"use client";

import { useState } from "react";

export default function InstallPill() {
  const [copied, setCopied] = useState(false);
  const command = "npm i -g forge-cc";

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(command);
    } catch {
      // Best effort — secure context or permission may be unavailable
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-5 py-2.5 font-[family-name:var(--font-ibm-plex-mono)] text-sm text-[#e5e5e5] transition-colors hover:border-white/40 hover:bg-white/10"
    >
      <span className="text-[#a3a3a3]">$</span>
      <span>{copied ? "copied!" : command}</span>
    </button>
  );
}
