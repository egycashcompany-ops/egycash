# Leave Management Module — Frozen Design

> Status: **FROZEN** (approved decisions L1–L8 recorded below; adversarial amendments R1–R15 and
> consistency fixes C1–C8 incorporated). This document is the single source of truth for the
> Leave Management implementation. Deviations require a recorded stop-and-explain.
>
> Companion precedent: `docs/12-planning/employee-module-design.md` (Employee Management).

## 0. Approved product decisions

| # | Decision |
|---|---|
| **L1** | Approval chain per type, configurable. Defaults: annual/casual/sick → **manager only**; unpaid/maternity/Hajj → **manager then HR** |
| **L2** | Only types marked `affectsEmployeeStatus` move the employee to `onLeave` (maternity, Hajj, unpaid > threshold). Short leaves never touch status |
| **L3** | Calendar-year entitlement grant, pro-rated in the hire year (monthly accrual is a config mode, off by default) |
| **L4** | Egyptian Labor Law amounts are **seeded editable configuration**. ⚠️ HR MUST verify the legal values before production go-live — the seed is a starting point, not legal advice |
| **L5** | Negative balances disabled (per-type cap, default 0) |
| **L6** | Annual carryover: carry ALL remaining days, no expiry, by default; cap and expiry are per-type configuration |
| **L7** | Employee Self-Service role ships in this phase: `leave.view` + `leave.request` at `own` scope, granted to employees with logins |
| **L8** | HR on-behalf may override **soft** rules only (notice period, max-per-occasion); never balance-gate or eligibility rules |

Guiding principle: **law and policy are data, not code**. Entitlements, chains, counting modes,
pay tiers — all admin-editable configuration with seeded defaults.

## 1. Boundary & integration

Placement: `apps/api/src/modules/hr/leave-management/` (features behind ADR-003 barrels:
`leave-types`, `leave-requests`, `leave-balances`) plus a **sibling** shared feature
`apps/api/src/modules/hr/work-calendar/` (weekends + public holidays), deliberately outside
leave-management because Attendance will consume it as-is. Web: `apps/web/src/modules/hr/leave-management/`.

Dependency direction: `leave-management → employee-management → recruitment → platform` (acyclic).
Integration points with existing modules — **exhaustive list**:

1. **Reads** employee facts for eligibility (hire date, employment periods, probation, status,
   gender + birthdate from the personal snapshot, `employment.managerId`).
2. **Drives** the Personnel Actions engine for status-affecting leaves through ONE new internal
   engine method `driveLeaveAction(byUserId, employeeId, 'leaveStart'|'leaveEnd', effectiveDate,
   requestRef)` — attributed to the approver, audited normally (the engine stays the only writer
   of employment facts). Changes to existing code are exactly three, all additive: this method,
   the timeline dynamic import (3), and `createLogin` emitting `hr.employee.loginLinked` (C1-R,
   §8) — plus the opt-in `ownerUserField` base-repository option (platform, backward compatible).
3. **Timeline**: the employee profile timeline composer adds leave rows via dynamic `import()`
   of the leave feature (same acyclic escape hatch the employee-file source uses; BD-007
   graceful degradation when absent).
4. **Subscribes** to `hr.employee.exited`: complete active leave at exit date, release the unused
   reservation, expire remaining balances.
5. Consumes Files (attachments), Notifications (8 templates), Audit (4 new actions),
   Settings (2 keys), Scheduler (4 tasks). Recruitment/Hiring Documents/Employee File: no contact.

The Employee module's manual `leaveStart`/`leaveEnd` dialogs disappear from the web Actions menu
(the planned F6 seam); the API alias stays for HR repair.

## 2. Leave Types catalog (`hr_leave_types`, admin-managed, seeded)

Per-type configuration: `code`, localized `name`, pay model (`paid` | `unpaid` |
`tiered` with ordered `{days, payRate%}` tiers), **balance source** `balanceTypeId`
(`self` = own banked entitlement · another type's balance (casual → annual) · `none` = untracked),
entitlement rules (base days; service-year steps; age step), eligibility (min service months,
gender, `oncePerService` | `maxPerService`, `allowedDuringProbation`), request rules
(`minNoticeDays`, `maxConsecutiveDays`, `maxPerYear`, `maxPerOccasion`, `backdateDays`,
`requiresAttachment` + `attachmentStage` (beforeApproval default | atSubmission), `allowHalfDay`),
counting mode (`workdays` | `calendarDays`), `affectsEmployeeStatus` (+ `statusThresholdDays` for
unpaid), approval shape (`managerOnly` | `managerThenHr`), carryover (`carryAll` default |
`capDays` | `none`, `expiryMonths` nullable), `negativeCapDays` (default 0), `active`, `sortOrder`.
Constraint (R13): `affectsEmployeeStatus` types cannot enable `allowHalfDay` (validated at save).

**Seeded defaults (editable; L4 verification note applies)**: Annual — banked; 15 days year 1
(after 6 months service, pro-rated), 21 from year 2, 30 after 10 service years OR age 50;
workdays; notice 3 days. Casual — deducts from annual; max 6/year, 2/occasion; backdatable.
Sick — untracked; tiers 90 @ 75% then 90 @ 85%; certificate before approval; calendar days;
backdatable 3 days. Maternity — untracked; 90 calendar days; female; 10 months service;
max 3 per service; affects status. Pilgrimage (Hajj) — untracked; 30 calendar days; once per
service; 5 service years; affects status. Unpaid — untracked; manager+HR; affects status > 14 days.

Only **banked** types (balance source `self`) have balance rows; deducting types hit their target
type's balance; untracked types validate from history and write dated consumption only (R11/C5).

## 3. Request lifecycle (`hr_leave_requests`)

Statuses (C3 — final enum): `pendingManager | pendingHr | pendingApproval | approved | active |
completed | rejected | cancelled`. Submission creates the request directly in its first pending
step (no draft/submitted state): `pendingManager`, or `pendingHr` when the employee has no manager
or the manager step is vacant. `pendingApproval` is a request on a configured approval chain. A
request starts on the chain only when a rung of it is staffed; otherwise it takes the manager and
HR path (§16).

- **Submit** (self via ESS, or HR on-behalf with `leave.requestForOthers`): validates
  eligibility, notice (soft, L8), overlap, per-year/occasion caps, attachment-at-submission when
  configured, probation rule, pending-exit rule (no leave crossing a scheduled exit), and — for
  banked sources — **reserves atomically** (R1, §4). Day count is computed from the work calendar
  and **frozen on the request** (R7); later calendar/type edits never recompute.
- **Concurrency** (R1/R2/C6): reservation is a conditional `findOneAndUpdate` on the balance row
  (`available ≥ days` → `$inc reserved`), then the ledger entry is appended. Overlap and cap
  checks re-run after insert; on conflict the newcomer with the larger `_id` self-rejects with a
  system comment and releases its reservation.
- **Decide**: step 1 = the employee's **current** manager (dynamic binding, R9b — a manager
  change re-routes the pending step; the daily reminder re-notifies the current holder); step 2
  (per type) = HR (`leave.approve`). HR may decide any pending step (override — prevents chain
  deadlock). A request on the chain is decided by the approvals engine; when a decision leaves
  nobody on the rungs that remain, it goes to HR's step (§16.2). Decisions are status-conditional atomic updates with a `version` guard (R3).
  The prohibition binds the **subject**: no one decides a request whose subject employee is
  themselves; an HR filer deciding a request they filed *for someone else* is allowed and
  audited (C7). The `approvals[]` array stores decided steps: `{step, deciderUserId, decision,
  comment, at}` — the ADR-011 workflow-instance history shape.
- **Approval catch-up** (R4): on approval, start ≤ today → `active` immediately; end < today →
  `completed` immediately with consumption (covers backdated sick leave and late approvals).
  The scheduler is the forward-looking safety net.
- **Active/complete**: at start (scheduler or catch-up) the request activates; for
  `affectsEmployeeStatus` types the module drives `leaveStart` (§1.2). Day after end →
  `completed`; reservation → consumption; `leaveEnd` drives status back. **Early return**:
  an action on `active` (`POST /:id/return`, manager or HR) recording `actualReturnDate`;
  resulting status `completed`; unused days released.
- **Cancel**: requester cancels any pending request; approved-not-started needs approver or
  `leave.cancelApproved`; active leave closes via early return, never cancel.
- **Status-drive failure semantics** (R5): the absence is a fact, the status is a projection —
  leave transitions NEVER roll back because `leaveStart`/`leaveEnd` was refused (e.g. employee
  suspended: `suspended → onLeave` is illegal; or pending-exit refusal). The request records
  `statusDriveOutcome: applied | failed | skipped`; failures notify HR via the existing
  scheduled-action-failed path.

## 4. Balances & ledger

- **`hr_leave_ledger`** (append-only truth): `employeeId, typeId` (what the absence was),
  `balanceTypeId` (whose balance it hits — R11/C5), `year, seq, kind` (`grant | carryover |
  reserve | consume | release | adjust | expire`), `days` (± halves allowed), `requestId?`,
  effective dates, `paidBreakdown [{days, payRate}]` on consumption (R7 — computed at
  consumption time from the type's tiers and year-to-date consumed; **this is the frozen Payroll
  read contract**), `by`, `note`. Unique keys — `(requestId, kind)` for request-driven entries,
  `(employeeId, balanceTypeId, year, kind:'grant')` — make every scheduler/migration write
  idempotent.
- **`hr_leave_balances`** (cache + concurrency gate, banked types only): unique
  `(employeeId, typeId, year)`; `granted, carriedOver, adjusted, reserved, consumed`;
  available = granted + carriedOver + adjusted − reserved − consumed. The conditional-update
  reservation (R1) is the ONLY way days are reserved. Rebuildable from the ledger
  (admin maintenance routine reconciles cache ↔ ledger).
- Grants: calendar-year, pro-rated by hire date in the hire year (L3); service-year steps count
  **total employed service across employment periods** (config `serviceAcrossPeriods`, default
  on); Hajj/maternity per-service counts read the ledger across periods (R12). Requests spanning
  Dec 31 split consumption entries across years. Manual adjustments (`leave.adjustBalances`)
  require a reason and audit + notify. Exit expires remaining balances; rehire grants fresh
  pro-rata in the new period (R12).

## 5. Work calendar (`hr/work-calendar` shared feature)

Org-level weekend days via declared setting `hr.workCalendar.weekendDays` (default Fri+Sat) (C2);
public-holidays catalog `hr_holidays` (unique date, localized name) with admin CRUD
(`workCalendar.manage` — C2); reads are available to any authenticated user (calendar facts power
every date picker). Exposes workdays-between for leave counting and, later, Attendance.
**Business-date rule (R10)**: all "today"/comparison logic evaluates on the **Africa/Cairo**
calendar date via one shared HR date utility; storage is UTC-midnight date-only. Scheduler tasks
compute due-ness with the same utility.

## 6. Data model summary (all new collections; zero changes to existing ones)

