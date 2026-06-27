"use client";

import { useState } from "react";
import CopyButton from "./CopyButton";

/**
 * Shows the connection string as the one thing you copy. The HTTP URL and API
 * key (the pieces the string is made of) hide behind a small "Show details"
 * toggle, so the screen stays simple.
 */
export default function ConnectionPanel({
  connectionString,
  httpUrl,
  apiKey,
}: {
  connectionString: string;
  httpUrl: string;
  apiKey: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <Field label="Connection string" value={connectionString} primary />

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-1 text-xs text-muted underline-offset-2 transition hover:text-accent hover:underline"
      >
        {open ? "Hide details" : "Show URL & key"}
      </button>

      {open && (
        <div className="mt-3 border-t border-border pt-3">
          <Field label="HTTP URL" value={httpUrl} />
          <Field label="API key" value={apiKey} />
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  primary = false,
}: {
  label: string;
  value: string;
  primary?: boolean;
}) {
  return (
    <div className="mb-3">
      <div className="mb-1.5 text-xs font-medium text-muted">{label}</div>
      <div className="flex items-center gap-2">
        <code
          className={`min-w-0 flex-1 truncate rounded-md border px-3 py-2 font-mono text-xs text-foreground ${
            primary
              ? "border-accent/40 bg-accent/5"
              : "border-border bg-surface-2"
          }`}
        >
          {value}
        </code>
        <CopyButton text={value} />
      </div>
    </div>
  );
}
