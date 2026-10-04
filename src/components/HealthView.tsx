"use client";

import Link from "next/link";
import { Card } from "./ui";
import { IconAlert, IconCheck } from "./icons";
import { useT } from "@/lib/locale-context";
import { dict, type DictKey } from "@/lib/i18n";
import type { HealthCheck } from "@/lib/engine/types";

export default function HealthView({ checks }: { checks: HealthCheck[] }) {
  const { t, locale } = useT();
  const warns = checks.filter((c) => c.status === "warn" && c.severity === "warn");
  const infos = checks.filter((c) => c.status === "warn" && c.severity === "info");
  const oks = checks.filter((c) => c.status === "ok");

  const title = (key: string): string => {
    const k = `hc_${key}` as DictKey;
    return k in dict ? t(k) : key;
  };

  const Item = ({ c }: { c: HealthCheck }) => (
    <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-3.5 last:border-0">
      <div className="flex min-w-0 items-start gap-3">
        <span
          className={`mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
            c.status === "ok"
              ? "bg-ok-soft text-ok"
              : c.severity === "info"
                ? "bg-surface-low text-muted"
                : "bg-warn-soft text-warn"
          }`}
        >
          {c.status === "ok" ? <IconCheck size={13} /> : <IconAlert size={13} />}
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium leading-6">{title(c.key)}</span>
            {c.count > 0 && (
              <span
                className={`rounded-full px-1.5 text-[11px] font-semibold leading-5 ${
                  c.severity === "info" ? "bg-surface-low text-muted" : "bg-warn-soft text-warn"
                }`}
              >
                {c.count}
              </span>
            )}
          </div>
          {c.details.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-[12px] text-muted">
              {c.details.map((d, i) => (
                <li key={i} className="truncate">
                  · {d}
                </li>
              ))}
              {c.count > c.details.length && <li>… +{c.count - c.details.length}</li>}
            </ul>
          )}
        </div>
      </div>
      <Link
        href={c.href}
        className="shrink-0 rounded-md px-2 py-1 text-[12px] font-medium text-accent transition-colors hover:bg-accent-soft"
      >
        {t("goTo")} →
      </Link>
    </div>
  );

  const group = (title: { ru: string; en: string }, list: HealthCheck[]) =>
    list.length > 0 && (
      <section className="mb-6">
        <h2 className="mb-2 text-[14px] font-semibold">
          {title[locale]} <span className="font-normal text-muted">{list.length}</span>
        </h2>
        <Card>
          {list.map((c) => (
            <Item key={c.key} c={c} />
          ))}
        </Card>
      </section>
    );

  return (
    <div>
      {group({ ru: "Требуют внимания", en: "Need attention" }, warns)}
      {group({ ru: "Для сведения", en: "For information" }, infos)}
      {group({ ru: "В порядке", en: "In order" }, oks)}
    </div>
  );
}
