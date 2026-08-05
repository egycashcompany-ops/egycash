# Attendance Module — Design (v1.0, FOR APPROVAL)

> Status: **draft, awaiting owner approval**. No implementation exists or may begin until §0 is
> settled and this document is marked frozen. HR order: Attendance → Payroll → Training →
> Performance → Medical → Termination.

Attendance answers one question per employee per day: **were they where they were meant to be, for
as long as they were meant to be?** Everything else here — devices, shifts, grace periods, overtime,
corrections — exists to make that answer defensible enough to pay someone from.

---

## 0. Decisions that need your approval

These are product decisions, not implementation details: each one changes the collections, the
events or the permissions. A default is proposed for every one so approval can be a yes/no rather
than an essay. **Nothing is written until you confirm or override these.**

| # | Question | Proposed default | Why, and what it costs to change later |
|---|---|---|---|
| **D1** | Where do punches come from? | **Device import + manual entry** in v1; a web/mobile self-punch behind a setting, default OFF | The record's provenance is stored per punch, so adding a source later is additive. Deciding *late* is cheap; deciding *wrong* is not — a self-punch without geofencing is an honesty system. |
| **D2** | How is "meant to be" defined? | **Shift templates** (start, end, break, grace) assigned to an employee, with an optional per-date override | Alternative — a fixed daily schedule on the employee — cannot express rotating security/driver shifts, and this company runs both. Templates subsume the simple case. |
| **D3** | Does a day belong to the calendar date of the **first punch** or of the **shift start**? | **Shift start** | A night shift crossing midnight is one working day, not two halves. This choice is baked into the day-record key and is expensive to reverse. |
| **D4** | Lateness | **Grace minutes per shift**, then late by exact minutes; **no tiers** in v1 | Tiers (5/15/30) are a payroll deduction policy, and Payroll is the module that should own money. Attendance records the minutes; Payroll decides what they cost. |
| **D5** | Overtime | **Recorded automatically, paid only after approval** | Recording without approving loses nothing and gives Payroll a truthful number. Auto-approving spends money without a decision. |
| **D6** | Missing checkout | Day closes as **`incomplete`**, never guessed | An assumed 8-hour day is an invented fact that reaches a payslip. `incomplete` is visible and correctable. |
| **D7** | Who fixes a wrong record? | The employee raises a **regularization request**; the manager approves; HR may edit directly with a mandatory reason | Mirrors the Leave request model exactly, so approvals and notifications reuse existing machinery. |
| **D8** | Punching at another branch | **Allowed and recorded** (`branchIdAtPunch`), flagged when it differs from the employee's branch | Cash-transport and fleet staff genuinely move. Blocking it would make the honest case impossible; flagging it makes the dishonest case visible. |
| **D9** | Raw device events | Kept **immutable and forever**; derived day records are recomputable from them | The raw event is the evidence. Retention policy can be added later; deleting evidence cannot be undone. |
| **D10** | What does Payroll read? | **Frozen daily rows**: worked minutes, late minutes, early-leave minutes, absence with its leave classification, approved overtime | Same shape as Leave's `paidBreakdown` — one uniform dated feed, no config re-derivation downstream. |
| **D11** | Ramadan / seasonal hours | **Deferred** to a dated shift-template variant, not in v1 | Recognised, deliberately postponed. Flagged so it is not "discovered" mid-Payroll. |

**If you accept all eleven, say so and I will freeze this document and start AT-1.** Override any
of them and I will revise before freezing.

---

## 1. Boundary & integration

Placement: `apps/api/src/modules/hr/attendance/` (features behind ADR-003 barrels: `shifts`,
`punches`, `day-records`, `regularizations`, `overtime`). Web:
`apps/web/src/modules/hr/attendance/`.

Dependency direction: `attendance → employee-management → recruitment → platform` (acyclic).
`work-calendar` is consumed as the **sibling shared feature it was deliberately built to be** —
Leave's design §1 placed it outside leave-management for exactly this reason. Not one line of it
changes.

