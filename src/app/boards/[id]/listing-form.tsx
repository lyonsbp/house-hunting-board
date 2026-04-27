"use client";

import { useActionState, useState } from "react";
import { Button } from "@heroui/react";

import type { ListingPreview } from "@/lib/listings/types";

import {
  commitListingImport,
  previewListing,
  type CommitListingState,
  type PreviewListingState,
} from "./import-listing-actions";

const previewInitial: PreviewListingState = { status: "idle" };
const commitInitial: CommitListingState = { status: "idle" };

const inputCls =
  "w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:border-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-200";

/**
 * Outer wrapper: bumps a `resetKey` whenever the inner flow asks to dismiss
 * itself, which remounts the inner component and clears its `useActionState`
 * back to the URL-entry phase.
 */
export function ListingForm({ boardId }: { boardId: string }) {
  const [resetKey, setResetKey] = useState(0);
  return (
    <ListingFormBody
      key={resetKey}
      boardId={boardId}
      onDismiss={() => setResetKey((k) => k + 1)}
    />
  );
}

function ListingFormBody({
  boardId,
  onDismiss,
}: {
  boardId: string;
  onDismiss: () => void;
}) {
  const [previewState, previewAction, previewPending] = useActionState(
    previewListing,
    previewInitial,
  );

  if (previewState.status === "ready") {
    return (
      <ListingPicker
        boardId={boardId}
        url={previewState.url}
        preview={previewState.preview}
        onDismiss={onDismiss}
      />
    );
  }

  return (
    <form action={previewAction} className="flex flex-col gap-3">
      <input type="hidden" name="boardId" value={boardId} />
      <input
        name="url"
        type="url"
        placeholder="https://www.redfin.com/… or https://www.zillow.com/…"
        required
        className={inputCls}
      />
      {previewState.status === "error" && (
        <p className="text-sm text-red-700">{previewState.message}</p>
      )}
      <p className="text-[11px] text-stone-500">
        Paste a Redfin or Zillow listing URL. We&apos;ll show the photos so you
        can pick which to keep.
      </p>
      <div>
        <Button type="submit" variant="primary" isDisabled={previewPending}>
          {previewPending ? "Reading listing…" : "Preview listing"}
        </Button>
      </div>
    </form>
  );
}

