# ADR-026: Administering roles cannot exceed the administrator

**Status:** Accepted · **Date:** 2026-08-10 · **Builds on:**
[ADR-004](ADR-004-permission-based-authorization.md) (permissions; roles are only bundles),
[ADR-017](ADR-017-platform-identity-and-access-control.md) (hierarchical data scopes)

## Context

ADR-004 settled what authorization *is*: code checks permissions, roles are data that bundle them,
and a role assignment carries a data scope the repository applies. It did not settle who may write
that data, because until System Administration shipped there was no screen that did — roles were
created by the seeds and by the HR-only reconciliation, both acting as the system.

Opening that surface to administrators exposed a hole that had been latent since ADR-004:

**`role.create` was effectively `*`.** Nothing checked what a new role contained. An administrator
holding `role.create` could mint a role carrying every key in the registry — `user.manageSessions`,
`file.purge`, every module's `delete` — and then assign it, to themselves. `role.assign` had the
same shape: the keys inside the role were never compared against the keys the assigner held.

Scope had the same gap one level down. A holder of `x @ branch` could grant `x @ organization`,
creating access they could not exercise themselves.

Two further questions had no recorded answer, and both had a wrong answer that looks obviously
right: how an administrator is told that a role is not theirs to edit, and what "disable this role"
means in a model with no role status.

## Decision

### 1. Nobody hands out an authority they do not hold — enforced server-side

Two guards, applied in the service, on every request that creates a role, edits one, or assigns one:

- **Keys.** Every permission key being put into a role, or carried by a role being assigned, must be
  a key the actor holds. On **update, only the keys the edit ADDS are checked** — removing a grant
  is a narrowing and is always allowed, and re-sending an untouched list must not refuse an
  administrator renaming a role that happens to carry something they lack. They gain nothing by
  leaving it there, and assigning that role still runs the full check.
- **Scope.** For each key the role carries, the assignment's scope must not be wider than the scope
  the actor holds that key at, compared on `DATA_SCOPE_RANK`. A holder of `x @ branch` cannot grant
  `x @ organization`.

Both refuse with `BusinessRuleError` (422) naming the offending keys, because the request is
well-formed and the state is what refuses it.

**The UI is not a guard.** The permission matrix disables a grant the actor does not hold and shows
the reason on it, but that is an explanation of a rule enforced elsewhere. Every guard here is in
the service, reached by every HTTP path.

**The actor parameter is optional; the exemption is the SYSTEM, never a principal.** The service
takes `actor?: AuthContext` so the HR-only reconciliation and the seeds can act — there is no
request behind them and no human authority to exceed, the same distinction `by: null` already draws
across this codebase. It is not keyed on a user id, a role, or a permission: the controller passes
the caller's context on **every mutating handler whose service method accepts one** — create role,
update role, create assignment, update assignment, revoke assignment — so no principal can reach the
unguarded path. (Deleting a role takes no actor: there is nothing to escalate in a deletion, and it
is guarded instead by §4 and by the refusal to delete a role anyone still holds.)

That is a property a reviewer must be able to check, so it is pinned by a test that invokes each
handler directly and asserts the argument the service received. An integration test cannot catch a
handler that forgets, because every integration test goes through the same controller that
remembers — the request would succeed, unguarded, and every suite would stay green.

### 2. A grant is scoped through its HOLDER

`role_assignments` declares no placement of its own, and must not: who may see or change a grant is
decided by where the person holding it sits.

- **Listing** joins to `users` and applies the same clause a direct read of `users` would
  (`UserRepository.holderScopeMatch`, which mirrors the fields the repository's own constructor
  declares). One definition of "in my scope" serves both paths. The page and its total come from one
  `$facet`, so the count cannot describe a set the rows do not.
- **Granting and changing** read the target account through the caller's scope. An administrator who
  cannot see an account cannot grant to it, and gets **404** — not 403, which would confirm that the
  account exists.

### 3. Role identity is derived, not stored

`RoleDto` exposes two read-only fields:

- `key` — the stable key seeded and managed roles already carried. **No field was added to the
  role model.**
- `managed` — one of `system | derived | none`, computed from the stored role: `isSystem` →
  `system`, a key prefixed `hr-only:` → `derived`, otherwise `none`.

