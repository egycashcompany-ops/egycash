# Fleet digits: every figure in «الحركة» in Latin digits, nothing else changes

**Owner's rule (23 Nov 2026).** «اى ارقام خليها بالانجلش حتى لو عربى» and «انا عاوزك تعدل حاجات الحركة فقط».
- In Fleet screens and Fleet papers, every figure an Arabic reader sees uses digits 0-9.
- English output stays byte-identical. The one exception is the Arabic-only custody letters, which an English-UI user also prints.
- Identifiers, typed values and numeric Excel cells stay as they are.
- HR, ATM, operations, gold, IT, organization, system-admin and the platform home do not change behaviour.

**Superseded documents.** `.wip-notes/digits/plan.md` and its survey (the Arabic-Indic direction, a shared `arabicIndicDigits`, packages P6-P9 for other modules) are obsolete. Do not apply them.

**How this was checked.** Read-only: only grep, sed and cat, plus two `node -e` Intl probes (Node 22.23.5, ICU 78.3).

---

## 0. What I verified in the code (load-bearing claims)

| Claim | Where | Result |
|---|---|---|
| `formatNumber` uses `ar-EG` in Arabic and `en-US` in English. `formatDate` and `formatDateTime` use `ar-EG` / `en-GB`. Money helpers use `ar-EG-u-nu-latn`. | `apps/web/src/shared/lib/format.ts:20-21,36,60-69,105-106,108-158` | Yes. Probe: ar-EG gives «١٥٤٬٣٢٠٫٥»; en-US gives «154,320.5». |
| `ar-EG-u-nu-latn` with `dateStyle:'medium'` gives the same shape and marks as ar-EG, only Latin digits. | probe | Yes: «07‏/11‏/2026» = `30 37 200f 2f 31 31 200f 2f 32 30 32 36`. en-GB gives «7 Nov 2026». |
| `translate()` fills `{{x}}` with `String(value)`, so a raw number comes out Latin. | `platform/localization/i18n.ts:31289-31300` | Yes |
| Fleet calls the shared digit helpers in **30 files, 75 call lines**. `formatDate`: 40 (13 in components, 27 in pages). `formatNumber`: 35 (22 and 13). | node import/call scan | Yes. It matches the critic's count. Fleet calls `formatDateTime` and `formatBusinessDateTime` nowhere. |
| `AlarmBadge.tsx:294-295` `formatNumber` is an injected prop, not the shared helper. Its only caller passes `latin`. | `MaintenanceAlarmsPage.tsx:399` | Yes. Leave it. |
| The only `'ar-EG'` Intl uses in Fleet are names only (month or weekday), plus a comment. | `dash-blocks.tsx:519`, `km-chart.tsx:190`, `tab-fuel-chart.tsx:103`, `roster-parts.tsx:64`, `custody-memo-editor.ts:327`, comment at `custody-paper-format.ts:5` | Yes. There is no `toLocale*()` without arguments, and no Intl built from a raw `locale`. |
| Arabic `fleet.*` catalogue values that contain Arabic-Indic digits: 16 lines, plus one «٪». | i18n.ts:22661-2, 23726, 24015, 24389-24395, 24423-4, 24429, 24438, 24781, 24804, 24836; «٪» at 24281 | Yes. No non-Fleet Arabic-Indic key is used in Fleet. |
| `ZoomableImage` is rendered by Operations, and the key `fleet.licenseImage.zoomLevel` comes with it. | `operations/components/ShipmentReceiptImageCell.tsx:29,174` | Yes. It is the **only** cross-module Fleet file this plan touches. |
| Operations does not reach `FuelCardImage`. | `operations/*` takes only `DesignField`, `Stroke`, `carBoxClass`, `LOOK`, `MONO` and `boxTone` from `FuelCardDialog` | Yes, so the Fleet image hosts can opt in safely. |
| The custody letters' Arabic-Indic digits come from `ai`, `aiAmount` and `tatweelDate` only. Their only importer is `custody-paper-letters.ts:15`. | `lib/custody-paper-format.ts:49-69` | Yes. `letterFigure` is stored as a `number` (`contracts fleet.ts:6080`), so a reprint re-formats it. |
| The car record's «المخالفات» count today is `useViolations({vehicleId,page:1,pageSize:1})` → `meta.totalItems`. | `VehicleDetailPage.tsx:342,355,359` | Yes. It is counted by id and by documents, and it misses old-book rows. See §3(a). |
| `fleet.vehicle.count.odometer` is **also** the odometer toolbar's key. | `OdometerPage.tsx:766` | Yes. **(Correction)** The plural change in §3(b) must cover OdometerPage too. The spec `fleet-odometer.spec.tsx:1335` («the number the profile showed») ties the two together. |
| `image-zoom-preview.spec.tsx:76` («١٠٠٪»). | spec | **(Correction)** Do not re-point it. It renders the default path, which is the Operations path, and must stay. Add a Fleet assertion beside it. |
| `fleet-vehicle-profile-alarm.spec.tsx:322` forbids `\bformatNumber\(` in VehicleDetailPage. `:328-329` counts `formatDate(` = 2. | spec | Yes. This is one reason the Fleet helpers get **distinct names** (§1.1). |
| No catalogue key-parity spec. `placeholders.spec.ts` checks only single braces. | spec | Yes. The plural `.one` values may drop `{{count}}`, as `fleet.custody.count.*` does. |

---

## 1. Approach

### 1.1 One Fleet-local figures module: NEW `apps/web/src/modules/fleet/lib/fleet-figures.ts`

These are the Latin twins of the shared helpers. They take the same inputs and give the same `'—'` for a missing value. English output is the same byte for byte. In Arabic only the numbering system changes. The module lifts `VehicleDetailPage.tsx:143-161`.