Integration points — **exhaustive list**:

1. **Reads** employee facts: `employment.branchId`, `departmentId`, `managerId`, `status`, hiring
   date, employment periods. No writes to any employee field, ever.
2. **Reads** `work-calendar`: `weekendDays()` and `listHolidays(from,to)` — a weekend or a holiday
   is not an absence. Used as-is; no new methods required.
3. **Reads** the Cairo date rule from `hr/shared/business-date` (`cairoToday`, `toDateOnly`,
   `dateOnlyIso`, `isoWeekday`, `addDays`). Attendance introduces **no second notion of "today"**.
4. **Subscribes** to `hr.leave.started` / `hr.leave.ended`: a day covered by approved leave is
   classified `onLeave`, never `absent`. This is the contract Leave's §15 already published.
5. **Subscribes** to `hr.employee.exited`: stop expecting attendance from the exit date; close any
   open shift.
6. **Timeline**: the employee profile timeline gains attendance rows via the same dynamic `import()`
   escape hatch the employee-file and leave sources use (BD-007 graceful degradation when absent).
7. Consumes Files (device import artefacts), Notifications, Audit, Settings, Scheduler.

**Explicit non-overlap with Fleet.** Fleet's `availability` feature (التمامات) records *operational*
driver unavailability for duty rostering. Attendance records *presence at work*. They answer
different questions for different readers and must not be merged; Attendance does not read or write
fleet collections, and Fleet keeps its own screens. Where a driver is absent, both facts exist
independently and legitimately — the HR record for pay, the fleet record for dispatch. **This is
called out because it is the single most likely place for someone to later build a duplicate.**

---

## 2. Domain model

Five concepts, in dependency order:

- **Shift** — a named pattern: `startTime`, `endTime`, `crossesMidnight`, `breakMinutes`,
  `graceInMinutes`, `graceOutMinutes`, `minMinutesForFullDay`, `minMinutesForHalfDay`. A catalog,
  admin-managed and seeded, exactly like leave types.
- **Shift assignment** — which shift an employee works, from a date, optionally to a date. The open
  interval is the current assignment. Per-date overrides live here too (one-day swaps).
- **Punch** — one raw event: `employeeId`, `at` (instant), `direction` (`in` | `out` | `unknown`),
  `source` (`device` | `manual` | `web`), `deviceId`, `branchIdAtPunch`, `importBatchId`,
  `recordedBy`. **Immutable.** A wrong punch is superseded, never edited.
- **Day record** — the derived answer for one employee on one *work date* (D3: keyed by shift
  start). Holds the resolved shift, first in, last out, worked minutes, late minutes, early-leave
  minutes, overtime minutes, and a `status`. **Recomputable at any time from punches + calendar +
  leave**; never the primary evidence.
- **Regularization** — a request to change a day record, with the same lifecycle as a leave request.

### Day record status

`present` · `late` · `earlyLeave` · `lateAndEarly` · `absent` · `onLeave` · `weekend` · `holiday` ·
`incomplete` (D6) · `dayOff` (rostered off).

One enum, one value per day — the same discipline as the recruitment stage status (I10). There is no
parallel set of booleans.

---

## 3. Data model

Five new collections. **Zero changes to any existing collection.**

| Collection | Key fields | Indexes |
|---|---|---|
| `hr_shifts` | `code` (unique), `name{ar,en}`, times, grace, thresholds, `active` | `code` unique; `active` |
| `hr_shift_assignments` | `employeeId`, `shiftId`, `fromDate`, `toDate\|null`, `branchId` | `{employeeId, fromDate}`; partial unique on open interval |
| `hr_attendance_punches` | `employeeId`, `at`, `direction`, `source`, `deviceId`, `branchIdAtPunch`, `importBatchId`, `supersededBy\|null` | `{employeeId, at}`; `{importBatchId}`; unique `{deviceId, at, employeeId}` for import idempotency |
| `hr_attendance_days` | `employeeId`, `workDate`, `shiftId`, `status`, minutes fields, `branchId`, `computedAt`, `frozenAt\|null` | **unique `{employeeId, workDate}`**; `{workDate, branchId}`; `{status}` |
| `hr_attendance_regularizations` | `employeeId`, `workDate`, requested values, `reason`, `status`, approver fields | `{employeeId, workDate}`; `{status}` |

