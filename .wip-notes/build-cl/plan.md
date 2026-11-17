# PLAN — one PR: «العهدة» (design _7) + «التراخيص والتجديدات» (design _8)

Owner's order (2026-11-17): «اعمل «العهدة» و«التراخيص والتجديدات»». Build, in ONE PR, the last two approved screens for real:
- «العهدة» — DECISIONS §9 (17 critic corrections A1–D1/E1–E3; Q1 (أ) period card = total + where that spend stands NOW
  «تمت الاستعاضة» / «في مذكرات لم تُستعَض» / «خارج المذكرات»; Q3 offered only). Approved cust-dark / cust-branch-dark; harness
  ZC. A NEW tab right after «الوقود والمصروفات» (no old tab of its own). It is a restyle of «لوحة تحكم العهدة»
  (`/fleet/custody/dashboard`): same formula, same titles, same reads.
- «التراخيص والتجديدات» — DECISIONS §11 (21 critic corrections A1–A6/B1–B9/C1–C6; Q2 (أ) full-width «أقرب رخص السائقين» with names;
  Q1 told: fuel-card expiry stays on «الوقود والمصروفات» with one line here; Q3 told: no insurance policies / inspection / driver files).
  Approved lic-dark / lic-branch-dark; harness ZL. It REPLACES the old «التراخيص وآخر ما سُجّل» body under the same key `licences`; the
  pill becomes «التراخيص والتجديدات».
- Final bar (12 pills): نظرة عامة · الحركة اليوم · توزيع السيارات · الصيانة والورش · العدادات والكيلومترات · الحوادث ومطالبات التأمين ·
  المخالفات المرورية والتسويات · الوقود والمصروفات · العهدة · التراخيص والتجديدات · أرقام الفترة · ملخصات. «أرقام الفترة» and «ملخصات»
  STAY exactly as they are (the owner decides their retirement later). Nobody loses a figure without being told; no dead link; never a fake
  figure; licensing-only readers keep `/fleet` (§11 A2).

NOT in this PR: the user's second ask in the same message («واعمل ديزاين شاشة الطاقم الثابت زى التعيين اليومى») is a separate SAMPLE workflow
(wak5bhhnz, worktree /home/user/egycash-fx, notes fixed-crew/), recorded in DECISIONS 2026-11-17. Nothing of it touches this tree.

Read-only plan. Nothing in /home/user/egycash-dash was edited. Paths relative to /home/user/egycash-dash unless absolute. Shared rules
follow build-plan/{plan,critic,shell,drift}.md and the #727/#728 builds (build-ka/, build-vf/); where they disagree with this file, THIS
file wins (every line number below was re-read today in the build tree at 21995fd4f).

Short forms: C / CS = packages/contracts/src/modules/fleet-dashboard{,.spec}.ts · CF = packages/contracts/src/modules/fleet.ts ·
NS / PS = apps/api/src/modules/fleet/dashboard/{now,period}.service.ts (NSS / PSS their .spec.ts) · HY = …/dashboard/dashboard-hygiene.spec.ts ·
CFS = apps/api/src/modules/fleet/custody/custody-fund.service.ts · CS2 = …/custody/custody.service.ts · CMR = …/custody/custody-memo.repository.ts ·
COR = …/custody/custody-operation.repository.ts · RR / RS = …/receipts/receipt.{repository,service}.ts · LER / LES =
…/license-expenses/license-expense.{repository,service}.ts · VR = …/vehicles/vehicle.repository.ts · LS = …/licensing/licensing.service.ts ·
DPS = …/driver-profiles/driver-profile.service.ts · INT / PAR / PERF / READS = apps/api/tests/integration/fleet-dashboard{,-parity,-performance,-reads}.spec.ts ·
W = apps/web/src/modules/fleet · FD = W/components/fleet-dashboard · FDP = W/pages/FleetDashboardPage.tsx · CFL = FD/custody-fund-line.tsx ·
CLF = W/lib/custody-dashboard-fund.ts · CDF = W/components/CustodyDashboardFund.tsx · LP = W/pages/LicensingPage.tsx ·
T / U / L = W/lib/fleet-dashboard-{tabs,url,links}.ts · I = apps/web/src/platform/localization/i18n.ts · RT = apps/web/src/platform/realtime/invalidation-registry.ts ·
FX / PFX = W/fleet-dashboard-fixtures.ts / W/fleet-dashboard-period-fixtures.ts · NT / PT / SH / LC / LS / RF / GT / TP / VCC / OV =
W/fleet-dashboard-{now-tabs.spec.tsx, period-tabs.spec.tsx, shell.spec.tsx, link-census.spec.ts, links.spec.ts, refresh.spec.ts, gates.spec.ts,
target-params.spec.tsx}, W/fleet-vehicle-card-census.spec.tsx, W/fleet-dashboard-tab-overview.spec.tsx · RFC = apps/web/src/shared/lib/remembered-filters-coverage.spec.ts ·
ZC / ZL = /home/user/egycash/apps/web/src/zz-custody-tab.tsx / zz-licences-tab.tsx (approved harnesses: words, order, tones, notes are approved;
figures are mock; they were written against the OLDER egycash tree, so a key they read may be gone here — see D27) · CL =
/tmp/claude-0/-home-user/85f289ec-521b-5944-9b89-a0120b22d71a/scratchpad/stitch-dash/build-cl.

---

## 0. Base, verified today (2026-11-17)

