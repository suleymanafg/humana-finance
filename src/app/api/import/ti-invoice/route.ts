// A Didox invoice from TI to Fargo (PDF) → the figures for the invoice form.
// Nothing is saved here: the form opens filled in, and the user saves it.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireDataEditor } from "@/lib/auth";
import { pdfTextLayer } from "@/lib/invoice-ocr";
import { matchProduct, parseDidoxInvoice } from "@/lib/didox-invoice";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  const session = await requireDataEditor();
  if (!session) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const file = (await request.formData()).get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "no-file" }, { status: 400 });
  if (file.size > 15 * 1024 * 1024) return NextResponse.json({ error: "too-large" }, { status: 400 });

  let text: string;
  try {
    text = await pdfTextLayer(Buffer.from(await file.arrayBuffer()));
  } catch (e) {
    console.error("Didox invoice: could not read the PDF:", e);
    return NextResponse.json({ error: "unreadable" }, { status: 422 });
  }
  if (text.trim() === "") return NextResponse.json({ error: "no-text" }, { status: 422 });

  const inv = parseDidoxInvoice(text);
  if (inv.lines.length === 0) return NextResponse.json({ error: "no-lines" }, { status: 422 });

  const [products, alreadyEntered, month] = await Promise.all([
    prisma.product.findMany({ where: { active: true, isPromo: false }, select: { id: true, nameRu: true } }),
    inv.number && inv.date
      ? prisma.tiInvoiceLine.count({
          where: { deletedAt: null, number: inv.number, date: new Date(`${inv.date}T00:00:00.000Z`) },
        })
      : Promise.resolve(0),
    inv.date ? prisma.month.findUnique({ where: { id: inv.date.slice(0, 7) }, select: { closedAt: true } }) : null,
  ]);
  const sum = (pick: (l: (typeof inv.lines)[number]) => number) => inv.lines.reduce((s, l) => s + pick(l), 0);

  return NextResponse.json({
    number: inv.number,
    date: inv.date,
    seller: inv.seller,
    buyer: inv.buyer,
    fromTiToFargo: /turbo/i.test(inv.seller ?? "") && /fargo/i.test(inv.buyer ?? ""),
    lines: inv.lines.map((l) => ({ ...l, productId: matchProduct(l.name, products) })),
    total: inv.totals?.total ?? sum((l) => l.total),
    addsUp:
      inv.totals != null &&
      Math.abs(sum((l) => l.amount) - inv.totals.amount) < 1 &&
      Math.abs(sum((l) => l.vat) - inv.totals.vat) < 1,
    alreadyEntered,
    monthExists: month != null,
    monthClosed: month?.closedAt != null,
  });
}
