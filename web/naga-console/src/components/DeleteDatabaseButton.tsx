"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TrashIcon } from "./icons";

/**
 * A "Delete database" button with a small confirm step. On success it sends the
 * user back to the databases list.
 */
export default function DeleteDatabaseButton({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "delete failed");
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "delete failed");
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="inline-flex h-9 items-center gap-2 rounded-lg border border-danger/40 px-3.5 text-[13px] font-medium text-danger transition hover:bg-danger/10"
      >
        <TrashIcon size={15} />
        Delete database
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2.5">
      {error ? (
        <span className="text-[12px] text-danger">{error}</span>
      ) : (
        <span className="text-[12px] text-muted">
          Delete{" "}
          <span className="font-medium text-foreground">{projectName}</span>?
        </span>
      )}
      <button
        onClick={remove}
        disabled={busy}
        className="inline-flex h-8 items-center rounded-lg bg-danger px-3 text-[12px] font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
      >
        {busy ? "Deleting…" : "Yes, delete"}
      </button>
      <button
        onClick={() => {
          setConfirming(false);
          setError(null);
        }}
        className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-[12px] text-muted transition hover:text-foreground"
      >
        Cancel
      </button>
    </div>
  );
}
