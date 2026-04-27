"use client";

import { useEffect, useRef, useState } from "react";
import {
  Dropdown,
  DropdownItem,
  DropdownMenu,
  DropdownPopover,
  DropdownTrigger,
} from "@heroui/react";

import type { Artifact } from "@/lib/artifacts";

import {
  addComment,
  addTagToArtifact,
  assignCategory,
  deleteArtifact,
  deleteComment,
  listComments,
  removeTagFromArtifact,
  unassignCategory,
  type AddCommentState,
  type CommentRow,
} from "./actions";

const SERIF =
  '"Cochin", "Hoefler Text", "Iowan Old Style", "Palatino Linotype", Georgia, serif';
const HAND =
  '"Marker Felt", "Bradley Hand", "Chalkboard SE", "Comic Sans MS", system-ui, sans-serif';

type Category = { id: string; name: string };
type Tag = { id: string; name: string };
type PanelKind = null | "categorize" | "tags" | "comments";

export function ArtifactCard({
  artifact,
  boardId,
  signedImageUrl,
  categories,
  memberCategoryIds,
  tags,
  allTags,
}: {
  artifact: Artifact;
  boardId: string;
  signedImageUrl?: string;
  categories: Category[];
  memberCategoryIds: string[];
  tags: Tag[];
  allTags: Tag[];
}) {
  const [openPanel, setOpenPanel] = useState<PanelKind>(null);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <div className="group relative">
      {/* Hidden form for the Remove action */}
      <form
        ref={formRef}
        action={deleteArtifact}
        className="hidden"
        aria-hidden="true"
      >
        <input type="hidden" name="id" value={artifact.id} />
        <input type="hidden" name="boardId" value={boardId} />
      </form>

      <CardOverflowMenu
        onOpenPanel={setOpenPanel}
        onRemove={() => formRef.current?.requestSubmit()}
      />

      <CardBody artifact={artifact} signedImageUrl={signedImageUrl} />

      {tags.length > 0 && <TagsRow tags={tags} />}

      {openPanel && (
        <CardPanelDialog
          openPanel={openPanel}
          onClose={() => setOpenPanel(null)}
          artifact={artifact}
          boardId={boardId}
          categories={categories}
          memberCategoryIds={memberCategoryIds}
          tags={tags}
          allTags={allTags}
        />
      )}
    </div>
  );
}

function CardOverflowMenu({
  onOpenPanel,
  onRemove,
}: {
  onOpenPanel: (panel: PanelKind) => void;
  onRemove: () => void;
}) {
  return (
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
          <DropdownItem onAction={() => onOpenPanel("categorize")}>
            Categorize…
          </DropdownItem>
          <DropdownItem onAction={() => onOpenPanel("tags")}>Tags…</DropdownItem>
          <DropdownItem onAction={() => onOpenPanel("comments")}>
            Comments
          </DropdownItem>
          <DropdownItem variant="danger" onAction={onRemove}>
            Remove
          </DropdownItem>
        </DropdownMenu>
      </DropdownPopover>
    </Dropdown>
  );
}

