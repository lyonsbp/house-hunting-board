"use server";

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

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("boards")
    .insert({ name: parsed.data.name, created_by: user.sub })
    .select("id")
    .single();

  if (error || !data) {
    return {
      status: "error",
      message: error?.message ?? "Failed to create board.",
    };
  }

  revalidatePath("/");
  redirect(`/boards/${data.id}`);
}
