<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Business context — read before touching anything

This app is the financial + supply-planning system for **Humana Uzbekistan**: Turbo Impex LLC (TI, the owner's importer) distributes Humana baby formula (DMK Baby, Bremen, Germany). The user is the owner/admin. Working language is Russian; the UI is RU-first bilingual.

## Company structure & the Fargo deal (critical to interpret any number)
- **Turbo Impex (TI)** imports from Germany (always PREPAYS — TI never owes Germany; «товар в пути» = TI's advances). TI pays 15% profit tax.
- **Fargo** is the distributor — a 50/50 partner. On paper TI "sells" to Fargo at COGS+3–10% (transfer price), but economically it is **consignment**: Fargo sells at the app's retail prices and must remit ALL collections (cash + bank) minus its own expenses. The app's settlement model («Осталось за Fargo») IS the real contract; the paper price and акт сверки are meaningless for economics. Fargo pays 12% VAT + 1.9% turnover tax (modeled in the engine).
- Fargo distributes other brands too, so it CANNOT report brand-level cash. The settlement receivable is verifiable only through the app's model.
- Known issue: Korzinka (~25–33% of revenue) moved to fast payment in exchange for **extra discounts that are NOT in the model** — revenue = qty × справочник price − retro %, so P&L profit and the Fargo receivable are overstated by the unmodeled discount. Permanent fix pending: 1C dev to add invoiced amounts («Сумма выручки с НДС») to the sales API.

## Data policies
- **pinetrade 1C is the source of truth for sales** (qty only; `Sale.amount` is null for synced rows → engine values revenue at Settings prices). Sell-in (channel orders), NOT consumer sell-out — monthly numbers sawtooth.
- Promo SKUs (АКЦИЯ) are separate products linked via `regularProductId`; planning/costing folds them into the regular physical SKU.
- **Month close**: closed months (Month.closedAt) are frozen for STAFF and 1C feeds; only ADMIN edits/reopens. The P&L shows closed months only.
- Balance sheet: stock at avg TI landed cost; «Не сверено» (plug) is the reconciliation error — only MEASURED lines (stock counts, банк/касса TI, AR, transit) move it; modeled lines (settlement) cannot.
- Stock: monthly month-end counts (StockCount); a daily 1C push to `/api/import/1c-stock` is planned but not yet scheduled by the 1C dev.

## Baby-formula demand mechanics (drives the planning module)
- Demand is driven by **medical detailing**: med reps get doctors to prescribe; each verified prescription (foil tracking) = one recruited baby. ~3 packs/month if fully retained; observed retention ≈35–45% blended, falling with age.
- **Stages**: Platin 1 (baby age 0–6 мес) → Platin 2 (6–12) → Platin 3 (12+, fading). Today's P1 recruitment predicts P2 demand ~6 months later (the "wave"). Expert line (AC/AR/HN/SL) is specialty — stable, not cohort-driven.
- The cohort model lives in `src/lib/planning/cohort.ts` + `model.ts`: recruitment × retention curve × packs, calibrated per stage against recent sell-in (hybrid: multiplicative where the programme dominates, additive base where pre-programme demand exists). Recruitment series in PlanningRecruitment (owner enters monthly verified Rx).
- Births in Uzbekistan are falling −3…5%/yr; growth must come from share (2027 plan: 340k units vs 220k in 2026).

## Supply chain (planning module)
- Orders are entered into Humana's **IBP system by the 20th of each month** = de facto order for the ship month 4 months later; +~1 month transit +1 week customs → sellable ~5 months after the deadline. Committed purchases (PlanningPurchase, per SKU per SHIP month) are the pipeline; contracts from order forms are historical seeds only.
- Trucks must be filled **≥98%** (transport safety), ~33 pallets / ~21.5t. Pallet densities: 400g SKUs 624/pal, 800g 384/pal, AC 864, HN 1160 (PlanningSku logistics from the Order Form import).
- Owner policy: ≥4 months of stock cover at all times (planning.minCoverMonths setting).
- Germany renumbered articles; PlanningSku.altArticles maps old→new (70836→70987 etc.).

## Operational conventions
- Dev DB = Neon `dev` branch (in .env); production = `main` branch (commented `# DATABASE_URL_PRODUCTION=` line — never print its value). Vercel auto-deploys master; **schema changes need a manual `prisma db push` against production BEFORE pushing code** (the owner runs it in PowerShell 5.1 — no `&&`, one command per line).
- `prisma/debug-*.ts` are gitignored read-only diagnostics (support `--production`). `prisma/refresh-dev-from-prod.ts` mirrors prod→dev (owner runs `--commit`).
- Roles: ADMIN (owner) / STAFF (figures only) / VIEWER. Planning section is ADMIN-only.
- For bulk data the owner provides files (Downloads folder); parse with the `xlsx` npm package (no Python on this machine).
