// One-time move of the local SQLite database into Postgres (Neon).
//
//   npx tsx prisma/migrate-sqlite-to-postgres.ts            # dry run
//   npx tsx prisma/migrate-sqlite-to-postgres.ts --commit   # write
//
// Reads the SQLite file with the raw libsql client (the Prisma client is now
// Postgres-only, so it cannot read the old file). Tables are written parents
// first, and every table is checked on row count plus a money/qty control
// total afterwards — a mismatch fails loudly rather than leaving a half-moved
// database behind.
import { createClient } from "@libsql/client";
import { newPrismaClient } from "../src/lib/prisma-factory";

const SQLITE = process.env.SQLITE_URL ?? "file:./dev.db";
const COMMIT = process.argv.includes("--commit");

const sqlite = createClient({ url: SQLITE });
const pg = newPrismaClient();

type Row = Record<string, unknown>;

/** SQLite stores DateTime as epoch-ms integers (or ISO strings); Postgres needs Date. */
function toDate(v: unknown): Date | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return new Date(v);
  if (typeof v === "string") return new Date(v);
  if (v instanceof Date) return v;
  return null;
}
function toBool(v: unknown): boolean {
  return v === true || v === 1 || v === "1";
}

interface TableSpec {
  table: string;
  /** prisma delegate name */
  model: string;
  dates?: string[];
  bools?: string[];
  /** numeric column summed as a control total */
  control?: string;
}

// parents first — FK order matters
const TABLES: TableSpec[] = [
  { table: "Product", model: "product", bools: ["isPromo", "active"], control: "price" },
  { table: "Channel", model: "channel", bools: ["active"], control: "retroPct" },
  { table: "Month", model: "month" },
  { table: "OpexCategory", model: "opexCategory", bools: ["active"] },
  { table: "MarketingCategory", model: "marketingCategory", bools: ["active"] },
  { table: "ImportExpenseCategory", model: "importExpenseCategory", bools: ["active"] },
  { table: "Setting", model: "setting" },
  { table: "Warehouse", model: "warehouse", bools: ["active"] },
  { table: "User", model: "user" },
  { table: "Contact", model: "contact", bools: ["active"] },
  { table: "Sale", model: "sale", dates: ["createdAt", "updatedAt"], control: "qty" },
  { table: "Shipment", model: "shipment", dates: ["deletedAt", "createdAt"] },
  { table: "ShipmentLine", model: "shipmentLine", dates: ["deletedAt"], control: "qty" },
  { table: "ImportExpense", model: "importExpense", dates: ["deletedAt"], control: "amount" },
  { table: "OpexTiEntry", model: "opexTiEntry", dates: ["deletedAt"], control: "cashAmount" },
  { table: "OpexFargoEntry", model: "opexFargoEntry", dates: ["deletedAt"], control: "amount" },
  { table: "MarketingEntry", model: "marketingEntry", dates: ["deletedAt"], control: "amount" },
  { table: "TiTaxFiling", model: "tiTaxFiling", dates: ["deletedAt"], control: "taxAmount" },
  {
    table: "CapitalContribution",
    model: "capitalContribution",
    dates: ["date", "deletedAt"],
    control: "tiAmount",
  },
  {
    table: "FargoTransfer",
    model: "fargoTransfer",
    dates: ["date", "deletedAt"],
    control: "bankAmount",
  },
  { table: "StockCount", model: "stockCount", dates: ["updatedAt"], control: "qty" },
  { table: "MonthBalance", model: "monthBalance", control: "tiBank" },
  { table: "ArEntry", model: "arEntry", dates: ["deletedAt"], control: "amount" },
  { table: "AuditLog", model: "auditLog", dates: ["createdAt"] },
  {
    table: "DataRequest",
    model: "dataRequest",
    dates: [
      "dueDate", "createdAt", "sentAt", "remindedAt", "openedAt",
      "submittedAt", "integratedAt", "revokedAt",
    ],
  },
  { table: "DataRequestItem", model: "dataRequestItem", dates: ["updatedAt"], control: "value" },
];

const money = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
let failures = 0;

async function readTable(spec: TableSpec): Promise<Row[]> {
  const res = await sqlite.execute(`SELECT * FROM "${spec.table}"`);
  return res.rows.map((r) => {
    const row: Row = { ...(r as unknown as Row) };
    for (const f of spec.dates ?? []) row[f] = toDate(row[f]);
    for (const f of spec.bools ?? []) row[f] = toBool(row[f]);
    return row;
  });
}

const sumOf = (rows: Row[], field?: string) =>
  field ? rows.reduce((s, r) => s + (typeof r[field] === "number" ? (r[field] as number) : 0), 0) : 0;

async function main() {
  console.log(COMMIT ? "=== COMMIT ===" : "=== DRY RUN (add --commit to write) ===");
  console.log(`source: ${SQLITE}`);
  console.log(`target: ${(process.env.DATABASE_URL ?? "").replace(/:[^:@]+@/, ":***@")}\n`);

  const source = new Map<string, Row[]>();
  for (const spec of TABLES) {
    const rows = await readTable(spec);
    source.set(spec.table, rows);
    const ctl = spec.control ? ` · Σ${spec.control}=${money(sumOf(rows, spec.control))}` : "";
    console.log(`  ${spec.table.padEnd(24)} ${String(rows.length).padStart(6)} rows${ctl}`);
  }
  const totalRows = [...source.values()].reduce((s, r) => s + r.length, 0);
  console.log(`\n  total ${totalRows} rows across ${TABLES.length} tables`);

  if (!COMMIT) {
    console.log("\ndry run — nothing written");
    return;
  }

  // refuse to overwrite a target that already holds data
  const existing = await pg.month.count();
  if (existing > 0) {
    throw new Error(
      `target database already has ${existing} months — refusing to overwrite. ` +
        "Reset it first (prisma db push --force-reset) if this is intentional."
    );
  }

  console.log("\nwriting…");
  for (const spec of TABLES) {
    const rows = source.get(spec.table) ?? [];
    if (rows.length === 0) continue;
    const delegate = (pg as unknown as Record<string, { createMany: (a: unknown) => Promise<unknown> }>)[
      spec.model
    ];
    // chunked so a large table cannot blow the statement limit
    for (let i = 0; i < rows.length; i += 500) {
      await delegate.createMany({ data: rows.slice(i, i + 500) });
    }
    console.log(`  ✓ ${spec.table} (${rows.length})`);
  }

  console.log("\nverifying…");
  for (const spec of TABLES) {
    const rows = source.get(spec.table) ?? [];
    const delegate = (
      pg as unknown as Record<
        string,
        { count: () => Promise<number>; findMany: () => Promise<Row[]> }
      >
    )[spec.model];
    const count = await delegate.count();
    const ok = count === rows.length;
    if (!ok) failures++;
    let ctl = "";
    if (spec.control && rows.length > 0) {
      const written = await delegate.findMany();
      const a = sumOf(rows, spec.control);
      const b = sumOf(written, spec.control);
      const tied = Math.abs(a - b) < 0.01;
      if (!tied) failures++;
      ctl = ` · Σ${spec.control} ${tied ? "✓" : `✗ ${money(a)} vs ${money(b)}`}`;
    }
    console.log(`  ${ok ? "✓" : "✗"} ${spec.table.padEnd(24)} ${count}/${rows.length}${ctl}`);
  }

  console.log(failures === 0 ? "\n✓ перенос завершён, всё сходится" : `\n✗ ${failures} расхождений`);
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
