# Employee Loans / Advances (P-HR-05)

**Status: decisions frozen (D1–D10, owner-approved). Phase A and phase B both implemented.**

**Base:** phase A on `main` at `1280b90`; phase B on `main` at `1fe7565`.

A bonus is a decision that ends when it is paid. A loan is a decision that **begins** when it is
paid: money leaves, and an obligation stays behind for months. That difference is why this is not
P-HR-04 with extra fields, and every rule below is it restated against something the codebase
already does.

---

## 1. The three concepts, kept apart

Mixing these is the usual way a loan system starts lying about its own numbers.

| | what it is | where it lives | may change? |
|---|---|---|---|
| **obligation** | "this employee owes X" — one decision, one principal | `hr_employee_loans`, one document | its status does; its principal never |
| **installment** | "this month is meant to take Y" — an **intention**, not yet a fact | `hr_loan_installments`, one row per (loan, month) | yes, while `planned` and its month is open |
| **payroll deduction** | "this month **took** Y" — a fact, on an issued payslip | phase B: a compensation line + `hr_loan_repayments` | **never** |

Phase A shipped the first two and no vocabulary for the third: an instalment was `planned` or
`cancelled`, and nothing else. **Phase B added `deducted` together with the code that sets it** —
the same stance PY-12 took about a PDF nobody had built yet.

## 2. The frozen decisions (D1–D10, owner-approved)

| # | decision |
|---|---|
| **D1** | One entity `employeeLoan` with a `type` of `advance \| loan`. The same obligation; the type is for reporting, not for a second collection. |
| **D2** | Approval in the P-HR-04 shape: `draft → pendingApproval → approved`, a separate `employeeLoan.approve` key, and **the submitter may not decide their own request**. No workflow engine — ADR-011 is Accepted but unimplemented. |
| **D3** | **One live loan per employee** in this phase. A second is refused with `409`. No allocation priority and no partial allocation. |
| **D4** | **No ceiling.** No `maxAmount`, no `MAX_PENALTY`, no payroll setting, no legal percentage hard-coded. |
| **D5** | Schedule from `installmentCount` + `firstPeriod`: equal monthly installments, the rounding difference on the **last** one. `sum(installments) === principal` in minor units, always. Generated **at disbursement**, not derived per payroll run. |
| **D6** | Rescheduling touches only **future `planned` installments in unfrozen periods**. It preserves `sum(remaining) === remaining principal`, never rewrites the past, and is gated + audited. |
| **D7** | Two separate paths: **`externalSettlement`** (money collected outside ECMS — cancels the remaining `planned` installments and closes the balance; produces **no** payroll deduction) and **`payrollAcceleration`** (an extra amount taken through payroll in a named month). |
| **D8** | On `EmployeeExited`: cancel `planned` installments after the exit date and mark a loan with a remaining balance `outstandingAtExit`. A settled loan is untouched, the balance stays readable, **nothing is deducted from the final salary**, and the debt is **not** written off. Consume the existing event; invent none. |
| **D9** | The installment is deducted **in full**. A negative net keeps today's `netBelowZero` behaviour — no floor, no partial deduction, no carry-forward, **no deferred line**, and the payslip must still issue. The engine gains no dependency on "net available". |
| **D10** | **No interest, no fees, no penalty, no extra percentage.** A loan is its principal, which is what makes `sum(installments) === principal` a design invariant rather than an approximation. |

### Where each decision lands

- **D1** is one collection and one enum. An advance is a loan with `installmentCount: 1`.
- **D2** is the state machine plus the permission split, and one extra rule the permission cannot
  express: `decide()` refuses the submitter, because a key says what you may do, not who you are.
- **D3** is a guard at creation over the **live** statuses. It is applied at the earliest point at
  which two loans could both reach `active` — see §7.
- **D4** is the absence of a rule: nothing to implement, and a seam spec asserts the feature names
  no cap and no setting.
- **D5** is a **pure** generator (`loan-schedule.ts`), so the arithmetic is arguable without a
  database — the same posture `compensation-rules.ts` and `leave-pay.ts` already take.
- **D6** is one operation that replaces the tail of the schedule and revalidates the invariant.
- **D7-1** (`externalSettlement`) shipped in phase A. **D7-2** (`payrollAcceleration`) is a payroll
  deduction by definition — the owner's own wording — so it shipped in **phase B**, beside the port
  that carries it.
- **D8** is a subscription to the existing `EmployeeExited` — **phase B**.
- **D9** and **D10** are constraints on what may NOT appear; both are guarded by seam specs.

## 3. The entity

`hr_employee_loans` — one document per obligation.

