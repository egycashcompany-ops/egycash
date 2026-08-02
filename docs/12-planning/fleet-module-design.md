# Fleet Module — design from the legacy system

**Status:** DRAFT — legacy extraction done; awaiting the owner's walkthrough + answers to §6 ·
**Source:** `egycashcompany-ops/fleet` @ `44654cd` (Express 4 + EJS + Mongoose 6, one 6,144-line
`contad_app.js`) · **Scope:** the 11 Fleet pages only — OPS (`tashghela`, `mohsana`, ATM, vault,
IT) is explicitly out of scope for this module and appears here only where Fleet touches it.

Everything in §2–§4 was read from the legacy code, not assumed. §5 classifies what carries over
verbatim, what gets replaced by platform services ECMS already has, and §6 lists the calls only
the owner can make.

---

## 1. What the legacy system is

A single Express app serving Fleet + OPS + ATM + vault + IT from one file. Views are EJS with the
business logic split roughly 80/20 between route handlers and inline `<% %>` blocks (the
maintenance-alarm math lives **in the view**, `cars_log.ejs:664-687`). Mongo collections are
shared with the OPS half — `emp` is a full mirror of HR employee data, maintained by hand from
this app's own `add_emp`/`hr_data_edit` pages.

Session auth is a hardcoded single-user check (`EventUserStatus.find({status:1, user:"pola"})` on
every route). Auditing is `added_by`/`deleted_by`/`deleted_date` string fields per row, with one
collection (`fleet_accident`) growing parallel `edited_by[]`/`edited_date[]` arrays. All numeric
data (odometers, money) is stored as strings and coerced at query time.

None of that carries over — §5.2. What carries over is the **domain model**, which is genuinely
good: nine entities with clear lifecycles and one clever odometer design.

## 2. The entities

| Legacy collection | Entity | Business key | Notes |
|---|---|---|---|
| `cars` | **Vehicle** | `car_code` | type, plate, chassis, motor, joining/`expiry_date` (license), `licens` (license class/state — values unclear, §6-Q8), branch, department, **ISSI + Motorola SN** (radio gear — a cash-transport security fact, not an accessory) |
| `cars_log` | **Odometer entry** | (vehicle, date) | `out_num` / `in_num` / `km` + driver(s). See §3.1 — the reading model is the subtlest thing in the system |
| `car_maintenance` | **Workshop visit** | — | `in_date` → `out_date` lifecycle; destination (workshop), works (type; the value `صيانة` is what the alarm counts from), spare_parts[], `counter` (odometer at service), who took it in / who took it out |
| `data_lists.carTypes` + alarms | **Maintenance rule** | vehicle **type** | interval km per type (`fm_car_maint`) + **global** yellow/red thresholds |
| `car_lock` | **Daily duty assignment** | (vehicle, date) | mission type (from catalog; default `نقل أموال (يومي)`), driver1, driver2, notes; upserted per day |
| `absence` (dept `الحركة`) | **Driver unavailability** | — | from–to + reason; "التمامات" page |
| `fleet_accident` | **Accident** | — | date, vehicle, culprit, statement, company cost, amount collected, paid, open/closed (stored as a **color**) |
| `car_violations` | **Violation** | — | ONE collection, TWO shapes: per-vehicle bulk rows (year, count × unit value, `total_before_grievance`) and per-driver event rows (`ح` seatbelt / `ت` phone, date, amount). §3.4 |
| `emp` (title ~ `سائق`) | **Driver** | `employee_id` | HR mirror + fleet-specific fields the fleet pages edit directly: license no./expiry, `specialization` (نقل أموال vs ATM), phone, branch |

Catalogs (`data_lists`): workshops (`fleet_destinations`), work types (`fleet_works`), spare
parts, mission types (`fleet_ops_tybe`) — all admin-appendable from `fleet_data_edit`.

## 3. The four pieces of real logic

### 3.1 One odometer reading closes the previous period and opens the next

`POST /cars_log` (`contad_app.js:3240`): the submitted reading becomes the **new** entry's
`out_num`, and the **same value** is written into the previous entry's `in_num`, with `km`
computed as the difference. The odometer is treated as the continuous, authoritative sequence it
physically is — periods cannot overlap or gap, because one reading is simultaneously "the car
came back at X" and "the car left at X".

This is the best design decision in the legacy system and ECMS should keep it, upgraded: derive
`km` server-side (legacy trusts a client-computed `kelo`) and **refuse a reading lower than the
previous one** (legacy accepts it silently, corrupting every downstream alarm).

### 3.2 The maintenance alarm is derived, never stored

For each vehicle's **latest** odometer entry only (`cars_log.ejs:664`):

