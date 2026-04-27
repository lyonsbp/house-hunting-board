"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Button } from "@heroui/react";

import {
  createImageArtifact,
  createLinkArtifact,
  createNoteArtifact,
  createTextArtifact,
  type CreateArtifactState,
} from "./actions";

const initialState: CreateArtifactState = { status: "idle" };

const KINDS = [
  { id: "note", label: "Note" },
  { id: "text", label: "Passage" },
  { id: "link", label: "Link" },
  { id: "image", label: "Image" },
] as const;
type KindId = (typeof KINDS)[number]["id"];

const inputCls =
  "w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:border-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-200";

export function AddArtifact({ boardId }: { boardId: string }) {
  const [active, setActive] = useState<KindId>("note");

  return (
    <div className="space-y-4">
      <div className="inline-flex gap-1 rounded-full border border-stone-200 bg-white p-1 shadow-sm">
        {KINDS.map((k) => (
          <button
            key={k.id}
            type="button"
            onClick={() => setActive(k.id)}
            aria-pressed={active === k.id}
            className={`rounded-full px-4 py-1.5 text-[10px] font-medium uppercase transition-colors ${
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

      <div>
        {active === "note" && <NoteForm boardId={boardId} />}
        {active === "text" && <TextForm boardId={boardId} />}
        {active === "link" && <LinkForm boardId={boardId} />}
        {active === "image" && <ImageForm boardId={boardId} />}
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

function ImageForm({ boardId }: { boardId: string }) {
  const [state, action, pending] = useActionState(
    createImageArtifact,
    initialState,
  );
  const formRef = useRef<HTMLFormElement>(null);
  useResetOnSuccess(state, pending, formRef);

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-3">
      <input type="hidden" name="boardId" value={boardId} />
      <input
        name="file"
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        required
        className="block w-full cursor-pointer rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-700 file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-stone-900 file:px-3 file:py-1.5 file:text-xs file:uppercase file:tracking-wider file:text-stone-50 hover:border-stone-300"
      />
      <input
        name="caption"
        placeholder="Caption (optional)"
        maxLength={1000}
        className={inputCls}
      />
      {state.status === "error" && <ErrorLine message={state.message} />}
      <div>
        <Button type="submit" variant="primary" isDisabled={pending}>
          {pending ? "Uploading…" : "Upload image"}
        </Button>
      </div>
    </form>
  );
}
