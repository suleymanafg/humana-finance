// Plain-object inputs and outputs of the calculation engine.
// The engine has no Prisma dependency, so it can be unit-tested directly.

// ───────────────────────── Inputs ─────────────────────────

export interface ProductIn {
  id: string;
  nameRu: string;
  nameEn?: string | null;
  code1c?: string | null;
  productLine?: string | null; // "Platin" | "Expert"
  price: number; // list price, UZS, VAT included
  isPromo: boolean;
  regularProductId: string | null; // promo SKU → the regular SKU it is costed as
  sortOrder: number;
}

export interface ChannelIn {
  id: string;
  name: string;
  code1c?: string | null;
  cashPct: number; // share of the channel's sales paid in cash (fraction)
  sortOrder: number;
}

export interface MonthIn {
  id: string; // "2025-08"
  nameRu: string;
  nameEn: string;
  sortOrder: number;
  closedAt?: Date | null;
  closedBy?: string | null;
}

export interface SaleIn {
  monthId: string;
  productId: string;
  channelId: string;
  qty: number;
  /** invoiced amount (VAT included) when the source provides one; else qty × list price */
  amount?: number | null;
}

export interface ShipmentLineIn {
  id: string;
  productId: string;
  qty: number;
  priceEur: number;
  rate: number; // UZS per EUR actually paid
  /** own cost per unit, outside the truck FIFO (free goods) */
  fixedUnitCost: number | null;
}

export interface ShipmentIn {
  id: string;
  code: string;
  monthId: string; // arrival month
  status: string; // "ARRIVED" | "TRANSIT"
  lines: ShipmentLineIn[];
}

export interface ImportExpenseIn {
  id: string;
  shipmentId: string;
  monthId: string;
  categoryName: string;
  amount: number;
  /** month paid, when later than monthId */
  paidMonthId?: string | null;
  notes?: string | null;
}

export interface InvoiceLineIn {
  id: string;
  date: string; // ISO
  number: string;
  productId: string;
  qty: number;
  price: number; // ex-VAT per unit
  amount: number; // ex-VAT
  vat: number;
  /** TI cost per unit for goods outside the truck FIFO */
  ownUnitCost: number | null;
  sortOrder: number;
  notes?: string | null;
}

export interface WriteOffIn {
  id: string;
  date: string; // ISO
  productId: string;
  qty: number;
  reason?: string | null;
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
  quarterLabel: string;
  taxAmount: number;
  bookedMonthId: string;
  paidMonthId?: string | null;
  declaredExpenses: number;
}

export interface VatAccountIn {
  id: string;
  period: string; // "2025-08"
  date: string | null;
  description: string;
  charged: number;
  reduced: number;
  paid: number;
  refunded: number;
  balanceAfter: number | null;
  sortOrder: number;
}

export interface VatChargeIn {
  id: string;
  monthId: string;
  description: string;
  amount: number;
  bearer: string; // "PRIOR_OWNER" | "TI"
}

export interface FargoVatReturnIn {
  id?: string;
  monthId: string;
  declaredSales: number;
  outputVat: number;
  inputVat: number;
  paid: number;
}

export interface LoanIn {
  id: string;
  monthId: string;
  lender: string;
  received: number;
  repaid: number;
  notes?: string | null;
}

export interface PriorOwnerIn {
  id: string;
  date: string; // ISO
  description: string;
  received: number;
  paid: number;
  viaFargo: boolean;
  notes?: string | null;
}

export interface OtherReceiptIn {
  id: string;
  date: string; // ISO
  payer: string;
  amount: number;
  notes?: string | null;
}

export interface ContributionIn {
  id: string;
  date: string; // ISO
  tiAmount: number;
  fargoAmount: number;
  viaFargo: boolean;
  notes?: string | null;
}

export interface TransferIn {
  id: string;
  date: string; // ISO
  cashAmount: number;
  bankAmount: number;
  notes?: string | null;
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
  tiCash: number;
  goodsInTransit: number;
}

export interface ArIn {
  id: string;
  monthId: string;
  customerName: string;
  amount: number;
}

export interface ClientMapIn {
  id: string;
  displayName: string;
  channelId: string | null;
  source: string;
}

export interface TaxSettings {
  vatRate: number; // 0.12
  deemedCashMargin: number; // cash sales are declared at Fargo cost × (1 + this)
  fargoIncomeTaxRate: number; // turnover tax, fraction of sales at customer prices
  tiIncomeTaxRate: number; // reference only — TI profit tax comes from filed returns
  /** Fargo may deduct the write-offs it records from what it owes TI */
  writeOffDeduct: boolean;
}

