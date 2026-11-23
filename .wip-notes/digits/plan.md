# Plan: Arabic-Indic figures in Arabic, money stays Latin

**Workflow:** ECMS digits, planner output, 22 Nov 2026.
**Basis:** the inventory from nine reviewers. I checked the load-bearing claims in the code myself (§0). No repository file was edited, and nothing was built or tested. The only commands run were a few read-only `node -e` Intl probes and one woff parser, written to the scratchpad.

---

## 0. The owner's answers this plan implements, and what I verified

**The owner's words (relayed).** «اى حاجه قدام عامل السيستم عربى كل حاجه تبقى عربى».
- Q1, the two dates on the print sheet: Arabic-Indic.
- Q2, the counts above «السيارات», «التراخيص» and «الإخطارات»: Arabic-Indic.
- Q3: «مش فاهم».
- Q4: «اه».

**What the run's notes add.** `.wip-notes/digits/spec.md` records three things:
- Q3 was re-asked plainly and answered «أيوه صلحها». This is the «المخالفات» count on the car record.
- Q4 is the count grammar on the car record.
- The scope answer was «كل الأرقام عربي ما عدا الفلوس (اقتراحي)».

The money exception is not in the relayed sentence. It comes from that recorded answer. The plan follows it. The cases where the owner's own originals write money in Arabic-Indic are held open (Q-6).

**Verified in the code.** Where a reviewer was wrong, the correction is marked **(correction)**.

| Fact | Where | Verified |
|---|---|---|
| `formatNumber`, `formatDate`, `formatDateTime` and `formatBusinessDateTime` use `ar-EG`. Money helpers use `ar-EG-u-nu-latn`. | `apps/web/src/shared/lib/format.ts:20-37,60-105,108-158` | yes |
| `formatNumber(2026,'ar')` = «٢٬٠٢٦». A year must never go through it. `useGrouping:'min2'` or `false` gives «٢٠٢٦». | node 22 ICU probe | yes |
| `formatDate(…,'ar')` with `dateStyle:'medium'` gives a numeric, day-first date «٢٢‏/١١‏/٢٠٢٦», not «٧ نوفمبر ٢٠٢٦». **(correction)** | probe | yes |
| ar-EG percent gives «٨٥٪» plus a trailing U+061C. ar-EG decimals give «٣٧٫١٠». | probe | yes |
| `translate()` fills `{{x}}` with `String(value)`. A missing param renders `{{name}` with one brace dropped, a pre-existing bug. | `apps/web/src/platform/localization/i18n.ts:31289-31300` | yes |
| `translate` lives in the same 31,300-line file as the whole catalogue. | i18n.ts | yes |
| Azeret Mono (the Fleet/ATM/Ops figure face) ships only the Latin and Latin-ext unicode-ranges. It has no U+0660–0669. | `node_modules/@fontsource/azeret-mono/400.css` | yes |
| Cairo's arabic subset covers U+0600–06FF. | `@fontsource/cairo` 5.3.0 | yes |
| Cairo's Arabic-Indic digits are **proportional**: advances 250, 309, 527, 676, 468, 678, 482, 624, 624, 519 per 1000. Cairo has **no `tnum`** (GSUB has only ccmp/fina/init/locl/medi/rlig), so `tabular-nums` does nothing for them. Azeret's Latin digits are 650 each, with `tnum`. U+066C «٬» is 193 wide, a thin mark. | parsed the woff files with `/tmp/claude-0/-home-user/85f289ec-521b-5944-9b89-a0120b22d71a/scratchpad/fontcheck/woff.py` | yes |
| Cairo is loaded by only six modules. It is not global. | `FuelCardBoard.tsx`, `FuelCardDialog.tsx`, `custody-dashboard-parts.tsx`, `hr/attendance/views/view-parts.tsx`, `InterviewRoom.tsx`, `PublicApplyPage.tsx` | yes |
| The Arabic plural helper already exists: five forms, zero reads as `few`, used by Operations, the roster, Welcome and custody. | `apps/web/src/shared/lib/plural.ts` (`pluralKey`, `pluralForm`) | yes |
| Plural categories: 0 zero (→ few); 1 one; 2 two; 3–10 few; 11–99 many; 100–102 other; 103–110 few; 111–199 many; 200 other; 1234 many. | `Intl.PluralRules('ar')` probe | yes |
| House style for counted nouns: «إيصال واحد · إيصالان · {{count}} إيصالات · {{count}} إيصالًا · {{count}} إيصال». For feminine «عملية», the many form is «{{count}} عملية», with no tanween on the taa marbuta. | i18n.ts:21534-21543 | yes |
| Raw MONEY reaching `t()`: only ATM banknote denominations. | SettlementPlanPage.tsx:724, PlanLinePanel.tsx:290/294, StandardLoadsDialog.tsx:156/190, CapturePanel.tsx:208, ControlDataTab.tsx:387-389, plus LayoutEditor.tsx:80 `before/after` | yes |
| Raw IDENTIFIERS reaching `t()`: custody memo `no` (a number). | ReceiptMemoChip.tsx:24-38, custody-memo-parts.tsx:169, CustodyMemoPaperView.tsx:120, CustodyReplenishDialog.tsx:210, ReceiptDialog.tsx:375-378,678-684, ReceiptsPage.tsx:508, CustodyMemoEditorPage.tsx:459,753 | yes |
| Raw YEARS reaching `t()`. | GoldReportsPage.tsx:322,448; PortalReportsPage.tsx:87 | yes |
| The dashboard `count()` is a plain en-US function, and it also writes MONEY: the fuel value-axis ticks and the bar aria amount. | `fleet/components/fleet-dashboard/dash-shell.tsx:639`; tab-fuel-chart.tsx:196,226; tab-custody-history.tsx:135 | yes |
| Operations prints counts through `formatAmount` on purpose. | SecuredDistributionParts.tsx:144, ReportBoard.tsx:310, report-export.ts:182 | yes |
| The custody Word letters print money as Arabic-Indic digits with an ASCII comma. These copy the owner's own Word papers. | `fleet/lib/custody-paper-format.ts:50-53` (`ai`, `aiAmount`) | yes |
| HR's view helpers read the locale from the store singleton (`store.getState()`), not from a hook. This is a precedent for non-hook helpers. | `hr/attendance/views/view-format.ts:8` | yes |

---

## 1. Approach

### 1.1 The rule as code

| Kind | Arabic | English |
|---|---|---|
| Counts, quantities, readings and km, durations, page and step numbers, ordinals, slot and position numbers, sheet row references, chart ticks and tooltips | Arabic-Indic, through `formatNumber` (grouping per Q-2) | unchanged |
| Years | Arabic-Indic, **never grouped** (`formatYear`) | unchanged |
| Dates and times | Arabic-Indic. Each screen keeps its own order and separator, except that Arabic dates joined by `-` switch to `/` (§4, bidi) | unchanged |
| Percent | Arabic-Indic plus «٪» | unchanged (`%`) |
| Decimals | ar-EG «٫» | unchanged |
| Print sheets | Arabic papers print every non-money figure in Arabic-Indic, whatever the UI language (Q-12) | — |
| MONEY (amounts, balances, prices, costs, fine amounts, fund figures, banknote denominations) | Latin digits, ASCII comma (`formatMoney`, `formatAmount`, `formatMoneyParts`, untouched) | unchanged |
| C identifiers, D typed inputs, E Excel/CSV, URLs, `data-*`, clipboard values, parse paths | **unchanged in this PR** (§7) | unchanged |

### 1.2 Central changes, in package P1 except the `translate` wiring

1. **Contracts:** `packages/contracts/src/common/value-objects.ts` gains `arabicIndicDigits(text)`, beside `asciiDigits` (:22), as its inverse. API papers and the web share it. The local copies (`ai` in custody-paper-format.ts:50, `toArabicDigits` in hr id-card/card-render.ts:59, `arabicDigits` in it/lib/custody-receipt-print.ts:92, `readerDigits` in vehicle-check-dashboard.ts:321, `ARABIC_FIGURES` in api contract-render.ts:365) may be re-pointed to it. That is optional and not required.

2. **`apps/web/src/shared/lib/format.ts`** gains the following. The signatures are fixed now, so packages can build in parallel.
   - `export { arabicIndicDigits }`
   - `localDigits(text, locale)`: Arabic maps digits; English returns the text unchanged. Use it for strings that are already built (padStart clocks, `ymd`, slices).
   - `formatYear(year: number|string|null|undefined, locale)`: «٢٠٢٦» / '2026'. Never grouped.
   - `formatPercent(value /*0–100*/, locale, { min = 0, max = 0 } = {})`: Arabic «٨٥٪» (digits plus U+066A, no ALM); English reproduces today's `${n}%` strings exactly.
   - `formatDecimal(value, locale, { min, max })`: Arabic «٣٧٫١٠»; English en-US with the same options.
   - `formatSlashDay(iso|null|undefined, locale)`: Fleet's year-first day «٢٠٢٦/١١/٠٧» / '2026/11/07'. Null gives '—'.
   - `formatPeriod('YYYY-MM'|null, locale)`: Arabic «نوفمبر ٢٠٢٦»; English returns the raw period, unchanged.
   - `formatNumber`: unchanged behaviour. Arabic grouping goes through one constant `AR_GROUP_MARK = '٬'`, applied with cached formatters and `formatToParts`. The answer to Q-2 then flips one line.
   - Reword the comment at :32-35: counts are no longer the legacy's untouched case; state the new rule.
   - Money helpers stay untouched.

3. **`apps/web/src/shared/lib/useFigures.ts`** (new): `useFigures()` returns `{ locale, count, year, percent, decimal, digits, day, period }`, bound to the store locale. Components use it so they do not have to thread `locale` through.

4. **`translate`.** New file `apps/web/src/platform/localization/figure-param.ts` (P1):
   `figureParam(value: string|number, locale) => typeof value === 'number' && locale === 'ar' ? formatNumber(value, 'ar') : String(value)`.
   The HUB wires one line in `i18n.ts` (`String(value)` → `figureParam(value, locale)`) and fixes the fallback to `{{${name}}}`. English stays `String(value)`, byte-identical.

   This fixes ≈385 raw-number params (≈336 calls in ≈150 files) at once. **Before it lands, every package converts its exceptions:**
   - money `d` (7 ATM sites) → `String(d)`;
   - memo `no` (≈16 sites) → `String(no)`;
   - years (3) → `formatYear`.

   Params that are already strings (`String(n)`, `toFixed`, `latin()`, `LATIN.format`, `num()`; ≈96 calls) are not reached by this change. They are listed per package.

5. **Font (P1).** Import `@fontsource/cairo/arabic-{400..800}.css` once in `apps/web/src/main.tsx`. Every screen then draws Arabic-Indic digits in the same face: the `font-figures` stack Azeret → Cairo, or the body stack. `unicode-range` keeps the download lazy.
   - Run a time-boxed spike first. Measure the U+0660–0669 advances of a candidate with a `tnum` feature or equal widths (Noto Sans Arabic, IBM Plex Sans Arabic) using the woff script.
   - Switch only if one passes **and** the owner prefers it in the pictures (Q-13).
   - Default: Cairo, with no change to `tailwind.config.ts` or `FIGURES_FONT`.

### 1.3 Per-site work

Each package replaces these patterns at its sites:
- page-local Latin formatters: `LATIN = new Intl.NumberFormat('en-US')`, `latin()`, `num`, `COUNT`, `KM`, `LITRES`, `ONE_DECIMAL`, `'ar-EG-u-nu-latn'`;
- raw `{n}` in JSX;
- `String(n)` and `toFixed` in text;
- hand-built dates (`slice(0,10)`, `padStart`).

