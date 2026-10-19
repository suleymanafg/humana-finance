// «Допущения» — the budget's assumptions: edit the working forecast (the answer
// recalculates as you type), approve it as the budget, or load a budget
// workbook from Excel.
import { loadBudget, statusInfo } from "@/lib/budget/data";
import BudgetImport from "@/components/budget/BudgetImport";
import BudgetInputsEditor from "@/components/budget/BudgetInputsEditor";
import { BudgetStatus } from "@/components/budget/BudgetStatus";

export const dynamic = "force-dynamic";

export default async function BudgetInputsPage() {
  const data = await loadBudget();
  if (data.empty) return <BudgetImport hasBudget={false} />;
  return (
    <>
      <BudgetStatus info={statusInfo(data)} />
      <BudgetImport hasBudget />
      <BudgetInputsEditor
        key={data.working.savedAt}
        approved={data.approved}
        working={data.working}
        realOpening={data.realOpening}
        alreadyIn={data.actuals.reduce((t, a) => t + a.cash.capital, 0)}
        closed={data.actuals.map((a) => a.monthId)}
      />
    </>
  );
}
