# Attendance Module — Design (v1.3, IMPLEMENTED — D12 model settled, transport open)

> **Status (v1.2, 2026-08-16): AT-1 → AT-7 are implemented and merged on `main`.**
>
> §0's decisions D1–D11, and the two P-HR-01 boundary decisions **D-PR-01** (conventions: ADR
> numbering, two-segment permission keys, `hr.attendance.*` setting keys) and **D-PR-07 Option A**
> (the Payroll Run owns the freeze trigger), were approved by the owner on 2026-08-12 and have
> since been **built**. §16 reconciles this document against `main` line by line.
>
> The v1.1 sentence *"no implementation exists or may begin until the owner approves this revision
> and the document is marked frozen"* is **superseded**: implementation proceeded, and code cites
> this document as "frozen design v1.1". v1.2 counted six such files; at v1.3 the count is **26**,
> across the API, the web and the seed — the citation spread while the document stayed unmergeable.
> This revision closes that gap by landing it.
>
> **What v1.3 changes.** This revision lands the document on `main` for the first time, and
> closes **the half of D12 that the owner has now ruled on**. It changes no section numbering:
> production code cites this document by section, and a renumber would break every citation it
> was written to make openable.
>
> **Still NOT settled:**
>
> * **D12-T** — the **transport**: protocol, push or pull, connection, payload shape, device-side
>   identity and whether the unit reports direction. §17.4 states exactly what is missing and why
>   guessing any of it is worse than waiting. **Open, and blocking AT-D3 only.**
>
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
| **D6** | Missing checkout | **APPROVED, with a refinement:** the day closes as **`incomplete`**, never guessed — and an `incomplete` day inside a period being calculated **blocks that employee's payroll calculation** until a proper regularization resolves it (see §4). **v1.3: the second half was reopened as D6-R and RULED as option C — the day is named on the payslip rather than blocking it. §4 records the ruling and why A was not taken.** | An assumed 8-hour day is an invented fact that reaches a payslip. `incomplete` is visible and correctable — and it must never be silently priced. |
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

#### D6-R — SETTLED (owner ruling, 2026-08-31): the day is named, not blocked.

**The rule above was implemented only in its first half.** On `main`:

* `payroll/compensation/attendance-quantities.ts` names the statuses that mean "came to work" and
  states `incomplete` is *"deliberately absent"* — so the day contributes **0** to every quantity
  source. It is counted neither as attendance nor as absence, which is faithful to "never guessed".
* But **nothing blocks**. No run error, no refusal, and no warning: the compensation warning
  vocabulary is exactly `legacyAllowancesIgnored` · `netBelowZero` · `leaveDaysAlsoPriced`, and
  there is no `incompleteDay` among them.

So the outcome today is that an unfinished day **passes through the calculation silently** — it is
not priced, and nobody is told. The design wanted it loud; the code made it quiet.

**This was a divergence between a ruling and the code, not a bug in either.** Three ways to close
it were put to the owner, and the cost column was measured against `main` before the choice:

| option | what it means | measured cost |
|---|---|---|
| **A — block** | Payroll refuses to calculate that employee's line and reports the day in the run's errors, as v1.1 ruled | **larger than v1.2 stated.** `payroll-run.model.ts` carries counters and lifecycle stamps and **no error surface at all** — no error list, nothing per-employee. A is not a refusal bolted onto an existing report; it is a new structure on the run, plus a decision about what "a run cannot close" means for the lifecycle |
| **B — keep the current behaviour** | the day contributes nothing and the run proceeds | nothing changes; the silence is accepted as intended |
| **C — warn** | the day contributes nothing, and the payslip carries a new warning naming it | **one value in a closed vocabulary.** The surface already runs end to end: `payslip.model.ts` persists `warnings[]`, the DTO returns them, and `CompensationCard.tsx` renders them |

**RULED: C.** The unfinished day keeps contributing nothing — guessing what it was worth is a
labour rule nobody has granted this system, and that half of D6 was never in question — but the
payslip now carries `incompleteDay` naming it. The silence is what the ruling was aimed at, and
the silence is what C ends.

