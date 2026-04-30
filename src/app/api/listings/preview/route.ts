import { NextResponse, type NextRequest } from "next/server";

import { previewListingCore } from "@/app/boards/[id]/import-listing-actions";
import { bearerToken, createBearerClient } from "@/lib/supabase/bearer";

/**
 * POST /api/listings/preview
 *
 * Authenticated mobile (or any non-cookie HTTP client) endpoint wrapping
 * `previewListingCore`. Authenticates via `Authorization: Bearer <jwt>`,
 * where the JWT is the access_token from a Supabase session.
 *
 * Body: { boardId: uuid, url: string }
 * Response: PreviewListingState (same union web returns from the action)
 */
export async function POST(request: NextRequest) {
  const token = bearerToken(request);
  if (!token) {
    return NextResponse.json(
      { status: "error", code: "http", message: "Missing bearer token." },
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
      { status: "error", code: "http", message: "Invalid or expired token." },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { status: "error", code: "parse", message: "Body must be JSON." },
      { status: 400 },
    );
  }
  const { boardId, url } = (body ?? {}) as { boardId?: unknown; url?: unknown };

  const result = await previewListingCore({
    boardId: typeof boardId === "string" ? boardId : "",
    url: typeof url === "string" ? url : "",
    userSub: user.id,
    userEmail: user.email ?? null,
    supabase,
  });

  // 200 for ready/idle, 400 for error states so HTTP semantics line up
  // with the body's `status` field.
  const httpStatus = result.status === "error" ? 400 : 200;
  return NextResponse.json(result, { status: httpStatus });
}