`managed` exists because `isSystem` cannot answer the question an administrator is asking. The HR-only
reconciliation deliberately does **not** set `isSystem` on its derivatives — that flag makes a
holder PRIVILEGED and forces TOTP — so `isSystem` alone cannot tell an administrator that editing an
`hr-only:*` role is pointless. `managed` is the single answer to "may I edit this?", and it is
derived precisely so it cannot drift from the roles it describes.

### 4. Managed roles are protected, for the reason that applies to them

- **System roles** (`isSystem`) cannot be edited or deleted: the platform depends on them.
- **`hr-only:*` derived roles** cannot be edited, deleted, or manually expanded either — not merely
  because it is unwise, but because **the reconciliation owns them and re-asserts them on every boot
  and seed**. An edit accepted here would be reverted rather than refused, which is worse.

Both refuse with `ROLE_PROTECTED` (422), and the messages differ because the reasons do.
**The HR-only reconciliation remains the sole owner of those roles**; this ADR records that
ownership, it does not move it.

### 5. Disabling a role IS revoking its assignments

**No `status` field was added to roles.** A role with no assignments grants nothing, which is what
disabled means; a flag would put a second switch inside the authorization path, where the switch
that is already there decides everything. The administration screen offers "revoke from everyone"
and a "held by nobody" filter computed from the assignments, so neither can drift from the truth.

Revoke-all is a **client-side loop of single revocations**, not an endpoint. Each revocation stays
independently authorized, independently audited, and independently refusable — an administrator's
own grant and the last Super Admin are both refused — and a partial result is not a broken state: it
is exactly the set of grants that could legitimately be removed. A bulk endpoint would have to
re-implement all three rules and would report one outcome for many decisions.

### 6. A grant's validity window is an edit; everything else is a new grant

`PATCH /platform/role-assignments/:id` moves `validFrom` / `validTo` and nothing else. Changing the
role, the account or the scope is a *different* grant — a revocation and a new assignment — and the
strict schema rejects those fields rather than ignoring them.

The PATCH is **version-checked** like every other update in this system. A validity window is
exactly the field two administrators reach for at the same moment — one extending a grant about to
lapse, the other ending it early — and last-write-wins would let the second silently undo the first.
A stale send answers **409 `STALE_DOCUMENT`**.

The audit row records the window **before and after** under its own action, `roleAssignmentUpdated`.
Expressing the change as revoke + re-grant would have split one decision into two rows and thrown
away when the grant was first made.

## What this ADR does NOT change

Recorded explicitly, because each was a plausible place to reach and none of them was touched:

| Unchanged | Why it matters |
|---|---|
| `BaseRepository.scopeFilter` | The one place scope is enforced (ADR-004/017). The new joined read *mirrors* it; it does not replace or fork it. |
| `widerScope`, `DATA_SCOPES` and their semantics | The ladder and the widest-grant-wins rule are ADR-017's. `DATA_SCOPE_RANK` is *read* by the new scope guard, never redefined. |
| RBAC cache and TTL semantics | Untouched, with **one correctness invalidation added**: a placement change now drops the cached auth snapshot. See below. |
| `isSystem` semantics | Still the flag that marks a seeded protected role and makes its holders privileged. `managed` is derived beside it, not layered on it. |
| Direct user grants — ADR-004 stands | Permissions still reach a user only through a role. No per-user grant was added. |
| HR-only reconciliation ownership | It still mints and re-asserts `hr-only:*`. This ADR protects those roles from a second writer; it does not become one. |
| Organization models (Branch / Department / Section) | Read to validate a user's placement. No field, index, route, or rule was added to them. One line in `organization/shared/org-unit.ts` changed — an import path, see below. |
| The stored placement on an assignment | Still recorded for the trail and read by permission-based notification fan-out. **Authorization has never read it** and still does not — it reads the holder's CURRENT placement from the request context. |

**The one cache change, and why it is a correctness fix rather than a semantic one.**
`AuthContext.branchId` / `departmentId` / `sectionId` come from the cached auth snapshot, and
`scopeFilter` builds every scoped query out of them. Nothing dropped that snapshot when an account's
placement changed, so an account moved out of a branch kept READING that branch until the snapshot's
TTL lapsed. The update now deletes the snapshot when the placement moves. No TTL, no key, and no
caching rule changed.

