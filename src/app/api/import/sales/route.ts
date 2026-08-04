// CSV/paste import (admin session): preview shows matched + rejected rows,
// commit upserts with dedupe by (month, product, channel).
import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { commitRows, matchRows, type ImportRow } from "@/lib/import-sales";

export async function POST(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await request.json()) as { mode: "preview" | "commit"; rows: ImportRow[] };
  if (!Array.isArray(body.rows)) return NextResponse.json({ error: "rows required" }, { status: 400 });

  const result = await matchRows(body.rows);
  if (body.mode === "commit") {
    await commitRows(result.matched, "CSV", session.username);
  }
  return NextResponse.json(result);
}
