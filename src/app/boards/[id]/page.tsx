import { notFound } from "next/navigation";
import { Card, CardContent } from "@heroui/react";

import { metroForZip } from "@/lib/analytics/metros";
import { getCurrentUser } from "@/lib/auth";
import {
  loadDashboardSummary,
  signImagePaths,
} from "@/lib/board-data";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { AddArtifact } from "./add-artifact";
import { CategoriesSection } from "./categories-section";
import { DashboardGrid } from "./dashboard-grid";
import { InvitesSection, type Member } from "./invites-section";
import { ListingsPanel, type ImportedListing } from "./listings-panel";
import { PasteImageListener } from "./paste-image-listener";
import { ReadOnlyBanner } from "./read-only-banner";
import { RealtimeBridge } from "./realtime-bridge";
import { SharingSection } from "./sharing-section";

const SERIF =
  '"Cochin", "Hoefler Text", "Iowan Old Style", "Palatino Linotype", Georgia, serif';

export default async function BoardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Anonymous viewers ARE allowed when the board is public, so we don't
  // redirect to /login here. RLS on `boards` returns null for private
  // boards anonymous users can't see, which we render as 404.
  const user = await getCurrentUser();
  const userId = user?.sub ?? null;

  const { id } = await params;

  const supabase = await createClient();
  const { data: board } = await supabase
    .from("boards")
    .select("id, name, is_public")
    .eq("id", id)
    .maybeSingle();

  if (!board) notFound();

  // Dashboard view: we only need categories + members (canEdit/owner gating
  // and email enrichment) + the listings catalog (drives the ListingsPanel).
  // We deliberately don't load full artifact rows / memberships / tags here
  // — the per-card UI lives in the drill-down route now. Tile thumbnails
  // come from `loadDashboardSummary` which makes its own bounded queries.
  const [
    { data: categoriesData },
    { data: memberRows },
    { data: propertyLinkRows },
    dashboardSummary,
  ] = await Promise.all([
    supabase
      .from("categories")
      .select("id, name")
      .eq("board_id", id)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    // board_members is gated on `is_board_member`; anonymous viewers get
    // an empty array. That's fine — they just don't see the member list.
    supabase.from("board_members").select("user_id, role").eq("board_id", id),
    supabase
      .from("property_artifacts")
      .select(
        "artifact_id, artifacts!inner(board_id), properties!inner(id, source, source_url, address, city, state, zip, list_price, sold_price, bedrooms, bathrooms, sqft, year_built, status, scraped_at)",
      )
      .eq("artifacts.board_id", id),
    loadDashboardSummary(supabase, id),
  ]);

  const members = memberRows ?? [];
  const currentRole = userId
    ? (members.find((m) => m.user_id === userId)?.role ?? null)
    : null;
  const isOwner = currentRole === "owner";
  const canEdit = currentRole === "owner" || currentRole === "editor";

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

  // Build a deduped per-board listings catalog with photo counts (drives the
  // "Listings imported" panel). Provenance + per-artifact tag/membership data
  // is no longer needed at this level — it lives in the drill-down route.
  type PropertyJoin = {
    id: string;
    source: string;
    source_url: string;
    address: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    list_price: number | null;
    sold_price: number | null;
    bedrooms: number | null;
    bathrooms: number | null;
    sqft: number | null;
    year_built: number | null;
    status: string | null;
    scraped_at: string;
  };
  const listingsById = new Map<string, ImportedListing>();
  for (const row of propertyLinkRows ?? []) {
    const propertyJoin = (row as unknown as {
      properties: PropertyJoin | PropertyJoin[];
    }).properties;
    const p = Array.isArray(propertyJoin) ? propertyJoin[0] : propertyJoin;
    if (!p) continue;
    const existing = listingsById.get(p.id);
    if (existing) {
      existing.photoCount += 1;
      continue;
    }
    listingsById.set(p.id, {
      id: p.id,
      source: p.source,
      sourceUrl: p.source_url,
      address: p.address,
      city: p.city,
      state: p.state,
      zip: p.zip,
      listPrice: p.list_price,
      soldPrice: p.sold_price,
      bedrooms: p.bedrooms,
      bathrooms: p.bathrooms,
      sqft: p.sqft,
      yearBuilt: p.year_built,
      status: p.status,
      scrapedAt: p.scraped_at,
      photoCount: 1,
      metro: metroForZip(p.zip),
    });
  }
  const listings: ImportedListing[] = [...listingsById.values()].sort(
    (a, b) => b.scrapedAt.localeCompare(a.scrapedAt),
  );

  // Pull LLM-extracted feature signals for every property surfaced on
  // this board. `feature_signals` is globally readable to authenticated
  // users; for anonymous viewers of a public board this query returns
  // an empty array, which renders as "no chips" — acceptable v1.
  if (listings.length > 0) {
    const propertyIds = listings.map((l) => l.id);
    const [{ data: signalRows }, { data: snapshotRows }] = await Promise.all([
      supabase
        .from("feature_signals")
        .select("property_id, feature, confidence")
        .in("property_id", propertyIds)
        .order("confidence", { ascending: false }),
      supabase
        .from("property_snapshots")
        .select("property_id, list_price, sold_price, status, scraped_at, source")
        .in("property_id", propertyIds)
        .order("scraped_at", { ascending: false }),
    ]);

    const featuresByProperty = new Map<string, { feature: string; confidence: number }[]>();
    for (const row of signalRows ?? []) {
      const list = featuresByProperty.get(row.property_id) ?? [];
      list.push({
        feature: row.feature,
        confidence: typeof row.confidence === "number" ? row.confidence : 0,
      });
      featuresByProperty.set(row.property_id, list);
    }

    // Pick the prior snapshot per property: the most recent snapshot
    // whose price (or status) actually differs from the listing's
    // current state. Without the "differs" filter we'd often pick a
    // listing-history event that simply mirrors today's price (e.g.
    // sold_price = current sold_price), which yields a $0 delta and
    // adds noise instead of insight.
    type Snap = {
      list_price: number | null;
      sold_price: number | null;
      status: string | null;
      scraped_at: string;
      source: string;
    };
    const snapshotsByProperty = new Map<string, Snap[]>();
    for (const row of snapshotRows ?? []) {
      const list = snapshotsByProperty.get(row.property_id) ?? [];
      list.push({
        list_price: row.list_price,
        sold_price: row.sold_price,
        status: row.status,
        scraped_at: row.scraped_at,
        source: row.source ?? "scrape",
      });
      snapshotsByProperty.set(row.property_id, list);
    }

    for (const l of listings) {
      l.features = featuresByProperty.get(l.id) ?? [];
      const snaps = snapshotsByProperty.get(l.id) ?? [];

      const prior = snaps.find(
        (s) =>
          s.list_price !== l.listPrice ||
          s.sold_price !== l.soldPrice ||
          s.status !== l.status,
      );
      if (prior) {
        l.priorSnapshot = {
          listPrice: prior.list_price,
          soldPrice: prior.sold_price,
          status: prior.status,
          scrapedAt: prior.scraped_at,
        };
      }

      // Build the inline timeline: oldest → newest, dedupe consecutive
      // entries that have identical price + status (a refresh that didn't
      // change anything is just noise here). Cap at 20 to keep the row
      // from growing unbounded.
      const ascending = [...snaps].reverse();
      const deduped: Snap[] = [];
      for (const s of ascending) {
        const last = deduped[deduped.length - 1];
        const sameAsLast =
          !!last &&
          last.list_price === s.list_price &&
          last.sold_price === s.sold_price &&
          last.status === s.status;
        if (sameAsLast) continue;
        deduped.push(s);
      }
      const trimmed = deduped.slice(-20);
      if (trimmed.length > 0) {
        l.priceHistory = trimmed.map((s) => ({
          listPrice: s.list_price,
          soldPrice: s.sold_price,
          status: s.status,
          scrapedAt: s.scraped_at,
          source: s.source,
        }));
      }
    }
  }

  // Sign just the dashboard tile thumbnails — bounded by O(categories × 4)
  // regardless of board size. Drill-down routes sign their own per-card URLs.
  const thumbnailPaths = Array.from(
    new Set(dashboardSummary.tiles.flatMap((t) => t.thumbnailPaths)),
  );
  const signedThumbUrls = await signImagePaths(thumbnailPaths);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:gap-10 sm:px-6 sm:py-10">
      <header className="flex flex-col gap-1">
        <p
          className="text-[10px] uppercase tracking-[0.22em] text-amber-700/80"
          style={{ letterSpacing: "0.22em" }}
        >
          Board
        </p>
        <h1
          style={{ fontFamily: SERIF }}
          className="text-3xl font-normal leading-tight text-stone-900 sm:text-4xl"
        >
          {board.name}
        </h1>
      </header>

      {!canEdit && <ReadOnlyBanner signedIn={!!userId} />}

      <Card>
        <CardContent>
          <CategoriesSection
            boardId={board.id}
            categories={categoriesData ?? []}
            canEdit={canEdit}
          />
        </CardContent>
      </Card>

      {listings.length > 0 && (
        <Card>
          <CardContent>
            <ListingsPanel listings={listings} />
          </CardContent>
        </Card>
      )}

      <section className="space-y-6">
        {canEdit && (
          <AddArtifact
            boardId={board.id}
            categories={categoriesData ?? []}
          />
        )}
        <DashboardGrid
          boardId={board.id}
          summary={dashboardSummary}
          signedThumbUrls={signedThumbUrls}
          canEdit={canEdit}
        />
      </section>

      {isOwner && (
        <Card>
          <CardContent>
            <SharingSection boardId={board.id} isPublic={board.is_public} />
          </CardContent>
        </Card>
      )}

      {isOwner && (
        <Card>
          <CardContent>
            <InvitesSection
              boardId={board.id}
              members={membersWithEmail}
              currentUserId={userId ?? ""}
            />
          </CardContent>
        </Card>
      )}

      {canEdit && <PasteImageListener boardId={board.id} />}
      <RealtimeBridge boardId={board.id} />
    </main>
  );
}
