# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **The owner (admin).** Runs Turbo Impex, Humana's importer in Uzbekistan. Opens the overview for a quick daily look on a laptop, and shows it to partners (Fargo, the 50/50 distribution partner) on a screen in meetings.
- **The team (staff, viewers).** Enter and check the month's figures (sales sync from 1C, invoices, expenses, stock counts); staff see figures but not structure, viewers only read.

## Product Purpose

Humana Finance is the financial and supply-planning system for Humana baby formula in Uzbekistan. It replaces the owner's Excel workbook: profit and loss for Turbo Impex, for Fargo's Humana business and for the group, the settlement between the two companies, stock and FIFO cost of goods, taxes, month close, and purchase planning against Humana's IBP ordering cycle. Success is the owner knowing how sales and stock are doing at a glance, and every figure matching the workbook it replaced.

## Positioning

Built around one specific partnership: Turbo Impex imports and invoices Fargo, Fargo sells and remits; the app's settlement model is the real contract between them, and the engine reproduces the owner's workbook figure for figure.

## Operating Context

- Months are the unit of work; a month is closed once its figures are complete.
- Sales come from pinetrade 1C as quantities (sell-in to channels, so months sawtooth); revenue is valued at the app's prices.
- Trucks arrive from DMK Baby (Germany); orders go into Humana's IBP system by the 20th of each month for the ship month four months later.
- Stock is counted at month-end; the owner's policy is at least four months of stock cover.
- Invoices from Turbo Impex to Fargo are issued in Didox.
- Russian first, English second, throughout.

## Capabilities and Constraints

- Next.js on Vercel with a Postgres database; desktop-first, usable on a phone.
- Money in UZS with comma thousands separators; purchase prices in EUR.
- Roles: admin (everything), staff (figures only), viewer (read only). Planning is admin-only.

## Brand Commitments

- Product name: Humana Finance. Companies named as Turbo Impex (TI) and Fargo.

## Evidence on Hand

- Real figures live in the database (the imported workbook, the 1C sync and entries since). Never invent figures, customers or benchmarks; demonstration data must be labelled as such.

## Product Principles

1. Exact numbers first: every figure is traceable to its source and agrees with the books.
2. The answer in a minute: the overview says how sales and stock are doing without digging.
3. Fit to show: what appears on screen in a partner meeting is accurate and composed.
4. Clean over decorative: nothing on screen that does not inform a decision.
