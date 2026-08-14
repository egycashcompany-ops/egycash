# P-HR-11 — End of Service / Final Settlement

**Status:** discovery and design complete. The headline finding is that **most of "final settlement"
already works**, and what remains splits into one buildable part and four that need a legal rule
nobody has given.

---

## 1. What End of Service means in THIS system

Not assumed from the phase name — read off the code. Four separate things already happen when an
employee exits, each owned by the feature that owns the fact:

| on exit | what happens | where |
|---|---|---|
| **Employment ends** | `exit.effectiveDate` is stamped; the employment span closes | `employee.model.ts`, `employment-spans.ts` |
| **Leave stops** | open requests completed at the exit date or cancelled, allocations released, **all balances expired** | `leave-request.service.ts` → `onEmployeeExited`, `leaveBalanceService.expireAllFor` |
| **The loan is settled or flagged** | future instalments **cancelled**; a loan never paid out is cancelled; a loan with a balance becomes `outstandingAtExit` | `employee-loan.service.ts` → `onEmployeeExited` |
| **Pay keeps working** | the leaver stays in the payroll batch for the exit month and is prorated to the day | `payslip-eligibility.ts` → `employedDuring` |

Five exit types exist already: `resignation`, `termination`, `endOfContract`, `retirement`,
`death`.

### THE FINDING THAT RESHAPES THIS PHASE

> **The last salary due is not missing. It already works.**

`employedDuring` puts anyone employed for *any part* of the period in the batch, and
`employmentSpansOf` clips every calculation to the exit date — the same spans both the batch and the
arithmetic read, so they cannot disagree. Somebody who leaves on the 10th is already in that month's
run, already prorated to ten days, and already issued a payslip.

A phase that built a "final pay calculator" would be building a second answer to a question the
payroll engine already answers correctly — and two answers about somebody's last salary is strictly
worse than one.

## 2. What exists, what is missing, what needs a rule

| domain | already exists | missing | needs a new rule? |
|---|---|---|---|
| **Last salary due** | ✅ **complete** — batch inclusion + proration to the exit day | — | **No** |
| **Loan balance** | ✅ **complete** — `outstandingAtExit`, future instalments cancelled, balance derived live | it is not recovered from final pay | **No — already ruled** (D8, §3) |
| **Leave balance** | ⚠️ balances are **expired** at exit, with a ledger entry | encashment (paying unused leave) | **YES — legal** |
| **Payroll adjustments** | ✅ work normally in the exit month; the frozen-period guard applies | — | **No** |
| **Overtime** | ✅ approved minutes priced as in any month | — | **No** |
| **Deductions** | ✅ any `deduction` pay item, unchanged | — | **No** |
| **Notice period** | ❌ **nothing anywhere** — the only `noticePeriod` in the repository is a free-text answer on a job application | length, whether pay replaces it, how it is computed | **YES — legal** |
| **Severance / EOS benefit** | ❌ **nothing** | everything | **YES — legal** |
| **Settlement approval** | ✅ the two-person shape exists three times over (P-HR-04 D1, P-HR-05 D2, P-HR-10) | — | **No** |
| **Payment recording** | ✅ P-HR-10 records payment at the RUN level | a per-employee payment, if one is ever wanted | **No** (would be a scope decision, not a rule) |
| **Audit** | ✅ every exit act already audited | — | **No** |

**Six of eleven rows need nothing.** Three need a legal rule. One is already ruled. One is a scope
question, not a rule.

## 3. `outstandingAtExit` — verified, and it is enough

Every question asked of this seam, answered from the code:

* **How is exit determined?** The `exit` personnel action stamps `exit.effectiveDate` and emits
  `hr.employee.exited` carrying that date. P-HR-05-B added `effectiveDate` to the payload precisely
  because the event fires *before* the employee document is saved — a consumer re-reading the
  employee would get pre-exit state.
* **When does the loan become `outstandingAtExit`?** In `onEmployeeExited`, and only when the loan is
  `active` **and** still owes something. A loan not yet disbursed is `cancelled` instead — there is
  no debt behind it. A loan already clear is left alone.
* **Snapshot or live?** **Live.** `remaining` is derived — `principal − (payroll repayments +
  external settlement)` — and the contract says explicitly it is never stored, so it cannot drift
  from the rows it summarizes.
* **More than one loan?** **No.** D3 allows one live loan per employee (`findLive`), enforced with a
  409, so there is exactly one balance to talk about.
* **Guardrails against double deduction?** **Yes, two.** Future `planned` instalments are
  `cancelled` at exit, so no later payslip can take one. And a repayment is written only when a NEW
  payslip is issued, under a unique key.
* **Can the same loan be deducted twice — once by a payslip, once by a settlement?** **Not by any
  path that exists.** The instalments are cancelled, and the repayment ledger is what `remaining`
  subtracts, so a deduction that already happened is already gone from the balance.

**Conclusion: no new abstraction. Nothing here needs building or wrapping.**

D8 also already ruled the question a settlement would otherwise raise: an outstanding loan at exit
is *"not a failure and not an error — a fact somebody has to act on outside this system"*. Automatic
recovery from final pay is therefore **not** an open question and is not reopened here.

## 4. Scope, split as required

### A — Final settlement → **mostly already works; one real gap**

The gap is not arithmetic, it is **visibility**. Everything a settlement needs to state is computed
somewhere, and **nothing brings it together**: the exit month's compensation lives in payroll, the
loan balance in the loans feature, the expired leave in the leave ledger, the adjustments in theirs.
Whoever settles with a leaver today opens four screens and adds up by hand.