`branchId` is the ADR-015 data-scope field on every collection that carries one, denormalized from
the employee at write time — the same discipline every HR collection already follows.

The unique `{employeeId, workDate}` index is what makes recomputation safe: the engine upserts,
so running it twice cannot produce two answers for one day.

---

## 4. The derivation engine

The heart of the module, and the only place that decides anything.

```
inputs:  punches(employee, window) + shift assignment + work calendar + approved leave + employee status
output:  exactly one hr_attendance_days row per employee per work date
```

Order of resolution (first match wins — the sequence is the specification):

1. Employee not employed on that date → **no row**.
2. Approved leave covers the date → `onLeave` (half-day leave keeps the worked half).
3. Public holiday → `holiday`.
4. Weekend per `work-calendar` → `weekend`.
5. No shift assignment → `dayOff`.
6. No punches → `absent`.
7. Punch in but no punch out → `incomplete` (D6).
8. Otherwise compute minutes and classify `present` / `late` / `earlyLeave` / `lateAndEarly`.

Properties the implementation must hold, each of which becomes a test:

- **Idempotent** — recomputing a day yields byte-identical output.
- **Order-independent** — punches arriving out of order produce the same result.
- **Frozen days are never recomputed.** Once Payroll freezes a period (`frozenAt`), the engine
  refuses to overwrite; a correction after freeze is a regularization that Payroll sees as an
  adjustment. This is the single most important guard in the module — without it, a late punch
  import silently changes a paid month.
- **Leave wins over absence.** A day cannot be both.

---

## 5. API contracts

Mounted under `/api/v1/hr`. No new platform endpoints.

| Method | Path | Grant |
|---|---|---|
| GET/POST/PATCH/DELETE | `/attendance/shifts` | `attendance.shifts.*` |
| GET/POST/DELETE | `/attendance/assignments` | `attendance.assign` |
| POST | `/attendance/punches` | `attendance.punch.record` |
| POST | `/attendance/punches/import` | `attendance.punch.import` |
| GET | `/attendance/punches` | `attendance.view` |
| GET | `/attendance/days` (range, filters) | `attendance.view` |
| GET | `/attendance/days/me` | own scope, ESS |
| POST | `/attendance/days/recompute` | `attendance.recompute` |
| POST | `/attendance/regularizations` | own scope |
| POST | `/attendance/regularizations/:id/decide` | `attendance.regularize.decide` |
| POST | `/attendance/overtime/:id/approve` | `attendance.overtime.approve` |
| GET | `/attendance/export` | `attendance.export` |

Every mutation returns the updated aggregate; list endpoints follow the standard `Paginated`
envelope. Zod at every boundary, types inferred not duplicated.

---

## 6. Permissions

`attendance.view` · `attendance.viewAll` · `attendance.shifts.manage` · `attendance.assign` ·
`attendance.punch.record` · `attendance.punch.import` · `attendance.recompute` ·
`attendance.regularize.request` (ESS) · `attendance.regularize.decide` ·
`attendance.overtime.approve` · `attendance.export`

Scoping follows ADR-004/ADR-015 unchanged: `own` → the employee's own rows via the `ownerUserField`
seam Leave already established; `branch` → `branchId`; `organization` → everything. The ESS role
gains `attendance.view` (own) and `attendance.regularize.request`.

---

## 7. Workflow — regularization

`draft` → **`pending`** → `approved` | `rejected` | `cancelled`

