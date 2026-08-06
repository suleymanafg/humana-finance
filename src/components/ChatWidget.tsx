"use client";

// Floating AI-assistant launcher, bottom-right on every authenticated page.
//
// Three states: closed (round launcher) · open (panel) · minimized (small
// pill). Minimizing HIDES the panel instead of unmounting it, so an answer
// that is still streaming keeps arriving in the background and is complete
// when the panel is restored. Closing unmounts; history survives anyway in
// sessionStorage.
import { useState } from "react";
import ChatBody from "./ChatBody";
import { IconMinus, IconSparkles, IconX } from "./icons";
import { useT } from "@/lib/locale-context";

type Mode = "closed" | "open" | "min";

export default function ChatWidget({ configured }: { configured: boolean }) {
  const { locale, t } = useT();
  const ru = locale === "ru";
  const [mode, setMode] = useState<Mode>("closed");

  return (
    <>
      {mode !== "closed" && (
        <div
          className={`fixed bottom-6 right-6 z-[70] flex h-[min(640px,calc(100vh-6rem))] w-[400px] max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-[0_16px_48px_rgba(16,24,40,0.18)] ${
            mode === "min" ? "invisible" : ""
          }`}
        >
          <div className="flex items-center gap-2.5 border-b border-border bg-sidebar px-4 py-3 text-sidebar-fg-strong">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10">
              <IconSparkles size={15} />
            </span>
            <div className="min-w-0 flex-1 leading-tight">
              <div className="text-[13.5px] font-semibold">{t("navChat")}</div>
              <div className="text-[10.5px] text-sidebar-fg/70">
                {ru ? "Только чтение — ничего не меняет" : "Read-only — changes nothing"}
              </div>
            </div>
            <button
              onClick={() => setMode("min")}
              title={ru ? "Свернуть" : "Minimize"}
              className="flex h-7 w-7 items-center justify-center rounded text-sidebar-fg/70 transition-colors hover:bg-white/10 hover:text-sidebar-fg-strong"
            >
              <IconMinus size={15} />
            </button>
            <button
              onClick={() => setMode("closed")}
              title={t("close")}
              className="flex h-7 w-7 items-center justify-center rounded text-sidebar-fg/70 transition-colors hover:bg-white/10 hover:text-sidebar-fg-strong"
            >
              <IconX size={15} />
            </button>
          </div>
          <ChatBody configured={configured} />
        </div>
      )}

      {mode === "min" && (
        <button
          onClick={() => setMode("open")}
          className="fixed bottom-6 right-6 z-[71] flex items-center gap-2 rounded-full bg-sidebar py-2.5 pl-3.5 pr-4 text-[12.5px] font-semibold text-sidebar-fg-strong shadow-[0_8px_24px_rgba(16,24,40,0.3)] transition-transform hover:scale-105"
        >
          <IconSparkles size={15} />
          {t("navChat")}
        </button>
      )}

      {mode === "closed" && (
        <button
          onClick={() => setMode("open")}
          title={t("navChat")}
          className="fixed bottom-6 right-6 z-[70] flex items-center justify-center rounded-full bg-accent text-white shadow-[0_8px_24px_rgba(31,16,142,0.35)] transition-transform hover:scale-105 hover:bg-accent-hover"
          style={{ height: "3.25rem", width: "3.25rem" }}
        >
          <IconSparkles size={22} />
        </button>
      )}
    </>
  );
}
