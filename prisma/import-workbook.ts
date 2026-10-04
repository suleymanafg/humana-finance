import "dotenv/config";
// Loads the owner's finance workbook ("Humana Finance - 2026.xlsx") into the
// database. It first recomputes the whole workbook with the app's engine and
// refuses to write unless every figure matches.
//
//   npx tsx prisma/import-workbook.ts "<path to the .xlsx>"              dry run (dev database)
//   npx tsx prisma/import-workbook.ts "<path to the .xlsx>" --commit     write
//
// Both runs do the whole import inside one transaction and then recompute the
// workbook's figures from the database. A dry run always rolls back; a commit
// keeps the data only when every figure matches.
//
// Options:
//   --production   target the live database (`# DATABASE_URL_PRODUCTION=` in .env)
//   --with-sales   also replace sales for the months the workbook covers
//                  (normally the 1C sync owns sales; without this flag they
//                  are only compared)
//   --bootstrap    create missing products and channels (empty database only)
//   --accept-differences   commit even when the figures from the database
//                  differ from the workbook (e.g. 1C sales newer than it)
//
// What it replaces: TI invoices, TI write-offs, the TI VAT account and other
// VAT charges, loans, the previous owner's money, other receipts, capital, tax
// filings, truck lines and import expenses of arrived trucks; expenses and
// receivables for every month up to the workbook's report month; and — for the
// months and dates the workbook covers — payments from Fargo, stock counts and
// month-end balances. Channel cash shares and the tax settings are updated.
// Replaced rows are hidden (deletedAt), not erased. Nothing later than the
// workbook's coverage is touched.
import { readFileSync } from "node:fs";
import { newPrismaClient } from "../src/lib/prisma-factory";
import { compute } from "../src/lib/engine/compute";
import { buildDataset } from "../src/lib/dataset";
import { readWorkbook } from "./workbook";
import { compareWithWorkbook } from "./workbook-compare";

const args = process.argv.slice(2);
const path = args.find((a) => !a.startsWith("--"));
const COMMIT = args.includes("--commit");
const PRODUCTION = args.includes("--production");
const WITH_SALES = args.includes("--with-sales");
const BOOTSTRAP = args.includes("--bootstrap");
const ACCEPT_DIFFERENCES = args.includes("--accept-differences");

/** Thrown inside the transaction to undo everything it wrote. */
class Rollback extends Error {}

if (!path) {
  console.error('Usage: npx tsx prisma/import-workbook.ts "<path to the .xlsx>" [--commit] [--production] [--with-sales]');
  process.exit(1);
}

