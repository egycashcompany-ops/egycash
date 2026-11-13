# ADR-021: IT asset custody is an append-only event chain, not a status field

**Status:** Accepted, amended · **Date:** 2026-08-09 · **Amended:** 2026-11-11 (a transfer's audit
follows its commit)

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

## Amendment — 2026-11-11: a transfer writes its audit after its commit

**Status:** Accepted · **Amends:** the "each in one transaction … + audit" clause of the Decision
(FR-3), for `transfer` alone — and the move to another branch, which is one. The Decision text
above stands as written.

The owner asked to move assets to another branch, several at once and a held one with its custody
(«ينتقل مع عهدته», «كذا حاجة مرة واحدة» —
[IT design §17, 2026-11-11](../12-planning/it-module-design.md)). The move of a held asset IS the
custody transfer to a new branch in the same hands, so it takes the transfer's own code path, not a
copy of it: one body, `transferInSession`, runs inside a transaction its caller owns — custody's
`transfer` for one asset in a transaction of its own, «نقل إلى فرع» (`POST /it/assets/move-branch`)
for up to 100 assets in ONE transaction, all of them or none.

- **`transfer` and the move record their audit rows after the commit**, then their
  `it.asset.transferred` events (the platform event already followed the commit for every custody
  action: subscribers react to facts, and one rolled back is not). A transfer to a new holder writes
  its receipt's `create` row, then its `transfer` row; the move writes one `transfer` row per asset,
  in stock or held, in the order the request named them.
- **Why.** The audit service is not part of the transaction. With one body serving both the single
  transfer and the batch move, a row written inside it for one asset would outlive a move the
  database then refused for a later one — an asset refused, a version conflict — and a retried
  transaction would write it twice. So the audit of a batch follows its single commit, and the
  single transfer, sharing that body, follows its own.
- **Unchanged.** Hand-over (`assign`), `return` and `dispose` still write their audit row inside
  their transaction. The custody facts themselves — the assignment rows, the asset's
  denormalization, the `transferred` history event — stay in the one transaction for every action,
  the transfer and the move included: a partial custody write is still impossible.
- ⚠️ A process that stops between the commit and the audit write leaves a transfer with its history
  event and without its audit row. Accepted: `it_asset_events` is the business record and is written
  in the transaction; the audit row is the security record this ADR already keeps apart from it, and
  a missing row is better than one recording a transfer that never happened.