They are replaced with the P1 helpers, or the store-locale variant in non-component helpers (the view-format precedent). Machine values stay Latin: data-* attributes, `<option value>`, URL params, Excel rows, file names. Where one string feeds the screen and Excel (`line()` in CustodyLedgerPage:534, `lineOf()` in CustodyMemosPage:516, `statementLines` in ATM operation-sheet), convert **only at the display and print edge**.

### 1.4 How money stays Latin

- **Do not touch:** `formatMoney`, `formatAmount`, `formatMoneyParts`, `moneyChip`, `useMoney`, `useFigure`, `Amount`, WHOLE/COMPACT/LATIN2, `fuel-reconcile` money and `signed`, `license-expense-memo money()`, `latin2` and `grouped`. Each keeps an en-US or nu-latn formatter and carries a `// latin-digits: money` marker for the guard (§5).
- **Split helpers that carry both money and counts:**
  - the dashboard `count()` at tab-fuel-chart.tsx:196,226 and tab-custody-history.tsx:135,356 → a money formatter;
  - ATM `int` (settlement-print.ts:73) → `int` for money plus a new count formatter;
  - ATM `plainNumber` (note-print.ts:96) → counts and slots versus denominations;
  - Operations ReportTable `figure`, `TileBody` and `printed` → a per-column or per-tile kind;
  - `countText` → `formatNumber`.
- **Fix money form, not digits.** These are Latin but ungrouped, against the rule's «1,000»:
  - `reportMoney` `toFixed(2)` (fleet-report-print.ts:235) → en-US with 2 decimals, grouped;
  - FuelCardsPage print `String(card.balance)`;
  - EmployeeInsuranceCard.tsx:125-137 `String(v)` → `formatAmount`.
- **B sites (money in Arabic-Indic today) on screens become Latin:**
  - CompanyViolationsPanel.tsx:698 (`formatNumber` on value × count) → `formatAmount`;
  - InterviewRoom.tsx:265 and CandidateBrief.tsx:373 (`toLocaleString('ar-EG')` on the expected salary) → `formatAmount`, or `formatMoney` with the currency;
  - PayrollReportsPage.tsx:308 and RunCostReport.tsx:114 (calculated columns): `formatAmount` when the expression references `amount`/`amountMinor` (`COLUMN_FIELDS`, CalculatedColumnBuilder.tsx:20), `formatNumber` otherwise.
- **B on the owner's own papers: HOLD (Q-6).** No change until he answers:
  - the custody Word letters, `aiAmount` at custody-paper-letters.ts:185,195,289,290,301,303,310,311;
  - HR «نموذج رقم (1)» wages, through `arabicFigures` in api contract-render.ts:372/392.

---

## 2. Packages (strict file ownership)

**Order and merge.** P1 merges first. P2–P9 build in parallel against P1's published names (§1.2). P10 (HUB) goes last.

**i18n changes.** No package edits `i18n.ts`. Each package writes `.wip-notes/digits/i18n/<pkg>.json` as `{ "set": { "<key>": { "ar": "…", "en": "…" } }, "remove": ["…"] }`, the format the earlier merge tool used. The HUB merges.

**Spec method.**
- A spec of a caller computes its expected text through the P1 helpers (`formatNumber(n,'ar')`, `formatSlashDay`, …). A Q-2 flip then breaks nothing.
- Helper specs pin literal strings.
- Inverted guards («no ٠-٩ anywhere») become «no Latin digit outside money cells», and keep a positive Arabic-Indic assertion.
- English pins stay as they are. They prove English is unchanged.

**Build rules.**
- One vitest file at a time, with no typecheck alongside (16 GB, no swap).
- No data change.
- Never print PINs.
- Card numbers stay masked.
- Owner messages in Arabic only.

### P1 FOUNDATION (shared, platform, contracts) — ≈22 source files, 6 specs re-pointed, 4 new

Source files:
- `packages/contracts/src/common/value-objects.ts`: add `arabicIndicDigits`.
- `apps/web/src/shared/lib/format.ts`: §1.2.
- `apps/web/src/shared/lib/useFigures.ts` (new).
- `apps/web/src/platform/localization/figure-param.ts` (new).
- `apps/web/src/shared/lib/relative-time.ts:5` → `'ar-EG'`, plus the comment at :1-2.
- `apps/web/src/platform/home/WelcomePage.tsx`: `:36` intlLocale → `'ar-EG'` (dates at :107, :210, :216, :240); `:167/:177` countdown figure → `formatNumber`.
- `apps/web/src/shared/ui/NumberedPager.tsx`: `:99`, `:101`, `:130`, `:159` → `formatNumber` (locale from the store). The option `value` and `data-pager-page` stay numeric. This fixes 16 Fleet boards, ATM `MachinesPage:315`, `ZoneList:118`, `ZoneDetail:158`, Ops `ShipmentsBoard:1571` and `RequirementsPage:554`.
- `apps/web/src/shared/ui/MultiSelect.tsx`: `:123` `selectionSummary(…, locale)` for the `+n` tail; `:919` badge. (`:726` and `:1098` are covered by the central change.)
- `apps/web/src/shared/ui/ColumnFilterSelect.tsx:53`: pass the locale.
- `apps/web/src/shared/ui/FormSection.tsx:40,:189`.
- `apps/web/src/shared/ui/DataTable.tsx:551`: sort-order badge, plus the comment at :543-545. `data-sort-order` stays numeric.
- `apps/web/src/platform/layout/nav-rows.tsx:44`: `count` and «٩٩+».
- `apps/web/src/platform/notifications/NotificationBell.tsx:146`: badge and «٩+».
- `apps/web/src/platform/auth/IdleSessionGuard.tsx:188` and `apps/web/src/platform/approvals/ApprovalChainPanel.tsx:122`: `String(n)` → `formatNumber`.
- `apps/web/src/shared/national-id/NationalIdOcr.tsx:59` (step circles) and `CardPhotoPicker.tsx:171`.
- `apps/web/src/main.tsx`: the Cairo arabic subset import (§1.2.5).
- Only if the spike switches face: `apps/web/tailwind.config.ts`.

Specs re-pointed:
- `platform/home/welcome.spec.tsx` :160, :182, :185, :186, :202 (the not-'>1<' check becomes vacuous; re-point to «١»), :243.
- `platform/notifications/notification-bell.spec.tsx` :69-81.
- `platform/approvals/ApprovalChainPanel.spec.tsx` :142.
- `platform/auth/idle-session-wiring.spec.ts` :52. It passes after the HUB wiring.
- `shared/ui/MultiSelect.spec.tsx` :140, :211, :812, :825, :900-907. Rename the «+n as today» test.
- `modules/fleet/fleet-figures-font.spec.ts`: only if the face changes.

New specs:
- `shared/lib/format-figures.spec.ts`: every helper. Arabic output matches `/^[^0-9]*$/`; English is byte-identical to today; years ungrouped; percent; decimal.
- `platform/localization/figure-param.spec.ts`.
- `shared/ui/NumberedPager.spec.tsx`.
- `shared/lib/latin-digits-guard.spec.ts`: the guard, §5.
- Extend `shared/lib/money-format.spec.ts` (:81 source guard). Add `toLocaleString('ar-EG')`, `ai(`/`aiAmount` outside custody-paper-letters, and `formatNumber` on money-named fields.

### P2 FLEET-RECORDS (registry, licensing, notices, drivers, accidents, odometer, maintenance, alarms, car page, print serial) — ≈30 source, ≈18 specs

All paths are under `apps/web/src/modules/fleet/`.

Pages:
- `pages/VehiclesListPage.tsx`: :708, :733, :1277, :1300 `ymd` → `formatSlashDay`; :971-972 `String()` → `formatNumber`. The tiles at :968-1013 are fixed through FleetFigures (owner Q2).
- `pages/VehicleDetailPage.tsx`: delete `LATIN_NUMBER`, `LATIN_DATE`, `LATIN_DATE_TIME` (:139-161) and use `formatNumber`/`formatDate`/`formatDateTime` (same options), for callers :205, :207, :236, :241, :280, :286, :316, :636, :639, :652, :657, :682. Fix the violations count (§3a) and the plural tag at :459 (§3b). Rewrite the comment at :458.
- `pages/LicensingPage.tsx`: :168 `day()` → `formatSlashDay` (:435); tiles :494-522 (Q2); month options :308 through licence-months.
- `pages/NoticesPage.tsx`: :115 `day()` (:320, :975); :553 and :826 `String` → `formatNumber`; tiles and breakdowns :518-568 (Q2).
- `pages/NoticeEditorPage.tsx`: :49 option «2026-11-20 — …» → `formatSlashDay(updatedAt)`; :433 `page:'2'` → `formatNumber(2)`.
- `pages/DriversListPage.tsx`: :185 `day()` (:791, :863); :1073-1074; :1316; tiles :1070-1121; print cells :689.
- `pages/DriverProfilePage.tsx`: :606, :733, :742, :751; :758 → `formatPercent`; :348 tab badge; the `dayAndTime` callers.
- `pages/AccidentsPage.tsx`: :122 LATIN → `formatNumber` (:180, :767); :527 `ymd`.
- `pages/OdometerPage.tsx`: :128 LATIN (:563, :580, :587, :779, :788); :480 `ymd`.
- `pages/MaintenancePage.tsx`: :126 LATIN (:646); :343 `ymd` (:473, :487).
- `pages/MaintenanceAlarmsPage.tsx`: :107-108 `latin` (:379, and :399 `formatNumber` prop); :424 `ymd`.
- `pages/AttendancePage.tsx`: :71 `ymd`.

Components:
- `components/FleetFigures.tsx`: :53 FigureChip, `typeof value==='number' ? formatNumber : value`; BreakdownCard :80/:86 and :96/:100.
- `components/ProfileCard.tsx:248`: `dayAndTime(…, locale)` through `localDigits`.
- `components/AlarmFigureCell.tsx:29`, `alarm-figure-card.tsx:31` and `AlarmReasonFacts.tsx:23`: the three local LATINs, and their `Day` (`AlarmReasonFacts.tsx:97-107`).
- `components/VehicleHoverCard.tsx`: :174 (:206); :217 and :286 `ymd`.
- `components/AccidentFormDialog.tsx`: :266 and :343 `String(MAX_GIVING_CARS)`; :312 `{i+1}`.
- `components/NoticeImageCell.tsx:94` and `components/GoLiveNotice.tsx:80`.

Lib:
- `lib/licence-months.ts:15` → `'ar-EG'`, plus the comment at :5-9. This reverses #767 (a).
- `lib/fleet-report-print.ts`:
  - :120 serial: add optional `locale?: Locale` to `FleetReport` (default `'ar'`, since the sheet is Arabic) and print `localDigits(String(i+1))`;
  - :235 `reportMoney` → grouped, two decimals, Latin.
  - Callers in other packages convert their own cells. ATM and Ops PDF statements pass `locale`.

i18n fragment: the 40 `fleet.vehicle.count.*.{one..other}` keys and the removals (§3b).

Specs:
- `pages/accidents-screen.spec.tsx` :237, :300, :434
- `pages/accidents-form.spec.tsx` :399
- `pages/drivers-licence-state.spec.tsx` :216 (the locator), :403, :422, :429, :491, :569
- `pages/vehicles-licence-state.spec.tsx` :263 (locator), :360, :363; rewrite :415-437, which today forbids Arabic-Indic
- `pages/licensing-screen.spec.tsx` :451 (keep :407, :564, :576, :579, :584, which already expect Arabic-Indic)
- `pages/registers-parity.spec.tsx` :339-343, :635-637 (expected values computed through the helpers)
- `fleet-alarm-figure.spec.tsx` :266-660
- `fleet-odometer-alarm-reason.spec.tsx` :249-407
- `fleet-maintenance-alarms.spec.tsx`: invert :203-216
- `fleet-maintenance.spec.tsx` :361-855
- `fleet-vehicle-profile-alarm.spec.tsx`: invert «whole body Latin» at :41-46 and :230-310
- `fleet-vehicle-card.spec.tsx` :248-422
- `fleet-odometer.spec.tsx` :321-1373, including pager :823
- `fleet-odometer-summary.spec.tsx` :154, :216
- `fleet-vehicle-history-links.spec.tsx`: :264, :283-285 (rewrite the «1,234 قراءة، Latin» test at :270), :308-310, :338, plus the new tests in §3
- `fleet-maintenance-integration.spec.tsx` :327-330: tighten to Arabic-Indic only
- `lib/month-window.spec.ts`: invert :28 and :52
- `lib/fleet-report-print` spec: serial and `reportMoney`

