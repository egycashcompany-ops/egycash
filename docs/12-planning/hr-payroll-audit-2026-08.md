# HR / Payroll architecture & code audit — P-HR-01 → P-HR-20

**Scope:** everything merged from P-HR-01 to P-HR-20, at `main` = `4352930`.
**Posture:** find *proven, impactful* problems. No refactor for improvement's sake — the owner's
rule, and the right one for a codebase whose seams are already asserted by guards.

**Outcome:** one defect found and fixed, one decision surfaced for the owner, three areas confirmed
clean with evidence, and one note about the audit's own tooling.

---

## A1 — ⚠️ DECISION NEEDED: a cancelled run's payslips survive it, and nothing marks them

**This is the audit's substantive finding.** It needs a decision, so nothing was changed.

### The evidence

* `payslip.model.ts` — uniqueness is `ux_run_employee` on **`(runId, employeeId)`**, and its comment
  justifies that scope: *"because `ux_live_period` already allows at most one live run per period,
  this gives 'one live payslip per employee per month' without a second index having to say so."*
* `payroll-run.model.ts` — `ux_live_period` covers `draft | frozen | approved | paid | closed` and
  **excludes `cancelled`**, deliberately: *"A cancelled run does not occupy the period — which is
  precisely what 'recalculate with a new run' needs."*

### What follows

```
run A frozen → payslips issued → run A cancelled → run B created for the same period
             → run B issues payslips → the employee now has TWO payslips for that month
```

Both are live documents. Nothing on a payslip says which run it came from was cancelled.

### Why it matters now

It was invisible until this wave. **P-HR-20** added `/hr/employees/:id/payslips` and **PY-11**
already had `/payslips/me` — so both HR and the employee now see a month's payslips listed
together, and a re-run month shows two.

The run-level reads are unaffected: PY-7's list and P-HR-15-A's reconciliation are both per-run, so
neither double-counts.

### The three ways to close it — each a decision, not a fix

1. **Mark it** — carry the issuing run's status on the payslip read. Additive, but a contract change,
   and it leaves both documents visible.
2. **Hide it** — exclude payslips of cancelled runs from the employee-facing lists. Smallest visible
   change and the most dangerous: it hides a document somebody may have been paid against.
3. **Prevent it** — refuse to cancel a run that has issued payslips. Contradicts the documented
   recovery path P-HR-10 relies on.

**Recommendation: (1).** It is the only one that adds information rather than removing or forbidding
it. But which of the three is right is a product judgement about what a payslip *means* after its
run is cancelled, so it is left to the owner.

### The owner's preliminary decision, and the design it still needs

**Recorded 2026-08-14. The owner chose option (1) — MARK the payslips of a cancelled run.** Not
hide them, not forbid the cancellation.

**Status: PRELIMINARY, and nothing below is implemented.** Nothing may be until the design here is
approved — that condition is the owner's, and it is why this is a record rather than a plan of work.

#### What the decision already has, and therefore does not need to invent

| the decision needs | it already exists | so this is NOT needed |
|---|---|---|
| a payslip that knows its run | `PayslipDoc.runId`, required since PY-7 | no new link, no join |
| a word for "this run was cancelled" | `cancelled` ∈ `PAYROLL_RUN_STATUSES` | **no new status value** |
| the run's current status | `PayrollRunDoc.status` | no copy, no second source |
| a place to say it | `PayslipDto`, what all the read paths already return | no new endpoint |

**The mark is DERIVED, not stored,** and that is the whole reason this option is small. A payslip is
a document nobody may edit — `payslip.repository.ts` says so in its opening comment and exposes no
update and no delete — while the run's status changes *after* the payslip is written. A stored copy
would therefore have to be rewritten across every payslip of a run at the moment it is cancelled: a
bulk write into precisely the collection this system refuses to rewrite. Reading the run the payslip
already cites has neither problem.

#### The one thing this design does NOT decide: the field's name

`PayslipDto` gains **one** field carrying an existing `PayrollRunStatus` value. Its name is a
contract decision and is left open deliberately — the repository holds two live naming precedents
and nothing that picks between them: `runId` on this same DTO (the `run`-prefixed form) and
`PayrollRunDto.status` (the bare form). **D-A1-b** is the owner's. Everything else is independent
of the answer.

#### The implementation seam — one this repository already established

`apps/api/src/modules/hr/shared/employee-labels.ts` (P-HR-06 / D7) is the same problem solved once
already: *"display enrichment for HR list reads: one batch fetch per page, id → label"*, with the
posture stated in its own comment — **"deliberately NOT denormalized onto the rows"** — and its
guard spec asserting **"no row stores the labels — not a schema field, not a mapper, not a
migration"**.

A1 is that shape with runs in place of employees:

1. a batch read of the runs a page's payslips cite: `runId[] → status`, one query per page;
2. the map spread in at the mapping site, exactly as `labelFields(map, id)` is;
3. `payslipService.toDto` takes the status beside the doc; the five call sites in
   `payslip.controller.ts` pass it.

Two of those five are where the finding is actually visible — `/hr/payroll/payslips/me` (PY-11) and
`/hr/employees/:id/payslips` (P-HR-20), the two cross-run lists. The run's own list and the by-id
reads get it for free, since the field is on the DTO either way.

#### Impact, in full

