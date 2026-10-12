import SalesView from "@/components/SalesView";
import Sync1cPanel from "@/components/Sync1cPanel";
import { salesData } from "@/lib/sales-data";
import type { SearchParams } from "@/lib/page-context";
import { salesApiLink, salesApiPeriodLink } from "@/lib/sync-1c-core";

export default async function SalesDataPage({ searchParams }: { searchParams: SearchParams }) {
  const { month } = await searchParams;
  const { ctx, props } = await salesData(month);
  const name = (id: string) => {
    const m = ctx.dataset.months.find((x) => x.id === id);
    return m ? ctx.l({ ru: m.nameRu, en: m.nameEn }) : id;
  };
  // every month with sales: one file saved from this link serves the reconciliation and each month
  const withSales = [...new Set(ctx.dataset.sales.map((s) => s.monthId))].sort();
  const first = withSales[0] ?? ctx.monthId;
  const last = withSales[withSales.length - 1] ?? ctx.monthId;
  return (
    <>
      {ctx.canEditAny && (
        <Sync1cPanel
          monthId={ctx.monthId}
          monthName={name(ctx.monthId)}
          apiLink={salesApiLink(ctx.monthId)}
          periodLink={salesApiPeriodLink(first, last)}
          periodName={first === last ? name(first) : `${name(first)} – ${name(last)}`}
        />
      )}
      <SalesView tab="data" {...props} />
    </>
  );
}
