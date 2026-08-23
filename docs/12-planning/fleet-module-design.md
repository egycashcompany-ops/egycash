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
| `licenseClassId` | ref → catalog `licenseClass` | legacy `licens`; §13-Q7 answered as DATA (rev 1.18) — an admin-owned catalog, not a free string |
| `operationId` | ref → catalog `operation`, nullable | التشغيل — the operating group the vehicle runs under |
| `insuranceCompanyId` | ref → catalog `insuranceCompany`, nullable | شركة التأمين |
| `licenseImage` | `{ fileId, fileName, mime, size, uploadedAt }`, nullable | the scanned vehicle licence; bytes live in platform Files (§9.2), the vehicle holds the link |
| `branchId` | org ref, **required** (rev 1.18) | replaces the free-text string; drives data-scope filtering. Rows created before rev 1.18 may hold null — they stay readable and editable, and an edit must name a branch |
| `departmentId` | org ref, nullable | replaces the free-text string |
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
| `sparePartIds` | array of refs → catalog `sparePart` | what new visits write |
| `spareParts` | array of strings | DEPRECATED free text kept for backward compatibility: still accepted, stored verbatim, shown on the row. Never converted to catalog ids — see §4.2 |
| `odometerAtService` | int | legacy `counter`; the counter on the way IN |
| `exitOdometer` | int, nullable, `≥ odometerAtService` | the counter on the way OUT, required at check-out. The alarm baseline of a closed visit (§4.4). `null` while the visit is open, and on visits closed before this was collected |
| `driverInEmployeeId` | ref, nullable | the DRIVER who brought the vehicle in, chosen explicitly and REQUIRED at check-in. Stored, not read from the roster — a plan is not a record of who arrived. `null` only on visits predating the field |
| `driverOutEmployeeId` | ref, nullable | the DRIVER who took it away, REQUIRED at check-out. `null` while open, cleared by reopen, and `null` on visits predating the field |
| `takenInByEmployeeId` / `takenOutByEmployeeId` | refs, nullable | CUSTODY — who PERFORMED the check-in/check-out (legacy driver/driver2), resolved from the authenticated user. A different fact from the two drivers above; see §4.2 |
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
'unavailabilityReason' | 'licenseClass' | 'operation' | 'insuranceCompany',
name (localized, unique-per-kind normalized), isActive, meta }`. The last three arrived with rev
1.18 and are the vocabularies the vehicle registry points at; they are **not seeded** — the admin
names them, and the only `licenseClass` rows the system creates itself come from the rev-1.18
migration of real legacy values.
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

`open` (checked in, `outDate` null) → `closed` (checked out: outDate + exit reading + custody).
`closed` → `open` (reopen — legacy `deleted_dock=5` — permissioned, audited; it clears the exit
reading and the check-out custody, because a car back in the workshop has not left). **New rule
the legacy lacked: at most one open visit per vehicle** (legacy allowed duplicates by accident;
nothing in the domain wants a car in two workshops).

**These two states ARE the visit's status.** There is no separate maintenance-status field, and
the derived alarm level (§4.4) is not one — that is a property of the VEHICLE, not of a visit: a
closed visit can sit on an overdue car and an open one on a car with thousands of km to go.

**Check-out requires the exit reading.** `exitOdometer` is mandatory and must be `≥` the visit's
`odometerAtService`; the same check guards a later edit of either number. It is what the next
service is measured from (§4.4), which is why it cannot be skipped — a check-out without it would
leave the next service counted from the arrival reading and falling due early. **Contract note:
this is a breaking change to `POST /fleet/maintenance/:id/check-out`; a caller that omits
`exitOdometer` is rejected, and external callers must send it.**

**Spare parts are catalog references.** New visits write `sparePartIds` against the `sparePart`
catalog (§2.10), validated as live items on the way in. The free-text `spareParts` of older
visits is retained and displayed, and is still accepted from callers written before the catalog
existed — stored verbatim, never matched to a catalog item by name, because guessing which part a
spelling meant is the silent data loss the catalog exists to end. Nothing is migrated or deleted.

**A driver is required at both ends.** Check-in refuses without `driverInEmployeeId` and
check-out refuses without `driverOutEmployeeId`; both are chosen explicitly from the HR directory
and STORED on the visit. They are deliberately not read from the duty roster: the roster says who
was *planned* to drive that day and can be re-planned afterwards, which is a different claim from
who actually brought the car in or drove it away. Reopening a visit clears the exit driver along
with the rest of the exit. Visits written before these fields existed carry `null` for both and
are never back-filled by guessing — the roster is not evidence of what happened.

**Driver is not custody.** `takenInByEmployeeId` / `takenOutByEmployeeId` answer "who PERFORMED
the check-in / check-out", and are resolved from the authenticated user through the platform
directory seam (`getSelfDirectoryEmployee`) rather than typed in; a login with no employee behind
it records nothing rather than inventing somebody. They are audit facts and are not shown as
drivers anywhere.

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
`sinceService = latestReading − baseline(latest closed alarm-counting visit)`,
`remaining = interval − sinceService`; `remaining ≤ FleetAlarmRedKm` → red, `≤ FleetAlarmYellowKm`
→ yellow. Guards preserved from legacy: newest entry only, entry date after last service date.
Never stored — computed on read. **Additive over legacy:** a daily scheduler sweep publishes
`fleet.maintenanceAlarm.raised` on first crossing into yellow/red (idempotent per vehicle+level+
service-baseline), so the alarm reaches people instead of waiting to be looked at.

The **baseline** is that visit's `exitOdometer` — the reading the vehicle LEFT the workshop on —
falling back to `odometerAtService` for visits closed before that reading was collected. Whatever
the workshop itself drove is not distance since the service, and counting it would bring the next
one forward. An OPEN visit is never a baseline: the car has not been serviced yet.

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
| FR-3 | Maintenance alarm is derived, never stored; interval per vehicle **type**; thresholds global settings; only alarm-counting work types reset the baseline, and the baseline is the closed visit's `exitOdometer` (fallback `odometerAtService`) | legacy §4.4 |
| FR-4 | At most one open maintenance visit per vehicle; `outDate ≥ inDate`; check-in requires a driver, check-out requires a driver and `exitOdometer ≥ odometerAtService`; custody is recorded from the login, separately from the drivers | legacy + tightened |
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
| Maintenance visit | `open`, `closed` (+ soft-deleted) | reopen allowed; these two are the whole status — no separate status field, and the derived alarm level is not one (§4.2) |
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
§8 event is live; all 22 `fleet.*` events are `stable`.
**Web status: COMPLETE.** FW-1…FW-10 delivered — the frozen IA's twelve applications are all
live, every route behind its §7 permission, nothing unshipped visible anywhere. What remains is
the one-off legacy migration (FL-10), starting only on the owner's go.

**Web tier plan (owner, 2026-08-02 — supersedes the FL-7…FL-9 grouping):** the frontend ships as
ten approval-gated slices under the same one-slice-one-review rhythm. FW-1 skeleton + navigation
+ routing (IA: `/fleet`, `/fleet/vehicles(/:id)`, `/fleet/drivers`, `/fleet/attendance`,
`/fleet/odometer`, `/fleet/maintenance`, `/fleet/maintenance-alarms`, `/fleet/roster`,
`/fleet/accidents`, `/fleet/violations`, `/fleet/catalogs`, `/fleet/settings`) · FW-2 dashboard ·
FW-3 vehicles list · FW-4 vehicle details · FW-5 drivers + profiles + attendance · FW-6 odometer
+ maintenance + alarms · FW-7 daily roster · FW-8 accidents · FW-9 violations + grievances ·
FW-10 catalogs + settings + final integration. No mock data anywhere: every page reads the
FL-2…FL-6 APIs only.

**Navigation rule (owner, FW-1 review; confirmed after FW-4 as the ECMS-wide standard):** no
placeholder surface is ever reachable by an end user, and nothing unshipped is ever VISIBLE —
links/menus/actions to unfinished screens are fully hidden (never rendered disabled) and appear
automatically the moment their slice ships. A screen joins the sidebar catalog AND the route
table in the same slice that ships it; until then its URL falls through to the standard 404.
Each FW slice appends its rows to the nav seed (the boot sync is additive).

| Slice | Delivers | Status |
|---|---|---|
| **FW-1** | Skeleton: module chunk + nav category + i18n + api/query layer | ✅ (revised per review: shipped-only navigation) |
| **FW-2** | Dashboard at `/fleet`: live KPIs (active vehicles, in-workshop, alarms, open accidents) + alarm board + expiring licenses | ✅ |
| **FW-3** | Vehicles list: URL-synced search/filters/sort/pagination + create/edit + §4.1 status dialog + delete, fully permission-gated | ✅ |
| **FW-4** | Vehicle profile: identity/type/license/placement/audit cards + 4 live indicators (workshop, last reading, alarm, last service) + reused edit/status dialogs; explicit View action in the list (owner decision: no row-click) | ✅ |
| **FW-5** | Drivers list + driver profile (fleet facts + HR link + per-driver التمامات) + attendance screen with record/edit/cancel | ✅ |
| **FW-6** | Odometer log (record + correction) + maintenance visits (check-in/out/reopen/edit/delete) + derived alarms board; odometer & maintenance links lit in the vehicle profile | ✅ |
| **FW-7** | Daily roster planning board: day board + driver pools (availability verdicts with reasons) + assign/edit/clear + one-save vehicle-to-vehicle transfer; roster link lit in the vehicle profile | ✅ |
| **FW-8** | Accidents registry: URL-synced list (vehicle/status/date-range, sortable, paginated) + record/edit (whole-registry vehicle select) + close/reopen/delete, all version-aware; accidents link lit in the vehicle profile | ✅ |
| **FW-9** | Violations in both backend shapes + the derived annual rollup view + the per-(vehicle, year) grievance dialog — zero client-side money math; violations link lit in the vehicle profile | ✅ |
| **FW-10** | Catalogs (six kinds, archive-not-delete) + settings (vehicle-type rules + the five fleet platform settings via the platform resolver) + final integration review — **the Fleet web tier is COMPLETE** | ✅ |

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
| Q7 | ~~`licens` example values~~ **ANSWERED (owner, rev 1.18): as DATA.** The vocabulary is a `licenseClass` catalog the admin owns, so no code change is needed when the authority renames a class | `licenseClassId` → catalog ref; legacy strings migrated, none deleted |
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
| 2026-08-02 | 1.7 — FW-1 delivered (frontend phase opened; no backend/contract change). The owner's ten-slice web plan (FW-1…FW-10) recorded in §12, superseding the FL-7…FL-9 grouping. The Fleet web module now exists exactly in the HR modules' architecture: a lazy route chunk under `/fleet/*` with `AppShell`, every §7 permission guarding its route, a permission-aware module home, breadcrumbs, ar/en i18n and RTL via the platform frame. Navigation is data-driven as everywhere else: the boot catalog sync gained a Fleet category (12 applications mapped to the real routes) — strictly additive, admin customizations untouched. The whole FL-2…FL-6 API surface is typed in `modules/fleet/api/` (client functions + TanStack Query hooks on the platform key factory) so FW-2…FW-10 consume data, never re-derive it. Screens whose slice has not landed render an honest planned-state page (no mock data) behind the final route + permission; each slice replaces its element in place. Five glyphs added to the shared icon set (truck/gauge/wrench/calendar/cog) and the sidebar icon registry extended — including `calendar`, which the Leave app had referenced without a registry entry. |
| 2026-08-02 | 1.8 — FW-1 revised per owner review + FW-2 delivered. Review rule recorded in §12: NO placeholder is ever user-reachable — the nav seed now carries only shipped pages (Fleet Home after this revision) and each slice appends its rows; the planned-state page was deleted outright, unshipped URLs fall to the standard 404, and the IA + §7 permission map lives as a comment in the route module. FW-2: `/fleet` is a live dashboard — four KPIs (active vehicles, in-workshop via open visits, derived alarms with red count, open accidents) and two boards (maintenance alarms in triage order red-first/most-overdue-first; licenses expiring within 60 days, expired flagged) — every number a server fact through the FL-2…FL-6 APIs, each card gated by its own §7 permission so queries never fire for cards the user cannot see. |
| 2026-08-02 | 1.9 — FW-3 delivered: the vehicles registry screen, in the HR list-page idiom exactly. URL-synchronized state (search over the four FR-1 identifiers server-side, status/type/branch filters, sortable code/license columns, pagination) — deep-linkable and back/forward-aware; the branch filter reuses the platform's `BranchFilterSelect` (renders only with `branch.view`). The DERIVED `inWorkshop` pill renders beside the §4.1 status badge, expired licenses show red in place. Create/edit share one dialog (cleared optional fields submit as null — an erased fact, not an untouched one); the status dialog offers only the transitions §4.1 allows, requires the reason whenever the vehicle leaves active, and spells out that disposal is terminal (edit/status actions are hidden for disposed rows); delete confirms with the audit-trail note. Every action behind its own §7 permission; rows do not navigate yet — the profile ships in FW-4 and adds the link then (navigation rule). Vehicles row added to the nav seed. |
| 2026-08-02 | 1.10 — FW-4 delivered + owner UI decision recorded: NO whole-row navigation anywhere in the module — an explicit View action in the actions column instead (avoids accidental navigation, matches the other modules, leaves row selection free). The vehicle profile at `/fleet/vehicles/:id` (legacy `one_car`): identity + radio card, type/license/placement/audit card (the type's §2.2 interval shown from the catalog, expired license flagged in place, branch name resolved only under `branch.view`), the §4.1 status strip with its reason, and four live indicators each gating its own §7 permission — in-workshop (derived), the server's expected next reading (H2), the FR-3 alarm with remaining/overdue km, and the last CLOSED visit with its counter. Edit/status reuse the FW-3 dialogs against the freshly loaded document (version-aware); both hidden for a disposed vehicle. The five history links (odometer, maintenance, accidents, violations, roster) are wired to pre-filtered URLs behind a per-slice shipped flag — hidden until each target ships, per the navigation rule. |
| 2026-08-02 | 1.11 — FW-5 delivered; hide-don't-disable confirmed by the owner as the ECMS-wide navigation standard. Drivers list (legacy `/drivers`): URL-synced license search + specialization/active filters, names resolved through the SHARED HR employees detail cache (one `EmployeeName` component; without `employee.view` it degrades honestly to the raw id), sortable expiry with expired-in-red, View/Edit actions per §7. Driver profile: the fleet-owned facts (FR-11) + a link INTO the shipped HR employee profile under `employee.view` + the driver's own التمامات timeline with record/edit/cancel in place — recording from the profile skips the employee picker because the driver is known. Attendance (legacy `/fleet_attendance`): the operational overlay as a URL-synced list (covers-date filter, sortable from/to), record through the directory picker (`EmployeeSearchPicker`, the ContractCreatePage idiom; degrades with a clear hint without `employee.view`), edit/cancel version-aware behind `fleetAvailability.edit` with the cancel confirm noting the audit trail. Drivers + Attendance rows joined the nav seed. Zero backend changes. |
| 2026-08-02 | 1.12 — FW-6 delivered: the three FL-4 screens, every number a server fact. Odometer log (legacy `cars_log`): URL-synced vehicle/date-range filters + sortable date/outReading; an open period renders as an honest "open" badge with km blank because the SERVER hasn't derived it yet; recording shows the expected-reading hint (H2) fetched per vehicle, never enforced client-side — the chain rules live in FL-4 only; the correction dialog sends only changed fields + version and NEVER sends `inReading: null` (the API reads that as reopening the period and refuses — the UI doesn't offer what the backend forbids). Maintenance (legacy `car_maintenance`): open/closed state filter, workshop/work-type names from the catalogs, check-in pre-trims in-workshop vehicles in the picker (server stays the FR-4 authority), check-out/reopen/edit/delete all version-aware behind their §7 permissions with reopen/delete confirms. Alarms board (legacy `cars_alarm`): the FR-3 projection rendered verbatim — client-side level filter + code search over the one live response, triage order red-first/most-overdue-first, "no baseline yet" stated plainly when no counting service exists. Shared pieces extracted: `VehicleSelect` (active registry, optional in-workshop exclusion), `CatalogSelect` (kind-scoped, keeps an inactive current value visible), `OptionalEmployeeField` (picked → resolved name + clear). Maintenance mutations invalidate maintenance + odometer + vehicles together because inWorkshop and alarm baselines are derived across them. Odometer + Maintenance links lit in the vehicle profile (shipped flags), three nav rows appended. Zero backend changes. |
| 2026-08-02 | 1.13 — FW-7 delivered: the daily roster planning screen over FL-5, the frontend a pure viewer/executor. The board arrives whole from `GET /fleet/roster` — scoped vehicles with the day's facts, the DERIVED in-maintenance flag, and the driver pool split by the availability seam with each refusal's named reason (the five seam verdicts translated, unknown reasons shown as sent) — nothing recomputed client-side. URL-synced date (prev/next day + date input) with client-side code/plate search over the one live response. Assign/edit opens one dialog per vehicle editing the COMPLETE desired state of (vehicle, date); driver slots offer ONLY the board's available pool (never a directory search), with each candidate's current assignment shown. Picking a driver held by another vehicle composes the releasing row into the SAME save — both sides of the move in one transaction, exactly the drag semantics FL-5 point 7 froze — with an explicit "will be moved off {code}" notice before saving; the server stays the FR-5/6/7 authority and a failed save invalidates the day (a 409 usually means the board went stale). The plan response IS the refreshed board, so the day cache is replaced in the same round-trip — no second fetch between save and repaint. Clearing is its own confirmed action (mission+drivers+notes → null; the audit trail keeps the history); an in-workshop vehicle offers clear but never assign (FR-5's exact asymmetry). Roster link lit in the vehicle profile (pre-filtered by the vehicle's code) and the nav row appended. Zero backend changes. |
| 2026-08-02 | 1.14 — FW-8 delivered: the accidents registry over FL-6, states and money exactly as the backend keeps them. URL-synced vehicle/status/date-range filters + sortable occurredAt + pagination in the module's list idiom. The form dialog (create/edit shared) asks for the entered facts only — the three amounts are stored typed and NOTHING is derived from them until §13-Q9 defines the formula, so the page sums nothing and the money renders via the platform's EGP formatter. The vehicle select offers the WHOLE registry (`VehicleSelect` gained an `anyStatus` prop): an accident is historical paperwork about the day it happened, so a disposed vehicle is a legal reference — §4.6's deliberate contrast with the odometer's refusal — and the code map uses the unfiltered registry so retired vehicles' files still resolve. Open/closed is purely the backend's state: the row offers exactly ONE direction (close on open files, reopen on closed — FR-10's single grant covers both), each flip a confirmed, version-aware call whose no-op form the server refuses; edits diff against the loaded document and send only changed fields + version; delete confirms with the audit-trail note. Every action behind its own §7 permission. Accidents link lit in the vehicle profile (pre-filtered `?vehicle=id`), nav row appended (shield). Zero backend changes. |
| 2026-08-02 | 1.15 — FW-9 delivered: violations + grievances over FL-6 with ZERO client-side money math. One screen, two URL-synced views. LIST: the rows in their two backend shapes side by side — a `vehicle` row shows year/count/unit value and the SERVER-computed amount (FR-9), a `driver` row shows date/driver (shared HR name cache) and the amount as entered — with kind/vehicle/year filters, sortable year/date, pagination. Recording is two dialogs matching the two POST endpoints: the vehicle statement sends count × unit value and NEVER an amount (the hint says the server computes it); the driver form records the entered amount and picks the person through the directory (the server enforces FR-11's profile requirement). Edit opens the dialog matching the row's own shape (cross-shape edits are refused server-side; the vehicle is identity and not editable), sending only changed fields + version. ROLLUP: `GET /violations/rollup` rendered verbatim — every per-(vehicle, year) figure including the grievance is server-assembled at query time; the year axis defaults to the current year and shares the URL param with the list's filter. The grievance dialog PUTs the ONE per-(vehicle, year) figure (H9's fate), prefilled from the rollup row, and the board repaints from the invalidated subtree — list and rollup invalidate together since both derive from the same rows. Violations link lit in the vehicle profile, nav row appended (tag). Zero backend changes. |
| 2026-08-02 | 1.16 — FW-10 delivered; **the Fleet module is COMPLETE (backend + web)**. Catalogs (`/fleet/catalogs`, `fleetCatalog.manage`): the six §2.10 kinds as URL-synced tabs over the live paginated list (kind/isActive filters, sortable name), create/edit dialogs with ARCHIVE-not-delete (history references items) and `countsForAlarm` offered only on workType, mirroring the schema's refinement. Settings (`/fleet/settings`, `fleetMaintenanceRule.manage`): section 1 is the vehicle-type table because the §2.2 interval ON the type IS the maintenance rule (create/edit version-aware, 0 shown as "no rule"); section 2 edits the five `FleetSettingKeys` through the PLATFORM's own settings surface — a new thin `platform/settings` web api (definitions / me-resolution / set) whose first consumer this screen is — values always the server's resolution (user → branch → organization → default), writes behind `setting.edit` at organization scope, NOTHING hardcoded client-side. Fleet-aware invalidation: type/workType writes touch the alarm projection (interval + baseline inputs) so they invalidate the odometer subtree; setting writes also invalidate roster (the HR-leave switch changes availability verdicts). Catalogs + Settings nav rows appended — the sidebar carries all twelve applications. Final integration review passed: 13 routes + 404 exactly matching the frozen IA, every §7 permission on its route, all five profile history links lit, zero placeholder/TODO surfaces, every page routed, every component consumed, one lazy fleet chunk, breadcrumbs on every subpage. Zero backend changes. |
| 2026-08-02 | 1.17 — Fleet Final Review (stabilization; no features). Seventeen-point pass over backend + web: dead-code sweep (removed the one unused web api function `getVehicleType`; made `fleetKeys` and `FleetSweepMarkModel` module-private — `fleetPermissions` stays exported for the permission-matrix test), i18n coverage proven complete both ways (every used key exists in en+ar including all dynamic families; no orphan keys), 25/25 icon actions carry aria-label+title, every DataTable has error+retry, every mutation flow shows its success toast over the global error toast, every editing dialog sends `version` (the roster's per-row server-side check stands per FL-5 point 4), URL-sync idiom on all ten list screens, one lazy chunk, the four vehicle-code registry maps share one cache entry (identical params), no dangerouslySetInnerHTML/storage-token/raw-URL patterns. Gates green (web+api tsc, lint, build, 57 web tests, 496 api unit tests; the 490 integration tests compile and run in CI — the sandbox still blocks the mongod download, documented since FL-2). The module is production-ready pending CI's integration run; remaining debt: none inside Fleet — FL-10 (legacy migration) is a separate future task gated on §13-Q13/Q14. |
| 2026-08-17 | 1.18 — **Catalogs & vehicles enhancement** (owner request; no structural change to any other entity). Three catalog kinds added to §2.10 — `licenseClass`, `operation`, `insuranceCompany` — reusing the existing generic catalog collection, service, routes and screen unchanged: the three tabs, the three selects and the three filters are all the SAME code the first six kinds already used, which is why the slice adds no catalog endpoint. §2.1 changed accordingly: `licenseClass` (free text) → `licenseClassId` (catalog ref, §13-Q7 answered as data), plus `operationId`, `insuranceCompanyId`, and `licenseImage` — the scanned licence, whose bytes live in platform Files under the `fleet-vehicle-documents` category (images only, 10 MB) and whose link lives on the vehicle. `branchId` is now REQUIRED: refused as `null` by the schema, proved live-and-active by the service, and `required` on the model so `create` itself cannot insert a branchless vehicle; the form preselects a branch resolved BY NAME from live branch data through the new `fleet.vehicle.defaultBranchName` setting (default «المهندسين») — never a baked-in id, which would differ per environment. Legacy data is migrated, not broken: `fleet.migration.ts` copies each distinct legacy `licenseClass` string into a catalog item and points the vehicle at it, keeps the old column untouched as the migration's own evidence, and REPORTS (never invents) vehicles predating the branch rule. The registry list now renders the frozen fourteen-column order with the licence-image cell (upload when absent, view + delete when present) and nine server-side filters — the four identifiers ANDed individually, the three catalog references, branch and type; a per-vehicle print view carries the record and, only when one exists, the licence image inlined. Authorization is unchanged and unextended: the image rides `fleetVehicle.view`/`.edit`, and a fleet ADR-023 file authorizer makes the platform's own file endpoints ask the same question. Two events added, both stable on arrival and published post-commit: `fleet.vehicleLicenseImage.uploaded/.deleted` — 24 fleet events in total. |
| 2026-08-22 | 1.19 — **Maintenance workshop entry/exit enhancement** (owner request, PR #282; no new entity, no new status, no new permission). The visit gains two fields (§2.6): `exitOdometer`, the counter the vehicle leaves on — **required at check-out**, `≥` the entry reading, and a **breaking change** to `POST /fleet/maintenance/:id/check-out` for external callers — and `sparePartIds`, catalog references replacing free text. The alarm baseline moves with it (§4.4/FR-3): a closed visit is measured from its exit reading, falling back to `odometerAtService` for visits closed before that reading existed, and an open visit is still never a baseline — one derived source, so the vehicle profile, the odometer register's since-service column, the alarms board and both sweeps all agree. Legacy free-text `spareParts` stays accepted and displayed, stored verbatim with no string→id conversion and no data migration. The screen gains server-side filtering across ten questions (check-in and check-out ranges, vehicle code by registry search, driver, workshop, work type, spare parts, notes, counter range, and the open/closed status), and shows the roster DRIVER for the check-in day beside the two CUSTODY employees — which the design had not previously distinguished (§4.2) — with custody resolved from the authenticated user rather than typed in. Visit lifecycle is unchanged: `open` ↔ `closed` remain the whole status, and the derived alarm level is documented as a vehicle property, not a visit status. |
| 2026-08-23 | 1.20 — **Workshop drivers recorded on the visit** (owner request; no new entity, no new permission). §2.6 gains `driverInEmployeeId` and `driverOutEmployeeId`: the driver is now chosen explicitly and **required** at check-in and again at check-out, and STORED — the duty roster is a plan that can be re-planned, which is a different claim from who actually brought the car in or drove it away, so the maintenance list stopped joining the roster for it. Both are breaking additions to `POST /fleet/maintenance` and `POST /fleet/maintenance/:id/check-out`. Reopen clears the exit driver with the rest of the exit; the driver filter matches EITHER end; visits predating the fields read `null` and are never back-filled by guessing. The custody pair stays exactly what it was — who PERFORMED the check-in and check-out, resolved from the login — and is documented as distinct from the drivers (§4.2), which is the confusion this slice removes. The maintenance grid is the eleven columns of §12 and nothing else: «اسم السائق» carries the two drivers stacked, entry above exit, and neither custody nor the exit reading appears in it. The exit reading keeps its role unchanged as the closed-visit alarm baseline (§4.4). Filters: one input per date and no counter filter. |