**Why not A, given v1.1 said so.** Two measured reasons, neither of them a preference. First, the
cost above: the run has nowhere to report a blocked employee, so A is a phase, not a patch.
Second, the timing: AT-D3 is not built, so no device writes punches yet and every attendance day
still arrives by hand — blocking payroll on unfinished days *today* would stop payslips at
exactly the moment the system is least able to prevent them. A stays available and is now cheaper
to decide, because C makes the days visible first: a block is a decision worth taking against a
count somebody has seen, not against one nobody can.

**What C deliberately does not do.** It does not repair the day, and it does not price it. The
unblock path is unchanged and is still a proper regularization (§7).

**The warning is raised only when attendance actually reaches that payslip's money** — at least one
line carrying a `quantitySource` — and only for days inside the employee's own employment. That
restraint is the same one `leaveDaysAlsoPriced` already uses. Without it the warning would appear
on every salaried payslip in any month somebody forgot to punch out, and a warning nobody reads is
a second silence wearing the first one's clothes.

---

## 5. API contracts

Mounted under `/api/v1/hr`. No new platform endpoints.

**v1.2 — this table now states what `main` actually mounts.** The rows the v1.1 draft listed all
shipped unchanged; four regularization rows were **added** by AT-5/AT-6 and were missing here.
Routers are mounted per feature at `/hr/attendance/{shifts,assignments,punches,days,
regularizations,overtime,export}`.

| Method | Path | Grant | since |
|---|---|---|---|
| GET/POST/PATCH/DELETE | `/attendance/shifts` | `attendance.manageShifts` | v1.1 |
| GET/POST/DELETE | `/attendance/assignments` | `attendance.assign` | v1.1 |
| GET | `/attendance/punches` | `attendance.view` | v1.1 |
| POST | `/attendance/punches` | `attendance.recordPunch` | v1.1 |
| POST | `/attendance/punches/import` | `attendance.importPunches` | v1.1 |
| GET | `/attendance/days` (range, filters) | `attendance.view` | v1.1 |
| GET | `/attendance/days/me` | own scope, ESS — no key | v1.1 |
| POST | `/attendance/days/recompute` | `attendance.recompute` | v1.1 |
| POST | `/attendance/regularizations` | own scope (`attendance.requestRegularization`) | v1.1 |
| POST | `/attendance/regularizations/:id/decide` | manager by relationship (step 1) / `attendance.decideRegularization` (step 2, HR) | v1.1 |
| **GET** | **`/attendance/regularizations/me`** | **own scope, ESS — no key** | **added, AT-6** |
| **GET** | **`/attendance/regularizations/pending-decisions`** | **by relationship — no key** | **added, AT-6** |
| **GET** | **`/attendance/regularizations`** (the queue) | **`attendance.decideRegularization`** | **added, AT-6** |
| **POST** | **`/attendance/regularizations/:id/cancel`** | **own scope** | **added, AT-5** |
| POST | `/attendance/overtime/:id/approve` | `attendance.approveOvertime` | v1.1 |
| GET | `/attendance/export` | `attendance.export` | v1.1 |

There is deliberately **no freeze endpoint** in this table: the freeze is invoked internally by
the Payroll Run (§4, D-PR-07 Option A), so it carries the run's own grant rather than one of its
own. **Verified on `main`:** `freezePeriod()` has exactly one production caller, the port at
`payroll/runs/attendance-freeze.port.ts`, and the string `unfreeze` appears nowhere in the
repository except in comments that say it does not exist.

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

**v1.2 — restated as what `main` routes.** The v1.1 list said "five screens" and folded the shifts
catalog and the assignment screen into one row; they shipped as two, each with its own registry
page, so the count was never going to hold. Six routed screens plus one profile tab:

