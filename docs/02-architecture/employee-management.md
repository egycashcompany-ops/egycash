# Employee Management — Architecture

> Companion to the frozen design (`docs/12-planning/employee-module-design.md`), which remains
> the single source of truth for the business rules and the recorded product decisions (D1–D6).
> This page maps the design onto the codebase.

## Placement

`apps/api/src/modules/hr/employee-management/` — three features behind barrels (ADR-003):

| Feature | Owns | Collections |
|---|---|---|
| `employees` | The employee registry: hire-from-offer, Direct Registration, personal data, reads (list / profile / subordinates / rehire-check / composed timeline), the login link (ADR-017), the boot migration | `hr_employees` |
| `employee-actions` | The Personnel Actions engine — the ONLY writer of employment facts — plus the deprecated status alias and the scheduler entry | `hr_employee_actions` |
| `employee-file` | The Electronic Employee File (document archive + recruitment-era timeline; supplemented on rehire) | `hr_employee_files` |

Dependency direction: `employee-management → recruitment features → platform`. The one
pre-existing reverse edge (`recruitment/hiring-documents → employees`, documents are collected
FOR an employee) keeps the graph acyclic. The migration and the employees service import the
actions *repository* by file (not the barrel) to avoid a load-time cycle — noted in place.

## The engine in one paragraph

`createAction` (per permission-grouped route) → scope + self-action + version + pending-exit
checks → atomic per-employee `seq` (`$inc actionSeq`) → persist (`scheduled` when
effective-dated in the future, otherwise applied inline). `apply` re-validates org referents,
captures `from` values at application time, mutates the snapshot (explicit `__v` bump — scalar
saves don't bump it), propagates (user placement + login status through the users seam, file
code/branch through `employeeFileService.syncEmployeeIdentity`), audits (`personnelAction`),
emits, and — on the scheduler path — records failures as `failed` + notification instead of
throwing. Cancel is an append-only status flip, gated by the permission of the targeted
action's group (route admits any group holder; the service resolves the group). The scheduler task
(`hr.employeeActions.applyScheduled`, 10-min cron) applies due work in (effectiveDate, seq)
order; `hr.employees.probationReminder` (daily) notifies ahead of probation deadlines.

## Data notes

- `personal` is the snapshot-then-own copy of the applicant's personal groups (raw national id,
  masked in DTOs — Security Architecture §3). Post-hire edits are plain audited updates
  (`update` audit action), NOT personnel actions; the composed timeline reads them back from
  the audit log (BD-007 graceful degradation).
- `employmentPeriods` is a DERIVED index over hire/rehire/exit actions (fast "employed during
  X" reads for Attendance/Payroll) — rebuildable, never hand-edited.
- `statusHistory` is the frozen legacy trail (migration links entry 0 to the synthesized hire
  action); history is read from the actions collection.
- One person = one employee, forever: `personal.nationalId` lookups guard every hire path and
  route exited matches to Rehire (same number, same file).

## Future-module seams

Leave drives `leaveStart`/`leaveEnd` through the same engine (manual entries hide once it
exists); Payroll consumes the effective-dated compensation history (`salaryChange`/`promotion`
actions) and the `hr.employee.exited` event; Attendance keys off the employee code and the
`hr.employee.transferred` old/new-code payload; ADR-011 approvals slot in via the reserved
`pendingApproval` action status. Deliberate deferrals (positions/headcount, salary grades,
org-chart UI, unmasked-NID egress per OQ-27) are listed in the frozen design §12.
