"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { prepareImageForUpload } from "@/lib/image-prep";

import { createImageArtifact } from "./actions";

type Status =
  | { kind: "idle" }
  | { kind: "uploading" }
  | { kind: "error"; message: string };

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export function PasteImageListener({ boardId }: { boardId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  useEffect(() => {
    async function onPaste(e: ClipboardEvent) {
      if (isTypingTarget(e.target)) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      const imageItem = Array.from(items).find((i) =>
        i.type.startsWith("image/"),
      );
      if (!imageItem) return;

      const file = imageItem.getAsFile();
      if (!file) return;
      e.preventDefault();

      const ext = EXT_BY_MIME[file.type] ?? "png";
      const named =
        file.name && file.name !== "image.png"
          ? file
          : new File([file], `paste-${Date.now()}.${ext}`, {
              type: file.type,
            });

      setStatus({ kind: "uploading" });
      const prepared = await prepareImageForUpload(named).catch(() => null);
      const fd = new FormData();
      fd.append("boardId", boardId);
      fd.append("file", prepared?.file ?? named);
      if (prepared?.width && prepared.height) {
        fd.append("width", String(prepared.width));
        fd.append("height", String(prepared.height));
      }
      if (prepared?.lqip) fd.append("lqip", prepared.lqip);

      const result = await createImageArtifact({ status: "idle" }, fd);
      if (result.status === "error") {
        setStatus({ kind: "error", message: result.message });
        setTimeout(() => setStatus({ kind: "idle" }), 4000);
      } else {
        setStatus({ kind: "idle" });
        router.refresh();
      }
    }

    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [boardId, router]);

  if (status.kind === "idle") return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed left-1/2 top-6 z-50 -translate-x-1/2 rounded-full border border-stone-200 bg-white/95 px-4 py-2 text-sm text-stone-700 shadow-lg backdrop-blur-sm"
    >
      {status.kind === "uploading" ? (
        <span className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-700" />
          Uploading pasted image…
        </span>
      ) : (
        <span className="text-red-700">{status.message}</span>
      )}
    </div>
  );
}
