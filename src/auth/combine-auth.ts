/**
 * Combines the legacy shared-password gate with the new Supabase per-user
 * auth (Fase 3, roadmap): either one grants access (OR), matching the
 * "keep legacy gate in parallel during the transition" decision - explicit
 * user requirement: legacy is checked/comes FIRST, not demoted behind the
 * new auth.
 *
 * `loading` is the OR of both branches: we wait for BOTH to finish their
 * initial check before ever deciding "not authed", so we never flash the
 * login screen while one branch (typically the Supabase session check,
 * which is async) is still resolving.
 *
 * Pure and framework-free on purpose: the two React contexts
 * (auth/AuthContext.tsx, auth/SupabaseAuthContext.tsx) each expose an
 * {isAuthed, loading} pair and call this function - the decision logic
 * itself is unit-testable without jsdom.
 */

export interface AuthBranchState {
  isAuthed: boolean;
  loading: boolean;
}

export interface CombinedAuthState {
  isAuthed: boolean;
  loading: boolean;
}

export function combineAuthState(
  legacy: AuthBranchState,
  supabase: AuthBranchState,
): CombinedAuthState {
  return {
    // Legacy is evaluated first (left operand) per explicit requirement,
    // even though `||` short-circuits and the practical result is the same
    // regardless of operand order for two booleans.
    isAuthed: legacy.isAuthed || supabase.isAuthed,
    loading: legacy.loading || supabase.loading,
  };
}
