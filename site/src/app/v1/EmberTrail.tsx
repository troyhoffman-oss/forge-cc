"use client";

import { useRef, useEffect, useCallback } from "react";
import { useReducedMotion } from "@/hooks/useReducedMotion";

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

const EMBER_COLORS = ["#d4a855", "#c49532", "#e8a030", "#b8862d", "#daa545"];
const PARTICLE_LIFETIME = 600; // ms
const PARTICLES_PER_MOVE = 10;

export default function EmberTrail() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const rafRef = useRef<number>(0);
  const lastSpawnRef = useRef(0);
  const reducedMotion = useReducedMotion();

  const spawnParticles = useCallback((x: number, y: number) => {
    const now = performance.now();
    // Throttle: at least 16ms between spawns (~60fps)
    if (now - lastSpawnRef.current < 16) return;
    lastSpawnRef.current = now;

    const particles = particlesRef.current;
    for (let i = 0; i < PARTICLES_PER_MOVE; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 0.8 + 0.2;
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: -(Math.random() * 1.2 + 0.4), // Drift upward (like heat rising)
        life: PARTICLE_LIFETIME,
        maxLife: PARTICLE_LIFETIME,
        size: Math.random() * 2 + 2, // 2-4px
        color: EMBER_COLORS[Math.floor(Math.random() * EMBER_COLORS.length)],
      });
    }

    // Cap particles to prevent memory growth
    if (particles.length > 500) {
      particlesRef.current = particles.slice(-400);
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Hide on mobile
    if (window.innerWidth < 768) return;

    // Skip if reduced motion
    if (reducedMotion) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = window.innerWidth + "px";
      canvas.style.height = window.innerHeight + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const handleMouseMove = (e: MouseEvent) => {
      spawnParticles(e.clientX, e.clientY);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("resize", resize);

    let lastTime = performance.now();

    const render = (now: number) => {
      const dt = now - lastTime;
      lastTime = now;

      const w = canvas.width / (Math.min(window.devicePixelRatio || 1, 2));
      const h = canvas.height / (Math.min(window.devicePixelRatio || 1, 2));

      ctx.clearRect(0, 0, w, h);

      const particles = particlesRef.current;
      const alive: Particle[] = [];

      for (const p of particles) {
        p.life -= dt;
        if (p.life <= 0) continue;

        p.x += p.vx;
        p.y += p.vy;
        // Slight horizontal drift
        p.vx *= 0.98;

        const progress = 1 - p.life / p.maxLife; // 0 -> 1
        const alpha = 1 - progress * progress; // Fade out with easing
        const size = p.size * (1 - progress * 0.5); // Shrink slightly

        ctx.globalAlpha = alpha * 0.8;
        ctx.fillStyle = p.color;

        // Draw a soft glowing circle
        ctx.beginPath();
        ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
        ctx.fill();

        // Add a faint glow halo
        if (alpha > 0.3) {
          ctx.globalAlpha = alpha * 0.2;
          ctx.beginPath();
          ctx.arc(p.x, p.y, size * 2.5, 0, Math.PI * 2);
          ctx.fill();
        }

        alive.push(p);
      }

      particlesRef.current = alive;
      ctx.globalAlpha = 1;

      rafRef.current = requestAnimationFrame(render);
    };

    rafRef.current = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("resize", resize);
      particlesRef.current = [];
    };
  }, [reducedMotion, spawnParticles]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-10 hidden md:block"
      aria-hidden="true"
    />
  );
}
