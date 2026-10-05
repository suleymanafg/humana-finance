# Humana Finance

Financial system for the Humana business in Uzbekistan, run by two companies:
**Turbo Impex (TI)** imports from Germany and invoices the goods to **Fargo**,
which distributes them and remits what it collects. The app keeps the books of
both companies and of the business as a whole, values every unit first in,
first out, and shows what Fargo owes TI at every month-end. Bilingual RU/EN
(RU primary).

## Quick start

```bash
npm install
npm run db:push      # create/update the schema in the database from DATABASE_URL
npm run db:seed      # master data: products, channels, months, categories, users
npm run dev          # http://localhost:3000
```

Log in: **admin / admin123** (full access) or **viewer / viewer123** (read-only).
Change these in the `User` table after first login.

Optional:

```bash
npm run db:demo      # synthetic demo data to explore the app
npm run db:reset     # wipe ALL transaction data, keep master data
npm test             # calculation-engine unit tests (vitest)
```

## Structure

The sidebar holds the sections; the pages of a section are tabs under its
title. Filters chosen on a page (company, view, units, sales selection) carry
over to the other tabs of the same section. The month is chosen once, in the
top bar, and applies everywhere.

| Section | Pages |
|---|---|
| Обзор | headline figures, results by company, what needs attention |
| Отчётность | profit and loss, balance sheet — consolidated, Turbo Impex or Fargo |
| Расчёты с Fargo | summary at month-end, by month, payments from Fargo, receivables |
| Продажи | overview with the map, product economics, channels, data (1C sync, grid, CSV) |
| Товар | shipments, TI invoices, stock and counts, FIFO cost |
| Расходы | Turbo Impex, Fargo |
| Налоги | Fargo VAT, Turbo Impex VAT, profit tax |
| Финансирование | capital, loans, previous owner, other receipts, cash balances |
| Закрытие месяца | checklist of the month's inputs; close or reopen the month |
| Планирование закупок | supply planning (admin) |
| Администрирование | reference data, data checks, data requests (admin) |

Months that are not closed are shown as preliminary. Every statement downloads
to Excel with the same lines the page shows.

## Financial model

All figures are computed from the raw inputs on every request
(`src/lib/engine/`); nothing derived is stored.

- **Landed cost.** Per truck, import expenses are spread over the purchase by a
  load factor. Import VAT is not a cost (it is recovered) and stays out. Lines
  with their own unit cost (free goods) sit outside the load factor and FIFO.
- **FIFO at two levels.** TI's invoices to Fargo and TI's write-offs draw on the
  arrived trucks in order. Fargo's sales and the differences found at each stock
  count draw on TI's invoice lines in order. The group's cost of a unit is the
  same draw valued at TI's cost, so the margin TI books on goods still in Fargo's
  warehouse is eliminated on consolidation.
- **Fargo.** Revenue excludes VAT: bank sales carry VAT inside the price
  (12/112); cash sales are declared at Fargo's FIFO cost plus the mark-up with
  12% VAT on top. Input VAT comes from TI's invoices; an unused credit carries
  forward. Turnover tax is 1.9% of sales. Write-off categories are part of the
  stock loss, never operating costs.
- **Turbo Impex.** Revenue is the invoices to Fargo at their ex-VAT amounts;
  profit tax comes from the filed returns. TI's VAT is computed from the
  invoices and import VAT and compared with the tax account statement; the
  previous owner's overpayment on that account is kept apart.
- **Settlement.** What Fargo owes TI is computed twice — from the money
  (collected, less Fargo's costs, taxes, payments made and customers' debts) and
  from the reconciliation act (act balance, bank payments that were not for
  goods, and the partnership part). The two must agree; Data checks warns when
  they do not. The debt splits into the part owed by bank against invoices and
  the part owed in cash.
- **Balance sheets** for TI, Fargo and the group, each with an «Несверенная
  сумма» line: the error left after all measured balances, which should stay
  close to zero.

Rates and options are in Reference data → Налоговые константы.

### Loading the owner's workbook

The importer recomputes the whole workbook with the app's engine and refuses to
write unless every figure it calculates matches:

```bash
npx tsx prisma/verify-workbook.ts "<workbook.xlsx>"            # compare only
npx tsx prisma/import-workbook.ts "<workbook.xlsx>"            # dry run
npx tsx prisma/import-workbook.ts "<workbook.xlsx>" --commit   # write
```

`--production` targets the live database, `--with-sales` also replaces sales
for the months the workbook covers (normally the 1C sync owns sales), and
`--bootstrap` creates missing products and channels in an empty database.

Re-importing a corrected workbook is safe once the app holds newer data: up to
the workbook's report month the workbook replaces what the app has; after it,
the app's own rows stay and the workbook's later rows are added only where the
app has none yet.

## Design

Text navigation without icons, one indigo accent, hairline borders, tabular
figures. Statements share one table style (`.stmt`): section headers, indented
lines, subtotals and a ruled total. Headline figures are plain tiles. Shared
pieces live in `src/components/statement.tsx` (statement table, tiles,
segmented filters) and `src/components/analysis.tsx` (sortable tables, change
figures, small bars).

## Architecture

- **Next.js 16 (App Router, Turbopack) + TypeScript + Tailwind v4** — hand-rolled UI kit, Recharts for charts.
- **Prisma 7 + Postgres** (Neon). The driver lives in one place,
  `src/lib/prisma-factory.ts`.
- **All figures computed server-side** from raw inputs on every request:
  `src/lib/dataset.ts` reads the dataset → `src/lib/engine/` (pure, unit-tested)
  → `src/lib/statements.ts` defines every statement once → pages and Excel
  exports render the same lines. `src/lib/page-context.ts` is the common start
  of every page (data, selected month, permissions).
