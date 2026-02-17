"use client";

import { useState } from "react";

export default function StratigraphicInstallPill() {
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
      className="inline-flex items-center gap-2 rounded-full border border-[#6c7ab8]/30 bg-white/5 px-5 py-2.5 font-[family-name:var(--font-ibm-plex-mono)] text-sm text-[#e0e0e8] transition-colors hover:border-[#5b6abf]/60 hover:bg-[#5b6abf]/10"
    >
      <span className="text-[#7a7a8c]">$</span>
      <span>{copied ? "copied!" : command}</span>
    </button>
  );
}
