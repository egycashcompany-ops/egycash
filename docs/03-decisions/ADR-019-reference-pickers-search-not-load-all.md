# ADR-019: Reference pickers search the server; they never load the whole catalog

**Status:** Accepted (recommendation — implementation not yet scheduled) · **Date:** 2026-08-03 ·
**Relates to:** [API Standards §4](../04-standards/api-standards.md) (pagination),
[ADR-013](ADR-013-frontend-state.md) (TanStack Query for server state),
[ADR-004](ADR-004-permission-based-authorization.md) (permissions on every read)

## Context

Fixing a production 400 (PR #117) exposed a design question the fix alone does not answer.

Three recruitment dialogs and four Fleet pages loaded their dropdown options by asking a paginated
list endpoint for one enormous page:

```ts
const { data: positions } = useJobPositions({ pageSize: 200, status: 'active' });
const { data: titles }    = useJobTitles({ pageSize: 200 });
```

`pageSize: 200` exceeds `MAX_PAGE_SIZE` (100), which API Standards §4 fixes and which both the
contract schema and `base.repository.ts` enforce, so every one of those requests was rejected with
`400` and the dropdowns silently rendered empty. The immediate fix was to ask for `MAX_PAGE_SIZE`.

That restores the 200 → the requests are valid and the dropdowns populate. **It does not make the
screen correct.** "Ask for one big page and render whatever comes back" is truncation with a
configurable threshold: at 200 the list broke at the 201st position, at 100 it breaks at the 101st.
The failure is worse than an error, because nothing fails — the option a user is looking for is
simply not in the list, and the system looks like it lost data.

The question this ADR answers: **is a paginated list endpoint the right thing for a picker to call
at all, and if not, what is?**

## The pattern already exists in this codebase

Two facts make this a correction rather than a new capability:

1. **The endpoints already support server-side search.** `ListOrgUnitsQuerySchema` and
   `ListJobPositionsQuerySchema` both carry `search`, and the services implement it — the job-title
   service builds a regex-escaped `$or` over `code`, `name.ar`, `name.en`. Nothing is missing on
   the server.

2. **The correct client control already exists and is documented as the generic one.**
   `UserPicker` is *"a debounced autocomplete over the platform Users endpoint (reused, gated on
   `user.view`)"*, and `ManagerPicker` and the interview queue's interviewer filter are both
   described as "this with different wording — one behaviour, one implementation". It queries with
   a search term, `pageSize: 8`, and is disabled below two characters:

   ```ts
   searchUsers = (term) => getPage<UserDto>(`/platform/users${buildQuery({ search: term, status: 'active', pageSize: 8 })}`);
   useUserSearch = (term, enabled) => useQuery({ …, enabled: enabled && term.trim().length >= 2, staleTime: 30_000 });
   ```

   It never loads the user directory. It cannot break at the 101st user, because it never asks for
   the 101st user — it asks for what the operator typed.

So there is no missing endpoint and no missing pattern. The position and title pickers simply use
the right endpoint **in the wrong mode**: as a bulk fetch instead of as a search.

## Decision

**A control that lets an operator choose one record out of a catalog is a SEARCH over that
catalog, not a rendering of it.**

1. **A picker sends a term and reads a small page.** It calls the resource's existing list endpoint
   with `search`, a small `pageSize` (8–20 — enough to choose from, never enough to matter), and
   `enabled` gated on a minimum term length. There is no separate "all options" endpoint, and none
   should be added: an unpaginated endpoint is the same unbounded read with the cap removed, and it
   would sit outside the pagination, scope and index guarantees every list endpoint gives us.

2. **A picker resolves its current value by id, not by finding it in a list.** An entity already
   selected must display even when it is not in the current search results — `UserPicker` does this
   with `useUser(id)` / `<UserName id>`, and the same seam (`GET /:id`, cached) is what any other
   picker uses. This is what makes "search-only" safe on an edit form.

3. **`MAX_PAGE_SIZE` stays at 100 and is not negotiable per-screen.** It is a documented standard
   enforced in two layers. A screen that feels constrained by it is a screen asking the wrong
   question; the answer is a narrower query, never a bigger page. Where a genuinely complete set is
   required — the applicant CSV export — the codebase already uses a dedicated, row-capped path
   that is explicitly outside paging, and that remains the only sanctioned shape for "everything".

4. **Loading a full catalog into a `<select>` is acceptable only for a bounded reference set** whose
   size is a business fact, not a data-growth accident: branches, evaluation phases, interview
   stages, catalog kinds, document types, application categories. The test is not "is it under 100
   today" but **"can this collection grow with the business?"** Job positions, job titles,
   employees, vehicles and applicants all can. Where a bounded set is loaded, it must still be
   requested with `MAX_PAGE_SIZE` from `@ecms/contracts`, never a hand-written number.