export interface Dataset {
  products: ProductIn[];
  channels: ChannelIn[];
  months: MonthIn[]; // sorted
  warehouses: WarehouseIn[];
  sales: SaleIn[];
  shipments: ShipmentIn[];
  importExpenses: ImportExpenseIn[];
  invoices: InvoiceLineIn[];
  writeOffs: WriteOffIn[];
  opexTi: OpexTiIn[];
  opexFargo: OpexFargoIn[];
  taxFilings: TaxFilingIn[];
  vatAccount: VatAccountIn[];
  vatCharges: VatChargeIn[];
  fargoVatReturns: FargoVatReturnIn[];
  loans: LoanIn[];
  priorOwner: PriorOwnerIn[];
  otherReceipts: OtherReceiptIn[];
  contributions: ContributionIn[];
  transfers: TransferIn[];
  stockCounts: StockCountIn[];
  monthBalances: MonthBalanceIn[];
  arEntries: ArIn[];
  clientMaps?: ClientMapIn[];
  taxes: TaxSettings;
}

// ───────────────────────── Outputs ─────────────────────────

export interface ShipmentLineCost extends ShipmentLineIn {
  costProductId: string;
  priceUzs: number; // priceEur × rate
  purchaseAmount: number; // priceUzs × qty
  unitCost: number; // landed, per unit
  landedValue: number;
  inFifo: boolean; // false for own-cost lines
}

export interface ShipmentCost {
  shipmentId: string;
  code: string;
  monthId: string;
  status: string;
  units: number;
  purchaseEur: number;
  purchaseTotal: number; // UZS
  expenseTotal: number; // import expenses excluding import VAT
  importVat: number;
  loadFactor: number;
  landedTotal: number;
  lines: ShipmentLineCost[];
}

export interface InvoiceLineCost extends InvoiceLineIn {
  monthId: string;
  costProductId: string;
  tiUnitCost: number;
  tiCost: number;
  outsideFifo: boolean;
  totalInclVat: number;
}

export interface WriteOffCost extends WriteOffIn {
  monthId: string;
  costProductId: string;
  unitCost: number;
  value: number;
}

/** One product's FIFO position at a month-end. */
export interface FifoMonth {
  unitsSold: number;
  cumSold: number;
  /** cumulative units missing at the latest count (book − counted) */
  cumCountDiff: number;
  fargoCogs: number; // at TI invoice prices
  fargoLoss: number;
  groupCogs: number; // at TI landed cost
  groupLoss: number;
  fargoUnitCost: number; // per unit sold this month
  groupUnitCost: number;
  fargoStock: number; // Fargo stock at the count, at invoice prices
  fargoStockTi: number; // the same units at TI landed cost
  fargoStockUnits: number;
  tiStock: number; // TI's own stock (arrived, not invoiced or written off), landed cost
  tiStockUnits: number;
  invoicedUnits: number; // cumulative
  arrivedUnits: number; // cumulative
}

export interface FifoBatchTi {
  shipmentId: string;
  code: string;
  monthId: string;
  qty: number;
  unitCost: number;
  value: number;
}

export interface FifoBatchFargo {
  lineId: string;
  date: string;
  number: string;
  qty: number;
  price: number;
  value: number;
  tiUnitCost: number;
  tiValue: number;
}

export interface ProductFifo {
  productId: string;
  tiBatches: FifoBatchTi[];
  fargoBatches: FifoBatchFargo[];
  months: Record<string, FifoMonth>;
}

export interface TiMonth {
  monthId: string;
  revenue: number;
  units: number;
  cogs: number;
  giveaways: number;
  grossProfit: number;
  opexByGroup: Record<string, number>;
  opex: number;
  ebitda: number;
  profitTax: number;
  vatCost: number;
  netProfit: number;
  vat: {
    importVat: number;
    outputInvoices: number;
    outputOther: number;
    netModel: number;
    perAccount: number;
    difference: number;
    accountBalance: number;
    priorOwnerPart: number;
    jvPosition: number;
  };
}

export interface FargoMonth {
  monthId: string;
  salesAtPrice: number; // customer prices, VAT included
  bankSales: number;
  cashSales: number;
  bankRevenue: number; // ex-VAT
  cashRevenue: number; // price − VAT on the declared value
  revenue: number;
  cashDeclared: number;
  declaredTotal: number;
  units: number;
  salesByChannel: Record<string, number>;
  salesByProduct: Record<string, number>;
  revenueByProduct: Record<string, number>;
  qtyByProduct: Record<string, number>;
  cogs: number;
  stockLoss: number;
  writeOffsRecorded: number;
  grossProfit: number;
  opexByGroup: Record<string, number>;
  opex: number;
  ebitda: number;
  incomeTax: number;
  netProfit: number;
  vat: {
    input: number;
    outputBank: number;
    outputCash: number;
    net: number;
    creditIn: number;
    paid: number;
    creditOut: number;
  };
}

