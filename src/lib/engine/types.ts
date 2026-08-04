// Plain-object inputs/outputs for the calculation engine.
// The engine has no Prisma dependency so it can be unit-tested directly.

export interface ProductIn {
  id: string;
  nameRu: string;
  nameEn?: string | null;
  code1c?: string | null; // 1C code for import matching
  productLine?: string | null; // "Platin" | "Expert"
  price: number; // sell price UZS
  isPromo: boolean;
  regularProductId: string | null;
  sortOrder: number;
}

export interface ChannelIn {
  id: string;
  name: string;
  code1c?: string | null; // 1C code for import matching
  retroPct: number; // fraction
  cashPct: number; // fraction
  sortOrder: number;
}

export interface MonthIn {
  id: string; // "2025-08"
  nameRu: string;
  nameEn: string;
  sortOrder: number;
}

export interface SaleIn {
  monthId: string;
  productId: string;
  channelId: string;
  qty: number;
  /** invoiced revenue from the source system; falls back to qty × list price */
  amount?: number | null;
}

export interface ShipmentLineIn {
  id: string;
  productId: string;
  qty: number;
  priceEur: number;
  rate: number; // EUR -> UZS
  fargoUnitCost: number | null;
}

export interface ShipmentIn {
  id: string;
  code: string;
  monthId: string;
  lines: ShipmentLineIn[];
}

export interface ImportExpenseIn {
  id: string;
  shipmentId: string;
  monthId: string;
  categoryName: string;
  amount: number;
}

export interface OpexTiIn {
  id: string;
  monthId: string;
  categoryName: string;
  plGroup: string | null;
  bankAmount: number;
  cashAmount: number;
  notes?: string | null;
}

export interface OpexFargoIn {
  id: string;
  monthId: string;
  categoryName: string;
  plGroup: string | null;
  amount: number;
  notes?: string | null;
}

export interface TaxFilingIn {
  id: string;
  quarterLabel: string; // "Q3 2025"
  taxAmount: number;
  bookedMonthId: string;
  declaredExpenses: number;
}

export interface ContributionIn {
  id: string;
  date: string; // ISO
  tiAmount: number;
  fargoAmount: number;
}

export interface TransferIn {
  id: string;
  date: string; // ISO
  cashAmount: number;
  bankAmount: number;
}

export interface WarehouseIn {
  id: string;
  name: string;
  sortOrder: number;
}

export interface StockCountIn {
  monthId: string;
  productId: string;
  warehouseId: string;
  qty: number;
}

export interface MonthBalanceIn {
  monthId: string;
  tiBank: number;
  goodsInTransit: number;
  vatPrepayment: number;
  priorVatBalance: number;
  nutribenLoan: number;
}

export interface ArIn {
  id: string;
  monthId: string;
  customerName: string;
  amount: number;
}

export interface TaxSettings {
  vatRate: number; // 0.12
  deemedCashMargin: number; // 0.03
  fargoIncomeTaxRate: number; // 0.019
  tiIncomeTaxRate: number; // 0.15
}

// Trusted external reference (the 1C export / the Excel workbook) that the
// engine must reproduce. Components left null are not yet available and are
// skipped by the tie-out check.
export interface GoldenValues {
  toMonthId: string;
  revenue: number | null;
  cogs: number | null;
  netProfit: number | null;
  gpMarginPct?: number | null;
  note?: string;
}

export interface Dataset {
  products: ProductIn[];
  channels: ChannelIn[];
  months: MonthIn[]; // sorted by sortOrder
  warehouses: WarehouseIn[];
  sales: SaleIn[];
  shipments: ShipmentIn[];
  importExpenses: ImportExpenseIn[];
  opexTi: OpexTiIn[];
  opexFargo: OpexFargoIn[];
  taxFilings: TaxFilingIn[];
  contributions: ContributionIn[];
  transfers: TransferIn[];
  stockCounts: StockCountIn[];
  monthBalances: MonthBalanceIn[];
  arEntries: ArIn[];
  taxes: TaxSettings;
  golden: GoldenValues | null;
}

// ───────────────────────── Outputs ─────────────────────────

export interface ShipmentLineCost extends ShipmentLineIn {
  priceUzs: number; // priceEur × rate
  purchaseAmount: number; // priceUzs × qty
  tiUnitCost: number; // priceUzs × loadFactor
}