Same shape as a leave request, deliberately: the manager relationship, the approval authorization
and the notification templates are already built and tested. Approval applies the change and
triggers a recompute of that one day; rejection leaves the record untouched with the reason stored.
A regularization on a **frozen** day is accepted but marked `postFreeze` so Payroll treats it as an
adjustment to the next period rather than a silent restatement of a paid one.

---

## 8. Events

Published: `hr.attendance.punchRecorded` · `.punchesImported` · `.dayComputed` · `.dayAbsent` ·
`.regularizationRequested` · `.regularizationDecided` · `.overtimeApproved` · `.periodFrozen`

Subscribed: `hr.leave.started` · `hr.leave.ended` · `hr.employee.exited`

Names follow the existing convention and are auto-catalogued.

---

## 9. Notifications · audit · settings · scheduler

- **Notifications** (5): absence recorded · missing checkout · regularization submitted /
  decided · overtime approved.
- **Audit**: every mutation. Punch import records the batch, the file and the row counts.
- **Settings** (4): `attendance.autoComputeHour` · `attendance.absenceNotify` ·
  `attendance.selfPunchEnabled` (D1, default `false`) · `attendance.overtimeRequiresApproval`
  (D5, default `true`).
- **Scheduler** (3, all idempotent via the unique day key): nightly compute for the previous day ·
  missing-checkout sweep · absence notification sweep.

---

## 10. UI

Five screens, all reusing the existing kit — `DataTable`, `FilterBar`, `MultiSelect`, the shared
`ApplicantPicker` pattern for employee search, `PageHeader`:

1. **Daily sheet** — one branch/department, one date, every employee, colour-coded status.
2. **Employee month** — a calendar grid with the day statuses; the ESS view of one's own month.
3. **Shifts catalog** + assignment screen.
4. **Regularization queue** — the manager's inbox, same shape as the leave approvals queue.
5. **Attendance tab on the employee profile** — alongside the existing Leave tab.

---

## 11. ADRs to record with the implementation

- **ADR-020 — Attendance day records are derived, punches are the record of truth.** Consequence:
  any bug is fixed by correcting inputs and recomputing, never by editing a derived row.
- **ADR-021 — A frozen period is immutable to recomputation.** Consequence: Payroll can trust a
  paid month; corrections flow forward as adjustments.

---

## 12. Migration & rollout

Purely additive, boot-time, idempotent: create the five collections and their indexes, seed a
default `GENERAL` shift (09:00–17:00, 30-minute grace), register permissions, settings, scheduler
tasks and the nav entry. No backfill of historical attendance — the module starts from its
go-live date, and that date is recorded so reports never imply data that was never captured.

---

## 13. Risks (accepted, to be mitigated in implementation)

| Risk | Mitigation |
|---|---|
| Device clock drift produces impossible punches | Import validates against a configurable window; out-of-range rows are quarantined in the batch, not silently dropped |
| A late import rewrites a paid month | The freeze guard (§4) refuses; the correction becomes a `postFreeze` adjustment |
| Duplicate punches from a double swipe | Unique `{deviceId, at, employeeId}` + a de-duplication window |
| Someone rebuilds this in Fleet | §1's non-overlap statement, and the shared-source guard pattern already used for the branch filter and the applicant picker |

---

## 14. Deliberate deferrals

Ramadan/seasonal variants (D11) · geofenced mobile punching · biometric enrolment management ·
shift-swap marketplace between employees · attendance-based automatic disciplinary actions.

Each is recognised, none is half-built.

---

## 15. Future-module compatibility

**Payroll** (next in the HR order) reads frozen daily rows through one dated feed — worked, late,
early-leave, absence-with-classification, approved overtime — matching the shape Leave already
publishes, so Payroll integrates one reader for both. **Performance** reads read-only aggregates.
**ESS/Mobile**: the own-scope endpoints are the contract. **Workflow Engine (ADR-011)**: the
regularization approval chain lifts onto definitions as data, exactly as Leave's does.

---

## Review trail

v1.0 — initial draft for owner review. §0 carries eleven open decisions; the document is **not
frozen** and no implementation may start until they are settled.
