// The app's structure: sections in the sidebar, pages as tabs inside a section.
import type { Role } from "./auth-crypto";

export type Bi = { ru: string; en: string };

export interface NavPage {
  href: string;
  label: Bi;
}

export interface NavSection {
  key: string;
  label: Bi;
  pages: NavPage[];
  adminOnly?: boolean;
  /** the section renders its own header (supply planning) */
  ownHeader?: boolean;
  group: "main" | "admin";
}

export const SECTIONS: NavSection[] = [
  {
    key: "overview",
    label: { ru: "Обзор", en: "Overview" },
    group: "main",
    pages: [{ href: "/", label: { ru: "Обзор", en: "Overview" } }],
  },
  {
    key: "statements",
    label: { ru: "Отчётность", en: "Statements" },
    group: "main",
    pages: [
      { href: "/statements/pnl", label: { ru: "Прибыли и убытки", en: "Profit and loss" } },
      { href: "/statements/balance", label: { ru: "Баланс", en: "Balance sheet" } },
    ],
  },
  {
    key: "settlement",
    label: { ru: "Расчёты с Fargo", en: "Settlement with Fargo" },
    group: "main",
    pages: [
      { href: "/settlement", label: { ru: "Итог", en: "Summary" } },
      { href: "/settlement/monthly", label: { ru: "По месяцам", en: "By month" } },
      { href: "/settlement/payments", label: { ru: "Платежи Fargo", en: "Payments from Fargo" } },
      { href: "/settlement/receivables", label: { ru: "Дебиторская задолженность", en: "Receivables" } },
    ],
  },
  {
    key: "sales",
    label: { ru: "Продажи", en: "Sales" },
    group: "main",
    pages: [
      { href: "/sales", label: { ru: "Обзор", en: "Overview" } },
      { href: "/sales/products", label: { ru: "Товары", en: "Products" } },
      { href: "/sales/channels", label: { ru: "Каналы", en: "Channels" } },
      { href: "/sales/data", label: { ru: "Данные", en: "Data" } },
    ],
  },
  {
    key: "goods",
    label: { ru: "Товар", en: "Goods" },
    group: "main",
    pages: [
      { href: "/goods/shipments", label: { ru: "Поставки", en: "Shipments" } },
      { href: "/goods/invoices", label: { ru: "Счета-фактуры TI", en: "TI invoices" } },
      { href: "/goods/stock", label: { ru: "Остатки", en: "Stock" } },
      { href: "/goods/fifo", label: { ru: "Себестоимость FIFO", en: "FIFO cost" } },
      { href: "/goods/write-offs", label: { ru: "Списания", en: "Write-offs" } },
    ],
  },
  {
    key: "expenses",
    label: { ru: "Расходы", en: "Expenses" },
    group: "main",
    pages: [
      { href: "/expenses/ti", label: { ru: "Turbo Impex", en: "Turbo Impex" } },
      { href: "/expenses/fargo", label: { ru: "Fargo", en: "Fargo" } },
    ],
  },
  {
    key: "taxes",
    label: { ru: "Налоги", en: "Taxes" },
    group: "main",
    pages: [
      { href: "/taxes/fargo-vat", label: { ru: "НДС Fargo", en: "Fargo VAT" } },
      { href: "/taxes/ti-vat", label: { ru: "НДС Turbo Impex", en: "Turbo Impex VAT" } },
      { href: "/taxes/profit", label: { ru: "Налог на прибыль", en: "Profit tax" } },
    ],
  },
  {
    key: "funding",
    label: { ru: "Финансирование", en: "Funding" },
    group: "main",
    pages: [
      { href: "/funding/capital", label: { ru: "Капитал", en: "Capital" } },
      { href: "/funding/loans", label: { ru: "Займы", en: "Loans" } },
      { href: "/funding/previous-owner", label: { ru: "Прежний владелец", en: "Previous owner" } },
      { href: "/funding/other", label: { ru: "Прочие поступления", en: "Other receipts" } },
      { href: "/funding/balances", label: { ru: "Денежные остатки", en: "Cash balances" } },
    ],
  },
  {
    key: "close",
    label: { ru: "Закрытие месяца", en: "Month close" },
    group: "main",
    pages: [{ href: "/close", label: { ru: "Закрытие месяца", en: "Month close" } }],
  },
  {
    key: "planning",
    label: { ru: "Планирование закупок", en: "Supply planning" },
    group: "main",
    adminOnly: true,
    ownHeader: true,
    pages: [{ href: "/planning", label: { ru: "Планирование закупок", en: "Supply planning" } }],
  },
  {
    key: "admin",
    label: { ru: "Администрирование", en: "Administration" },
    group: "admin",
    adminOnly: true,
    pages: [
      { href: "/settings", label: { ru: "Справочники", en: "Reference data" } },
      { href: "/health", label: { ru: "Проверки данных", en: "Data checks" } },
      { href: "/requests", label: { ru: "Запросы данных", en: "Data requests" } },
    ],
  },
];

const matches = (pathname: string, href: string) =>
  href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");

/** The section a path belongs to, and the page (longest matching link) within it. */
export function locate(pathname: string): { section: NavSection | null; page: NavPage | null } {
  let best: { section: NavSection; page: NavPage } | null = null;
  for (const section of SECTIONS) {
    for (const page of section.pages) {
      if (matches(pathname, page.href) && (!best || page.href.length > best.page.href.length)) {
        best = { section, page };
      }
    }
  }
  return best ?? { section: null, page: null };
}

export const visibleSections = (role: Role) =>
  SECTIONS.filter((s) => !s.adminOnly || role === "ADMIN");
