# Fleet Module — Frozen Design

**Status:** **FROZEN v1.0** (2026-08-02) — the single reference for Fleet implementation. §13's
open questions refine *defaults and labels*; they do not reopen structure. Any structural change
requires a new revision in §15.
**Source of business logic:** legacy repo `egycashcompany-ops/fleet` @ `44654cd` — read in full
(routes `contad_app.js:2444–6144`, all 10 fleet models, and the client-side JS inside every fleet
EJS view). The legacy system is a *source of understanding*, *not* a target of re-implementation:
§10 lists every piece of logic found hiding in views/JS, §11 lists what was deliberately left
behind.
**Scope:** Fleet only. OPS (money-transport operations — `tashghela`, `mohsana`, ATM, vault) is a
separate future module; it appears here only at the §9.4 boundary.

---

## 0. Scope and non-goals

**In scope:** vehicle registry and lifecycle · driver profiles (fleet-owned extension of HR
employees) · driver availability (التمامات) · odometer log · maintenance visits + derived
maintenance alarms · daily duty roster (تعيين السيارات) · accidents · violations (vehicle + driver)
· fleet catalogs · module dashboards · the events that make all of it automatable.

**Non-goals (this module, this phase):** OPS work orders and trip execution (OPS module) · fuel
tracking (التفويل — evidence of a dropped feature in the legacy `one_car` view; §13-Q11) · GPS/
telematics · tires/batteries part-lifetime tracking · insurance policies (Contracts module owns
company contracts) · payroll deduction of driver violations (Payroll; Fleet only publishes the
event, §9.3).

## 1. What the legacy system taught us (summary of extraction)

One Express file serves Fleet + OPS + ATM + vault + IT. Fleet's domain model underneath the mess
is genuinely sound — nine entities with clear lifecycles and one clever odometer design — while
everything *around* the domain (auth, audit, org data, typed data) is what ECMS's platform already
does properly. The four load-bearing pieces of logic:

1. **Odometer continuity** — one reading simultaneously closes the previous period and opens the
   next (`POST /cars_log`: submitted reading → new row's `out_num` **and** previous row's
   `in_num`, km = difference). Periods cannot gap or overlap because the odometer is treated as
   the continuous physical sequence it is.
2. **Derived maintenance alarm** — never stored: `remaining = interval(vehicleType) −
   (currentReading − readingAtLastService)`; yellow/red when remaining crosses global thresholds;
   evaluated only on each vehicle's newest reading and only when it postdates the last service
   (`cars_log.ejs:664–687`). The rule list self-heals from the distinct types in the registry
   (`GET /cars_alarm`).
3. **Roster = availability − commitments** — defaults to **tomorrow** (planning, not diary);
   excludes vehicles with an open workshop visit covering the date; excludes absent and
   already-assigned drivers; saves as an **upsert per (vehicle, date)** so re-planning edits in
   place (`GET/POST /taeen_drivers`).
4. **Two-shape violations with annual rollup** — vehicle violations arrive as bulk yearly
   statements (count × unit value, with a تظلم/grievance figure that reduces the payable), driver
   violations are per-event (seatbelt/phone); the page aggregates both per (vehicle, year).

## 2. Entities

All collections `fleet_*` (identifier discipline, module-hierarchy §5). All rows carry the
platform base: `createdAt/updatedAt`, `version`, soft-delete (`deletedAt/deletedBy`) unless noted.
Auditing is the platform audit service — **no** per-row `added_by`/`edited_by[]` columns.

### 2.1 `fleet_vehicles` — Vehicle

| Field | Type | Notes |
|---|---|---|
| `code` | string, **unique among non-deleted** | business key (legacy `car_code`); shown everywhere |
| `typeId` | ref → `fleet_vehicle_types` | replaces free-text `car_type` |
| `plateNumber` | string, unique among non-deleted | |
| `chassisNumber` | string, unique among non-deleted | |
| `motorNumber` | string, unique among non-deleted | |
| `joinedAt` | date | joined the fleet |
| `licenseExpiresAt` | date | vehicle license (رخصة السيارة) renewal deadline |
| `licenseClass` | string, nullable | legacy `licens`; values pending §13-Q8 — free string until then |
| `branchId` / `departmentId` | org refs, nullable | replace free-text strings; drive data-scope filtering |
| `radio` | `{ issi: string?, motorolaSn: string? }` | cash-transport radio gear — a security fact of the vehicle |
| `status` | enum §6.1 | replaces legacy `deleted`+`status` numbers |
| `statusReason` | string, nullable | required when leaving `active` |

Legacy's denormalized `driver` field on the car is **dropped** — "current driver" is a roster
fact, derived from today's assignment.

