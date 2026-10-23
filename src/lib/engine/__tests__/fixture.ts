import type { Dataset } from "../types";

// Synthetic fixture, values worked out by hand.
//
// Truck S1 (Aug): A 100 × 4 EUR × 14 000 = 56 000; B 50 × 5 EUR × 14 000 = 70 000;
//   A 10 free from HQ at an own cost of 5 000. Expenses 960 000 (+ import VAT,
//   which is not a cost). Load factor = (9 100 000 + 960 000 − 50 000) / 9 100 000 = 1.1
//   → A 61 600, B 77 000.
// Truck S2 (Sep): A 100 × 5 EUR × 14 000 = 70 000, no expenses → 70 000.
// Truck S3 is still in transit: outside every cost.
//
// TI invoices: A 80 @ 65 000 (Aug 20), A 10 free (Aug 25, own cost 5 000),
//   A 60 @ 72 000 and B 50 @ 80 000 (Sep 10). TI write-off: A 5 (Oct 31).
// Sales: Aug A 50 city + A-promo 10 chain; Sep A 30 city, B 20 chain; Oct A 10 city.
// Count at Sep: A 57 (book 60 → 3 missing), B 30 (book 30).

export function fixture(): Dataset {
  return {
    products: [
      { id: "A", nameRu: "A", price: 120_000, isPromo: false, regularProductId: null, sortOrder: 0 },
      { id: "A-promo", nameRu: "A (АКЦИЯ)", price: 90_000, isPromo: true, regularProductId: "A", sortOrder: 1 },
      { id: "B", nameRu: "B", price: 150_000, isPromo: false, regularProductId: null, sortOrder: 2 },
    ],
    channels: [
      { id: "CITY", name: "Город", cashPct: 0.5, sortOrder: 0 },
      { id: "CHAIN", name: "Сеть", cashPct: 0, sortOrder: 1 },
    ],
    months: [
      { id: "2025-08", nameRu: "Август 2025", nameEn: "August 2025", sortOrder: 0 },
      { id: "2025-09", nameRu: "Сентябрь 2025", nameEn: "September 2025", sortOrder: 1 },
      { id: "2025-10", nameRu: "Октябрь 2025", nameEn: "October 2025", sortOrder: 2 },
    ],
    warehouses: [{ id: "W1", name: "Основной склад", sortOrder: 0 }],
    sales: [
      { monthId: "2025-08", productId: "A", channelId: "CITY", qty: 50 },
      { monthId: "2025-08", productId: "A-promo", channelId: "CHAIN", qty: 10 },
      { monthId: "2025-09", productId: "A", channelId: "CITY", qty: 30 },
      { monthId: "2025-09", productId: "B", channelId: "CHAIN", qty: 20 },
      { monthId: "2025-10", productId: "A", channelId: "CITY", qty: 10 },
    ],
    shipments: [
      {
        id: "S1",
        code: "Truck 1",
        monthId: "2025-08",
        status: "ARRIVED",
        lines: [
          { id: "L1", productId: "A", qty: 100, priceEur: 4, rate: 14_000, fixedUnitCost: null },
          { id: "L2", productId: "B", qty: 50, priceEur: 5, rate: 14_000, fixedUnitCost: null },
          { id: "L3", productId: "A", qty: 10, priceEur: 0, rate: 14_000, fixedUnitCost: 5_000 },
        ],
      },
      {
        id: "S2",
        code: "Truck 2",
        monthId: "2025-09",
        status: "ARRIVED",
        lines: [{ id: "L4", productId: "A", qty: 100, priceEur: 5, rate: 14_000, fixedUnitCost: null }],
      },
      {
        id: "S3",
        code: "Truck 3",
        monthId: "2025-10",
        status: "TRANSIT",
        lines: [{ id: "L5", productId: "A", qty: 100, priceEur: 1, rate: 14_000, fixedUnitCost: null }],
      },
    ],
    importExpenses: [
      { id: "E1", shipmentId: "S1", monthId: "2025-08", categoryName: "Транспорт", amount: 960_000 },
      { id: "E2", shipmentId: "S1", monthId: "2025-08", categoryName: "НДС (импорт)", amount: 1_200_000 },
      { id: "E3", shipmentId: "S2", monthId: "2025-09", categoryName: "Хранение", amount: 0, paidMonthId: "2025-10" },
    ],
    invoices: [
      { id: "I1", date: "2025-08-20", number: "1", productId: "A", qty: 80, price: 65_000, amount: 5_200_000, vat: 624_000, ownUnitCost: null, sortOrder: 0 },
      { id: "I2", date: "2025-08-25", number: "—", productId: "A", qty: 10, price: 0, amount: 0, vat: 0, ownUnitCost: 5_000, sortOrder: 1 },
      { id: "I3", date: "2025-09-10", number: "2", productId: "A", qty: 60, price: 72_000, amount: 4_320_000, vat: 518_400, ownUnitCost: null, sortOrder: 2 },
      { id: "I4", date: "2025-09-10", number: "2", productId: "B", qty: 50, price: 80_000, amount: 4_000_000, vat: 480_000, ownUnitCost: null, sortOrder: 3 },
    ],
    writeOffs: [{ id: "W1", date: "2025-10-31", productId: "A", qty: 5 }],
    fargoWriteOffs: [],
    opexTi: [
      { id: "OT1", monthId: "2025-08", categoryName: "Зарплата", plGroup: "TI_SALARIES", bankAmount: 300_000, cashAmount: 100_000 },
    ],
    opexFargo: [
      { id: "OF1", monthId: "2025-08", categoryName: "Склад", plGroup: "FG_WAREHOUSE", amount: 250_000 },
      { id: "OF2", monthId: "2025-09", categoryName: "Списания", plGroup: "FG_WRITEOFF", amount: 77_000 },
    ],
    taxFilings: [{ id: "F1", quarterLabel: "Q3 2025", taxAmount: 40_000, bookedMonthId: "2025-09", paidMonthId: "2025-10", declaredExpenses: 0 }],
    vatAccount: [
      { id: "V0", period: "2025-07", date: null, description: "Opening", charged: 0, reduced: 0, paid: 1_000_000, refunded: 0, balanceAfter: null, sortOrder: 0 },
      { id: "V1", period: "2025-08", date: null, description: "August", charged: 300_000, reduced: 0, paid: 0, refunded: 0, balanceAfter: null, sortOrder: 1 },
    ],
    vatCharges: [
      { id: "C1", monthId: "2025-08", description: "Prior owner sale", amount: 200_000, bearer: "PRIOR_OWNER" },
      { id: "C2", monthId: "2025-08", description: "Paid twice", amount: 50_000, bearer: "TI" },
    ],
    fargoVatReturns: [],
    loans: [{ id: "LN1", monthId: "2025-09", lender: "Bank", received: 500_000, repaid: 100_000 }],
    priorOwner: [
      { id: "P1", date: "2025-09-05", description: "Cash via Fargo", received: 300_000, paid: 0, viaFargo: true },
      { id: "P2", date: "2025-09-06", description: "Paid for them", received: 0, paid: 250_000, viaFargo: false },
    ],
    otherReceipts: [{ id: "O1", date: "2025-09-30", payer: "Clinic", amount: 20_000 }],
    contributions: [
      { id: "K1", date: "2025-07-25", tiAmount: 2_000_000, fargoAmount: 0, viaFargo: false },
      { id: "K2", date: "2025-08-02", tiAmount: 0, fargoAmount: 1_500_000, viaFargo: true },
    ],
    transfers: [
      { id: "T1", date: "2025-08-28", cashAmount: 1_000_000, bankAmount: 2_000_000 },
      { id: "T2", date: "2025-09-15", cashAmount: 500_000, bankAmount: 3_000_000 },
    ],
    stockCounts: [
      { monthId: "2025-09", productId: "A", warehouseId: "W1", qty: 57 },
      { monthId: "2025-09", productId: "B", warehouseId: "W1", qty: 30 },
    ],
    monthBalances: [{ monthId: "2025-09", tiBank: 400_000, tiCash: 50_000, goodsInTransit: 0 }],
    arEntries: [{ id: "AR1", monthId: "2025-09", customerName: "Сеть", amount: 600_000 }],
    taxes: { vatRate: 0.12, deemedCashMargin: 0.03, fargoIncomeTaxRate: 0.019, tiIncomeTaxRate: 0.15, writeOffDeduct: false },
  };
}
