# P-HR-15 — Reports: the inventory

**Companion to `payroll-reports-and-reconciliation.md`, which covered the reconciliation half.**
This one covers the half that was left blocked, and it exists to answer a single question honestly:
*what can be built from the data this system already holds, without anybody inventing a
requirement?*

**The short answer: one thing, and it is not a new report.** Everything else on the list below needs
a decision, and each is recorded as one rather than guessed at.

---

## 0. The rule this document is written to

A **reconciliation** is an identity: two figures the system already stores either agree or they do
not, and nobody had to decide what the check means. A **report** is a *definition* — who reads it,
what it is for, which rows, which columns, which grouping, which period. Those are requirements, and
this repository contains none of them.

That distinction is the whole of §1 through §3. Where a candidate turns out to be an identity, it is
buildable; where it turns out to need a definition, it is blocked, **however obvious the definition
seems**. "Obvious" is exactly how an invented requirement gets in.

---

## 1. What is actually available, re-verified against `main`

| data | where | what it can support |
|---|---|---|
| `PayslipDoc` — `totalEarningsMinor`, `totalDeductionsMinor`, `netMinor`, `currency`, `runId`, `period`, `employeeId`, `employee` (code, name, job title as at issue), `basicSalary`, `employmentDaysInPeriod`, `earnings[]`, `deductions[]`, `warnings[]`, `issuedAt` | `payslip.model.ts` | any per-run or per-employee money view |
| `CompensationLineDto` — `origin` (`payItem` · `leaveSnapshot` · `adjustment` · `loanInstallment`), `code`, `name`, `kind`, `amountMinor`, `state`, `quantity` | `hr-payroll.ts` | attributing a figure to what produced it |
| `PayrollRunDoc` — `period`, `status`, the governance stamps (`frozenAt/By`, `approvedAt/By`, `paidAt/By`, `paidOn`, `paymentReference`, `closedAt/By`, `cancelledAt/By`) | `payroll-run.model.ts` | anything about a month's lifecycle |
| `PayrollAdjustmentDoc` — kind, status, period, amount, currency, employee, reason, approver | `payroll-adjustment.model.ts` | approved-vs-paid views |
| `employmentSpansOf` + `employedDuring` | `compensation/`, `payslips/` | who *should* appear in a period |
| `branchId` on the payslip, denormalized at issue | `payslip.model.ts` | any grouping by branch — **the scope axis already exists** |
| loan instalments and repayments | the lending module | ⚠️ **behind the P-HR-05-B seam** — see §3, R4 |

Two facts worth stating because they bound everything below:

* **The only aggregates in HR are P-HR-15-A's.** Nothing else sums anything.
* **There is no exchange rate anywhere.** Any total that spans currencies must stay per-currency, or
  it is a defect wearing the costume of a summary.

---

## 2. ✅ The one thing that needs no decision — and it is a screen, not a report

### S1 — surface the reconciliation that already shipped

P-HR-15-A merged as an **API with no user interface**. The endpoint, its permission, its columns and
its audience were all decided and merged in #221; nothing about showing it decides anything new:

| the question a report must answer | who already answered it |
|---|---|
| what is it for? | the endpoint's own design — settling a month |
| for whom? | `employee.viewCompensation`, the key already on the route |
| which data? | `PayrollRunReconciliationDto`, merged |
| which columns? | that DTO's fields, merged |
| where does it live? | inside the run's payslips dialog — **no new page, therefore no new permission** |

So this is the one piece of P-HR-15 that can ship without the owner deciding anything, and it is
shipped: `RunReconciliation.tsx` renders the merged DTO where a month is actually settled.

**It defines nothing.** It adds no column the DTO does not have, no grouping, no filter, no period
selector, and no export.

---

## 3. 🔒 Everything else — the candidates, each with what is missing

Every row below was reachable from the data in §1. Each is blocked on a **definition**, not on data.

### R-A — Payroll register (a month's payslips as a list)

