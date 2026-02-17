"use client";

import { useState } from "react";

export default function AlchemicalInstallPill() {
  const [copied, setCopied] = useState(false);
  const command = "npm i -g forge-cc";

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(command);
    } catch {
      // Best effort
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-2 rounded-full border border-[#d4a855]/20 bg-[#1a1a1a]/80 px-6 py-3 font-[family-name:var(--font-ibm-plex-mono)] text-sm text-[#e8dcc8] backdrop-blur-sm transition-all duration-300 hover:border-[#d4a855]/60 hover:bg-[#1a1a1a] hover:shadow-[0_0_20px_rgba(212,168,85,0.1)]"
    >
      <span className="text-[#8a7e6b]">$</span>
      <span>{copied ? "copied!" : command}</span>
    </button>
  );
}
