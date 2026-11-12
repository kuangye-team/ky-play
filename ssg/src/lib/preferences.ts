import { isDesktop } from "./runtime";
import { syncDesktopTheme } from "./desktop-window";
import { useSyncExternalStore } from "react";
import favicon from "/favicon.svg?raw";

export type Language = "system" | "zh" | "en";
export type Theme = "violet" | "ocean" | "matcha" | "midnight";
type Preferences = { language: Language; theme: Theme };
export const PREFERENCES_KEY = "shiguang.preferences";
const defaults: Preferences = { language: "system", theme: "matcha" };
const languages: Language[] = ["system", "zh", "en"];
const themes: Theme[] = ["matcha", "ocean", "violet", "midnight"];

function readPreferences(): Preferences {
  if (isDesktop) return { ...defaults };
  try {
    const saved = JSON.parse(localStorage.getItem(PREFERENCES_KEY) || "null");
    return {
      language: languages.includes(saved?.language)
        ? saved.language
        : defaults.language,
      theme: themes.includes(saved?.theme) ? saved.theme : defaults.theme,
    };
  } catch {
    return { ...defaults };
  }
}

let preferences = readPreferences();
const listeners = new Set<() => void>();
export const getPreferences = () => preferences;
export const getLocale = (): "zh-CN" | "en" => {
  const language =
    preferences.language === "system"
      ? typeof navigator === "undefined"
        ? "zh-CN"
        : navigator.languages?.[0] || navigator.language
      : preferences.language;
  return /^zh(?:-|$)/i.test(language) ? "zh-CN" : "en";
};
export const subscribePreferences = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

function applyPreferences() {
  const colors: Record<Theme, { color: string; textColor: string }> = {
    violet: { color: "#f3f6fc", textColor: "#36334d" },
    ocean: { color: "#edf5fa", textColor: "#233e50" },
    matcha: { color: "#f0f4ec", textColor: "#34452e" },
    midnight: { color: "#141622", textColor: "#eceaf6" },
  };
  const palette = colors[preferences.theme];
  const scheme = preferences.theme === "midnight" ? "dark" : "light";
  void syncDesktopTheme({ ...palette, scheme });
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = preferences.theme;
    document.documentElement.lang = getLocale();
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", palette.color);
    const iconColors: Record<Theme, string> = {
      matcha: "#567c43",
      ocean: "#267eaa",
      violet: "#7956de",
      midnight: "#b1a0ff",
    };
    const themedIcon = favicon.replace(
      /color="[^"]*"/,
      `color="${iconColors[preferences.theme]}"`,
    );
    document
      .querySelector('link[rel="icon"]')
      ?.setAttribute(
        "href",
        `data:image/svg+xml,${encodeURIComponent(themedIcon)}`,
      );
    document.documentElement.style.colorScheme = scheme;
  }
  listeners.forEach((listener) => listener());
}

export async function initializePreferences() {
  if (!isDesktop) return;
  const { database } = await import("./storage/index");
  const saved = (await (await database).get("settings", PREFERENCES_KEY)) as
    Preferences | undefined;
  if (saved) {
    preferences = {
      language: languages.includes(saved.language)
        ? saved.language
        : defaults.language,
      theme: themes.includes(saved.theme) ? saved.theme : defaults.theme,
    };
    applyPreferences();
  }
}

export function setPreferences(next: Partial<Preferences>) {
  preferences = { ...preferences, ...next };
  if (isDesktop) {
    const saved = { ...preferences };
    void import("./storage/index")
      .then(async ({ database }) => {
        await (await database).put("settings", saved, PREFERENCES_KEY);
      })
      .catch(console.error);
  } else
    try {
      localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
    } catch {
      // Keep the controls usable even when the browser disallows storage.
    }
  applyPreferences();
}

export function usePreferences() {
  return useSyncExternalStore(
    subscribePreferences,
    getPreferences,
    getPreferences,
  );
}

applyPreferences();
if (typeof window !== "undefined") {
  window.addEventListener("languagechange", () => {
    if (preferences.language === "system") {
      preferences = { ...preferences };
      applyPreferences();
    }
  });
  window.addEventListener("storage", (event) => {
    if (!isDesktop && (event.key === PREFERENCES_KEY || event.key === null)) {
      preferences = readPreferences();
      applyPreferences();
    }
  });
}
