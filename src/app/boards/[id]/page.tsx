import { notFound, redirect } from "next/navigation";
import { Card, CardContent, CardHeader } from "@heroui/react";

import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

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

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10">
      <Card>
        <CardHeader>
          <h1 className="text-xl font-semibold">{board.name}</h1>
        </CardHeader>
        <CardContent className="text-sm opacity-60">
          Categories and artifacts coming in the next slice.
        </CardContent>
      </Card>
    </main>
  );
}