### 2.2 `fleet_vehicle_types` — Vehicle Type (catalog + maintenance rule)

| Field | Type | Notes |
|---|---|---|
| `name` | localized string, unique (normalized) | e.g. غزالة مصفحة |
| `maintenanceIntervalKm` | int ≥ 0, 0 = no rule | legacy `fm_car_maint` |
| `isActive` | bool | archive instead of delete — vehicles reference it |

The legacy self-healing behaviour (rule rows appear/disappear with registry types) is replaced by
referential integrity: a vehicle *must* reference a type, so the rules page simply lists types.
Global thresholds `FleetAlarmYellowKm` / `FleetAlarmRedKm` are **platform settings** (settings
service, organization scope) — they are scalars, not rows.

### 2.3 `fleet_driver_profiles` — Driver Profile

The fleet-owned extension of an HR employee. **Fleet does not own people** (the legacy `emp`
mirror and its add/remove pages are gone): personal data, phone, employment state live in HR;
this row holds only what Fleet is the authority on.

| Field | Type | Notes |
|---|---|---|
| `employeeId` | ref → hr employee, **unique** | the join key |
| `licenseNumber` | string | driving license |
| `licenseExpiresAt` | date | |
| `specialization` | enum `cashTransport \| atm \| both` | legacy free-text تخصص |
| `area` | string, nullable | legacy المنطقة |
| `isActive` | bool | leaving the driver pool without touching the HR record |

**Design improvement over legacy:** driver eligibility = *has an active driver profile*, not
`employee_title` matching regex `سائق` — a title rename can no longer silently empty the roster.
(§13-Q13 confirms the enrollment path.)

### 2.4 `fleet_driver_unavailability` — Unavailability (التمامات)

| Field | Type | Notes |
|---|---|---|
| `employeeId` | ref | must hold a driver profile |
| `from` / `to` | dates, `to ≥ from` | inclusive range |
| `reason` | string (catalog-suggested, free allowed) | |
| `notes` | string, nullable | |

Availability on date *D* is a **seam**: unavailable if a row covers *D*, **or** (when setting
`FleetLeaveIntegration=true`, default per §13-Q1) HR leave covers *D*. One source of truth for
"why is he not here" once Q1 lands; the structure works either way.

### 2.5 `fleet_odometer_logs` — Odometer Entry

| Field | Type | Notes |
|---|---|---|
| `vehicleId` | ref | |
| `date` | date | operating day |
| `outReading` | int | odometer when leaving |
| `inReading` | int, nullable | odometer when back; **null = open period** |
| `km` | int, **server-derived** | `inReading − outReading`; never client-supplied |
| `driver1EmployeeId` / `driver2EmployeeId` | refs, nullable | |
| `notes` | string, nullable | |

The continuity rule (§4.3) is enforced here; a correction is a permissioned, audited edit — not a
free rewrite.

### 2.6 `fleet_maintenance_visits` — Workshop Visit

| Field | Type | Notes |
|---|---|---|
| `vehicleId` | ref | |
| `inDate` | date | check-in |
| `outDate` | date, nullable, `≥ inDate` | **null = in workshop** (the open state) |
| `workshopId` | ref → catalog `workshop` | legacy `destination` |
| `workTypeId` | ref → catalog `workType` | legacy `works`; the type flagged `countsForAlarm` (seeded: صيانة) resets the alarm baseline |
| `spareParts` | array of catalog refs/labels | |
| `odometerAtService` | int | legacy `counter`; the alarm baseline |
| `takenInByEmployeeId` / `takenOutByEmployeeId` | refs, nullable | custody (legacy driver/driver2) |
| `notes` | string, nullable | |

### 2.7 `fleet_duty_assignments` — Daily Duty Assignment (تعيين)

| Field | Type | Notes |
|---|---|---|
| `vehicleId` + `date` | **unique pair** | upsert target; re-planning edits in place |
| `missionTypeId` | ref → catalog `missionType`, nullable | default seeded نقل أموال (يومي); `maintenance` is **derived**, never stored (§10-H5 fixes a legacy bug here) |
| `driver1EmployeeId` / `driver2EmployeeId` | refs, nullable | driver2 role per §13-Q10 |
| `notes` | string, nullable | |

This row is the **OPS boundary**: OPS (future) attaches work orders to `assignmentId` and owns
what the mission actually did; Fleet owns who/which/what-kind per day. No soft-delete — clearing
a day's assignment empties the row's drivers/mission, preserving the planning audit trail.

### 2.8 `fleet_accidents` — Accident

