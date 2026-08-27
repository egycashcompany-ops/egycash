# B1 — Payroll Report Builder

**Scope B1**, built on `main = 882ba1a`. No roadmap identifier is claimed here: the phase name is a
proposal only, and inventing a `P-HR-nn` would be inventing a decision (D-B1-7).

---

## 1. What this is, and what it finishes

P-HR-25 built the **execution** of a run cost report: a scoped aggregation over payslip lines, one
axis at a time, with calculated columns evaluated by the P-HR-24 expression engine. What it did not
build is the half the requirement actually named:

> «نحتاج Dynamic Report **Builder** لكل إدارة. بالإضافة إلى Report للشركة بالكامل.»

B1 adds **the definition** on top of that execution: a stored report — its dimensions, measures,
filters, sort and calculated columns — that a person composes, saves, and runs.

**The P-HR-15 rule still holds and is still satisfied the same way.** A report is a *definition*, and
this system invents none: the definition is authored by the user and stored as their words. What
changes from P-HR-25 is only that the definition now **persists** instead of arriving with each
request.

---

## 2. The decisions, as approved

| # | Decision | As approved |
|---|---|---|
| **D-B1-1** | Permissions | `payrollReport.view` + `payrollReport.manage`; **execution requires those AND `employee.viewCompensation`** |
| **D-B1-2** | Measures | `lineCount` and `amountMinor` only. No `avg` / `min` / `max` |
| **D-B1-3** | Filter operators | `eq` · `ne` · `in` · `nin` only |
| **D-B1-4** | Composable dimensions | Yes — `GROUP_KEYS` is decomposed into atomic dimensions, **under a strict equivalence test against the current output** |
| **D-B1-5** | Versioning | **Corrected — see below.** An edit carries the `version` it read, and `BaseRepository.updateById` enforces it |
| **D-B1-6** | Preview | Yes — an unsaved definition can be executed |
| **D-B1-7** | Phase identifier | **Not chosen.** Recorded as scope B1 |

### D-B1-5 was decided on a misreading, and is corrected here

The original decision — *expose `version`, do not demand it back* — was argued from the claim that
this codebase's catalogs expose a version without enforcing one. **That claim was wrong, and the
error was mine.** The line cited as evidence, `version: doc.__v` in `cost-center.service.ts`, is the
DTO's **output**; the update input is a different thing entirely, and `UpdateCostCenterSchema`
carries `version: z.number().int().min(0)`.

What the code actually does, found while implementing stage 2:

```ts
// apps/api/src/shared/base/base.repository.ts:253
async updateById(id, set, meta: WriteMeta & { version: number; … }) {
  const filter = this.baseFilter(meta.scope, { _id: …, __v: meta.version, … });
```

`version` is **required**, and it is matched inside the update itself. Every update in this
repository passes one. Optimistic concurrency is the house pattern, not an option, and a report
definition is not the one entity that gets to opt out.

**Corrected: an edit carries the version it read.** A mismatch raises the platform's
`StaleDocumentError` (409) and writes nothing — the update is a single atomic `findOneAndUpdate`, so
a failed check cannot leave half a definition behind. Deleting takes no version, which is
`softDeleteById`'s shape for every entity in this system rather than a gap in this one.

### Why a new permission is proven, not assumed

`validatePageRegistry` refuses `empty-page` (`packages/contracts/src/permissions/def.ts:213`), and the
rule is deliberate: *"A page with no permissions renders as an expandable row containing nothing …
Failing the boot is the honest response."* A builder needs a page; a page needs a permission. So the
"reuse what exists" preference cannot hold here, and D-B1-1 is the smallest thing that satisfies it.

**Execution demands both keys.** `payrollReport.view` governs the builder; `employee.viewCompensation`
governs reading somebody's pay. If execution took only the first, the new key would become a way to
read payroll without holding the payroll key — a permission bypass wearing the costume of a feature.
`authorize` is an ordinary middleware, so chaining two of them is an AND. **No existing route chains
two**, so this is a sound pattern without precedent in this repository, and it is stated here rather
than discovered later.

---

## 3. The data source, closed at one

`sourceId` accepts exactly `payrollRunLines` — the payslip lines of a single payroll run (D-REPORT-3
= A). Multi-source stays out; if it is ever wanted it reopens D-REPORT-2 (where the engine lives) and
is a phase of its own.

### Dimensions

`kind` · `origin` · `payItem` · `branch` · `costCenter`

**`currency` is not on that list, and its absence is the point.** It is part of every grouping key,
always, and cannot be selected or removed: there is no exchange rate anywhere in this system, so a
row spanning two currencies would be a defect wearing the costume of a summary.

`costCenter` reads `payslip.costCenterId` — the snapshot P-HR-23 stamps once at issue — and is never
re-derived from today's membership. `payItem` carries the code the LINE stored, not the catalog's
today, so a later rename cannot restate a document somebody was paid against.

### Measures

`lineCount` and `amountMinor`. These are **exactly what the existing pipeline already computes**;
anything else is a new aggregation, and D-B1-2 keeps it out.

### Calculated fields

The P-HR-24 AST, unchanged — same nodes, same limits, same validator, same evaluator, evaluated in
JavaScript after the aggregation. **Nothing under `packages/contracts/src/expression/` changes.** A
column sees the measures of its own row and nothing else, which is D-REPORT-13 = A carried forward.

---

## 4. Filters — where the security actually lives

**The fields a filter may name are the declared dimensions plus `currency`. Nothing else, ever.**