```
sinceService  = current out_num − counter of the latest works="صيانة" visit
remaining     = interval(vehicle TYPE) − sinceService
remaining ≤ red_alarm    → red cell
remaining ≤ yellow_alarm → yellow cell
```

Guards: only if the entry's date is after the last service date, and only on the newest row per
vehicle. Interval is per **type**; yellow/red are **global**. `cars_alarm` (the settings page)
also self-heals: it syncs the per-type rule list from the distinct types actually present in the
vehicle registry — add a type, its rule row appears; retire a type, its rule disappears.

ECMS keeps derivation (a stored "due" flag would go stale the moment anyone backfills a reading)
but computes it server-side, and the platform scheduler can additionally *notify* on threshold
crossings instead of relying on someone opening the page.

### 3.3 The assignment board is availability minus commitments

`GET /taeen_drivers` defaults to **tomorrow** (it is a planning page, not a diary) and builds, in
order:

1. vehicles of one branch (hardcoded `المهندسين` — §6-Q4);
2. minus vehicles with an **open workshop visit** covering that date (they render flagged, and the
   client forces their status to `صيانة`);
3. drivers = active employees of dept `الحركة` with title ~ `سائق`, minus those with an
   **unavailability record** covering the date, minus those **already assigned** to another
   vehicle that day;
4. each vehicle row gets mission type + up to two drivers; save **upserts per (vehicle, date)**, so
   re-planning the same day edits in place and never duplicates.

