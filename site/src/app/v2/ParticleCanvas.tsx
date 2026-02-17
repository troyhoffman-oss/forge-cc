"use client";

import { useRef, useEffect, useCallback } from "react";
import { useReducedMotion } from "@/hooks/useReducedMotion";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  baseAlpha: number;
  alpha: number;
  radius: number;
}

type BehaviorState = "chaos" | "orbit" | "streams";

const SECTION_COLORS = [
  { r: 10, g: 10, b: 10 },       // Hero: #0a0a0a
  { r: 21, g: 21, b: 32 },       // Triage: #151520
  { r: 26, g: 26, b: 46 },       // Spec: #1a1a2e
  { r: 22, g: 33, b: 62 },       // Go: #16213e
];

const FOCAL_POINTS = [
  { xRatio: 0.3, yRatio: 0.4 },
  { xRatio: 0.7, yRatio: 0.6 },
  { xRatio: 0.5, yRatio: 0.3 },
];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpColor(
  c1: { r: number; g: number; b: number },
  c2: { r: number; g: number; b: number },
  t: number,
): { r: number; g: number; b: number } {
  return {
    r: Math.round(lerp(c1.r, c2.r, t)),
    g: Math.round(lerp(c1.g, c2.g, t)),
    b: Math.round(lerp(c1.b, c2.b, t)),
  };
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function getScrollState(scrollProgress: number): {
  behavior: BehaviorState;
  transitionProgress: number;
  nextBehavior: BehaviorState | null;
} {
  // 0-0.25: chaos (hero)
  // 0.25-0.5: chaos->orbit (triage)
  // 0.5-0.75: orbit (spec)
  // 0.75-1.0: orbit->streams (go)
  if (scrollProgress < 0.25) {
    return { behavior: "chaos", transitionProgress: 0, nextBehavior: null };
  } else if (scrollProgress < 0.5) {
    const t = (scrollProgress - 0.25) / 0.25;
    return { behavior: "chaos", transitionProgress: easeInOutCubic(t), nextBehavior: "orbit" };
  } else if (scrollProgress < 0.75) {
    return { behavior: "orbit", transitionProgress: 0, nextBehavior: null };
  } else {
    const t = (scrollProgress - 0.75) / 0.25;
    return { behavior: "orbit", transitionProgress: easeInOutCubic(t), nextBehavior: "streams" };
  }
}

function getBackgroundColor(scrollProgress: number): string {
  const segmentCount = SECTION_COLORS.length - 1;
  const segment = Math.min(
    Math.floor(scrollProgress * segmentCount),
    segmentCount - 1,
  );
  const segmentProgress = (scrollProgress * segmentCount - segment);
  const color = lerpColor(
    SECTION_COLORS[segment],
    SECTION_COLORS[Math.min(segment + 1, segmentCount)],
    Math.max(0, Math.min(1, segmentProgress)),
  );
  return `rgb(${color.r}, ${color.g}, ${color.b})`;
}

function getActiveSection(scrollProgress: number): number {
  if (scrollProgress < 0.25) return 0;
  if (scrollProgress < 0.5) return 1;
  if (scrollProgress < 0.75) return 2;
  return 3;
}

interface ParticleCanvasProps {
  scrollProgress: number;
  mouseX: number;
  mouseY: number;
  mouseActive: boolean;
  activeSection: number;
}

export default function ParticleCanvas({
  scrollProgress,
  mouseX,
  mouseY,
  mouseActive,
  activeSection,
}: ParticleCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const animFrameRef = useRef<number>(0);
  const reducedMotion = useReducedMotion();
  const initedRef = useRef(false);

  // Store reactive values in refs so the animation loop can read them
  // without being torn down and re-created on every change.
  const scrollProgressRef = useRef(scrollProgress);
  const mouseXRef = useRef(mouseX);
  const mouseYRef = useRef(mouseY);
  const mouseActiveRef = useRef(mouseActive);
  const activeSectionRef = useRef(activeSection);
  scrollProgressRef.current = scrollProgress;
  mouseXRef.current = mouseX;
  mouseYRef.current = mouseY;
  mouseActiveRef.current = mouseActive;
  activeSectionRef.current = activeSection;

  const getParticleCount = useCallback(() => {
    if (typeof window === "undefined") return 250;
    return window.innerWidth < 768 ? 150 : 250;
  }, []);

  // Initialize particles
  useEffect(() => {
    if (initedRef.current) return;
    initedRef.current = true;

    const count = getParticleCount();
    const w = window.innerWidth;
    const h = window.innerHeight;
    const particles: Particle[] = [];

    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 1.5,
        vy: (Math.random() - 0.5) * 1.5,
        baseAlpha: 0.15 + Math.random() * 0.35,
        alpha: 0.15 + Math.random() * 0.35,
        radius: 1 + Math.random() * 1.5,
      });
    }
    particlesRef.current = particles;
  }, [getParticleCount]);

  // Animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    if (reducedMotion) {
      // Static render: distribute particles evenly
      const w = window.innerWidth;
      const h = window.innerHeight;
      ctx.clearRect(0, 0, w, h);
      const particles = particlesRef.current;
      for (const p of particles) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(224, 224, 232, ${p.baseAlpha})`;
        ctx.fill();
      }
      return () => {
        window.removeEventListener("resize", resize);
      };
    }

    const animate = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      ctx.clearRect(0, 0, w, h);

      const { behavior, transitionProgress, nextBehavior } =
        getScrollState(scrollProgressRef.current);
      const particles = particlesRef.current;
      const isMobile = w < 768;

      for (const p of particles) {
        // Compute target velocity based on behavior
        let targetVx = p.vx;
        let targetVy = p.vy;

        if (behavior === "chaos" && !nextBehavior) {
          // Pure brownian
          targetVx += (Math.random() - 0.5) * 0.3;
          targetVy += (Math.random() - 0.5) * 0.3;
          targetVx *= 0.98;
          targetVy *= 0.98;
        } else if (behavior === "orbit" && !nextBehavior) {
          // Orbit around focal points
          const focalIdx = Math.floor(
            (p.x / w) * FOCAL_POINTS.length,
          ) % FOCAL_POINTS.length;
          const focal = FOCAL_POINTS[focalIdx];
          const fx = focal.xRatio * w;
          const fy = focal.yRatio * h;
          const dx = fx - p.x;
          const dy = fy - p.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const orbitRadius = 80 + (p.baseAlpha * 120);
          const force = (dist - orbitRadius) * 0.002;
          // Tangential + radial
          targetVx += (dx / dist) * force - (dy / dist) * 0.3;
          targetVy += (dy / dist) * force + (dx / dist) * 0.3;
          targetVx *= 0.97;
          targetVy *= 0.97;
        } else if (behavior === "streams" || nextBehavior === "streams") {
          // Parallel streams flowing right
          const streamY = Math.round(p.y / 40) * 40;
          const dyStream = streamY - p.y;
          const streamVx = 1.5 + p.baseAlpha * 1;
          const streamVy = dyStream * 0.05;

          if (nextBehavior === "streams") {
            // Transitioning to streams
            const orbitVx = p.vx;
            const orbitVy = p.vy;
            // Apply orbit behavior for blend
            const focalIdx = Math.floor(
              (p.x / w) * FOCAL_POINTS.length,
            ) % FOCAL_POINTS.length;
            const focal = FOCAL_POINTS[focalIdx];
            const fx = focal.xRatio * w;
            const fy = focal.yRatio * h;
            const dx = fx - p.x;
            const dy = fy - p.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            const orbitRadius = 80 + (p.baseAlpha * 120);
            const force = (dist - orbitRadius) * 0.002;
            const oVx = orbitVx + (dx / dist) * force - (dy / dist) * 0.3;
            const oVy = orbitVy + (dy / dist) * force + (dx / dist) * 0.3;

            targetVx = lerp(oVx * 0.97, streamVx, transitionProgress);
            targetVy = lerp(oVy * 0.97, streamVy, transitionProgress);
          } else {
            targetVx = streamVx;
            targetVy = streamVy;
          }
        }

        // Handle chaos->orbit transition
        if (behavior === "chaos" && nextBehavior === "orbit") {
          const chaosVx = p.vx + (Math.random() - 0.5) * 0.3;
          const chaosVy = p.vy + (Math.random() - 0.5) * 0.3;

          const focalIdx = Math.floor(
            (p.x / w) * FOCAL_POINTS.length,
          ) % FOCAL_POINTS.length;
          const focal = FOCAL_POINTS[focalIdx];
          const fx = focal.xRatio * w;
          const fy = focal.yRatio * h;
          const dx = fx - p.x;
          const dy = fy - p.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const orbitRadius = 80 + (p.baseAlpha * 120);
          const force = (dist - orbitRadius) * 0.002;
          const orbitVx =
            chaosVx + (dx / dist) * force - (dy / dist) * 0.3;
          const orbitVy =
            chaosVy + (dy / dist) * force + (dx / dist) * 0.3;

          targetVx = lerp(chaosVx * 0.98, orbitVx * 0.97, transitionProgress);
          targetVy = lerp(chaosVy * 0.98, orbitVy * 0.97, transitionProgress);
        }

        // Mouse interaction (desktop only)
        if (mouseActiveRef.current && !isMobile) {
          const dx = p.x - mouseXRef.current;
          const dy = p.y - mouseYRef.current;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const maxDist = 150;

          if (dist < maxDist) {
            const strength = (1 - dist / maxDist);
            if (activeSectionRef.current === 1) {
              // Triage: repel
              targetVx += (dx / dist) * strength * 3;
              targetVy += (dy / dist) * strength * 3;
              p.alpha = Math.min(1, p.baseAlpha + strength * 0.5);
            } else if (activeSectionRef.current === 2) {
              // Spec: attract into orbit
              targetVx -= (dx / dist) * strength * 2;
              targetVy -= (dy / dist) * strength * 2;
              // Add tangential force for orbit
              targetVx -= (dy / dist) * strength * 1.5;
              targetVy += (dx / dist) * strength * 1.5;
              p.alpha = Math.min(1, p.baseAlpha + strength * 0.5);
            } else if (activeSectionRef.current === 3) {
              // Go: boost stream speed
              targetVx += strength * 3;
              p.alpha = Math.min(1, p.baseAlpha + strength * 0.5);
            }
          } else {
            p.alpha = lerp(p.alpha, p.baseAlpha, 0.05);
          }
        } else {
          p.alpha = lerp(p.alpha, p.baseAlpha, 0.05);
        }

        // Apply velocity
        p.vx = lerp(p.vx, targetVx, 0.1);
        p.vy = lerp(p.vy, targetVy, 0.1);

        // Clamp speed
        const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
        if (speed > 4) {
          p.vx = (p.vx / speed) * 4;
          p.vy = (p.vy / speed) * 4;
        }

        p.x += p.vx;
        p.y += p.vy;

        // Wrap around edges
        if (p.x < -10) p.x = w + 10;
        if (p.x > w + 10) p.x = -10;
        if (p.y < -10) p.y = h + 10;
        if (p.y > h + 10) p.y = -10;

        // Draw
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(224, 224, 232, ${p.alpha})`;
        ctx.fill();
      }

      animFrameRef.current = requestAnimationFrame(animate);
    };

    animFrameRef.current = requestAnimationFrame(animate);

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [reducedMotion]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-0"
      aria-hidden="true"
    />
  );
}

export { getBackgroundColor, getActiveSection };