That is exactly the defect P-HR-06 and P-HR-08 each closed, in the same shape: **a read that
assembles what already exists**, computing nothing new.

### B — Severance / EOS benefit → **BLOCKED, legal**

Nothing exists and nothing can be derived. See §5.

### C — Bank / WPS → **out of scope, already ruled**

P-HR-10 settled that `Pay` means recorded-as-paid inside the system. Not reopened.

### D — PY-12 export / PDF → **closed by decision**

A settlement summary is a screen, not a document. Not reopened, and asserted by a guard.

## 5. POLICY DECISIONS — needed before any amount can be computed

Each states the rule, the data it needs, and where it would live. **None is guessed.**

### 5.1 End-of-service gratuity

* **Rule needed:** the entitlement formula — service-length bands, the wage base (basic only, or
  basic plus which allowances), how partial years count, and which exit types qualify.
  `termination` and `resignation` are not the same case in Egyptian law, and `death` is a third.
* **Data needed:** service length — **available** from `employmentPeriods`, which already handles
  rehire gaps. The wage base — **available** from the compensation engine. So the *inputs* exist;
  only the formula is missing.
* **Where it would live:** a pure function beside `compensation-rules.ts`, priced as an earning on
  the exit month. Not a new engine.

### 5.2 Leave encashment

* **Rule needed:** whether unused leave is paid at exit, which leave types, at what day rate, and
  whether any cap applies.
* **Data needed:** the balances — **available**, and currently **expired** with a ledger entry
  reading `employee exited`. The rate — available from the leave-pay engine (PY-5).
* **A trap worth recording, because it cost a red CI run:** `expireAllFor` stamps each ledger entry
  with the **balance's** year (`row.year`), not the exit's. A balance granted for 2026 that is
  expired by an exit dated 2025 is written as 2026 — so reading the ledger "for the exit year"
  reports that nothing was lost, which is the most misleading answer this screen could give. Every
  expired entry is read instead, each carrying its own year, scoped to the current employment
  period so a rehired employee's earlier exit is not counted again.
* **Where it would live:** the expiry would become a paid-out branch, or an earning on the exit
  month. **The current behaviour is a real decision, not an oversight: today the balance is expired,
  which means unused leave is NOT paid.** If that is wrong, it is wrong now and this is the rule that
  fixes it.

### 5.3 Notice period

* **Rule needed:** its length by contract type or service length, and whether pay in lieu is owed
  when it is not served.
* **Data needed:** **the length does not exist anywhere in this system** — not on the contract, not
  on the employee, not in settings. This is the only one of the three where a field would have to be
  added before a rule could even be applied.
* **Where it would live:** on the contract type or the contract itself, then priced as an earning.

### 5.4 Whether a settlement is *approved* as its own decision

Not a legal rule — a scope question, recorded so it is not answered by accident. Today an amount
reaches a leaver as a payroll adjustment on the exit month, which already carries a two-person rule
and a frozen-period guard. A settlement entity with its own approval would be a **second** approval
lifecycle over the same money. **Not built, on the §7 principle: the adjustment exists, so no new
correction entity.**

## 6. What P-HR-11 builds

**A read-only settlement summary, and nothing else.**

* One assembled read for an exited employee: the exit facts, the exit month's compensation, the
  outstanding loan (if any), the leave the exit expired, and the exit month's **undecided**
  adjustments.
* **Undecided adjustments only, and that is a decision.** An *approved* adjustment is already a
  line inside the exit month's compensation, so listing it again would put the same money on the
  screen twice and invite whoever settles to count it twice. A *cancelled* one is not money. What
  is left is the case that would otherwise be invisible: a bonus or a penalty still sitting in
  somebody's queue, about the month being settled, and in nobody's total.
* Every figure comes from the service that already owns it. **No arithmetic is performed here** —
  the summary quotes, it does not compute.
* The amounts §5 blocks are **absent and named on the screen**, so nobody mistakes an incomplete
  settlement for a complete one.

### What it will NOT add

No settlement entity, no settlement lifecycle, no second approval, no new financial rule, no EOS
formula, no leave encashment, no notice period, no automatic loan recovery, no bank file, no
migration, no new permission — reading a leaver's money is reading pay, which
`employee.viewCompensation` already governs.

## 7. Test matrix

| case | expectation |
|---|---|
| exited employee, summary read | assembles all four sources |
| still-employed employee | refused — there is nothing to settle |
| exit month compensation | equals what the compensation engine returns for that period |
| outstanding loan present | quotes the derived balance; does not recompute it |
| loan already settled | reports no outstanding balance |
| loan never disbursed | reports none — it was cancelled, not owed |
| leave balances | reports what the exit expired, read from the ledger (the balance is zeroed) |
| the expired entry's year | the **balance's** year, never the exit's — they routinely differ |
| undecided adjustment on the exit month | listed |
| approved adjustment on the exit month | **not** listed separately — it is already a line in `finalPeriod` |
| frozen exit month | the summary still reads; nothing is written |
| permissions | behind `employee.viewCompensation`; refused without it |
| no write path | asserted — the feature has no mutation at all |
| no EOS/notice/encashment figure | asserted absent, so a rule cannot arrive unnoticed |
| PY-12 / bank | asserted absent |

Legal rules that do not exist do **not** become assumed tests.
