# P-HR-13 — Profit Sharing

**Discovery and design only. No formula, no eligibility rule, no timing, no base — none of them
exists in this repository and none is invented here.**

Verified: no occurrence of `profitShar` anywhere in `apps/api`, `packages/contracts` or
`apps/web`. The phase is blocked in the strongest sense — not "the code is missing" but "the rule
has never been stated".

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

1. **Distribution or derivation?** Does finance decide each employee's amount (then §1's adjustment
   path carries it), or must ECMS compute it from a pool? Everything else depends on this.
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
