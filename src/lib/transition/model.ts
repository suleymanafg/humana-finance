// Vocabulary of the distribution handover (Fargo → Turbo Impex): workstreams,
// statuses, routes. Pure data, safe to import from client and server code.
// Labels are bilingual like the rest of the app, Russian first.
export type Bi = { ru: string; en: string };
export type Tone = "neutral" | "ok" | "warn" | "accent" | "danger";

interface Option {
  label: Bi;
  tone?: Tone;
}

export const TR_STREAMS: Array<{ key: string; label: Bi; desc: Bi }> = [
  {
    key: "agreement",
    label: { ru: "Договорённости с Fargo", en: "Agreement with Fargo" },
    desc: { ru: "Условия передачи, расчёты, данные от Fargo", en: "Handover terms, settlement, data from Fargo" },
  },
  {
    key: "chains",
    label: { ru: "Сети", en: "Retail chains" },
    desc: { ru: "Регистрация TI поставщиком, договоры, переключение", en: "TI as supplier, contracts, switch" },
  },
  {
    key: "regions",
    label: { ru: "Регионы и дилеры", en: "Regions and dealers" },
    desc: { ru: "Маршрут и дата перехода по каждому региону", en: "Route and switch date for each region" },
  },
  {
    key: "outlets",
    label: { ru: "Торговые точки", en: "Outlets" },
    desc: { ru: "Договоры TI с каждой точкой, кредитная политика", en: "TI agreements with every outlet, credit policy" },
  },
  {
    key: "stock",
    label: { ru: "Товар и выкуп", en: "Stock and buyback" },
    desc: { ru: "Остатки Fargo по партиям, сроки годности, выкуп", en: "Fargo's stock by batch, expiry, buyback" },
  },
  {
    key: "operations",
    label: { ru: "SmartUp и операции", en: "SmartUp and operations" },
    desc: { ru: "Учёт, склад, доставка, бэк-офис", en: "System, warehouse, delivery, back office" },
  },
  {
    key: "team",
    label: { ru: "Команда", en: "Team" },
    desc: { ru: "Торговые агенты, связка с медпредставителями", en: "Sales agents, link with the MR team" },
  },
  {
    key: "finance",
    label: { ru: "Финансы", en: "Finance" },
    desc: { ru: "Оборотный капитал, дебиторка, отчётность партнёру", en: "Working capital, receivables, partner reporting" },
  },
  {
    key: "comms",
    label: { ru: "Коммуникации", en: "Communication" },
    desc: { ru: "Humana HQ, клиенты, команда", en: "Humana HQ, customers, team" },
  },
  {
    key: "app",
    label: { ru: "Это приложение", en: "This app" },
    desc: { ru: "Переход данных с 1С Fargo на продажи TI", en: "Moving data from Fargo's 1C to TI's sales" },
  },
];

export const streamLabel = (key: string): Bi =>
  TR_STREAMS.find((s) => s.key === key)?.label ?? { ru: key, en: key };

export const TASK_STATUS: Record<string, Option> = {
  TODO: { label: { ru: "Не начато", en: "To do" }, tone: "neutral" },
  DOING: { label: { ru: "В работе", en: "In progress" }, tone: "accent" },
  BLOCKED: { label: { ru: "Заблокировано", en: "Blocked" }, tone: "danger" },
  DONE: { label: { ru: "Готово", en: "Done" }, tone: "ok" },
  DROPPED: { label: { ru: "Отменено", en: "Dropped" }, tone: "neutral" },
};
/** a task that no longer needs work */
export const isClosedTask = (status: string) => status === "DONE" || status === "DROPPED";

export const PRIORITY: Record<string, Option> = {
  URGENT: { label: { ru: "Срочно", en: "Urgent" }, tone: "danger" },
  HIGH: { label: { ru: "Высокий", en: "High" }, tone: "warn" },
  NORMAL: { label: { ru: "Обычный", en: "Normal" }, tone: "neutral" },
};

export const ROUTES: Record<string, Option> = {
  UNDECIDED: { label: { ru: "Не решено", en: "Undecided" }, tone: "warn" },
  TI_AGENTS: { label: { ru: "Агенты TI", en: "TI agents" }, tone: "accent" },
  NUTRIBEN_DEALER: { label: { ru: "Дилер Nutriben", en: "Nutriben dealer" }, tone: "accent" },
  FARGO_DEALER: { label: { ru: "Дилер Fargo напрямую", en: "Fargo's dealer, direct" }, tone: "accent" },
  CHAIN_DIRECT: { label: { ru: "Сеть напрямую", en: "Chain, direct" }, tone: "accent" },
};

