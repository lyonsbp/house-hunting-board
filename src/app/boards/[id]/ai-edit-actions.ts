"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import {
  getAiInvocationLimit,
  isSuperadminEmail,
  startOfAiWindow,
} from "@/lib/ai/quota";
import { getEditor, DEFAULT_MODEL } from "@/lib/ai/registry";
import {
  buildRefMetadata,
  resolveReferences,
  validateRefInputs,
  type RefInput,
} from "@/lib/ai/references";
import type { ImageEditModel } from "@/lib/ai/types";

/**
 * Models the user can pick from the AI-edit modal. Has to be a strict
 * subset of `ImageEditModel` (the registry's full enum) — kept small so
 * the UI stays simple and we don't expose the still-stubbed local
 * ComfyUI variants in production.
 */
const SELECTABLE_MODELS = [
  "gemini-2.5-flash-image",
  "flux-kontext",
] as const satisfies readonly ImageEditModel[];

function pickModel(raw: FormDataEntryValue | null): ImageEditModel {
  if (typeof raw !== "string") return DEFAULT_MODEL;
  const found = (SELECTABLE_MODELS as readonly string[]).includes(raw);
  return found ? (raw as ImageEditModel) : DEFAULT_MODEL;
}
import { getCurrentUser } from "@/lib/auth";
import { encodeServerVariants } from "@/lib/image-encode-server";
import { readImageDimensions } from "@/lib/image-meta";
import {
  type ImageExt,
  type Variant,
  buildKey,
  r2WritesEnabled,
  storage,
} from "@/lib/storage";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const MAX_PROMPT_LEN = 1000;
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
const MIN_REMIX_VARIANTS = 2;
const MAX_REMIX_VARIANTS = 4;

const OUTPUT_EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export type EditImageState =
  | { status: "idle" }
  | {
      status: "done";
      outputArtifactId: string;
      signedUrl: string | null;
      prompt: string;
      remaining: number | null;
    }
  | {
      status: "error";
      code:
        | "auth"
        | "not-found"
        | "wrong-kind"
        | "quota"
        | "model"
        | "storage"
        | "validation";
      message: string;
    };

const Schema = z.object({
  boardId: z.string().uuid(),
  artifactId: z.string().uuid(),
  prompt: z
    .string()
    .trim()
    .min(1, "Tell us what to change.")
    .max(MAX_PROMPT_LEN, `Keep it under ${MAX_PROMPT_LEN} characters.`),
});

/**
 * Run a single AI edit: source image + prompt → one new image artifact on
 * the same board. Saved with full lineage in `ai_edits` so the analytics
 * passes can find it later.
 *
 * This is the M3 phase-A implementation — Remix (variants > 1) lands in a
 * follow-up that fans out across the same editor.
 */
