import { NextResponse, type NextRequest } from "next/server";

import { refreshListingCore } from "@/app/boards/[id]/refresh-listing-actions";
import { bearerToken, createBearerClient } from "@/lib/supabase/bearer";

/**
 * POST /api/listings/refresh
 *
 * Body: { propertyId: uuid }
 * Response: RefreshResult (`{ok:true,...}` or `{error}`)
 */
export async function POST(request: NextRequest) {
  const token = bearerToken(request);
  if (!token) {
    return NextResponse.json(
      { error: "Missing bearer token." },
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
      { error: "Invalid or expired token." },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const { propertyId } = (body ?? {}) as { propertyId?: unknown };

  const result = await refreshListingCore({
    propertyId: typeof propertyId === "string" ? propertyId : "",
    userSub: user.id,
    userEmail: user.email ?? null,
    supabase,
  });

  const httpStatus = "error" in result ? 400 : 200;
  return NextResponse.json(result, { status: httpStatus });
}
