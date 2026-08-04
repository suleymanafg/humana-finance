"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/locale-context";
import { Button, Input } from "@/components/ui";

export default function LoginPage() {
  const { t, locale, setLocale } = useT();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(false);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    setBusy(false);
    if (res.ok) {
      router.push("/");
      router.refresh();
    } else {
      setError(true);
    }
  }

  return (
    <div className="auth-bg flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-7 shadow-[0_8px_30px_-6px_rgba(16,24,40,0.12)]">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#5b6cff] to-[#3a4bd4] text-xl font-bold text-white shadow-[0_4px_14px_rgba(70,87,224,0.4)]">
            H
          </div>
          <div>
            <div className="text-[16px] font-semibold tracking-[-0.01em]">Humana Uzbekistan</div>
            <div className="mt-0.5 text-[12.5px] text-muted">Turbo Impex + Fargo — P&L</div>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="mb-1 block text-[12px] font-medium text-muted">{t("username")}</label>
            <Input value={username} onChange={(e) => setUsername(e.target.value)} className="w-full" autoFocus />
          </div>
          <div>
            <label className="mb-1 block text-[12px] font-medium text-muted">{t("password")}</label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full"
            />
          </div>
          {error && <div className="text-[12px] text-danger">{t("invalidCredentials")}</div>}
          <Button type="submit" disabled={busy} className="w-full justify-center">
            {t("login")}
          </Button>
        </form>
        <div className="mt-4 flex justify-center gap-1">
          {(["ru", "en"] as const).map((l) => (
            <button
              key={l}
              onClick={() => setLocale(l)}
              className={`rounded-md px-2 py-0.5 text-[12px] uppercase ${
                locale === l ? "bg-accent-soft text-accent" : "text-muted"
              }`}
            >
              {l}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