`hr_leave_types` (§2) · `hr_leave_requests` — employeeId + denormalized employeeCode/searchName/
branchId/departmentId/sectionId (scoping) + `employeeUserId` (nullable — the own-scope owner
field, C1-R), typeId, startDate, endDate, halfDayStart/End, frozen `days`, reason,
`attachments: fileId[]`, status, `approvals[]` (the manager and HR path's decisions),
`approvalSteps[]` (the approvals engine's trail, on a request a configured chain runs; a request
handed to HR after engine decisions carries both lists),
`approvalWorkflowId` and `approvalChainShape` (that request's pin: the chain row it was submitted
on and its rungs, written at submission and never rewritten; null and empty otherwise, and missing
on a request submitted before the pin shipped, which reads its chain live;
[ADR-041](../03-decisions/ADR-041-money-approvals-on-the-platform-engine.md) decision 4),
`actualReturnDate`, `statusDriveOutcome`, `version`, createdBy; indexes `(employeeId, status, startDate)`, `(status, startDate)`,
`(branchId, status, startDate)`, `(employeeUserId, startDate)` · `hr_leave_ledger` (§4) ·
`hr_leave_balances` (§4) · `hr_holidays` (§5).

## 7. APIs (mounted under `/api/v1/hr`)

- Catalog: `GET|POST /leave-types` · `PATCH /leave-types/:id` (deactivate, never delete).
- Calendar: `GET /work-calendar?from&to` (merged weekends+holidays; authenticated) ·
  `GET|POST /holidays` · `PATCH|DELETE /holidays/:id` (`workCalendar.manage`).
- Balances: `GET /employees/:id/leave-balances?year` · `GET /employees/:id/leave-ledger?typeId&year`
  (`leave.viewLedger`) · `POST /employees/:id/leave-balances/adjust` (`leave.adjustBalances`).
- Requests: `POST /leave-requests` (self; `employeeId` only with `leave.requestForOthers`) ·
  `GET /leave-requests` (scoped; filters: status, typeId, employeeId, date range) ·
  `GET /leave-requests/pending-approvals` (union: my-manager queue + `leave.approve` queue) ·
  `GET /leave-requests/:id` · `POST /leave-requests/:id/approve | /reject` (comment, version) ·
  `POST /leave-requests/:id/cancel` · `POST /leave-requests/:id/return` ·
  `POST /leave-requests/:id/attachments` (multipart, files platform).
- Preflight: `GET /employees/:id/leave-eligibility?typeId&start&end&halfDayStart&halfDayEnd` —
  computed days, balance-after, violated rules (hard vs soft) — powers live wizard validation.
- Calendar view: `GET /leave-calendar?from&to` (scoped approved+active leave).

All lists use the standard paginated envelope; all mutations carry `version`.

## 8. Permissions & security

`leave.view` · `leave.request` · `leave.requestForOthers` · `leave.approve` · `leave.cancelApproved`
· `leave.manageTypes` · `leave.adjustBalances` · `leave.viewLedger` · `workCalendar.manage` (C2).
All scope-aware (own/section/department/branch/organization).

- **ESS role** (L7): seeded "Employee Self-Service" role = `leave.view` + `leave.request` @ `own`;
  granted to users linked to employees (migration step ④); the reusable seam for every future
  self-service surface.
- **`own` scope has two shapes (R14, revised C1-R)**. *Lists*: the base repository gains an
  opt-in `ownerUserField` option (peer of `hasAssignees`); own-filter = `createdBy` ∪ owner
  field. Leave requests denormalize `employeeUserId` at creation (the creating service already
  holds the employee). Records filed before the employee's login exists are backfilled by a new
  `hr.employee.loginLinked` event emitted by `createLogin` — consuming modules run an idempotent
  `updateMany` (the link is set at most once per employee under ADR-017, so backfill is
  one-shot). This keeps the platform's declarative scoping model uniform: the standard
  `repo.list({scope})` idiom stays correct for own-scope, and every future employee-subject
  module (Attendance, Payroll, Performance) reuses the same recipe — field + option + one
  subscriber. *Single-target* employee-keyed endpoints (balances, ledger, eligibility) have no
  row to filter: the service enforces `employee.userId === ctx.userId` on the resolved target.
- **Relationship-based approval (R9)**: approve/reject/pending-approvals routes authenticate
  only; the SERVICE authorizes: current manager of the subject **or** `leave.approve` in scope.
  Denials audited. Visibility matrix: requester · current manager · `leave.view` in scope.
- Self-decision prohibition binds the subject employee (C7). Managers need no broad permissions.

## 9. Notifications, audit, events

- **Templates** (boot-seeded, en+ar): `leave.requestSubmitted` (→ current approver) ·
  `leave.requestApproved` / `leave.requestRejected` (→ employee) · `leave.requestCancelled`
  (→ pending approver) · `leave.approvalReminder` · `leave.returnDue` (→ manager+HR) ·
  `leave.longLeaveStarted` (→ HR; affecting types) · `leave.balanceAdjusted` (→ employee).
  Employee/manager recipients user-directed; HR permission-scoped.
- **Audit** (closed-enum additions): `leaveRequest`, `leaveDecision` (step + verdict in changes),
  `leaveCancellation`, `leaveBalanceAdjustment`; catalogs use existing create/update/delete.
  Requests immutable after decision; every ledger `adjust` pairs with an audit record. A
  submission on a chain nobody staffs adds the change `unstaffedChain` to its `leaveRequest` row.
- **Events**: `hr.leave.requested` · `hr.leave.decided` · `hr.leave.cancelled` ·
  `hr.leave.started` / `hr.leave.ended` (payload: employeeId, code, typeId, dates, halfDay —
  the Attendance feed) · `hr.leave.balanceAdjusted`. Plus one EMPLOYEE-module event addition:
  `hr.employee.loginLinked` (emitted by `createLogin`; consumed by leave's own-scope backfill,
  C1-R — reusable by any future employee-subject module).

## 10. Scheduler (declared in the HR manifest; all idempotent via ledger unique keys + status-conditional updates)

| Task | Cron (UTC) | Work |
|---|---|---|
| `hr.leave.activateStarted` | `*/30 * * * *` | approved → active at Cairo start date; drive `leaveStart` for affecting types |
| `hr.leave.completeEnded` | `0 1 * * *` | active → completed after Cairo end date; reserve → consume (+`paidBreakdown`); drive `leaveEnd` |
| `hr.leave.approvalReminder` | `0 6 * * *` | nudge current approvers on requests pending > `hr.leave.approvalReminderDays` (setting, default 3) |
| `hr.leave.yearEnd` | `30 0 1 1 *` + boot catch-up | close year, carryover per type config, grant new-year entitlements pro-rata |

## 11. UI/UX

New **Leave** app in the HR nav group (`/leave`): **My Leave** (balance cards, my requests,
request wizard: type → dates on a calendar with weekends/holidays greyed + live day count and
balance-after via the eligibility endpoint → reason/attachment → confirm; approval-chain
stepper on detail) · **Approvals inbox** (manager + HR queues; approve/reject with comment;
balance context + team-overlap warning) · **Team calendar** (scoped month grid) ·
**HR administration** (all requests; balances with audited adjust dialog; Leave Types config;
Holidays admin; year-end status; **unreconciled-leave panel** — §12 ③). Employee profile hub:
additive **Leave tab** (balances + history); leave rows (approved/active/completed) join the
composed timeline; manual leave dialogs removed from the Actions menu. Full en/ar parity, RTL
calendars, standard page kit.

## 12. Migration & rollout (boot-time, idempotent; module is purely additive)

① Seed leave types (§2 defaults) + current-year Egyptian public holidays (editable).
② Grant current-year entitlements per employed employee, pro-rated by hire date (idempotent via
the grant unique key). ③ Employees currently `onLeave` from manual actions surface on the HR
**unreconciled-leave panel** — HR may record a retroactive request; the module never guesses.
④ Seed the ESS role and assign it to users linked to employees (L7). Rollback: disable
routes/nav — no existing collection was touched. ⚠️ L4: HR verifies seeded legal values before
production.

## 13. Risks (accepted, mitigated)

Balance drift between cache and ledger → single reservation path (R1) + rebuild/reconcile
routine. Approval deadlock → HR override + dynamic manager binding + daily reminder.
Status/absence divergence → `statusDriveOutcome` + HR notification (R5). Timezone off-by-one →
single Cairo date utility (R10). Policy edits mid-flight → submission-time freezing +
consumption-time `paidBreakdown` snapshots (R7). Scheduler double-runs → ledger unique keys +
conditional updates. Legal drift → L4 verification note + everything editable as data.

## 14. Deliberate deferrals

Approval delegation rules (HR override covers the gap) · leave encashment (needs Payroll) ·
monthly-accrual UI (schema supports the mode) · branch-specific holiday calendars ·
workflow-engine-backed definitions (ADR-011 — the `approvals[]` shape and per-type approval
config migrate onto it without redesign) · attendance-level absence recording (Attendance module).

## 15. Future-module compatibility (verified — no redesign required)

**Attendance**: reuses `work-calendar`, the Cairo date rule, `hr.leave.started/ended` events and
a by-date-range absence read (half-day detail included). **Payroll**: reads dated ledger entries
with frozen `paidBreakdown` — paid/partial/unpaid absence in one uniform feed; no config
re-derivation. **Performance**: read-only aggregates. **Self-Service portal / Mobile**: the ESS
role + own-scope REST APIs are the contract; no UI coupling. **Workflow Engine (ADR-011)**:
approval chains and per-type approval config lift onto definitions as data.

## 16. A leave request nobody on its chain can approve takes the manager and HR path (PXQ-1)

**Status.** A plan for one HR pull request, written 2026-11-25. Built, in the pull request titled
in 16.5; its number is added here when it opens. It carries LQ-1 to LQ-3 as each stands until the
owner answers (16.3): no task change, today's rule for HR's step, and no LQ-3 routing. It changes
§3's routing, so it is recorded here, as the frozen header asks for any deviation.

**Source.** PXQ-1 asked what happens when nobody can approve the remaining steps of a leave request's
chain, from the start or after earlier steps were approved
([PX-1 re-detail](administration-module-phase-px1.md) §2). The owner answered on 2026-11-25
«موافق على كل التوصيات، كمّل» ([decision log](administration-module-decisions-and-phases.md)
§16.12), adopting option 1, the recommendation, which reads: "Send it to HR: down leave's manager
and HR path at submission, as when no chain exists, and to HR for the remaining steps after earlier
approvals" (`administration-module-phase-px1.md:151-152`). The engine's side is
[ADR-041](../03-decisions/ADR-041-money-approvals-on-the-platform-engine.md) decisions 2 and 3: the
engine answers `unstaffed` or `noChain`, never approved, and each host applies its own policy to
those answers. This section is leave's policy. The engine does not change.

**When.** After PX-1.6 merges and PX-1 closes. The decision log records the answer as applied in an
HR slice of its own after PX-1.6, and the owner's rule is one phase at a time (§16.12 of the decision
log). The slice needs PX-1.2 (`chainFor` returns `status`) and PX-1.4 (the pin). Both are on the tree
this plan was read from.

