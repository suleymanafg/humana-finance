import SalesView from "@/components/SalesView";
import Sync1cPanel from "@/components/Sync1cPanel";
import { salesData } from "@/lib/sales-data";
import type { SearchParams } from "@/lib/page-context";

export default async function SalesDataPage({ searchParams }: { searchParams: SearchParams }) {
  const { month } = await searchParams;
  const { ctx, props } = await salesData(month);
  const m = ctx.dataset.months.find((x) => x.id === ctx.monthId);
  return (
    <>
      {ctx.canEditAny && <Sync1cPanel monthId={ctx.monthId} monthName={m ? ctx.l({ ru: m.nameRu, en: m.nameEn }) : ctx.monthId} />}
      <SalesView tab="data" {...props} />
    </>
  );
}