The contract carries **names**, never paths. `'branch'` is a name; `'$branchId'` is a path, and the
mapping from one to the other lives in code that no request can reach. This is the whole answer to
"no field path from the user reaches Mongo": there is no path in the request to begin with.

**Values are validated by field**, not accepted as free text — an ObjectId where an id belongs, a
member of the closed vocabulary where an enum belongs, three letters where a currency belongs.

**A filter cannot widen a scope, structurally.** Execution starts with `baseFilter(scope, { runId })`,
which produces an `$and`; a user filter is one more condition inside that `$and`, and adding a term
to a conjunction narrows it. There is no shape a filter can take that removes a condition already
there.

### One token worth naming

`none` selects the group where the dimension is null — the payslips issued before cost centres
existed, the lines with no pay item. That group is real and is shown (D-REPORT-7 = A), so it must
also be selectable; without the token it would be visible and unfilterable.

### The shape, and why every filter carries a list

`{ field, op, values[] }` — one shape for all four operators, with `eq` and `ne` refusing anything
but a single value. A UI renders one control instead of two, an API validates one schema instead of
two, and "equals" stays unambiguous.

---

## 5. Sorting

One key, chosen from the dimensions or measures the definition actually selected, plus a direction —
and a **deterministic tiebreak** underneath it, so two rows that tie do not swap places between two
runs of the same report.

---

## 6. Scope — how "لكل إدارة" is answered without an ownership model

A definition is stored with **no owner and no sharing** (D-REPORT-11 = A). The narrowing happens at
**execution**, through the `scopeSelector` this system already has: the same saved definition hands a
reader whose scope is `branch` their branch's figures and hands a reader whose scope is
`organization` the whole company's — with no ownership entity, because the scope ladder
`own → section → department → branch → organization` already expresses who may see what.

A filter cannot escape that. The scoped `$match` is the first stage of the pipeline and a user filter
is a later one, and a `$match` after a `$match` can only narrow what survived the first. This is a
property of the pipeline's **shape**, not of a check somebody has to remember.

### F-B1-1 — the ladder does not actually reach the department, and this design said it did

> **CLOSED by P-SCOPE-1.** `payslip.departmentId` is now stamped at issue and declared to the
> repository, so a `department`-scoped grant narrows every payslip read — this report included,
> without a line changing here, because the scope arrives through the same `baseFilter` it always
> did. `section` is still unnarrowed, deliberately (D-DEPT-5).
>
> The finding below is kept as written, in the present tense it was written in. It is the record of
> what was true for four phases and of how it was found, and the last paragraph turned out to be
> exactly right: the characterization test DID fail when the gap was closed, and was replaced by
> its opposite in `hr-payroll-reports.spec.ts`. See `payroll-department-scope-design.md`.

**The earlier text of this section was wrong.** It claimed a *department* manager is answered with
their department's figures. The code does not do that, and never did:

- `payslip.model.ts` stores `branchId` and `costCenterId`. There is **no department field**.
- `payslip.repository.ts` therefore declares `branchField: 'branchId'` and nothing else.
- `BaseRepository.scopeFilter` answers a scope whose field is undeclared with `{}` —
  `orgScopeFilter(undefined, id)` returns an empty filter — and `baseFilter` drops empty clauses.

So a grant of `employee.viewCompensation` at **`department`** (or `section`) scope narrows a payslip
read by **nothing**: that reader is answered exactly as an `organization`-scoped reader is.

This is **inherited, not introduced by B1**. Every payslip read has behaved this way since PY-7 — the
payslip list, the reconciliation, the P-HR-14 cost breakdown and the P-HR-25 dynamic report all run
the same `baseFilter`. B1 reuses that pipeline deliberately (§3), so it reuses this with it.

It matters here because it is the **exact requirement B1 was approved to answer**: D-GAP-3′ settled
that «الإدارة» means the organizational unit, and "لكل إدارة، بالإضافة إلى الشركة بالكامل" is the
sentence this scope section exists to satisfy. Branch-level narrowing satisfies the second half and
approximates the first.

`apps/api/tests/integration/hr-payroll-reports.spec.ts` asserts the **actual** behaviour under this
name, so the gap is visible in the test output rather than only in prose — and so that any later fix
fails a test instead of passing silently.

**Not resolved in B1.** Closing it means changing what a payslip stores or how a payslip read is
scoped, and `payslip.model.ts` is on the do-not-touch list for this scope (§7). It is recorded for the
owner's decision.

The **list of definitions** is metadata, not pay, so it is read with `payrollReport.view` and carries
no organizational scope of its own.

---

## 7. What B1 does not build

multi-source · accounting integration · budget or target · allocations or distributions · hierarchy
(**D-CC-4 stands**) · export · scheduling · dashboards · ownership or sharing · execution history ·
reports spanning several runs.

**Not touched:** `packages/contracts/src/expression/**` · `filter-eval.ts` · `compensation-rules.ts` ·
`attendance-quantities.ts` · `payslip-eligibility.ts` · `payslip.model.ts` · the cost-centre module ·
`permission-matrix.generated.md` (the generator reads platform permissions only, and these are `hr`).

---

## 8. Stages

1. **Design + contracts/schema** ← this commit
2. API model / repository / service
3. Generalising the P-HR-25 pipeline **without copying it**, under an equivalence test
4. Permissions, routes, navigation
5. Web builder, AST composer, preview
6. Tests and scope barriers
7. Gates and CI

Each stage stops for review.