### P3 FLEET-CUSTODY (fund, ledger, memos, papers, licence expenses, receipts) — ≈45 source, ≈22 specs

All paths are under `apps/web/src/modules/fleet/`.

Pages:
- `CustodyPage.tsx`: :464 `ymd`; :871 and :914 through `useCount`; print cells :594.
- `CustodyLedgerPage.tsx`: :129, :134, :139, :149, :282, :286, :298 `ymd` → `formatSlashDay`; :688 `deletedCount`.
  - Print :577: `localDigits` on cells i<5. Cells 5–6 keep `reportMoney`.
  - `line()` (:534) stays Latin for Excel (:551).
- `CustodyMemosPage.tsx`: :476 (raw receipts). Print cells :514-521 at the print edge only (Excel at :529 stays as it is). :572 and :575 `String` → `formatNumber`. The «رقم المذكرة» identifier stays.
- `CustodyMemoEditorPage.tsx`:
  - :114 LATIN (:185, :315, :831-832, :873); :513 `toFixed(2)` → `formatDecimal(…,{min:2,max:2})`;
  - :462 and :729 `ymd`; :778 `monthOfDay`; :834 and :914-918;
  - :459 and :753 `no` → `String(no)`.
- `CustodyDeletedPage.tsx` :123/:271/:316.
- `CustodyPapersSetupPage.tsx` :448 `index+1`. The letters preview at :184 is HOLD (Q-6).
- `LicenseExpensesPage.tsx`: :95 LATIN (:426, :440, :455, :759, :928, :935); :376 `ymd`; :657 print count; :339 `settlementDay` with locale (Excel at :628 stays Latin); memo titles at :238, :997, :1047, :1020.
- `LicenseExpenseEditorPage.tsx`: :203 and :231 `index+1`; :585, :602, :774 memo; :637.
- `LicenseExpenseSetupPage.tsx` :512.
- `ReceiptsPage.tsx`: :100 LITRES → `formatDecimal` 2; :105 KM → `formatNumber` (:231, :462, :470); :381 `ymd`; print :598 (`toFixed(2)` → `formatDecimal`) and :599 (`String(odometer)` → `formatNumber`); :508 `String(memo.no)`.

Components:
- `custody-dashboard-parts.tsx`:
  - :22 `COUNT`, `LITRES`, `RATE` → locale-bound;
  - :162 and :247-261 `useCount` → `formatNumber(n, locale)`;
  - :200 `custodyPeriod` and :220 `custodyShare1` → `localDigits` and `formatPercent`;
  - WHOLE/COMPACT (:27) keep, with the money marker.
  - **Contract with P4:** P3 removes the `COUNT` export, and P4's `dash-shell` stops importing it.
- `CustodyDashboard.tsx` :241-626 (COUNT, LITRES :610, RATE :554).
- `CustodyDashboardCharts.tsx`: :242-245 slices; COUNT at :364, :950, :1183, :1297; :1358.
- `CustodyDashboardFund.tsx`: :97 LATIN (:235, :657, :1145, :1733, :1764, :1767); :787 `list.more`; `ymd` at :504, :690, :812, :939-948, :1368, :1441, :1450, :1768, :1807. LATIN2 (:98) and COMPACT (:1035) are money.
- `CustodyFigures.tsx`: :41 `custodyShare` and siblings → `formatPercent`/`localDigits`; :250.
- `CustodyLedgerFigures.tsx` :34 (:278).
- `CustodyTabs.tsx` :52 (:123).
- `CustodyCarLog.tsx`: :168 options, :176-178, :213 page buttons, :319, :356, :506.
- `CustodyOperationDrawer.tsx`: kit at :125-136 (count and day locale-aware); :236; :405 and :483.
- `CustodyCancelHeldDialog.tsx` :115.
- `CustodyConfirmTransferDialog.tsx` :74, :114, :130, :158.
- `CustodyDeleteOperationDialog.tsx` :181.
- `custody-delete-parts.tsx` :117-118 and `custody-deleted-parts.tsx` :86, :171, :249-250, :267: display through `localDigits`.
- `custody-hold-drawer.tsx` :58-141.
- `custody-hold-parts.tsx` :295-381.
- `custody-memo-parts.tsx`: :131, :321, :344; :169 `String(memo.no)`.
- `CustodyMemoPaperView.tsx:120`, `CustodyReplenishDialog.tsx:210`, `ReceiptMemoChip.tsx:24-38`: `String(no)`, and `memoDay` display.
- `ReceiptDialog.tsx`: :375-378 and :678-684 `String(no)`; :682; :922 `toFixed(2)` → `formatDecimal`.

Lib:
- `custody-words.ts:31` → `formatNumber`.
- `custody-ledger-words.ts` :45 and :108 inline en-US; the kit.
- `custody-memo-editor.ts:324-331` `monthOfDay` → `Intl.DateTimeFormat(locale==='ar'?'ar-EG':'en-GB',{month:'long',year:'numeric',timeZone:'UTC'})`.
- `custody-delete.ts:138` `cairoAt`: the machine parts stay; add a display wrapper.
- `custody-paper-memos.ts`: :143, :240, :355 serials and :357 `dMy` → `ai()` (an Arabic paper; money stays Latin).
- `custody-paper-format.ts`: `ai` may re-export `arabicIndicDigits`. No output change.
- `custody-hold.ts` :113-121: export text frozen (E).
- `license-expense-memo.ts`: :69-70 `carsPhrase`, :80/:83 title date, :111-149 serials and «العدد» → `ai()`. `money()` keeps.
- `license-expense-settlement.ts:48`: add a locale.
- `receipt-memo-lock.ts:53` `memoDay`: add a locale, or wrap at display.
- `custody-paper-letters.ts`: no change (HOLD).

Specs:
- `pages/custody-tabs.spec.tsx` :166-171
- `custody-memos.spec.tsx` :241, :242, :249, :566
- `custody-memo-editor.spec.tsx` :374, :630, :751, :768-769
- `custody-ledger.spec.tsx` :403, :508-509, :659, :877, :884
- `custody-deleted.spec.tsx` :231, :265-359, :293
- `custody-hold.spec.tsx` :349
- `custody-hold-dialogs.spec.tsx` :255
- `custody-dashboard.spec.tsx`: invert :778, plus ≈30 lines (:909-3323)
- `custody-dashboard-fund.spec.tsx` :724-1526
- `custody-fund-dialogs.spec.tsx` :387, :1007, :1019-1021. The B pin at :887 stays while Q-6 is open.
- `custody-papers-setup.spec.tsx`: the B pin at :321 stays; :347 stays.
- `custody-delete-dialog.spec.tsx` :316
- `license-expenses-screen.spec.tsx` :203-206, :329, :356, :376, :977
- `receipts-screen.spec.tsx`: invert :383-386 and :950-951; :520
- `receipts-memo-lock.spec.tsx` :222-223
- `lib/custody-words.spec.ts` :110
- `lib/custody-delete.spec.ts` :224 (stays if the machine `cairoAt` stays; add display tests)
- `lib/custody-paper-memos.spec.ts`: :297 «Latin only» becomes «money Latin, serials and dates Arabic-Indic»; :61-62, :77, :110, :203, :251
- `lib/custody-paper-letters.spec.ts`, `lib/custody-papers.spec.ts` :245, `lib/custody-paper-format.spec.ts`: unchanged (HOLD)
- `components/custody-memo-parts.spec.tsx` :133, :146, :193, :196

### P4 FLEET-DASHBOARD and ROSTER — ≈38 source, ≈20 specs

All paths are under `apps/web/src/modules/fleet/`.

**`components/fleet-dashboard/dash-shell.tsx:639` `count`.**
- Make it locale-aware. Preferred: `count(n)` reads `store.getState().locale.locale`, the view-format precedent. That avoids touching ≈300 call sites.
- Check first that the dashboard specs render against the singleton store. If they build their own store, use `count(n, locale)` and let the compiler list the callers.
- Drop the `COUNT` import (the contract with P3).
- :188/:181 badges; :563 `fresh.n`.

Dashboard components:
- `tab-fuel-chart.tsx` :196, :226 and `tab-custody-history.tsx` :135, :356 → the money formatter (`Amount`, or a Latin `money()` with the marker) **before** `count` changes. These ticks and amounts are money.
- Years from slices → `formatYear`: `dash-blocks.tsx:541-542`, `tab-overview.tsx:1159`, `tab-distribution.tsx:824,1105/1231/1235/1263` (display only; the query keeps the raw year), `tab-summaries.tsx:486,883`, `tab-licences-chart.tsx:183,229,352`.
- `tab-maintenance.tsx`: :110 ONE_DECIMAL → `formatDecimal`; :945 rank.
- `tab-km.tsx:639` rank.
- `tab-violations.tsx:499/561` `share` → `formatPercent`. `data-viol-share` keeps the raw number (:553).
- `period-filter-bar.tsx` :297, :329.
- `dash-blocks.tsx` :550-551.
- `km-chart.tsx`: every `kmText`, `count`, `slashDay`, `axisLabel` user.
- The other tabs (`tab-*-words.tsx`, `tab-accidents`, `tab-licences-*`, `tab-overview*`, `tab-summaries`, `tab-today`, `tab-fuel-*`, `tab-custody-*`, `dash-columns`) are fixed through the helpers. The packages check their `Day` components.

Lib:
- `lib/fleet-dashboard-tabs.ts`: :153-155 `kmText`, `shareText`, `ratioText` and :192 `slashDay` take a locale (or read the store). Delete `cairoTime` (no callers) or make it locale-aware.
- `lib/fleet-dashboard-km-chart.ts:146` `axisLabel` → `localDigits` (:208 labels model).
- `lib/fleet-dashboard-links.ts`: **no change.** URLs stay Latin.

Roster:
- `components/roster/roster-parts.tsx`: :20 `num` → locale-bound; :26 and :264 `Count`; `slashDate` (display) → `formatSlashDay`.
- `FixedDeskBoard.tsx:337`, `RosterDeskBoard.tsx:460`, `roster-desk-parts.tsx:169,388`, `roster-drivers.tsx:127,464,484,548,617`, `roster-touch-parts.tsx:105,260-644`, `RosterTouchBoard.tsx:529`.

Specs:
- `fleet-dashboard-blocks.spec.tsx` :135-270
- `fleet-dashboard-period-filters.spec.tsx` :55-169
- `fleet-dashboard-tab-km.spec.tsx` :358-1091
- `fleet-dashboard-tab-custody.spec.tsx` :547, :866 and 13 more
- `fleet-dashboard-tab-fuel.spec.tsx` :724-1221 (money lines stay)
- `fleet-dashboard-tab-maintenance.spec.tsx` :436-841
- `fleet-dashboard-tab-overview.spec.tsx` :285, :833, :843, :881-882, :972
- `fleet-dashboard-tab-distribution.spec.tsx` :364-659
- `fleet-dashboard-tab-violations.spec.tsx` :723-858
- `fleet-dashboard-tab-accidents.spec.tsx` :572, :770
- `fleet-dashboard-now-tabs.spec.tsx` :151
- `fleet-dashboard-tab-today.spec.tsx` :212
- `lib/fleet-dashboard-km-chart.spec.ts` :282, :320
- `components/roster/roster-shared.spec.tsx`: invert :104, :264, :398, :462, :468
- `roster-optional-props.spec.tsx` :144, :337
- `fleet-fixed-roster-touch.spec.tsx`: invert :526, :580, :647, :665
- `fleet-roster-touch.spec.tsx` :395, :400, :479
- `fleet-daily-roster.spec.tsx` :238, :331-335, :823, :1247, :2133-2192
- `fleet-roster-licence.spec.tsx` :231-448
- The link-census spec must stay green unchanged.

