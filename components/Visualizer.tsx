import React, { useEffect, useRef } from 'react';
import { VisualizerProps } from '../types';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

const Visualizer: React.FC<VisualizerProps> = ({ analyser, isActive, mood }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>();
  const particlesRef = useRef<Particle[]>([]);

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
    
    // Core state
    let rotation = 0;
    let smoothedVolume = 0;

    const draw = () => {
      if (!ctx || !canvas) return;

      // Clear with trail effect
      ctx.fillStyle = 'rgba(0, 0, 0, 0.2)'; // Leaves slight trails
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      // Get Audio Data
      if (analyser && isActive) {
        analyser.getByteFrequencyData(dataArray);
      } else {
        for(let i=0; i<bufferLength; i++) dataArray[i] = 5; 
      }

      // Calculate Volume
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) sum += dataArray[i];
      const average = sum / bufferLength;
      
      smoothedVolume += (average - smoothedVolume) * 0.1;
      
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      const baseRadius = Math.min(canvas.width, canvas.height) * 0.15;
      const radius = baseRadius + (smoothedVolume * 0.8); // More reactive radius

      // Colors
      let r = 0, g = 255, b = 255; // Cyan default
      if (mood === 'stranger') { r=255; g=20; b=20; }
      else if (mood === 'energy') { r=200; g=0; b=255; }
      else if (mood === 'calm') { r=0; g=255; b=150; }

      const colorString = `${r}, ${g}, ${b}`;

      // --- PARTICLE SYSTEM ---
      // Spawn particles if volume is high enough
      if (isActive && smoothedVolume > 10) {
        const spawnCount = Math.floor(smoothedVolume / 10);
        for (let i = 0; i < spawnCount; i++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = Math.random() * 2 + (smoothedVolume / 50);
          particlesRef.current.push({
            x: cx + Math.cos(angle) * radius,
            y: cy + Math.sin(angle) * radius,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: 1.0,
            maxLife: 1.0,
            size: Math.random() * 3 + 1,
            color: `rgba(${colorString}, ${Math.random()})`
          });
        }
      }

      // Update and Draw Particles
      for (let i = particlesRef.current.length - 1; i >= 0; i--) {
        const p = particlesRef.current[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 0.02;
        
        if (p.life <= 0) {
          particlesRef.current.splice(i, 1);
          continue;
        }

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${colorString}, ${p.life})`;
        ctx.fill();
      }

      // --- CORE VISUALS ---
      // 1. Glow Gradient
      const gradient = ctx.createRadialGradient(cx, cy, radius * 0.2, cx, cy, radius * 1.5);
      gradient.addColorStop(0, `rgba(${colorString}, 0.8)`);
      gradient.addColorStop(0.5, `rgba(${colorString}, 0.1)`);
      gradient.addColorStop(1, `rgba(${colorString}, 0)`);
      
      ctx.globalCompositeOperation = 'screen'; // Make it glowy
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 1.5, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';

      // 2. The Ring (Audio Data)
      const bars = 60;
      const step = (Math.PI * 2) / bars;
      
      ctx.strokeStyle = `rgba(${colorString}, ${isActive ? 0.9 : 0.3})`;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';

      rotation += 0.005; 

      for (let i = 0; i < bars; i++) {
        const dataIndex = Math.floor((i / bars) * (bufferLength / 2));
        const value = dataArray[dataIndex] || 0;
        const barHeight = (value / 255) * 120 * (isActive ? 1.5 : 0.2);
        
        const angle = (i * step) + rotation;
        
        const x1 = cx + Math.cos(angle) * (radius - 5);
        const y1 = cy + Math.sin(angle) * (radius - 5);
        const x2 = cx + Math.cos(angle) * (radius + barHeight);
        const y2 = cy + Math.sin(angle) * (radius + barHeight);

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }

      // 3. Orbital Rings (Decorations)
      ctx.strokeStyle = `rgba(${colorString}, 0.3)`;
      ctx.lineWidth = 1;
      
      // Rotating ring
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-rotation * 0.5);
      ctx.beginPath();
      ctx.arc(0, 0, baseRadius * 2.2, 0, Math.PI * 2);
      ctx.setLineDash([10, 30]);
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
      className="absolute top-0 left-0 w-full h-full pointer-events-none z-10"
    />
  );
};

export default Visualizer;