- `employeeId`, `branchId` (ADR-015 scope, denormalized at write like every HR collection)
- `type` — `advance | loan` (D1)
- `principal`, `currency` — major units, as `employee_pay_items` and `hr_payroll_adjustments` store
  them; the currency must equal the employee's basic-salary currency
- `installmentCount`, `firstPeriod` — the schedule's two inputs (D5)
- `reason` — **required**; money handed over for a reason nobody wrote down is not a record
- `note`, `attachmentFileId` — the signed request behind the decision (ADR-023, the HR3-C pattern)
- `status`, and the who/when of every transition
- `disbursedAt`, `disbursedBy`, `disbursementNote` — **a record that money was handed over
  elsewhere.** ECMS has no treasury and pays nobody; see §8.
- `externalSettlement` — `{ amountMinor, reason, at, by }` or null (D7-1)

### States (D2, D5, D7)

```
draft ──submit──▶ pendingApproval ──approve──▶ approved ──disburse──▶ active
  ▲                     │                          │                    │
  └──────reject─────────┘                          │          externalSettlement
                                                   │                    ▼
       (draft | pendingApproval | approved) ──cancel──▶ cancelled     settled
```

**`approved` is not the end — it is the middle.** It means "this may be paid out"; the obligation
begins at `disburse`, which is also when the schedule is generated.

