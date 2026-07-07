/**
 * Supabase client for Zornade Studio.
 *
 * Deliberately similar in shape to app/src/lib/supabase.ts (same singleton
 * pattern, avoids the "Multiple GoTrueClient instances" warning), but this
 * is a DIFFERENT, dedicated Supabase project - not shared with app/ (decided
 * 2026-07-07: without cross-domain SSO, sharing auth.users with app/ gave no
 * real UX benefit and only operational risk to its production database; see
 * /memories/repo/zornade-studio-oss-own-project-2026-07-06.md). Studio and
 * app/ also run on different origins (studio.zornade.com vs app.zornade.com)
 * so each gets its own isolated localStorage session regardless - login is
 * separate per site by design, not just an artefact of separate projects.
 *
 * This client is additive: it does not replace the legacy shared-password
 * gate in auth/AuthContext.tsx, which stays active during the transition.
 */


import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const supabaseAnonKey = (
  import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
)?.trim();

/**
 * Whether Supabase is configured in this environment. Studio must keep
 * working (legacy password gate only) when these env vars are absent, e.g.
 * for OSS self-hosters who haven't set up a Supabase project yet.
 */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

let _supabaseClient: SupabaseClient | null = null;

/**
 * Lazily creates (and memoises) the Supabase client. Returns null when the
 * env vars are not configured, instead of throwing - callers must check
 * {@link isSupabaseConfigured} (or handle a null return) before using it.
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null;
  if (_supabaseClient) return _supabaseClient;

  _supabaseClient = createClient(supabaseUrl as string, supabaseAnonKey as string, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
  });

  return _supabaseClient;
}
