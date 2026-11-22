# Owner follow-ups (2026-11-22) — the build plan

TEMPORARY NOTES (inside `.wip-notes/`, removed before the PR). Spec: `.wip-notes/followups-spec.md`.
Base: `53594fd2` (= main `04651a71`). The work = `git diff 53594fd2 -- . ':!.wip-notes'`.

## 0. Common rules for every package

- Edit ONLY the files your package owns (§6). A file you need changed elsewhere → a line in your
  hand-off `/home/user/egycash/.wip-notes/followups/handoff-<pkg>.md`, never an edit.
- New / changed / removed UI words → `/home/user/egycash/.wip-notes/followups/i18n/<pkg>.json`:
  `{ "remove": ["key", …], "set": { "key": { "ar": "…", "en": "…" } } }` (`set` = new key or new
  value; ar AND en always; formal Arabic; Latin digits). Never edit `i18n.ts` (HUB).
- A spec that reads a new/changed word is RED until the HUB merges the JSON: run it anyway, list the
  red assertions (and only those) in the hand-off.
- MEMORY: every vitest / tsc / contracts build goes through ONE lock, so two never run at once:
  `L=/tmp/claude-0/-home-user/85f289ec-521b-5944-9b89-a0120b22d71a/scratchpad/followups/heavy.lock`
  - web spec: `cd /home/user/egycash/apps/web && flock $L npx vitest run <file>`
  - api spec: `cd /home/user/egycash/apps/api && flock $L npx vitest run --maxWorkers=1 <file>`
    (ONE file per run, integration specs included)
  - contracts: `cd /home/user/egycash && flock $L npm run build -w packages/contracts`
  - typecheck: `cd /home/user/egycash && flock $L npx tsc --noEmit -p apps/web` (or `apps/api`)
  Never the full web/api suite (the gate does that, alone). Big logs / screenshots →
  `/tmp/claude-0/-home-user/85f289ec-521b-5944-9b89-a0120b22d71a/scratchpad/followups/<pkg>/`.
- No commit, no push, no PR, no publish. Never revert or amend the parent's WIP commits. Never skip,
  `.only`, disable or loosen a spec; re-pointing a pin to the owner's new decision is allowed and
  must stay at least as strict (assert the new face AND the absence of the old one).
- Screenshot harnesses: copy the approach of
  `/tmp/claude-0/-home-user/85f289ec-521b-5944-9b89-a0120b22d71a/scratchpad/fixed-build/owner-harness/`
  (vite + `cdp.mjs` + `/usr/bin/google-chrome`, Chrome 153; or playwright at
  `/opt/node-tools/node_modules/playwright` with `executablePath: '/usr/bin/google-chrome'`). Harness
  files inside `apps/web` only as `zz-*` (git-excluded) and DELETED before you finish; nothing `zz-` is
  ever committed. Dark mode for anything the owner sees.
- `contracts` changes reach api/web only through `packages/contracts/dist` (rebuild). Only `dash-api`
  rebuilds contracts; the others never do.

## 1. Answer 1 — remove «أرقام الفترة» (key `period`); «ملخصات» (`summaries`) stays untouched

### 1.1 What the current code holds (verified)

- `packages/contracts/src/modules/fleet-dashboard.ts`
  - `FLEET_DASHBOARD_TABS` (l.55): 12 keys, `'period'` 11th, `'summaries'` last.
  - `FLEET_DASHBOARD_TAB_READS.period = ['period']` (l.90); `summaries = ['now','web']` (no R2).
  - `FLEET_DASHBOARD_PERIOD_TABS = ['period']` (l.101) — the ONLY member; becomes empty → delete.
  - `FLEET_DASHBOARD_TAB_SECTIONS.period = ['km','visits','accidents','opex','dealership']` (l.655).
  - `FLEET_DASHBOARD_PERIOD_SECTIONS` (l.402) holds `visits`; `FLEET_DASHBOARD_GATES.visits`
    (l.509, `fleetMaintenance.view`, `/fleet/maintenance`).
  - `FleetDashboardPeriodDto.visits` (l.1434) + `FleetDashboardPeriodVisitsDto` (l.1711);
    `accidents.openRemaining` (l.1448, doc: "«أرقام الفترة»'s").
  - `FLEET_DASHBOARD_TAB_PARTS` doc (l.700-706) names «أرقام الفترة»; header comments l.1-27, 44-54,
    94-100 name the old tab.
  - Key unions: `visits` and `exits` share the gate `fleetMaintenance.view`, and `exits` follows
    `visits` in `ALL_SECTIONS` → `FLEET_DASHBOARD_PERIOD_KEYS`, `FLEET_DASHBOARD_PAGE_KEYS`,
    `FLEET_DASHBOARD_SCOPE_KEYS` stay IDENTICAL (set and order). No permission key changes;
    `gen-permission-matrix --check` must stay green.
- Which tab or «ملخصات» reads each section of `GET /fleet/dashboard/period` (period.service.ts):

  | section | read by (besides «أرقام الفترة») | fate |
  |---|---|---|
  | km | «العدادات والكيلومترات», «نظرة عامة» month card, «توزيع السيارات» (month) | keep |
  | visits | NOBODY (check-in day; `fleetMaintenanceService.visitStates` → repo `stateCounts`) | REMOVE section + service + repo method |
  | exits | «الصيانة والورش», overview month «زيارات الصيانة» | keep |
  | accidents | «الحوادث ومطالبات التأمين», overview month, hub | keep; drop field `openRemaining` (only tab-period read it; `open.count` still needs the same query) |
  | accidentList | accidents tab | keep |
  | violations / violationList | «المخالفات المرورية والتسويات» | keep |
  | opex | «الوقود والمصروفات», «العهدة» (part), overview month | keep |
  | opexSeries | fuel tab | keep |
  | custodyStates | «العهدة» | keep |
  | dealership | fuel tab | keep |
  | dealershipList | fuel tab | keep |
  | licenceSpend | «التراخيص والتجديدات» | keep |
  «ملخصات» reads R1 (`fuelCharging`, `accidentsOpen`, `violationsYear`) + the custody hooks — no R2.
