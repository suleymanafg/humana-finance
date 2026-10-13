// Writes for the handover module: loading the starting plan, building the
// outlet register from Fargo's 1C sales, and importing uploaded lists.
// Only the module's own tables are written; every write is audited.
import { prisma } from "@/lib/db";
import { getComputed } from "@/lib/data";
import { normName } from "./model";
import { dateOfCell, numberOf, text, type RawRow } from "./parse";

export type { RawRow };
import { STARTING_DECISIONS, STARTING_TASKS, regionDefaults } from "./seed-plan";

const audit = (action: string, data: unknown, username: string) =>
  prisma.auditLog.create({
    data: { entity: "transition", entityId: "", action, data: JSON.stringify(data), username },
  });

const dateOf = (s: string | undefined) => (s ? new Date(`${s}T00:00:00Z`) : null);

/**
 * Adds whatever part of the starting plan is missing: a region row for every
 * active sales channel, the starting tasks and decisions. Safe to run twice —
 * rows are keyed (channelId / seedKey), so nothing is duplicated or overwritten.
 */
export async function seedPlan(username: string) {
  const channels = await prisma.channel.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } });
  const existingRegions = await prisma.trRegion.findMany({ select: { channelId: true } });
  const haveChannel = new Set(existingRegions.map((r) => r.channelId).filter(Boolean));
  let regions = 0;
  for (const [i, c] of channels.entries()) {
    if (haveChannel.has(c.id)) continue;
    const d = regionDefaults(c.name);
    await prisma.trRegion.create({
      data: { channelId: c.id, name: c.name, kind: d.kind, route: d.route, sortOrder: i },
    });
    regions++;
  }

  const existingTasks = await prisma.trTask.findMany({ where: { seedKey: { not: null } }, select: { seedKey: true } });
  const haveTask = new Set(existingTasks.map((t) => t.seedKey));
  let tasks = 0;
  for (const [i, t] of STARTING_TASKS.entries()) {
    if (haveTask.has(t.key)) continue;
    await prisma.trTask.create({
      data: {
        seedKey: t.key,
        stream: t.stream,
        title: t.title,
        titleEn: t.titleEn,
        details: t.details ?? null,
        detailsEn: t.detailsEn ?? null,
        priority: t.priority ?? "NORMAL",
        dueDate: dateOf(t.due),
        sortOrder: i,
      },
    });
    tasks++;
  }
  // dependencies refer to seed keys; resolve them once every task exists
  const seeded = await prisma.trTask.findMany({ where: { seedKey: { not: null } }, select: { id: true, seedKey: true, dependsOnId: true } });
  const idOfKey = new Map(seeded.map((t) => [t.seedKey, t.id]));
  for (const t of STARTING_TASKS) {
    if (!t.dependsOn) continue;
    const row = seeded.find((s) => s.seedKey === t.key);
    const dep = idOfKey.get(t.dependsOn);
    if (row && dep && !row.dependsOnId) {
      await prisma.trTask.update({ where: { id: row.id }, data: { dependsOnId: dep } });
    }
  }

  const existingDecisions = await prisma.trDecision.findMany({ where: { seedKey: { not: null } }, select: { seedKey: true } });
  const haveDecision = new Set(existingDecisions.map((d) => d.seedKey));
  let decisions = 0;
  for (const [i, d] of STARTING_DECISIONS.entries()) {
    if (haveDecision.has(d.key)) continue;
    await prisma.trDecision.create({
      data: {
        seedKey: d.key,
        topic: d.topic,
        topicEn: d.topicEn,
        options: d.options ?? null,
        decision: d.decision ?? null,
        status: d.decision ? "DECIDED" : "OPEN",
        dueDate: dateOf(d.due),
        sortOrder: i,
      },
    });
    decisions++;
  }
  const result = { regions, tasks, decisions };
  await audit("SEED", result, username);
  return result;
}

/**
 * Adds every 1C client Fargo sold Humana to in the last `months` months to the
 * outlet register (clients already in it are left as they are). The region is
 * the handover row of the client's sales channel.
 */
