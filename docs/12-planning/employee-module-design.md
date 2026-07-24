# Employee Management Module — Frozen Design

> **Status: FROZEN — approved for implementation.**
> This document is the single source of truth for the Employee module. It consolidates the
> reviewed design (v1), the adversarial-review amendments (v2), the cross-module compatibility
> findings (F1–F6), and the six product decisions recorded at approval. Deviations during
> implementation require an explicit stop-and-explain before any change.

## 0. Approved product decisions

| # | Decision |
|---|----------|
| D1 | Every newly hired employee starts in **`probation`** (probation end = hire date + `probationMonths`; 0 months ⇒ straight to `active`). |
| D2 | Rehiring an employee whose `exit.eligibleForRehire` is **false** requires the dedicated **`employee.rehireOverride`** permission. Normal HR users are blocked. |
| D3 | On Exit, the linked user account is **automatically suspended** — not optional, no checkbox. |
| D4 | **Direct Employee Registration ships in Phase 1** (go-live workforce onboarding). |
| D5 | **Retirement is an exit type only.** Retirement-age reminders are deferred until Payroll/Attendance exist. |
| D6 | The Suspend dialog's **"Disable login" is enabled by default** (HR may untick it). |

## 1. Boundary: Recruitment vs Employee Management

Recruitment is a pipeline that ends; Employee Management is a registry that lives for years.

| Concern | Owner |
|---|---|
| Applicants, screening, interviews, evaluations, offers, hiring documents | Recruitment |
| The hire trigger (accepted offer → employee) | Recruitment triggers; Employee module owns the aggregate |
| Employee record, number, status, lifecycle, post-hire personal data | **Employee Management** |
| Electronic Employee File (documents + recruitment history links) | **Employee Management** |
| Promotions, transfers, suspensions, exits, rehires | **Employee Management** |
| Login account link (ADR-017) | Employee Management |

**Code restructure (behavior-frozen):** `apps/api/src/modules/hr/recruitment/{employees,employee-file}`
move to `apps/api/src/modules/hr/employees/`; the web features likewise become their own sidebar
app. Routes stay `/hr/employees` and `/hr/employee-files`; permission keys stay `employee.*` /
`employeeFile.*`. Dependency direction (verified): Employee module → Recruitment features →
Platform; never the reverse. The applicant record is immutable pre-hire history after the hire.

## 2. Lifecycle

Statuses: `probation → active ⇄ onLeave ⇄ suspended → exited`; `exited → probation` via Rehire only.

```
probation → active (probationConfirm) | onLeave | suspended | exited
active    → onLeave | suspended | exited
onLeave   → base | suspended | exited
suspended → base | exited
exited    → probation (rehire only)
```

- **base** = `probation` while probation is unconfirmed and not failed, else `active`
  (derived from the probation subdocument — reinstate/leaveEnd return to base, so a
  suspension during probation cannot skip probation).
- **Exit** is the single terminal status. The exit **type** is data:
  `resignation | termination | endOfContract | retirement | death`, plus reason, effective
  date, and an explicit `eligibleForRehire` decision. Exits are legal from every non-exited
  state. Exit auto-suspends the linked login (D3), requires a direct-reports decision (§4 F-table),
  and closes the current employment period.
- **Probation**: entry state for all hires (D1). `probationConfirm` → active; `probationExtend`
  sets a new end date; `probationFail` → exit. A scheduler task reminds HR + the manager before
  the end date lapses. Nothing auto-confirms.
- **Leave of absence**: manual `leaveStart`/`leaveEnd` actions until the Leave module exists,
  which will drive the same actions (manual entry points are hidden once that module is present).
- **Rehire**: appends a new employment period on the SAME employee — same `employeeNumber`,
  same Employee File. Never a second employee record for the same person.

## 3. Personnel Actions engine (the spine)

Every change to employment is an append-only **Personnel Action** in `hr_employee_actions`:

- `employeeId`, `seq` (per-employee, atomic `$inc` on the employee document — also the ordering guarantee)
- `type`: `hire | probationConfirm | probationExtend | probationFail | promotion | transfer |
  salaryChange | managerChange | suspend | reinstate | leaveStart | leaveEnd | resignation |
  termination | contractEnd | retirement | death | rehire | dataCorrection`
- `effectiveDate` — past-dated is legal (applies immediately, past date recorded);
  future-dated ⇒ `scheduled`, applied by the scheduler strictly in effective-date order
- `status`: `scheduled | applied | cancelled | failed` (+ reserved `pendingApproval` — ADR-011 seam)
- `changes[{field, from, to}]` — **`to` captured at creation; `from` captured at APPLICATION time**
  (C1: scheduled actions must never record stale from-values)
- `reason`, `note`, `attachmentFileId` (files category `hr-employee-actions`), `by`, `at`, `version`

Rules:
- **Application-time validation (F3):** org referents (branch/department/section/job title) must be
  active when the action APPLIES; a scheduled action that fails validation becomes `failed` +
  HR notification — never silently applied.