- Web:
  - `pages/FleetDashboardPage.tsx`: imports `FLEET_DASHBOARD_PERIOD_TABS`, `PeriodTab`
    (`components/fleet-dashboard/period-tabs`); `PeriodTabKey`/`isPeriodTab`, the `PeriodTab`
    branch (l.366-381), `NOW_PANELS` type excludes `PeriodTabKey`; header comment "Twelve tabs".
  - `components/fleet-dashboard/period-tabs.tsx` (`PeriodTab`, `PeriodTabProps`, only `tab:'period'`)
    and `tab-period.tsx` (`PeriodFiguresTab`, `PeriodBodyProps`, `Dot`, AND `kmText`, which
    `tab-km.tsx:102`, `tab-distribution.tsx:108`, `km-chart.tsx:41` import).
  - `lib/fleet-dashboard-links.ts` `periodLinks`: `visits(...)` (l.683) and `opexCustody()` (l.716)
    are drawn only by tab-period (`opexCustody` = `custodySpend('opex.custody')`, which stays —
    «العهدة» uses `custodySpend`).
  - `lib/fleet-dashboard-url.ts`: `readTab` — an unknown tab falls back to `visible[0]`; once
    `period` is no tab, `?tab=period` opens «نظرة عامة» by construction (no LEGACY entry needed).
    Header comment names «أرقام الفترة».
  - `lib/fleet-dashboard-tabs.ts` `tabBadges`: no badge for `period` (nothing to remove).
  - Overview hub (`tab-overview.tsx`): no card or link to `period` (verified: no `tabLink('period'`
    anywhere; no `tab=period` href in code).
  - `dashboardReads.period` keeps sending R2 for every reader who saw «أرقام الفترة»: each of its five
    sections is drawn by another tab (table above; `visits` shares its gate with `exits`), so no
    reader loses the page or R2.
- i18n read ONLY by the removed files: `fleet.dash.shell.tab.period`, `fleet.dash.filters.rangeHead`,
  `fleet.dash.period.{today, km.*, visits.*, accidents.*, opex.*, dealership.*}` (24 + 2 keys).
  KEEP `fleet.dash.period.dataFrom` (tab-fuel-period.tsx:93, tab-custody-period.tsx:66) and
  `fleet.dash.period.notSummed` (tab-fuel-period.tsx:585, fuel spec).

### 1.2 Every figure of «أرقام الفترة» and where it still shows

| card · figure | still shows (tab · label) |
|---|---|
| «الكيلومترات المقطوعة» total | «العدادات والكيلومترات» · «إجمالي الكيلومترات» (+ month on «نظرة عامة» «ملخص إحصائيات هذا الشهر») |
| «متوسط … كم للسيارة» | «العدادات والكيلومترات» · «متوسط لكل سيارة» |
| «مؤكدة حتى …» / «لا يوم مؤكد بعد» | «العدادات والكيلومترات» · tag of «إجمالي الكيلومترات» and the chart notes |
| «لم تُغلق بعد: …» (open days) | «العدادات والكيلومترات» · chart notes «لم تُغلق القراءة بعد: …» |
| «قراءات تحتاج مراجعة N» | «العدادات والكيلومترات» · card «قراءات تحتاج مراجعة» |
| «قراءات لـX من Y» | «العدادات والكيلومترات» · under «متوسط لكل سيارة» — its % bar is DROPPED |
| «زيارات الصيانة» by CHECK-IN day: count, «خرجت», «ما زالت في الورشة», «خرج منها حتى الآن» % | DROPPED (no other tab counts by check-in day). Nearest: «الصيانة والورش» · «خرجت من الورشة» (by exit day) and «في الورشة الآن» |
| «الحوادث» count | «الحوادث ومطالبات التأمين» · «حوادث الفترة» (+ overview month) |
| «مفتوحة N» | same card · «منها N مفتوحة حتى الآن» |
| «المتبقي» of the OPEN files only | DROPPED; that tab shows «إجمالي المتبقي» of all the period's files (open + closed) in «مبالغ ملفات حوادث الفترة» |
| «حوادث بلا تاريخ لا تدخل أي فترة» | «الحوادث ومطالبات التأمين» · «والحوادث بلا تاريخ (N) لا تدخل أي فترة.» |
| «المفتوحة منها» % bar | DROPPED |
| «مصروف التشغيل» total | «الوقود والمصروفات» · «مصروف التشغيل» (+ overview month) |
| «إيصالات الكارت» | «الوقود والمصروفات» · «مصروف التشغيل حسب النوع» (the card bar) |
| «إيصالات العهدة» | «العهدة» · «مصروفات العهدة» (and by kind in «مصروف التشغيل حسب النوع») |
| «كارت ثم عهدة» % bar | as each kind's share in «مصروف التشغيل حسب النوع» (no single card-vs-custody bar) |
| «الإيصالات وحدها؛ شحن الكروت تمويل…» note | «الوقود والمصروفات» · tag «الإيصالات وحدها» |
| «فواتير التوكيل» amount, rows, «بانتظار الفاتورة» | «الوقود والمصروفات» · «فواتير التوكيل» |
| «الصفوف المسجّلة قيمتها» % bar | DROPPED |
| «البيانات متاحة من …» | «الوقود والمصروفات» and «العهدة» |
| «مصروف التشغيل وفواتير التوكيل لا يُجمعان…» | «الوقود والمصروفات» |

