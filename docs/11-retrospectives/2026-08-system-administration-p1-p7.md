# Sprint Retrospective — System Administration P1–P7

**Capability:** System Administration — users, roles, permissions, pages ·
**PRs:** [#158](https://github.com/egycashcompany-ops/egycash/pull/158) ·
[#159](https://github.com/egycashcompany-ops/egycash/pull/159) ·
[#160](https://github.com/egycashcompany-ops/egycash/pull/160) ·
[#161](https://github.com/egycashcompany-ops/egycash/pull/161) ·
[#162](https://github.com/egycashcompany-ops/egycash/pull/162) ·
[#163](https://github.com/egycashcompany-ops/egycash/pull/163) ·
[#164](https://github.com/egycashcompany-ops/egycash/pull/164) ·
[#166](https://github.com/egycashcompany-ops/egycash/pull/166) ·
[#167](https://github.com/egycashcompany-ops/egycash/pull/167) ·
[#168](https://github.com/egycashcompany-ops/egycash/pull/168) ·
[#169](https://github.com/egycashcompany-ops/egycash/pull/169) ·
**Merged:** 2026-08-10 · **Final merge commit:** `f0463ab` ·
**Outcome:** ✅ Delivered — each PR reviewed by EGYCASH and **approved** before merge.

> **Scope note.** This document was written as a P1–P6 closeout and was extended before merge to
> cover **P7 — the Page layer** (#166, #167, #168) and its follow-up fix (#169). P7 is the one part
> of the module that **did** change the contract, deliberately and with the decision recorded; every
> statement below that says "no contract change" is scoped to P1–P6 and says so.

## 1. Sprint goal

Give the platform's own administration a screen. Authentication, the user lifecycle, RBAC, the audit
trail and the organization model had all shipped with Sprint 2.1 and had been running ever since —
with **no user interface at all**. A search of `apps/web` for the platform user endpoints returned
pickers only. Every account creation, every role grant, every password reset was a database
operation or a seed.

The constraint that shaped all six phases: **build the surface, add no backend.** The endpoints
exist, they are authorized, they are audited. Where a phase found that a rule did not exist — and
two did — the rule was added to the **service**, never to the screen.

**P7 was added after that goal was met**, from use rather than from the plan: a 202-key permission
matrix grouped by module is still a wall, and there was no way to start a new role from one that
already worked. It is the only phase permitted to change the contract, because the missing thing was
a *concept* — the page — and a concept cannot be added from the screen.

## 2. Delivered features

- **P1 — Users administration ([#158](https://github.com/egycashcompany-ops/egycash/pull/158)).**
  List (search / lifecycle filter / sort / pagination, all URL-synced) and detail with three tabs.
  Two badges rather than one, because an account answers two different questions: `status` is the
  lifecycle an administrator drives, `accountStatus` is derived server-side and answers "can this
  person sign in right now, and if not, why". Identity reads organizational placement from the
  platform **directory** rather than from `UserDto`'s raw ids.
- **P2 — Creation, editing and linkage
  ([#159](https://github.com/egycashcompany-ops/egycash/pull/159)).** Account creation with the
  one-time setup link, editing, unlock, organization placement pickers, and the employee link — which
  is written by **HR**, because HR owns that relationship (`user.employeeId` is the authority).
- **P3 — Roles and permissions
  ([#160](https://github.com/egycashcompany-ops/egycash/pull/160)).** Role list and detail, the
  permission registry screen, scoped assignments, the user's roles tab, and the guards that had to
  exist before any of it could be handed to a human — recorded as **ADR-026**.
- **P4 — Effective permissions
  ([#161](https://github.com/egycashcompany-ops/egycash/pull/161)).** A read-only projection
  answering "what may this account actually do, and why", with every contributing grant shown
  including the pending and the expired. Recorded as an appendix to ADR-026.
- **Bulk selection ([#162](https://github.com/egycashcompany-ops/egycash/pull/162)).** Two hundred
  checkboxes is not a form: select-all, per-module selection, search and collapse — none of which may
  do anything an administrator could not do by clicking each box in turn.
- **P5 — Account & role retirement
  ([#163](https://github.com/egycashcompany-ops/egycash/pull/163)).** Archive an account, delete an
  account, delete an unused role — plus the two refusals that had to exist first.
- **P6 — UX & hardening
  ([#164](https://github.com/egycashcompany-ops/egycash/pull/164)).** Branch filter, an error state
  for the activity tab, older history on demand, URL pagination, role → account navigation, revoke
  confirmations, and the unknown-key fix.

- **P7-A — the page registry
  ([#166](https://github.com/egycashcompany-ops/egycash/pull/166)).** A `PageDef` in
  `@ecms/contracts` and a `pageId: string | null` on every permission, declared **once per resource**
  in the module manifests rather than 202 times. **46 pages, 172 of 202 permissions assigned, 30
  deliberately `null`** — the unassigned ones are cross-cutting or backend-only and saying `null` out
  loud is the point. `validatePageRegistry()` refuses a duplicate id, a malformed id, a page whose
  module does not own it, a permission naming a page that does not exist, and an empty page;
  `bootstrap` calls `syncPageRegistry` and **throws at startup** on any of them, and
  `scripts/check-page-registry.mjs` is a CI step so it fails in review instead of at boot.
- **P7-B — Module → Page → Permission
  ([#167](https://github.com/egycashcompany-ops/egycash/pull/167)).** The role matrix gained the
  middle level. A module's rows **are** the concatenation of its pages' rows — one derivation, not
  two agreeing code paths — so the counters and the tri-state select-all stay honest by construction
  rather than by care. Permissions with no page fall into a labelled group instead of disappearing.
- **P7-C — Role duplication
  ([#168](https://github.com/egycashcompany-ops/egycash/pull/168),
  [#169](https://github.com/egycashcompany-ops/egycash/pull/169)).** Start a new role from an
  existing one. **There is no duplicate endpoint and there must not be one:** a duplicate is a
  `POST /platform/roles` with a pre-filled form, so it passes `assertKnownPermissionKeys` and
  `assertKeysHeld` exactly as a hand-built role does. The copy carries permissions and description
  and nothing else — **no assignments**, by type, because `CreateRole` has no field for them — and
  comes out `managed: 'none'` because the server writes `key: null` and `isSystem: false` on every
  create. Refusals are **all-or-nothing**: copying only the grantable subset would succeed, look
  right, and produce a role that shares a name with the original and quietly grants less.

**The shape of the module after P6:** 5 routes, 7 tabs, **24 distinct endpoint paths consumed**
(21 `platform`, 3 `hr`), **17 permission keys referenced** (12 belonging to the module). **Zero** new
endpoints, permissions, models, migrations, contract changes or dependencies across all six phases.

**What P7 changed on top of that:** contract additions only — `PageDef`, `pageId`, the page list on
the permission-catalog response, and a sixth `declarePermissions()` parameter. Still **zero** new
endpoints, permission keys, models, migrations or dependencies; the page layer is **organizational
only** and no authorization decision reads a `pageId`.

## 3. Test results

- **Web** — 453 tests across 36 files at the end of P6, up from the pre-P1 baseline. Because the web
  suite runs with `environment: 'node'` and deliberately carries no jsdom (`vitest.config.ts`),
  nothing clicks. Every rule that mattered was therefore extracted into a pure function and tested
  directly — `lib/permission-selection`, `lib/revoke-all`, `lib/timeline-view` — with the component
  render proving only the WIRING. Where a claim could only be made structurally, the assertion says
  so in a comment.
- **API** — the T1–T20 matrix in P3 and a ~25-case retirement suite in P5, plus regressions carried
  forward from #157 to #161 in every later phase. 643 unit tests green throughout.
- **Contracts** — 199 tests, untouched by this work.

**At the end of P7:** web **512** tests across 38 files, API **652** unit tests across 82 files,
contracts **214** across 13. P7 added the page-registry validation suite in contracts, a
`page-registry` suite on the API service, and the matrix-tree and role-duplication suites on the web.
Integration suites are unchanged in kind: still CI-only, for the reason in §7.

## 4. CI results

Green on every merged commit. Three iterations were needed across the six phases, each for a real
defect rather than a flaky run:

- **P3** — three CI-only failures at once: a placement check too strict for HR-only fixtures, a
  section fixture sending a field the strict schema rejects, and `z.boolean()` refusing the string
  `'true'` that a query parameter actually arrives as (`booleanQuery()` is the fix).
- **P3, second round** — six assertions read `data.items` where the `okPage` envelope sends
  `{ data: [...], meta }`.
- **P5** — three failures cascading from one, which turned out to be a genuine security defect in
  shipped P3 code. See §5.
- **P7-A** — one failure, and the honest description of it is that the implementation had drifted
  from its own approved design. The design said "no endpoint change"; the implementation widened
  `GET /platform/permissions` to `{ permissions, pages }`, and an integration assertion that called
  `registry.some(...)` on the response broke. The deviation was flagged as something the owner should
  have decided rather than discovered.
- **P7-C** — CI green on both PRs. The defects that mattered in this phase were not found by CI at
  all; see §6.

## 5. Security decisions that became live

Recorded here because they are the substance of the module, not a side effect of it.

1. **Nobody hands out an authority they do not hold** (ADR-026 §1). Every key put into a role, and
   every key carried by a role being assigned, must be a key the actor holds; the assignment's scope
   may not exceed the actor's own scope for that key. Enforced in the service, on every path, with
   **no identity-based exemption** — the only exemption is "no actor at all", which is the system.
2. **A grant is scoped through its holder** (§2). An administrator who cannot see an account cannot
   grant to it, and gets **404** rather than 403 — which would confirm the account exists.
3. **The last Super Admin cannot be removed, on three doors.** Archive, delete, and revoking the
   assignment. P5 defined what "last" means: **accounts that can still sign in**, not assignment rows.
4. **You cannot retire yourself.** Not your grant, not your account.
5. **Managed roles are inert** (§4). `hr-only:*` derivatives are re-asserted on every boot, so an
   accepted edit would be silently reverted — worse than a refusal.
6. **Optimistic concurrency where two administrators reach for the same field.** The assignment
   validity window and the account status are both version-checked; a stale send answers **409**.
7. **An unknown permission key comes off and never back on** (P6). It cannot be re-granted because
   nothing in the system defines it any more.
8. **The UI is never the guard.** Every refusal above is in the service. The screens explain rules;
   they do not enforce them.
9. **A duplicate is a create** (P7-C). The one operation whose entire purpose is to reproduce a set
   of authorities in one click is also the one where re-implementing the guards would be most
   tempting and most dangerous — so it has no endpoint of its own and reuses `POST /platform/roles`
   whole. The screen refuses early and says why; the server is still what refuses. The copy is
   unmanaged by construction, which is what makes duplicating a **managed** role safe rather than a
   loosened guard: an administrator who cannot grant everything `super-admin` carries cannot copy it
   either.
10. **The page layer decides nothing** (P7-A). `pageId` groups permissions for humans. No
    authorization path reads it, and adding one would need its own decision.

## 6. What the work discovered

Four defects that were **already in production code** before the phase that found them:

- **The last-Super-Admin assignment rule could be defeated by archiving.** P3's
  `isLastSuperAdminAssignment` counted assignment ROWS. Archiving keeps a user's grants by design, so
  an archived Super Admin was accepted as cover and the live one's assignment could then be revoked,
  leaving a system with **zero administrators able to sign in**. P5 made the sequence reachable from
  the screen by adding the Archive button, and the P5 test suite exposed it — CI run 483 recorded the
  revoke returning 204 where it should have returned 422. Fixed in `05de9ae` by counting accounts
  that can sign in, using the same predicate `auth.service` applies at login.
- **The same defect, in P5's own new guard.** Caught while writing the test, before it shipped.
- **A permission key the registry had forgotten could not be removed.** The matrix header had always
  said "still ticked, and still removable"; the code folded `unknown` into `disabled`. Fixed in P6,
  with the header comment left exactly as written — it had described the intent correctly all along.
- **A failed history read rendered as an empty history.** "Nothing has been recorded" and "we could
  not read this" are opposite claims, and the second dressed as the first ends an investigation
  before it starts. Fixed in P6.

Two latent problems surfaced by P3 and fixed there: an **import cycle** (`org-unit.ts` imported the
audit barrel, which pulled the audit routes → auth → users → the department repository → back to a
schema still initializing), and a **stale auth snapshot** — an account moved out of a branch kept
reading that branch until its cached snapshot lapsed, because nothing dropped it on a placement
change.

**And two more in P7-C, reported from the running UI rather than found by any test** — both of the
same kind, "the code shipped and the control was unusable":

- **Duplicate was hidden on every managed role.** The button went into `RoleDetailPage`'s `actions`
  block, which is wrapped in a single `role.managed === 'none'` ternary so that Edit and Delete do
  not appear on a system or `hr-only:*` role. Duplicate inherited that gate and should never have
  had it: a well-shaped system role is the **obvious** thing to start a narrower one from. Edit and
  Delete now carry their own checks and Duplicate stands outside them.
- **Duplicate was disabled whenever the registry had not been read.** `duplicateBlocker` treated an
  **empty** catalog as "the registry declares nothing", so every key the role carried looked unknown
  and the blocker fired — on first paint for everyone, and **permanently** for an administrator
  holding `role.create` without `permission.view`, which the platform allows. The message blamed the
  role for carrying permissions nobody defines. The unknown check now runs only when there is a
  registry to check against; `assertKnownPermissionKeys` on the server was always what decided.

Fixed in [#169](https://github.com/egycashcompany-ops/egycash/pull/169). Both fixes were proven by
restoring each defect in turn and watching the new tests fail — 3 failures for the blocker, 1 for the
actions gate, 23 passing with both fixed.

## 7. Problems & limitations

- **Integration tests cannot run in the development sandbox.** `mongodb-memory-server` fetches its
  `mongod` binary from `fastdl.mongodb.org`, and the egress proxy answers `403`, so all 38 integration
  files fail identically at the download. Every phase ran them **on CI only**, said so in its PR, and
  nothing was routed around it.
- **One verification limitation is recorded in [#163](https://github.com/egycashcompany-ops/egycash/pull/163)'s
  description** rather than resolved: the self-contained assertion added to the `#160` regression was
  written *after* the fix, so it never ran against the pre-fix guard. The scenario itself is proven
  by CI run 483 failing and run 484 passing; the extra assertion is strictly stronger and untested
  against the old code. The equivalent P6 assertions **were** run against the previous implementation
  and fail there, which is the standard the module should hold to going forward.
- **A web suite with no DOM shapes the design, for better and worse.** It forced the rules into pure
  functions, which is the right structure. It also means no test in this module clicks anything, and
  a rule that cannot be extracted cannot be properly proven.
- **P7-C is what that limitation costs, stated concretely.** Every assertion covering duplication was
  either a source scan or a pure-function test. They proved a `<Can permission="role.create">`
  wrapper sat near the label and that `duplicateBlocker` computed correctly *for a populated
  catalog*. Neither could see that the wrapper was nested inside a branch that removes it, or that
  the function was being called with `[]` half the time. The regex that "covered" the gating —
  `expect(PAGE).toMatch(/<Can permission="role\.create">[\s\S]{0,900}?actions\.duplicate/)` — passed
  while the button was unreachable, and the owner found it by opening the screen. **This gap is still
  open**: the new tests pin the two known shapes, they do not make reachability testable in general.

## 8. Deliberate deferrals, and why

| Deferred | Why |
|---|---|
| **Audit, Settings, Appearance and Color Rules screens** | Named as later phases in the approved plan and guarded by a test that refuses their routes early. Audit and Settings have complete backends; **Appearance and Color Rules have none at all** and would need a collection, permissions and endpoints — a different size of phase, requiring a design proposal first. |
| **G-2 — fail-closed `orgScopeFilter`** | An undeclared scope field widens instead of refusing. Making it fail closed would invert the default on ~24 collections at once, turning a visibility bug into a total outage on a migration nobody ran (ADR-026, "Known limitation"). Every phase excluded it explicitly. |
| **Declaring `departmentField` / `sectionField` on the remaining collections** | Each answer is a per-collection modelling decision with a migration behind it, not something a role screen may decide. The screens **warn** about the widening instead. |
| **A bulk assignment-revoke endpoint** | ADR-026 §5. It would re-implement three refusal rules and report one outcome for many decisions. Revoke-all stays a client loop of independently authorized single revocations. |
| **Adding `meta` to `TimelineDto`** | P6 needed "is there more"; the endpoint is shared by every timeline consumer, and the scope forbade contract changes. Inferred from the page being full instead, at a cost of one empty request when the history is an exact multiple of the page size. |
| **The duplicated user API calls between HR and System Administration** | The alternatives are a cross-module import (forbidden) or refactoring HR, which no phase was allowed to do. |
| **Page-level authorization** (P7) | Decided against, explicitly. The page layer is **organizational only**: it groups permissions so a 202-key matrix can be read. Granting "this page" would be a second authority alongside the permission key and would have to answer what it means when the two disagree. Nothing in the authorization path reads `pageId`. |
| **A page for the 30 unassigned permissions** (P7-A) | They are cross-cutting or backend-only, and inventing a page to reach 100% would have made the number look better and the grouping worse. `pageId: null` is a declaration, and the CI check counts it rather than tolerating it. |
| **Deriving pages from `Application.permissionKey`** (P7-A) | Rejected during the design audit: it covered 21% of the keys, it is runtime-mutable data rather than code, and the relationship was not a function — which would have made the matrix counters and the tri-state select-all quietly wrong. |
| **A duplicate-role endpoint** (P7-C) | It would have to re-implement `assertKnownPermissionKeys` and `assertKeysHeld` on the one path where re-implementing them is most dangerous. The copy is a create with a pre-filled form. |

## 9. Lessons learned

- **Write the test that proves the rule, then check it fails without the fix.** P5's guard defect and
  P3's shipped one were both found by a test being written, not by review. P6 went further and ran
  its new assertions against the previous implementation to confirm they fail there — which is the
  only way a regression test earns the name.
- **A comment that disagrees with its code is a bug report.** The unknown-key contradiction sat in
  the file header for two phases, describing behaviour the code did not have. The instruction to fix
  the code and leave the comment was the right call: the comment was correct.
- **"No backend changes" is a useful constraint until it hides a missing rule.** P5 was scoped as UI
  work and turned out to need two service guards; P6 was scoped as UX and turned out to contain a
  security-adjacent fix. Both were flagged before being written rather than smuggled in.
- **Documentation drifted for seven PRs.** This closeout exists because none of #158–#164 carried its
  CHANGELOG entry in the same PR, which is the rule stated at the top of that file. The entries are
  harder to write well weeks later than they would have been on the day.
- **A test that reads the source proves the source, not the screen.** P7-C shipped with full green
  CI and a feature nobody could use. Every assertion was true and the button was unreachable. When a
  suite cannot render, "is this control reachable in the states the page is actually in" is a
  question it is structurally unable to ask — so the answer has to come from opening the screen, and
  the phase is not done until somebody has.
- **A deviation from an approved design is a decision, and it belongs to the owner.** P7-A widened a
  response the design said would not change. It was caught by CI as a broken assertion, which is the
  wrong place to discover a scope change; it should have been raised when it was made.
