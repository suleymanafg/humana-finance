"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { useRouter } from "next/navigation";
import { dict, LOCALE_COOKIE, type DictKey, type Locale } from "./i18n";

export type Bi = { ru: string; en: string };

interface LocaleCtx {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: DictKey) => string;
  /** pick the current language from an inline { ru, en } label */
  l: (label: Bi) => string;
}

const Ctx = createContext<LocaleCtx>({
  locale: "ru",
  setLocale: () => {},
  t: (k) => dict[k].ru,
  l: (label) => label.ru,
});

export function LocaleProvider({ initial, children }: { initial: Locale; children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initial);
  const router = useRouter();
  const setLocale = useCallback(
    (l: Locale) => {
      document.cookie = `${LOCALE_COOKIE}=${l};path=/;max-age=${3600 * 24 * 365}`;
      setLocaleState(l);
      router.refresh();
    },
    [router]
  );
  const t = useCallback((key: DictKey) => dict[key][locale], [locale]);
  const l = useCallback((label: Bi) => label[locale], [locale]);
  return <Ctx.Provider value={{ locale, setLocale, t, l }}>{children}</Ctx.Provider>;
}

export function useT() {
  return useContext(Ctx);
}
