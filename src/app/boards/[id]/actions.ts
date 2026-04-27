"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getCurrentUser } from "@/lib/auth";
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
