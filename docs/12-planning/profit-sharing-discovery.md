# P-HR-13 — Profit Sharing

> **STATUS (v1.1) — the phase has SHIPPED. §4.1 was answered by the owner: DISTRIBUTION.**
> The implementation merged as **PR #229** and the six §4 items below did **not** have to be
> answered, because five of them only exist under the other branch of §4.1. §7 records the
> outcome; everything above it is preserved as written, as the record of how the question was
> framed before it was answered.

**Discovery and design only. No formula, no eligibility rule, no timing, no base — none of them
exists in this repository and none is invented here.** *(Still true after #229: the amounts are
typed in, and nothing in the shipped code computes one — see §7.)*

Verified **at the time of writing**: no occurrence of `profitShar` anywhere in `apps/api`,
`packages/contracts` or `apps/web`. The phase was blocked in the strongest sense — not "the code
is missing" but "the rule has never been stated".

> **Corrected in v1.1.** Both sentences above have aged, in opposite directions:
>
> * `profitShar` now appears in **three spec files and nowhere else** — and in all three it is a
>   guard that FORBIDS the word (`settlement-guards.spec.ts`, `reconciliation-guards.spec.ts`,
>   `bulk-distribution-guards.spec.ts`). Production code still contains **zero** occurrences, by
>   design: the shipped feature is named for its shape (`BulkDistribution`), not for profit.
> * "the rule has never been stated" is **no longer true**. The rule was stated — it is
>   *"finance decides each amount outside ECMS"* — and that IS the answer to §4.1.

---

## 1. Where it would enter the existing lifecycle

The repository already has **three shapes** a payment can take, and profit sharing must be one of
them. Which one it is decides the size of the phase, and the answer follows from the rule rather
than from taste.

| shape | what it means | fits profit sharing if… |
|---|---|---|
| **Pay item + assignment** (PY-1/PY-2) | a RATE in force over a dated interval, prorated by the days it was in force, paid every month it covers | …the share is a recurring entitlement. **It almost certainly is not.** |
| **Payroll adjustment** (P-HR-04) | ONE amount, for ONE person, for ONE month, because somebody decided so — with a two-person rule and a frozen-period guard already on it | …the share is a one-off amount per employee in a named month. **This is the natural fit.** |
| **A new engine** | a source of its own, behind a port, like PY-4's attendance and PY-5's leave | …the share must be *derived* by the system from a pool and a formula, rather than decided and entered. |

**The choice is not ours, and it is the first question in §4.** The distinction is sharp: if the
amounts are computed elsewhere (finance decides each person's share) then P-HR-13 is a *distribution*
feature and the adjustment path already carries it end to end — approval, audit, payslip line,
employee visibility (P-HR-19), reconciliation (P-HR-15-A). If the system must compute the shares,
it is an engine, and every input in §3 becomes a requirement.

## 2. What already exists and would be reused either way

| need | where it already is |
|---|---|
| a decided amount, per employee, per month | `PayrollAdjustment` — kind, amount, currency, reason, status |
| the two-person rule | P-HR-04 D1 — recorded under one key, decided under another |
| refusal to touch a paid month | PY-9's `assertPeriodOpen`, re-checked at submit *and* at approval |
| landing on the payslip | `origin: 'adjustment'`, already a closed vocabulary value |
| the employee seeing it | P-HR-19 — `/hr/payroll/adjustments/me` |
| checking it was paid | P-HR-15-A — approved vs on-payslip, per currency |
| **service length** | `employmentPeriods` — derived from hire/rehire/exit, and it already handles rehire gaps |
| **who was employed when** | `employmentSpansOf` + `employedDuring` — the same pair payroll and the settlement both use |
| audit | every write path already records |

**If profit sharing is a distribution, almost nothing needs building.** That is the most valuable
finding here: the expensive-sounding phase may be a screen and a bulk entry path over machinery that
already exists.

## 3. What is missing — and what each gap is made of

| input | status | note |
|---|---|---|
| **the pool** | ❌ absent | there is no concept of company profit anywhere in ECMS, and no place one would live |
| **the formula** | ❌ absent | how a pool becomes an individual amount — flat, by salary, by grade, by service, by attendance |
| **eligibility** | ❌ absent | who qualifies: employment type, service length, leavers, joiners mid-year, `termination` vs `resignation` |
| **timing** | ❌ absent | annual, quarterly, on a named month; and which period the payment lands in |
| **the base** | ❌ absent | if the formula scales by pay, which pay — basic only, or basic plus which allowances |
| **proration** | ❌ absent | a partial year: by months employed, by days, or not at all |
| service length | ✅ available | `employmentPeriods` |
| employment window | ✅ available | `employmentSpansOf` |
| the wage base data | ✅ available | the compensation engine, if a base is chosen |

Note the pattern: **every missing item is a policy, and every available item is a fact.** That is
exactly the line this phase must not cross.

## 4. 🔒 BLOCKED — the decisions, in the order they unblock work

> **v1.1: item 1 is ANSWERED — *distribution*. Items 2–6 are therefore NOT open; they are
> inapplicable under the answered model, and would only re-open if the owner later rules that ECMS
> must compute the shares itself.** They are left standing below, unedited, so that the cost of
> that reversal stays visible.

1. **Distribution or derivation?** Does finance decide each employee's amount (then §1's adjustment
   path carries it), or must ECMS compute it from a pool? Everything else depends on this.
   → **ANSWERED: distribution** (owner ruling, recorded as **D13-1** in §7).
