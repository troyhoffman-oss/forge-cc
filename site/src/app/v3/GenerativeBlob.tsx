"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import { useReducedMotion } from "@/hooks/useReducedMotion";

interface ControlPoint {
  baseRadius: number;
  frequency: number;
  phase: number;
  amplitude: number;
}

interface GenerativeBlobProps {
  pillHovered: boolean;
}

const NUM_POINTS = 10;
const BASE_RADIUS = 300;
const MOBILE_RADIUS = 175;
const BREATHE_CYCLE = 6;
const BREATHE_AMOUNT = 0.025;
const FLINCH_RADIUS = 200;
const FLINCH_STRENGTH = 60;
const SQUISH_AMOUNT = 0.15;
const SQUISH_OVERSHOOT = 0.05;

function createControlPoints(): ControlPoint[] {
  const points: ControlPoint[] = [];
  for (let i = 0; i < NUM_POINTS; i++) {
    points.push({
      baseRadius: BASE_RADIUS + (Math.random() - 0.5) * 40,
      frequency: 0.3 + Math.random() * 0.4,
      phase: Math.random() * Math.PI * 2,
      amplitude: 8 + Math.random() * 12,
    });
  }
  return points;
}

function generateBlobPath(
  points: { x: number; y: number }[],
  tension: number = 0.3
): string {
  const n = points.length;
  if (n < 3) return "";

  const parts: string[] = [`M ${points[0].x} ${points[0].y}`];

  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n];
    const curr = points[i];
    const next = points[(i + 1) % n];
    const next2 = points[(i + 2) % n];

    const tx1 = (next.x - prev.x) * tension;
    const ty1 = (next.y - prev.y) * tension;
    const tx2 = (curr.x - next2.x) * tension;
    const ty2 = (curr.y - next2.y) * tension;

    const cp1x = curr.x + tx1;
    const cp1y = curr.y + ty1;
    const cp2x = next.x + tx2;
    const cp2y = next.y + ty2;

    parts.push(`C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${next.x} ${next.y}`);
  }

  parts.push("Z");
  return parts.join(" ");
}

export default function GenerativeBlob({ pillHovered }: GenerativeBlobProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const controlPointsRef = useRef<ControlPoint[]>(createControlPoints());
  const mouseRef = useRef<{ x: number; y: number } | null>(null);
  const animRef = useRef<number>(0);
  const reducedMotion = useReducedMotion();
  const [isMobile, setIsMobile] = useState(false);
  const squishRef = useRef(0);
  const squishTargetRef = useRef(0);
  const squishVelocityRef = useRef(0);
  const dirtyRef = useRef(true);
  const lastMouseRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    squishTargetRef.current = pillHovered ? -SQUISH_AMOUNT : 0;
    dirtyRef.current = true;
  }, [pillHovered]);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (isMobile) return;
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      mouseRef.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
      dirtyRef.current = true;
    },
    [isMobile]
  );

  const handleMouseLeave = useCallback(() => {
    mouseRef.current = null;
    dirtyRef.current = true;
  }, []);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    svg.addEventListener("mousemove", handleMouseMove);
    svg.addEventListener("mouseleave", handleMouseLeave);
    return () => {
      svg.removeEventListener("mousemove", handleMouseMove);
      svg.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, [handleMouseMove, handleMouseLeave]);

  useEffect(() => {
    const controlPoints = controlPointsRef.current;
    const radius = isMobile ? MOBILE_RADIUS : BASE_RADIUS;
    const size = radius * 2 + 100;
    const cx = size / 2;
    const cy = size / 2;

    const animate = (time: number) => {
      const t = time / 1000;

      // Spring physics for squish
      const squishDiff = squishTargetRef.current - squishRef.current;
      squishVelocityRef.current += squishDiff * 0.15;
      squishVelocityRef.current *= 0.8;
      squishRef.current += squishVelocityRef.current;

      // Mark dirty if squish is still animating
      const squishSettled = Math.abs(squishVelocityRef.current) < 0.0005 && Math.abs(squishDiff) < 0.0005;
      const mouseChanged = mouseRef.current !== lastMouseRef.current;
      if (!squishSettled || mouseChanged) {
        dirtyRef.current = true;
        lastMouseRef.current = mouseRef.current;
      }

      // In reduced motion, skip render when nothing has changed
      if (reducedMotion && !dirtyRef.current) {
        animRef.current = requestAnimationFrame(animate);
        return;
      }
      dirtyRef.current = false;

      // Handle overshoot on release
      const squishScale = 1 + squishRef.current;

      // Breathing scale
      const breatheScale = reducedMotion
        ? 1
        : 1 + Math.sin((t * Math.PI * 2) / BREATHE_CYCLE) * BREATHE_AMOUNT;

      const totalScale = breatheScale * squishScale;

      const points: { x: number; y: number }[] = [];

      for (let i = 0; i < NUM_POINTS; i++) {
        const angle = (i / NUM_POINTS) * Math.PI * 2;
        const cp = controlPoints[i];
        const scaledBase = (cp.baseRadius / BASE_RADIUS) * radius;

        let r = scaledBase;
        if (!reducedMotion) {
          r += Math.sin(t * cp.frequency + cp.phase) * cp.amplitude;
        }

        r *= totalScale;

        let x = cx + r * Math.cos(angle);
        let y = cy + r * Math.sin(angle);

        // Cursor flinch (desktop only, not reduced motion)
        if (!isMobile && mouseRef.current) {
          const dx = x - mouseRef.current.x;
          const dy = y - mouseRef.current.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < FLINCH_RADIUS && dist > 0) {
            const strength =
              (1 - dist / FLINCH_RADIUS) * (1 - dist / FLINCH_RADIUS);
            const pushX = (dx / dist) * strength * FLINCH_STRENGTH;
            const pushY = (dy / dist) * strength * FLINCH_STRENGTH;
            x += pushX;
            y += pushY;
          }
        }

        points.push({ x, y });
      }

      const path = generateBlobPath(points);
      if (pathRef.current) {
        pathRef.current.setAttribute("d", path);
      }

      animRef.current = requestAnimationFrame(animate);
    };

    animRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animRef.current);
  }, [isMobile, reducedMotion]);

  const radius = isMobile ? MOBILE_RADIUS : BASE_RADIUS;
  const size = radius * 2 + 100;

  return (
    <svg
      ref={svgRef}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="max-w-full"
      aria-hidden="true"
    >
      <path
        ref={pathRef}
        fill="#c4503820"
        stroke="#c45038"
        strokeWidth={1.5}
      />
    </svg>
  );
}