**Line pins.** Every `path:line` below was read on `local/hr-pxq1` at `6009ffd5`, which is `main`
`d29c4974` plus PX-1.4. PX-1.5 changes no leave file. PX-1.6 changes the integration suite: every
`PUT` sends `basedOn`, and it adds cases of its own. The pull request re-pins that file, and any
other line that has moved, on its own base.

**Paths.** Leave's files are under `apps/api/src/modules/hr/leave-management/leave-requests/`.
"The service" is `leave-request.service.ts` there. Engine files are under
`apps/api/src/platform/approvals/`. "The suite" is `apps/api/tests/integration/approvals.spec.ts`.
A bare `:n` is a line of the service, except in 16.7, where it is a line of the file its paragraph
names first, and in 16.8, where it is a line of the suite. 16.7 opens with the full list of files.

**Terms.** ADR-041's Context defines chain, rung, staffed, settled, the first unsettled rung, the
waiting rung and the rung to decide; its decision 4 defines the pin. This section adds five:

- **the manager and HR path**: leave's own routing, `pendingManager` and then `pendingHr`, as §3
  describes it (16.1);
- **HR's step**: that path's `pendingHr` step;
- **on the chain**: status `pendingApproval`, where the engine decides;
- **a routed request**: one whose chain read `unstaffed` at submission, so that it took the manager
  and HR path (16.2 item 1);
- **handed to HR**: moved from the chain to HR's step by this slice (16.2 item 2).

### 16.1 What leave does today

**The manager and HR path.**

| Status | Who decides | An approval leads to | What is recorded |
|---|---|---|---|
| `pendingManager` | the employee's current manager, by relationship (`employment.managerId`, a user id; `isSubjectManager`, `:140-143`), or anyone whose `leave.approve` scope covers the employee (`approveCoversEmployee`, `:738-742`); `:494-498` | `pendingHr` for a `managerThenHr` type, `approved` for a `managerOnly` one (`:503-509`) | `approvals[]` gains `{ step: 'manager', deciderUserId, decision, comment, at }` (`:520-537`) |
| `pendingHr` | only a holder of `leave.approve` whose scope covers the employee (`:499-501`) | `approved` | `approvals[]` gains `{ step: 'hr', … }` |

- **Submission** picks `pendingManager` when the employee has a manager, and `pendingHr` otherwise
  (`:329-333`). It writes no pin.
- **A rejection** gives `rejected` at either step and releases the reserved days (`:556-559`).
  Nobody decides their own leave (C7, `:482-485`). The certificate gate holds an approval without an
  attachment, and holds every step for an `atSubmission` type (`:510-518`).
- **The write** is conditional on the status (`:521-538`). Each decision writes one `leaveDecision`
  audit row, with `step`, `decision` and `status` (`:540-548`), and emits `hr.leave.decided`
  (`:549-554`). The engine writes nothing.
- **Notices.** `leave.requestSubmitted` goes to the manager on `pendingManager`, and to holders of
  `leave.approve` at organization scope otherwise (`:448-459`). It is sent at submission, and again
  when a manager's approval hands the request to HR (`:561-564`). `leave.requestApproved` or
  `leave.requestRejected` goes to the employee (`:556-565`). The stale reminder goes to the manager
  on `pendingManager`, and to organization-scope holders otherwise (`:1305-1333`). A cancellation
  tells the manager, or those holders when there is no manager (`:1014-1025`).
- **Lists.** The manager's inbox lists the `pendingManager` requests of direct reports
  (`leave-request.repository.ts:103-114`). The HR queue lists every pending status, `pendingApproval`
  included, within the reader's `leave.approve` scope (`leave-request.repository.ts:117-127`). The
  DTO's `pendingStep` is `manager` on `pendingManager`, `hr` on `pendingHr`, and null otherwise,
  `pendingApproval` included (`leave-request.mapper.ts:40`).
- **Keys.** `leave.approve` and its scope decide; `leave.cancelApproved` cancels an approved request
  that has not started (`:980-988`). A manager needs no key. The decide, cancel, return, attach and
  pending-approvals routes authenticate only, and the service authorizes them
  (`leave-request.routes.ts:1-5`); the list, submit and unreconciled routes authorize a key
  (`leave-request.routes.ts:62-84`).

**At submission.** The service asks `chainFor` (`:325-326`) and puts the request on the chain
whenever the chosen chain has rungs (`onEngine`, `:327`).

| `chainFor` answers | Status today | Pin | Notice |
|---|---|---|---|
| `noChain` | the manager and HR path | none (`pinOf` is null, `:328`) | as on that path |
| `unstaffed` | `pendingApproval` | written (`:336-341`) | none: `currentApprovers` finds no waiting rung, so `notifyChainApprovers` sends nothing (`:444-447`, `:715-722`) |
| `pending` | `pendingApproval` | written | `leave.requestSubmitted` to the holders of the waiting rung |

An `unstaffed` request then waits. Only an `approval.override` that reaches the first unsettled rung
can decide it (ADR-041 decisions 3 and 6). Its stale reminder goes to organization-scope holders of
`leave.approve`, who are not on the chain (`:1315-1318`).

**After an engine decision.** `decideOnChain` (`:588-679`) asks the engine to decide
(`:601-604`). An `approved` or `rejected` answer becomes the request's status. Any other answer,
`unstaffed` included, keeps `pendingApproval` (`:613-618`). The engine's entries are appended to
`approvalSteps[]` in a write conditional on the trail's length (`:619-641`). The engine has already
written its own `platform/approval` row (`approval.service.ts:260-279`), and leave then writes its
`leaveDecision` row (`:643-651`). On `pendingApproval` leave notifies the next rung's holders
(`:664-666`). After an approval that leaves nobody on any rung that is left, that list is empty and
nobody is told (`:717-722`). The request waits as an `unstaffed` request does at submission, and the
panel marks the first unsettled rung (`approval.service.ts:189-192`).

**The trail off the chain.** A request with engine entries keeps its trail, whatever its status. Off
`pendingApproval`, leave clears `currentStep` and the reader's flags (`:693-712`).

**The web.** The detail page offers Approve and Reject on a request with no trail to anybody who can
open a pending request. On a request with a trail it offers them only when the trail's flags say so
(`apps/web/src/modules/hr/leave-management/pages/LeaveRequestDetailPage.tsx:58-70`). It draws the
chain panel when there is a trail, and the manager and HR card only when there is none (`:193-195`
of that file). Decisions are taken only on this page; the inbox is a list
(`apps/web/src/modules/hr/leave-management/pages/ApprovalsInboxPage.tsx:1-3`).

### 16.2 The rule

1. **At submission, a chain with no staffed rung takes the manager and HR path.** Only a chain that
   reads `pending` puts the request on the chain. An `unstaffed` answer does what `noChain` does:
   `pendingManager` when the employee has a manager, `pendingHr` otherwise, and no pin. From then on
   the request is a manager and HR request in every respect: who decides, what is recorded, the
   notices, the reminder and the inbox. A chain that is staffed later does not take it back: a
   request on the manager and HR path never moves to the chain (`:312-315`). The only move between
   the two is item 2's (with LQ-1 option 1, also the daily task's), one way, from the chain to HR's
   step.
2. **After an engine decision, a request with nobody left on its remaining rungs goes to HR's step.**
   When the engine answers `unstaffed` after a decision, the same conditional write that appends the
   engine's entries sets `pendingHr` instead of `pendingApproval`. This holds whoever decided, a
   holder of a rung or an override, and whether the request is pinned or reads its chain live. The
   request never goes to the manager: option 1 says "to HR for the remaining steps". HR's step
   then runs as on the manager and HR path. A holder of `leave.approve` whose scope covers the
   employee decides it. An approval gives `approved`, and a rejection gives `rejected`.
3. **HR's step stands for every rung that is left.** No entry is written for the rungs nobody
   reached. Writing `skipped` for them would make the engine read the chain as approved before HR
   decides, which is the defect R2 removed (ADR-041 decision 2).
4. **The record keeps both.** `approvalSteps[]` keeps the engine's entries up to the hand-over.
   `approvals[]` gets HR's decision, `{ step: 'hr', … }`. The pin stays as written at submission. A
   handed-over request is the only kind that carries both lists. Which list a request starts with is
   still settled at submission.
5. **Audit.**
   - A submission on an `unstaffed` chain: the `leaveRequest` row (`:413-421`) gains one change,
     `{ field: 'unstaffedChain', old: null, new: <the chain row's id> }`. A reader can then see that
     a chain applied and why the request took the manager and HR path. A `noChain` submission is
     audited as today.
   - The decision that hands the request over: the engine's `platform/approval` row, as today (leave
     stays an `'engine'` audit type, ADR-041 decision 7), and leave's `leaveDecision` row with
     `status` from `pendingApproval` to `pendingHr`.
   - HR's decision: the manager and HR path's `leaveDecision` row, with `step` `hr`. The engine writes
     no row.
   - No new audit verb.
6. **Notices and events.** At submission, as on the manager and HR path. At the hand-over,
   `leave.requestSubmitted` to organization-scope holders of `leave.approve`, as when a manager hands
   a request to HR (`:561-564`, then `:448-451`). The employee is not told of the hand-over, as on
   that path. After HR's decision, `leave.requestApproved` or `leave.requestRejected` goes to the
   employee. `hr.leave.decided` fires for each decision: first with `step` the rung's index, then
   with `step` `hr`.
7. **The screen shows both.** On a handed-over request the detail page draws the chain panel, headed
   "Approval chain" («مسار الموافقة»), which shows how far the chain got and who decided, and beside
   it the manager and HR card, headed "HR step" («خطوة الموارد البشرية») instead of its usual
   heading, which also reads "Approval chain" in English. One line in the card says why, in the
   panel's own term: "Nobody on the approval chain could decide the remaining steps, so the request
   went to HR." The page header offers Approve and Reject on HR's step as on any manager and HR
   request.

### 16.3 Questions for the owner

The answer settles submission and the moment of a decision. Three points it does not settle follow,
as leave questions LQ-1 to LQ-3.
The pull request does not wait for them: each says what applies until it is answered. Each answer
is recorded, dated and with the owner's words in «», in the decision log (§16.12 of
[administration-module-decisions-and-phases.md](administration-module-decisions-and-phases.md)),
and this section then names it.

#### LQ-1: a request on the chain that nobody on the chain can decide any more

- **Question.** A request waits on its chain, and later nobody on the chain can decide it, with no
  decision in between. The holders of every rung left may have lost the grant (its end date passed,
  the account was suspended, the role was removed). Or the chain of an unpinned request may have been
  deleted, so it reads the next wider chain that matches or, with none, `noChain` (ADR-041 decision
  10), or shortened, so it reads approved while leave keeps it pending (PX-1 re-detail §12, PX-R2).
  What happens?