**And the one import change.** `organization/shared/org-unit.ts` runs at schema-definition time and
imported the audit *barrel*, which additionally pulls in the audit routes → auth → users → the
department repository → back to a model whose schema helpers are still initializing. The cycle was
latent until the placement check gave the users service a reason to import the department
repository; it now imports the audit *service* module directly. Same surface, one fewer edge — no
behaviour, no ownership, and no module boundary moved.

## Known limitation: department and section scope widen on most collections

A scope narrows a collection only when that collection **declares the corresponding field**
(`departmentField` / `sectionField`). Where the field is undeclared, `orgScopeFilter` returns `{}`
and the scope **widens to organization-wide** for that collection — the convention ADR-017 §1 chose
deliberately, so that finer scopes could be added without touching 29 repositories at once.

Today **four** collections declare `departmentField` — users, employees, leave requests, fleet
vehicles — and **three** declare `sectionField` (the same list without vehicles, which records no
section), against **28** that declare `branchField`. So a `department`-scoped grant widens to
organization-wide on 24 of those 28, and a `section`-scoped grant on 25: both behave as branch scope
or wider across most of the system, and an administrator choosing one may reasonably believe they
granted something narrower than they did.

**P3 does not change this.** The alternative — making an undeclared field fail closed (`NEVER`)
instead of widening, the behaviour labelled **G-2** in the P3 design discussion — would invert the
default on those two dozen collections at once: every department- and section-scoped user would see
an empty list everywhere the field is undeclared, turning a visibility bug into a total outage on a
migration nobody ran. Fixing it properly means declaring the field on each collection that genuinely
has one, which is a per-collection modelling decision with a data migration behind it — not
something a role-administration screen may decide.

What P3 does instead is **say so**: the scope badge and the grant dialog both carry the warning, in
both locales, naming the four collections that honour these scopes. An administrator is told what
the grant will actually do before they make it. The fail-closed change remains open, and is the
subject of its own ADR when someone owns it.

## Alternatives considered

**Enforce the escalation rules in the UI.** Rejected outright: the API is the boundary, the screens
are one client of it, and a rule that lives in a React component is not a rule. The matrix explains
the rule; the service is what refuses.

**Exempt super-admin from the key and scope guards.** Rejected. A holder of every key passes the key
guard on the facts, so no exemption is needed — and an exemption keyed on identity or a role name is
exactly the `if (user.role === …)` that ADR-004 exists to forbid. The only exemption is "no actor at
all", which is the system.

**Give roles a `status` field.** Rejected — §5. Two switches in the authorization path, and the
second one drifts.

**A bulk revoke endpoint.** Rejected — §5. It would re-implement three refusal rules and report one
outcome for many decisions.

**Denormalize the holder's placement onto the assignment so the list can filter without a join.**
Rejected. It creates a second, staler copy of a fact that already has an owner, and it is the same
mistake the stored assignment placement already represents — a field that looks authoritative and is
not. The join is one `$lookup` on an indexed foreign key.

**Add `departmentField` / `sectionField` to the remaining collections as part of P3.** Rejected as
out of scope: it is a per-collection modelling decision (does *this* record belong to a department at
all?), not a role-administration one, and each answer is a migration.

## Consequences

- ✅ An administrator cannot create access they do not have, at any breadth, through any path.
- ✅ An administrator cannot see, grant, or revoke a grant belonging to someone outside their scope,
  and cannot learn that such an account exists.
- ✅ "Which roles are effectively off" is computed, not maintained.
- ✅ A validity window can be moved without destroying when the grant was first made, and a
  simultaneous edit is refused rather than silently lost.
- ⚠️ An administrator with a narrow scope cannot bootstrap a wider one, by design. Widening remains
  something a wider administrator does — there is no self-service path, and there should not be.
- ⚠️ The assignments list costs a `$lookup` per page. Bounded by page size, on an indexed key.
- ⚠️ `managed` is derived from a key prefix, so the HR-only confinement's key convention
  (`hr-only:`) is now load-bearing for the administration UI as well as for the reconciliation.
  Renaming that prefix is a two-place change, and both places are named in this ADR.
- ⚠️ The department/section widening above is now *documented* rather than fixed. Every screen that
  offers those scopes carries the warning; the platform behaviour is unchanged and still wrong for
  what the words suggest.