- **Auth**: HMAC-signed session cookie (`SESSION_SECRET` env), scrypt password
  hashes, `src/proxy.ts` guards all routes. Roles: ADMIN (edit) / VIEWER (read).
- **Audit**: every financial mutation writes an `AuditLog` row; entry tables use
  soft delete (`deletedAt`).

## Data entry & import

- **Sales** (Продажи → Данные): 1C sync, editable month × product × channel
  grid, CSV paste/upload with preview + rejection report; **1C adapter**:
  `POST /api/import/1c` with header `X-Api-Key: <ONEC_API_KEY>` and body
  `{ "rows": [{ "month": "2025-08", "productName": "…", "channelName": "…", "qty": 120 }] }`.
  Names are matched case-insensitively against reference lists; unmatched rows
  come back in `rejected` with reasons; matched rows upsert (dedupe by
  month/product/channel). Rows may also carry `productCode` / `channelCode` —
  the 1C codes entered in Settings ("Код в 1С") — which are matched **first**
  and survive renames; names remain the fallback. Prefer codes for automated
  pulls.
- **Inventory (per warehouse)**: warehouses live in Settings → Склады (with an
  optional 1C code for matching). Stock is stored per month × product ×
  warehouse; the balance sheet sums across warehouses at avg TI cost.
  **1C adapter**: `POST /api/import/1c-stock` with the same `X-Api-Key` and body
  `{ "month": "2026-01", "fullSnapshot": true, "rows": [{ "warehouse": "Основной склад", "productName": "…", "qty": 1250 }] }`.
  Warehouse matches by name or 1C code. Snapshot semantics: rows replace stored
  quantities; with `fullSnapshot: true` (default) products absent from the
  payload are zeroed for the warehouses present — a daily full pull is
  self-correcting. `month` defaults to the current month. A month whose counts
  are all zero is treated as not counted.
- Everything else is manual entry via inline-editable grids.
- **Excel**: every statement (`/api/export/statement`), sales, shipments and
  expenses download as formatted workbooks.

### Hooking up 1C

Two options; the second needs the 1C developer only once:

1. **Push**: a scheduled job (регламентное задание) in 1C posts to the two
   endpoints above daily.
2. **Pull via standard OData** (recommended): the 1C developer publishes the
   infobase on IIS/Apache and enables the standard OData interface
   (стандартный интерфейс OData) with a read-only user, whitelisting the needed
   objects (sales register, stock register — ideally broadly, so future needs
   don't require him again). Any data then becomes queryable over HTTP and a
   sync job on our side transforms and imports it. Ask for: publication URL,
   read-only credentials, HTTPS, and the object whitelist.

## Environment

See `.env.example` for the full list with comments. Keys: `DATABASE_URL`,
`SESSION_SECRET`, `ONEC_API_KEY`, `APP_URL`, and the optional
`TELEGRAM_BOT_TOKEN` / `TELEGRAM_WEBHOOK_SECRET`.

`.env` is gitignored, as is `dev.db` and every `dev.db.backup-*` — those hold
real company financials and must never reach GitHub.

## Deployment (Neon + Vercel)

The database moved from SQLite to Postgres on 2026-08-03. `prisma/schema.prisma`
is `provider = "postgresql"` and the driver lives in **one** place,
`src/lib/prisma-factory.ts` — app and all `prisma/` scripts go through it.

**1 · Neon.** Create a project, then two branches: `main` (production) and a dev
branch for local work, so local experiments can never touch live figures. Copy
the *pooled* connection string (ends `-pooler`) into `DATABASE_URL` in `.env`.

**2 · Create the schema.**

```bash
npx prisma db push
```

**3 · Move the existing data.** Dry run first — it prints per-table row counts
and control totals, writes nothing:

```bash
npx tsx prisma/migrate-sqlite-to-postgres.ts
```

Then commit. It refuses to run against a database that already holds months,
and re-checks every table's row count plus a money/qty control total after
writing:

```bash
npx tsx prisma/migrate-sqlite-to-postgres.ts --commit
```

**4 · Verify against Postgres**, not just SQLite:

```bash
npm test                              # engine tests
npx tsx prisma/verify-requests.ts     # all four data-request kinds, end to end
```

**5 · Vercel.** Import the GitHub repo. `build` already runs `prisma generate`
first (the generated client is gitignored, so the build would otherwise fail).
Set every key from `.env.example` in the project settings, with `APP_URL` set to
the real deployed domain — data-request links are built from it, and a localhost
value produces links recipients cannot open.

**Preview deployments.** Every branch pushed to GitHub gets its own Vercel
preview URL, separate from production (`master`). Previews read the Vercel
environment variables scoped to *Preview*; if `DATABASE_URL` is shared with
Production, a preview reads and writes live figures. Point Preview's
`DATABASE_URL` at a Neon dev branch before testing anything that writes data or
changes the schema. Vercel skips a build when a branch head is a commit it has
already deployed, so a new branch needs one commit of its own before a preview
appears.

**Moving a database to the new financial model.** The schema change is
additive (new tables and nullable columns), so it is safe on a database the
current production app uses. Run it before the code that needs it:

```bash
npx prisma db push
npx tsx prisma/import-workbook.ts "<workbook.xlsx>"            # dry run
npx tsx prisma/import-workbook.ts "<workbook.xlsx>" --commit
```

**Note on long requests.** The 1C sync (especially «Заменить все месяцы») and any
future agentic chat run well past a typical serverless timeout. If they time out
on the deployed plan, they need streaming or a background job rather than a
plain request/response.
