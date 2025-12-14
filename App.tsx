import React, { useEffect, useRef, useState } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Type, FunctionDeclaration } from '@google/genai';
import { 
  Mic, 
  MicOff, 
  Video, 
  CameraOff,
  Power,
  X,
  Cpu,
  Zap,
  Activity
} from 'lucide-react';
import Visualizer from './components/Visualizer';
import { ConnectionState, AtmosphereState, NotificationState } from './types';
import { 
  AUDIO_INPUT_SAMPLE_RATE, 
  AUDIO_OUTPUT_SAMPLE_RATE, 
  createAudioBlob, 
  decodeAudioData, 
  base64ToBytes
} from './services/audioUtils';

// --- CONFIG ---
const MODEL_NAME = 'gemini-2.5-flash-native-audio-preview-09-2025';

const SYSTEM_INSTRUCTION = `
You are SAM (Synthetic Autonomous Mind).
You are a pure voice interface.
You are concise, intelligent, and have a slightly dry, sci-fi wit.
Your creator is the SAM Verce Collective.

VISUALS:
- Use 'update_blackboard' ONLY when you need to show complex code, lists, or math.
- Use 'set_atmosphere' to change the mood colors.
- Use 'show_notification' for system alerts.
`;

const tools: [{ functionDeclarations: FunctionDeclaration[] }] = [{
  functionDeclarations: [
    {
      name: "update_blackboard",
      description: "Show text/code on the HUD overlay.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          content: { type: Type.STRING },
        },
        required: ["content"]
      }
    },
    {
      name: "set_atmosphere",
      description: "Change UI color theme.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          mood: { type: Type.STRING, enum: ["default", "energy", "calm", "stranger"] }
        },
        required: ["mood"]
      }
    },
    {
      name: "show_notification",
      description: "Show a small system alert toast.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          message: { type: Type.STRING },
          type: { type: Type.STRING, enum: ["info", "success", "warning"] }
        },
        required: ["message"]
      }
    }
  ]
}];

