"use client";

import { Fragment } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useT, type Bi } from "@/lib/locale-context";
import { fmtN, fmtPct } from "@/lib/format";
import { valueOver, type Statement, type StatementLine } from "@/lib/statements";
import { shortMonth, type Scale, type View } from "@/lib/statement-ui";

export interface MonthLite {
  id: string;
  nameRu: string;
  nameEn: string;
}


interface Col {
  key: string;
  label: string;
  months: string[];
  change?: [string[], string[]];
  focus?: boolean;
  open?: boolean;
}

/**
 * A financial statement. In the month view: the month, the month before, the
 * change and (for flows) the total since the first month. In the by-month view:
 * every month up to the selected one, plus the total for flows.
 */
export function StatementTable({
  statement,
  months,
  monthId,
  view,
  scale = 1,
  sinceLabel,
  openMonths = [],
}: {
  statement: Statement;
  months: MonthLite[];
  monthId: string;
  view: View;
  scale?: Scale;
  sinceLabel?: Bi;
  /** months not yet closed: marked as preliminary */
  openMonths?: string[];
}) {
  const { locale, l } = useT();
  const idx = Math.max(0, months.findIndex((m) => m.id === monthId));
  const upto = months.slice(0, idx + 1).map((m) => m.id);
  const name = (id: string) => {
    const m = months.find((x) => x.id === id);
    return m ? (locale === "ru" ? m.nameRu : m.nameEn) : id;
  };
  const flow = statement.mode === "flow";

  const open = new Set(openMonths);
  const cols: Col[] = [];
  if (view === "month") {
    cols.push({ key: "m", label: name(monthId), months: [monthId], focus: true, open: open.has(monthId) });
    if (idx > 0) {
      const prev = months[idx - 1].id;
      cols.push({ key: "p", label: name(prev), months: [prev], open: open.has(prev) });
      cols.push({ key: "d", label: locale === "ru" ? "Изменение" : "Change", months: [], change: [[monthId], [prev]] });
    }
    if (flow && upto.length > 1) {
      cols.push({
        key: "t",
        label: sinceLabel ? l(sinceLabel) : locale === "ru" ? `С ${shortMonth(upto[0], locale)}` : `Since ${shortMonth(upto[0], locale)}`,
        months: upto,
      });
    }
  } else {
    for (const m of upto) {
      cols.push({ key: m, label: shortMonth(m, locale), months: [m], focus: m === monthId, open: open.has(m) });
    }
    if (flow) cols.push({ key: "t", label: locale === "ru" ? "Итого" : "Total", months: upto });
  }

  const fmtMoney = (v: number) => {
    const scaled = v / scale;
    if (Math.abs(scaled) < (scale === 1_000_000 ? 0.05 : 0.5)) return "—";
    return fmtN(scaled, scale === 1_000_000 ? 1 : 0);
  };

  const cell = (lineDef: StatementLine, col: Col) => {
    if (lineDef.kind === "header") return null;
    if (col.change) {
      const a = valueOver(lineDef, col.change[0], statement.lines);
      const b = valueOver(lineDef, col.change[1], statement.lines);
      if (a == null || b == null) return <span className="text-muted">—</span>;
      if (lineDef.kind === "ratio") {
        const pp = (a - b) * 100;
        if (Math.abs(pp) < 0.05) return <span className="text-muted">—</span>;
        return <span className="text-muted">{`${pp > 0 ? "+" : "−"}${Math.abs(pp).toFixed(1)} ${locale === "ru" ? "пп" : "pp"}`}</span>;
      }
      const d = a - b;
      const text = lineDef.units ? (Math.abs(d) < 0.5 ? "—" : fmtN(d)) : fmtMoney(d);
      return <span className="text-muted">{text}</span>;
    }
    const v = valueOver(lineDef, col.months, statement.lines);
    if (v == null) return <span className="text-muted">—</span>;
    if (lineDef.kind === "ratio") return <span>{fmtPct(v)}</span>;
    const text = lineDef.units ? (Math.abs(v) < 0.5 ? "—" : fmtN(v)) : fmtMoney(v);
    const alert = (lineDef.kind === "check" && Math.abs(v) >= 1) || (!!lineDef.result && v < 0 && text !== "—");
    return <span className={alert ? "text-danger" : ""}>{text}</span>;
  };

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="stmt">
        <thead>
          <tr>
            <th className="sticky-col">{scaleLabel(scale, locale)}</th>
            {cols.map((c) => (
              <th key={c.key} className={c.focus ? "is-focus" : ""}>
                <div>{c.label}</div>
                {c.open && (
                  <div className="text-[10.5px] font-normal text-muted/80">
                    {locale === "ru" ? "предварительно" : "preliminary"}
                  </div>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {statement.lines.map((lineDef) => (
            <tr key={lineDef.key} className={`is-${lineDef.kind}`}>
              <td className="sticky-col">
                <span className={lineDef.indent ? "pl-4" : ""}>
                  {lineDef.href ? (
                    <Link href={lineDef.href} className="hover:text-accent hover:underline">
                      {l(lineDef.label)}
                    </Link>
                  ) : (
                    l(lineDef.label)
                  )}
                </span>
              </td>
              {cols.map((c) => (
                <td key={c.key} className={c.focus ? "is-focus" : ""}>
                  {cell(lineDef, c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function scaleLabel(scale: Scale, locale: "ru" | "en") {
  if (scale === 1000) return locale === "ru" ? "тыс. сум" : "UZS thousand";
  if (scale === 1_000_000) return locale === "ru" ? "млн сум" : "UZS million";
  return locale === "ru" ? "сум" : "UZS";
}

/** Segmented control whose options are links that set one search parameter. */
export function Segmented({
  param,
  value,
  options,
}: {
  param: string;
  value: string;
  options: Array<{ value: string; label: Bi }>;
}) {
  const { l } = useT();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <div className="inline-flex rounded-md border border-border bg-surface p-0.5">
      {options.map((o) => {
        const p = new URLSearchParams(params.toString());
        p.set(param, o.value);
        const active = o.value === value;
        return (
          <Link
            key={o.value}
            href={`${pathname}?${p.toString()}`}
            scroll={false}
            className={`rounded px-3 py-1 text-[12.5px] transition-colors ${
              active ? "bg-accent text-white" : "text-muted hover:text-foreground"
            }`}
          >
            {l(o.label)}
          </Link>
        );
      })}
    </div>
  );
}

export function Toolbar({ children }: { children: React.ReactNode }) {
  return <div className="mb-4 flex flex-wrap items-center gap-3">{children}</div>;
}

/** Plain link styled as a secondary button. */
export function ButtonLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="inline-flex h-8 items-center rounded-md border border-border bg-surface px-3 text-[12.5px] text-foreground transition-colors hover:bg-surface-low"
    >
      {children}
    </a>
  );
}

/** A compact headline figure. */
export function Figure({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  tone?: "neg";
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-surface px-4 py-3.5">
      <div className="truncate text-[12px] text-muted">{label}</div>
      <div className={`figure-num mt-1 text-[20px] font-semibold tracking-[-0.02em] ${tone === "neg" ? "text-danger" : ""}`}>
        {value}
      </div>
      {sub && <div className="mt-1 text-[12px] leading-snug text-muted">{sub}</div>}
    </div>
  );
}

export function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-4 rounded-md border border-warn/25 bg-warn-soft px-3.5 py-2.5 text-[13px] text-warn">{children}</div>
  );
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-2.5 mt-8 flex items-baseline justify-between gap-3 first:mt-0">
      <h2 className="text-[14px] font-semibold tracking-[-0.01em]">{children}</h2>
      {right}
    </div>
  );
}

/** A short document-style statement: titled sections of label · amount lines. */
export function DocTable({
  sections,
}: {
  sections: Array<{
    title: Bi;
    lines: Array<{ label: Bi; value: number | null; kind?: "line" | "subtotal" | "total" | "memo"; href?: string }>;
  }>;
}) {
  const { l } = useT();
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <table className="stmt">
        <tbody>
          {sections.map((sec, si) => (
            <Fragment key={si}>
              <tr className="is-header">
                <td colSpan={2}>{l(sec.title)}</td>
              </tr>
              {sec.lines.map((ln, li) => {
                const kind = ln.kind ?? "line";
                return (
                  <tr key={li} className={`is-${kind === "line" ? "line" : kind}`}>
                    <td>
                      <span className={kind === "line" || kind === "memo" ? "pl-4" : ""}>
                        {ln.href ? (
                          <Link href={ln.href} className="hover:text-accent hover:underline">
                            {l(ln.label)}
                          </Link>
                        ) : (
                          l(ln.label)
                        )}
                      </span>
                    </td>
                    <td className="w-48">{ln.value == null ? "—" : Math.abs(ln.value) < 0.5 ? "—" : fmtN(ln.value)}</td>
                  </tr>
                );
              })}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A select whose choice is kept in one search parameter. */
export function ParamSelect({
  param,
  value,
  options,
}: {
  param: string;
  value: string;
  options: Array<{ value: string; label: string }>;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  return (
    <select
      value={value}
      onChange={(e) => {
        const p = new URLSearchParams(params.toString());
        p.set(param, e.target.value);
        router.push(`${pathname}?${p.toString()}`, { scroll: false });
      }}
      className="h-8 rounded-md border border-border bg-surface px-2 text-[13px] outline-none focus:border-accent"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
