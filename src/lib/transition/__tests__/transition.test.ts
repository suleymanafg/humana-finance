import { describe, expect, it } from "vitest";
import { daysBetween, normName, todayYmd } from "../model";
import { regionDefaults, STARTING_TASKS, STARTING_DECISIONS } from "../seed-plan";
import { dateOfCell, numberOf } from "../parse";
import { nextUp, type TaskView } from "../tasks";

const task = (over: Partial<TaskView>): TaskView => ({
  id: "x",
  stream: "chains",
  title: "t",
  titleEn: null,
  details: null,
  detailsEn: null,
  owner: null,
  status: "TODO",
  priority: "NORMAL",
  startDate: "",
  dueDate: "",
  doneAt: "",
  dependsOnId: null,
  regionId: null,
  notes: null,
  overdue: false,
  dueIn: null,
  waiting: false,
  ...over,
});

describe("transition model", () => {
  it("counts days and dates in Tashkent time", () => {
    expect(daysBetween("2026-10-13", "2027-01-01")).toBe(80);
    expect(todayYmd(new Date("2026-10-13T20:30:00Z"))).toBe("2026-10-14");
  });

  it("normalises names for matching", () => {
    expect(normName("  «Корзинка»  Ёлка ")).toBe("корзинка елка");
  });

  it("guesses a channel's kind and route from its name", () => {
    expect(regionDefaults("Korzinka")).toEqual({ kind: "CHAIN", route: "CHAIN_DIRECT" });
    expect(regionDefaults("Андижан")).toEqual({ kind: "REGION", route: "NUTRIBEN_DEALER" });
    expect(regionDefaults("Прочие")).toEqual({ kind: "OTHER", route: "UNDECIDED" });
    expect(regionDefaults("Самарканд")).toEqual({ kind: "REGION", route: "UNDECIDED" });
    expect(regionDefaults("UZUM MARKET")).toEqual({ kind: "CHAIN", route: "CHAIN_DIRECT" });
    expect(regionDefaults("NEW RETAIL (Bi1)")).toEqual({ kind: "CHAIN", route: "CHAIN_DIRECT" });
    expect(regionDefaults("Дилеры Бондюэль")).toEqual({ kind: "OTHER", route: "UNDECIDED" });
    expect(regionDefaults("Магазин Fargo")).toEqual({ kind: "OTHER", route: "UNDECIDED" });
    expect(regionDefaults("Коканд")).toEqual({ kind: "REGION", route: "UNDECIDED" });
  });

  it("has a consistent starting plan", () => {
    const keys = new Set(STARTING_TASKS.map((t) => t.key));
    expect(keys.size).toBe(STARTING_TASKS.length);
    for (const t of STARTING_TASKS) if (t.dependsOn) expect(keys.has(t.dependsOn)).toBe(true);
    expect(new Set(STARTING_DECISIONS.map((d) => d.key)).size).toBe(STARTING_DECISIONS.length);
  });
});

describe("import parsing", () => {
  it("reads numbers in both styles", () => {
    expect(numberOf("1 234,5")).toBe(1234.5);
    expect(numberOf("1,234,567")).toBe(1234567);
    expect(numberOf("12,5")).toBe(12.5);
    expect(numberOf(42)).toBe(42);
    expect(numberOf("")).toBeNull();
  });

  it("reads dates from Excel and from text", () => {
    expect(dateOfCell("31.12.2026")).toBe("2026-12-31");
    expect(dateOfCell("2027-03-01")).toBe("2027-03-01");
    expect(dateOfCell(46387)).toBe("2026-12-31");
    expect(dateOfCell("05/2027")).toBe("2027-05-01");
    expect(dateOfCell("скоро")).toBeNull();
  });
});

describe("what's next", () => {
  it("puts overdue, then blocked, then urgent first and drops finished work", () => {
    const list = nextUp([
      task({ id: "soon", dueIn: 5, dueDate: "2026-10-18" }),
      task({ id: "urgent", priority: "URGENT" }),
      task({ id: "late", overdue: true, dueIn: -2, dueDate: "2026-10-11" }),
      task({ id: "blocked", status: "BLOCKED" }),
      task({ id: "done", status: "DONE", overdue: false, priority: "URGENT" }),
      task({ id: "far", dueIn: 60, dueDate: "2026-12-12" }),
    ]);
    expect(list.map((t) => t.id)).toEqual(["late", "blocked", "urgent", "soon"]);
  });
});
