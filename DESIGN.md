---
name: Humana Finance
description: Quiet Authority. The owner's books for Turbo Impex and Fargo, set as calm financial documents on an off-white plane.
colors:
  accent: "#1f108e"
  accent-hover: "#3730a3"
  accent-soft: "#e2dfff"
  accent-soft-bg: "#eef0fd"
  background: "#f8f9ff"
  foreground: "#0b1c30"
  surface: "#ffffff"
  surface-low: "#eff4ff"
  border: "#e2e8f0"
  border-strong: "#c8c4d5"
  muted: "#64748b"
  danger: "#ba1a1a"
  danger-soft: "#ffdad6"
  ok: "#067647"
  ok-soft: "#ecfdf3"
  warn: "#b54708"
  warn-soft: "#fffaeb"
  sidebar: "#1e1b4b"
  sidebar-line: "rgba(255, 255, 255, 0.08)"
  sidebar-fg: "#adaae3"
  sidebar-fg-strong: "#ffffff"
  sidebar-accent: "#a9a7ff"
  series-1: "#2a78d6"
  series-2: "#eb6834"
  series-3: "#1baf7a"
  series-4: "#eda100"
  series-5: "#e87ba4"
  series-other: "#b8bfcc"
  trend: "#a3adbf"
  plan-accent: "#0039a6"
  plan-background: "#f4f6f9"
  plan-foreground: "#0b1b33"
  plan-border: "#dce3ec"
  plan-muted: "#5c6b82"
  plan-sky: "#3aa6da"
typography:
  display:
    fontFamily: "Manrope, Inter, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Manrope, Inter, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    letterSpacing: "-0.015em"
  title:
    fontFamily: "Manrope, Inter, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    letterSpacing: "-0.01em"
  figure-lg:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: "28px"
    letterSpacing: "-0.02em"
    fontFeature: "\"tnum\" 1"
  body:
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "13px"
    fontWeight: 400
  figure:
    fontFamily: "Inter, Arial, Helvetica, sans-serif"
    fontSize: "13px"
    fontWeight: 550
    letterSpacing: "0.01em"
    fontFeature: "\"tnum\" 1"
  label:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
  table-head:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "11.5px"
    fontWeight: 600
  plan-ui:
    fontFamily: "Nunito Sans, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    letterSpacing: "-0.1px"
  plan-figure:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "13px"
    fontWeight: 400
    letterSpacing: "-0.2px"
    fontFeature: "\"tnum\" 1"
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  modal: "16px"
  pill: "9999px"
  plan-card: "14px"
  plan-pill: "20px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  2xl: "24px"
  page: "32px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.surface}"
    rounded: "{rounded.sm}"
    padding: "0 14px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.sm}"
    padding: "0 14px"
    height: "36px"
  button-secondary-hover:
    backgroundColor: "{colors.surface-low}"
  button-ghost:
    textColor: "{colors.muted}"
    rounded: "{rounded.sm}"
    padding: "0 14px"
    height: "36px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    padding: "0 10px"
    height: "32px"
  segmented-active:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.surface}"
    rounded: "{rounded.sm}"
    padding: "4px 12px"
  segmented-idle:
    textColor: "{colors.muted}"
    rounded: "{rounded.sm}"
    padding: "4px 12px"
  badge-neutral:
    backgroundColor: "{colors.background}"
    textColor: "{colors.muted}"
    rounded: "{rounded.pill}"
    padding: "1px 8px"
  badge-warn:
    backgroundColor: "{colors.warn-soft}"
    textColor: "{colors.warn}"
    rounded: "{rounded.pill}"
    padding: "1px 8px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
  pulse-tile:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    padding: "14px 16px"
  pulse-tile-active:
    backgroundColor: "{colors.accent-soft-bg}"
  nav-item:
    textColor: "{colors.sidebar-fg}"
    padding: "8px 20px"
  nav-item-active:
    textColor: "{colors.sidebar-fg-strong}"
  chart-column:
    backgroundColor: "{colors.accent}"
    rounded: "{rounded.sm}"
    width: "24px"
