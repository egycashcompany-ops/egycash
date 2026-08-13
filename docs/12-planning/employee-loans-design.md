# Employee Loans / Advances (P-HR-05)

**Status: decisions frozen (D1–D10, owner-approved). Phase A implemented here; phase B is payroll.**

**Base:** `main` at `1280b90`.

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

Phase A ships the first two. It ships **no** payroll deduction, and therefore no vocabulary for
one: the installment statuses here are `planned` and `cancelled`, and nothing else. `deducted`
arrives in phase B with the code that sets it — the same stance PY-12 took about a PDF nobody had
built yet.

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
- **D7-1** (`externalSettlement`) ships here. **D7-2** (`payrollAcceleration`) is a payroll
  deduction by definition — the owner's own wording — and phase A touches no payroll, so it ships
  in phase B beside the port that would carry it. Its schedule effect is already expressible
  through D6, and shipping a second way to say that in phase A would be a promise with no consumer.
- **D8** is a subscription to `EmployeeExited` — phase B, listed there by the owner.
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

`outstandingAtExit` and `settled`-by-payroll arrive in phase B with the code that produces them.
Phase A's terminal states are `settled` (via external settlement), `cancelled`, and the open
`active`.

## 4. The schedule (D5) — and why it is stored, not derived

`hr_loan_installments`, one row per (loan, month):

- `loanId`, `employeeId`, `branchId`
- `seq` — 1…N, the order the generator produced
- `period` — `YYYY-MM`, Cairo, as everywhere else in payroll
- `amountMinor` — **minor units**, because this is the number the invariant is stated in
- `status` — `planned | cancelled`

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

## 8. What this phase deliberately does not do

- **No payroll integration at all.** No port, no `origin`, no line, no repayment ledger, no change
  to `CompensationLineDto`, and no change to PY-1…PY-12 behaviour. The compensation engine does not
  know this feature exists.
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

## 9. Open questions this phase does not answer

- **Who may approve a loan** is an administration decision about the key, not a code one.
- If the employee's salary currency changes mid-schedule, the loan and the salary disagree from
  that month on. Nothing in the repository prevents such a change, and no rule exists for it.
- Correcting a loan after a payslip has already taken an installment: the payroll figure is fixed
  forward by an adjustment, but that does not move the loan's balance — two ledgers, one mistake.
  A decision for whenever it first happens.
