import { useState, type FormEvent } from "react";
import { Lock, LogIn, AlertTriangle, Mail, CheckCircle2 } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { useSupabaseAuth } from "../auth/SupabaseAuthContext";

export function LoginScreen() {
  const { login, notConfigured } = useAuth();
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const err = await login(user, password);
    setBusy(false);
    if (err) setError(err);
  };

  return (
    <div className="flex h-full items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <img src="/zornade-icon.svg" alt="Zornade" className="h-12 w-12" />
          <div>
            <h1 className="font-display text-xl font-semibold tracking-tight text-slate-900">
              Zornade <span className="text-zornade">Studio</span>
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Accesso riservato alla redazione
            </p>
          </div>
        </div>

        <form
          onSubmit={onSubmit}
          className="space-y-3 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
        >
          {notConfigured && (
            <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
              Accesso non configurato: imposta <code>VITE_STUDIO_USER</code> e{" "}
              <code>VITE_STUDIO_PASS_SHA256</code> in <code>.env.local</code>.
            </p>
          )}

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">
              Utente
            </span>
            <input
              value={user}
              onChange={(e) => setUser(e.target.value)}
              autoComplete="username"
              autoFocus
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-zornade focus:outline-none focus:ring-2 focus:ring-zornade/20"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">
              Password
            </span>
            <div className="relative">
              <Lock
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm focus:border-zornade focus:outline-none focus:ring-2 focus:ring-zornade/20"
              />
            </div>
          </label>

          {error && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || notConfigured}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-zornade px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zornade-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <LogIn size={16} />
            {busy ? "Accesso…" : "Entra"}
          </button>
        </form>

        <MagicLinkSection />

        <p className="mt-4 text-center text-[11px] text-slate-400">
          Strumento interno. La sessione scade dopo 12 ore.
        </p>
      </div>
    </div>
  );
}

/**
 * Supabase magic-link section, shown BELOW the legacy password form (never
 * above it - explicit requirement: the legacy gate stays primary during the
 * transition). Renders nothing if Supabase isn't configured in this
 * environment (e.g. OSS self-hoster who hasn't set one up yet).
 */
function MagicLinkSection() {
  const { isConfigured, sendMagicLink } = useSupabaseAuth();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!isConfigured) return null;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const err = await sendMagicLink(email);
    setBusy(false);
    if (err) setError(err);
    else setSent(true);
  };

  return (
    <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <div className="h-px flex-1 bg-slate-200" />
        <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
          oppure
        </span>
        <div className="h-px flex-1 bg-slate-200" />
      </div>

      {sent ? (
        <p className="flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          <CheckCircle2 size={14} className="mt-0.5 flex-shrink-0" />
          Controlla la tua email: ti abbiamo inviato un link di accesso.
        </p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">
              Accedi (o registrati) con la tua email
            </span>
            <div className="relative">
              <Mail
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                placeholder="tu@esempio.com"
                className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm focus:border-zornade focus:outline-none focus:ring-2 focus:ring-zornade/20"
              />
            </div>
          </label>

          {error && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || !email.trim()}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Mail size={16} />
            {busy ? "Invio…" : "Invia link di accesso"}
          </button>
        </form>
      )}
    </div>
  );
}
