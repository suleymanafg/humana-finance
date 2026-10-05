import { pageContext, type SearchParams } from "@/lib/page-context";
import { fmtN } from "@/lib/format";
import { Figure, SectionTitle } from "@/components/statement";
import EntryGrid from "@/components/EntryGrid";
import MonthTotals from "@/components/MonthTotals";
import WriteOffTiStock from "@/components/WriteOffTiStock";

export default async function WriteOffsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const ctx = await pageContext(sp.month);
  const { dataset, computed, monthId } = ctx;
  const l = ctx.l;
  const month = dataset.months.find((m) => m.id === monthId);
  const monthName = l({ ru: month?.nameRu ?? monthId, en: month?.nameEn ?? monthId });
  const [y, m] = monthId.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const products = dataset.products.filter((p) => !p.isPromo).map((p) => ({ value: p.id, label: p.nameRu }));
  const name = (id: string) => dataset.products.find((p) => p.id === id)?.nameRu ?? id;
  const reasons = [
    { value: "EXPIRED", label: l({ ru: "Просрочка", en: "Expired" }) },
    { value: "DAMAGED", label: l({ ru: "Брак, повреждение", en: "Damaged" }) },
    { value: "OTHER", label: l({ ru: "Прочее", en: "Other" }) },
  ];

  const fargoRows = computed.fargoWriteOffs
    .filter((w) => w.monthId === monthId)
    .map((w) => ({ id: w.id, date: w.date.slice(0, 10), productId: w.productId, qty: w.qty, reason: w.reason, notes: w.notes ?? "", value: w.value }));
  const tiRows = computed.writeOffs
    .filter((w) => w.monthId === monthId)
    .map((w) => ({ id: w.id, date: w.date.slice(0, 10), productId: w.productId, qty: w.qty, reason: w.reason ?? "", value: w.value }));
  const fargo = computed.fargo.find((f) => f.monthId === monthId);
  const ti = computed.ti.find((t) => t.monthId === monthId);
  const stock = computed.stock.find((s) => s.monthId === monthId);
  const units = (rows: Array<{ qty: number }>) => rows.reduce((s, r) => s + r.qty, 0);

  // what TI still holds at the month's end, for the one-step write-off
  const tiHeld = (stock?.products ?? [])
    .filter((p) => p.tiUnits > 0)
    .map((p) => ({
      productId: p.productId,
      name: name(p.productId),
      units: p.tiUnits,
      value: computed.fifo[p.productId]?.months[monthId]?.tiStock ?? 0,
    }));

  const byMonth = computed.monthIds
    .filter((id) => id <= monthId)
    .map((id) => {
      const f = computed.fargo.find((x) => x.monthId === id);
      const t = computed.ti.find((x) => x.monthId === id);
      return {
        monthId: id,
        values: [
          units(computed.fargoWriteOffs.filter((w) => w.monthId === id)),
          f?.writeOffLoss ?? 0,
          units(computed.writeOffs.filter((w) => w.monthId === id)),
          t?.giveaways ?? 0,
          f?.stockLoss ?? 0,
        ],
      };
    })
    .filter((r) => r.values.some((v) => Math.abs(v) >= 0.5));

  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Figure
          label={l({ ru: "Списано у Fargo", en: "Written off at Fargo" })}
          value={fmtN(fargo?.writeOffLoss ?? 0)}
          sub={`${fmtN(units(fargoRows))} ${l({ ru: "шт · по ценам счетов TI", en: "units · at TI invoice prices" })}`}
        />
        <Figure
          label={l({ ru: "Образцы и лаборатория, TI", en: "Samples and laboratory, TI" })}
          value={fmtN(ti?.giveaways ?? 0)}
          sub={`${fmtN(units(tiRows))} ${l({ ru: "шт · по себестоимости TI", en: "units · at TI landed cost" })}`}
        />
        <Figure
          label={l({ ru: "Потери по инвентаризации", en: "Stock loss at the count" })}
          value={fmtN(fargo?.stockLoss ?? 0)}
          sub={
            stock?.isCountMonth
              ? l({ ru: "не объяснено списаниями · по ценам счетов TI", en: "not explained by write-offs · at TI invoice prices" })
              : l({ ru: "пересчёта в этом месяце нет", en: "no count this month" })
          }
        />
      </div>

      <SectionTitle>{l({ ru: "Списания у Fargo: просрочка, брак, прочее", en: "Write-offs at Fargo: expired, damaged, other" })}</SectionTitle>
      <p className="-mt-1 mb-2.5 text-[12.5px] text-muted">
        {l({
          ru: "Количество по товарам; стоимость считается по FIFO. Списанное уходит из учётного остатка Fargo, поэтому пересчёт показывает только необъяснённое расхождение.",
          en: "Quantities by product; the cost follows FIFO. Written-off goods leave Fargo's book stock, so a count shows only the difference left unexplained.",
        })}
      </p>
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <EntryGrid
          entity="fargoWriteOff"
          rows={fargoRows}
          readOnly={!ctx.canEdit}
          defaults={{ date: lastDay, reason: "EXPIRED" }}
          sumFields={["qty", "value"]}
          cols={[
            { field: "date", label: l({ ru: "Дата", en: "Date" }), type: "date", width: "150px" },
            { field: "productId", label: l({ ru: "Товар", en: "Product" }), type: "select", options: products },
            { field: "qty", label: l({ ru: "Кол-во", en: "Qty" }), type: "number", width: "110px" },
            { field: "reason", label: l({ ru: "Причина", en: "Reason" }), type: "select", options: reasons, width: "190px" },
            { field: "notes", label: l({ ru: "Примечание", en: "Note" }), type: "text" },
            { field: "value", label: l({ ru: "Себестоимость, FIFO", en: "Cost, FIFO" }), type: "number", readOnly: true, width: "160px" },
          ]}
          emptyLabel={l({ ru: "За этот месяц списаний у Fargo нет", en: "No write-offs at Fargo this month" })}
        />
      </div>

      <SectionTitle right={ctx.canEdit && <WriteOffTiStock monthId={monthId} monthName={monthName} rows={tiHeld} />}>
        {l({ ru: "Образцы и лаборатория: со склада TI", en: "Samples and laboratory: from TI's stock" })}
      </SectionTitle>
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <EntryGrid
          entity="tiWriteOff"
          rows={tiRows}
          readOnly={!ctx.canEdit}
          defaults={{ date: lastDay }}
          sumFields={["qty", "value"]}
          cols={[
            { field: "date", label: l({ ru: "Дата", en: "Date" }), type: "date", width: "150px" },
            { field: "productId", label: l({ ru: "Товар", en: "Product" }), type: "select", options: products },
            { field: "qty", label: l({ ru: "Кол-во", en: "Qty" }), type: "number", width: "110px" },
            { field: "reason", label: l({ ru: "Причина", en: "Reason" }), type: "text" },
            { field: "value", label: l({ ru: "Себестоимость, FIFO", en: "Cost, FIFO" }), type: "number", readOnly: true, width: "160px" },
          ]}
          emptyLabel={l({ ru: "За этот месяц списаний TI нет", en: "No TI write-offs this month" })}
        />
      </div>

      <SectionTitle>{l({ ru: "По месяцам", en: "By month" })}</SectionTitle>
      <MonthTotals
        months={ctx.months}
        rows={byMonth}
        columns={[
          { ru: "Списано у Fargo, шт", en: "Written off at Fargo, units" },
          { ru: "Списано у Fargo, сум", en: "Written off at Fargo, UZS" },
          { ru: "Списано у TI, шт", en: "Written off at TI, units" },
          { ru: "Списано у TI, сум", en: "Written off at TI, UZS" },
          { ru: "Потери Fargo по пересчёту", en: "Fargo count loss" },
        ]}
      />
    </>
  );
}
