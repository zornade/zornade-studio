/**
 * Combines the legacy shared-password gate with the new Supabase per-user
 * auth (Fase 3, roadmap).
 *
 * Behaviour depends on how many of the two methods are actually configured
 * in this environment (`configured` on each branch - e.g. a self-hoster may
 * only have set up one of the two):
 *
 * - Only one method configured: that one alone grants access (unchanged
 *   behaviour from before this file supported sequential auth - keeps OSS
 *   self-hosters who only set up one method working exactly as before).
 * - BOTH methods configured (e.g. zornade.com/studio in production today):
 *   access requires BOTH, completed in sequence - legacy shared-secret
 *   FIRST, then Supabase magic link - explicit requirement: with both
 *   methods set, a user needs to clear both steps, not just one of them.
 *   The UI (components/LoginScreen.tsx) enforces the ordering by only
 *   showing the magic-link step once the legacy step has passed; this
 *   function only encodes the "both required" access decision, not the
 *   step ordering itself (that's a UI concern).
 *
 * `loading` is the OR of both branches: we wait for BOTH to finish their
 * initial check before ever deciding "not authed", so we never flash the
 * login screen while one branch (typically the Supabase session check,
 * which is async) is still resolving.
 *
 * Pure and framework-free on purpose: the two React contexts
 * (auth/AuthContext.tsx, auth/SupabaseAuthContext.tsx) each expose an
 * {isAuthed, loading, configured} triple and call this function - the
 * decision logic itself is unit-testable without jsdom.
 */

export interface AuthBranchState {
  isAuthed: boolean;
  loading: boolean;
  /** Whether this auth method is set up/available in this environment. */
  configured: boolean;
}

export interface CombinedAuthState {
  isAuthed: boolean;
  loading: boolean;
}

export function combineAuthState(
  legacy: AuthBranchState,
  supabase: AuthBranchState,
): CombinedAuthState {
  const bothConfigured = legacy.configured && supabase.configured;
  return {
    isAuthed: bothConfigured
      // Sequential: both steps required.
      ? legacy.isAuthed && supabase.isAuthed
      // Only one configured (or neither) - whichever is available/passed
      // grants access, same as the previous OR-only behaviour.
      : legacy.isAuthed || supabase.isAuthed,
    loading: legacy.loading || supabase.loading,
  };
}
