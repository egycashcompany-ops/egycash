# Attendance Module — Design (v1.1, DECISIONS SETTLED — awaiting freeze)

> Status: **§0 decisions D1–D11 approved by the owner on 2026-08-12**, together with the two
> Payroll-boundary decisions taken in P-HR-01: **D-PR-01** (conventions: ADR numbering,
> two-segment permission keys, `hr.attendance.*` setting keys) and **D-PR-07 Option A** (the
> Payroll Run owns the freeze trigger). This revision folds those rulings in; **no implementation
> exists or may begin until the owner approves this revision and the document is marked frozen.**
> HR order: Attendance → Payroll → Training → Performance → Medical → Termination.

Attendance answers one question per employee per day: **were they where they were meant to be, for
as long as they were meant to be?** Everything else here — devices, shifts, grace periods, overtime,
corrections — exists to make that answer defensible enough to pay someone from.

---

## 0. Decisions — SETTLED (owner rulings, 2026-08-12)

These are product decisions, not implementation details: each one changes the collections, the
events or the permissions. **All eleven were ruled on by the owner in P-HR-01.** Three carry
refinements beyond the original proposal (D6, D7, D10 — marked below); the rest were approved as
proposed. The rulings in this table are binding on the implementation.

| # | Question | Owner ruling | Why, and what it costs to change later |
|---|---|---|---|
| **D1** | Where do punches come from? | **APPROVED — device import + manual entry** in v1; a web self-punch exists behind `hr.attendance.selfPunchEnabled`, default OFF. Every punch carries its `source`. | The record's provenance is stored per punch, so adding a source later is additive. Deciding *late* is cheap; deciding *wrong* is not — a self-punch without geofencing is an honesty system. |
| **D2** | How is "meant to be" defined? | **APPROVED — shift templates** (start, end, break, grace) assigned to an employee over dated intervals (`fromDate → toDate\|null`), with a per-date override | Alternative — a fixed daily schedule on the employee — cannot express rotating security/driver shifts, and this company runs both. Templates subsume the simple case. |
| **D3** | Does a day belong to the calendar date of the **first punch** or of the **shift start**? | **APPROVED — shift start.** A shift starting 31 July 22:00 and ending 1 August 06:00 is one working day owned entirely by 31 July — and therefore by July's payroll period. | A night shift crossing midnight is one working day, not two halves. This choice is baked into the day-record key and is expensive to reverse. |
| **D4** | Lateness | **APPROVED — grace minutes per shift, then raw late minutes only.** No tiers and no monetary deduction logic inside Attendance, ever. | Tiers (5/15/30) are a payroll deduction policy, and Payroll is the module that should own money. Attendance records the minutes; Payroll decides what they cost. |
| **D5** | Overtime | **APPROVED — derived automatically from punches, paid only after approval.** Attendance owns the quantity and its approval; Payroll owns the price and the multipliers. | Recording without approving loses nothing and gives Payroll a truthful number. Auto-approving spends money without a decision. |
| **D6** | Missing checkout | **APPROVED, with a refinement:** the day closes as **`incomplete`**, never guessed — and an `incomplete` day inside a period being calculated **blocks that employee's payroll calculation** until a proper regularization resolves it (see §4). | An assumed 8-hour day is an invented fact that reaches a payslip. `incomplete` is visible and correctable — and it must never be silently priced. |
| **D7** | Who fixes a wrong record? | **APPROVED, with a refinement: two approval steps, not one.** A regularization goes request → **manager approval → HR approval**, mirroring the Leave chain (`pendingManager → pendingHr`) exactly — not manager-only. HR may still edit directly with a mandatory reason. Post-freeze corrections are `postFreeze` adjustments only — never a restatement (see §7). | Mirrors the Leave request model exactly, so approvals and notifications reuse existing machinery. |
| **D8** | Punching at another branch | **APPROVED — allowed and recorded** (`branchIdAtPunch`), flagged when it differs from the employee's branch. Payroll and any GL split use the **employee's** branch per ADR-015, never the punch's. | Cash-transport and fleet staff genuinely move. Blocking it would make the honest case impossible; flagging it makes the dishonest case visible. |
| **D9** | Raw device events | **APPROVED — immutable, kept forever.** No edit, no delete; a wrong punch is superseded via `supersededBy` with the original retained as evidence. Derived day records are recomputable from them. | The raw event is the evidence. Retention policy can be added later; deleting evidence cannot be undone. |
| **D10** | What does Payroll read? | **APPROVED, with the contract made explicit:** frozen daily rows are the **only** interface — Payroll never re-derives attendance from punches. The formal per-row contract is §15.1. | Same shape as Leave's `paidBreakdown` — one uniform dated feed, no config re-derivation downstream. |
| **D11** | Ramadan / seasonal hours | **APPROVED — deferred.** When built, seasonal hours arrive as **dated shift-template variants** — never as Payroll pricing rules — so the derived quantities change at the source and the money side stays untouched. | Recognised, deliberately postponed. Flagged so it is not "discovered" mid-Payroll. |

