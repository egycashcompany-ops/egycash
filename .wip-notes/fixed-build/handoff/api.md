# Hand-off — package `api` (the fixed save's refusal carries what the screen needs)

TEMPORARY (inside `.wip-notes/`). Written 2026-11-18. Status: DONE, nothing committed.

## Files changed (package work = `git diff 2b9467a3 -- <these>`)
- `apps/api/src/modules/fleet/fixed-roster/fixed-roster.service.ts` — details added to the five
  refusals; new exported const `FIXED_CREW_REFUSAL` (the six literals). `ConflictError` import
  replaced by `AppError` + `ErrorCodes` (from `@ecms/contracts`). No rule, status, error code or
  English message changed. Prettier also re-flowed `switchedOffProfiles` onto one line and dropped
  a stray blank line before the class's closing brace (format only).
- `apps/api/tests/integration/fleet.spec.ts` — 10 new specs at the END of
  `describe('fixed crew (الطقم الثابت) …')` (section «the refusal says WHICH driver and WHICH car»),
  plus imports `FIXED_CREW_REFUSAL`, `fleetFixedRosterService`, `AppError`.
- `packages/contracts/src/modules/fleet.ts` — COMMENT ONLY (optional task, done): the fixed-crew
  header no longer says «no mission, no notes» (the row has carried both since 1.22); the pool's
  doc no longer says «every ACTIVE driver profile» (it is the driving-seat registry less a
  switched-off profile, as the service does). No type, schema or value changed; no rebuild needed.

## To core — the literals, exactly (pin the same in `lib/fixed-save-refusal.ts` + its spec)
Every detail is `{ field, code, message }` (`ApiErrorDetail`). Ids are canonical lowercase hex —
the same spelling as the board DTO's ids.

