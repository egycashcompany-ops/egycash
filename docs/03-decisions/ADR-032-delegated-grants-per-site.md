# ADR-032: A manager hands out, per site, what they hold there

**Status:** Accepted · **Date:** 2026-09-19 · **Builds on:**
[ADR-004](ADR-004-permission-based-authorization.md) (permissions; roles are only bundles),
[ADR-017](ADR-017-platform-identity-and-access-control.md) (hierarchical data scopes),
[ADR-026](ADR-026-role-administration-guards.md) (nobody hands out what they do not hold),
[ADR-031](ADR-031-org-units-defined-once-declared-per-branch.md) (one department, declared per branch)

## Context

The owner described how authority flows in the company, and the model until now could not say it:

> One department company-wide; the branches are independent. Per department there is a general
> manager over every site, a manager in each site (who may be given a second site to follow), and
> under him the users. The manager decides, **per site and independently**, which screens each of
> his people gets and which actions on each screen. In المهندسين محمد has everything; in أكتوبر two
> screens, view only.

Two things stood in the way.

**A grant reached one unit.** A role assignment resolved to the holder's own branch or department.
The first step (a grant's *reach* — `branchIds`, `departmentCatalogId`, `allBranches` on the
assignment) let «مدير الحركة» be given a second site and «مدير عام الحركة» every site. But the reach
was a **union across the holder's grants**: whichever key was granted anywhere reached everywhere the
holder reached. Under that rule «الحضور، عرض بس، في أكتوبر» is not expressible — the attendance key
would ride the employees key's reach.

**Only an administrator granted, and only roles.** `role.assign` is an administration key, the
role is a company-wide bundle an administrator curates, and the guards of ADR-026 compare keys and
scopes but know nothing of *sites*. A manager staffing his own team, one site at a time, with a
different list in each site, was not a thing the model had a word for.

## Decision

### 1. Reach is recorded per permission key

The one derivation of an effective permission set (`computeEffective`) now collects reach twice from
the same walk over the holder's active grants:

- the **union** — `reach` — which is what the branch switcher offers and which rooms a socket joins;
- **per key** — `keyReach[key]` — which is what each permission's data filter reads.

`scopeSelector(ctx, key)` reads the per-key entry; a key with none reaches the home unit only. A
snapshot cached before this existed carries no per-key entry and the union answers for it, so the
change is invisible to any account whose grants all reach the same places — every account before
this ADR.

A home-only grant keeps its home apart from listed sites, and the home is added back only when some
other grant of the same key reaches further. A person holding «الموظفين» at home through a role and
in a second site through a delegation holds it in both; a list of the second site alone would have
lost the first.

### 2. A delegated grant is a list of keys for one account in one site

New collection `delegated_grants`: `{ userId, branchId, permissionKeys[], grantedBy }`, one live row
per (account, site). No role in between — the grant *is* the list. It contributes each key at
`branch` scope in its one site, never wider, and never makes its holder privileged on its own (the
break-glass rule stays keyed on the permission, as everywhere).

The record is **replaced whole** on every write and an empty list removes it. Each site's row says
nothing about any other site's; that is the owner's "كل فرع صلاحياته قايمة بذاتها" made literal.

### 3. One key: `delegation.manage`, read per site

Holding `delegation.manage` in a site (organization-wide, or at branch level or wider in a site the
key reaches — `keyReachesBranch`) lets the holder write delegated grants **in that site**, for
accounts their `delegation.manage` grant reaches (the target is read through that selector: an
account outside it answers 404 before a key is looked at, as `assignRole` does with `role.assign`).

The key is itself delegable. That is how the general manager lets the site manager staff his own
team, and the chain keeps the ceiling at every link.

### 4. The ceiling is ADR-026 §1, read per site

Every key **added** by a write must be one the writer holds at branch level or wider **in that
site**. Keys already on the row that the writer could not grant themselves stay: removing is a
narrowing and is always allowed; keeping what somebody else granted is not a grant. The service
refuses with 422 naming the keys, on every HTTP path; the screen greys out what cannot be granted,
which is an explanation of that refusal and not a guard.

### 5. What is deliberately not here

- **No scope other than branch.** A delegated grant is per site by definition. Department- or
  section-level delegation would be a different feature with a different screen.
- **No validity window.** A manager who wants somebody out changes the list.
- **No notification on change.** The audit trail records it (`roleAssigned` / `roleRevoked` with a
  `delegation` change naming the keys and the site); a message to the person is a later addition.
- **Approvals do not read it.** Who approves what, and in which order, is the next phase.

## Consequences

- `EffectivePermissions` and `AuthContext` gain `keyReach`. The cache format is forward-compatible:
  the union answers for an old snapshot.
- `EffectivePermissionSourceDto` gains `kind` (`role` | `delegation`) and `branch`; `roleId` is
  null for a delegation. The "why can they" screen shows a direct grant with its site.
- The fan-out «everyone holding X in site B» (`listUserIdsWithPermission`) reads both collections.
- Endpoints: `GET /platform/delegations/me` (the caller's own ceiling, per site, with the registry
  entries to draw it), `GET /platform/delegations/users/:userId`,
  `PUT /platform/delegations/users/:userId/branches/:branchId`.