Two boundary decisions taken alongside §0 in P-HR-01 are folded into this revision:

- **D-PR-01 (conventions).** ADR numbers move to the next free sequence (§11); permission keys
  follow the platform's two-segment `resource.action` generator (§6); setting keys follow
  `hr.attendance.*` (§9).
- **D-PR-07 Option A (freeze ownership).** The **Payroll Run owns the freeze trigger**: its
  transition to `calculating` invokes the attendance freeze internally. No standalone admin
  freeze endpoint in v1, and **no unfreeze at all** (§4).

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
| `hr_attendance_days` | `employeeId`, `workDate`, `shiftId`, `status`, minutes fields (`worked`, `late`, `earlyLeave`, `overtime`, `approvedOvertime`), `leaveId\|null`, `flags`, `branchId`, `computedAt`, `frozenAt\|null` | **unique `{employeeId, workDate}`**; `{workDate, branchId}`; `{status}` |
| `hr_attendance_regularizations` | `employeeId`, `workDate`, requested values, `reason`, `status`, approver fields | `{employeeId, workDate}`; `{status}` |

`branchId` is the ADR-015 data-scope field on every collection that carries one, denormalized from
the employee at write time — the same discipline every HR collection already follows. Per **D8**,
this is the **employee's** branch: `branchIdAtPunch` lives on the punch as evidence, and Payroll
and any GL split read the day record's `branchId`, never the punch's.