- **Evidence.** The rule of 16.2 acts at submission and at a decision. Between the two, nothing
  moves the request. `decide` then refuses everyone without an override within reach
  (`approvals.notYourStep`), or everyone at all (`approvals.nothingToDecide` on `noChain`,
  `approvals.alreadyDecided` on approved; `approval.service.ts:222-242`). The notice of the request
  went to the holders who have since left. The same holds for requests stamped `pendingApproval` on
  an `unstaffed` chain while PX-1's option 3 applied, which this slice does not re-route (16.10).
- **Options.**
  1. The daily reminder task (`hr.leave.approvalReminder`, `apps/api/src/modules/hr/hr.module.ts:2274-2283`)
     first asks the engine about every request on the chain. Each one whose answer is not `pending`
     goes to HR's step, whether or not a rung was approved. Its first run after the deploy also moves
     every request already in that state, those stamped while PX-1's option 3 applied included, up
     to count LC1 (16.10) (S: one service method, one repository read, the task's handler).
  2. As 1, but a request with no rung approved yet goes down the manager and HR path as at
     submission: to the manager when the employee has one (S).
  3. It waits on the chain until an override within reach decides it or the employee cancels it
     (none: what PX-1 leaves).
- **Recommendation.** 1. It is one rule for every request already on the chain: when the chain can
  no longer decide, HR does. Sending a request back to the manager part-way would start a second
  route on a request that already has one.
- **Until the owner answers.** Option 3. If the owner picks option 1 before the pull request opens,
  it carries the task's change of 16.7; otherwise it ships without it, and a follow-up pull request
  adds it once the owner answers.
- **Arabic.** إذا كان طلب الإجازة ينتظر في مسار اعتماده، ثم لم يعد في المسار من يستطيع البتّ فيه دون
  أن يُتخذ فيه قرار، لأن أصحاب الخطوات الباقية فقدوا صلاحيتهم، أو لأن المسار حُذف أو اختُصر تحت طلب
  قُدِّم قبل تثبيت المسارات، فماذا يحدث؟ (١) تنقله المهمة اليومية لتذكير المعتمدين إلى خطوة الموارد
  البشرية، سواء اعتُمدت فيه خطوة سابقة أم لا، وتنقل في أول تشغيل لها بعد هذا التعديل كل طلب ينتظر
  على هذا النحو من قبل، وهذا ما نوصي به؛ (٢) مثل الخيار الأول، إلا أن الطلب الذي لم تُعتمد فيه أي
  خطوة يعود إلى مسار المدير ثم الموارد البشرية كما عند الإرسال؛ (٣) يبقى في الانتظار حتى يقرر فيه من
  يملك صلاحية التجاوز أو يلغيه الموظف، وهذا ما سيحدث إلى أن تجيب.

#### LQ-2: the same person on a rung and on HR's step

- **Question.** After a request is handed to HR, may a person who approved an earlier rung of its
  chain also decide HR's step, when their `leave.approve` scope covers the employee?
- **Evidence.** HR's step is decided by any holder of `leave.approve` whose scope covers the
  employee, the employee excepted (`:482-485`, `:499-501`). Leave has no other separation-of-duties
  rule. On the manager and HR path today, a manager who also holds `leave.approve` may decide both
  steps. The engine enforces no such rule either: ADR-041 decision 11 leaves it to each host. For P2
  purchase requests, the owner chose PRQ-4 (1) the same day: "a different person settles each empty
  level" (`administration-module-decisions-and-phases.md:1942`). That is a separation-of-duties
  rule of option 2's kind, for a request that spends money.
- **Options.**
  1. Yes, as on the manager and HR path today (none).
  2. No: HR's step refuses a person who decided a rung of this request's chain, as PRQ-4 does for
     purchase requests (S: one check in `decide` before `:499-501`, and a refusal message).
- **Recommendation.** 1. Under 16.2 item 2, HR's step runs as on the manager and HR path, so one
  rule decides it however the request reached it; option 2 would make it differ by route. A leave
  request spends no money, which is what PRQ-4's rule guards. If the owner wants PRQ-4's rule for
  leave too, option 2 applies it.
- **Until the owner answers.** Option 1, which is today's rule.
- **Arabic.** بعد تحويل الطلب إلى خطوة الموارد البشرية، هل يجوز لمن اعتمد خطوة سابقة في مسار اعتماده
  أن يقرر أيضًا في خطوة الموارد البشرية، إذا كانت صلاحية اعتماد الإجازات لديه تشمل الموظف؟ وقد
  اخترتَ لطلبات الشراء أن يحسم كل مستوى فارغ شخص مختلف. (١) نعم، كما في مسار المدير ثم الموارد
  البشرية اليوم، حيث يقرر في خطوة الموارد البشرية كل من يملك هذه الصلاحية على الموظف عدا الموظف
  نفسه، لأن طلب الإجازة لا يصرف مالًا، وهذا ما نوصي به، وهو ما سيحدث إلى أن تجيب؛ (٢) لا، تُرفض في
  خطوة الموارد البشرية قرارات من سبق أن اعتمد خطوة في مسار هذا الطلب، كما في طلبات الشراء.

#### LQ-3: the employee is the only holder of the rungs left

- **Question.** A request's only holder of the rungs that are left is the employee who filed it. For
  example, a unit manager files their own leave on a chain whose only rung is the unit's. Should it
  go to HR too?
- **Evidence.** The engine counts the employee as a holder (R6), so the chain reads `pending` and 16.2
  does not apply. Leave refuses anyone deciding their own leave (`:482-485`). So the request waits
  for a holder of a later rung, who may decide early (`approval-chain.ts:154-164`), an override
  within reach, or a cancellation. ADR-041 decision 11 leaves R6 to hosts. Leave can already see the
  question's own example without an engine change. `approvalService.currentApprovers`, on the
  barrel and called by leave (`:715-722`), returns the holders of the rung the request waits on
  (`approval.service.ts:284-291`). Each rung's `staffed` flag is on the chain at submission and on
  the trail after it (`packages/contracts/src/platform/approvals.ts:112`). When that list is the
  employee alone and no rung after it is staffed, nobody but an override can decide the request.
  Only a later rung that is staffed, but held by the employee alone too, is out of leave's sight:
  the engine exports no per-rung holder list (PX-1 re-detail §9).
- **Options.**
  1. Yes, where leave can see it: the rung the request waits on is held by the employee alone, and
     no rung after it is staffed. Leave checks this at submission and after each decision, and
     routes such a request as 16.2 routes an `unstaffed` one: down the manager and HR path at
     submission, to HR's step after a decision. No engine change (S, an HR pull request of its own
     after this one).
  2. As 1, and also when a later staffed rung is held by the employee alone. This needs the engine
     to report each rung's holders, a platform change with an ADR of its own (M).
  3. Not now: it waits, as it does today (none).
- **Recommendation.** 1. It covers the question's example, and every chain whose rungs after the
  employee's own are empty, with no engine change, and it sends such a request where the owner's
  PXQ-1 answer sends every request nobody can decide. Option 2's extra case needs the employee to
  hold two rungs of their own chain; it can wait until it is seen.
- **Until the owner answers.** Option 3, which is today's behavior. If the owner picks option 1, it
  is planned in this section and ships in its own pull request after this one.
- **Arabic.** إذا كان الوحيد الذي يملك صلاحية الخطوة التي ينتظرها طلب الإجازة هو الموظف صاحب الطلب
  نفسه، مثل مدير إدارة يقدّم طلب إجازته على مسار خطوته الوحيدة خطوة مدير الإدارة، فإن محرك الاعتماد يعدّه
  صاحب الخطوة فيبقى الطلب منتظرًا، بينما يمنع نظام الإجازات أي موظف من البتّ في إجازته. فهل يُحوَّل هذا
  الطلب أيضًا إلى الموارد البشرية؟ (١) نعم، إذا لم تكن بعد خطوته في المسار خطوة لها صاحب، وهي حالة يستطيع
  نظام الإجازات أن يتبيّنها بنفسه دون تعديل في محرك الاعتماد، في تعديل صغير لاحق، وهذا ما نوصي به؛ (٢)
  نعم في كل الحالات، حتى إذا كان الموظف نفسه صاحب خطوة تالية أيضًا، ويتطلب ذلك تعديلًا في محرك الاعتماد
  له قرار معماري مستقل في مرحلة لاحقة؛ (٣) ليس الآن: يبقى منتظرًا كما هو اليوم حتى يقرر فيه صاحب خطوة
  تالية أو من يملك صلاحية التجاوز، أو يلغيه الموظف، وهذا ما سيحدث إلى أن تجيب.

### 16.4 What does not change

- **The engine.** No file under `apps/api/src/platform/approvals/` changes, nor
  `packages/contracts/src/platform/approvals.ts`. ADR-041 is not edited (ADRs are immutable,
  `docs/README.md` rule 2). Its "Later changes" clause asks for a new ADR for any change to its
  decisions (`ADR-041-money-approvals-on-the-platform-engine.md:512-514`). This slice changes none.
  Decision 2 states the engine's answers and leaves each host its policy; its sentence on HR leave,
  and the Consequences' HR leave bullet, describe leave before PXQ-1 and name that question as the
  open one (`ADR-041-money-approvals-on-the-platform-engine.md:215-218, 470-481`). This slice
  applies the answer, so no new ADR is needed. A reader of ADR-041 reaches
  the new rule through PXQ-1 in the PX-1 re-detail §2, whose "Answered" bullet names this section
  (16.7, Docs).
- **The `noChain` and `pending` submissions.** They route as today.
- **The manager and HR path.** Who decides each step (except under LQ-2 option 2), the transitions,
  the certificate gate, the conditional write, its audit, its notices, the reminder's audience, the
  inbox, cancellation, early return, activation, completion and exit settlement.
- **Leave on the chain.** A `pending` chain is decided by the engine as today. Leave's audit stays
  the engine's (`'engine'`, ADR-041 decision 7). Leave's trail still offers nothing off
  `pendingApproval` (`:693-712`).
- **The API surface.** No route, DTO field, permission key, audit verb, event, notification template,
  realtime topic, setting, scheduler task key or cron, field or index. Comments in the leave contract
  change, and no type does.
- **The org-catalog survey** (`apps/api/src/org-catalog-migration/apply.ts:538-590`). It counts
  `pendingApproval` requests only. A routed request is never counted, and a handed-over one stops
  being counted. Neither is decided on a chain any more. An unpinned handed-over request still draws
  its trail from the live chain (`:693-700`, `:124-138`), so linking its department can redraw its
  panel against another chain's rungs; that is display only, because HR's step reads no chain.
- **R6 and R7** stay host rules that leave does not apply, beyond C7 (LQ-2, LQ-3).
- **`apps/api/tests/integration/hr-leave.spec.ts`**: every request there runs with no chain. The
  file never writes one: it makes no `/api/v1/platform/approvals` call and names no
  `pendingApproval`.

