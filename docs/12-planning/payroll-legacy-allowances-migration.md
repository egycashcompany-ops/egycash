# Legacy `employment.allowances[]` → Pay Items (PY-10)

**Status: CLOSED.** The decisions below are **frozen and approved by the owner**; §5 records how each
open question was answered. Nothing here writes, deletes or migrates a single row — under the
approved decisions there is no data migration to run, and the phase closes as a rule that is now
enforced in code.

**Base:** `main` at `cd785ca`; closed on `main` after HR3-C.

---

## 1. What the legacy shape actually is

```ts
// packages/contracts/src/modules/hr-job-offer.ts
AllowanceSchema = { name: string(1..100), amount: number ≥ 0, currency: string(3) = 'EGP' }
```

A **free-text name**, an amount, a currency. No code, no kind, no calculation basis, **no dates**.

A pay item is the opposite: a coded catalog entry whose `kind` and `calcBasis` *are* its meaning
(`hr-payroll.ts` — both immutable by contract precisely because a payslip line cites them),
assigned to an employee over a dated interval that may not overlap another.

## 2. Every place it is read or written

| file | role |
|---|---|
| `employee.model.ts:64,197` | the stored array |
| `employee.mapper.ts:47` | read → DTO, redacted without `employee.viewCompensation` |
| `employee.service.ts:174,376` | written at creation (direct register, offer acceptance) |
| `employee-action.service.ts:400` | **written** by `salaryChange` — replaces the whole array |
| `employee-action.service.ts:749,784` | written on rehire from stored terms |
| `job-offer.service.ts:65,283` · `job-offer.model.ts:40` · `job-offer.mapper.ts:20` | the offer package the candidate is shown |
| `EmploymentView.tsx:62` (web) | displayed on the employment tab |
| `compensation.service.ts:126` | payroll — **only** as the boolean `hasLegacyAllowances` |

## 3. The two findings that shape the phase

### 3.1 The list has live producers — a one-shot migration cannot give "one source"

Three flows still write it today: **offer acceptance**, **direct registration**, and the
**`salaryChange` action**. Converting today's rows would leave tomorrow's offer creating new ones.

Achieving *one* source therefore requires stopping the producers — which means changing what a
**job offer** is. An offer states allowances as part of the package presented to a candidate; it is
a business document, not a payroll row, and it is authored before the employee (and often before
any catalog item) exists. Removing allowances from offer terms is a Recruitment change with a
contract break, not a payroll clean-up.

### 3.2 Payroll has **never** read these amounts — so migrating them starts paying them

`compensation.service.ts` reads `allowances` only to raise the `legacyAllowancesIgnored` warning.
No compensation figure, no payslip and no total has ever included a legacy allowance.

So converting them into pay-item assignments does not "tidy up a duplicate source" — it **adds
money to payroll for every employee who carries one**. That is a business decision about what
people are paid, and this phase does not take it.

## 4. What is delivered here

`payroll/employee-pay-items/legacy-allowance-mapping.ts` (pure, 0 writes) — the gate the brief
names first: *prove every record is convertible before deleting any of them*.

- `classifyAllowance(allowance, catalog)` → `byCode` · `byName` · `ambiguous` · `unmapped` ·
  `notPayable`
- `readinessOf(mappings)` → counts, the distinct names nobody can convert yet, and one boolean:
  `convertible`.

**Matching is exact only** — a catalog code, or exactly one item's Arabic or English name, after
trimming and case folding. Nothing fuzzy. `بدل سكن` and `بدل السكن` are two strings, and deciding
they are one allowance is a judgement about this organization's payroll that no similarity score
should make. `ambiguous` (several items carry the name) blocks convertibility exactly as
`unmapped` does.

## 5. The frozen decisions (approved)

| # | decision |
|---|---|
| **1** | A legacy-allowance migration **is not a payment** and creates **no new financial entitlement**. |
| **2** | **No automatic retroactivity.** Pay Items begin at an explicit transition/migration date. |
| **3** | `employment.allowances[]` **does not become a payroll source** — not during the transition, not after it. |
| **4** | Once migration is complete, **Pay Items are the operational Single Source of Truth** for payroll. |
| **5** | The legacy `allowances[]` is **not deleted**. It stays as historical/audit data and enters no payroll calculation after the transition date. |
| **6** | **No additional financial rule** beyond these is to be invented. |

### How they answer the open questions

- **D1 — does converting mean these amounts start being paid?** → **No** (decision 1). This was the
  question with money attached, and it is now settled in the direction that changes nobody's pay.
- **D2 — from which date?** → Only from an **explicit transition date** (decision 2). No hire-date
  backfill, and therefore no collision with PY-9's frozen-period guard.
- **D3 — unmapped names?** → Unchanged: `readinessOf().convertible` stays false until HR creates the
  missing catalog items. Because of decision 1 this is now a **readiness report**, not a gate on a
  payment; `legacy-allowance-mapping.ts` produces the work list.
- **D4 — do the producers stop?** → They do not need to. Decision 3 removes the reason: offers,
  direct registration and `salaryChange` may keep writing the array because it is the **offer/HR
  record**, and Pay Items are the **payroll record** (decision 4). Two sources with two distinct
  meanings, deliberately, rather than one source achieved by breaking the offer contract.
- **D5 — when may the array be deleted?** → **Never** (decision 5). It is history.

### What "closed" is enforced by

Decision 3 is the one that can be broken by accident — it is one property access wide, and the
array sits on the same document as the salary. So it is enforced **twice**, the way every other
seam in this repository is:

1. **eslint** — `no-restricted-syntax` over `apps/api/src/modules/hr/payroll/**`, forbidding any
   `employment.allowances` member expression. One file is exempted: `compensation.service.ts`,
   which raises the warning.
2. **`compensation/legacy-allowances-seam.spec.ts`** — reads the payroll sources and asserts that
   exactly one file mentions the array, that all it does there is `.length > 0` (never `.amount`,
   `map(` or `reduce(`), that the pure engine receives a `boolean` and never the rows, and that
   payslips and runs never mention it at all. Then it computes the same period twice, with and
   without the list, and asserts the earnings, deductions, deferred lines and all three totals are
   **identical** — the only difference being the `legacyAllowancesIgnored` warning.

The second half is stated as an identity between two runs rather than as expected numbers on
purpose: it stays true when the pricing rules change, which is exactly when a regression would
otherwise slip through.

## 6. What was NOT done, and why

No migration script, no writes, no deletion, no change to the offer or registration surfaces, and
**no change to what payroll pays** — decision 1 is precisely that payroll's figures do not move.

The `legacyAllowancesIgnored` warning is **kept**, not retired. Under these decisions it says
exactly the right thing: this employee carries allowances on the employment tab, and payroll does
not price them. Retiring it would remove the only place the system admits to the two records.

Converting an organization's existing allowance rows into pay-item assignments remains available as
ordinary configuration work — create the catalog items `readinessOf()` reports as missing, then
assign them from the agreed transition date (decision 2). That is data entry under decisions
already made, not a phase.
