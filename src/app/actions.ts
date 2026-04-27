"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const CreateBoardSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
});

export type CreateBoardState =
  | { status: "idle" }
  | { status: "error"; message: string };

export async function createBoard(
  _prev: CreateBoardState,
  formData: FormData,
): Promise<CreateBoardState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const parsed = CreateBoardSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  // Generate the id client-side so we can skip RETURNING. Postgres applies
  // the SELECT policy to the RETURNING row, and at that moment the AFTER
  // INSERT trigger's membership row isn't visible to the RLS check — so
  // RETURNING raises a (misleading) RLS error. Without RETURNING the
  // INSERT just runs the WITH CHECK (true) policy and succeeds.
  const id = randomUUID();
  const supabase = await createClient();
  const { error } = await supabase
    .from("boards")
    .insert({ id, name: parsed.data.name });

  if (error) {
    return { status: "error", message: error.message };
  }

  revalidatePath("/");
  redirect(`/boards/${id}`);
}