- **Cancel (F3):** a `scheduled` action can be cancelled before applying — append-only
  (status → `cancelled`, audited); permission = same as creating that type.
- **Self-action rejection (I1):** the server rejects any action whose target employee's `userId`
  equals the actor. No exceptions, including data corrections.
- **Overlap warning (C1):** creating an action touching fields a pending scheduled action also
  touches surfaces a warning; application order remains strict effective-date order.
- **Pending exit (edge):** while an exit is scheduled, other actions remain allowed EXCEPT those
  with an effective date on/after the exit date; the profile shows a pending-exit banner.
- `dataCorrection` is for employment facts only (e.g. wrong hire date). Personal-profile edits are
  NOT actions (I4) — they are ordinary audited updates surfaced on the timeline via the platform
  audit entity-timeline.
- The employee document holds only the current snapshot; history is read from actions.
  `statusHistory` becomes legacy-read-only after migration.

### Propagation table (F1 — every action updates every dependent record)

| Action | Also updates |
|---|---|
| Transfer (branch) | employee `code` prefix (ADR-017) · **linked user's placement** (branch/department/section on the user drive data-scope) · Employee File `branchId` **and** `employeeCode` |
| Transfer (dept/section) | linked user's placement |
| Exit | user → `suspended` (D3) · direct-reports decision (bulk reassign to a named manager, or explicit unassigned + "no active manager" badge) · close employment period |
| Rehire | reopen period · reactivate prior user account (offered) or create fresh · **append** new hiring-document copies to the EXISTING file |
| Suspend / Reinstate | user suspend (default on, D6) / re-activate |

The pre-existing super-admin branch-code-change path must share this propagation (verify it
updates employee files; fix if not).

## 4. Hire paths

1. **From accepted offer** (existing, updated): terms from the immutable accepted snapshot;
   entry status `probation` (D1); personal data **copied once from the applicant** (snapshot-then-own;
   the copy reads the ENCRYPTED stored national ID, never the masked DTO — I5); NID match against
   employees: match on an exited employee → refuse + route to Rehire (F2); on an employed one →
   hard block.
2. **Direct registration** (new, D4): full personal + employment payload (reuses applicant
   personal-data schemas + the shared national-ID OCR); NID duplicate guard against applicants AND
   employees (I6) with the same exited→Rehire routing; entry status probation or active (payload
   choice, for backfilling tenured staff); `origin: 'direct'`, recruitment references null.
3. **Rehire**: from the exited profile or the NID-match prompt. Optionally sources terms from an
   accepted offer (`jobOfferId`) when the person returned through a fresh recruitment cycle —
   same hire mechanics, no duplication. `eligibleForRehire=false` ⇒ requires `employee.rehireOverride` (D2).

## 5. Data model & database changes

**`hr_employees` (extended):** `origin: 'recruitment'|'direct'`; recruitment refs
(`applicantId/jobOfferId/offerCode/acceptedOfferRevision`) nullable (direct only);
`personal` subdocument (applicant identity/contact/education/military/experience/licenses shape;
NID stored encrypted+masked as applicants do); `probation {endDate, confirmedAt, confirmedBy,
extendedTo, failed}`; `exit {type, reason, effectiveDate, eligibleForRehire, by} | null`;
`employmentPeriods [{hiredAt, exitedAt, exitType}]` — **derived index**, rebuildable from
hire/rehire/exit actions, never hand-edited; `actionSeq` counter; status enum per §2.
`statusHistory` frozen (legacy, `actionId` backfilled).

**`hr_employee_actions` (new):** §3 shape. Indexes: `(employeeId, seq)`, `(employeeId, effectiveDate)`,
`(status, effectiveDate)` (scheduler), `type`. Employee: index `employment.managerId` (subordinates).

**Unchanged:** Employee File (document archive + recruitment-era timeline), org units, job titles,
users, files, audit, notifications — referenced, never copied.

## 6. APIs

Kept: create-from-offer, list, get, create-login, employee-file routes. `POST /:id/status` becomes
a thin alias over the actions engine for one release, then retires (with `employee.changeStatus`).

New — actions engine, **one engine, permission-grouped routes (F5):**
- `POST /hr/employees/:id/actions/employment` — promotion / transfer / managerChange / probation* /
  suspend / reinstate / leaveStart / leaveEnd / dataCorrection → `employee.manageActions`
  (a promotion carrying salary additionally requires `employee.manageCompensation`)
- `POST /hr/employees/:id/actions/compensation` — salaryChange → `employee.manageCompensation`
- `POST /hr/employees/:id/actions/exit` — resignation / termination / contractEnd / retirement /
  death → `employee.exit`
- `POST /hr/employees/:id/actions/rehire` → `employee.rehire` (+ `employee.rehireOverride` when
  `eligibleForRehire=false`)
