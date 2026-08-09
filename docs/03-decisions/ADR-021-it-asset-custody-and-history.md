# ADR-021: IT asset custody is an append-only event chain, not a status field

**Status:** Accepted · **Date:** 2026-08-09

> The frozen IT design (§14, 2026-08-03) reserved this as "ADR-020". ADR-020 was taken by
> [Shared file storage](ADR-020-shared-file-storage.md) on 2026-08-05 and numbers are never reused,
> so the module's three ADRs shifted to 021/022/023. Numbering only — the decision below is the one
> the design reserved.

## Context

An IT asset is company property that passes through hands. The questions asked of it are rarely
"where is it now" and almost always "who had it on the day it broke", "who signed for it", "when
did it leave the Cairo branch". Six months later those answers settle a dispute about money or
negligence — and they are asked precisely when the *current* row no longer says anything useful,
because the laptop is back in stock or written off.

ECMS already has three places such a fact could live, and two are wrong for it:

- **`it_assets.status`** — one derived value. It answers "now" and forgets everything else.
- **The audit trail** — ops-governed and retention-purged (F4). It is a *security* record of who
  touched the system, deliberately subject to a retention policy the business does not control.
- **The recruitment timeline (I5)** — an append-only business history, never purged, rendered
  directly on screen. This is the shape the custody question actually has.

The design settles this (§2.3, §4.3, D3); IT-2 is where the choice becomes code.

## Decision

- **`it_asset_events` is the asset's business history** — append-only, never updated, never
  deleted, excluded from retention purge. Screens render history from here and never from audit.
  Rows are `{ assetId, type, at, actorUserId, actorName, metadata, notes? }` over a closed type
  vocabulary. Events carrying no extra facts store `metadata: {}` and are handled **by type**,
  never by probing metadata keys — with `minimize: false` on the schema, because Mongoose
  minimization deletes empty objects on the way to the database and `.lean()` reads then return
  `undefined` (the PR #117 outage, in this repo, from this exact mistake).
- **Audit continues in parallel, for a different reader.** Every custody action writes both: the
  event row (business record, permanent) and an audit row (who did it, purgeable). Neither
  substitutes for the other. `assign` · `return` · `transfer` · `dispose` join the closed
  `AUDIT_ACTIONS` vocabulary as named acts rather than generic updates, because a dispute is
  settled by filtering on them (the Fleet FL-4 precedent).
- **`it_asset_assignments` holds custody intervals**; the open one is denormalized onto the asset
  as `currentAssignmentId`. The denormalization is a read convenience — the assignment rows are
  the truth — and the invariant "at most one open assignment per asset" is enforced by a **partial
  unique index**, not by the code that happens to write it.
- **Status stays derived (FR-2).** No endpoint accepts a status. `assign` → `assigned`,
  `return` → `inStock`, `dispose` → `disposed`; the write schemas have no field for it at all.
- **All four actions are named service actions, each in one transaction** (FR-3): assignment row +
  asset denormalization + history event + platform event + audit. A partial custody write must be
  impossible, so it is one `unitOfWork`, not five sequential awaits.
- **Transfer is one fact, not two.** Person→person and branch→branch both close the current
  interval and open the next inside a single transaction, and write a single `transferred` event
  carrying `{ fromEmployeeId?, toEmployeeId?, fromBranchId?, toBranchId? }`. It is never expressed
  as return-then-assign on the surface: the history must show intent, not mechanics.
- **Disposal is terminal and irreversible** (FR-4): it requires no open assignment, sets `disposal`
  once, and the asset accepts no further custody operation. The row is never deleted and the code
  is never reused, so a disposed asset stays answerable forever.
- **`hr.employee.exited` never auto-returns anything** (FR-13). The subscription records that a
  leaver still holds assets; a human records the physical return. An automatic return would write
  a custody fact that did not happen.

## Alternatives considered

- **Status field + audit trail only** — rejected: the custody chain would inherit the audit
  retention policy, so the record that settles a dispute could be purged by an ops decision taken
  for unrelated reasons. A business record must not depend on a security log's lifetime (D3).
- **Rebuild history from the audit trail on read** — rejected: same retention problem, plus it
  couples the screen to the audit row shape and turns "what happened" into a query over free-form
  change diffs rather than over typed facts.
- **Transfer as return + assign** — rejected: two events for one decision. Read back later, a
  transfer and an unrelated same-day return-then-reissue become indistinguishable.
- **Enforcing "one open assignment" in the service only** — rejected: two concurrent assigns would
  both pass the check and both insert. The partial unique index makes that a database error
  instead of a silent second open interval.
- **A separate timeline implementation per entity** — rejected: assets and tickets (§2.6) need the
  same append-only idiom, so the model factory and service shape are shared and parameterized by
  collection and type vocabulary. The idiom appears twice in the product and once in the code —
  and it is the extraction candidate the design already names (§16 P2).
- **Hard-deleting a disposed asset** — rejected: disposal is exactly when the history becomes
  valuable. FR-5's delete window covers the only legitimate deletion (registered in error, before
  any history exists).

## Consequences

- ✅ "Who held this, when, and in what condition" is answerable for the life of the company, from
  one collection, with no dependency on audit retention.
- ✅ Custody is atomic: there is no reachable state where the assignment row and the asset
  disagree, and the double-assign race is a database error rather than corrupt data.
- ✅ The shared timeline factory means IT-3's ticket stream costs a vocabulary, not a rewrite.
- ⚠️ Two writes per custody action (event + audit) inside a transaction. Accepted: these are
  human-paced operations, not a hot path.
- ⚠️ `it_asset_events` grows without bound and is never purged. That is the point; it is small,
  bounded in practice by the number of physical movements, and indexed on `{ assetId, at }`.
- ⚠️ Real MongoDB transactions require a replica set (ADR-005) — already a deployment requirement.
