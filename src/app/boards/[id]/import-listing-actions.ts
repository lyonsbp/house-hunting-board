"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getCurrentUser } from "@/lib/auth";
import {
  getDailyScrapeLimit,
  isSuperadminEmail,
  startOfTodayUtc,
} from "@/lib/listings/quota";
import { getFetcher } from "@/lib/listings/registry";
import {
  ListingFetchError,
  UnsupportedListingError,
  type ListingPreview,
  type ListingSource,
} from "@/lib/listings/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const MAX_IMAGES_PER_IMPORT = 60;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const PER_IMAGE_TIMEOUT_MS = 10_000;
const DOWNLOAD_CONCURRENCY = 6;

const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

// ---------------------------------------------------------------------------
// previewListing
// ---------------------------------------------------------------------------

export type PreviewListingState =
  | { status: "idle" }
  | {
      status: "ready";
      preview: ListingPreview;
      boardId: string;
      url: string;
    }
  | {
      status: "error";
      code:
        | "unsupported"
        | "blocked"
        | "timeout"
        | "parse"
        | "http"
        | "not-html"
        | "rate-limit";
      message: string;
    };

const PreviewSchema = z.object({
  boardId: z.string().uuid(),
  url: z.string().trim().url(),
});

export async function previewListing(
  _prev: PreviewListingState,
  formData: FormData,
): Promise<PreviewListingState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const parsed = PreviewSchema.safeParse({
    boardId: formData.get("boardId"),
    url: formData.get("url"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      code: "parse",
      message: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  let fetcher;
  try {
    fetcher = getFetcher(parsed.data.url);
  } catch (e) {
    if (e instanceof UnsupportedListingError) {
      return {
        status: "error",
        code: "unsupported",
        message: `${e.host} isn't supported yet — try a Redfin or Zillow listing URL.`,
      };
    }
    throw e;
  }

  // Rate-limit gate. Superadmins listed in SUPERADMIN_EMAILS skip the count.
  const supabase = await createClient();
  const exempt = isSuperadminEmail(
    typeof user.email === "string" ? user.email : null,
  );
  if (!exempt) {
    const limit = getDailyScrapeLimit();
    const { count, error: countError } = await supabase
      .from("listing_scrapes")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.sub)
      .gte("created_at", startOfTodayUtc());
    if (countError) {
      return {
        status: "error",
        code: "http",
        message: `Couldn't check daily quota: ${countError.message}`,
      };
    }
    if ((count ?? 0) >= limit) {
      return {
        status: "error",
        code: "rate-limit",
        message: `Daily scan limit reached (${limit}/day). Try again tomorrow.`,
      };
    }
  }

  // Log the scrape attempt before we make the (possibly billable) call.
  // Counting attempts rather than successes prevents a user from burning
  // Scrapfly credits by retrying bad URLs in a loop.
  const { error: logError } = await supabase.from("listing_scrapes").insert({
    user_id: user.sub,
    source: fetcher.source,
    source_url: parsed.data.url,
    status: "preview",
  });
  if (logError) {
    return {
      status: "error",
      code: "http",
      message: `Couldn't log scrape: ${logError.message}`,
    };
  }

  let preview: ListingPreview;
  try {
    preview = await fetcher.fetchAndParse(parsed.data.url);
  } catch (e) {
    if (e instanceof ListingFetchError) {
      return { status: "error", code: e.code, message: e.message };
    }
    return {
      status: "error",
      code: "parse",
      message: e instanceof Error ? e.message : "Failed to read listing.",
    };
  }

  if (preview.images.length > MAX_IMAGES_PER_IMPORT) {
    preview = { ...preview, images: preview.images.slice(0, MAX_IMAGES_PER_IMPORT) };
  }

  return {
    status: "ready",
    preview,
    boardId: parsed.data.boardId,
    url: parsed.data.url,
  };
}

// ---------------------------------------------------------------------------
// commitListingImport
// ---------------------------------------------------------------------------

export type CommitListingState =
  | { status: "idle" }
  | {
      status: "done";
      succeeded: number;
      failed: number;
      errors: string[];
      boardId: string;
    }
  | { status: "error"; message: string };

const CommitSchema = z.object({
  boardId: z.string().uuid(),
  url: z.string().trim().url(),
  selectedImageUrls: z
    .array(z.string().url())
    .min(1, "Pick at least one image to import.")
    .max(MAX_IMAGES_PER_IMPORT, `At most ${MAX_IMAGES_PER_IMPORT} images per import.`),
  cachedPreview: z.unknown(),
});

export async function commitListingImport(
  _prev: CommitListingState,
  formData: FormData,
): Promise<CommitListingState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const rawSelected = formData.get("selectedImageUrls");
  const rawCached = formData.get("cachedPreview");

  let selectedImageUrls: unknown;
  let cachedPreviewParsed: unknown;
  try {
    selectedImageUrls = typeof rawSelected === "string" ? JSON.parse(rawSelected) : null;
    cachedPreviewParsed = typeof rawCached === "string" ? JSON.parse(rawCached) : null;
  } catch {
    return { status: "error", message: "Selection payload was malformed." };
  }

  const parsed = CommitSchema.safeParse({
    boardId: formData.get("boardId"),
    url: formData.get("url"),
    selectedImageUrls,
    cachedPreview: cachedPreviewParsed,
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  const cachedPreview = cachedPreviewParsed as ListingPreview | null;
  if (!cachedPreview || !Array.isArray(cachedPreview.images)) {
    return { status: "error", message: "Preview state was missing." };
  }

  // Defense-in-depth: only allow image URLs that came from this preview, on
  // hosts we recognize. Without this, a user could edit the form and have
  // our server fetch arbitrary URLs.
  const previewedSet = new Set(cachedPreview.images.map((i) => i.url));
  for (const u of parsed.data.selectedImageUrls) {
    if (!previewedSet.has(u)) {
      return {
        status: "error",
        message: "One or more images aren't part of the previewed listing.",
      };
    }
  }
  const propertySource: ListingSource = cachedPreview.property.source;

  // Editor check up front (RLS still gates writes; this is for a friendlier
  // error than a generic "violates row-level security policy").
  const supabase = await createClient();
  const { data: membership } = await supabase
    .from("board_members")
    .select("role")
    .eq("board_id", parsed.data.boardId)
    .eq("user_id", user.sub)
    .maybeSingle();
  if (!membership || (membership.role !== "editor" && membership.role !== "owner")) {
    return {
      status: "error",
      message: "Only board editors can import listings.",
    };
  }

  // Upsert property via service role — `properties` has no insert policy.
  const admin = createAdminClient();
  const { data: propertyRow, error: propertyError } = await admin
    .from("properties")
    .upsert(
      {
        source: propertySource,
        source_url: cachedPreview.property.sourceUrl,
        source_id: cachedPreview.property.sourceId ?? null,
        address: cachedPreview.property.address ?? null,
        city: cachedPreview.property.city ?? null,
        state: cachedPreview.property.state ?? null,
        zip: cachedPreview.property.zip ?? null,
        list_price: cachedPreview.property.listPrice ?? null,
        sold_price: cachedPreview.property.soldPrice ?? null,
        bedrooms: cachedPreview.property.bedrooms ?? null,
        bathrooms: cachedPreview.property.bathrooms ?? null,
        sqft: cachedPreview.property.sqft ?? null,
        lot_sqft: cachedPreview.property.lotSqft ?? null,
        year_built: cachedPreview.property.yearBuilt ?? null,
        status: cachedPreview.property.status ?? null,
        raw: cachedPreview.property.raw ?? {},
        scraped_at: cachedPreview.scrapedAt,
      },
      { onConflict: "source,source_url" },
    )
    .select("id")
    .single();
  if (propertyError || !propertyRow) {
    return {
      status: "error",
      message: propertyError?.message ?? "Failed to save listing record.",
    };
  }
  const propertyId = propertyRow.id as string;

  // Bounded-parallel image download + upload. Each entry retains its
  // position in the original selection so the saved `image_index` metadata
  // matches the order the user picked.
  const errors: string[] = [];
  let succeeded = 0;
  const queue: Array<[number, string]> = parsed.data.selectedImageUrls.map(
    (u, i) => [i, u],
  );

  const workers = Array.from({ length: DOWNLOAD_CONCURRENCY }, async () => {
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next) return;
      const [imageIndex, imageUrl] = next;
      const ok = await importOneImage({
        supabase,
        boardId: parsed.data.boardId,
        propertyId,
        source: propertySource,
        sourceUrl: cachedPreview.property.sourceUrl,
        scrapedAt: cachedPreview.scrapedAt,
        imageUrl,
        imageIndex,
      });
      if (ok.ok) {
        succeeded++;
      } else {
        errors.push(ok.error);
      }
    }
  });
  await Promise.all(workers);

  revalidatePath(`/boards/${parsed.data.boardId}`);

  return {
    status: "done",
    succeeded,
    failed: errors.length,
    errors,
    boardId: parsed.data.boardId,
  };
}

