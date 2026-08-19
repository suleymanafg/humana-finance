// Server-side month-close checks shared by every write endpoint.
import { prisma } from "./db";

export async function isMonthClosed(monthId: string | null | undefined): Promise<boolean> {
  if (!monthId) return false;
  const m = await prisma.month.findUnique({ where: { id: monthId }, select: { closedAt: true } });
  return !!m?.closedAt;
}

/** Ids of all closed months, for filtering imports in one query. */
export async function closedMonthIds(): Promise<Set<string>> {
  const rows = await prisma.month.findMany({
    where: { closedAt: { not: null } },
    select: { id: true },
  });
  return new Set(rows.map((r) => r.id));
}
