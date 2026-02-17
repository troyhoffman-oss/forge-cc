"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "@/hooks/useReducedMotion";

const TRAIL_LENGTH = 5;
const DOT_SIZE = 6;

interface TrailDot {
  x: number;
  y: number;
  id: number;
}

export default function CursorTrail() {
  const [dots, setDots] = useState<TrailDot[]>([]);
  const [isMobile, setIsMobile] = useState(false);
  const counterRef = useRef(0);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    if (isMobile || reducedMotion) return;

    const handleMouseMove = (e: MouseEvent) => {
      const pos = { x: e.clientX, y: e.clientY };

      // Only add dot if moved enough distance
      if (lastPosRef.current) {
        const dx = pos.x - lastPosRef.current.x;
        const dy = pos.y - lastPosRef.current.y;
        if (dx * dx + dy * dy < 100) return;
      }
      lastPosRef.current = pos;

      counterRef.current += 1;
      const newDot: TrailDot = { x: pos.x, y: pos.y, id: counterRef.current };

      setDots((prev) => [...prev.slice(-(TRAIL_LENGTH - 1)), newDot]);
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [isMobile, reducedMotion]);

  // Clean up old dots
  useEffect(() => {
    if (dots.length === 0) return;
    const timer = setTimeout(() => {
      setDots((prev) => prev.slice(1));
    }, 400);
    return () => clearTimeout(timer);
  }, [dots]);

  if (isMobile || reducedMotion) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-50">
      {dots.map((dot, i) => {
        const age = dots.length - i;
        const opacity = Math.max(0, 1 - age / (TRAIL_LENGTH + 1));
        const scale = Math.max(0.3, 1 - age * 0.15);
        return (
          <div
            key={dot.id}
            className="absolute rounded-full bg-[#c45038]"
            style={{
              width: DOT_SIZE,
              height: DOT_SIZE,
              left: dot.x - DOT_SIZE / 2,
              top: dot.y - DOT_SIZE / 2,
              opacity: opacity * 0.6,
              transform: `scale(${scale})`,
              transition: "opacity 0.3s ease-out, transform 0.3s ease-out",
            }}
          />
        );
      })}
    </div>
  );
}
