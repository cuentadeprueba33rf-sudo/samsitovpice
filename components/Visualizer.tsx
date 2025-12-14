import React, { useEffect, useRef } from 'react';
import { VisualizerProps } from '../types';

const Visualizer: React.FC<VisualizerProps> = ({ analyser, isActive, mood }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size to match window
    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight * 0.6; // Take up bottom 60%
    };
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    // Data buffer
    const bufferLength = analyser ? analyser.frequencyBinCount : 0;
    const dataArray = new Uint8Array(bufferLength);

    let time = 0;

    const draw = () => {
      if (!ctx || !canvas) return;

      // Clear with transparency for trail effect (optional, but clean clear is better for this style)
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (analyser && isActive) {
        analyser.getByteFrequencyData(dataArray);
      } else {
        // Idle animation data if not active
        for(let i=0; i<bufferLength; i++) dataArray[i] = 20; 
      }

      // Calculate average volume for global opacity/intensity
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
      }
      const avg = sum / (bufferLength || 1);
      const intensity = isActive ? Math.max(0.3, avg / 128) : 0.2; // Base intensity when idle

      // Draw glowing waves
      const waves = 3;
      const centerY = canvas.height * 0.8; // Position near bottom
      
      // Determine Base Hue based on Mood
      let baseHue = 220; // Default Blue
      let saturation = 80;
      
      if (mood === 'stranger') {
        baseHue = 0; // Red
        saturation = 100;
      } else if (mood === 'energy') {
        baseHue = 280; // Purple/Pink
      } else if (mood === 'calm') {
        baseHue = 180; // Teal
      } else if (mood === 'alert') {
        baseHue = 10; // Orange/Red
      }

      for (let w = 0; w < waves; w++) {
        ctx.beginPath();
        
        const hue = baseHue + w * 20; 
        const alpha = (0.2 + (intensity * 0.3)) / (w + 1);
        
        ctx.fillStyle = `hsla(${hue}, ${saturation}%, 60%, ${alpha})`;
        ctx.strokeStyle = `hsla(${hue}, ${saturation + 10}%, 70%, ${alpha * 2})`;
        ctx.lineWidth = 2;

        for (let x = 0; x < canvas.width; x += 10) {
            // Mix sine waves with audio data
            // Map x to frequency index
            const freqIndex = Math.floor((x / canvas.width) * (bufferLength / 2));
            const freqValue = isActive ? dataArray[freqIndex] : 10;
            const scaledFreq = (freqValue / 255) * canvas.height * 0.5;

            // Sine wave movement
            const waveOffset = Math.sin((x * 0.01) + (time * (0.02 + w * 0.01))) * 50;
            
            // Combine
            const y = centerY - scaledFreq - waveOffset + (w * 20);

            if (x === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }

        // Close path to bottom
        ctx.lineTo(canvas.width, canvas.height);
        ctx.lineTo(0, canvas.height);
        ctx.closePath();
        ctx.fill();
        
        // Add a top stroke for definition
        // We redraw just the top line
        ctx.beginPath();
        for (let x = 0; x < canvas.width; x += 10) {
            const freqIndex = Math.floor((x / canvas.width) * (bufferLength / 2));
            const freqValue = isActive ? dataArray[freqIndex] : 10;
            const scaledFreq = (freqValue / 255) * canvas.height * 0.5;
            const waveOffset = Math.sin((x * 0.01) + (time * (0.02 + w * 0.01))) * 50;
            const y = centerY - scaledFreq - waveOffset + (w * 20);
            if (x === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      time += 1;
      animationRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [analyser, isActive, mood]);

  return (
    <canvas 
      ref={canvasRef} 
      className="absolute bottom-0 left-0 w-full h-[60%] pointer-events-none z-0 filter blur-xl opacity-90 transition-opacity duration-1000"
    />
  );
};

export default Visualizer;