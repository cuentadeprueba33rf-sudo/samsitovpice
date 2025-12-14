import React, { useEffect, useRef } from 'react';
import { VisualizerProps } from '../types';

const Visualizer: React.FC<VisualizerProps> = ({ analyser, isActive, mood }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    const bufferLength = analyser ? analyser.frequencyBinCount : 128;
    const dataArray = new Uint8Array(bufferLength);
    
    let rotation = 0;
    let smoothedVolume = 0;

    const draw = () => {
      if (!ctx || !canvas) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      if (analyser && isActive) {
        analyser.getByteFrequencyData(dataArray);
      } else {
        for(let i=0; i<bufferLength; i++) dataArray[i] = 5; 
      }

      let sum = 0;
      for (let i = 0; i < bufferLength; i++) sum += dataArray[i];
      const average = sum / bufferLength;
      smoothedVolume += (average - smoothedVolume) * 0.1;
      
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      const baseRadius = Math.min(canvas.width, canvas.height) * 0.15;
      const radius = baseRadius + (smoothedVolume * 0.6); // Slightly more reactive

      // Mood Colors
      let r=0, g=255, b=255;
      if (mood === 'stranger') { r=255; g=20; b=20; }
      else if (mood === 'energy') { r=200; g=0; b=255; }
      else if (mood === 'calm') { r=0; g=255; b=150; }
      
      const primaryColor = `${r}, ${g}, ${b}`;

      // --- EFFECTS SETUP ---
      // Add Neon Glow
      ctx.shadowBlur = 25;
      ctx.shadowColor = `rgba(${primaryColor}, 0.6)`;

      // --- LAYER 1: Core Gradient ---
      const gradient = ctx.createRadialGradient(cx, cy, radius * 0.2, cx, cy, radius);
      gradient.addColorStop(0, `rgba(${primaryColor}, 0.8)`);
      gradient.addColorStop(0.5, `rgba(${primaryColor}, 0.2)`);
      gradient.addColorStop(1, `rgba(${primaryColor}, 0)`);
      
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();

      // --- LAYER 2: Reactive Frequency Ring ---
      const bars = 60;
      const step = (Math.PI * 2) / bars;
      
      ctx.strokeStyle = `rgba(${primaryColor}, ${isActive ? 0.9 : 0.4})`;
      ctx.lineWidth = 3; 
      ctx.lineCap = 'round';

      rotation += 0.002;

      for (let i = 0; i < bars; i++) {
        const dataIndex = Math.floor((i / bars) * (bufferLength / 2));
        const value = dataArray[dataIndex] || 0;
        const barHeight = (value / 255) * 120 * (isActive ? 1.5 : 0.2);
        
        const angle = (i * step) + rotation;
        const x1 = cx + Math.cos(angle) * (radius + 10);
        const y1 = cy + Math.sin(angle) * (radius + 10);
        const x2 = cx + Math.cos(angle) * (radius + 10 + barHeight);
        const y2 = cy + Math.sin(angle) * (radius + 10 + barHeight);

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }

      // --- LAYER 3: Orbital Rings ---
      // Inner
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, baseRadius * 1.9, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${primaryColor}, 0.3)`;
      ctx.stroke();

      // Outer (Rotating)
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-rotation * 1.5);
      ctx.beginPath();
      ctx.setLineDash([10, 25]);
      ctx.arc(0, 0, baseRadius * 2.5, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${primaryColor}, 0.2)`;
      ctx.stroke();
      ctx.restore();

      // Reset shadow for next frame performance
      ctx.shadowBlur = 0;

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
      className="absolute top-0 left-0 w-full h-full pointer-events-none z-10"
    />
  );
};

export default Visualizer;