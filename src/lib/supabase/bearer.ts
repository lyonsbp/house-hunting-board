import { createClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase client authenticated via a JWT passed in the
 * Authorization header — used by `/api/*` route handlers that mobile (or
 * any non-cookie HTTP client) calls with `Authorization: Bearer <token>`.
 *
 * The token is the same Supabase access token the client gets from
 * `auth.getSession()`. Forwarding it as a `Bearer` header makes RLS treat
 * subsequent queries as that authenticated user — `auth.uid()` resolves
 * naturally in Postgres policies.
 *
 * Pair every route handler that uses this with `supabase.auth.getUser()`
 * to verify the token is still valid (cookie/SSR clients verify
 * automatically through middleware; bearer clients don't).
 */
export function createBearerClient(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    },
  );
}

/**
 * Pull the Bearer token off a Request's Authorization header. Returns null
 * if missing or malformed — let the caller decide the response shape.
 */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}
