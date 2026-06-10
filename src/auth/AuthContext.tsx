/**
 * Authentication gate for Zornade Studio.
 *
 * TWO MODES, auto-detected:
 *
 * 1. SERVER mode (production on Netlify): a serverless function validates the
 *    password and sets an HttpOnly session cookie (`/api/login`,
 *    `/api/session`, `/api/logout`). The password and signing secret live only
 *    on the server; the browser never sees them and cannot forge the cookie.
 *    This is the robust path.
 *
 * 2. CLIENT mode (local `vite` dev without Netlify functions): falls back to a
 *    client-side SHA-256 check against `VITE_STUDIO_*` env vars, with a
 *    sessionStorage flag. Convenient for development; NOT used in production
 *    because the functions answer `/api/session` there.
 *
 * Detection: on load we GET `/api/session`. If it answers with JSON we are in
 * server mode; if it 404s or fails (no functions), we fall back to client mode.
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

const CLIENT_SESSION_KEY = "zornade-studio-auth";
/** Client-mode session lifetime (hours). */
const CLIENT_SESSION_HOURS = 12;

const EXPECTED_USER = (import.meta.env.VITE_STUDIO_USER as string | undefined)?.trim();
const EXPECTED_HASH = (
  import.meta.env.VITE_STUDIO_PASS_SHA256 as string | undefined
)
  ?.trim()
  .toLowerCase();

type Mode = "loading" | "server" | "client";

interface AuthContextValue {
  /** Whether a valid session exists. */
  isAuthed: boolean;
  /** Still detecting mode / checking the existing session. */
  loading: boolean;
  /** True when credentials are not configured (client mode only). */
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

function readClientSession(): boolean {
  try {
    const raw = sessionStorage.getItem(CLIENT_SESSION_KEY);
    if (!raw) return false;
    const { exp } = JSON.parse(raw) as { exp: number };
    return typeof exp === "number" && Date.now() < exp;
  } catch {
    return false;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>("loading");
  const [isAuthed, setIsAuthed] = useState(false);

  // Detect mode and check any existing session on load.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/session", {
          headers: { accept: "application/json" },
        });
        const ct = res.headers.get("content-type") ?? "";
        if (res.ok && ct.includes("application/json")) {
          const data = (await res.json()) as { authed?: boolean };
          if (!cancelled) {
            setMode("server");
            setIsAuthed(Boolean(data.authed));
          }
          return;
        }
        throw new Error("no functions");
      } catch {
        // No functions reachable → client fallback (dev).
        if (!cancelled) {
          setMode("client");
          setIsAuthed(readClientSession());
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const notConfigured = mode === "client" && (!EXPECTED_USER || !EXPECTED_HASH);

  const login = useCallback(
    async (user: string, password: string): Promise<string | null> => {
      if (mode === "server") {
        try {
          const res = await fetch("/api/login", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ user, password }),
          });
          if (res.ok) {
            setIsAuthed(true);
            return null;
          }
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          return data.error ?? "Accesso negato.";
        } catch {
          return "Errore di rete durante l'accesso.";
        }
      }

      // Client fallback (dev).
      if (!EXPECTED_USER || !EXPECTED_HASH) {
        return "Accesso non configurato. Imposta VITE_STUDIO_USER e VITE_STUDIO_PASS_SHA256 in .env.local.";
      }
      const userOk = safeEqual(user.trim(), EXPECTED_USER);
      const hash = await sha256Hex(password);
      const passOk = safeEqual(hash, EXPECTED_HASH);
      if (!userOk || !passOk) return "Utente o password non corretti.";
      const exp = Date.now() + CLIENT_SESSION_HOURS * 60 * 60 * 1000;
      sessionStorage.setItem(CLIENT_SESSION_KEY, JSON.stringify({ exp }));
      setIsAuthed(true);
      return null;
    },
    [mode],
  );

  const logout = useCallback(() => {
    if (mode === "server") {
      void fetch("/api/logout", { method: "POST" }).catch(() => {});
    } else {
      sessionStorage.removeItem(CLIENT_SESSION_KEY);
    }
    setIsAuthed(false);
  }, [mode]);

  const value = useMemo<AuthContextValue>(
    () => ({
      isAuthed,
      loading: mode === "loading",
      notConfigured,
      login,
      logout,
    }),
    [isAuthed, mode, notConfigured, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