| Field | Type | Notes |
|---|---|---|
| `vehicleId` | ref | |
| `occurredAt` | date | |
| `culprit` | string | driver name / third party / تحقيق pending — free text (legacy semantics; §13-Q9 may type it) |
| `statement` | string | البيان |
| `companyCost` | money (typed decimal) | legacy `company_account` — exact semantics §13-Q9 |
| `amountCollected` | money | |
| `paidAmount` | money | legacy client-computed `paid` — server-derived once Q9 defines the formula |
| `status` | enum `open \| closed` | replaces the stored **color** |
| `notes` | string, nullable | |
| attachments | via platform Files | police report, photos — additive over legacy |

### 2.9 `fleet_violations` — Violation (one collection, two shapes, discriminated)

Common: `vehicleId`, `amount` (money), soft-delete.

**`kind: 'vehicle'`** — bulk yearly statement rows: `year` (int, stored explicitly — legacy
synthesized a fake date from it, §10-H8), `violationTypeId` (catalog; seeds from the hardcoded
datalist §10-H7), `count` (int ≥ 1), `unitValue` (money), `amount = count × unitValue`
(**server-computed**).

**`kind: 'driver'`** — per-event: `date`, `driverEmployeeId`, `violationTypeId` (seeds: حزام،
تليفون), `amount`.

**`fleet_violation_grievances`** — one row per (vehicle, year): `totalBeforeGrievance` (money).
Legacy stamped this redundantly onto every violation row via `updateMany` (§10-H9); ECMS stores
it once. Annual rollup per (vehicle, year) = vehicle rows + driver rows + grievance figure, all
derived at query time.

### 2.10 `fleet_catalog_items` — Catalogs

`{ kind: 'workshop' | 'workType' | 'sparePart' | 'missionType' | 'violationType' |
'unavailabilityReason', name (localized, unique-per-kind normalized), isActive, meta }`.
`workType.meta.countsForAlarm: bool`. Append + rename + archive (legacy was append-only with no
rename — an admin typo lived forever).

## 3. Relationships

```
hr employee 1──0..1 fleet_driver_profiles ──< fleet_driver_unavailability
     │                        │
     │                        ├──< fleet_duty_assignments (driver1/driver2)
     │                        ├──< fleet_odometer_logs (driver1/driver2)
     │                        └──< fleet_violations (kind=driver)
fleet_vehicle_types 1──< fleet_vehicles 1──< fleet_odometer_logs
     (interval km)            ├──< fleet_maintenance_visits >── catalogs (workshop/workType/parts)
                              ├──< fleet_duty_assignments >── catalogs (missionType)   ← OPS attaches here (future)
                              ├──< fleet_accidents
                              └──< fleet_violations ──ᵍʳᵒᵘᵖᵉᵈ ᵇʸ ʸᵉᵃʳ── fleet_violation_grievances
org branch/department ── fleet_vehicles (scoping)     settings: FleetAlarmYellowKm/RedKm, FleetLeaveIntegration
```

## 4. Workflows and lifecycles

### 4.1 Vehicle lifecycle

`active` ⇄ `outOfService` → `disposed` (terminal; §13-Q6 may add labels like sold/scrapped as
*reasons* on `disposed`, not new states). "In workshop" is **derived** (an open maintenance visit
exists), never a stored state — deriving it is what makes it impossible to forget to flip back.
Every transition audited + published (§8).

### 4.2 Maintenance visit

`open` (checked in, `outDate` null) → `closed` (checked out: outDate + custody). `closed` →
`open` (reopen — legacy `deleted_dock=5` — permissioned, audited). **New rule the legacy lacked:
at most one open visit per vehicle** (legacy allowed duplicates by accident; nothing in the
domain wants a car in two workshops).

### 4.3 Odometer recording (the continuity workflow)

Recording reading *R* for vehicle *V* on date *D*:
1. Find *V*'s latest entry. If it is open (`inReading` null): set its `inReading = R`, derive its
   `km` — **the same reading closes the previous period**.
2. Create the new entry with `outReading = R`, `inReading = null` — **and opens the next**.
3. Monotonic guard: `R ≥` latest known reading for *V* (hard 422; corrections only via
   `fleet.odometer.correct`, §13-Q8 decides if a correction needs approval).
4. Recompute the alarm projection (§4.4) and publish `fleet.odometer.recorded`.

The legacy client conveniences become server behaviour: prefill "expected reading" from the
latest entry (API exposes it), Arabic-Indic digit normalization at the API boundary (§10-H3).

### 4.4 Maintenance alarm (derived + notified)