### 16.5 Pull request

- **Title.** `feat(hr/leave): leave nobody on the chain can approve takes the manager and HR path (PXQ-1)`.
- **Branch.** `feat/hr-leave-unstaffed-to-hr`, off `main` after PX-1.6 has merged.
- **Content.** API, web and docs in one pull request, because the web must show HR's step on a
  request that also has a trail (16.7). Leave design §16 (this section) is the plan.
- **Size.** About 700 changed lines without LQ-1's task change, about 500 of them tests; about 820
  with it. CONTRIBUTING asks to split above about 500 (`CONTRIBUTING.md:53`). The code is about 200
  lines, and the API and the web must deploy together (16.10), so it stays one pull request. If the
  reviewer asks, LQ-1's change becomes a follow-up pull request of its own.
- **Order of work.** One commit per step, each leaving the tree building with its tests green:
  1. `leave-request.routing.ts` and its unit spec;
  2. the service, model and contract changes, with the suite's helper changes, the rewrites of E1 to
     E4 and the new cases N1 to N7 and N9 to N11, together, because E1 to E4 fail on the new service
     until they are rewritten;
  3. the web view helpers and their spec, the detail page and the i18n keys;
  4. with LQ-1 option 1 only: the repository read, the service method, the task's handler and N8;
  5. the CHANGELOG and the docs of 16.7.
- **Depends on.** PX-1 closed; this plan's design review; LQ-1 to LQ-3 do not block (16.3).
- **Description.** The PR template's checklist filled in (`CONTRIBUTING.md:56-57`); its size and CI
  minutes (RK-01, the 45-minute budget); count LC1 (16.10); the new cases failing on the base commit
  and passing on the head; the rollback note (16.13); which answers of 16.3 it carries.
- **Deploy.** API and web together (16.13).

### 16.6 Data model

No new field, no index and no data change.

- **The hand-over needs no field.** A request a decision handed over is `pendingHr`, or later, with
  engine entries in `approvalSteps[]`, which are already stored. One that LQ-1's task moved before
  any decision may have no entries, and no pin if it was filed before PX-1.4. Either way the audit
  row records the move, as the status change from `pendingApproval` to `pendingHr`.
- **A routed request needs no field.** It is a manager and HR request. Its audit row names the chain
  that nobody staffed (16.2 item 5). It stores no pin, so the pin keeps its meaning: the chain a
  request ran on.
- **The pin is written once.** A handed-over request keeps the pin of its submission. Nothing
  rewrites it.
- **LQ-1's read** (`status: 'pendingApproval'`) is served by `ix_status_start`
  (`leave-request.model.ts:132`).
- **Census rows** (PX-1 re-detail §5): no new path, so neither list gains a row.
- **What becomes untrue in the model** is a comment: "A request carries one or the other, never
  both" (`leave-request.model.ts:32`), and two near it. 16.7 lists every comment the slice
  rewrites, in the model, the service and the leave contract. The engine's comments that a request
  with nobody on its rungs left waits for an override
  (`packages/contracts/src/platform/approvals.ts:105-110`,
  `apps/api/src/platform/approvals/approval-trail.ts:106-109`) describe the engine's own answer,
  which this slice does not change and P2 still relies on, so they stay.

### 16.7 Code changes

**Files.** The pull request writes these and no other; "LQ-1 (1)" marks a file it writes only with
LQ-1 option 1.

| Path | Mark |
|---|---|
| `apps/api/src/modules/hr/leave-management/leave-requests/leave-request.routing.ts` | Create |
| `apps/api/src/modules/hr/leave-management/leave-requests/leave-request.routing.spec.ts` | Create |
| `apps/api/src/modules/hr/leave-management/leave-requests/leave-request.service.ts` | Modify |
| `apps/api/src/modules/hr/leave-management/leave-requests/leave-request.model.ts` | Modify (comments) |
| `apps/api/src/modules/hr/leave-management/leave-requests/leave-request.repository.ts` | Modify, LQ-1 (1) |
| `apps/api/src/modules/hr/hr.module.ts` | Modify, LQ-1 (1) |
| `packages/contracts/src/modules/hr-leave.ts` | Modify (comments) |
| `apps/web/src/modules/hr/leave-management/lib/leave-request-view.ts` | Create |
| `apps/web/src/modules/hr/leave-management/lib/leave-request-view.spec.ts` | Create |
| `apps/web/src/modules/hr/leave-management/pages/LeaveRequestDetailPage.tsx` | Modify |
| `apps/web/src/platform/localization/i18n.ts` | Modify |
| `apps/api/tests/integration/approvals.spec.ts` | Modify |
| `CHANGELOG.md` | Modify |
| `docs/12-planning/leave-management-design.md` | Modify |
| `docs/12-planning/administration-module-phase-px1.md` | Modify |
| `docs/12-planning/administration-module-decisions-and-phases.md` | Modify, only for an answer to LQ-1 to LQ-3 given before the pull request opens and not yet recorded (§16.12) |

**New: `leave-request.routing.ts`**, pure, beside the service. The two rules of 16.2 as functions,
so a unit spec covers each answer of the engine:

```ts
import { type ChainStatus } from '../../../../platform/approvals';

/** Where a new request starts: on the chain only when a rung of it is staffed (16.2 item 1). */
export const initialStatusFor = (
  chain: ChainStatus,
  hasManager: boolean,
): 'pendingApproval' | 'pendingManager' | 'pendingHr' =>
  chain === 'pending' ? 'pendingApproval' : hasManager ? 'pendingManager' : 'pendingHr';

/** Where a request on the chain goes after the engine decides (16.2 item 2). */
export const statusAfterChainDecision = (
  status: ChainStatus,
): 'approved' | 'rejected' | 'pendingApproval' | 'pendingHr' =>
  status === 'approved' || status === 'rejected'
    ? status
    : status === 'pending'
      ? 'pendingApproval'
      : 'pendingHr';
```

`noChain` cannot follow a decision, because `decide` refuses it first (`approval.service.ts:223`).
It maps with `unstaffed`, so the function is total. `ChainStatus` comes from the barrel
(`apps/api/src/platform/approvals/index.ts:11`). With LQ-1 option 1 the file also exports
`chainCannotDecide = (status: ChainStatus): boolean => status !== 'pending'`.

**`leave-request.service.ts`:**

- **Imports** (`:35-42`): add the routing file's functions.
- **`submit`, the routing** (`:325-333`): `initialStatus = initialStatusFor(chain.status,
  employee.employment.managerId !== null)`, and `pin = initialStatus === 'pendingApproval' ?
  pinOf(chain) : null`. The `onEngine` flag goes. The create's spread (`:336-341`) is unchanged, and
  so writes no pin for a routed request.
- **`submit`, its comment** (`:312-324`): the route is chosen at submission. It is the chain only
  when a rung of it is staffed. A chain nobody staffs takes the manager and HR path, as no chain
  does, and never moves to the chain later. The only later move is one way: a request on the chain
  whose remaining rungs nobody holds goes to HR's step and keeps its trail (leave design §16).
- **`submit`, the audit** (`:413-421`): when `chain.status === 'unstaffed'`, add `{ field:
  'unstaffedChain', old: null, new: chain.workflowId }`. `workflowId` is set whenever the answer is
  `unstaffed`, because a row was chosen.
- **`decide`, its comment** (`:486-489`): a request handed to HR's step is `pendingHr` and runs on
  the checks below it. LQ-2 option 2 only: a check before `:499-501`, on `pendingHr`, refuses a
  decider whose id is a `deciderUserId` in `request.approvalSteps`, with
  `new ForbiddenError('you decided an earlier step of this request')`.
- **`decideOnChain`, the status** (`:613-618`): `nextStatus = statusAfterChainDecision(outcome.status)`.
  The write (`:619-641`) is unchanged: it sets whatever `nextStatus` is.
- **`decideOnChain`, the notice** (`:659-667`): after the `rejected` branch, a `pendingHr` branch
  calls `notifyPendingApprover(updated, employee)`, which sends to organization-scope holders for
  `pendingHr` (`:448-451`), and returns `updated`.
- **`decideOnChain`, its comment** (`:577-587`): an answer of nobody left hands the request to HR's
  step in the same write.
- **`trailFor`, its comment** (`:681-692`): a handed-over request keeps its trail and offers no
  decision on it. Its HR step is shown in the page's manager and HR card and decided from the page
  header's buttons, as on any manager and HR request. The code is unchanged.
- **`notifyChainApprovers`, its comment** (`:717-722`): a decision no longer leaves a request
  `unstaffed` on the chain. An empty list now means that a rung's holders left while it waited
  (LQ-1).
- **LQ-1 option 1 only.** A method `handOverStuckToHr(): Promise<string[]>`, placed before
  `remindPendingApprovals` (`:1305`):
  - it reads every request on the chain (`leaveRequestRepository.findOnChain()`, below);
  - for each, it loads the employee (it skips the request if there is none) and asks
    `approvalService.statusFor(this.subjectOf(request, await this.unitOf(employee)))`;
  - when `chainCannotDecide` holds, it writes `pendingHr` with the same filter as `decideOnChain`'s
    write (`status: 'pendingApproval'`, no entry at index `approvalSteps.length`, not deleted) and
    `$inc: { __v: 1 }`; a null result means a decision won, and it skips the request. With LQ-1
    option 2 instead, it writes `pendingManager` for a request with no entries whose employee has a
    manager, and `pendingHr` otherwise;
  - it records `{ action: 'update', changes: [{ field: 'status', old: 'pendingApproval', new:
    'pendingHr' }, { field: 'chainStatus', old: null, new: <the answer> }] }` on the request through
    `auditService.record`, which writes a null actor when no request context holds one
    (`apps/api/src/platform/audit/audit.service.ts:162`), as the job-offer expiry sweep's
    system-driven transitions are audited with no actor
    (`apps/api/src/modules/hr/recruitment/job-offers/job-offer.service.ts:402-428`);
  - it emits no `hr.leave.*` event: the move is not a decision, and §9's events name decisions,
    cancellations and the leave's start and end;
  - it calls `notifyPendingApprover(updated, employee)`;
  - each request runs in its own `try`, logged with `logger.warn` on failure, as
    `activateDueStarted` does (`:1254-1265`);
  - it never writes `approved` or `rejected`, and never writes an engine entry;
  - it returns the ids it moved.
  `remindPendingApprovals` (`:1305-1333`) takes `skip: ReadonlySet<string> = new Set()` and skips
  those ids, so a moved request gets one notice that morning, not two. It returns the number of
  requests it reminded, so the skipped ids are not counted.

**`leave-request.repository.ts`** (LQ-1 option 1 only): `findOnChain(): Promise<LeaveRequestEntity[]>`
after `findPendingSince` (`:66-76`). It reads `{ status: 'pendingApproval', isDeleted: false }`,
sorted by `createdAt`, hydrated (as `findDueToActivate`, `:51-56`), so a missing pin reads as its
defaults (PX-1 re-detail §5).

