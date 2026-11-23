## What & why

The owner's answers of 22 and 23 November about the digits, built exactly as answered and only in
«الحركة»: «اى ارقام خليها بالانجلش حتى لو عربى», for his own papers «اى ارقام بالانجلش», and «انا
عاوزك تعدل حاجات الحركة فقط»; on the car record, «أيوه صلحها» (the violations count) and «اه» (the
counts' grammar). His earlier «كل الأرقام عربي ما عدا الفلوس» is superseded and was never built.

1. **Every figure an Arabic reader sees in Fleet is written 0-9** — counts, dates and times,
   readings and kilometres, percentages, money, and the papers Fleet prints. One Fleet module,
   `lib/fleet-figures.ts` (`latinNumber`, `latinDate`, `latinDateTime`), is the Latin twin of the
   shared `formatNumber` / `formatDate` / `formatDateTime`: the same options, the same «—», the same
   English byte for byte; an Arabic date keeps the shared day-first order and its RLM marks
   («07‏/11‏/2026»). Every Fleet call of the shared digit helpers now calls it, except
   ZoomableImage's Operations default (item 2) and AlarmBadge's injected `formatNumber` prop
   (already Latin, `formatNumber={latin}`): the toolbar counts of eleven screens (Q2: «السيارات», «التراخيص», «الإخطارات»), the two dates
   of the car record's «طباعة التقرير» (Q1) and the driver's licence print, every Excel / PDF date
   column (text cells), the odometer and workshop dialogs, the violations boards, the makes'
   interval, the transfer log. The shared `format.ts`, `translate()` and every shared component are
   untouched, so every other module keeps its digits.
2. **The image viewers:** `ZoomableImage` gains an opt-in `latinFigures` prop
   (`fleet.licenseImage.zoomPercent` «{{value}}%»). All nine Fleet hosts pass it («100%»); the
   default path — Operations' `ShipmentReceiptImageCell` — still reads «١٠٠٪».
3. **The custody Word letters print Latin digits.** `custody-paper-format.ts` loses `ai`,
   `aiAmount`, `AR_ZERO` and `AR_DECIMAL`; amounts are `grouped()` («( 200,000)», «(81,908)»,
   «(124,139.46)»), serials `String(i + 1)`, dates their plain parts («التاريخ29/ 09 / 2026»,
   «5/10/2026»), the period still joined by the tatweel («01ـ09ـ2026»), and the typed reason is
   folded with `asciiDigits` («نظير ٢٤ سياره تجديد» prints «24»), with its decimal and thousands
   marks between two digits («١٢٫٥» prints «12.5», not «12٫5»). The letters never read the UI
   language, so an English-UI print changes too (intended), and a reprint re-formats the stored
   figure.
4. **The car record's «المخالفات» counts what its link opens** (§3(a) of the plan). The link opens
   both halves of «مخالفات السيارات» on the car's code (`codes` + `dcodes`); the count is now
   Σ `totalCount` of `useViolationRollup(undefined, [code], …)` → `GET
   /fleet/violations/rollup?vehicleCodes=<code>`, by code with the old-book rows, a statement
   «×5» counted five and a driver's fine one — the sum of the company half's «إجمالي السيارة»
   lines, which is its «إجمالي الشركة» lines plus the drivers' badge (each driver's fine is in
   «إجمالي السيارة» already, so it is never added twice). It was
   `useViolations({ vehicleId, pageSize: 1 }).meta.totalItems`: documents by id, so a «×5» read 1 and the old book was missed. Same permission (`fleetViolation.view`); no
   API change.