function productionUrl(): string {
  const env = readFileSync(".env", "utf8");
  const url = (env.match(/^#\s*DATABASE_URL_PRODUCTION=\s*"?([^"\n]+)/m) ?? [])[1]?.trim();
  if (!url) throw new Error("No `# DATABASE_URL_PRODUCTION=` line in .env.");
  return url;
}

const prisma = newPrismaClient(PRODUCTION ? productionUrl() : undefined);
const money = (v: number) => Math.round(v).toLocaleString("en-US");
const sum = <T>(rows: T[], pick: (r: T) => number) => rows.reduce((s, r) => s + pick(r), 0);
const day = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);

async function main() {
  console.log(`${COMMIT ? "COMMIT" : "DRY RUN (add --commit to write)"} → ${PRODUCTION ? "PRODUCTION" : "development"} database\n`);

  // ── 1. the engine must reproduce the workbook ──
  const wb = readWorkbook(path!);
  const ds = wb.dataset;
  const proof = compareWithWorkbook(compute(ds), wb.expected, wb.reportTo);
  for (const line of proof.lines) console.log(line);
  if (!proof.ok) {
    console.error("\nStopped: the engine does not reproduce this workbook, so nothing was written.");
    process.exit(1);
  }

  // ── 2. reference data ──
  const [products, channels, months, warehouses, importCats, opexCats, shipments] = await Promise.all([
    prisma.product.findMany(),
    prisma.channel.findMany(),
    prisma.month.findMany(),
    prisma.warehouse.findMany(),
    prisma.importExpenseCategory.findMany(),
    prisma.opexCategory.findMany(),
    prisma.shipment.findMany({ where: { deletedAt: null } }),
  ]);
  const productIds = new Set(products.map((p) => p.id));
  const channelIds = new Set(channels.map((c) => c.id));
  const usedProducts = new Set([
    ...ds.sales.map((s) => s.productId),
    ...ds.shipments.flatMap((s) => s.lines.map((l) => l.productId)),
    ...ds.invoices.map((l) => l.productId),
    ...ds.writeOffs.map((w) => w.productId),
    ...ds.stockCounts.map((c) => c.productId),
  ]);
  const missingProducts = [...usedProducts].filter((id) => !productIds.has(id));
  const missingChannels = [...new Set(ds.sales.map((s) => s.channelId))].filter((id) => !channelIds.has(id));
  if ((missingProducts.length > 0 || missingChannels.length > 0) && !BOOTSTRAP) {
    console.error(`\nStopped: unknown products ${missingProducts.join(", ") || "—"}; unknown channels ${missingChannels.join(", ") || "—"}.`);
    process.exit(1);
  }

  console.log("\nChanges");
  const cashShareChanges = ds.channels.filter((c) => {
    const db = channels.find((x) => x.id === c.id);
    return db && Math.abs(db.cashPct - c.cashPct) > 1e-9;
  });
  console.log(`  channel cash shares updated: ${cashShareChanges.map((c) => `${c.name} ${channels.find((x) => x.id === c.id)!.cashPct} → ${c.cashPct}`).join("; ") || "none"}`);
  const groupChanges = wb.opexCategories.filter((c) => {
    const db = opexCats.find((x) => x.company === c.company && x.name === c.name);
    return db && db.plGroup !== c.plGroup;
  });
  console.log(`  expense categories regrouped: ${groupChanges.map((c) => `${c.company} «${c.name}» → ${c.plGroup}`).join("; ") || "none"}`);
  const newCategories = wb.opexCategories.filter((c) => !opexCats.some((x) => x.company === c.company && x.name === c.name));
  console.log(`  expense categories added: ${newCategories.map((c) => `${c.company} «${c.name}»`).join("; ") || "none"}`);
  const arrivedIds = new Set(wb.shipmentHeaders.filter((h) => h.status === "ARRIVED").map((h) => h.id));
  const missingShipments = wb.shipmentHeaders.filter((h) => !shipments.some((s) => s.id === h.id));
  console.log(`  trucks added: ${missingShipments.map((h) => h.code).join(", ") || "none"}`);
  // a truck the workbook records as arrived is arrived; a newer arrival in the app is kept
  const headerUpdates = wb.shipmentHeaders.filter((h) => {
    const db = shipments.find((s) => s.id === h.id);
    return db && h.status === "ARRIVED" && (db.status !== "ARRIVED" || db.monthId !== h.monthId);
  });
  console.log(`  trucks marked arrived or moved: ${headerUpdates.map((h) => `${h.code} (${h.monthId})`).join(", ") || "none"}`);
  const dbLines = await prisma.shipmentLine.findMany({ where: { deletedAt: null, shipmentId: { in: [...arrivedIds] } } });
  console.log(
    `  truck lines (arrived trucks): ${dbLines.length} → ${sum(ds.shipments.filter((s) => arrivedIds.has(s.id)), (s) => s.lines.length)}; purchase ${money(sum(dbLines, (l) => l.qty * l.priceEur * l.rate))} → ${money(sum(ds.shipments.filter((s) => arrivedIds.has(s.id)).flatMap((s) => s.lines), (l) => l.qty * l.priceEur * l.rate))} UZS`
  );
  // an expense of a truck the workbook does not list counts nowhere in the workbook either
  const knownTrucks = new Set(wb.shipmentHeaders.map((h) => h.id));
  const importExpenses = ds.importExpenses.filter((e) => knownTrucks.has(e.shipmentId));
  const orphanExpenses = ds.importExpenses.filter((e) => !knownTrucks.has(e.shipmentId));
  console.log(
    `  import expenses: ${importExpenses.length} rows, ${money(sum(importExpenses, (e) => e.amount))} UZS${orphanExpenses.length > 0 ? `; ${orphanExpenses.length} row(s) of a truck the workbook does not list skipped (${money(sum(orphanExpenses, (e) => e.amount))} UZS)` : ""}`
  );
  console.log(`  TI invoice lines: ${ds.invoices.length}, ${money(sum(ds.invoices, (l) => l.amount))} UZS ex-VAT`);
  console.log(`  TI write-offs: ${ds.writeOffs.length}; TI VAT account: ${ds.vatAccount.length} operations; other VAT charges: ${ds.vatCharges.length}`);
  console.log(`  loans: ${ds.loans.length}; previous owner: ${ds.priorOwner.length}; other receipts: ${ds.otherReceipts.length}; capital: ${ds.contributions.length}; tax filings: ${ds.taxFilings.length}`);
  const lastTransfer = ds.transfers.map((t) => t.date).sort().at(-1) ?? "";
  console.log(
    `  payments from Fargo up to ${lastTransfer}: ${ds.transfers.length} (cash ${money(sum(ds.transfers, (t) => t.cashAmount))}, bank ${money(sum(ds.transfers, (t) => t.bankAmount))}); ${wb.skippedTransfers.length / 2} previous-owner pairs kept under «Previous owner»`
  );
  // the workbook is the full record up to its report month: expenses and
  // receivables are replaced for every month up to it (and any later month it fills)
  const covered = (filled: string[]) => ({ OR: [{ monthId: { lte: wb.reportTo } }, { monthId: { in: filled } }] });
  const opexTiMonths = [...new Set(ds.opexTi.map((e) => e.monthId))].sort();
  const opexFargoMonths = [...new Set(ds.opexFargo.map((e) => e.monthId))].sort();
  const [opexTiNow, opexFargoNow, arNow] = await Promise.all([
    prisma.opexTiEntry.findMany({ where: { deletedAt: null, ...covered(opexTiMonths) }, select: { bankAmount: true, cashAmount: true } }),
    prisma.opexFargoEntry.findMany({ where: { deletedAt: null, ...covered(opexFargoMonths) }, select: { amount: true } }),
    prisma.arEntry.findMany({ where: { deletedAt: null }, select: { monthId: true } }),
  ]);
  console.log(
    `  expenses up to ${wb.reportTo} replaced — TI ${money(sum(opexTiNow, (e) => e.bankAmount + e.cashAmount))} → ${money(sum(ds.opexTi, (e) => e.bankAmount + e.cashAmount))}; Fargo ${money(sum(opexFargoNow, (e) => e.amount))} → ${money(sum(ds.opexFargo, (e) => e.amount))}`
  );
  const arMonths = [...new Set(ds.arEntries.map((a) => a.monthId))].sort();
  const arOutside = [...new Set(arNow.map((a) => a.monthId))].filter((m) => m <= wb.reportTo && !arMonths.includes(m)).sort();
  if (arOutside.length > 0) console.log(`  receivables the workbook does not have, hidden: ${arOutside.join(", ")}`);
  const countMonths = [...new Set(ds.stockCounts.map((c) => c.monthId))].sort();
  console.log(`  receivables for ${arMonths.join(", ")}; stock counts for ${countMonths.join(", ")}; month-end balances for ${ds.monthBalances.map((b) => b.monthId).join(", ")}`);

  // sales are compared, not replaced, unless asked
  const dbSales = await prisma.sale.findMany({ select: { monthId: true, productId: true, qty: true, amount: true } });
  const salesMonths = [...new Set(ds.sales.map((s) => s.monthId))].sort();
  const price = new Map(ds.products.map((p) => [p.id, p.price]));
  const value = (s: { productId: string; qty: number; amount?: number | null }) => s.amount ?? s.qty * (price.get(s.productId) ?? 0);
  const salesDiff = salesMonths.filter((m) => {
    const a = dbSales.filter((s) => s.monthId === m);
    const b = ds.sales.filter((s) => s.monthId === m);
    return Math.abs(sum(a, (s) => s.qty) - sum(b, (s) => s.qty)) > 1e-6 || Math.abs(sum(a, value) - sum(b, value)) > 1;
  });
  console.log(
    WITH_SALES
      ? `  sales replaced for ${salesMonths[0]}…${salesMonths.at(-1)} (${ds.sales.length} rows)`
      : `  sales: ${salesDiff.length === 0 ? "the database matches the workbook" : `differ from the workbook in ${salesDiff.join(", ")} (left as they are; 1C owns sales)`}`
  );

  // ── 3. write ──
  const monthUnion = [...new Set([...months.map((m) => m.id), ...ds.months.map((m) => m.id)])].sort();
  await prisma.$transaction(
    async (tx) => {
      const now = new Date();
      for (const [i, id] of monthUnion.entries()) {
        const row = ds.months.find((m) => m.id === id);
        // months the database has beyond the workbook only keep their place in order
        if (row) {
          await tx.month.upsert({
            where: { id },
            create: { id, nameRu: row.nameRu, nameEn: row.nameEn, sortOrder: i },
            update: { sortOrder: i },
          });
        } else {
          await tx.month.update({ where: { id }, data: { sortOrder: i } });
        }
      }
      if (BOOTSTRAP) {
        for (const p of [...ds.products].sort((a, b) => Number(a.isPromo) - Number(b.isPromo))) {
          if (!productIds.has(p.id)) {
            await tx.product.create({
              data: { id: p.id, nameRu: p.nameRu, price: p.price, isPromo: p.isPromo, regularProductId: p.regularProductId, sortOrder: p.sortOrder },
            });
          }
        }
        for (const c of ds.channels) {
          if (!channelIds.has(c.id)) {
            await tx.channel.create({ data: { id: c.id, name: c.name, cashPct: c.cashPct, sortOrder: c.sortOrder } });
          }
        }
      }
      for (const c of ds.channels) {
        await tx.channel.updateMany({ where: { id: c.id }, data: { cashPct: c.cashPct } });
      }

      // categories and warehouses
      const opexId = new Map<string, string>();
      for (const c of wb.opexCategories) {
        const row = await tx.opexCategory.upsert({
          where: { company_name: { company: c.company, name: c.name } },
          create: { company: c.company, name: c.name, plGroup: c.plGroup },
          update: { plGroup: c.plGroup },
        });
        opexId.set(`${c.company}|${c.name}`, row.id);
      }
      const importId = new Map<string, string>();
      for (const name of wb.importCategories) {
        const row = await tx.importExpenseCategory.upsert({ where: { name }, create: { name }, update: {} });
        importId.set(name, row.id);
      }
      const warehouseId = new Map<string, string>();
      for (const [i, name] of wb.warehouses.entries()) {
        const row = await tx.warehouse.upsert({ where: { name }, create: { name, sortOrder: i }, update: {} });
        warehouseId.set(name, row.id);
      }

      // trucks: headers created when missing; lines and expenses of arrived trucks replaced
      for (const h of missingShipments) {
        await tx.shipment.create({ data: { id: h.id, code: h.code, monthId: h.monthId, status: h.status } });
      }
      for (const h of headerUpdates) {
        await tx.shipment.update({ where: { id: h.id }, data: { status: "ARRIVED", monthId: h.monthId } });
      }
      await tx.shipmentLine.updateMany({ where: { deletedAt: null, shipmentId: { in: [...arrivedIds] } }, data: { deletedAt: now } });
      await tx.shipmentLine.createMany({
        data: ds.shipments
          .filter((s) => arrivedIds.has(s.id))
          .flatMap((s) =>
            s.lines.map((l) => ({
              shipmentId: s.id,
              productId: l.productId,
              qty: l.qty,
              priceEur: l.priceEur,
              rate: l.rate,
              fixedUnitCost: l.fixedUnitCost,
            }))
          ),
      });
      const expenseShipments = [...new Set(importExpenses.map((e) => e.shipmentId))];
      await tx.importExpense.updateMany({ where: { deletedAt: null, shipmentId: { in: expenseShipments } }, data: { deletedAt: now } });
      await tx.importExpense.createMany({
        data: importExpenses.map((e) => ({
          monthId: e.monthId,
          shipmentId: e.shipmentId,
          categoryId: importId.get(e.categoryName)!,
          amount: e.amount,
          paidMonthId: e.paidMonthId ?? null,
          notes: e.notes ?? null,
        })),
      });

      // TI ↔ Fargo
      await tx.tiInvoiceLine.updateMany({ where: { deletedAt: null }, data: { deletedAt: now } });
      await tx.tiInvoiceLine.createMany({
        data: ds.invoices.map((l) => ({
          date: day(l.date),
          number: l.number,
          productId: l.productId,
          qty: l.qty,
          price: l.price,
          amount: l.amount,
          vat: l.vat,
          ownUnitCost: l.ownUnitCost,
          sortOrder: l.sortOrder,
        })),
      });
      await tx.tiWriteOff.updateMany({ where: { deletedAt: null }, data: { deletedAt: now } });
      await tx.tiWriteOff.createMany({
        data: ds.writeOffs.map((w) => ({ date: day(w.date), productId: w.productId, qty: w.qty, reason: w.reason ?? null })),
      });
      await tx.fargoTransfer.updateMany({
        where: { deletedAt: null, date: { lte: new Date(`${lastTransfer.slice(0, 10)}T23:59:59.999Z`) } },
        data: { deletedAt: now },
      });
      await tx.fargoTransfer.createMany({
        data: ds.transfers.map((t) => ({ date: day(t.date), cashAmount: t.cashAmount, bankAmount: t.bankAmount, notes: t.notes ?? null })),
      });

      // expenses for the months the workbook covers
      await tx.opexTiEntry.updateMany({ where: { deletedAt: null, ...covered(opexTiMonths) }, data: { deletedAt: now } });
      await tx.opexTiEntry.createMany({
        data: ds.opexTi.map((e) => ({
          monthId: e.monthId,
          categoryId: opexId.get(`TI|${e.categoryName}`)!,
          bankAmount: e.bankAmount,
          cashAmount: e.cashAmount,
        })),
      });
      await tx.opexFargoEntry.updateMany({ where: { deletedAt: null, ...covered(opexFargoMonths) }, data: { deletedAt: now } });
      await tx.opexFargoEntry.createMany({
        data: ds.opexFargo.map((e) => ({ monthId: e.monthId, categoryId: opexId.get(`FARGO|${e.categoryName}`)!, amount: e.amount })),
      });

      // taxes
      await tx.tiTaxFiling.updateMany({ where: { deletedAt: null }, data: { deletedAt: now } });
      await tx.tiTaxFiling.createMany({
        data: ds.taxFilings.map((f) => ({
          quarterLabel: f.quarterLabel,
          taxAmount: f.taxAmount,
          bookedMonthId: f.bookedMonthId,
          paidMonthId: f.paidMonthId ?? null,
          declaredExpenses: f.declaredExpenses,
        })),
      });
      await tx.tiVatAccountEntry.updateMany({ where: { deletedAt: null }, data: { deletedAt: now } });
      await tx.tiVatAccountEntry.createMany({
        data: ds.vatAccount.map((e) => ({
          period: e.period,
          date: e.date ? day(e.date) : null,
          description: e.description,
          charged: e.charged,
          reduced: e.reduced,
          paid: e.paid,
          refunded: e.refunded,
          balanceAfter: e.balanceAfter,
          sortOrder: e.sortOrder,
        })),
      });
      await tx.tiVatCharge.updateMany({ where: { deletedAt: null }, data: { deletedAt: now } });
      await tx.tiVatCharge.createMany({
        data: ds.vatCharges.map((c) => ({ monthId: c.monthId, description: c.description, amount: c.amount, bearer: c.bearer })),
      });
      for (const r of ds.fargoVatReturns) {
        await tx.fargoVatReturn.upsert({ where: { monthId: r.monthId }, create: r, update: r });
      }

      // funding
      await tx.loanMovement.updateMany({ where: { deletedAt: null }, data: { deletedAt: now } });
      await tx.loanMovement.createMany({
        data: ds.loans.map((l) => ({ monthId: l.monthId, lender: l.lender, received: l.received, repaid: l.repaid, notes: l.notes ?? null })),
      });
      await tx.priorOwnerEntry.updateMany({ where: { deletedAt: null }, data: { deletedAt: now } });
      await tx.priorOwnerEntry.createMany({
        data: ds.priorOwner.map((p) => ({
          date: day(p.date),
          description: p.description,
          received: p.received,
          paid: p.paid,
          viaFargo: p.viaFargo,
          notes: p.notes ?? null,
        })),
      });
      await tx.otherReceipt.updateMany({ where: { deletedAt: null }, data: { deletedAt: now } });
      await tx.otherReceipt.createMany({
        data: ds.otherReceipts.map((o) => ({ date: day(o.date), payer: o.payer, amount: o.amount, notes: o.notes ?? null })),
      });
      await tx.capitalContribution.updateMany({ where: { deletedAt: null }, data: { deletedAt: now } });
      await tx.capitalContribution.createMany({
        data: ds.contributions.map((c) => ({
          date: day(c.date),
          tiAmount: c.tiAmount,
          fargoAmount: c.fargoAmount,
          viaFargo: c.viaFargo,
          notes: c.notes ?? null,
        })),
      });

      // month-end inputs
      await tx.arEntry.updateMany({ where: { deletedAt: null, ...covered(arMonths) }, data: { deletedAt: now } });
      await tx.arEntry.createMany({
        data: ds.arEntries.map((a) => ({ monthId: a.monthId, customerName: a.customerName, amount: a.amount })),
      });
      await tx.stockCount.deleteMany({ where: { monthId: { in: countMonths } } });
      await tx.stockCount.createMany({
        data: ds.stockCounts.map((c) => ({
          monthId: c.monthId,
          productId: c.productId,
          warehouseId: warehouseId.get(c.warehouseId)!,
          qty: c.qty,
        })),
      });
      for (const b of ds.monthBalances) {
        await tx.monthBalance.upsert({
          where: { monthId: b.monthId },
          create: { monthId: b.monthId, tiBank: b.tiBank, tiCash: b.tiCash, goodsInTransit: b.goodsInTransit },
          update: { tiBank: b.tiBank, tiCash: b.tiCash, goodsInTransit: b.goodsInTransit },
        });
      }

      const current = await tx.setting.findUnique({ where: { key: "taxes" } });
      const merged = { ...(current ? (JSON.parse(current.value) as object) : {}), ...ds.taxes };
      await tx.setting.upsert({
        where: { key: "taxes" },
        create: { key: "taxes", value: JSON.stringify(merged) },
        update: { value: JSON.stringify(merged) },
      });

      if (WITH_SALES) {
        await tx.sale.deleteMany({ where: { monthId: { in: salesMonths } } });
        const merged = new Map<string, { monthId: string; productId: string; channelId: string; qty: number; amount: number | null }>();
        for (const s of ds.sales) {
          const key = `${s.monthId}|${s.productId}|${s.channelId}`;
          const prev = merged.get(key);
          if (prev) {
            prev.qty += s.qty;
            prev.amount = prev.amount == null || s.amount == null ? null : prev.amount + s.amount;
          } else {
            merged.set(key, { ...s, amount: s.amount ?? null });
          }
        }
        await tx.sale.createMany({ data: [...merged.values()].map((s) => ({ ...s, source: "IMPORT" })) });
      }

      await tx.auditLog.create({
        data: {
          entity: "workbook",
          entityId: path!.split(/[\\/]/).pop() ?? "workbook",
          action: "IMPORT",
          data: JSON.stringify({
            reportTo: wb.reportTo,
            invoices: ds.invoices.length,
            transfers: ds.transfers.length,
            withSales: WITH_SALES,
          }),
          username: "import-workbook",
        },
      });

      // ── 4. the database must now give the workbook's figures ──
      const after = compareWithWorkbook(
        compute(await buildDataset(tx as unknown as Parameters<typeof buildDataset>[0])),
        wb.expected,
        wb.reportTo
      );
      console.log("\nAfter writing, from the database:");
      for (const line of after.lines) console.log(line);
      if (!after.ok && !WITH_SALES && salesDiff.length > 0) {
        console.log("  (sales in the database differ from the workbook — see above)");
      }
      if (!COMMIT) throw new Rollback("dry run");
      if (!after.ok && !ACCEPT_DIFFERENCES) throw new Rollback("differences");
    },
    { timeout: 300_000, maxWait: 60_000 }
  );
  console.log("\nDone — the import is saved.");
}

main()
  .catch((e) => {
    if (e instanceof Rollback) {
      console.log(
        e.message === "dry run"
          ? "\nDry run — everything above was rolled back; nothing was written."
          : "\nStopped: the figures from the database differ from the workbook, so everything was rolled back and nothing was written."
      );
      return;
    }
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