```ts
// Fleet's figures in Latin digits, in Arabic as in English — owner, 2026-11-23:
// «اى ارقام خليها بالانجلش حتى لو عربى» / «انا عاوزك تعدل حاجات الحركة فقط». Twins of the shared
// formatNumber / formatDate / formatDateTime (same options, same «—», English byte-identical);
// only the Arabic numbering system is Latin. The shared helpers keep every other module's digits.
import { type Locale } from '@ecms/contracts';

const PLACEHOLDER = '—';
const NUMBER = new Intl.NumberFormat('en-US'); // = shared formatNumber's English
const DATE: Record<Locale, Intl.DateTimeFormat> = {
  ar: new Intl.DateTimeFormat('ar-EG-u-nu-latn', { dateStyle: 'medium' }),
  en: new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }),
};
const DATE_TIME: Record<Locale, Intl.DateTimeFormat> = {
  ar: new Intl.DateTimeFormat('ar-EG-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' }),
  en: new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }),
};
const toDate = (value: string | Date | null | undefined): Date | null => {
  if (value === null || value === undefined) return null;
  const d = typeof value === 'string' ? new Date(value) : value;
  return Number.isNaN(d.getTime()) ? null : d;
};
export const latinNumber = (value: number | null | undefined): string =>
  value === null || value === undefined ? PLACEHOLDER : NUMBER.format(value);
export const latinDate = (value: string | Date | null | undefined, locale: Locale): string => {
  const d = toDate(value);
  return d === null ? PLACEHOLDER : DATE[locale].format(d);
};
export const latinDateTime = (value: string | Date | null | undefined, locale: Locale): string => {
  const d = toDate(value);
  return d === null ? PLACEHOLDER : DATE_TIME[locale].format(d);
};
```

**Why these choices:**
- **Counts and km use `en-US`, not `ar-EG-u-nu-latn`.** `en-US` adds no LRM before a minus («‎-250»). It is Fleet's convention already (custody-words, vehicle-contract-words, page `LATIN`s). And it equals shared `formatNumber(…, 'en')`.
- **Dates use `ar-EG-u-nu-latn`.** That keeps today's day-first order and the RLM marks. VehicleDetailPage already ships this.
- **No timezone option.** Same as shared `formatDate`, which follows the browser clock.
- **Distinct names (`latin*`).** Spec `fleet-vehicle-profile-alarm.spec.tsx:322` forbids `formatNumber(` in VehicleDetailPage. `registers-parity.spec.tsx:346` scans `'formatDate(row.date'`. A file that also imports shared `formatMoney` reads unambiguously. The guard (§5.3) can forbid the shared names outright.
- **No percent or decimal helpers.** No call site needs one. The zoom readout uses `latinNumber` plus a Fleet key ending in «%». The violations money preview needs `en-US` with up to 3 decimals, which is exactly `latinNumber`.

### 1.2 Call-site rule (mechanical)

- `formatNumber(x, locale)` → `latinNumber(x)`
- `formatDate(x, locale)` → `latinDate(x, locale)`
- Remove `formatNumber` and `formatDate` from each file's `shared/lib/format` import. Keep `localized`, `formatMoney*`, `formatAmount` and `asciiDigits` there.
- If a file's `locale` / `useAppSelector` is now unread, remove it (lint gate).
- Pages that already have a local `LATIN` keep it for their tables. New edits use the module helper, for one rule.

### 1.3 Shared and cross-module components

