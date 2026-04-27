import { createClient } from "@/lib/supabase/server";

/**
 * Returns the verified JWT claims for the current request, or null when no
 * session is present. Always use this (or `getUser()` for fresh DB data) for
 * authorization gates — never `getSession()` (cookie-only, unverified).
 */
export async function getCurrentUser() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data) return null;
  return data.claims;
}