For each vehicle with `type.maintenanceIntervalKm > 0`:
`sinceService = latestReading − odometerAtService(latest closed alarm-counting visit)`,
`remaining = interval − sinceService`; `remaining ≤ FleetAlarmRedKm` → red, `≤ FleetAlarmYellowKm`
→ yellow. Guards preserved from legacy: newest entry only, entry date after last service date.
Never stored — computed on read. **Additive over legacy:** a daily scheduler sweep publishes
`fleet.maintenanceAlarm.raised` on first crossing into yellow/red (idempotent per vehicle+level+
service-baseline), so the alarm reaches people instead of waiting to be looked at.

### 4.5 Daily roster planning

Page defaults to **tomorrow**. Board = vehicles in the user's data scope (no hardcoded branch —
§13-Q4 confirms the legacy `المهندسين` filter was circumstance, and scope replaces it either way)
minus open-maintenance vehicles (shown, flagged, unassignable). Driver pool = active driver
profiles minus unavailable-on-D minus already-assigned-on-D. Save = upsert per (vehicle, date);
**a driver may hold one assignment per date** (enforced server-side with a unique check, not just
UI filtering — legacy enforced it only by hiding cards). Publishing: one `fleet.roster.planned`
per save + `fleet.assignment.changed` per changed row.

### 4.6 Accident

`open` → `closed` (and back — legacy toggles freely; kept, both audited). Create requires the §7
fields; amounts are typed money; attachments via Files.

### 4.7 Violations

Vehicle statement entry: pick (vehicle, year, type, count, unitValue) → server computes amount →
rows accumulate under the year. Grievance: set/update the single per-(vehicle, year) figure.
Driver events: single rows. All edits audited; deletes soft.

## 5. Business rules (normative)

| # | Rule | Origin |
|---|---|---|
| FR-1 | Vehicle `code`, `plateNumber`, `chassisNumber`, `motorNumber` unique among non-deleted | legacy intent, now enforced |
| FR-2 | Odometer readings per vehicle are monotonically non-decreasing; one reading closes the previous period and opens the next; `km` is server-derived | legacy §4.3 |
| FR-3 | Maintenance alarm is derived, never stored; interval per vehicle **type**; thresholds global settings; only alarm-counting work types reset the baseline | legacy §4.4 |
| FR-4 | At most one open maintenance visit per vehicle; `outDate ≥ inDate`; check-out records custody | legacy + tightened |
| FR-5 | A vehicle with an open visit covering date D is unassignable on D | legacy |
| FR-6 | A driver unavailable on D (fleet record, and HR leave when integration on) is unassignable on D | legacy + Q1 |
| FR-7 | One assignment per driver per date; one assignment row per (vehicle, date), upserted | legacy, now server-enforced |
| FR-8 | Roster defaults to tomorrow (planning tool) | legacy |
| FR-9 | Vehicle violations: `amount = count × unitValue`, server-computed; grievance stored once per (vehicle, year); annual rollup merges vehicle + driver shapes | legacy §2.9 |
| FR-10 | Accident status is open/closed; both directions allowed, audited | legacy |
| FR-11 | Fleet never edits HR-owned personal data; fleet-owned driver facts live in the driver profile | corrected boundary |
| FR-12 | Vehicle "current driver" and "in workshop" are derived facts, never stored fields | corrected |
| FR-13 | Every mutation is audited (platform audit) and scoped (data scopes); every lifecycle change publishes its §8 event | ECMS platform |
| FR-14 | License expiry (vehicle + driver) is tracked and swept daily; expiring-soon windows configurable via settings | legacy columns + additive sweep |

## 6. States catalog

| Entity | States | Notes |
|---|---|---|
| Vehicle | `active`, `outOfService`, `disposed` (+ soft-deleted) | inWorkshop derived; §13-Q6 refines disposal *reasons* |
| Maintenance visit | `open`, `closed` (+ soft-deleted) | reopen allowed |
| Odometer entry | `open` (no inReading), `closed` | closed by the next reading |
| Duty assignment | present/empty per (vehicle, date) | vehicle-side flag `maintenance` derived |
| Accident | `open`, `closed` (+ soft-deleted) | |
| Violation | live, soft-deleted | no further lifecycle |
| Driver profile | `active`, `inactive` | independent of HR employment status, which gates it (inactive employee ⇒ ineligible regardless) |

## 7. Permissions (resource.action — RBAC + data scopes)

