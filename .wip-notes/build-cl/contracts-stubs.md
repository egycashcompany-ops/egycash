# C0 stubs (build-cl) — every one is tagged `C0-STUB(<owner>)` in the tree

C0 changed the contracts (packages/contracts/src/modules/fleet-dashboard.ts + .spec.ts, fleet.ts). To keep
`tsc --noEmit` clean in apps/api and apps/web for Phase B, it left the neutral stubs below in files other packages
own. Each carries a `C0-STUB(<owner>)` comment. **The owner replaces the stub (or keeps the planned value) and deletes
the tag.** Before the commit, INT runs:

    grep -rn "C0-STUB\|UNBUILT_TABS\|RETIRED_RECENT" apps packages --include=*.ts --include=*.tsx   # must print nothing

Neutral means: `null` for a part no web code draws yet, an empty list / zeros for a figure not computed yet, or the value
the plan already fixes (marked "planned — keep it, drop the tag"). What a reader sees changes only where the CONTRACT
itself moved it (listed at the end): «العهدة» is kept out of the bar (FDP stub), no web file reads the new fields yet,
and the API fills the two new R2 sections with zeros (never `unavailable`, never an error).

Line numbers: tree 21995fd4f + C0, uncommitted, after `prettier --write` (2026-11-17).

## A1 (api)

| File:line | Stub | Replace with |
|---|---|---|
| apps/api/src/modules/fleet/custody/custody-fund.service.ts:300-301 (`summary`) | `held: { ...terms.held, letters: [] }` (does NOT tie to `held.count` until replaced) | plan §5.1.2–§5.1.3: COR `heldReplenishments()` + custody-memo.service `heldRows()`, grouped by replenishment, oldest letter first; pins in NEW custody-held-letters.spec.ts |
| apps/api/src/modules/fleet/receipts/receipt.repository.ts:186-189 (`totals`) | `custodyCount` = Σ `row.count` where `_id.source === 'custody'` from the same `$group` (**planned §5.2.1 — keep it, drop the tag**) | keep; add the spec case (receipt-summary-over.spec.ts) |
| apps/api/src/modules/fleet/dashboard/now.service.ts:779-782 (`licenceVehicles` rows) | `typeName: null, licenceClass: null, papers: null` | §5.4.1/§5.4.3/§5.4.5: VR `nearestLicences` typeId + licenseClassId → names; `papers` via `fleetLicensingService.paperStagesFor` only when `d.permits('papers')` |
| now.service.ts:792-793 (`licenceVehicles.months`) | `months: []` | §5.4.2: `VR.licenceMonthCounts(scope, today, today+11 months)`, 12 keys from this month, zeros kept |
| now.service.ts:800-801 (`licenceDrivers`) | `months: []`, `list: { rows: [], more: 0 }` (do NOT tie to the counts) | §5.4.4–§5.4.5: DPS `registryDigest` months + nearest; `days`, `licenceType` names |
| now.service.ts:890-891 | tag line where `recentWorkshop` / `recentAccidents` sections, `recentSince`, `FLEET_DASHBOARD_RECENT_DAYS/ROWS` imports were DELETED (**planned §5.4.6 — drop the line**) | nothing; `fleetMaintenanceService.recentWritten` / `fleetAccidentService.recentWritten` stay (unused; their DTO types stay in the contracts, see c0.md) |
| apps/api/src/modules/fleet/dashboard/period.service.ts:220-221 (`opex`) | `custodyCount: totals.custodyCount` (**planned §5.5.1 — keep it, drop the tag**) | keep |
| period.service.ts:231-235 (`custodyStates`) | `Promise.resolve({ replenished: 0, pending: 0, outside: 0 })` (zeros; do NOT sum to `opex.custody`) | §5.2.2–§5.2.3, §5.5.2: `fleetReceiptService.custodyStatesOver(dated(p))` |
| period.service.ts:254-266 (`licenceSpend`) | `Promise.resolve({ count: 0, cars: 0, visa: 0, cash: 0, renewal: 0, extension: 0, total: 0 })` | §5.3, §5.5.3: `fleetLicenseExpenseService.periodSpend({ from, to })` (range only) |
| apps/api/src/modules/fleet/dashboard/now-alerts.spec.ts:42-43, :52-54 | fixture `licenceVehicles.months: []`; `licenceDrivers.months: []`, `list: { rows: [], more: 0 }` | fixture values A1 wants (no alert line reads them) |
| apps/api/src/modules/fleet/dashboard/now.service.spec.ts:405 (`USES`) | tag where `recentWorkshop` / `recentAccidents` USES rows were deleted (**planned — drop the line**) | + the new calls of `licenceVehicles` / `licenceDrivers` (§5.4.7) |
| apps/api/src/modules/fleet/dashboard/period.service.spec.ts:266-271 (`USES`) | `custodyStates: []`, `licenceSpend: []` (the stubs call nothing) | the module calls (§5.5.4) |
| apps/api/tests/integration/fleet-dashboard.spec.ts:145 (`NOW_SECTIONS`) | tag where the two retired keys were deleted (**planned — drop the line**) | — |
| fleet-dashboard.spec.ts:162-166 (`PERIOD_SECTIONS`) | `custodyStates` (after `opexSeries`) and `licenceSpend` (last) added (**planned — drop the tag**) | keep |
| apps/api/tests/integration/fleet-dashboard-parity.spec.ts:1141-1142 | tag where the case «T4.8/T4.9: each recent row opens its own list» was deleted (its sections are retired) (**planned — drop the line**) | the new PAR ties (§5.6) |

