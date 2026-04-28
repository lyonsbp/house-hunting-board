"use client";

import { useState, useTransition } from "react";

import { setBoardVisibility } from "./actions";

export function SharingSection({
  boardId,
  isPublic: initialIsPublic,
}: {
  boardId: string;
  isPublic: boolean;
}) {
  const [isPublic, setIsPublic] = useState(initialIsPublic);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  function toggle(next: boolean) {
    setError(null);
    // Optimistic — flips back on failure.
    setIsPublic(next);
    startTransition(async () => {
      const res = await setBoardVisibility({ boardId, isPublic: next });
      if ("error" in res) {
        setError(res.error);
        setIsPublic(!next);
      }
    });
  }

  async function copyLink() {
    if (typeof window === "undefined") return;
    const url = `${window.location.origin}/boards/${boardId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Fallback: select the input — most browsers allow that without perms.
      window.prompt("Copy this link:", url);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide opacity-60">
        Sharing
      </h2>

      <label className="flex cursor-pointer items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={isPublic}
          onChange={(e) => toggle(e.target.checked)}
          disabled={pending}
          className="mt-0.5 h-4 w-4 cursor-pointer accent-stone-900"
        />
        <span className="flex flex-col gap-0.5">
          <span className="font-medium text-stone-900">
            Anyone with the link can view
          </span>
          <span className="text-[12px] text-stone-500">
            Read-only. Visitors won&apos;t see member emails or be able to add,
            comment, edit, or invite.
          </span>
        </span>
      </label>

      {isPublic && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-stone-200 bg-stone-50 px-3 py-2">
          <code className="flex-1 truncate font-mono text-[12px] text-stone-700">
            {typeof window !== "undefined"
              ? `${window.location.origin}/boards/${boardId}`
              : `/boards/${boardId}`}
          </code>
          <button
            type="button"
            onClick={copyLink}
            className="rounded-md bg-stone-900 px-3 py-1 text-[10px] uppercase tracking-wider text-stone-50 hover:bg-stone-800"
            style={{ letterSpacing: "0.12em" }}
          >
            {copied ? "Copied!" : "Copy link"}
          </button>
        </div>
      )}

      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  );
}
