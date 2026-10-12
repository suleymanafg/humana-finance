// 1C sales sync (admin session): preview fetches the month from the 1C sales
// API and shows what would change; commit replaces the month's sales as a full
// snapshot. Credentials pass through to 1C for this one request — they are not
// stored, not logged, and never echoed back. When the app's server cannot
// reach 1C (it answers only Uzbekistan), the admin opens a link in the browser,
// saves the page and sends its contents as `data` instead of the credentials —
// for one month, or for the whole period, which then feeds every mode.
import { gunzipSync } from "node:zlib";
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
  monthsCovered,
  salesFromFile,
  SyncError,
  type Api1cItem,
} from "@/lib/sync-1c";

// «Заменить все месяцы» rebuilds every month in turn
export const maxDuration = 300;

type Body = {
  mode: "preview" | "commit" | "reconcile" | "commit-all";
  monthId?: string;
  login?: string;
  password?: string;
  byClientName?: boolean;
  /** the 1C response saved from the browser, in place of login and password */
  data?: unknown;
};

const FILE_BAD =
  "Файл не похож на ответ 1С: в нём нет списка продаж. Сохраните страницу по ссылке (Ctrl+S) и выберите этот файл.";
const day = (iso: string) => iso.split("-").reverse().join(".");

/** A whole period saved from 1C runs to megabytes, more than a request may carry: the panel sends it gzipped. */
async function readBody(request: NextRequest): Promise<Body | null> {
  try {
    if (request.headers.get("x-body-encoding") === "gzip") {
      const raw = gunzipSync(Buffer.from(await request.arrayBuffer()), { maxOutputLength: 256 * 1024 * 1024 });
      return JSON.parse(raw.toString("utf8")) as Body;
    }
    return (await request.json()) as Body;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await readBody(request);
  const fromFile = body?.data !== undefined;
  if (!body || (!fromFile && (!body.login || !body.password)))
    return NextResponse.json({ error: "login and password are required" }, { status: 400 });
  const saved = fromFile ? salesFromFile(body.data) : null;
  if (fromFile && !saved) return NextResponse.json({ error: FILE_BAD }, { status: 400 });

  try {
    // whole-range modes: reconcile (read-only comparison) and commit-all
    // (replace every loaded month with 1C data — owner decision: 1C is the
    // source of truth)
    if (body.mode === "reconcile" || body.mode === "commit-all") {
      let items: Api1cItem[], dateFrom: string, dateTo: string;
      if (saved) {
        if (!saved.period) return NextResponse.json({ error: FILE_BAD }, { status: 400 });
        ({ dateFrom, dateTo } = saved.period);
        items = saved.items;
        if (monthsCovered(dateFrom, dateTo).length === 0)
          return NextResponse.json(
            {
              error: `Файл за ${day(dateFrom)} – ${day(dateTo)} не покрывает ни одного месяца целиком. Сохраните страницу по ссылке «за все месяцы».`,
            },
            { status: 400 }
          );
      } else {
        const withSales = await prisma.sale.groupBy({ by: ["monthId"] });
        if (withSales.length === 0)
          return NextResponse.json({ error: "no sales data to reconcile" }, { status: 400 });
        const ids = withSales.map((m) => m.monthId).sort();
        ({ dateFrom } = monthRange(ids[0]));
        ({ dateTo } = monthRange(ids[ids.length - 1]));
        items = (await fetch1cSales(dateFrom, dateTo, body.login ?? "", body.password ?? "")).items;
      }
      if (body.mode === "reconcile") return NextResponse.json(await buildReconcile(items, dateFrom, dateTo));
      const result = await commitAllMonths(
        items,
        body.byClientName !== false,
        session.username,
        dateFrom,
        dateTo,
        saved ? "file" : "1c"
      );
      return NextResponse.json({ dateFrom, dateTo, ...result });
    }

    if (!body.monthId)
      return NextResponse.json({ error: "monthId is required" }, { status: 400 });
    const month = await prisma.month.findUnique({ where: { id: body.monthId } });
    if (!month) return NextResponse.json({ error: `unknown month ${body.monthId}` }, { status: 400 });

    const { dateFrom, dateTo } = monthRange(body.monthId);
    let items: Api1cItem[];
    if (saved) {
      // a file for the whole period serves any month in it; the rest is not "outside the period"
      items = saved.items.filter((it) => String(it.Дата ?? "").slice(0, 7) === body.monthId);
      const covers = saved.period?.declared
        ? monthsCovered(saved.period.dateFrom, saved.period.dateTo).includes(body.monthId)
        : items.length > 0;
      // applying a file without the month would empty the month's sales
      if (!covers)
        return NextResponse.json(
          {
            error: saved.period
              ? `Файл за ${day(saved.period.dateFrom)} – ${day(saved.period.dateTo)}: месяца ${body.monthId} в нём нет целиком. Сохраните страницу по ссылке за этот месяц или за все месяцы.`
              : `В файле нет продаж за ${body.monthId}.`,
          },
          { status: 400 }
        );
    } else {
      items = (await fetch1cSales(dateFrom, dateTo, body.login ?? "", body.password ?? "")).items;
    }
    const { report, matched, learned, clientDetail } = await buildSync(
      body.monthId,
      items,
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
          source: saved ? "file" : "1c",
          fetched: report.fetched,
          totalQty: report.products.reduce((s, p) => s + p.qtyNew, 0),
          replacedRows: report.current.rows,
          replacedWithAmount: report.current.withAmount,
          unknownSkus: report.unknownSkus,
          fallbackClients: report.fallbackClients.length,
          learnedCodes: report.learnedCodes,
        },
        session.username,
        clientDetail
      );
    }
    return NextResponse.json(report);
  } catch (e) {
    if (e instanceof SyncError)
      return NextResponse.json({ error: e.message, code: e.code }, { status: 502 });
    throw e;
  }
}