**`apps/api/src/modules/hr/hr.module.ts:2274-2283`** (LQ-1 option 1 only): the handler runs
`const moved = await leaveRequestService.handOverStuckToHr()` and then
`await leaveRequestService.remindPendingApprovals(new Set(moved))`. Its description, today
`'Remind approvers about stale pending leave requests'`, becomes
`'Hand leave requests nobody on their chain can decide to HR, then remind approvers about stale pending leave requests'`.
The key and the cron stay.

**`leave-request.model.ts`**, comments only:

- `:32`: a request starts with one list or the other, settled at submission. A request handed to HR
  after engine decisions carries both: the engine's entries up to the hand-over, then HR's decision
  in `approvals`.
- `:62`: `approvalSteps` is empty on a request that took the manager and HR path at submission.
- `:68`: such a request has empty pin fields. A handed-over request keeps its own.

**`packages/contracts/src/modules/hr-leave.ts`**, comments only:

- `:223-224`: requests filed before a chain was written, and requests on a chain nobody staffs,
  take the manager and HR path and finish on it. A request on a chain that nobody can take further
  goes to `pendingHr`.
- `:346-347`: `pendingStep` is null while the engine runs a request. A handed-over request reads
  `hr`.
- `:351`: `approvalTrail` is null when the request has no engine entries and is not on the chain.

**New: `apps/web/src/modules/hr/leave-management/lib/leave-request-view.ts`**, pure, so a spec proves
the page's three conditions without a DOM: the web suite runs in node with no jsdom
(`apps/web/vitest.config.ts`), and pure view helpers with a spec beside them are how other modules
test what a page shows (`apps/web/src/modules/administration/lib/supplier-view.ts`). These three
conditions are 16.2 item 7, and 16.13's rollback reasoning rests on them.

```ts
import { type LeaveRequestDto } from '@ecms/contracts';

const isPending = (status: LeaveRequestDto['status']): boolean =>
  status === 'pendingManager' || status === 'pendingHr' || status === 'pendingApproval';

/** Whether the page header offers Approve and Reject: the trail's flags only while the chain decides. */
export const mayDecideOn = (request: LeaveRequestDto): boolean =>
  request.status === 'pendingApproval' && request.approvalTrail !== null
    ? request.approvalTrail.viewerMayDecide || request.approvalTrail.viewerMayOverride
    : isPending(request.status);

/** Whether the manager and HR card is drawn: with no trail, and beside the trail once HR's step exists. */
export const showsDeskCard = (request: LeaveRequestDto): boolean =>
  request.approvalTrail === null || request.approvals.length > 0 || request.pendingStep !== null;

/** Whether the card is a handed-over request's HR step: its own heading and the line that says why. */
export const showsHandedToHr = (request: LeaveRequestDto): boolean =>
  request.approvalTrail !== null && showsDeskCard(request);
```

**`apps/web/src/modules/hr/leave-management/pages/LeaveRequestDetailPage.tsx`:**

- `:58-70`: `mayDecide` becomes `mayDecideOn(request)`. A handed-over request is then offered its
  decision as any manager and HR request is, and every other case reads as today. The comment says
  that the trail's flags answer only while the request is on the chain.
- `:195`: the card's condition becomes `showsDeskCard(request)`, so a handed-over request shows the
  card beside the chain panel. The comment at `:190-192` says that the two are drawn together only
  on a handed-over request, under different headings, and why.
- `:198`: the heading is `t(showsHandedToHr(request) ? 'leave.detail.hrStep' : 'leave.detail.approvals')`,
  so the two cards never share the title "Approval chain". Under it, when `showsHandedToHr(request)`,
  one line, `t('leave.detail.handedToHr')`, in the panel's notice style
  (`apps/web/src/platform/approvals/ApprovalChainPanel.tsx:125-128`).
- Before this edit, the implementer runs the `ui-consistency:finding-patterns` skill for this page.
  It counts how the project's pages draw a card heading and a notice line, and writes the checklist
  this edit follows, as the administration plans run their `ui-consistency` pass before a page
  change (`docs/12-planning/administration-module-phase-2.md:1099`).

**`apps/web/src/platform/localization/i18n.ts`:** two keys after `:1991` (English) and `:18362`
(Arabic). Each line uses the panel's own term for the chain, "approval chain" (`approvals.title`,
`:1892`) and «مسار الموافقة» (`:18253`), and the same verb, decide, in both languages:

| Key | English | Arabic |
|---|---|---|
| `leave.detail.hrStep` | HR step | خطوة الموارد البشرية |
| `leave.detail.handedToHr` | Nobody on the approval chain could decide the remaining steps, so the request went to HR. | لم يكن في مسار الموافقة من يستطيع البتّ في الخطوات الباقية، فحُوِّل الطلب إلى الموارد البشرية. |

**`CHANGELOG.md`**, `[Unreleased]`, `### Changed`, one entry:

> **HR leave: a request nobody on its approval chain can approve takes the manager and HR path
> (PXQ-1).** A new request on a chain with nobody holding any rung goes to the employee's manager,
> or to HR when there is none, as a request with no chain does. A request whose remaining rungs
> nobody holds after an approval goes to HR's step, keeping the chain's record; its page shows both.
> Managers and HR receive requests that used to wait on the chain with no notice to anyone who could
> decide them. The approvals engine is unchanged. Count LC1 (leave design §16.10) is in the pull
> request. Rollback: revert API and web together (leave design §16.13).

**Docs.** In this file, each edit adds the sentence given:

- §3's first paragraph (`:81-84`): "`pendingApproval` is a request on a configured approval chain.
  A request starts on the chain only when a rung of it is staffed; otherwise it takes the manager and
  HR path (§16)."
- §3's Decide bullet (`:95`): "A request on the chain is decided by the approvals engine; when a
  decision leaves nobody on the rungs that remain, it goes to HR's step (§16.2)."
- §6 (`:156-157`): "A request handed to HR after engine decisions carries both lists."
- §9's Audit bullet (`:217`): "A submission on a chain nobody staffs adds the change
  `unstaffedChain` to its `leaveRequest` row." With LQ-1 option 1 also: "The daily task's move to
  HR's step is an `update` row with `status` and `chainStatus`."
- With LQ-1 option 1, §10's reminder row (`:232`): "first hands requests nobody on their chain can
  decide to HR's step (§16.7)".
- This section's Status line: the pull request's number, and "Built".

In `docs/12-planning/administration-module-phase-px1.md`, PXQ-1's "Answered" bullet
(`administration-module-phase-px1.md:158-159`) gains: "Applied by leave design §16, pull request
#<n>." In `docs/12-planning/administration-module-decisions-and-phases.md`, §16.12 gains a row for
each answer to LQ-1 to LQ-3 given before the pull request opens, if it is not yet recorded, and this
section's question then names it.

### 16.8 Tests

**Unit.** A new
`apps/api/src/modules/hr/leave-management/leave-requests/leave-request.routing.spec.ts`, pure,
beside the file it tests as the module's other unit spec is
(`apps/api/src/modules/hr/leave-management/leave-types/entitled-days.spec.ts`), so
`npm run test:unit -w apps/api` (`vitest run src`, `apps/api/package.json:17`) runs it:

- `initialStatusFor`: `pending` gives `pendingApproval`, with or without a manager; `unstaffed` and
  `noChain` give `pendingManager` with a manager and `pendingHr` without; `approved` and `rejected`,
  which cannot occur with no decisions, take the manager and HR path too.
- `statusAfterChainDecision`: `approved`, `rejected` and `pending` as today; `unstaffed` and
  `noChain` give `pendingHr`.
- With LQ-1 option 1: `chainCannotDecide` is false for `pending` only.

**Integration.** New cases go in the suite, in one new `describe` at its end, after PX-1.6's cases.
No new integration file (RK-01). Helpers:

- `regEmployee` (`approvals.spec.ts:120-158`) takes an optional object spread into `employment`, as
  the leave suite's does (`hr-leave.spec.ts:105-141`), so a case can give an employee a manager.
- `file` (`approvals.spec.ts:245-253`) takes an optional `{ emp, ess, typeId }`, to file for that
  employee and, for N11, a type other than annual. `SICK_ID` is read beside `ANNUAL_ID` (`:316-318`).
- The PX-1.4 block's `putChain` (`approvals.spec.ts:833-843`), which returns the chain's DTO, moves
  to the top level next to `writeChain` (`:545-555`), and `writeChain` calls it.
- `told(userId, template, requestId)` counts `NotificationModel` rows by recipient and template, as
  the R1 case does (`:878-882`), and by `'entityRef.entityId': requestId`, so a count is for one
  request. N8's reminder checks and N7's "no notice" use the same filter without a recipient.
- `stale(id)` moves a request's `createdAt` four days back with a collection-level update,
  `LeaveRequestModel.collection.updateOne({ _id }, { $set: { createdAt } })`, as the criterion 4
  guard unsets the pin (`:921-924`): the base schema's timestamps keep `createdAt` immutable through
  the model (`apps/api/src/shared/base/base.model.ts:27`).
- A case that grants `leave.approve` to `branch@ecms.local` (`branchApproverId`, `:373`, an id only)
  logs that account in after the grant to read and decide as it, and revokes the grant in `finally`,
  as the R4 and R8 cases do (`:697-699`, `:814-816`). A case that revokes HR's organization grant
  restores it in `finally`, as E2 does (`:621-622`, `:657-659`).

**Employees and days.** The N cases do not file for the suite's shared employee, whose 15 days of
next-year headroom (`:189-201`, `:399`) the existing cases already come close to filling on a run
late in the year: every request that is neither rejected nor cancelled keeps its day reserved. The
new `describe`'s `beforeAll` registers its own employee, `nEmp`, with `regEmployee`,
`activateEssLogin` and `grantNextYearHeadroom`, and every N case files for it, except N2, whose
employee is registered the same three ways with a manager. Each case files on its own offset, one
annual day unless stated: N1 7, N2 7 (its own employee), N3 14, N4 21, N5 28, N6 35, N7 42, N8 49
(A), 56 (B) and 63 (C), N9 70, N10 77, N11 84 (sick leave, which reserves nothing). At most nine of
`nEmp`'s requests keep a day, within its 21-day grant or its 15 days of headroom, whichever year
they fall in.