## 2. Answer 2 — overview card «رصيد العهدة النقدية» → «إجمالي العهدة»

`tab-overview.tsx:413` `title={w('kpi.custody.title')}` → key `fleet.dash.overview.kpi.custody.title`
(ar l.22521 «رصيد العهدة النقدية», en l.7057 "Cash custody balance"), read ONLY there. Same figure
(`custody.fundTotal`), same links (`custodyFund.total`, `custodyFund.dashboard`). Change = the value
only: ar «إجمالي العهدة», en "Custody fund total" (= `fleet.custody.fund.title` en). Spec: overview
K6 (`fleet-dashboard-tab-overview.spec.tsx:418`) asserts the new title text and the old one gone.

## 3. Answer 3 — «سجل العهدة» keeps «2 سيارات»: NO change anywhere.

## 4. Answer 4 — the shared ErrorState prints no raw code

`apps/web/src/shared/ui/states/ErrorState.tsx` l.36-43: a quiet `<p class="font-mono …" dir="ltr">`
with `diagnostic.code` (e.g. `INTERNAL`) and `· requestId` (`req_<uuid>`, minted by
`apps/api/src/infrastructure/http/request-context.ts:45`). Used by ~114 screens and by `DataTable`.
Readers that rely on it: the "findable in the API log" intent (`errors.spec.ts` tests
`errorDiagnostic` itself — unchanged); `VehiclesListPage.tsx:1381` styles `[&_td_.font-mono]` (the id
in a table cell; `fleet-figures-font.spec.ts` pins that selector); `errors.spec.ts` source guard
"ErrorState gates on hasError". Decision: never print the code (any locale — the friendly message is
already chosen by it, and the API log line found by the reference holds it); when `requestId` exists
print one quiet line `«الرقم المرجعي»: <bdi dir="ltr" class="font-mono">req_…</bdi>` (the system
already names it so: login message «الرقم المرجعي {{requestId}}»); no requestId → no line.

## 5. Answer 5 — done by the parent (artifact deleted). Nothing to build.

## 6. Answer 6 — the small fixes (each verified in the current code)

a. `apps/web/src/modules/fleet/lib/licence-months.ts` `monthCountOptions`: `tag = 'ar-EG'` for BOTH
   the month name and the count → «أكتوبر ٢٠٢٦ (١٢)». Readers: `licenceMonthOptions` →
   `VehiclesListPage.tsx:245` and `LicensingPage.tsx:308` («شهر انتهاء الترخيص»), and
   `NoticesPage.tsx:570` («الإخطارات» · «حسب الشهر» breakdown, name with the count stripped). Fix:
   `ar-EG-u-nu-latn` → «أكتوبر 2026 (12)»; en unchanged (`en-GB`).