No stub adds a `$`-key, a `date:`/`isDeleted:` key or an `.aggregate(` under dashboard/ (HY green). Section order = DTO order.

## HUB (web hub files and shared specs)

| File:line | Stub | Replace with |
|---|---|---|
| apps/web/src/modules/fleet/pages/FleetDashboardPage.tsx:120-123 (`dashboardReads.period`) | `FLEET_DASHBOARD_PERIOD_SECTIONS.some((section) => sectionPermitted(section, can))` (**planned D5 — keep it, drop the tag**; import `FLEET_DASHBOARD_PERIOD_KEYS` → `FLEET_DASHBOARD_PERIOD_SECTIONS`) | keep. Without it a custody-only reader sent R2 (fleetCustody.view is in the R2 union now) |
| FleetDashboardPage.tsx:157-162 | `UNBUILT_TABS = ['custody']`, `type UnbuiltTabKey`, `type NowTabKey = Exclude<FleetDashboardTab, PeriodTabKey \| MixedTabKey \| UnbuiltTabKey>` (NOW_PANELS keyed by it) | delete all three; `MIXED_PANELS += { custody: CustodyTab, licences: LicencesTab }`, `NOW_PANELS` −licences, `MIXED_PERIOD_SECTIONS += custody ['opex'], licences ['licenceSpend']`, mixed branch reads «الآن» per TAB_READS (plan D3, §8 FDP) |
| FleetDashboardPage.tsx:203-206 | `visibleTabs(answers).filter((tab) => !UNBUILT_TABS.includes(tab))` — «العهدة» never reaches the bar (`?tab=custody` opens the first visible tab) | `visibleTabs(answers)` |
| FleetDashboardPage.tsx:350-351 | `NOW_PANELS[active as NowTabKey]` | `NOW_PANELS[active]` |
| apps/web/src/modules/fleet/fleet-dashboard-fixtures.ts:341-353 (NOW_DTO `licenceVehicles`) | rows `.map(… typeName: null, licenceClass: null, papers: null)`, `months: []` | seed (§8 FX): makes, classes, papers on «ت» cars, 12 months |
| fleet-dashboard-fixtures.ts:361-363 (NOW_DTO `licenceDrivers`) | `months: []`, `list: { rows: [], more: 0 }` | seed (§8 FX): months, rows (one suspended), `more` tying to the counts |
| fleet-dashboard-fixtures.ts:467-468 (NOW_DTO) | tag where `recentWorkshop` / `recentAccidents` fixtures were deleted (**planned — drop the line**) | — |
| fleet-dashboard-fixtures.ts:640-645 (PERIOD_DTO) | `custodyStates: null`, `licenceSpend: null` | keep null in the month read or seed (§8 PFX) |
| fleet-dashboard-fixtures.ts:674-675 (CUSTODY_FUND) | `held: { …0…, letters: [] }` (consistent: none held) | seed a held letter with `seedCustody` (§8 FX) |
| apps/web/src/modules/fleet/fleet-dashboard-period-fixtures.ts:513-514 (PERIOD_FULL `opex`) | `custodyCount: 88` (of 210) | reseed with `custodyStates` (Σ = 47,850) and `licenceSpend` (§8 PFX) |
| fleet-dashboard-period-fixtures.ts:571-574 (PERIOD_FULL) | `custodyStates: null`, `licenceSpend: null` (PERIOD_YEAR inherits) | seed FULL / YEAR / narrowed (§8 PFX) |
| fleet-dashboard-period-fixtures.ts:597-598 (PERIOD_YEAR `opex`) | `custodyCount: 131` (of 314) | reseed |
| apps/web/src/modules/fleet/fleet-dashboard-period-tabs.spec.tsx:149-150 | the dataFrom-guard literal `opex` gains `custodyCount: 1` | keep (the guard reads `dataFrom`), drop the tag |
| apps/web/src/modules/fleet/fleet-dashboard-tab-fuel.spec.tsx:239-240 (`OPEX`) — file in no package's list | `custodyCount: 236` (of 574; the fuel tab reads none) | keep, drop the tag |
| apps/web/src/modules/fleet/fleet-dashboard-tab-overview.spec.tsx:109-110 (MONTH `opex`) | `custodyCount: 22` (of 40; the overview reads none) | keep, drop the tag |
| fleet-dashboard-tab-overview.spec.tsx:543-554 (licence row) | `typeName: null, licenceClass: null, papers: null` | keep, drop the tag |
| apps/web/src/modules/fleet/fleet-dashboard-link-census.spec.ts:848-849 | the case «says plainly that nothing was recorded lately…» renders `NOW_DTO` (the retired keys dropped); it FAILS at run time (the card is gone) | delete the case with the old body (§8 LC) |

