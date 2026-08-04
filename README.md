# Humana Uzbekistan — P&L / Financial Management

Management P&L for the two-company distribution business:
**Turbo Impex (TI)** — importer (EUR purchases, import costs, 15% income tax) and
**Fargo** — distributor (24 channels, 12% VAT, 1.9% turnover tax).
Replaces the consolidated Excel workbook. Bilingual RU/EN (RU primary).

## Quick start

```bash
npm install
npm run db:push      # create/update SQLite schema (dev.db)
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

## Live data: real 1C sales, Aug 2025 – Jul 2026

Loaded from the 1C export (`humana_12m_sku.xlsx`, "Продажи по клиентам",
month × client × SKU) via `prisma/import-real-sales.ts`:

- **175 912 units / 30 527 421 507 UZS** (VAT-inclusive invoiced amounts) for
  the approved product range, tying exactly to the export.
- 13 407 in-range fact rows aggregated to **1 194** app rows (month × product ×
  channel); quantities are exact.
- **13 approved SKUs**, confirmed by the owner, each tagged `Platin` or `Expert`
  (`Product.productLine`). All 13 list prices match 1C's modal invoiced price
  exactly: Platin 400 g = **135 800**, Platin 800 g = **259 800**, promo 400 g =
  **101 850**, AC/AR Expert DS 350 g ×12 = 176 000, SL Expert BIB 500 = 152 000,
  HN Expert FS 300 = 120 000. (135 800 is confirmed as the 400 g price by
  97–98% of its units; the earlier seed wrongly applied it to 800 g packs too.)
- **Excluded from every calculation** (1 084 units / 140 342 589 UZS — 0.46% of
  export revenue): AC Expert FS 300, AR Expert FS 300, both MC cereals, and the
  promo Platin 1 800 г. They are absent from the product table, so the CSV and
  1C importers reject them with a reason rather than letting them back in.
  Re-adding one means adding it to `PRODUCTS` in `prisma/import-real-sales.ts`.
- Product names use 1C's `Номенклатура` spelling **without** the trailing
  `, шт.` unit-of-measure suffix shown in the 1C view, so name-matching works.
- **Revenue ties to 1C exactly.** Each sale row stores the invoiced amount
  (`Sale.amount`) and the engine prefers it over `qty × list price`, so
  discounts, returns and price corrections are reflected to the som. Valuing the
  same quantities at list price instead gives 29 991 701 900 (−1.75%); that gap
  is analysed by `prisma/discount-check.ts` — mostly 548 zero-quantity price
  corrections (+188.6 M) and 65 rows invoiced above list (+387.6 M), against
  only 108.3 M of genuine below-list discounting.
- **30 channels**: 12 territories tied to the map, 13 chains standing alone
  (Korzinka, Makro, Митвой/Mittivoy, Uzum Market, Pepito, Vikiton, Kidimart,
  Bi1, Galmart, City Farm, Bio Plus Farm, Bigmag, Прочая сеть), 3 dealers
  (Бондюэль, DARVOZA SAVDO, ТИИН ОПТОМ), Внутреннее, and «Прочие».
- The 156 trade points 1C left without a territory go to **«Прочие»** except
  four named accounts the business tracks (Бондюэль, Darvoza, Тиин Оптом,
  Митвой), which route to their own channels. Fixing the territory in 1C makes
  this permanent — see `UNCLASSIFIED` in the export.
- Negative quantities are **returns**; they are kept as-is and listed in Health
  Check for information.

Re-run the import any time with:

```bash
npx tsx prisma/import-real-sales.ts            # dry run, report only
npx tsx prisma/import-real-sales.ts --commit   # wipe + import
```

### Real COGS, from the working P&L workbook

Loaded from `Humana P&L - 2026 - Working Copy.xlsx` (tabs **COGS** and **Import
Expenses**) via `prisma/import-cogs.ts`:

- **12 shipments, 72 lines, 96 import-expense rows.**
- Purchase value **17 899 417 060 UZS** / **1 192 835 EUR** / 229 384 units, and
  import expenses **4 399 131 356.74 UZS** — both tie exactly to the workbook's
  own TOTAL rows.
- Landed costs are **derived, not imported**: `loadFactor = 1 + Σexpenses ÷
  Σpurchase` per shipment, then `TI unit cost = price UZS × loadFactor`, then a
  qty-weighted average per product. The importer verifies this against the
  workbook's "Avg Unit Cost (TI)" column — **all 10 purchased products match
  with 0.0000 UZS deviation**, confirming the engine reproduces the workbook's
  method exactly. Load factors range ×1.209–×1.596 (the two August air freights
  carry ~59% expense loads; trucks ~21–24%).
- Promo SKUs take their regular product's unit costs, which is what the workbook
  does too (its promo rows repeat the regular product's figures).
- ⚠ **14 of 72 lines have no Fargo transfer cost** (all of Truck №10 and Truck
  №11, Apr and Jun 2026). Those quantities are excluded from the weighted-average
  Fargo cost, which feeds the Fargo VAT calculation — so VAT for those products
  is understated until the costs are filled in. Flagged in Health Check.

### Real OPEX and marketing, from the same workbook

Loaded from tabs **OPEX — Turbo Impex**, **OPEX — Fargo** and
**Marketing & Promo** via `prisma/import-opex.ts`. All five control totals tie
exactly to the workbook:

| | app | workbook |
|---|---|---|
| OPEX TI — bank | 357 711 798 | 357 711 798 |
| OPEX TI — cash | 4 323 082 200 | 4 323 082 200 |
| OPEX Fargo | 2 376 145 000 | 2 376 145 000 |
| Marketing (Fargo) | 190 217 582 | 190 217 582 |
| Marketing (TI) | 156 108 996.64 | 156 108 996.64 |

- 103 TI entries / 163 Fargo entries / 24 marketing entries, Aug 2025 – Jun 2026.
  Structural zero rows in the sheet (19 TI, 38 Fargo) are not imported.
- **Category → P&L group comes from the workbook's own "P&L Group" column**, so
  the app's grouping matches the workbook by construction rather than by guess.
  The seeded placeholder categories were replaced by the workbook's real ones
  (15 TI, 19 Fargo, 5 marketing) — nothing landed as UNMAPPED.
- Marketing rows carry the workbook's Paid By (Fargo / Turbo Impex); all 24 were
  already ticked "Validated?" in the source.

**The P&L is now complete** for Aug 2025 – Jul 2026: revenue 30 527 421 507,
COGS 16 928 862 930 (GP 44.5%), total OPEX 9 907 031 116, taxes 1 936 200 332,
**net profit 1 755 327 129 (5.8% net margin)**.

**Still not loaded:** TI quarterly tax filings, month-end stock, AR, investments
and the balance-sheet inputs — all present as tabs in the same workbook. The
Balance page's month-status timeline and Health Check show exactly what is
missing.

⚠ **The workbook's golden revenue no longer matches 1C.** The Excel reference
said 26 269 537 700 for Aug'25–Apr'26; the 1C invoiced amount for the same
period is 20 680 179 278 (a flat 220 349 UZS/unit would be needed to reach the
workbook figure). The two use different revenue bases — decide which one
management reports on before publishing. The golden reference is currently set
to the 1C control total.

## ⚠ Assumptions to verify (Settings → Справочники)

1. **Promo SKU mapping** — the three "(АКЦИЯ)" variants are seeded as
   Platin 1/2/3 MP 400г. If the workbook maps them to different SKUs, fix
   `regularProductId` in Settings → Products.
2. **Channel percentages** — only the percentages named in the spec are seeded
   (cities 8% / 33.6% cash, Корзинка 11%, Bi1 5%, Darvoza 6%, Бондюэль 4%,
   ХУМАНА АБДУРАХМАН & Прочие 100% cash). **Офис and Магазин Fargo are seeded
   at 100% cash as a guess** — verify all 24 rows against the workbook.
3. **OPEX category lists** — representative RU category names are seeded with
   the correct 7 TI / 5 Fargo group mappings; rename/add to match the workbook.
4. **Balance sheet "tax payable"** — computed as the current month's accrued
   taxes (Fargo VAT + both income taxes). If the workbook uses a different
   figure, this is in `computeBalanceSheets` (`src/lib/engine/compute.ts`).
5. **Weighted-average costs are global** (all shipments in the DB), matching
   the workbook's single average per product — not FIFO, not month-cumulative.

The **Health Check** page includes a tie-out against the workbook's known-good
YTD values (Aug'25–Apr'26 revenue 26 269 537 700, COGS 14 867 863 161, net
≈ 737 104 688). It stays ⚠ until the real workbook data is imported; if it
still warns after a full import, an input differs from the workbook.

## Design system: "Quiet Authority" (Stitch)

The visual language comes from an owner-approved Google Stitch design (see the
DESIGN.md tokens): deep-indigo primary `#1f108e`, navy sidebar `#1e1b4b` with a
4px left-bar active indicator, white "quiet cards" (1px border, no shadows,
border tints on hover) on an `#f8f9ff` plane, **Manrope** for headline figures,
**Inter** for body, **JetBrains Mono** for all numbers, uppercase tracked
micro-labels, 8px card radius.

