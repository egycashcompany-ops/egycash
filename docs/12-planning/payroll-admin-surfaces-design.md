# P-HR-06 — Payroll Administrative Surfaces

**Status:** decisions frozen by the owner before any code was written. Phase A is implemented; phase
B is scoped here and not started.

---

## 0. Why this phase exists

P-HR-06 had no meaning in this repository. A read-only investigation over the tree and the git
history found the identifier nowhere — no design note, no reserved number, no comment. It was named
before it was defined, so the first act of this phase was to find out what the previous phases had
actually left unfinished, and let the owner choose from that evidence rather than from a guess.

What the investigation found, stated as facts about the code:

1. **Two organization-wide endpoints exist with no caller at all.**
   `GET /hr/payroll/adjustments` shipped with P-HR-04 and `GET /hr/employee-loans` with P-HR-05-A.
   Both are mounted, authorized and validated. Neither had a single reader anywhere in `apps/web`.

2. **One declared page pointed at nothing.** `hr.payroll-adjustments` is declared in
   `hr.module.ts` with `route: '/payroll/adjustments'`. `apps/web/.../payroll/routes.tsx` routed
   `payslips/me`, `pay-items` and `runs` — so that route resolved to the module's 404 page. It is
   the only one of the HR pages with neither a web route nor a navigation row.

3. **No gate could catch it.** `validatePageRegistry` checks a page's id shape, that its module owns
   it, and that at least one permission points at it. It never asks whether the page's `route`
   resolves to a screen. The permission matrix, the flag-expiry check and the automation-template
   check are all blind to it too.

4. **The approval half of P-HR-04 was unreachable in practice.** `payrollAdjustment.approve` exists,
   the two-person rule is enforced server-side, and the ONLY place to exercise it was a tab on one
   employee's profile — so an approver could act on a bonus only by already knowing whose bonus it
   was.

5. **Seven comments named phases that do not exist.** `P-HR-08` and `P-HR-09` appear in attendance
   and in the attendance contract as the future owners of retro corrections and of overtime
   pricing. Neither identifier is defined anywhere. The work they describe partly shipped under
   different names (P-HR-04, PY-4, PY-6) and partly does not exist at all.

---

## 1. Frozen decisions

| # | Decision | Ruling |
|---|---|---|
| **D1** | What P-HR-06 means | **Payroll Administrative Surfaces** — give the already-built payroll decisions the screens they were shipped without. No new financial rule. |
| **D2** | The stale phase labels | **Correct them, comments only.** Zero behaviour change. |
| **D3** | The adjustments queue | **Build the administrative screen in full** — route and navigation. No new permission, no new financial rule. |
| **D4** | The loans admin screen | **Build it, with route and navigation, keeping the profile tab**, using the existing keys. |
| **D5** | What defines the queue | **The approval key.** No workflow engine, no new permission. |
| **D6** | Payroll Settings | **No.** Not in this phase. |
| **D7** | The shared employee labels | **Move the helper to `hr/shared/`** — transport only, no behaviour change, no denormalization, no stored fields, no new API, no payroll→attendance dependency. `employeeName` / `employeeCode` stay optional and compatible with the existing DTOs. |

### D7, in the owner's conditions

* the move changes no utility behaviour;
* no denormalization and no new stored fields;
* no new API;
* no dependency from payroll to attendance;
* imports and the necessary guards are updated after the move;
* `employeeName` / `employeeCode` stay **optional** and compatible with the current DTO;
* `compensation-rules.ts` and every existing port and seam spec are untouched, except where an
  import path had to change.

---

## 2. Why D7 was necessary at all

`employee-labels.ts` arrived with AT-6 inside `attendance/`. The second feature that needed the same
two fields was payroll — which **may not import attendance**: eslint bans `**/attendance` and
`**/attendance/**` from `payroll/**` with two named port exceptions (the §15.1 seam, PY-4 and PY-6).

So the choice was between a second copy of a display rule and one implementation in a place both
sides may reach. A copy drifts the moment one of them learns about a preferred name or a locale, and
the seam makes the copy the path of least resistance — which is exactly why the move is the smaller
change. The file now lives at `apps/api/src/modules/hr/shared/employee-labels.ts`; attendance reaches
it from `../../shared/`, payroll from `../../shared/`, loans from `../shared/`.

**Nothing is stored.** A day row is derived, a regularization is a request, an adjustment is a
decision about somebody, and a loan is a debt they still owe: all four concern a person who still
exists, so the label is looked up per read. Elsewhere in HR the opposite is right and equally
deliberate — a contract, a personnel action, an employee-file entry, a hiring document and a leave
filing all DO store the name, because each records what was written at a moment. `employee-labels.spec.ts`
asserts which side of that line these four sit on.

---

## 3. Phase A — what shipped

**Scope:** the adjustments queue, the stale-label corrections, and D7.

### 3.1 D7 — shared employee labels

* `hr/attendance/employee-labels.ts` → `hr/shared/employee-labels.ts` (`git mv`, body unchanged).
* Three attendance importers updated to the new path.
* `PayrollAdjustmentDto` and `EmployeeLoanDto` gain **optional** `employeeCode?` / `employeeName?`,
  documented as enriched on the organization-wide read and never stored.
