import Link from "next/link";
import { pageContext, type SearchParams } from "@/lib/page-context";
import { fmtN } from "@/lib/format";
import { Figure, SectionTitle } from "@/components/statement";
import StockCountGrid from "@/components/StockCountGrid";
import StockTable from "@/components/StockTable";

export default async function StockPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const ctx = await pageContext(sp.month);
  const { dataset, computed, monthId } = ctx;
  const stock = computed.stock.find((s) => s.monthId === monthId);
  const regular = dataset.products.filter((p) => !p.isPromo);
  const name = (id: string) => dataset.products.find((p) => p.id === id)?.nameRu ?? id;
  const rows = (stock?.products ?? [])
    .filter((r) => r.arrived !== 0 || r.invoiced !== 0 || r.sold !== 0)
    .map((r) => {
      const f = computed.fifo[r.productId]?.months[monthId];
      return {
        productId: r.productId,
        name: name(r.productId),
        tiUnits: r.tiUnits,
        fargoBook: r.fargoBook,
        counted: r.counted,
        difference: r.difference,
        cumDifference: r.cumDifference,
        lossMonth: f?.groupLoss ?? 0,
        fargoUnits: f?.fargoStockUnits ?? 0,
        valueTi: (f?.fargoStockTi ?? 0) + (f?.tiStock ?? 0),
      };
    });
  const sum = (pick: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + pick(r), 0);
  const group = computed.group.find((g) => g.monthId === monthId);
  const lossToDate = computed.group.filter((g) => g.monthId <= monthId).reduce((s, g) => s + g.stockLoss, 0);
  // a month whose rows are all zero has not been counted yet: show it empty
  const monthCounts = dataset.stockCounts.filter((c) => c.monthId === monthId);
  const counts: Record<string, number> = {};
  if (monthCounts.some((c) => c.qty !== 0)) for (const c of monthCounts) counts[`${c.productId}|${c.warehouseId}`] = c.qty;
  const countMonths = computed.stock.filter((s) => s.isCountMonth && s.monthId <= monthId);

  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Figure
          label={ctx.l({ ru: "Товар по стоимости TI", en: "Stock at TI landed cost" })}
          value={fmtN(sum((r) => r.valueTi))}
          sub={`${fmtN(sum((r) => r.fargoUnits + r.tiUnits))} ${ctx.l({ ru: "шт", en: "units" })}`}
        />
        <Figure
          label={ctx.l({ ru: "Расхождение по пересчёту, шт", en: "Count difference, units" })}
          value={stock?.isCountMonth ? fmtN(sum((r) => r.difference ?? 0)) : "—"}
          sub={stock?.isCountMonth ? ctx.l({ ru: "учётный остаток минус факт", en: "book less counted" }) : ctx.l({ ru: "пересчёта в этом месяце нет", en: "no count this month" })}
        />
        <Figure
          label={ctx.l({ ru: "Потери за месяц", en: "Loss in the month" })}
          value={fmtN(group?.stockLoss ?? 0)}
          sub={ctx.l({ ru: "по стоимости TI", en: "at TI landed cost" })}
        />
        <Figure
          label={ctx.l({ ru: "Потери с начала", en: "Loss to date" })}
          value={fmtN(lossToDate)}
          sub={ctx.l({ ru: "по стоимости TI", en: "at TI landed cost" })}
        />
      </div>

      <SectionTitle
        right={
          <Link href={`/goods/write-offs?month=${monthId}`} className="text-[12.5px] text-accent hover:underline">
            {ctx.l({ ru: "Списания", en: "Write-offs" })}
          </Link>
        }
      >
        {ctx.l({ ru: "Остатки по товарам на конец месяца", en: "Stock by product at month-end" })}
      </SectionTitle>
      <StockTable rows={rows} isCountMonth={!!stock?.isCountMonth} />

      <SectionTitle>{ctx.l({ ru: "Пересчёт на складах", en: "Warehouse count" })}</SectionTitle>
      <StockCountGrid
        monthId={monthId}
        products={regular.map((p) => ({ id: p.id, name: p.nameRu }))}
        warehouses={dataset.warehouses.map((w) => ({ id: w.id, name: w.name }))}
        counts={counts}
        readOnly={!ctx.canEdit}
      />

      <SectionTitle>{ctx.l({ ru: "История пересчётов", en: "Count history" })}</SectionTitle>
      <p className="-mt-1 mb-2.5 text-[12.5px] text-muted">
        {ctx.l({
          ru: "Учётный остаток — счета TI минус продажи и списания Fargo. Расхождение копится с начала; потери месяца — только новое расхождение с прошлого пересчёта.",
          en: "Book stock is TI's invoices less Fargo's sales and write-offs. The difference builds up from the start; a month's loss is only the new difference since the previous count.",
        })}
      </p>
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="stmt is-compact">
          <thead>
            <tr>
              <th>{ctx.l({ ru: "Месяц пересчёта", en: "Count month" })}</th>
              <th>{ctx.l({ ru: "Учётный остаток Fargo, шт", en: "Fargo book stock, units" })}</th>
              <th>{ctx.l({ ru: "Пересчитано, шт", en: "Counted, units" })}</th>
              <th>{ctx.l({ ru: "Расхождение с начала, шт", en: "Difference to date, units" })}</th>
              <th>{ctx.l({ ru: "Новое расхождение, шт", en: "New difference, units" })}</th>
              <th>{ctx.l({ ru: "Потери за месяц, по стоимости TI", en: "Loss in the month, at TI cost" })}</th>
            </tr>
          </thead>
          <tbody>
            {countMonths.length === 0 && (
              <tr>
                <td colSpan={6} className="!py-6 !text-center text-muted">
                  {ctx.l({ ru: "Пересчётов пока нет", en: "No counts yet" })}
                </td>
              </tr>
            )}
            {[...countMonths].reverse().map((s, i, all) => {
              const book = s.products.reduce((t, p) => t + p.fargoBook, 0);
              const counted = s.products.reduce((t, p) => t + (p.counted ?? 0), 0);
              // the count before this one is next in the newest-first list
              const prev = all[i + 1]?.products.reduce((t, p) => t + (p.difference ?? 0), 0) ?? 0;
              const loss = computed.group.find((g) => g.monthId === s.monthId)?.stockLoss ?? 0;
              const m = dataset.months.find((x) => x.id === s.monthId);
              return (
                <tr key={s.monthId}>
                  <td>{m ? ctx.l({ ru: m.nameRu, en: m.nameEn }) : s.monthId}</td>
                  <td>{fmtN(book)}</td>
                  <td>{fmtN(counted)}</td>
                  <td>{fmtN(book - counted)}</td>
                  <td className={book - counted - prev > 0 ? "text-danger" : ""}>{fmtN(book - counted - prev)}</td>
                  <td>{Math.abs(loss) < 0.5 ? "—" : fmtN(loss)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
