import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { it } from "./dictionaries/it";
import { en } from "./dictionaries/en";
import type { Dictionary } from "./dictionaries/it";

export type Lang = "it" | "en";

const STORAGE_KEY = "zornade-studio-lang";

const DICTIONARIES: Record<Lang, Dictionary> = { it, en };

function detectDefaultLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "it" || stored === "en") return stored;
  } catch {
    // localStorage unavailable (privacy mode, SSR, ...) - fall through to
    // browser-language detection.
  }
  const browserLang = typeof navigator !== "undefined" ? navigator.language : "it";
  return browserLang.toLowerCase().startsWith("it") ? "it" : "en";
}

interface I18nContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  dict: Dictionary;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectDefaultLang);

  const setLang = (next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Ignore write failures (privacy mode, quota, ...) - the choice just
      // won't persist across reloads.
    }
  };

  const value = useMemo<I18nContextValue>(
    () => ({ lang, setLang, dict: DICTIONARIES[lang] }),
    [lang],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within a LanguageProvider");
  }
  return ctx;
}
