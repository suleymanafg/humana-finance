// 1C (pinetrade) sales API sync: fetch a period, match SKUs, classify channels,
// preview vs current data, commit as a full-snapshot replace of the month.
//
// Endpoint: https://db.mobi-c.uz/pinetrade/hs/sales/api/v1/sales?dateFrom&dateTo
// HTTP Basic auth; credentials are entered by the admin at load time and used
// for one server-side request only — never stored, never sent to the browser.
//
// The API returns quantities only (no amounts), so synced Sale rows keep
// amount=null and the engine values them at the Settings price. Months imported
// from Excel carry exact invoiced amounts — replacing such a month is allowed
// but flagged loudly in the preview.
//
// SKU matching (in order): КодСКЮ → Product.codeSales1c; СКЮ → Product.article;
// СКЮ → product name. The pinetrade КодСКЮ space (96597…) is unrelated to the
// main 1C Код (00-xxx). Name/артикул matches on products without a stored
// codeSales1c are auto-learned on commit.
//
// Channel classifier (agreed 2026-07-30):
//   1) Район present: Tashkent-region towns → «Ташкентская область»;
//      city districts / «Ташкент» → «г. Ташкент»; region names → that region.
//   2) Blank/unrecognized район but recognizable client name (chains,
//      region-named филиалы) → that channel. Optional — one switch to disable.
//   3) Otherwise → «Прочие», with every such client listed in the sync report
//      for later manual reassignment.
//
// This module is pure (no DB) — buildSync/commitSync live in sync-1c.ts.

export interface Api1cItem {
  Дата: string;
  ТипОперации: string; // "Продажа" | "Возврат"
  НомерДокумента: string;
  КодСКЮ: string | number;
  СКЮ: string;
  Контрагент: string;
  КодКонтрагента: string;
  КодВыгрузки: string;
  Район: string | null;
  Количество: number;
  ЕдиницаИзмерения: string;
}

interface Api1cResponse {
  status: string;
  dateFrom: string;
  dateTo: string;
  count: number;
  countSales: number;
  countReturns: number;
  items: Api1cItem[];
}

const API_URL = "https://db.mobi-c.uz/pinetrade/hs/sales/api/v1/sales";

export class SyncError extends Error {
  constructor(
    message: string,
    public code: "AUTH" | "HTTP" | "NETWORK" | "BADDATA"
  ) {
    super(message);
  }
}

