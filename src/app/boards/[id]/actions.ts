"use server";

import { randomUUID } from "node:crypto";
import * as cheerio from "cheerio";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const CreateCategorySchema = z.object({
  boardId: z.string().uuid(),
  name: z.string().trim().min(1, "Name is required").max(80),
});

export type CreateCategoryState =
  | { status: "idle" }
  | { status: "error"; message: string };

export async function createCategory(
  _prev: CreateCategoryState,
  formData: FormData,
): Promise<CreateCategoryState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const parsed = CreateCategorySchema.safeParse({
    boardId: formData.get("boardId"),
    name: formData.get("name"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("categories")
    .insert({ board_id: parsed.data.boardId, name: parsed.data.name });

  if (error) {
    if (error.code === "23505") {
      return { status: "error", message: "That name is already used." };
    }
    return { status: "error", message: error.message };
  }

  revalidatePath(`/boards/${parsed.data.boardId}`);
  return { status: "idle" };
}

export async function deleteCategory(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const id = z.string().uuid().parse(formData.get("id"));
  const boardId = z.string().uuid().parse(formData.get("boardId"));

  const supabase = await createClient();
  const { error } = await supabase.from("categories").delete().eq("id", id);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/boards/${boardId}`);
}

// ---------------------------------------------------------------------------
// Artifacts
// ---------------------------------------------------------------------------

export type CreateArtifactState =
  | { status: "idle" }
  | { status: "error"; message: string };

const NoteOrTextSchema = z.object({
  boardId: z.string().uuid(),
  body: z.string().trim().min(1, "Can't be empty").max(10_000),
});

const LinkSchema = z.object({
  boardId: z.string().uuid(),
  url: z.string().trim().url("Enter a valid URL"),
});

async function insertArtifact(
  boardId: string,
  fields: {
    kind: "note" | "text" | "link" | "image";
    body?: string | null;
    url?: string | null;
    storage_path?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  const supabase = await createClient();
  const { error } = await supabase.from("artifacts").insert({
    board_id: boardId,
    kind: fields.kind,
    body: fields.body ?? null,
    url: fields.url ?? null,
    storage_path: fields.storage_path ?? null,
    metadata: fields.metadata ?? {},
  });
  return error;
}

export async function createNoteArtifact(
  _prev: CreateArtifactState,
  formData: FormData,
): Promise<CreateArtifactState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const parsed = NoteOrTextSchema.safeParse({
    boardId: formData.get("boardId"),
    body: formData.get("body"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  const error = await insertArtifact(parsed.data.boardId, {
    kind: "note",
    body: parsed.data.body,
  });
  if (error) return { status: "error", message: error.message };

  revalidatePath(`/boards/${parsed.data.boardId}`);
  return { status: "idle" };
}

export async function createTextArtifact(
  _prev: CreateArtifactState,
  formData: FormData,
): Promise<CreateArtifactState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const parsed = NoteOrTextSchema.safeParse({
    boardId: formData.get("boardId"),
    body: formData.get("body"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  const error = await insertArtifact(parsed.data.boardId, {
    kind: "text",
    body: parsed.data.body,
  });
  if (error) return { status: "error", message: error.message };

  revalidatePath(`/boards/${parsed.data.boardId}`);
  return { status: "idle" };
}

async function fetchOgMetadata(
  url: string,
): Promise<{ title?: string; description?: string; image_url?: string }> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        // Many sites gate richer responses on a real-looking UA.
        "user-agent":
          "Mozilla/5.0 (compatible; HouseHuntingBoard/0.1; +https://localhost)",
      },
      redirect: "follow",
    }).finally(() => clearTimeout(timer));

    if (!res.ok) return {};
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("text/html")) return {};

    const html = await res.text();
    const $ = cheerio.load(html);
    const meta = (selector: string) =>
      $(selector).attr("content")?.trim() || undefined;

    return {
      title:
        meta('meta[property="og:title"]') ??
        meta('meta[name="twitter:title"]') ??
        ($("title").first().text().trim() || undefined),
      description:
        meta('meta[property="og:description"]') ??
        meta('meta[name="twitter:description"]') ??
        meta('meta[name="description"]'),
      image_url:
        meta('meta[property="og:image"]') ??
        meta('meta[name="twitter:image"]'),
    };
  } catch {
    return {};
  }
}

export async function createLinkArtifact(
  _prev: CreateArtifactState,
  formData: FormData,
): Promise<CreateArtifactState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const parsed = LinkSchema.safeParse({
    boardId: formData.get("boardId"),
    url: formData.get("url"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  const og = await fetchOgMetadata(parsed.data.url);

  const error = await insertArtifact(parsed.data.boardId, {
    kind: "link",
    url: parsed.data.url,
    body: og.description ?? null,
    metadata: og,
  });
  if (error) return { status: "error", message: error.message };

  revalidatePath(`/boards/${parsed.data.boardId}`);
  return { status: "idle" };
}

const ImageSchema = z.object({
  boardId: z.string().uuid(),
  caption: z.string().trim().max(1000).optional(),
});

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB

export async function createImageArtifact(
  _prev: CreateArtifactState,
  formData: FormData,
): Promise<CreateArtifactState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const parsed = ImageSchema.safeParse({
    boardId: formData.get("boardId"),
    caption: formData.get("caption") || undefined,
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", message: "Pick an image to upload." };
  }
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    return { status: "error", message: "Unsupported image type." };
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return { status: "error", message: "Image is larger than 10MB." };
  }

  const ext = (file.name.split(".").pop() ?? "bin").toLowerCase();
  const path = `boards/${parsed.data.boardId}/${randomUUID()}.${ext}`;

  const supabase = await createClient();
  const { error: uploadError } = await supabase.storage
    .from("artifacts")
    .upload(path, file, {
      contentType: file.type,
      upsert: false,
    });
  if (uploadError) {
    return { status: "error", message: uploadError.message };
  }

  const insertError = await insertArtifact(parsed.data.boardId, {
    kind: "image",
    storage_path: path,
    body: parsed.data.caption ?? null,
  });
  if (insertError) {
    // Try to clean up the orphaned object on insert failure.
    await supabase.storage.from("artifacts").remove([path]);
    return { status: "error", message: insertError.message };
  }

  revalidatePath(`/boards/${parsed.data.boardId}`);
  return { status: "idle" };
}

export async function deleteArtifact(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const id = z.string().uuid().parse(formData.get("id"));
  const boardId = z.string().uuid().parse(formData.get("boardId"));

  const supabase = await createClient();
  const { data: row } = await supabase
    .from("artifacts")
    .select("storage_path")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase.from("artifacts").delete().eq("id", id);
  if (error) throw new Error(error.message);

  if (row?.storage_path) {
    await supabase.storage.from("artifacts").remove([row.storage_path]);
  }

  revalidatePath(`/boards/${boardId}`);
}
