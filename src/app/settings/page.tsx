import { prisma } from "@/lib/db";
import { loadDataset } from "@/lib/data";
import { getSession } from "@/lib/auth";
import SettingsView from "@/components/SettingsView";

export default async function SettingsPage() {
  const dataset = await loadDataset();
  const session = await getSession();
  const opexCategories = await prisma.opexCategory.findMany({ orderBy: [{ company: "asc" }, { sortOrder: "asc" }] });
  const importCategories = await prisma.importExpenseCategory.findMany({ orderBy: { name: "asc" } });

  return (
    <SettingsView
      products={dataset.products.map((p) => ({
        id: p.id,
        nameRu: p.nameRu,
        nameEn: p.nameEn ?? "",
        code1c: p.code1c ?? "",
        productLine: p.productLine ?? "",
        price: p.price,
        isPromo: p.isPromo,
        regularProductId: p.regularProductId ?? "",
        sortOrder: p.sortOrder,
      }))}
      channels={dataset.channels.map((c) => ({
        id: c.id,
        name: c.name,
        code1c: c.code1c ?? "",
        retroPct: c.retroPct,
        cashPct: c.cashPct,
        bankPct: 1 - c.cashPct,
        sortOrder: c.sortOrder,
      }))}
      months={dataset.months.map((m) => ({ ...m }))}
      warehouses={await prisma.warehouse
        .findMany({ orderBy: { sortOrder: "asc" } })
        .then((list) => list.map((w) => ({ id: w.id, name: w.name, code1c: w.code1c ?? "", sortOrder: w.sortOrder })))}
      opexCategories={opexCategories.map((c) => ({
        id: c.id,
        company: c.company,
        name: c.name,
        plGroup: c.plGroup ?? "",
        sortOrder: c.sortOrder,
      }))}
      importCategories={importCategories.map((c) => ({ id: c.id, name: c.name }))}
      clients={await prisma.clientChannelMap
        .findMany({ where: { deletedAt: null }, orderBy: { totalQty: "desc" } })
        .then((list) =>
          list.map((c) => ({
            id: c.id,
            displayName: c.displayName,
            channelId: c.channelId ?? "",
            source: c.source,
            lastSeenAt: c.lastSeenAt.toISOString().slice(0, 10),
            totalQty: c.totalQty,
          }))
        )}
      taxes={dataset.taxes}
      readOnly={session?.role !== "ADMIN"}
    />
  );
}
