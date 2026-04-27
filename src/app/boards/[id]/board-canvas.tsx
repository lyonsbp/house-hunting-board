"use client";

import type { Artifact } from "@/lib/artifacts";

import { ArtifactCard } from "./artifact-card";

const SERIF =
  '"Cochin", "Hoefler Text", "Iowan Old Style", "Palatino Linotype", Georgia, serif';

export function BoardCanvas({
  boardId,
  artifacts,
  signedImageUrls,
}: {
  boardId: string;
  artifacts: Artifact[];
  signedImageUrls: Record<string, string>;
}) {
  if (artifacts.length === 0) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-8 py-24 text-center">
        <svg
          width="96"
          height="96"
          viewBox="0 0 96 96"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-stone-400"
          aria-hidden="true"
        >
          <path d="M14 52 L48 22 L82 52" />
          <path d="M22 47 V78 H74 V47" />
          <path d="M40 78 V62 H56 V78" />
          <circle cx="62" cy="58" r="1.5" fill="currentColor" stroke="none" />
        </svg>
        <p
          style={{ fontFamily: SERIF }}
          className="text-xl italic leading-relaxed text-stone-500"
        >
          Your board is blank.
          <br />
          Drop in a photo, a listing link, or just a thought.
        </p>
      </div>
    );
  }

  return (
    <div className="columns-2 gap-5 [column-fill:_balance] md:columns-3 md:gap-6 lg:columns-4">
      {artifacts.map((art) => (
        <div key={art.id} className="mb-5 break-inside-avoid md:mb-6">
          <ArtifactCard
            artifact={art}
            boardId={boardId}
            signedImageUrl={
              art.kind === "image" ? signedImageUrls[art.storagePath] : undefined
            }
          />
        </div>
      ))}
    </div>
  );
}
