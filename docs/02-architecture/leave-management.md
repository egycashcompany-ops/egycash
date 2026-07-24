# Leave Management — Architecture

> Companion to the frozen design (`docs/12-planning/leave-management-design.md`), which remains
> the single source of truth for the business rules and the recorded decisions (L1–L8, R1–R15,
> C1–C8 + C1-R). This page maps the design onto the codebase.

## Placement

| Feature | Owns | Collections |
|---|---|---|
| `hr/work-calendar` | Weekend setting + public-holiday catalog + day counting (shared with future Attendance) | `hr_holidays` |
| `hr/leave-management/leave-types` | The policy catalog — law as editable data (L4) — and the pure entitlement calculator | `hr_leave_types` |
| `hr/leave-management/leave-balances` | The append-only ledger, the balance cache **and** the atomic reservation gate (R1), grants/carryover/expiry, year-end | `hr_leave_ledger`, `hr_leave_balances` |
| `hr/leave-management/leave-requests` | The request lifecycle, approvals, attachments, eligibility preflight, subscribers and scheduler entries | `hr_leave_requests` |

Dependency direction: `leave-management → employee-management → recruitment → platform` (acyclic).
Changes to pre-existing code are three additive touchpoints plus one platform option: the
engine's `driveLeaveAction` seam (§ below), `createLogin` emitting `hr.employee.loginLinked`
(C1-R), the profile hub's lazy Leave tab, and the opt-in `ownerUserField` base-repository
option that lets `own` scope match the SUBJECT employee's user.

## The lifecycle in one paragraph

Submit (self-service or HR on-behalf; soft rules block self, HR overrides them — L8) freezes
the day count from the Cairo work calendar (R7/R10), then reserves through the balance cache's
conditional update — the ONLY code path that increases `reserved` (R1) — with an
insert-then-recheck for overlap and per-year caps (R2/C6). The pending step binds DYNAMICALLY
to the employee's current manager (R9b); decisions are relationship-or-permission authorized in
the service (route authenticates only — the documented R9 deviation) and applied as
status-conditional updates (R3). Approval catches up synchronously when the start (or the whole
span) is already past (R4). Activation drives `leaveStart` through the Personnel Actions engine
for status-affecting types, attributed to the approver; completion converts the reservation to
dated consumption with a `paidBreakdown` snapshot (the frozen Payroll read contract) and drives
`leaveEnd`. Drive failures NEVER roll the leave back — `statusDriveOutcome` records them and HR
is notified (R5): the absence is a fact, the status a projection.

## Ledger sign conventions (§4)

`grant`/`carryover` add to their cache columns · `reserve` adds to `reserved` · `release`
subtracts from `reserved` · `consume` moves `reserved` → `consumed` · `adjust` is signed into
`adjusted` · `expire` subtracts from `adjusted`. `available = granted + carriedOver + adjusted −
reserved − consumed`. Unique ledger keys — `(requestId, kind, year)` and `(employee,
balanceType, year, grant|carryover)` — make every scheduler, migration and event write
idempotent; `rebuildFor` reconciles the cache from these sums. Casual leave carries
`typeId = CASUAL`, `balanceTypeId = ANNUAL` (R11); untracked types (sick/maternity/Hajj/unpaid)
write dated consumption with `balanceTypeId = null` — Payroll reads ONE uniform feed.

## Grants

Boot migration and the year-end task grant the current year for everyone employed (pro-rated by
hire date, service steps across employment periods); `hr.employee.created`/`rehired`
subscriptions grant mid-year joiners immediately. Exits expire remaining availability (R12).

## Self-service (C1-R)

The seeded **Employee Self-Service** role holds `leave.view` + `leave.request` at `own` scope.
Lists ride the platform's declarative scoping (`ownerUserField: employeeUserId`, backfilled by
the loginLinked event); employee-keyed single targets (balances, ledger, eligibility) enforce
`employee.userId === ctx.userId` in the service. `MeDto.employeeId` tells the client its
subject.

## Scheduler

`hr.leave.activateStarted` (*/30) · `hr.leave.completeEnded` (daily, + return-due reminders) ·
`hr.leave.approvalReminder` (daily, threshold setting) · `hr.leave.yearEnd` (Jan 1 + boot
catch-up: carryover per type config (L6), new-year grants, carryover-expiry windows).
All date comparisons go through the shared Cairo business-date helpers (R10).

## ⚠️ Legal note (L4)

The seeded types and 2026 holidays are a starting point modeled on the Egyptian Labor Law.
**HR must verify every amount against the law in force before production use** — the catalog
exists precisely so that corrections are configuration, not releases.
