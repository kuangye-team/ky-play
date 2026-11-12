import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import english from "./locales/en.json";
import { getLocale, subscribePreferences } from "./preferences";

void i18next.use(initReactI18next).init({
  lng: getLocale(),
  fallbackLng: "zh-CN",
  resources: { en: { translation: english }, "zh-CN": { translation: {} } },
  keySeparator: false,
  nsSeparator: false,
  interpolation: { escapeValue: false },
  initAsync: false,
});

subscribePreferences(() => {
  const language = getLocale();
  if (i18next.language !== language) void i18next.changeLanguage(language);
});

// Chinese source copy doubles as the fallback; user-provided names are left intact.
export function translate(
  text: string,
  values?: Record<string, unknown>,
): string {
  return i18next.t(text, { ...values, defaultValue: text });
}

export default i18next;

const presetTags: Record<string, string> = {
  classic: "童年回忆",
  relax: "轻松一下",
  challenge: "挑战通关",
};

export function tagLabel(tag: { id: string; name: string }): string {
  return presetTags[tag.id] === tag.name ? translate(tag.name) : tag.name;
}