| # | screen | route | gate | page registry |
|---|---|---|---|---|
| 1 | **My attendance** (ESS) | index + `me` | none — own scope by construction | — |
| 2 | **Daily sheet** | `daily` | `attendance.view` | `hr.attendance-daily` |
| 3 | **Employee month** | `employees/:id` | `attendance.view` | — (same page as the daily sheet) |
| 4 | **Regularization queue** | `regularizations` | `attendance.decideRegularization` | `hr.attendance-regularizations` |
| 5 | **Shifts catalog** | `shifts` | `attendance.manageShifts` | `hr.attendance-shifts` |
| 6 | **Shift assignments** | `assignments` | `attendance.assign` | `hr.attendance-assignments` |
| — | **Attendance tab on the employee profile** | (tab, not a route) | the profile's own gate | — |

Four registry pages, four navigation rows. All reuse the existing kit — `DataTable`, `FilterBar`,
`MultiSelect`, the shared picker pattern, `PageHeader`.

---

## 11. ADRs to record with the implementation

> ### ⚠️ v1.2 — UNPAID DOCUMENTATION DEBT
>
> **Neither ADR was written.** `docs/03-decisions/` on `main` runs `ADR-001 … ADR-026` with the
> ADR-022 gap still unused, exactly as this section predicted — but ADR-027 and ADR-028 are simply
> absent, while the rules they were meant to record shipped and are enforced in code.
>
> This is a documentation debt, **not an open decision**: both rules were ruled on, built, and are
> guarded by tests. What is missing is the architectural record. Writing them changes no code.

Numbered from the next free slot in the sequence (D-PR-01): the v1.0 draft said ADR-020/021, but
both numbers were taken by later merges (`ADR-020-shared-file-storage`,
`ADR-021-it-asset-custody-and-history`), and the gap at ADR-022 stays unused so the sequence
keeps its chronological meaning.

- **ADR-027 — Attendance day records are derived, punches are the record of truth.** Consequence:
  any bug is fixed by correcting inputs and recomputing, never by editing a derived row.
  *(Built: the punch model is immutable with `supersededBy`; day records upsert under a unique
  `{employeeId, workDate}`. Not written down.)*
- **ADR-028 — A frozen period is immutable to recomputation.** Consequence: Payroll can trust a
  paid month; corrections flow forward as adjustments — and there is no unfreeze (D-PR-07).
  *(Built: one caller of `freezePeriod()`, no unfreeze path anywhere, `postFreeze` regularizations
  carry corrections forward. Not written down.)*

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

- A row with `status = incomplete` contributes NOTHING to any quantity — the feed never launders
  an unfinished day into a paid one (D6). **D6-R as ruled (option C):** it does not block the
  line; the payslip carries `incompleteDay` naming the day instead, raised only where attendance
  actually prices that payslip. §4 records the ruling.
- `absent` prices as a deduction only where no leave and no calendar fact covers the day — the
  engine already guarantees that ordering (§4).
- Post-freeze corrections arrive as `postFreeze` regularizations and surface in Payroll as
  forward adjustments (§7); the frozen rows themselves never change.

---

## 16. Reconciliation against `main` (v1.2, 2026-08-16)

The module was built across seven phases (AT-1 → AT-7). This section states what agrees with the
design, what is missing, and what diverges — so that no reader has to infer the module's status
from the fact that a document exists.

### 16.1 Built and matching the design