| Screen | View needs | Operations on it |
|---|---|---|
| `/fleet` (home) | any fleet view permission | — |
| `/fleet/vehicles` | `fleetVehicle.view` | `fleetVehicle.create`, `.edit`, `.changeStatus`, `.delete` |
| `/fleet/vehicles/:id` | `fleetVehicle.view` | tabs reuse their own view permissions |
| `/fleet/drivers` | `fleetDriver.view` | `fleetDriver.manage` (profile create/edit/deactivate) |
| `/fleet/availability` | `fleetAvailability.view` | `fleetAvailability.record`, `.edit` (covers delete) |
| `/fleet/odometer` | `fleetOdometer.view` | `fleetOdometer.record`, `.correct` (monotonic override + past edits) |
| `/fleet/maintenance` | `fleetMaintenance.view` | `fleetMaintenance.checkIn`, `.checkOut` (incl. reopen), `.edit`, `.delete` |
| `/fleet/maintenance-rules` | `fleetMaintenance.view` | `fleetMaintenanceRule.manage` (intervals + thresholds) |
| `/fleet/roster` | `fleetRoster.view` | `fleetRoster.plan` |
| `/fleet/accidents` | `fleetAccident.view` | `fleetAccident.create`, `.edit`, `.close` (both directions), `.delete` |
| `/fleet/violations` | `fleetViolation.view` | `fleetViolation.record`, `.edit`, `.grievance`, `.delete` |
| `/fleet/settings` | `fleetCatalog.manage` | catalog CRUD (archive, rename) |

Data scopes apply on every read/write through the standard base-repository path: a branch-scoped
user sees that branch's vehicles and everything hanging off them. All fleet permissions are
declared in `packages/contracts` and land in the generated permission matrix.

## 8. Events (the Automation Engine surface)

All envelope-carried per ADR-008, v1 payloads, catalogued so they appear in the automation
trigger picker. Naming `fleet.<entity>.<pastTenseEvent>`.

| Event | Payload v1 (beyond ids) | Fired when |
|---|---|---|
| `fleet.vehicle.created` / `.updated` | vehicleId, code, typeId | registry writes |
| `fleet.vehicle.statusChanged` | vehicleId, code, from, to, reason | lifecycle |
| `fleet.odometer.recorded` | vehicleId, code, logId, outReading, closedKm? | §4.3 step 4 |
| `fleet.odometer.corrected` | vehicleId, logId, field, old, new | permissioned correction |
| `fleet.maintenance.checkedIn` / `.checkedOut` / `.reopened` | visitId, vehicleId, workshopId, workTypeId, odometerAtService | §4.2 |
| `fleet.maintenanceAlarm.raised` | vehicleId, code, level (`yellow`\|`red`), remainingKm | sweep, first crossing |
| `fleet.vehicleLicense.expiring` / `.expired` | vehicleId, code, licenseExpiresAt | daily sweep, configurable window |
| `fleet.driverLicense.expiring` / `.expired` | employeeId, licenseExpiresAt | daily sweep |
| `fleet.roster.planned` | date, changedCount | per save |
| `fleet.assignment.changed` | vehicleId, date, missionTypeId, driver1, driver2 | per changed row |
| `fleet.driverUnavailability.recorded` / `.ended` | employeeId, from, to, reason | التمامات |
| `fleet.accident.recorded` / `.closed` / `.reopened` | accidentId, vehicleId, amounts | §4.6 |
| `fleet.violation.recorded` | violationId, kind, vehicleId, driverEmployeeId?, year?, amount | §4.7 |
| `fleet.violation.grievanceApplied` | vehicleId, year, totalBeforeGrievance | grievance set |

First automation candidates once A-6b ships: red alarm → escalate; license expiring → WhatsApp
the responsible; roster planned → publish the day sheet.

## 9. Integration points

**9.1 HR (live):** driver = employee + fleet profile (FR-11); employee exit/suspension events
(`hr.employee.statusChanged/.exited`) auto-deactivate roster eligibility; leave feeds availability
behind the `FleetLeaveIntegration` setting (Q1).
**9.2 Platform (live):** auth/RBAC/data scopes on everything; audit on every mutation; Files for
vehicle/accident/violation attachments (additive); notifications templates (`fleet.maintenanceDue`,
`fleet.licenseExpiring`, …) seeded by the module; settings for thresholds/windows/toggles;
scheduler for the two daily sweeps; sequences not used in v1 (§13-Q12).
**9.3 Accounting (future):** no coupling — accident and violation money is published in events and
queryable; Accounting subscribes when it exists.
**9.4 OPS (future):** OPS reads `fleet_duty_assignments` by date and attaches work orders to
`assignmentId`; mission-type catalog is Fleet-owned, OPS-readable. Fleet never knows what the
mission did.
**9.5 Automation (live):** §8 is the contract; nothing else needed.

## 10. Hidden logic found in views/controllers/JS (and its ECMS fate)

