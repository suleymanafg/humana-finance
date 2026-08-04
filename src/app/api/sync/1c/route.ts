// 1C sales sync (admin session): preview fetches the month from the pinetrade
// API and shows what would change; commit replaces the month's sales as a full
// snapshot. Credentials pass through to 1C for this one request — they are not
// stored, not logged, and never echoed back.
import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  buildReconcile,
  buildSync,
  commitAllMonths,
  commitSync,
  fetch1cSales,
  monthRange,
  SyncError,
} from "@/lib/sync-1c";

export async function POST(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await request.json().catch(() => null)) as {
    mode: "preview" | "commit" | "reconcile" | "commit-all";
    monthId?: string;
    login: string;
    password: string;
    byClientName?: boolean;
  } | null;
  if (!body || !body.login || !body.password)
    return NextResponse.json({ error: "login and password are required" }, { status: 400 });

  // whole-range modes: reconcile (read-only comparison) and commit-all
  // (replace every loaded month with 1C data — owner decision: 1C is the
  // source of truth)
  if (body.mode === "reconcile" || body.mode === "commit-all") {
    const withSales = await prisma.sale.groupBy({ by: ["monthId"] });
    if (withSales.length === 0)
      return NextResponse.json({ error: "no sales data to reconcile" }, { status: 400 });
    const ids = withSales.map((m) => m.monthId).sort();
    const { dateFrom } = monthRange(ids[0]);
    const { dateTo } = monthRange(ids[ids.length - 1]);
    try {
      const data = await fetch1cSales(dateFrom, dateTo, body.login, body.password);
      if (body.mode === "reconcile")
        return NextResponse.json(await buildReconcile(data.items, dateFrom, dateTo));
      const result = await commitAllMonths(
        data.items,
        body.byClientName !== false,
        session.username
      );
      return NextResponse.json({ dateFrom, dateTo, ...result });
    } catch (e) {
      if (e instanceof SyncError)
        return NextResponse.json({ error: e.message, code: e.code }, { status: 502 });
      throw e;
    }
  }

  if (!body.monthId)
    return NextResponse.json({ error: "monthId is required" }, { status: 400 });
  const month = await prisma.month.findUnique({ where: { id: body.monthId } });
  if (!month) return NextResponse.json({ error: `unknown month ${body.monthId}` }, { status: 400 });

  try {
    const { dateFrom, dateTo } = monthRange(body.monthId);
    const data = await fetch1cSales(dateFrom, dateTo, body.login, body.password);
    const { report, matched, learned } = await buildSync(
      body.monthId,
      data.items,
      body.byClientName !== false
    );
    if (body.mode === "commit") {
      report.committed = await commitSync(
        body.monthId,
        matched,
        learned,
        {
          dateFrom,
          dateTo,
          fetched: report.fetched,
          totalQty: report.products.reduce((s, p) => s + p.qtyNew, 0),
          replacedRows: report.current.rows,
          replacedWithAmount: report.current.withAmount,
          unknownSkus: report.unknownSkus,
          fallbackClients: report.fallbackClients.length,
          learnedCodes: report.learnedCodes,
        },
        session.username
      );
    }
    return NextResponse.json(report);
  } catch (e) {
    if (e instanceof SyncError)
      return NextResponse.json({ error: e.message, code: e.code }, { status: 502 });
    throw e;
  }
}
