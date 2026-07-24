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

Statuses (C3 — final enum): `pendingManager | pendingHr | approved | active | completed |
rejected | cancelled`. Submission creates the request directly in its first pending step
(no draft/submitted state): `pendingManager`, or `pendingHr` when the employee has no manager or
the manager step is vacant.

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
  deadlock). Decisions are status-conditional atomic updates with a `version` guard (R3).
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
`attachments: fileId[]`, status, `approvals[]`, `actualReturnDate`, `statusDriveOutcome`,
`version`, createdBy; indexes `(employeeId, status, startDate)`, `(status, startDate)`,
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
  Requests immutable after decision; every ledger `adjust` pairs with an audit record.
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
