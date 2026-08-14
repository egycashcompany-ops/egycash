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
