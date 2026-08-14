# P-HR-15 — Reports / Reconciliation

**Status:** discovery complete. The phase splits cleanly in two, and only one half can be built
without a decision from the owner.

* **Reconciliation — BUILDABLE.** Arithmetic identities over data this system already owns. No
  business rule, no report definition, no invented figure.
* **Reports — BLOCKED.** *Which* reports, *for whom*, with *which columns* is a requirement nobody
  has given, and a report built on a guess is worse than none because people act on it.

This phase ships the first and records the second. **P-HR-15-A is the reconciliation.**

---

## 1. What already exists, read off the code

| data | where | usable for |
|---|---|---|
| `PayslipDoc` — `totalEarningsMinor`, `totalDeductionsMinor`, `netMinor`, `currency`, `runId`, `period`, `employeeId`, `earnings[]`, `deductions[]` | `payslip.model.ts` | every money total below |
| `CompensationLineDto.origin` — `payItem` · `leaveSnapshot` · `adjustment` · `loanInstallment` | `hr-payroll.ts` | attributing a line to what produced it |
| `PayrollAdjustmentDoc` — status, period, amount, employee | `payroll-adjustment.model.ts` | approved-vs-paid checks |
| `employedDuring` + `employmentSpansOf` | `payslip-eligibility.ts`, `employment-spans.ts` | who *should* have a payslip |
| `LoanRepaymentDoc` — `runId`, `payslipId`, `period`, `amountMinor` | `loan-repayment.model.ts` | ⚠️ see §4 |

**There is no aggregate query anywhere in the HR module today** — verified: zero `aggregate(` calls
outside specs. Nothing sums a run.

## 2. Inventory — what CAN be reconciled with no new rule

Each of these is an **identity**, not an opinion. Either the numbers agree or something is wrong.

| # | check | why it needs no rule |
|---|---|---|
| **R1** | the run's **totals** = the sum of its issued payslips, per currency | addition over stored figures |
| **R2** | **coverage**: employees employed during the period vs payslips issued | `employedDuring` already defines the population; PY-7 uses the same function to build it |
| **R3** | **approved adjustments for the period** vs the `adjustment`-origin lines actually on those payslips | both sides exist; a gap means an adjustment was approved *after* the payslip was issued — a real operational fact, not a judgement |

**Totals are reported PER CURRENCY.** Summing across currencies would be a defect, not a
simplification: the engine refuses a mixed-currency *employee*, but nothing says two employees must
share a currency.

## 3. What is NOT a reconciliation, and stays blocked

* **Which reports exist at all** — a payroll register, a bank list, a department summary, a
  year-to-date statement: each is a *definition* (audience, columns, grouping, period), and none is
  written anywhere in this repository.
* **Any statutory or accounting view** — tax, insurance, GL. Those are P-HR-12 and P-HR-14 and are
  blocked on their own rules.
* **Printable or exportable output** — **PY-12 stays closed.** A "report" that renders a document
  reopens it sideways, so this phase produces a screen and an API and nothing downloadable.

## 4. ⚠️ One check deliberately NOT built — and why it is an architecture decision, not an omission

**R4 would be: the loan repayments recorded for a run vs the `loanInstallment`-origin lines on that
run's payslips.** It is a genuine identity — P-HR-05-B promises a repayment is written exactly when
a new payslip takes an instalment — and it would be the most valuable check of the four.

It is not built because **payroll cannot read the loan ledger.** The P-HR-05-B seam allows exactly
one door (`compensation/loan-installment.port.ts`), and its contract is explicit: what crosses is an
amount and a sentence — *"not its balance, not its schedule, not its status"*. A guard asserts that
no payroll file names `LoanRepaymentModel`.

Adding "sum the repayments for run X" to that port would widen a seam that was deliberately narrow.
That is an **architectural decision for the owner**, not something to slip into a reporting phase —
so it is recorded here and left out.

## 5. What P-HR-15-A builds

```
GET /hr/payroll/runs/:id/reconciliation      → employee.viewCompensation
```

Behind the key that already governs reading the run's payslips, because every figure it states is
somebody's pay in aggregate. **No new permission, no new page, no new event, no stored row.**

It computes **nothing that is not a sum or a count** of documents the system already wrote.

### What it will not add

No report definition · no export/PDF/CSV · no tax, insurance or GL view · no loan-ledger reading ·
no change to any run state · no new collection or migration.

## 6. Test matrix

| case | expectation |
|---|---|
| a run with issued payslips | totals equal the sum of those payslips, per currency |
| a draft run with none issued | zero totals, zero issued, and no error |
| coverage | employed-in-period ≥ issued, and the difference is reported rather than implied |
| an approved adjustment that reached a payslip | counted on both sides, difference zero |
| an approved adjustment created after issuing | approved side grows, payslip side does not, difference reported |
| two currencies in one run | two total rows, never one summed row |
| permissions | behind `employee.viewCompensation`; refused without it |
| no write path | asserted — the feature has no mutation |
| PY-12 | asserted absent: no export, no document |
| the loans seam | asserted untouched: no `LoanRepaymentModel` anywhere in payroll |
