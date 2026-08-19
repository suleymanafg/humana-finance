// 1C inventory adapter (token auth, no session).
//
//   POST /api/import/1c-stock
//   Header: X-Api-Key: <ONEC_API_KEY env var>
//   Body: {
//     "month": "2026-01",            // optional; defaults to the current month
//     "fullSnapshot": true,          // optional; default true — see below
//     "rows": [
//       { "warehouse": "Основной склад",   // or its 1C code
//         "productCode": "УТ-000123",      // 1C code — matched first (optional)
//         "productName": "Humana Platin 1 MP 400г", // fallback by name
//         "qty": 1250 },
//       ...
//     ]
//   }
//
// Warehouse is matched by name or by its 1C code (Settings → Склады → "Код в 1С").
// Snapshot semantics: rows replace the stored qty per (month, product, warehouse);
// with fullSnapshot=true, products absent from the payload are zeroed for the
// warehouses present, so a daily full pull is self-correcting.
// Response: { imported: n, rejected: [ { row, reason } ] }.
import { NextResponse, type NextRequest } from "next/server";
import { commitStockRows, matchStockRows, type StockRow } from "@/lib/import-stock";
import { closedMonthIds } from "@/lib/month-close";

export async function POST(request: NextRequest) {
  const key = request.headers.get("x-api-key");
  const expected = process.env.ONEC_API_KEY ?? "dev-1c-key";
  if (!key || key !== expected) {
    return NextResponse.json({ error: "invalid api key" }, { status: 401 });
  }
  const body = (await request.json()) as {
    rows: StockRow[];
    month?: string;
    fullSnapshot?: boolean;
  };
  if (!Array.isArray(body.rows)) return NextResponse.json({ error: "rows required" }, { status: 400 });

  const result = await matchStockRows(body.rows, body.month);
  // closed months are frozen for the external feed: reject, never overwrite
  const closed = await closedMonthIds();
  const writable = result.matched.filter((r) => !closed.has(r.monthId));
  const frozen = result.matched
    .filter((r) => closed.has(r.monthId))
    .map((r) => ({
      row: { warehouse: r.warehouseName, productName: r.productName, qty: r.qty, month: r.monthId },
      reason: "month is closed",
    }));
  await commitStockRows(writable, "1c-api", body.fullSnapshot !== false);
  return NextResponse.json({ imported: writable.length, rejected: [...result.rejected, ...frozen] });
}