function TagsRow({ tags }: { tags: Tag[] }) {
  const visible = tags.slice(0, 4);
  const extra = tags.length - visible.length;
  return (
    <div className="mt-2 flex flex-wrap gap-1 px-1">
      {visible.map((t) => (
        <span
          key={t.id}
          className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-stone-600"
          style={{ letterSpacing: "0.08em" }}
        >
          {t.name}
        </span>
      ))}
      {extra > 0 && (
        <span className="px-1 text-[10px] uppercase tracking-wide text-stone-400">
          +{extra}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card body — discriminated union renderer
// ---------------------------------------------------------------------------

function CardBody({
  artifact,
  signedImageUrl,
}: {
  artifact: Artifact;
  signedImageUrl?: string;
}) {
  switch (artifact.kind) {
    case "image":
      return <ImageBody artifact={artifact} signedImageUrl={signedImageUrl} />;
    case "link":
      return <LinkBody artifact={artifact} />;
    case "text":
      return <TextBody artifact={artifact} />;
    case "note":
      return <NoteBody artifact={artifact} />;
  }
}

function ImageBody({
  artifact,
  signedImageUrl,
}: {
  artifact: Extract<Artifact, { kind: "image" }>;
  signedImageUrl?: string;
}) {
  return (
    <figure>
      <div className="overflow-hidden rounded-xl bg-stone-100 shadow-[0_2px_24px_-10px_rgba(0,0,0,0.25)]">
        {signedImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={signedImageUrl}
            alt={artifact.body || "Board image"}
            className="block h-auto w-full"
            loading="lazy"
            draggable={false}
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
    </figure>
  );
}

function LinkBody({
  artifact,
}: {
  artifact: Extract<Artifact, { kind: "link" }>;
}) {
  let host = "";
  try {
    host = new URL(artifact.url).host.replace(/^www\./, "");
  } catch {
    host = artifact.url;
  }

  const { title, description, imageUrl } = artifact.metadata;

  return (
    <article className="overflow-hidden rounded-xl border border-stone-200 bg-white transition-shadow duration-300 hover:shadow-[0_8px_28px_-12px_rgba(0,0,0,0.18)]">
      <a
        href={artifact.url}
        target="_blank"
        rel="noopener noreferrer"
        className="block"
        draggable={false}
      >
        {imageUrl && (
          <div className="aspect-[16/10] overflow-hidden bg-stone-100">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl}
              alt=""
              className="h-full w-full object-cover transition-transform duration-700 hover:scale-[1.04]"
              loading="lazy"
              draggable={false}
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
            className="pt-1 font-mono text-[10px] uppercase text-amber-700/80"
            style={{ letterSpacing: "0.18em" }}
          >
            {host}
          </p>
        </div>
      </a>
    </article>
  );
}

function TextBody({
  artifact,
}: {
  artifact: Extract<Artifact, { kind: "text" }>;
}) {
  return (
    <article className="rounded-xl border border-stone-200/80 bg-stone-50/60 px-6 pb-5 pt-4">
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
    </article>
  );
}

function tiltFor(id: string): string {
  const hash = id
    .split("")
    .reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) >>> 0, 0);
  const buckets = [-1.4, -0.8, -0.3, 0.3, 0.8, 1.4];
  return `${buckets[hash % buckets.length]}deg`;
}

function NoteBody({
  artifact,
}: {
  artifact: Extract<Artifact, { kind: "note" }>;
}) {
  return (
    <article
      className="rounded-md p-4 shadow-[2px_3px_14px_-7px_rgba(0,0,0,0.3)]"
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
    </article>
  );
}

// ---------------------------------------------------------------------------
// Panel modal (native <dialog>) — Categorize / Tags / Comments
// ---------------------------------------------------------------------------

function CardPanelDialog({
  openPanel,
  onClose,
  artifact,
  boardId,
  categories,
  memberCategoryIds,
  tags,
  allTags,
}: {
  openPanel: PanelKind;
  onClose: () => void;
  artifact: Artifact;
  boardId: string;
  categories: Category[];
  memberCategoryIds: string[];
  tags: Tag[];
  allTags: Tag[];
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (openPanel) {
      if (!dlg.open) dlg.showModal();
    } else {
      if (dlg.open) dlg.close();
    }
  }, [openPanel]);

  const title =
    openPanel === "categorize"
      ? "Categorize"
      : openPanel === "tags"
        ? "Tags"
        : "Comments";

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        // Close on backdrop click (target === dialog itself)
        if (e.target === ref.current) onClose();
      }}
      className="m-0 mx-auto my-auto rounded-2xl border border-stone-200 bg-white p-0 shadow-2xl backdrop:bg-stone-900/30 backdrop:backdrop-blur-sm"
    >
      <div className="w-[min(420px,90vw)] p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3
            style={{ fontFamily: SERIF }}
            className="text-2xl font-normal text-stone-900"
          >
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M6 6 L18 18 M18 6 L6 18" />
            </svg>
          </button>
        </div>

        {openPanel === "categorize" && (
          <CategorizePanel
            artifactId={artifact.id}
            boardId={boardId}
            categories={categories}
            memberCategoryIds={memberCategoryIds}
          />
        )}
        {openPanel === "tags" && (
          <TagsPanel
            artifactId={artifact.id}
            boardId={boardId}
            tags={tags}
            allTags={allTags}
          />
        )}
        {openPanel === "comments" && (
          <CommentsPanel artifactId={artifact.id} boardId={boardId} />
        )}
      </div>
    </dialog>
  );
}

