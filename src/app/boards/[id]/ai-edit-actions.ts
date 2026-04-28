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
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const MAX_PROMPT_LEN = 1000;
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

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
    .select("id, board_id, kind, storage_path")
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
  if (parent.kind !== "image" || !parent.storage_path) {
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

  // Download the source image bytes from Storage.
  const { data: sourceBlob, error: dlError } = await supabase.storage
    .from("artifacts")
    .download(parent.storage_path);
  if (dlError || !sourceBlob) {
    return {
      status: "error",
      code: "storage",
      message: dlError?.message ?? "Couldn't read source image.",
    };
  }
  const sourceBytes = new Uint8Array(await sourceBlob.arrayBuffer());
  const sourceMime = sourceBlob.type || "image/jpeg";

  // Insert the pending ai_edits row first so the quota counter sees this
  // invocation if a sibling tab also tries to fire one.
  const { data: editRow, error: editInsertError } = await supabase
    .from("ai_edits")
    .insert({
      parent_artifact_id: parent.id,
      prompt,
      model: DEFAULT_MODEL,
      variant_index: 0,
      status: "pending",
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
    const editor = getEditor(DEFAULT_MODEL);
    const [result] = await editor.edit({
      source: { kind: "bytes", mimeType: sourceMime, bytes: sourceBytes },
      prompt,
      variants: 1,
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

  const ext = OUTPUT_EXT_BY_MIME[outputMime.toLowerCase()] ?? "png";
  const outputPath = `boards/${boardId}/${crypto.randomUUID()}.${ext}`;

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

  const { data: childArtifact, error: childError } = await supabase
    .from("artifacts")
    .insert({
      board_id: boardId,
      kind: "image",
      storage_path: outputPath,
      body: prompt,
      metadata: {
        ai_edit_of: parent.id,
        prompt,
        model: DEFAULT_MODEL,
      },
    })
    .select("id")
    .single();
  if (childError || !childArtifact) {
    await supabase.storage.from("artifacts").remove([outputPath]);
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

  // Sign a one-hour URL for the review dialog so the client can show the
  // result without waiting for the next page-render to refresh signed URLs.
  let signedUrl: string | null = null;
  const { data: signed } = await supabase.storage
    .from("artifacts")
    .createSignedUrl(outputPath, 3600);
  if (signed?.signedUrl) signedUrl = signed.signedUrl;

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
