# P-HR-09 — Overtime Pricing

**Status: the seam is COMPLETE and needs no new structure. One value is blocked on an owner
decision, and nothing was changed while it is open.**

---

## 1. The finding

The brief asked me to examine how overtime quantity is derived, how it enters the payroll engine,
and to prepare the seam *if that needs no new decision*. It needs none, because **the seam already
exists end to end and already prices overtime today**:

| step | where | what it does |
|---|---|---|
| approval | `overtime.service.ts` | releases minutes, capped at the derived figure, refused on a frozen day |
| the feed | §15.1 `attendance-feed.ts` | carries `approvedOvertimeMinutes` — approved only; derived-but-unapproved never crosses |
| the door | `compensation/attendance-quantity.port.ts` (PY-4) | the one file in payroll that knows attendance exists |
| the mapper | `attendance-quantities.ts` | `approvedOvertimeMinutes: (row) => row.approvedOvertimeMinutes` |
| the vocabulary | `hr-payroll.ts` | `PAY_ITEM_QUANTITY_SOURCES` includes it; `perMinute` is a declared `calcBasis`; the unit map pins it to `minutes` |
| the engine | `compensation-rules.ts` | `perMinute` × `quantityFor(rows, source, slice, spans)` → `scaleMinorUnits(rate, quantity)`, with **no** proration factor (the quantity was already counted over the slice) |

So an organization can price overtime **now**: create a pay item with `calcBasis: 'perMinute'` and
`quantitySource: 'approvedOvertimeMinutes'`, assign it, and every approved minute is paid at that
item's own rate. The engine also refuses to guess — an item on one of the two quantity bases with no
source, or with no frozen feed, produces a line in the `unknown` state that is shown and excluded
from every total, rather than a zero.

**Nothing was added by this phase. There was nothing to add.**

## 2. THE BLOCKER — the multiplier

What does **not** exist anywhere in this repository is a **premium or multiplier**: no `1.5`, no
`2.0`, no ordinary-vs-holiday-vs-night distinction, no factor of any kind. Verified across
`apps/api/src`, `apps/web/src` and `packages/contracts/src` — the only occurrences of the word are
in comments and in guards asserting its absence.

That means an approved minute is currently worth **the pay item's own rate and nothing more**. If
the organization intends overtime to be paid at a premium over the ordinary minute, that premium is
a legal and financial rule, and it is not written anywhere here. Deriving one would be inventing it.

### The decisions needed to unblock it

1. **The factors themselves** — ordinary overtime, rest-day, public-holiday, night, each as an
   explicit number, and whether they multiply the basic minute or the pay item's stated rate.
2. **Where the factor lives** — a field on the pay item, a setting, or a table keyed by day type.
   Each has a different blast radius; the third would need the day type to cross the §15.1 feed,
   which today it does not.
3. **Whether the ceiling changes.** Today approval is capped at the derived minutes and nothing
   above that can ever be priced. A premium does not change that cap, but it is worth stating.

Until those are ruled, no code should apply a factor.

## 3. What this phase shipped

A guard, and only a guard: `overtime-pricing.spec.ts` pins that the path above stays wired — the
quantity source is declared, the unit is minutes, the engine multiplies rate by quantity for
`perMinute`, and the `unknown` state is what an unpriceable item produces. It also pins the
**absence** of any multiplier, so one cannot arrive without a phase behind it.

**No behaviour changed.** No contract, no engine rule, no setting, no permission, no migration.

## 4. Standing constraints observed

No financial or legal rule was invented. The §15.1 seam is untouched; the two ports remain the only
doors. `freezePeriod()` semantics, frozen facts and issued payslips are untouched. PY-12 remains
closed and is not reopened by anything here.
