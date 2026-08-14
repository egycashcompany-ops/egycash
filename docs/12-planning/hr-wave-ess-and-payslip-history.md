# HR Operations — the next wave: P-HR-18, P-HR-19, P-HR-20

**One plan, three phases, chosen from the repository rather than from the old roadmap.**

---

## 0. Why not P-HR-12..15

Re-checked against `main` at `cd726ab`. There is still **no** occurrence of `incomeTax`,
`socialInsurance`, `generalLedger`, `journalEntry` or `profitShar` anywhere in `apps/api`,
`packages/contracts` or `apps/web`, and no file defines what P-HR-12..15 mean. Each of the four
needs a rule that does not exist here:

| phase | the missing rule |
|---|---|
| P-HR-12 statutory deductions | brackets, rates, wage base, exemptions, insurance ceilings, employer vs employee share |
| P-HR-13 profit sharing | the formula, who qualifies, the timing, the pool |
| P-HR-14 GL / posting | the chart of accounts, pay-item→account mapping, posting rules |
| P-HR-15 reports | which reports, for whom, with which columns |

P-HR-12 is worse than blocked — building its *scaffolding* would **contradict an existing
decision**. `hr-payroll.ts` opens by stating that there is deliberately no `taxable` flag, no
statutory category, no bracket and no contribution rule, *"because a field with no consumer would
be a claim about legislation that this system has not been given"*. Adding that field now would
reopen a decision nobody has revisited.

So none of the four enters this wave. **The fourth phase carried forward is documented in §5.**

## 1. How these three were found

The same way P-HR-08 and P-HR-16 were: by looking for **a fact the system records or announces that
nothing reads**.

| phase | the evidence, in one line |
|---|---|
| **P-HR-18** | `employee-loan.service.ts` notifies **the employee's own login** twice (`Decided`, `Disbursed`) — and there is no screen anywhere an employee can see their loan |
| **P-HR-19** | `payroll-adjustment.service.ts` notifies **the employee's own login** on `Decided` — same gap, same shape |
| **P-HR-20** | `ListPayslipsQuerySchema` carries an `employeeId` filter that is applied **only inside one run**, where an employee has at most one payslip. No route can list one employee's payslips across runs |

All three are reads over data that already exists. **None needs a business rule, and none is
blocked.**

## 2. The three phases

### P-HR-18 — Employee Self-Service: My Loans

* **Scope:** the caller's own loans, with their schedule and what is left.
* **Already exists:** the whole lending feature; `employeeLoanService.listForEmployee` and
  `childrenFor` (the batch schedule read P-HR-05 built for the profile tab); the `/me` posture,
  established three times (`payslips/me`, `attendance/days/me`, regularizations `/me`).
* **Built:** `GET /hr/employee-loans/me`, own-scope **by construction** — the employee is resolved
  from the login link and nothing the caller sends can widen it, so it carries **no permission**,
  exactly as PY-11 documents for payslips. One web page under the payroll subtree, plus i18n.
* **Contracts:** none new. `ListEmployeeLoansQuery` and `EmployeeLoanDetailDto` already say it.
* **Pages/permissions/events:** **none.** ESS routes carry no permission and appear in no page
  registry — that is how My Payslips, My Leave and My Attendance already work.
* **Not built:** no write of any kind. An employee cannot request a loan here: recording one is
  `employeeLoan.create` and the two-person rule (D2) owns that path.

### P-HR-19 — Employee Self-Service: My Payroll Adjustments

* **Scope:** the bonuses and penalties recorded about the caller, and where each stands.
* **Already exists:** `payrollAdjustmentService.listForEmployee`, the DTO, the mapper, the same
  `/me` posture.
* **Built:** `GET /hr/payroll/adjustments/me`, own-scope by construction, no permission. One web
  page under the payroll subtree, plus i18n.
* **Contracts:** none new.
* **Not built:** no write. An employee cannot record or contest an adjustment from here — P-HR-04
  put both under `payrollAdjustment.create`/`approve`, and this phase does not touch that.
* **A real limit, stated:** `draft` entries are excluded. A draft is the recorder's private working
  note (P-HR-07's words), and showing somebody a penalty nobody has decided to apply would be
  telling them about a decision that has not been taken.

### P-HR-20 — Employee payslip history (HR-facing)

* **Scope:** one employee's payslips across every run, on their profile.
* **Already exists:** the payslips feature, `PayslipDto`, `ListPayslipsQuery.employeeId` — a filter
  with nowhere useful to be used today.
* **Built:** `GET /hr/employees/:id/payslips` behind **`employee.viewCompensation`** (the key that
  already governs `/payslips/:id` and the run's list), and a **Payslips tab** on the employee
  profile beside Pay Items / Adjustments / Loans / Settlement.
* **Contracts:** none new — the query and DTO already exist.
* **Pages/permissions:** **none.** The tab rides `compensationVisible`, the answer the profile
  already has.
* **Not built:** no PDF, no export, no print — **PY-12 stays closed**. No recalculation: a payslip
  is a frozen document and this reads it.

## 3. Dependencies

**None between them functionally** — three different features, three different routers, three
different endpoints. Each could ship alone.

They are developed **stacked** (18 → 19 → 20) for one mechanical reason: all three touch
`i18n.ts`, and 18 and 19 both add a route to `payroll/routes.tsx`. Stacking resolves that once,
here, instead of leaving a conflict for whoever merges second. **Merge order is 18 → 19 → 20**, and
each base is retargeted to `main` before its merge — the sequence #211→#214 already used.

## 4. Tests and guards, per phase

Every phase gets the same three layers:

* **Guards (source-scanning):** the `/me` route carries **no** `authorize(...)`; the controller
  drops any `employeeId` the caller sends; there is no mutating verb; no export/PDF vocabulary; and
  for P-HR-20, no new permission and no page.
* **Integration:** the own-scope read answers for the caller and **nobody else** — the decisive case
  is a second employee's row never appearing, and a login with no employee link getting 404 rather
  than an empty list; plus 401 unauthenticated. For P-HR-20: 403 without the compensation key.
* **Web:** lazy-loaded, no mutation, no `can(...)` on ESS surfaces, both locales for every key.

## 5. The fourth phase, and why it waits

**P-HR-15 — Reports** is the nearest of the four to being possible, because some of what a report
would show already exists (a run's payslips, their totals, the adjustments queue). It is **not** in
this wave because *which* reports are wanted, for whom, and with which columns is a requirement
nobody has given — and a report built on a guess is worse than none, since people act on it. It
also brushes against PY-12, which is closed by decision; a "printable report" would reopen it
sideways.

It enters a wave the moment the report list exists. P-HR-12, P-HR-13 and P-HR-14 wait on legal and
accounting rules and are further away.

## 6. What none of these three may do

No tax, insurance, profit-share, GL or report rule. No EOS formula, leave encashment, notice
period, retro rule or overtime multiplier. No bank/WPS. **PY-12 stays closed. `reviewed` is not
added. `Pay` keeps its meaning.** No new permission, collection, event or migration in any of the
three — every one of them is a read over facts another feature already owns.