---

# Design System: Humana Finance

## Overview

**Creative North Star: "Quiet Authority"**

Humana Finance reads like a well-kept set of books rather than a dashboard. White cards with hairline borders sit on a cool off-white plane, and figures are set in tabular digits and right-aligned. Hierarchy comes from weight, hairlines and spacing. Colour is held back for meaning. A single deep indigo carries selection and the single-series marks. Green and red are reserved for direction and sign, and amber means one thing: something is below the line it should be above. A navy sidebar frames the work, and the sticky month switcher is the one control that is always present, because the month is the unit of work.

Density is that of a working ledger: 13px body, 11.5px table heads, and tight row padding on long statements. The overview is the exception. It is composed so it can be shown to partners on a screen as it stands: five pulse tiles steer one large chart, and every tile is the switch for its own view in that chart. The app's own copy is Russian first and English second, and every string is bilingual.

The supply-planning section (`/planning`) runs a scoped sub-system that came from the owner's design canvas. It has its own palette, Nunito Sans for UI, JetBrains Mono figures and 14px cards. It is documented below as a scoped world. Nothing outside `/planning` should borrow from it.

**Key Characteristics:**
- Flat white cards with 1px hairlines on an off-white plane. Cards carry no shadow.
- One indigo accent for selection, the active state and single-series data.
- Tabular, right-aligned figures everywhere. Negatives are red, in statements and in the `Num` primitive.
- Structure is shown through weight and rules (hairline, strong rule, foreground rule), not through fills.
- Amber is a warning colour only.
- Manrope sets headings, Inter sets body and figures, and icons are hand-drawn strokes.

## Colors

The palette is a cool neutral ground with one saturated indigo. The semantic colours appear only when a figure needs them, and charts use a separate categorical set.

### Primary
- **Deep Ledger Indigo** (accent): the active segmented option, the primary button, the active pulse tile outline, the single-series chart columns and sparklines, focus outlines, links on hover, and the active section tab underline. Hover deepens it to **Indigo Hover** (accent-hover).
- **Indigo Wash** (accent-soft-bg): the selected or open month. It bands the open month in the chart, tints the focus column in statements (`is-focus`), fills the active tile and the YTD/selected column in tables, and marks the current month in the month picker.
- **Indigo Mist** (accent-soft): the focus ring around inputs, the text selection colour on the overview, and accent badges.

### Neutral
- **Cool Paper** (background): the page plane. It is also the hover fill for tiles and supply rows.
- **White Sheet** (surface): cards, tables, tooltips and the sticky header (at 95% opacity, with backdrop blur).
- **Faint Ledger Blue** (surface-low): total rows, hover on secondary buttons, and the sub-band headers inside cards.
- **Ink Navy** (foreground): text, the 1px rule above totals, and the chart's norm line and its label.
- **Slate Muted** (muted): labels, subtitles, axis ticks, table heads, and comparison figures.
- **Hairline** (border): card borders, row dividers (mixed to 55% in statements), and chart gridlines.
- **Strong Hairline** (border-strong): table header rules, subtotal rules, and the chart baseline.
- **Midnight Navy** (sidebar), with **Lavender Text** (sidebar-fg), white (sidebar-fg-strong) and **Lavender Accent** (sidebar-accent, the 2px left bar on the active section).

### Semantic
- **Ledger Red** (danger / danger-soft): negative figures, falling changes, failed checks, and destructive actions.
- **Ledger Green** (ok / ok-soft): rising changes, ok badges, and complete months in the month picker.
- **Amber** (warn / warn-soft): warnings only. Stock cover below the rule (on the tile value, on the column, and in the supply list), the «нужен пересчёт склада» flag, notices, warn badges, and partial months in the month picker.

