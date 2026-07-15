/**
 * Contextual login prompt - "login only when necessary" (2026-07-13).
 *
 * Before this, the ENTIRE editor sat behind a full-page login wall
 * (App.tsx's StudioShell blocked rendering until isAuthed). Editing/
 * visualising data never actually needed an identity (file save/load and
 * local autosave are already 100% client-side); only saving to the cloud,
 * sharing, and publishing genuinely need to know WHO is doing it. This
 * modal is shown instead of the old full-page block, only at the moment one
 * of those actions is attempted while signed out - the editor itself stays
 * open to anyone from the first load, which is the entire point (reduce
 * bounce rate: let people try Studio before asking them to sign up).
 *
 * Reuses the exact same magic-link form as the (still-existing) full-page
 * LoginScreen - same copy, same behaviour - just shown as an overlay so the
 * current map/project in progress is never unmounted or lost.
 */

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { useSupabaseAuth } from "../auth/SupabaseAuthContext";
import { MagicLinkSection } from "./LoginScreen";
import { useI18n } from "../i18n/LanguageContext";

export function AuthGateModal({
  message,
  onClose,
  onAuthed,
}: {
  /** Short, action-specific reason shown above the form, e.g. "Accedi per
   * pubblicare la tua mappa". */
  message: string;
  /** Called when the user dismisses the modal (backdrop click / X) without
   * completing login. */
  onClose: () => void;
  /** Called ONCE, instead of onClose, the moment a Supabase session appears
   * (magic link completed - detected the same way the old LoginScreen
   * detected it, via the reactive isAuthed from SupabaseAuthContext, which
   * supabase-js keeps in sync across tabs). Defaults to onClose if omitted. */
  onAuthed?: () => void;
}) {
  const { isAuthed } = useSupabaseAuth();
  const firedRef = useRef(false);
  const { dict } = useI18n();

  useEffect(() => {
    if (isAuthed && !firedRef.current) {
      firedRef.current = true;
      (onAuthed ?? onClose)();
    }
  }, [isAuthed, onAuthed, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-sm">
        <button
          onClick={onClose}
          className="absolute -right-2 -top-2 z-10 rounded-full bg-white p-1 text-slate-400 shadow-sm hover:bg-slate-100 hover:text-slate-600"
          aria-label={dict.common.close}
        >
          <X size={16} />
        </button>
        <p className="mb-3 text-center text-sm font-medium text-slate-700">
          {message}
        </p>
        <MagicLinkSection standalone />
      </div>
    </div>
  );
}