| design | on `main` |
|---|---|
| §1 features behind barrels | `shifts` · `assignments` · `punches` · `day-records` · `regularizations` · `overtime` |
| §1.2/§1.3 reads work-calendar and the Cairo date rule, adds no second notion of "today" | as designed |
| §1.4/§1.5 subscribes to `hr.leave.started` / `.ended` / `hr.employee.exited` | all three subscribed; the exit handler recomputes the affected span |
| §3 five collections, zero changes to existing ones | as designed, including `branchIdAtPunch`, `importBatchId`, `supersededBy`, and the partial unique `{deviceId, at, employeeId}` |
| §3 unique `{employeeId, workDate}` | as designed — recomputation is idempotent |
| **D1** sources | `device` · `manual` · `regularization` (AT-D2) · `web`; `hr.attendance.selfPunchEnabled` defaults **off** |
| **D3** the day is keyed by shift start | as designed |
| **D5** overtime derived, paid only after approval | `hr.attendance.overtimeRequiresApproval` defaults **on**; `approvedOvertimeMinutes` is separate from the derived figure |
| **D7** two approval steps | `pendingManager → pendingHr`, the Leave pair |
| **D8** cross-branch punches recorded and flagged | `crossBranchPunch` · `manualPunch` · `regularizedPunch` (AT-D2), closed vocabulary |
| **D9** punches immutable, superseded not edited | as designed |
| **D10 / §15.1** the feed | **exactly the twelve fields**, held by name in a contract test, and an unfrozen row cannot be mapped |
| **D-PR-07** freeze owned by the run | one production caller; no freeze endpoint; **no unfreeze anywhere** |
| **D-PR-01** conventions | two-segment keys · `hr.attendance.*` settings · `attendance.viewAll` **dropped, zero occurrences** |
| §8 events | all eight published, all three subscribed |
| §9 settings + scheduler | the four settings and the three tasks, by the names given here |
| §12 rollout | `GENERAL` shift seeded; no backfill |

### 16.2 Designed, not built

* **§1.6 — attendance rows on the employee-profile timeline.** The timeline resolves two sources
  through its dynamic-import escape hatch (employee file, leave); attendance is not among them.
  Deferred, not refused — nothing depends on it.
* **§11 — ADR-027 and ADR-028.** See the box in §11.

### 16.3 Diverging

* **Nothing.** D6-R was the last entry here — the `incomplete` day was designed to block payroll
  and built to pass through it silently. Closed by the owner's option-C ruling: the day still
  contributes nothing, and the payslip now says so. §4 records the ruling and the measured cost
  that argued against option A.

### 16.4 Added after the design was written

* The AT-6 regularization read endpoints and the cancel path (§5, marked in the table).
* The two nightly sweeps were designed in §9 and shipped in AT-7 — the design covered them.

---

## 17. D12 — how device punches reach ECMS. **MODEL SETTLED (v1.3); TRANSPORT OPEN.**

D1 settled *that* devices are a punch source. It never settled *how the rows arrive*, nor what a
**device** is to this system — today it is a free-text string on a punch.

v1.3 closes the second half. The owner ruled on the **model**: what a device is, how a device punch
differs from a hand-entry, and what must exist before the device may become the only source. The
**transport** — protocol, push or pull, wire format — remains open, deliberately, and §17.4 says
why guessing it is worse than waiting.

### 17.1 What exists today, verified in code

Ingestion is a **single authenticated endpoint that something else calls**:

| | today |
|---|---|
| who initiates | a client — a person, a script, an integration — calls ECMS |
| endpoint | `POST /hr/attendance/punches/import` |
| authorization | `authenticate` + `attendance.importPunches` |
| payload | JSON rows validated by Zod, at most 5000 per call |
| employee resolution | by employee number |
| idempotency | the partial unique index `{deviceId, at, employeeId}` — a re-import is a duplicate, not a second punch |
| quarantine | rows outside the sanity window (older than 90 days, more than an hour ahead) are reported in the response, never silently dropped |
| device identity | `deviceId`, a free-text string on the punch. **There is no device entity, no registry, no serial number, no last-seen state.** |
| callers | **none.** No screen calls either write endpoint; nothing in the product reaches them. |

### 17.2 D12 — SETTLED (owner ruling, 2026-08-29)

