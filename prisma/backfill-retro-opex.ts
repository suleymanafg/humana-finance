// One-off migration (2026-09): retro bonuses stop being computed automatically
// (Channel.retroPct × revenue) and become manual OPEX Fargo entries under the
// FG_RETRO group. This script preserves history: for every month with sales it
// books what the automatic model had computed, as real OpexFargoEntry rows —
// one category «Ретро — <канал>» per channel.
//
// Owner ruling 2026-09-16: Андижан, Наманган and Фергана never had retro deals
// — they are EXCLUDED, so their historical retro (≈328.6M) is removed and the
// Fargo settlement rises by exactly that amount.
//
// Dry-run by default; --commit to write. Runs against PRODUCTION (reads the
// # DATABASE_URL_PRODUCTION line from .env next to this repo); works from any
// cwd. Idempotent: refuses to run twice.
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { Client } from "pg";

const ENV_PATH = fileURLToPath(new URL("../.env", import.meta.url));
const EXCLUDE = ["Андижан", "Наманган", "Фергана"];
const COMMIT = process.argv.includes("--commit");
const fmt = (v: number) => Math.round(v).toLocaleString("en-US");

async function main() {
  const url = (readFileSync(ENV_PATH, "utf8").match(/^#\s*DATABASE_URL_PRODUCTION=\s*"?([^"\n]+)/m) ?? [])[1]?.trim();
  if (!url) throw new Error("no prod url in .env");
  const db = new Client({ connectionString: url });
  await db.connect();

  // refuse a second run: any live entry on an FG_RETRO category means the
  // backfill (or manual retro entry) already happened
  const existing = await db.query(
    `SELECT COUNT(*)::int AS n FROM "OpexFargoEntry" e
     JOIN "OpexCategory" c ON c.id = e."categoryId"
     WHERE c."plGroup" = 'FG_RETRO' AND e."deletedAt" IS NULL`
  );
  if (existing.rows[0].n > 0) {
    console.log(`FG_RETRO categories already hold ${existing.rows[0].n} entries — nothing to do (backfill ran, or manual entry started).`);
    await db.end();
    return;
  }

  const channels = await db.query<{ id: string; name: string; retropct: number; sortorder: number }>(
    `SELECT id, name, "retroPct" AS retropct, "sortOrder" AS sortorder
     FROM "Channel" WHERE "retroPct" > 0 ORDER BY "sortOrder"`
  );
  const keep = channels.rows.filter((c) => !EXCLUDE.includes(c.name));
  const dropped = channels.rows.filter((c) => EXCLUDE.includes(c.name));

  // what the automatic model computed: per month × channel, engine valuation
  const rev = await db.query<{ monthid: string; channelid: string; revenue: number }>(
    `SELECT s."monthId" AS monthid, s."channelId" AS channelid,
            SUM(COALESCE(s.amount, s.qty * p.price)) AS revenue
     FROM "Sale" s JOIN "Product" p ON p.id = s."productId"
     GROUP BY s."monthId", s."channelId"`
  );
  const revByChannelMonth = new Map<string, number>();
  for (const r of rev.rows) revByChannelMonth.set(`${r.channelid}|${r.monthid}`, Number(r.revenue));
  const monthIds = [...new Set(rev.rows.map((r) => r.monthid))].sort();

  type Row = { monthId: string; channel: (typeof keep)[0]; amount: number };
  const rowsToInsert: Row[] = [];
  for (const ch of keep) {
    for (const monthId of monthIds) {
      const revenue = revByChannelMonth.get(`${ch.id}|${monthId}`) ?? 0;
      const amount = Math.round(revenue * Number(ch.retropct));
      if (amount !== 0) rowsToInsert.push({ monthId, channel: ch, amount });
    }
  }

  const byChannel = new Map<string, number>();
  for (const r of rowsToInsert) byChannel.set(r.channel.name, (byChannel.get(r.channel.name) ?? 0) + r.amount);
  const total = rowsToInsert.reduce((s, r) => s + r.amount, 0);

  console.log(`== backfill plan: ${keep.length} categories, ${rowsToInsert.length} entries over ${monthIds.length} months ==`);
  for (const [name, v] of [...byChannel.entries()].sort((a, b) => b[1] - a[1]))
    console.log(`  Ретро — ${name.padEnd(22)} ${fmt(v).padStart(15)}`);
  console.log(`  TOTAL booked into OPEX Fargo: ${fmt(total)}`);
  console.log(`  EXCLUDED (retro removed from history): ${dropped.map((c) => c.name).join(", ") || "—"}`);

  if (!COMMIT) {
    console.log("dry run — pass --commit to write");
    await db.end();
    return;
  }

  await db.query("BEGIN");
  try {
    const catIdByChannel = new Map<string, string>();
    for (const ch of keep) {
      const name = `Ретро — ${ch.name}`;
      const res = await db.query<{ id: string }>(
        `INSERT INTO "OpexCategory" (id, company, name, "plGroup", "sortOrder", active)
         VALUES ($1, 'FARGO', $2, 'FG_RETRO', $3, true)
         ON CONFLICT (company, name)
         DO UPDATE SET "plGroup" = 'FG_RETRO', active = true
         RETURNING id`,
        [randomUUID(), name, 900 + ch.sortorder]
      );
      catIdByChannel.set(ch.id, res.rows[0].id);
    }
    const pct = (p: number) => `${Math.round(p * 1000) / 10}%`;
    for (const r of rowsToInsert) {
      await db.query(
        `INSERT INTO "OpexFargoEntry" (id, "monthId", "categoryId", amount, notes)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          randomUUID(),
          r.monthId,
          catIdByChannel.get(r.channel.id),
          r.amount,
          `Перенос из автоматического ретро (${pct(Number(r.channel.retropct))} × выручка канала)`,
        ]
      );
    }
    await db.query("COMMIT");
    console.log(`done — ${rowsToInsert.length} entries written; retro is manual from now on (Расходы Fargo → Ретро-бонусы)`);
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  }
  await db.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
