// One-off: fold the Marketing section into OPEX (owner decision 2026-08-03).
// The marketing page is removed; its categories become ordinary OPEX categories
// under the new TI_MARKETING / FG_MARKETING P&L groups, so P&L totals are
// unchanged — the amounts simply move from the marketing lines into OPEX.
//
// Category mapping (owner asked for three categories; the two others carry real
// data and are folded into the closest match — reported loudly at the end):
//   Маркетинг и реклама          → same name
//   Флаеры                       → same name
//   Списания / просрочка         → same name
//   Промо-акции и поддержка…     → Маркетинг и реклама   (it is marketing)
//   IT / сервисы / подписки      → Прочее (TI_OTHERS)    (not marketing)
//
// TI marketing had no bank/cash split, so migrated amounts land in bankAmount;
// adjust per row in the UI if some were paid in cash.
//   npx tsx prisma/merge-marketing-into-opex.ts [--commit]
import { newPrismaClient } from "../src/lib/prisma-factory";

const prisma = newPrismaClient();
const COMMIT = process.argv.includes("--commit");

const KEEP = ["Маркетинг и реклама", "Флаеры", "Списания / просрочка"] as const;

/** marketing category name → { TI: opex category name, FARGO: opex category name } */
const REMAP: Record<string, { TI: string; FARGO: string }> = {
  "Промо-акции и поддержка продаж": { TI: "Маркетинг и реклама", FARGO: "Маркетинг и реклама" },
  "IT / сервисы / подписки": { TI: "Прочее", FARGO: "Маркетинг и реклама" },
};

async function ensureCategory(company: "TI" | "FARGO", name: string, plGroup: string) {
  const existing = await prisma.opexCategory.findFirst({ where: { company, name } });
  if (existing) {
    if (!existing.active && COMMIT)
      await prisma.opexCategory.update({ where: { id: existing.id }, data: { active: true } });
    return existing.id;
  }
  console.log(`  + категория ${company}: ${name} [${plGroup}]`);
  if (!COMMIT) return `dry-${company}-${name}`;
  const max = await prisma.opexCategory.aggregate({ where: { company }, _max: { sortOrder: true } });
  const created = await prisma.opexCategory.create({
    data: { company, name, plGroup, sortOrder: (max._max.sortOrder ?? 0) + 1, active: true },
  });
  return created.id;
}

async function main() {
  console.log(COMMIT ? "=== COMMIT ===" : "=== DRY RUN (add --commit to write) ===");

  // 1. the three requested categories on both companies
  const catId: Record<string, Record<string, string>> = { TI: {}, FARGO: {} };
  for (const name of KEEP) {
    catId.TI[name] = await ensureCategory("TI", name, "TI_MARKETING");
    catId.FARGO[name] = await ensureCategory("FARGO", name, "FG_MARKETING");
  }

  const entries = await prisma.marketingEntry.findMany({
    where: { deletedAt: null },
    include: { category: true },
  });
  console.log(`\nзаписей маркетинга: ${entries.length}`);

  const moved: Record<string, number> = {};
  const remapped: string[] = [];
  let tiTotal = 0;
  let fgTotal = 0;

  for (const e of entries) {
    const company: "TI" | "FARGO" = e.paidBy === "TI" ? "TI" : "FARGO";
    const src = e.category.name;
    let target = src;
    if (!KEEP.includes(src as (typeof KEEP)[number])) {
      const r = REMAP[src];
      if (!r) throw new Error(`no mapping for marketing category "${src}"`);
      target = r[company];
      remapped.push(`${company} · ${src} → ${target}: ${e.amount.toLocaleString("ru")} (${e.monthId})`);
    }

    // resolve the target category id (may be an existing non-marketing one)
    let targetId = catId[company][target];
    if (!targetId) {
      const found = await prisma.opexCategory.findFirst({ where: { company, name: target } });
      if (!found) throw new Error(`target OPEX category "${target}" not found for ${company}`);
      targetId = found.id;
      catId[company][target] = targetId;
    }

    const key = `${company} · ${target}`;
    moved[key] = (moved[key] ?? 0) + e.amount;
    if (company === "TI") tiTotal += e.amount;
    else fgTotal += e.amount;

    if (!COMMIT) continue;

    const note = [src !== target ? `(из маркетинга: ${src})` : "(из маркетинга)", e.notes]
      .filter(Boolean)
      .join(" ");
    if (company === "TI") {
      const ex = await prisma.opexTiEntry.findFirst({
        where: { monthId: e.monthId, categoryId: targetId, deletedAt: null },
      });
      if (ex) {
        await prisma.opexTiEntry.update({
          where: { id: ex.id },
          data: { bankAmount: ex.bankAmount + e.amount, notes: [ex.notes, note].filter(Boolean).join("; ") },
        });
      } else {
        await prisma.opexTiEntry.create({
          data: { monthId: e.monthId, categoryId: targetId, bankAmount: e.amount, cashAmount: 0, notes: note },
        });
      }
    } else {
      const ex = await prisma.opexFargoEntry.findFirst({
        where: { monthId: e.monthId, categoryId: targetId, deletedAt: null },
      });
      if (ex) {
        await prisma.opexFargoEntry.update({
          where: { id: ex.id },
          data: { amount: ex.amount + e.amount, notes: [ex.notes, note].filter(Boolean).join("; ") },
        });
      } else {
        await prisma.opexFargoEntry.create({
          data: { monthId: e.monthId, categoryId: targetId, amount: e.amount, notes: note },
        });
      }
    }
    await prisma.marketingEntry.update({ where: { id: e.id }, data: { deletedAt: new Date() } });
  }

  console.log("\nперенесено:");
  for (const [k, v] of Object.entries(moved).sort()) console.log(`  ${k}: ${v.toLocaleString("ru")}`);
  console.log(`\nИТОГО TI:    ${tiTotal.toLocaleString("ru")}`);
  console.log(`ИТОГО FARGO: ${fgTotal.toLocaleString("ru")}`);
  console.log(`ВСЕГО:       ${(tiTotal + fgTotal).toLocaleString("ru")}`);

  if (remapped.length) {
    console.log("\n⚠ переназначено (категории вне списка из трёх):");
    for (const r of remapped) console.log(`  ${r}`);
  }

  if (COMMIT) {
    const cats = await prisma.marketingCategory.updateMany({ data: { active: false } });
    console.log(`\nдеактивировано категорий маркетинга: ${cats.count}`);
    const left = await prisma.marketingEntry.count({ where: { deletedAt: null } });
    console.log(`осталось активных записей маркетинга: ${left}`);
  }
}

main().finally(() => prisma.$disconnect());
