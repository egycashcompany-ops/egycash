# P-HR-24 — Shared Safe Expression Engine

**Status:** implemented, Phase 3 of the HR Operations baseline. Built on `main = 1089ce2`
(P-HR-23 / dynamic cost centres).

This phase ships **one capability and no surface**: a calculated field can be described as data,
checked against a declared catalog, and evaluated — without anything, anywhere, executing a string.
There is no route, no page, no permission and no consumer. Phase 4 (Dynamic Reports) is what will
call it.

---

## 1. Why an engine, and why only an engine

The approved execution order places a shared expression engine *before* dynamic reports, and the
requirement that produced it was explicit: build **one** safe expression engine for reports and
anything similar, **not two languages and not two engines**.

Discovery against `main` found the following, and the design follows from it:

| finding | consequence |
|---|---|
| **Zero** dynamic code execution exists in the repository — no `eval`, no `new Function`, no `vm`, no `jsonata`/`mathjs` | that baseline is a property to preserve, not a gap to fill |
| One restricted expression form exists: `AutomationFilterSchema` + `filter-eval.ts` — **boolean only**, ten comparison operators, AND-only | there was no arithmetic anywhere; this engine adds it |
| ADR-011's "restricted declarative guard expression" has exactly **one** implementation (the filter form). The recruitment workflow's `workflow-guard.ts` is a capability token, not an evaluator | no second evaluator was hiding anywhere |
| The payroll engine's `calcBasis` is a **closed vocabulary compiled into TypeScript**, not a formula language | making it configurable would be a second payroll calculator — refused, and guarded |
| No report surface exists at all — no directory, no permission, no page | Phase 4 is greenfield; Phase 3 must not pre-empt it |

---

## 2. The decisions

| # | decision | outcome |
|---|---|---|
| D-EXPR-1 | relation to the existing filter form | **B** — a shared core in philosophy; `filter-eval` is **not** merged, migrated or touched |
| D-EXPR-2 | where it lives | **A** — `packages/contracts`, so API and web share one implementation |
| D-EXPR-3 | representation | **A** — structured JSON AST only; **no text parser** |
| D-EXPR-4 | value domain | **A** — plain numbers; minor units, rounding and currency stay with the caller; no FX |
| D-EXPR-5 | unknown / invalid / division by zero | **B** — `null`, never `0` |
| D-EXPR-6 | what may be referenced | **A** — a declared catalog derived from Zod; no free paths |
| D-EXPR-7 | what ships | **A** — engine only: AST + validation + evaluation + tests + guards |
| D-EXPR-8 | payroll | **YES** — `calcBasis` and the payroll engine do **not** become expressions, in this phase or Phase 4 |
| D-EXPR-9 | limits | explicit, testable, in the contract; `$expr`/`$function`/dynamic execution forbidden |
| D-EXPR-10 | phase id | **P-HR-24** |
| D-EXPR-11 | Zod derivation | **C** — a separate, narrower derivation; `events/catalog.ts` untouched, drift caught by a test |
| D-EXPR-12 | `round` / `abs` / `min` / `max` | **A** — excluded; they are functions, and rounding is the caller's decision |
| D-EXPR-13 | `EXPRESSION_AST_VERSION` | **A** — present, set to `1` |
| D-EXPR-14 | the numbers | **A** — 4096 bytes · depth 12 · 128 nodes · path length 200 |
| D-EXPR-15 | magnitude limit | **A** — none; "finite" is the only requirement |
| D-EXPR-16 | record | **A** — this document; no new ADR |

---

## 3. The shape

```jsonc
{ "kind": "literal", "value": 12.5 }
{ "kind": "field",   "path": "totals.netMinor" }
{ "kind": "unary",   "op": "negate", "operand": { … } }
{ "kind": "binary",  "op": "add" | "subtract" | "multiply" | "divide", "left": { … }, "right": { … } }
```