Structural elements introduced with it:

- **Global month switcher** in the sticky top bar (‹ месяц › + a calendar
  popover showing all months with completeness dots). The choice persists in
  the `hf-month` cookie and applies across pages; explicit `?month=` overrides.
  Server pages resolve via `src/lib/month.ts`.
- **Month-centric dashboard**: hero net-profit card with ghost sparkline and
  MoM delta, three quiet KPI cards, revenue trend, a real "Внимание" list
  (missing month data + actionable health warnings), sales-by-region bars,
  the Fargo↔TI settlement card (dark indigo summary), top-5 products.
- **Ввод данных (`/close`)**: a guided six-step monthly close checklist with
  live statuses from `src/lib/month-status.ts` and a progress bar.

## Screen design principle

The reporting screens (Sales, COGS, Taxes, OPEX ×2, Marketing) are ordered by
decision value, not by what is easiest to total:

1. a compact metric strip — five figures, each with a month-on-month delta and a
   12-month sparkline;
2. **what changed** — the movers, variances and outliers that prompt action;
3. the analytical tables (contribution, realised price vs list, margin per SKU,
   spend against revenue), sortable, with inline share bars and sparklines;
4. **data entry last**, collapsed — it is used once a month and should not
   dominate a screen used weekly.

Shared primitives live in `src/components/analysis.tsx` (`MetricStrip`,
`Section`, `Collapsible`, `Delta`, `Spark`, `ShareBar`, `Th`, `useSort`). Tables
are the primary medium; cards are reserved for headline figures. Grid children
that hold tables carry `min-w-0` so a wide table scrolls inside its column
instead of overflowing it.