type ImportOneArgs = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  boardId: string;
  propertyId: string;
  source: ListingSource;
  sourceUrl: string;
  scrapedAt: string;
  imageUrl: string;
  imageIndex: number;
};

async function importOneImage(
  args: ImportOneArgs,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let res: Response;
  try {
    res = await fetch(args.imageUrl, {
      signal: AbortSignal.timeout(PER_IMAGE_TIMEOUT_MS),
      redirect: "follow",
    });
  } catch (e) {
    return {
      ok: false,
      error: shortError(args.imageUrl, e instanceof Error ? e.message : "fetch failed"),
    };
  }
  if (!res.ok) {
    return { ok: false, error: shortError(args.imageUrl, `${res.status}`) };
  }
  const ct = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!ct.startsWith("image/")) {
    return { ok: false, error: shortError(args.imageUrl, `not an image (${ct || "unknown"})`) };
  }
  const ext = ALLOWED_IMAGE_TYPES[ct];
  if (!ext) {
    return { ok: false, error: shortError(args.imageUrl, `unsupported type ${ct}`) };
  }
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_IMAGE_BYTES) {
    return { ok: false, error: shortError(args.imageUrl, "exceeds 10MB cap") };
  }

  const path = `boards/${args.boardId}/${crypto.randomUUID()}.${ext}`;
  const { error: uploadError } = await args.supabase.storage
    .from("artifacts")
    .upload(path, buf, { contentType: ct, upsert: false });
  if (uploadError) {
    return { ok: false, error: shortError(args.imageUrl, uploadError.message) };
  }

  const { data: artifactRow, error: artifactError } = await args.supabase
    .from("artifacts")
    .insert({
      board_id: args.boardId,
      kind: "image",
      storage_path: path,
      metadata: {
        source: args.source,
        source_url: args.sourceUrl,
        scraped_at: args.scrapedAt,
        image_source_url: args.imageUrl,
        image_index: args.imageIndex,
      },
    })
    .select("id")
    .single();
  if (artifactError || !artifactRow) {
    await args.supabase.storage.from("artifacts").remove([path]);
    return {
      ok: false,
      error: shortError(args.imageUrl, artifactError?.message ?? "artifact insert failed"),
    };
  }

  const { error: linkError } = await args.supabase
    .from("property_artifacts")
    .insert({ property_id: args.propertyId, artifact_id: artifactRow.id });
  if (linkError) {
    // Roll back the artifact + the storage object on link failure so we
    // don't leave a half-imported row.
    await args.supabase.from("artifacts").delete().eq("id", artifactRow.id);
    await args.supabase.storage.from("artifacts").remove([path]);
    return { ok: false, error: shortError(args.imageUrl, linkError.message) };
  }

  return { ok: true };
}

function shortError(url: string, msg: string): string {
  const short = url.length > 60 ? `${url.slice(0, 57)}…` : url;
  return `${short} — ${msg}`;
}
