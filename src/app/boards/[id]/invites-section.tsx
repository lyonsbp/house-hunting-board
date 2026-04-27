"use client";

import { useActionState, useEffect, useRef } from "react";
import { Button } from "@heroui/react";

import { inviteMember, type InviteState } from "./actions";

const initialState: InviteState = { status: "idle" };

const inputCls =
  "w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:border-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-200";

export type Member = {
  user_id: string;
  role: string;
  email?: string | null;
};

export function InvitesSection({
  boardId,
  members,
  currentUserId,
}: {
  boardId: string;
  members: Member[];
  currentUserId: string;
}) {
  const [state, action, pending] = useActionState(inviteMember, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (
      (state.status === "sent" || state.status === "added") &&
      !pending
    ) {
      formRef.current?.reset();
    }
  }, [state, pending]);

  return (
    <div className="flex flex-col gap-5">
      <h3 className="text-sm font-semibold uppercase tracking-wide opacity-60">
        Members
      </h3>

      {members.length > 0 && (
        <ul className="divide-y divide-stone-100 overflow-hidden rounded-lg border border-stone-200">
          {members.map((m) => {
            const isYou = m.user_id === currentUserId;
            return (
              <li
                key={m.user_id}
                className="flex items-center justify-between gap-4 bg-white px-4 py-2.5"
              >
                <span className="truncate text-sm text-stone-800">
                  {m.email ?? `User ${m.user_id.slice(0, 8)}…`}
                  {isYou && (
                    <span className="ml-2 text-xs italic text-stone-400">
                      (you)
                    </span>
                  )}
                </span>
                <span
                  className="text-[10px] uppercase tracking-[0.18em] text-amber-700/80"
                  style={{ letterSpacing: "0.18em" }}
                >
                  {m.role}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <form
        ref={formRef}
        action={action}
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
      >
        <input type="hidden" name="boardId" value={boardId} />
        <div className="flex-1">
          <label
            htmlFor="invite-email"
            className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-stone-500"
            style={{ letterSpacing: "0.18em" }}
          >
            Invite by email
          </label>
          <input
            id="invite-email"
            name="email"
            type="email"
            placeholder="someone@example.com"
            required
            className={inputCls}
          />
        </div>
        <div className="sm:w-32">
          <label
            htmlFor="invite-role"
            className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-stone-500"
            style={{ letterSpacing: "0.18em" }}
          >
            Role
          </label>
          <select
            id="invite-role"
            name="role"
            defaultValue="editor"
            className={inputCls}
          >
            <option value="editor">Editor</option>
            <option value="viewer">Viewer</option>
          </select>
        </div>
        <Button type="submit" variant="primary" isDisabled={pending}>
          {pending ? "Sending…" : "Invite"}
        </Button>
      </form>

      {state.status === "sent" && (
        <p className="text-sm text-emerald-700">
          Invitation email sent to {state.email}.
        </p>
      )}
      {state.status === "added" && (
        <p className="text-sm text-emerald-700">
          {state.email} already had an account — they were added to this board.
          They&rsquo;ll see it next time they sign in.
        </p>
      )}
      {state.status === "error" && (
        <p className="text-sm text-red-700">{state.message}</p>
      )}
    </div>
  );
}
