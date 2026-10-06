---
version: 1
slug: "src-app-page-tsx"
primary_target: "src/app/page.tsx"
related_targets: ["src/components/OverviewView.tsx"]
---

# Обзор (overview) — surface brief

Scope: the app's home route, the month overview. Mode: Operate.

Audience and job: the owner, a quick daily look on a laptop; also put on a screen for partners (Fargo) in meetings. It must answer two questions at a glance: how are sales going, and is stock under control. Profit, settlement and data-entry checks live in their own sections.

Content: for the selected month, sales incl. VAT, units sold, the leading channel's share, months of stock cover against the owner's four-month rule, and (as of today) days to the IBP order deadline and trucks on the way; twelve months of history; products that moved most; products below the cover rule.

Constraints: exact figures from the books, nothing invented; Russian first; clean, no decoration.

## Direction contract

THESIS: One glance, one gesture: five pulse tiles drive one large chart below them, so the page answers "how are sales going" and "is stock under control" without leaving it. It refuses the profit-first tiles-and-tables home and the generic KPI grid whose charts are unrelated to its tiles.

OWN-WORLD: The shipped Quiet Authority system: off-white plane #f8f9ff, white cards with 1px #e2e8f0 hairlines, deep indigo #1f108e for selection and single-series marks, Manrope headings, Inter figures. Splits use the validated five-slot categorical palette plus a neutral "Прочие"; amber appears only where cover is below the rule.

STORY: The owner reads the month's sales, units, leading channel, cover against the four-month rule and days to the IBP deadline; clicks a tile to see its year in the chart; hovers a month for the breakdown or clicks it to move the whole page there; scans movers and supply for what needs action; shows it to partners as it stands.

FIRST VIEWPORT: Five equal tiles across the top (label, value, change vs last month, 12-month sparkline; the active tile outlined in indigo). Below, full width, the focus chart card: title left, metric and split controls right, twelve monthly columns with the selected month banded, legend and a table view. Movers and supply side by side beneath.

FORM: Pulse strip + focus chart; position 4 of 7 on the ordered list; dealt lead; seed key c2798b78.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
