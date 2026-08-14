# P-HR-14 — Payroll → GL

**Discovery and design only. No implementation, and none is proposed until §5 is answered.**

The accounting rules do not exist in this repository — verified, not assumed: there is no
occurrence of `generalLedger`, `journalEntry`, `debit`, `credit`, `costCenter` or a chart of
accounts anywhere in `apps/api`, `packages/contracts` or `apps/web`. Every one of them is a
decision, and this document's job is to make the shape of that decision small and precise instead
of open-ended.

---

## 1. What payroll already produces that a GL could need

Everything below exists today and is stable. **This is the whole surface** — a GL integration needs
nothing invented on the payroll side.

| output | where | shape |
|---|---|---|
| **The payslip line** | `PayslipDoc.earnings[]` / `.deductions[]` | `origin` · `code` · `name` · `kind` (`earning`/`deduction`) · `amountMinor` · `currency` |
| **The line's source** | `CompensationLineDto.origin` | `payItem` · `leaveSnapshot` · `adjustment` · `loanInstallment` — four, closed |
| **The pay item** | `PayItemDoc.code` | uppercase, unique, **stable by design**: PY-1 refuses to change an item's `code`, `kind` or `calcBasis` because a payslip cites it |
| **Per-employee totals** | `PayslipDoc` | `totalEarningsMinor` · `totalDeductionsMinor` · `netMinor` |
| **Per-run totals** | P-HR-15-A | the same, summed per currency |
| **Org placement** | `PayslipDoc.branchId`, and `employee` on the slip | the ADR-015 scope axis, denormalized at issue time |
| **The payment fact** | `PayrollRunDoc` | `paidAt` · `paidOn` · `paidBy` · `paymentReference` — recorded by P-HR-10 |
| **The moment it happened** | `hr.payroll.runPaid` (P-HR-16) | `runId` · `period` · `status` · `by` |

### The two facts that make this tractable

1. **`payItem.code` is a stable key.** PY-1 already forbids changing an item's meaning precisely
   because payslips cite it. A mapping keyed on it cannot silently repoint.
2. **`origin` is a closed vocabulary of four.** Anything a GL must treat differently is already
   distinguishable without a new field.

## 2. The integration boundary

Payroll's side is a **read plus an event**, and nothing more:

```
hr.payroll.runPaid  ──▶  [ GL feature ]  ──▶  posting
        │                      │
        └── run reconciliation, payslip lines (read)
```

* **The trigger is `runPaid`, not `frozen` or `approved`.** P-HR-10 settled that `Pay` means
  recorded-as-paid inside this system; before that moment nothing has left, and posting a
  liability that may still be cancelled would put the ledger ahead of the facts. (`approved` is
  still cancellable — `paid` is not.)
* **Direction: GL reads payroll.** Payroll must not learn what an account is. Every seam in this
  module points the same way — attendance→payroll, lending→payroll — and the reason holds here:
  a payroll engine that knew about accounts would be two systems in one file.
* **Shape: a port, as in PY-4, PY-5 and P-HR-05-B.** One file, one interface, one direction. If GL
  ships as its own module, this is the door; if it ships inside payroll, the port keeps the
  accounting rules out of the calculation.

**Nothing on the payroll side changes** to enable this: no new field, no new event, no new state.

## 3. What the GL side would need to hold

Not built, not designed further than naming it — each item is §5's to answer:

* a **chart of accounts** (or a reference to an external one);
* a **mapping** from what payroll produces to accounts;
* **posting rules** — what is debited, what is credited, at what granularity;
* an **idempotency key**, so re-posting a run cannot double it (payroll's own precedent:
  `$setOnInsert` under a unique key);
* a **reversal** story for a run cancelled after posting — which is the same shape as audit finding
  A1 and should be answered with it.

## 4. Granularity — the question that decides the size of the phase

The same data supports all three, and the choice is the owner's:

| level | one journal per | pros | cost |
|---|---|---|---|
| **run** | payroll run | smallest, closes the month | no per-employee or per-branch detail in the ledger |
| **branch × pay item** | `branchId` + `payItem.code` | matches how the org already reads money; both fields are on the payslip | more lines |
| **employee** | payslip | fully traceable | thousands of lines a month |

**Not chosen here.** It is not a technical question: it is how the finance team wants to read the
ledger.

## 5. 🔒 BLOCKED — the decisions this phase cannot start without

1. **The chart of accounts** — or, if it lives in an external system, how ECMS refers to an account.
2. **The mapping** — which account each `payItem.code` posts to, and what to do with the other three
   origins (`leaveSnapshot`, `adjustment`, `loanInstallment`). A loan instalment in particular is not
   an expense at all: it settles a receivable, and saying so is an accounting decision.
3. **Posting rules** — debit/credit per line kind, the treatment of the net vs the gross, and whether
   the employer's side (if any) posts here.
4. **Granularity** — §4.
5. **Trigger confirmation** — `runPaid` is the recommendation above; if accrual accounting requires
   posting at `frozen` or `approved` instead, that changes the trigger and the reversal story.
6. **Reversal** — what happens to a posted run that is later cancelled (see audit A1).

**None of these is guessed here, and none may be guessed later.** A wrong account mapping is not a
bug that shows up in a test: it is a wrong set of books.

## 6. What this phase will NOT do, whenever it starts

No chart of accounts invented · no mapping invented · no posting rule invented · no change to the
payroll engine, its states, or the meaning of `Pay` · no bank/WPS (settled by P-HR-10) · PY-12 stays
closed · no tax or insurance treatment (that is P-HR-12, blocked on its own rules).