### P5 FLEET fuel, contracts, violations, dealership — ≈42 source, ≈12 specs

All paths are under `apps/web/src/modules/fleet/`.

Pages:
- `pages/FuelCardsPage.tsx`: :344, :353, :363; :369 (`rate` at :187 → `formatDecimal` max 1); :380, :381, :387, :412; print :314 cells. Print `String(card.balance)` → grouped money.
- `pages/FuelChargingPage.tsx` :405, :421, :432; print :356. :90-91 are D (input), no change.
- `pages/FuelReconcilePage.tsx` and `pages/FuelNumberRepairPage.tsx`: through the words helpers.
- `pages/VehicleContractsPage.tsx`: :212, :320-357; :347 `formatPercent`. :421 `contractName` is C.
- `pages/VehicleContractPage.tsx`: :125 and :128 `ymd`; :196, :210; :249 `formatPercent`.
- `pages/VehicleContractEditorPage.tsx`: :152, :276 (`no` stays `latin()`, C), :399, :448.
- `pages/DealershipPage.tsx`: :107 `day()` (:205); tiles :689 and :701; print :393 cells.

Components:
- `components/FuelCardBoard.tsx`: `ymd` stays Latin (values and Excel); add a doc comment pointing to `formatSlashDay`. Display callers :484 and :855 → `formatSlashDay`. :666 and :808 `String` counts.
- `FuelCardDialog.tsx:878` money marker.
- `FuelCardHistoryDialog.tsx`: :48 stamp and `dayOf` → `localDigits` (:269, :452, :597). Money at :98 and :130 gets the marker.
- `FuelCardImage.tsx:403`.
- `FuelTransferDialog.tsx`: :388 and :593 `String(i+1)`; :437 moves.
- Fuel reconcile:
  - `fuel-reconcile/ReconcileHeader.tsx`: :218-268 BoardKpi `String`; :224, :285, :302; stamps :116, :123.
  - `ReconcileTable.tsx`: :386, :508, :529; stamps :92, :251.
  - `ReconcileConfirmDialog.tsx:391`.
  - `ReconcileFolds.tsx` :85, :137 and `reconcile-folds-parts.tsx:213`.
  - `ReconcileNewCards.tsx` :93, :194.
  - `ReconcileUploadCard.tsx`: :49; :231 KB en-US → `formatDecimal`.
  - `reconcile-header-parts.tsx` :145, :252 and `reconcile-confirm-parts.tsx` (stamps).
- Number repair:
  - `number-repair/RepairHeader.tsx` :76, :137, :210-244, :269.
  - `RepairCycleSection.tsx` :83, :444.
  - `RepairPairSection.tsx:239`.
  - `RepairActionBar.tsx` :52, :122.
  - `RepairConfirmDialog.tsx:198`.
  - `NumberRepairEntry.tsx` :43, :47.
  - `repair-parts.tsx` :40-42.
- Vehicle contracts:
  - `VehicleContractViewer.tsx:168`.
  - `vehicle-contract-record-parts.tsx:123` and `vehicle-contract-parts.tsx:285` → `formatPercent`.
  - `VehicleContractFilesSection.tsx:123` and `VehicleContractAttachments.tsx:239`: upload «NN%».
  - `VehicleContractsExport.tsx`: print cells :59-125 → `formatNumber`; Excel :95 frozen.
  - `VehicleContractDeliveryDialog.tsx:203`.
  - `vehicle-contract-columns.tsx` :74, :86.
- Violations:
  - `CompanyViolationsPanel.tsx`: **B** :698 → `formatAmount`; :915 `formatYear`; :567 and :768 option **labels** `formatYear` (values stay raw); :448 and :976 → `formatYear`; print :306-312.
  - `CompanyViolationsDetailLayer.tsx:233` and `ViolationDialogs.tsx:520`: years.
  - `DriverViolationsPanel.tsx`: :212/:215 and :461 → `formatSlashDay`; :326, :1118, :1123, :1234 `String` counts; :571/:575 `filedYear`; :1192 year chip; :782 print date. The xlsx at :716 stays.
- `DealershipInvoiceDialog.tsx:393` MB.

Lib:
- `lib/fuel-reconcile.ts:76` `stampOf`, `timeOf`, `dayText`: keep them Latin as machine values and add `…For(locale)` display wrappers. Money at :32 gets the marker.
- `lib/fuel-reconcile-words.ts`: :35; params at :91 and :187.
- `lib/fuel-number-repair-words.ts:20`.
- `lib/vehicle-contract-words.ts`: :23-24 `latin` → `formatNumber` for count, unit, days, deadline, leftHead, deliveryName, fileSize. `contractName`'s `no` keeps `latin` (C). File-size units come from i18n.
- `lib/driver-violation-entry.ts:69` ordinal.
- `lib/vehicle-set-params.ts:130` display → `formatSlashDay`. The URL at :117 stays.

Specs:
- `pages/fuel-card-log-sheet.spec.tsx` :340, :342
- `pages/fuel-number-repair.spec.tsx` :217-487
- `pages/fuel-reconcile-links.spec.tsx` :252
- `pages/fuel-reconcile-screen.spec.tsx` :309-957
- `pages/vehicle-contracts-screen.spec.tsx` :267-545
- `lib/vehicle-contract-words.spec.ts` :23
- `lib/fuel-reconcile-words.spec.ts` :56
- `lib/fuel-reconcile.spec.ts` :166, :350 (stays if the machine stamp is kept; add wrapper tests)
- `fleet-violations-split.spec.tsx` :1197-1491 (keep :1398)
- `fleet-violations-period.spec.tsx` :225

### P6 HR (all of `apps/web/src/modules/hr/**`) — ≈70 source, ≈8 specs re-pointed, 1 new

Attendance:
- `attendance/views/view-format.ts`: `clock`, `timeSpan`, `hourTick` (:11-28), `duration`, `shortDuration` (:36, :43), `num` (:46), `dayLabel` (:49, nu-latn) → ar-EG digits for `lang()==='ar'`. English byte-identical. Rewrite the header at :2-3.
- `attendance/views/view-charts.tsx`: :71, :176, :178; :183 and :215 → `formatPercent`; :214; :256 and :309 nu-latn → `'ar-EG'`; :280 day number; :511 «8س».
- `attendance/views/EmployeeAttendanceView.tsx`: :100, :101 (percent), :105.
- `attendance/pages/DailySheetPage.tsx:263` → `'ar-EG'`.
- `attendance/pages/DeviceHealthPage.tsx`: :170; :247 → `formatDate`; :251; :253 percent.
- `attendance/pages/ShiftsPage.tsx`: :47-48 HH:mm → `localDigits`; :55.
- `attendance/components/DecisionSignals.tsx` :31, :45, :50.
- `attendance/components/DayDecisionDialog.tsx`: :102 → `formatDate`. Keep :38 with the `// latin-digits: parse` marker.
- `view-model.ts:23` and `period.ts:23`: markers only.

Leave:
- `leave-management/components/BalanceCards.tsx`: :25 `formatYear`; :28; :32-34.
- `RequestLeaveDialog.tsx` :106, :111, :116.
- `RequestsTable.tsx:54`.
- `pages/LeaveRequestDetailPage.tsx` :142, :183.
- `HolidaysPage.tsx:68` `formatYear`.
- `TeamCalendarPage.tsx`: :58 explicit ar-EG/en-GB (today it follows the browser locale); :96, :109.

Loans and payroll:
- `employee-loans/components/EmployeeLoansTab.tsx`: :200, :278; :201 and :282 `formatPeriod`; :286 `formatDate`.
- `EmployeeLoansAdminPage.tsx:199`.
- `MyLoansPage.tsx:168` `formatPeriod`.
- `payroll/pages/PayrollRunsPage.tsx`: :81, :281, :424, :472, :530, :575, :631 `formatPeriod`.
- `PayrollReportsPage.tsx`: :266; **B** :308.
- `components/RunCostReport.tsx`: **B** :114.
- `MyAdjustmentsPage.tsx:48`; `MyPayslipsPage.tsx` :44, :109, :120; `PayrollAdjustmentsPage.tsx:151`; `EmployeeAdjustmentsTab.tsx:88`; `EmployeePayslipsTab.tsx` :54, :116.
- `CompensationCard.tsx`: :91 and :124 → `formatPercent`; :101, :119, :137, :222, :270-272.
- `settlement/components/EmployeeSettlementTab.tsx` :60 (`formatYear`), :61.
- `SettlementQueueTable.tsx:58` `formatPeriod`. The settlement-tab spec forbids `formatMoney` in this file.

Other HR areas:
- `training/components/CompleteSessionDialog.tsx` :61, :81; `pages/TrainingCoursesPage.tsx:189`; `pages/TrainingSessionsPage.tsx:281`.
- `medical/pages/InsuranceCardsPage.tsx:105`.
- Performance: `AssessmentDialog.tsx` :147, :158; `GoalsDialog.tsx:167`; `MyPerformancePage.tsx:53`; `PerformanceCyclesPage.tsx` :71-73, :221, :228; `PerformanceReviewsPage.tsx:263`.
- `announcements/pages/ComposeAnnouncementPage.tsx:90`.
- `notification-rules/components/RuleEditor.tsx:511` and `pages/NotificationRulesPage.tsx` :144, :151.
- `contracts/pages/TemplatesListPage.tsx:223`, `TemplateEditorPage.tsx` :226, :492, `ContractDetailPage.tsx` :456, :603, :606: versions «v٣» per Q-1 (recommended: A). `RichTextSection.tsx:162` «H1» is left alone.

Employees:
- `employee-management/employees/components/RosterImportDialog.tsx` :49/:65, :209, :380 (`formatDate`), :481.
- `EmployeeCostCenterCard.tsx:74`, `pages/MyProfilePage.tsx:95` (`formatDate`), `components/ActionHistory.tsx:46`.
- `id-card/IdCardStatusButton.tsx:96` and `id-card/EmployeeIdCardTab.tsx:100`.
- `EmployeeInsuranceCard.tsx:125-137` → `formatAmount` (money form).
- `actions/ExitRehireDialogs.tsx:122`.
- `employee-files/components/LinkedHistory.tsx:43`.
- The employee profile timeline renders P9's structured `leave` field in **Arabic only**. English keeps `item.detail` exactly as it is.