### Chart series
- **Categorical five** (series-1 to series-5: blue, orange, green, gold, pink). They are validated for colour-blind separation and assigned in this fixed order to the leading series. The folded remainder «Прочие» is always **Neutral Fog** (series-other). In tile sparklines, the line of an inactive tile recedes to **Trend Grey** (trend).

### Named Rules
**The One Accent Rule.** Indigo is the only accent colour. It marks what is selected or what is the single measure on screen. Never use it for decoration.

**The Amber Means Below Rule.** Amber appears only where something falls short: cover below the rule, a needed recount, or an incomplete month. A cover column at or above the rule stays indigo.

**The Fixed Series Rule.** Split series take series-1 to series-5 in order, and «Прочие» is always series-other. A series never changes colour between views.

## Typography

**Display Font:** Manrope (with Inter, system-ui)
**Body Font:** Inter (with system-ui, -apple-system, Segoe UI)
**Figures:** Inter with tabular numerals (with Arial, Helvetica). There is no monospace face in the main world.

**Character:** Manrope gives the headings a calm, slightly geometric authority. Inter carries the text and the figures. Its real 550 and 680 weights keep the digits even and dense without going thin.

### Hierarchy
- **Display** (Manrope 600, 24px, -0.01em): the page title in `PageTitle`.
- **Headline** (Manrope 600, 22px, -0.015em): the section heading in the shell, above the section tabs.
- **Month switcher** (Manrope 600, 15px): the month name in the sticky header.
- **Title** (600, 15px, -0.01em): titles of the overview cards. `SectionTitle` uses 14px and `CardHeader` uses 13px.
- **Pulse figure** (Inter 600, 22px, line-height 28px, -0.02em). It drops to 18px when the value is longer than 13 characters. `Figure` uses 20px.
- **Body** (Inter 400, 13px): table cells and rows. Subtitles are 12.5px muted.
- **Figure** (Inter 550, tabular, +0.01em, right-aligned, no wrapping, no ligatures). Weight 680 when the figure is strong.
- **Label** (600, 12px, muted): field and group labels. Tile labels are 12px regular, muted.
- **Table head** (600, 11.5px, muted, sentence case).
- **Statement section row** (650, 11px, uppercase, 0.06em tracking, muted): used only as the group header row inside a statement table.

### Named Rules
**The Tabular Rule.** Every figure that can be compared is set in tabular digits (`tnum`) and right-aligned in its column. Axis ticks in charts follow the same rule.

**The Sentence-Case Rule.** Headings, labels and table heads are in sentence case. The only uppercase is the statement section row inside a table.

## Layout

- **Shell:** a fixed 240px navy sidebar on the left. The main column has a sticky 56px header holding the month switcher, and content sits in a centred container (max 1440px, 32px side padding, 28px top, 64px bottom).
- **Section heading:** the headline sits above an underline tab row (24px gap, 2px indigo underline on the active tab). Tabs carry the query string across, so filters persist between them.
- **Rhythm:** 16px between cards. Card headers are inset 20px horizontally and 16px from the top. Table cells are padded 0.42–0.45rem vertically and 0.75–0.9rem horizontally (0.7rem in `is-compact`). Section titles get 32px above them.
- **Overview:** a context line (12.5px muted). Then five pulse tiles in one bordered strip with 1px dividers, in 2 columns, 3 from md and 5 from xl. Then one full-width chart card, and below it Movers and Supply side by side from lg. The chart footer reserves 64px on the right so the floating assistant button never covers the table toggle.
- **Breakpoints:** Tailwind defaults (md 768px, lg 1024px, xl 1280px). The app is desktop-first, and wide tables scroll horizontally with a sticky label column.

## Elevation & Depth

The system is flat. Depth comes from tone (the off-white plane under white cards, then surface-low bands) and from hairlines, not from shadows. Cards, tables, tiles and the chart card have no shadow. Shadow is used only for layers that float above the page.

