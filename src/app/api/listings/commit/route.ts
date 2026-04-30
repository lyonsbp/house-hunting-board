import { NextResponse, type NextRequest } from "next/server";

import { commitListingImportCore } from "@/app/boards/[id]/import-listing-actions";
import type { ListingPreview } from "@/lib/listings/types";
import { bearerToken, createBearerClient } from "@/lib/supabase/bearer";

/**
 * POST /api/listings/commit
 *
 * Body: {
 *   boardId: uuid,
 *   url: string,
 *   selectedImageUrls: string[],
 *   cachedPreview: ListingPreview
 * }
 * Response: CommitListingState
 */
export async function POST(request: NextRequest) {
  const token = bearerToken(request);
  if (!token) {
    return NextResponse.json(
      { status: "error", message: "Missing bearer token." },
      { status: 401 },
    );
  }

  const supabase = createBearerClient(token);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json(
      { status: "error", message: "Invalid or expired token." },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { status: "error", message: "Body must be JSON." },
      { status: 400 },
    );
  }
  const {
    boardId,
    url,
    selectedImageUrls,
    cachedPreview,
  } = (body ?? {}) as {
    boardId?: unknown;
    url?: unknown;
    selectedImageUrls?: unknown;
    cachedPreview?: unknown;
  };

  if (!Array.isArray(selectedImageUrls)) {
    return NextResponse.json(
      { status: "error", message: "selectedImageUrls must be an array." },
      { status: 400 },
    );
  }
  if (!cachedPreview || typeof cachedPreview !== "object") {
    return NextResponse.json(
      { status: "error", message: "cachedPreview is required." },
      { status: 400 },
    );
  }

  const result = await commitListingImportCore({
    boardId: typeof boardId === "string" ? boardId : "",
    url: typeof url === "string" ? url : "",
    selectedImageUrls: selectedImageUrls as string[],
    cachedPreview: cachedPreview as ListingPreview,
    userSub: user.id,
    supabase,
  });

  const httpStatus = result.status === "error" ? 400 : 200;
  return NextResponse.json(result, { status: httpStatus });
}
