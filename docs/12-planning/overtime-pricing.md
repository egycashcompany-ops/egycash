# P-HR-09 — Overtime Pricing

**Status: COMPLETE. The seam needs no new structure, and the owner has ruled that no multiplier is
added now — any future premium is a separate policy change with its own decision.**

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

## 2. THE DECISION — ruled by the owner

> **No multiplier or premium is added automatically now.** The overtime quantity is
> `approvedOvertimeMinutes` and pricing happens through a per-minute payroll pay item, which is the
> seam described above. No setting, no multiplier table, no day-type classification and no unproven
> legal rule is introduced.
>
> **P-HR-09 is complete as it stands.** Any future multiplier or premium is an independent policy
> change that needs an explicit decision and an explicit rule before it is implemented.

So an approved minute is worth **the pay item's own rate and nothing more**, and that is now a
recorded choice rather than an open gap.

### What that means in practice

An organization that wants overtime paid above the ordinary rate can already express it **today**,
without any code change: create the overtime pay item with the rate it intends. What the system does
not do — deliberately — is apply a factor on the organization's behalf.

### What a future premium would have to decide first

Recorded so the next phase starts from a question rather than a guess, **not** as work implied here:

1. The factors themselves, and whether they multiply the basic minute or the pay item's stated rate.
2. Where the factor lives — a field on the pay item, a setting, or a table keyed by day type. The
   third is the expensive one: day type does not cross the §15.1 feed today.
3. Whether the approval ceiling changes. It does not need to, but silence on it would be a gap.

Verified absent across `apps/api/src`, `apps/web/src` and `packages/contracts/src`: no `1.5`, no
`2.0`, no factor of any kind. The only occurrences of the word are comments and the guard below.

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
