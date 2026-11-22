# Hand-off — package `dash-api` (contracts + server side of answer 1)

TEMPORARY NOTES (inside `.wip-notes/`, removed before the PR).

## Status

- contracts built 2026-11-22T08:54:50Z (`packages/contracts/dist` holds the eleven tabs, no `period` tab, no
  `FLEET_DASHBOARD_PERIOD_TABS`, no R2 `visits`, no `accidents.openRemaining`). dash-web may run its specs.
- `node scripts/gen-permission-matrix.mjs --check` → "permission matrix is up to date" (rc 0).

## 1. Key arrays recorded BEFORE any edit (node over `packages/contracts/dist`, base 53594fd2)

- `FLEET_DASHBOARD_NOW_KEYS` = `["fleetVehicle.view","fleetRoster.view","fleetMaintenance.view","fleetOdometer.view","fleetDriver.view","fleetLicensing.view","fleetFuelCard.view","fleetFuelCharge.view","fleetNotice.view","fleetDealership.view","fleetAccident.view","fleetViolation.view"]`
- `FLEET_DASHBOARD_PERIOD_KEYS` = `["fleetOdometer.view","fleetMaintenance.view","fleetAccident.view","fleetViolation.view","fleetReceipt.view","fleetCustody.view","fleetDealership.view","fleetLicenseExpense.view"]`
- `FLEET_DASHBOARD_PAGE_KEYS` = `["fleetVehicle.view","fleetRoster.view","fleetMaintenance.view","fleetOdometer.view","fleetDriver.view","fleetLicensing.view","fleetFuelCard.view","fleetFuelCharge.view","fleetNotice.view","fleetDealership.view","fleetAccident.view","fleetViolation.view","fleetReceipt.view","fleetCustody.view"]`
- `FLEET_DASHBOARD_SCOPE_KEYS` = `["fleetVehicle.view","fleetRoster.view","fleetMaintenance.view","fleetOdometer.view","fleetDriver.view","fleetLicensing.view","fleetFuelCard.view","fleetFuelCharge.view","fleetNotice.view","fleetDealership.view","fleetAccident.view","fleetViolation.view","fleetReceipt.view"]`
- `FLEET_DASHBOARD_UNSCOPED_KEYS` = `["fleetCustody.view","fleetLicenseExpense.view"]`

## 2. Key arrays AFTER the change (dist rebuilt) — IDENTICAL to §1, set and order

Checked with node over the rebuilt dist (a `diff` of the two dumps is empty). `FLEET_DASHBOARD_TABS`
is now the eleven `overview, today, distribution, maintenance, km, accidents, violations, fuel,
custody, licences, summaries`; `FLEET_DASHBOARD_PERIOD_SECTIONS` is the twelve
`km, exits, accidents, accidentList, violations, violationList, opex, opexSeries, custodyStates,
dealership, dealershipList, licenceSpend`; `'FLEET_DASHBOARD_PERIOD_TABS' in contracts === false`;
no `visits` gate; no `period` key in `TAB_READS` / `TAB_SECTIONS` / `TAB_PARTS`. The contracts spec
pins the four unions against the recorded arrays (`KEYS_BEFORE_PERIOD_TAB_RETIRED`).

## 3. What changed (dash-api files only)

- `packages/contracts/src/modules/fleet-dashboard.ts`: `period` out of `FLEET_DASHBOARD_TABS`,
  `FLEET_DASHBOARD_TAB_READS`, `FLEET_DASHBOARD_TAB_SECTIONS`; `FLEET_DASHBOARD_PERIOD_TABS` deleted
  (its doc folded into the `TAB_READS` doc: every 'period' reader is a mixed tab); `visits` out of
  `FLEET_DASHBOARD_PERIOD_SECTIONS` and `FLEET_DASHBOARD_GATES`; `FleetDashboardPeriodDto.visits` and
  `FleetDashboardPeriodVisitsDto` deleted; `accidents.openRemaining` deleted; every comment naming the
  old tab / "twelve tabs" / "the two old tabs" rewritten (eleven tabs, «ملخصات» the one old tab kept;
  the source no longer names the old tab in Arabic). `summaries` untouched.
- `apps/api/src/modules/fleet/dashboard/period.service.ts`: the `visits` section and its comments
  gone; `accidents` returns `{ count, open, undated, totals }` (the open query stays — `open.count`).
- `apps/api/src/modules/fleet/maintenance/maintenance.service.ts`: `visitStates` and its
  `FleetDashboardPeriodVisitsDto` import deleted (no other caller; `scopedFilter` still serves
  `exitBreakdown` and the list).
- `apps/api/src/modules/fleet/maintenance/maintenance.repository.ts`: `stateCounts` deleted (no
  other caller).
- Specs: see §5.

## 4. Measured performance ceilings (`fleet-dashboard-performance.spec.ts`, run twice, stable)