Recruitment:
- `recruitment/applicant-documents/components/folder-file-bits.tsx:96` and `recruitment-form/components/CvUploadRow.tsx` :22, :94: one size helper, with units from i18n.
- `DeleteFoldersDialog.tsx:124`.
- `applicants/components/ReturnToStageDialog.tsx:133`: fix the `.replace('{n}')` bug, then `t(key,{n})`.
- Evaluation and interview queues: `EvaluationBatchesPage.tsx:119`, `OpenEvaluationDialog.tsx:105`, `EvaluationDetailPage.tsx:241`, `EvaluationQueuePage.tsx:112`, `EvaluationPhaseQueuePage.tsx:148`, `EvaluationPhasesPage.tsx:162`, `InterviewStagesPage.tsx:148`, `BulkScheduleDialog.tsx:76`, `InterviewStageQueuePage.tsx:210`, `PhaseBoard.tsx:242`, `QuickDecide.tsx:66`, `InterviewDetailPage.tsx:302`, `PanelList.tsx:45`, `InterviewEvaluationPanel.tsx` :165, :176.
- `InterviewRoom.tsx`: :60 timer, :138, :210, **B** :265, :285, :317, :352 `formatYear`, :501.
- `CandidateBrief.tsx`: **B** :373.
- `JobRequisitionsListPage.tsx:164`, `JobRequisitionDetailPage.tsx:217`, `ApplyLayout.tsx:280`, `ApplicantDocumentReview.tsx:86`, `ApplicantDocumentsQueuePage.tsx:158`, `ApplicantPortalLoginPage.tsx:276`, `shared/StageBuckets.tsx:44`, `timeline/components/RecruitmentTimelineList.tsx:84`.

Constraints:
- `attendance-routes.spec.ts:110` forbids `formatMoney`, `rate` and similar words in attendance files. Name things accordingly (no `rate`).
- `settlement-tab.spec.ts:190` forbids `formatMoney` in SettlementQueueTable.

Specs:
- `attendance/attendance-screens.spec.tsx` :334 → «٩:٢٠ ص ← ٥:٠٠ م». The English pins at :260-262, :324, :332, :536, :645-647 stay.
- `employee-sensitive-blocks.spec.tsx` :85 → «194,200».
- `id-card/card-receipt.spec.ts` stays as it is.
- `RecruitmentTimelineList.spec.tsx`, `view-model.spec.ts`, `export-name.spec.ts`: English and machine pins, they stay.
- New: `attendance/views/view-format.spec.ts`.

### P7 OPERATIONS and ATM (`apps/web/src/modules/operations/**`, `apps/web/src/modules/atm/**`) — ≈80 source, ≈50 specs

**Operations**

Counts and days:
- `components/SecuredDistributionParts.tsx`:
  - :144 `countText` → `formatNumber` (rewrite the comment at :139-143);
  - :2628 `dayText(iso, locale)`: Arabic «٢٠٢٦/١١/١٤» inside `ltrIsolate`, using `/` and not `-` (§4 bidi); English unchanged;
  - :1467/:1475 van time → `localDigits`.
- `pages/SecuredDistributionPage.tsx` and `pages/VaultHandoverPage.tsx`: callers. :197-212 `vanLoadSheet` gets `count: formatNumber`.

Stamps and the shipment log:
- `lib/shipment-log.ts`:
  - :146 `cairoStamp` and `cairoStampText` (the machine parts stay; add display variants);
  - :193 `shipmentCaption(…, locale)`;
  - :130 `logValue`: field-aware `localDigits` for `collectionDate`, `deliveryDate`, `bagCount`, `cartonCount`, `boxCount`, `bagSealsPerBag`, `sequence`, and the count half of the denomination lines. Money, codes and seals are never touched. **This replaces any API change.**
- `lib/vault-queue.ts:104`.
- Callers: `ShipmentBadges.tsx` :310, :332; `ShipmentLogDialog.tsx` :162, :208-209, :253, :262, :300; `DeletedShipments.tsx` :111, :166, :168, :171, :409, :450, :455; `VaultHeldReportDialog.tsx` :110, :137, :190, :237; `CancelVaultReceiptDialog.tsx:142`; `DispatchSecuredDialog.tsx:209`; `pages/SecuredDispatchPage.tsx:194`.

Reports and prints:
- `components/ReportBoard.tsx:310` `figure`: per-column kind. Serial (:320) and counts (:370, :424, :431, :438) → `formatNumber`; money columns stay `formatAmount`.
- `ReportModal.tsx:303` `TileBody`: tile kind.
- `lib/report-export.ts`: :139 subtitle; :182 `printed` uses the column kind. Excel at :170-186/:277 is frozen.
- `lib/van-load-sheet.ts` :73, :89, :92.
- `lib/vault-receipt-print.ts`: :87; :117-118. Plus `components/ReceiveIntoVaultDialog.tsx`: :779-780, **the two receipt dates (owner Q1)**; :805 `count: formatNumber`; :361, :382, :1144.
- `lib/vault-receipt.ts:458`.

Dashboards and boards:
- `components/BoardFigures.tsx:137` PERCENT → `formatPercent`.
- `components/BankBranchDashboard.tsx` :97, :176, :209, :213, :300, :324.
- `SecuredDispatchDashboard.tsx` :124, :157, :302, :371, :441/:560-561, :495, :520, :570, :633, :679, :756.
- `lib/secured-dispatch-dashboard.ts` :435, :444: print only.
- `BoardCrewCards.tsx:289`.
- `CrewPlanControls.tsx` :907, :932: button **labels** only; the value passed to `set()` stays Latin.
- `ShipmentDraftFields.tsx` :666, :681, :712.
- `ShipmentReceiptImageCell.tsx:151`.
- `ShipmentsBoard.tsx` :902, :904, :907, :921.

Branch import, catalogues, crew:
- `branch-import/BranchImportConfirmDialog.tsx:21`, `BranchImportResult.tsx:63`, `BranchImportTable.tsx:290`, `BranchImportUpload.tsx` :41, :159.
- `pages/CatalogsPage.tsx:280`.
- `CrewDepartmentsCard.tsx:365`.
- `CrewBoardPage.tsx:933` and the mobile pages are covered by the central change.
- `AssignDeliveryCrewDialog.tsx` and `CrewPools.tsx` are not mounted. Leave them.

**ATM**

Dates and papers:
- `lib/settlement-dates.ts`:
  - :36 `formatPaperDate(day, locale='ar')`;
  - :53 `formatPaperTimestamp`: map the digits after formatting (`Number(pick('hour'))` stays on Latin parts);
  - :64 `formatTime12`; :78 `runCompact`.
  - This answers owner Q1: the Note's B9 replenishment date and the G72 print stamp.
- `lib/papers/settlement-print.ts:73` `int`: money only; add a count formatter.
- `lib/papers/note-print.ts`:
  - :96 `plainNumber`: split. Slots and bags (:191, :195, :278) → Arabic-Indic. Denominations (:192, :244, :279) stay Latin. The serial at :146 is C, pending Q-1.
  - :110-111 → «١»/«٢»; :167; :193; :302; :100.
- `lib/papers/receipt-print.ts` :65, :73, :82.
- `lib/papers/handover-print.ts` :53 (bag numbers only), :71, :129, :134, :148-149.

Durations and boards:
- `lib/operation-view.ts`: :31 `formatElapsed(…, locale)` and :59 `formatDuration(…, locale)`. Units per Q-10.
- `lib/operation-sheet.ts:104/417`: the display column uses the locale form; the Excel cell keeps today's Latin text.
- `components/LiveTimer.tsx:36`.

Register and Data Report (D7):
- `lib/register-labels.ts`: :51 `formatRegisterDate(iso, locale)`; :64 `formatAsOf` → `'ar-EG'`; comment :57-63.
- `lib/register-report-view.ts:60` `reportCount(value, locale)` (ungrouped, 0 written).
- `register-report/BarChart.tsx` :184, :254, :283; `GroupedBarChart.tsx` :76, :121; `ReportTable.tsx:87`; `ReportSection.tsx` :113, :119; `AsOfStamp.tsx:20`.
- `register/RegisterGrid.tsx` :371, :373.

Other ATM sites:
- `components/PasteStopNotice.tsx` :14, :30: defaults → `formatNumber`.
- `pages/DailyReportPage.tsx`: :44/:46 `bankCountsText(…, locale)` (cell and filter list together); :95, :104.
- `components/MachineSyncDialog.tsx:155`; `register-import/ImportCategoryCard.tsx:178`; `ImportIssuesList.tsx:63`; `ImportPreviewPanel.tsx:146`.
- **Money params → `String(d)`:** `pages/SettlementPlanPage.tsx:724`; `settlements/PlanLinePanel.tsx` :290, :294; `StandardLoadsDialog.tsx` :156, :190; `CapturePanel.tsx:208`; `ControlDataTab.tsx:387`; `LayoutEditor.tsx:80` (`before`, `after`).
- `StatementExportButtons.tsx:77`: pass `locale` to the Fleet report.
- `MachineMapPage.tsx:684` default zone name: no change (D).

Ops specs:
- `lib/shipment-log.spec.ts`: :178-193 machine stamps stay; add display tests; :217-248 caption
- `lib/vault-queue.spec.ts` :210-224
- `lib/report-export.spec.ts` :219-230, :282, :301
- `lib/van-load-sheet.spec.ts` :71, :93, :99, :104
- `lib/vault-receipt-print.spec.ts` :51, :93-94, :103, :113, :116
- `lib/vault-receipt.spec.ts` :749, :755
- `components/distribution-round26.spec.tsx` :283-313: **rewrite** (it counts `formatNumber(` and forbids Arabic-Indic)
- `distribution-van-card.spec.tsx` :161, :205, :287, :633-659
- `DeletedShipments.spec.tsx` :238-245
- `ShipmentLogDialog.spec.tsx` :152-158
- `BoardFigures.spec.tsx` :130
- `ShipmentReceiptImageCell.spec.tsx` :231
- `branch-import.spec.tsx` :444, :542
- `pages/secured-dispatch-dashboard.spec.tsx` :413-684
- `vault-history.spec.tsx` :428-754
- `bank-dashboard.spec.tsx` :284-365
- `report-screens.spec.tsx` :321-380
- `secured-dispatch.spec.tsx` :321
- `secured-distribution.spec.tsx` :465-1668
- `vault-receive.spec.tsx` :969-1201
- `crew-departments-page.spec.tsx` :173
- `secured-screen.spec.tsx` :345

ATM specs:
- `lib/settlement-dates.spec.ts` :40-62 (English lines stay)
- `lib/operation-view.spec.ts` :68, :74
- `steady-tables.spec.tsx` :144
- `atm-register-i18n.spec.ts` :385; invert :395-398
- `register-page.spec.tsx` :467
- `lib/register-report-view.spec.ts` :179
- `register-report-page.spec.tsx` :189-423
- `daily-report-page.spec.tsx` :234-287
- `lib/papers/note-print.spec.ts` :115-236 (money :145 stays)
- `receipt-print.spec.ts` :42-63
- `handover-print.spec.ts` :57-171
- `lib/settlement-view.spec.ts` :99-250
- `atm-settlements-i18n.spec.ts` :139-146
- `open-stop-notice.spec.tsx`
- `paste-batches.spec.tsx` :418-469
- `no-double-open.spec.tsx` :221-246
- `data-edit-catalog.spec.tsx` :910-941
- `machine-sync.spec.tsx` :289
- `preparation-page.spec.tsx` :209-274
- `cassette-layouts-page.spec.tsx` :264, :418-419, :511
- `board-filters.spec.tsx` :407-434 (MultiSelect badge)
- `board-day-view.spec.tsx` :549 (sort badge)
- `map-page.spec.tsx` and `zone-editor.spec.ts` stay unchanged

### P8 GOLD, IT, ORGANIZATION, SYSTEM-ADMIN — ≈65 source, ≈15 specs, 1 new