| # | Found | Where | ECMS fate |
|---|---|---|---|
| H1 | Full alarm math in the view | `cars_log.ejs:664–687` | server-side, §4.4 |
| H2 | Client-only monotonic check (خروج ≥ دخول) + auto-prefill of the new reading from the previous day's max | `cars_log.ejs:455–560` | server rule FR-2 + API-provided expected reading |
| H3 | Arabic-Indic digit normalization before math | `cars_log.ejs toNumberHuman` | API-boundary normalization |
| H4 | Roster save un-hides filtered rows then submits **all** rows | `taeen_drivers.ejs:1049` | save sends only changed rows |
| H5 | Forced status `صيانة` only when `department === "نقل اموال"` — misspelled (missing hamza), so the branch never matches real data | `taeen_drivers.ejs:1023` | derived maintenance flag for **all** vehicles (§2.7); latent bug not carried |
| H6 | Drag-and-drop driver cards between vehicles; card roles (`leader-card`) | `taeen_drivers.ejs` | roster UX kept (drag or pick); role flags are OPS concerns, not Fleet |
| H7 | Vehicle violation types hardcoded in a datalist (الانتظار في الممنوع، تعمد تعطيل المرور، عدم اتباع تعليمات المرور، رسوم قضائية، رسوم خدمة) | `car_violations.ejs` | seeded `violationType` catalog |
| H8 | Bulk violation date synthesized as (year, *current* month, day+1) — only the year is real | `POST /car_violations/cars` | explicit `year` field |
| H9 | Grievance figure `updateMany`-stamped onto every row of the (car, year) | `POST /car_violations/edit/totalBeforeGrievance` | one grievance row per (vehicle, year) |
| H10 | Accident `paid` computed client-side, saved "exactly as sent"; commas stripped pre-submit | `fleet_accident.ejs` + edit route comment | typed money, server-derived once Q9 defines the formula |
| H11 | Accident list sorted open-first, then vehicle, then date desc | `GET /fleet_accident` | default sort kept |
| H12 | Per-user roster department filter persisted in its own collection (`fleet_filter`); other pages use `localStorage` | routes + views | client-side URL/local state; no collection |
| H13 | Commented-out fuel (التفويل) table | `one_car.ejs:703` | out of scope; §13-Q11 |
| H14 | Edit forms default the date picker to **yesterday** | `cars_log.ejs` flatpickr | not carried; default today, explicit pick |
| H15 | Unicode direction-mark scrubbing at read time (Excel paste residue) | `/fleet`, `/fleet_accident` | normalize at write time |

## 11. Deliberately left behind

Single-user `pola` session check → auth/RBAC. The `emp` HR mirror and its `add_emp`/`remove_emp`/
`hr_data_edit` pages → HR module. Free-text branch/department + hardcoded `المهندسين`/`الحركة` →
org refs + data scopes. `added_by`/`edited_by[]` columns → audit service. Status-as-color
(`finsh_status_color`) and magic `deleted_dock` codes 0–5 → enums + named endpoints. Numbers and
money as strings → typed schema. Title-regex driver detection → driver profiles. Append-only
catalogs → archive/rename. Duplicate `contad_app copy.js` — ignored (stale backup).

## 12. Pages (12) and delivery slices

Pages as approved in the extraction: home · vehicles · vehicle profile (tabs: details, odometer,
maintenance, accidents, violations, assignments — three more histories than legacy `one_car`
showed) · drivers · availability · odometer · maintenance · maintenance-rules · roster ·
accidents · violations · settings.

| Slice | Delivers | Depends on |
|---|---|---|
| **FL-1** ✅ | Contracts: DTOs/schemas/permissions/events/settings for everything above | — |
| **FL-2** ✅ | API: vehicle types + catalogs + vehicle registry/lifecycle | FL-1 |
| **FL-3** ✅ | API: driver profiles + unavailability (+ HR event subscriptions, leave seam) | FL-1 |
| **FL-4** ✅ | API: odometer + maintenance + alarm engine + the two sweeps | FL-2 |
| **FL-5** ✅ | API: roster | FL-3, FL-4 |
| **FL-6** ✅ | API: accidents + violations + grievances + rollups | FL-2 |
| **FL-7** | Web: vehicles, vehicle profile, drivers, settings | FL-2, FL-3 |
| **FL-8** | Web: odometer, maintenance, rules, roster | FL-4, FL-5 |
| **FL-9** | Web: accidents, violations, availability, module home | FL-6 |
| **FL-10** | Legacy data migration (one-off script: cars, logs, visits, accidents, violations, absence → typed collections; §13-Q14 cutover) | all |

Each slice carries its own tests, docs, and permission-matrix updates per ECMS norm; one PR per
slice, approval-gated, exactly as HR/Contracts/Automation were built.

