// Excel export of one ship-month's committed purchases, in the shape
// Germany's order form expects: item #, description, pcs, cartons, pallets,
// gross/net weight, EUR value.
import { type NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { MONEY, MONEY2, buildWorkbook, workbookResponse } from "@/lib/excel";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const ship = request.nextUrl.searchParams.get("ship");
  if (!ship || !/^\d{4}-(0[1-9]|1[0-2])$/.test(ship)) {
    return NextResponse.json({ error: "ship month required" }, { status: 400 });
  }
  const purchases = await prisma.planningPurchase.findMany({
    where: { shipMonth: ship, qty: { gt: 0 } },
    include: { sku: true },
  });
  if (purchases.length === 0) return NextResponse.json({ error: "no purchases for this month" }, { status: 404 });

  const rows: Array<Array<string | number | null>> = [];
  let tUnits = 0, tCartons = 0, tPallets = 0, tGross = 0, tNet = 0, tEur = 0;
  for (const l of purchases.sort((a, b) => a.sku.sortOrder - b.sku.sortOrder)) {
    const s = l.sku;
    const cartons = s.pcsPerCarton > 0 ? l.qty / s.pcsPerCarton : null;
    const pallets = s.pcsPerPallet > 0 ? l.qty / s.pcsPerPallet : null;
    const gross = l.qty * s.grossKgPerUnit;
    const net = l.qty * s.netKgPerUnit;
    const eur = l.qty * s.priceEur;
    tUnits += l.qty; tCartons += cartons ?? 0; tPallets += pallets ?? 0;
    tGross += gross; tNet += net; tEur += eur;
    rows.push([s.article, s.name, l.qty, cartons, pallets, gross, net, s.priceEur, eur]);
  }
  rows.push(["", "TOTAL", tUnits, tCartons, tPallets, tGross, tNet, null, tEur]);

  const label = `sales ${ship.slice(5)}-${ship.slice(0, 4)}`;
  const wb = buildWorkbook([
    {
      name: "Order",
      title: `Humana order — ${label}`,
      subtitle: `ship month: ${ship} · arrival: ~1 month later`,
      columns: [
        { header: "Item #", width: 10 },
        { header: "Item description", width: 38 },
        { header: "Order qty, pcs", width: 14, numFmt: MONEY },
        { header: "Cartons", width: 10, numFmt: MONEY2 },
        { header: "Pallets", width: 10, numFmt: MONEY2 },
        { header: "Gross kg", width: 11, numFmt: MONEY2 },
        { header: "Net kg", width: 11, numFmt: MONEY2 },
        { header: "Price €", width: 9, numFmt: MONEY2 },
        { header: "Value €", width: 12, numFmt: MONEY2 },
      ],
      rows,
      boldRows: [rows.length - 1],
      freezeCols: 2,
    },
  ]);
  return workbookResponse(wb, `humana-order-${label.replace(/\s+/g, "-")}.xlsx`);
}