function CategorizePanel({
  artifactId,
  boardId,
  categories,
  memberCategoryIds,
}: {
  artifactId: string;
  boardId: string;
  categories: Category[];
  memberCategoryIds: string[];
}) {
  const memberSet = new Set(memberCategoryIds);
  const [pending, setPending] = useState<string | null>(null);

  async function toggle(categoryId: string) {
    setPending(categoryId);
    try {
      if (memberSet.has(categoryId)) {
        await unassignCategory({ artifactId, categoryId, boardId });
      } else {
        await assignCategory({ artifactId, categoryId, boardId });
      }
    } finally {
      setPending(null);
    }
  }

  if (categories.length === 0) {
    return (
      <p className="text-sm italic text-stone-500" style={{ fontFamily: SERIF }}>
        No categories yet. Add one from the categories section above the canvas.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {categories.map((c) => {
        const on = memberSet.has(c.id);
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => toggle(c.id)}
            disabled={pending === c.id}
            className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
              on
                ? "border-stone-900 bg-stone-900 text-stone-50"
                : "border-stone-200 bg-white text-stone-700 hover:border-stone-400"
            } ${pending === c.id ? "opacity-50" : ""}`}
          >
            {c.name}
          </button>
        );
      })}
    </div>
  );
}

function TagsPanel({
  artifactId,
  boardId,
  tags,
  allTags,
}: {
  artifactId: string;
  boardId: string;
  tags: Tag[];
  allTags: Tag[];
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const tagIds = new Set(tags.map((t) => t.id));
  const suggestions = allTags
    .filter((t) => !tagIds.has(t.id))
    .filter(
      (t) =>
        draft.length > 0 && t.name.toLowerCase().includes(draft.toLowerCase()),
    )
    .slice(0, 6);

  async function add(name: string) {
    const value = name.trim();
    if (!value) return;
    setPending(true);
    setError(null);
    const result = await addTagToArtifact({
      boardId,
      artifactId,
      tagName: value,
    });
    setPending(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setDraft("");
  }

  async function remove(tagId: string) {
    await removeTagFromArtifact({ boardId, artifactId, tagId });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5">
        {tags.length === 0 && (
          <p
            className="text-sm italic text-stone-500"
            style={{ fontFamily: SERIF }}
          >
            No tags yet.
          </p>
        )}
        {tags.map((t) => (
          <span
            key={t.id}
            className="inline-flex items-center gap-1 rounded-full bg-stone-100 py-1 pl-3 pr-1 text-xs text-stone-700"
          >
            {t.name}
            <button
              type="button"
              onClick={() => remove(t.id)}
              aria-label={`Remove ${t.name}`}
              className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full text-stone-400 hover:bg-stone-200 hover:text-stone-700"
            >
              ×
            </button>
          </span>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void add(draft);
        }}
        className="relative"
      >
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Type a tag and press Enter…"
          maxLength={40}
          className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:border-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-200"
          disabled={pending}
        />
        {suggestions.length > 0 && (
          <ul className="absolute left-0 right-0 top-full z-10 mt-1 max-h-44 overflow-auto rounded-lg border border-stone-200 bg-white shadow-lg">
            {suggestions.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => void add(s.name)}
                  className="block w-full px-3 py-1.5 text-left text-sm text-stone-700 hover:bg-stone-50"
                >
                  {s.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </form>
      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  );
}

function CommentsPanel({
  artifactId,
  boardId,
}: {
  artifactId: string;
  boardId: string;
}) {
  const [comments, setComments] = useState<CommentRow[] | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    listComments({ artifactId }).then((rows) => {
      if (!cancelled) setComments(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [artifactId, reloadKey]);

  return (
    <div className="flex flex-col gap-4">
      <div className="max-h-64 overflow-y-auto pr-1">
        {comments === null ? (
          <p className="text-sm text-stone-400">Loading…</p>
        ) : comments.length === 0 ? (
          <p className="text-sm italic text-stone-500" style={{ fontFamily: SERIF }}>
            Be the first to comment.
          </p>
        ) : (
          <ul className="space-y-3">
            {comments.map((c) => (
              <li
                key={c.id}
                className="rounded-md border border-stone-100 bg-stone-50 p-3"
              >
                <p className="whitespace-pre-line text-[14px] leading-relaxed text-stone-800">
                  {c.body}
                </p>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-wide text-stone-400">
                    {new Date(c.created_at).toLocaleDateString()}
                  </span>
                  <DeleteCommentButton
                    id={c.id}
                    boardId={boardId}
                    onDeleted={() => setReloadKey((k) => k + 1)}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <CommentForm
        artifactId={artifactId}
        boardId={boardId}
        onAdded={() => setReloadKey((k) => k + 1)}
      />
    </div>
  );
}

function DeleteCommentButton({
  id,
  boardId,
  onDeleted,
}: {
  id: string;
  boardId: string;
  onDeleted: () => void;
}) {
  return (
    <form
      action={async (fd) => {
        await deleteComment(fd);
        onDeleted();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="boardId" value={boardId} />
      <button
        type="submit"
        className="text-[10px] uppercase tracking-wide text-stone-400 hover:text-red-700"
      >
        Delete
      </button>
    </form>
  );
}

function CommentForm({
  artifactId,
  boardId,
  onAdded,
}: {
  artifactId: string;
  boardId: string;
  onAdded: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={async (fd) => {
        setPending(true);
        setError(null);
        const initial: AddCommentState = { status: "idle" };
        const result = await addComment(initial, fd);
        setPending(false);
        if (result.status === "error") {
          setError(result.message);
          return;
        }
        formRef.current?.reset();
        onAdded();
      }}
      className="flex flex-col gap-2"
    >
      <input type="hidden" name="boardId" value={boardId} />
      <input type="hidden" name="artifactId" value={artifactId} />
      <textarea
        name="body"
        rows={2}
        maxLength={2000}
        placeholder="Add a comment…"
        required
        className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:border-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-200"
        disabled={pending}
      />
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-stone-900 px-3 py-1.5 text-xs uppercase tracking-wider text-stone-50 disabled:opacity-50"
          style={{ letterSpacing: "0.12em" }}
        >
          {pending ? "Posting…" : "Post"}
        </button>
      </div>
    </form>
  );
}
