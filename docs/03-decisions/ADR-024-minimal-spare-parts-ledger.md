# ADR-024: The spare-parts ledger is a store record, not inventory accounting

**Status:** Accepted · **Date:** 2026-08-09

> The frozen design (§14) reserved this as "ADR-023". ADR-023 was taken by
> [entity-derived file authorization](ADR-023-entity-derived-file-authorization.md) on
> 2026-08-09 and numbers are never reused, so this decision is 024 — matching §15.
> Numbering only; the decision below is the one §14 reserved.

## Context

Maintenance consumes parts, and a maintenance order that cannot say which parts it used is not a
maintenance record. So IT-4 has to track parts. The question is how far to go.

A real inventory system carries valuation (FIFO/weighted average), locations and bins,
reservations, transfers, stock-takes and a general-ledger posting. Every one of those is a
decision that belongs to a module that does not exist yet — Procurement owns purchasing and
Warehouses owns stock. Building a shadow version inside IT would mean the company has two
answers to "how many do we have", and the wrong one is the one nobody reconciles.

## Decision

**`it_spare_part_movements` is an append-only ledger of what the IT store received and consumed,
and nothing more.**

- A movement is `{ partId, qty, orderId?, at, byUserId, note? }` — positive on receipt, negative
  on consumption. **Consumption is always tied to a maintenance order** (FR-9); a negative
  movement with no `orderId` is refused.
- `onHandQty` on the part is DENORMALIZED, written by the same atomic `$inc` that inserts the
  movement, so the two can never disagree by a partial write.
- Consumption that would drive `onHandQty` below zero is a `BusinessRuleError`. The store cannot
  issue what it does not have, and a negative on-hand is a number nobody can act on.
- An order's parts are NOT stored on the order. The movements keyed by `orderId` are the single
  source; an embedded list would drift from the ledger the first time one was edited.

**Explicitly out of scope, and each is a deliberate absence:** valuation and costing, locations
and bins, reservations, inter-store transfers, stock-takes and adjustments beyond a noted
movement, supplier/purchase-order linkage, and any accounting posting.

## The boundary Procurement and Warehouses inherit

When those modules arrive, this ledger is the seam they meet:

- **Receipts become their output.** A receipt here is currently a hand-entered movement. Once
  Procurement exists, a received purchase order is what creates it — the movement shape does not
  change, only who writes it.
- **On-hand may become theirs.** If Warehouses owns stock, `onHandQty` stops being IT's number and
  IT reads it. The movement ledger stays, because "which parts did this repair consume" is an IT
  question whoever owns the stock.
- **Nothing here presumes either.** No valuation field to migrate, no location to reconcile, no
  accounting entry to reverse. That is the point of the absences above: the cheapest thing to
  hand over is a record that never claimed to be more than it is.

## Consequences

- IT can answer "what did this repair consume" and "are we below minimum" — the two questions the
  maintenance flow actually asks — and no others.
- `it.sparePart.belowMin` is a warning event, not a block: a technician mid-repair must not be
  stopped by a reorder threshold.
- Anyone looking for cost-of-parts reporting will not find it here, and should not have it added
  here. That report belongs to whichever module owns valuation.

## Alternatives rejected

**Full inventory in IT.** Guesses at Procurement's and Warehouses' design from the outside, and
creates a second stock number to reconcile. The expensive kind of wrong.

**No ledger — a plain `onHandQty` counter.** Cheaper, and it loses the audit trail that makes a
consumption defensible six months later. It also cannot answer "what did this order use", which
is the question maintenance exists to record.

**Parts embedded on the order.** One less collection, and it drifts: an edited list and a ledger
that disagree, with no way to tell which is true.