Four node kinds, four binary operations, one unary operation. Operations are **named, not symbolic**
(`add`, not `+`) — a symbol alphabet invites the small tokenizer that would end the restriction, and
`z.enum` refuses `%` and `**` by construction rather than by a regular expression.

Every object is `.strict()`: a stray key is a rejection, not a field quietly ignored.

**Deliberately absent, each by decision:** variables · function calls · conditionals · loops ·
recursion · comparisons and boolean logic (that is the filter form's job) · aggregation (`sum`,
`count` — a grouping question, not an expression question) · `round`/`abs`/`min`/`max`.

---

## 4. Validation — three stages, in this order

1. **Size**, measured on the JSON serialization in UTF-8 bytes.
2. **Shape**, via the Zod schema.
3. **The walk** — depth, node count, and every field reference against the catalog.

**The order is a safety property, not a style.** The schema is recursive (`z.lazy`), so a
sufficiently deep tree would exhaust the stack *inside* `safeParse`, before any depth limit could
speak. Bounding the bytes first bounds the nesting: at 4 KB the deepest possible nesting is roughly
ninety levels. `JSON.stringify` is also the first thing to touch untrusted input, so a circular
reference, a `BigInt`, or a structure too deep to serialize all fail there as a size-class refusal
rather than as a crash.

Stages 1 and 2 stop on failure — nothing can be walked whose shape is unknown. **Within** stage 3
every problem is collected, so an author fixing one undeclared field at a time is not the experience.

The walk is **iterative, with an explicit stack**: a validator that could overflow the stack while
enforcing a depth limit would be defeating itself.

### A limit interaction, recorded rather than hidden

At the approved numbers the **size limit binds long before the node limit**. The largest full binary
tree that fits in 4096 bytes has **63 nodes** (the next size up, 127 nodes, needs 4627 bytes), so
`EXPRESSION_MAX_NODES = 128` cannot currently be reached — it is defence in depth that becomes live
only if the size limit is raised. A test asserts this relationship rather than asserting a limit
that never fires, so whoever raises `EXPRESSION_MAX_SIZE_BYTES` learns that the node ceiling has
just become real.

---

## 5. Evaluation semantics

| situation | result |
|---|---|
| field absent from the values record | `null` |
| field present but not a finite number (`'12'`, `true`, `null`, a `Date`) | `null` — **no coercion** |
| any operand `null` | `null` — it propagates |
| division by zero, including `0 / 0` | `null` |
| result overflows to ±Infinity | `null` |
| anything unexpected at all | `null` — **evaluation never throws** |

**`null`, never `0`.** The system already paid for this distinction: `compensation-rules.ts` emits a
`pendingQuantity` line — shown, and excluded from every total — rather than a confident zero,
because a total containing a guess is worse than none.

**Two deliberate divergences from `filter-eval`, both recorded:**

* *No coercion.* That file compares primitives by their string form, because a filter authored in a
  web form arrives as `'3'` while the payload carries `3`. Arithmetic has the opposite failure mode:
  silently reading `'12'` as twelve produces a number that is wrong instead of a blank that is
  honest.
* *`null`, not `false`.* Both files refuse to throw — an exception on the automation dispatch path
  would drop an event for every subscriber — but the safe answer differs because the question does.

**Values are a flat record** keyed by the catalog's dot paths, not a nested object. A nested shape
would need a path walk, and a path walk over author-influenced strings is how `constructor` or
`__proto__` becomes a readable "field". Own properties only.

**Consequence worth stating plainly:** with no fallback operator (`coalesce` is a conditional, and
conditionals are not in this language), **one missing input empties the whole calculated field**.
That is the intended behaviour. Whether such a row is displayed blank or omitted is a **Phase 4
decision**, and is not taken here.

---

## 6. The field catalog

An expression may name only what a catalog declares (D-EXPR-6). The catalog is derived from the same
Zod schema the data already validates against — a hand-written field list would drift from the real
shape on the first rename, silently.

