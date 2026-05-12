"use server";

import * as cheerio from "cheerio";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getCurrentUser } from "@/lib/auth";
import { UNCATEGORIZED_ID } from "@/lib/board-data-shared";
import { readImageDimensions } from "@/lib/image-meta";
import { slugify } from "@/lib/slug";
import { createAdminClient } from "@/lib/supabase/admin";
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
  categoryId: z.string().uuid().optional(),
  // Optional client-supplied image metadata. The client measures these
  // before submitting so the grid can render an exact aspect-ratio box
  // immediately. If absent we parse dims from bytes server-side.
  width: z.coerce.number().int().positive().max(50_000).optional(),
  height: z.coerce.number().int().positive().max(50_000).optional(),
  lqip: z
    .string()
    .max(4_000)
    .regex(/^data:image\/(jpeg|png|webp);base64,/)
    .optional(),
});

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB

/**
 * Image-specific superset of CreateArtifactState. After a successful
 * upload we surface where the image landed (category name + slug) so the
 * form can render a toast linking to that category's drill-down.
 */
export type CreateImageArtifactState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | {
      status: "success";
      categoryId: string | null;
      categoryName: string;
      categorySlug: string;
    };

export async function createImageArtifact(
  _prev: CreateImageArtifactState,
  formData: FormData,
): Promise<CreateImageArtifactState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const parsed = ImageSchema.safeParse({
    boardId: formData.get("boardId"),
    caption: formData.get("caption") || undefined,
    categoryId: formData.get("categoryId") || undefined,
    width: formData.get("width") || undefined,
    height: formData.get("height") || undefined,
    lqip: formData.get("lqip") || undefined,
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
  const path = `boards/${parsed.data.boardId}/${crypto.randomUUID()}.${ext}`;

  // Prefer the client-measured dims (zero extra bytes read). Fall back
  // to parsing the file header server-side so non-browser submitters
  // (e.g. CLI tests, future automation) still get exact aspect ratios.
  let width = parsed.data.width;
  let height = parsed.data.height;
  if (!width || !height) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const dims = readImageDimensions(buf, file.type);
    if (dims) {
      width = dims.width;
      height = dims.height;
    }
  }

  const metadata: Record<string, unknown> = {};
  if (width && height) {
    metadata.width = width;
    metadata.height = height;
  }
  if (parsed.data.lqip) metadata.lqip = parsed.data.lqip;

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

  // Inline-insert here (instead of using insertArtifact) so we can grab
  // the new artifact id and chain it into artifact_categories when the
  // user picked a target category.
  const { data: inserted, error: insertError } = await supabase
    .from("artifacts")
    .insert({
      board_id: parsed.data.boardId,
      kind: "image",
      storage_path: path,
      body: parsed.data.caption ?? null,
      metadata,
    })
    .select("id")
    .single();
  if (insertError || !inserted) {
    await supabase.storage.from("artifacts").remove([path]);
    return {
      status: "error",
      message: insertError?.message ?? "Failed to save image.",
    };
  }

  // Category assignment (optional). If it fails we fall back to
  // Uncategorized — the image is already uploaded and visible, so a
  // failed assignment shouldn't be a hard error.
  let landingCategoryId: string | null = null;
  let landingCategoryName = "Uncategorized";
  let landingCategorySlug: string = UNCATEGORIZED_ID;

  if (parsed.data.categoryId) {
    const { data: maxRow } = await supabase
      .from("artifact_categories")
      .select("sort_order")
      .eq("category_id", parsed.data.categoryId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextSortOrder = (maxRow?.sort_order ?? -1) + 1;

    const { error: assignError } = await supabase
      .from("artifact_categories")
      .insert({
        artifact_id: inserted.id,
        category_id: parsed.data.categoryId,
        sort_order: nextSortOrder,
      });

    if (!assignError) {
      const { data: cat } = await supabase
        .from("categories")
        .select("name")
        .eq("id", parsed.data.categoryId)
        .maybeSingle();
      if (cat) {
        landingCategoryId = parsed.data.categoryId;
        landingCategoryName = cat.name;
        landingCategorySlug = slugify(cat.name);
      }
    }
  }

  revalidatePath(`/boards/${parsed.data.boardId}`);
  return {
    status: "success",
    categoryId: landingCategoryId,
    categoryName: landingCategoryName,
    categorySlug: landingCategorySlug,
  };
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

// ---------------------------------------------------------------------------
// Categorization (artifact_categories)
// ---------------------------------------------------------------------------

const UuidPair = z.object({
  artifactId: z.string().uuid(),
  categoryId: z.string().uuid(),
  boardId: z.string().uuid(),
});

export async function assignCategory(input: {
  artifactId: string;
  categoryId: string;
  boardId: string;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { artifactId, categoryId, boardId } = UuidPair.parse(input);

  const supabase = await createClient();

  // Append: sort_order = max + 1 within this category, or 0 if empty.
  const { data: maxRow } = await supabase
    .from("artifact_categories")
    .select("sort_order")
    .eq("category_id", categoryId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextSortOrder = (maxRow?.sort_order ?? -1) + 1;

  const { error } = await supabase.from("artifact_categories").upsert(
    {
      artifact_id: artifactId,
      category_id: categoryId,
      sort_order: nextSortOrder,
    },
    { onConflict: "artifact_id,category_id", ignoreDuplicates: true },
  );
  if (error) throw new Error(error.message);

  revalidatePath(`/boards/${boardId}`);
}

export async function unassignCategory(input: {
  artifactId: string;
  categoryId: string;
  boardId: string;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { artifactId, categoryId, boardId } = UuidPair.parse(input);

  const supabase = await createClient();
  const { error } = await supabase
    .from("artifact_categories")
    .delete()
    .eq("artifact_id", artifactId)
    .eq("category_id", categoryId);
  if (error) throw new Error(error.message);

  revalidatePath(`/boards/${boardId}`);
}

const SetFavoriteSchema = z.object({
  boardId: z.string().uuid(),
  categoryId: z.string().uuid(),
  artifactId: z.string().uuid(),
  favorite: z.boolean(),
});

/**
 * Toggle the per-category favorite flag on an artifact membership.
 * Favorites sort above non-favorites in the category drill-down.
 *
 * `favorite` is explicit (not a server-side toggle) so a double-click
 * can't race itself into an unintended state. The artifact must already
 * be a member of the category — we UPDATE rather than UPSERT, since
 * favoriting an artifact you haven't first added to a category is
 * meaningless. RLS enforces editor-role writes via the existing
 * "artifact_categories: via artifact" policy.
 */
export async function setFavorite(input: {
  boardId: string;
  categoryId: string;
  artifactId: string;
  favorite: boolean;
}): Promise<{ ok: true } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not authenticated" };
  const parsed = SetFavoriteSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("artifact_categories")
    .update({ is_favorite: parsed.data.favorite })
    .eq("artifact_id", parsed.data.artifactId)
    .eq("category_id", parsed.data.categoryId);
  if (error) return { error: error.message };

  revalidatePath(`/boards/${parsed.data.boardId}`);
  return { ok: true };
}

const CreateCategoryAndAssignSchema = z.object({
  boardId: z.string().uuid(),
  artifactId: z.string().uuid(),
  /** When dragging from a real category, unassign from it as part of the
   *  move. Null when dragging from Uncategorized. */
  sourceCategoryId: z.string().uuid().nullable(),
  name: z.string().trim().min(1, "Name is required").max(80),
});

/**
 * Creates a brand-new category and moves the dragged artifact into it
 * in one round-trip. Used by the swim-lane panel's "+ New category"
 * drop target. Returns the new category's id + name so the caller can
 * compute a slug and redirect.
 *
 * Move semantics match the regular `chip:assign` flow: the artifact is
 * unassigned from its source category (if any) and assigned to the new
 * one. RLS gates each step on board membership / editor role.
 */
export async function createCategoryAndAssign(input: {
  boardId: string;
  artifactId: string;
  sourceCategoryId: string | null;
  name: string;
}): Promise<
  { ok: true; categoryId: string; name: string } | { error: string }
> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const parsed = CreateCategoryAndAssignSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();

  const { data: catRow, error: catErr } = await supabase
    .from("categories")
    .insert({ board_id: parsed.data.boardId, name: parsed.data.name })
    .select("id, name")
    .single();
  if (catErr || !catRow) {
    if (catErr?.code === "23505") {
      return { error: "That name is already used." };
    }
    return { error: catErr?.message ?? "Failed to create category." };
  }

  // Assign the artifact to the new category. New category has no rows
  // yet, so sort_order = 0.
  const { error: assignErr } = await supabase
    .from("artifact_categories")
    .upsert(
      {
        artifact_id: parsed.data.artifactId,
        category_id: catRow.id,
        sort_order: 0,
      },
      { onConflict: "artifact_id,category_id", ignoreDuplicates: true },
    );
  if (assignErr) return { error: assignErr.message };

  // If the artifact was dragged from a real category, unassign it from
  // the source. Matches the move semantics of `chip:assign:<id>`.
  if (parsed.data.sourceCategoryId) {
    const { error: unErr } = await supabase
      .from("artifact_categories")
      .delete()
      .eq("artifact_id", parsed.data.artifactId)
      .eq("category_id", parsed.data.sourceCategoryId);
    if (unErr) return { error: unErr.message };
  }

  revalidatePath(`/boards/${parsed.data.boardId}`);
  return { ok: true, categoryId: catRow.id, name: catRow.name };
}

const ReorderSchema = z.object({
  boardId: z.string().uuid(),
  categoryId: z.string().uuid(),
  orderedArtifactIds: z.array(z.string().uuid()).min(1),
});

export async function reorderCategory(input: {
  boardId: string;
  categoryId: string;
  orderedArtifactIds: string[];
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { boardId, categoryId, orderedArtifactIds } =
    ReorderSchema.parse(input);

  const supabase = await createClient();
  // Run updates in parallel — RLS still gates each row by board membership.
  const results = await Promise.all(
    orderedArtifactIds.map((artifactId, i) =>
      supabase
        .from("artifact_categories")
        .update({ sort_order: i })
        .eq("artifact_id", artifactId)
        .eq("category_id", categoryId),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) throw new Error(failed.error.message);

  revalidatePath(`/boards/${boardId}`);
}

// ---------------------------------------------------------------------------
// Tags (board-scoped) + artifact_tags (per-artifact)
// ---------------------------------------------------------------------------

const AddTagSchema = z.object({
  boardId: z.string().uuid(),
  artifactId: z.string().uuid(),
  tagName: z.string().trim().min(1).max(40),
});

export async function addTagToArtifact(input: {
  boardId: string;
  artifactId: string;
  tagName: string;
}): Promise<{ tagId: string } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not authenticated" };
  const parsed = AddTagSchema.safeParse(input);
  if (!parsed.success)
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { boardId, artifactId, tagName } = parsed.data;

  const supabase = await createClient();

  // Upsert tag for this board (unique on board_id+name).
  const { data: tagRow, error: tagErr } = await supabase
    .from("tags")
    .upsert(
      { board_id: boardId, name: tagName },
      { onConflict: "board_id,name", ignoreDuplicates: false },
    )
    .select("id")
    .single();
  if (tagErr || !tagRow) {
    return { error: tagErr?.message ?? "Failed to create tag" };
  }

  const { error: linkErr } = await supabase
    .from("artifact_tags")
    .upsert(
      { artifact_id: artifactId, tag_id: tagRow.id },
      { onConflict: "artifact_id,tag_id", ignoreDuplicates: true },
    );
  if (linkErr) return { error: linkErr.message };

  revalidatePath(`/boards/${boardId}`);
  return { tagId: tagRow.id };
}

export async function removeTagFromArtifact(input: {
  boardId: string;
  artifactId: string;
  tagId: string;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { boardId, artifactId, tagId } = z
    .object({
      boardId: z.string().uuid(),
      artifactId: z.string().uuid(),
      tagId: z.string().uuid(),
    })
    .parse(input);

  const supabase = await createClient();
  const { error } = await supabase
    .from("artifact_tags")
    .delete()
    .eq("artifact_id", artifactId)
    .eq("tag_id", tagId);
  if (error) throw new Error(error.message);

  revalidatePath(`/boards/${boardId}`);
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

const AddCommentSchema = z.object({
  boardId: z.string().uuid(),
  artifactId: z.string().uuid(),
  body: z.string().trim().min(1, "Can't be empty").max(2000),
});

export type AddCommentState =
  | { status: "idle" }
  | { status: "error"; message: string };

export async function addComment(
  _prev: AddCommentState,
  formData: FormData,
): Promise<AddCommentState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const parsed = AddCommentSchema.safeParse({
    boardId: formData.get("boardId"),
    artifactId: formData.get("artifactId"),
    body: formData.get("body"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("comments")
    .insert({ artifact_id: parsed.data.artifactId, body: parsed.data.body });
  if (error) return { status: "error", message: error.message };

  revalidatePath(`/boards/${parsed.data.boardId}`);
  return { status: "idle" };
}

export type CommentRow = {
  id: string;
  body: string;
  author_id: string;
  created_at: string;
};

export async function listComments(input: {
  artifactId: string;
}): Promise<CommentRow[]> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const artifactId = z.string().uuid().parse(input.artifactId);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("comments")
    .select("id, body, author_id, created_at")
    .eq("artifact_id", artifactId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as CommentRow[];
}

export async function deleteComment(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const id = z.string().uuid().parse(formData.get("id"));
  const boardId = z.string().uuid().parse(formData.get("boardId"));

  const supabase = await createClient();
  const { error } = await supabase.from("comments").delete().eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath(`/boards/${boardId}`);
}

// ---------------------------------------------------------------------------
// Member invites
// ---------------------------------------------------------------------------

const InviteSchema = z.object({
  boardId: z.string().uuid(),
  email: z.string().email("Enter a valid email"),
  role: z.enum(["editor", "viewer"]),
});

export type InviteState =
  | { status: "idle" }
  /** New user — Supabase sent them a magic-link invitation email. */
  | { status: "sent"; email: string }
  /** Existing user — added directly to the board, no email sent. */
  | { status: "added"; email: string }
  | { status: "error"; message: string };

export async function inviteMember(
  _prev: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const parsed = InviteSchema.safeParse({
    boardId: formData.get("boardId"),
    email: formData.get("email"),
    role: formData.get("role"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }
  const { boardId, email, role } = parsed.data;

  // Owner check via the user-scoped client (RLS will filter to memberships
  // they can actually see).
  const supabase = await createClient();
  const { data: ownership } = await supabase
    .from("board_members")
    .select("role")
    .eq("board_id", boardId)
    .eq("user_id", user.sub)
    .maybeSingle();

  if (ownership?.role !== "owner") {
    return {
      status: "error",
      message: "Only the board owner can invite members.",
    };
  }

  const admin = createAdminClient();
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL ?? (await headers()).get("origin") ?? "";

  const { data: inviteData, error: inviteError } =
    await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${origin}/auth/callback`,
    });

  // If the user already exists, Supabase Auth returns a specific error.
  // We treat that as a non-failure and look the user up below.
  let invitedUserId = inviteData?.user?.id;
  const alreadyRegistered =
    inviteError && /already.*registered/i.test(inviteError.message);

  if (inviteError && !alreadyRegistered) {
    return { status: "error", message: inviteError.message };
  }

  if (!invitedUserId) {
    const { data: list, error: listErr } = await admin.auth.admin.listUsers({
      perPage: 1000,
    });
    if (listErr) return { status: "error", message: listErr.message };
    const existing = list?.users?.find(
      (u) => u.email?.toLowerCase() === email.toLowerCase(),
    );
    if (!existing) {
      return {
        status: "error",
        message: "Could not resolve invited user.",
      };
    }
    invitedUserId = existing.id;
  }

  const { error: memberError } = await admin
    .from("board_members")
    .upsert(
      {
        board_id: boardId,
        user_id: invitedUserId,
        role,
        invited_by: user.sub,
      },
      { onConflict: "board_id,user_id" },
    );

  if (memberError) {
    return { status: "error", message: memberError.message };
  }

  revalidatePath(`/boards/${boardId}`);
  return alreadyRegistered
    ? { status: "added", email }
    : { status: "sent", email };
}

// ---------------------------------------------------------------------------
// Sharing — public read-only links
// ---------------------------------------------------------------------------

const SetVisibilitySchema = z.object({
  boardId: z.string().uuid(),
  isPublic: z.boolean(),
});

export async function setBoardVisibility(input: {
  boardId: string;
  isPublic: boolean;
}): Promise<{ ok: true; isPublic: boolean } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not authenticated" };
  const parsed = SetVisibilitySchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  // Owner check up front for a friendlier error than RLS would give. The
  // boards UPDATE policy is editor+ but flipping visibility is owner-only —
  // enforce that here.
  const { data: membership } = await supabase
    .from("board_members")
    .select("role")
    .eq("board_id", parsed.data.boardId)
    .eq("user_id", user.sub)
    .maybeSingle();
  if (membership?.role !== "owner") {
    return { error: "Only the board owner can change sharing." };
  }

  const { error } = await supabase
    .from("boards")
    .update({ is_public: parsed.data.isPublic })
    .eq("id", parsed.data.boardId);
  if (error) return { error: error.message };

  revalidatePath(`/boards/${parsed.data.boardId}`);
  return { ok: true, isPublic: parsed.data.isPublic };
}
