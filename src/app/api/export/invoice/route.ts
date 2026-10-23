// One TI → Fargo invoice as Excel: the document and TI's cost and margin on it.
// GET ?number=<as printed>&date=YYYY-MM-DD&locale=ru|en
import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { getComputed } from "@/lib/data";
import { buildWorkbook, workbookResponse } from "@/lib/excel";
import { invoiceSheets } from "@/lib/full-export";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const params = request.nextUrl.searchParams;
  const locale = params.get("locale") === "en" ? "en" : "ru";
  const number = (params.get("number") ?? "").trim();
  const date = params.get("date") ?? "";
  if (!number || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "number and date (YYYY-MM-DD) required" }, { status: 400 });
  const { dataset, computed } = await getComputed();
  const lines = computed.invoices.filter((l) => l.number === number && l.date.slice(0, 10) === date).sort((a, b) => a.sortOrder - b.sortOrder);
  if (lines.length === 0) return NextResponse.json({ error: "invoice not found" }, { status: 404 });
  const wb = buildWorkbook(invoiceSheets(dataset, lines, locale));
  return workbookResponse(wb, `invoice-${number.replace(/[^\w.-]+/g, "_")}-${date}.xlsx`);
}
