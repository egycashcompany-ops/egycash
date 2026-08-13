# Legacy `employment.allowances[]` → Pay Items (PY-10)

**Status:** investigation + convertibility tooling delivered. The conversion itself is **blocked on
two decisions with money attached** (D1, D2 below). Nothing in this phase writes, deletes or
migrates a single row.

**Base:** `main` at `cd785ca`.

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

## 5. Decisions required before any data moves

### D1 — Does converting mean these amounts start being **paid**?

Payroll has never included them (§3.2).

- **(a) Yes** — the allowance was always real pay and payroll simply did not know about it. Then
  conversion raises everyone's compensation total, and the first run after it prices differently.
- **(b) No** — convert as `archived`/zero, or not at all. Then the migration is bookkeeping and
  the `legacyAllowancesIgnored` warning could simply be retired instead.

**No recommendation.** This is a statement about what this organization owes people, and nothing in
the code implies either answer.

### D2 — If (a): from which date?

There is no date in the data — the brief forbids inventing one.

- **(a) The migration date** (or the first day of the first period with no frozen run). Invents
  nothing, changes no historical figure, and is consistent with PY-9: the past is frozen and
  backdating into it is refused. **This is the only option that asserts nothing false**, and is
  what I would implement if D1 = yes.
- **(b) The employee's hire date.** Asserts the current allowance applied since hire — false for
  anyone whose allowances ever changed, and it would collide with PY-9's guard on every frozen
  month.

### D3 — What happens to unmapped names?

`readinessOf().convertible` is false until every row maps. Either HR creates the missing catalog
items first (the honest path), or the migration creates them from free text — which means
generating codes from Arabic names and inventing a `kind`/`calcBasis` per item. **Recommend the
first**; the tooling above produces the exact work list.

### D4 — Do the producers stop? (§3.1)

Without this there is no "single source", only a copy. Options: leave offers as they are and accept
that `employment.allowances[]` remains the *offer record* while pay items are the *payroll record*
(two sources, deliberately, with distinct meanings) — or change the offer contract in a Recruitment
phase of its own.

### D5 — When may the legacy array be deleted?

Only after D1–D4 and a green `convertible`. Until then the array stays and stays readable; the web
employment tab keeps showing it.

## 6. What was NOT done, and why

No migration script, no writes, no deletion, no change to the offer or registration surfaces, no
change to what payroll pays. Every one of those depends on D1, and answering D1 inside an
autonomous phase would be inventing a requirement about money.