export const REGION_KINDS: Record<string, Option> = {
  REGION: { label: { ru: "Регион", en: "Region" } },
  CHAIN: { label: { ru: "Сеть", en: "Chain" } },
  OTHER: { label: { ru: "Прочее", en: "Other" } },
};

export const REGION_STATUS: Record<string, Option> = {
  NOT_STARTED: { label: { ru: "Не начато", en: "Not started" }, tone: "neutral" },
  PREPARING: { label: { ru: "Подготовка", en: "Preparing" }, tone: "accent" },
  READY: { label: { ru: "Готов к переходу", en: "Ready to switch" }, tone: "accent" },
  SWITCHED: { label: { ru: "Переведён на TI", en: "Switched to TI" }, tone: "ok" },
};

export const OUTLET_TYPES: Record<string, Option> = {
  SHOP: { label: { ru: "Магазин", en: "Shop" } },
  PHARMACY: { label: { ru: "Аптека", en: "Pharmacy" } },
  CHAIN: { label: { ru: "Сеть", en: "Chain" } },
  DEALER: { label: { ru: "Дилер", en: "Dealer" } },
  OTHER: { label: { ru: "Прочее", en: "Other" } },
};

/** the outlet funnel, in order */
export const OUTLET_STATUS: Record<string, Option> = {
  TO_CONTACT: { label: { ru: "Связаться", en: "To contact" }, tone: "neutral" },
  CONTACTED: { label: { ru: "На связи", en: "Contacted" }, tone: "neutral" },
  CONTRACT_SENT: { label: { ru: "Договор отправлен", en: "Contract sent" }, tone: "accent" },
  SIGNED: { label: { ru: "Договор подписан", en: "Contract signed" }, tone: "ok" },
  FIRST_ORDER: { label: { ru: "Первый заказ TI", en: "First TI order" }, tone: "ok" },
  LOST: { label: { ru: "Потерян", en: "Lost" }, tone: "danger" },
  INACTIVE: { label: { ru: "Не активен", en: "Inactive" }, tone: "neutral" },
};
/** outlets that can buy from TI */
export const isSignedOutlet = (status: string) => status === "SIGNED" || status === "FIRST_ORDER";

export const LOT_STATUS: Record<string, Option> = {
  COUNTED: { label: { ru: "Посчитано", en: "Counted" }, tone: "neutral" },
  AGREED: { label: { ru: "Согласовано", en: "Agreed" }, tone: "accent" },
  MOVED: { label: { ru: "Принято на склад TI", en: "Received by TI" }, tone: "ok" },
  WRITTEN_OFF: { label: { ru: "Списано", en: "Written off" }, tone: "danger" },
};

export const DECISION_STATUS: Record<string, Option> = {
  OPEN: { label: { ru: "Открыто", en: "Open" }, tone: "warn" },
  DECIDED: { label: { ru: "Решено", en: "Decided" }, tone: "ok" },
};

/** options for a <select> in the current language */
export const optionsOf = (map: Record<string, Option>, locale: "ru" | "en") =>
  Object.entries(map).map(([value, o]) => ({ value, label: o.label[locale] }));

/** Setting keys owned by this module. */
export const SETTING_GO_LIVE = "transition.goLive";
export const SETTING_BRIEF = "transition.brief";
export const DEFAULT_GO_LIVE = "2027-01-01";

/** a stored Date as YYYY-MM-DD, or "" */
export const ymd = (d: Date | string | null | undefined): string =>
  !d ? "" : typeof d === "string" ? d.slice(0, 10) : Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);

/** today as YYYY-MM-DD in Tashkent (UTC+5), where the business runs */
export function todayYmd(now = new Date()): string {
  return new Date(now.getTime() + 5 * 3600_000).toISOString().slice(0, 10);
}

/** whole days from a to b (YYYY-MM-DD strings) */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** Normalised name for matching outlets and items across files. */
export const normName = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[«»"'`]/g, "")
    .replace(/\s+/g, " ");