| read | before (the file's recorded measurement / ceiling) | measured now | new ceiling |
|---|---|---|---|
| R1 | 74 / 75 | 74 | 75 (unchanged — R1 untouched) |
| R2 October | 37 / 38 | 36 | `CEILING.r2 = 36` |
| R2 this year | ≤ 38 | 36 | (shares `CEILING.r2`) |
| R2 type + codes | 41 / 42 | 39 | `CEILING_FILTERED_R2 = 39` |

R2 −1: the `visits` `$group`. Filtered R2 −2: that `$group` and the maintenance list's own code
resolution for it (`liveIdsByCodes`, not memoised; `exits` keeps its own). The ceilings are the
measurements themselves (lower only, never raise); the comment says the conditional
`latestChainDates` is never asked on this fixture. Logs:
`/tmp/claude-0/-home-user/85f289ec-521b-5944-9b89-a0120b22d71a/scratchpad/followups/dash-api/int-perf-1.log`
(measure) and `int-perf-2.log` (green with the new ceilings).

## 5. Specs and results (each run alone, under the lock; API with `--maxWorkers=1`)

- `packages/contracts/src/modules/fleet-dashboard.spec.ts` — 89 passed. Eleven tabs ending
  `licences, summaries`; no `period` in tabs / reads / sections / parts; no tab reads `['period']`
  alone; `'FLEET_DASHBOARD_PERIOD_TABS' in` the module AND the index is false; no `visits` section or
  gate; `exits` = the workshop's gate on R2 (`fleetMaintenance.view`); the four unions = §1 exactly;
  `opex` drawn by `overview, fuel`, `dealership` by `fuel`; the DTO samples carry no `visits` / no
  `openRemaining` (each also a `@ts-expect-error` excess-property check, so tsc fails if either
  field comes back).
- `apps/api/src/modules/fleet/dashboard/period.service.spec.ts` — 35 passed. No `visits` stub (the
  maintenance stub is `{ exitBreakdown }` only, asked once, never with `from`/`to`); new case: the
  twelve sections run, the DTO keys are exactly `today, asOf, range, vehicleScope, …12 sections,
  unavailable`, no `visits`; accidents `toEqual({ count, open: 1, undated: 25, totals })`.
- `apps/api/src/modules/fleet/maintenance/maintenance-breakdown.spec.ts` — 43 passed. Only the
  `visitStates` cases dropped; the `exitBreakdown` loop over `QUERIES + EXIT_QUERIES` kept; new case:
  `'visitStates' in fleetMaintenanceService` and `'stateCounts' in fleetMaintenanceRepository` false.
- `apps/api/src/modules/fleet/dashboard/dashboard-hygiene.spec.ts` — 4 passed (unchanged).
- `apps/api/tests/integration/fleet-dashboard.spec.ts` — 44 passed. A maintenance clerk's R2 is
  `['exits']` and has no `visits` key; the branch / old-book / set cases assert `visits` absent.
- `apps/api/tests/integration/fleet-dashboard-parity.spec.ts` — 52 passed. Visits parity and
  `openRemaining` dropped (absence asserted); every other parity kept.
- `apps/api/tests/integration/fleet-dashboard-performance.spec.ts` — 13 passed (twice). The
  `typeIds` case now checks `exits` against the list over the exit day (and BIG + SMALL = company)
  instead of `visits`.
- `apps/api/tests/integration/fleet-maintenance-breakdown.spec.ts` — 28 passed. The `visitStates`
  describe, its explain case and header item 1 dropped; its "the dashboard's set (vehicleSet) gives
  the same count as the screen's filter" check is KEPT on `exitBreakdown`, and the type cases it
  covered (type T1 with the deleted car; type T2 ∩ branch B2) were added to the exit-day cases.
- Extra (unchanged file, maintenance service touched): `tests/integration/fleet-dashboard-workshop-parity.spec.ts` — 14 passed.
- `npx tsc --noEmit -p apps/api` rc 0; `-p packages/contracts` rc 0; eslint on every file above rc 0;
  prettier --check clean.

## 6. To HUB

- Fixtures (HUB files): drop `visits` (`fleet-dashboard-fixtures.ts` l.682, `fleet-dashboard-period-
  fixtures.ts` l.278) and `accidents.openRemaining` (l.718 / l.335): they no longer type-check against
  `FleetDashboardPeriodDto`.
- `apps/web/src/modules/fleet/components/fleet-dashboard/dash-shell.tsx` l.91-93 (in NO package's
  list): the `PageRead` doc still says "The four old period tabs get the same read through
  `PeriodTab`". Your `PeriodTab` grep will hit it; suggested text: "R2 under the PAGE's filters (the
  period bar's one state, as the address bar holds it), handed to each mixed tab with its own face
  (the first: «الصيانة والورش»)."
- Your census greps WILL find these names in dash-api specs — they are absence guards, keep them:
  `packages/contracts/src/modules/fleet-dashboard.spec.ts` (`'FLEET_DASHBOARD_PERIOD_TABS' in …`,
  the `openRemaining` `@ts-expect-error` sample), `apps/api/src/modules/fleet/maintenance/maintenance-breakdown.spec.ts`
  (`'visitStates' in …`, `'stateCounts' in …`), `apps/api/src/modules/fleet/dashboard/period.service.spec.ts`
  and `apps/api/tests/integration/fleet-dashboard-parity.spec.ts` (`not.toHaveProperty('openRemaining')`).
  No dash-api file names «أرقام الفترة» in Arabic (the old tab is "the `period` tab" in comments).
- CHANGELOG facts: R2 (`GET /fleet/dashboard/period`) lost `visits` (check-in day count) and
  `accidents.openRemaining`; no permission key and no key-union order changed; R2 is one query
  cheaper (36), the filtered R2 two (39).

## 7. i18n

None: `/home/user/egycash/.wip-notes/followups/i18n/dash-api.json` is `{ "remove": [], "set": {} }` (no UI words).
