// The financial model as a live-formula Excel workbook, up to the chosen month,
// in the app's language. GET ?month=YYYY-MM&locale=ru|en
import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { getComputed } from "@/lib/data";
import { LOCALE_COOKIE } from "@/lib/i18n";
import { workbookResponse } from "@/lib/excel";
import { modelWorkbook } from "@/lib/model-workbook";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const params = request.nextUrl.searchParams;
  const asked = params.get("locale") ?? request.cookies.get(LOCALE_COOKIE)?.value;
  const locale = asked === "en" ? "en" : "ru";
  const { dataset, computed } = await getComputed();
  const requested = params.get("month") ?? "";
  const monthId = computed.monthIds.includes(requested) ? requested : computed.monthIds[computed.monthIds.length - 1];
  if (!monthId) return NextResponse.json({ error: "no months" }, { status: 404 });
  return workbookResponse(modelWorkbook(dataset, computed, monthId, locale), `humana-model-${monthId}-${locale}.xlsx`);
}