**Cancellation stops at disbursement.** Before it, cancelling withdraws a proposal and costs
nothing. After it, "cancel" would mean forgiving a debt — a financial decision this system has not
been granted (D10's reasoning, applied to the balance rather than to a rate).

`settled` is reached two ways: an external settlement (D7-1) or the last instalment landing on a
payslip. `outstandingAtExit` is phase B's, and it leaves `active` only when somebody leaves owing
money — see §8.

## 4. The schedule (D5) — and why it is stored, not derived

`hr_loan_installments`, one row per (loan, month):

- `loanId`, `employeeId`, `branchId`
- `seq` — 1…N, the order the generator produced
- `period` — `YYYY-MM`, Cairo, as everywhere else in payroll
- `amountMinor` — **minor units**, because this is the number the invariant is stated in
- `status` — `planned | deducted | cancelled` (the middle value is phase B's; see §8)

Indexes: **`ux_loan_seq`** and **`ux_loan_period`**, both unique. Two installments in one month for
one loan is not a business rule to enforce later; it is a shape that must not exist.

The generator is pure:

```
base      = floor(principalMinor / count)
remainder = principalMinor − base × count
amounts   = [base, …, base, base + remainder]        ← the difference lands on the LAST one
```

`sum === principalMinor` by construction, and a test states it over hundreds of shapes rather than
one. An `installmentCount` larger than `principalMinor` is refused: an installment of zero is not
an installment, and rounding it away would silently shorten the schedule.

**Generated at disbursement** (D5), because that is the moment the obligation becomes real — and
because a schedule derived afresh on every payroll run would be a different schedule every time
somebody edited the loan. Stored rows also make the payroll read in phase B a plain index lookup
on `(period, status)`, exactly as `approvedFor` is for adjustments.

Every period the schedule will occupy is checked **twice** — once when the loan is created and
again at disbursement, because a month can be frozen in between. The two checks are PY-3's and
PY-9's, reused rather than reinvented:

| rule | protects |
|---|---|
| the whole schedule lies inside **one employment span** | scheduling a deduction for a month nobody worked here |
| **no** period in it is frozen | a month that has been priced gaining a deduction after the fact |
| the currency equals the **basic salary's** | PY-3 refuses to total two currencies |
| `principal > 0`, `installmentCount ≥ 1`, `principalMinor ≥ installmentCount` | arithmetic, not policy |

## 5. Rescheduling (D6)

One operation, and it rewrites **only the tail**:

- every replaced row must be `planned` (a `cancelled` one is history) and in an **unfrozen** period;
- the new months must be free of a frozen row, and all inside one employment span;
- and the **amount is not an input**. The operation takes the same two inputs the original schedule
  took — a count and a first month — and re-splits the sum of the replaced rows through the same
  generator. `sum(new) === sum(replaced)` therefore holds by construction rather than by a caller
  getting the rounding right, and the service asserts it anyway.

It takes `employeeLoan.approve`, not `create`: changing when somebody's money comes back is the
same seniority of decision as agreeing to lend it. It is audited as a `statusChange` on the loan
with the old and new tail sums, because that is the pair a reviewer actually compares.

## 6. External settlement (D7-1)

Recording that the remaining balance was collected **outside ECMS**: a reason, optionally a
document, and the amount — which must equal the remaining balance, because D7-1 says this closes
the loan. Its effects are exactly three: the remaining `planned` installments become `cancelled`,
the loan becomes `settled`, and nothing at all happens in payroll. A settlement that produced a
payroll line would be claiming a deduction that never occurred.

## 7. D3, stated precisely

The decision says a second loan is refused while one is `active`. The guard is applied over
`pendingApproval | approved | active` — the states from which a loan **will** become active without
anybody deciding anything further. Refusing only at `active` would let two requests be approved in
parallel and disbursed a minute apart, which is the situation D3 exists to prevent.

`draft` deliberately does **not** block: a draft is a proposal, and a forgotten one would otherwise
lock an employee out of ever borrowing again.

## 8. The payroll side (phase B)

### One door, two directions

```
compensation.service ──dueFor──▶ │        │ ──▶ engine line (origin: 'loanInstallment')
                                 │  port  │
payslip.service ──recordTaken──▶ │        │ ──▶ hr_loan_repayments + instalment 'deducted'
```

`compensation/loan-installment.port.ts` is the only file in payroll that names the loans feature,
and a seam spec asserts it by reading the imports. The write-back is the **AT-4 shape** — a payroll
run already reaches into attendance to freeze a period through a port — so no event was invented
for it. Payroll emits none anyway.

**What crosses is an amount, a currency and a sentence to print.** What does not cross is the loan:
not its balance, not its schedule, not its status. The engine stamps the origin and totals the
line like any other deduction.

### The line

`kind: 'deduction'`, always. `prorationFactor: null`, always — the day of the month a payslip is cut
on is not a discount on a debt. It is added **after** the adjustments, because everything above it
is what the month earned and this is what it gives back.

### The ledger

`hr_loan_repayments`, append-only in the shape `hr_leave_ledger` established: written once, never
updated, never deleted, and the balance rebuilt **from** it. It cites `runId` and `payslipId` rather
than minting an identity — **the payslip is the receipt**.

**`(loanId, period)` is unique.** One loan owes at most one instalment in one month, so a re-issued
payslip, a second run over the same period, or a retried batch all collide on a row that already
exists and change nothing. The instalment flips to `deducted` only on the write that inserted it.

`remaining = principal − Σ(ledger) − externalSettlement`. Nothing stores it.

### D9, exactly as frozen

The instalment is taken **in full**. A negative net raises the `netBelowZero` warning payroll
already had — no floor, no partial deduction, no carry-forward, and **no deferred line**, because a
deferred line would stop PY-7 from issuing the payslip at all. That last point is the reason the
engine gained no dependency on "net available": there is nothing to decide.

### D7-2 — acceleration

An extra amount in a named month, taken out of the **last** instalments: months at the end
disappear, and the one the extra runs out inside is reduced. `sum` does not move — an acceleration
repays *faster*, never *more*. The arithmetic is pure (`accelerateTail`). It is deliberately not the
same operation as an external settlement: this money comes out of a salary, that money did not.

### D8 — the exit

On `hr.employee.exited` (the event Leave and Attendance already consume): instalments scheduled
**after** the exit month are cancelled — payroll would never have priced them, since the calculation
clips at the employment span — and a loan with a balance left becomes `outstandingAtExit`. A loan
approved but never paid out is simply `cancelled`; there is no debt behind it. **Nothing is taken
from a final salary and nothing is written off.**

### Freeze

Unchanged from phase A and extended by one fact: a `deducted` instalment is history. Reschedule and
acceleration read only `planned` rows in unfrozen months, so neither can move it; an external
settlement cancels only `planned` rows. A mistake found after the freeze is corrected forward, the
way the rest of payroll corrects a closed month.

## 9. What this phase deliberately does not do

- **No disbursement of money.** ECMS has no treasury module; `disburse` records that a payment was
  made elsewhere. If the money is to move through ECMS one day, that is a module, not a field.
- **No interest, fee, penalty or ceiling** (D4, D10). No payroll setting — payroll declares none
  today and gains none here.
- **No new event.** D8's integration consumes the existing `EmployeeExited`, in phase B.
- **No new page and no navigation entry.** The surface is a tab on the employee profile, exactly
  where an employee's pay items and adjustments already are, so the three permission keys carry
  `pageId: null` and join the registry's named list of resources with no administration screen.
- **No end-of-service or legal settlement.** `outstandingAtExit` is the far edge of this phase's
  scope, and it is a statement of fact rather than a financial decision.

## 10. Open questions this phase does not answer

- **Who may approve a loan** is an administration decision about the key, not a code one.
- If the employee's salary currency changes mid-schedule, the loan and the salary disagree from
  that month on. Nothing in the repository prevents such a change, and no rule exists for it.
- Correcting a loan after a payslip has already taken an installment: the payroll figure is fixed
  forward by an adjustment, but that does not move the loan's balance — two ledgers, one mistake.
  A decision for whenever it first happens.
