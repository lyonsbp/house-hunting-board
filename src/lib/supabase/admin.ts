import { createClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase client built with the service-role key. Bypasses RLS.
 *
 * Use ONLY for admin operations that legitimately exceed user authority:
 *   - Inviting users to boards (owner-driven, but the membership insert
 *     itself runs above RLS).
 *   - Looking up emails by user_id for owner-visible member lists.
 *
 * NEVER import this from a client component, RSC that runs in the browser
 * runtime, or any file that ends up in the client bundle. The runtime
 * guard below will throw if it ever runs in a browser.
 */
export function createAdminClient() {
  if (typeof window !== "undefined") {
    throw new Error("createAdminClient is server-only");
  }
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
