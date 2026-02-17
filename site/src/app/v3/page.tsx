"use client";

import { useState } from "react";
import GenerativeBlob from "./GenerativeBlob";
import CursorTrail from "./CursorTrail";
import NegativeSpaceInstallPill from "./NegativeSpaceInstallPill";
import NegativeSpaceFooter from "./NegativeSpaceFooter";

export default function V3Page() {
  const [pillHovered, setPillHovered] = useState(false);

  return (
    <div className="flex min-h-screen flex-col bg-[#f5f0eb] text-[#1a1a1a] cursor-crosshair">
      <CursorTrail />

      <main className="flex flex-1 flex-col items-center justify-center px-6 md:flex-row md:gap-0">
        {/* Blob first on mobile (stacked above), visually on right for desktop */}
        <div className="order-1 flex items-center justify-center md:order-2 md:w-[60%] md:justify-center">
          <GenerativeBlob pillHovered={pillHovered} />
        </div>

        {/* Text section — left on desktop, below on mobile */}
        <div className="order-2 mt-8 flex flex-col items-center text-center md:order-1 md:mt-0 md:w-[30%] md:items-start md:text-left md:pl-[8%]">
          <h1 className="font-[family-name:var(--font-instrument-serif)] text-6xl italic leading-tight md:text-7xl lg:text-8xl">
            forge
          </h1>
          <p className="mt-4 font-[family-name:var(--font-space-mono)] text-sm text-[#8a8a8a]">
            forge your workflow
          </p>
          <div className="mt-6">
            <NegativeSpaceInstallPill onHoverChange={setPillHovered} />
          </div>
        </div>
      </main>

      <NegativeSpaceFooter />
    </div>
  );
}
