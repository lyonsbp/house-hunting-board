import { notFound, redirect } from "next/navigation";
import { Card, CardContent, CardHeader } from "@heroui/react";

import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

import { CategoriesSection } from "./categories-section";

export default async function BoardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { id } = await params;

  const supabase = await createClient();
  const { data: board } = await supabase
    .from("boards")
    .select("id, name")
    .eq("id", id)
    .maybeSingle();

  if (!board) notFound();

  const { data: categories } = await supabase
    .from("categories")
    .select("id, name")
    .eq("board_id", id)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10">
      <Card>
        <CardHeader>
          <h1 className="text-xl font-semibold">{board.name}</h1>
        </CardHeader>
        <CardContent>
          <CategoriesSection boardId={board.id} categories={categories ?? []} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="text-sm opacity-60">
          Artifacts coming in the next slice.
        </CardContent>
      </Card>
    </main>
  );
}