export async function outletsFromSales(username: string, months = 6) {
  const recent = (
    await prisma.clientSale.groupBy({ by: ["monthId"], orderBy: { monthId: "desc" }, take: months })
  ).map((m) => m.monthId);
  if (!recent.length) return { added: 0, months: [] as string[] };
  const active = await prisma.clientSale.groupBy({
    by: ["clientMapId"],
    where: { monthId: { in: recent }, qty: { gt: 0 } },
  });
  const ids = active.map((a) => a.clientMapId);
  const [clients, regions, existing] = await Promise.all([
    prisma.clientChannelMap.findMany({ where: { id: { in: ids }, deletedAt: null } }),
    prisma.trRegion.findMany({ where: { deletedAt: null } }),
    prisma.trOutlet.findMany({ select: { clientMapId: true, name: true } }),
  ]);
  const haveClient = new Set(existing.map((o) => o.clientMapId).filter(Boolean));
  const haveName = new Set(existing.map((o) => normName(o.name)));
  const regionOf = new Map(regions.filter((r) => r.channelId).map((r) => [r.channelId!, r]));
  let added = 0;
  for (const c of clients) {
    if (haveClient.has(c.id) || haveName.has(normName(c.displayName))) continue;
    const region = c.channelId ? regionOf.get(c.channelId) : undefined;
    await prisma.trOutlet.create({
      data: {
        clientMapId: c.id,
        name: c.displayName,
        regionId: region?.id ?? null,
        district: c.district ?? null,
        type: region?.kind === "CHAIN" ? "CHAIN" : "SHOP",
        source: "SALES",
      },
    });
    added++;
  }
  const result = { added, months: recent.sort() };
  await audit("OUTLETS_FROM_SALES", result, username);
  return result;
}

// ───────────────────────────── Imports ─────────────────────────────

export type ImportKind = "outlets" | "stock" | "tiSales";

export interface ImportResult {
  ok: number;
  created: number;
  updated: number;
  rejected: Array<{ row: number; reason: string }>;
  /** a few rows as they will be written, for the preview */
  sample: Array<Record<string, unknown>>;
}

const boolOf = (v: RawRow[string]) => /^(1|true|да|yes|y|x|✓|\+)$/i.test(text(v));

function matcher<T>(items: T[], names: (x: T) => string[]) {
  const exact = new Map<string, T>();
  for (const x of items) for (const n of names(x)) if (n) exact.set(normName(n), x);
  return (raw: string): T | undefined => {
    const n = normName(raw);
    if (!n) return undefined;
    const hit = exact.get(n);
    if (hit) return hit;
    // otherwise the longest known name contained in the text (or the reverse)
    let best: { x: T; len: number } | undefined;
    for (const [k, x] of exact) {
      if (k.length >= 4 && (n.includes(k) || k.includes(n)) && (!best || k.length > best.len)) best = { x, len: k.length };
    }
    return best?.x;
  };
}

