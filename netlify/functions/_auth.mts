/**
 * Combined auth check for endpoints that must accept EITHER the legacy
 * shared-password cookie OR a Supabase-authenticated user (magic link) -
 * used by publish.mts and db.mts. See _session.mts (legacy) and
 * _supabase-auth.mts (Supabase) for the two individual mechanisms.
 *
 * BUG FIXED HERE (2026-07-13): both endpoints previously checked ONLY the
 * legacy cookie. On the official zornade.com/studio deployment the legacy
 * gate is DISABLED by default (see .env.example) - the sole sign-in path
 * there is the Supabase magic link. That meant every Supabase-only user
 * (i.e. everyone on the real deployment) got a 401 "Non autenticato" from
 * `/api/publish` and `/api/db`, even though the app's UI had already let
 * them into the editor as logged in. Publishing an embed - and the "Zornade
 * DB" dataset catalog in DataPanel - were therefore silently broken for any
 * real user, only the (disabled-by-default) legacy path ever worked.
 */
import { verifyToken, readCookie } from "./_session.mts";
import { verifySupabaseUser, isSupabaseAuthConfigured } from "./_supabase-auth.mts";

export interface AuthResult {
  ok: boolean;
  /** Which method succeeded - for logging/debugging only. */
  method?: "legacy" | "supabase";
  /** Supabase user id, only set when method === "supabase". */
  userId?: string;
}

/** Checks the request against whichever auth method(s) are configured. */
export async function verifyRequestAuth(req: Request): Promise<AuthResult> {
  const legacySecret = process.env.STUDIO_SESSION_SECRET;
  if (legacySecret) {
    const token = readCookie(req.headers.get("cookie"));
    if (token && verifyToken(token, legacySecret)) {
      return { ok: true, method: "legacy" };
    }
  }
  const userId = await verifySupabaseUser(req);
  if (userId) return { ok: true, method: "supabase", userId };
  return { ok: false };
}

/**
 * True if at least ONE auth method is actually configured on this deploy.
 * Used to tell apart a genuine misconfiguration (500 - nobody could ever
 * authenticate) from a normal 401 (configured, but this request isn't
 * authenticated).
 */
export function isAnyAuthConfigured(): boolean {
  return Boolean(process.env.STUDIO_SESSION_SECRET) || isSupabaseAuthConfigured();
}