**Gold**
- `gold/lib/gold-format.ts`: :10 `fmtNumber`, :13 `fmtWeightValue`, :16 `fmtDecimal2`, :19 `fmtKilos`, :25 `fmtDate`, :34 `fmtDateTime` gain a locale. Arabic is Arabic-Indic. **The English branch returns exactly today's string**, Arabic month names included. ≈130 callers. Weights follow Q-7; build as Arabic-Indic, isolated in this one file so a flip is one line.
- `gold/lib/gold-print.ts`: :36 `stamp`; cells :118, :185, :191; drawer audit :253-254, :275, :281, :309, :317; fund closing :355-356, :367, :368, :371 → `arabicIndicDigits` (Arabic paper).
- `pages/GoldDashboardPage.tsx`: :40 compact ticks (Arabic `Intl ar-EG compact`); :136 pie «٪»; :282, :284, :296-311, :369, :412, :438; :459 tooltip.
- `GoldReceivingPage.tsx` :109, :128, :132, :137; `GoldDeliveryPage.tsx` :106, :125, :129, :134; `GoldTransfersPage.tsx` :101, :130, :134; `GoldBarsPage.tsx` :78, :243, :252.
- `GoldKeysPage.tsx` :103, :142, :152, :182, :184, :252-262, :348, :352, :476.
- `GoldReportsPage.tsx`: :122-189, :322 (`formatYear`), :333-342, :395-407, :448 (`formatYear`), :455-476, :528-556, :595, :651-667.
- `GoldVaultsBoardPage.tsx` :89, :91, :136, :186, :203, :224, :228, :234-262, :290; `GoldVaultSettingsPage.tsx` :291, :296, :666, :737, :747, :764.
- `GoldRepresentativesPage.tsx:109`, `GoldCompaniesPage.tsx:122`, `GoldPortalAccountsPage.tsx:137`.
- `components/DrawerCell.tsx` :89, :107, :110-122, :142.
- `ReceivingEditorDialog.tsx`: :180, :263-285, :453-454, :575-602 (print weights from the typed drafts → formatted), :872, :937. The CSV match at :427 stays Latin.
- `DeliveryEditorDialog.tsx` :148 (raw date → `formatDate`), :157-171, :204, :206, :369.
- `TransferEditorDialog.tsx` :166, :183-197, :230-232, :461.
- `BarPicker.tsx` :120, :169, :181.
- Portal: `portal/pages/PortalReportsPage.tsx` :38, :75-101, :87 (`formatYear`), :196, :202-226; `PortalReceiptsPage`, `PortalTransfersPage`, `PortalDrawersPage`, `PortalOverviewPage`, `PortalBarsPage`, `PortalKeysPage`, `PortalList.tsx:88`.
- Server-built drawer labels «V-001» are C. Map the digits of the drawer number at display only (`PortalBarsPage.tsx:48`, `PortalKeysPage.tsx:17`, `PortalDrawersPage.tsx:17`, `GoldKeysPage.tsx:348`).

**IT**
- `it/mobile/VehicleCheckPage.tsx:537`; `VehicleCheckSent.tsx:132` (`dayShown`); `VehicleCheckPhotos.tsx:78`.
- `lib/vehicle-check-form.ts:312` `dayShown(…, locale)`; `lib/vehicle-check-photos.ts:71` `photoMegabytes(…, locale)`.
- `lib/custody-receipt-print.ts:479` → «١/٢».
- `components/AssetImportPreview.tsx` :194, :202; `AssetImportResult.tsx:38`; `CustodyDialogs.tsx` :430, :471.
- `SparePartPicker.tsx` :63, :111 (drop `font-mono` on the figure); `SparePartDialogs.tsx:229`; `SoftwareDialogs.tsx:250`; `TicketAttachments.tsx` :36/:139.
- `pages/LicensesPage.tsx:110`, `ItEmployeesPage.tsx:147`, `ItEmployeeHistoryPage.tsx:429`.
- `TicketDetailPage.tsx` :162-165, :302 and `HelpDeskSettingsPage.tsx` :89-92, :99: one shared hours/minutes helper.
- `MaintenancePlansPage.tsx:121`, `ItCatalogsPage.tsx:105`, `VendorsPage.tsx:113`.

**Organization**
- `organization/org-chart/pages/OrgChartPage.tsx` :182-185 (print labels), :295-296.
- `components/DepartmentTiles.tsx` :92, :95; `ChartBoard.tsx:501`.
- `application-categories/pages/ApplicationCategoriesListPage.tsx:108`, `ApplicationCategoryDetailPage.tsx:143`.
- `applications/pages/ApplicationsListPage.tsx:124`, `ApplicationDetailPage.tsx:161`.

**System admin**
- `system-admin/active-users/pages/ActiveUsersPage.tsx`: :56 → `'ar-EG'`; :122 `duration`; :135, :147.
- `audit/pages/AuditLogPage.tsx:97`. `AuditDetailPanel.tsx:100` and `users/components/UserActivityTab.tsx:106` stay raw (the forensic diff, C).
- `settings/pages/SettingsPage.tsx` :59, :155, :168.
- `settings/components/SettingRow.tsx:138`: numeric default values only, **never the `fleet.fuel.price.*` money settings**.
- `notification-templates/pages/TemplatesListPage.tsx:120` and `TemplateDetailPage.tsx:160`: use the existing unused key `systemAdmin.templates.versionLabel`.
- `approvals/pages/ApprovalWorkflowsPage.tsx:310`.

Specs:
- `system-admin/active-users/active-users-page.spec.tsx` :141-252
- `organization/org-chart/components/chart-board.spec.tsx` :285-286
- `org-chart/lib/chart-print.spec.ts` :94-95 (fixture labels)
- `it/lib/asset-import.spec.ts` :124, :523-578
- `it/pages/assets-import-screen.spec.tsx` :456
- `it/mobile/vehicle-check-page.spec.tsx` :35-36, :149, :171, :272-273, :385-387, :457-493
- `it/lib/vehicle-check-dashboard.spec.ts` :419 (after the catalogue change)
- `it/lib/vehicle-check-form.spec.ts` :175
- `it/lib/vehicle-check-photos.spec.ts` :122-126
- `it/lib/custody-receipt-print.spec.ts` :320-321
- English pins stay: `SettingsPage.spec.tsx` :473…, `RolePermissionMatrix.spec.tsx` :164…, `UsersListPage.spec.tsx` :171
- New: `gold/lib/gold-format.spec.ts` (English byte-identical, Arabic Arabic-Indic)

### P9 API (`apps/api/src/**`, plus `packages/contracts/src/modules/hr-employee.ts` only) — ≈10 source, ≈8 specs

**Notifications.** `apps/api/src/platform/notifications/notification.rendering.ts:44-60` `renderBilingual`: the Arabic side renders from a copy of `data`.
- Figure variables are mapped with `arabicIndicDigits`: `round`, `days`, `year`, `minutes`, `installmentCount`, `count`, `windowMinutes`.
- Calendar variables (`endDate`, `startDate`, `workDate`, `disbursedAt`, `period`, `firstPeriod`) become «٢٠٢٦/١١/٢٢».
- Instant variables (`when`, `expiresAt`) become a Cairo «yyyy/mm/dd hh:mm» in Arabic-Indic.
- The English side keeps the raw data, byte-identical.
- Identifier variables (`employeeCode`, `applicantCode`, `code`, `typeCode`, `username`, `setupLink`) are never on the list.
- This covers the bell, inbox, e-mail and push, and `credentials-delivery.ts:90`.

**Notification rules.** `apps/api/src/modules/hr/notification-rules/rule-bridge.ts:101-106`: the Arabic values are mapped from the event catalogue's number and date field types. Fields named `amount`, `salary`, `price`, `cost`, `balance` or `fine` are excluded. `rule-matching.ts` is unchanged.

**Other server text:**
- `apps/api/src/platform/auth/auth.service.ts:173`: «صالح لمدة ١٠ دقائق». The code itself stays Latin (C).
- `apps/api/src/modules/hr/recruitment/evaluation-batches/evaluation-batch-package.ts`: serials :114, :181, :243; issued dates :123, :189, :253 (Cairo d/m/yyyy); counts :149, :207, :265. `manifest.csv` (:52) is frozen (E).
- `apps/api/src/modules/gold/vaults/vault.service.ts` :264, :270.
- `apps/api/src/modules/hr/employee-management/employees/employee.service.ts:1792`: add a structured `leave: { from, to, days }` beside `detail`, which is unchanged. `packages/contracts/src/modules/hr-employee.ts:1015` `EmployeeTimelineItemDto` gains it as optional. P6 consumes it.

**HOLD, no change unless the owner answers Q-8 or Q-6:**
- `hr/contracts/contracts/contract-render.ts` :128 (`counter(page, arabic-indic)`), :170/:387 (map date, year and day keys at render time; the stored values stay Latin, so the papers form and the SHA-256 hash are safe), :372/:392 (Form 1 wages);
- `hiring-templates/hiring-papers.ts` :76, :103, :169, :266, :298-304;
- `shared/variable-catalog.ts` :16-57, :39-40.

**No change:**
- go-live notes (stored text; the «no data change» rule);
- `atm/branch-links/branch-move.planner.ts:84` (stored names);
- `fleet/go-live/vocabulary-names.ts` and `contracts egypt-geography.ts` (stored or matched names);
- the CSV exports (E);
- `operations/shipments/shipment-log.ts` (fixed on the web, P7).

Specs:
- `platform/notifications/notification.rendering.spec.ts`: add Arabic figure cases; the English assertions at :37 and :60 stay.
- A new rule-bridge Arabic test. `rule-matching.spec.ts:98` stays.
- `evaluation-batch-package.spec.ts` :184 → «العدد: ١». The manifest at :65-66 stays.
- The vault service spec: the two messages.
- The auth portal-challenge message spec.
- The employee timeline spec: the new field.
- `tests/integration/hr-attendance.spec.ts:2792` stays unchanged (raw `data`).

### P10 HUB (last; shared i18n, CHANGELOG, design docs only)

`apps/web/src/platform/localization/i18n.ts`:
1. Wire `translate`: `String(value)` → `figureParam(value, locale)`, and fix the fallback `{{${name}}}`. Do this only after P2–P8 have converted the money, identifier and year params.
2. Merge `.wip-notes/digits/i18n/*.json`.
3. Rewrite Arabic catalogue literals, located by key; the line numbers are as of today:
   - Fleet: 22678, 22680 («خلال ٦٠ يومًا»), 20436-20487, 21447, 23143, 23173, 23182, 23306-23307, 16483, 23819.
   - HR: 17125, 17050, 17097, 17220, 17242-17259, 17297, 17385, 17398, 17658, 18947-18951 (Q-11), 18987-18988, 20076, 16184.
   - Operations: 27608, 27610, 28190-28191, 28375-28376, 28733-28734.
   - ATM: 30169-30185 («كاسيت ١»…), 30314, 30573, 30590-30591, 30624, 30794, 30838, 30898, 30935, 30946, 31263.
   - IT: 25930, 25937, 25982-25983, 26013, 26039-26040, 26051, 20502-20504, 22090-22095.
   - Admin: 26416, 27185-27344.
   - Keep in Latin (C, money, codes; pinned by key in the guard): fuel grades «بنزين 80/92/95», «HP 85A», «A4», «v1», «ADR-015», «0849», phone prefixes «010…», the code samples «01-00001», «0100004», «0102818», «123/456», «8-4-4-4-12», «(0–9)» (the password regex is ASCII), «1,000,000,000» (21727, 21729), denominations 30951/30953 and the cassette heads 30177-30179 (DEC-22), the coordinates sample 30671.
4. Remove dead keys: the flat `fleet.vehicle.count.{odometer,maintenance,accidents,violations}`.

Specs:
- `platform/localization/placeholders.spec.ts:26` → `` `${formatNumber(1671,'ar')} موظف` `` (:27 English stays).
- New `platform/localization/catalog-digits.spec.ts`: no `[0-9]` in an Arabic value outside the keep-list, which is pinned by key.

Docs:
- `CHANGELOG.md`.
- `docs/04-standards/coding-standards.md`: a new «Figures and digits» section covering the rule, the helpers and the guard markers.
- `docs/12-planning/atm-efficiency-register.md:1630-1635`: `formatAsOf`/`reportCount` are Arabic-Indic in Arabic; D7's ungrouped figures and visible 0 are kept.
- `docs/12-planning/atm-settlements-phase1.md` DS-18 (:172): papers print counts and dates in Arabic-Indic and money `#,##0` in Latin, plus a dated amendment line.

