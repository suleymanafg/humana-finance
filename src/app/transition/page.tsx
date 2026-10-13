import Link from "next/link";
import { pageContext, type SearchParams } from "@/lib/page-context";
import { loadTransition, overview } from "@/lib/transition/data";
import { PRIORITY, TASK_STATUS, TR_STREAMS, streamLabel } from "@/lib/transition/model";
import { fmtN, fmtPct } from "@/lib/format";
import { Figure, Notice, SectionTitle, Toolbar } from "@/components/statement";
import { Badge } from "@/components/ui";
import { AskGuide, SeedPlanButton } from "@/components/transition/TrActions";
import BriefEditor from "@/components/transition/BriefEditor";

const fmtDate = (d: string) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : "");

export default async function TransitionOverview({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const ctx = await pageContext(sp.month);
  const data = await loadTransition();
  const o = await overview(data);
  const empty = data.tasks.length === 0 && data.regions.length === 0;
  const title = (t: { title: string; titleEn: string | null }) => (ctx.locale === "en" && t.titleEn ? t.titleEn : t.title);

  return (
    <>
      <Toolbar>
        <div className="text-[13px] text-muted">
          {o.daysToGoLive >= 0
            ? ctx.l({
                ru: `До новой структуры ${o.daysToGoLive} дн. — с ${fmtDate(o.goLive)}`,
                en: `${o.daysToGoLive} days to the new structure — from ${fmtDate(o.goLive)}`,
              })
            : ctx.l({ ru: `Новая структура с ${fmtDate(o.goLive)}`, en: `New structure since ${fmtDate(o.goLive)}` })}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <BriefEditor goLive={data.goLive} brief={data.brief} />
          {empty && <SeedPlanButton empty />}
        </div>
      </Toolbar>

      {empty && (
        <Notice>
          {ctx.l({
            ru: "План ещё пуст. «Загрузить стартовый план» создаст задачи по направлениям, открытые решения и строку на каждый канал продаж — всё потом редактируется.",
            en: "The plan is empty. «Load the starting plan» creates tasks by workstream, the open decisions and a row for each sales channel — all editable afterwards.",
          })}
        </Notice>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Figure
          label={ctx.l({ ru: "Задачи выполнены", en: "Tasks done" })}
          value={`${o.tasks.done} / ${o.tasks.total}`}
          sub={
            <span className={o.tasks.overdue > 0 ? "text-danger" : ""}>
              {ctx.l({ ru: `просрочено ${o.tasks.overdue} · блок ${o.tasks.blocked}`, en: `${o.tasks.overdue} overdue · ${o.tasks.blocked} blocked` })}
            </span>
          }
        />
        <Figure
          label={ctx.l({ ru: "Каналы переведены", en: "Channels switched" })}
          value={`${o.regions.switched} / ${o.regions.total}`}
          sub={ctx.l({
            ru: `без маршрута ${o.regions.undecided} · без даты ${o.regions.withoutDate}`,
            en: `${o.regions.undecided} no route · ${o.regions.withoutDate} no date`,
          })}
        />
        <Figure
          label={ctx.l({ ru: "Точки с договором TI", en: "Outlets signed with TI" })}
          value={`${o.outlets.signed} / ${o.outlets.active}`}
          sub={ctx.l({
            ru: `${fmtPct(o.outlets.signedShare)} продаж последних месяцев`,
            en: `${fmtPct(o.outlets.signedShare)} of recent sales`,
          })}
        />
        <Figure
          label={ctx.l({ ru: "Остатки Fargo к выкупу", en: "Fargo stock to buy back" })}
          value={fmtN(o.stock.value)}
          sub={ctx.l({
            ru: `${fmtN(o.stock.qty)} шт. · срок < 90 дн. ${fmtN(o.stock.lt90Qty + o.stock.expiredQty)}`,
            en: `${fmtN(o.stock.qty)} units · < 90 days ${fmtN(o.stock.lt90Qty + o.stock.expiredQty)}`,
          })}
        />
        <Figure
          label={ctx.l({ ru: "Fargo должен TI", en: "Fargo owes TI" })}
          value={fmtN(o.settlement.owes)}
          sub={
            <Link href="/settlement" className="hover:text-accent hover:underline">
              {ctx.l({ ru: "расчёты с Fargo →", en: "settlement →" })}
            </Link>
          }
        />
        <Figure
          label={ctx.l({ ru: "Открытые решения", en: "Open decisions" })}
          value={String(o.decisions.open)}
          sub={
            <span className={o.decisions.overdue > 0 ? "text-danger" : ""}>
              {ctx.l({ ru: `просрочено ${o.decisions.overdue}`, en: `${o.decisions.overdue} overdue` })}
            </span>
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div>
          <SectionTitle
            right={
              <Link href="/transition/plan" className="text-[12.5px] font-medium text-accent hover:underline">
                {ctx.l({ ru: "Весь план", en: "Full plan" })}
              </Link>
            }
          >
            {ctx.l({ ru: "Что дальше", en: "What's next" })}
          </SectionTitle>
          <div className="overflow-hidden rounded-lg border border-border bg-surface">
            {o.next.length === 0 ? (
              <div className="px-4 py-6 text-center text-[13px] text-muted">
                {ctx.l({ ru: "Ничего срочного и просроченного", en: "Nothing urgent or overdue" })}
              </div>
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>{ctx.l({ ru: "Задача", en: "Task" })}</th>
                    <th style={{ width: 170 }}>{ctx.l({ ru: "Направление", en: "Workstream" })}</th>
                    <th style={{ width: 130 }}>{ctx.l({ ru: "Статус", en: "Status" })}</th>
                    <th style={{ width: 110 }} className="text-right">
                      {ctx.l({ ru: "Срок", en: "Due" })}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {o.next.map((t) => (
                    <tr key={t.id}>
                      <td>
                        <div>{title(t)}</div>
                        {t.waiting && (
                          <div className="text-[12px] text-warn">
                            {ctx.l({ ru: "ждёт предыдущую задачу", en: "waiting on an earlier task" })}
                          </div>
                        )}
                      </td>
                      <td className="text-[12.5px] text-muted">{ctx.l(streamLabel(t.stream))}</td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          <Badge tone={TASK_STATUS[t.status]?.tone}>{ctx.l(TASK_STATUS[t.status]?.label ?? { ru: t.status, en: t.status })}</Badge>
                          {t.priority !== "NORMAL" && (
                            <Badge tone={PRIORITY[t.priority]?.tone}>{ctx.l(PRIORITY[t.priority]?.label ?? { ru: "", en: "" })}</Badge>
                          )}
                        </div>
                      </td>
                      <td className={`num text-right ${t.overdue ? "font-semibold text-danger" : ""}`}>
                        {t.dueDate ? fmtDate(t.dueDate) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <SectionTitle>{ctx.l({ ru: "По направлениям", en: "By workstream" })}</SectionTitle>
          <div className="overflow-hidden rounded-lg border border-border bg-surface">
            <table className="tbl">
              <thead>
                <tr>
                  <th>{ctx.l({ ru: "Направление", en: "Workstream" })}</th>
                  <th className="text-right">{ctx.l({ ru: "Готово", en: "Done" })}</th>
                  <th className="text-right">{ctx.l({ ru: "Всего", en: "Total" })}</th>
                  <th className="text-right">{ctx.l({ ru: "Просрочено", en: "Overdue" })}</th>
                  <th style={{ width: 180 }} />
                </tr>
              </thead>
              <tbody>
                {TR_STREAMS.filter((s) => o.streams[s.key]).map((s) => {
                  const v = o.streams[s.key];
                  const share = v.total ? v.done / v.total : 0;
                  return (
                    <tr key={s.key}>
                      <td>{ctx.l(s.label)}</td>
                      <td className="num text-right">{v.done}</td>
                      <td className="num text-right">{v.total}</td>
                      <td className={`num text-right ${v.overdue ? "text-danger" : ""}`}>{v.overdue || "—"}</td>
                      <td>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-background">
                          <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(share * 100)}%` }} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <SectionTitle>{ctx.l({ ru: "Спросить помощника", en: "Ask the assistant" })}</SectionTitle>
          <AskGuide
            questions={[
              { ru: "Что мне сделать на этой неделе по переходу? Учти сроки и зависимости.", en: "What should I do this week on the handover? Take deadlines and dependencies into account." },
              { ru: "Какие главные риски для запуска в срок и что с ними сделать?", en: "What are the main risks to going live on time, and what should I do about them?" },
              { ru: "Предложи порядок и даты перехода регионов на основе продаж и готовности.", en: "Propose the order and dates of the region switches based on sales and readiness." },
              { ru: "Проверь остатки Fargo к выкупу: расхождения с учётом, сроки годности, цены.", en: "Check Fargo's stock for the buyback: differences with the books, expiry, prices." },
              { ru: "Какие крупные точки ещё без договора с TI?", en: "Which large outlets are still not signed with TI?" },
              { ru: "Напиши письмо клиентам о смене поставщика на русском и узбекском.", en: "Draft the customer letter on the change of supplier in Russian and Uzbek." },
              { ru: "Напиши письмо в Humana HQ о переходе дистрибуции на английском.", en: "Draft the letter to Humana HQ about the distribution handover, in English." },
            ]}
          />
          <p className="mt-2 text-[12px] leading-snug text-muted">
            {ctx.l({
              ru: "Помощник видит план, регионы, точки, остатки, решения и все финансовые данные приложения. Меняет задачи только по вашей команде.",
              en: "The assistant sees the plan, regions, outlets, stock, decisions and all the app's financial data. It changes tasks only when you tell it to.",
            })}
          </p>
        </div>
      </div>
    </>
  );
}