5. **NEW CODE MAY NOT USE "LOAD ALL + FILTER IN THE BROWSER". EVER.** This rule is forward-looking
   and binds every module from here on, including ones not yet designed. A reference picker
   introduced from this ADR onward ships with **server-side search from its first commit** — it is
   not acceptable to start with a full fetch "because the catalog is small today" and convert it
   later. The debt catalogued below is what that shortcut already cost once; it is not a precedent.

   Concretely, in a new picker:

   - **Forbidden:** fetching a list with a large `pageSize` and narrowing it with
     `.filter(…)`/`.includes(…)` in the component, in a `useMemo`, or in a `select:` transform.
   - **Required:** the term goes to the server as `search`, the response is a small page, and the
     currently-selected record is resolved by id.
   - **If a resource has no `search` parameter yet**, add it to that resource's list contract and
     service as part of the work that needs the picker — that is the correct place for the cost,
     and it is a smaller change than any of the alternatives rejected below. It is never a reason
     to fall back to loading everything.

   Reviewers: a new `pageSize` above the default in web code, or a client-side filter over a
   fetched catalog, is a **blocking** review comment under Development Workflow §4, not a
   suggestion. The only exemption is rule 4's bounded reference sets, and the PR must say which
   business fact bounds the set.

## Consequences

**Positive.** Correctness stops depending on catalog size; the operator gets typeahead over the
whole catalog instead of an arbitrary first slice; payloads shrink from ~100 records per dialog
open to ~8 per keystroke-batch; one control and one behaviour to fix when RTL, debounce or
accessibility need work; no new endpoint, no contract change, no standard weakened.

**Negative.** Browsing is lost: an operator who does not know what to type can no longer scan the
list. For catalogs in the low hundreds that is a real UX regression, and the mitigation — showing
the first page unfiltered on focus, then narrowing as they type — must be part of the
implementation rather than an afterthought. Each converted picker also needs its
current-value-by-id read, which is more code than a `<select>` over a fetched array.

**Cost of not doing it.** Every picker keeps a silent correctness cliff at exactly 100 records,
which will be hit by whichever customer grows first, and will present as "the system lost our job
titles" rather than as an error anyone can see.

## Scope of the debt today

Everything in this section is **existing** code, grandfathered pending conversion. Rule 5 means
nothing new joins this table.

Twenty files request a full page of options. Most are bounded reference sets and are fine under
rule 4. The ones that fail the growth test, in priority order:

| Surface | Catalog | Why it can outgrow 100 |
| --- | --- | --- |
| `ReassignDialog`, `BulkReassignDialog`, `RecommendationDialog` | job positions, job titles | one per seat / per title across the whole company |
| Fleet `Odometer`, `Maintenance`, `Accidents`, `Violations` filters | vehicles | a fleet is expected to grow past 100 |
| `VehicleSelect` | vehicles | same |
| `job-offer-api` department + job-title options | departments, job titles | grows with the org |

`branches`, `evaluation-phases`, `interview-stages`, `hiring-document-types`, `applicant-sources`,
`file-categories`, `application-categories` and `fleet catalog kinds` are bounded by business
design and stay as they are.

## Why the current fix is a hotfix

PR #117 changed `200` → `MAX_PAGE_SIZE` because the endpoints were returning `400` and the
dropdowns were empty **now**, for every customer, at every catalog size. That is a production
outage and it needed the smallest correct change, which is to stop violating the contract.

It is explicitly **not** the end state: it converts a loud failure (empty dropdown, 400 in the
console) into a quiet one (a complete-looking list that is missing the 101st item). For every
customer whose catalogs are under 100 records the two are indistinguishable and the system is
correct; past 100 it is not. This ADR is the record that the remaining gap is known, bounded, and
deliberate — not an oversight — and that the fix for it is the conversion above, not a larger page.

## Alternatives considered

**Raise `MAX_PAGE_SIZE` to 200 (or 500).** Rejected. It edits a written standard, the shared
contract and both enforcement layers to move an arbitrary threshold to a different arbitrary
threshold, weakens a limit protecting every list endpoint in the platform, and leaves the same cliff
one position further out. It buys nothing except a later failure.

**Add an unpaginated `/options` endpoint per resource.** Rejected. It is the unbounded read with the
guardrail removed, it duplicates each resource's scope and filter logic in a second place, and it
grows without bound in exactly the tenants it is meant to serve. The applicant export shows the
narrow shape where "everything" is legitimate: an explicit, row-capped, audited export — not a
convenience read behind a dropdown.

**Client-side paging over repeated requests ("fetch all pages in a loop").** Rejected. It is the
same unbounded read spelled with more round trips, and it moves a filter the database can do behind
an index into the browser.

**Leave `pageSize: 200` and exempt these endpoints from the cap.** Rejected — it was never
functioning: the requests were being rejected outright, so the dropdowns were empty in production.

## Follow-up (not scheduled — needs the owner's go)

1. Generalize `UserPicker` into a shared `ReferencePicker` (search + debounce + resolve-by-id +
   permission gate + RTL + empty/no-access states), leaving `UserPicker` as a thin wrapper so its
   behaviour is the one implementation.
2. Convert the position/title pickers, then `VehicleSelect` and the Fleet vehicle filters.
3. Add a lint rule for `pageSize:` literals in web code, so rule 5 is enforced by the toolchain
   rather than by reviewer attention — the failure mode this ADR exists to prevent is precisely the
   one that survives a busy review.
4. Confirm every converted resource's `search` covers the fields an operator would actually type
   (code and both name locales), and that the fields are indexed.