5. **The record's counts agree with their number** (§3(b)): `fleet.vehicle.count.{odometer,
   maintenance,accidents,violations}` become five forms each through `pluralKey`, the
   `fleet.custody.count.*` house style — «قراءة واحدة · قراءتان · 3 قراءات · 11 قراءة · 1,234
   قراءة», «3 عمليات · 14 عملية», «حادث واحد · حادثان · 3 حوادث · 11 حادثًا · 100 حادث», «مخالفة
   واحدة · مخالفتان · 3 مخالفات · 11 مخالفة». «سجل نظيف» and «سائق نشط» are unchanged. The odometer
   screen's toolbar read the same flat key, so it takes the same forms («73 قراءة»). English keeps
   its one form in all five slots («1 readings» included, as today).
6. **The catalogue:** every Arabic `fleet.*` value with an Arabic-Indic digit is written in Latin
   (17 values: «اعرض آخر 12 شهر», «فترة بـ 0 كم», «حتى 10 ميجابايت», «0 = لا قاعدة صيانة دورية»,
   «(من 1 إلى 30)», «أعلى 5 / أقل 5 سيارات», the go-live notice's ten values — its dates and the two car codes);
   `fleet.licenseImage.zoomLevel` keeps «{{value}}٪» for Operations. No English value changed.
7. **A module-wide guard**, `fleet-latin-figures.spec.ts` (plan §5.3 (a)-(g), widened in review
   with (h) and (i)): no shared digit helper (one allowlisted import, ZoomableImage's default,
   asserted still needed); no Arabic tag without `-u-nu-latn` (`ar-EG`, `ar-SA`, `ar-u-nu-arab`)
   beyond five name-only formatters, and no numbering system but `latn`; every digit-writing
   formatter (`Intl.NumberFormat` / `DateTimeFormat` / `RelativeTimeFormat` / `DurationFormat`,
   `toLocale…String`) names its tag — a quoted tag, a choice of quoted tags, or a constant bound
   to one — so never the reader's locale, none, or plain `'ar'`; no digit built from a code point
   (hex, decimal or another character's); no Arabic-Indic digit / «٫» / «٬» / «٪» in an Arabic
   `fleet.*` word or in any other word a Fleet source names (no allowlist but the Operations
   readout); every `<ZoomableImage>` with `latinFigures`; (h) no Arabic-Indic figure written into
   the code — literal, `\u0660` escape, `0x0660`, HTML entity — but six named lines that read typed
   input; (i) no shared component that writes the reader's digits (`Pagination`, `ListView`,
   `FileUploadList`, the `shared/ui` barrel — found by reading `shared/`), the fuel reconcile's
   picker allowlisted because it unmounts on pick; and (g) proves each rule bites and the shared
   helpers still give Arabic-Indic. The scans share one reader, `fleet-source-scan.ts`, with the
   image viewers' spec.

## ما يجب أن يعرفه صاحب الطلب

1. كل الأرقام في «الحركة» بقت أرقام إنجليزي حتى والسيستم عربي، زي ما قلت «اى ارقام خليها بالانجلش حتى لو عربى»: الأعداد اللي جنب الفلاتر، والتواريخ، وقراءات العداد والكيلومترات، والنسب، والفلوس، وورق الطباعة.
2. عدد السيارات فوق جدول «السيارات»، والعدد في «التراخيص» و«الإخطارات» بقوا بالأرقام الإنجليزي، وكمان العدد اللي جنب الفلاتر في «السائقون» و«التمامات» و«عدادات السيارات» و«صيانة السيارات» و«إنذارات الصيانة» و«التوكيل» و«خصم الإيصالات» و«مصروفات العهدة».
3. ورقة «طباعة التقرير» في سجل السيارة: «تاريخ الانضمام للأسطول» و«انتهاء الترخيص» بقوا بالأرقام الإنجليزي، وكمان تاريخ الرخصة في ورقة طباعة رخصة السواق.
4. «المخالفات» في سجل السيارة بقت بتعدّ نفس اللي بيفتحه الرابط بالظبط: مخالفات الشركة ومخالفات السواقين على كود السيارة، ومعاهم مخالفات الدفتر القديم اللي على نفس الكود. والبيان اللي عليه «×5» بيتعد 5 مش 1. يعني الرقم بقى = مجموع سطور «إجمالي السيارة» في جزء الشركة، وهو نفسه مجموع سطور «إجمالي الشركة» + عدد جزء السواقين (مخالفة السواق محسوبة جوه «إجمالي السيارة» أصلًا، فما تتجمعش مرتين). والرقم الصغير اللي جنب زرار المسح في جزء الشركة بيعدّ السطور (سنة × سيارة) مش المخالفات.
5. الأعداد في سجل السيارة بقت مظبوطة في العربي: «حادث واحد» و«حادثان» و«3 حوادث» و«11 حادثًا»، و«عملية واحدة» و«3 عمليات» و«14 عملية»، و«قراءة واحدة» و«3 قراءات» و«1,234 قراءة»، و«مخالفتان» و«3 مخالفات». «سجل نظيف» و«سائق نشط» زي ما هما.
6. شاشة «عدادات السيارات»: العدد اللي جنب الفلاتر اتغير كلامه مع سجل السيارة («قراءة واحدة» و«قراءتان» و«3 قراءات» و«73 قراءة»)، عشان الاتنين يفضلوا يقولوا نفس الكلام.
7. خطابات العهدة («صرف عهدة» و«استعاضه عهدة» و«تسويه عهدة») بقت بتطبع أرقام إنجليزي، يعني ما بقتش زي أرقام الوورد العربي بتاعتك: «( 200,000)» و«(81,908)» و«التاريخ29/ 09 / 2026». الشَرطة الطويلة بين أجزاء تاريخ الفترة («01ـ09ـ2026») زي ما هي. ولو كتبت السبب بأرقام عربي زي «نظير ٢٤ سياره تجديد» هيطلع في الخطاب «24»، ولو كتبت «١٢٫٥» هتطلع «12.5».
8. الخطابات دي هتطلع بالأرقام الإنجليزي حتى لو الشاشة إنجليزي، ولو طبعت خطاب لعملية قديمة هيطلع هو كمان بالأرقام الإنجليزي.
9. ملفات الإكسل: التواريخ اللي بتنزل كلام في الإكسل بقت أرقام إنجليزي بنفس الترتيب، اليوم الأول ثم الشهر ثم السنة («07/11/2026»). الخانات اللي فيها أرقام فضلت أرقام زي ما هي.
10. خانات اختيار التاريخ اللي بيفتحها المتصفح بتكتب الأرقام على حسب لغة المتصفح نفسه، ودي مش في إيدينا.
11. خانة السنة المطبوعة «٢٠٢» في استمارة شركة التأمين ما ينفعش تتغير، لأنها جزء من صورة الاستمارة نفسها.
12. نسبة التكبير في عارض الصور في «الحركة» بقت «100%».
13. أكواد السيارات وأرقام اللوحات والموبايلات والكروت، وأي حاجة بتكتبها بإيدك، فضلت زي ما هي.
14. مفيش أي حاجة اتغيرت برّه «الحركة»: الموارد البشرية والصراف الآلي والتشغيل والدهب وتقنية المعلومات وباقي السيستم زي ما هما بالظبط.

## Scope

- Type: feat (Fleet), the owner's digits answers of 22-23 November, Fleet only.
- New: `apps/web/src/modules/fleet/lib/fleet-figures.ts` (+ `lib/fleet-figures.spec.ts`); the
  guard `fleet-latin-figures.spec.ts` and the module source reader it shares with the image
  viewers' spec, `fleet-source-scan.ts` (not a spec, like `roster-spec-sources.ts`);
  `fleet-register-figures.spec.ts`, `fleet-workshop-figures.spec.tsx`; the API contract spec
  `apps/api/tests/integration/fleet-vehicle-violation-count.spec.ts`.
- Web, the figures (call-site swaps `formatNumber(x, locale)` → `latinNumber(x)`,
  `formatDate(x, locale)` → `latinDate(x, locale)`): pages `VehiclesListPage`, `LicensingPage`,
  `NoticesPage`, `DriversListPage`, `DriverProfilePage`, `AttendancePage`, `AccidentsPage`,
  `OdometerPage`, `MaintenancePage`, `MaintenanceAlarmsPage`, `DealershipPage`, `ReceiptsPage`,
  `CustodyPage`, `FuelCardsPage`, `FuelChargingPage`, `LicenseExpensesPage`; components
  `AccidentTransferLogDialog`, `RecordOdometerDialog`, `MaintenanceDialogs`, `VehicleTypesTable`,
  `CompanyViolationsPanel`, `CompanyViolationsDetailLayer`, `DriverViolationsPanel`,
  `DealershipInvoiceDialog`, `VehicleContractsExport`, `DriverLicenseImage`, `ReceiptImageCell`,
  `DealershipImageCell`.
- Web, the viewers: `ZoomableImage` (the opt-in prop) and its nine Fleet hosts (`NoticeImageCell`,
  `ReceiptImageCell`, `DriverLicenseImage` ×2, `VehicleLicenseImage`, `VehicleContractViewer`,
  `DealershipImageCell`, `FuelCardImage`, `number-repair/RepairThumb`); `lib/image-zoom.ts` comment.
- Web, the letters: `lib/custody-paper-format.ts`, `lib/custody-paper-letters.ts`;
  comments only in `lib/custody-paper-wording.ts` (no string changed, so the verbatim file reads
  the same) and `components/CustodyChargeDialog.tsx`.
- Web, the car record: `VehicleDetailPage.tsx` (its local Latin helpers moved to the module,
  `useHistoryCounts` on the rollup, `countTag` through `pluralKey`, the print sheet's two dates).
- i18n (`platform/localization/i18n.ts`): +40 plural entries (20 per language), +2
  `fleet.licenseImage.zoomPercent`, −8 flat `fleet.vehicle.count.*`, 17 Arabic-only values, one
  comment. English block diffed against the base: only those additions and removals.
- Specs re-pointed to exact Latin strings (none loosened, none skipped): `fleet-vehicle-history-links`,
  `fleet-vehicle-profile-alarm`, `pages/licensing-screen`, `fleet-drivers`, `fleet-odometer`,
  `fleet-maintenance`, `fleet-maintenance-alarms`, `fleet-workshop-odometer-warning`,
  `fleet-maintenance-integration`, `fleet-violations-split`, `pages/receipts-screen`,
  `lib/custody-paper-format`, `lib/custody-paper-letters`, `lib/custody-papers`,
  `pages/custody-fund-dialogs`, `pages/custody-papers-setup`, `image-zoom-preview` (Operations'
  «١٠٠٪» kept), plus the optional `fleet-attendance` / `fleet-catalogs-vehicles` checks.
- Outside Fleet: `ZoomableImage`'s Operations default is unchanged; `formal-arabic.spec.ts`
  comments only (the letters no longer build digits from code points; the test is the same).
- Docs: CHANGELOG `[Unreleased] › Changed`; `docs/12-planning/fleet-module-design.md` §12
  «Figures: Latin digits in both languages (2026-11-23)» + revision 1.27.
- Not touched: `shared/lib/format.ts`, `translate()`, every shared/platform component, the API
  source, the contracts, the data (no migration), permission keys, every other module.

## Review checklist (Development Workflow §4)

- [x] Layer rules respected (thin controller, logic in service, data access in repository) — no
      API source changed; the count reads the existing rollup endpoint through its existing hook.
- [x] No cross-module imports; features imported via `index.ts` only — none added; the one
      cross-module file (`ZoomableImage`, rendered by Operations) gains an opt-in prop whose
      default is today's behaviour.
- [x] Permissions declared + route `authorize(...)` present; frontend gated with `<Can>` — no key
      changed; the record's count keeps `fleetViolation.view`, the list's own permission.
- [x] Zod validation at every new boundary; types inferred, not duplicated — no new boundary.
- [x] Mutations audited; events named per convention; reliable tier where business-critical — no
      mutation changed.
- [x] Tests: unit for rules, integration for endpoints (happy + authZ + validation) — the figures
      module, the guard, the letters and the count forms are unit-tested; the record's count is
      pinned against the API in `fleet-vehicle-violation-count.spec.ts` (rollup 7 = statements 5 +
      drivers 2, the old figure 2; soft-deleted, neighbouring and `2000`/`20` old-book rows excluded),
      and on the screen in `fleet-violations-split.spec.tsx`: the link's board, on the record's
      data, adds up to the record's figure («إجمالي السيارة» = «إجمالي الشركة» + the drivers'
      count) and asks the drivers half for the code alone.
- [x] ar + en translations; RTL-safe layout — Arabic-only value edits; the plural forms in both
      languages; dates keep `ar-EG`'s RLM marks and no `latinDate` sits in an LTR span; formal
      Arabic check green.
- [x] Docs updated in this PR (permission matrix, DB design, CHANGELOG, ADR if architectural) —
      CHANGELOG and the Fleet design (§12 + revision 1.27); the permission matrix and DB design are
      unchanged (no key, no schema).

## Verification

The CI gate in CI order (`CI=true`, `.wip-notes/digits/gate.sh`), run alone on the final tree
under the machine-wide lock, green on the first run:

| step | result |
|---|---|
| clean room (no `zz-*` under `apps/`) | 0 files |
| `check-secrets` | rc 0 |
| contracts build | rc 0 |
| lint (root, `apps/api`, `apps/web`) | rc 0 |
| typecheck (every workspace) | rc 0 |
| `gen-permission-matrix --check` | rc 0 — unchanged |
| `check-flag-expiry` · `check-page-registry` · `automation-templates` | rc 0 |
| `check-formal-arabic` | rc 0 |
| contracts tests | 54 files, 1,374 tests passed |
| api tests (integration included) | 711 files, 12,234 tests passed |
| web tests | 618 files, 14,608 tests passed |
| build | rc 0 |
| `dependency-audit` | rc 0 |

Also, before the gate, each package's own specs one file at a time (hand-offs P1-P5), the guard
alone (15 tests) and with a planted offender (`zz-probe.tsx`: a shared `formatDate`,
`toLocaleString()`, `'ar-EG'`, `fromCharCode(0x0660 + n)` and a viewer without `latinFigures` —
(a), (b), (c), (d) and (f) each failed; the probe was deleted), and the English block of
`i18n.ts` diffed against the base. Inside the web suite, `money-format.spec.ts` (the shared
Arabic-Indic money, untouched), `formal-arabic.spec.ts` and the guard pass.

## Notes for reviewers

- **English is byte-identical.** `latinNumber` equals shared `formatNumber(…, 'en')` and the
  dates equal shared `formatDate` / `formatDateTime` in English (pinned in
  `lib/fleet-figures.spec.ts` and the guard); the catalogue edits are Arabic-only. The one English
  change is the custody letters, which are Arabic papers in both UIs.
- **Why distinct names (`latin*`)** and not a swapped `formatNumber`: `fleet-vehicle-profile-alarm`
  forbids `formatNumber(` on the car page, `registers-parity` scans `'formatDate(row.date'`, and
  the guard can then forbid the shared names outright. The guard reads imports, not the bare word:
  `MaintenanceAlarmsPage` passes AlarmBadge an injected prop named `formatNumber={latin}`.
- **Excel**: numeric cells are untouched; the date columns were text cells built with
  `formatDate` and stay text, now «07‏/11‏/2026».
- **The violations count** reads the rollup by code with the same query key the un-narrowed
  violations board builds, so opening the link after the record serves the board from the cache. A fresh
  `[vehicleCode]` per render does not refetch (the key is built from strings).
- **Deviations from the plan, all within its intent:** `VehicleDetailPage`'s digits note is a `//`
  block (as JSDoc it would attach to `Indicators`); the odometer delete prompt drops its own null
  check (`latinNumber` already gives «—»); `AttendancePage` and `RecordOdometerDialog` lose their
  now-unused `locale` / `useAppSelector` (lint); `formal-arabic.spec.ts` gets a comment-only fix
  (outside Fleet, from the P5 hand-off); four Fleet comments that quoted the screen in
  Arabic-Indic now quote it in Latin, and one spec title («اعرض آخر 12 شهر»). From the review:
  the guard gains rules (h) and (i) and wider (b), (c), (d) and (e) than §5.3; the letter's typed
  reason also folds «٫» / «٬» between two digits (P5's optional fold, two regex lines named in
  rule (h)); the image viewers' spec and the guard read tags through one shared reader; and the
  «المخالفات» arithmetic is written with the board's own labels («إجمالي السيارة» = «إجمالي
  الشركة» + the drivers' count) — the first draft said «الإجمالي» plus the drivers, which counted
  a driver's fine twice.
- **Typed text:** the letter's typed reason folds its digits and the «٫» / «٬» between two of
  them («٢٤٫٥» prints «24.5»); typed notes elsewhere show as typed.
- **prettier**: a few touched files (`VehiclesListPage`, `AttendancePage`, `VehicleLicenseImage`,
  `lib/image-zoom.ts`, `CompanyViolationsPanel`, `CompanyViolationsDetailLayer` and some specs)
  were already not prettier-clean at the base in lines this PR does not touch; only the new hunks
  are formatted. CI does not run `prettier --check`.
- **Pictures for the owner** (plan §6, dark, Arabic) are taken after this gate and are not part of
  the diff.

---
🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01KFPypEQevKkuq5Lx1xvJ1B