| # | Case | Checks |
|---|---|---|
| N1 | A chain whose only rung nobody holds (`[BRANCH_RUNG]`) sends a new request down the manager and HR path. `nEmp` has no manager | `pendingHr`; `approvalTrail` null; `pendingStep` `hr`; on the row, `approvalWorkflowId` null and `approvalChainShape` empty; the `leaveRequest` audit row carries `unstaffedChain` with the chain's id; `leave.requestSubmitted` to the HR approver, one more; HR approves: `approved`, `approvals` is one `{ step: 'hr' }` by HR, `approvalSteps` empty; no `platform/approval` row under that decision's request id |
| N2 | The same chain, for an employee with a manager (a new account placed in the branch, set as `managerId`) | `pendingManager`; `leave.requestSubmitted` to the manager; the manager approves by relationship: `approved` (annual is `managerOnly`), `approvals` is one `{ step: 'manager' }` |
| N3 | `[UNIT_RUNG, BRANCH_RUNG]`: the unit holder approves, and nobody holds the branch rung that is left | `pendingHr`; `pendingStep` `hr`; trail outcomes `approved`, `pending`, `currentStep` null; `chainStatus` reads `unstaffed`; `leave.requestSubmitted` to the HR approver, one more; one `leaveDecision` row with `status` `pendingHr` and one `platform/approval` row `hr.leave:0`; the organization-scope override reads `viewerMayOverride: false` and is refused 403; HR approves: `approved`, `approvals` is one `{ step: 'hr' }` by HR, `approvalSteps` still one entry, `leaveDecision` statuses `pendingHr` then `approved`, and still one `platform/approval` row for the request |
| N4 | As N3 to the hand-over; then a branch grant of `leave.approve` to `branch@ecms.local` staffs the branch rung, which nobody held in N3; the case logs that account in, and revokes the grant in `finally` | `chainStatus` reads `pending`, and the request stays `pendingHr`; the branch holder reads `currentStep` null and no flags; the branch holder's approval is HR's step (`{ step: 'hr' }`) and gives `approved`; `approvalSteps` unchanged |
| N5 | As N3 to the hand-over; HR rejects | `rejected`; the year's reserved days back to their value before the request; `leave.requestRejected` to the employee |
| N6 | As N3 to the hand-over; the employee cancels | `cancelled`; no flags on the trail; the days released; `leave.requestCancelled` to the HR approver (no manager) |
| N7 | LQ-2. `[BRANCH_RUNG, ORGANIZATION_RUNG]`, with a branch grant to `branch@ecms.local` (logged in after it, revoked in `finally`), and HR's organization grant revoked for the case and restored in `finally`. The branch holder approves, and the request is handed over | with option 1, the branch holder decides HR's step to `approved`; with option 2, the same decision is refused 403 with `you decided an earlier step of this request`. Either way, with nobody holding `leave.approve` company-wide in force, no `leave.requestSubmitted` for this request goes out at the hand-over (16.12, LR-2) |
| N8 | LQ-1 option 1. Request A on `[BRANCH_RUNG]` with a branch grant to `branch@ecms.local`, which is then revoked (`unstaffed`, no decision); request B on `[UNIT_RUNG]` (`pending`); request C on `[UNIT_RUNG]` with its pin fields unset, as the criterion 4 guard does (`:921-924`), and that chain then deleted (`noChain`). `stale` moves A, B and C four days back, so the reminder reads them as stale | the ids `handOverStuckToHr()` returns include A and C and not B (other rows of the shared database may move too, so the case asserts membership, not the whole list); A and C are `pendingHr`, each with one `update` audit row (`status` and `chainStatus`), and the HR approver is told of each (`told`, by request); B stays `pendingApproval`; a second run's ids include neither A nor C; `remindPendingApprovals` with the first run's set sends `leave.approvalReminder` with B's `entityRef` and none with A's or C's |
| N9 | 16.2 item 2, an override's decision. `[BRANCH_RUNG, DEPARTMENT_RUNG]`, filed while a branch grant to `branch@ecms.local` staffs the first rung, the grant revoked in a `finally` around the filing, so the request reads `unstaffed` at rung 0 with nobody on rung 1. The organization-scope override approves | `pendingHr`; outcomes `['approved', APPROVAL_OVERRIDE_KEY]`, `['pending', null]`; one `leaveDecision` row with `status` `pendingHr`; `leave.requestSubmitted` for this request to the HR approver; HR approves: `approved` |
| N10 | 16.2 item 2, a request with no pin. As N3, with its pin fields unset right after filing, as the criterion 4 guard does (`:921-924`) | after the unit holder's approval, `pendingHr`, its trail drawn on the live chain (`workflowId` the live row's id, outcomes `approved`, `pending`); HR approves: `approved` |
| N11 | 16.9, the certificate gate. Sick leave (`SICK_ID`, `requiresAttachment` with the default `beforeApproval`) on `[UNIT_RUNG, BRANCH_RUNG]`, filed with no attachment; the unit holder approves | the hand-over needs no attachment: `pendingHr` (`leave-request.service.ts:605-611`); HR's approve is refused 422 with `an attachment is required before approval` (`leave-request.service.ts:510-518`); the employee attaches a file (`POST /:id/attachments`, as `hr-leave.spec.ts:578-582`); HR approves: `approved` |

**Existing cases that change.**

| Case | Now | After this slice |
|---|---|---|
| E1, PX-1.2, "a request whose only rung nobody holds waits unstaffed" (`approvals.spec.ts:588-616`) | a new request on `[BRANCH_RUNG]` waits `unstaffed` | it would take the manager and HR path. It reaches `unstaffed` another way: a branch grant to `branch@ecms.local` staffs the rung, the request is filed (`pending`) inside a `try` whose `finally` revokes the grant, and the chain then reads `unstaffed`. Its R2 and R4 assertions stay: `currentStep` 0, the other branch's override refused `approvals.notYourStep`, the organization-scope override approves. Its name becomes "R2, R4: a request whose only rung loses its holder after submission waits unstaffed; an override over the other branch is refused, an organization-scope one approves it" |
| E2, PX-1.2, "the unit holder's approval leaves a request with nobody on its organization rung waiting unstaffed" (`:618-660`) | the request stays `pendingApproval`, and an organization-scope override approves it | the approval hands it to HR's step: `pendingHr`, outcomes `approved`, `pending`, `currentStep` null, `chainStatus` `unstaffed`; the branch and organization-scope overrides read no flags and are refused 403. The case ends there, and its `finally` restores HR's grant. The R4 rule by level stays covered by `:662-700`, and an override's decision that hands a request over by N9. Its name becomes "R2, PXQ-1: the unit holder's approval, with nobody on the organization rung, hands the request to HR's step, where no override decides" |
| E3, PX-1.2, the cancelled-request case, its second half (`:733-747`) | an approval leaves `[UNIT_RUNG, DEPARTMENT_RUNG]` unstaffed | its chain becomes `[BRANCH_RUNG]`, and it reaches `unstaffed` as E1 does, with no decision: the branch grant, the filing, the revoke in `finally`. The organization-scope override reads `viewerMayOverride` true; the employee cancels; the trail reads no flags. The unit rung stays out of it, because the unit approver holds it for the whole suite |
| E4, PX-1.3, R8, its second half (`:809-813`) | a request on a rung held only by a suspended account waits `unstaffed` | it takes the manager and HR path: `pendingHr`, trail null, no pin. Its name (`:782`) becomes "R8: a rung whose only holder is suspended is passed when a staffed rung follows, and as the only rung sends the request down the manager and HR path" |
| PX-1.6's off-type case (not on this tree) | a new request on a chain with an off-type rung reads that rung unstaffed | if the chain has no other staffed rung, the new request takes the manager and HR path; the case asserts that |

**Unchanged.** The suite's other cases: PX-1.1's (`:411-521`), the R4 staffed-chain case
(`:662-700`), the R3 case (`:752-780`), the first half of the R8 case, both PX-1.4 cases
(`:848-940`), and PX-1.6's `basedOn` cases. `hr-leave.spec.ts` (16.4). The engine's unit specs.
`org-catalog.spec.ts`. The two Arabic strings are checked by
`apps/web/src/platform/localization/formal-arabic.spec.ts`.

**Web.** A new `apps/web/src/modules/hr/leave-management/lib/leave-request-view.spec.ts`, pure, on
`LeaveRequestDto` fixtures, run by `npm run test -w apps/web` (CI's "Test — web" step,
`.github/workflows/ci.yml:68-69`):

- (a) `pendingApproval` with a trail: `mayDecideOn` follows the flags, false with neither, true with
  `viewerMayDecide` or `viewerMayOverride`; `showsDeskCard` false.
- (b) A handed-over request, `pendingHr` with a trail and `pendingStep` `hr`: `mayDecideOn`,
  `showsDeskCard` and `showsHandedToHr` all true, the trail's flags false.
- (c) After HR decided it, `approved` with a trail and one `{ step: 'hr' }` in `approvals`: the card
  and the line, and no decision.
- (d) A request LQ-1's task moved with no entries, `pendingHr` with no trail: `mayDecideOn` and
  `showsDeskCard` true, `showsHandedToHr` false.
- (e) An engine request approved, rejected or cancelled, a handed-over one cancelled before HR
  decided included, with a trail and no `approvals`: no card, no line, no decision.
- (f) A routed request, `pendingManager` or `pendingHr` with no trail: the card without the line,
  and `mayDecideOn` true.

### 16.9 Edge cases

- **A pinned request.** A routed request has no pin. A handed-over request keeps its pin, and its
  trail is drawn on it (`:124-138`). HR's step reads neither. A handed-over request with no pin
  draws its trail from the live chain (`:693-700`), so a later edit or a department link redraws
  its panel (16.4); HR's step does not read it.
- **A request on the chain with no pin** (filed before PX-1.4). After a decision the same rule
  applies, on its live chain. If its chain was deleted it falls back to the next wider chain that
  matches, and reads `noChain` only when none does (ADR-041 decision 10;
  `apps/api/src/platform/approvals/approval.service.ts:390-393`). `decide` refuses `noChain` for
  everyone; that request's way out is a cancellation, or LQ-1 option 1.
- **A chain that is staffed again.** A routed request stays on the manager and HR path (`:312-315`).
  A handed-over request stays on HR's step (N4). A request still on the chain whose holder comes
  back before any move continues on the chain.