export async function editImageArtifact(
  _prev: EditImageState,
  formData: FormData,
): Promise<EditImageState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const parsed = Schema.safeParse({
    boardId: formData.get("boardId"),
    artifactId: formData.get("artifactId"),
    prompt: formData.get("prompt"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      code: "validation",
      message: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }
  const { boardId, artifactId, prompt } = parsed.data;
  const model = pickModel(formData.get("model"));

  // References (optional). Hidden form input is a JSON-encoded array of
  // RefInput per `lib/ai/references.ts`.
  let refInputs: RefInput[];
  try {
    refInputs = validateRefInputs(formData.get("references"));
  } catch (e) {
    return {
      status: "error",
      code: "validation",
      message: e instanceof Error ? e.message : "Invalid references.",
    };
  }

  const supabase = await createClient();

  // Up-front editor-role check for a friendlier error than RLS would give.
  const { data: membership } = await supabase
    .from("board_members")
    .select("role")
    .eq("board_id", boardId)
    .eq("user_id", user.sub)
    .maybeSingle();
  if (!membership || (membership.role !== "editor" && membership.role !== "owner")) {
    return {
      status: "error",
      code: "auth",
      message: "Only board editors can run AI edits.",
    };
  }

  // Fetch the parent artifact + verify it's an image on this board.
  const { data: parent, error: parentError } = await supabase
    .from("artifacts")
    .select("id, board_id, kind, storage_path, storage_backend, metadata")
    .eq("id", artifactId)
    .maybeSingle();
  if (parentError || !parent) {
    return {
      status: "error",
      code: "not-found",
      message: "That image is no longer available.",
    };
  }
  if (parent.board_id !== boardId) {
    return {
      status: "error",
      code: "not-found",
      message: "Artifact does not belong to this board.",
    };
  }
  if (parent.kind !== "image" || !hasArtifactBytes(parent)) {
    return {
      status: "error",
      code: "wrong-kind",
      message: "AI edits only work on image artifacts.",
    };
  }

  // Quota gate. Counts pending + succeeded ai_edits for this user in the
  // rolling window; failed rows don't burn quota so a flaky API call
  // doesn't penalize the user.
  const exempt = isSuperadminEmail(
    typeof user.email === "string" ? user.email : null,
  );
  const limit = getAiInvocationLimit();
  let remaining: number | null = null;
  if (!exempt) {
    const { count, error: countError } = await supabase
      .from("ai_edits")
      .select("id", { count: "exact", head: true })
      .eq("created_by", user.sub)
      .in("status", ["pending", "succeeded"])
      .gte("created_at", startOfAiWindow());
    if (countError) {
      return {
        status: "error",
        code: "model",
        message: `Couldn't check AI quota: ${countError.message}`,
      };
    }
    const used = count ?? 0;
    if (used >= limit) {
      return {
        status: "error",
        code: "quota",
        message: `Weekly AI edit limit reached (${limit}). Try again later.`,
      };
    }
    remaining = limit - used - 1;
  }

  // Download the source image bytes from whichever backend owns them.
  const loaded = await loadArtifactBytes(supabase, parent);
  if ("error" in loaded) {
    return { status: "error", code: "storage", message: loaded.error };
  }
  const sourceBytes = loaded.bytes;
  const sourceMime = loaded.mime;

  // Resolve reference images (RLS gates artifact reads + upload-prefix
  // ownership). Done before the pending insert so quota isn't burned on
  // a request that never reaches the model.
  let referenceImages: Awaited<ReturnType<typeof resolveReferences>> = [];
  const refMetadata = buildRefMetadata(refInputs);
  if (refInputs.length > 0) {
    try {
      referenceImages = await resolveReferences(
        supabase,
        user.sub,
        boardId,
        refInputs,
      );
    } catch (e) {
      return {
        status: "error",
        code: "validation",
        message: e instanceof Error ? e.message : "Invalid references.",
      };
    }
  }

  // Insert the pending ai_edits row first so the quota counter sees this
  // invocation if a sibling tab also tries to fire one. Stamp `metadata.refs`
  // up-front so collaborators subscribed to ai_edits realtime see the inputs
  // even before the model finishes.
  const { data: editRow, error: editInsertError } = await supabase
    .from("ai_edits")
    .insert({
      parent_artifact_id: parent.id,
      prompt,
      model,
      variant_index: 0,
      status: "pending",
      metadata: refMetadata.length > 0 ? { refs: refMetadata } : {},
    })
    .select("id")
    .single();
  if (editInsertError || !editRow) {
    return {
      status: "error",
      code: "model",
      message: editInsertError?.message ?? "Couldn't log AI edit.",
    };
  }
  const editId = editRow.id as string;

  // Run the model.
  let outputBytes: Uint8Array;
  let outputMime: string;
  let costCents: number | null;
  try {
    const editor = getEditor(model);
    const [result] = await editor.edit({
      source: { kind: "bytes", mimeType: sourceMime, bytes: sourceBytes },
      prompt,
      variants: 1,
      references: referenceImages,
    });
    if (!result) throw new Error("Editor returned no result");
    if (result.image.bytes.length > MAX_OUTPUT_BYTES) {
      throw new Error("Output image exceeds the 10MB cap");
    }
    outputBytes = result.image.bytes;
    outputMime = result.image.mimeType;
    costCents = result.costCents;
  } catch (e) {
    const message = e instanceof Error ? e.message : "AI edit failed.";
    await supabase
      .from("ai_edits")
      .update({ status: "failed", error: message })
      .eq("id", editId);
    return { status: "error", code: "model", message };
  }

  const legacyExt = OUTPUT_EXT_BY_MIME[outputMime.toLowerCase()] ?? "png";

  let insertPayload: {
    storage_path: string | null;
    storage_backend: "supabase" | "r2";
    content_hash: string | null;
    metadata: Record<string, unknown>;
  };
  let previewUrl: string | null = null;
  let cleanupLegacyPath: string | null = null;
  let cleanupR2Keys: string[] = [];

  if (r2WritesEnabled()) {
    let encoded;
    try {
      encoded = await encodeServerVariants({
        bytes: outputBytes,
        sourceMime: outputMime,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "resize failed";
      await supabase
        .from("ai_edits")
        .update({ status: "failed", error: msg })
        .eq("id", editId);
      return { status: "error", code: "storage", message: msg };
    }
    try {
      const uploaded = await uploadAiVariantsDeduped({
        contentHash: encoded.contentHash,
        thumb: encoded.thumb,
        display: encoded.display,
        original: encoded.original,
      });
      cleanupR2Keys = uploaded.uploadedKeys;
      insertPayload = {
        storage_path: null,
        storage_backend: "r2",
        content_hash: encoded.contentHash,
        metadata: {
          ai_edit_of: parent.id,
          prompt,
          model,
          width: encoded.width,
          height: encoded.height,
          variants: uploaded.variants,
          ...(refMetadata.length > 0 ? { refs: refMetadata } : {}),
        },
      };
      previewUrl = storage.publicUrl(uploaded.variants.display.key);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "R2 upload failed";
      await supabase
        .from("ai_edits")
        .update({ status: "failed", error: msg })
        .eq("id", editId);
      return { status: "error", code: "storage", message: msg };
    }
  } else {
    const outputPath = `boards/${boardId}/${crypto.randomUUID()}.${legacyExt}`;
    const { error: uploadError } = await supabase.storage
      .from("artifacts")
      .upload(outputPath, outputBytes, {
        contentType: outputMime,
        upsert: false,
      });
    if (uploadError) {
      await supabase
        .from("ai_edits")
        .update({ status: "failed", error: uploadError.message })
        .eq("id", editId);
      return { status: "error", code: "storage", message: uploadError.message };
    }
    cleanupLegacyPath = outputPath;
    const outputDims = readImageDimensions(outputBytes, outputMime);
    insertPayload = {
      storage_path: outputPath,
      storage_backend: "supabase",
      content_hash: null,
      metadata: {
        ai_edit_of: parent.id,
        prompt,
        model,
        ...(outputDims
          ? { width: outputDims.width, height: outputDims.height }
          : {}),
        ...(refMetadata.length > 0 ? { refs: refMetadata } : {}),
      },
    };
  }

  const { data: childArtifact, error: childError } = await supabase
    .from("artifacts")
    .insert({
      board_id: boardId,
      kind: "image",
      storage_path: insertPayload.storage_path,
      storage_backend: insertPayload.storage_backend,
      content_hash: insertPayload.content_hash,
      body: prompt,
      metadata: insertPayload.metadata,
    })
    .select("id")
    .single();
  if (childError || !childArtifact) {
    if (cleanupLegacyPath) {
      await supabase.storage.from("artifacts").remove([cleanupLegacyPath]);
    }
    if (cleanupR2Keys.length > 0) {
      await storage.remove(cleanupR2Keys).catch(() => undefined);
    }
    await supabase
      .from("ai_edits")
      .update({ status: "failed", error: childError?.message ?? "insert failed" })
      .eq("id", editId);
    return {
      status: "error",
      code: "storage",
      message: childError?.message ?? "Couldn't save the edited image.",
    };
  }
  const childId = childArtifact.id as string;

  // Inherit the parent's categories so the child lands next to its source
  // in the canvas instead of in Uncategorized.
  await inheritCategories(supabase, parent.id, childId);

  // Finalize the ai_edits row.
  await supabase
    .from("ai_edits")
    .update({
      status: "succeeded",
      output_artifact_id: childId,
      cost_cents: costCents,
    })
    .eq("id", editId);

  // Preview URL for the review dialog. R2 rows reuse the immutable
  // display variant URL we already have. Legacy rows sign a one-hour
  // URL for the same UX as today.
  let signedUrl: string | null = previewUrl;
  if (!signedUrl && insertPayload.storage_path) {
    const { data: signed } = await supabase.storage
      .from("artifacts")
      .createSignedUrl(insertPayload.storage_path, 3600);
    if (signed?.signedUrl) signedUrl = signed.signedUrl;
  }

  revalidatePath(`/boards/${boardId}`);
  return {
    status: "done",
    outputArtifactId: childId,
    signedUrl,
    prompt,
    remaining,
  };
}

const DiscardSchema = z.object({
  boardId: z.string().uuid(),
  outputArtifactId: z.string().uuid(),
});

/**
 * Roll back an AI edit the user just generated: delete the child artifact,
 * its `ai_edits` row, and the storage object. Restores the user's quota
 * since `ai_edits` rows are the counter source.
 *
 * Caller must own the edit (RLS enforces the artifact's board membership).
 */
export async function discardAiEdit(input: {
  boardId: string;
  outputArtifactId: string;
}): Promise<{ ok: true } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const parsed = DiscardSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { boardId, outputArtifactId } = parsed.data;

  const supabase = await createClient();

  // Look up the artifact to grab the storage path before deletion.
  const { data: child } = await supabase
    .from("artifacts")
    .select("id, board_id, storage_path")
    .eq("id", outputArtifactId)
    .maybeSingle();
  if (!child) return { error: "Edit is no longer available." };
  if (child.board_id !== boardId) {
    return { error: "Artifact does not belong to this board." };
  }

  // Drop the ai_edits row first so the quota counter is restored even if
  // the artifact delete fails downstream. RLS gates this to the original
  // creator, which is the same user via the `with check` clause we never
  // hit on delete — but the `using` policy lets a board member see the row.
  await supabase
    .from("ai_edits")
    .delete()
    .eq("output_artifact_id", outputArtifactId);

  const { error: artifactErr } = await supabase
    .from("artifacts")
    .delete()
    .eq("id", outputArtifactId);
  if (artifactErr) return { error: artifactErr.message };

  if (child.storage_path) {
    await supabase.storage.from("artifacts").remove([child.storage_path]);
  }

  revalidatePath(`/boards/${boardId}`);
  return { ok: true };
}

export type AiQuotaStatus = {
  used: number;
  limit: number;
  /** null when the user is exempt (effectively unlimited). */
  remaining: number | null;
  exempt: boolean;
};

/**
 * Lightweight read used by the AI-edit modal to show "X edits left this
 * week". Doesn't run the model, doesn't write anything.
 */
export async function getAiQuota(): Promise<AiQuotaStatus> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const limit = getAiInvocationLimit();
  const exempt = isSuperadminEmail(
    typeof user.email === "string" ? user.email : null,
  );
  if (exempt) {
    return { used: 0, limit, remaining: null, exempt: true };
  }

  const supabase = await createClient();
  const { count } = await supabase
    .from("ai_edits")
    .select("id", { count: "exact", head: true })
    .eq("created_by", user.sub)
    .in("status", ["pending", "succeeded"])
    .gte("created_at", startOfAiWindow());

  const used = count ?? 0;
  return { used, limit, remaining: Math.max(0, limit - used), exempt: false };
}

async function inheritCategories(
  supabase: Awaited<ReturnType<typeof createClient>>,
  parentArtifactId: string,
  childArtifactId: string,
) {
  const { data: rows } = await supabase
    .from("artifact_categories")
    .select("category_id")
    .eq("artifact_id", parentArtifactId);
  if (!rows || rows.length === 0) return;
  await supabase.from("artifact_categories").insert(
    rows.map((r) => ({
      artifact_id: childArtifactId,
      category_id: r.category_id,
    })),
  );
}

// ---------------------------------------------------------------------------
// Remix — multi-variant fan-out
// ---------------------------------------------------------------------------

export type RemixVariant = {
  outputArtifactId: string;
  signedUrl: string | null;
  variantIndex: number;
};

export type RemixImageState =
  | { status: "idle" }
  | {
      status: "done";
      results: RemixVariant[];
      requested: number;
      failed: number;
      prompt: string;
      remaining: number | null;
      boardId: string;
    }
  | {
      status: "error";
      code:
        | "auth"
        | "not-found"
        | "wrong-kind"
        | "quota"
        | "model"
        | "storage"
        | "validation";
      message: string;
    };

const RemixSchema = z.object({
  boardId: z.string().uuid(),
  artifactId: z.string().uuid(),
  prompt: z
    .string()
    .trim()
    .min(1, "Tell us what to vary.")
    .max(MAX_PROMPT_LEN, `Keep it under ${MAX_PROMPT_LEN} characters.`),
  variants: z.coerce
    .number()
    .int()
    .min(MIN_REMIX_VARIANTS)
    .max(MAX_REMIX_VARIANTS),
});

/**
 * Fan-out variant generator. N AI calls run in parallel; each successful
 * variant becomes its own image artifact + `ai_edits` row. The user picks
 * which to keep via `keepRemixSelections`; unchosen variants are deleted
 * and their quota slots restored.
 *
 * Counts as N quota invocations regardless of how many the user keeps —
 * each call hits Gemini and costs us money. Failed variants are an
 * exception: their `ai_edits` rows are stamped 'failed' which excludes
 * them from the quota counter.
 */
export async function remixImageArtifact(
  _prev: RemixImageState,
  formData: FormData,
): Promise<RemixImageState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const parsed = RemixSchema.safeParse({
    boardId: formData.get("boardId"),
    artifactId: formData.get("artifactId"),
    prompt: formData.get("prompt"),
    variants: formData.get("variants"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      code: "validation",
      message: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }
  const { boardId, artifactId, prompt, variants } = parsed.data;
  const model = pickModel(formData.get("model"));

  let refInputs: RefInput[];
  try {
    refInputs = validateRefInputs(formData.get("references"));
  } catch (e) {
    return {
      status: "error",
      code: "validation",
      message: e instanceof Error ? e.message : "Invalid references.",
    };
  }

  const supabase = await createClient();

  const { data: membership } = await supabase
    .from("board_members")
    .select("role")
    .eq("board_id", boardId)
    .eq("user_id", user.sub)
    .maybeSingle();
  if (!membership || (membership.role !== "editor" && membership.role !== "owner")) {
    return {
      status: "error",
      code: "auth",
      message: "Only board editors can run AI remixes.",
    };
  }

  const { data: parent } = await supabase
    .from("artifacts")
    .select("id, board_id, kind, storage_path, storage_backend, metadata")
    .eq("id", artifactId)
    .maybeSingle();
  if (!parent) {
    return { status: "error", code: "not-found", message: "Image not found." };
  }
  if (parent.board_id !== boardId) {
    return {
      status: "error",
      code: "not-found",
      message: "Artifact does not belong to this board.",
    };
  }
  if (parent.kind !== "image" || !hasArtifactBytes(parent)) {
    return {
      status: "error",
      code: "wrong-kind",
      message: "Remix only works on image artifacts.",
    };
  }

  // Quota gate. A remix of N counts as N invocations, so we need at least
  // N free slots in the rolling window.
  const exempt = isSuperadminEmail(
    typeof user.email === "string" ? user.email : null,
  );
  const limit = getAiInvocationLimit();
  let remaining: number | null = null;
  if (!exempt) {
    const { count, error: countError } = await supabase
      .from("ai_edits")
      .select("id", { count: "exact", head: true })
      .eq("created_by", user.sub)
      .in("status", ["pending", "succeeded"])
      .gte("created_at", startOfAiWindow());
    if (countError) {
      return {
        status: "error",
        code: "model",
        message: `Couldn't check AI quota: ${countError.message}`,
      };
    }
    const used = count ?? 0;
    if (used + variants > limit) {
      return {
        status: "error",
        code: "quota",
        message: `A remix of ${variants} would exceed your weekly limit (${limit}). ${Math.max(0, limit - used)} left this week.`,
      };
    }
    remaining = limit - used - variants;
  }

  // Download the source once, share across all parallel calls.
  const loaded = await loadArtifactBytes(supabase, parent);
  if ("error" in loaded) {
    return { status: "error", code: "storage", message: loaded.error };
  }
  const sourceBytes = loaded.bytes;
  const sourceMime = loaded.mime;

  // Resolve reference images once for the whole batch.
  let referenceImages: Awaited<ReturnType<typeof resolveReferences>> = [];
  const refMetadata = buildRefMetadata(refInputs);
  if (refInputs.length > 0) {
    try {
      referenceImages = await resolveReferences(
        supabase,
        user.sub,
        boardId,
        refInputs,
      );
    } catch (e) {
      return {
        status: "error",
        code: "validation",
        message: e instanceof Error ? e.message : "Invalid references.",
      };
    }
  }
  const refMetadataField = refMetadata.length > 0 ? { refs: refMetadata } : {};

  // Pre-insert N pending ai_edits rows so concurrent quota checks see the
  // commitment immediately. Stamp metadata.refs on each so a partner
  // subscribed to ai_edits realtime sees the inputs even before the
  // model finishes.
  const pendingRows = Array.from({ length: variants }, (_unused, i) => ({
    parent_artifact_id: parent.id,
    prompt,
    model,
    variant_index: i,
    status: "pending",
    metadata: refMetadataField,
  }));
  const { data: editRows, error: editsError } = await supabase
    .from("ai_edits")
    .insert(pendingRows)
    .select("id, variant_index");
  if (editsError || !editRows) {
    return {
      status: "error",
      code: "model",
      message: editsError?.message ?? "Couldn't log AI remix.",
    };
  }
  const editIdByVariant = new Map<number, string>();
  for (const row of editRows) editIdByVariant.set(row.variant_index, row.id);

  // Run the model.
  const editor = getEditor(model);
  type ModelResults = Awaited<ReturnType<typeof editor.edit>>;
  let modelResults: ModelResults = [];
  try {
    modelResults = await editor.edit({
      source: { kind: "bytes", mimeType: sourceMime, bytes: sourceBytes },
      prompt,
      variants,
      references: referenceImages,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "AI remix failed.";
    // Whole-batch failure: mark every pending row as failed so quota is
    // restored and we don't leave dangling pending entries.
    await supabase
      .from("ai_edits")
      .update({ status: "failed", error: message })
      .in("id", [...editIdByVariant.values()]);
    return { status: "error", code: "model", message };
  }

  const succeededVariantIndices = new Set(
    modelResults.map((r) => r.variantIndex),
  );

  // Mark variants that didn't come back as failed (partial-failure path).
  const failedEditIds = [...editIdByVariant.entries()]
    .filter(([idx]) => !succeededVariantIndices.has(idx))
    .map(([, id]) => id);
  if (failedEditIds.length > 0) {
    await supabase
      .from("ai_edits")
      .update({ status: "failed", error: "no image returned" })
      .in("id", failedEditIds);
  }

  // For each succeeded variant: upload, insert artifact, link, sign URL.
  const variantOutputs: RemixVariant[] = [];
  // Inherit parent categories — query once, reuse for every child.
  const { data: parentCategoryRows } = await supabase
    .from("artifact_categories")
    .select("category_id")
    .eq("artifact_id", parent.id);
  const parentCategoryIds = (parentCategoryRows ?? []).map(
    (r) => r.category_id as string,
  );

  const admin = createAdminClient();

  for (const result of modelResults) {
    const editId = editIdByVariant.get(result.variantIndex);
    if (!editId) continue;
    const legacyExt = OUTPUT_EXT_BY_MIME[result.image.mimeType.toLowerCase()] ?? "png";

    if (result.image.bytes.length > MAX_OUTPUT_BYTES) {
      await supabase
        .from("ai_edits")
        .update({ status: "failed", error: "output exceeded 10MB cap" })
        .eq("id", editId);
      continue;
    }

    let insertPayload: {
      storage_path: string | null;
      storage_backend: "supabase" | "r2";
      content_hash: string | null;
      metadata: Record<string, unknown>;
    };
    let previewUrl: string | null = null;
    let cleanupLegacyPath: string | null = null;
    let cleanupR2Keys: string[] = [];

    const baseMetadata = {
      ai_edit_of: parent.id,
      prompt,
      model,
      variant_index: result.variantIndex,
      remix_size: variants,
      ...(refMetadata.length > 0 ? { refs: refMetadata } : {}),
    };

    if (r2WritesEnabled()) {
      let encoded;
      try {
        encoded = await encodeServerVariants({
          bytes: result.image.bytes,
          sourceMime: result.image.mimeType,
        });
      } catch (e) {
        await supabase
          .from("ai_edits")
          .update({
            status: "failed",
            error: e instanceof Error ? e.message : "resize failed",
          })
          .eq("id", editId);
        continue;
      }
      try {
        const uploaded = await uploadAiVariantsDeduped({
          contentHash: encoded.contentHash,
          thumb: encoded.thumb,
          display: encoded.display,
          original: encoded.original,
        });
        cleanupR2Keys = uploaded.uploadedKeys;
        insertPayload = {
          storage_path: null,
          storage_backend: "r2",
          content_hash: encoded.contentHash,
          metadata: {
            ...baseMetadata,
            width: encoded.width,
            height: encoded.height,
            variants: uploaded.variants,
          },
        };
        previewUrl = storage.publicUrl(uploaded.variants.display.key);
      } catch (e) {
        await supabase
          .from("ai_edits")
          .update({
            status: "failed",
            error: e instanceof Error ? e.message : "R2 upload failed",
          })
          .eq("id", editId);
        continue;
      }
    } else {
      const outputPath = `boards/${boardId}/${crypto.randomUUID()}.${legacyExt}`;
      const { error: uploadError } = await supabase.storage
        .from("artifacts")
        .upload(outputPath, result.image.bytes, {
          contentType: result.image.mimeType,
          upsert: false,
        });
      if (uploadError) {
        await supabase
          .from("ai_edits")
          .update({ status: "failed", error: uploadError.message })
          .eq("id", editId);
        continue;
      }
      cleanupLegacyPath = outputPath;
      insertPayload = {
        storage_path: outputPath,
        storage_backend: "supabase",
        content_hash: null,
        metadata: baseMetadata,
      };
    }

    const { data: childArtifact, error: childError } = await supabase
      .from("artifacts")
      .insert({
        board_id: boardId,
        kind: "image",
        storage_path: insertPayload.storage_path,
        storage_backend: insertPayload.storage_backend,
        content_hash: insertPayload.content_hash,
        body: prompt,
        metadata: insertPayload.metadata,
      })
      .select("id")
      .single();
    if (childError || !childArtifact) {
      if (cleanupLegacyPath) {
        await supabase.storage.from("artifacts").remove([cleanupLegacyPath]);
      }
      if (cleanupR2Keys.length > 0) {
        await storage.remove(cleanupR2Keys).catch(() => undefined);
      }
      await supabase
        .from("ai_edits")
        .update({
          status: "failed",
          error: childError?.message ?? "insert failed",
        })
        .eq("id", editId);
      continue;
    }
    const childId = childArtifact.id as string;

    if (parentCategoryIds.length > 0) {
      await supabase.from("artifact_categories").insert(
        parentCategoryIds.map((cid) => ({
          artifact_id: childId,
          category_id: cid,
        })),
      );
    }

    await supabase
      .from("ai_edits")
      .update({
        status: "succeeded",
        output_artifact_id: childId,
        cost_cents: result.costCents,
      })
      .eq("id", editId);

    let signedUrl: string | null = previewUrl;
    if (!signedUrl && insertPayload.storage_path) {
      const { data: signed } = await admin.storage
        .from("artifacts")
        .createSignedUrl(insertPayload.storage_path, 3600);
      if (signed?.signedUrl) signedUrl = signed.signedUrl;
    }

    variantOutputs.push({
      outputArtifactId: childId,
      signedUrl,
      variantIndex: result.variantIndex,
    });
  }

  if (variantOutputs.length === 0) {
    // Surface the actual per-variant error rows so we can debug instead
    // of just showing "try a different prompt". The most common path now
    // is FLUX_API_KEY missing or BFL endpoint mismatches.
    const ids = [...editIdByVariant.values()];
    const { data: failedRows } = await supabase
      .from("ai_edits")
      .select("error")
      .in("id", ids)
      .eq("status", "failed")
      .limit(1);
    const detail = failedRows?.[0]?.error;
    return {
      status: "error",
      code: "model",
      message: detail
        ? `All variants failed — first error: ${detail}`
        : "All variants failed — try a different prompt or fewer variants.",
    };
  }

  revalidatePath(`/boards/${boardId}`);
  return {
    status: "done",
    results: variantOutputs,
    requested: variants,
    failed: variants - variantOutputs.length,
    prompt,
    remaining,
    boardId,
  };
}

// ---------------------------------------------------------------------------
// Keep / discard remix selections
// ---------------------------------------------------------------------------

const KeepSchema = z.object({
  boardId: z.string().uuid(),
  keepArtifactIds: z.array(z.string().uuid()),
  discardArtifactIds: z.array(z.string().uuid()),
});

/**
 * Bulk version of `discardAiEdit` used by the remix gallery's "Keep selected"
 * action. Anything in `discardArtifactIds` is removed (artifact + ai_edits
 * row + storage object), restoring the user's quota for those slots.
 */
export async function keepRemixSelections(input: {
  boardId: string;
  keepArtifactIds: string[];
  discardArtifactIds: string[];
}): Promise<
  | { ok: true; kept: number; discarded: number }
  | { error: string }
> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const parsed = KeepSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { boardId, discardArtifactIds, keepArtifactIds } = parsed.data;

  const supabase = await createClient();

  if (discardArtifactIds.length > 0) {
    const { data: rows } = await supabase
      .from("artifacts")
      .select("id, board_id, storage_path")
      .in("id", discardArtifactIds);
    const safeRows = (rows ?? []).filter((r) => r.board_id === boardId);

    // Drop ai_edits rows first to restore quota.
    await supabase
      .from("ai_edits")
      .delete()
      .in(
        "output_artifact_id",
        safeRows.map((r) => r.id),
      );

    await supabase
      .from("artifacts")
      .delete()
      .in(
        "id",
        safeRows.map((r) => r.id),
      );

    const paths = safeRows
      .map((r) => r.storage_path)
      .filter((p): p is string => !!p);
    if (paths.length > 0) {
      await supabase.storage.from("artifacts").remove(paths);
    }
  }

  revalidatePath(`/boards/${boardId}`);
  return {
    ok: true,
    kept: keepArtifactIds.length,
    discarded: discardArtifactIds.length,
  };
}

// ---------------------------------------------------------------------------
// Backend-aware artifact byte loader (shared by edit + remix input paths)
// ---------------------------------------------------------------------------

type ArtifactByteRow = {
  storage_backend: string | null;
  storage_path: string | null;
  metadata: unknown;
};

function hasArtifactBytes(row: ArtifactByteRow): boolean {
  if ((row.storage_backend ?? "supabase") === "r2") {
    const variants = (row.metadata as { variants?: Record<string, { key?: string }> } | null)?.variants;
    return Boolean(variants?.original?.key);
  }
  return Boolean(row.storage_path);
}

async function loadArtifactBytes(
  supabase: Awaited<ReturnType<typeof createClient>>,
  row: ArtifactByteRow,
): Promise<{ bytes: Uint8Array; mime: string } | { error: string }> {
  const backend = row.storage_backend ?? "supabase";
  if (backend === "r2") {
    const variants = (row.metadata as { variants?: Record<string, { key?: string; ext?: string }> } | null)?.variants;
    const orig = variants?.original;
    if (!orig?.key) return { error: "R2 artifact has no original variant key." };
    const obj = await storage.get(orig.key);
    if (!obj) return { error: "Source image is missing in R2." };
    return {
      bytes: new Uint8Array(obj.bytes),
      mime: obj.contentType || mimeFromExt(orig.ext),
    };
  }
  if (!row.storage_path) {
    return { error: "Artifact has no storage path." };
  }
  const { data, error } = await supabase.storage
    .from("artifacts")
    .download(row.storage_path);
  if (error || !data) {
    return { error: error?.message ?? "Couldn't read source image." };
  }
  return {
    bytes: new Uint8Array(await data.arrayBuffer()),
    mime: data.type || "image/jpeg",
  };
}

function mimeFromExt(ext: string | undefined): string {
  switch ((ext ?? "").toLowerCase()) {
    case "avif":
      return "image/avif";
    case "webp":
      return "image/webp";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    default:
      return "application/octet-stream";
  }
}

// ---------------------------------------------------------------------------
// R2 variant upload helper (shared by edit + remix output paths)
// ---------------------------------------------------------------------------

type VariantUploadInput = { blob: Blob; ext: ImageExt };

async function uploadAiVariantsDeduped(input: {
  contentHash: string;
  thumb: VariantUploadInput;
  display: VariantUploadInput;
  original: VariantUploadInput;
}): Promise<{
  variants: Record<Variant, { key: string; ext: ImageExt }>;
  uploadedKeys: string[];
}> {
  const uploaded: string[] = [];
  const put = async (v: Variant, vi: VariantUploadInput) => {
    if (await storage.has(input.contentHash, v, vi.ext)) {
      return { key: buildKey(input.contentHash, v, vi.ext), ext: vi.ext };
    }
    const ref = await storage.putOne(input.contentHash, v, vi.blob, vi.ext);
    uploaded.push(ref.key);
    return ref;
  };
  const [thumb, display, original] = await Promise.all([
    put("thumb", input.thumb),
    put("display", input.display),
    put("original", input.original),
  ]);
  return { variants: { thumb, display, original }, uploadedKeys: uploaded };
}
