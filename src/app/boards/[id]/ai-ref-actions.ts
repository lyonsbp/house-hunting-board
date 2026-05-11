"use server";

import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * Upload an ephemeral reference image for an AI edit / remix. Lands at
 * `ref_uploads/<user_id>/<uuid>.<ext>` in the existing `artifacts` bucket;
 * a daily Cloudflare cron (`workers/gc-ref-uploads/`) GCs anything older
 * than 24h. Storage RLS (migration 0014) gates this prefix to the owner.
 *
 * The client resizes images to ≤1024px on the long edge before calling
 * this action (see `lib/ai/ref-image-resize.ts`). The server cap below
 * is a safety belt for callers that bypass the helper.
 */

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB after client resize
const ACCEPTED = new Set(["image/jpeg", "image/png", "image/webp"]);
const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export async function uploadRefImage(
  formData: FormData,
): Promise<{ ok: true; path: string } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const file = formData.get("file");
  if (!(file instanceof Blob)) {
    return { error: "Missing file." };
  }
  const mime = file.type;
  if (!ACCEPTED.has(mime)) {
    return { error: "Only JPEG, PNG, or WebP." };
  }
  if (file.size === 0) {
    return { error: "File is empty." };
  }
  if (file.size > MAX_BYTES) {
    return {
      error: `Image too large (${Math.round(
        file.size / 1024,
      )} KB). Max ${MAX_BYTES / 1024 / 1024} MB after resize.`,
    };
  }

  const ext = EXT_BY_MIME[mime];
  const path = `ref_uploads/${user.sub}/${crypto.randomUUID()}.${ext}`;

  const supabase = await createClient();
  const { error: uploadError } = await supabase.storage
    .from("artifacts")
    .upload(path, file, { contentType: mime, upsert: false });
  if (uploadError) {
    return { error: uploadError.message };
  }
  return { ok: true, path };
}

export type BoardRefArtifact = {
  id: string;
  storagePath: string;
  signedUrl: string;
  label: string | null;
};

/**
 * Lazy-loaded list of every image artifact on a board, with short-lived
 * signed URLs for thumbnails. Used by the "From board" picker in the AI
 * edit modal — the board page itself already paginates / filters
 * artifacts for rendering, but the picker wants the full image set in
 * one shot.
 */
export async function listBoardImageArtifactsForRefs(
  boardId: string,
): Promise<{ ok: true; artifacts: BoardRefArtifact[] } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .from("artifacts")
    .select("id, storage_path, body, metadata")
    .eq("board_id", boardId)
    .eq("kind", "image")
    .not("storage_path", "is", null)
    .order("created_at", { ascending: false })
    .limit(120);
  if (error) return { error: error.message };

  const out: BoardRefArtifact[] = [];
  for (const row of rows ?? []) {
    if (!row.storage_path) continue;
    const { data: signed } = await supabase.storage
      .from("artifacts")
      .createSignedUrl(row.storage_path as string, 600);
    if (!signed?.signedUrl) continue;
    out.push({
      id: row.id as string,
      storagePath: row.storage_path as string,
      signedUrl: signed.signedUrl,
      label: typeof row.body === "string" && row.body.length > 0 ? row.body : null,
    });
  }
  return { ok: true, artifacts: out };
}

