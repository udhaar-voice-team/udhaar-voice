import { format, setDefaultOptions } from "date-fns";
import { bn as bnDates, enIN, hi as hiDates } from "date-fns/locale";
import { useSyncExternalStore } from "react";
import { LANGUAGES, type Language } from "@/lib/domain/types";
import { bn } from "./bn";
import { en } from "./en";
import { hi } from "./hi";
import { mr } from "./mr";
import { or } from "./or";

/**
 * All shopkeeper-facing text, in English, Hindi, Odia, Bengali and Marathi. The app language is a per-device
 * choice (Settings), stored in this browser so it applies before sign-in too. English is the default.
 * Month and day names follow it through date-fns; digits stay 0–9, as on most Indian apps.
 */
export type Dictionary = typeof en;

const DICTIONARIES: Record<Language, Dictionary> = { en, hi, or, bn, mr };
// date-fns has no Odia or Marathi month names, so those use English ones ("28 Oct").
const DATE_LOCALES: Record<Language, typeof enIN> = { en: enIN, hi: hiDates, or: enIN, bn: bnDates, mr: enIN };
const STORAGE_KEY = "udhaar-voice-language";
const listeners = new Set<() => void>();

function stored(): Language {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (LANGUAGES.includes(value as Language)) return value as Language;
  } catch {
    // Blocked storage: fall back to English.
  }
  return "en";
}

function apply(language: Language) {
  setDefaultOptions({ locale: DATE_LOCALES[language] });
  document.documentElement.lang = language;
}

// Screens render their data (and its dates) only in the browser, after loading, so the date
// locale can be set as soon as this module loads.
if (typeof window !== "undefined") apply(stored());

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY) return;
    apply(stored());
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useAppLanguage(): Language {
  return useSyncExternalStore(subscribe, stored, () => "en");
}

export function setAppLanguage(language: Language) {
  try {
    window.localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // Blocked storage (some private windows): the app stays in English.
  }
  apply(language);
  for (const listener of listeners) listener();
}

/** A long date in the app's language: "Wednesday, 28th October" in English, the usual style elsewhere. */
export function formatLongDate(date: Date, language: Language): string {
  return format(date, language === "en" ? "EEEE, do MMMM" : "EEEE d MMMM");
}

export function useT(): Dictionary {
  return DICTIONARIES[useAppLanguage()];
}

/** Text for someone other than the shopkeeper, such as a customer's WhatsApp message in their own language. */
export const dictionaryFor = (language: Language): Dictionary => DICTIONARIES[language];

export { en };
