"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { createCategoryAndAssign } from "../../actions";
import { slugify } from "@/lib/slug";

const SERIF =
  '"Cochin", "Hoefler Text", "Iowan Old Style", "Palatino Linotype", Georgia, serif';

/**
 * Triggered when an artifact is dropped on the "+ New category" row of
 * the swim-lane panel. Auto-opens via `showModal()`, asks for a name,
 * creates the category + moves the artifact + redirects to the new
 * category's drill-down — all on submit.
 *
 * `sourceCategoryId` is null when the drop came from the Uncategorized
 * drill-down (no source row to unassign from); otherwise it's the
 * current real category, which gets cleared as part of the move.
 */
export function NewCategoryDialog({
  boardId,
  artifactId,
  sourceCategoryId,
  onClose,
}: {
  boardId: string;
  artifactId: string;
  sourceCategoryId: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const d = dialogRef.current;
    if (d && !d.open) d.showModal();
  }, []);

  function close() {
    if (!busy) {
      dialogRef.current?.close();
      onClose();
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name is required.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await createCategoryAndAssign({
      boardId,
      artifactId,
      sourceCategoryId,
      name: trimmed,
    });
    setBusy(false);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    // Navigate to the new category's drill-down. The slug is computed
    // from the same `name` we submitted, so the route resolver will
    // match it back to the freshly-created category.
    const slug = slugify(res.name);
    dialogRef.current?.close();
    onClose();
    router.push(`/boards/${boardId}/c/${slug}`);
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={(e) => {
        // Click on the backdrop (the dialog itself, not its child form) → close.
        if (e.target === dialogRef.current) close();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      className="rounded-xl border border-stone-200 bg-white p-0 shadow-2xl backdrop:bg-stone-900/40"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-6">
        <div className="flex flex-col gap-1">
          <h2
            className="text-2xl text-stone-900"
            style={{ fontFamily: SERIF }}
          >
            New category
          </h2>
          <p
            className="text-sm italic text-stone-500"
            style={{ fontFamily: SERIF }}
          >
            Name it, and we&rsquo;ll move this card into it.
          </p>
        </div>

        <input
          autoFocus
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Modern kitchens"
          maxLength={80}
          disabled={busy}
          className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-base text-stone-900 outline-none focus:border-stone-500 focus:ring-2 focus:ring-stone-300 disabled:bg-stone-50"
        />

        {error && (
          <p className="text-sm text-red-700" role="alert">
            {error}
          </p>
        )}

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={close}
            disabled={busy}
            className="rounded-full border border-stone-300 bg-white px-4 py-1.5 text-sm text-stone-700 transition-colors hover:bg-stone-50 disabled:opacity-50"
            style={{ fontFamily: SERIF }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || name.trim().length === 0}
            className="rounded-full bg-stone-900 px-4 py-1.5 text-sm text-stone-50 transition-colors hover:bg-stone-700 disabled:opacity-50"
            style={{ fontFamily: SERIF }}
          >
            {busy ? "Creating…" : "Create & move"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