Activities (no files): the full gate, sequential, one vitest at a time; the dark pictures (§6); the PR body.

---

## 3. The two Fleet items

### 3(a) «المخالفات» counts exactly what its link opens

**Today.** `useHistoryCounts` (VehicleDetailPage.tsx:342, :355) calls `useViolations({ vehicleId, page:1, pageSize:1 })`, which is `GET /fleet/violations?vehicleId=…`. The deprecated `vehicleId` adds the clause `{vehicleId}` (violation.repository.ts:244-246). That means:
- old-book rows with `vehicleId: null` and `vehicleCode` equal to the car's code are **missed**;
- `meta.totalItems` counts **documents**, so a company statement row «5 × 100» counts as 1.

**What the link opens.** `/fleet/violations?codes=<code>&dcodes=<code>`.
- The URL carries a query string, so remembered filters are not restored (`chooseInitialView`, useRememberedFilters.ts:77-81). No year applies to either half.
- The company half is `GET /fleet/violations/rollup?vehicleCodes=<code>` (CompanyViolationsPanel.tsx:195). Its rows carry `totalCount = vehicleCount (Σ statement count) + driverCount (driver events)` (violation.repository.ts:318-319, :667-676).
- The drivers' half lists the same driver fines one by one (`kind:'driver'`, `vehicleCodes`; DriverViolationsPanel.tsx:336-347).
- Both resolve the code through `carsOf` and `byVehicleOrBookCode` (violation.service.ts:368-386; odometer.repository.ts:87-95). That includes old-book rows with `vehicleId: null` and a matching `vehicleCode`. Carried fines move with their `vehicleId` in both halves.

**The query to use (no API change):**
```ts
const violations = useViolationRollup(undefined, [vehicleCode], can('fleetViolation.view') && vehicleCode !== '');
// count = Σ row.totalCount over every row (every year; old-book rows with vehicleId null included)
...(violations.data === undefined ? {} : { violations: violations.data.reduce((s, r) => s + r.totalCount, 0) }),
```
- This is `GET /fleet/violations/rollup?vehicleCodes=<code>`. It has the same permission as the list (violation.routes.ts:44-50) and the same query key the company board uses when the link opens it.
- Remove the now-unused `one` constant.
- I rejected `GET /fleet/violations?vehicleCodes=<code>&page=1&pageSize=1`. It accepts `vehicleCodes` and spans both halves, but it counts documents, which disagrees with the board's «عدد» columns. The list schema has no `codes` or `dcodes`; those are page URL params, and the strict schema would answer 400.

**Specs (P2, `fleet-vehicle-history-links.spec.tsx`):**
- A source-scan test like the accidents one at :374-382: the hook calls `useViolationRollup(undefined, [vehicleCode], …)` and never `useViolations(one`.
- A render test: a mocked rollup `[{totalCount:3, vehicleId:'…'}, {totalCount:2, vehicleId:null, code:'200'}]` gives «٥ مخالفات».
- The test at :173 («both halves») stays.

### 3(b) Arabic number agreement on the record counts

**Convention.** Use `pluralKey('fleet.vehicle.count.<row>', locale, n)` from `shared/lib/plural.ts`, with `{ count: formatNumber(n, locale) }`. That is the five-form catalogue already used by `fleet.custody.count.*`. The «many» form drops the tanween on taa marbuta («{{count}} عملية») and writes it on the masculine («إيصالًا»). Zero reads as `few`.

**Change.** VehicleDetailPage.tsx:459:
`return { tag: t(pluralKey(`fleet.vehicle.count.${key}`, locale, n), { count: formatNumber(n, locale) }) };`
- Accidents at 0 keeps «سجل نظيف» (`accidentsClean`, :451-457).
- The fifth row, «تعيين السيارات», shows «سائق نشط» with no number.
- Maintenance keeps today's noun «عملية». The owner asked for agreement, not new wording. «زيارة», the maintenance screen's own word, is an option for him to choose.

**Arabic keys (P2 fragment):**

| Row | `.one` | `.two` | `.few` | `.many` | `.other` |
|---|---|---|---|---|---|
| odometer «قراءة» | قراءة واحدة | قراءتان | {{count}} قراءات | {{count}} قراءة | {{count}} قراءة |
| maintenance «عملية» | عملية واحدة | عمليتان | {{count}} عمليات | {{count}} عملية | {{count}} عملية |
| accidents «حادث» | حادث واحد | حادثان | {{count}} حوادث | {{count}} حادثًا | {{count}} حادث |
| violations «مخالفة» | مخالفة واحدة | مخالفتان | {{count}} مخالفات | {{count}} مخالفة | {{count}} مخالفة |

**Rendered:**

| n | قراءة | عملية | حادث | مخالفة |
|---|---|---|---|---|
| 0 | ٠ قراءات | ٠ عمليات | سجل نظيف | ٠ مخالفات |
| 1 | قراءة واحدة | عملية واحدة | حادث واحد | مخالفة واحدة |
| 2 | قراءتان | عمليتان | حادثان | مخالفتان |
| 3–10 | ٣ قراءات … ١٠ قراءات | ٣ عمليات | ٣ حوادث | ٣ مخالفات |
| 11–99 | ١١ قراءة … ٩٩ قراءة | ١٤ عملية | ١١ حادثًا | ١١ مخالفة |
| 100+ | ١٠٠ / ١٠١ / ١٠٢ قراءة; ١٠٣–١١٠ قراءات; ١١١–١٩٩ قراءة; ٢٠٠ قراءة; ١٬٢٣٤ قراءة | same pattern: ١٠٣ عمليات, ١١١ عملية | ١٠٠ حادث, ١٠٣ حوادث, ١١١ حادثًا | ١٠٠ مخالفة, ١٠٣ مخالفات, ١١١ مخالفة |

For n of 100 and above, the form follows n mod 100. This is CLDR and formal Arabic alike: «مئة وثلاث قراءات», «مئة وإحدى عشرة قراءة». The «١٬٢٣٤» spelling follows Q-2.

**English keys.** All five forms are today's text exactly: '{{count}} readings', '{{count}} operations', '{{count}} accidents', '{{count}} violations'. English stays byte-identical, including today's «1 readings»; fixing that is optional later. Remove the four flat keys.

**Specs.** `fleet-vehicle-history-links.spec.tsx`: cover n = 0, 1, 2, 3, 11, 100, 103 for each row. Rewrite :264, :283-285 and :308-310 to compute through `pluralKey` and `formatNumber`.

---

## 4. Risks and how each is handled

