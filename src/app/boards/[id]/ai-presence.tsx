"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/client";

/**
 * Realtime presence for in-progress AI edits. Per PRD §5.3a, while a
 * partner is composing an edit (prompt + ref thumbnails), the draft
 * broadcasts on the board channel so collaborators see what's being
 * attempted before it runs.
 *
 * Channel topic: `boards:{boardId}:ai-presence` — separate from the
 * existing `boards:{boardId}` channel used by `RealtimeBridge` for
 * postgres_changes, so the two concerns don't compete for one shared
 * topic.
 *
 * Lifecycle: the panel calls `useAiPresence(boardId, open)`. When
 * `open` is true, the hook subscribes + tracks. When it flips false
 * (or the component unmounts), we untrack and remove the channel.
 *
 * Track payload is debounced ~400ms so a fast typist doesn't spam
 * presence updates that all peers would re-render on.
 */

export type DraftRefThumb = {
  index: number;
  role?: string;
  /** Short-lived signed URL the broadcaster has read access to. */
  thumbUrl: string;
};

export type Draft = {
  user_id: string;
  display: string;
  artifactId: string;
  prompt: string;
  variants: number;
  refs: DraftRefThumb[];
};

const DEBOUNCE_MS = 400;

export function useAiPresence(boardId: string, open: boolean) {
  const [others, setOthers] = useState<Draft[]>([]);
  const [meId, setMeId] = useState<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const lastDraftRef = useRef<Draft | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const supabase = createClient();

    void supabase.auth.getUser().then(({ data }) => {
      if (!cancelled) setMeId(data.user?.id ?? null);
    });

    const channel = supabase.channel(`boards:${boardId}:ai-presence`, {
      config: { presence: { key: "" } },
    });
    channelRef.current = channel;

    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState<Draft>();
      const flat: Draft[] = [];
      for (const peers of Object.values(state)) {
        for (const peer of peers) flat.push(peer);
      }
      setOthers(flat);
    });

    void channel.subscribe();

    return () => {
      cancelled = true;
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      void channel.untrack();
      void supabase.removeChannel(channel);
      channelRef.current = null;
      setOthers([]);
    };
  }, [boardId, open]);

  const peers = useMemo(
    () => others.filter((d) => !meId || d.user_id !== meId),
    [others, meId],
  );

  function broadcastDraft(draft: Draft) {
    lastDraftRef.current = draft;
    const ch = channelRef.current;
    if (!ch) return;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      const latest = lastDraftRef.current;
      if (!latest) return;
      void ch.track(latest);
    }, DEBOUNCE_MS);
  }

  function clearDraft() {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    const ch = channelRef.current;
    if (ch) void ch.untrack();
  }

  return { peers, broadcastDraft, clearDraft };
}

/**
 * Compact banner shown above the ref row when other board members are
 * composing AI edits in their own panels right now.
 */
export function OtherDraftsBanner({ peers }: { peers: Draft[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  if (peers.length === 0) return null;

  return (
    <div className="rounded-md border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs text-amber-900">
      {peers.map((d) => {
        const summary = d.prompt
          ? truncate(d.prompt, 80)
          : "(no prompt yet)";
        const refCount = d.refs?.length ?? 0;
        const isOpen = expandedId === d.user_id;
        return (
          <div key={d.user_id} className="flex flex-col gap-1">
            <button
              type="button"
              onClick={() => setExpandedId(isOpen ? null : d.user_id)}
              className="flex items-baseline justify-between text-left hover:underline"
            >
              <span>
                <strong className="font-medium">{d.display}</strong> is composing
                an edit
                {d.variants > 1 ? ` · remix ${d.variants}` : ""}
                {refCount > 0
                  ? ` · ${refCount} ref${refCount === 1 ? "" : "s"}`
                  : ""}
              </span>
              <span className="ml-2 text-amber-700">{isOpen ? "▾" : "▸"}</span>
            </button>
            {isOpen && (
              <div className="flex flex-col gap-1 pl-1">
                <span className="italic text-amber-800/80">“{summary}”</span>
                {refCount > 0 && (
                  <div className="flex gap-1">
                    {d.refs.map((r) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={`${r.index}-${r.thumbUrl}`}
                        src={r.thumbUrl}
                        alt={r.role ?? `ref ${r.index}`}
                        title={r.role ?? `Reference ${r.index}`}
                        className="h-12 w-12 rounded border border-amber-300 object-cover"
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}