function ListingPicker({
  boardId,
  url,
  preview,
  onDismiss,
}: {
  boardId: string;
  url: string;
  preview: ListingPreview;
  onDismiss: () => void;
}) {
  const [selected, setSelected] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(preview.images.map((img) => [img.url, true])),
  );
  const [showErrors, setShowErrors] = useState(false);
  const [commitState, commitAction, commitPending] = useActionState(
    commitListingImport,
    commitInitial,
  );

  // After the import settles, swap the picker for a compact summary so the
  // user has a definitive end-of-flow rather than the grid lingering.
  if (commitState.status === "done") {
    return (
      <ImportSummary
        succeeded={commitState.succeeded}
        failed={commitState.failed}
        errors={commitState.errors}
        showErrors={showErrors}
        onToggleErrors={() => setShowErrors((v) => !v)}
        onDismiss={onDismiss}
      />
    );
  }

  const selectedUrls = preview.images.map((i) => i.url).filter((u) => selected[u]);
  const toggleAll = (on: boolean) =>
    setSelected(Object.fromEntries(preview.images.map((i) => [i.url, on])));

  const cachedPreviewJson = JSON.stringify(preview);
  const selectedJson = JSON.stringify(selectedUrls);

  const { property } = preview;
  const priceLabel = property.listPrice
    ? `$${property.listPrice.toLocaleString()}`
    : null;
  const stats: string[] = [];
  if (property.bedrooms !== undefined) stats.push(`${property.bedrooms} bd`);
  if (property.bathrooms !== undefined) stats.push(`${property.bathrooms} ba`);
  if (property.sqft !== undefined)
    stats.push(`${property.sqft.toLocaleString()} sqft`);
  if (property.yearBuilt !== undefined) stats.push(`built ${property.yearBuilt}`);

  return (
    <form action={commitAction} className="flex flex-col gap-4">
      <input type="hidden" name="boardId" value={boardId} />
      <input type="hidden" name="url" value={url} />
      <input type="hidden" name="cachedPreview" value={cachedPreviewJson} />
      <input type="hidden" name="selectedImageUrls" value={selectedJson} />

      <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-stone-200 bg-stone-50 px-4 py-3">
        <div>
          <p className="text-sm font-medium text-stone-900">
            {property.address ?? "Listing"}
            {property.city && property.state ? (
              <span className="text-stone-500">
                {" "}
                · {property.city}, {property.state}
              </span>
            ) : null}
          </p>
          <p className="mt-0.5 text-[11px] uppercase tracking-wide text-stone-500">
            {priceLabel} {priceLabel && stats.length > 0 ? "·" : ""}{" "}
            {stats.join(" · ")}
          </p>
        </div>
        {preview.partial && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] uppercase tracking-wider text-amber-800">
            Partial preview
          </span>
        )}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-stone-500">
          {selectedUrls.length} of {preview.images.length} selected
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => toggleAll(true)}
            className="text-[11px] uppercase tracking-wider text-stone-500 hover:text-stone-900"
          >
            Select all
          </button>
          <span className="text-stone-300">·</span>
          <button
            type="button"
            onClick={() => toggleAll(false)}
            className="text-[11px] uppercase tracking-wider text-stone-500 hover:text-stone-900"
          >
            Clear
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {preview.images.map((img) => {
          const isOn = !!selected[img.url];
          return (
            <label
              key={img.url}
              className={`group relative cursor-pointer overflow-hidden rounded-md border-2 transition ${
                isOn
                  ? "border-stone-900 ring-2 ring-stone-300"
                  : "border-transparent opacity-70 hover:opacity-100"
              }`}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={isOn}
                onChange={(e) =>
                  setSelected((s) => ({ ...s, [img.url]: e.target.checked }))
                }
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.url}
                alt=""
                loading="lazy"
                className="block aspect-square w-full object-cover"
                draggable={false}
              />
              {isOn && (
                <span className="absolute right-1 top-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-stone-900 text-[10px] font-bold text-stone-50">
                  ✓
                </span>
              )}
            </label>
          );
        })}
      </div>

      {commitState.status === "error" && (
        <p className="text-sm text-red-700">{commitState.message}</p>
      )}

      <div className="flex justify-between">
        <button
          type="button"
          onClick={onDismiss}
          className="text-[11px] uppercase tracking-wider text-stone-500 hover:text-stone-900"
        >
          ← Different listing
        </button>
        <Button
          type="submit"
          variant="primary"
          isDisabled={commitPending || selectedUrls.length === 0}
        >
          {commitPending
            ? `Importing ${selectedUrls.length}…`
            : `Import ${selectedUrls.length} ${
                selectedUrls.length === 1 ? "image" : "images"
              }`}
        </Button>
      </div>
    </form>
  );
}

function ImportSummary({
  succeeded,
  failed,
  errors,
  showErrors,
  onToggleErrors,
  onDismiss,
}: {
  succeeded: number;
  failed: number;
  errors: string[];
  showErrors: boolean;
  onToggleErrors: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-md border border-stone-200 bg-stone-50 px-4 py-3">
      <div className="flex items-baseline justify-between">
        <p className="text-sm text-stone-800">
          Imported {succeeded} {succeeded === 1 ? "image" : "images"}.
          {failed > 0 ? ` ${failed} failed.` : ""}
        </p>
        <Button type="button" variant="primary" onClick={onDismiss}>
          Done
        </Button>
      </div>
      {errors.length > 0 && (
        <div>
          <button
            type="button"
            onClick={onToggleErrors}
            className="text-[11px] uppercase tracking-wider text-stone-500 hover:text-stone-900"
          >
            {showErrors ? "Hide errors" : "Show errors"}
          </button>
          {showErrors && (
            <ul className="mt-2 space-y-1 text-[12px] text-stone-600">
              {errors.map((err, i) => (
                <li key={i} className="font-mono">
                  {err}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
