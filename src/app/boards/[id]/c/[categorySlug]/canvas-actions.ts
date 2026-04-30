"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getCurrentUser } from "@/lib/auth";
import {
  CANVAS_CARD_H,
  CANVAS_CARD_W,
  CANVAS_GAP,
} from "@/lib/board-data-shared";
import { createClient } from "@/lib/supabase/server";

const CANVAS_COLS = 4;

const SetCardPositionSchema = z.object({
  boardId: z.string().uuid(),
  categoryId: z.string().uuid(),
  artifactId: z.string().uuid(),
  x: z.number().finite(),
  y: z.number().finite(),
});

/**
 * Persist a card's canvas position. RLS on `artifact_categories`
 * already gates this to board members via the parent artifact's
 * `is_board_member()`; we still validate inputs and call
 * `revalidatePath` so the partner's RSC tree refreshes via Realtime.
 *
 * Note: positions are stored on the `(artifact_id, category_id)` row,
 * so the same artifact pinned to two categories has independent
 * positions in each. Uncategorized is intentionally unsupported —
 * there's no `artifact_categories` row to attach a position to.
 */
export async function setCardPosition(input: {
  boardId: string;
  categoryId: string;
  artifactId: string;
  x: number;
  y: number;
}): Promise<{ ok: true } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const parsed = SetCardPositionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("artifact_categories")
    .update({ canvas_x: parsed.data.x, canvas_y: parsed.data.y })
    .eq("artifact_id", parsed.data.artifactId)
    .eq("category_id", parsed.data.categoryId);

  if (error) return { error: error.message };

  // Path revalidation is keyed by /boards/[id]/c/[slug] but we don't
  // know the slug at action call time. revalidating the board root
  // covers both the dashboard tile counts and the drill-down via Next's
  // tag-based caching (RSC trees re-render on the next request).
  revalidatePath(`/boards/${parsed.data.boardId}`);

  return { ok: true };
}

const ResetCanvasLayoutSchema = z.object({
  boardId: z.string().uuid(),
  categoryId: z.string().uuid(),
});

/**
 * Re-aligns every card in a category to a tidy 4-wide grid based on
 * `sort_order`. Overwrites any user-positioned cards — this is the
 * "I made a mess of the canvas, start over" button.
 *
 * Uses the same coordinate constants as the lazy seeder so a reset
 * lands cards in the same positions a fresh visit would seed them.
 */
export async function resetCanvasLayout(input: {
  boardId: string;
  categoryId: string;
}): Promise<
  { ok: true; positions: Record<string, { x: number; y: number }> }
  | { error: string }
> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const parsed = ResetCanvasLayoutSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }

  const supabase = await createClient();
  const { data: rows, error: fetchErr } = await supabase
    .from("artifact_categories")
    .select("artifact_id, sort_order, artifacts!inner(board_id)")
    .eq("category_id", parsed.data.categoryId)
    .eq("artifacts.board_id", parsed.data.boardId)
    .order("sort_order", { ascending: true });

  if (fetchErr) return { error: fetchErr.message };

  const ordered = [...(rows ?? [])].sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
  );

  const positions: Record<string, { x: number; y: number }> = {};
  const updates = ordered.map((r, i) => {
    const col = i % CANVAS_COLS;
    const row = Math.floor(i / CANVAS_COLS);
    const x = col * (CANVAS_CARD_W + CANVAS_GAP);
    const y = row * (CANVAS_CARD_H + CANVAS_GAP);
    positions[r.artifact_id] = { x, y };
    return { artifactId: r.artifact_id, x, y };
  });

  const results = await Promise.all(
    updates.map((u) =>
      supabase
        .from("artifact_categories")
        .update({ canvas_x: u.x, canvas_y: u.y })
        .eq("artifact_id", u.artifactId)
        .eq("category_id", parsed.data.categoryId),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) return { error: failed.error.message };

  revalidatePath(`/boards/${parsed.data.boardId}`);
  return { ok: true, positions };
}
