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

    const resizeCanvas = () => {
      // Create a square canvas based on the smallest dimension to keep circle perfect
      const size = Math.min(window.innerWidth, window.innerHeight) * 0.8;
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    const bufferLength = analyser ? analyser.frequencyBinCount : 128;
    const dataArray = new Uint8Array(bufferLength);
    
    // Core state for smoothing
    let rotation = 0;
    let smoothedVolume = 0;

    const draw = () => {
      if (!ctx || !canvas) return;

      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Get Audio Data
      if (analyser && isActive) {
        analyser.getByteFrequencyData(dataArray);
      } else {
        // Idle noise
        for(let i=0; i<bufferLength; i++) dataArray[i] = 5; 
      }

      // Calculate Volume
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) sum += dataArray[i];
      const average = sum / bufferLength;
      
      // Smooth volume transition
      smoothedVolume += (average - smoothedVolume) * 0.1;
      
      // Center Point
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      
      // Dynamic Radius based on volume
      const baseRadius = Math.min(canvas.width, canvas.height) * 0.15;
      const radius = baseRadius + (smoothedVolume * 0.5);

      // Mood Colors
      let primaryColor = '0, 255, 255'; // Cyan (Default)
      if (mood === 'stranger') primaryColor = '255, 20, 20';
      if (mood === 'energy') primaryColor = '200, 0, 255';
      if (mood === 'calm') primaryColor = '0, 255, 150';

      // --- LAYER 1: The Core (Filled Circle) ---
      const gradient = ctx.createRadialGradient(cx, cy, radius * 0.2, cx, cy, radius);
      gradient.addColorStop(0, `rgba(${primaryColor}, 0.8)`);
      gradient.addColorStop(0.6, `rgba(${primaryColor}, 0.2)`);
      gradient.addColorStop(1, `rgba(${primaryColor}, 0)`);
      
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();

      // --- LAYER 2: The Reactive Ring (Lines) ---
      const bars = 60; // Number of lines around circle
      const step = (Math.PI * 2) / bars;
      
      ctx.strokeStyle = `rgba(${primaryColor}, ${isActive ? 0.8 : 0.3})`;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';

      rotation += 0.002; // Slow constant rotation

      for (let i = 0; i < bars; i++) {
        // Map bar index to frequency index
        const dataIndex = Math.floor((i / bars) * (bufferLength / 2));
        const value = dataArray[dataIndex] || 0;
        const barHeight = (value / 255) * 100 * (isActive ? 1.5 : 0.2); // Scale height
        
        const angle = (i * step) + rotation;
        
        // Start point (on radius surface)
        const x1 = cx + Math.cos(angle) * (radius + 5);
        const y1 = cy + Math.sin(angle) * (radius + 5);
        
        // End point (extending outward)
        const x2 = cx + Math.cos(angle) * (radius + 5 + barHeight);
        const y2 = cy + Math.sin(angle) * (radius + 5 + barHeight);

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }

      // --- LAYER 3: Orbital Rings (Decorative) ---
      ctx.strokeStyle = `rgba(${primaryColor}, 0.1)`;
      ctx.lineWidth = 1;
      
      // Inner Ring
      ctx.beginPath();
      ctx.arc(cx, cy, baseRadius * 1.8, 0, Math.PI * 2);
      ctx.stroke();

      // Outer Ring (Rotating opposite)
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-rotation * 2);
      ctx.beginPath();
      // Dashed ring
      ctx.setLineDash([20, 40]);
      ctx.arc(0, 0, baseRadius * 2.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

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
      className="absolute top-0 left-0 w-full h-full pointer-events-none z-10 transition-opacity duration-1000"
    />
  );
};

export default Visualizer;