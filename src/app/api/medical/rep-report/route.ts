// A medical rep's report as Excel, or every rep's as a zip (the medical
// director and the owner). GET ?rep=<name>&from=YYYY-MM&to=YYYY-MM, or ?all=1&from&to.
import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { allRepReports, monthsBetween, repReport } from "@/lib/medical-report";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
// a Cyrillic file name needs the RFC 5987 form; the plain one is an ASCII fallback
const disposition = (name: string, fallback: string) => `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session || (session.role !== "ADMIN" && session.role !== "MEDICAL")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const q = request.nextUrl.searchParams;
  const from = q.get("from") ?? "";
  const to = q.get("to") ?? from;
  if (!MONTH.test(from) || !MONTH.test(to) || to < from) return NextResponse.json({ error: "from/to: YYYY-MM" }, { status: 400 });
  const months = monthsBetween(from, to);

  if (q.get("all") === "1") {
    const z = await allRepReports(months);
    if (z.count === 0) return NextResponse.json({ error: "no prescriptions in the period" }, { status: 404 });
    return new Response(z.buffer as unknown as BodyInit, { headers: { "Content-Type": "application/zip", "Content-Disposition": disposition(z.name, `rep-reports-${from}.zip`) } });
  }
  const rep = (q.get("rep") ?? "").trim();
  if (!rep) return NextResponse.json({ error: "rep required" }, { status: 400 });
  const r = await repReport(rep, months);
  return new Response(r.buffer as unknown as BodyInit, {
    headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": disposition(r.name, `rep-report-${from}.xlsx`) },
  });
}
