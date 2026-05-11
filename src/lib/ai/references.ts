import { z } from "zod";

import type { createClient } from "@/lib/supabase/server";

import type { ReferenceImage, ReferenceRole } from "./types";

/**
 * Server-side helpers for the reference-image inputs to AI edits/remixes.
 *
 * Wire shape coming from the client:
 *   { source: 'artifact'; artifactId: uuid; role?; index }
 *   { source: 'upload';   path: string;    role?; index }
 *
 * We:
 *   1. Validate the shape + cap at 3 + dedupe slots (`validateRefInputs`)
 *   2. Resolve each input to actual bytes the editor can hand the model
 *      (`resolveReferences`) — RLS via the user's Supabase client gates
 *      access to artifact storage paths and to other users' upload prefixes
 *   3. Persist a compact provenance record onto `ai_edits.metadata.refs`
 *      via `buildRefMetadata` so a future re-run can recover the inputs
 */

export const MAX_REFERENCES = 3;

const REFERENCE_ROLES = [
  "style",
  "color",
  "materials",
  "scale",
  "placement",
  "other",
] as const satisfies readonly ReferenceRole[];

const RoleSchema = z.enum(REFERENCE_ROLES);

const ArtifactRefSchema = z.object({
  source: z.literal("artifact"),
  artifactId: z.string().uuid(),
  role: RoleSchema.optional(),
  index: z.number().int().min(1).max(MAX_REFERENCES),
});

const UploadRefSchema = z.object({
  source: z.literal("upload"),
  // Path like "ref_uploads/<user_id>/<uuid>.<ext>". We re-validate the
  // user_id segment against the caller in resolveReferences.
  path: z
    .string()
    .min(1)
    .max(512)
    .regex(/^ref_uploads\/[0-9a-f-]{36}\/[A-Za-z0-9._-]+$/),
  role: RoleSchema.optional(),
  index: z.number().int().min(1).max(MAX_REFERENCES),
});

export const RefInputSchema = z.discriminatedUnion("source", [
  ArtifactRefSchema,
  UploadRefSchema,
]);

export type RefInput = z.infer<typeof RefInputSchema>;

export const RefInputArraySchema = z
  .array(RefInputSchema)
  .max(MAX_REFERENCES)
  .superRefine((arr, ctx) => {
    const seen = new Set<number>();
    for (let i = 0; i < arr.length; i++) {
      if (seen.has(arr[i].index)) {
        ctx.addIssue({
          code: "custom",
          message: `Duplicate reference slot ${arr[i].index}`,
          path: [i, "index"],
        });
      }
      seen.add(arr[i].index);
    }
  });

/**
 * Parse + validate the JSON payload coming from the AI edit form. Throws a
 * caller-friendly Error on invalid input so the action layer can convert it
 * to the existing `validation` error shape.
 */
export function validateRefInputs(raw: unknown): RefInput[] {
  if (raw == null || raw === "") return [];
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("references field is not valid JSON");
    }
  }
  const result = RefInputArraySchema.safeParse(parsed);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new Error(first?.message ?? "Invalid references payload");
  }
  return result.data;
}

export type RefMetadataEntry = {
  source: "artifact" | "upload";
  /** artifactId for artifact refs, storage path for upload refs */
  id_or_path: string;
  role?: ReferenceRole;
  index: number;
};

/** The shape we persist on `ai_edits.metadata.refs` for provenance. */
export function buildRefMetadata(refs: RefInput[]): RefMetadataEntry[] {
  return refs.map((r) => ({
    source: r.source,
    id_or_path: r.source === "artifact" ? r.artifactId : r.path,
    role: r.role,
    index: r.index,
  }));
}

const STORAGE_BUCKET = "artifacts";
const MAX_REF_BYTES = 4 * 1024 * 1024; // hard cap server-side; client should resize first

/**
 * Resolve each ref input into concrete bytes the editor can pass to the
 * model. Uses the caller's Supabase client (RLS-gated) so that:
 *   - artifact refs only resolve when the caller is a board member
 *   - upload refs only resolve when the path is under the caller's prefix
 *
 * Throws on the first unresolvable ref so the caller surfaces a single
 * clear error rather than silently dropping a slot.
 */
export async function resolveReferences(
  supabase: Awaited<ReturnType<typeof createClient>>,
  callerUserId: string,
  boardId: string,
  refs: RefInput[],
): Promise<ReferenceImage[]> {
  if (refs.length === 0) return [];

  const out: ReferenceImage[] = [];
  for (const ref of refs) {
    const path = await resolveRefPath(supabase, callerUserId, boardId, ref);
    const { data: blob, error: dlError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .download(path);
    if (dlError || !blob) {
      throw new Error(
        `Couldn't read reference ${ref.index}: ${dlError?.message ?? "not found"}`,
      );
    }
    const buf = await blob.arrayBuffer();
    if (buf.byteLength > MAX_REF_BYTES) {
      throw new Error(
        `Reference ${ref.index} is larger than ${Math.round(MAX_REF_BYTES / 1024 / 1024)} MB.`,
      );
    }
    out.push({
      source: {
        kind: "bytes",
        mimeType: blob.type || "image/jpeg",
        bytes: new Uint8Array(buf),
      },
      role: ref.role,
      index: ref.index,
    });
  }
  return out;
}

async function resolveRefPath(
  supabase: Awaited<ReturnType<typeof createClient>>,
  callerUserId: string,
  boardId: string,
  ref: RefInput,
): Promise<string> {
  if (ref.source === "artifact") {
    const { data: row, error } = await supabase
      .from("artifacts")
      .select("id, board_id, kind, storage_path")
      .eq("id", ref.artifactId)
      .maybeSingle();
    if (error || !row) {
      throw new Error(`Reference ${ref.index} artifact not found`);
    }
    if (row.board_id !== boardId) {
      throw new Error(`Reference ${ref.index} is on a different board`);
    }
    if (row.kind !== "image" || !row.storage_path) {
      throw new Error(`Reference ${ref.index} is not an image artifact`);
    }
    return row.storage_path as string;
  }

  // upload — the regex already enforced the shape; double-check the user
  // segment matches the caller so a stolen path can't be borrowed.
  const segments = ref.path.split("/");
  if (segments.length < 3 || segments[1] !== callerUserId) {
    throw new Error(`Reference ${ref.index} is not your upload`);
  }
  return ref.path;
}