const OUTLET_TYPE_WORDS: Array<[RegExp, string]> = [
  [/апт|pharm|dorixon/i, "PHARMACY"],
  [/сет|chain|market|маркет/i, "CHAIN"],
  [/дилер|dealer|опт|whole/i, "DEALER"],
  [/магаз|shop|store|do'kon|dokon/i, "SHOP"],
];

export async function importRows(
  kind: ImportKind,
  rows: RawRow[],
  commit: boolean,
  username: string,
  opts: { replace?: boolean } = {}
): Promise<ImportResult> {
  const result: ImportResult = { ok: 0, created: 0, updated: 0, rejected: [], sample: [] };
  const regions = await prisma.trRegion.findMany({ where: { deletedAt: null } });
  const findRegion = matcher(regions, (r) => [r.name]);

  if (kind === "outlets") {
    const [outlets, clients] = await Promise.all([
      prisma.trOutlet.findMany({ where: { deletedAt: null } }),
      prisma.clientChannelMap.findMany({ where: { deletedAt: null }, select: { id: true, name1c: true, displayName: true } }),
    ]);
    const byName = new Map(outlets.map((o) => [normName(o.name), o]));
    const linked = new Set(outlets.map((o) => o.clientMapId).filter(Boolean));
    const clientByName = new Map<string, string>();
    for (const c of clients) {
      clientByName.set(normName(c.displayName), c.id);
      clientByName.set(normName(c.name1c), c.id);
    }
    for (const [i, r] of rows.entries()) {
      const name = text(r.name);
      if (!name) {
        result.rejected.push({ row: i + 1, reason: "нет названия / no name" });
        continue;
      }
      const region = text(r.region) ? findRegion(text(r.region)) : undefined;
      const typeWord = text(r.type);
      const type = OUTLET_TYPE_WORDS.find(([re]) => re.test(typeWord))?.[1];
      const credit = numberOf(r.creditDays);
      const fields = {
        ...(region ? { regionId: region.id } : {}),
        ...(text(r.district) ? { district: text(r.district) } : {}),
        ...(type ? { type } : {}),
        ...(text(r.contact) ? { contact: text(r.contact) } : {}),
        ...(text(r.phone) ? { phone: text(r.phone) } : {}),
        ...(credit !== null ? { creditDays: Math.round(credit) } : {}),
        ...(text(r.contractNo) ? { contractNo: text(r.contractNo) } : {}),
        ...(text(r.notes) ? { notes: text(r.notes) } : {}),
      };
      const existing = byName.get(normName(name));
      if (result.sample.length < 8) {
        result.sample.push({ name, region: region?.name ?? "", action: existing ? "update" : "create", ...fields });
      }
      result.ok++;
      if (existing) {
        result.updated++;
        if (commit) await prisma.trOutlet.update({ where: { id: existing.id }, data: fields });
      } else {
        result.created++;
        const clientId = clientByName.get(normName(name));
        if (commit) {
          const created = await prisma.trOutlet.create({
            data: {
              name,
              source: "UPLOAD",
              clientMapId: clientId && !linked.has(clientId) ? clientId : null,
              ...fields,
            },
          });
          byName.set(normName(name), created);
          if (clientId) linked.add(clientId);
        }
      }
    }
  }

  if (kind === "stock") {
    const { dataset } = await getComputed();
    const findProduct = matcher(dataset.products, (p) => [p.nameRu, p.nameEn ?? ""]);
    const productByCode = new Map<string, string>();
    const rawProducts = await prisma.product.findMany({ select: { id: true, code1c: true, article: true, codeSales1c: true } });
    for (const p of rawProducts) {
      for (const c of [p.code1c, p.article, p.codeSales1c]) if (c) productByCode.set(c.trim(), p.id);
    }
    const parsed: Array<Parameters<typeof prisma.trStockLot.create>[0]["data"]> = [];
    for (const [i, r] of rows.entries()) {
      const item = text(r.item);
      const qty = numberOf(r.qty);
      if (!item) {
        result.rejected.push({ row: i + 1, reason: "нет товара / no item" });
        continue;
      }
      if (qty === null) {
        result.rejected.push({ row: i + 1, reason: `нет количества / no quantity: ${item}` });
        continue;
      }
      if (qty === 0) continue;
      const code = text(r.code);
      const productId = (code && productByCode.get(code)) || findProduct(item)?.id || null;
      const expiry = dateOfCell(r.expiry);
      const countDate = dateOfCell(r.countDate);
      const price = numberOf(r.unitPrice);
      const data = {
        productId,
        itemName: item,
        batch: text(r.batch) || null,
        expiry: expiry ? new Date(`${expiry}T00:00:00Z`) : null,
        qty,
        location: text(r.location) || null,
        countDate: countDate ? new Date(`${countDate}T00:00:00Z`) : null,
        preAug2025: boolOf(r.preAug2025),
        unitPrice: price,
        source: "UPLOAD",
      };
      parsed.push(data);
      if (result.sample.length < 8) {
        result.sample.push({
          item,
          product: productId ? dataset.products.find((p) => p.id === productId)?.nameRu : "—",
          batch: data.batch,
          expiry,
          qty,
          location: data.location,
        });
      }
    }
    result.ok = parsed.length;
    result.created = parsed.length;
    if (commit) {
      await prisma.$transaction(async (tx) => {
        if (opts.replace) {
          await tx.trStockLot.updateMany({ where: { source: "UPLOAD", deletedAt: null }, data: { deletedAt: new Date() } });
        }
        for (const data of parsed) await tx.trStockLot.create({ data });
      });
    }
  }

  if (kind === "tiSales") {
    for (const [i, r] of rows.entries()) {
      const region = findRegion(text(r.region));
      const monthRaw = text(r.month);
      const monthId = /^\d{4}-\d{2}$/.test(monthRaw) ? monthRaw : dateOfCell(r.month)?.slice(0, 7);
      const amount = numberOf(r.amount);
      if (!region) {
        result.rejected.push({ row: i + 1, reason: `регион не найден / region not found: ${text(r.region)}` });
        continue;
      }
      if (!monthId) {
        result.rejected.push({ row: i + 1, reason: `нет месяца / no month: ${monthRaw}` });
        continue;
      }
      if (amount === null) {
        result.rejected.push({ row: i + 1, reason: "нет суммы / no amount" });
        continue;
      }
      const units = numberOf(r.units);
      result.ok++;
      const existing = await prisma.trTiSale.findUnique({ where: { monthId_regionId: { monthId, regionId: region.id } } });
      if (existing) result.updated++;
      else result.created++;
      if (result.sample.length < 8) result.sample.push({ month: monthId, region: region.name, amount, units });
      if (commit) {
        await prisma.trTiSale.upsert({
          where: { monthId_regionId: { monthId, regionId: region.id } },
          create: { monthId, regionId: region.id, amount, units },
          update: { amount, units },
        });
      }
    }
  }

  if (commit) await audit(`IMPORT_${kind.toUpperCase()}`, { ok: result.ok, created: result.created, updated: result.updated, rejected: result.rejected.length, replace: !!opts.replace }, username);
  return result;
}
