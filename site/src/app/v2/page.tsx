"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import ParticleCanvas, {
  getBackgroundColor,
  getActiveSection,
} from "./ParticleCanvas";
import StratigraphicInstallPill from "./StratigraphicInstallPill";
import StratigraphicFooter from "./StratigraphicFooter";
import Section from "./Section";

export default function V2Page() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [mouseX, setMouseX] = useState(0);
  const [mouseY, setMouseY] = useState(0);
  const [mouseActive, setMouseActive] = useState(false);
  const [bgColor, setBgColor] = useState("rgb(10, 10, 10)");

  const activeSection = getActiveSection(scrollProgress);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const maxScroll = el.scrollHeight - el.clientHeight;
    if (maxScroll <= 0) return;
    const progress = Math.max(0, Math.min(1, el.scrollTop / maxScroll));
    setScrollProgress(progress);
    setBgColor(getBackgroundColor(progress));
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    setMouseX(e.clientX);
    setMouseY(e.clientY);
    setMouseActive(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setMouseActive(false);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    el.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseleave", handleMouseLeave);

    return () => {
      el.removeEventListener("scroll", handleScroll);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, [handleScroll, handleMouseMove, handleMouseLeave]);

  return (
    <div
      ref={containerRef}
      className="h-screen snap-y snap-mandatory overflow-y-auto"
      style={{ backgroundColor: bgColor, transition: "background-color 0.3s ease" }}
    >
      <ParticleCanvas
        scrollProgress={scrollProgress}
        mouseX={mouseX}
        mouseY={mouseY}
        mouseActive={mouseActive}
        activeSection={activeSection}
      />

      {/* Hero */}
      <Section>
        <h1
          className="mb-6 text-8xl font-light tracking-tight text-[#e0e0e8] sm:text-9xl"
          style={{ fontFamily: "var(--font-fraunces)" }}
        >
          forge
        </h1>
        <p
          className="mb-10 text-lg text-[#7a7a8c]"
          style={{ fontFamily: "var(--font-jetbrains-mono)" }}
        >
          forge your workflow
        </p>
        <StratigraphicInstallPill />
      </Section>

      {/* Triage */}
      <Section>
        <h2
          className="mb-6 text-6xl font-light tracking-tight text-[#e0e0e8] sm:text-7xl"
          style={{ fontFamily: "var(--font-fraunces)" }}
        >
          triage
        </h2>
        <p
          className="mx-auto max-w-xl text-base leading-relaxed text-[#7a7a8c]"
          style={{ fontFamily: "var(--font-jetbrains-mono)" }}
        >
          Brain dump to structured projects. Stream-of-consciousness in, Linear
          issues out.
        </p>
      </Section>

      {/* Spec */}
      <Section>
        <h2
          className="mb-6 text-6xl font-light tracking-tight text-[#e0e0e8] sm:text-7xl"
          style={{ fontFamily: "var(--font-fraunces)" }}
        >
          spec
        </h2>
        <p
          className="mx-auto max-w-xl text-base leading-relaxed text-[#7a7a8c]"
          style={{ fontFamily: "var(--font-jetbrains-mono)" }}
        >
          Interactive PRD generation. Define milestones, scope, and acceptance
          criteria through guided conversation.
        </p>
      </Section>

      {/* Go */}
      <Section>
        <h2
          className="mb-6 text-6xl font-light tracking-tight text-[#e0e0e8] sm:text-7xl"
          style={{ fontFamily: "var(--font-fraunces)" }}
        >
          go
        </h2>
        <p
          className="mx-auto max-w-xl text-base leading-relaxed text-[#7a7a8c]"
          style={{ fontFamily: "var(--font-jetbrains-mono)" }}
        >
          Parallel agent teams execute milestones with self-healing verification.
          Ship with confidence.
        </p>
      </Section>

      {/* Footer */}
      <StratigraphicFooter />
    </div>
  );
}
