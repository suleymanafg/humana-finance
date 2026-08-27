// Invoice upload → automatic extraction for the «Новая поставка» form.
// Free and local: the scanned pages are OCR'd with Tesseract (no paid API)
// and parsed against DMK's fixed SAP invoice layout; article numbers are then
// matched to products deterministically (same alt-article map planning uses).
// Nothing is saved here — the client prefills the form and the owner reviews
// before creating the shipment.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireDataEditor } from "@/lib/auth";
import { extractInvoice } from "@/lib/invoice-ocr";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // OCR takes ~7s per page

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export async function POST(request: NextRequest) {
  const session = await requireDataEditor();
  if (!session) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "file required" }, { status: 400 });
  if (file.size > 15 * 1024 * 1024)
    return NextResponse.json({ error: "file too large (max 15 MB)" }, { status: 400 });

  let parsed;
  try {
    parsed = await extractInvoice(Buffer.from(await file.arrayBuffer()));
  } catch (e) {
    // surface the real cause in the function logs AND to the admin's screen
    console.error("invoice extraction failed:", e);
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: `could not read the PDF: ${msg}` }, { status: 502 });
  }
  if (parsed.lines.length === 0) {
    return NextResponse.json(
      { error: "no invoice lines recognized — enter the shipment manually" },
      { status: 422 }
    );
  }

  // deterministic matching: article -> planning SKU (incl. superseded article
  // numbers) -> product; fall back to Product.article, then to the name
  const [products, planningSkus] = await Promise.all([
    prisma.product.findMany({
      where: { active: true },
      select: { id: true, nameRu: true, article: true, isPromo: true },
    }),
    prisma.planningSku.findMany({ select: { article: true, altArticles: true, productId: true } }),
  ]);
  const productByArticle = new Map<string, string>();
  for (const s of planningSkus) {
    if (!s.productId) continue;
    productByArticle.set(s.article, s.productId);
    for (const alt of (s.altArticles ?? "").split(",").map((x) => x.trim()).filter(Boolean))
      productByArticle.set(alt, s.productId);
  }
  for (const p of products) {
    if (p.article && !productByArticle.has(p.article)) productByArticle.set(p.article, p.id);
  }
  const productByName = new Map(products.filter((p) => !p.isPromo).map((p) => [norm(p.nameRu), p.id]));
  const nameById = new Map(products.map((p) => [p.id, p.nameRu]));

  const lines = parsed.lines
    .filter((l) => l.qty > 0)
    .map((l) => {
      const productId =
        (l.article ? productByArticle.get(l.article.trim()) : undefined) ??
        productByName.get(norm(l.description)) ??
        null;
      return {
        productId,
        productName: productId ? nameById.get(productId) : null,
        article: l.article,
        description: l.description,
        qty: l.qty,
        unitPrice: l.unitPrice,
      };
    });

  return NextResponse.json({
    invoiceNumber: parsed.invoiceNumber,
    invoiceDate: parsed.invoiceDate,
    currency: parsed.currency,
    totalAmount: parsed.totalAmount,
    lines,
    unmatched: lines.filter((l) => !l.productId).length,
  });
}
