import { prisma } from "@/lib/db";
import { pageContext, type SearchParams } from "@/lib/page-context";
import { costProductIdOf, isImportVat } from "@/lib/engine/compute";
import ShipmentsView from "@/components/ShipmentsView";

export default async function ShipmentsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const ctx = await pageContext(sp.month);
  const { dataset, computed } = ctx;
  const [importCategories, expenses, transit, meta] = await Promise.all([
    prisma.importExpenseCategory.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.importExpense.findMany({ where: { deletedAt: null }, include: { category: true, shipment: true } }),
    prisma.shipment.findMany({
      where: { deletedAt: null, status: "TRANSIT" },
      include: { lines: { where: { deletedAt: null } } },
      orderBy: { etaDate: "asc" },
    }),
    prisma.shipment.findMany({
      where: { deletedAt: null },
      select: { id: true, status: true, etaDate: true, dispatchDate: true },
    }),
  ]);
  const now = new Date();
  const currentMonthId = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

  return (
    <ShipmentsView
      months={dataset.months}
      products={dataset.products.map((p) => ({
        id: p.id,
        nameRu: p.nameRu,
        price: p.price,
        isPromo: p.isPromo,
        productLine: p.productLine ?? null,
        costProductId: costProductIdOf(p.id, dataset),
      }))}
      shipmentCosts={computed.shipments.filter((s) => s.status === "ARRIVED")}
      expenses={expenses.map((e) => ({
        id: e.id,
        monthId: e.monthId,
        shipmentId: e.shipmentId,
        shipmentCode: e.shipment.code,
        categoryId: e.categoryId,
        categoryName: e.category.name,
        amount: e.amount,
        paidMonthId: e.paidMonthId,
        isVat: isImportVat(e.category.name),
        notes: e.notes,
      }))}
      importCategories={importCategories.map((c) => ({ id: c.id, name: c.name }))}
      transit={transit.map((s) => ({
        id: s.id,
        code: s.code,
        etaDate: day(s.etaDate),
        totalUnits: s.lines.reduce((sum, l) => sum + l.qty, 0),
      }))}
      statusById={Object.fromEntries(
        meta.map((s) => [s.id, { status: s.status, etaDate: day(s.etaDate), dispatchDate: day(s.dispatchDate) }])
      )}
      currentMonthId={
        dataset.months.some((m) => m.id === currentMonthId) ? currentMonthId : dataset.months.at(-1)?.id ?? currentMonthId
      }
      readOnly={!ctx.canEditAny}
    />
  );
}
