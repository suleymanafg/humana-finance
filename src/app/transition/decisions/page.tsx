import { pageContext, type SearchParams } from "@/lib/page-context";
import { loadTransition } from "@/lib/transition/data";
import { DECISION_STATUS, optionsOf, ymd } from "@/lib/transition/model";
import { Toolbar } from "@/components/statement";
import EntryGrid from "@/components/EntryGrid";

export default async function TransitionDecisions({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const ctx = await pageContext(sp.month);
  const data = await loadTransition();
  const en = ctx.locale === "en";
  const rows = [...data.decisions]
    .sort((a, b) => Number(a.status === "DECIDED") - Number(b.status === "DECIDED") || a.sortOrder - b.sortOrder)
    .map((d) => ({
      id: d.id,
      topic: d.topic,
      topicEn: d.topicEn || d.topic,
      options: d.options ?? "",
      decision: d.decision ?? "",
      status: d.status,
      dueDate: ymd(d.dueDate),
      decidedAt: ymd(d.decidedAt),
      notes: d.notes ?? "",
    }));
  return (
    <>
      <Toolbar>
        <p className="max-w-3xl text-[12.5px] text-muted">
          {ctx.l({
            ru: "Решения, от которых зависит план. Когда решение принято — впишите его и поставьте «Решено»; помощник учитывает этот список в ответах. Согласованные условия стоит также перенести в брифинг на странице «Обзор».",
            en: "Decisions the plan depends on. Once made, write it in and set «Decided»; the assistant takes this list into account. Agreed terms are also worth adding to the briefing on the Overview page.",
          })}
        </p>
      </Toolbar>
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <EntryGrid
          entity="trDecision"
          rows={rows}
          defaults={{ status: "OPEN" }}
          cols={[
            en
              ? { field: "topicEn", label: "Topic", type: "text", width: "220px" }
              : { field: "topic", label: "Вопрос", type: "text", width: "220px" },
            { field: "options", label: ctx.l({ ru: "Варианты", en: "Options" }), type: "text", width: "260px" },
            { field: "decision", label: ctx.l({ ru: "Решение", en: "Decision" }), type: "text" },
            { field: "status", label: ctx.l({ ru: "Статус", en: "Status" }), type: "select", options: optionsOf(DECISION_STATUS, ctx.locale), width: "120px" },
            { field: "dueDate", label: ctx.l({ ru: "Решить до", en: "Decide by" }), type: "date", width: "130px" },
            { field: "decidedAt", label: ctx.l({ ru: "Решено", en: "Decided on" }), type: "date", width: "130px" },
            { field: "notes", label: ctx.l({ ru: "Заметки", en: "Notes" }), type: "text", width: "180px" },
          ]}
          emptyLabel={ctx.l({ ru: "Загрузите стартовый план на странице «План»", en: "Load the starting plan on the Plan page" })}
        />
      </div>
    </>
  );
}
