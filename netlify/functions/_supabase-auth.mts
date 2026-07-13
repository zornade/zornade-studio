/**
 * Server-side verification of a Supabase-authenticated user (magic link),
 * used as an alternative to the legacy shared-password cookie (_session.mts)
 * so auth-gated endpoints (publish.mts, db.mts) also recognise per-user
 * Supabase logins - see _auth.mts for why this exists and the bug it fixes.
 *
 * Reuses the SAME env vars already required for the Vite client build
 * (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY) instead of introducing new
 * server-only duplicates: Netlify Functions can read ANY site environment
 * variable via process.env regardless of the "VITE_" prefix - that prefix
 * only controls what Vite inlines into the browser bundle at build time, it
 * has no effect on what Functions can see at runtime. No new environment
 * variables need to be configured on Netlify for this to work.
 */

import { createClient } from "@supabase/supabase-js";

function readEnv(): { url: string | null; anonKey: string | null } {
  const url = process.env.VITE_SUPABASE_URL?.trim() || null;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY?.trim() || null;
  return { url, anonKey };
}

/** True if a Supabase project is configured on this deploy at all. */
export function isSupabaseAuthConfigured(): boolean {
  const { url, anonKey } = readEnv();
  return Boolean(url && anonKey);
}

/**
 * Verifies the `Authorization: Bearer <access_token>` header (the client's
 * current Supabase session access token) against Supabase's Auth server.
 * Returns the authenticated user's id, or null if the header is absent, the
 * token is invalid/expired, or Supabase isn't configured on this deploy.
 */
export async function verifySupabaseUser(req: Request): Promise<string | null> {
  const { url, anonKey } = readEnv();
  if (!url || !anonKey) return null;

  const authHeader = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authHeader);
  if (!match) return null;
  const accessToken = match[1].trim();
  if (!accessToken) return null;

  try {
    // A fresh client per call is deliberate: this is a stateless verification
    // (no session persistence needed/wanted server-side), and Netlify
    // Functions are short-lived anyway - no meaningful cost to not caching it.
    const client = createClient(url, anonKey);
    const { data, error } = await client.auth.getUser(accessToken);
    if (error || !data.user) return null;
    return data.user.id;
  } catch {
    return null;
  }
}
