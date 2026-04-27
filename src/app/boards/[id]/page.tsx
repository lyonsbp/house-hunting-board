import { notFound, redirect } from "next/navigation";
import { Card, CardContent } from "@heroui/react";

import { getCurrentUser } from "@/lib/auth";
import { toArtifact, type ArtifactRow } from "@/lib/artifacts";
import { createClient } from "@/lib/supabase/server";

import { AddArtifact } from "./add-artifact";
import { BoardCanvas } from "./board-canvas";
import { CategoriesSection } from "./categories-section";
import { PasteImageListener } from "./paste-image-listener";

const SERIF =
  '"Cochin", "Hoefler Text", "Iowan Old Style", "Palatino Linotype", Georgia, serif';

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

  const [{ data: categoriesData }, { data: artifactRows }] = await Promise.all([
    supabase
      .from("categories")
      .select("id, name")
      .eq("board_id", id)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("artifacts")
      .select(
        "id, board_id, kind, storage_path, url, body, metadata, created_at",
      )
      .eq("board_id", id)
      .order("created_at", { ascending: false }),
  ]);

  const artifacts = (artifactRows ?? []).map((row) =>
    toArtifact(row as ArtifactRow),
  );

  // Pre-sign image URLs server-side so the client never sees raw paths.
  const imagePaths = artifacts
    .filter((a): a is Extract<typeof a, { kind: "image" }> => a.kind === "image")
    .map((a) => a.storagePath)
    .filter(Boolean);

  const signedImageUrls: Record<string, string> = {};
  if (imagePaths.length > 0) {
    const { data: signed } = await supabase.storage
      .from("artifacts")
      .createSignedUrls(imagePaths, 3600);
    for (const item of signed ?? []) {
      if (item.path && item.signedUrl) {
        signedImageUrls[item.path] = item.signedUrl;
      }
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 py-10">
      <header className="flex flex-col gap-1">
        <p
          className="text-[10px] uppercase tracking-[0.22em] text-amber-700/80"
          style={{ letterSpacing: "0.22em" }}
        >
          Board
        </p>
        <h1
          style={{ fontFamily: SERIF }}
          className="text-4xl font-normal leading-tight text-stone-900"
        >
          {board.name}
        </h1>
      </header>

      <Card>
        <CardContent>
          <CategoriesSection
            boardId={board.id}
            categories={categoriesData ?? []}
          />
        </CardContent>
      </Card>

      <section className="space-y-6">
        <AddArtifact boardId={board.id} />
        <BoardCanvas
          boardId={board.id}
          artifacts={artifacts}
          signedImageUrls={signedImageUrls}
        />
      </section>

      <PasteImageListener boardId={board.id} />
    </main>
  );
}
