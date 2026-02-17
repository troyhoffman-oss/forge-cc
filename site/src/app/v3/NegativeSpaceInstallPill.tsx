"use client";

import { useState } from "react";

interface NegativeSpaceInstallPillProps {
  onHoverChange: (hovered: boolean) => void;
}

export default function NegativeSpaceInstallPill({
  onHoverChange,
}: NegativeSpaceInstallPillProps) {
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
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
      className="inline-flex items-center gap-2 rounded-full border border-[#1a1a1a] bg-transparent px-5 py-2.5 font-[family-name:var(--font-space-mono)] text-sm text-[#1a1a1a] transition-all duration-200 hover:border-[#c45038] hover:bg-[#c45038] hover:text-white"
    >
      <span className="text-[#8a8a8a]">$</span>
      <span>{copied ? "copied!" : command}</span>
    </button>
  );
}