export interface ShipmentCost {
  shipmentId: string;
  code: string;
  monthId: string;
  purchaseTotal: number;
  expenseTotal: number;
  loadFactor: number;
  fargoValue: number; // Σ qty × fargoUnitCost (missing costs contribute 0)
  hasMissingFargoCost: boolean;
  lines: ShipmentLineCost[];
}

export interface ProductCost {
  productId: string;
  totalQty: number;
  avgTiCost: number; // qty-weighted across all shipment lines
  avgFargoCost: number;
  hasFargoCost: boolean;
}

export interface VatRow {
  productId: string;
  qty: number;
  qtyCash: number;
  qtyBank: number;
  sellPrice: number;
  fargoUnitCost: number;
  bankVat: number;
  cashVat: number;
  totalVat: number;
}

export interface CogsRow {
  productId: string;
  qty: number;
  unitCost: number;
  amount: number;
}

export interface MonthlyResult {
  monthId: string;
  revenueByChannel: Record<string, number>;
  revenue: number;
  cashRevenue: number;
  bankRevenue: number;
  retroBonus: number;
  retroByChannel: Record<string, number>;
  qtyByProduct: Record<string, number>;
  revenueByProduct: Record<string, number>;
  totalQty: number;
  cogsRows: CogsRow[];
  cogs: number;
  grossProfit: number;
  gpMarginPct: number;
  opexTiByGroup: Record<string, number>;
  opexTiTotal: number;
  opexFargoByGroup: Record<string, number>;
  opexFargoTotal: number;
  totalOpex: number; // OPEX TI + OPEX Fargo + retro (marketing folded into OPEX)
  ebitda: number;
  ebitdaMarginPct: number;
  vatRows: VatRow[];
  fargoVat: number;
  bankVat: number; // VAT on the real margin of bank sales
  cashVat: number; // VAT on the deemed 3% margin of cash sales
  fargoIncomeTax: number;
  tiIncomeTax: number; // filings booked in this month
  taxesTotal: number;
  netProfit: number;
  netMarginPct: number;
}

export interface SettlementRow {
  monthId: string;
  cumRevenue: number;
  cumFargoOpex: number;
  cumRetro: number;
  cumFargoVat: number;
  cumFargoIncomeTax: number;
  dueToTi: number;
  cumTransfersCash: number;
  cumTransfersBank: number;
  outstandingAr: number;
  remaining: number; // = settlement receivable asset
}

export interface BalanceSheetRow {
  monthId: string;
  inventory: number;
  goodsInTransit: number;
  arTotal: number;
  tiBank: number;
  vatPrepayment: number;
  settlementReceivable: number;
  assetsTotal: number;
  taxPayable: number; // assumption: current month's taxes (see README)
  priorVatBalance: number;
  nutribenLoan: number;
  liabilitiesTotal: number;
  tiCapital: number;
  fargoCapital: number;
  retainedEarnings: number;
  plug: number; // unreconciled: A − L − other equity
  equityTotal: number;
  hasInputs: boolean; // month has any manual BS inputs
}

export interface QuarterAudit {
  quarterLabel: string;
  shipmentCodes: string[];
  fargoValue: number;
  grossProfit: number; // Σ margins
  declaredExpenses: number;
  taxableProfit: number;
  computedTax: number;
  filedTax: number;
  taxVariance: number; // filed − computed
  computedVat: number; // Σ margin × vatRate
}

export interface HealthCheck {
  key: string;
  status: "ok" | "warn";
  /** "info" checks are informational only — they never raise the warning badge */
  severity: "warn" | "info";
  count: number;
  details: string[]; // human-readable items (RU-ish source names)
  href: string; // where to fix it
}

export interface Computed {
  shipmentCosts: ShipmentCost[];
  productCosts: Record<string, ProductCost>; // keyed by regular product id
  monthly: MonthlyResult[]; // in month order, all months
  ytd: MonthlyResult; // sum over all months with data (monthId = "YTD")
  settlement: SettlementRow[];
  balanceSheets: BalanceSheetRow[];

  quarterAudits: QuarterAudit[];
  healthChecks: HealthCheck[];
}