* **Purpose:** the classic "what did we pay, to whom, this month".
* **Audience:** whoever settles payroll. Plausibly `employee.viewCompensation`.
* **Data:** ✅ entirely present — this is `GET /hr/payroll/runs/:id/payslips`, which already exists.
* **Possible columns:** employee code · name · job title · branch · currency · basic · total
  earnings · total deductions · net · days employed in the period.
* **🔒 Decision needed:** *which* of those columns, in what order, grouped by what (branch?
  department? nothing?), and sorted how. Also whether a "register" is a distinct thing at all or
  just the existing payslip list with a different heading. **The data is free; the definition is
  not.**

### R-B — Cost breakdown by origin (what the month was made of)

* **Purpose:** how much of the run came from pay items, leave, adjustments, and loan instalments.
* **Audience:** unknown — plausibly finance, plausibly HR management.
* **Data:** ✅ present. Every payslip line carries `origin`, and the vocabulary is closed. **This
  needs no loan-ledger read** — the instalment amount is on payroll's own payslip line.
* **Possible columns:** origin · currency · amount · share of the total.
* **🔒 Decision needed:** whether this view is wanted, and at what grain (per run? per branch? per
  pay item?). The arithmetic is an identity; **whether anybody needs it is not.**

### R-C — Cost by branch / department / section

* **Purpose:** where the money went, organizationally.
* **Data:** ✅ `branchId` is on every payslip. Department and section are **not** — they would have
  to be joined from the employee as they stand *now*, which is a different question from where they
  stood when the payslip was issued.
* **🔒 Decision needed:** which axis, and — the real question — **as-at-issue or as-of-today?** The
  payslip deliberately froze the employee's identity but not their department. Answering "which
  department paid this?" for somebody who transferred requires a rule about which answer is true.

### R-D — Variance against the previous month

* **Purpose:** what changed, and why.
* **Data:** ✅ both months' payslips exist.
* **🔒 Decision needed:** what "compared to last month" means when the population changes — joiners,
  leavers, a person whose currency changed. A variance report that silently treats a leaver's
  absence as a saving is worse than no report.

### R-E — Year-to-date per employee

* **Purpose:** a person's cumulative pay.
* **Data:** ✅ every payslip is stored with its period.
* **🔒 Decision needed:** what a "year" is here (calendar? fiscal? — **no fiscal year exists in this
  system**), whether cancelled-run payslips count (A1's territory), and whether it is HR-facing,
  employee-facing, or both.

### R-F — Bank / payment list

* **🔒 Blocked twice over.** `Pay` in this system means *recorded as paid*, by decision — there is no
  bank integration and no WPS. A payment list also needs bank account data that **no model holds**.
  Nothing here is buildable, and the missing half is a locked decision rather than an oversight.

### R-G — Statutory and accounting views (tax, insurance, GL)

* **🔒 P-HR-12 and P-HR-14.** Blocked on legal and accounting rules that do not exist in this
  repository, and explicitly out of scope for this phase.

### R4 — Loan repayments reconciled against the payslip lines

Carried forward unchanged from the earlier design's §4: it is a genuine identity and would be
valuable, and it is **not built because payroll may not read the loan ledger**. Widening
`loan-installment.port.ts` is an architectural decision for the owner, still open.

---

## 4. What this track deliberately did NOT do

No new report definition · no column chosen on the reader's behalf · no export, PDF or CSV — **PY-12
stays closed** · no new page, permission, event, collection or migration · no aggregate beyond the
ones P-HR-15-A already merged · no cross-currency total · no statutory or accounting view · no
widening of the lending seam.

**No API change at all.** This track is a client surface over an endpoint that shipped in #221.

---

## 5. The decisions this document is asking for

1. **R-A** — is a payroll register wanted as a thing of its own, and with which columns and grouping?
2. **R-B** — is the by-origin breakdown wanted, and at what grain?
3. **R-C** — which organizational axis, and as-at-issue or as-of-today?
4. **R-D** — what does a month-on-month comparison mean when the population changes?
5. **R-E** — which year, and does a cancelled run's payslip count?
6. **R4** — widen the P-HR-05-B port, or leave the loan side unreconciled?

Until one of these is answered, the reports half of P-HR-15 stays where it is: **possible, and
undefined.**
