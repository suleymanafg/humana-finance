"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { useRouter } from "next/navigation";
import { dict, LOCALE_COOKIE, type DictKey, type Locale } from "./i18n";

interface LocaleCtx {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: DictKey) => string;
}

const Ctx = createContext<LocaleCtx>({ locale: "ru", setLocale: () => {}, t: (k) => dict[k].ru });

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
  return <Ctx.Provider value={{ locale, setLocale, t }}>{children}</Ctx.Provider>;
}

export function useT() {
  return useContext(Ctx);
}
