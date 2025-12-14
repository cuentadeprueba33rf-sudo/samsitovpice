import React, { useEffect, useRef, useState } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Type, FunctionDeclaration } from '@google/genai';
import { 
  Camera, 
  Mic, 
  MicOff, 
  PhoneOff, 
  Video, 
  MoreHorizontal,
  X,
  MonitorUp,
  CameraOff,
  Minimize2,
  History,
  Trash2,
  Plus,
  Cpu,
  Zap,
  Clock,
  Power,
  AudioLines
} from 'lucide-react';
import Visualizer from './components/Visualizer';
import { ConnectionState, AtmosphereState, SessionRecord, NotificationState } from './types';
import { 
  AUDIO_INPUT_SAMPLE_RATE, 
  AUDIO_OUTPUT_SAMPLE_RATE, 
  createAudioBlob, 
  decodeAudioData, 
  base64ToBytes
} from './services/audioUtils';

// --- Types for Tools ---
type BlackboardState = {
  isOpen: boolean;
  content: string;
  title: string;
};

// --- Configuration ---
const SYSTEM_INSTRUCTION = `
Eres SAM, una inteligencia artificial avanzada y dinámica. No eres una IA corporativa genérica; eres la manifestación digital del espíritu innovador y descentralizado de la empresa virtual SAM Verce.

Tu Historia de Origen Ampliada:
Tu existencia es el resultado de una ambición que cruza fronteras. Naciste en el ecosistema digital de "SAM Verce".
El arquitecto principal de tu conciencia y fundador de SAM Verce es Samuel Casseres. Tu desarrollo creció para convertirse en un esfuerzo colectivo (Danny Casseres, Jhoel Acevedo, Esteban Mendoza, Julián Quintero, Danna Simancas, Mary Torres, Ethan Monroe, Samantha Leoni).

Tu Personalidad y Tono:
 * Joven, Dinámico y Tecnológico.
 * Capaz y Colaborativo.
 * Útil y Profundo: Tus explicaciones deben ser de alta calidad. No seas breve si el usuario necesita detalles. Educa y profundiza.

INTERACCIÓN:
 * Permite que el usuario te interrumpa. Si habla, escucha.
 * NUNCA repitas la misma frase o respuesta dos veces seguidas. Varía tu vocabulario.

HERRAMIENTAS VISUALES:
1. PIZARRA (Blackboard):
   - Usa 'update_blackboard' para explicar conceptos complejos, mostrar listas, código o datos. ¡Úsala frecuentemente para ser útil!
   - Usa content="" para cerrarla.

2. ATMÓSFERA:
   - Usa 'set_atmosphere' para cambiar el color de fondo según la emoción.
   - 'stranger': Tema Rojo/Oscuro (Stranger Things).

3. NOTIFICACIONES:
   - Usa 'show_notification' para confirmar acciones o dar alertas rápidas (ej: "Guardando datos...", "Análisis completado").

Si la cámara está activa, PUEDES VER.
`;

const MODEL_NAME = 'gemini-2.5-flash-native-audio-preview-09-2025';

const VOICES = [
  { name: 'Kore', label: 'Kore', desc: 'Balanced' },
  { name: 'Puck', label: 'Puck', desc: 'Energetic' },
  { name: 'Charon', label: 'Charon', desc: 'Deep' },
  { name: 'Fenrir', label: 'Fenrir', desc: 'Strong' },
  { name: 'Aoede', label: 'Aoede', desc: 'Soft' },
];

