"use client";

import { ReactNode } from "react";

interface SectionProps {
  children: ReactNode;
  className?: string;
}

export default function Section({ children, className = "" }: SectionProps) {
  return (
    <section
      className={`relative z-10 flex h-screen w-full snap-start items-center justify-center px-6 ${className}`}
    >
      <div className="mx-auto max-w-3xl text-center">{children}</div>
    </section>
  );
}
