import "dotenv/config";
// Independent fidelity check of the SQLite → Postgres move: sums EVERY numeric
// column of every table on both sides and compares. The migration script's own
// control totals only covered one column per table, which would not have caught
// a corrupted Sale.amount — the column revenue is actually computed from.
//
//   npx tsx prisma/verify-migration.ts
import { createClient } from "@libsql/client";
import { newPrismaClient } from "../src/lib/prisma-factory";

const SQLITE = process.env.SQLITE_URL ?? "file:./dev.db";
const sqlite = createClient({ url: SQLITE });
const pg = newPrismaClient();

const TABLES = [
  "Product", "Channel", "Month", "OpexCategory", "MarketingCategory",
  "ImportExpenseCategory", "Setting", "Warehouse", "User", "Contact",
  "Sale", "Shipment", "ShipmentLine", "ImportExpense", "OpexTiEntry",
  "OpexFargoEntry", "MarketingEntry", "TiTaxFiling", "CapitalContribution",
  "FargoTransfer", "StockCount", "MonthBalance", "ArEntry", "AuditLog",
  "DataRequest", "DataRequestItem",
];

const money = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
let failures = 0;

async function main() {
  console.log(`source: ${SQLITE}`);
  console.log(`target: ${(process.env.DATABASE_URL ?? "").replace(/:[^:@]+@/, ":***@").slice(0, 60)}…\n`);

  for (const table of TABLES) {
    const src = await sqlite.execute(`SELECT * FROM "${table}"`);
    const rows = src.rows as unknown as Array<Record<string, unknown>>;

    // SQLite stores booleans as 0/1 and Postgres as true/false, so coerce both
    // to numbers before summing — otherwise every boolean column reads as a
    // false mismatch.
    const val = (v: unknown): number | null => {
      if (typeof v === "number") return v;
      if (typeof v === "boolean") return v ? 1 : 0;
      if (typeof v === "bigint") return Number(v);
      return null;
    };

    const numeric = (src.columns as string[]).filter((c) =>
      rows.some((r) => val(r[c]) !== null)
    );

    const dst = (await pg.$queryRawUnsafe(`SELECT * FROM "${table}"`)) as Array<
      Record<string, unknown>
    >;

    if (rows.length !== dst.length) {
      failures++;
      console.log(`  ✗ ${table.padEnd(23)} row count ${rows.length} vs ${dst.length}`);
      continue;
    }

    const diffs: string[] = [];
    for (const col of numeric) {
      const a = rows.reduce((s, r) => s + (val(r[col]) ?? 0), 0);
      const b = dst.reduce((s, r) => s + (val(r[col]) ?? 0), 0);
      // nulls must survive too: a null silently read as 0 would tie on sums
      const nullsA = rows.filter((r) => r[col] === null).length;
      const nullsB = dst.filter((r) => r[col] === null).length;
      if (Math.abs(a - b) > 0.01) diffs.push(`${col}: ${money(a)} vs ${money(b)}`);
      else if (nullsA !== nullsB) diffs.push(`${col}: ${nullsA} vs ${nullsB} nulls`);
    }

    if (diffs.length) {
      failures += diffs.length;
      console.log(`  ✗ ${table.padEnd(23)} ${diffs.join(" | ")}`);
    } else {
      console.log(
        `  ✓ ${table.padEnd(23)} ${String(rows.length).padStart(5)} rows · ${numeric.length} numeric cols tie`
      );
    }
  }

  console.log(
    failures === 0
      ? "\n✓ every numeric column matches on both sides"
      : `\n✗ ${failures} mismatches`
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main()
  .catch((e) => {
    console.error("\n✗", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pg.$disconnect();
    sqlite.close();
  });
