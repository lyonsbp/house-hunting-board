"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@heroui/react";

import { prepareImageForUpload } from "@/lib/image-prep";

import {
  createImageArtifact,
  createLinkArtifact,
  createNoteArtifact,
  createTextArtifact,
  type CreateArtifactState,
  type CreateImageArtifactState,
} from "./actions";
import { ListingForm } from "./listing-form";

const initialState: CreateArtifactState = { status: "idle" };
const imageInitialState: CreateImageArtifactState = { status: "idle" };

type CategoryOption = { id: string; name: string };

const KINDS = [
  { id: "note", label: "Note" },
  { id: "text", label: "Passage" },
  { id: "link", label: "Link" },
  { id: "image", label: "Image" },
  { id: "listing", label: "Listing" },
] as const;
type KindId = (typeof KINDS)[number]["id"];

const inputCls =
  "w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:border-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-200";

export function AddArtifact({
  boardId,
  categories,
}: {
  boardId: string;
  categories: CategoryOption[];
}) {
  const [active, setActive] = useState<KindId>("note");

  return (
    <div className="space-y-4">
      <div
        // -mx-1 + px-1 + overflow-x-auto lets the pill bar scroll
        // horizontally on phones that can't fit all five tabs in a row,
        // without breaking the rounded outline on wider screens.
        className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:overflow-visible sm:px-0"
      >
        <div className="inline-flex w-max gap-1 rounded-full border border-stone-200 bg-white p-1 shadow-sm">
          {KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              onClick={() => setActive(k.id)}
              aria-pressed={active === k.id}
              className={`whitespace-nowrap rounded-full px-3 py-1.5 text-[10px] font-medium uppercase transition-colors sm:px-4 ${
                active === k.id
                  ? "bg-stone-900 text-stone-50"
                  : "text-stone-500 hover:text-stone-900"
              }`}
              style={{ letterSpacing: "0.18em" }}
            >
              {k.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        {active === "note" && <NoteForm boardId={boardId} />}
        {active === "text" && <TextForm boardId={boardId} />}
        {active === "link" && <LinkForm boardId={boardId} />}
        {active === "image" && (
          <ImageForm boardId={boardId} categories={categories} />
        )}
        {active === "listing" && <ListingForm boardId={boardId} />}
      </div>
    </div>
  );
}

function ErrorLine({ message }: { message: string }) {
  return <p className="text-sm text-red-700">{message}</p>;
}

function useResetOnSuccess(
  state: CreateArtifactState,
  pending: boolean,
  formRef: React.RefObject<HTMLFormElement | null>,
) {
  useEffect(() => {
    if (state.status === "idle" && !pending) formRef.current?.reset();
  }, [state, pending, formRef]);
}

function NoteForm({ boardId }: { boardId: string }) {
  const [state, action, pending] = useActionState(
    createNoteArtifact,
    initialState,
  );
  const formRef = useRef<HTMLFormElement>(null);
  useResetOnSuccess(state, pending, formRef);

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-3">
      <input type="hidden" name="boardId" value={boardId} />
      <textarea
        name="body"
        placeholder="A quick thought…"
        rows={2}
        maxLength={2000}
        required
        className={inputCls}
      />
      {state.status === "error" && <ErrorLine message={state.message} />}
      <div>
        <Button type="submit" variant="primary" isDisabled={pending}>
          {pending ? "Saving…" : "Add note"}
        </Button>
      </div>
    </form>
  );
}

function TextForm({ boardId }: { boardId: string }) {
  const [state, action, pending] = useActionState(
    createTextArtifact,
    initialState,
  );
  const formRef = useRef<HTMLFormElement>(null);
  useResetOnSuccess(state, pending, formRef);

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-3">
      <input type="hidden" name="boardId" value={boardId} />
      <textarea
        name="body"
        placeholder="Paste a passage you want to remember…"
        rows={6}
        maxLength={10000}
        required
        className={inputCls}
      />
      {state.status === "error" && <ErrorLine message={state.message} />}
      <div>
        <Button type="submit" variant="primary" isDisabled={pending}>
          {pending ? "Saving…" : "Add passage"}
        </Button>
      </div>
    </form>
  );
}

function LinkForm({ boardId }: { boardId: string }) {
  const [state, action, pending] = useActionState(
    createLinkArtifact,
    initialState,
  );
  const formRef = useRef<HTMLFormElement>(null);
  useResetOnSuccess(state, pending, formRef);

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-3">
      <input type="hidden" name="boardId" value={boardId} />
      <input
        name="url"
        type="url"
        placeholder="https://www.zillow.com/homedetails/…"
        required
        className={inputCls}
      />
      {state.status === "error" && <ErrorLine message={state.message} />}
      <div>
        <Button type="submit" variant="primary" isDisabled={pending}>
          {pending ? "Fetching preview…" : "Add link"}
        </Button>
      </div>
    </form>
  );
}

