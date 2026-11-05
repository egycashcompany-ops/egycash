---
name: drift-check
description: >-
  Check whether an ECMS document still describes the code — a design, an architecture page, or
  docs/05-database/database-design.md — and report only where they differ (the Elephant-Goldfish
  Model drift method). Use before starting a new phase in an existing module, before relying on a
  design that says it is current, or when a doc looks stale. One document, or a short named list,
  at a time.
---

# Drift check: does the document still match the code?

Docs in ECMS are updated when a change is written ("docs travel with code"), but nothing checks
afterwards, and some pages have quietly fallen behind. This skill is the drift method of Google's
Elephant-Goldfish Model (`egm-drift-report`, Apache-2.0), scoped and verified the ECMS way.

## Scope first

- One document, or a short list the owner or the task names, each paired with its code path
  (module folder, models, routes). Never "all of docs/12-planning" in one go: 50+ documents is
  hours of reading and mostly noise.
- **Out of scope:** discovery documents (`*-legacy-discovery.md`), port records whose rule is
  legacy parity, designs marked CLOSED, retrospectives, and ADRs as such — an ADR records what was
  decided on its date; when the code has moved on, that is a new ADR, not an edit.

## Method

1. **Read the document.** List what it names: collections, fields, indexes, endpoints,
   permissions, files, settings, states, numbers (limits, timeouts).
2. **Find the code** for each — the paths the doc gives, otherwise search (Mongoose models are
   `*.model.ts`, the collection name is the third argument to `model(...)`, indexes are
   `schema.index(...)`; routes are `*.routes.ts`; contracts are `packages/contracts/src`). If the
   doc gives no path, note it: adding the path makes the next check cheap.
3. **Compare and keep only differences**:
   - **missing** — described, not built;
   - **different** — built another way (field names, types, index keys, defaults, flow order);
   - **unrecorded** — built but not in the doc, where the doc claims to be complete;
   - **hard-coded** — a fixed value where the doc promised a setting, or the reverse.
   If a document matches, say "No drift" for it and move on.
4. **Filter what is already known.** Before calling a drift new, check the record: ADRs that
   superseded the doc, `docs/10-reviews/*` (especially `technical-debt.md`), `CHANGELOG.md`, and the
   doc's own status line. In the trial on `database-design.md` (2026-11-05) a third of the drifts
   were already recorded elsewhere and three were wrong, so mark each one new / known (cite where) /
   false.
5. **Verify** the new ones: open the doc line and the code line together, or give the list to one
   fresh verifier subagent told to refute each. One root cause (a whole section never reconciled)
   is one item, not seven.

## Output

- Working notes in the session scratchpad, never in the repository root.
- Then either:
  - **fix the document** in a docs-only PR (the usual outcome when the code is right and the page is
    old), naming the drift fixed in the commit message; or
  - **fix the code**, when the doc states a decision the code broke; that is a normal change with
    its own tests.
- Drift you cannot settle, or that needs the owner's decision, goes to him in Arabic as one short
  question with your recommendation; anything left open goes into `docs/10-reviews/technical-debt.md`.
