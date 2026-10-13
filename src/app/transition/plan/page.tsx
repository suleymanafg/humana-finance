import { pageContext, type SearchParams } from "@/lib/page-context";
import { loadTransition, taskViews } from "@/lib/transition/data";
import { Toolbar } from "@/components/statement";
import TaskBoard from "@/components/transition/TaskBoard";
import { SeedPlanButton } from "@/components/transition/TrActions";

export default async function TransitionPlan({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const ctx = await pageContext(sp.month);
  const data = await loadTransition();
  const tasks = taskViews(data);
  return (
    <>
      <Toolbar>
        <p className="max-w-3xl text-[12.5px] text-muted">
          {ctx.l({
            ru: "Задачи по направлениям. Статус меняется прямо в списке, остальное — карандашом. «После задачи» связывает задачи: зависимая задача подсвечивается, пока предыдущая не готова.",
            en: "Tasks by workstream. Change the status in the list; edit the rest with the pencil. «After task» links tasks: a dependent task is flagged until the earlier one is done.",
          })}
        </p>
        <div className="ml-auto">
          <SeedPlanButton empty={tasks.length === 0} />
        </div>
      </Toolbar>
      <TaskBoard tasks={tasks} regions={data.regions.map((r) => ({ id: r.id, name: r.name }))} />
    </>
  );
}
