// Loads a budget workbook in the owner's v10 layout (ADMIN). Without `apply`
// it reads the inputs and reports the answer they give, and how their opening
// compares with the books; with apply=1 it stores them as the approved budget,
// the working forecast, or both.
// POST multipart: file, target=both|approved|forecast, apply=1?
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { getComputed } from "@/lib/data";
import { readBudgetWorkbook } from "@/lib/budget/workbook";
import { bookFromXlsx } from "@/lib/budget/exceljs-book";
import { runBudget } from "@/lib/budget/model";
import { capitalAnswer } from "@/lib/budget/capital";
import { openingAt } from "@/lib/budget/actuals";
import { checkInputs, parseStored, SETTING_APPROVED, SETTING_FORECAST, SETTING_PREVIOUS, type StoredBudget } from "@/lib/budget/store";

const MAX_BYTES = 10 * 1024 * 1024;
const upsert = (key: string, value: string) => prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });

export async function POST(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const form = await request.formData();
  const file = form.get("file");
  const target = String(form.get("target") ?? "both");
  const apply = form.get("apply") === "1";
  if (!(file instanceof File)) return NextResponse.json({ error: "file required" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "file is larger than 10 MB" }, { status: 400 });
  if (!file.name.toLowerCase().endsWith(".xlsx")) return NextResponse.json({ error: "Нужен файл .xlsx / Use an .xlsx file" }, { status: 400 });
  if (!["both", "approved", "forecast"].includes(target)) return NextResponse.json({ error: "target: both | approved | forecast" }, { status: 400 });

  let inputs;
  try {
    inputs = readBudgetWorkbook(await bookFromXlsx(await file.arrayBuffer()));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "could not read the workbook" }, { status: 400 });
  }
  const ok = checkInputs(inputs);
  if ("error" in ok) return NextResponse.json({ error: `the workbook's inputs: ${ok.error}` }, { status: 400 });

  const run = runBudget(ok.inputs);
  const cap = capitalAnswer(run, ok.inputs);
  const { dataset, computed } = await getComputed();
  const books = openingAt(dataset, computed, ok.inputs.opening.monthId, ok.inputs)?.opening;
  const keys = ["cash", "stockUnits", "stockValue", "transitPaid", "loans", "vatCredit", "priorOwner", "fargoOwes", "fargoStockUnits", "fargoStockValue", "fargoCustomersOwe", "profitYtd"] as const;
  const openingVsBooks = books ? keys.map((k) => ({ key: k, workbook: ok.inputs.opening[k], books: books[k] })) : null;
  const summary = { ask: cap.ask, firstNeeded: cap.firstNeeded, worstMonth: cap.worstMonth, headroom: cap.headroom, checks: cap.checks, openingVsBooks };

  if (apply) {
    const stored: StoredBudget = { name: file.name.replace(/\.xlsx$/i, ""), savedAt: new Date().toISOString(), savedBy: session.username, source: file.name, inputs: ok.inputs };
    const before = await prisma.setting.findUnique({ where: { key: SETTING_APPROVED } });
    const previous = parseStored(before?.value);
    await prisma.$transaction([
      ...(target !== "forecast" && previous ? [upsert(SETTING_PREVIOUS, JSON.stringify(previous))] : []),
      ...(target !== "forecast" ? [upsert(SETTING_APPROVED, JSON.stringify(stored))] : []),
      ...(target !== "approved" ? [upsert(SETTING_FORECAST, JSON.stringify(stored))] : []),
      prisma.auditLog.create({
        data: { entity: "budget", entityId: `import ${target}`, action: "UPSERT", data: JSON.stringify({ file: file.name, ask: cap.ask }), username: session.username },
      }),
    ]);
  }
  return NextResponse.json({ ...summary, applied: apply, target });
}