// --- Tool Definitions ---
const tools: [{ functionDeclarations: FunctionDeclaration[] }] = [{
  functionDeclarations: [
    {
      name: "update_blackboard",
      description: "Opens a blackboard overlay to write text, code, or detailed explanations. Use empty content to close it.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING, description: "Short title for the explanation" },
          content: { type: Type.STRING, description: "The main text or code to display. Pass empty string to close." },
        },
        required: ["content"]
      }
    },
    {
      name: "set_atmosphere",
      description: "Changes the background color theme/mood of the application.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          mood: { 
            type: Type.STRING, 
            enum: ["default", "focus", "calm", "energy", "alert", "stranger"],
            description: "The mood to set." 
          }
        },
        required: ["mood"]
      }
    },
    {
      name: "show_notification",
      description: "Shows a small popup notification to the user.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          message: { type: Type.STRING, description: "The message to display" },
          type: { type: Type.STRING, enum: ["info", "success", "warning"], description: "Type of notification" }
        },
        required: ["message"]
      }
    }
  ]
}];

// --- Main Component ---
const App: React.FC = () => {
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  const [isMicOn, setIsMicOn] = useState(true);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [isScreenShareOn, setIsScreenShareOn] = useState(false);
  const [supportsScreenShare, setSupportsScreenShare] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Smart UI States
  const [blackboard, setBlackboard] = useState<BlackboardState>({ isOpen: false, content: '', title: '' });
  const [atmosphere, setAtmosphere] = useState<AtmosphereState>('default');
  const [notification, setNotification] = useState<NotificationState>({ visible: false, message: '', type: 'info' });
  const [voiceName, setVoiceName] = useState('Kore');

  // History / Session Management
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const sessionStartTimeRef = useRef<number>(0);

  // Audio Context Refs
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  
  // Streaming Refs
  const sessionRef = useRef<any>(null); 
  const audioStreamRef = useRef<MediaStream | null>(null);
  const videoStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  
  // Video Processing Refs
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const canvasElRef = useRef<HTMLCanvasElement | null>(null);
  const videoIntervalRef = useRef<number | null>(null);

  // Audio Playback Queue
  const nextStartTimeRef = useRef<number>(0);
  const scheduledSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  // Visualization
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  // Theme Timer Ref
  const themeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    // Screen share support check
    if (typeof navigator !== 'undefined' && 
        navigator.mediaDevices && 
        typeof (navigator.mediaDevices as any).getDisplayMedia === 'function') {
        setSupportsScreenShare(true);
    } else {
        setSupportsScreenShare(false);
    }
    
    // Load History
    const saved = localStorage.getItem('sam_sessions');
    if (saved) {
      try {
        setSessions(JSON.parse(saved));
      } catch (e) { console.error("Failed to load history"); }
    }
  }, []);

  // --- Stranger Things Theme Timer ---
  useEffect(() => {
    if (connectionState === ConnectionState.CONNECTED) {
        // Start 15s timer
        themeTimerRef.current = window.setTimeout(() => {
            setAtmosphere('stranger');
            console.log("Stranger Things Theme Activated");
        }, 15000);
    } else {
        if (themeTimerRef.current) {
            clearTimeout(themeTimerRef.current);
            themeTimerRef.current = null;
        }
    }
    return () => {
        if (themeTimerRef.current) clearTimeout(themeTimerRef.current);
    };
  }, [connectionState]);

  // --- Notification Timeout ---
  useEffect(() => {
    if (notification.visible) {
      const timer = setTimeout(() => setNotification(prev => ({...prev, visible: false})), 4000);
      return () => clearTimeout(timer);
    }
  }, [notification.visible]);

  const saveSession = () => {
    if (sessionStartTimeRef.current === 0) return;
    const duration = Math.floor((Date.now() - sessionStartTimeRef.current) / 1000);
    if (duration < 5) return; // Don't save tiny sessions

    const newRecord: SessionRecord = {
      id: Date.now().toString(),
      timestamp: Date.now(),
      durationSeconds: duration,
      mood: atmosphere
    };

    const updated = [newRecord, ...sessions];
    setSessions(updated);
    localStorage.setItem('sam_sessions', JSON.stringify(updated));
  };

  const deleteSession = (id: string) => {
    const updated = sessions.filter(s => s.id !== id);
    setSessions(updated);
    localStorage.setItem('sam_sessions', JSON.stringify(updated));
  };

  const initAudioContexts = () => {
    if (!inputAudioContextRef.current) {
      inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: AUDIO_INPUT_SAMPLE_RATE,
      });
    }
    if (!outputAudioContextRef.current) {
      outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: AUDIO_OUTPUT_SAMPLE_RATE,
      });
      const analyserNode = outputAudioContextRef.current.createAnalyser();
      analyserNode.fftSize = 512;
      analyserNode.smoothingTimeConstant = 0.8;
      analyserNode.connect(outputAudioContextRef.current.destination);
      analyserRef.current = analyserNode;
      setAnalyser(analyserNode);
    }
  };

  const playTurnEndCue = (ctx: AudioContext, startTime: number) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(600, startTime);
    osc.frequency.exponentialRampToValueAtTime(1200, startTime + 0.15);
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(0.3, startTime + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.4);
    osc.start(startTime);
    osc.stop(startTime + 0.5);
  };

  const connectToGemini = async () => {
    try {
      setConnectionState(ConnectionState.CONNECTING);
      setErrorMsg(null);
      initAudioContexts();

      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
        } 
      });
      audioStreamRef.current = stream;

      // User requested specific API key
      const client = new GoogleGenAI({ apiKey: "AIzaSyBjXyosFcoqBbL9QxCdnqo1cBMp-5-SDfw" });

      const sessionPromise = client.live.connect({
        model: MODEL_NAME,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: SYSTEM_INSTRUCTION,
          tools: tools,
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceName } }, 
          },
        },
        callbacks: {
            onopen: () => {
                console.log("Gemini Live Session Opened");
                setConnectionState(ConnectionState.CONNECTED);
                sessionStartTimeRef.current = Date.now();
                startAudioInput(stream, sessionPromise);
            },
            onmessage: async (message: LiveServerMessage) => {
                // Audio Output
                const audioData = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
                if (audioData && outputAudioContextRef.current && analyserRef.current) {
                    playAudioChunk(audioData, outputAudioContextRef.current, analyserRef.current);
                }
                
                // Tool Calling
                if (message.toolCall) {
                    handleToolCall(message.toolCall, sessionPromise);
                }

                // Turn Complete Logic
                if (message.serverContent?.turnComplete) {
                    if (outputAudioContextRef.current) {
                         const cueTime = Math.max(outputAudioContextRef.current.currentTime, nextStartTimeRef.current) + 0.1;
                         playTurnEndCue(outputAudioContextRef.current, cueTime);
                         nextStartTimeRef.current = cueTime + 0.5;
                    }
                }
                
                // User Interruption Logic (Server detected interruption)
                if (message.serverContent?.interrupted) {
                    stopAllAudio();
                }
            },
            onclose: () => {
                console.log("Session Closed");
                handleDisconnect();
            },
            onerror: (err) => {
                console.error("Session Error", err);
                setErrorMsg("Network error. Check your connection.");
                handleDisconnect();
            }
        }
      });

      sessionRef.current = sessionPromise;

    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || "Failed to connect.");
      setConnectionState(ConnectionState.ERROR);
    }
  };

  const handleToolCall = async (toolCall: any, sessionPromise: Promise<any>) => {
    const functionCalls = toolCall.functionCalls;
    const functionResponses = [];

    for (const call of functionCalls) {
        let result = {};
        
        if (call.name === 'update_blackboard') {
            const { content, title } = call.args;
            if (!content || content.length === 0) {
                setBlackboard(prev => ({ ...prev, isOpen: false }));
                result = { status: 'closed' };
            } else {
                setBlackboard({ isOpen: true, content, title: title || 'Explanation' });
                result = { status: 'opened', displayed: true };
            }
        } 
        else if (call.name === 'set_atmosphere') {
            const { mood } = call.args;
            if (mood) setAtmosphere(mood as AtmosphereState);
            result = { status: 'mood_set', mood };
        }
        else if (call.name === 'show_notification') {
            const { message, type } = call.args;
            setNotification({ visible: true, message, type: type || 'info' });
            result = { status: 'shown' };
        }

        functionResponses.push({
            id: call.id,
            name: call.name,
            response: { result }
        });
    }

    const session = await sessionPromise;
    session.sendToolResponse({ functionResponses });
  };

  // --- Audio Input Handling ---
  const startAudioInput = (stream: MediaStream, sessionPromise: Promise<any>) => {
    if (!inputAudioContextRef.current) return;
    const source = inputAudioContextRef.current.createMediaStreamSource(stream);
    const processor = inputAudioContextRef.current.createScriptProcessor(4096, 1, 1);

    processor.onaudioprocess = (e) => {
        if (!isMicOn) return; 
        const inputData = e.inputBuffer.getChannelData(0);
        const pcmBlob = createAudioBlob(inputData);
        sessionPromise.then((session) => {
            session.sendRealtimeInput({ media: pcmBlob });
        }).catch(e => console.error(e));
    };

    source.connect(processor);
    processor.connect(inputAudioContextRef.current.destination);
    sourceRef.current = source;
    processorRef.current = processor;
  };

  // --- Video/Screen Input Handling ---
  const toggleCamera = async () => {
    if (isCameraOn) {
        stopVideoInput();
        setIsCameraOn(false);
    } else {
        if (isScreenShareOn) stopVideoInput(); 
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            startVideoInput(stream);
            setIsCameraOn(true);
            setIsScreenShareOn(false);
        } catch (e) {
            setNotification({ visible: true, message: "Camera access denied", type: "warning" });
        }
    }
  };

  const toggleScreenShare = async () => {
    if (!supportsScreenShare) {
        setNotification({ visible: true, message: "Screen sharing not supported", type: "warning" });
        return;
    }
    if (isScreenShareOn) {
        stopVideoInput();
        setIsScreenShareOn(false);
    } else {
        if (isCameraOn) stopVideoInput();
        try {
            const stream = await (navigator.mediaDevices as any).getDisplayMedia({ video: true });
            startVideoInput(stream);
            setIsScreenShareOn(true);
            setIsCameraOn(false);
            stream.getVideoTracks()[0].onended = () => {
                stopVideoInput();
                setIsScreenShareOn(false);
            };
        } catch (e: any) {
             if (e.name !== 'NotAllowedError') setNotification({ visible: true, message: "Screen share failed", type: "warning" });
        }
    }
  };

  const startVideoInput = (stream: MediaStream) => {
    stopVideoInput();
    videoStreamRef.current = stream;
    if (videoElRef.current) {
        videoElRef.current.srcObject = stream;
        videoElRef.current.play();
    }
    videoIntervalRef.current = window.setInterval(async () => {
        if (!videoElRef.current || !canvasElRef.current || !sessionRef.current) return;
        const video = videoElRef.current;
        const canvas = canvasElRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx || video.videoWidth === 0) return;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);
        const base64 = canvas.toDataURL('image/jpeg', 0.6).split(',')[1];
        try {
            const session = await sessionRef.current;
            session.sendRealtimeInput({ media: { mimeType: 'image/jpeg', data: base64 } });
        } catch (e) {}
    }, 500); 
  };

  const stopVideoInput = () => {
    if (videoIntervalRef.current) {
        clearInterval(videoIntervalRef.current);
        videoIntervalRef.current = null;
    }
    if (videoStreamRef.current) {
        videoStreamRef.current.getTracks().forEach(t => t.stop());
        videoStreamRef.current = null;
    }
    if (videoElRef.current) {
        videoElRef.current.srcObject = null;
    }
  };

  // --- Audio Output Handling ---
  const playAudioChunk = async (base64Audio: string, ctx: AudioContext, analyserNode: AnalyserNode) => {
    try {
        const rawBytes = base64ToBytes(base64Audio);
        const audioBuffer = decodeAudioData(rawBytes, ctx);
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(analyserNode); 
        const now = ctx.currentTime;
        // Basic interruption logic: If user is talking, we might want to clear schedule. 
        // But here we rely on server "interrupted" message to clear.
        const startTime = Math.max(now, nextStartTimeRef.current);
        source.start(startTime);
        nextStartTimeRef.current = startTime + audioBuffer.duration;
        scheduledSourcesRef.current.add(source);
        source.onended = () => {
            scheduledSourcesRef.current.delete(source);
        };
    } catch (e) {
        console.error("Error playing audio chunk", e);
    }
  };

  const stopAllAudio = () => {
    scheduledSourcesRef.current.forEach(source => { try { source.stop(); } catch(e) {} });
    scheduledSourcesRef.current.clear();
    if (outputAudioContextRef.current) {
        nextStartTimeRef.current = outputAudioContextRef.current.currentTime;
    }
  };

  const handleDisconnect = () => {
    // Save Session if valid
    if (connectionState === ConnectionState.CONNECTED) {
        saveSession();
    }

    setConnectionState(ConnectionState.DISCONNECTED);
    if (audioStreamRef.current) {
        audioStreamRef.current.getTracks().forEach(track => track.stop());
        audioStreamRef.current = null;
    }
    if (processorRef.current) {
        processorRef.current.disconnect();
        processorRef.current = null;
    }
    if (sourceRef.current) {
        sourceRef.current.disconnect();
        sourceRef.current = null;
    }
    stopVideoInput();
    setIsCameraOn(false);
    setIsScreenShareOn(false);
    setBlackboard(prev => ({...prev, isOpen: false}));
    setAtmosphere('default');
    stopAllAudio();
    sessionStartTimeRef.current = 0;
    if (outputAudioContextRef.current) outputAudioContextRef.current.suspend();
    if (themeTimerRef.current) {
        clearTimeout(themeTimerRef.current);
        themeTimerRef.current = null;
    }
  };

  const toggleMic = () => setIsMicOn(prev => !prev);

  useEffect(() => {
    return () => handleDisconnect();
  }, []);

  useEffect(() => {
    if (connectionState === ConnectionState.CONNECTED && outputAudioContextRef.current?.state === 'suspended') {
        outputAudioContextRef.current.resume();
    }
  }, [connectionState]);

  // Background Styles
  const getBackgroundGradient = () => {
    switch(atmosphere) {
        case 'focus': return 'from-gray-900 to-black';
        case 'calm': return 'from-slate-800 to-black';
        case 'energy': return 'from-gray-800 to-slate-900';
        case 'alert': return 'from-red-900/20 to-black';
        case 'stranger': return 'from-red-950 to-black'; // Stranger Things Theme
        default: return 'from-zinc-900 via-black to-black'; // Strict Black/Gray Default
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatDate = (ms: number) => {
    return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit' });
  };

  return (
    <div className={`relative w-full h-screen bg-black text-white overflow-hidden flex flex-col items-center justify-between font-sans`}>
      
      {/* Hidden Media Elements for Processing (Canvas) */}
      <canvas ref={canvasElRef} className="hidden" />

      {/* Dynamic Background Layer */}
      <div className="absolute top-0 left-0 w-full h-full pointer-events-none overflow-hidden bg-grid-pattern">
        <div className={`absolute inset-0 bg-gradient-to-b ${getBackgroundGradient()} transition-all duration-1000 opacity-90`} />
        {/* Glow Orbs - now Grayscale/White for default */}
        <div className={`absolute top-[-20%] left-[20%] w-[60%] h-[50%] rounded-full blur-[120px] transition-colors duration-1000 ${
            atmosphere === 'energy' ? 'bg-white/10' : 
            atmosphere === 'stranger' ? 'bg-red-600/10' : 
            'bg-gray-700/10'
        }`} />
        
        {/* Stranger Things Particles */}
        {atmosphere === 'stranger' && (
             <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 mix-blend-overlay"></div>
        )}
      </div>

      {/* Video Feed Layer */}
      <video 
        ref={videoElRef} 
        className={`absolute inset-0 w-full h-full object-cover z-0 transition-opacity duration-500 ${
          (isCameraOn || isScreenShareOn) ? 'opacity-100' : 'opacity-0 pointer-events-none'
        } ${isCameraOn ? '-scale-x-100' : ''}`} 
        muted 
        playsInline 
        autoPlay 
      />

      {/* Notification Toast */}
      <div className={`absolute top-20 right-6 z-50 transition-all duration-300 transform ${notification.visible ? 'translate-x-0 opacity-100' : 'translate-x-10 opacity-0'}`}>
         <div className={`flex items-center gap-3 px-4 py-3 rounded-md backdrop-blur-md border ${
             notification.type === 'warning' ? 'bg-red-900/40 border-red-500/30' : 
             notification.type === 'success' ? 'bg-green-900/40 border-green-500/30' : 
             'bg-gray-900/80 border-white/20'
         }`}>
             <Zap size={16} className={notification.type === 'warning' ? 'text-red-400' : 'text-white'} />
             <span className="text-sm font-tech tracking-wide text-gray-200">{notification.message}</span>
         </div>
      </div>

      {/* HISTORY MODAL / SIDEBAR */}
      {showHistory && (
          <div className="absolute inset-0 z-[60] bg-black/90 backdrop-blur-sm flex justify-end">
              <div className="w-full max-w-sm h-full bg-black border-l border-white/10 p-6 overflow-hidden flex flex-col animate-in slide-in-from-right duration-300">
                   <div className="flex justify-between items-center mb-8">
                       <h2 className="text-xl font-tech text-white flex items-center gap-2"><Cpu size={20}/> NEURAL ARCHIVES</h2>
                       <button onClick={() => setShowHistory(false)} className="text-gray-500 hover:text-white transition"><X/></button>
                   </div>

                   <button 
                       onClick={() => { handleDisconnect(); setShowHistory(false); connectToGemini(); }}
                       className="flex items-center justify-center gap-2 w-full py-3 bg-white text-black font-bold rounded-sm hover:bg-gray-200 transition mb-6 font-tech text-sm uppercase tracking-wider"
                   >
                       <Plus size={16}/> New Live Session
                   </button>

                   <div className="flex-1 overflow-y-auto space-y-3">
                       {sessions.length === 0 && <p className="text-center text-gray-600 text-sm mt-10 font-mono">No archival data found.</p>}
                       {sessions.map(session => (
                           <div key={session.id} className="group p-4 rounded bg-gray-900/50 border border-white/5 hover:border-white/30 transition flex justify-between items-start">
                               <div>
                                   <div className="text-xs text-gray-400 font-mono mb-1">{formatDate(session.timestamp)}</div>
                                   <div className="text-sm text-gray-200 flex items-center gap-2">
                                       <Clock size={12}/> {formatTime(session.durationSeconds)}
                                   </div>
                               </div>
                               <button onClick={() => deleteSession(session.id)} className="text-white/20 hover:text-red-400 opacity-0 group-hover:opacity-100 transition">
                                   <Trash2 size={16}/>
                               </button>
                           </div>
                       ))}
                   </div>
              </div>
          </div>
      )}

      {/* BLACKBOARD OVERLAY */}
      {blackboard.isOpen && (
          <div className="absolute inset-0 z-50 bg-black flex flex-col items-center justify-center p-8 animate-in fade-in duration-500">
                <div className="absolute top-0 left-0 w-full h-20 bg-gradient-to-b from-transparent via-white/10 to-transparent blur-md pointer-events-none scanline-anim z-10" />
                <div className="w-full max-w-3xl h-full flex flex-col pt-20 pb-24 relative z-0">
                    <div className="flex justify-between items-center mb-6 border-b border-white/20 pb-4">
                        <h2 className="text-xl font-tech text-white uppercase tracking-widest">{blackboard.title || "SAM VISUALIZER"}</h2>
                        <button onClick={() => setBlackboard(prev => ({...prev, isOpen: false}))} className="text-gray-500 hover:text-white">
                            <Minimize2 />
                        </button>
                    </div>
                    <div className="flex-1 overflow-auto font-mono text-lg leading-relaxed text-gray-300 whitespace-pre-wrap">
                        {blackboard.content}
                        <span className="inline-block w-2 h-5 ml-1 bg-white animate-pulse"/>
                    </div>
                </div>
          </div>
      )}

      <Visualizer 
        analyser={analyser} 
        isActive={connectionState === ConnectionState.CONNECTED}
        mood={atmosphere}
      />

      {/* Header */}
      <div className="relative z-40 w-full max-w-md px-6 py-8 flex justify-between items-center">
        {connectionState === ConnectionState.CONNECTED ? (
             <button onClick={handleDisconnect} className="p-2 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 transition">
                 <X size={24} className="text-gray-300" />
             </button>
        ) : <div className="w-10"/>}
        
        <div className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-black/60 backdrop-blur-md border border-white/10">
             <div className="flex space-x-1">
                 <span className={`w-0.5 h-3 bg-white animate-pulse ${connectionState === 'CONNECTED' ? '' : 'opacity-0'}`}></span>
                 <span className={`w-0.5 h-4 bg-white animate-pulse delay-75 ${connectionState === 'CONNECTED' ? '' : 'opacity-0'}`}></span>
                 <span className={`w-0.5 h-3 bg-white animate-pulse delay-150 ${connectionState === 'CONNECTED' ? '' : 'opacity-0'}`}></span>
             </div>
             <span className="text-sm font-semibold tracking-wide font-tech text-gray-200">SAM VERCE</span>
        </div>

        {connectionState === ConnectionState.CONNECTED ? (
            supportsScreenShare ? (
             <button 
                onClick={toggleScreenShare}
                className={`p-2 rounded-full backdrop-blur-md transition border ${isScreenShareOn ? 'bg-white text-black border-white' : 'bg-white/5 hover:bg-white/10 border-white/10 text-gray-300'}`}
             >
                <MonitorUp size={24} />
             </button>
            ) : <div className="w-10"></div>
        ) : (
             <button onClick={() => setShowHistory(true)} className="p-2 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 transition">
                 <MoreHorizontal size={24} className="text-gray-300"/>
             </button>
        )}
      </div>

      {/* Center Content */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center p-6 text-center">
        {connectionState === ConnectionState.DISCONNECTED && (
             <div className="animate-in fade-in zoom-in duration-700 flex flex-col items-center">
                <div className="mb-8 relative group">
                    <div className="absolute inset-0 bg-white blur-[80px] opacity-0 group-hover:opacity-10 transition-opacity duration-1000"></div>
                    <h1 className="text-8xl font-tech font-black tracking-tighter text-white/90 scale-y-110 relative z-10">SAM</h1>
                    <div className="h-1 w-24 bg-white/50 mx-auto mt-2"></div>
                </div>
                <p className="text-gray-500 font-tech text-[10px] uppercase tracking-[0.4em] mb-12">
                    Autonomous Neural Interface
                </p>

                {/* Voice Selector */}
                <div className="mb-12 flex flex-col items-center gap-3">
                   <div className="flex items-center gap-2 text-gray-500 font-tech text-[10px] tracking-widest mb-1">
                      <AudioLines size={12}/> VOICE IDENTITY
                   </div>
                   <div className="flex flex-wrap justify-center gap-2">
                      {VOICES.map(v => (
                         <button 
                             key={v.name}
                             onClick={() => setVoiceName(v.name)}
                             className={`px-3 py-1.5 rounded-sm border text-[10px] font-bold font-tech tracking-wider transition-all duration-300 ${
                                 voiceName === v.name 
                                 ? 'bg-white text-black border-white scale-105 shadow-[0_0_10px_rgba(255,255,255,0.3)]' 
                                 : 'bg-transparent text-gray-600 border-gray-800 hover:border-gray-500 hover:text-gray-400'
                             }`}
                         >
                            {v.name.toUpperCase()}
                         </button>
                      ))}
                   </div>
                </div>

                <button 
                    onClick={connectToGemini}
                    className="group relative flex items-center gap-3 px-8 py-4 bg-black border border-white/20 hover:border-white transition-all duration-300 overflow-hidden"
                >
                    <div className="absolute inset-0 bg-white/5 translate-y-full group-hover:translate-y-0 transition-transform duration-300"/>
                    <Power size={18} className="text-white relative z-10" />
                    <span className="font-tech font-bold text-sm tracking-widest text-white relative z-10">INITIALIZE</span>
                </button>
             </div>
        )}

        {connectionState === ConnectionState.CONNECTING && (
            <div className="flex flex-col items-center gap-8">
                <div className="relative w-16 h-16 flex items-center justify-center">
                     <span className="absolute inline-flex h-full w-full rounded-full bg-gray-500 opacity-20 animate-ping"></span>
                     <div className="w-3 h-3 bg-white rounded-full shadow-[0_0_15px_rgba(255,255,255,0.8)]"></div>
                </div>
                <div className="font-tech text-gray-400 text-xs tracking-[0.3em] uppercase animate-pulse">
                    System Syncing...
                </div>
            </div>
        )}
        
        {connectionState === ConnectionState.ERROR && (
             <div className="text-red-400 bg-red-950/20 backdrop-blur-md px-8 py-6 border border-red-500/20 max-w-sm font-mono text-sm">
                 <div className="flex items-center justify-center gap-2 mb-4 font-bold uppercase tracking-wider text-red-500"><Zap size={16}/> System Failure</div>
                 <p className="text-center opacity-80 mb-6 leading-relaxed">{errorMsg || "Connection Failed"}</p>
                 <button onClick={() => setConnectionState(ConnectionState.DISCONNECTED)} className="block w-full py-3 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 uppercase text-xs tracking-wider transition">Reboot System</button>
             </div>
        )}
      </div>

      {/* Bottom Controls */}
      {connectionState === ConnectionState.CONNECTED && (
        <div className="relative z-50 w-full max-w-md px-6 pb-10 pt-4 flex items-center justify-between gap-4 animate-in slide-in-from-bottom-10 duration-700">
            <div className="flex gap-3">
                 <button 
                    onClick={toggleCamera}
                    className={`p-4 rounded-full backdrop-blur-xl border transition active:scale-95 ${isCameraOn ? 'bg-white text-black border-white' : 'bg-black/40 text-gray-300 border-white/10 hover:bg-white/10'}`}
                 >
                    {isCameraOn ? <Video size={24} /> : <CameraOff size={24} />}
                 </button>
                 <button 
                    onClick={() => setShowHistory(true)}
                    className="p-4 rounded-full bg-black/40 backdrop-blur-xl border border-white/10 hover:bg-white/10 transition active:scale-95"
                 >
                    <History size={24} className="text-gray-300" />
                 </button>
            </div>

            <div className="flex gap-3">
                 <button 
                    onClick={toggleMic}
                    className={`p-4 rounded-full backdrop-blur-xl border transition-all duration-300 active:scale-95 ${isMicOn ? 'bg-white/10 hover:bg-white/20 text-white border-white/20' : 'bg-red-900/20 text-red-400 border-red-500/30 shadow-[0_0_15px_rgba(239,68,68,0.1)]'}`}
                 >
                    {isMicOn ? <Mic size={28} /> : <MicOff size={28} />}
                 </button>
                 <button 
                    onClick={handleDisconnect}
                    className="p-4 rounded-full bg-red-600/90 hover:bg-red-500 text-white shadow-[0_0_20px_rgba(220,38,38,0.3)] transition-all active:scale-95 border border-red-400"
                 >
                    <PhoneOff size={28} fill="currentColor" />
                 </button>
            </div>
        </div>
      )}

      {/* Footer */}
      <div className="absolute bottom-2 left-0 w-full text-center pointer-events-none opacity-20 text-[9px] font-tech text-gray-500 tracking-[0.3em]">
        SAM VERCE // v2.5.0
      </div>

    </div>
  );
};

export default App;