2. **If derivation: the pool** — where the figure comes from, who enters it, and whether ECMS stores
   it at all.
3. **The formula**, stated explicitly.
4. **Eligibility**, including the cases that are never symmetric: a leaver, a mid-year joiner, and
   the different exit types.
5. **Timing**, and which payroll period the money lands in.
6. **The base and proration**, if the formula scales by pay or by service.

## 5. What this phase will NOT do, whenever it starts

No formula, rate, percentage, threshold or eligibility rule invented · no new "profit" entity unless
§4.1 says derivation · no second approval lifecycle — P-HR-04's two-person rule already governs an
amount reaching an employee · no change to the compensation engine's existing sources · no tax
treatment (P-HR-12, blocked on its own rules) · **PY-12 stays closed**.

## 6. The honest summary

**P-HR-13 is one question away from being small.** If the shares are decided outside ECMS, this is a
bulk-entry screen over P-HR-04 and could ship in a single phase. If ECMS must compute them, it is a
new engine and needs all six answers in §4 before a line is written.

Nothing here guesses which.

> **v1.1 — and that is exactly what happened.** The answer was *decided outside ECMS*, and the
> phase shipped in a single PR as a bulk-entry path over P-HR-04. §7 records what landed.

---

## 7. Outcome — what was decided, and what shipped (v1.1)

*Added after the fact. This section records rulings and merged code; it introduces no decision of
its own.*

### 7.1 The rulings

| id | ruling |
|---|---|
| **D13-1** | **Distribution, not derivation.** Finance decides each employee's amount outside ECMS; the system records and routes it. This is §4.1, answered. |
| **D13-2a** | The batch posts against a **pay item** the organization creates, whose `code` is `PROFIT_SHARE`. It is a **row of data, not a constant in the code** — which is why a guard forbids the literal from appearing in any source file. |
| **D13-3** | One batch covers **one period**. |
| **D13-4** | `payItemId` is **required** on the batch — there is no implicit or defaulted item. |
| **D13-5** | A screen is in scope, riding the existing adjustments queue. |
| **D13-6** | `kind: 'earning'` only; a deduction would only be refused by the engine. |
| **D13-7** | At most **5000** rows per batch. |

### 7.2 What merged — PR #229

* **Contracts** — `BulkPayrollAdjustmentRowSchema` (`employeeId` · `amount` · `reason`),
  `BulkCreatePayrollAdjustmentsSchema` (period + required `payItemId` + 1…5000 rows),
  `BulkCreatePayrollAdjustmentsResultDto` (`created` · `duplicates` · `rejected[]`, each refusal
  carrying its row index and reason).
* **API** — `POST /hr/payroll/adjustments/bulk`, behind the key that already records one
  adjustment (`payrollAdjustment.create`). No new permission, no new page, no migration.
* **Service** — `payrollAdjustmentService.createMany()`, which validates the pay item once and then
  creates each row through the SAME `create()` path a single adjustment uses. Every existing guard
  therefore still applies per row: the two-person rule, PY-9's frozen-period refusal, the currency
  derived from the employee's own basic salary, and the audit record.
* **Web** — `BulkDistributionDialog`, opened from the existing adjustments queue.

### 7.3 What it deliberately is not

The shipped feature computes **nothing**. It has no pool, no formula, no eligibility test, no
proration and no base — its guards assert the absence of each. It is a way to *record* amounts that
were decided elsewhere, and profit sharing is the case it was built for rather than a concept it
models. §5's prohibitions all still hold.