* `listAdjustments` and `listLoans` enrich with one batch fetch per page. The employee-scoped reads
  beside them deliberately do not: they are already on somebody's file.

Both DTOs are enriched in phase A even though only the adjustments SCREEN ships in A, so the
contract is touched once rather than twice.

### 3.2 D3 / D5 — the Payroll Adjustments Queue

* `/payroll/adjustments`, behind `RequirePermission permission="payrollAdjustment.view"`.
* Two tabs: **awaiting decision** (the org-wide endpoint asked with `status=pendingApproval`, fixed)
  and **all adjustments** (status, kind and period filters). Pagination on both.
* Approve / reject through the same nested endpoint the profile tab already posts to — the employee
  comes from the row. The server still refuses a decision from whoever submitted it (D1).
* The screen deliberately cannot RECORD an adjustment: creating one stays on the employee's file,
  where the person and the currency are already known.
* Navigation row gated on `payrollAdjustment.approve`.

**Why the navigation row is narrower than the route.** The row is an invitation to decide, so it
belongs in the sidebar of the people who can. The route is gated on `view` because that is the key
the server requires for the list the screen reads — gating the route on `approve` would hand a
`view` holder a blank refusal for data the API would have answered.

### 3.3 D2 — the stale labels

Seven references corrected, comments only, plus an eighth of the same kind found during the work:

| File | Was | Now |
|---|---|---|
| `attendance/overtime/overtime.service.ts` | pricing is Payroll's (P-HR-09) | priced as a `perMinute` pay item (PY-3 rate, PY-4 quantity); **no overtime premium or multiplier exists anywhere in this repository** |
| `contracts/hr-attendance.ts` | multipliers and pricing are Payroll's, P-HR-09 | the approved figure crosses as a QUANTITY (PY-4); no multiplier exists to apply |
| `attendance/regularizations/regularization.model.ts` | Payroll's retro engine will read `postFreeze` (P-HR-08) | nothing outside attendance reads that stamp; there is no retro engine, and the only built forward path is a payroll adjustment recorded by hand (P-HR-04) |
| `attendance/regularizations/regularization.service.ts` | reaches pay as a forward adjustment (P-HR-08) | reaches pay only as a payroll adjustment somebody records by hand (P-HR-04); no code makes that hop |
| `attendance/day-records/day-record.service.ts` | the Payroll Run's transition to `calculating` (P-HR-09) | the run's freeze step (PY-6) through `runs/attendance-freeze.port.ts`; a run's states are `draft`, `frozen`, `cancelled` — there is no `calculating` |
| `attendance/day-records/attendance-feed.ts` | no caller until the Payroll Run exists (P-HR-09) | payroll reaches it through `compensation/attendance-quantity.port.ts` (PY-4), and the freeze through `runs/attendance-freeze.port.ts` (PY-6) |
| `tests/integration/hr-attendance.spec.ts` | what the Payroll Run will do in P-HR-09 | the same way payroll's two ports do |
| `payroll/compensation/attendance-quantity.port.ts` *(the eighth)* | freezing happens "when it starts calculating (PY-6), and until that exists nothing in production freezes anything" | freezing is the run's decision and it goes through the OTHER door; PY-6 exists and the run calls it |

### 3.4 Guards added or widened

* `hr/shared/employee-labels.spec.ts` (new) — one definition, every reader imports it, no model or
  mapper under attendance/payroll/loans stores the two fields, and only the two organization-wide
  controllers enrich.
* `payroll-routes.spec.ts` — route list widened to four; new block asserting that the DECLARED page
  `hr.payroll-adjustments` resolves to a routed screen (the gap `validatePageRegistry` cannot see),
  that navigation is under the approve key, that the queue adds no API and records nothing, and that
  it shows a name rather than an id.
* `compensation-card.spec.ts` — two route-list pins widened.
* `payroll-i18n.spec.ts` — adjustment statuses, kinds and the queue's tab labels added to the
  template-key vocabularies, so a contract enum gaining a value fails here rather than shipping the
  raw key onto an approver's screen.
* `hr-payroll.spec.ts` / `hr-employee-loans.spec.ts` (integration) — the organization-wide reads
  answer, the queue filter is the whole of the queue, the labels are present there and absent on the
  employee-scoped reads, and neither endpoint needs a new key.

### 3.5 What phase A did NOT add

No new API, no new permission, no new page declaration, no new setting, no new event, no new
financial rule, no migration.

---

## 4. Phase B — scoped, not started

* The loans administration screen at `/payroll/loans` or equivalent (D4), keeping the profile tab.
* The `hr.employee-loans` page declaration and its navigation row — today `employeeLoan.*` is
  declared with `pageId: null`, which is honest only while the tab is the whole surface.
* The read half is already in place: `GET /hr/employee-loans` returns rows carrying the employee
  label, so the screen is a client, not a new endpoint.

---

## 5. Standing constraints observed

No legal or financial rule was invented. Nothing about taxes, social insurance, overtime pricing or
end-of-service appears here. Attendance, leave, `leave-allocation.ts`, the `chronological`
convention, the half-day convention and `freezePeriod()` semantics are untouched except for the
comment corrections listed in §3.3, which change no behaviour. No test guard was deleted; every one
that stood in the way was WIDENED to cover the new shape.