| | ruling | why it is not merely tidy-up |
|---|---|---|
| **D12.1** | **The device is the natural source of attendance punches.** | Sets which source the others are measured against. |
| **D12.2** | **The approved-correction path must keep working and may not be broken.** | Regularization writes punches today. A naive "device only" that refused non-device rows would destroy the *only* way to fix a day the device missed — and would do it silently, since nothing else writes punches. |
| **D12.3** | **`regularization` becomes its own punch source, separate from `manual`.** | Today an approved two-step correction and an HR hand-entry are **indistinguishable in the data**: both `manual`, both raising the same `manualPunch` flag. Under D12.1 the only legitimate non-device punch is an approved correction, so the two must stop sharing a name. |
| **D12.4** | **A direct `manual` punch is not equivalent to a device punch.** | Provenance is a property of evidence. The flag on the derived day must be able to say which kind it was. |
| **D12.5** | **A device is a real entity**: `deviceId` → branch, activation state, and last contact / last successful read. | A free-text string cannot be deactivated, cannot be located, and cannot be observed to have gone quiet. |
| **D12.6** | **One connector/adapter per protocol, behind a port.** The attendance service never names a vendor or model. | The brand must be a leaf. `platform/automation/providers` and the OCR and secrets providers already establish the self-registering provider pattern — this reuses it rather than inventing a second one. |
| **D12.7** | **`branchIdAtPunch` records the DEVICE's branch, not the employee's.** | The field's own comment calls it *"where the punch physically happened — evidence"*, and import sets it from the employee. So `crossBranchPunch` — the flag that exists to catch exactly this — **can never fire on a device punch.** It has been dead for the one source it was written for. |
| **D12.8** | **Device-only exclusivity may not be enabled before device health / last-seen visibility exists.** | If the device is the only source and it goes quiet for a day, everybody is absent and nothing says so. This is a precondition, not advice: the setting is to *refuse* the exclusive mode while no active device has been seen. |

### 17.3 What the settled model does NOT decide

Nothing in D12.1–D12.8 chooses a transport, and none of it may be read as choosing one. The three
shapes stay named neutrally, exactly as v1.2 left them:

| option | what would have to exist |
|---|---|
| **client / agent → ECMS** | something outside ECMS reads the device and calls the existing endpoint. Needs a credential for that caller and a place for it to run. No change to ECMS. |
| **device → ECMS (push)** | the device initiates HTTP to the server on its own. Needs an **ingress that ECMS does not have**: a route outside the permission model, a non-JSON body, and a way to authenticate a device rather than a user. |
| **file import** | punch files are uploaded and processed. Needs an upload path and a parser; the Files module already exists. |

### 17.4 D12-T — the transport. **OPEN, and blocking.**

Six facts are required before a single line of connector code is worth writing. **Not one of them
is discoverable from this repository**, because no integration was ever built:

1. the make and model, **confirmed against the physical unit**;
2. the protocol it actually speaks, as configured;
3. **push or pull** — and, decisively, whether the ECMS host can reach the device's network at all.
   A cloud server cannot pull from a device on an office LAN without an agent inside that network,
   and that single fact changes the whole shape of the work;
4. connection details;
5. the wire/export format — **one real export file answers this, and questions 6 and 7 with it**;
6. what identifies the employee on the device: our employee number, or the device's own enrolment
   id (import keys on `employeeNumber` today);
7. whether the unit reports IN/OUT or only a timestamp (the engine pairs first-in/last-out when the
   direction is `unknown`).

**A note on hardware, recorded as provenance and not as a decision.** v1.2 §17 stated that *"the
organization has ZKTeco K40 Pro hardware on the network."* That sentence has never been confirmed
against the unit, and it sat in a document that had never reached `main` — so the only place in the
entire system naming the hardware was one nobody could open. It is preserved here as the origin of
the claim. **It is not a design input, no adapter is being written against it, and D12.6 exists
precisely so that the answer is a leaf rather than a foundation.**

**Why guessing is worse than waiting.** A connector built on an assumed format does not fail
loudly; it produces *plausible* punches — shifted by a timezone, paired in the wrong order, or
attributed to the wrong person by an enrolment id that happened to collide with an employee number.
Those rows flow into the derivation, the freeze and the payroll feed. The failure surfaces as a
wrong salary weeks later, with the evidence trail pointing at a machine that "worked".

### 17.5 What proceeds without D12-T, and what does not

