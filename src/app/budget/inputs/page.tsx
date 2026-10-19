// «Допущения» — the budget's assumptions: edit the estimate (the capital answer
// recalculates as you type). Below: keep the estimate for the month's start,
// set the original budget, or load a budget workbook from Excel.
import { pageContext, type SearchParams } from "@/lib/page-context";
import { loadBudget } from "@/lib/budget/data";
import BudgetImport from "@/components/budget/BudgetImport";
import BudgetInputsEditor from "@/components/budget/BudgetInputsEditor";
import SaveEstimate from "@/components/budget/SaveEstimate";

export const dynamic = "force-dynamic";

export default async function BudgetInputsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const ctx = await pageContext(sp.month);
  const data = await loadBudget();
  if (data.empty) return <BudgetImport hasBudget={false} />;
  const firstOpen = data.plan?.months[0] ?? null;
  const kept = firstOpen ? data.estimates.find((e) => e.monthId === firstOpen) ?? null : null;

  return (
    <>
      <BudgetInputsEditor
        key={data.working.savedAt}
        approved={data.approved}
        working={data.working}
        realOpening={data.realOpening}
        alreadyIn={data.actuals.reduce((t, a) => t + a.cash.capital, 0)}
        closed={data.actuals.map((a) => a.monthId)}
        supply={data.supply}
      />
      <div className="mt-8 space-y-4">
        {firstOpen && ctx.isAdmin && (
          <div className="rounded-lg border border-border bg-surface px-4 py-3">
            <SaveEstimate month={firstOpen} keptAt={kept?.takenAt ?? null} />
          </div>
        )}
        <BudgetImport hasBudget />
      </div>
    </>
  );
}
