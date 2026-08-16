# P-HR-25 — Dynamic Run Cost Report

**Phase 4 of the HR Operations baseline.** Built on `main = eab67eb`, which already carries
P-HR-23's cost-centre stamp and P-HR-24's expression engine.

---

## 1. What this phase is, and why it is allowed to exist

`payroll-reports-and-reconciliation.md` records the rule this repository has followed since
P-HR-15: a **reconciliation** is an identity — two figures either agree or something is wrong — and
is buildable; a **report** is a *definition* — who reads it, which rows, which columns, which
grouping — and **is blocked**, "however obvious the definition seems. 'Obvious' is exactly how an
invented requirement gets in."

That rule is not relaxed here. It is satisfied a different way: **the caller supplies the
definition.** The system offers a closed set of axes it can already group by and a safe way to
describe a calculated column; it does not decide what any report means, for whom, or which columns
matter. Nothing in this phase names a business figure that nobody asked for.

This is what makes the phase possible at all, and it is the reason the owner's D-REPORT-1 = C — a
parameterised aggregate now, a stored builder only if it is later wanted — is the smaller and the
safer half of the same idea.

---

## 2. The decisions

| # | Decision | As approved |
|---|---|---|
| **D-REPORT-1** | What "dynamic" means | **C** — parameterised aggregate, nothing stored. A stored builder stays possible, not assumed |
| **D-REPORT-2** | Where the engine lives | **A** — `modules/hr`. No early generalisation to `platform`, and therefore no source-registry seam |
| **D-REPORT-3** | Data sources | **A** — one: the payslip lines of a single payroll run |
| **D-REPORT-4** | Permissions | **A** — reuse `employee.viewCompensation`. No new key |
| **D-REPORT-5** | Cost-centre axis | **A** — added as the fourth axis |
| **D-REPORT-6** | Where calculated fields evaluate | **A** — JavaScript, after aggregation. Never inside Mongo |
| **D-REPORT-7** | `null` results | **A** — an empty cell; the row is still shown |
| **D-REPORT-8** | Rounding | **A** — none in the engine; presentation formats |
| **D-REPORT-9** | Stale stored definitions | **N/A** — nothing is stored |
| **D-REPORT-10** | Export | **A** — none. PY-12 stays closed |
| **D-REPORT-11** | Ownership / sharing | **A** — none. The existing organisational scope already answers "each department sees its own" |
| **D-REPORT-12** | Phase identifier | **P-HR-25** |
| **D-REPORT-13** | What a calculated column can see | **A** — the current grouped row only. No share-of-run-total, and no new aggregation capability |

---

## 3. The shape

One new endpoint, beside the existing one rather than replacing it:

```
POST /hr/payroll/runs/:id/cost-report        authorize('employee.viewCompensation')

body   { groupBy: 'origin' | 'payItem' | 'branch' | 'costCenter',
         columns?: [{ key, expression: ExpressionNode }] }
```

**Why POST for a read.** A calculated column is an AST, and P-HR-24 allows one of up to 4096 bytes;
several of them do not fit in a query string that any proxy will carry intact. `POST /contracts/preview`
already establishes the pattern here: a request that computes and returns without writing anything.

**Why a second route rather than query parameters on the existing GET.** The GET returns all three
splits at once and is what the current dialog renders. Leaving it exactly as it is means this phase
adds a capability instead of changing one that works.

### The axes

`origin · payItem · branch · costCenter` — a closed enum, validated by Zod. Each is a dimension the
payslip line or the payslip itself **already stores**; none is derived, and none is new data.

`currency` is part of every group key, always, and not by choice: there is no exchange rate anywhere
in this system, so a total spanning two currencies is a defect wearing the costume of a summary.

### The cost-centre axis

`payslip.costCenterId` is a **historical snapshot**, written once under `$setOnInsert` at issue
(P-HR-23). The report reads that stored value. It does **not** re-derive membership from
`hr_cost_center_assignments`, because a payslip issued in March must keep answering with March's
placement however many times somebody has been moved since.

`null` is a real group and is shown as one: every payslip issued before P-HR-23 carries a null cost
centre, which is not missing data — there was no membership to record then.

### Calculated columns

Validated against a catalog derived from the row's own Zod schema through
`expressionCatalogFromSchema`, then evaluated by `evaluateExpression` over the flattened row. The
engine is **consumed, not modified** — no file under `packages/contracts/src/expression/` changes.

---

## 4. What a calculated column can and cannot see

A column is evaluated over **one grouped row**, and the numeric fields of that row are all it can
name: `lines`, `amountMinor`, `amount`.

That is enough for anything intrinsic to the row — cost per line, a scaled amount, a difference
between two of its own figures. It is **not** enough for anything that needs another row: "share of
the run's total" requires the total, and a total across rows is an aggregate. Aggregation is
deliberately absent from the expression language (P-HR-24), so such a column cannot be expressed
today. Recorded here as a limitation rather than solved by widening the language.

**D-REPORT-13 = A** settles this deliberately: a column sees its own row and nothing else. Exposing
run-level totals in the catalog would make ratios expressible without touching the expression
language at all — it stays available as a separate decision, and is not taken here, because "share
of the total" is a business figure nobody has asked for, and inventing one is exactly what the
P-HR-15 rule exists to prevent.

---

## 5. Boundaries this phase respects

* **`modules → platform, shared` only.** The report lives in HR and reads `costCenterRepository`
  from `platform/organization` — the direction the cost-centre assignment service already uses.
* **`baseFilter(scope, …)` inside every `$match`**, as audit finding A2 established. A branch reader
  reconciles and reports on their branch, and an axis does not widen a scope.
* **No Mongo evaluation.** No `$expr`, `$function`, `$where`, `$accumulator` — the guard P-HR-24
  wrote for the engine is extended to this feature.
* **Payroll calculation untouched.** No `calcBasis` change, no rule reads a report, and the P-HR-24
  guard that keeps the engine out of `compensation-rules`, `attendance-quantities` and
  `payslip-eligibility` continues to hold.

---

## 6. A stated decision this phase reverses, in the open

`cost-breakdown.controller.ts` carries this, written when the endpoint was built:

> "It takes no query parameter, deliberately. A grouping, a filter or a period selector would each
> be a REPORT DEFINITION — which rows, for whom, sliced how — and P-HR-15's inventory records that
> nobody has given one."

That reasoning was correct and is now spent: the missing definition has been supplied, by the caller
rather than by the system. The comment is **rewritten to say so**, and the guards that assert "one
GET, no query parameter" and "states all three splits rather than a chosen one" are **re-stated to
the new claim** — not deleted, and not loosened. A guard that quietly stops asserting anything is
worse than one that fails.

---

## 7. What this phase does not build

No stored report definitions · no CRUD · no migration · no backfill · no new permission · no new
page · no navigation row · no export, CSV or PDF · no joins · no report spanning several runs · no
dashboard · no sharing or subscriptions · no change to `filter-eval` · no change to the expression
engine · no reopening of PY-12, P-HR-12, D12, the accounting boundary, or D6-R.
