"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

/**
 * Subscribes to all board-scoped table changes and triggers a soft refresh
 * of the current RSC tree on every event. This is the simplest pattern that
 * keeps two collaborators on the same board in sync; richer in-place
 * diffing is a later optimization.
 *
 * `artifact_categories`, `artifact_tags`, and `comments` don't have a
 * `board_id` column to filter on at the Realtime layer — they're scoped
 * via their parent `artifact_id`. RLS gates what events the client
 * actually receives, so subscribing to the full table is safe; the worst
 * case is an unnecessary refresh from a sibling board change, which
 * never lands because RLS would have hidden it anyway.
 */
export function RealtimeBridge({ boardId }: { boardId: string }) {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    const refresh = () => router.refresh();

    const channel = supabase
      .channel(`boards:${boardId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "artifacts",
          filter: `board_id=eq.${boardId}`,
        },
        refresh,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "categories",
          filter: `board_id=eq.${boardId}`,
        },
        refresh,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tags",
          filter: `board_id=eq.${boardId}`,
        },
        refresh,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "artifact_categories" },
        refresh,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "artifact_tags" },
        refresh,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "comments" },
        refresh,
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [boardId, router]);

  return null;
}