export interface GroupMonth {
  monthId: string;
  bankRevenue: number;
  cashRevenue: number;
  revenue: number;
  units: number;
  cogs: number;
  cogsByProduct: Record<string, number>;
  giveaways: number;
  stockLoss: number;
  grossProfit: number;
  opexTi: number;
  opexFargo: number;
  opex: number;
  ebitda: number;
  fargoIncomeTax: number;
  tiProfitTax: number;
  tiVatCost: number;
  taxes: number;
  netProfit: number;
  recon: {
    tiNet: number;
    fargoNet: number;
    marginInvoiced: number; // − TI margin on goods invoiced this month
    marginSold: number; // + TI margin on goods Fargo sold
    marginInLoss: number; // + TI margin inside goods lost vs count
    total: number;
    check: number;
  };
}

export interface SettlementMonth {
  monthId: string;
  // cash method — month flows
  salesAtPrice: number;
  fargoOpex: number;
  writeOffsDeducted: number;
  vatPaid: number;
  incomeTax: number;
  accrued: number;
  transfersCash: number;
  transfersBank: number;
  // cash method — cumulative / month-end
  dueCum: number;
  cashCum: number;
  bankCum: number;
  receivables: number;
  owes: number;
  // from the reconciliation act
  invoicesInclVatCum: number;
  allBankCum: number;
  actBalance: number;
  fargoCapitalViaFargo: number;
  tiCapitalViaFargo: number;
  priorOwnerViaFargo: number;
  notGoods: number;
  fargoNetCum: number;
  fargoStock: number;
  writeOffsDeductedCum: number;
  vatCredit: number;
  partnership: number;
  owesByAct: number;
  check: number;
  byBank: number;
  inCash: number;
  change: number;
}

export interface BalanceTi {
  bank: number;
  cash: number;
  receivableFromFargo: number;
  stock: number;
  goodsInTransit: number;
  vatOverpaid: number;
  assets: number;
  vatDebt: number;
  priorOwnerVat: number;
  priorOwnerCash: number;
  loans: number;
  otherReceipts: number;
  importUnpaid: number;
  profitTaxPayable: number;
  liabilities: number;
  tiCapital: number;
  fargoCapital: number;
  retained: number;
  equity: number;
  unreconciled: number;
  unreconciledCash: number; // cash and prepayments against their recorded sources
  unreconciledVat: number;
  stockOpening: number;
  stockArrived: number;
  stockInvoiced: number;
  stockWrittenOff: number;
}

export interface BalanceFargo {
  stock: number;
  vatCredit: number;
  receivables: number;
  cashHeld: number;
  assets: number;
  payableToTi: number;
  liabilities: number;
  retained: number;
  equity: number;
  check: number;
  stockOpening: number;
  stockBought: number;
  stockSold: number;
  stockLost: number;
  settlement: number;
  capital: number;
}

export interface BalanceGroup {
  stock: number;
  stockAtTi: number;
  stockAtFargo: number;
  goodsInTransit: number;
  vat: number;
  receivables: number;
  tiCash: number;
  cashHeldByFargo: number;
  assets: number;
  liabilities: number;
  tiCapital: number;
  fargoCapital: number;
  retained: number;
  equity: number;
  unreconciled: number;
  tiMarginInStock: number;
  countedUnits: number;
  cumStockLoss: number;
}

export interface BalanceMonth {
  monthId: string;
  hasInputs: boolean;
  ti: BalanceTi;
  fargo: BalanceFargo;
  group: BalanceGroup;
}

export interface StockProductMonth {
  productId: string;
  arrived: number; // cumulative, units
  invoiced: number;
  sold: number;
  writtenOff: number;
  tiUnits: number;
  fargoBook: number;
  counted: number | null;
  difference: number | null; // book − counted, in count months
  cumDifference: number; // latest count
}

export interface StockMonth {
  monthId: string;
  isCountMonth: boolean;
  products: StockProductMonth[];
}

export interface HealthCheck {
  key: string;
  status: "ok" | "warn";
  severity: "warn" | "info";
  count: number;
  details: string[];
  href: string;
}

export interface Computed {
  monthIds: string[];
  shipments: ShipmentCost[];
  invoices: InvoiceLineCost[];
  writeOffs: WriteOffCost[];
  fifo: Record<string, ProductFifo>;
  ti: TiMonth[];
  fargo: FargoMonth[];
  group: GroupMonth[];
  settlement: SettlementMonth[];
  balance: BalanceMonth[];
  stock: StockMonth[];
  /** TI VAT overpayment that belongs to the previous owner, before joint operations */
  priorOwnerVatOpening: number;
  healthChecks: HealthCheck[];
}