- **An override holder deciding meanwhile.** While a request is on the chain and reads `unstaffed`
  (LQ-1's window), an override within reach may decide the rung to decide. If that leaves nobody on
  the rungs left, the decision hands the request to HR (16.2 item 2). If it settles the last rung,
  the request is approved. On a handed-over request an override reaches nothing: HR's step needs
  `leave.approve` (`:499-501`), and the trail offers nothing. A decision and LQ-1's task never both
  write: both writes need `pendingApproval` and the same trail length, so the second finds nothing.
  A losing decision gets 409 `the request was already decided` (`:641`); the task skips.
- **Cancellation.** A routed or handed-over request is cancelled as any manager and HR request
  (`:972-998`), and tells the manager or organization-scope holders (`:1014-1025`). Cancelled, it
  offers nothing on its trail. A handed-over request cancelled before HR decided has neither an HR
  decision nor a pending step, so the page shows its chain panel alone (16.8, Web, case (e)).
- **A more specific chain that nobody staffs** is not replaced by a wider chain that is staffed. The
  engine picks the most specific row (`approval-chain.ts:41-56`), and 16.2 then routes the request.
- **The certificate gate.** A hand-over is not an approval. For a `beforeApproval` type it needs no
  attachment, and HR's approval then does. For an `atSubmission` type, every decision needs one
  first, the handing-over decision included (`:605-611`).
- **A request handed over by LQ-1's task with no engine entries** has no trail to draw
  (`:694`). The page shows the manager and HR card only, without the line of 16.2 item 7. Its audit
  row says what happened.
- **Requests already waiting `unstaffed`.** Requests stamped `pendingApproval` on an `unstaffed`
  chain while PX-1's option 3 applied are not re-routed by the deploy (16.10).
- **The employee is the only holder** (LQ-3): unchanged.
- **Exit settlement** cancels a `pendingHr` request as any open request (`:1214-1242`).

### 16.10 Migration posture

- **No backfill.** The rule acts on new submissions and new decisions. Nothing rewrites existing
  rows at deploy. No migration command, boot step or index ships.
- **Requests already on an `unstaffed` chain** stay `pendingApproval`. A decision on them follows
  16.2 from the deploy on. Without LQ-1 option 1, they wait for an override or a cancellation, as
  PX-1 leaves them. With it, the daily task moves them at its first run. That is the rule applied at
  run time, conditional and audited, as the scheduler activates approved leave. It is not a data
  migration.
- **No destructive operation and no production migration.** The owner's rule requires the owner's
  explicit approval for either («لا تعمل destructive operation أو production migration بدون موافقتي
  الصريحة», [Administrative Affairs design](administration-module-design.md) §0, D-17). This slice
  needs neither.
- **Read-only counts.** The owner, or an operator the owner names, runs them on production, since
  the implementer may have no production access.

  | Count | `mongosh` | Reported |
  |---|---|---|
  | **LC1** requests on a chain | `db.hr_leave_requests.countDocuments({ status: 'pendingApproval', isDeleted: false })` | in the pull request's description, before it deploys |
  | **LC2** handed-over requests | `db.hr_leave_requests.countDocuments({ status: 'pendingHr', isDeleted: false, 'approvalSteps.0': { $exists: true } })` | before any rollback (16.13) |

  LC1 bounds what LQ-1's first run can move. Which of those requests nobody on the chain can decide
  is the engine's answer, not `mongosh`'s, so the first run may move fewer.

- **Deploy.** API and web together. An API ahead of the web hands requests over that the older page
  shows without buttons (16.13).

### 16.11 Exit criteria

1. **The rule, tested.** N1 to N7 and N9 to N11 pass, and N8 with LQ-1 option 1. Each fails on the
   base commit, which the description shows.
2. **The rewritten cases pass.** E1 to E4, and PX-1.6's off-type case as 16.8 says.
3. **The unit specs.** `leave-request.routing.spec.ts` exists beside the routing file and passes in
   `npm run test:unit -w apps/api`. `leave-request-view.spec.ts` exists beside the view helpers,
   covers cases (a) to (f) of 16.8's Web list, and passes in `npm run test -w apps/web`; the page
   reads its three conditions only through those helpers.
4. **Nothing else moves.** `hr-leave.spec.ts` is unchanged and green. The diff touches no file under
   `apps/api/src/platform/approvals/` and no type in `packages/contracts`. It adds no field, index,
   permission key, audit verb, event, template, realtime topic, setting or scheduler task. The
   permission-matrix check has nothing to regenerate.
5. **Gates.** `npm run lint`, `typecheck`, `test:unit`, `test:integration`, `build`,
   `check:permission-matrix` and `check:flag-expiry` pass (`CONTRIBUTING.md:35-41`), and so do CI's
   web suite (`npm run test -w apps/web`) and the formal-Arabic check.
6. **Docs.** 16.7's doc edits and the CHANGELOG entry are in the pull request. Each answer to LQ-1 to
   LQ-3 given before it opens is in the decision log and named here.
7. **Counts.** LC1 is in the description before the deploy. The implementer tells the owner, in
   Arabic and before the deploy, what LC1 means: with LQ-1 option 1, the most requests the task's
   first run can move to HR's step; without it, the requests that keep waiting on the chain.

### 16.12 Risks

| # | Risk | L | I | Mitigation |
|---|---|---|---|---|
| LR-1 | **The panel still reads "Waiting" on rungs nobody reached.** After HR decides a handed-over request, its chain panel shows those rungs as `pending`, as on a cancelled request today | H | L | The card's line says why (16.2 item 7). A new outcome would be a contract and engine change, outside this slice |
| LR-2 | **The notice at a hand-over can find nobody.** It goes to organization-scope holders of `leave.approve`. If the rung left empty was an organization rung, there are none in force | M | M | As on the manager and HR path today. The HR queue lists the request to every holder of `leave.approve` whose scope covers the employee (`leave-request.repository.ts:117-127`). N7 pins the behavior |
| LR-3 | **The page header offers Approve and Reject on HR's step to anybody who can open a pending request**, as on the manager and HR path today: the buttons are header actions gated by `mayDecide` only, not part of the card (`LeaveRequestDetailPage.tsx:61-70, 111-118`) | M | L | The server decides. The employee is refused under C7 (`:482-485`); anybody else without `leave.approve` over the employee gets 403 `this step requires leave.approve` (`:499-501`) |
| LR-4 | **One person can decide a rung and HR's step** | L | M | LQ-2 |
| LR-5 | **Managers receive requests they did not before.** A request on an `unstaffed` chain used to wait with no notice to anyone who could decide it; now it goes to the manager, then HR where the type asks | M | L | Intended by PXQ-1's answer. The CHANGELOG entry (16.7) says what managers and HR now receive, and LC1 is reported before the deploy (16.11 item 7) |
| LR-6 | **Rollback hides HR's buttons** on handed-over requests | L | M | 16.13; LC2 sizes it |
| LR-7 | **CI time.** Eleven cases join one integration file | M | L | No new integration file; the description reports minutes (RK-01) |
| LR-8 | **Line pins move** with PX-1.5 and PX-1.6 | H | L | The pull request re-pins on its base (Line pins, above) |
| LR-9 | **LQ-1's first run moves a backlog at once**, with one notice each | L | L | LC1 bounds it; the implementer gives the owner LC1 before the deploy (16.11 item 7) |

### 16.13 Rollback

Revert the pull request, API and web together (RK-30). Nothing is undone in the data.

- A routed request is an ordinary manager and HR request, and the older code runs it as one.
- A handed-over request is `pendingHr` with an engine trail. The older API decides it on the manager
  and HR path. The older page hides its buttons, because it reads a trail's flags whenever there is
  a trail (`LeaveRequestDetailPage.tsx:67-70`), and leave clears them off `pendingApproval`. HR can
  decide it once the slice is redeployed, and the employee can still cancel it. Count LC2 before the
  rollback says how many there are.
- A request LQ-1's task moved with no engine entries has no trail, so the older page offers its
  buttons.
- The `unstaffedChain` changes and `update` rows stay as history.
- After the rollback, new requests on an `unstaffed` chain wait on it again, as PX-1 leaves them.

## Review trail

Adversarial review amendments **R1–R15** (atomic balance gate; overlap recheck; conditional
decisions; approval catch-up; status-drive failure semantics; `driveLeaveAction` seam;
submission-time freezing + `paidBreakdown`; timeline dynamic import; relationship authorization +
visibility matrix; Cairo date rule; `typeId`/`balanceTypeId` split; exit/rehire closure;
half-day constraint; own-scope shapes; migration plan) and final consistency fixes **C1–C8**
(`workCalendar.*` permission/setting naming; final request-status enum without a draft state;
per-type negative cap; balance rows for banked types only; per-year caps inside the post-insert
recheck; self-decision binds the subject; ESS grant as migration step ④) are incorporated above.
**C1 was subsequently re-reviewed and REVISED (C1-R)**: the original service-level-only
resolution was rejected because it breaks the platform's declarative scoping idiom (a repo call
with an own-scope selector would silently apply `createdBy` semantics) and forces every future
employee-subject module to reimplement own-scope. Final architecture: restore the
`ownerUserField` platform seam + creation-time `employeeUserId` denormalization, close the
pre-login staleness flaw with the `hr.employee.loginLinked` event + idempotent backfill, and
keep service-level userId matching for single-target endpoints (§8).

**2026-11-25, §16 (PXQ-1), design review.** **Plan check** preset, as the design-review skill runs
it (`.claude/skills/design-review/SKILL.md`), on §16, lines 283-866 as reviewed, with
`implementation-readiness-standard.md`.

- **Reviewers run.** E `egm-implementation-readiness`, `egm-codebase-details` and `egm-style`. Not
  run: none.
- **Findings.** 43, 13 Major and 30 Nit, merged by the verifier into 33.
- **Dropped under (a)–(d).** Two parts of kept findings. Under (d): that N7's "no notice" check could
  count the lapsed approver's expired organization grant; the notification fan-out reads grants in
  force only (`apps/api/src/platform/rbac/rbac.repository.ts:267-296`). Under (c): that the page's
  buttons newly show to the employee and the line manager; LR-3 already said they show to anybody
  who can open a pending request.
- **Fixed: all 33.**
  - *Tests.* The web conditions move into pure view helpers with a spec, cases (a) to (f), and an
    exit criterion. The N cases file for an employee of their own, on stated offsets, so the
    shared employee's next-year headroom cannot run out. Three cases join, N9 to N11: an override's
    decision that hands a request over, an unpinned hand-over, and the certificate gate. N4, N7 and
    N8 state their logins, revokes, `createdAt` move and per-request notice filter, and N8 asserts
    membership. The rewrites of E1 to E4 state their method and names.
  - *Boundary.* A file table with Create and Modify marks, the decision log included; the unit spec's
    path and runner (`test:unit`); an order of work in five commits; the PR template.
  - *Screen.* On a handed-over request the card is headed "HR step", so the two cards never share
    "Approval chain", and the new line uses the panel's terms, «مسار الموافقة» and the verb decide.
  - *Questions.* LQ-1's options and Arabic say that option 1 also moves, at its first run, the
    requests already waiting. LQ-2's recommendation no longer quotes the answer, and its evidence and
    Arabic name PRQ-4. LQ-3's evidence now separates what leave can see host-side
    (`currentApprovers` and the rungs' `staffed` flags) from what needs the engine; it gains that
    host-only option, which is now the recommendation.
  - *Accuracy and wording.* The heading and PR title say "takes the manager and HR path"; the
    mapper pin and `pendingStep`'s null; the bare-pin rule; an unpinned handed-over request still
    draws its live chain; the deleted-chain fallback; ADR-041's "Later changes" clause; the contract
    comment on a null trail; Terms; Source's quotation; LR-3, LR-5 and LR-9; the routes; the D-17
    link; the open LQ-1 option 1 details (refusal text, audit precedent, no event, the reminder's
    count, the task's description).
- **Contested, accepted, declined, open.** None.
- **Escalated.** No new question. LQ-1 to LQ-3 (16.3) stay open for the owner, as revised above; until
  answered, LQ-1 option 3, LQ-2 option 1 and LQ-3 option 3 apply.
