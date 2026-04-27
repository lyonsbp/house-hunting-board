import { notFound, redirect } from "next/navigation";
import { Card, CardContent } from "@heroui/react";

import { getCurrentUser } from "@/lib/auth";
import { toArtifact, type ArtifactRow } from "@/lib/artifacts";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { AddArtifact } from "./add-artifact";
import { BoardCanvas } from "./board-canvas";
import { CategoriesSection } from "./categories-section";
import { InvitesSection, type Member } from "./invites-section";
import { PasteImageListener } from "./paste-image-listener";
import { RealtimeBridge } from "./realtime-bridge";

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

  const [
    { data: categoriesData },
    { data: artifactRows },
    { data: membershipRows },
    { data: artifactTagRows },
    { data: tagRows },
    { data: memberRows },
    { data: propertyLinkRows },
  ] = await Promise.all([
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
    supabase
      .from("artifact_categories")
      .select("artifact_id, category_id, sort_order, artifacts!inner(board_id)")
      .eq("artifacts.board_id", id),
    supabase
      .from("artifact_tags")
      .select("artifact_id, tag_id, artifacts!inner(board_id)")
      .eq("artifacts.board_id", id),
    supabase.from("tags").select("id, name").eq("board_id", id),
    supabase
      .from("board_members")
      .select("user_id, role")
      .eq("board_id", id),
    supabase
      .from("property_artifacts")
      .select(
        "artifact_id, artifacts!inner(board_id), properties!inner(address, city, state, source_url)",
      )
      .eq("artifacts.board_id", id),
  ]);

  const members = memberRows ?? [];
  const currentRole = members.find((m) => m.user_id === user.sub)?.role ?? null;
  const isOwner = currentRole === "owner";

  // Owner-only enrichment: pull emails for members via the admin client so
  // the invites section can show "alice@x.com — editor" rather than uuids.
  let membersWithEmail: Member[] = members.map((m) => ({
    user_id: m.user_id,
    role: m.role,
  }));
  if (isOwner && members.length > 0) {
    try {
      const admin = createAdminClient();
      const { data: usersList } = await admin.auth.admin.listUsers({
        perPage: 1000,
      });
      const memberIds = new Set(members.map((m) => m.user_id));
      const emailById = new Map(
        (usersList?.users ?? [])
          .filter((u) => memberIds.has(u.id) && !!u.email)
          .map((u) => [u.id, u.email as string]),
      );
      membersWithEmail = members.map((m) => ({
        user_id: m.user_id,
        role: m.role,
        email: emailById.get(m.user_id) ?? null,
      }));
    } catch {
      // Admin lookup failure shouldn't block the page; fall back to ids.
    }
  }

  const artifacts = (artifactRows ?? []).map((row) =>
    toArtifact(row as ArtifactRow),
  );

  // Build membership map: artifactId -> [{ categoryId, sortOrder }]
  const membershipsByArtifact: Record<
    string,
    { categoryId: string; sortOrder: number }[]
  > = {};
  for (const m of membershipRows ?? []) {
    const list = membershipsByArtifact[m.artifact_id] ?? [];
    list.push({ categoryId: m.category_id, sortOrder: m.sort_order });
    membershipsByArtifact[m.artifact_id] = list;
  }

  // Build tag map: artifactId -> [{ id, name }]
  const tagsById = new Map((tagRows ?? []).map((t) => [t.id, t.name]));
  const tagsByArtifact: Record<string, { id: string; name: string }[]> = {};
  for (const at of artifactTagRows ?? []) {
    const name = tagsById.get(at.tag_id);
    if (!name) continue;
    const list = tagsByArtifact[at.artifact_id] ?? [];
    list.push({ id: at.tag_id, name });
    tagsByArtifact[at.artifact_id] = list;
  }

  // Provenance for image artifacts that came from a listing import.
  const provenanceByArtifact: Record<
    string,
    { address: string | null; city: string | null; state: string | null; sourceUrl: string }
  > = {};
  for (const row of propertyLinkRows ?? []) {
    const propertyJoin = (row as unknown as {
      properties:
        | { address: string | null; city: string | null; state: string | null; source_url: string }
        | { address: string | null; city: string | null; state: string | null; source_url: string }[];
    }).properties;
    const property = Array.isArray(propertyJoin) ? propertyJoin[0] : propertyJoin;
    if (!property) continue;
    provenanceByArtifact[row.artifact_id] = {
      address: property.address,
      city: property.city,
      state: property.state,
      sourceUrl: property.source_url,
    };
  }

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
          categories={categoriesData ?? []}
          membershipsByArtifact={membershipsByArtifact}
          tagsByArtifact={tagsByArtifact}
          allTags={tagRows ?? []}
          provenanceByArtifact={provenanceByArtifact}
        />
      </section>

      {isOwner && (
        <Card>
          <CardContent>
            <InvitesSection
              boardId={board.id}
              members={membersWithEmail}
              currentUserId={user.sub}
            />
          </CardContent>
        </Card>
      )}

      <PasteImageListener boardId={board.id} />
      <RealtimeBridge boardId={board.id} />
    </main>
  );
}
