"use client";

import { useState } from "react";
import { CopyIcon, CheckIcon } from "./icons";

/** A button that copies text to the clipboard and briefly shows a check. */
export default function CopyButton({
  text,
  label,
  className = "",
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard can be blocked (e.g. insecure context); fail quietly.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className={`inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[12px] font-medium text-muted transition hover:border-border-strong hover:text-foreground ${className}`}
    >
      {copied ? (
        <CheckIcon size={14} className="text-accent" />
      ) : (
        <CopyIcon size={14} />
      )}
      {label ? <span>{copied ? "Copied" : label}</span> : null}
    </button>
  );
}