**Backend status: COMPLETE.** FL-1…FL-6 delivered — every §2 entity, §5 rule, §7 permission and
§8 event is live; all 22 `fleet.*` events are `stable`. What remains is the web tier (FL-7…FL-9)
and the one-off legacy migration (FL-10), each starting only on the owner's go.

## 13. Open Questions

Answers refine defaults/labels; none reopen structure.

| # | Question | Frozen interim |
|---|---|---|
| Q1 | ~~التمامات~~ **ANSWERED (owner, 2026-08-02):** HR Leave is the base; fleet adds only the daily operational overlay | `fleet.availability.useHrLeave` default **true**; overlay = `fleet_driver_unavailability` |
| Q2 | ~~Driver profile split~~ **ANSWERED:** profile is an extension of the HR employee, no personal-data duplication | as designed (FR-11) |
| Q3 | Confirm OPS boundary: Fleet owns (vehicle, drivers, mission type)/day; OPS owns execution | designed as stated (§9.4) |
| Q4 | ~~`المهندسين` hardcode~~ **ANSWERED:** data scopes only | as designed (§4.5) |
| Q5 | Driver violation → payroll deduction, or record only? | record + event only; Payroll subscribes later |
| Q6 | Disposal reasons (sold/scrapped/…)? Branch transfer: does the code change? | `disposed` + free reason; code immutable pending answer |
| Q7 | `licens` example values | free string `licenseClass` until then |
| Q8 | Odometer corrections: who, and with approval? | `fleetOdometer.correct` permission, audited, no approval chain yet |
| Q9 | Exact semantics of accident `companyCost`/`amountCollected`/`paid` formula | stored typed, no derived math until defined |
| Q10 | driver2 = codriver/guard or mid-day handover? | second slot, no handover semantics |
| Q11 | ~~Fuel (التفويل)~~ **ANSWERED:** deferred to a later phase | out of scope v1 |
| Q12 | Reference numbers for accidents/violations (sequences)? | none in v1 |
| Q13 | Driver enrollment: who creates profiles, and bulk-import from current data? | `fleetDriver.manage`; import in FL-10 |
| Q14 | Migration cutover: parallel run or hard switch? which collections' history matters most? | FL-10 plans after answer |

## 14. Answers to the extraction's §6 (superseded)

The ten questions from revision 0.1 are carried into §13 (renumbered) — none were answered yet.

## 15. Review trail