## WC (web «العهدة» + custody/receipts spec fallout)

| File:line | Stub | Replace with |
|---|---|---|
| apps/web/src/modules/fleet/pages/custody-dashboard-fund.spec.tsx:107-108, :1213-1214 | `held: { …, letters: [] }` | **planned §6 — keep it, drop the tag** (or seed letters where a case reads them) |
| pages/custody-fund-dialogs.spec.tsx:227-228 | same | same |
| pages/custody-hold.spec.tsx:116-117 (`held.count` 1) | `letters: []` (does not tie to count 1; no case reads it) | same |
| pages/custody-ledger.spec.tsx:162-163 | same | same |
| pages/custody-memos.spec.tsx:142-143 | same | same |
| pages/custody-split.spec.tsx:135-136, :245-248 | same | same |
| pages/custody-tabs.spec.tsx:55-56 | same | same |
| apps/web/src/modules/fleet/fleet-row-actions-look.spec.tsx:143-144 | `custodyCount: 0` (custodyTotal 0) | **planned — keep it, drop the tag** |
| pages/receipts-memo-lock.spec.tsx:115-116 | `custodyCount: 3` (all 3 receipts custody, cardTotal 0) | same |
| pages/receipts-screen.spec.tsx:113-114 | `custodyCount: 4` (of 6; custody fuel/tyres/wash/maintenance) | same |

## WL (web «التراخيص والتجديدات»)