b. `pages/VehicleDetailPage.tsx`: `formatNumber` (shared, `ar-EG` = Arabic-Indic) at l.174, 176
   (alarm km), 249 («آخر قراءة عداد»), 255 («أعلى قراءة {{km}} كم»), 285 («آخر صيانة» km), 619
   (maintenance interval); dates via `formatDate`/`formatDateTime` (`ar-EG`, «١٠‏/٠٨‏/٢٠٢٦») at l.205,
   210, 603, 606, 624, 649 — the vehicles list beside it writes Latin (`ymd`). Fix the WHOLE page
   body: numbers in Latin («50,000»), dates the same style in Latin digits (`ar-EG-u-nu-latn`,
   «10‏/08‏/2026»), page-local helpers (do NOT touch shared `format.ts`). The print sheet rows
   (l.444, 448, `printLicenceRecord`, the registry's own sheet) stay as they are.
c. `VehicleDetailPage.tsx` `useHistoryCounts` l.322: accidents counted by `vehicleId`
   (`useAccidents({vehicleId,…})`) while the link (l.95) opens `/fleet/accidents?vehicleCodes=<code>`,
   which also lists old-book files under that code (`accident.service.ts` `vehicleClause`). Fix:
   count with `{ vehicleCodes: [code], page: 1, pageSize: 1 }`, gated on `code !== ''` — exactly as
   odometer/maintenance (D20(d)). «سجل نظيف» then follows the code count.
   (Observed, NOT in the owner's list, not touched: violations count by id vs `codes`/`dcodes` link.)
d. `components/EmployeeName.tsx` l.92: `<span className="ms-2 … " dir="ltr">code</span>` — `ms-2` =
   `margin-inline-start` resolved in the span's OWN (ltr) direction = the left = the far side in RTL
   → name and code touch. Readers of `<EmployeeName>`: `RosterAssignDialog.tsx` l.50 (seat) and l.100
   (option button, `card={false}`), `DriverFormDialog.tsx:295`, and via `DriverName`:
   `CompanyViolationsDetailLayer`, `DriverViolationsPanel`, `tab-violations.tsx`. All of them show the
   same touching pair in Arabic; in English the margin is right already. ONE shared fix: the margin
   on an element in the page's direction, the code isolated inside it:
   `<span className="ms-2 font-figures text-xs text-slate-500"><bdi dir="ltr">{code}</bdi></span>` —
   gap between name and code in both directions, every reader improves, nothing else moves.
   `FixedCrewDialog.tsx` keeps its own `NameAndCode` (its comment l.26-28 updated only).
e. Daily notes: desk `RosterAssignDialog.tsx` `<Textarea rows={2}>` (no cap); touch
   `RosterTouchBoard.tsx:563` `<NotesSheet>` without `maxLength` (NotesSheet default = uncapped,
   pinned by `roster-optional-props.spec.tsx`). API cap: `PlanFleetRosterRowSchema.notes.max(500)`
   (contracts fleet.ts:1840; fixed: l.1974); the fixed screen caps 500 (FixedCrewDialog l.334,
   FixedTouchBoard `NOTE_MAX`). Fix: `export const ROSTER_NOTE_MAX = 500` in
   `components/roster/roster-parts.tsx` (the daily shared parts), `maxLength={ROSTER_NOTE_MAX}` on both
   daily inputs. NotesSheet's default and the fixed `NOTE_MAX` stay.
f. `components/roster/RosterDeskBoard.tsx:155` `MISSION_BOX = "mx-auto w-[9.5rem] max-[1535px]:w-36
   [&_select]:…Cairo"`, used by the daily (l.315) and fixed (`FixedDeskBoard.tsx:218`) desk boards
   around `CatalogSelect density="tight"` (`px-2` + `pe-6` + 2px border). Text room: 152−34 = 118px
   at ≥1536 (1920), 144−34 = 110px at 1280–1535 (1280, 1366). A longer name is HARD-CUT (Chrome 153
   probe: «نقل أموال (يومي) بـ», no ellipsis), and the hover title is `CatalogSelect`'s
   `title={ariaLabel}` = «150 · نوع المهمة», not the name. Fix without any width change (so both
   tables keep their measured fit at 1280/1366/1440/1920 by construction): append
   `[&_select]:!truncate` to MISSION_BOX (Chrome 153 renders «نقل أموال (يوم…» — probed) and give
   `CatalogSelect` an optional `title` prop (default stays `ariaLabel` for every other caller); both
   boards pass the chosen mission's full name (`m.missionName(row.missionTypeId)`) when one is set.

## 7. The packages (parallel) and the HUB (last)

Each file has ONE owner. Hand-offs: `/home/user/egycash/.wip-notes/followups/handoff-<pkg>.md`.

### P1 `dash-api` (api) — contracts + server side of answer 1
Files:
- packages/contracts/src/modules/fleet-dashboard.ts
- packages/contracts/src/modules/fleet-dashboard.spec.ts
- apps/api/src/modules/fleet/dashboard/period.service.ts
- apps/api/src/modules/fleet/dashboard/period.service.spec.ts
- apps/api/src/modules/fleet/maintenance/maintenance.service.ts
- apps/api/src/modules/fleet/maintenance/maintenance.repository.ts
- apps/api/src/modules/fleet/maintenance/maintenance-breakdown.spec.ts
- apps/api/tests/integration/fleet-dashboard.spec.ts
- apps/api/tests/integration/fleet-dashboard-parity.spec.ts
- apps/api/tests/integration/fleet-dashboard-performance.spec.ts
- apps/api/tests/integration/fleet-maintenance-breakdown.spec.ts
Tasks (contracts FIRST, then build, then write `handoff-dash-api.md` line "contracts built <time>"
so `dash-web` can run its specs):
1. Before editing, record the current `FLEET_DASHBOARD_PERIOD_KEYS`, `FLEET_DASHBOARD_PAGE_KEYS`,
   `FLEET_DASHBOARD_NOW_KEYS`, `FLEET_DASHBOARD_SCOPE_KEYS` arrays (node over dist) in the hand-off.
2. contracts: drop `'period'` from `FLEET_DASHBOARD_TABS`, `TAB_READS`, `TAB_SECTIONS`; delete
   `FLEET_DASHBOARD_PERIOD_TABS`; drop `visits` from `FLEET_DASHBOARD_PERIOD_SECTIONS`, the gate,
   the DTO and `FleetDashboardPeriodVisitsDto`; drop `accidents.openRemaining`; rewrite every comment
   that names «أرقام الفترة» / "twelve tabs" / "the two old tabs" (eleven tabs, «ملخصات» the one old
   tab kept). `summaries` untouched.
3. Build contracts (lock). `node scripts/gen-permission-matrix.mjs --check` green.
4. API: remove the `visits` section from `periodSections` and its comments (l.109-116, header);
   `accidents` returns `{ count, open, undated, totals }`; remove `visitStates` (maintenance.service
   l.944-953 + its `FleetDashboardPeriodVisitsDto` import) and `stateCounts` (repository l.797-818) —
   nothing else calls them.
Specs:
- contracts spec: eleven tabs in order ending `licences`, `summaries`; `TAB_READS` has no `period`;
  `'FLEET_DASHBOARD_PERIOD_TABS' in contracts === false`; `PERIOD_SECTIONS` without `visits`, GATES
  without `visits`; the four key unions EQUAL the arrays recorded in task 1 (exact order); fix the
  table/`exits === visits` gate lines (l.487, 651-658: `exits` gated `fleetMaintenance.view`); drop
  `openRemaining` from the DTO sample (l.1551).
- period.service.spec: no `visits` mock/section (l.21, 111, 183, 281, 747, 845); `'visits' in dto`
  is false; accidents `toEqual({ count, open: 1, undated: 25, totals })`; the section count of
  `runSections` = 12.
- maintenance-breakdown.spec (unit): remove the `visitStates` cases (l.203-212, 245-262) only; the
  `exitBreakdown` loop over QUERIES+EXIT_QUERIES and every other case stay; add
  `expect('visitStates' in fleetMaintenanceService).toBe(false)`.
- integration (each alone, `--maxWorkers=1`): fleet-dashboard.spec (l.161 list, l.587 a maintenance
  clerk now gets `['exits']`, l.697/804/832 → assert `visits` absent), parity (drop the visits parity
  l.1639-1642, 1860-1862, 1886, 1962, 2043 and `openRemaining` l.1688/1890; keep every other parity),
  performance (drop visits from l.993-1017 test + title; RUN it, then set `CEILING.r2` and
  `CEILING_FILTERED_R2` to the measured values — lower only, never raise — with a comment line
  "«أرقام الفترة» retired: its one `$group` gone"), fleet-maintenance-breakdown (drop the
  `visitStates` describe l.405-445, the explain case l.751-757 and header item 1; `exitBreakdown`,
  `openNow`, `recentWritten`, «الفرع» stay).
- Run: contracts spec, period.service.spec, maintenance-breakdown.spec, dashboard-hygiene.spec, then
  the four integration specs, one by one. `flock $L npx tsc --noEmit -p apps/api` clean.
Hand-offs: none for i18n. To HUB: fixture fields to drop (`visits`, `openRemaining`).

### P2 `dash-web` (web) — the web side of answers 1 and 2
Files:
- apps/web/src/modules/fleet/pages/FleetDashboardPage.tsx
- apps/web/src/modules/fleet/lib/fleet-dashboard-links.ts
- apps/web/src/modules/fleet/lib/fleet-dashboard-url.ts
- apps/web/src/modules/fleet/lib/fleet-dashboard-tabs.ts
- apps/web/src/modules/fleet/components/fleet-dashboard/tab-km.tsx
- apps/web/src/modules/fleet/components/fleet-dashboard/tab-distribution.tsx
- apps/web/src/modules/fleet/components/fleet-dashboard/km-chart.tsx
- apps/web/src/modules/fleet/components/fleet-dashboard/tab-maintenance.tsx
- apps/web/src/modules/fleet/fleet-dashboard-shell.spec.tsx
- apps/web/src/modules/fleet/fleet-dashboard-link-census.spec.ts
- apps/web/src/modules/fleet/fleet-dashboard-links.spec.ts
- apps/web/src/modules/fleet/fleet-dashboard-gates.spec.ts
- apps/web/src/modules/fleet/fleet-dashboard-blocks.spec.tsx
- apps/web/src/modules/fleet/fleet-dashboard-refresh.spec.ts
- apps/web/src/modules/fleet/fleet-dashboard-tab-overview.spec.tsx
- apps/web/src/modules/fleet/fleet-dashboard-tab-accidents.spec.tsx
- apps/web/src/modules/fleet/fleet-dashboard-period-tabs.spec.tsx (DELETE)
- apps/web/src/shared/lib/remembered-filters-coverage.spec.ts
Tasks:
1. Move `kmText` (en-US whole, comma-grouped) into `lib/fleet-dashboard-tabs.ts` (display
   arithmetic); re-point the three imports (tab-km, tab-distribution, km-chart). Do NOT delete
   tab-period.tsx / period-tabs.tsx (HUB, with the fixtures that import them).
2. FleetDashboardPage: no `FLEET_DASHBOARD_PERIOD_TABS`, `PeriodTab`, `PeriodTabKey`, `isPeriodTab`
   or PeriodTab branch; `NOW_PANELS: Record<Exclude<FleetDashboardTab, MixedTabKey>, …>`; header
   "eleven tabs … «ملخصات» the old tab kept"; R2 comment l.19 → the mixed panels and the month read.
3. links: delete `visits(...)` and `opexCustody()` from `periodLinks` (`custodySpend` stays); fix the
   header comment l.4. url: header comment. tab-km l.24-25 / tab-maintenance l.15: comments only.
4. i18n `/home/user/egycash/.wip-notes/followups/i18n/dash-web.json`:
   remove `fleet.dash.shell.tab.period`, `fleet.dash.filters.rangeHead`, `fleet.dash.period.today`,
   `fleet.dash.period.km.{title,average,confirmedThrough,noneConfirmed,open,invalid,coverage}`,
   `fleet.dash.period.visits.{title,split,note,bar}`,
   `fleet.dash.period.accidents.{title,split,undated,bar}`,
   `fleet.dash.period.opex.{title,split,note,bar}`,
   `fleet.dash.period.dealership.{title,pending,note,bar}`;
   set `fleet.dash.overview.kpi.custody.title` = { ar «إجمالي العهدة», en "Custody fund total" }.
   KEEP `fleet.dash.period.dataFrom` and `fleet.dash.period.notSummed`.
Specs:
- shell: the bar = eleven tabs (…, `licences`, `summaries`), no pill «أرقام الفترة»; `/fleet?tab=period`
  and `/fleet?tab=period&period=last30` press «نظرة عامة» (`data-dash-panel="overview"`, no
  `data-period-tab`), and `?tab=km&period=last30` still reads the period (the filter is untouched);
  the H1 test l.171 is replaced by these; a reader holding exactly the five keys the old tab needed
  (`fleetOdometer.view`, `fleetMaintenance.view`, `fleetAccident.view`, `fleetReceipt.view`,
  `fleetDealership.view`) sees «العدادات والكيلومترات», «الصيانة والورش», «الحوادث ومطالبات التأمين»,
  «الوقود والمصروفات»; `translate('ar', key) === key` for every removed key (RED until HUB merge).
- census: 11 tabs (l.471), `PAGE_PERIOD_TABS` = the seven mixed tabs; drop `P.opexCustody()`,
  `P.visits(...)`, `'visits'` from the sections list (l.492) and `/^visits\./u` (l.944); assert no
  link metric starts `visits.` and no href carries `tab=period`.
- links: `P.visits` cases → `P.exits` (branch narrowing l.566; plain-link list l.470; l.236-237
  dropped; l.655 and l.1420 «أرقام الفترة» lines dropped); the D20 tests l.497-509 and l.571-576
  re-pointed to `custodySpend('opex.custody')` with the SAME expectations.
- gates: l.104 → `expect(fleetDashboardGateKeys('exits')).toEqual(['fleetMaintenance.view'])`.
- blocks: l.435 test (reads period-tabs.tsx) → assert FleetDashboardPage mounts no `PeriodTab` and
  `components/fleet-dashboard` has no `period-tabs.tsx` import anywhere in web src.
- refresh: l.273-277 → the mixed panels' `refreshing: periodQ.isFetching,` and their RefreshTools
  `refreshing` (no read of period-tabs.tsx).
- overview: l.726-729 (`visits: null`) dropped; K6 l.418 renamed «إجمالي العهدة» and asserts
  `text(body)` contains «إجمالي العهدة» and not «رصيد العهدة النقدية» (RED until HUB merge).
- accidents: l.676 title without «أرقام الفترة» (expectations unchanged).
- remembered-filters-coverage l.596: description without «أرقام الفترة» (the seven mixed panels).
- Delete fleet-dashboard-period-tabs.spec.tsx (its subject is gone).
- Run (lock, one at a time, after `dash-api`'s "contracts built"): shell, census, links, gates,
  blocks, refresh, overview, accidents, km, distribution, fuel, custody, maintenance, now-tabs,
  remembered-filters-coverage, lib/fleet-dashboard-km-chart. tsc: errors allowed ONLY in
  tab-period.tsx, period-tabs.tsx, fleet-dashboard-fixtures.ts, fleet-dashboard-period-fixtures.ts
  (list them in the hand-off).
- Dark screenshots for the HUB: the bar at 1920 and 1366, the overview KPI row (custody card).
Hand-offs: dash-web.json; to HUB: delete tab-period.tsx + period-tabs.tsx; fixtures: drop
`renderPeriodTab`, the `PeriodTab` import, `visits`, `openRemaining`, the «أرقام الفترة» comments.

### P3 `fixes-web` (web) — answer 4 and small fixes a, b, c
Files:
- apps/web/src/shared/ui/states/ErrorState.tsx
- apps/web/src/shared/ui/states/error-state.spec.tsx (NEW)
- apps/web/src/modules/fleet/lib/licence-months.ts
- apps/web/src/modules/fleet/lib/month-window.spec.ts
- apps/web/src/modules/fleet/pages/VehicleDetailPage.tsx
- apps/web/src/modules/fleet/fleet-vehicle-profile-alarm.spec.tsx
- apps/web/src/modules/fleet/fleet-vehicle-history-links.spec.tsx
Tasks:
1. ErrorState (§4): no `diagnostic.code` anywhere; with `requestId`:
   `<p class="text-xs text-slate-400 dark:text-slate-500">{t('common.error.reference')}: <bdi dir="ltr" class="font-mono">{requestId}</bdi></p>`;
   keep `hasError(error)` gating. i18n `fixes-web.json`: set `common.error.reference` = { ar
   «الرقم المرجعي», en "Reference" }.
2. a: `ar-EG-u-nu-latn` for the month name and the count.
3. b: page-local Latin helpers (numbers `en-US`-grouped; dates `ar-EG-u-nu-latn` / `en-GB`, same
   `dateStyle`/`timeStyle` as `formatDate`/`formatDateTime`, `—` for null) for every figure and date
   of the page body (l.174, 176, 205, 210, 249, 255, 285, 603, 606, 619, 624, 649); the print rows
   (l.444, 448) keep `formatDate`.
4. c: accidents count by `vehicleCodes` (§6c); update the `useHistoryCounts` doc comment.
Specs:
- error-state.spec.tsx (new, renderToStaticMarkup + store): `ApiError('INTERNAL','server english',500,undefined,'req_abc')`
  in ar → no `INTERNAL`, no `server english`; contains «الرقم المرجعي» and `req_abc` inside
  `dir="ltr"` with `font-mono`; en → "Reference", no `INTERNAL`; no requestId → neither line nor code;
  `TypeError('Failed to fetch')` → no reference line; for each code the errors table knows
  (`INTERNAL`, `UNKNOWN`, `CONFLICT`, `BUSINESS_RULE`, `VALIDATION_ERROR`, …) the ar AND en markup
  does not contain that code. (RED for the label until HUB merge.)
- month-window.spec: ar `licenceMonthOptions` → exactly «نوفمبر 2026 (1)»; `monthCountOptions(
  [{month:'2026-10',count:12}],'ar')` → «أكتوبر 2026 (12)»; no `[٠-٩]` in any ar label;
  en unchanged.
- profile-alarm spec: re-point l.210-218, 242 to Latin («50,000», the date «10…»), each with
  `not.toContain` of the Arabic-Indic form; new case: `Indicators` with a reading and a higher
  highest → «آخر قراءة عداد» Latin and «أعلى قراءة 120,500 كم»; the markup has no `[٠-٩]`;
  source: VehicleDetailPage calls no `formatNumber(` and `formatDate(` only inside `printReport`.
- history-links spec: «الحوادث» counts by code — seed `listKey('fleet','accidents',{vehicleCodes:['194'],page:1,pageSize:1})`
  = 3 and by id = 2 → «3 حادث», not «2 حادث»; by code 1 / by id 0 → «1 حادث», not «سجل نظيف»; the
  link's `vehicleCodes` = the count's.
- Also run: errors.spec.ts, fleet-figures-font.spec.ts, vehicles-licence-state.spec.tsx,
  fleet-vehicle-card-census.spec.tsx, fleet-alarm-permission.spec.tsx (unchanged, must stay green).
- Dark screenshots for the HUB: an error state (ar, with a reference), the car page (1920, reading
  tile with «أعلى قراءة»), the «شهر انتهاء الترخيص» options open on «السيارات».
Hand-offs: fixes-web.json.

### P4 `roster-web` (web) — small fixes d, e, f
Files:
- apps/web/src/modules/fleet/components/EmployeeName.tsx
- apps/web/src/modules/fleet/components/RosterAssignDialog.tsx
- apps/web/src/modules/fleet/components/CatalogSelect.tsx
- apps/web/src/modules/fleet/components/roster/roster-parts.tsx
- apps/web/src/modules/fleet/components/roster/RosterTouchBoard.tsx
- apps/web/src/modules/fleet/components/roster/RosterDeskBoard.tsx
- apps/web/src/modules/fleet/components/roster/FixedDeskBoard.tsx
- apps/web/src/modules/fleet/components/roster/FixedCrewDialog.tsx (comment l.26-28 only)
- apps/web/src/modules/fleet/fleet-daily-roster.spec.tsx
- apps/web/src/modules/fleet/fleet-roster-touch.spec.tsx
- apps/web/src/modules/fleet/fleet-fixed-roster.spec.tsx
- apps/web/src/modules/fleet/fleet-driver-card.spec.tsx
Tasks: §6d (shared EmployeeName markup), §6e (`ROSTER_NOTE_MAX` in roster-parts, both daily inputs),
§6f (`[&_select]:!truncate` appended to MISSION_BOX — keep its pinned prefix
`"mx-auto w-[9.5rem] max-[1535px]:w-36 "`; `CatalogSelect` optional `title`, default `ariaLabel`;
both desk boards pass `m.missionName(id)` when a mission is set). No i18n expected (write `{}` if
none).
Specs:
- driver-card: `EmployeeName` (ar and en) → the code inside `<bdi dir="ltr">` wrapped by an `ms-2`
  element that carries NO `dir`; `card={false}` unchanged; `DriverName` the same.
- fixed-roster l.990-992: re-point the "unchanged EmployeeName" pin to the new shared markup (keep
  "FixedCrewDialog draws its own face" and its `gap-x-2`); the fixed mission select's `title` = the
  mission's name; MISSION_BOX still in the fixed cell.
- daily-roster: render `RosterAssignDialog` with a picked driver → the gap markup and
  `maxlength="500"`; `ROSTER_NOTE_MAX === 500` and `PlanFleetRosterRowSchema` accepts a 500-letter
  note and refuses 501; MISSION_BOX contains `[&_select]:!truncate` and keeps both widths (l.1834,
  1883 pins stay green); the daily mission select's `title` = the mission's name, the empty one keeps
  the aria label.
- roster-touch: the daily `<NotesSheet` passes `maxLength={ROSTER_NOTE_MAX}`; a rendered daily notes
  sheet has `maxlength="500"`. (`roster-optional-props.spec.tsx` "uncapped by default" stays green.)
- Also run: fleet-fixed-roster-touch.spec, roster-optional-props.spec, fleet-catalogs-vehicles.spec,
  fleet-drivers.spec (unchanged, green).
- Visual (dark, both desk boards, a mission named «نقل أموال (يومي) بين الفروع والبنوك»): at 1280,
  1366 and 1920 the table's `scrollWidth − clientWidth` equals the value before the change (record
  both), the select shows «…» and its title the whole name; the daily dialog's name and code with a
  gap; the notes field refusing letter 501. Screenshots for the HUB.
Hand-offs: roster-web.json (likely `{}`).

### HUB (runs last, alone)
Files:
- apps/web/src/platform/localization/i18n.ts
- CHANGELOG.md
- apps/web/src/modules/fleet/fleet-dashboard-fixtures.ts
- apps/web/src/modules/fleet/fleet-dashboard-period-fixtures.ts
- apps/web/src/modules/fleet/components/fleet-dashboard/tab-period.tsx (DELETE)
- apps/web/src/modules/fleet/components/fleet-dashboard/period-tabs.tsx (DELETE)
Tasks:
1. Read every hand-off. Merge `i18n/*.json` into `i18n.ts` (ar and en blocks): removals, the custody
   title value, `common.error.reference`. Grep each removed key: zero readers in `apps/web/src`.
2. Delete tab-period.tsx and period-tabs.tsx; fixtures: drop the `PeriodTab` import and
   `renderPeriodTab`, `visits` (fleet-dashboard-fixtures l.681-682, period-fixtures l.277-278 and the
   header line 10), `openRemaining` (l.718 / l.335), the «أرقام الفترة» comments.
3. Census greps (code, not CHANGELOG/.wip-notes): no `'period'` tab, `tab=period`, `PeriodTab`,
   `FLEET_DASHBOARD_PERIOD_TABS`, `visitStates`, `stateCounts`, `openRemaining`, `opexCustody`,
   `.visits` of R2, `fleet.dash.period.` other than `dataFrom`/`notSummed`; «أرقام الفترة» nowhere
   in apps/ or packages/. `git diff 53594fd2 -- apps/web/src/modules/fleet/components/fleet-dashboard/tab-summaries.tsx`
   is EMPTY. No `zz-*` under apps/ (`git ls-files --others --ignored --exclude-standard -- apps | grep /zz-`).
4. tsc web + api + contracts clean; eslint apps/web and apps/api; `node scripts/check-formal-arabic.mjs`.
5. Re-run every spec a package reported RED-until-merge, then the dashboard specs that import the
   fixtures (one at a time, lock).
6. CHANGELOG `## [Unreleased]`: one "Fleet: the owner's follow-ups of 22 November" entry — the six
   answers as built (period tab removed and where its figures live / what was dropped; «إجمالي
   العهدة»; «2 سيارات» kept; no error code on screen, the reference stays; a–f), and the server read
   lost `visits` and `accidents.openRemaining`.
7. THE GATE (§8), alone.
8. Owner pictures, DARK only, in
   `/tmp/claude-0/-home-user/85f289ec-521b-5944-9b89-a0120b22d71a/scratchpad/followups/owner/`: the
   bar without «أرقام الفترة», the overview custody card, an error state, the licence-month options,
   the car page, the daily dialog gap, the notes cap, the mission name (ellipsis + hover). Use the
   packages' shots where they already are final.

## 8. The gate

`bash /home/user/egycash/.wip-notes/followups/gate.sh` — ALONE (no other vitest/tsc/build running),
logs and `summary.txt` in
`/tmp/claude-0/-home-user/85f289ec-521b-5944-9b89-a0120b22d71a/scratchpad/followups/gate-out/`.
Green = `00-cleanroom lines=0`, every step `rc=0` (01 secrets, 03 contracts build, 04 lint, 05
typecheck, 06 permission matrix, 07 flags, 08 pages, 09 automation templates, 10 formal Arabic, 11
contracts tests, 12 api tests, 13 web tests, 14 build, 15 dependency audit), `99-git-status` lists
only the files of §7. A red step: read its log, fix in the owning file, re-run the gate whole.

## 9. Told list (owner, Egyptian Arabic, Arabic script only)

1. «أرقام الفترة»: شلنا التبويب من شريط «لوحة تحكم الحركة»، و«ملخصات» زي ما هي بالظبط. لو حد فتح رابط قديم للتبويب ده هيفتح على «نظرة عامة».
2. «الكيلومترات المقطوعة» موجودة في «العدادات والكيلومترات» باسم «إجمالي الكيلومترات» (ومعاها «مؤكدة حتى» و«لم تُغلق القراءة بعد»)، وبتاعة الشهر في «نظرة عامة».
3. «متوسط الكيلومترات للسيارة» موجود في «العدادات والكيلومترات» باسم «متوسط لكل سيارة».
4. «قراءات تحتاج مراجعة» موجودة في «العدادات والكيلومترات» بنفس الاسم.
5. «قراءات لكام سيارة من كام» موجودة تحت «متوسط لكل سيارة»، بس النسبة المئوية اللي كانت جنبها اتشالت.
6. «زيارات الصيانة» بتاريخ دخول الورشة (العدد واللي خرجت واللي لسه في الورشة ونسبتها) اتشالت خالص، مفيش تبويب تاني بيعدّ بتاريخ الدخول. الأقرب ليها «خرجت من الورشة» في «الصيانة والورش» (بتاريخ الخروج) و«في الورشة الآن».
7. «الحوادث»: العدد والمفتوحة منها والحوادث اللي من غير تاريخ موجودين في «الحوادث ومطالبات التأمين» («حوادث الفترة»).
8. «المتبقي» بتاع الحوادث المفتوحة لوحدها اتشال؛ في «الحوادث ومطالبات التأمين» فيه «إجمالي المتبقي» لكل حوادث الفترة المفتوحة والمقفولة («مبالغ ملفات حوادث الفترة»). ونسبة «المفتوحة منها» اتشالت.
9. «مصروف التشغيل» موجود في «الوقود والمصروفات» بنفس الاسم، وبتاع الشهر في «نظرة عامة».
10. «إيصالات الكارت» موجودة في «مصروف التشغيل حسب النوع» في «الوقود والمصروفات»، و«إيصالات العهدة» موجودة في تبويب «العهدة» باسم «مصروفات العهدة» (ومتقسمة حسب النوع في «الوقود والمصروفات»). شريط «كارت ثم عهدة» اتشال، والنسبة بقت لكل نوع في «مصروف التشغيل حسب النوع».
11. «فواتير التوكيل» (المبلغ وعدد الصفوف و«بانتظار الفاتورة») موجودة في «الوقود والمصروفات» بنفس الاسم؛ نسبة «الصفوف المسجّلة قيمتها» اتشالت.
12. «البيانات متاحة من …» بتفضل تظهر في «الوقود والمصروفات» و«العهدة»، والجملة اللي بتقول إن مصروف التشغيل وفواتير التوكيل ما بيتجمعوش موجودة في «الوقود والمصروفات».
13. كارت «رصيد العهدة النقدية» في «نظرة عامة» بقى اسمه «إجمالي العهدة»، نفس الرقم ونفس الرابط.
14. «سجل العهدة»: سيبنا «2 سيارات» زي ما هي، ما اتغيرش حاجة.
15. رسالة الغلط: الكلمة الإنجليزي (كود الغلط) مش هتظهر لحد تاني. اللي بيفضل تحت الرسالة سطر صغير «الرقم المرجعي» عشان الدعم الفني يلاقي الطلب، والرقم ده نفسه حروف وأرقام بالإنجليزي لأنه رقم الطلب عندهم.
16. الصفحة اللي اتعملت بالغلط اتمسحت.
17. «شهر انتهاء الترخيص» في «السيارات» و«التراخيص»، وشهور «حسب الشهر» في «الإخطارات»: الأرقام بقت إنجليزي زي باقي السيستم.
18. صفحة السيارة: كل الأرقام والتواريخ بقت أرقام إنجليزي، ومنها «آخر قراءة عداد» وسطر «أعلى قراءة». ورقة الطباعة زي ما هي.
19. «الحوادث» في سجل السيارة بقت بتتعد بكود السيارة زي الرابط بالظبط، فالرقم بقى نفس عدد اللي بيفتح (ومعاه حوادث الدفتر القديم اللي على نفس الكود).
20. «تعديل» في «تعيين السيارات»: بقى فيه مسافة بين اسم السواق وكوده. اتصلحت في المكان المشترك، فالمسافة اتظبطت كمان في «مخالفات السيارات» و«السائقون».
21. ملاحظات «تعيين السيارات» على الكمبيوتر والموبايل: بقى ليها حد أقصى 500 حرف زي «الطقم الثابت».
22. «نوع المهمة» على الكمبيوتر في «تعيين السيارات» و«الطقم الثابت»: الاسم الطويل بيتقفل بثلاث نقط، ولما تقف عليه بالماوس يظهر الاسم كله، وعرض الجدول زي ما هو على اللابتوب والشاشة الكبيرة.
