# ADR-027: People outside the company get ECMS accounts, confined to one surface

**Status:** Accepted · **Date:** 2026-08-19

## Context

The gold-vault module has customers: the funds, companies and institutions whose metal EGYCASH
holds. They need to see their own bars, their own receipts and their own monthly statements. Until
now every login in ECMS belonged either to an employee or to nobody (the seeded super-admin), and
neither shape fits a customer.

The standalone gold system answered this with a **second authentication system**: a `portal_users`
collection, its own bcrypt hashing, its own JWT carrying `kind: 'portal'`, and its own middleware.
Bringing that across would have contradicted the constraint the whole port was executed under — the
module must not build a parallel system where ECMS already has one — and would have left the
platform with two places where a password is checked, two lockout policies, two session stores and
two audit trails.

Two properties had to be true of whatever replaced it:

1. **A customer is structurally incapable of seeing another customer's metal.**
2. **A customer is structurally incapable of writing anything**, anywhere in ECMS.

The second is not answered by permissions. Permissions say what a caller may *do*; they cannot say
which routes should exist for them at all, and ECMS has endpoints that are deliberately open to any
authenticated caller. Two live examples at the time of writing: `POST /platform/directory/resolve`
returns staff display names, job titles, departments and work e-mail to anyone with a session; and
gold's own `/print` endpoints are POSTs that increment a counter. No permission set stops either.

## Decision

**A portal user is an ordinary ECMS account.** Same `users` collection, same argon2id, same lockout,
same session rotation and refresh cookie, same activation flow, same audit. It has `employeeId:
null` — a shape the platform already documents and already ships — and one new nullable field:

```ts
externalSubject: { moduleId: string; subjectType: string; subjectId: ObjectId } | null
```

This is `employeeId` with its owner named. The platform stores it, indexes it, and never interprets
it; the module that owns the relationship writes it through one service method, exactly as HR owns
`employeeId` (ADR-017). The two are mutually exclusive and both linkers enforce that rather than
leaving it to convention. `UserDto.kind` — `employee | system | external` — is derived from the two
fields so that a screen asking "is this someone who works here?" reads one value instead of
inferring it from a null.

A second module with external users of its own writes one new `subjectType` string and reuses the
field, the index, the `kind` vocabulary, the admin filter and the gate below.

**Confinement is a separate, coarser check, asked before authorization, and it fails closed.** An
external account may reach exactly two things:

1. the whole `/api/v1/auth` router — either pre-authentication or self-service by construction
   (login, refresh, logout, me, password change, TOTP, sessions);
2. the single route prefix its owning module registered for that subject type, **by GET only**.

Everything else is refused with 403 and an audited `permissionDenied` row. A route added anywhere
else in ECMS tomorrow is out of reach without anybody remembering the gate exists, which is the only
version of this that stays true as the codebase grows. Modules push their surface in at boot
(`registerExternalSurface`), the same direction `file-authorizers.ts` established; a subject type
nobody registered gets self-service and nothing else.

**Which customer's data they see is the module's question, not the platform's, and it is answered
with a type.** The gold module mints a branded `PortalCompany` in one middleware, after re-reading
the binding and the company from the database. Every portal read takes one as its first parameter,
so a query that forgot to scope does not compile; an eslint rule forbids casting one anywhere else.

## Consequences

**No sixth `DataScope`.** The scopes describe the organizational tree, and a customer is not in it.
The two a placement-less account could hold are both wrong — `organization` resolves to `{}`, the
whole vault, and `own` matches `createdBy`, which a customer never sets — and scope filtering
deliberately fails *open* on a collection that does not declare the field. Confinement therefore
never travels through `ScopeSelector`; portal reads pass none at all.

**The company is read fresh on every portal request, not from the 60-second auth snapshot.** Two
indexed lookups buy instant revocation: deactivating a customer company, or re-pointing an account
after a merger, takes effect on the next request. The snapshot's copy of the subject drives only the
coarse gate, where staleness is harmless in both directions.

**The snapshot cache key is versioned** (`auth:user:v2:`). The gate reads a field the snapshot did
not previously carry, and a deployment rolling out over warm pre-upgrade entries would otherwise
answer `undefined` into a security decision until the TTL expired.

**Customers inherit the organization's auth policy.** Password rules, lockout thresholds and session
lengths are organization-wide settings and process-wide values; there is no per-audience policy. If
customers ever need a different session length, that is a platform change, not a module one.

**Two pre-existing platform behaviours now apply to customers, and are worth naming rather than
discovering.** An account with a null org placement is invisible to a *branch-scoped* `user.view`
administrator — only organization-scoped admins can list them, which is why the module ships its own
screen. And the platform's user *write* endpoints are unscoped, so any holder of `user.edit` can
suspend or reset a portal account by id even though they cannot list it. Both are follow-up work if
they matter.

## Alternatives considered

**A module-owned join collection** (`gold_portal_accounts { userId, companyId }`), leaving the
platform untouched. Rejected: the platform then cannot *name* the population. Without a field on the
account, the admin user list renders a customer identically to the super-admin, offers them in every
"pick a person" picker, and lets an HR import attach them to an employee record. The collection also
needs its own model, repository, unique partial index and deploy step — and a second module with
external users would have to build the whole mechanism again.

**A second authentication system, as gold had it.** Rejected on the port's standing constraint, and
on the fact that it would have doubled every credential-handling decision in the platform.

**Adding a `customer` data scope.** Rejected as described above: the scopes are the org tree, and
widening the enum would change a value persisted on every existing role assignment.