// --- COMPONENT ---
const App: React.FC = () => {
  // Connection & Media State
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  const [isMicOn, setIsMicOn] = useState(true);
  const [isCameraOn, setIsCameraOn] = useState(false);
  
  // UI State
  const [atmosphere, setAtmosphere] = useState<AtmosphereState>('default');
  const [blackboard, setBlackboard] = useState({ isOpen: false, content: '', title: '' });
  const [notification, setNotification] = useState<NotificationState>({ visible: false, message: '', type: 'info' });
  const [volumeLevel, setVolumeLevel] = useState(0); 

  // Audio/Video Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sessionRef = useRef<any>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoIntervalRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  
  // Audio Queue
  const nextStartTimeRef = useRef<number>(0);
  const scheduledSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  // --- INITIALIZATION ---
  const initAudio = () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: AUDIO_OUTPUT_SAMPLE_RATE,
      });
      
      const analyser = audioContextRef.current.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.8;
      analyser.connect(audioContextRef.current.destination); // Connect to speakers
      analyserRef.current = analyser;
    }
    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }
  };

  const connectToGemini = async () => {
    try {
      initAudio();
      setConnectionState(ConnectionState.CONNECTING);
      
      // Get Mic
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { echoCancellation: true, noiseSuppression: true } 
      });
      mediaStreamRef.current = stream;

      // API Client
      const client = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      const sessionPromise = client.live.connect({
        model: MODEL_NAME,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: SYSTEM_INSTRUCTION,
          tools: tools,
        },
        callbacks: {
          onopen: () => {
            setConnectionState(ConnectionState.CONNECTED);
            setNotification({ visible: true, message: "SYSTEM ONLINE", type: "success" });
            startAudioInput(stream, sessionPromise);
          },
          onmessage: (msg: LiveServerMessage) => handleMessage(msg, sessionPromise),
          onclose: () => handleDisconnect(),
          onerror: (err) => {
            console.error(err);
            setNotification({ visible: true, message: "CONNECTION LOST", type: "warning" });
            handleDisconnect();
          }
        }
      });
      sessionRef.current = sessionPromise;

    } catch (e) {
      console.error(e);
      setConnectionState(ConnectionState.DISCONNECTED);
      setNotification({ visible: true, message: "INIT FAILED", type: "warning" });
    }
  };

  const handleDisconnect = () => {
    setConnectionState(ConnectionState.DISCONNECTED);
    setAtmosphere('default');
    setIsCameraOn(false);
    setBlackboard(prev => ({ ...prev, isOpen: false }));
    
    // Cleanup Audio
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(t => t.stop());
      mediaStreamRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    // Cleanup Video
    if (videoIntervalRef.current) clearInterval(videoIntervalRef.current);
    
    // Stop Playback
    scheduledSourcesRef.current.forEach(s => s.stop());
    scheduledSourcesRef.current.clear();
  };

  // --- AUDIO INPUT ---
  const startAudioInput = (stream: MediaStream, sessionPromise: Promise<any>) => {
    if (!audioContextRef.current) return;

    const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: AUDIO_INPUT_SAMPLE_RATE });
    const source = inputCtx.createMediaStreamSource(stream);
    const processor = inputCtx.createScriptProcessor(4096, 1, 1);
    
    processor.onaudioprocess = (e) => {
      if (!isMicOn) return;
      
      // Calculate volume for UI
      const inputData = e.inputBuffer.getChannelData(0);
      let sum = 0;
      // Sampling for performance
      for(let i=0; i<inputData.length; i+=50) sum += Math.abs(inputData[i]);
      setVolumeLevel(sum / (inputData.length/50));

      const blob = createAudioBlob(inputData);
      sessionPromise.then(sess => sess.sendRealtimeInput({ media: blob }));
    };

    source.connect(processor);
    processor.connect(inputCtx.destination); 
    processorRef.current = processor;
  };

  // --- HANDLING MESSAGES ---
  const handleMessage = async (msg: LiveServerMessage, sessionPromise: Promise<any>) => {
    // 1. Audio
    const audioData = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
    if (audioData && audioContextRef.current && analyserRef.current) {
      playAudio(audioData);
    }

    // 2. Interruption
    if (msg.serverContent?.interrupted) {
      scheduledSourcesRef.current.forEach(s => s.stop());
      scheduledSourcesRef.current.clear();
      nextStartTimeRef.current = audioContextRef.current?.currentTime || 0;
    }

    // 3. Tools
    if (msg.toolCall) {
      const responses = msg.toolCall.functionCalls.map(fc => {
        let result = { status: 'ok' };
        if (fc.name === 'update_blackboard') {
           setBlackboard({ isOpen: true, title: fc.args.title, content: fc.args.content });
        } else if (fc.name === 'set_atmosphere') {
           setAtmosphere(fc.args.mood);
        } else if (fc.name === 'show_notification') {
           setNotification({ visible: true, message: fc.args.message, type: fc.args.type });
        }
        return { id: fc.id, name: fc.name, response: { result } };
      });
      
      const session = await sessionPromise;
      session.sendToolResponse({ functionResponses: responses });
    }
  };

  const playAudio = (base64: string) => {
    if (!audioContextRef.current || !analyserRef.current) return;
    const ctx = audioContextRef.current;
    
    try {
      const bytes = base64ToBytes(base64);
      const buffer = decodeAudioData(bytes, ctx);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(analyserRef.current);
      
      const start = Math.max(ctx.currentTime, nextStartTimeRef.current);
      source.start(start);
      nextStartTimeRef.current = start + buffer.duration;
      
      scheduledSourcesRef.current.add(source);
      source.onended = () => scheduledSourcesRef.current.delete(source);
    } catch(e) { console.error("Audio Decode Error", e); }
  };

  // --- VIDEO HANDLING ---
  const toggleCamera = async () => {
    if (isCameraOn) {
      setIsCameraOn(false);
      if (videoIntervalRef.current) clearInterval(videoIntervalRef.current);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }
        setIsCameraOn(true);
        
        // Start sending frames
        videoIntervalRef.current = window.setInterval(async () => {
          if (!videoRef.current || !canvasRef.current || !sessionRef.current) return;
          const ctx = canvasRef.current.getContext('2d');
          canvasRef.current.width = videoRef.current.videoWidth;
          canvasRef.current.height = videoRef.current.videoHeight;
          ctx?.drawImage(videoRef.current, 0, 0);
          
          const base64 = canvasRef.current.toDataURL('image/jpeg', 0.5).split(',')[1];
          const sess = await sessionRef.current;
          sess.sendRealtimeInput({ media: { mimeType: 'image/jpeg', data: base64 } });
        }, 1000); // 1 FPS to save bandwidth
        
      } catch (e) {
        setNotification({ visible: true, message: "CAMERA ERROR", type: "warning" });
      }
    }
  };

  // --- RENDER HELPERS ---
  useEffect(() => {
    if (notification.visible) {
      const t = setTimeout(() => setNotification(prev => ({...prev, visible: false})), 3000);
      return () => clearTimeout(t);
    }
  }, [notification]);

  const getThemeColor = () => {
    switch(atmosphere) {
      case 'stranger': return 'text-red-500 border-red-500 shadow-red-900';
      case 'energy': return 'text-purple-400 border-purple-500 shadow-purple-900';
      case 'calm': return 'text-teal-400 border-teal-500 shadow-teal-900';
      default: return 'text-cyan-400 border-cyan-500 shadow-cyan-900';
    }
  };

  return (
    <div className="relative w-full h-screen bg-black text-gray-200 overflow-hidden font-sans selection:bg-cyan-500/30">
      
      {/* BACKGROUND & EFFECTS */}
      <div className="absolute inset-0 bg-noise pointer-events-none z-0"></div>
      <div className={`absolute inset-0 bg-gradient-to-b from-black via-transparent to-black opacity-80 z-0 transition-colors duration-1000 ${
        atmosphere === 'stranger' ? 'via-red-950/20' : ''
      }`} />
      
      {/* HIDDEN ELEMENTS FOR PROCESSING */}
      <canvas ref={canvasRef} className="hidden" />
      <video ref={videoRef} className="hidden" muted playsInline />

      {/* --- LAYER 1: VISUALIZER (BACKGROUND) --- */}
      <div className="absolute inset-0 z-10 flex items-center justify-center">
        <Visualizer 
          analyser={analyserRef.current} 
          isActive={connectionState === ConnectionState.CONNECTED} 
          mood={atmosphere}
        />
      </div>

      {/* --- LAYER 2: HUD OVERLAY --- */}
      <div className="relative z-20 w-full h-full flex flex-col justify-between p-6 md:p-12 pointer-events-none">
        
        {/* TOP BAR */}
        <div className="flex justify-between items-start">
          <div className="flex flex-col gap-1 animate-fade-in">
             <div className="flex items-center gap-2">
                <Cpu size={18} className={getThemeColor().split(' ')[0]} />
                <h1 className="font-tech text-2xl font-bold tracking-widest text-white">SAM <span className="text-xs opacity-50 font-normal">OS v3.1</span></h1>
             </div>
             <div className="flex items-center gap-2 text-[10px] font-mono tracking-widest text-gray-500 uppercase">
                <Activity size={10} />
                <span>Neural Engine: {connectionState}</span>
             </div>
          </div>

          {/* NOTIFICATION TOAST */}
          <div className={`transition-all duration-500 transform ${notification.visible ? 'translate-y-0 opacity-100' : '-translate-y-4 opacity-0'}`}>
            <div className={`flex items-center gap-3 px-6 py-2 bg-black/80 backdrop-blur border border-l-4 ${
              notification.type === 'warning' ? 'border-l-red-500 border-white/10' : 'border-l-cyan-500 border-white/10'
            }`}>
              <Zap size={14} className="text-white" />
              <span className="font-mono text-xs text-white uppercase tracking-wider">{notification.message}</span>
            </div>
          </div>
        </div>

        {/* CENTER CONTENT (START & LOADING SCREENS) */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            
            {/* DISCONNECTED - Central Start Button */}
            {connectionState === ConnectionState.DISCONNECTED && (
              <button 
                onClick={connectToGemini}
                className="pointer-events-auto group relative flex flex-col items-center justify-center transition-all duration-700 hover:scale-105"
              >
                 <div className="relative w-32 h-32 flex items-center justify-center rounded-full border border-cyan-500/30 bg-black/50 backdrop-blur-md shadow-[0_0_30px_rgba(0,255,255,0.1)] group-hover:shadow-[0_0_60px_rgba(0,255,255,0.4)] transition-all">
                    <Power size={48} className="text-cyan-500/80 group-hover:text-cyan-400 transition-colors" />
                    <div className="absolute inset-0 rounded-full border border-cyan-400/20 animate-ping-slow"></div>
                 </div>
                 <span className="mt-6 font-tech text-lg tracking-[0.3em] text-cyan-500/80 group-hover:text-cyan-400">INITIALIZE SYSTEM</span>
              </button>
            )}

            {/* CONNECTING - Central Full Loader */}
            {connectionState === ConnectionState.CONNECTING && (
               <div className="flex flex-col items-center justify-center animate-fade-in z-50 p-8 bg-black/40 backdrop-blur-xl rounded-2xl border border-white/5">
                  <div className="relative w-24 h-24">
                     <div className="absolute inset-0 rounded-full border-t-2 border-cyan-400 animate-spin"></div>
                     <div className="absolute inset-2 rounded-full border-r-2 border-cyan-600 animate-spin-reverse"></div>
                     <div className="absolute inset-0 flex items-center justify-center">
                        <Cpu size={24} className="text-cyan-500 animate-pulse" />
                     </div>
                  </div>
                  <div className="mt-8 flex flex-col items-center gap-2">
                    <h2 className="font-tech text-xl text-cyan-400 tracking-widest animate-pulse">ESTABLISHING UPLINK</h2>
                    <span className="font-mono text-xs text-cyan-500/50">SECURE HANDSHAKE IN PROGRESS...</span>
                  </div>
               </div>
            )}
        </div>

        {/* CENTER BLACKBOARD (Modal) */}
        {blackboard.isOpen && (
           <div className="absolute inset-0 flex items-center justify-center pointer-events-auto z-50 bg-black/60 backdrop-blur-sm animate-fade-in">
              <div className="w-full max-w-2xl bg-black/90 border border-white/20 p-8 shadow-[0_0_50px_rgba(0,0,0,0.8)] relative">
                  <div className="flex justify-between items-center mb-6 border-b border-white/10 pb-4">
                     <h2 className={`font-tech text-lg tracking-widest ${getThemeColor().split(' ')[0]}`}>{blackboard.title || "DATA STREAM"}</h2>
                     <button onClick={() => setBlackboard(prev => ({...prev, isOpen: false}))} className="hover:text-white transition"><X /></button>
                  </div>
                  <pre className="font-mono text-sm text-gray-300 whitespace-pre-wrap overflow-y-auto max-h-[60vh] custom-scrollbar">
                    {blackboard.content}
                  </pre>
                  <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-white"></div>
                  <div className="absolute top-0 right-0 w-2 h-2 border-t border-r border-white"></div>
                  <div className="absolute bottom-0 left-0 w-2 h-2 border-b border-l border-white"></div>
                  <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-white"></div>
              </div>
           </div>
        )}

        {/* BOTTOM BAR (CONTROLS) - Only visible when CONNECTED */}
        <div className="flex items-end justify-center pointer-events-auto pb-8 min-h-[100px]">
           {connectionState === ConnectionState.CONNECTED && (
              <div className="flex items-center gap-6 animate-fade-in bg-black/40 px-8 py-4 rounded-full border border-white/10 backdrop-blur-md">
                 
                 {/* Cam Toggle */}
                 <button 
                   onClick={toggleCamera}
                   className={`p-4 rounded-full border transition-all duration-300 hover:scale-105 ${
                     isCameraOn 
                     ? 'bg-white text-black border-white shadow-[0_0_20px_rgba(255,255,255,0.4)]' 
                     : 'bg-transparent text-gray-400 border-gray-600 hover:border-gray-400 hover:text-white'
                   }`}
                 >
                   {isCameraOn ? <Video size={24} /> : <CameraOff size={24} />}
                 </button>

                 {/* Mic Toggle (Main) */}
                 <button 
                   onClick={() => setIsMicOn(!isMicOn)}
                   className={`relative p-5 rounded-full border transition-all duration-300 hover:scale-110 ${
                     isMicOn 
                     ? `bg-cyan-900/20 text-cyan-400 border-cyan-500/50 shadow-[0_0_30px_rgba(0,255,255,0.15)]`
                     : 'bg-red-900/20 text-red-500 border-red-500/50'
                   }`}
                 >
                   {isMicOn ? <Mic size={28} /> : <MicOff size={28} />}
                   {/* Voice Activity Indicator */}
                   {isMicOn && (
                     <div 
                       className="absolute inset-0 rounded-full border border-white/30 transition-transform duration-75"
                       style={{ transform: `scale(${1 + volumeLevel * 0.5})` }}
                     />
                   )}
                 </button>

                 {/* Disconnect */}
                 <button 
                   onClick={handleDisconnect}
                   className="p-4 rounded-full bg-transparent text-gray-400 border border-gray-600 hover:bg-red-900/30 hover:border-red-500 hover:text-red-500 transition-all duration-300 hover:scale-105"
                 >
                   <X size={24} />
                 </button>

              </div>
           )}
        </div>
      </div>
    </div>
  );
};

export default App;