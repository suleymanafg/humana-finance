"use client";

// The budget pages before any budget is loaded.
import Link from "next/link";
import { useT } from "@/lib/locale-context";

export function BudgetEmpty() {
  const { l } = useT();
  return (
    <div className="rounded-lg border border-border bg-surface px-5 py-10 text-center text-[13.5px]">
      <p className="mb-3">{l({ ru: "Бюджет ещё не загружен.", en: "No budget has been loaded yet." })}</p>
      <Link href="/budget/inputs" className="text-accent hover:underline">
        {l({ ru: "Загрузить книгу бюджета (v10–v17) на вкладке «Допущения»", en: "Load the budget workbook (v10–v17) on the Assumptions tab" })}
      </Link>
    </div>
  );
}