On the day record: `leaveId` links the covering leave request when `status = onLeave` (the paid
classification itself stays in Leave's `paidBreakdown` — it is not copied here); `overtimeMinutes`
is what the engine derived, `approvedOvertimeMinutes` is what the D5 approval released (always
≤ derived), and only the approved number ever reaches the feed; `flags` is a closed vocabulary
(initially `crossBranchPunch`, `manualPunch`) extended only by contract change.

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
- **Frozen days are never recomputed.** Once a period is frozen (`frozenAt`), the engine refuses
  to overwrite; a correction after freeze is a regularization that Payroll sees as an adjustment.
  This is the single most important guard in the module — without it, a late punch import
  silently changes a paid month.
- **Leave wins over absence.** A day cannot be both.

### Freeze ownership (D-PR-07, Option A — owner-approved)

**The Payroll Run owns the freeze trigger.** When a run transitions to `calculating`, it invokes
`freezePeriod(period)` on the attendance service **internally** — both are features of the `hr`
module, so this is an in-process service call, not an HTTP hop. Consequences, each deliberate:

- **No standalone admin freeze endpoint in v1.** A frozen period with no run, or a run over a
  fluid period, are both states that cannot be reached — the freeze and the calculation are one
  decision, guarded by one permission (the run's `calculate` grant).
- **No unfreeze, at all.** Unfreezing is a restatement wearing a different name. Corrections
  after a freeze go through the `postFreeze` regularization path (§7) and surface in Payroll as
  forward adjustments — never by re-opening the frozen rows.
- `hr.attendance.periodFrozen` is published on every freeze (§8), so downstream readers learn the
  boundary moved without polling.

### The `incomplete` rule at calculation time (D6 refinement — owner-approved)

An `incomplete` day is visible and correctable — and it is also **non-priceable**. If a period
being calculated still contains an `incomplete` day for an employee, Payroll **blocks that
employee's calculation** and reports the day in the run's errors, rather than guessing a worked
day or assuming an absence. The unblock path is a proper regularization (§7); nothing else
converts `incomplete` into money.

---

## 5. API contracts

Mounted under `/api/v1/hr`. No new platform endpoints.

| Method | Path | Grant |
|---|---|---|
| GET/POST/PATCH/DELETE | `/attendance/shifts` | `attendance.manageShifts` |
| GET/POST/DELETE | `/attendance/assignments` | `attendance.assign` |
| POST | `/attendance/punches` | `attendance.recordPunch` |
| POST | `/attendance/punches/import` | `attendance.importPunches` |
| GET | `/attendance/punches` | `attendance.view` |
| GET | `/attendance/days` (range, filters) | `attendance.view` |
| GET | `/attendance/days/me` | own scope, ESS |
| POST | `/attendance/days/recompute` | `attendance.recompute` |
| POST | `/attendance/regularizations` | own scope (`attendance.requestRegularization`) |
| POST | `/attendance/regularizations/:id/decide` | manager by relationship (step 1) / `attendance.decideRegularization` (step 2, HR) |
| POST | `/attendance/overtime/:id/approve` | `attendance.approveOvertime` |
| GET | `/attendance/export` | `attendance.export` |

There is deliberately **no freeze endpoint** in this table: the freeze is invoked internally by
the Payroll Run (§4, D-PR-07 Option A), so it carries the run's own grant rather than one of its
own.

Every mutation returns the updated aggregate; list endpoints follow the standard `Paginated`
envelope. Zod at every boundary, types inferred not duplicated.

---

## 6. Permissions

Keys follow the platform's two-segment `resource.action` generator (D-PR-01) — the same
`declarePermissions('hr', 'attendance', …)` recipe every HR resource already uses:

`attendance.view` · `attendance.manageShifts` · `attendance.assign` · `attendance.recordPunch` ·
`attendance.importPunches` · `attendance.recompute` · `attendance.requestRegularization` (ESS) ·
`attendance.decideRegularization` (the HR step; the manager step authorizes by relationship, as
Leave's does) · `attendance.approveOvertime` · `attendance.export`

The v1.0 draft also listed a separate `attendance.viewAll`; it is **dropped**: "who can see whose
rows" is what ADR-004 scope already expresses (`own`/`branch`/`organization` on the grant), and no
existing HR resource duplicates its scope as a second key.

Scoping follows ADR-004/ADR-015 unchanged: `own` → the employee's own rows via the `ownerUserField`
seam Leave already established; `branch` → `branchId`; `organization` → everything. The ESS role
gains `attendance.view` (own) and `attendance.requestRegularization`.

---

## 7. Workflow — regularization

`draft` → **`pendingManager`** → **`pendingHr`** → `approved` | `rejected` | `cancelled`

**Two approval steps, not one (D7 as ruled).** The chain mirrors the Leave request lifecycle
exactly — `pendingManager → pendingHr` is the same pair Leave's `LEAVE_REQUEST_STATUSES` already
runs — so the manager-relationship authorization, the approval machinery and the notification
templates are reused rather than rebuilt. The manager step authorizes by **relationship** (the
subject's current manager), the HR step by `attendance.decideRegularization` — the same split
Leave's R9 established. HR direct edits (with a mandatory reason) remain available and are
audited as such.

Final approval applies the change and triggers a recompute of that one day; rejection at either
step leaves the record untouched with the reason stored. A regularization on a **frozen** day is
accepted but marked `postFreeze` so Payroll treats it as an adjustment to the next period — never
a restatement of a paid one, because frozen rows are never rewritten (§4).

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
- **Settings** (4, keyed `hr.attendance.*` per the platform convention — D-PR-01):
  `hr.attendance.autoComputeHour` · `hr.attendance.absenceNotify` ·
  `hr.attendance.selfPunchEnabled` (D1, default `false`) ·
  `hr.attendance.overtimeRequiresApproval` (D5, default `true`).
- **Scheduler** (3, all idempotent via the unique day key, keyed like the existing HR tasks):
  `hr.attendance.computeDaily` (nightly compute for the previous day) ·
  `hr.attendance.missingCheckoutSweep` · `hr.attendance.absenceNotifySweep`.

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

Numbered from the next free slot in the sequence (D-PR-01): the v1.0 draft said ADR-020/021, but
both numbers were taken by later merges (`ADR-020-shared-file-storage`,
`ADR-021-it-asset-custody-and-history`), and the gap at ADR-022 stays unused so the sequence
keeps its chronological meaning.

- **ADR-027 — Attendance day records are derived, punches are the record of truth.** Consequence:
  any bug is fixed by correcting inputs and recomputing, never by editing a derived row.
- **ADR-028 — A frozen period is immutable to recomputation.** Consequence: Payroll can trust a
  paid month; corrections flow forward as adjustments — and there is no unfreeze (D-PR-07).

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

**Payroll** (next in the HR order) reads frozen daily rows through one dated feed — the formal
contract in §15.1 — matching the discipline Leave already publishes (`paidBreakdown`, frozen at
consumption), so Payroll integrates one reader for both. **Performance** reads read-only
aggregates. **ESS/Mobile**: the own-scope endpoints are the contract. **Workflow Engine
(ADR-011)**: the regularization approval chain lifts onto definitions as data, exactly as
Leave's does.

### 15.1 The Attendance → Payroll feed contract (D10 — owner-approved, binding)

Frozen daily rows are the **only** interface Payroll reads. Payroll never re-derives attendance
from punches, shifts or the calendar — quantities are decided here, money is decided there, and
neither module restates the other's answer. One row per employee per work date in the frozen
period:

| Field | Meaning |
|---|---|
| `employeeId` | The subject. |
| `workDate` | The day, keyed by shift start (D3) — an overnight shift lands whole in its start date's payroll period. |
| `status` | One value from the §2 enum. |
| `shiftId` | The shift resolved for the day (`null` on `dayOff`/`weekend`/`holiday` rows without one). |
| `workedMinutes` | Presence actually measured. |
| `lateMinutes` | Raw minutes past grace (D4) — priced by Payroll's tiers, never here. |
| `earlyLeaveMinutes` | Raw minutes left early — same division of labour. |
| `approvedOvertimeMinutes` | Only what the D5 approval released; the derived-but-unapproved remainder never reaches this feed. |
| `leaveId` | The covering leave request when `status = onLeave`; the paid split stays in Leave's `paidBreakdown` and is not copied. |
| `branchId` | The **employee's** branch (D8/ADR-015) — the payroll/GL axis, never the punch's branch. |
| `flags` | Closed vocabulary (`crossBranchPunch`, `manualPunch`, …) — signals for review, never inputs to arithmetic. |
| `frozenAt` | When the row became immutable — set by the freeze the Payroll Run triggered (§4). |

Rules that ride the contract:

- A row with `status = incomplete` in a period under calculation **blocks that employee's payroll
  line** until regularized (D6) — the feed never launders an unfinished day into a paid one.
- `absent` prices as a deduction only where no leave and no calendar fact covers the day — the
  engine already guarantees that ordering (§4).
- Post-freeze corrections arrive as `postFreeze` regularizations and surface in Payroll as
  forward adjustments (§7); the frozen rows themselves never change.

---

## Review trail

v1.0 — initial draft for owner review. §0 carried eleven open decisions.

v1.1 (2026-08-12) — **§0 D1–D11 ruled on by the owner in P-HR-01** and folded in, together with
the two boundary decisions taken beside them:

- **D6 refinement:** an `incomplete` day blocks that employee's payroll calculation until
  regularized (§4, §15.1).
- **D7 refinement:** regularization approval is **two steps** (`pendingManager → pendingHr`),
  mirroring Leave exactly — not manager-only (§7).
- **D10 made concrete:** the Attendance → Payroll feed contract is now formal and binding
  (§15.1), with the owner's field list (`employeeId`, `workDate`, `status`, `shiftId`, minutes,
  `approvedOvertimeMinutes`, `leaveId`, `branchId`, `flags`, `frozenAt`).
- **D-PR-07 Option A:** the Payroll Run owns the freeze trigger; no admin freeze endpoint, no
  unfreeze (§4, §5).
- **D-PR-01:** ADR numbers renumbered to the free sequence (ADR-027/028, §11); permission keys
  reshaped to the platform's two-segment `resource.action` generator (§5, §6); setting and
  scheduler keys prefixed `hr.attendance.*` (§9).
- One key **dropped, and the drop confirmed by the owner explicitly:** `attendance.viewAll` —
  ADR-004 scope on the grant (`own`/`branch`/`organization`) already expresses reach, and no
  existing HR resource carries a second "all" key beside its `view` (§6).

The document is **not frozen**: implementation starts only after the owner approves this
revision.