function ImageForm({
  boardId,
  categories,
}: {
  boardId: string;
  categories: CategoryOption[];
}) {
  const [state, action, pending] = useActionState(
    createImageArtifact,
    imageInitialState,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const widthRef = useRef<HTMLInputElement>(null);
  const heightRef = useRef<HTMLInputElement>(null);
  const lqipRef = useRef<HTMLInputElement>(null);

  // Reset the form after each successful submit so the user can add
  // another image without manually clearing the file input. Distinct
  // from useResetOnSuccess because our state union has a "success"
  // variant the other forms don't.
  useEffect(() => {
    if ((state.status === "idle" || state.status === "success") && !pending) {
      formRef.current?.reset();
    }
  }, [state, pending]);

  // Measure dims + render an LQIP in the browser as soon as the user
  // picks a file, and stash the values in hidden inputs so the server
  // action gets them alongside the upload. Failing this step is
  // non-fatal — the action will fall back to parsing dims server-side.
  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.currentTarget.files?.[0];
    if (widthRef.current) widthRef.current.value = "";
    if (heightRef.current) heightRef.current.value = "";
    if (lqipRef.current) lqipRef.current.value = "";
    if (!file) return;
    const prepared = await prepareImageForUpload(file).catch(() => null);
    if (!prepared) return;
    if (widthRef.current && prepared.width) {
      widthRef.current.value = String(prepared.width);
    }
    if (heightRef.current && prepared.height) {
      heightRef.current.value = String(prepared.height);
    }
    if (lqipRef.current && prepared.lqip) {
      lqipRef.current.value = prepared.lqip;
    }
  }

  return (
    <>
      <form ref={formRef} action={action} className="flex flex-col gap-3">
        <input type="hidden" name="boardId" value={boardId} />
        <input type="hidden" name="width" ref={widthRef} />
        <input type="hidden" name="height" ref={heightRef} />
        <input type="hidden" name="lqip" ref={lqipRef} />
        <input
          name="file"
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          required
          onChange={onFileChange}
          className="block w-full cursor-pointer rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-700 file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-stone-900 file:px-3 file:py-1.5 file:text-xs file:uppercase file:tracking-wider file:text-stone-50 hover:border-stone-300"
        />
        <input
          name="caption"
          placeholder="Caption (optional)"
          maxLength={1000}
          className={inputCls}
        />
        <select
          name="categoryId"
          defaultValue=""
          className={inputCls}
          aria-label="Add to category"
        >
          <option value="">Uncategorized</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {state.status === "error" && <ErrorLine message={state.message} />}
        <div>
          <Button type="submit" variant="primary" isDisabled={pending}>
            {pending ? "Uploading…" : "Upload image"}
          </Button>
        </div>
      </form>
      <ImageUploadToast boardId={boardId} state={state} />
    </>
  );
}

function ImageUploadToast({
  boardId,
  state,
}: {
  boardId: string;
  state: CreateImageArtifactState;
}) {
  // Derive visibility from `state` directly. Track only which state the user
  // (or the auto-hide timer) has dismissed so a fresh success re-shows the
  // toast. useActionState returns a new object per dispatch, so reference
  // equality cleanly distinguishes "same success" from "another success".
  const [dismissed, setDismissed] = useState<CreateImageArtifactState | null>(
    null,
  );

  useEffect(() => {
    if (state.status !== "success" || dismissed === state) return;
    const t = setTimeout(() => setDismissed(state), 5000);
    return () => clearTimeout(t);
  }, [state, dismissed]);

  if (state.status !== "success" || dismissed === state) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed left-1/2 top-6 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full border border-stone-200 bg-white/95 px-4 py-2 text-sm text-stone-700 shadow-lg backdrop-blur-sm"
    >
      <span>
        Image added to{" "}
        <span className="font-medium text-stone-900">{state.categoryName}</span>
      </span>
      <Link
        href={`/boards/${boardId}/c/${state.categorySlug}`}
        className="text-[11px] uppercase tracking-wider text-amber-700 hover:text-amber-900"
        style={{ letterSpacing: "0.12em" }}
      >
        View →
      </Link>
      <button
        type="button"
        onClick={() => setDismissed(state)}
        aria-label="Dismiss"
        className="text-stone-400 hover:text-stone-700"
      >
        ×
      </button>
    </div>
  );
}
