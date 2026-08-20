# ADR-028: One control in the command bar narrows the whole application to a branch

**Status:** Accepted · **Date:** 2026-08-20

## Context

EGYCASH runs several branches, and two different people need two different answers from the same
screen. A vault operator in a branch should see their branch and nothing else — the data scopes
already do that, from their organizational placement. An account that sees the whole company should
be able to *choose*: the consolidated view, or one branch at a time.

The standalone gold system had exactly this, as a picker in its top bar. Its rule
(`utils/branchScope.js`) was two lines: a super-admin's active branch came from an `x-branch-id`
header, everybody else's from their own placement, and `all` meant no filter. The same value then
answered both questions a branch can answer — what you SEE, and where a new document is FILED.

The port carried the filing rule across and left the control behind, and the consequence showed up
the first time the integration suite ran against a real database: an organization-wide account could
not create a gold document at all. It was refused with "your account is not linked to a branch" —
correct, since a document has to be filed somewhere and nothing could guess where, but with no way
to answer. That is a trap, not a rule.

## Decision

**One control, in the command bar, that narrows the caller.** `AuthContext.activeBranchId` is read
from an `X-Active-Branch` header on every authenticated request, and `scopeSelector` folds it in:

```
organization grant + a chosen branch  →  branch scope, on that branch
anything else                         →  unchanged
```

**It narrows and only narrows.** The caller's granted scope is the ceiling. A branch-placed operator
sending another branch's id keeps their own branch; a department or section grant is finer than a
branch and is left alone, because widening it is the one thing this must never do. That property is
what makes the control a *preference* rather than a permission — there is nothing to authorize,
because nobody can reach a row their grant did not already reach. It is asserted directly in
`shared/types/scope-narrowing.spec.ts`, and end to end in the gold suite.

**The same value decides where a new document is filed**, which is what gold did and what makes an
organization-wide account able to work again. With the whole company selected, a branch-stamped
create is still refused — but the message now names the control that answers it.

**A header, not a query parameter.** It applies to every call the application makes; threading it
through each one would be a change nobody could keep current. The web client holds it beside the
access token and sends it on all four request paths.

## Consequences

**It applies to every module, not only the vault.** That is deliberate: a control in the global bar
that silently governed one module would be worse than either alternative. Choosing a branch narrows
HR, Fleet, Operations, IT and Gold alike, because they all read their scope through the same helper.

**Collections without a branch field are unaffected.** `BaseRepository` only applies a branch
predicate where the model declares one, so narrowing a scope over a branchless collection is a
no-op — the same behaviour those collections already had for a branch-placed caller.

**The switcher is not rendered for an account placed in a branch.** Their grants already confine
them, so the control would be a no-op with a menu. It is shown when `me.branchId` is null.

**Choosing reloads the page.** The choice changes what every query in the application *means*,
including ones already on screen; a reload is the only way to be sure nothing is left showing the
previous answer. It is a deliberate, visible action, taken rarely.

**A stale choice fails open, not closed.** A branch that was retired, or an id from another
deployment, resolves to "the whole company" — the unnarrowed view the account would have had anyway
— rather than to a filter matching nothing that the user cannot see or clear. The client clears the
stored value when the branch list no longer contains it.

**Validation is cached with a fresh re-check on a miss.** The header arrives on every request and the
branch list changes once a year, so the allowed ids are cached for five minutes; an id the cache does
not know is re-checked against the database before it is refused, so a branch created a minute ago
works immediately instead of being silently ignored until the cache expires. That re-check is why
there is no explicit invalidation to keep in step with branch mutations: the only value the cache can
be stale about in the other direction is a branch retired within the last five minutes, and honouring
it for that long narrows a caller to a branch they could already see — the same answer they had a
moment earlier, not a wider one.

## Alternatives considered

**Adding a `branchId` field to every module's create payloads**, with a picker on each form.
Rejected: it answers the filing question and not the viewing one, it is a redesign of five gold
forms plus every other module's, and it makes each screen decide something that belongs to the
session.

**Storing the active branch on the session, server-side.** Rejected for v1: it makes a read
stateful, needs its own endpoint and invalidation, and gains nothing over a header the client
already holds — the value carries no authority, so there is nothing to protect from tampering.

**Leaving it as it was, and telling administrators to work from a branch account.** Rejected: it is
a workaround for a missing control, and it was already the thing the port had lost.
