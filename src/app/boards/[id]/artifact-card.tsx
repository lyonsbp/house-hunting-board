"use client";

import { useRef } from "react";
import {
  Dropdown,
  DropdownItem,
  DropdownMenu,
  DropdownPopover,
  DropdownTrigger,
} from "@heroui/react";

import type { Artifact } from "@/lib/artifacts";

import { deleteArtifact } from "./actions";

const SERIF =
  '"Cochin", "Hoefler Text", "Iowan Old Style", "Palatino Linotype", Georgia, serif';
const HAND =
  '"Marker Felt", "Bradley Hand", "Chalkboard SE", "Comic Sans MS", system-ui, sans-serif';

export function ArtifactCard({
  artifact,
  boardId,
  signedImageUrl,
}: {
  artifact: Artifact;
  boardId: string;
  signedImageUrl?: string;
}) {
  switch (artifact.kind) {
    case "image":
      return (
        <ImageCard
          artifact={artifact}
          boardId={boardId}
          signedImageUrl={signedImageUrl}
        />
      );
    case "link":
      return <LinkCard artifact={artifact} boardId={boardId} />;
    case "text":
      return <TextCard artifact={artifact} boardId={boardId} />;
    case "note":
      return <NoteCard artifact={artifact} boardId={boardId} />;
  }
}

function CardOverflowMenu({ id, boardId }: { id: string; boardId: string }) {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <>
      <form
        ref={formRef}
        action={deleteArtifact}
        className="hidden"
        aria-hidden="true"
      >
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="boardId" value={boardId} />
      </form>
      <Dropdown>
        <DropdownTrigger
          aria-label="Card options"
          className="absolute right-2 top-2 z-10 inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/85 text-stone-600 opacity-0 shadow-sm backdrop-blur-sm transition-opacity hover:text-stone-900 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="currentColor"
            aria-hidden="true"
          >
            <circle cx="3" cy="8" r="1.5" />
            <circle cx="8" cy="8" r="1.5" />
            <circle cx="13" cy="8" r="1.5" />
          </svg>
        </DropdownTrigger>
        <DropdownPopover placement="bottom end">
          <DropdownMenu aria-label="Card actions">
            <DropdownItem
              variant="danger"
              onAction={() => formRef.current?.requestSubmit()}
            >
              Remove
            </DropdownItem>
          </DropdownMenu>
        </DropdownPopover>
      </Dropdown>
    </>
  );
}

function ImageCard({
  artifact,
  boardId,
  signedImageUrl,
}: {
  artifact: Extract<Artifact, { kind: "image" }>;
  boardId: string;
  signedImageUrl?: string;
}) {
  return (
    <figure className="group relative">
      <div className="overflow-hidden rounded-xl bg-stone-100 shadow-[0_2px_24px_-10px_rgba(0,0,0,0.25)]">
        {signedImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={signedImageUrl}
            alt={artifact.body || "Board image"}
            className="block h-auto w-full"
            loading="lazy"
          />
        ) : (
          <div className="aspect-square animate-pulse" />
        )}
      </div>
      {artifact.body && (
        <figcaption
          style={{ fontFamily: SERIF }}
          className="mt-3 px-1 text-[13px] italic leading-snug text-stone-500"
        >
          {artifact.body}
        </figcaption>
      )}
      <CardOverflowMenu id={artifact.id} boardId={boardId} />
    </figure>
  );
}

function LinkCard({
  artifact,
  boardId,
}: {
  artifact: Extract<Artifact, { kind: "link" }>;
  boardId: string;
}) {
  let host = "";
  try {
    host = new URL(artifact.url).host.replace(/^www\./, "");
  } catch {
    host = artifact.url;
  }

  const { title, description, imageUrl } = artifact.metadata;

  return (
    <article className="group relative overflow-hidden rounded-xl border border-stone-200 bg-white transition-shadow duration-300 hover:shadow-[0_8px_28px_-12px_rgba(0,0,0,0.18)]">
      <a
        href={artifact.url}
        target="_blank"
        rel="noopener noreferrer"
        className="block"
      >
        {imageUrl && (
          <div className="aspect-[16/10] overflow-hidden bg-stone-100">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl}
              alt=""
              className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.04]"
              loading="lazy"
            />
          </div>
        )}
        <div className="space-y-2 px-4 pb-4 pt-3.5">
          {title ? (
            <h3 className="text-[15px] font-semibold leading-snug text-stone-900">
              {title}
            </h3>
          ) : (
            <h3
              style={{ fontFamily: SERIF }}
              className="text-[15px] italic leading-snug text-stone-700"
            >
              Untitled link
            </h3>
          )}
          {description && (
            <p className="line-clamp-2 text-[13px] leading-relaxed text-stone-600">
              {description}
            </p>
          )}
          <p
            className="pt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-amber-700/80"
            style={{ letterSpacing: "0.18em" }}
          >
            {host}
          </p>
        </div>
      </a>
      <CardOverflowMenu id={artifact.id} boardId={boardId} />
    </article>
  );
}

function TextCard({
  artifact,
  boardId,
}: {
  artifact: Extract<Artifact, { kind: "text" }>;
  boardId: string;
}) {
  return (
    <article className="group relative rounded-xl border border-stone-200/80 bg-stone-50/60 px-6 pb-5 pt-4">
      <div style={{ fontFamily: SERIF }} className="relative text-stone-800">
        <span
          aria-hidden="true"
          className="absolute -left-1 -top-2 select-none text-5xl leading-none text-amber-700/35"
        >
          &ldquo;
        </span>
        <p className="relative pl-4 text-[15px] italic leading-relaxed">
          {artifact.body}
        </p>
      </div>
      <CardOverflowMenu id={artifact.id} boardId={boardId} />
    </article>
  );
}

// Pseudo-random tilt per id so notes feel pinned-not-grid.
function tiltFor(id: string): string {
  const hash = id
    .split("")
    .reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) >>> 0, 0);
  const buckets = [-1.4, -0.8, -0.3, 0.3, 0.8, 1.4];
  return `${buckets[hash % buckets.length]}deg`;
}

function NoteCard({
  artifact,
  boardId,
}: {
  artifact: Extract<Artifact, { kind: "note" }>;
  boardId: string;
}) {
  return (
    <article
      className="group relative rounded-md p-4 shadow-[2px_3px_14px_-7px_rgba(0,0,0,0.3)]"
      style={{
        background:
          "linear-gradient(145deg, #FFF6D8 0%, #FCEDB7 60%, #F8E29A 100%)",
        transform: `rotate(${tiltFor(artifact.id)})`,
      }}
    >
      <p
        className="whitespace-pre-line text-[15px] leading-snug text-stone-800"
        style={{ fontFamily: HAND }}
      >
        {artifact.body}
      </p>
      <CardOverflowMenu id={artifact.id} boardId={boardId} />
    </article>
  );
}