- `POST /hr/employees/:id/actions/:actionId/cancel` — scheduled only; permission of the group
- `GET /hr/employees/:id/actions` — paged, type filter; salary-bearing entries redacted without
  `employee.viewCompensation`

Other new endpoints: `POST /hr/employees/direct` · `PATCH /hr/employees/:id/personal` (audit-only) ·
`GET /hr/employees/:id/timeline` (composed: file milestones + actions + audit personal edits;
BD-007 graceful degradation) · `GET /hr/employees/:id/subordinates` ·
`GET /hr/employees/rehire-check?nationalId=…`. List filters added: departmentId, sectionId,
jobTitleId, employmentType, managerId, origin.

## 7. Permissions (all scope-aware: own/section/department/branch/organization)

Existing: `employee.view`, `employee.create`, `employee.changeStatus` (retires with the alias),
`employeeFile.*`. New: `employee.registerDirect`, `employee.editPersonal`, `employee.manageActions`,
`employee.manageCompensation`, `employee.viewCompensation`, `employee.exit`, `employee.rehire`,
`employee.rehireOverride` (D2), `employee.viewSensitive` (unmasked NID; access audited as sensitive).
Salary visibility everywhere (profile, action lists, timeline) keys off `employee.viewCompensation`.
Scope `own` is the future self-service seam.

## 8. UI/UX

New sidebar app **Employees** (dynamic-nav application, peer of Recruitment):
- **Employees list** — defaults to employed people (probation/active/onLeave/suspended); exited via
  explicit filter. Columns: code, name, title, department@branch, status. Filters + search.
- **Employee profile hub** — header (photo, name ar/en, code, title, placement, status,
  **Actions menu** filtered by status × permissions) + tabs:
  Overview (employment summary, probation card, pending-exit banner, key dates) ·
  Personal (sectioned like the applicant form; edit gated; OCR reuse) ·
  Employment (action history; compensation sub-view gated) ·
  Documents (existing Employee File components) · Timeline (composed) · Account (existing login card).
- **Action dialogs** — from→to preview, effective date (past/today/future), reason (required on
  negative actions), optional attachment, consequence restated (e.g. code change). Suspend:
  "Disable login" checked by default (D6). Exit: no login checkbox (D3 — automatic), shows
  direct-report count + reassignment decision, `eligibleForRehire` explicit.
- **Direct registration** — gated multi-step form reusing applicant form sections + OCR.
- **Employee Files** pages move under this app unchanged. Recruitment app loses its Employees entry.
- Future-proof (F6): Attendance/Leave/Payroll/Performance each become an additive tab + action
  group + timeline source; manual leave actions hide when the Leave module exists; compensation is
  already isolated behind `viewCompensation` for the Payroll read-through.

## 9. Audit, events, notifications

- Every action write → audit record with the full change set; actions immutable; personal-data
  edits audited field-level; unmasked-NID reads audited as sensitive access.
- Events: keep `hr.employee.created/statusChanged`; add `hr.employee.actionApplied` (typed),
  `hr.employee.transferred` (old/new code), `hr.employee.exited`, `hr.employee.rehired`.
- Notification templates (boot-seeded): probation-ending reminder (HR + manager),
  scheduled-action applied, scheduled-action failed, exit recorded, rehire completed.

## 10. Migration plan (boot-time, idempotent)

1. Folder restructure (pure move, behavior frozen, CI-gated).
2. `terminated` → `exited` + `exit {type:'termination', reason/effectiveDate/by from last status
   event, eligibleForRehire:false}`; `origin:'recruitment'` backfill; one employment period from
   `hiredAt`; `personal` copied from the linked applicant (encrypted NID from source).
3. Synthesize a `hire` action per employee from `statusHistory[0]`; backfill `actionId` links;
   freeze `statusHistory`.
4. Status alias active for one release. Rollback: reverse enum map documented (`exited`→`terminated`).
5. Permission matrix regenerated; i18n parity enforced; strict-TS sweep carries the enum change
   through web badges/filters/tests.

## 11. Risks (accepted, mitigated)

Restructure churn → isolated behavior-frozen commit, CI gate. Enum ripple → contracts-first strict
sweep. Scheduled actions late/double-applied → idempotent by actionId, `(status,effectiveDate)`
index, applied-at recorded. Personal-copy confusion → UI labels the copy moment; applicant
read-only post-hire. Compensation leaks → redaction tied to `viewCompensation`. Payroll/Leave scope
creep → this module records employment facts, never computes. User-suspension side effects → exit
dialog states the account will be suspended; refresh-session invalidation verified by test.

## 12. Deliberate deferrals

Position/headcount management (Organization, future) · grade/step salary structures (Payroll) ·
org-chart visualization (subordinates endpoint ships now) · retirement-age reminders (D5) ·
approval workflows on actions (ADR-011 seam reserved) · Person/Employee entity split (**rejected**
for single-org ADR-015 — employment periods on one record give rehire identity without a join
everywhere).
