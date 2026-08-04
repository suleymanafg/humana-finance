// Exercises every request kind end to end against a COPY of dev.db:
// build the line list → simulate a responder submitting → accept → integrate →
// assert the figure landed in the right table with the right field.
//   DATABASE_URL=file:<copy> npx tsx prisma/_test-requests.ts
import { prisma } from "../src/lib/db";
import { REQUEST_KINDS } from "../src/lib/requests/kinds";
import { createRequest, integrateRequest, saveSubmission } from "../src/lib/requests/service";

const MONTH = "2026-09"; // an empty future month, so nothing real is touched
let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✗"} ${label}: ${actual}${ok ? "" : ` (expected ${expected})`}`);
}

async function run(kind: string, pick: (items: Array<{ id: string; label: string }>) => number) {
  const spec = REQUEST_KINDS[kind];
  console.log(`\n── ${kind} — ${spec.labelRu}`);

  const contact = await prisma.contact.create({ data: { name: `тест-${kind}` } });
  const request = await createRequest({
    kind,
    monthId: MONTH,
    contactId: contact.id,
    createdBy: "test",
  });
  console.log(`  строк в запросе: ${request.items.length}`);
  if (request.items.length === 0) {
    console.log("  ✗ no items built");
    failures++;
    return;
  }

  // the link only works once sent
  await prisma.dataRequest.update({ where: { id: request.id }, data: { status: "SENT" } });

  const idx = pick(request.items);
  const target = request.items[idx];
  const VALUE = 1_234_567;

  // AR rows carry a responder-typed customer name
  const freeLabel = kind === "AR" ? (target.freeLabel || "ООО Тест-Клиент") : target.freeLabel;
  const saved = await saveSubmission(
    request.token,
    [{ id: target.id, value: VALUE, note: "из теста", freeLabel }],
    true
  );
  check("submission accepted", saved, true);

  await prisma.dataRequestItem.update({
    where: { id: target.id },
    data: { decision: "ACCEPTED" },
  });
  const written = await integrateRequest(request.id, "test-admin");
  check("lines written", written, 1);
  console.log(`  позиция: ${target.label}  →  ${VALUE}`);

  // assert it reached the real table
  if (kind === "OPEX_TI") {
    const row = await prisma.opexTiEntry.findFirst({
      where: { monthId: MONTH, categoryId: target.refId!, deletedAt: null },
    });
    const field = target.field as "bankAmount" | "cashAmount";
    check(`opexTi.${field}`, row?.[field], VALUE);
    check("other column untouched", row?.[field === "bankAmount" ? "cashAmount" : "bankAmount"], 0);
  } else if (kind === "OPEX_FARGO") {
    const row = await prisma.opexFargoEntry.findFirst({
      where: { monthId: MONTH, categoryId: target.refId!, deletedAt: null },
    });
    check("opexFargo.amount", row?.amount, VALUE);
  } else if (kind === "STOCK") {
    const row = await prisma.stockCount.findFirst({
      where: { monthId: MONTH, productId: target.refId!, warehouseId: target.refId2! },
    });
    check("stockCount.qty", row?.qty, VALUE);
  } else if (kind === "AR") {
    const row = await prisma.arEntry.findFirst({
      where: { monthId: MONTH, customerName: freeLabel!, deletedAt: null },
    });
    check("arEntry.customerName", row?.customerName, freeLabel);
    check("arEntry.amount", row?.amount, VALUE);
  }

  // the link must be dead afterwards, and re-integration refused
  const reopened = await prisma.dataRequest.findUnique({ where: { id: request.id } });
  check("status", reopened?.status, "INTEGRATED");
  let refused = false;
  try {
    await integrateRequest(request.id, "test-admin");
  } catch {
    refused = true;
  }
  check("second integrate refused", refused, true);

  const audit = await prisma.auditLog.count({
    where: { action: "INTEGRATE", entity: `request:${kind}` },
  });
  check("audit entries", audit, 1);
}

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url.includes("test-requests")) throw new Error("refusing to run outside the test copy");
  console.log(`db: ${url}`);

  await prisma.month.upsert({
    where: { id: MONTH },
    create: { id: MONTH, nameRu: "Сентябрь 2026", nameEn: "September 2026", sortOrder: 999 },
    update: {},
  });

  await run("OPEX_TI", () => 0);
  await run("OPEX_FARGO", () => 0);
  await run("STOCK", () => 0);
  // AR builds its rows from prior-month customers; pick one that exists
  await run("AR", () => 0);

  console.log(failures === 0 ? "\n✓ все проверки прошли" : `\n✗ ${failures} проверок не прошло`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().finally(() => prisma.$disconnect());
