// The whole financial model as one Excel workbook (statements and every record
// behind them), up to the chosen month. GET ?month=YYYY-MM&locale=ru|en
import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { getComputed } from "@/lib/data";
import { buildWorkbook, workbookResponse } from "@/lib/excel";
import { fullWorkbookSheets } from "@/lib/full-export";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const params = request.nextUrl.searchParams;
  const locale = params.get("locale") === "en" ? "en" : "ru";
  const { dataset, computed } = await getComputed();
  const requested = params.get("month") ?? "";
  const monthId = computed.monthIds.includes(requested) ? requested : computed.monthIds[computed.monthIds.length - 1];
  if (!monthId) return NextResponse.json({ error: "no months" }, { status: 404 });
  const wb = buildWorkbook(fullWorkbookSheets(dataset, computed, monthId, locale));
  return workbookResponse(wb, `humana-finance-${monthId}.xlsx`);
}