## Architecture

- **Next.js 16 (App Router, Turbopack) + TypeScript + Tailwind v4** — hand-rolled UI kit, Recharts for charts.
- **Prisma 7 + SQLite** (libsql driver adapter) in dev. To move to Postgres/Neon:
  set `provider = "postgresql"` in `prisma/schema.prisma`, set `DATABASE_URL`,
  swap `PrismaLibSql` for `@prisma/adapter-pg` in `src/lib/db.ts` (and the two
  scripts in `prisma/`), then `prisma db push`.
- **All figures computed server-side** from raw inputs on every request:
  `src/lib/data.ts` loads the full dataset → `src/lib/engine/compute.ts`
  (pure functions, unit-tested) → pages render the result. Nothing derived is
  stored.
- **Auth**: HMAC-signed session cookie (`SESSION_SECRET` env), scrypt password
  hashes, `src/proxy.ts` guards all routes. Roles: ADMIN (edit) / VIEWER (read).
- **Audit**: every financial mutation writes an `AuditLog` row; entry tables use
  soft delete (`deletedAt`).

## Calculation engine (mirrors the workbook)

| Step | Formula |
|---|---|
| Landed cost | per shipment `loadFactor = 1 + Σexpenses/Σpurchase`; line `TI cost = EUR × rate × loadFactor`; per product qty-weighted average across all shipments; promo SKUs use their regular SKU's costs |
| Revenue | `qty × price` (promo price for promo SKUs); per-channel cash/bank/retro % |
| COGS | `qty sold × avg TI cost` |
| Fargo VAT | qty split by month's overall cash share; bank: `qtyBank × (price − Fargo cost) × 12%`; cash: `qtyCash × Fargo cost × 3% × 12%` |
| Fargo income tax | `revenue × 1.9%` |
| TI income tax | manual quarterly filings booked to a month; audit view recomputes `margin = FargoValue ÷ 1.12 ÷ 1.03 × 3%` per shipment, `tax = 15% × max(0, GP − declared expenses)` + variance vs filed |
| Settlement | cumulative `revenue − Fargo OPEX − retro − Fargo marketing − Fargo VAT − Fargo income tax − transfers − AR` |
| Balance sheet | inventory @ avg TI cost + transit + AR + TI bank + VAT prepay + settlement receivable = tax payable + prior VAT + Nutriben loan + capital + retained earnings + explicit plug |
| Parity | target = max(TI, Fargo) cumulative capital; shows who invests next |

Tax rates are editable in Settings (`Setting` table, key `taxes`).

## Data entry & import

- **Sales**: editable month × product × channel grid; CSV paste/upload with
  preview + rejection report; **1C adapter**:
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
  self-correcting. `month` defaults to the current month.
- Everything else is manual entry via inline-editable grids.
- **P&L export**: `⇩ Export` button → CSV (semicolon, UTF-8 BOM) for Excel.

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
npm test                              # 22 engine tests
npx tsx prisma/verify-requests.ts     # all four data-request kinds, end to end
```

**5 · Vercel.** Import the GitHub repo. `build` already runs `prisma generate`
first (the generated client is gitignored, so the build would otherwise fail).
Set every key from `.env.example` in the project settings, with `APP_URL` set to
the real deployed domain — data-request links are built from it, and a localhost
value produces links recipients cannot open.

**Note on long requests.** The 1C sync (especially «Заменить все месяцы») and any
future agentic chat run well past a typical serverless timeout. If they time out
on the deployed plan, they need streaming or a background job rather than a
plain request/response.
