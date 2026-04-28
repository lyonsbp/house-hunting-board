import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  ListBox,
  ListBoxItem,
} from "@heroui/react";

import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

import { CreateBoardForm } from "./create-board-form";

export default async function HomePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const { data: boards, error } = await supabase
    .from("boards")
    .select("id, name, created_at")
    .order("created_at", { ascending: false });

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Card>
        <CardHeader>
          <h1 className="text-xl font-semibold">Your boards</h1>
        </CardHeader>
        <CardContent>
          {error ? (
            <p className="text-sm text-red-600">
              Failed to load boards: {error.message}
            </p>
          ) : boards && boards.length > 0 ? (
            <ListBox aria-label="Your boards">
              {boards.map((board) => (
                <ListBoxItem key={board.id} href={`/boards/${board.id}`}>
                  {board.name}
                </ListBoxItem>
              ))}
            </ListBox>
          ) : (
            <p className="text-sm opacity-60">
              No boards yet. Create one below.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <CreateBoardForm />
        </CardContent>
      </Card>

      <p className="text-center text-[11px] uppercase tracking-[0.18em] text-stone-500">
        <Link href="/analytics" className="hover:text-stone-900">
          Feature analytics →
        </Link>
      </p>
    </main>
  );
}