**Numbers only**, in this phase: arithmetic over a string or a date is not an operation this engine
has, so offering such a field would be offering something that can only evaluate to `null`.

**Three things are skipped on purpose:** arrays (addressing an element needs an index or an
aggregate, and this engine has neither), `z.lazy` (a recursive schema has no finite field list), and
every non-numeric leaf.

### Why a second derivation, and how drift is prevented

`events/catalog.ts` already walks Zod schemas via `describeField()` — but it is **not exported**, it
produces nine field types this engine has no use for, and the event catalogue serves a live `ETag`
(`event-catalog.routes.ts`). Editing a published surface to serve a phase that ships no surface was
the wrong trade, so the walk is written narrowly in `expression/field-catalog.ts` (D-EXPR-11 = C).

Drift is prevented by a **test, not by discipline**: `expression.spec.ts` runs both derivations over
the entire real event catalogue — **155 declared events, 69 numeric fields** — and requires the same
answer, path and nullability alike. `ZodBigInt` is the one deliberate difference (the event
catalogue reports it as `number`; a bigint is not a JavaScript number and could only evaluate to
`null`), and no contract uses one today.

---

## 7. Guards

Six, each attached to a decision that would erode invisibly:

| guard | holds |
|---|---|
| **G1** | no dynamic execution: `eval(` · `new Function` · `vm.` · `require(` · `import(` · `globalThis`; and no Mongo `$function` · `$where` · `$expr` · `$accumulator` |
| **G2** | the engine imports **only** `zod` and its own files; no clock, no randomness |
| **G3** | D-EXPR-8 — the engine names nothing from payroll, and no payroll calculation imports or names any part of the engine |
| **G4** | no parser: nothing exported matches `parse`/`compile`/`tokenize`/`fromString`, and validation takes `unknown` |
| **G5** | the closed vocabularies are exactly four kinds, four binary operations, one unary operation, one field type — and none of the rejected constructs appears |
| **G6** | D-EXPR-1 = B — `filter-eval` neither imports this nor is imported by it |

Comments are stripped before every scan: these files *explain* what they refuse — `payroll` appears
in the prose of two of them — and a guard that read the explanation as a violation would punish the
documentation for being explicit. The payroll-file guard additionally asserts the files it reads are
non-trivial and still contain `calcBasis`, so a rename cannot turn it into a silent pass on an empty
string.

---

## 8. What this phase did not touch

**No route, page, permission, navigation row or consumer** — so `page-registry.spec`,
`packages/contracts/src/permissions/pages.spec.ts`, `permission-matrix.generated.md` and
`auth-seed-login.spec` are unchanged, and no counter moved.

**No migration, no backfill, no historical implication:** nothing is stored.

**`apps/api` and `apps/web` are untouched in their entirety.** `filter-eval.ts`, the payroll engine,
`events/catalog.ts`, the cost-centre work from P-HR-23 — all unchanged.

**Still closed, and not reopened:** PY-12 (payslip export/PDF) · P-HR-12 (statutory) · D12 (the
attendance device) · the accounting boundary · D6-R.

---

## 9. What Phase 4 inherits

* **A `byCostCenter` axis does not exist yet.** P-HR-23 stamps `payslip.costCenterId`, but the run
  cost breakdown still groups by origin, pay item and branch only. Adding the axis is a small,
  rule-free change — recorded here as a **future option**, deliberately not taken, because the
  baseline separates Phase 3 from Phase 4.
* **Report definitions are still blocked** by the rule `payroll-reports-and-reconciliation.md`
  states: a reconciliation is an identity, a report is a *definition* — who reads it, which rows,
  which columns, which grouping — and none has been given.
* **Open questions this engine hands forward:** how a `null` result is presented; whether `round`
  becomes necessary once real calculated fields exist (D-EXPR-12 reopens as its own decision, not by
  drift); and whether storing expressions warrants a CI validation step of the kind
  `scripts/automation-templates.mjs` already provides for stored automation definitions.