| area | impact |
|---|---|
| **migration** | **none.** Nothing is stored, so there is nothing to backfill and no old row that is wrong. |
| **contract** | **additive** — one field on `PayslipDto`. `hr-payroll.spec.ts` keeps an explicit required-key list for this DTO, so that list gains one entry. |
| **API** | no new route, no new query parameter, no existing response shape changed beyond the added field. |
| **permissions / pages / events** | **none.** Every path that would carry the mark is gated exactly as it is today. |
| **database** | one batch read per page; no new index — runs are fetched by `_id`. |
| **web** | the two cross-run surfaces (`MyPayslipsPage.tsx`, `EmployeePayslipsTab.tsx`) show the mark; one i18n key in both locales. |
| **write paths** | **none touched.** Issuing, freezing, approving and cancelling are unchanged. |
| **P-HR-15-A** | unaffected — the reconciliation is per-run and never compares across runs. |

#### What it must not become

No new run state and no new payslip state · no `void`, `superseded` or any other word this system
has not already defined · no deletion, no soft-delete, and no exclusion of a cancelled run's
payslips from any list — the decision was to *mark*, and hiding is the option that was rejected · no
change to `CANCELLABLE_PAYROLL_RUN_STATUSES`, which is option (3) and also rejected · no re-issue
and no recalculation.

#### Still open before a line is written

* **D-A1-a** — approval of this design as a whole.
* **D-A1-b** — the field's name.

---

## A2 — ✅ FOUND AND FIXED: the reconciliation ignored the caller's scope

Found in P-HR-15-A's own first cut, during this audit, and fixed in that phase's PR rather than
here — the tracks stay separate.

* Both aggregates (`totalsForRun`, `adjustmentLineTotalsForRun`), the `distinct` behind coverage,
  and the approved-adjustments aggregate took **no scope**, while the route is gated by
  `employee.viewCompensation` — a permission that may be branch-scoped.
* The damage is worse than over-reporting: a reconciliation **compares two sides**, so scoping
  neither consistently would compare organization-wide approvals against branch-scoped payslips and
  **state a discrepancy that does not exist**.

Fixed by building every `$match` from `baseFilter(scope, …)` — the same filter the paginated reads
beside them use — and by counting coverage through a new `listAllInScope`, deliberately not PY-7's
`listAllSystem` (issuing is a system act; reading is not). Pinned by four guards so it cannot
regress.

---

## A3 — ℹ️ Recorded, not a defect: three whole-population reads

`payslipService.generateFor`, the probation sweep, and the leave year-end close each load every
employee. All three are **batch operations over the whole organization**, so the read matches the
work; none is on a per-request hot path. Recorded so a future reader knows it was considered rather
than missed.

---

## Confirmed clean, with the evidence

### Permissions / RBAC — no finding

258 HR routes. **50 carry no `authorize(...)`, and every one is a documented deliberate deviation**,
stated at the point of deviation:

| routes | mechanism | where it is documented |
|---|---|---|
| `/me` × 5 (payslips ×2, days, regularizations, loans, adjustments) | own-scope **by construction** — the employee is resolved from the login link | PY-11 header, and each phase's guard |
| leave: approve / reject / cancel / return / attach / pending-approvals | **relationship** authorization (current manager), enforced in the service, denials audited | `leave-request.routes.ts` header — "DOCUMENTED DEVIATION … frozen design R9" |
| evaluation batches (16 routes) | the permission resource is a property of the **phase** (RW7), knowable only after the batch resolves | `evaluation-batch.routes.ts` header → `evaluation-batch.access.ts` |
| recruitment stage counts | spans every stage; returns only what the caller may see, empty rather than 403 | file header |
| work-calendar reads | open to any authenticated user (C2 — calendar facts power every date picker) | file header |
| public application form (`/:token`) | the token in the path **is** the credential | manifest comment |

### Audit trail — no finding

Every HR service with a write path references `auditService`. Checked by scanning all
`*.service.ts` for `create|update|decide|submit|cancel|approve` methods: **zero without it.**

### Indexes / query patterns — no finding

Every hot path has a matching index, including the two reads this wave added:

| collection | index | serves |
|---|---|---|
| payslips | `ux_run_employee` (unique), `ix_employee_period` | run reads, P-HR-15-A aggregates, P-HR-20 history |
| runs | `ux_live_period` (partial, unique), `ix_status_period` | one live run, run lists |
| adjustments | `ix_employee_period`, `ix_period_status` | employee tab, queue, P-HR-15-A approvals |
| loan instalments | `ux_loan_seq`, `ix_period_status`, `ix_employee_period` | schedule, payroll deduction |
| loan repayments | `ux_loan_period` (unique), `ix_loan_recordedAt`, `ix_employee_period` | ledger, balance |
| leave snapshot | `ix_run_employee` | PY-5 pricing |

### Duplicate logic — no finding

Period-from-a-date derivation exists **once** (`settlement.service.ts`). Payroll otherwise moves the
other way, `periodRange(period)`, from a single helper.

### Events / notifications — guarded by construction, no finding

An uncatalogued event constant is a **compile error**; `event-publishers.spec.ts` source-scans every
emit site against the catalogue in both directions; `hr.seed.spec.ts` proves every template that is
*sent* is *seeded*. Nothing to add.

### Module boundaries — no finding

The three payroll seams each have a source-scanning guard and all pass: attendance reaches payroll
only through the §15.1 ports, lending only through `loan-installment.port.ts`, adjustments only
through `adjustment.port.ts`. P-HR-15-A was written to respect the lending seam rather than widen it
(see its design §4).

---

## A4 — a note on the audit's own tooling

The first route scan reported **74 unguarded routes**; the second, after resolving local guard
helpers, **50**; reading the files brought it to **zero**. Every one was a false positive from
`const manage = [authenticate, authorize('x')] as const` and `...guard('x')` spreads.

Recorded because an audit that reports false findings is worse than one that reports none: it costs
the reader their trust in the rest of the document. **A finding in this file was read in the file
before it was written here.**