1. **Font and alignment (verified).**
   - Problem: Azeret Mono has no Arabic-Indic glyphs. Cairo's are proportional (250–678) with no `tnum`, so columns of counts and dates will not align, and `tabular-nums` does nothing. Figures change from a mono face to a proportional one, beside Latin money in Azeret. The owner's «plain zero» request no longer applies: «٠» is a dot, worst at 10–11 px badges.
   - Handling: load Cairo arabic globally (P1) so every screen uses one face. Run the P1 spike for a tabular face. Show the densest tables in the pictures (§6 #6, #12, #13). The owner decides (Q-13).
   - Widths shrink on average (Cairo ≈515 against Azeret 650), so overflow is unlikely; misalignment is the real issue.
   - Papers: Calibri has no Arabic-Indic, so Windows falls back to Segoe UI and Linux to the Noto aliases at the Arabic size-adjust. Re-check the ATM Note's 72-row fit and the seals sheet's 10% column in picture #9.
2. **Grouping (verified).** `ar-EG` groups with U+066C, which is 193 units wide: «١٥٤٬٣٢٠» can read as «١٥٤٣٢٠». This is the owner's own money argument. Handling: one constant, `AR_GROUP_MARK`, and Q-2. Specs compute through `formatNumber`, so a flip costs nothing. Years never group (`formatYear`).
3. **Bidi.** Not rendered in this run; the pictures must confirm it.
   - Arabic-Indic digits are AN. Joined by `/` or `:` (CS), they stay one left-to-right unit and look like today's Latin. Joined by `-` or by spaced separators, the AN runs are laid out right-to-left: «٢٠٢٦-١١-١٤» shows as «١٤-١١-٢٠٢٦», even inside an LTR isolate. The pager's «١ - ٢٥» shows as «٢٥ - ١», which reads correctly right-to-left but differs from today.
   - Handling: Arabic dates use `/` (`formatSlashDay`; Operations `dayText`). Check the pager, ranges («من ٢ إلى ٥»), ratios «١٨/٢٠», percent «<١٪», negative values and time ranges in pictures #1, #6, #15.
4. **Values parsed back.** These must stay Latin and get a `// latin-digits: parse` marker:
   - `formatPaperTimestamp` `Number(pick('hour'))`; HR `view-model.ts:23` `cairoClock` and `period.ts:23` `en-CA`; `DayDecisionDialog.tsx:38`; `EmployeeMonthPage` month param;
   - `notice-render.ts` `dateParts` (ASCII `\d`) and `notice-autofill`; `FuelChargingPage.tsx:90-91`; `FleetSettingsPage`; the `PlanLinePanel` `CountInput` and `StandardLoads`; `ungroupCardNumber`;
   - Ops `vanCodeText`/`looseNumberOf`/`matchesBoardVan`; gold `ReceivingEditorDialog.tsx:427`; ATM `zoneNameKey`.
   - Handling: never route a display helper into these. Inputs keep `asciiDigits` folding.
5. **URLs, clipboard, CSV and Excel, `data-*`, file names.** These stay Latin. `ymd`, `line()`, `lineOf()`, `statementLines`, `report-export` rows and `dashboardExportSections` feed Excel as well, so conversion happens only at the display and print edges. Excel text cells are frozen in this PR. They are already mixed today: `formatDate` cells are Arabic-Indic, `ymd` cells Latin (Q-3). Table copy (`table-copy.ts`) copies displayed text, so counts paste into Excel as text; noted in Q-3.
6. **Sorting and filters.** Sorts use raw values. `columnSortKey` and `foldColumnText` fold digits (column-filter.ts:52, :166). Arabic-Indic code points are sequential, so text order is preserved. Column-filter lists are the cell text, so cell and list change together (ATM `bankCountsText`, ledger, plan). Picks are not persisted.
7. **Money through count helpers.** The dashboard `count()` fuel and custody-history ticks, ATM `int`/`plainNumber`, Ops `figure`/`printed`, and `translate` with raw `d`. All are split or converted **before** the switch (§1.4). The guard and money-format spec catch regressions.
8. **The central `translate` change is app-wide.** Stringified params (≈96) are not reached and are fixed per site. Raw numeric identifiers (memo `no`) are stringified first. Years go through `formatYear`, or they would group. The HUB wires it last; the full gate proves it.
9. **Server text.** Stored notifications, contract snapshots (hashed) and go-live notes keep their digits. Only new rows change, with no data change. The leave eligibility details (RequestLeaveDialog.tsx:125,134) are English sentences composed on the server; that is out of scope here and listed as a follow-up.
10. **Charts.** Fleet charts are custom SVG/HTML through `count`, `kmText` and `axisLabel` (P4). Gold uses Recharts `tickFormatter` (P8). ATM bars use `reportCount` (P7). HR uses `hourTick` (P6). Check label overlap in pictures #10 and #14.
11. **Specs that locate cells by Latin text.** `vehicles-licence-state.spec:263`, `drivers-licence-state.spec:216`. About 40 specs assert `not.toMatch(/[٠-٩]/)`, and some pin code shape (`distribution-round26.spec`). These are rewritten, never deleted.
12. **Mixed state if partial.** The three alarm cards each define their own LATIN, so P2 changes all three. The attendance view helpers move together (P6).
13. **Native date inputs** draw digits from the browser and OS locale; the app cannot control them (D).

---

## 5. Specs

**Re-point, by package (≈ files / ≈ assertions):**

| Package | Files | Assertions |
|---|---|---|
| P1 | 6 | 20 |
| P2 | 18 | 150 |
| P3 | 22 | 170 |
| P4 | 20 | 200 |
| P5 | 10 | 70 |
| P6 | 3 | 15 |
| P7 | 48 | 200 |
| P8 | 11 | 45 |
| P9 | 6 | 15 |
| HUB | 1 | 1 |
| **Total** | **≈145** | **≈880** |

English pins and machine pins stay.

**New specs (≈15):**
- P1: `format-figures.spec.ts`, `figure-param.spec.ts`, `NumberedPager.spec.tsx`, `latin-digits-guard.spec.ts`, and the `money-format.spec.ts` extension.
- P2: the history-count tests (§3), and a `fleet-report-print` serial/money test.
- P6: `view-format.spec.ts`.
- P8: `gold-format.spec.ts`.
- P9: the notification Arabic figures test and the rule-bridge Arabic test.
- HUB: `catalog-digits.spec.ts`.

**The guard: `apps/web/src/shared/lib/latin-digits-guard.spec.ts` (P1).**

1. **Source scan** of every non-spec `apps/web/src/**/*.{ts,tsx}`.
   - It flags `nu-latn`, `NumberFormat('en-US'|'en-GB'`, `toLocaleString('en-US'`, `DateTimeFormat('en-GB'|'en-US'|'en-CA'`, and `toLocale(Date|Time)?String(undefined` or with no locale.
   - A line passes when it sits in a ternary whose other branch is `'ar-EG'` (an English branch), or when that line or the one above carries `// latin-digits: money|parse|english|machine — <why>`.
   - Pin the set of files that carry a `money` marker, so a new one is a reviewed diff.
   - `shared/lib/format.ts` `moneyLocale` is the only allowed `nu-latn`.
2. **Behaviour.** For every figure helper in `format.ts`, the Arabic output contains no `[0-9]`. For `formatMoney`, `formatAmount` and `formatMoneyParts`, the Arabic output contains no `[٠-٩]`. English outputs equal today's strings.
3. **`translate`.** `translate('ar', <a count key>, {count: 5})` contains «٥»; English contains «5».
4. **Raw money in `t()`.** No `t(` param named `d`, `denomination` or `amount` may be a bare identifier or number unless wrapped in `String(`, `formatAmount`, `formatMoney`, `formatEgp`, `figure(`, `money(`, `latin`, `grouped`, `TOKEN` or `MARK`. An allowlist pins the current sites.
5. **HUB `catalog-digits.spec.ts`.** No Latin digit in any Arabic catalogue value outside the keep-list.

**Constraints to respect:** `attendance-routes.spec.ts:110`, `settlement-tab.spec.ts:190`, `formal-arabic.spec.ts` (the formal-Arabic guard over new keys), `fleet-dashboard-link-census` (URLs).

---

## 6. Dark pictures for the owner (17)

All in the dark theme (`class="dark"`), in Arabic unless stated. Desktop width is 1366, except as noted.

1. `/fleet/vehicles`, 1366: the figures strip and breakdown cards (Q2), the table dates «٢٠٢٦/١١/٠٧», the pager «عرض ١ - ٢٥ من أصل …», and money still Latin wherever it shows.
2. `/fleet/licensing`, 1366: the five tiles (Q2), with the month filter opened on «أكتوبر ٢٠٢٦ (١٢)». This reverses #767 (a).
3. `/fleet/notices`, 1366: tiles and «حسب النموذج / حسب الشهر» (Q2).
4. The car record `/fleet/vehicles/:id`, 1366: the history rows «٣ حوادث», «١٤ عملية», «قراءة واحدة», «المخالفات ٥», and the dates and km on the page. This reverses #767 (b).
5. The same car's «المخالفات» link → `/fleet/violations?codes=X&dcodes=X`, 1366: both halves, with the totals equal to picture 4's count, including an old-book row (Q3 answered).
6. `/fleet/odometer`, 1366: readings ≥ 100,000. Take **6a** with «١٥٤٬٣٢٠» and **6b** with «١٥٤,٣٢٠» (Q-2). Add the «كيف حُسب الفارق» card open, and column alignment in Cairo (Q-13).
7. The `/fleet/custody/log` print sheet: «التاريخ / إلى», the serial «م» and the counts in «البيان» in Arabic-Indic; the amounts in Latin (Q1).
8. The «إيصال استلام محصنة» print, from `/operations/vault/receive`: «تاريخ الاستلام / تاريخ التسليم» and the counts in Arabic-Indic, «عدد الأوراق: ١٬٥٠٠ = 300,000» (Q1, plus the `/` date form).
9. The ATM «محضر جرد ماكينة الصراف الآلى» print: the B9 date, the G72 stamp, cassette numbers and note counts in Arabic-Indic; denominations and totals in Latin. Check the one-page fit (Q1, DS-18).
10. «لوحة تحكم الحركة» → the km tab, 1366: chart axis, tooltip, «أعلى ٥ سيارات», and the month chip «نوفمبر ٢٠٢٦».
11. The Fleet daily roster, 1366: toolbar and column counts.
12. `/fleet/fuel-cards`, 1366: KPIs «معدل ١٫٥ كارت», expiry dates, balances in Latin beside Arabic-Indic counts (fonts).
13. ATM «خطة التغذية», 1366: note counts «٢٬٠٠٠» beside Latin money in a dense table, the line panel «كاسيت ٣» and run «٢ · ٩:٠٠ م» (Q-2, Q-13).
14. ATM «تقرير البيانات», 1366: bar labels, tables and «بتاريخ ١٣ / أكتوبر / ٢٠٢٦» (Q-5, the D7 reversal).
15. HR «الحضور اليومي», 1366: «٩:٢٠ ص ← ٥:٠٠ م», durations «٧:٤٩», «٨٢٪», status counters, the page-title date.
16. Gold «الخزائن» board and the «أمر خروج» print, 1366: drawer numbers, fill «٤٥٪», grams «١٢٬٥٠٠» (Q-7).
17. Phone, 390 wide: the welcome page with the bell «٣» and «قبل ٥ دقائق», plus «يوم القائد» «تم ٢ من ٥».

Add **#18** in **English**: `/fleet/vehicles` at 1366, to show English is unchanged.

---

## 7. Open questions for the owner (Arabic text to send, with the recommended answer)

1. **Identifiers.** «أكواد العربيات والموظفين، أرقام اللوحات والموبايلات والأرقام القومية، أرقام الكروت والمذكرات والإيصالات والعقود: تفضل إنجليزي زي دلوقتي ولا عربي؟»
   *Recommended:* English (Latin) on screens. These values are typed, searched, copied and compared, and the search boxes fold Arabic-Indic to Latin. Papers that already print them in Arabic-Indic at his request (ID card, ID receipt, IT custody acknowledgement, Form 1) stay as they are. Versions, step numbers and sheet row numbers are figures and become Arabic-Indic.
2. **The thousands mark on non-money figures** (readings, large counts). «١٥٤٬٣٢٠ ولا ١٥٤,٣٢٠ ولا ١٥٤٣٢٠؟» (pictures 6a and 6b)
   *Recommended:* «١٥٤,٣٢٠». It uses the same comma as money and his own Word letters, for his own reason that «٬» is too faint.
3. **Excel.** «ملفات الإكسل: الأرقام والتواريخ تفضل إنجليزي عشان الإكسل يرتّب ويجمع؟»
   *Recommended:* yes, keep Excel Latin and numeric. A follow-up would make today's mixed date text cells Latin too.
4. **Typed inputs.** «خانات الكتابة والتاريخ تفضل زي ما هي؟»
   *Recommended:* yes. Inputs keep folding to Latin; native date boxes follow the browser. Read-only figures next to them follow the rule.
5. **ATM Data Report (D7 «Latin in both languages»).** «تقرير البيانات يبقى أرقام عربي برضه (من غير فواصل والصفر ظاهر)؟»
   *Recommended:* yes. D7's Latin note came from a review finding (WEB-5) and is overturned by the new rule; its other parts are kept.
6. **His own papers that write MONEY in Arabic-Indic** (the custody Word letters «( ٢٠٠,٠٠٠ )»; Form 1 wages «٢٧٢٠ / ٠٠»). «تفضل زي أصلك ولا الفلوس فيها تبقى إنجليزي زي الشاشات؟»
   *Recommended:* keep them as his originals write them. They copy his own Word and government forms, and he asked «كل الأرقام بالعربي» on Form 1.
7. **Gold weights** (grams on the vault board and the fund statements). Weights or fund figures? «أوزان الذهب تبقى عربي زي باقي الأرقام ولا إنجليزي زي الفلوس؟»
   *Recommended:* Arabic-Indic. A weight is a quantity, and the money exception was about amounts. Picture 16.
8. **Contract and hiring papers** (A27 «رجعهم كلهم زي الاصل»).
   *Recommended:* in this PR, nothing. Next, map only the dates, years and day numbers the system fills in on Arabic contracts at render time (the stored values and hash stay safe). The template's own wording, law numbers included, stays as his original until he sees a printed contract.
9. **Percent sign.** «٨٥٪ ولا 85%؟»
   *Recommended:* «٨٥٪». It is already used on IT and gold.
10. **Units.** ATM durations «٠٢h : ٢٥m» → «٠٢ س : ٢٥ د»? File sizes «KB/MB» → «ك.ب / م.ب»?
    *Recommended:* Arabic units in Arabic, as the Fleet contract files already use «ك.ب».
11. **Names that contain numbers.** «بنزين 92»، «6 أكتوبر»، «HP 85A»، and the salary rule «٧٠٪ / ٣٠٪ / ÷ ١٫٣».
    *Recommended:* product, place and model names stay as written. Rule percentages and slot labels («كاسيت ١», «أخصائي ١», «داخل الخزينة ١») become Arabic-Indic.
12. **Arabic papers printed by an English-language user.**
    *Recommended:* the digits follow the paper's language. Arabic papers always print Arabic-Indic, as the IT papers and the ID card already do.
13. **The digits' font** (proportional Cairo, columns not aligned). Pictures 6, 12, 13.
    *Recommended:* accept Cairo unless the columns look broken to him; otherwise the spike's tabular face.
14. **Q3 «مش فاهم» and Q4 «اه».** Settled through the run notes: the violations count and the count grammar. Pictures 4 and 5 let him confirm.

---

## 8. Size estimate

- **Source files:** ≈400 (Fleet ≈155, HR ≈70, Ops ≈40, ATM ≈40, Gold/IT/Org/Admin ≈65, platform/shared ≈22, contracts 2, API ≈10), plus `i18n.ts`.
- **Direct code sites:** ≈620 (Fleet ≈270, HR ≈130, Ops ≈60, ATM ≈50, Gold/IT/Org/Admin ≈80, platform/shared ≈40). On top of these:
  - ≈385 raw `t()` number params, fixed by one line plus ≈26 pre-conversions;
  - ≈100 Arabic catalogue strings;
  - ≈26 API sites.
- **B sites (money to Latin):** 5 on screens, plus 4 money-form fixes. Two paper families are held.
- **Specs:** ≈145 files and ≈880 assertions re-pointed, ≈15 new spec files.
- **Packages:** 10. Effort balance: P1 S, P2 L, P3 L, P4 L (≈300 `count` calls if the store-read option fails), P5 M, P6 L, P7 L, P8 L, P9 M, HUB M (catalogue rewrite plus the sequential full gate).
