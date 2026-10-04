import { pageContext, type SearchParams } from "@/lib/page-context";
import { fmtN } from "@/lib/format";
import { ParamSelect, Toolbar } from "@/components/statement";
import FifoTables from "@/components/FifoTables";

/** Units left in each batch once the first `used` units have been drawn. */
function remaining<T extends { qty: number }>(batches: T[], used: number): Array<T & { left: number }> {
  let rest = used;
  return batches.map((b) => {
    const take = Math.max(0, Math.min(b.qty, rest));
    rest -= take;
    return { ...b, left: b.qty - take };
  });
}

export default async function FifoPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const ctx = await pageContext(sp.month);
  const { dataset, computed, monthId } = ctx;
  const regular = dataset.products.filter((p) => !p.isPromo && computed.fifo[p.id]);
  const productId = regular.some((p) => p.id === sp.product) ? sp.product! : regular[0]?.id ?? "";
  const pf = computed.fifo[productId];
  const name = (id: string) => dataset.products.find((p) => p.id === id)?.nameRu ?? id;

  // TI draws on trucks for its invoices (outside own-cost lines) and write-offs
  const tiUsed =
    computed.invoices.filter((l) => l.costProductId === productId && !l.outsideFifo && l.monthId <= monthId).reduce((s, l) => s + l.qty, 0) +
    computed.writeOffs.filter((w) => w.costProductId === productId && w.monthId <= monthId).reduce((s, w) => s + w.qty, 0);
  const fm = pf?.months[monthId];
  const fargoUsed = fm ? fm.cumSold + fm.cumCountDiff : 0;

  const monthsUpTo = computed.monthIds.filter((m) => m <= monthId);
  const summary = regular.map((p) => {
    const x = computed.fifo[p.id].months[monthId];
    return {
      productId: p.id,
      name: p.nameRu,
      unitsSold: x?.unitsSold ?? 0,
      fargoUnitCost: x?.fargoUnitCost ?? 0,
      groupUnitCost: x?.groupUnitCost ?? 0,
      fargoUnits: x?.fargoStockUnits ?? 0,
      fargoStock: x?.fargoStock ?? 0,
      fargoStockTi: x?.fargoStockTi ?? 0,
    };
  });

  return (
    <>
      <FifoTables
        summary={summary}
        tiBatches={remaining(pf?.tiBatches ?? [], tiUsed).map((b, i) => ({
          key: `${b.shipmentId}-${i}`,
          label: b.code,
          monthId: b.monthId,
          qty: b.qty,
          unit: b.unitCost,
          left: b.left,
        }))}
        fargoBatches={remaining(pf?.fargoBatches ?? [], fargoUsed).map((b) => ({
          key: b.lineId,
          label: `№ ${b.number}`,
          date: b.date.slice(0, 10),
          qty: b.qty,
          unit: b.price,
          tiUnit: b.tiUnitCost,
          left: b.left,
        }))}
        monthly={monthsUpTo.map((m) => {
          const x = pf?.months[m];
          return {
            monthId: m,
            unitsSold: x?.unitsSold ?? 0,
            fargoUnitCost: x?.fargoUnitCost ?? 0,
            groupUnitCost: x?.groupUnitCost ?? 0,
            fargoCogs: x?.fargoCogs ?? 0,
            groupCogs: x?.groupCogs ?? 0,
            loss: x?.groupLoss ?? 0,
          };
        })}
        months={ctx.months}
        productName={name(productId)}
        picker={
          <Toolbar>
            <ParamSelect param="product" value={productId} options={regular.map((p) => ({ value: p.id, label: p.nameRu }))} />
            <span className="text-[12.5px] text-muted">
              {ctx.l({ ru: "У Fargo на конец месяца", en: "At Fargo at month-end" })}: {fmtN(fm?.fargoStockUnits ?? 0)}{" "}
              {ctx.l({ ru: "шт", en: "units" })}
            </span>
          </Toolbar>
        }
      />
    </>
  );
}