Real rules preserved: one driver → one vehicle per day; absent ⇒ unassignable; in-workshop ⇒
unassignable; per-day idempotent upsert. (A per-user department filter is persisted in its own
collection — that's UI preference state, ECMS handles it client-side.)

### 3.4 Violations are two shapes with one annual rollup

- **Vehicle violations** are entered in **bulk per year** — count × unit value per violation type,
  matching how radar statements actually arrive from the authority — with a separate
  `total_before_grievance`, because a تظلم (grievance) reduces the payable amount and the page
  reports both.
- **Driver violations** are per-event: date, driver, type (`حزام`/`تليفون`), amount.
- The page aggregates both **per vehicle per year** and merges them into a combined total
  (count + amounts, before/after grievance).

Both entry modes are real workflow, not accident — the bulk mode mirrors the paper statement,
the per-event mode assigns personal responsibility. Keep both (§6-Q5 confirms).

### 3.5 Everything else per page

| Legacy page | Behaviour found |
|---|---|
| `/fleet` | registry CRUD (soft delete), filter values derived from live data, license-expiry column with month filter |
| `/one_car` | read-only join of registry + odometer history + workshop history for one `car_code` (accidents/violations **not** shown — gap worth closing) |
| `/drivers` | HR-mirror list filtered by title; **edits license/phone/branch/specialization directly on the HR record** (§6-Q2) |
| `/fleet_attendance` | unavailability CRUD (from–to, reason), dept hardcoded `الحركة` |
| `/cars_maintenance` | two queues: in workshop (`out_date:null`) and history; check-in → (edit \| check-out \| reopen \| soft-delete) via magic form codes 0–5 |
| `/fleet_accident` | CRUD + status toggle; sorted open-first; the "who reported" list comes from dept `الحركة`/`التشغيل` |
| `/fleet_data_edit` | append-only catalog editor (dupes rejected, no rename/delete) |

## 4. Where Fleet touches everything else (dependency map)

```
HR (built)          → drivers ARE employees (dept/title); unavailability ≈ leave (§6-Q1)
Organization (built)→ branch/department on vehicles replace free-text strings
Platform (built)    → auth/RBAC+data scopes, audit, files (photos, licenses, accident docs),
                      notifications, settings, sequences, scheduler (expiry + alarm sweeps)
Automation (built)  → fleet.* events become n8n-automatable for free (license-expiry reminders,
                      red-alarm escalation) once the module publishes them
OPS (future)        → consumes the daily assignment (mission type on car_lock is the OPS work
                      order type); Accounting (future) ← violation/accident amounts
```

Fleet has **no dependency on any unbuilt module** — it needs HR + platform only, both live. It is
buildable now, and it unblocks OPS later (OPS's `tashghela` references cars + assignments).

## 5. Classification

### 5.1 Real rules — carried over

Odometer continuity + monotonic guard; derived alarm (interval per type, global thresholds,
self-healing rule list); workshop visit lifecycle with in/out custody; open visit ⇒ unassignable;
absent/double-booked driver ⇒ unassignable; per-(vehicle, date) upsert planning with tomorrow
default; two violation entry modes + grievance + annual rollup; accident cost/collection/paid
tracking with open/closed state; radio equipment (ISSI/SN) on the vehicle; license expiry
tracking on both vehicle and driver; driver specialization (cash vs ATM); soft delete everywhere.

### 5.2 Legacy workarounds — replaced by platform, not ported

Hardcoded `user:"pola"` session check → auth/RBAC. `emp` HR mirror + `add_emp` pages → the real
HR module (BIGGEST correction: fleet stops owning people). Free-text branch/department + hardcoded
`المهندسين`/`الحركة` → organization units + data scopes. `added_by`/`edited_by[]` columns → audit
service. Status-as-color (`finsh_status_color`) → status enum. Numbers-as-strings → typed schema.
Magic `deleted_dock` codes 0–5 → named endpoints. Per-user filter collection → client state.
Unicode direction-mark scrubbing at read time → normalize at write time. Client-computed `km` →
server-derived.

### 5.3 Page plan (ECMS)

| # | ECMS page | Replaces | Notes |
|---|---|---|---|
| 1 | `/fleet` (module home) | — | ECMS pattern; alarm/expiry/open-visit KPIs |
| 2 | `/fleet/vehicles` | `/fleet` | registry list + create |
| 3 | `/fleet/vehicles/:id` | `/one_car` | profile hub: details, odometer, maintenance, **+ accidents, violations, assignments** (tabs) |
| 4 | `/fleet/drivers` | `/drivers` | HR-sourced list + fleet-owned driver profile (§6-Q2) |
| 5 | `/fleet/availability` | `/fleet_attendance` | unavailability CRUD (§6-Q1 decides the engine) |
| 6 | `/fleet/odometer` | `/cars_log` | daily log + derived alarm column |
| 7 | `/fleet/maintenance` | `/cars_maintenance` | open-visits queue + history |
| 8 | `/fleet/maintenance-rules` | `/cars_alarm` | per-type interval + thresholds |
| 9 | `/fleet/roster` | `/taeen_drivers` | daily assignment board, date-navigable |
| 10 | `/fleet/accidents` | `/fleet_accident` | CRUD + open/closed |
| 11 | `/fleet/violations` | `/car_violations` | vehicle tab (bulk/year) + driver tab (event) + annual rollup |
| 12 | `/fleet/settings` | `/fleet_data_edit` | catalogs (workshops, works, spare parts, mission types) |

Eleven legacy pages → 12 ECMS pages (the module home is additive; `one_car` absorbs three
histories it didn't show).

## 6. Questions only the owner can answer

1. **التمامات vs الإجازات.** Legacy tracks driver absence separately from any leave system. ECMS
   has a full leave module. Should fleet **read** HR leave (absence there ⇒ unavailable here) and
   add only an operational overlay (e.g. مأمورية/عهدة خارجية), or stay a fully separate record?
   Recommendation: read leave + thin overlay — one source of truth for "why is he not here".
2. **Who owns the driving license?** Legacy edits license no./expiry/phone on the HR record from
   the fleet page. Recommendation: fleet owns a **Driver Profile** (license, specialization,
   area) keyed by employeeId; personal fields (phone) stay HR-owned and fleet links to them. OK?
3. **Assignment ↔ OPS boundary.** The mission type on the daily assignment is where OPS will
   later attach work orders. Confirm: fleet owns "which car + which drivers + which mission type
   per day", OPS (later) owns what the mission actually did?
4. **`المهندسين` hardcode.** Is "only this branch's cars are assignable" a business rule or just
   where the fleet happened to live? Recommendation: the roster is branch-scoped by the user's
   data scope, no hardcode.
5. **Violations:** keep both entry modes (bulk-per-year for vehicles, per-event for drivers)? Does
   a driver violation deduct from payroll (future hook) or is it record-keeping only?
6. **Vehicle lifecycle end-states.** Legacy has only `deleted`. What are the real states — active,
   out of service, sold, scrapped? Does a car ever transfer branches (and does its code change)?
7. **`licens` field values** on the vehicle — license class? renewal state? Send 2–3 example
   values from real data.
8. **Odometer corrections.** When a wrong reading is discovered late, who may correct it and does
   the correction need approval? (Affects whether the monotonic guard is hard or overridable.)
9. **Accident amounts** (`company_account`, `amount_collected`) — exact meaning of each, and does
   "paid" mean paid by the culprit, insurance, or the company?
10. **Two drivers** on odometer/assignment rows — is driver2 a codriver/guard, or a mid-day
    handover? (Affects whether an assignment row can change drivers mid-day.)

## 7. Review trail

| Date | Revision |
|---|---|
| 2026-08-02 | 0.1 — full legacy extraction (routes 2444–6144, all fleet models, view-embedded alarm math); entity model, four core logic pieces, workaround classification, 12-page plan, 10 owner questions. NOT frozen — awaiting owner walkthrough. |
