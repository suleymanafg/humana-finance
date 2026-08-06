import { getComputed } from "@/lib/data";
import { getSession } from "@/lib/auth";
import { canEditData } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import ShipmentsView from "@/components/ShipmentsView";
import { costProductIdOf } from "@/lib/engine/compute";

export default async function ShipmentsPage() {
  const { dataset, computed } = await getComputed();
  const session = await getSession();
  const importCategories = await prisma.importExpenseCategory.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
  });
  const expenses = await prisma.importExpense.findMany({
    where: { deletedAt: null },
    include: { category: true, shipment: true },
  });

  // sold-to-date per product, for the purchased-vs-sold balance
  const soldQty: Record<string, number> = {};
  const soldRevenue: Record<string, number> = {};
  for (const m of computed.monthly) {
    for (const [pid, qty] of Object.entries(m.qtyByProduct)) {
      soldQty[pid] = (soldQty[pid] ?? 0) + qty;
      soldRevenue[pid] = (soldRevenue[pid] ?? 0) + (m.revenueByProduct[pid] ?? 0);
    }
  }

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
      shipmentCosts={computed.shipmentCosts}
      productCosts={computed.productCosts}
      soldQty={soldQty}
      soldRevenue={soldRevenue}
      ytdCogs={computed.ytd.cogs}
      ytdRevenue={computed.ytd.revenue}
      ytdGpMargin={computed.ytd.gpMarginPct}
      expenses={expenses.map((e) => ({
        id: e.id,
        monthId: e.monthId,
        shipmentId: e.shipmentId,
        shipmentCode: e.shipment.code,
        categoryId: e.categoryId,
        categoryName: e.category.name,
        amount: e.amount,
        notes: e.notes,
      }))}
      importCategories={importCategories.map((c) => ({ id: c.id, name: c.name }))}
      readOnly={!canEditData(session?.role)}
    />
  );
}
