// Task views and the «what's next» ordering. Pure, no database.
import { isClosedTask } from "./model";

export interface TaskView {
  id: string;
  stream: string;
  title: string;
  titleEn: string | null;
  details: string | null;
  detailsEn: string | null;
  owner: string | null;
  status: string;
  priority: string;
  startDate: string;
  dueDate: string;
  doneAt: string;
  dependsOnId: string | null;
  regionId: string | null;
  notes: string | null;
  /** due date passed and not finished */
  overdue: boolean;
  /** days until due (negative = late), null without a due date */
  dueIn: number | null;
  /** the task it depends on is not finished yet */
  waiting: boolean;
}

const PRIORITY_RANK: Record<string, number> = { URGENT: 0, HIGH: 1, NORMAL: 2 };

/** What needs attention now: overdue, blocked, urgent, due within `days`. */
export function nextUp(tasks: TaskView[], days = 14): TaskView[] {
  return tasks
    .filter(
      (t) =>
        !isClosedTask(t.status) &&
        (t.overdue || t.status === "BLOCKED" || t.priority === "URGENT" || (t.dueIn !== null && t.dueIn <= days))
    )
    .sort(
      (a, b) =>
        Number(b.overdue) - Number(a.overdue) ||
        Number(b.status === "BLOCKED") - Number(a.status === "BLOCKED") ||
        (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) ||
        (a.dueIn ?? 9999) - (b.dueIn ?? 9999)
    );
}
