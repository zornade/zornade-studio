/**
 * Lightweight authentication gate for Zornade Studio (internal use).
 *
 * SECURITY MODEL (read this):
 * This is a client-side gate. It prevents casual access to the UI but is NOT a
 * substitute for server-side protection: the app bundle is downloadable, so a
 * determined actor could bypass the UI gate. The credential is never stored in
 * plaintext — we compare the SHA-256 hash of the typed password against a hash
 * provided via an environment variable (`VITE_STUDIO_PASS_SHA256`, set in a
 * gitignored .env.local). The robust version (server-side check + HttpOnly
 * cookie, or Netlify's built-in password protection) lands when we deploy.
 *
 * Configuration (.env.local, NOT committed):
 *   VITE_STUDIO_USER=redazione
 *   VITE_STUDIO_PASS_SHA256=<hex sha-256 of the password>
 *
 * Generate the hash without revealing the password to anyone (type it yourself):
 *   printf '%s' 'LA_TUA_PASSWORD' | sha256sum
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

const SESSION_KEY = "zornade-studio-auth";
/** Session lifetime: re-login required after this many hours. */
const SESSION_HOURS = 12;

const EXPECTED_USER = (import.meta.env.VITE_STUDIO_USER as string | undefined)?.trim();
const EXPECTED_HASH = (
  import.meta.env.VITE_STUDIO_PASS_SHA256 as string | undefined
)
  ?.trim()
  .toLowerCase();

interface AuthContextValue {
  /** Whether a valid, unexpired session exists. */
  isAuthed: boolean;
  /** True when credentials are not configured (.env.local missing). */
  notConfigured: boolean;
  /** Attempt login; returns null on success or an error message. */
  login: (user: string, password: string) => Promise<string | null>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** SHA-256 of a string as lowercase hex, via WebCrypto (secure contexts only). */
async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time-ish string comparison (avoids early-exit timing leaks). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function readSession(): boolean {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return false;
    const { exp } = JSON.parse(raw) as { exp: number };
    return typeof exp === "number" && Date.now() < exp;
  } catch {
    return false;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const notConfigured = !EXPECTED_USER || !EXPECTED_HASH;
  const [isAuthed, setIsAuthed] = useState<boolean>(() => readSession());

  // Drop the session automatically when it expires while the app is open.
  useEffect(() => {
    if (!isAuthed) return undefined;
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return undefined;
    try {
      const { exp } = JSON.parse(raw) as { exp: number };
      const ms = exp - Date.now();
      if (ms <= 0) {
        setIsAuthed(false);
        return undefined;
      }
      const t = setTimeout(() => setIsAuthed(false), ms);
      return () => clearTimeout(t);
    } catch {
      return undefined;
    }
  }, [isAuthed]);

  const login = useCallback(
    async (user: string, password: string): Promise<string | null> => {
      if (notConfigured) {
        return "Accesso non configurato. Imposta VITE_STUDIO_USER e VITE_STUDIO_PASS_SHA256 in .env.local.";
      }
      const userOk = safeEqual(user.trim(), EXPECTED_USER!);
      const hash = await sha256Hex(password);
      const passOk = safeEqual(hash, EXPECTED_HASH!);
      // Evaluate both regardless of the username result to avoid leaking which
      // field was wrong.
      if (!userOk || !passOk) return "Utente o password non corretti.";
      const exp = Date.now() + SESSION_HOURS * 60 * 60 * 1000;
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ exp }));
      setIsAuthed(true);
      return null;
    },
    [notConfigured],
  );

  const logout = useCallback(() => {
    sessionStorage.removeItem(SESSION_KEY);
    setIsAuthed(false);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ isAuthed, notConfigured, login, logout }),
    [isAuthed, notConfigured, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
