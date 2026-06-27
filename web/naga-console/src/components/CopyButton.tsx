"use client";

import { useState } from "react";
import { CopyIcon, CheckIcon } from "./icons";
import { copyToClipboard } from "@/lib/clipboard";

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
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    const ok = await copyToClipboard(text);
    setState(ok ? "copied" : "failed");
    setTimeout(() => setState("idle"), 1600);
  }

  const copied = state === "copied";
  const failed = state === "failed";

  return (
    <button
      type="button"
      onClick={copy}
      title={failed ? "Couldn't copy — select the text and copy manually" : undefined}
      className={`inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[12px] font-medium text-muted transition hover:border-border-strong hover:text-foreground ${className}`}
    >
      {copied ? (
        <CheckIcon size={14} className="text-accent" />
      ) : (
        <CopyIcon size={14} />
      )}
      {label || failed ? (
        <span className={failed ? "text-danger" : undefined}>
          {copied ? "Copied" : failed ? "Press ⌘/Ctrl+C" : label}
        </span>
      ) : null}
    </button>
  );
}

