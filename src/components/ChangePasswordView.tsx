"use client";

// Password change. Rendered stand-alone (outside the app shell) when forced,
// because a session with a temporary password cannot reach any other page.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Card, Input } from "./ui";
import { useT } from "@/lib/locale-context";

const MIN_LENGTH = 12;

export default function ChangePasswordView({
  username,
  forced,
}: {
  username: string;
  forced: boolean;
}) {
  const { locale } = useT();
  const ru = locale === "ru";
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  async function submit() {
    setError(null);
    if (next !== repeat) {
      setError(ru ? "Пароли не совпадают" : "Passwords do not match");
      return;
    }
    if (next.length < MIN_LENGTH) {
      setError(
        ru ? `Минимум ${MIN_LENGTH} символов` : `At least ${MIN_LENGTH} characters`
      );
      return;
    }
    setBusy(true);
    const res = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentPassword: current, newPassword: next }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? `HTTP ${res.status}`);
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-10">
      <h1 className="font-display text-[22px] font-semibold">
        {forced
          ? ru
            ? "Задайте свой пароль"
            : "Set your own password"
          : ru
            ? "Смена пароля"
            : "Change password"}
      </h1>
      <p className="mb-5 mt-1.5 text-[13.5px] leading-relaxed text-muted">
        {forced
          ? ru
            ? `Вход «${username}» защищён временным паролем. Придумайте свой — временный перестанет работать.`
            : `The "${username}" account is using a temporary password. Choose your own — the temporary one stops working.`
          : ru
            ? `Вы вошли как «${username}».`
            : `Signed in as "${username}".`}
      </p>

      <Card>
        <div className="space-y-3 p-4">
          <label className="flex flex-col gap-1 text-[12px] text-muted">
            {forced
              ? ru
                ? "Временный пароль — тот же, которым вы только что вошли"
                : "Temporary password — the same one you just signed in with"
              : ru
                ? "Текущий пароль"
                : "Current password"}
            <Input
              type="password"
              value={current}
              autoComplete="current-password"
              onChange={(e) => setCurrent(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-muted">
            {ru ? "Новый пароль" : "New password"}
            <Input
              type="password"
              value={next}
              autoComplete="new-password"
              onChange={(e) => setNext(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-muted">
            {ru ? "Повторите новый пароль" : "Repeat new password"}
            <Input
              type="password"
              value={repeat}
              autoComplete="new-password"
              onKeyDown={(e) => e.key === "Enter" && submit()}
              onChange={(e) => setRepeat(e.target.value)}
            />
          </label>
          <p className="text-[11.5px] text-muted">
            {ru
              ? `Минимум ${MIN_LENGTH} символов. Не используйте пароль от других сервисов.`
              : `At least ${MIN_LENGTH} characters. Don't reuse a password from another service.`}
          </p>
          {error && <p className="text-[12.5px] text-danger">{error}</p>}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
          {forced ? (
            <button
              onClick={signOut}
              className="text-[12.5px] text-muted transition-colors hover:text-danger"
            >
              {ru ? "Выйти" : "Sign out"}
            </button>
          ) : (
            <Link href="/" className="text-[12.5px] text-muted transition-colors hover:text-accent">
              ← {ru ? "Назад в приложение" : "Back to the app"}
            </Link>
          )}
          <Button onClick={submit} disabled={busy || !current || !next || !repeat}>
            {busy ? (ru ? "Сохранение…" : "Saving…") : ru ? "Сохранить пароль" : "Save password"}
          </Button>
        </div>
      </Card>
    </main>
  );
}