- **`ZoomableImage.tsx`, the only change in a cross-module file.**
  - Add the optional prop `latinFigures?: boolean` (default `false`, today's behaviour).
  - When it is set: `t('fleet.licenseImage.zoomPercent', { value: latinNumber(zoomPercent(zoom)) })`. The new key is ar `'{{value}}%'`, en `'{{value}}%'`, so English is identical.
  - Otherwise the existing line stays, with shared `formatNumber` and `fleet.licenseImage.zoomLevel` '{{value}}٪'. Operations keeps «١٠٠٪».
  - All 9 Fleet hosts pass `latinFigures`: NoticeImageCell:189, ReceiptImageCell:157, DriverLicenseImage:234 and :595, VehicleLicenseImage:178, VehicleContractViewer:72, DealershipImageCell:156, FuelCardImage:281, number-repair/RepairThumb:69.
  - Leave the shared key `fleet.licenseImage.zoomLevel` as it is.
- **Already Latin, or not painted on Fleet. No change:**
  - `NumberedPager`/`FleetPager`, `MultiSelect`, `DataTable`, `BulkActionBar`, `StatCard`, the app-shell badges and `translate()`.
  - `fleet-report-print.ts` (serial `String(i+1)`, `reportMoney` `toFixed(2)`; also used by ATM, IT and Operations: do not touch). `vehicle-print.ts` passes values through. `fleet-sheet` and `xlsx-writer` write strings as text and numbers as numbers.
  - `FileUpload.formatSize`: ar-EG, but unmounted on pick in `ReconcileUploadCard.tsx:207`.
- **Fleet files other modules import, which keep their exports and behaviour:** FuelCardBoard, DesignDialog, fleet-report-print, FilterWithIcon, board-scroll, fleet-sheet, FuelCardDialog, custody-words, HoverCardLayer, row-actions-look, dark-filter-bar, custody-dashboard-parts, whole-catalog, row-action-icons, RosterBottomSheet, vehicle-code-match, FleetPager, reconcile-cells, `VehiclesListPage` (Operations takes only `DARK_TABLE`), vehicle-code-rank, draft-storage, LicenseExpensePaidGroup and DateBox. Of these, only `VehiclesListPage` is edited, and none of its exports change.

### 1.4 Custody Word letters (Fleet lib, P5)

- `custody-paper-format.ts`: delete `ai`, `aiAmount`, `AR_ZERO` and `AR_DECIMAL`. In `tatweelDate`, drop `.map(ai)`. This gives «01ـ09ـ2026» and «1ـ09ـ2026». The tatweel stays.
- Callers in `custody-paper-letters.ts`:
  - amounts → `grouped(v)`: «81,908», «124,139.46».
  - serials → `String(i + 1)`.
  - date lines → the plain Latin parts.
  - the typed reason → `asciiDigits(...)`, imported from `@ecms/contracts`. Typed «٢٤» prints «24».
- `latin2` stays. There is no Arabic letter in the engine file, so `formal-arabic.spec.ts:120-130` still holds.
- The letters never read the locale, so an English-UI user's letter changes too. This is intended.

### 1.5 Catalogue (HUB)

- Change Arabic values only. Write the 16 Arabic-Indic lines in Latin.
- Add `fleet.licenseImage.zoomPercent`.
- Replace the four flat `fleet.vehicle.count.*` keys with five-form plural sets (§3(b)).
- No English value changes.

### 1.6 What does not change

- `shared/lib/format.ts`, `translate()` and every shared component.
- The API and contracts. The fleet-api survey found zero server-side Arabic-Indic output, and the «1200.50» refusal detail strings must stay plain Latin.
- `money-format.spec.ts:65` (shared Arabic-Indic) stays green.

---

## 2. Packages (strict file ownership; paths under `apps/web/src/modules/fleet/` unless absolute)

### Order

- **Step 0 (sequential, about 10 min).** P1 writes `lib/fleet-figures.ts` exactly as in §1.1. The HUB applies the P1 and P2 i18n **additions** fixed in this plan (zoomPercent and the 40 plural keys) so the package specs can run. Flat keys are removed only in the HUB's final step.
- **P1-P5 run in parallel.** Each runs **only its own spec files, one vitest at a time**: 16 GB, no swap.
- **HUB runs last.** It merges the fragments and does the removals, adds the guard, the docs and the PR body, runs the gate alone, then takes the pictures.

Each package writes its i18n fragment to `.wip-notes/digits/i18n/<pkg>.json` as `{"set":{key:{ar,en}},"remove":[…]}`. Each also updates the comments that state the old exception in the files it owns.

### P1 FIGURES and IMAGE VIEWERS (10 source files: 1 new, 9 edited)

**Source changes:**
- NEW `lib/fleet-figures.ts` (§1.1).
- `components/ZoomableImage.tsx`: `latinFigures` prop (§1.3). Update the comment at :259-260.
- `components/VehicleLicenseImage.tsx:178`, `components/NoticeImageCell.tsx:189`, `components/FuelCardImage.tsx:281`, `components/VehicleContractViewer.tsx:72`, `components/number-repair/RepairThumb.tsx:69`: pass `latinFigures`.
- `components/DriverLicenseImage.tsx`: pass `latinFigures` at :234 and :595. At :272, the «تاريخ الرخصة» print row becomes `latinDate(driver.licenseExpiresAt, locale)`.
- `components/ReceiptImageCell.tsx`: pass `latinFigures` at :157. At :67, `identity()` date becomes `latinDate(row.date, locale)`. This one edit fixes the dialog subtitle :134, print subtitle :176, row :179 and caption :190.
- `components/DealershipImageCell.tsx`: pass `latinFigures` at :156. At :66, `latinDate(row.outDate, locale)`. Same reach: :133, :180, :183, :193.
- `lib/image-zoom.ts:154`: comment only («١٠٠٪» becomes «100%»).

**Specs:**
- NEW `lib/fleet-figures.spec.ts`:
  - `latinNumber(154320.5)` = '154,320.5'; null and undefined give '—'.
  - For [0, 7, 1234, 120000, 154320.5, 1.125, -250], `latinNumber(v) === formatNumber(v,'en')`.
  - For several ISO strings and a Date, `latinDate(v,'ar') === asciiDigits(formatDate(v,'ar'))`: same shape and RLMs, only the digits change. The result has no `[٠-٩]`.
  - `latinDate(v,'en') === formatDate(v,'en')`. Invalid input gives '—'.
  - The same pair of checks for `latinDateTime` against `formatDateTime`.
- EDIT `image-zoom-preview.spec.tsx`:
  - **Keep** :72-77 (the default/Operations path «١٠٠٪», English «100%»).
  - **Add** a render with `latinFigures`: Arabic contains «100%» and no `[٠-٩٪]`; English «100%».
  - **Add** a source scan: every `<ZoomableImage` in Fleet non-spec source carries `latinFigures`, and `operations/components/ShipmentReceiptImageCell.tsx` does not.

**i18n fragment `p1.json`:**
`{"set":{"fleet.licenseImage.zoomPercent":{"ar":"{{value}}%","en":"{{value}}%"}},"remove":[]}`

### P2 CAR RECORD and REGISTRY SCREENS (9 source files)

**Source changes:**
- `pages/VehicleDetailPage.tsx`:
  - Delete the local `LATIN_NUMBER`/`LATIN_DATE`/`LATIN_DATE_TIME`/`latinWhen`/`latinNumber`/`latinDate`/`latinDateTime` (:143-161). Import `latinNumber, latinDate, latinDateTime` from `../lib/fleet-figures`.
  - Rewrite the comment at :132-141 (the whole page and its print are Latin).
  - `printReport` :477 and :481 → `latinDate(…, locale)`. Drop `formatDate` from the import at :18 and keep `localized`.
  - §3(a): `useHistoryCounts` uses `useViolationRollup`. Drop the `vehicleId` param, `one` and the `useViolations` import, and add `useViolationRollup` to the `../api/fleet-queries` import.
  - §3(b): `countTag` :459 → `t(pluralKey(\`fleet.vehicle.count.${key}\`, locale, n), { count: latinNumber(n) })` with `import { pluralKey } from '../../../shared/lib/plural'`.
- `pages/VehiclesListPage.tsx`: print rows :450 and :454 and sheet columns :549-550 → `latinDate`. Toolbar :853 → `latinNumber(data.meta.totalItems)`; keep `data.meta.totalItems` inside the cell (`fleet-catalogs-vehicles.spec.tsx:722-728`). Do not touch the `DARK_TABLE` export.
- `pages/LicensingPage.tsx`: :376 `latinDate`; :457 `latinNumber(rows.length)`.
- `pages/NoticesPage.tsx:465`: `latinNumber(data.meta.totalItems)`.
- `pages/DriversListPage.tsx`: :656 and :659 `latinDate`; :963 `latinNumber(matchedDrivers)`.
- `pages/DriverProfilePage.tsx`: :288 `latinDate`; :816 both dates `latinDate`; :876 `latinNumber(reading.km)`. Keep `formatAmount`.
- `pages/AttendancePage.tsx:223`: `latinNumber(…)`.
- `pages/AccidentsPage.tsx:487`: `latinDate(r.occurredAt, locale)` (Excel text cell).
- `components/AccidentTransferLogDialog.tsx:117`: `latinDate(entry.at, locale)`. Keep `formatMoney`.

**Specs, re-point:**
- `fleet-vehicle-history-links.spec.tsx`:
  - :264-265, :283-285, :308-310 and :338-344 go through `pluralKey`. Literals: `toBe('3 حوادث')` replaces `'3 حادث'` at :344; the odometer 9 gives '9 قراءات'; 1,234 gives '1,234 قراءة'; maintenance 3 gives '3 عمليات'.
  - Keep :173 (both halves).
- `fleet-vehicle-profile-alarm.spec.tsx:314-330`:
  - The shared format import has no `formatNumber`, `formatDate` or `formatDateTime`, and the source has no `\bformatDate\(`.
  - `printReport` contains `latinDate(vehicle.joinedAt, locale)` and `latinDate(vehicle.licenseExpiresAt, locale)`.
  - Retitle: «the print sheet too». The negatives at :233-238 and :293-301 stay.
- `pages/licensing-screen.spec.tsx`: :407 '٢', :564 '٣', :576 '١', :579 '٢' and :584 '٠' become **exact** `toBe(translate('ar','fleet.licensing.count',{count:'2'}))` and so on, not `toContain('2')`. Plates at :35, :130-132 and :242-253 stay.
- `fleet-drivers.spec.tsx:525,529`: `{count:'60'}`.

**Specs, add:**
- In `fleet-vehicle-history-links.spec.tsx`:
  - **3(a) render.** Seed `['fleet','violations','rollup',{year:'',vehicleCodes:'200'}]` with `[{vehicleId:VEHICLE_ID,code:'200',year:2026,totalCount:3,…},{vehicleId:null,code:'200',year:2025,totalCount:2,…}]`. Also seed the old list key `listKey('fleet','violations',{vehicleId:VEHICLE_ID,page:1,pageSize:1})` with `totalItems:1`. Expect «5 مخالفات» and not «مخالفة واحدة».
  - **3(a) source scan.** Modelled on :374-382. Expect `useViolationRollup(\s*undefined,\s*\[vehicleCode\],\s*can('fleetViolation.view') && vehicleCode !== ''`, `reduce(… + row.totalCount`, and no `useViolations(`.
  - **3(b) forms.** For each row, n = 0, 1, 2, 3, 11, 14, 100, 103, 1234 (table in §3(b)). Accidents 0 stays «سجل نظيف».
  - **English unchanged.** `translate('en', pluralKey(...,'en',1), {count:'1'})` = '1 readings'.
- Optional, in `fleet-catalogs-vehicles.spec.tsx` and `fleet-attendance.spec.tsx`: the toolbar count has no `[٠-٩]`.

**Recommended NEW API contract spec** `apps/api/tests/integration/fleet-vehicle-violation-count.spec.ts`:
- Seed car `200` with:
  - a statement row ×3 in 2025;
  - one driver fine in 2026;
  - an old-book statement row (`vehicleId:null, vehicleCode:'200'`) ×2;
  - one old-book driver fine on code 200.
- Assert:
  - Σ `GET /fleet/violations/rollup?vehicleCodes=200` `.totalCount` = 7;
  - Σ statement counts (5) plus `GET /fleet/violations?kind=driver&vehicleCodes=200` `meta.totalItems` (2) = 7;
  - `GET /fleet/violations?vehicleId=<id>` `totalItems` = 2 (the old figure).

**i18n fragment `p2.json`:** the 40 `set` entries in §3(b), plus `"remove":["fleet.vehicle.count.odometer","fleet.vehicle.count.maintenance","fleet.vehicle.count.accidents","fleet.vehicle.count.violations"]`.

### P3 ODOMETER, WORKSHOP, ALARMS, MAKES (6 source files)

**Source changes:**
- `pages/OdometerPage.tsx`:
  - :421 `latinDate` (Excel).
  - :764-768 → `t(pluralKey('fleet.vehicle.count.odometer', locale, data.meta.totalItems), { count: latinNumber(data.meta.totalItems) })`. This uses P2's keys, so it stays «the number the profile showed».
  - :1077 `latinDate`; :1079 `latinNumber`.
  - Comment at :122-127.
- `pages/MaintenancePage.tsx`: :428 and :429 `latinDate`; :790 `latinNumber`. Comment at :122-125.
- `pages/MaintenanceAlarmsPage.tsx`: :301 `latinDate`; :448 `latinNumber(rows.length)`. Comments at :102-106 and :270-274.
- `components/RecordOdometerDialog.tsx`: :233 and :385 `latinNumber`.
- `components/MaintenanceDialogs.tsx`:
  - :290 `{ km: latinNumber(km), date: latinDate(at, locale) }`, which covers :374, :613, :798 and :839;
  - :481, :487, :711, :719, :944 and :969 `latinNumber`;
  - :488, :720, :945 and :970 `latinDate`.
- `components/VehicleTypesTable.tsx:118`: `latinNumber(r.maintenanceIntervalKm)`.

**Specs, re-point:**
- `fleet-odometer.spec.tsx`:
  - :1188 → `toContain('latinNumber(data.meta.totalItems)')`;
  - :1190 → `not.toMatch(/count: latinNumber\(rows\.length/u)`;
  - :1203 → `translate('ar', pluralKey('fleet.vehicle.count.odometer','ar',73), {count:'73'})`, which is «73 قراءة»;
  - :1343 → the same with 412.
- `fleet-maintenance.spec.tsx:1157`: '120,000'. Keep the negatives at :514 and :562.
- `fleet-maintenance-alarms.spec.tsx:184,186`: `{count:'3'}` and `{count:'1'}`.
- `fleet-workshop-odometer-warning.spec.tsx:368`: `toContain('latinDate(at, locale)')` and add `toContain('latinNumber(km)')`.
- `fleet-maintenance-integration.spec.tsx:314,327,330`: optional tightening to Latin only.

**i18n:** none. Its catalogue strings are HUB edits.

### P4 VIOLATIONS and REGISTER SHEETS (11 source files)

**Source changes:**
- `components/CompanyViolationsPanel.tsx`: :446, :698 (money preview; `latinNumber` keeps English identical, which `formatAmount` would not for 3-decimal input), :750, :933, :979 and :980 → `latinNumber`. Keep `formatMoney`.
- `components/CompanyViolationsDetailLayer.tsx`: :173 `latinNumber`; :195 `latinDate`.
- `components/DriverViolationsPanel.tsx`: :1173, :1446, :1449 and :1450 → `latinNumber`.
- `pages/DealershipPage.tsx`: :370 and :399 `latinDate`; :478 `latinNumber`.
- `components/DealershipInvoiceDialog.tsx:246`: `latinDate`. This also puts the value back in the NUM face.
- `pages/ReceiptsPage.tsx`: :559 and :592 `latinDate`; :681 `latinNumber`.
- `pages/CustodyPage.tsx`: :562 `latinDate`; :685 `latinNumber`.
- `pages/FuelCardsPage.tsx:300`, `pages/FuelChargingPage.tsx:343`, `pages/LicenseExpensesPage.tsx:621,655`: `latinDate`.
- `components/VehicleContractsExport.tsx:69-70`: `latinDate`. Keep the `row.deadline === null ? ''` ternary.

**Specs, re-point:**
- `fleet-violations-split.spec.tsx`: :955-956 → exact `translate('ar','fleet.violations.loadedOf',{shown:'100',total:'440'})`; :1398 → `'2'`. The negatives at :993 and :1899 stay.
- `pages/receipts-screen.spec.tsx:929`: `{count:'1'}`.
- `pages/registers-parity.spec.tsx:346` stays valid.

**i18n:** none.

### P5 CUSTODY LETTERS (4 source files)

**Source changes:**
- `lib/custody-paper-format.ts`:
  - Delete `AR_ZERO` (:10), `AR_DECIMAL` (:12), `ai` (:49-50) and `aiAmount` (:53).
  - `tatweelDate` :66-69 without `.map(ai)`.
  - Rewrite the header comment :1-7 and the doc comments at :48, :52 and :62-65 (Word's Context numerals → the owner's «اى ارقام بالانجلش»).
- `lib/custody-paper-letters.ts`:
  - :15 import `grouped` in place of `ai` and `aiAmount`; add `import { asciiDigits } from '@ecms/contracts'` (types already come from there).
  - :177 `reasonOf = (reason) => asciiDigits(reason.trim().replace(LEADING_REASON, ''))`.
  - :185, :195, :289, :290, :301 (amount), :303, :310 and :311 `aiAmount(…)` → `grouped(…)`.
  - :207 → `` `${Number(d)}/${Number(m)}/${y}` ``.
  - :279 → `` `${dateWord}${d.padStart(2, '0')}/ ${m} / ${y}` ``.
  - :280 → `` `${dateWord} ${String(Number(d))} / ${m} / ${y}` ``.
  - :301 and :321 serial `String(i + 1)`.
  - :321 label `esc(settleRowLabel(row.part, String(row.cars)))`.
  - Header comment :4-7.
- `lib/custody-paper-wording.ts`: comments only at :130 and :137-139.
- `components/CustodyChargeDialog.tsx`: comment only at :151 («in his digits» → «Latin digits»).

**Specs, re-point:**
- `lib/custody-paper-format.spec.ts`:
  - Replace describe :45-58 with «the Word letters: Latin digits»: `grouped(81908)`='81,908', 100000→'100,000', 124139.46→'124,139.46', no `[٠-٩٫٬]`.
  - :69-73 → `` `01${tw}09${tw}2026` ``, `` `1${tw}09${tw}2026` ``, `` `30${tw}09${tw}2026` ``.
- `lib/custody-paper-letters.spec.ts`, every literal Latin:
  - :44 'التاريخ</span> 5/10/2026';
  - :49, :58, :74 and :78 '( 200,000)', '24 سياره تجديد + 23 سياره مد مده .';
  - :92 'التاريخ29/ 09 / 2026';
  - :99 and :124 the body and period «(81,908) … ( 100,000) … 01ـ…»;
  - :109-112 rows ['1','كاوتش','2,650'] … ['الاجمالي','','81,908'];
  - :132 'التاريخ 5 / 10 / 2026';
  - :139 '(124,139.46) … (299,400)';
  - :144 '<td class="n4">1</td><td>تجديد 5 سياره</td>';
  - :151 'مد مده 23 سياره';
  - :182 `String(i + 1)`;
  - :234-238 inverted: «prints Latin digits only», `not.toMatch(/[٠-٩٫٬]/u)` on every letter's text;
  - retitle :42, :103 and :143.
- `lib/custody-papers.spec.ts:245`: '( 100,000)'.
- `pages/custody-fund-dialogs.spec.tsx:887`: '200,000'.
- `pages/custody-papers-setup.spec.tsx`: :321 '75,000'; :347 'التاريخ19/ 10 / 2026'.

**Specs, add:** in `custody-paper-letters.spec.ts`, the typed reason 'نظير ٢٤ سياره تجديد' prints '24 سياره تجديد'. The paginated multi-sheet settle test keeps the same sheet count (pagination is by character count).

**i18n:** none.

### HUB (last)

**Files:**
- `apps/web/src/platform/localization/i18n.ts`;
- NEW `apps/web/src/modules/fleet/fleet-latin-figures.spec.ts` (the guard, §5.3);
- `CHANGELOG.md` (an `[Unreleased] › Changed` entry: «Fleet: every figure in Latin digits», with the owner's words, what changed, what did not, and what to tell him from §7);
- `docs/12-planning/fleet-module-design.md` (a new subsection «Figures: Latin digits in both languages (2026-11-23)»: the rule, `lib/fleet-figures.ts`, the guard, the exceptions — ZoomableImage default for Operations, identifiers, typed text, native date inputs — and the plural record counts. Leave §10-H3, which is about input normalization, as it is);
- the PR body `.wip-notes/digits/pr-body.md`.

**i18n edits:**
1. Merge `p1.json` and `p2.json`. Put the plural keys where the flat keys were (en :8117-8121, ar :23778-23782). Keep `activeDriver` and `accidentsClean`. Remove the four flat keys in both languages.
2. Arabic-only edits. Check each English value is unchanged.
   - :23726 `fleet.vehicles.licenseImage.hint` → 'JPEG أو PNG أو WebP — حتى 10 ميجابايت.'
   - :24015 `fleet.odometer.emptyMonth.action` → 'اعرض آخر 12 شهر'
   - :24780-24781 `fleet.odometer.sameAsPrevious` → 'مطابقة لآخر قراءة — ستُسجَّل فترة بـ 0 كم. وهذا صحيح إذا لم تتحرك السيارة.'
   - :24804 `fleet.settings.intervalHint` → '0 = لا قاعدة صيانة دورية لهذا النوع'
   - :24835-24836 `fleet.settings.keys.odometerMissingReadingDaysHint` → '… (من 1 إلى 30).'
   - Dead keys :22661-22662 → 'أعلى 5 سيارات' / 'أقل 5 سيارات'.
   - Unmounted go-live block: :24389-24395, :24423-24424, :24429 and :24438 → «24 سبتمبر», «23 سبتمبر», «16 سبتمبر», «قراءات السيارتين 150 و153».
3. Keep `fleet.licenseImage.zoomLevel` '{{value}}٪' (Operations).

**Gate:** typecheck and lint, then each package's spec list, then the full web suite **alone**, plus `money-format.spec.ts` and `formal-arabic.spec.ts`. Then the pictures (§6).

---

## 3. The two Fleet items (same PR, both in P2)

### 3(a) «المخالفات» equals what its link opens

**What the link opens.** `/fleet/violations?codes=<code>&dcodes=<code>`.
- A query string is present, so remembered filters are not restored (`shared/lib/useRememberedFilters.ts:77-81`). No `year`, `dyear`, `cset`, `dset` or set applies.
- **Company half:** `useViolationRollup(undefined, [code], true, vehicleSet)` (CompanyViolationsPanel.tsx:189-200), which calls `GET /fleet/violations/rollup?vehicleCodes=<code>`.
  - The service `carsOf` (violation.service.ts:368-386) resolves the code to ids and keeps the codes.
  - `yearSums` (violation.repository.ts:602-613) matches `isDeleted:false` plus `byVehicleOrBookCode(ids, codes)` (odometer.repository.ts:87-94). That covers **old-book rows with `vehicleId:null` and `vehicleCode` = the code**.
  - It groups by (vehicleId, vehicleCode, year) with `vehicleCount = Σ count` of statement rows and `driverCount = #` of driver rows (:667-676).
  - `assembleRollups` sets `totalCount = vehicleCount + driverCount` (violation-rollup.ts:95). Grievance-only groups have `totalCount` 0, and empty groups are dropped by `hasSomethingInIt`.
  - The board draws the four lines per group. «الإجمالي» is `totalCount` (CompanyViolationsPanel.tsx:54-78, :929-934). The default `settled===''` shows every group.
- **Drivers half:** `GET /fleet/violations?kind=driver&vehicleCodes=<code>` (DriverViolationsPanel.tsx:333-347), with the same `carsOf` → `violationFilter` → `byVehicleOrBookCode` (violation.repository.ts:244-249) and `isDeleted:false` from `baseFilter`. Its badge (:1173) is `meta.totalItems`, which equals Σ `driverCount` of the rollup.
- Moved fines (`homeVehicleId`) are counted by their current `vehicleId` in both halves.

**Therefore** Σ `row.totalCount` over the rollup = Σ «الإجمالي» lines on the company half = Σ «إجمالي الشركة» lines + the drivers' badge (the drivers half's rows). The drivers' fines are counted once and both halves include old-book rows. **The earlier proposal is correct.** The list endpoint counts documents, so a «×5» statement would count as 1. It is rejected.

**Code (VehicleDetailPage.tsx :337-362, :371):**
```ts
const useHistoryCounts = (vehicleCode: string, can: (permission: string) => boolean) => {
  // …odometer / maintenance / accidents unchanged…
  // «المخالفات»: the rollup of BOTH halves its link opens (codes + dcodes), by CODE — old-book rows
  // with no car included — summed as the boards count: a statement «×5» is five, a driver fine one.
  const violations = useViolationRollup(
    undefined,
    [vehicleCode],
    can('fleetViolation.view') && vehicleCode !== '',
  );
  return {
    …,
    ...(violations.data === undefined
      ? {}
      : { violations: violations.data.reduce((sum, row) => sum + row.totalCount, 0) }),
  };
};
const counts = useHistoryCounts(vehicle?.code ?? '', can);
```
- Same permission as the list (violation.routes.ts:44-50).
- The query key `['fleet','violations','rollup',{year:'',vehicleCodes:<code>}]` is built from strings, so a fresh `[vehicleCode]` per render does not refetch.
- No API change.

### 3(b) Arabic number agreement on the car record counts

**House style:** `fleet.custody.count.*` (i18n.ts:21529-21548).
- Five forms through `pluralKey` (shared/lib/plural.ts:43). Zero reads as `few`.
- The masculine `many` form carries tanween on alif («إيصالًا» = U+064B then U+0627). The feminine with taa marbuta has none («11 مذكرة»).
- `two` is nominative («مذكرتان»). The digits are `latinNumber(n)`.

**Arabic values (P2 fragment):**

| key | `.one` | `.two` | `.few` | `.many` | `.other` |
|---|---|---|---|---|---|
| `fleet.vehicle.count.odometer` | قراءة واحدة | قراءتان | {{count}} قراءات | {{count}} قراءة | {{count}} قراءة |
| `fleet.vehicle.count.maintenance` | عملية واحدة | عمليتان | {{count}} عمليات | {{count}} عملية | {{count}} عملية |
| `fleet.vehicle.count.accidents` | حادث واحد | حادثان | {{count}} حوادث | {{count}} حادثًا | {{count}} حادث |
| `fleet.vehicle.count.violations` | مخالفة واحدة | مخالفتان | {{count}} مخالفات | {{count}} مخالفة | {{count}} مخالفة |

**English.** All five forms of each key are today's string exactly: '{{count}} readings', '{{count}} operations', '{{count}} accidents', '{{count}} violations'. English stays byte-identical, «1 readings» included.

**Rendered.** CLDR `ar` probe: 0 zero→few, 1 one, 2 two, 3-10 few, 11-99 many, 100-102 other, 103 few, 111 many, 1234 many.

| n | odometer | maintenance | accidents | violations |
|---|---|---|---|---|
| 0 | 0 قراءات | 0 عمليات | **سجل نظيف** (kept, :451-457) | 0 مخالفات |
| 1 | قراءة واحدة | عملية واحدة | حادث واحد | مخالفة واحدة |
| 2 | قراءتان | عمليتان | حادثان | مخالفتان |
| 3 | 3 قراءات | 3 عمليات | **3 حوادث** | 3 مخالفات |
| 11 / 14 | 11 قراءة | **14 عملية** | 11 حادثًا | 11 مخالفة |
| 100 | 100 قراءة | 100 عملية | 100 حادث | 100 مخالفة |
| 103 | 103 قراءات | 103 عمليات | 103 حوادث | 103 مخالفات |
| 1234 | 1,234 قراءة | 1,234 عملية | 1,234 حادثًا | 1,234 مخالفة |

«سائق نشط» (`activeDriver`) has no number and is unchanged. The odometer toolbar (P3) uses the same forms, so the profile and the screen still read identically.

---

## 4. Risks and handling

1. **Other modules.** `shared/lib/format.ts`, `translate`, the shared UI and every Fleet export another module imports stay untouched. The exception is ZoomableImage's opt-in prop; its default is today's behaviour, and the spec keeps «١٠٠٪» on the default path. `money-format.spec.ts:65` stays green. The HUB takes one internal (non-owner) picture of Operations' shipment receipt viewer still reading «١٠٠٪».
2. **Specs that find cells or counts by text.**
   - licensing `counter()`, violations `countBadgeText` and `data-driver-loaded`, the alarms toolbar slice, odometer `data-filtered-count`, receipts and custody counts, and the custody letter table regexes (:105, :178).
   - Re-point them to **exact** strings built with `translate`/`pluralKey` and Latin params. Do not loosen them to `toContain('2')`.
   - Build date expectations with `latinDate(iso,'ar')`, because the result carries U+200F. Never type the date by hand.
3. **Source-text pins.**
   - `fleet-odometer.spec.tsx:1188,1190`;
   - `fleet-workshop-odometer-warning.spec.tsx:368`;
   - `fleet-vehicle-profile-alarm.spec.tsx:314-330`;
   - `fleet-vehicle-history-links.spec.tsx:374-382` (an accidents pin; stays) and the new violations pin.
   - Re-point these with the code, in the same package.
4. **Bidi.**
   - `ar-EG-u-nu-latn` dates keep the RLMs and lay out exactly as today in RTL. None of the 40 date sites sits in a `dir="ltr"` span, and the print sheets are `dir="rtl"`. Checked.
   - Rule for builders: never move a `latinDate` into an LTR span, and never switch to '-' separators.
   - In the letters, Latin digits after Arabic letters or the tatweel resolve to AN (rule W2). That is the same class as the Arabic-Indic digits, so «01ـ09ـ2026», «التاريخ29/ 09 / 2026», «5/10/2026» and «( 200,000)» keep their visual order.
5. **Fonts and print fit.**
   - Azeret Mono (NUM/MONO) has Latin glyphs only, so today's fallbacks disappear (DealershipInvoiceDialog:246, RecordOdometerDialog:385, DriverProfilePage:876).
   - On the letters, Latin digits come from Times New Roman / Liberation Serif instead of the U+0600-06FF paper alias (`shared/lib/paper-fonts.ts:21-22`).
   - Pagination is estimated by `text.length` (custody-paper-letters.ts:125), which is unchanged. Confirm with the letter picture.
6. **Parse-back.** None.
   - The inputs are prefilled with raw numbers, and typed digits are folded by `input-rules.ts:37`.
   - The server's accident refusal detail «1200.50» is parsed by `AccidentFormDialog.tsx:456`. It is untouched.
   - The input folds (notice-setup.ts:125-133, notice-render.ts:65-67, vehicle-code-match, receipt-cards) stay.
7. **Excel.** The date columns built with `formatDate` are TEXT cells. They become «07‏/11‏/2026», still text and still day-first. Numeric cells are untouched. Tell the owner.
8. **English.** The new helpers equal the shared English output, and the catalogue edits are Arabic-only. The custody letters are Arabic papers in both UIs, so an English-UI print changes digits. This is intended.
9. **Lint after the swaps.** Unused `locale` or `useAppSelector` (ZoomableImage keeps them for its default path), a now-unused `formatDate` import (VehicleDetailPage keeps `localized`), `useViolations` and `one` in VehicleDetailPage, and `ai` in the letters.
10. **i18n timing.** Additions are seeded at step 0. The flat-key removal happens only in the HUB's final step, after P2 and P3 have switched. Otherwise `translate` would return the bare key.
11. **A future Fleet image host that forgets `latinFigures`.** The guard catches it (§5.3(f)).
12. **Known limits, unchanged:**
    - native `<input type=date>` digits follow the browser's language;
    - typed free text (notes) shows as typed; only the letter's typed reason is folded;
    - the insurer form's pre-printed «٢٠٢» year box (notice-templates.ts:55) stays mixed, because it is the insurer's image.
13. **Formal Arabic.** The new values must pass `scripts/check-formal-arabic.mjs` and `formal-arabic.spec.ts`. The paper-engine files still carry no Arabic letter.
14. **Memory.** Run one vitest at a time. No package runs the full suite.

---

## 5. Specs

### 5.1 Re-point list (19 files)

| Package | Spec files |
|---|---|
| P1 | `image-zoom-preview.spec.tsx` (add, keep :76) |
| P2 | `fleet-vehicle-history-links.spec.tsx`, `fleet-vehicle-profile-alarm.spec.tsx`, `pages/licensing-screen.spec.tsx`, `fleet-drivers.spec.tsx` |
| P3 | `fleet-odometer.spec.tsx`, `fleet-maintenance.spec.tsx`, `fleet-maintenance-alarms.spec.tsx`, `fleet-workshop-odometer-warning.spec.tsx`, `fleet-maintenance-integration.spec.tsx` (optional) |
| P4 | `fleet-violations-split.spec.tsx`, `pages/receipts-screen.spec.tsx` |
| P5 | `lib/custody-paper-format.spec.ts`, `lib/custody-paper-letters.spec.ts`, `lib/custody-papers.spec.ts`, `pages/custody-fund-dialogs.spec.tsx`, `pages/custody-papers-setup.spec.tsx` |

These stay as they are and become stronger: `vehicles-licence-state.spec.tsx:419-437`, `roster-shared.spec.tsx:104`, `custody-memo-parts.spec.tsx:204` and the input-fold specs.

### 5.2 New specs

- P1: `lib/fleet-figures.spec.ts`.
- P2: the 3(a) and 3(b) tests in `fleet-vehicle-history-links.spec.tsx`, and the recommended API contract spec `apps/api/tests/integration/fleet-vehicle-violation-count.spec.ts`.
- P5: the typed-reason fold test.
- HUB: the guard.

### 5.3 Guard `apps/web/src/modules/fleet/fleet-latin-figures.spec.ts` (HUB)

It reads every non-spec `.ts`/`.tsx` under `modules/fleet`, with comments stripped (the idiom at `fleet-catalogs-vehicles.spec.tsx:723`).

- **(a) No shared digit helpers.** No import of `formatNumber|formatDate|formatDateTime|formatBusinessDateTime` from `…/shared/lib/format`, multi-line imports included.
  - Allowlist: `{ 'components/ZoomableImage.tsx': ['formatNumber'] }`, the Operations default path.
  - It asserts the allowlist entry is still needed, so it bites both ways.
- **(b) No digit-bearing `ar-EG`.** No `'ar-EG'`/`"ar-EG"` literal unless followed by `-u-nu-latn`.
  - NAME_ONLY allowlist: `components/fleet-dashboard/dash-blocks.tsx`, `components/fleet-dashboard/km-chart.tsx`, `components/fleet-dashboard/tab-fuel-chart.tsx`, `components/roster/roster-parts.tsx`, `lib/custody-memo-editor.ts`.
  - For each, the options object after `'ar-EG'` holds only `month: 'long'` or `weekday: 'long'` plus `timeZone`, with no `day|year|hour|minute|dateStyle|timeStyle|numeric|2-digit`.
  - Runtime probe: `monthName('2026-11-07','ar')` and `monthOfDay('2026-11-07','ar')` contain no `[٠-٩]`.
- **(c) No locale-default formatting.** No `toLocale(String|DateString|TimeString)\(\s*(\)|'ar'|locale)`, no `new Intl.(NumberFormat|DateTimeFormat)\(\s*('ar'|locale\b)`.
- **(d) No code-point digit builder.** `/fromC(?:harCode|odePoint)\([^)]*(?:0x066|0x06[fF])/` must not match, and there is no `٫` or `0x066B`. The input fold `notice-setup.ts:133` subtracts and does not call `fromCharCode`, so it is not caught.
- **(e) Catalogue.**
  - Parse the `ar` block of `i18n.ts`: keys matching `^\s*'(fleet\.[^']+)':`. Read each value through `translate('ar', key)`, which handles multi-line values.
  - No value may contain `[٠-٩۰-۹٫٬]`. Digit allowlist: **none**.
  - No value may contain «٪» (U+066A) except `fleet.licenseImage.zoomLevel` (Operations).
- **(f) Image hosts.** Every `<ZoomableImage` in Fleet non-spec source carries `latinFigures`.
- **(g) It bites.** A synthetic file text with `formatNumber } from '../../../shared/lib/format'` and a value «٣ سيارات» are both reported. `formatNumber(1000,'ar')` from shared still matches `/[٠-٩]/`, proving the shared helper did not move.

---

## 6. DARK pictures for the owner

All are Arabic, dark theme, Fleet only. Desktop is 1440×900 unless stated. Papers are white; the app chrome around them is dark.

1. **«السيارات»** `/fleet/vehicles`: the toolbar «N سيارة» in Latin (Q2).
2. **«التراخيص»** `/fleet/licensing`: the count beside the filters, in Latin (Q2).
3. **«الإخطارات»** `/fleet/notices`: «N إخطار» (Q2).
4. **The car record** `/fleet/vehicles/<id>`:
   - Pick a car that has old-book violations (`vehicleId` null, `vehicleCode` = its code, taken from the go-live data), 3 or more accidents and 11 or more workshop visits.
   - It shows the history rows «… قراءة/قراءات», «14 عملية», «3 حوادث», «المخالفات N» and «سائق نشط». All tiles are Latin.
5. **The same car's «المخالفات» link opened** `/fleet/violations?codes=X&dcodes=X`: the company half's «الإجمالي» lines and the drivers' badge. The caption gives the arithmetic: «N = الشركة a + السائقين b».
6. **Car print «بيانات السيارة»** («طباعة التقرير» on the record), print window at A4 width (~794 px): «تاريخ الانضمام للأسطول» and «انتهاء الترخيص» in Latin (Q1).
7. **Custody letter «استعاضه عهدة»** (the setup preview `/fleet/custody/memos/setup/…` or the ledger drawer):
   - «التاريخ29/ 09 / 2026», «(81,908) … ( 100,000)», «من 01ـ09ـ2026 الى الفتره 30ـ09ـ2026»;
   - the table «1 · كاوتش · 2,650 … الاجمالي 81,908».
   - Add a second shot of «تسويه عهدة» («(124,139.46)», «1 تجديد 5 سياره»).
8. **«صرف عهدة» dialog** on `/fleet/custody/dashboard`, under «نص الخطاب»: «( 200,000) … نظير 24 سياره تجديد».
9. **Dashboard** `/fleet` «نظرة عامة»: a control. It is already Latin, to show it is unchanged.
10. **Odometer** `/fleet/odometer`: the toolbar «N قراءة», plus the «تسجيل قراءة» dialog with «الخادم يتوقع 150,250 كم أو أكثر» and the warning «فترة بـ 0 كم».
11. **Fuel** `/fleet/fuel-cards`: the board, plus its «تصدير PDF» sheet with «تاريخ الانتهاء» in Latin.
12. **Roster** `/fleet/roster`: a control, already Latin.
13. **Maintenance** `/fleet/maintenance`: the exit dialog with «دخلت على 120,000 كم» and the counter warning «… يوم 07‏/11‏/2026».
14. **Image viewer** at 1024: the car licence preview from «السيارات», zoom readout «100%».
15. *(Optional)* The car record at phone width 390: the count tags wrap cleanly.

**Internal only, not for the owner:** Operations' «صورة إيصال الشحنة» viewer still reads «١٠٠٪».

---

## 7. To ask, or to tell, the owner

**Nothing blocks the build.** He has answered: all digits Latin in Fleet; identifiers, typed values and Excel numbers unchanged.

**Tell him (Arabic, in the summary):**
- Excel text dates become Latin, with the same order.
- His custody letters now print Latin digits, so they no longer copy Word's Arabic digits. The tatweel in the period dates stays.
- The date boxes in the browser show digits according to the browser's own language.
- The insurer form's pre-printed «٢٠٢» box cannot be changed.

**One optional question, only after the pictures:** «تحب نصحّح العدد في عناوين باقي شاشات الحركة كمان؟ (مثلاً «3 سيارات» بدل «3 سيارة») — اقتراحي: مش في التحديث ده». The recommendation is no. It is out of the requested scope, which covers the car record counts only.

---

## 8. Size estimate

- **Source:** about 41 files (1 new): P1 10, P2 9, P3 6, P4 11, P5 4, plus `i18n.ts`. Roughly 250 changed lines. Most are one-token swaps; the larger ones are VehicleDetailPage (§3), the ZoomableImage prop and the letter helpers.
- **Specs:** 17-19 files re-pointed and 3-4 new, about 450-650 lines. The custody letter and format specs are about 40% of that. The guard is about 150 lines.
- **i18n:** about 60 lines (40 plural entries added, 8 removed, 17 Arabic values edited, 1 new key).
- **Time:** step 0 takes about 10 min. Packages run in parallel, about 45-90 min each, with P5 and P2 the longest. HUB merge, guard, docs, the gate run alone and the 14 pictures take about 2 h.
- **API and contracts:** 0 source changes. One optional integration spec.
