# ADR-025: Sweep announcements are marked in their own collection, not on the record

**Status:** Accepted · **Date:** 2026-08-09

## Context

IT's first three sweeps needed no bookkeeping. `it.slaSweep` writes the breach stamp that *is* the
record (FR-6); `it.autoCloseSweep` moves a status that is its own guard; `it.preventiveSweep` asks
"does this plan already have an unfinished order?" and the order *is* the mark. In all three the
thing being announced is a business fact with a home, so idempotency came free.

IT-5's expiry sweep is the first that announces something with **no home**. "This license expires
in 30 days" is not a fact about the license — it is a fact about *today* and the license. Nothing
on the document changes when the warning fires, and nothing should: a warning is not a state.

The frozen design (§4.8) says "set-once marks on the docs, Fleet FR-14 pattern". Those are two
different mechanisms, and Fleet's actual implementation is the second: `fleet_sweep_marks`, a
unique key per announced fact (`sweeps/sweep-mark.model.ts`).

## Decision

**IT gets `it_sweep_marks`, keyed on the fact's identity — including the date being announced.**

- The unique index IS the idempotency: only the run that INSERTS a mark emits.
- The key embeds the expiry date (`lic:expiring:<id>:<yyyy-mm-dd>`), so **renewal re-arms the
  announcement automatically**. A new expiry date is a new fact and deserves a new warning.
- Marks are operational bookkeeping: no soft delete, no versioning, never read to answer a
  business question.

## Why not a flag on the document

A `warnedAt` field on the license would have to be cleared on every renewal, by every code path
that can change `expiresAt`. That is a rule enforced by remembering, and the failure is silent:
a renewed license that never warns again. The date-keyed mark makes re-arming a property of the
key rather than a step someone must not forget.

It also puts an announcement flag inside a business record, where a reader cannot tell it from
the business data — the distinction ADR-021 draws between the custody chain and the audit trail,
applied one level down.

## Consequences

- One collection whose rows are never read by a human and never answer a question.
- Marks accumulate: one row per announced fact per expiry date. Bounded by
  (licenses + warranted assets) × 2, and re-armed only by renewal. No retention job in this slice;
  if that changes, the trigger is row count, not time.
- IT and Fleet now hold two copies of a 45-line idiom. That is the Expiry-watcher seam already
  recorded as debt P3 in the IT design §16, whose stated trigger is "not before IT-5 exists".
  **This ADR is what makes that trigger true**, and the seam extraction — not a third copy — is
  the correct response to the next module that needs it.

## Alternatives rejected

**A flag on the document.** Above.

**Recompute and de-duplicate downstream.** Moves the problem to every subscriber and makes
"announced once" a property nobody owns.

**No idempotency — announce daily.** Turns a warning into noise for 30 consecutive days, which is
the precise failure `it.sparePart.belowMin` was designed to avoid.
