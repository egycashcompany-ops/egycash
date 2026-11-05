---
name: drift-check
description: >-
  Check whether an ECMS document still describes the code — a design, an architecture page, or
  docs/05-database/database-design.md — and report only where they differ (the drift method of the
  Elephant-Goldfish Model). Use before starting a new phase in an existing module, before relying
  on a design that says it is current, or when a doc looks stale. One document, or a short named
  list, at a time.
---

# Drift check: does the document still match the code?

Docs in ECMS are updated when a change is written ("docs travel with code"), but nothing checks
afterwards, and some pages have quietly fallen behind. This skill follows the drift method of
Google's Elephant-Goldfish Model (`egm-drift-report`, Apache-2.0), scoped and verified the ECMS
way. It runs in the main session; no reviewer persona is needed.

## Scope first

- One document, or a short list the owner or the task names, each paired with its code path
  (module folder, models, routes). Never "all of docs/12-planning" in one go: 50+ documents is
  hours of reading and mostly noise.
- **Out of scope:** discovery documents (`*-discovery.md`), port records whose rule is legacy
  parity, designs marked CLOSED, retrospectives, and ADRs as such. An ADR records what was decided
  on its date; when the code has moved on, that calls for a new ADR or a dated amendment, not an
  edit.

## Method

1. **Read the document.** List what it names: collections, fields, indexes, endpoints,
   permissions, files, settings, states, numbers (limits, timeouts).
2. **Find the code** for each, at the paths the doc gives or by searching:
   - Mongoose models are `*.model.ts`; the collection name is the third argument to `model(...)`;
     indexes are `schema.index(...)`;
   - routes are `*.routes.ts`;
   - contracts are in `packages/contracts/src`.

   If the doc gives no path, note it: adding the path makes the next check cheap.

3. **Compare, and keep only the differences**:
   - **missing**: described, not built;
   - **different**: built another way (field names, types, index keys, defaults, flow order);
   - **unrecorded**: built but not in the doc, where the doc claims to be complete;
   - **hard-coded**: a fixed value where the doc promised a setting, or the reverse.

   If a document matches, say "No drift" for it and move on.

4. **Filter what is already known.** Before calling a drift new, check the record:
   - ADRs that superseded the doc;
   - `docs/10-reviews/*`, especially `technical-debt.md`;
   - `CHANGELOG.md`;
   - the doc's own status line and follow-ups.

   Mark each drift new, known (cite where) or false. In the trial on `database-design.md`
   (2026-11-05), 28 drifts came out: 15 new, 9 already recorded elsewhere, 3 false and 1 unclear.

5. **Verify** the new ones. Open the doc line and the code line together, or give the list to one
   fresh verifier (agent type `Plan`, read-only) told to refute each. One root cause, such as a
   whole section never reconciled, counts as one item, not seven.

## Output

- Working notes go in the scratchpad directory your system prompt names. If it names none, use a
  new directory under `$TMPDIR`. Never put them inside the repository.
- Then either:
  - **fix the document** in a docs-only PR. This is the usual outcome when the code is right and the
    page is old. Name the drift fixed in the commit message.
  - **fix the code**, when the doc states a decision the code broke. That is a normal change with
    its own tests.
- Drift that needs the owner's decision goes to him in Arabic, as one short question with your
  recommendation. Drift you leave unfixed is noted in the document itself, as a dated "out of date"
  note on the section. It goes into `docs/10-reviews/technical-debt.md` only once someone has
  decided to defer it.