### Shadow Vocabulary
- **Tooltip** (`box-shadow: 0 6px 20px -6px rgba(11,28,48,0.18)`): the chart tooltip.
- **Modal** (`box-shadow: 0 20px 50px -12px rgba(16,24,40,0.35)`): dialogs, over a 40% slate scrim with a 2px blur.
- **Popover** (Tailwind `shadow-xl`): the month picker.
- **Field lift** (`box-shadow: 0 1px 2px rgba(16,24,40,0.04)`): a barely-there lift under inputs and selects.

### Named Rules
**The Hairline Rule.** A resting surface is separated by a 1px border, never by a shadow. On hover, a quiet card's border tints towards indigo (35% mix).

## Shapes

Corners are gentle and small. Buttons and segmented options are 4px. Toggle frames and icon buttons are 6px. Cards, inputs, selects, tables and tooltips are 8px. Modals are 16px. Badges and status dots are full pills. Chart columns are rounded 4px at the data end and square at the baseline. The open-month band is 6px. Legend swatches are 10px squares with 3px corners. The tooltip key is a 3px × 10px rounded line. Icons are 24-unit lucide-style strokes at 1.7 weight with round caps and joins. Glyphs and emoji are never used as icons.

## Components

### Buttons
Restrained and compact.
- **Shape:** 4px corners, 36px tall, 13px medium text.
- **Primary:** indigo with white text, deepening to accent-hover on hover.
- **Secondary:** white with a hairline border, turning surface-low on hover.
- **Ghost / Danger:** text only (muted or red), with a background on hover. Disabled buttons drop to 50% opacity.
- **Icon button:** 28px square with 6px corners, muted, tinting by tone on hover.
- **Text action:** 12.5px medium indigo text that underlines on hover (for example «Показать таблицей», «Открыть план закупок»).

### Segmented control
A 2px-padded white frame with a hairline border and 6px corners. The active option is filled indigo with white text. Idle options are muted and turn foreground on hover. Use it for view, scale, measure and split choices.

### Badges
Full pills, 11px medium, a 1px tinted border at 15% of the tone, in the tones neutral, ok, warn, accent and danger.

### Cards / Containers
- **Corner Style:** 8px.
- **Background:** white on the off-white plane.
- **Shadow Strategy:** none (see the Hairline Rule).
- **Border:** 1px hairline. Inner bands are separated by hairline top borders, and sub-headings sit on a 50% surface-low band.
- **Internal Padding:** 16–20px.

### Inputs / Fields
- **Style:** 32px tall, 8px corners, hairline border, white, 13px, with the field lift.
- **Focus:** the border turns indigo with a 3px indigo-mist ring.
- **Disabled:** background-coloured fill with muted text.
- **Number input:** groups digits with commas as the user types («10,000,000»). In fraction fields a typed comma is the decimal mark. Pasted amounts in either style are accepted.

### Navigation
The sidebar has the Manrope wordmark at the top, then section links at 13.5px. The active link has a 2px lavender-accent left bar, a 7% white fill and white text. Idle links are lavender and brighten on hover. A small pulsing dot shows a pending navigation. The admin group sits below a sidebar-line rule. A RU/EN switch is at the foot of the sidebar. The sticky header holds the ‹ month › switcher. Its popover lists every month with a completeness dot (green for complete, amber for partial, strong hairline for empty) and a lock for closed months.

### Financial statements and tables
Every statement uses one table style. The label column is on the left and sticky. Figures are right-aligned and tabular. Header rows are 11.5px muted over a strong hairline, and row dividers are 55% hairlines. Structure is shown by rule and weight: a subtotal has a strong rule on top at 650 weight, and a total has a foreground rule on top, 700 weight and a surface-low fill. Ratio, memo and check rows are muted and smaller. The focus month is washed in indigo. An open month carries «предварительно» under its header. Rows highlight on hover. Empty values show as «—».