| phase | needs the transport? |
|---|---|
| **AT-D1** — device entity, registry, branch scope, `branchIdAtPunch` from the device (D12.5, D12.7) | **no** — and it fixes a dead flag today |
| **AT-D2** — `regularization` split from `manual` (D12.3, D12.4) | **no** — and it ends a live conflation today |
| **AT-D3** — port, adapter, ingestion funnel (D12.6) | **yes, entirely** |
| **AT-D4** — health, last-seen, alarm (D12.8) | partly |
| **AT-D5** — exclusivity, gated on AT-D4 (D12.1, D12.8) | no |

**Nothing in the shipped module depends on D12-T being answered.** Manual and web punches work, the
import endpoint works, and the derivation, freeze and feed are all indifferent to how a punch
arrived — `source` and `deviceId` are already on the record.

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

v1.2 (2026-08-16) — **reconciled against `main`.** Implementation went ahead across AT-1 → AT-7
and this document was never merged, so `main` came to cite a "frozen design v1.1" that no reader
could open. This revision changes **no ruling** and **no production code**; it records status,
states two open questions, and corrects what had aged:

- **Status corrected.** The v1.1 line forbidding implementation is superseded — §16 reconciles the
  design against the code phase by phase. D1–D11, D-PR-01 and D-PR-07 were all built as ruled.
- **D6-R opened (§4, §16.3).** The ruling's second half — that an `incomplete` day *blocks* the
  employee's payroll calculation — was not built. On `main` the day is excluded from every
  quantity and nothing announces it. Three ways to close it are set out; **none is chosen here.**
- **D12 opened (§17).** How device punches physically reach ECMS was never decided: D1 settled the
  source, not the transport. The options are named neutrally and **no protocol, endpoint, agent or
  polling design is assumed or recommended.**
- **§5 and §10 restated as built** — four regularization endpoints added by AT-5/AT-6 were missing
  from the API table, and the "five screens" count never matched the six routed screens plus the
  profile tab.
- **§11 marked as unpaid debt** — ADR-027 and ADR-028 were never written, though both rules are
  built and guarded.
- **§16.2 records the one designed-but-unbuilt integration**: attendance rows on the employee
  timeline (§1.6).

**Awaiting owner review.** Two decisions (D6-R, D12) are open by design; this revision exists to
put them in front of the owner, not to resolve them.

v1.3 (2026-08-29) — **landed on `main`, and D12's model ruled on.** v1.2 put two questions in front
of the owner; one has come back answered. This revision records that answer and finally merges the
document, so the "frozen design" that **26** files across the API and the web cite is a file a reader can open.

- **The document reaches `main` for the first time.** Section numbering is untouched, deliberately:
  production code cites this design by section, and renumbering would break the very citations
  merging it was meant to make openable.
- **D12 — model SETTLED (§17.2).** Eight rulings: the device is the natural source; the approved
  correction path may not be broken; `regularization` becomes its own punch source; a direct
  `manual` punch is not equivalent to a device punch; a device is a real entity with a branch, an
  activation state and a last-seen; one adapter per protocol behind a port, with no vendor named in
  the attendance service; `branchIdAtPunch` records the **device's** branch; and device-only
  exclusivity may not be switched on before health visibility exists.
- **Two live defects named by those rulings, both pre-dating this revision.** `crossBranchPunch`
  can never fire on a device punch, because import stamps the employee's own branch into a field
  documented as *where the punch physically happened* (D12.7). And an approved two-step
  regularization is **indistinguishable in the data** from an HR hand-entry — both `manual` (D12.3).
- **D12-T — transport still OPEN (§17.4).** Protocol, push/pull, connection, wire format,
  device-side identity and direction reporting. None is discoverable from this repository, and none
  is assumed. The v1.2 hardware sentence is preserved as **provenance, explicitly not as a design
  input** — it was never confirmed against the unit, and it lived in a document nobody could open.
- **D6-R unchanged and still open.** It was not among the rulings, so it is not touched here.

**Not frozen against further change; frozen against guessing.** AT-D1 and AT-D2 proceed on the
settled model. AT-D3 does not begin until D12-T is answered from the physical device.
