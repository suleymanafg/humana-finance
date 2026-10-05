"use client";

// Hand-rolled UI kit (no component library dependency).
import { useEffect } from "react";
import { fmtN, fmtPct, groupTyped, numberInputText, parseNum } from "@/lib/format";
import { IconX } from "./icons";

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`quiet-card ${className}`}>{children}</div>;
}

export function CardHeader({
  title,
  desc,
  right,
}: {
  title: React.ReactNode;
  desc?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
      <div className="min-w-0">
        <h2 className="text-[13px] font-semibold tracking-[-0.01em]">{title}</h2>
        {desc && <p className="mt-0.5 text-[12px] leading-snug text-muted">{desc}</p>}
      </div>
      {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
    </div>
  );
}

export function PageTitle({
  title,
  subtitle,
  right,
}: {
  title: React.ReactNode;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="font-display text-[24px] font-semibold tracking-[-0.01em]">{title}</h1>
        {subtitle && <p className="mt-1 max-w-xl text-[13.5px] leading-snug text-muted">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2">{right}</div>
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = "primary",
  type = "button",
  disabled,
  className = "",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  type?: "button" | "submit";
  disabled?: boolean;
  className?: string;
}) {
  const styles = {
    primary: "bg-accent text-white hover:bg-accent-hover",
    secondary: "border border-border bg-surface text-foreground hover:bg-surface-low",
    danger: "text-danger hover:bg-danger-soft",
    ghost: "text-muted hover:bg-surface-low hover:text-foreground",
  }[variant];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-9 items-center gap-1.5 rounded px-3.5 text-[13px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

export function IconButton({
  children,
  onClick,
  title,
  tone = "neutral",
  className = "",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  title?: string;
  tone?: "neutral" | "danger" | "accent";
  className?: string;
}) {
  const styles = {
    neutral: "text-muted hover:bg-background hover:text-foreground",
    danger: "text-muted hover:bg-danger-soft hover:text-danger",
    accent: "text-muted hover:bg-accent-soft hover:text-accent",
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

/** A text box; `numeric` or `fraction` makes it a NumberInput. */
export function Input({ numeric, fraction, ...props }: InputProps & { numeric?: boolean; fraction?: boolean }) {
  const className = `h-8 rounded-lg border border-border bg-surface px-2.5 text-[13px] shadow-[0_1px_2px_rgba(16,24,40,0.04)] outline-none transition-shadow placeholder:text-muted/60 focus:border-accent focus:ring-[3px] focus:ring-accent-soft disabled:bg-background disabled:text-muted ${props.className ?? ""}`;
  return numeric || fraction ? (
    <NumberInput {...props} fraction={fraction} className={className} />
  ) : (
    <input {...props} className={className} />
  );
}

/**
 * A box for amounts: digits are grouped with commas as they are typed
 * ("10000000" shows as "10,000,000") and "." is the decimal mark. It replaces
 * <input> as is: value, defaultValue and the handlers get the grouped text,
 * which parseNum reads. In a `fraction` box (rates, EUR prices) a typed comma
 * is the decimal mark, as on a Russian keyboard; elsewhere commas only group.
 * With `step`, the arrow keys add or take away a step.
 */
export function NumberInput({ fraction = false, value, defaultValue, onChange, onKeyDown, onPaste, ...props }: InputProps & { fraction?: boolean }) {
  const shown = (v: InputProps["value"]) =>
    v === undefined ? undefined : typeof v === "number" ? numberInputText(v) : groupTyped(String(v ?? ""));
  return (
    <input
      {...props}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={shown(value)}
      defaultValue={shown(defaultValue)}
      onChange={(e) => {
        regroup(e.currentTarget, fraction ? (e.nativeEvent as InputEvent).data : null);
        onChange?.(e);
      }}
      onKeyDown={(e) => {
        stepOrSkipComma(e, props.step, props.min);
        onKeyDown?.(e);
      }}
      onPaste={(e) => {
        pasteNumber(e);
        onPaste?.(e);
      }}
    />
  );
}

/** Groups the box's text again after a keystroke, keeping the caret after the same digit. */
function regroup(el: HTMLInputElement, typed: string | null | undefined) {
  let raw = el.value;
  const caret = el.selectionStart ?? raw.length;
  if (typed === "," && raw[caret - 1] === "," && !raw.includes(".")) raw = `${raw.slice(0, caret - 1)}.${raw.slice(caret)}`;
  const text = groupTyped(raw);
  if (text === el.value) return;
  let pos = text.length;
  for (let after = raw.slice(caret).replace(/[^\d.]/g, "").length; after > 0 && pos > 0; ) {
    if (/[\d.]/.test(text[--pos])) after--;
  }
  while (pos > 0 && text[pos - 1] === ",") pos--;
  el.value = text;
  el.setSelectionRange(pos, pos);
}

function stepOrSkipComma(e: React.KeyboardEvent<HTMLInputElement>, step: InputProps["step"], min: InputProps["min"]) {
  const el = e.currentTarget;
  if (el.readOnly || el.disabled) return;
  if (step && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
    e.preventDefault();
    const next = (parseNum(el.value) ?? 0) + (e.key === "ArrowUp" ? 1 : -1) * Number(step);
    setTyped(el, numberInputText(min === undefined || min === "" ? next : Math.max(Number(min), next)));
    return;
  }
  const at = el.selectionStart;
  if (at === null || at !== el.selectionEnd) return;
  // deleting next to a comma deletes the digit beyond it
  if (e.key === "Backspace" && el.value[at - 1] === ",") el.setSelectionRange(at - 1, at - 1);
  if (e.key === "Delete" && el.value[at] === ",") el.setSelectionRange(at + 1, at + 1);
}

/** A pasted "1 482 000", "1,482,000" or "1,5" goes in as the number it is. */
function pasteNumber(e: React.ClipboardEvent<HTMLInputElement>) {
  const el = e.currentTarget;
  const n = parseNum(e.clipboardData.getData("text"));
  if (n === null || el.readOnly || el.disabled) return;
  e.preventDefault();
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? start;
  setTyped(el, `${el.value.slice(0, start)}${numberInputText(n)}${el.value.slice(end)}`);
}

/** Puts text in the box the way typing does, so onChange handlers see it. */
function setTyped(el: HTMLInputElement, text: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(el, text);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`h-8 cursor-pointer rounded-lg border border-border bg-surface px-2 text-[13px] shadow-[0_1px_2px_rgba(16,24,40,0.04)] outline-none transition-shadow focus:border-accent focus:ring-[3px] focus:ring-accent-soft ${props.className ?? ""}`}
    />
  );
}

/** Right-aligned tabular number, negatives red + in parentheses. */
export function Num({
  v,
  decimals = 0,
  strong = false,
  className = "",
}: {
  v: number | null | undefined;
  decimals?: number;
  strong?: boolean;
  className?: string;
}) {
  const negative = (v ?? 0) < 0;
  return (
    <span className={`num ${negative ? "text-danger" : ""} ${strong ? "font-semibold" : ""} ${className}`}>
      {fmtN(v, decimals)}
    </span>
  );
}

export function Pct({ v, className = "" }: { v: number | null | undefined; className?: string }) {
  const negative = (v ?? 0) < 0;
  return <span className={`num ${negative ? "text-danger" : ""} ${className}`}>{fmtPct(v)}</span>;
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "ok" | "warn" | "accent" | "danger";
}) {
  const styles = {
    neutral: "bg-background text-muted border border-border",
    ok: "bg-ok-soft text-ok border border-ok/15",
    warn: "bg-warn-soft text-warn border border-warn/15",
    accent: "bg-accent-soft text-accent border border-accent/15",
    danger: "bg-danger-soft text-danger border border-danger/15",
  }[tone];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-[1px] text-[11px] font-medium leading-5 ${styles}`}
    >
      {children}
    </span>
  );
}

export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className={`max-h-[85vh] w-full ${wide ? "max-w-4xl" : "max-w-lg"} overflow-auto rounded-2xl border border-border bg-surface shadow-[0_20px_50px_-12px_rgba(16,24,40,0.35)]`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-surface px-5 py-3.5">
          <h3 className="text-[14px] font-semibold tracking-[-0.01em]">{title}</h3>
          <IconButton onClick={onClose} title="Esc">
            <IconX size={16} />
          </IconButton>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-background text-muted">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7">
          <path d="M4 7h16M4 12h16M4 17h10" strokeLinecap="round" />
        </svg>
      </div>
      <div className="text-[13px] text-muted">{text}</div>
    </div>
  );
}