### Pulse tile (signature)
The pulse tiles form one bordered strip, divided by 1px gaps. Each tile has a 12px muted label, a 22px figure, one or two 12px lines, and a 12-month sparkline at its foot (2px stroke, a dot on the open month). A change line is an arrow icon plus a signed percentage in green or red, followed by a muted «к августу». When a tile is clicked it switches the chart. The active tile gets the indigo wash and a 1px inset indigo outline. Today-scoped tiles say so in their label («Ближайший заказ в IBP»).

### Focus chart (signature)
- Columns are at most 24px wide (minimum 8px, 46% of the slot), with 4px rounding at the data end and a square baseline.
- Stacked segments are separated by a 2px surface gap.
- Gridlines are hairlines (border colour), and the baseline is border-strong. Axis ticks are 11px muted tabular text.
- The open month is banded in the indigo wash, and its total is capped above the column (11.5px, weight 650). A running month is drawn at 50% opacity and labelled «месяц идёт».
- A norm line is drawn as a 1px foreground rule, with its label in foreground at weight 600 on the axis. Columns below the norm turn amber.
- Show a legend under the chart for two or more series and no legend for one series. The swatches are 10px.
- The tooltip leads with the month (muted), then the value (15px, 600). Next comes the change against the previous month, then each series, top of the stack first, keyed by a short coloured line. It flips sides past 62% of the width.
- Keyboard support: arrow keys, Home and End move between months, and Enter opens the month. Clicking a column also opens the month.
- Every chart offers a table view («Показать таблицей») that shows all 12 months.
- Motion: the one authored motion is the columns settling up from the baseline when the measure or split changes (0.46s, `cubic-bezier(0.16, 1, 0.3, 1)`, from 84% scale and 40% opacity). It plays only when `prefers-reduced-motion: no-preference` and never on page load.

### Supply-planning canvas (scoped to `/planning`)
`.plan-design` redefines the theme variables, so utilities inside it pick up the canvas palette. Its accent is plan-accent, it adds a sky role and info, past and ink/border tints for each tone, and its plane is plan-background. UI text is Nunito Sans and every figure is JetBrains Mono (tabular). Cards are 14px, hairlined and shadowless. Pills are 20px, 11px and weight 800. Tables have uppercase 10.5px/800 micro-headers on a surface-low band, hairline rows and a 2px-ruled footer. The columns the owner edits are tinted. Number inputs are 108px wide with 6px corners and a 2px indigo outline on focus. These values apply only inside `/planning`.

## Do's and Don'ts

### Do:
- **Do** use the tokens and shared classes (`.quiet-card`, `.stmt`, `.tbl`, `.num`, `.figure-num`) and the primitives in `ui.tsx` and `statement.tsx`, rather than one-off hex values.
- **Do** set every comparable figure in tabular digits, right-aligned. Show negatives in red, and show «—» for empty values.
- **Do** reserve indigo for the selected, active or single measure, and the indigo wash for the open or focus month.
- **Do** use amber only for shortfalls: cover below the rule, a needed recount, partial data.
- **Do** give split charts the fixed series order, with «Прочие» in series-other. Show a legend only when there are two or more series, and always offer a table view.
- **Do** keep copy bilingual, Russian first, and say when a figure is scoped to today or to a month in progress.
- **Do** gate motion behind `prefers-reduced-motion` and play it only in response to a change the user made.

### Don't:
- **Don't** put shadows on cards, tiles or tables. Shadows belong only to tooltips, popovers, modals and the faint input lift.
- **Don't** add a second accent hue, or use series colours outside charts and their legends and tile bars.
- **Don't** colour a column amber when it is at or above the rule, and don't use amber for emphasis.
- **Don't** use glyphs or emoji as icons. Use the stroke set in `icons.tsx`.
- **Don't** put uppercase tracked kicker labels above headings. Uppercase belongs only to statement section rows (and to `/planning` table heads).
- **Don't** bring Nunito, JetBrains Mono, the plan-accent or 14px cards out of `/planning`.
- **Don't** show real customer figures in examples or demos without labelling them as demonstration data.
