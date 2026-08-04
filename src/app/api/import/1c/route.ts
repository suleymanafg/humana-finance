// 1C adapter endpoint (token auth, no session).
//
//   POST /api/import/1c
//   Header: X-Api-Key: <ONEC_API_KEY env var>
//   Body: { "rows": [ { "month": "2025-08", "productName": "Humana Platin 1 MP 400г",
//                       "channelName": "Корзинка", "qty": 120 }, ... ] }
//
// Names are matched against the reference lists (trim/case-insensitive).
// Response: { imported: n, rejected: [ { row, reason } ] } — a rejection report
// for every unmatched name; matched rows upsert by (month, product, channel).
import { NextResponse, type NextRequest } from "next/server";
import { commitRows, matchRows, type ImportRow } from "@/lib/import-sales";

export async function POST(request: NextRequest) {
  const key = request.headers.get("x-api-key");
  const expected = process.env.ONEC_API_KEY ?? "dev-1c-key";
  if (!key || key !== expected) {
    return NextResponse.json({ error: "invalid api key" }, { status: 401 });
  }
  const body = (await request.json()) as { rows: ImportRow[] };
  if (!Array.isArray(body.rows)) return NextResponse.json({ error: "rows required" }, { status: 400 });

  const result = await matchRows(body.rows);
  await commitRows(result.matched, "API", "1c-api");
  return NextResponse.json({ imported: result.matched.length, rejected: result.rejected });
}