export async function fetch1cSales(
  dateFrom: string,
  dateTo: string,
  login: string,
  password: string
): Promise<Api1cResponse> {
  const url = `${API_URL}?dateFrom=${dateFrom}&dateTo=${dateTo}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(90_000),
    });
  } catch (e) {
    throw new SyncError(
      `Сервер 1С недоступен: ${e instanceof Error ? e.message : String(e)}`,
      "NETWORK"
    );
  }
  if (res.status === 401 || res.status === 403)
    throw new SyncError("1С отклонила логин или пароль", "AUTH");
  if (!res.ok) throw new SyncError(`Ошибка 1С: HTTP ${res.status}`, "HTTP");
  const body = (await res.json().catch(() => null)) as Api1cResponse | null;
  if (!body || !Array.isArray(body.items))
    throw new SyncError("Неожиданный формат ответа 1С (нет items)", "BADDATA");
  return body;
}

// ─────────────────────── channel classifier ───────────────────────

export const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ").replace(/ё/g, "е");

// Tashkent-region towns/markers — checked BEFORE the city, since bare
// "ташкент" is a substring of "ташкентская".
const TASH_REGION = [
  "ташкентская обл", "таш обл", "таш.обл", "ташобл", "чирчик", "кибрай",
  "газалкент", "тойтепа", "янгиюл", "алмалык", "ангрен", "бекабад",
  "нурафшан", "пскент", "паркент", "зангиата", "чиноз", "бустонлик",
];
// 12 city districts (stems, after ё→е normalization) + the city itself
const TASH_CITY = [
  "алмазар", "бектемир", "мирабад", "мирзо", "сергели", "учтепа",
  "чиланзар", "шайхантахур", "шайхантаур", "юнусабад", "яккасарай",
  "яшнабад", "янгихает", "ташкент",
];
// region keyword → exact channel name in the DB
const REGIONS: Array<[string[], string]> = [
  [["самарканд", "каттакурган"], "Самарканд"],
  [["кашкадар", "карши", "шахрисабз"], "Кашкадарья"],
  [["наманган", "чуст"], "Наманган"],
  [["андижан"], "Андижан"],
  [["фергана", "фаргона", "коканд", "маргилан"], "Фергана"],
  [["бухара", "бухоро"], "Бухара"],
  [["джизак", "жиззах"], "Джизак"],
  [["хорезм", "ургенч", "хива"], "Хорезм"],
  [["навои", "зарафшан"], "Навои"],
  [["сурхандар", "сурхон", "термез"], "Сурхандарья"],
];
// client-name keyword → exact channel name (step 2; chains checked first)
const CLIENTS: Array<[string[], string]> = [
  [["корзинка", "korzinka", "angelsey", "анор пойтахт"], "Korzinka"],
  [["makro", "макро"], "Makro"],
  [["митвой", "mittivoy"], "Митвой (Mittivoy)"],
  [["uzum", "узум"], "Uzum Market"],
  [["pepito", "пепито"], "Pepito"],
  [["vikiton", "викитон"], "Vikiton"],
  [["kidimart", "кидимарт"], "Kidimart"],
  [["bi1", "new retail", "нью ритейл"], "Bi1 / New Retail"],
  [["galmart", "галмарт"], "Galmart"],
  [["city farm", "сити фарм"], "City Farm"],
  [["bio plus", "био плюс"], "Bio Plus Farm"],
  [["bigmag", "бигмаг"], "Bigmag"],
  [["бондюэль", "бондюель", "bonduel"], "Дилеры Бондюэль"],
  [["darvoza", "дарвоза"], "DARVOZA SAVDO"],
  [["тиин", "tiin"], "ТИИН ОПТОМ"],
  [["turbo", "турбо"], "Внутреннее"],
];

// Canonical Tashkent-city district names, keyed by the same stems the
// classifier matches. Used by the geography export to split «г. Ташкент».
const TASH_DISTRICTS: Array<[string, string]> = [
  ["алмазар", "Алмазарский район"],
  ["бектемир", "Бектемирский район"],
  ["мирабад", "Мирабадский район"],
  ["мирзо", "Мирзо-Улугбекский район"],
  ["сергели", "Сергелийский район"],
  ["учтепа", "Учтепинский район"],
  ["чиланзар", "Чиланзарский район"],
  ["шайхантахур", "Шайхантахурский район"],
  ["шайхантаур", "Шайхантахурский район"],
  ["юнусабад", "Юнусабадский район"],
  ["яккасарай", "Яккасарайский район"],
  ["яшнабад", "Яшнабадский район"],
  ["янгихает", "Янгихаётский район"],
];

/** Canonical Tashkent-city district for a raw 1C «Район» value, or null. */
export function tashkentDistrictOf(rayon: string | null | undefined): string | null {
  const r = norm(rayon ?? "");
  if (!r) return null;
  for (const [stem, name] of TASH_DISTRICTS) if (r.includes(stem)) return name;
  return null;
}

export type ClassifyRule = "manual" | "district" | "region" | "client" | "fallback";

/** Returns the DB channel name + which rule fired.
 *  `manual` maps norm(client) → channel name (admin assignments from the
 *  client registry) and beats every keyword rule. */
export function classifyChannel(
  rayon: string | null | undefined,
  client: string,
  byClientName: boolean,
  manual?: Map<string, string>
): { channel: string; rule: ClassifyRule } {
  const manualChannel = manual?.get(norm(client));
  if (manualChannel) return { channel: manualChannel, rule: "manual" };
  const r = norm(rayon ?? "");
  if (r) {
    if (TASH_REGION.some((k) => r.includes(k)))
      return { channel: "Ташкентская область", rule: "region" };
    if (TASH_CITY.some((k) => r.includes(k))) return { channel: "г. Ташкент", rule: "district" };
    for (const [keys, name] of REGIONS)
      if (keys.some((k) => r.includes(k))) return { channel: name, rule: "region" };
  }
  if (byClientName) {
    const c = norm(client);
    for (const [keys, name] of CLIENTS)
      if (keys.some((k) => c.includes(k))) return { channel: name, rule: "client" };
    if (TASH_REGION.some((k) => c.includes(k)))
      return { channel: "Ташкентская область", rule: "client" };
    for (const [keys, name] of REGIONS)
      if (keys.some((k) => c.includes(k))) return { channel: name, rule: "client" };
  }
  return { channel: "Прочие", rule: "fallback" };
}

// ─────────────────────── preview / commit ───────────────────────

export interface SyncProductRow {
  productId: string;
  name: string;
  qtyNew: number;
  qtyCur: number;
  salesDocs: number;
  returnDocs: number;
}
export interface SyncChannelRow {
  channelId: string;
  name: string;
  qty: number;
  clients: number;
}
export interface SyncReport {
  monthId: string;
  dateFrom: string;
  dateTo: string;
  fetched: { total: number; sales: number; returns: number; outsidePeriod: number };
  products: SyncProductRow[];
  channels: SyncChannelRow[];
  byRule: Record<ClassifyRule, number>; // net qty per classifier rule
  fallbackClients: Array<{ client: string; qty: number; docs: number }>;
  unknownSkus: Array<{ code: string; name: string; qty: number }>;
  learnedCodes: Array<{ code: string; product: string }>;
  negativeKeys: Array<{ product: string; channel: string; qty: number }>;
  current: { rows: number; qty: number; withAmount: number; sources: string[] };
  committed?: { deleted: number; inserted: number };
}

// Reconciliation: quantity-only comparison of the whole loaded period against
// 1C (the API carries no amounts). Read-only — changes nothing.
export interface ReconcileMonthRow {
  monthId: string;
  appQty: number;
  apiQty: number;
  // per-SKU rows only where the two sides differ
  products: Array<{ name: string; appQty: number; apiQty: number }>;
}
export interface ReconcileReport {
  dateFrom: string;
  dateTo: string;
  fetchedTotal: number;
  months: ReconcileMonthRow[];
  // SKUs outside the approved range — excluded on BOTH sides, listed for transparency
  unknownSkus: Array<{ code: string; name: string; qty: number }>;
}

// Batch replace: every loaded month is re-synced from 1C in one operation
// (owner decision 2026-07-31: pinetrade 1C is the source of truth; Excel
// amounts from Fargo's extension are discarded, revenue = qty × Settings price).
export interface BatchSyncMonthRow {
  monthId: string;
  qtyCur: number;
  qtyNew: number;
  deleted: number;
  inserted: number;
}
export interface BatchSyncReport {
  dateFrom: string;
  dateTo: string;
  months: BatchSyncMonthRow[];
  skipped: string[]; // app months with data but nothing from 1C — left untouched
  unknownSkus: Array<{ code: string; name: string; qty: number }>;
  fallbackClients: Array<{ client: string; qty: number }>;
}

export function monthRange(monthId: string): { dateFrom: string; dateTo: string } {
  const [y, m] = monthId.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    dateFrom: `${monthId}-01`,
    dateTo: `${monthId}-${String(last).padStart(2, "0")}`,
  };
}