| Date | Revision |
|---|---|
| 2026-08-02 | 0.1 — legacy extraction, entity sketch, page plan, 10 owner questions (draft) |
| 2026-08-02 | **1.0 — FROZEN.** Full design per the owner's instruction: field-level entities on platform conventions, relationships, lifecycles, 14 business rules, states, per-screen permissions, validations embedded in §2/§4/§5, 16-event automation surface, integration boundaries (HR/OPS/Accounting/platform), 15 pieces of hidden view/JS logic with their fates (incl. the misspelled-department roster bug H5 and the fake-date violation bug H8, neither carried), 10 slices FL-1…FL-10. Open questions narrowed to defaults/labels (§13); structure closed. |
| 2026-08-02 | 1.1 — owner approval + Q1/Q2/Q4/Q11 answered (leave-based availability with operational overlay; profile as HR-employee extension; data scopes only; fuel deferred). Owner's seven implementation principles recorded — all already embodied by the frozen structure: no legacy workarounds, derived-not-stored, backend-only rules, settings/catalogs over hardcodes, domain events everywhere, event/service integration without coupling, full platform conventions. FL-1 (contracts) started on this basis. |
| 2026-08-02 | 1.2 — FL-2 delivered (no design change): fleet module manifest registered ungated like HR; vehicle types + catalogs + vehicle registry live with the §7 permissions, branch/department data scopes, version-aware audited writes, and the three `fleet.vehicle.*` events promoted planned → stable. Derived `inWorkshop` is a service seam returning false until FL-4 owns visits. Fleet settings declared with defaults (yellow 1000 km, red 300 km, leave integration ON, both license warn windows 30 days). Boot seed: work type «صيانة» (counts for alarm), mission type «نقل أموال (يومي)», the seven legacy violation types. |
| 2026-08-02 | 1.3 — FL-3 delivered (no structural change): driver profiles + التمامات live. One new platform surface, `platform/directory` — the employee-directory seam (employee lookup + approved/active-leave lookup), registered by HR at module load exactly as `auth/identity-seams` established, consumed by Fleet; neither module imports the other. Profiles carry an internal `kind` discriminator (unique index employeeId+kind, not in the DTO) so a future second profile kind is additive, per the owner's FL-3 instruction 3. Availability is one seam function layering profile switch → HR employment gate → fleet overlay → HR leave (setting-gated). `hr.employee.exited` subscription deactivates the profile. `fleet.driverUnavailability.recorded/.ended` promoted to stable; updates deliberately publish no event (a date correction adjusts a fact, it is not a new one). |
| 2026-08-02 | 1.4 — FL-4 delivered (no structural change): odometer + maintenance + the derived alarm engine + both sweeps live. §4.3 continuity implemented literally — one reading closes the open period and opens the next inside one transaction (`ux_open_period` partial unique index enforces at most one open period per vehicle), and the correction flow rewrites the SHARED reading on both neighbouring rows atomically, refusing any correction that would break chain order (owner FL-4 point 1). The alarm is computed on read only — pure `computeAlarm` (legacy `cars_log.ejs` arithmetic with both guards) over settings thresholds + vehicle-TYPE interval + latest closed counting visit as baseline; nothing derived is stored (points 2/3/5). Sweep idempotency is one new collection, `fleet_sweep_marks` (unique deterministic key, insert-if-new): license renewal or a new service baseline naturally re-arms the announcement, and re-running a sweep emits nothing (point 4). Scheduled tasks `fleet.licenseExpirySweep` (04:15) and `fleet.maintenanceAlarmSweep` (04:30) registered in the manifest. FL-2's `inWorkshop` seam body replaced with the real open-visit query — no call-site changed. Ten events promoted planned → stable, all post-commit (point 6): `fleet.odometer.recorded/.corrected`, `fleet.maintenance.checkedIn/.checkedOut/.reopened`, `fleet.maintenanceAlarm.raised`, `fleet.vehicleLicense.expiring/.expired`, `fleet.driverLicense.expiring/.expired`. Additive contract deltas only: `FleetExpectedReadingDto`, `FleetVehicleIdQuerySchema`, `ReopenFleetMaintenanceSchema`, audit actions `correct`/`checkOut`/`reopen`. |
| 2026-08-02 | 1.5 — FL-5 delivered (no structural change): the daily duty roster is live. `fleet_duty_assignments` per §2.7 — one row per (vehicle, date) under a unique index, upserted in place, NO soft-delete: clearing a day's plan empties the row's facts so the planning trail keeps the row its audit history hangs on (owner FL-5 point 5). The roster owns no availability logic (points 1/2): a driver's assignability is exactly `driverAvailabilityOn`'s verdict (FR-6) and a vehicle's is exactly the `openVisitVehicleIds` seam's — extended with a covering-date parameter for FR-5 with no call-site change. FR-7 is enforced against the END STATE of the whole day inside the transaction: a row outside the payload still holding a payload driver is a 409 telling the client to send the releasing row — which is exactly what a drag produces, so the API is drag-and-drop-ready with no future backend change (point 7). Every save runs in one `unitOfWork`, each write version-checked against the row it read (point 4); unchanged rows are pure no-ops (no write, no audit, no event). `fleet.roster.planned` (one per save, with changedCount) + `fleet.assignment.changed` (per changed row) promoted planned → stable, both post-commit (point 6). New permission pair `fleetRoster.view`/`fleetRoster.plan`; the plan response returns the refreshed board in the same round-trip. Zero contract changes — the FL-1 roster surface was implemented exactly as frozen. |
| 2026-08-02 | 1.6 — FL-6 delivered; **the Fleet backend is complete** (no structural change). Accidents per §2.8/§4.6: `open` at creation, both flip directions legal and published (FR-10) with no-op flips refused, amounts stored as entered facts — no derived money until §13-Q9 defines the formula; recording is allowed against a disposed vehicle, because an accident is historical paperwork, not a new operational fact (deliberate contrast with the odometer's refusal). Violations per §2.9/§4.7: one collection, two discriminated shapes; a vehicle statement row NEVER accepts an amount — the server derives count × unitValue on create and on every factor edit (FR-9) — while driver rows record the amount as entered and require a driver profile to exist (active or not: history counts). Cross-shape edits are refused in the service, the one place both shapes meet. Grievance = ONE row per (vehicle, year) under a unique index, upserted in place, each set published (H9's fate); the annual rollup (`GET /fleet/violations/rollup`) is fully derived at query time — vehicle rows by stored year, driver rows by the year of their date (H8's fate: no synthesized dates), merged with grievances and codes by a pure, unit-tested assembler. Five events promoted planned → stable post-commit: `fleet.accident.recorded/.closed/.reopened`, `fleet.violation.recorded/.grievanceApplied` — **all 22 fleet events are now stable; the automation surface is complete**. §7 permissions live: `fleetAccident.view/create/edit/delete/close` (close covers both directions), `fleetViolation.view/record/edit/grievance/delete`. Additive contract deltas only: `FleetGrievanceDto`, `FleetViolationRollupQuerySchema`. |