- Tree /home/user/egycash-dash, branch `claude/fleet-progress-status-yvgr3f`, HEAD `21995fd4f` (= main after #728 b1cc9d36), `git status`
  clean, node_modules present, no zz file in the tree.
- C (1640 lines): `FLEET_DASHBOARD_TABS` :52-64 (11: … `fuel`, `period`, `summaries`, `licences`); `TAB_READS` :70-88 (`licences: ['now']`,
  `summaries: ['now','web']`); `PERIOD_TABS = ['period']` :96; `RECENT_DAYS/ROWS` :113-114; `LICENCE_ROWS = 6`; NOW sections :364-386
  (incl. `licenceVehicles, licenceDrivers, papers, …, recentWorkshop :379, recentAccidents :380`); PERIOD sections :387-399; PART sections
  `['supplyContracts']` :407; gates :443-494 (`papers` = the ONLY `fleetLicensing.view` gate :455; `custodyFund` 'web' :492); key unions
  `keysOfRead` :515-536 (PART sections out); `TAB_SECTIONS` :542-623 (`licences: [licenceVehicles, licenceDrivers, papers, fuelCards,
  recentWorkshop, recentAccidents]` :571-578; `summaries: ['fuelCharging','custodyFund','accidentsOpen','violationsYear']`; `period: [km,
  visits, accidents, opex, dealership]`); `TAB_PARTS = { distribution: ['km','supplyContracts'] }` :629-635; R1 DTO :694-770
  (`recentWorkshop/recentAccidents` :740-741); `FleetDashboardNowLicenceVehiclesDto` :1062-1072 (list rows `{vehicleId, code, expiresAt,
  days}` only); `…LicenceDriversDto` :1075-1083 (counts only); recent DTOs :1163-1190; R2 `opex` :1305-1330 (`card, custody, fuel, total,
  count, dataFrom, fuelCustody, tyres, wash, maintenance, litres, unpricedFuel` — card receipts are fuel only, so custody = fuelCustody +
  tyres + wash + maintenance).
- CF: `FleetCustodyFundSummaryDto` :6126-6149 (`held: {count, amount, memos, receipts}` — no letter day, no memo list); replenish
  candidates :6150-6155 (pending memos only, oldest `no` first); settle candidates :6157-6174 (`parts[]` with kind, date, cars, codes, visa,
  cash, total); `FleetCustodyMemoRowDto` :5737-5758; `FleetCustodyOutsideKindDto` :5797-5808; ledger row :6073-6115; `FLEET_CUSTODY_LEDGER_OPS`
  :5914 (`charge, replenish, settle, spend`); `FLEET_CUSTODY_MEMO_STATE_OF_STATUS` :5619 (held → pending); `FleetReceiptTotalsDto` :4977-4990
  (no custody count); `FLEET_CUSTODY_SOURCES = ['maintenance','fuel','tyres','wash']` :4997 (the custody order).
- API: NS `licenceVehicles` :758-796 ('screen' scope; `VR.nearestLicences` :406-439 selects `code, licenseExpiresAt` only); `licenceDrivers`
  :798-801 (`driverRegistry` memo :116-134 → `DPS.registryDigest` :272-326 — profiles in memory, suspended included, no list, no months);
  `papers` :803-806 (`LS.openPaperCounts` :103, read-only); `recentWorkshop` :889-896, `recentAccidents` :898-905 (`recentSince` :113-114).
  PS `opex` :198-221 (`fleetReceiptService.summaryOver`), no custody count, no memo states. RR `totals` :129-187 (`$group` by kind+source with
  `count`); CS2 `memoStatuses` :118-139 (one memo read → `custodyMemoStatusOf`), `custodyMemoStateOf` (custody-dashboard.ts:208). CFS
  `summary` :288-315. LER `totals` :234-254 (visa + cash over BOTH parts; no per-part sum), `linesTotalExpression` :39-52,
  `CARS_COUNT_EXPRESSION` :54-60; LES `expenseFilter` :147-178 (`date $gte from, $lt to+1`). Indexes already there: vehicles
  `ix_license_sweep {status, licenseExpiresAt}`; receipts `ix_receipt_source_date`; licence expenses `ix_license_expense_date`; custody
  operations `ix_custody_operation_kind {kind, date}` and `ix_custody_operation_memo`. NO new index is needed.
- Web: FDP `REMEMBERED_FILTERS` :96 (§0c done); `dashboardReads` :116-125 (`period` = any PERIOD key); `MIXED_PANELS` :130-136 (maintenance,
  km, accidents, violations, fuel); `MIXED_PERIOD_SECTIONS` :143-149 (lists); `NOW_PANELS` :154-163 (overview, today, distribution, licences,
  summaries); mixed branch :270-313 (stamps/refresh from R1 only); `FleetDashboardPage` :382-390 mounts `CustodyFundSource` only with
  `fleetCustody.view`. CFL :1-74 hands over `lines` as a NUMBER only, `fundTotal`, `waiting`, `settle`; NT :273-276 pins
  `useCustodyFundAlerts(` to CFL alone; NT :257-270 no-count scan over `^(tab-|dash-|custody-|period-)`. T `tabBadges` :132-148 (licences
  red badge, PLAIN «0» at zero :144). U `LEGACY_TABS` :115-122 (`licences` not mapped — it opens the tab). dash-shell `SHORT` :152-154
  (`licences` pill shows «التراخيص»). L: `custodyDashboardLink` :86 (PATH_ONLY), `nowLinks` :175 (licence windows :215-249, `licensing(paper)`
  `?sort=asc` :434-435, `visitDay/accidentDay/accidentsRecent/visitsRecent` :440-466 — old body only), `periodLinks` :526
  (`opexCustody()` D20 :599-609). RT `fleet.licenseExpense` :516-519 (no dashboard key), `fleet.custodyMemo` :539-542 and
  `fleet.custodyOperation` :543-546 (no dashboard key). I: shell labels en :6654-6675, ar :21338-21359 (`tab.licences` «التراخيص وآخر ما
  سُجّل», `tabShort.licences` «التراخيص», `badge.licences` «تراخيص ورخص منتهية: {{count}}»); old body keys `fleet.dash.licences.*` ar
  :21611-21667 (read only by FD/tab-licences.tsx and two specs).
- The OLD «التراخيص» body (FD/tab-licences.tsx, 898 lines) holds four cards: «تراخيص السيارات» (3 window buckets + mix bar + out-of-service
  line + ≤ 6 rows + «+N»), «آخر ما سُجّل» (recentWorkshop + recentAccidents, 30 days), «رخص السائقين» (3 windows + «بلا تاريخ» + «بلا ملف
  سائق»), «أوراق التراخيص وكروت الوقود» (insurance open, tax open, cards expiring within W). Every figure's new home is §2.
- Approved pictures re-read (dark, company + «المهندسين»): bar = … الوقود والمصروفات · **العهدة** (no count) · **التراخيص والتجديدات 2**
  (red); the custody «الآن» band head carries LiveChip + «من بداية العهدة» (+ «الشركة كلها» under the branch); the licences «الآن» band carries
  LiveChip only, and its period band head «الشركة كلها» under the branch. ZC/ZL mock TODAY 2026-11-12 (one mocked day serves both shots).
- CI: .github/workflows/ci.yml, 15 steps (§11); last green local run build-vf/fix/gate/out/summary.txt (all rc=0); dependency-audit zod
  waiver valid until 2026-11-26.

---

## 1. Decisions this plan takes

| # | Item | Decision | Why |
|---|---|---|---|
| D1 | Keys | NEW `custody`. `licences` KEPT (an old `?tab=licences` link opens the new body). No legacy mapping change. | task; §11 |
| D2 | Bar | 12 pills, order of the header above. `fleet.dash.shell.tab.custody` «العهدة» / 'Custody' (NEW); `fleet.dash.shell.tab.licences` CHANGES to «التراخيص والتجديدات» / 'Licences and renewals'; dash-shell `SHORT.licences` removed (the pill shows the full approved name, the strip already scrolls with its cue); `tabShort.licences` dropRead. | approved pictures |
| D3 | Panel kinds | BOTH become MIXED (`MixedTabProps`): `TAB_READS.custody = ['web','period']`, `TAB_READS.licences = ['now','period']`. FDP `MIXED_PANELS += { custody: CustodyTab, licences: LicencesTab }`, `NOW_PANELS` loses `licences`; `MIXED_PERIOD_SECTIONS.custody = ['opex']`, `.licences = ['licenceSpend']`. The mixed branch learns its «الآن» read from TAB_READS: 'now' → R1 (as today); 'web' → the custody figures (`custody.updatedAt` in the age, `custody.refetch()` + R2 on «تحديث», `custody.fetching` in `refreshing`, no `nowPending`). | the only web+period tab |
| D4 | Visibility | `TAB_SECTIONS.custody = ['custodyFund']`, `TAB_PARTS.custody = ['opex','custodyStates']` (the period band is drawn BESIDE the fund, never makes the tab show: a receipts-only reader keeps the custody spend on «أرقام الفترة» and the fuel bars, and gets no «العهدة» whose screens they cannot open). `TAB_SECTIONS.licences = ['licenceVehicles','licenceDrivers','papers']`, `TAB_PARTS.licences = ['licenceSpend']`. `fuelCards`, `recentWorkshop`, `recentAccidents` leave `licences` (§2). | critic E2, A2 |
| D5 | Access | `papers` stays (gate `fleetLicensing.view`) → a licensing-only reader keeps `/fleet` and sees «التراخيص والتجديدات» with the papers KPI alone, no period band (sends no R2). NEW contract list `FLEET_DASHBOARD_PAGELESS_SECTIONS = ['licenceSpend']`: its key reads R2 (`PERIOD_KEYS += fleetLicenseExpense.view`) but is left out of `PAGE_KEYS` (a licence-expense-only reader does NOT gain `/fleet`). `custodyStates` gate = api `['fleetReceipt.view','fleetCustody.view']`, page `['fleetCustody.view']` → `PERIOD_KEYS += fleetCustody.view`; `PAGE_KEYS` and the NOW union unchanged as SETS (pin). FDP `dashboardReads.period` becomes «some PERIOD section fully permitted» (`FLEET_DASHBOARD_PERIOD_SECTIONS.some(sectionPermitted)`), so a custody-only reader still sends no R2 (identical behaviour). | §11 A2; critic E2 |
| D6 | Badges | «العهدة»: none (approved). «التراخيص والتجديدات»: n = `licenceVehicles.expired` + `licenceDrivers.expired`, red, HIDDEN at 0 (today a plain «0»); a reader with one section gets that part; neither → no badge; tooltip reuses `fleet.dash.shell.badge.licences`. = the tab's two red KPIs = the overview's two red action lines. | §11 badge rule |
| D7 | Custody NOW reads | Only the custody screen's own hooks: CFL keeps the ONE `useCustodyFundAlerts(` call (NT pin) and now also hands over the alert LINES, the fund summary, the replenish and settle candidates (`detail`) and `fetching`; existing fields (`lines` count, `fundTotal`, `waiting`, `settle`, `loading`, `error`, `updatedAt`, `refetch`) unchanged → «ملخصات» and the overview identical. The chart + table read `useCustodyLedger(CUSTODY_LEDGER_PARAMS)` (CDF :120, same cache as «لوحة تحكم العهدة») from the tab itself (mounted only on the tab, only with `fleetCustody.view`). | D3 (the custody pages' own reads) |
| D8 | Custody server additions | (a) `FleetCustodyFundSummaryDto.held.letters` (NEW, required): each replenishment waiting for its transfer, oldest letter first: `{id, date, from, to, amount, receipts, memos[{id,no,kind,name,date,receipts,total}]}` — the held card's letter line, period, age and memo rows (the gap map's `held.oldest` = `letters[0].date`). (b) `FleetReceiptTotalsDto.custodyCount` + R2 `opex.custodyCount` («236 إيصالًا»). (c) NEW R2 section `custodyStates {replenished, pending, outside}` = the `memoStates` rule over the SAME custody receipts `opex.custody` counts (same filter, period, type/operation/codes, branch via the receipt's car); a held memo counts as pending; Σ = `opex.custody`. No fund-movements-in-period read (Q3 offer only). | §9 Q1 (أ), critic B1/E2 |
| D9 | Custody «الآن» layout | ZC order (NowBand :3118): strip ×5 with operators at every width (`− + − =`), no «استعاضة معلّقة» line on the strip (C5); row ×3 «تنتظر الاستعاضة» · «استعاضة معلّقة» · «تنتظر التسوية» (amber «waits» edge; tiles sky / amber / emerald, C2); full-width «تنبيهات العهدة» (firing lines only); full-width chart «إجمالي العهدة بعد كل عملية» (brand step line, red below 0, held/cancelled rows not drawn); full-width «آخر عمليات العهدة» (newest 6). Band head: LiveChip + «من بداية العهدة» (`fleet.custody.dashboard.fund.scopeSince`) + `CompanyWide` when NARROWED (`scopeBranches !== null` from R1 or R2's echo — a chosen branch AND «كل فروعي», E1). | approved; critic C1/C2/C5/E1 |
| D10 | Custody lists | Pending memos («في مذكرات لم تُستعَض بعد») and settle parts («تنتظر التسوية»): ≤ `FLEET_DASHBOARD_CUSTODY_WAIT_ROWS = 6` rows each (oldest first, the candidates' own order), then «و N أخرى ←» (N = lib count − 6; → `memos?status=pending` / `license-expenses?status=waiting`). Held letters: all (rare), each with all its memos. The approved pictures draw 2 / 3 / 1 — under the cap (told). | critic B2 |
| D11 | Custody ages | Whole UTC days from the board's day (`custodyAgeDays`, CLF :24-35), «منذ N يومًا»; AMBER with a clock past 30 (`custodyIsLate`); red only for the fund's «−X», alert (a) and alert (e). The held card's «في انتظار التحويل منذ N أيام» from `held.letters[0].date`. | critic A3, E3 |
| D12 | Custody PERIOD | Sky KPI «مصروفات العهدة» (tag «بيوم ورقة الإيصال»): `opex.custody` + chip `opex.custodyCount` receipts + «منها حتى الآن:» three lines from `custodyStates` (plain figures) + foot «عرض مصروفات العهدة ←»; beside it «مصروفات العهدة حسب النوع» brand bars in the CUSTODY order صيانة (`opex.maintenance`) · وقود من العهدة (`opex.fuelCustody`) · كاوتش (`opex.tyres`) · غسيل (`opex.wash`), amount (linked) + one-decimal share (`shareText`), chip = `opex.custody`, note «النسبة من مصروفات العهدة؛ الترتيب ثابت.»; under both the B4 sentence + `tabLink('fuel', …)` «الوقود والمصروفات ←» (keeps the period; plain text when the reader cannot see the fuel tab). The bar under the band head is the FULL page bar (type / operation / codes narrow it, as approved). States band drawn only when `custodyStates` is permitted (else the KPI without «منها»). | §9 Q1 (أ); C3/C4/C7 |
| D13 | Custody links | Read parameters only; never `?fund=`, never `letter=1`, never a bare list (C6): strip tiles → `/fleet/custody/log?op=charge|spend|replenish|settle`, fund tile → `log?sort=date:desc`; waiting total → `/fleet/custody/dashboard` (PATH_ONLY); held part → `memos?status=held` (B3); pending part → `memos?status=pending`; outside part → `/fleet/custody/dashboard`; each outside kind amount → `memos?kind=<kind>`; held amount + each letter «فتح» → `log?open=<id>`; settle total → `license-expenses?status=waiting`, each part «فتح» → `license-expenses?kind=<part>&status=waiting` — both ONLY with `fleetLicenseExpense.view`, else plain; alert (a) → `log?sort=date:desc`, (b) → `memos?kind=<kind>`, (c) → `memos?status=pending`, (d) → `license-expenses?kind&status=waiting` (LE view), (e) → `license-expenses?status=waiting` (LE view); table row «فتح»: operation → `log?open=<id>`, «صرف» run → `/fleet/custody-expenses?from&to` (CLF `custodyPeriodLink`); table foot «عرض سجل العهدة» → `log?sort=date:desc`; period total / bars → D20 rule: `/fleet/custody-expenses?[source=<k>&]from&to[&vehicleCodes]` when nothing but codes narrows, else `/fleet/receipts?[kind=<k>&]source=custody&from&to&type&operation&branch&vehicleCodes` (C7). | critic B3/C6/C7 |
| D14 | Licences «الآن» | Six KPIs, cars row over drivers row (ZL NowKpis :1631-1815): «تراخيص سيارات منتهية» red (figure → expired window; ≤ 3 CarChips of the expired list rows with «منتهٍ منذ …» + «و N أخرى» (N = expired − 3); sub «لا تُحسب ضمن السيارات الجاهزة للتشغيل» + «· وخارج الخدمة N» only when > 0) · «تراخيص تنتهي / خلال {W} يومًا» amber (figure → expiring window; «ومن {W+1} إلى 60 يومًا: N ←» → soon window, hidden when W ≥ 60; foot «مدة التنبيه من «إعدادات الحركة»، وحدّ 60 يومًا ثابت») · «أوراق لم تُستلم بعد» violet («تأمينات N» · «ضرائب N», no total, each → `licensing?paper=…`; sub «في لوحة التراخيص»; foot = the board's sentence «الورقة مفتوحة إذا عُلّمت خانة واحدة فقط من خانتَي التسليم والاستلام.») · «رخص سائقين منتهية» red (figure → drivers expired; ≤ 3 names of the expired rows → their files, «منتهٍ منذ …», + «و N أخرى»; foot «لا يُحسبون ضمن السائقين المتاحين اليوم») · «رخص تنتهي / خلال {W} يومًا» amber (+ «ومن … إلى 60 يومًا»; same settings foot) · «بيانات رخص ناقصة» amber («رخصة غير مسجّلة N» → `drivers?licExp=none&branch`; «بلا ملف سائق: N» plain; foot «تاريخ الرخصة من ملف السائق في الحركة»). Then the line «انتهاء كروت الوقود يظهر في «الوقود والمصروفات» ←» (only when the fuel tab is visible) and, when narrowed, «السائقون حسب فروعهم في الموارد البشرية، لا حسب فرع السيارة.» Each KPI under its own section (cars `licenceVehicles`, drivers `licenceDrivers`, papers `papers`); `W` = each section's `warnDays`, through the counted noun. | §11, critic A4/A5/B4/B5/B6/C6 |
| D15 | Licences chart | Full width «التراخيص المستحقة للتجديد — 12 شهرًا» (ZL MonthChart :1867-2087): 12 slots from this month (server keys), per slot TWO columns — cars `TONE.brand.bar`, drivers two steps lighter (dark 500→300, light 600→400, DECISIONS §11 rule) — value on top, never a month total; «هذا الشهر» marked by a word under the axis label + a faint band, never by a shade (B7); readout row (month · «هذا الشهر» · «N سيارات» · «N سائقين»); legend «تراخيص السيارات» · «رخص السائقين»; foot «عمودا الشهر لا يُجمعان. ما انتهى قبل هذا الشهر في …»; a column opens its month: cars `vehicles?status=active&licenseMonths=YYYY-MM` (C1), drivers `drivers?licExpFrom=YYYY-MM-01&licExpBefore=<last day>&branch`. A series is drawn only with its section; the phone scrolls inside the card from this month. | §11, critic B7/C1 |
| D16 | Licences tables | Full-width «أقرب تراخيص السيارات» (ZL CarsTable :2166-2274): chip = expired + expiring + soon; cols السيارة (CarChip + make) │ الترخيص (licence class) │ تاريخ الانتهاء (date in red / amber ≤ W / neutral) │ المتبقي (pill «منتهٍ اليوم» / «منتهٍ منذ …» red, «بعد …» amber ≤ W, grey after) │ أوراق الترخيص (violet tags «تأمينات لم تُستلم» / «ضرائب لم تُستلم», «—» else; COLUMN drawn only with `fleetLicensing.view`) │ «فتح» → `/fleet/vehicles/:id`; ≤ 6 rows; «عرض الباقي (N) ←» → vehicles within 60. Full-width «أقرب رخص السائقين» (ZL DriversTable :2288-2395): chip = drivers expired + expiring + soon; cols السائق (DriverIdentity: initials + name + code from `/fleet/people`) │ درجة الرخصة (catalog name) │ تاريخ الانتهاء │ المتبقي │ «فتح» → `/fleet/drivers/:profileId`; a suspended file carries the roster word «الملف موقوف» (C4, not drawn in the picture — told); ≤ 6 rows; «عرض الباقي (N) ←» → drivers within 60 + branch. Phone: rows stack as blocks. One spelling per state: «منتهٍ» (B8). | §11 Q2 (أ), B8, C4 |
| D17 | Licences PERIOD | Band head «خلال الفترة» (sky, RangeChip, sub «مذكرات مصروفات التراخيص بيوم المذكرة، ولا تحمل المذكرة فرعًا ولا نوع سيارة ولا تشغيلًا، فلا يغيّرها إلا اختيار الفترة.») + `CompanyWide` when narrowed; PeriodFilterBar with the PERIOD CHOICES ONLY (NEW prop `periodOnly`: no type / operation / codes controls, only the range echo chip) (A3, told); row [sky «مصروفات التراخيص في الفترة» (tag «بيوم المذكرة»; `licenceSpend.total` → `license-expenses?from&to`; well «عدد المذكرات» `count` · «السيارات» `cars` — the register's labels, plain; foot «عرض مذكرات الفترة ←») │ «تفصيل مصروفات الفترة» (chip total; note «كل مجموعة تساوي الإجمالي، والنسبة منه.»; groups «حسب نوع المذكرة» تجديد تراخيص / مد مدة and «حسب طريقة الدفع» فيزا / نقدي, brand bars, amount + one-decimal share, PLAIN figures — B3)]; under the row the custody note «تُخصم هذه المذكرات من العهدة عند «تسوية العهدة»، وما ينتظر التسوية منها يظهر في «العهدة»؛ فلا تُجمع أرقام هذا الجزء مع أرقام العهدة.» + `tabLink('custody', …)` «العهدة ←». Drawn only with `licenceSpend` (LE view). | §11, A3/B2/B3/B9 |
| D18 | Licences reads | R1 `licenceVehicles.list` rows += `typeName`, `licenceClass` (catalog name), `papers {insurance, tax}` (paper stages, ONLY for board («ت») cars and only when the reader holds `fleetLicensing.view`, else `null`); `licenceVehicles.months` (12 `{key:'YYYY-MM', count}`, active cars by expiry month, this month first, reader scope). R1 `licenceDrivers.months` (12, same keys, drivers in the digest by expiry month) + `licenceDrivers.list {rows ≤ LICENCE_ROWS, more}` (`{profileId, employeeId, expiresAt, days, licenceType, active}`, longest-expired first, ≤ today+60; `rows.length + more = expired + expiring + soon`). NEW R2 `licenceSpend {count, cars, visa, cash, renewal, extension, total}` over memos by memo day in [from, to], whole company (ignores type/operation/codes/branch). Gates kept per section (C4: folded into the existing sections). | §11; critic C4 |
| D19 | Old body → homes | §2 table. «آخر ما سُجّل» (R1 `recentWorkshop`, `recentAccidents`) has NO place in _8 or any approved screen → RETIRED (sections, gates, DTOs, constants `RECENT_DAYS/ROWS`, NS sections + `recentSince`, L builders `visitDay/accidentDay(now)/accidentsRecent/visitsRecent`, their pins) — TOLD (the accidents are in «حوادث الفترة», the visits on «الصيانة والورش» / the maintenance register). The modules keep `recentWritten` (unused; later cleanup). Fuel-card expiry → «الوقود والمصروفات» KPI (same `fuelCards.expiring`, same link) + the pointer line. | owner: nobody loses a figure untold |
| D20 | Other screens learn params | LP learns `paper=insurance|tax` = OPEN stage only (`paperStage === 'open'`), read + `REMEMBERED_FILTERS` + `clearFilters` + `hasFilters` + one removable chip (critic C5; the old `?sort=asc` link listed every car). Nothing else: custody log `op/open/sort`, memos `status/kind`, license-expenses `kind/status/from/to`, custody-expenses `source/from/to/vehicleCodes`, receipts `kind/source/…`, vehicles `licenseMonths`/`licExp*`, drivers `licExp*`/`licExp=none`/`branch` all exist (verified). | critic C5 |
| D21 | Overview | No overview code change. Hub «العهدة والتراخيص»: its line «تراخيص قريبة N سيارة» and foot already open `tabLink('licences', …)` → now the new body (same key). The custody KPI «رصيد العهدة النقدية» (figure + «فتح لوحة العهدة») and the action line «تنبيهات لوحة العهدة» keep `/fleet/custody/dashboard`: their words name that screen, and the «الآن» figures there are the tab's. (Custody hand-off «use «إجمالي العهدة» on the overview card» is NOT done — the approved overview B says «رصيد العهدة النقدية»; told as an open choice.) | approved overview B |
| D22 | Old tabs sharing reads | «أرقام الفترة»: `opex.{card,custody,total,count,dataFrom}`, `dealership` untouched (fields only ADDED) → identical; its custody figure = the custody tab's «مصروفات العهدة» (same field). «ملخصات»: custody KPI / column («إجمالي العهدة» `fundTotal`, «تنتظر الاستعاضة» `waiting`, «تنتظر التسوية» `settle`, the lines count) from the SAME CFL fields → identical to the custody tab's strip and cards; `fuelCharging`, `accidentsOpen`, `violationsYear` untouched. Fuel tab: «وقود من العهدة» / «كاوتش» / «غسيل» / «صيانة» = the custody bars over the same period and branch (the B4 sentence says so). Overview custody KPI = `fundTotal`; red action lines = the licences red KPIs. | «nobody loses a figure» |
| D23 | Counting | Server: every count (`custodyCount`, `licenceSpend.count/cars`, `held.letters`, months, list `more`, `notRecorded`, `unregistered`, `papers`). Browser display only: shares, bar lengths, the operators, «و N أخرى» = a server/lib count − the row constant. The custody lists' counts are LIB helpers in CLF beside `custodyWaiting` (`custodyOutsideReceipts(outside)`, `custodySettleCount(parts)`, `custodyPendingCount(memos)`), never in a `tab-*` file (NT scan). | NT :257-270 |
| D24 | Realtime | RT `fleet.licenseExpense` += `FLEET_DASHBOARD_LIVE` (licenceSpend; as receipts: a back-dated memo refreshes a past period on «تحديث» or reload — told in risks); `fleet.custodyMemo` and `fleet.custodyOperation` += `FLEET_DASHBOARD_LIVE` + `FLEET_DASHBOARD_PAST` (`custodyStates` are «as of now» for any period, like the fines; doc block :40-49 updated); custody «الآن» already rides `['fleet','custody']`. throttle.spec lists re-pinned. | critic C3; D13 doc |
| D25 | Brand rule (§5) | Custody chart line + area and both bar cards in the brand family; licences columns brand (cars) / two steps lighter (drivers); period bars brand. Status colours stay: red fund below zero + alerts (a)/(e), amber waits/ages/late alerts, register tiles (charge teal, spend slate, replenish sky, settle emerald, held amber), renewal sky / extension violet pills, papers violet, expired red, expiring amber. | §5 |
| D26 | Tables / phone | Custody table and both licences tables are tables from `md`, stacked blocks below; charts scroll inside their card on a phone (custody to the latest point, licences from this month); 16 px gutters, no sideways page scroll; KPIs 1 → 2 → 3 → 6 columns (6 from 1800 px). | #727/#728 phone rule |
| D27 | Words | Copied from ZC/ZL (their own literals) and the custody pages' existing keys (`fleet.custody.*`, `fleet.dash.summaries.waiting/settle`, `fleet.custody.dashboard.states.*`, `fleet.nav.custodyExpenses`). ZC read two keys that no longer exist here (`fleet.dash.alerts.none.title` «لا توجد تنبيهات الآن», `fleet.dash.alerts.custody.figure` «تنبيهات العهدة» — retired with «التنبيهات» in #708): they become NEW keys under `fleet.dash.custody.*` with the same Arabic. Dual forms («طلبان»، «تنبيهان»، «سائقان»، «يومين»، «مذكرتان») are tab-local counted words (the #728 `tab-fuel-words.tsx` pattern); the kit `DashNoun` has no dual. | ZC/ZL; §0b |
| D28 | Formal Arabic / digits | `node scripts/check-formal-arabic.mjs` + `offendersIn` on every JSON's ar values; Latin digits; no English shown to Arabic readers; «−» (U+2212) for minus in figures. | rules |

---

## 2. The old «التراخيص» body — every figure's new home

| Old figure (FD/tab-licences.tsx) | Field | New home | Same link? |
|---|---|---|---|
| «تراخيص السيارات» · «منتهية» bucket | `licenceVehicles.expired` | K1 «تراخيص سيارات منتهية» (+ badge, + overview red line) | yes (`vehicleLicencesExpired`) |
| · «خلال W يومًا» bucket | `.expiring` | K2 figure | yes |
| · «خلال 60 يومًا» bucket (grey) | `.soon` | K2 «ومن {W+1} إلى 60 يومًا: N ←» (critic B4: the old label read like a running total) | yes (`vehicleLicencesSoon`) |
| · mix bar «N سيارة: منتهية أو تنتهي خلال 60 يومًا» | expired + expiring + soon | chip on «أقرب تراخيص السيارات» («13 سيارة»); the bar itself is not in _8 → not drawn | — |
| · «ومنتهية التراخيص خارج الخدمة: N» | `.outOfServiceExpired` | K1 sub «· وخارج الخدمة N» (only > 0) | plain (as before) |
| · ≤ 6 nearest rows + «+N خلال 60 يومًا» | `.list`, `.more` | «أقرب تراخيص السيارات» table (+ make, licence class, papers) + «عرض الباقي (N)» | yes (`vehicle(id)`, `vehicleLicencesWithin60`) |
| «آخر ما سُجّل» (visits + accidents, 30 days) | `recentWorkshop`, `recentAccidents` | NONE in the approved screens → RETIRED, TOLD (accidents: «الحوادث ومطالبات التأمين» → «حوادث الفترة» with «آخر 30 يومًا»; visits: «الصيانة والورش» and the maintenance register) | — |
| «رخص السائقين» · منتهية / خلال W / خلال 60 | `licenceDrivers.expired/expiring/soon` | K3, K4 (+ «ومن … إلى 60»), badge, overview red line | yes |
| · «بلا تاريخ» | `.notRecorded` | K6 «رخصة غير مسجّلة» (critic B5: «الحركة اليوم»'s word) | yes (`licExp=none&branch`) |
| · «بلا ملف سائق» | `.unregistered` | K6 «بلا ملف سائق: N» | plain (no list, as before) |
| «أوراق التراخيص وكروت الوقود» · «أوراق تأمين / ضرائب مفتوحة» | `papers.insurance/tax` | K5 «أوراق لم تُستلم بعد» «تأمينات» / «ضرائب» | BETTER: `licensing?paper=…` (exact open papers; was `?sort=asc`) — told |
| · «كروت تنتهي خلال W يوم» | `fuelCards.expiring` | «الوقود والمصروفات» KPI «تنتهي خلال {W} يومًا» (same field, same link) + the pointer line here (§11 Q1 told) | yes (on the fuel tab) |
| head «التراخيص وآخر ما سُجّل», sub, refresh | — | TabHead «التراخيص والتجديدات», new sub, RefreshTools | — |

Readers: a fuel-card-only reader (`fleetFuelCard.view`) no longer sees «التراخيص» but sees the same figure on «الوقود والمصروفات» (visible to
them since #728); a maintenance-only or accidents-only reader loses «آخر ما سُجّل» (told) and keeps their own tabs; a licensing-only reader
keeps the tab (papers). TOLD.

---

## 3. Packages, phases and strict file ownership

```
Phase A   C0  (contracts)                                                   — alone, first; contracts build + test green
Phase B   A1 (api) ∥ WC (web «العهدة» + custody lib/specs fallout) ∥ WL (web «التراخيص والتجديدات» + LicensingPage + period bar)
Phase C   HUB (FDP, T/U/L, dash-shell, RT, i18n, CHANGELOG, FX/PFX, shared specs) — after A1, WC, WL report
Phase D   INT (no files of its own): full CI gate in CI order, house checks, clean room, real-page shots (port 5315), root fixes, PR-body draft
```

| File | Owner |
|---|---|
| C, CS, CF (+ packages/contracts/src/modules/fleet.spec.ts only if a CF case is added) | C0 |
| CFS, COR, CMR, CS2 (memo statuses moved into CMR), apps/api/src/modules/fleet/custody/custody-memo.service.ts (held rows), NEW …/custody/custody-held-letters.spec.ts · RR, RS, …/receipts/receipt-summary-over.spec.ts · LER, LES, NEW …/license-expenses/license-expense-period-spend.spec.ts · VR (+ its spec on fallout), LS, …/licensing/licensing-open-papers.spec.ts · DPS, …/driver-profiles/driver-registry-digest.spec.ts · NS, NSS, PS, PSS, …/dashboard/now-alerts.spec.ts (fixture fallout) · INT, PAR, PERF, READS (fallout), apps/api/tests/integration/fleet-custody-hold.spec.ts, fleet-custody-fund.spec.ts / fleet-custody-memos.spec.ts / fleet-custody-delete.spec.ts (DTO fallout only), fleet-license-expenses.spec.ts (period spend case) | A1 |
| NEW FD/tab-custody.tsx, FD/tab-custody-now.tsx, FD/tab-custody-history.tsx, FD/tab-custody-period.tsx, FD/tab-custody-words.tsx · CFL · CLF (+ W/pages/custody-dashboard-fund.spec.tsx for the new helpers) · NEW W/fleet-dashboard-tab-custody.spec.tsx · fallout only: W/pages/custody-{dashboard-fund,fund-dialogs,hold,tabs,memos,deleted,split,delete-dialog,ledger,hold-dialogs}.spec.tsx (`held.letters: []`), W/pages/receipts-screen.spec.tsx, W/pages/receipts-memo-lock.spec.tsx, W/fleet-row-actions-look.spec.tsx (`custodyCount`) | WC |
| FD/tab-licences.tsx (REWRITE), NEW FD/tab-licences-now.tsx, FD/tab-licences-chart.tsx, FD/tab-licences-tables.tsx, FD/tab-licences-period.tsx, FD/tab-licences-words.tsx · FD/period-filter-bar.tsx (additive `periodOnly`) · LP · NEW W/fleet-dashboard-tab-licences.spec.tsx · W/pages/licensing-screen.spec.tsx (`paper=` cases) | WL |
| FDP, T, U (doc), L, FD/dash-shell.tsx (`SHORT`), RT, apps/web/src/platform/realtime/throttle.spec.ts, I, CHANGELOG.md, FX, PFX, NT, PT (fallout), SH, LC, LS, RF, GT, TP, VCC, RFC, OV (only if a pin moves), FD/tab-overview.tsx + FD/tab-overview-actions.tsx + FD/tab-summaries.tsx (comments only, if any), and on fallout the source-scan specs (W/fleet-input-rules.spec.ts, W/fleet-multi-clear.spec.ts, W/fleet-date-picker.spec.tsx, …) | HUB |

Rules for every package: edit only owned files (another package's file is a hand-off note, never an edit); formal Arabic only through i18n
hand-offs; no new permission key; no migration; soft delete untouched; data unchanged (no new index is needed — §0); dashboard/ hygiene (HY:
new counts live in their modules; composition only; no `$`-keys, no `.aggregate(`, no `isDeleted:`/`date:`-style keys in dashboard/); new web
files keep the `tab-` prefix and draw no `data-zz-`; NO browser counting (NT :257-270 scan; counts are server fields or CLF helpers); Latin
digits; ar + en for every new key with identical placeholders (placeholders.spec.ts); Operations-imported fleet exports (custody-dashboard-parts,
CustodyDashboardFund, FuelCardBoard …) are imported, never moved or re-signed; never import a zz file; card numbers stay masked (not on these
tabs). Never push, never touch a PR, never publish (no Artifact tool). Do NOT commit unless the step says so.

New words: each package writes `CL/i18n/<pkg>.json` (`c0.json` and `a1.json` empty unless needed; `wc.json`, `wl.json`):
```json
{ "ar": { "<key>": "<formal Arabic>" }, "en": { "<key>": "<English>" },
  "change": { "<existing key>": { "ar": "…", "en": "…" } },
  "dropRead": [ "<existing key this package stops reading>" ] }
```
Words are COPIED from ZC / ZL (their literals) or reuse an existing key — never re-worded — then checked with
`node scripts/check-formal-arabic.mjs`'s `offendersIn`. `dropRead` lists keys the package stopped reading; HUB deletes a key only when a
whole-tree grep finds no reader left. Other hand-off notes → `CL/handoff/<pkg>.md` (c0.md, a1.md, wc.md, wl.md, hub.md).

Package exit (own files): `npx eslint <files>`, `npx prettier --check <files>`, `npx tsc --noEmit -p apps/<api|web>` with errors ONLY in files
another package owns (listed in the hand-off), and the focused vitest the package can run. Tab specs render through `renderDashboard` (FDP + FX)
and run at HUB's end; WC/WL self-check their spec through a temporary shim (deleted before reporting), as WV/WF did in #728.

---

## 4. C0 — contracts (Phase A)

Owns C, CS, CF. Exit: `npm run build -w packages/contracts && npm run test -w packages/contracts` green; api/web typecheck fallout listed by
file in `CL/handoff/c0.md` (no stubs in other packages' files).

1. C header :1-25 and TABS doc :44-51: twelve tabs; «العهدة» (`custody`) NEW after «الوقود والمصروفات», MIXED of the custody screen's own
   reads ('web') and R2; «التراخيص والتجديدات» (`licences`) rebuilt under its key, MIXED (R1 + R2); «أرقام الفترة», «ملخصات» unchanged after them.
2. `FLEET_DASHBOARD_TABS` :52-64 → `[…, 'violations', 'fuel', 'custody', 'licences', 'period', 'summaries']`.
3. `TAB_READS` :70-88: `custody: ['web','period']`, `licences: ['now','period']`; `PERIOD_TABS` stays `['period']` (doc: seven mixed tabs
   draw the bar inside).
4. Constants: DELETE `FLEET_DASHBOARD_RECENT_DAYS/ROWS` :113-114; ADD `FLEET_DASHBOARD_CUSTODY_RECENT_ROWS = 6` («آخر عمليات العهدة») and
   `FLEET_DASHBOARD_CUSTODY_WAIT_ROWS = 6` (pending memos / settle parts before «و N أخرى»); `FLEET_DASHBOARD_LICENCE_ROWS = 6` now also names the
   drivers' rows (doc); ADD `FLEET_DASHBOARD_LICENCE_MONTHS = 12`.
5. Sections: NOW :364-386 DROP `recentWorkshop`, `recentAccidents`; PERIOD :387-399 += `'custodyStates'` (after `opexSeries`) and
   `'licenceSpend'` (last). Registry order = DTO field order.
6. NEW `FLEET_DASHBOARD_PAGELESS_SECTIONS = ['licenceSpend'] as const` (doc: «its key reads R2 but never opens the page — a licence-expense-only
   reader does not gain `/fleet` (§11 A2)»); `keysOfRead(null)` leaves PART and PAGELESS sections out; `keysOfRead('period')` keeps PAGELESS
   in. Docs of NOW/PERIOD/PAGE unions :524-536 updated (PERIOD grew by `fleetCustody.view`, `fleetLicenseExpense.view`; NOW and PAGE unchanged
   as sets).
7. Gates :443-494: DROP `recentWorkshop` :450, `recentAccidents` :475; ADD
   `custodyStates: Object.freeze({ read: 'period', api: ['fleetReceipt.view', 'fleetCustody.view'], page: ['fleetCustody.view'], path: '/fleet/custody-expenses' })`
   and `licenceSpend: gate('period', 'fleetLicenseExpense.view', '/fleet/license-expenses')`.
8. `TAB_SECTIONS` :542-623: `custody: ['custodyFund']` (doc: the fund's reader alone sees the tab), `licences: ['licenceVehicles',
   'licenceDrivers', 'papers']` (doc: each KPI under its own gate; papers keep a licensing-only reader on `/fleet`); every other entry
   unchanged. `TAB_PARTS` :629-635 += `custody: ['opex', 'custodyStates']`, `licences: ['licenceSpend']`.
9. R1 DTOs (docs as below):
   ```ts
   // FleetDashboardNowLicenceVehiclesDto (:1062)
   list: FleetDashboardNowLicenceVehicleRowDto[];       // ≤ 6, expired first (days < 0), longest-expired first
   export interface FleetDashboardNowLicenceVehicleRowDto {
     vehicleId: string; code: string; expiresAt: string; days: number;     // kept
     typeName: LocalizedString | null;                  // «مرسيدس اسيليو 915» — the vehicle type's name
     licenceClass: LocalizedString | null;              // «برقاش م» — the licence-class catalog name
     /** The board's two papers (paperStage) — a «ت» car on the licensing board only, and only for a reader of the board. */
     papers: { insurance: 'none' | 'open' | 'done'; tax: 'none' | 'open' | 'done' } | null;
   }
   /** Active cars by licence expiry month, FLEET_DASHBOARD_LICENCE_MONTHS slots from this (Cairo) month. */
   months: { key: string; count: number }[];            // key 'YYYY-MM'
   // FleetDashboardNowLicenceDriversDto (:1075) — additive
   months: { key: string; count: number }[];            // same keys; drivers by their Fleet file's expiry month
   /** ≤ FLEET_DASHBOARD_LICENCE_ROWS files with expiry ≤ today+60, longest-expired first; rows + more = expired + expiring + soon. */
   list: { rows: FleetDashboardNowLicenceDriverRowDto[]; more: number };
   export interface FleetDashboardNowLicenceDriverRowDto {
     profileId: string; employeeId: string;
     expiresAt: string;                                 // 'YYYY-MM-DD'
     days: number;                                      // < 0 expired, 0 expires today
     licenceType: LocalizedString | null;               // «اولى» — the driver licence type catalog name
     active: boolean;                                   // false → «الملف موقوف»
   }
   ```
   DELETE `recentWorkshop`, `recentAccidents` (:740-741) and `FleetDashboardRecentVisitDto` / `FleetDashboardRecentAccidentDto` (:1163-1190).
10. R2 DTOs:
    ```ts
    opex: { …; /** custody-paid receipts (= /fleet/receipts/summary?source=custody count) */ custodyCount: number } | null;
    /** Where the period's custody receipts stand NOW against the memos (FLEET_CUSTODY_MEMO_STATE_OF_STATUS: held → pending); Σ = opex.custody. */
    custodyStates: { replenished: number; pending: number; outside: number } | null;
    /** The licence-expense memos whose memo day is in the range — the whole company (no branch, type, operation or codes reach a memo).
     *  renewal + extension = visa + cash = total; count = records (a record may hold both memos); cars = entries (hand-typed plates too). */
    licenceSpend: { count: number; cars: number; visa: number; cash: number; renewal: number; extension: number; total: number } | null;
    ```
11. CF: `FleetCustodyFundSummaryDto.held` += `letters: FleetCustodyHeldLetterDto[]` (NEW interface: `id, date` (letter day), `from, to`
    (the letter's period or null), `amount`, `receipts`, `memos: Pick<FleetCustodyMemoRowDto, 'id'|'no'|'kind'|'name'|'date'|'receipts'|'total'>[]`
    (no ascending); doc: oldest letter first; Σ amount = `held.amount`, Σ receipts = `held.receipts`, length = `held.count`, Σ memos = `held.memos`).
    `FleetReceiptTotalsDto` :4977 += `custodyCount: number` (custody-paid receipts).
12. CS re-pins: tab list (12, order); TAB_READS (custody web+period; licences now+period); the mixed set (`maintenance, km, accidents,
    violations, fuel, custody, licences`); gates table (+2, −2); PERIOD_KEYS + `fleetCustody.view` + `fleetLicenseExpense.view` (rename the
    «only the R2 union grew» case :576); NOW_KEYS and PAGE_KEYS equal as SETS to before (assert); PAGELESS: `licenceSpend` not in PAGE_KEYS,
    in PERIOD_KEYS; TAB_SECTIONS map; TAB_PARTS `{distribution, custody, licences}` and «parts never show a tab»; «every section a tab draws
    belongs to a read it names» holds (custody: web + period); constants; DTO sample objects (compile-only).

**C0 fallout list** (expected, for c0.md): api — NS (recent sections, licence DTOs), PS (opex/custodyStates/licenceSpend), RR (`custodyCount`),
CFS (`held.letters`), NSS/PSS/INT/PAR literals, custody integration literals; web — FX/PFX, FDP (`NOW_PANELS` type now excludes `licences`;
`MIXED_PERIOD_SECTIONS` Record needs custody/licences → HUB), FD/tab-licences.tsx (recent DTOs gone → WL rewrite), L (recent builders' DTO
types → HUB), custody page specs (`letters`) and receipts specs (`custodyCount`) → WC, SH/LC/GT literals → HUB.

---

## 5. A1 — API (Phase B)

Owns the A1 files of §3. No words: `CL/i18n/a1.json` empty; `CL/handoff/a1.md` = PERF ceilings + field notes.

### 5.1 Custody
1. CMR NEW `statusesByIds(ids): Promise<Map<string, FleetCustodyMemoStatus>>` = the body of CS2 `memoStatuses` :118-139 (live memos only,
   `custodyMemoStatusOf`); CS2 calls it (same result — «لوحة تحكم المصروفات»'s `memoStates` unchanged; its spec stays green).
2. COR NEW `heldReplenishments()` → live `{kind: 'replenish', status: 'held'}` operations, `date` asc then `_id` (index
   `ix_custody_operation_kind`), projecting `date, from, to, amount, memos`. custody-memo.service.ts NEW `heldRows()` → the memo ROWS
   (`FleetCustodyMemoRowDto`, live receipts/total, the list's own mapping) of memos whose replenishment is held (the `status=held` clause of
   `STATUS_CLAUSES`), `no` asc.
3. CFS `summary` :288-315: `held: { ...terms.held, letters }`, letters = held operations each with its memos (grouped by
   `replenishment.id`), `receipts` = Σ its memos' receipts, `amount` = the operation's own amount (to the piastre). Two reads more, in the
   existing `Promise.all`. Pins (NEW custody-held-letters.spec.ts): Σ letters.amount = held.amount; Σ receipts = held.receipts; letters = held.count;
   Σ memos = held.memos; order oldest letter first; a transferred or cancelled letter is not listed; a deleted memo is not listed.
4. Integration: fleet-custody-hold.spec.ts — after «استعاضة العهدة» held: `GET /fleet/custody/fund/summary` → `held.letters[0]` = that letter
   (day, period, memos with their receipts/totals); after «تأكيد التحويل» → `letters: []`; after cancel → `[]`. Other custody integration specs:
   DTO fallout only.

### 5.2 Receipts (custody count and states)
1. RR `totals` :129-187: `custodyCount = Σ row.count where _id.source === 'custody'` (same `$group`, no new query).
2. RR NEW `custodyByMemo(filter)`: ONE aggregate — `$match` baseFilter(filter) (the caller's filter already says `source: 'custody'`) →
   `$group { _id: '$memoId', amount: { $sum: '$amount' }, count: { $sum: 1 } }`; amounts rounded to the piastre.
3. RS NEW `custodyStatesOver(query)`: `filterFor({ ...query, source: 'custody' })` (the SAME resolution `summaryOver` uses: codes ∩ type /
   operation / branch, deleted cars included) → `custodyByMemo` → `fleetCustodyMemoRepository.statusesByIds(ids)` → state per group with
   `custodyMemoStateOf` (custody-dashboard.ts:208; held → pending) → `{replenished, pending, outside}` summed in whole piastres.
4. Specs (receipt-summary-over.spec.ts): `custodyCount`; states over pending / held / replenished / no-memo / deleted-memo rows; Σ states =
   `custodyTotal` to the piastre; a card receipt never counted.

### 5.3 Licence expenses
1. LER NEW `spendDigest(filter)`: ONE aggregate `$match baseFilter(filter)` → `$group { _id: null, count: {$sum: 1}, cars: {$sum:
   CARS_COUNT_EXPRESSION}, visa: {$sum: linesTotalExpression('visa')}, cash: {$sum: linesTotalExpression('cash')}, renewal: {$sum: <$reduce over
   `$renewal.items` with LINE_COST>}, extension: {$sum: <same over `$extension.items`>} }` → rounded; `total = round(visa + cash)`.
2. LES NEW `periodSpend({ from, to })` = `expenseFilter({ from, to })` (the register's own day rule, `$lt to+1`) + `spendDigest`.
3. Spec NEW license-expense-period-spend.spec.ts: renewal + extension = visa + cash = total on mixed records (a record with both memos, one with
   a cash-only line, a `count` > 1 line); count/cars/visa/cash = `totals()` over the same filter; whole days at both ends. Integration
   fleet-license-expenses.spec.ts: one case `GET /fleet/license-expenses/summary?from&to` vs the digest.

### 5.4 Licences R1
1. VR `nearestLicences` :406-439: select `typeId, licenseClassId` too and return them (`typeId`, `licenseClassId` strings or null).
2. VR NEW `licenceMonthCounts(scope, fromYmd, toYmd)`: `$match baseFilter(scope, { status: 'active', licenseExpiresAt: { $gte: <first of
   fromYm>, $lte: <end of toYm> } })` → `$group` by `$dateToString '%Y-%m'` (UTC — licence dates are stored date-only at UTC midnight, CF:391)
   → Map key → count (`ix_license_sweep`).
3. LS NEW `paperStagesFor(scope, vehicleIds)` → Map<vehicleId, {insurance, tax}> for the vehicles among the board's own «ت» cars
   (`vehiclesOfClasses` rule, LS :178-198) using `FLEET_LICENSING_PAPERS` + `paperStage` on `findForVehicles` marks (read-only, never the
   writing GET). Spec in licensing-open-papers.spec.ts: a «م» car → absent; «ت» car → its stages; = `openPaperCounts` over the same cars.
4. DPS `registryDigest` :272-326: `licence` += `months` (12 keys from `input.today`'s month: profiles whose `licenseExpiresAt` day falls in
   the month) and `nearest` (profiles with a date ≤ today+60, sorted `licenseExpiresAt` asc then `employeeId`, first `limit` + `total`), each
   `{profileId, employeeId, expiresAt (ymd), licenceTypeId, active: profile.isActive}`; input += `nearestLimit`. Same rows as the counts, so
   `nearest.total = expired + expiring + soon` (pin in driver-registry-digest.spec.ts, suspended included, no-profile seats excluded).
5. NS `licenceVehicles` :758-796: rows += `typeName` (types via the read's memoised `fleetVehicleTypeRepository` names), `licenceClass`
   (`fleetCatalogItemRepository.namesByIds`), `papers` (only when `d.permits('papers')`: `fleetLicensingService.paperStagesFor(d.scope(
   'fleetLicensing.view'), ids)`, else null); `months` via `licenceMonthCounts(scope, today, today+11 months)` with zeros kept for empty keys.
   `licenceDrivers` :798-801: `months` and `list { rows ≤ FLEET_DASHBOARD_LICENCE_ROWS, more }` from the digest, `days = daysBetweenYmd(today,
   expiresAt)`, `licenceType` via `fleetCatalogItemRepository.namesByIds` (driver licence type kind).
6. NS: DELETE `recentWorkshop` :889-896, `recentAccidents` :898-905, `recentSince` :113-114 and the imports they alone used.
   `fleetMaintenanceService.recentWritten` / `fleetAccidentService.recentWritten` stay (unused — note in a1.md).
7. Specs: NSS (licence rows widened, papers null without the grant, months 12 keys incl. zeros, drivers list/more ties, recent sections gone);
   now-alerts.spec.ts fixture fallout only.

### 5.5 R2 composition (PS)
1. `opex` :198-221 += `custodyCount: totals.custodyCount`.
2. NEW `custodyStates: section('custodyStates', 'company+set', () => fleetReceiptService.custodyStatesOver(dated(p)))`.
3. NEW `licenceSpend: section('licenceSpend', 'company+set', () => fleetLicenseExpenseService.periodSpend({ from: ymdToUtcDate(p.range.from),
   to: ymdToUtcDate(p.range.to) }))` — doc: the set never reaches a memo (no branch, no car amount); the section kind stays 'company+set' and
   ignores `p.filter`.
4. PSS: opex.custodyCount; custodyStates called with `dated(p)`; licenceSpend called with the range only (a type/branch filter does not reach it).

### 5.6 Integration
- INT: R1 section list (−2), R2 (+2); doors: a `fleetLicensing.view`-only reader → R1 `papers` only, `/period` 403; a
  `fleetLicenseExpense.view`-only reader → `/period` 200 with `licenceSpend` only, `/now` 403 (and the WEB page stays closed — PAGE_KEYS);
  `fleetCustody.view` + `fleetReceipt.view` → `opex` + `custodyStates`; `fleetReceipt.view` alone → `custodyStates` null. Branch B1:
  custodyStates follow the receipt's car (Σ = opex.custody under B1); licenceSpend identical to the company view; licence months/rows narrow (cars
  by car branch, drivers by HR branch).
- PAR (company AND B2): `opex.custodyCount` = `/fleet/receipts/summary?source=custody&from&to&branchIds` count; `custodyStates` Σ =
  `opex.custody`; `licenceSpend` = `/fleet/license-expenses/summary?from&to` (count, cars, visa + cash); each car month = `/fleet/vehicles?
  status=active&licenseMonths=YYYY-MM` totalItems; each driver month = `/fleet/drivers?licExpFrom&licExpBefore&branch` totalItems;
  `licenceDrivers.list.rows + more` = `/fleet/drivers?licExpBefore=today+60&branch` totalItems; `held.letters` vs `/fleet/custody/memos?
  status=held` (same memos).
- PERF: re-measure warm; re-pin `CEILING` and `CEILING_FILTERED_R2` with one comment line per change (expected R1: −2 recent sections,
  +3–4 (months aggregate, type/catalog names, paper stages); R2: +3–4 (custodyByMemo + memo statuses, spendDigest)); «index used» cases
  for the months aggregate (`ix_license_sweep`), `custodyByMemo` (`ix_receipt_source_date`), `spendDigest` (`ix_license_expense_date`).
- READS: on fallout only.

**A1 exit**: `npx tsc --noEmit -p apps/api`; eslint + prettier on owned files; from apps/api `npx vitest run src/modules/fleet
tests/integration/fleet-dashboard tests/integration/fleet-custody tests/integration/fleet-license-expenses.spec.ts
tests/integration/fleet-licensing.spec.ts` green; HY green.

**A1 → web field notes** (a1.md): counts are server fields (`custodyCount`, `licenceSpend.count/cars`, `list.more`, months); `papers` null
= no board car or no grant (draw «—» / no column); `active: false` = «الملف موقوف»; `held.letters` oldest first; month `key` order = the
chart's order; `custodyStates` null = not permitted (no «منها» lines).

---

## 6. WC — «العهدة» (Phase B)

Owns the WC files of §3. Truth: approved/cust-dark.png + cust-branch-dark.png + ZC (NowBand :3118, Strip :1639-1765, WaitingCard :1799-1978,
HeldCard :1980-2090, SettleCard :2117-2212, AlertLine/AlertsCard :2235-2430, StepsChart :2522-2860, RecentTable :2861-3116, PeriodBand
:3143-3369); figures only from the CFL figures (`props.custody`), the ledger hook and the page R2 (`opex`, `custodyStates`). Pattern:
FD/tab-fuel*.tsx (bands, ReadBand faces, filter bar between bands). `export const CustodyTab = (props: MixedTabProps) => JSX.Element`,
wrapper `data-dash-tab-body="custody"`.

1. **CFL** (D7): `CustodyFigures` += `detail: { summary: FleetCustodyFundSummaryDto; replenish: FleetCustodyReplenishCandidatesDto;
   settle: FleetCustodySettleCandidatesDto; alerts: CustodyFundAlert[] } | null` (null until all three answered) and `fetching: boolean`; the
   `useCustodyFundAlerts(` call stays the only one (pass its array; `lines` stays its length). Header comment: the custody tab is the third
   reader.
2. **CLF** helpers (D23, lib — counts allowed): `custodyOutsideReceipts(outside)` (Σ count), `custodySettleCount(parts)`, `custodyPendingCount
   (memos)`, `custodyDoneRows(rows)` (the chart's done rows) — each with a unit case in W/pages/custody-dashboard-fund.spec.tsx.
3. **TabHead** (ZC Heading :1542): wallet icon, title `fleet.dash.shell.tab.custody`, `live={false}`, sub «عهدة إدارة الحركة: إجمالي العهدة
   الآن، وما ينتظر الاستعاضة والتسوية، ومصروفاتها في الفترة.» (critic C8), RefreshTools (`props.updatedAt/onRefresh/refreshing` — HUB wires custody
   + R2; the tab also refetches its ledger on «تحديث»).
4. **BandHead «الآن»** (`first`): LiveChip + chip «من بداية العهدة» + `CompanyWide` when narrowed (D9). The custody reads' face: skeleton while
   `custody.loading`, ReadError (retry `custody.refetch`) on `custody.error` with nothing to show; an R2 failure never blanks it and vice versa.
5. **Strip** (ZC :1639-1765): «طلبات − مصروفات + استعاضة − تسوية» formula line; five tiles «إجمالي طلبات العهدة» (teal, `charged`, foot «N
   طلبات») − «مصروفات الإيصالات» (slate, `spent`, «N إيصالًا») + «إجمالي الاستعاضة» (sky, `replenished.amount`, «N مذكرة» = `replenished.memos`)
   − «إجمالي التسوية» (emerald, `settled.amount`, «N مصروف تراخيص» = `settled.parts`, `partsPhrase`) = «إجمالي العهدة الآن» (slate strong,
   `fundTotal`, red «−X» below zero); operator badges at every width (stacked on the phone); links D13. Words: the ledger tiles' keys
   (`fleet.custody.ledger.tiles.*`) as ZC reads them.
6. **Three cards** (ZC WaitsRow :2214; amber edge, tiles sky / amber / emerald, equal heights, 1 → 3 columns):
   - «تنتظر الاستعاضة» (`fleet.dash.summaries.waiting`; sub `fleet.custody.dashboard.waiting.title` «مبالغ صُرفت ولم تُستعَض بعد»):
     BigMoney `waiting` → custody dashboard; chip «N إيصالًا» (`custodyWaiting(...).receipts`, B1); parts: «في انتظار التحويل» `held.amount`
     · «N مذكرات» → `memos?status=held`; «في مذكرات لم تُستعَض بعد» `memos.pendingTotal` · «مذكرتان» → `memos?status=pending`, its memos (≤ 6, D10:
     name or «مذكرة <النوع> رقم N» (`fleet.custody.parts.memoFallback`), day · «N إيصالًا», amount, age chip amber past 30); «إيصالات لم تدخل أي
     مذكرة بعد» (B4) Σ outside · «N إيصالًا» (`custodyOutsideReceipts`) → custody dashboard, four kind tiles in custody order (amount →
     `memos?kind=<k>`, «N إيصالًا», «أقدمها منذ N يومًا», amber box when stale); note «تعود إلى إجمالي العهدة عند «استعاضة العهدة».».
   - «استعاضة معلّقة» (amber tile, tag «ضمن ما ينتظر الاستعاضة»): BigMoney `held.amount` (→ `log?open=<id>` when one letter, else
     `memos?status=held`); chip «N إيصالًا» (`held.receipts`); «في انتظار التحويل منذ N أيام» (oldest letter, D11); per letter: «خطاب <day> ·
     N مذكرات», «عن الفترة من … إلى …» (when from/to), «فتح» → `log?open=<id>`, its memos (name, day · receipts, amount); note
     `fleet.custody.hold.heldTileNote`; empty «لا توجد استعاضة معلّقة».
   - «تنتظر التسوية» (`fleet.dash.summaries.settle`; sub «مصروفات تراخيص لم تُسوَّ بعد»; emerald tile): BigMoney `settle` (→ license-expenses
     ?status=waiting with LE view, else plain); chip «N مصروفات تراخيص» (`custodySettleCount`, `partsPhrase`); rows ≤ 6 (D10): kind pill (renewal
     sky «تجديد» / extension violet «مد مدة»), day, «N سيارات:» + CarChips of `codes`, «فيزا X • نقدي Y», amount, age chip, «فتح» (LE view only);
     note «تُخصم من إجمالي العهدة عند «تسوية العهدة».»; empty reuses `fleet.custody.fundForm.settle.empty` «لا توجد مذكرات مصروفات تراخيص لم تُسوَّ بعد.» (I :20384, critic B4).
7. **«تنبيهات العهدة»** full width (NEW key `fleet.dash.custody.alerts.title`): chip «N تنبيهات» (`custody.lines`, dual «تنبيهان»); one row per
   `detail.alerts` line in the banner's order, words `fleet.custody.dashboard.alerts.{negative,stale,memo,licence,settleOver}` (line (d) names
   the kind with `fleet.licenseExpenses.kinds.*`, B4; line (c) prints a typed memo name when there is one, B6), amber clock icon, red for
   (a)/(e) (A3), «فتح» per D13; none → `fleet.dash.custody.alerts.none` «لا توجد تنبيهات الآن».
8. **Chart «إجمالي العهدة بعد كل عملية»** full width (ZC StepsChart; FD/tab-custody-history.tsx): `useCustodyLedger(CUSTODY_LEDGER_PARAMS)`;
   done rows only (`custodyDoneRows`), step line + area in the brand, red segment/band below zero, dots per operation in the register colours,
   zero line, value axis «ج.م» (`custodyTicks`/`custodyStepScale` imported from CDF / custody-dashboard-parts), x labels op word + day, «الآن» on
   the last point (`custodyNowLabelPlace`), readout row (picked step: op chip · day(s) · amount · «بعدها» · «الآن»), legend, note
   `fleet.custody.dashboard.steps.noteRequests`; chip «آخر N عملية» only when `meta.totalItems > items.length`; scrolls to the latest point on a
   phone.
9. **Table «آخر عمليات العهدة»** full width (ZC RecentTable): the newest `FLEET_DASHBOARD_CUSTODY_RECENT_ROWS` rows of any status: التاريخ (day,
   «إلى» day for a run, «خطاب» day on a transferred row) │ العملية (op chip; «معلّقة» / «ملغاة» chip) │ التفاصيل (`ledgerWords` /
   `custody-ledger-words.ts`; transferred «حُوِّل المبلغ في …» + «مرجع R» when typed; held «في انتظار تحويل المبلغ منذ …») │ المبلغ (signed,
   U+2212; held dashed) │ إجمالي العهدة بعدها («الآن» chip on the latest; held «لم تتغيّر بعد») │ «فتح» (D13); held row tint; foot «عرض سجل العهدة ←».
10. **BandHead «خلال الفترة»** (sky; RangeChip; sub «إيصالات العهدة بيوم ورقتها، وتتبع الفرع عن طريق سيارة الإيصال.») + the page's FULL
    PeriodFilterBar under it — only when `props.period.enabled && sectionPermitted('opex', can)`; ReadBand for R2.
11. **Period row** `xl:grid-cols-[2fr_3fr]` (D12): SpendKpi (sky) | KindsCard (brand bars); the B4 note line under both.
12. Markers: `data-dash-tab-body="custody"`, `data-dash-band="now|period"`, `data-cust-term=<charged|spent|replenished|settled|fund>`,
    `data-cust-wait=<waiting|held|settle>`, `data-cust-part=<held|inMemos|outside>`, `data-cust-memo=<no>`, `data-cust-outside=<kind>`,
    `data-cust-letter=<id>`, `data-cust-settle=<expenseId>:<part>`, `data-cust-alert=<type>`, `data-cust-step=<id>`, `data-cust-row=<id>`,
    `data-cust-state=<state>`, `data-cust-bar=<kind>`.
13. Spec NEW W/fleet-dashboard-tab-custody.spec.tsx (through `renderDashboard`; NOW + R2 + custody seeds incl. ledger): tab visible only with
    `fleetCustody.view`; strip figures = summary fields, operators present, fund red «−» when negative + line (a) red; waiting = CFL `waiting`
    (= «ملخصات»'s figure — same field), held inside it, chip receipts; held card per letter + age from `letters[0]`; settle rows ≤ 6 + «و N
    أخرى», no «فتح» without LE view; alerts: only firing lines, amber except (a)/(e), chip = `custody.lines`; chart: held/cancelled not drawn,
    capped chip only when capped; table 6 rows, «الآن» on latest; «الشركة كلها» on «الآن» under B1 AND «كل فروعي», never on the period band;
    period: KPI = `opex.custody`, chip = `custodyCount`, states plain and absent when `custodyStates` null, bars in custody order with brand class
    + shares, links D20 (custody-expenses vs receipts under a branch / type), B4 note present and opex.custody + any fuel-tab figure written
    nowhere; nothing in «الآن» changes when the page period / filters change; R2 failed keeps «الآن», custody failed keeps the period band; no
    `?fund=`, no `letter=1`, no bare list link; no `data-zz-`; banned words absent («الحد الأدنى», «حد الأمان», «سقف», «معدل الدوران», «أعلى السيارات
    صرفًا», «أعلى السائقين صرفًا», «تصدير», «طوارئ», «ضيافة», «معتمد»).
14. wc.json — new: `fleet.dash.custody.{sub, now.since?(reuse scopeSince), formula?(reuse), held.title, held.inside, held.since, held.period?,
    settle.sub?, alerts.title, alerts.none, alerts.count.*, period.sub, period.tag, period.statesHead, bars.title, bars.note, overlap, more,
    count.{request,alert,car}.{one,two,few,many,other}}` (exact list after reuse; every reused key named in wc.md); change: none; dropRead: [].

**WC exit**: eslint/prettier owned files; `npx vitest run src/modules/fleet/pages/custody-dashboard-fund.spec.tsx src/modules/fleet/pages/custody-*.spec.tsx
src/modules/fleet/pages/receipts-screen.spec.tsx` green; web typecheck errors only in HUB files (FDP, FX/PFX, L) and HUB-pending L names
(§8). Hand-off `CL/handoff/wc.md`.

---

## 7. WL — «التراخيص والتجديدات» + LicensingPage + the period bar (Phase B)

Owns the WL files of §3. Truth: approved/lic-dark.png + lic-branch-dark.png + ZL (Heading :1393, NowKpis :1631-1815, NowNotes :1817-1841,
MonthChart :1867-2087, CarsTable :2166-2274, DriversTable :2288-2395, NowBand :2397, PeriodBar :2415, SpendCard :2464-2551, SplitCard
:2553-2623, PeriodBand :2635-2661); figures only from R1 `licenceVehicles`, `licenceDrivers`, `papers` and the page R2 `licenceSpend`.
`export const LicencesTab = (props: MixedTabProps) => JSX.Element`, wrapper `data-dash-tab-body="licences"`. The old body's four cards and
their helpers are DELETED.

1. **TabHead**: doc icon, title `fleet.dash.shell.tab.licences` (now «التراخيص والتجديدات»), sub «تراخيص السيارات ورخص السائقين وأوراق التأمينات
   والضرائب الآن، ومصروفات التراخيص في الفترة.», RefreshTools (HUB: R1 + R2).
2. **BandHead «الآن»** (`first`, LiveChip only); ReadBand for R1 (`nowPending` face).
3. **Six KPIs** (D14), grid `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 min-[1800px]:grid-cols-6`, cars row then drivers row; titles «تراخيص
   تنتهي / خلال {W} يومًا» on two lines (ZL TwoLine). Day phrases (one spelling, B8): «منتهٍ اليوم», «منتهٍ منذ يوم واحد / يومين / N أيام / N
   يومًا», «بعد يوم واحد / يومين / N أيام / N يومًا» — reuse `fleet.dash.licences.expiredToday`; dual-aware forms in tab-licences-words.tsx.
4. **Notes** (ZL NowNotes): fuel pointer «انتهاء كروت الوقود يظهر في» + FootLink «الوقود والمصروفات» (`props.tabLink('fuel', 'licences.fuelTab')`; line
   not drawn when null); narrowed → «السائقون حسب فروعهم في الموارد البشرية، لا حسب فرع السيارة.».
5. **Chart** (D15) FD/tab-licences-chart.tsx; month names through the app's Arabic month words (the odometer/fuel charts' helper); readout picks
   a month (default this month).
6. **Tables** (D16) FD/tab-licences-tables.tsx; driver names via `useFleetPeopleMap` (`fleetDriver.view`, as «الحركة اليوم» :1229), a person
   not found → the code-only identity (`WithExitedDrivers` where the today tab uses it).
7. **BandHead «خلال الفترة»** + `CompanyWide` when narrowed + `PeriodFilterBar periodOnly` (D17) — only when `props.period.enabled &&
   sectionPermitted('licenceSpend', can)`; ReadBand for R2.
8. **Period row** `xl:grid-cols-[2fr_3fr]` (D17) FD/tab-licences-period.tsx + the custody note + `props.tabLink('custody', 'licenceSpend.custodyTab')`
   (plain text when null).
9. **period-filter-bar.tsx**: additive prop `periodOnly?: boolean` — draws the preset select (+ custom dates) and the range echo chip only;
   never the type / operation / codes controls or their chips; default false (every other tab unchanged). Its doc says why (a memo has no branch,
   type, operation or car amount).
10. **LP** (D20): `paper` read (`'insurance' | 'tax'`, anything else ignored) → keep only rows whose `paperStage(row, paper) === 'open'` (the
    board filters in the browser, LP :112-127 pattern); `REMEMBERED_FILTERS` (:82-…) += `'paper'`; `clearFilters`/`hasFilters` include it; ONE
    removable chip «أوراق تأمينات لم تُستلم» / «أوراق ضرائب لم تُستلم» (`data-licensing-paper`); stats bar unchanged.
11. Markers: `data-dash-tab-body="licences"`, `data-dash-band`, `data-lic-kpi="carsExpired|carsExpiring|papers|driversExpired|driversExpiring|missing"`,
    `data-lic-soon=<cars|drivers>`, `data-lic-month=<YYYY-MM>` (+ `data-lic-series=<cars|drivers>`, `data-lic-this-month`), `data-lic-car=<vehicleId>`,
    `data-lic-driver=<profileId>`, `data-lic-spend`, `data-lic-split=<renewal|extension|visa|cash>`.
12. Spec NEW W/fleet-dashboard-tab-licences.spec.tsx: KPIs read their fields and windows (exact hrefs; `W` from each section; «ومن …» hidden
    when W ≥ 60; counted noun for W = 10); K1 chips ≤ 3 + «و N أخرى»; out-of-service line only > 0; papers pair links `licensing?paper=`;
    «رخصة غير مسجّلة» linked, «بلا ملف سائق» plain; badge = K1 + K3 (via shell) and hidden at 0; chart: 12 slots in key order, two series, no
    month total anywhere, this-month word, column links (cars carry `status=active`), a series absent without its section; cars table ≤ 6,
    papers column only with `fleetLicensing.view`, tags only for «open», state words one spelling, «عرض الباقي» only when more > 0; drivers
    table names from the people map, «الملف موقوف» on `active:false`, record links `/fleet/drivers/:id`; period: total = `licenceSpend.total`
    → license-expenses from/to, count/cars plain, split bars plain (NO link), shares one decimal, «الشركة كلها» under B1 and «كل فروعي», bar has
    no type / operation / codes control and no chip of them, type/branch filters do not change the figures; custody note + link; R1 failed
    keeps the period band and vice versa; licensing-only reader sees the papers KPI alone and no period band; licence-expense-only… n/a (no
    page); no `data-zz-`; banned words absent («وثيقة التأمين», «قسط», «فحص فني», «الفيش الجنائي», «كشف طبي», «مخصص», «خزينة», «متوسط تكلفة»,
    «مكتمل», «ذروة», «مجدول», «تسجيل معاملة تجديد», «آخر ما سُجّل»). licensing-screen.spec.tsx: `paper=insurance` lists open insurance papers
    only, chip shown and removable, remembered and read in LP's own source, does not answer a narrowed address from the un-narrowed rows.
13. wl.json — new: `fleet.dash.licences.{sub (change), kpi.carsExpired.title, kpi.carsExpired.sub, kpi.outOfService, kpi.expiring.first,
    kpi.expiring.within, kpi.soon, kpi.warnFoot, kpi.papers.title, kpi.papers.insurance, kpi.papers.tax, kpi.papers.sub, kpi.papers.note,
    kpi.driversExpired.title, kpi.driversExpired.foot, kpi.driversExpiring.first, kpi.missing.title, kpi.missing.noFile, kpi.missing.foot,
    andMore, fuelLine, hrBranchNote, chart.title, chart.note, chart.thisMonth, chart.cars, chart.drivers, chart.foot, cars.title, cars.note,
    cars.col.*, cars.paper.{insurance,tax}, drivers.title, drivers.note, drivers.col.*, suspended (reuse the roster key if one fits), more,
    period.sub, spend.title, spend.tag, spend.count, spend.cars, spend.screen, split.title, split.note, split.byKind, split.byPay,
    custodyNote, count.{car,driver,day}.{one,two,few,many,other}}`; reuse `fleet.dash.licences.expiredToday`, `fleet.dash.now.licenceNotRecorded`,
    `fleet.dash.licences.unregistered`, `fleet.licenseExpenses.kinds.*`, `fleet.licenseExpenses.*` payment words, the catalog words; LP chip
    `fleet.licensing.paperOpen.{insurance,tax}`. dropRead: every old `fleet.dash.licences.*` key the new body no longer reads (latest*, seg*,
    visit*, accident*, mix, more, showVehicles, nearestFirst, vehiclesTitle, vehiclesNote, outOfService (if replaced), noneDue (if replaced),
    driversTitle, driversSub, driversNote, openDrivers, byExpiry, missingData, notRecorded, papersTitle, papersSub, papersNote, openCards,
    openLicensing, papersCaption, cardsCaption, insuranceOpen, taxOpen, cardsExpiring, within, expired, expiredSince, expiresIn, noCulprit,
    recordedAt, inWorkshop, left, noWorkshop, lastDays, newestFirst, latestNote, accidentsLog, visitsLog, latestNone, segLabel) — exact list in wl.md.

**WL exit**: eslint/prettier owned files; `npx vitest run src/modules/fleet/pages/licensing-screen.spec.tsx` green; web typecheck errors only
in HUB files and HUB-pending L names (§8). Hand-off `CL/handoff/wl.md`.

---

## 8. Link builders HUB adds (WC and WL code against these names now)

```ts
// top level (no echo — the custody screens read no branch and keep no period)
export const custodyLinks = {
  log: (op: FleetCustodyLedgerOp | null, metric: string): DashLink =>
    op === null ? at('custody/log', { sort: 'date:desc' }, metric) : at('custody/log', { op }, metric),
  open: (id: string, metric: string): DashLink => at('custody/log', { open: id }, metric),
  memos: (q: { status?: 'pending' | 'held'; kind?: FleetCustodySource }, metric: string): DashLink => at('custody/memos', q, metric),
  days: (from: string, to: string, metric: string): DashLink => at('custody-expenses', { from, to }, metric),   // a «صرف» run
  licenceWaiting: (kind: FleetLicenseExpenseKind | null, metric: string): DashLink =>
    at('license-expenses', { kind, status: 'waiting' }, metric),
};
// custodyDashboardLink (PATH_ONLY) unchanged.
// nowLinks (L:175) — licences
papersOpen: (paper: 'insurance' | 'tax'): DashLink => at('licensing', { paper }, `papers.${paper}`),   // REPLACES licensing()
vehicleLicenceMonth: (ym: string): DashLink => at('vehicles', { status: 'active', licenseMonths: [ym] }, 'licenceVehicles.month'),
driverLicenceMonth: (ym: string): DashLink => driverLicence('licenceDrivers.month', `${ym}-01`, lastDayOf(ym)),
driverLicencesWithin60: (): DashLink => driverLicence('licenceDrivers.more', null, addDaysYmd(today, FLEET_LICENCE_GREY_DAYS)),
driver: (profileId: string, metric: string): DashLink => ({ to: `/fleet/drivers/${encodeURIComponent(profileId)}`, metric }),  // a record
// DELETE visitDay, accidentDay (nowLinks), accidentsRecent, visitsRecent, licensing.
// periodLinks (L:526)
custodySpend: (metric: string, kind?: FleetCustodySource): DashLink =>   // D20: custody-expenses when nothing but codes narrows
  onlyCodes ? at('custody-expenses', { source: kind, ...dates, vehicleCodes: vehicleScope.vehicleCodes }, metric)
            : over('receipts', metric, { kind, source: 'custody' }),
licenceSpend: (metric: string): DashLink => at('license-expenses', { ...dates }, metric),   // no set: a memo has none
// tab links through props.tabLink: ('fuel','licences.fuelTab'), ('fuel','opex.custodyOverlap'), ('custody','licenceSpend.custodyTab').
```
`opexCustody()` stays («أرقام الفترة»). The census treats `/fleet/drivers/:id` as a record (like `/fleet/vehicles/:id`).

---

## 9. HUB (Phase C — after A1, WC, WL report)

Owns the HUB files of §3.

### 9.1 First (so the Phase-B specs can run): L / FDP / T / shell / RT / fixtures
- **L**: §8 builders; header :1-25 (twelve tabs; drivers' records); delete the four recent builders and `licensing()`.
- **FDP** (D3, D5): header :1-35 (twelve tabs; seven mixed: «العهدة» from the custody reads + R2); imports CustodyTab; `MIXED_PANELS += {
  custody, licences }`, `NOW_PANELS` −licences; `MIXED_PERIOD_SECTIONS += { custody: ['opex'], licences: ['licenceSpend'] }`; mixed branch:
  `ownRead = TAB_READS[active].includes('now') ? 'now' : 'web'` drives stamps / refresh / refreshing / nowPending; `dashboardReads.period` =
  some PERIOD section permitted (FLEET_DASHBOARD_PERIOD_SECTIONS).
- **T**: `tabBadges` :132-148 — licences only when n > 0 (D6); doc (no count on «العهدة»).
- **U**: doc only (`licences` opens the rebuilt body; `custody` new).
- **dash-shell**: `SHORT` :152-154 → empty (or removed with its use) — the pill reads the full label.
- **RT** + throttle.spec.ts (D24).
- **FX**: NOW_DTO `licenceVehicles.list` rows widened (makes, classes, papers on «ت» rows, one expired, one > W), `months` (12 keys from TODAY,
  zeros kept), `licenceDrivers.months` + `list` (one suspended row, more > 0); drop `recentWorkshop/recentAccidents`; `CUSTODY_FUND.held`
  (count/amount/memos/receipts) + `letters` (one letter, 3 memos — ties); `seedCustody` += replenish memos (2, one late), settle parts (7: cap
  exercised, one late), outside with a stale kind, and the ledger page under `custodyQueryKeys.ledger(CUSTODY_LEDGER_PARAMS)` (spend runs,
  charge, settle, one held, one transferred with a reference, one cancelled; `meta.totalItems` > rows for the cap chip variant). Branch R1
  fixture: licence rows/months narrowed. **PFX**: PERIOD_FULL / YEAR / narrowed += `opex.custodyCount`, `custodyStates` (Σ = custody),
  `licenceSpend` (renewal + extension = visa + cash = total).

### 9.2 i18n merge (I)
Merge wc.json, wl.json (ar + en blocks in their namespace's region, prettier-stable lines); HUB's own: `fleet.dash.shell.tab.custody`
«العهدة» / 'Custody' (ar beside :21346, en beside :6662); CHANGE `fleet.dash.shell.tab.licences` → «التراخيص والتجديدات» / 'Licences and
renewals'; DELETE `fleet.dash.shell.tabShort.licences` and every dropRead key with no reader left (whole-tree grep incl. specs). Checks:
ar/en parity over new keys, placeholders.spec.ts, formal-arabic.spec.ts, `node scripts/check-formal-arabic.mjs`. (i18n.ts and CHANGELOG.md
carry pre-existing prettier drift on main: format only this PR's lines.)

### 9.3 Shared specs
- **NT**: header (only «ملخصات» is old here); DELETE the old licences pins (the `data-licences-card` blocks incl. :240-252) and the recent-records
  ones; the no-count scan + D3 single call + no-sample pins unchanged (cover the new files by prefix); the Phase-2 / ruled-out loop over 12
  tabs (custody seeded with the ledger; mixed tabs with R2) — add «أعلى السيارات صرفًا», «أعلى السائقين صرفًا», «الحد الأدنى», «حد الأمان» to
  RULED_OUT; «ملخصات» custody pins unchanged.
- **PT**: fallout only («أرقام الفترة» unchanged).
- **SH**: tab list 12 + labels (licences full name, no short pill); mixed set (7); custody: visible only with `fleetCustody.view`, its age and
  «تحديث» are the custody reads + R2, a custody-only reader sends NO R2; licences: badge red n and ABSENT at 0, a licensing-only reader keeps
  the page and sees licences (papers KPI only, no period band, no R2), a licence-expense-only reader has no page; a fuel-card-only reader no
  longer sees licences (sees fuel).
- **LC**: TABS 12; PAGE_PERIOD_TABS ∪ {custody, licences}; render both tabs under company, NOW_BRANCH, «كل فروعي» and the narrowed page R2;
  metrics += `custodyFund.*` (tab metrics), `opex.custody*`, `custodyStates` (none — plain), `licenceVehicles.*`, `licenceDrivers.*`,
  `papers.*`, `licenceSpend.*`; `built()` += §8 builders, − recent/licensing; «checked» += `/fleet/custody/log?op`, `?open`, `?sort`,
  `/fleet/custody/memos?status`, `?kind`, `/fleet/license-expenses?kind`, `?status`, `?from`, `?to`, `/fleet/custody-expenses?source`,
  `/fleet/licensing?paper`, `/fleet/vehicles?licenseMonths`; records += `/fleet/drivers/:id`; named plain figures in the census notes (custody
  counts, held receipts, states, licence split bars, «بلا ملف سائق», out-of-service).
- **LS**: exact URLs of every §8 builder; `licensing()` and the recent builders gone.
- **RF**: refresh joins custody + R2 on custody, R1 + R2 on licences (FDP source pins); `periodDrawn` lists.
- **GT**: keys of `custodyStates` (both), `licenceSpend`; PERIOD_KEYS += 2; PAGE_KEYS/NOW_KEYS sets unchanged; PAGELESS.
- **TP**: NEW LicensingPage block: `paper` → only open papers, chip shown and removable, remembered, read in LP's own source, not answered from
  the un-narrowed rows (the «period screens read the vehicle set» pattern).
- **VCC**: rows for `tab-licences-now.tsx`, `tab-licences-tables.tsx`, `tab-custody-now.tsx` (CarChip).
- **RFC**: LP row += `paper`; TAB_SHARED reason names seven mixed tabs.
- **OV**: re-pin only if a fixture change moves a figure (the hub line still opens `?tab=licences`).
- **Source-scan specs on fallout**: re-pin only what LP's new param and the period bar's prop break.

### 9.4 CHANGELOG.md
One bullet at the top of `### Changed` (:2023, above the #728 bullet :2025), house style: bold title naming «لوحة تحكم الحركة» `/fleet`:
«العهدة» NEW tab after «الوقود والمصروفات» and «التراخيص والتجديدات» replacing the old «التراخيص» body (same key), as approved; owner's
words «اعتمد سامبل العهدة», «اعمل اللى بتفضلوا» (custody Q1), «أ جدول بالسواقين», «اعتمد» (licences), «اعمل «العهدة» و«التراخيص والتجديدات»»;
the bar (12, the two old tabs after); what each shows; badge hidden at 0; «آخر ما سُجّل» retired (R1 `recentWorkshop`/`recentAccidents`,
`FLEET_DASHBOARD_RECENT_*`); fuel-card expiry stays on the fuel tab; new read fields (R1 licence rows/months/drivers list; R2
`opex.custodyCount`, `custodyStates`, `licenceSpend`; fund summary `held.letters`; receipts summary `custodyCount`); LicensingPage reads
`paper`; realtime (licence memos, custody memos/operations move the period read); access (licensing-only keeps `/fleet`, licence-expense-only
does not); «أرقام الفترة»، «ملخصات» unchanged; «No new permission key. No migration; data unchanged; no new index.»

**HUB exit**: from apps/web `npx vitest run src/modules/fleet src/shared/lib src/platform` green (incl. the WC/WL specs); eslint/prettier owned
files; web typecheck clean; `node scripts/check-formal-arabic.mjs` green.

---

## 10. INT (Phase D) — the full gate, CI order, from /home/user/egycash-dash, `CI=true`

0. Clean room: `git ls-files --others --ignored --exclude-standard -- apps/web | grep '/zz-'` prints nothing.
1. CI (.github/workflows/ci.yml, same order; runner = build-vf/gate/gate.sh with `G=$CL/gate/out` → `CL/gate/gate.sh`, one log per step +
   summary.txt):
   ```
   node scripts/check-secrets.mjs
   npm ci                                    # CI only — node_modules present here, not run locally
   npm run build -w packages/contracts
   npm run lint
   npm run typecheck --workspaces --if-present
   node scripts/gen-permission-matrix.mjs --check
   node scripts/check-flag-expiry.mjs
   node scripts/check-page-registry.mjs
   node scripts/automation-templates.mjs
   node scripts/check-formal-arabic.mjs
   npm run test -w packages/contracts
   npm run test -w apps/api
   npm run test -w apps/web
   npm run build                             # contracts + api + web + scripts/check-bundle-require.mjs
   node scripts/dependency-audit.mjs         # needs the npm registry; zod waiver valid until 2026-11-26
   ```
2. House: `npx prettier --check` on this PR's changed .ts/.tsx/.json/.md files (i18n.ts and CHANGELOG.md: this PR's own lines only);
   `git diff --check`; `git status --porcelain` = only §3's files.
3. Words: hand-read every new ar value against ZC/ZL and DECISIONS §9/§11; no English shown to Arabic readers; Latin digits; register words
   («منتهٍ», «تمت الاستعاضة», «في مذكرات لم تُستعَض», «خارج المذكرات», «إيصالات لم تدخل أي مذكرة بعد», «تنتظر التسوية», «الملف موقوف», «رخصة غير مسجّلة»).
4. Real-page shots (mocked API from the contracts dist; harness `apps/web/zz-real-cl.html` + `apps/web/src/zz-real-cl.tsx` mounting the REAL
   FleetDashboardPage, on the model of build-vf/vf; shooter `CL/shots/shoot-real-cl.mjs`; playwright-core /opt/node-tools, chromium
   /opt/pw-browsers/chromium-1194; Vite port 5315; day 2026-11-12 as ZC/ZL; mock figures = the approved sets (custody gap map §8a,
   licences gap map §10a with the critic's B1 make)): custody dark company + «المهندسين» vs cust-dark / cust-branch-dark; licences dark
   company + «المهندسين» vs lic-dark / lic-branch-dark; light 1536 (internal); 1366 and 1920 (12-pill strip + cue + chip, the full licences
   label); 375 (no sideways scroll; tables as blocks; charts scroll); «كل فروعي»; R1-failed / R2-failed / custody-failed faces; a licensing-only
   reader; a custody-only reader; every OTHER tab once (unchanged look; «ملخصات» custody parts and «أرقام الفترة» custody figure equal the
   custody tab's); /fleet/licensing?paper=insurance applied. Each difference = told (§11) or a root fix. Owner gets DARK pictures only (4).
   Stop Vite, delete the harness, repeat step 0.
5. PR body draft per .github/pull_request_template.md (build-vf/hub/pr-body.md style): What & why (owner's words), told list (§11),
   Verification = pasted gate results, the four dark pictures; one CHANGELOG bullet. Commit / push / PR / merge are later workflow steps.

---

## 11. Told list (for the owner — Egyptian Arabic, no English; the same items go in the PR description)

1. اتضاف تبويب جديد «العهدة» بعد «الوقود والمصروفات»، زي الصورة المعتمدة وبأرقام حقيقية: هو نفسه «لوحة تحكم العهدة» بشكل اللوحة الجديد، بنفس المعادلة ونفس الأسماء.
2. تبويب «التراخيص» القديم اتبدّل بـ«التراخيص والتجديدات» زي الصورة المعتمدة، وفي نفس مكانه في الروابط (أي لينك قديم للتراخيص بيفتح الجديد). الاسم في الشريط بقى «التراخيص والتجديدات» كامل بدل «التراخيص» المختصرة.
3. الشريط بقى 12 تبويب: نظرة عامة · الحركة اليوم · توزيع السيارات · الصيانة والورش · العدادات والكيلومترات · الحوادث ومطالبات التأمين · المخالفات المرورية والتسويات · الوقود والمصروفات · العهدة · التراخيص والتجديدات · وبعدهم «أرقام الفترة» و«ملخصات» زي ما هما بنفس أرقامهم (مش في الصور؛ فاضلين لحد ما تقرر تشيلهم). ولأن الشريط طول، على الشاشات الأصغر بيتسحب بالسهم.
4. الرقم الأحمر على «التراخيص والتجديدات» = تراخيص العربيات المنتهية + رخص السواقين المنتهية، ومبقاش يظهر لو صفر (قبل كده كان بيظهر «0» رمادي). مفيش رقم على «العهدة» زي الصورة.
5. جزء «آخر ما سُجّل» (آخر زيارات الورشة والحوادث في 30 يوم) اللي كان في التراخيص القديم مش موجود في التصميم الجديد، فاتشال من اللوحة: الحوادث تلاقيها في «الحوادث ومطالبات التأمين» (جدول «حوادث الفترة» — اختار «آخر 30 يومًا»)، والزيارات في «الصيانة والورش» وشاشة الصيانة. اللي عنده صلاحية الصيانة بس أو الحوادث بس مش هيشوف تبويب التراخيص، بس تبويباته موجودة.
6. «كروت تنتهي خلال 30 يوم» اللي كانت في كارت «أوراق التراخيص وكروت الوقود» القديم مكانها دلوقتي «الوقود والمصروفات» (نفس الرقم ونفس اللينك)، وفي «التراخيص والتجديدات» سطر واحد بيفتح تبويب الوقود. اللي عنده صلاحية كروت الوقود بس هيلاقيها في تبويب الوقود.
7. أرقام «أوراق لم تُستلم بعد» (تأمينات / ضرائب) بقت بتفتح «لوحة التراخيص» على الأوراق المفتوحة بس — اتضاف في الشاشة دي فلتر جديد بيبان كشريحة وتتشال بضغطة. قبل كده كان بيفتح اللوحة كلها مترتبة.
8. اللي عنده صلاحية «لوحة التراخيص» بس هيفضل يفتح لوحة الحركة ويشوف «التراخيص والتجديدات» بالأوراق بس؛ واللي عنده صلاحية «مصروفات التراخيص» بس مش هيفتح اللوحة.
9. شريط الفترة في «التراخيص والتجديدات» فيه اختيار الفترة بس (مفيش نوع السيارة ولا التشغيل ولا الأكواد)، لأن مذكرات التراخيص مالهاش فرع ولا نوع عربية ولا تشغيل ولا مبلغ لكل عربية؛ ولما تختار فرع مصروفات التراخيص بتفضل للشركة كلها وعليها «الشركة كلها».
10. «رخص سائقين منتهية» ممكن تطلع أكبر من «رخصة منتهية» في «الحركة اليوم»: السواق الموقوف بيتحسب هنا، وهناك بيظهر تحت «الملف موقوف». وفي جدول «أقرب رخص السائقين» السواق الموقوف عليه علامة «الملف موقوف» (مش موجودة في الصورة لأن مفيش سواق موقوف فيها).
11. تاريخ رخصة السواق اللي بيتحسب هو اللي في ملف السائق في الحركة، مش اللي في ملف الموظف في الموارد البشرية؛ اللي مكتوب في الموارد البشرية بس هيبان «رخصة غير مسجّلة».
12. العربيات بتتبع فرع العربية، والسواقين بيتبعوا فرعهم في الموارد البشرية (مكتوب تحت الكروت لما تختار فرع).
13. «خلال 30 يومًا» جاية من «إعدادات الحركة» (مدة التنبيه للعربيات وللسواقين) والـ60 ثابتة؛ لو غيرت الإعداد العنوان والأرقام بيتغيروا معاه، ولو بقى 60 أو أكتر سطر «ومن … إلى 60 يومًا» بيختفي. ملحوظة قديمة: «لوحة التراخيص» وشاشة العربيات لسه بيلوّنوا الأصفر على 30 يوم ثابتين.
14. رسم «التراخيص المستحقة للتجديد — 12 شهرًا» بيبدأ من الشهر الحالي، وكل عمود بيفتح قائمة الشهر ده (عربيات نشطة أو سواقين).
15. «مصروفات التراخيص في الفترة» بيوم المذكرة: «عدد المذكرات» زي شاشة مصروفات التراخيص (المذكرة الواحدة ممكن يبقى فيها تجديد ومد مدة)، و«السيارات» = العربيات المكتوبة في المذكرات زي الشاشة (حتى المكتوبة بإيد، والعربية اللي في الجزئين بتتعد مرتين). بارات «تجديد تراخيص / مد مدة» و«فيزا / نقدي» أرقام من غير لينك، لأن مفيش فلتر في الشاشة بيطابقها بالظبط.
16. في «العهدة»: جزء «الآن» (المعادلة، اللي مستني استعاضة أو تسوية، التنبيهات، الرسم، آخر العمليات) للشركة كلها من بداية العهدة ومش بيتأثر بالفلاتر، ولما تختار فرع (أو «كل فروعي») عليه «الشركة كلها». جزء «خلال الفترة» بيتبع الفرع عن طريق عربية الإيصال.
17. «مصروفات العهدة» في الفترة وبارات الأنواع هي نفس أعمدة «صيانة» و«وقود من العهدة» و«كاوتش» و«غسيل» في «الوقود والمصروفات» لنفس الفترة والفرع، فمش بتتجمع معاها (الجملة مكتوبة تحتها). و«منها حتى الآن» حالة الإيصالات النهارده، فرقم شهر فات ممكن يتغير لما تحصل استعاضة.
18. «استعاضة معلّقة»: لو فيه أكتر من خطاب مستني التحويل بيظهروا كلهم تحت بعض (الصورة فيها خطاب واحد)، و«منذ N أيام» من أقدم خطاب.
19. «في مذكرات لم تُستعَض بعد» و«تنتظر التسوية» بيعرضوا أول 6 بس وتحتهم «و N أخرى» لو أكتر (الصورة فيها 2 و3). وزرار «فتح» على مصروفات التراخيص بيظهر بس للي عنده صلاحية «مصروفات التراخيص».
20. «تنبيهات العهدة» بتعرض بس اللي شغال من القواعد الخمسة؛ التأخير بالأصفر، والأحمر بس لما العهدة تبقى بالسالب أو التسويات المستنية أكبر من العهدة. لو مفيش: «لا توجد تنبيهات الآن».
21. رسم «إجمالي العهدة بعد كل عملية» بيرسم آخر 100 عملية (لو أكتر بيكتب «آخر 100 عملية»)، والاستعاضة المعلّقة والملغاة مش مرسومة؛ الخط بلون البرنامج والأحمر تحت الصفر.
22. في «نظرة عامة» مفيش تغيير: «فتح لوحة العهدة» و«تنبيهات لوحة العهدة» لسه بيفتحوا «لوحة تحكم العهدة» زي ما مكتوب عليهم، وسطر «تراخيص قريبة» بيفتح «التراخيص والتجديدات» الجديد. اسم الكارت «رصيد العهدة النقدية» فضل زي الصورة المعتمدة (لو حابب يبقى «إجمالي العهدة» زي شاشة العهدة قولّي).
23. «أرقام الفترة» و«ملخصات» زي ما هما، والأرقام اللي بيشاركوا فيها مع التبويبين الجداد (إجمالي العهدة، تنتظر الاستعاضة، تنتظر التسوية، مصروفات العهدة) هي نفس الرقم بالظبط.
24. مفيش في التبويبين أي زرار تسجيل ولا تصدير؛ «فتح» بس، وكل رقم بيفتح الشاشة اللي بتعرض نفس الرقم.
25. على الموبايل الجداول بتتعرض كروت تحت بعض من غير ما الصفحة تتسحب جنب، والرسمين بيتسحبوا جوه الكارت.
26. لو حابب بعدين نضيف «حركة العهدة في الفترة» (كام اتطلب واتعوّض واتسوّى في الشهر)، دي إضافة لوحدها. ولو حابب نسجّل تاريخ انتهاء وثيقة التأمين أو الفحص الفني، دا طلب لوحده.

---

## 12. Risks / notes

1. Phase-B web specs cannot run before HUB wires FDP / L / FX — written against §8 names, run at HUB's end; INT fixes at root.
2. R2 carries two more sections on EVERY R2 read (incl. the overview's month read): PERF re-pin; `custodyByMemo` reads every custody receipt of
   the range (bounded by the range; index `ix_receipt_source_date`).
3. `custodyStates` money: groups rounded to the piastre then summed; pinned Σ = `opex.custody` on realistic fixtures — a float tail would show
   as a 0.01 gap; A1 sums in whole piastres.
4. `held.letters` makes `FleetCustodyFundSummaryDto` wider: ten custody web specs and three api integration specs need `letters` in their
   literals (fallout, WC/A1).
5. A back-dated licence memo or receipt refreshes a PAST period only on «تحديث» or reload (LIVE key only, the receipts precedent); custody memo /
   operation events refresh past periods too (states as of now).
6. The licences tab reads `/fleet/people` for driver names (one cached read, the «الحركة اليوم» pattern); a driver missing from it shows the
   code-only identity.
7. `recentWritten` stays in the maintenance and accident modules with no dashboard reader — a later cleanup, noted in a1.md.
8. The custody chart reads up to 100 ledger rows on the custody tab only (shared cache with «لوحة تحكم العهدة»).
9. Counted words with dual forms are tab-local again (custody, licences) beside the fuel tab's — a later kit unification.
10. Data unknowns (no DB access): live number of held letters, late memos/receipts, a negative fund, licence class names, drivers without a
    date, how many memos name hand-typed plates.
11. The approved harnesses in /home/user/egycash/apps/web/src (git-excluded) are never edited; move any zz file out of this tree before a gate.