| Refusal | HTTP | `error.code` | `details` (in this order) |
|---|---|---|---|
| a payload driver another, UNSENT row still holds | 409 | `DUPLICATE` | `{ field: 'driverEmployeeId', code: 'FIXED_CREW_DRIVER_HELD', message: <employeeId> }`, then ONLY if the holding car reads in the caller's scope: `{ field: 'vehicleCode', code: 'FIXED_CREW_HOLDER', message: <holder's code> }` |
| a crewed (assigning) payload car that is not `active` | 409 | `DUPLICATE` | `{ field: 'vehicleCode', code: 'FIXED_CREW_VEHICLE_NOT_ACTIVE', message: <car's code> }` |
| the driver's fleet profile exists and is switched off | 400 | `VALIDATION_FAILED` | `{ field: 'body.rows.driverEmployeeId', code: 'UNKNOWN', message: 'this driver’s fleet profile is inactive' }` (old, still FIRST), `{ field: 'driverEmployeeId', code: 'FIXED_CREW_PROFILE_INACTIVE', message: <employeeId> }` |
| the employee holds no driving seat | 400 | `VALIDATION_FAILED` | `{ field: 'body.rows.driverEmployeeId', code: 'UNKNOWN', message: 'this employee does not hold a driving seat' }` (old, FIRST), `{ field: 'driverEmployeeId', code: 'FIXED_CREW_NOT_A_DRIVER', message: <employeeId> }` |
| mission type not live / not a `missionType` (archived, `workType`, `workshop`, dangling) | 400 | `VALIDATION_FAILED` | `{ field: 'body.rows.missionTypeId', code: 'UNKNOWN', message: 'mission type not found or inactive' }` (old, FIRST), `{ field: 'missionTypeId', code: 'FIXED_CREW_MISSION_INACTIVE', message: <missionTypeId> }` |
| seat 2 without seat 1 (service-level) | 400 | `VALIDATION_FAILED` | unchanged, ONE detail: `{ field: 'body.rows.driver2EmployeeId', code: 'DRIVER2_WITHOUT_DRIVER1', message: 'a second driver needs a first — assign driver 1 before driver 2' }` |

The six codes: `FIXED_CREW_DRIVER_HELD`, `FIXED_CREW_HOLDER`, `FIXED_CREW_VEHICLE_NOT_ACTIVE`,
`FIXED_CREW_PROFILE_INACTIVE`, `FIXED_CREW_NOT_A_DRIVER`, `FIXED_CREW_MISSION_INACTIVE`
(server const: `FIXED_CREW_REFUSAL = { held, holder, vehicleNotActive, profileInactive, notADriver,
missionInactive }` — same keys as plan §4.4's web `FIXED_REFUSAL` minus `needsFirst`).

Facts core should know:
- NO names in any body (D11): the web names the driver from its own people map; no name in reach →
  the unnamed sentence. The holder's car is named by CODE only, never its id.
- ONE refusal per response — the first that fails, in this order: (1) a payload car not active
  (409); (2) seat 2 without seat 1 (400); (3) per driver, not-a-driver then profile-off (400);
  (4) mission type (400); (5) held elsewhere (409, checked last, inside the transaction).
- OVER HTTP `DRIVER2_WITHOUT_DRIVER1` is never seen: the contract schema refuses that payload first,
  as `{ field: 'body.rows.<i>.driver2EmployeeId', code: 'CUSTOM', message: 'a second driver needs
  a first — assign driver 1 before driver 2' }`. The same holds for the contract's other two rules
  (same person in both seats → `CUSTOM` on `body.rows.<i>.driver2EmployeeId`; one driver in two rows
  → `CUSTOM` on `body.rows.<i>`). None carries a `FIXED_CREW_*` code (pinned by a spec). The board
  never sends those payloads (the model promotes / refuses first), so → `refusal.generic` is right.
- A stale write is still `409 STALE_DOCUMENT` with no details (unchanged; `errorMessage` path).
- `FIXED_CREW_HOLDER` missing beside `FIXED_CREW_DRIVER_HELD` = the holding car is in another
  branch for this caller (or soft-deleted) → «سيارة أخرى ليست في هذه الشاشة». A holder that is
  merely OUT OF SERVICE (so not on the board) but in scope DOES carry its code (spec'd).

## Specs (all in tests/integration/fleet.spec.ts, end of the fixed-crew describe)
1. the six literals == `FIXED_CREW_REFUSAL`
2. (a) held → 409 DUPLICATE, same English message, details = [HELD id, HOLDER code], no vehicle id,
   no name in the body; holding row untouched, receiving row empty
3. held in SEAT TWO → same two details
4. held by a car since put OUT OF SERVICE (off the board, in scope) → HOLDER carries its code
5. (b) holder in ANOTHER BRANCH — `fleetFixedRosterService.save(input, by, branchScope(A))` →
   409, details = [HELD id] only, neither the car's id nor its code anywhere in details; control
   call with the organization selector → [HELD, HOLDER code]; nothing moved
6. (e) crewed car out of service → 409 DUPLICATE, same message, [VEHICLE_NOT_ACTIVE code], no id
7. (c) switched-off profile (the told-16 case: editing the car whose crew holds him) → 400, old
   detail first + PROFILE_INACTIVE id, no name, nothing written
8. (d) office employee (no driving seat) → 400, old detail first + NOT_A_DRIVER id, no name
9. (f) archived missionType AND a workType id → 400, old detail first + MISSION_INACTIVE id
10. seat 2 without seat 1 straight at the service → the one unchanged detail; over HTTP the
    contract's refusals carry no `FIXED_CREW_*` code

## Runs (each alone, under the flock lock, `--maxWorkers=1`)
- `tests/integration/fleet.spec.ts` FULL FILE: 408/408 passed (rc 0).
- `tests/integration/fleet.spec.ts -t "fixed crew"`: 66 passed (the 10 new among them), 1 failed:
  «MIGRATION never touches a maintenance document» — a FILTER ARTEFACT, not a regression: its
  precondition (`the fixture has maintenance visits to protect`) is built by the workshop describes
  that `-t` skips. It passes in the full-file run above. The gate runs the full suite.
- `src/modules/fleet/fixed-roster/fixed-crew-write-surface.spec.ts` 12/12 (incl. the 200-char
  `findActiveOfKind(` → `ValidationError` pin); `legacy-crew-row.spec.ts` 7/7;
  `driver-profiles/drivers-are-derived.spec.ts` 7/7; `catalogs/catalog-read-permission.spec.ts` 8/8.
- `npm run typecheck -w apps/api` rc 0 (covers tests/). eslint on the service, the spec and the
  contracts file: clean. prettier --check: clean on all three.

## To the HUB
- Cases that could NOT be tested: none — all of (a)–(f) are covered. The out-of-scope holder is
  proven through the service with a branch `ScopeSelector` (the file has no branch-scoped ROSTER
  token: `branchAToken` lacks `fleetRoster.*` and gets 403, which an existing spec pins).
- PLACEMENT / FRAGILITY: the new block sits LAST in the fixed-crew describe on purpose. The two
  existing «AUDIT — …» tests read `/fleet/drivers?pageSize=100` as ONE page to compare the driver
  population; with the new block placed before them the registry passed 100 rows and both went red.
  Anyone adding driver-making tests ABOVE those AUDIT tests will hit the same thing.
- Observation, NOT changed (rule: same English message): when the holder is out of the caller's
  scope, the 409's English `message` still ends with the holder's VEHICLE ID (`… of vehicle
  <id>; …`), as it always did. The web never shows the message; details carry no id. A later PR
  could drop the id from the message.
- Contracts comment fix done (see above). The docs' §4.5b also still says «No date, no mission, no
  notes» (docs/12-planning/fleet-module-design.md:400 — HUB's file).
- Docs/CHANGELOG material: «the fixed save's refusals now carry details — the driver's employee
  id and, when the holding car is in the caller's scope, its code; the inactive car's code; the
  profile-off / not-a-driver driver id; the mission type id. Same status, same error code, same
  message; no rule, field, migration or permission change; no names in the body.»

## i18n
None — the server's English is never shown. `i18n/api.json` is `{}`.
