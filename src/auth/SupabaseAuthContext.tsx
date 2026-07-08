/**
 * Supabase per-user authentication for Zornade Studio (Fase 3, roadmap).
 *
 * Additive to the legacy shared-password gate in auth/AuthContext.tsx, which
 * stays active during the transition (see combine-auth.ts for how the two
 * are combined - legacy is authoritative/checked first per explicit
 * decision). This context is self-contained and safe to use even when
 * Supabase isn't configured (self-hoster who hasn't set up a project yet,
 * or local dev): every action becomes a no-op / returns an error message
 * instead of throwing.
 *
 * Auth method: email magic link only (signInWithOtp), no password, no
 * OAuth - matches the "condivisione progetti via email" design (an
 * account only needs to prove ownership of an email address).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabaseClient, isSupabaseConfigured } from "../lib/supabase";

interface SupabaseAuthContextValue {
  /** Whether a valid Supabase session exists. */
  isAuthed: boolean;
  /** Still checking for an existing session on load. */
  loading: boolean;
  /** Email of the signed-in user, if any. */
  email: string | null;
  /** id (auth.users.id) of the signed-in user, if any. */
  userId: string | null;
  /** Whether Supabase is configured in this environment at all. */
  isConfigured: boolean;
  /** Send a magic link to the given email. Returns an error message, or null on success. */
  sendMagicLink: (email: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

const SupabaseAuthContext = createContext<SupabaseAuthContextValue | null>(null);

export function SupabaseAuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  // No client configured -> nothing to wait for, resolve immediately.
  const [loading, setLoading] = useState(isSupabaseConfigured);

  useEffect(() => {
    const client = getSupabaseClient();
    if (!client) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    client.auth.getSession().then(({ data }) => {
      if (!cancelled) {
        setSession(data.session);
        setLoading(false);
      }
    });

    const { data: subscription } = client.auth.onAuthStateChange(
      (_event, newSession) => {
        setSession(newSession);
      },
    );

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const sendMagicLink = useCallback(async (email: string): Promise<string | null> => {
    const client = getSupabaseClient();
    if (!client) return "Supabase is not configured for this environment.";
    const trimmed = email.trim();
    if (!trimmed) return "Enter an email address.";
    const { error } = await client.auth.signInWithOtp({
      email: trimmed,
      options: {
        emailRedirectTo: window.location.origin,
        shouldCreateUser: true,
      },
    });
    return error ? error.message : null;
  }, []);

  const signOut = useCallback(async () => {
    const client = getSupabaseClient();
    if (!client) return;
    await client.auth.signOut();
  }, []);

  const value = useMemo<SupabaseAuthContextValue>(
    () => ({
      isAuthed: session !== null,
      loading,
      email: session?.user.email ?? null,
      userId: session?.user.id ?? null,
      isConfigured: isSupabaseConfigured,
      sendMagicLink,
      signOut,
    }),
    [session, loading, sendMagicLink, signOut],
  );

  return (
    <SupabaseAuthContext.Provider value={value}>
      {children}
    </SupabaseAuthContext.Provider>
  );
}

export function useSupabaseAuth(): SupabaseAuthContextValue {
  const ctx = useContext(SupabaseAuthContext);
  if (!ctx) {
    throw new Error("useSupabaseAuth must be used within SupabaseAuthProvider");
  }
  return ctx;
}