| File:line | Stub | Replace with |
|---|---|---|
| apps/web/src/modules/fleet/components/fleet-dashboard/tab-licences.tsx:847-856 (old body) | local `FLEET_DASHBOARD_RECENT_DAYS = 30` and `RETIRED_RECENT = { visits: null, accidents: null }`; `LICENCE_SECTIONS` without the two retired keys; the «آخر ما سُجّل» card is therefore NEVER drawn (`RETIRED_RECENT` at :888-894) | the whole file is rewritten (plan §7); every old helper goes |

## Runtime fallout after the stubs (typecheck is clean everywhere)

Measured 2026-11-17 (raw logs in build-cl/c0/):

- **contracts**: build green; `npm run test -w packages/contracts` 52 files / 1320 tests green (fleet-dashboard spec 87).
- **api unit** (`cd apps/api && npx vitest run src/modules/fleet`): 5 of 1754 fail — A1's re-pins:
  - now.service.spec.ts «R1 — data scope › «كل فروعي» … every company+set source narrows to BOTH» — expects `maintenance.recentWritten` (retired).
  - now.service.spec.ts «R1 — one clock › 2026-10-31T23:30Z is 2026-11-01 for every figure…» — expects `recentWritten` calls (retired).
  - now.service.spec.ts «R1 — one clock › counts the licence windows of R-10…» — exact `toEqual` on the old row shape.
  - period.service.spec.ts «R2 — the gating matrix › with only fleetCustody.view, exactly its sections answer» — `fleetCustody.view` is in
    PERIOD_KEYS now but alone covers no R2 section (custodyStates needs the receipts' key too): re-pin (a custody-only
    reader is admitted to /period and answered all-null; the web no longer sends it — FDP stub).
  - **now.service.spec.ts «R1 — data scope › the custody fund’s key (a browser read) never decides what the figures cover»
    — A REAL BEHAVIOUR CHANGE, NOT A RE-PIN: see c0.md «Open item 1». Needs A1's fix in dashboard-context.ts.**
- **api integration** (fleet-dashboard ×4, fleet-custody-fund/hold/memos/delete, fleet-license-expenses, fleet-licensing; in-memory
  Mongo): 1 of 270 fails — fleet-dashboard.spec.ts «the doors › a workshop clerk gets the workshop sections only» expects
  `['workshop','recentWorkshop']` (A1 re-pin). PERF green.
- **web** (`cd apps/web && npx vitest run src/modules/fleet src/shared/lib src/platform`): 12 of 5349 fail — HUB re-pins:
  - fleet-dashboard-gates.spec.ts ×3 («the home route …»): the union of the gates must leave PAGELESS (`licenceSpend`) out.
  - fleet-dashboard-link-census.spec.ts ×3: «all eleven tabs», «names every figure after a gated section» (L still has
    `recentWorkshop.*` / `recentAccidents.*` metrics), «nothing was recorded lately» (retired card).
  - fleet-dashboard-links.spec.ts ×1: same metric-name case (`visitDay`/`accidentsRecent`/`visitsRecent` builders).
  - fleet-dashboard-now-tabs.spec.tsx ×3 («tab 4 — licences and the latest records»): the retired card.
  - fleet-dashboard-shell.spec.tsx ×2: «all eleven tabs in the bar's order» (licences now stands before period/summaries),
    «a fuel-card-only reader … » (no «التراخيص» any more — planned, told).
- **Visible now through the contract alone** (before any Phase B work): the bar order is … fuel · licences · period ·
  summaries («العهدة» kept out by the FDP stub); «التراخيص» shows only for licenceVehicles / licenceDrivers / papers (a
  fuel-card-only reader loses it — planned); the old body draws no «آخر ما سُجّل» card; `/period` admits
  `fleetCustody.view` and `fleetLicenseExpense.view` readers (the latter gets `licenceSpend` zeros; neither opens the page
  through it); the dashboard's branch answer widens for an org-wide custody/licence-expense grant (Open item 1).
