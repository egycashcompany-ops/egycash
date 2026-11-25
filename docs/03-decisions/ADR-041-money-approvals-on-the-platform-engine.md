# ADR-041: Money approvals on the platform engine

**Status:** Proposed · **Date:** 2026-11-25 (the owner adopted every recommended default on 2026-11-24,
so OD-19 is A, OD-20 is A and OD-69's override sub-question is (i); design §16.12) · **Supersedes in
part:** [ADR-011](ADR-011-workflow-engine.md)'s "Approval integration" bullet (decision 1) · **Relates
to:** [platform core](../02-architecture/platform-core.md) §11,
[ADR-026](ADR-026-role-administration-guards.md) SA-4 (effective permissions) and SA-6 (accounts that
can sign in), [ADR-032](ADR-032-delegated-grants-per-site.md) (delegated grants), the
[Administrative Affairs design](../12-planning/administration-module-decisions-and-phases.md) (four
files; section numbers run across them) §5.2, §6.6, §7.6, §15.2.1, §16.5 (OD-69), §16.7 (OD-18,
OD-19, OD-20), §16.12, §18.3.1 and §20, and the
[PX-1 re-detail](../12-planning/administration-module-phase-px1.md)

The design's sections are in its four files: §0–§3 in
[`administration-module-design.md`](../12-planning/administration-module-design.md), §4–§7 in
[`administration-module-design-flows.md`](../12-planning/administration-module-design-flows.md),
§8–§14 in
[`administration-module-design-integration.md`](../12-planning/administration-module-design-integration.md)
and §15–§22 in
[`administration-module-decisions-and-phases.md`](../12-planning/administration-module-decisions-and-phases.md).
Paths below are under `apps/api/src/platform/approvals/` unless they say otherwise. A bare file name
outside that folder repeats the full path given at its first use. Line numbers are those of `main`
at `f48918ad`.

## Context

**Terms.**

- A **chain** is an ordered list of **rungs**. A rung is a permission key and a **level**: `unit`,
  `department`, `branch` or `organization` (`packages/contracts/src/platform/approvals.ts:35-51`).
  "Below" and "above" a rung mean earlier and later in that list. A chain is usually configured from
  the requester's unit up to the organization, but nothing enforces that order: a save checks only
  the keys and repeated rungs (`approval.service.ts:262-271`).
- A request's **Unit** is where it is judged: a branch, a company-wide department (a catalog entry,
  ADR-031), and that branch's copy of the department (`approver-level.ts:38-44`). The host builds it.
- A grant has a **scope**, `own`, `section`, `department`, `branch` or `organization`
  (`packages/contracts/src/common/index.ts:111`), and a reach of whole branches and department copies
  (ADR-032). `approver-level.ts:8-21` reads a grant as a level: `unit` is a department grant over the
  request's department in its branch only, `department` that department in every branch, `branch` a
  branch grant over the whole branch, `organization` organization scope. `own` and `section` reach no
  Unit (`apps/api/src/shared/types/index.ts:157-181`).
- A rung is **staffed** when some account holds its key at its level over the Unit. It is
  **settled** when it lies below `progressOf`, one past the highest rung the host's trail has an
  entry for (`approval-trail.ts:41-49`). A trail the engine wrote has an entry for every settled rung;
  `progressOf` also steps past a gap an older write left. The **first unsettled rung** is
  `progressOf`. The **waiting rung** is the first staffed rung at or after it (`liveStep`,
  `approval-chain.ts:83-92`). The **rung to decide** is the waiting rung on a `pending` chain and the
  first unsettled rung on an `unstaffed` one (decision 3). Reading a chain **live** means resolving
  the current chain row at each call.
- A grant is **in force** when its validity window is open now
  (`apps/api/src/platform/rbac/rbac.service.ts:123-127`). The code also says "active" for an
  assignment that is not deleted (`findActiveForUser`) and for an account whose `status` is `active`.
  This ADR keeps "active" for accounts.
- A **round** is one pass of a document through its chain. Administrative Affairs starts another round
  on a return (OD-72), a recount (OD-51) or a loss round (OD-47.4) (design §5.2, "Rounds"). HR leave has
  one round per request.

**What the engine is today.** No ADR records it, so it is set down here as the code has it.

- **Request types.** A module registers each kind of request at load in the **request-type
  registry**: a key, the module, a name and the permission keys a chain may use
  (`request-type.registry.ts:15-26`). HR leave is the only one, `hr.leave` with `leave.approve`
  (`apps/api/src/modules/hr/leave-management/leave-requests/leave-request.service.ts:65-71`). No other
  module imports the engine.
- **Chains are data.** A chain is a row of `approval_workflows`: a request type, a place (a company
  department and a branch, where null means "any") and its rungs, each with an optional caption, the
  label (`workflow.model.ts:12-42, 70`). There is one non-deleted row per place
  (`workflow.model.ts:61-68`), and the most specific row that matches a request wins
  (`approval-chain.ts:41-56`).
- **Nobody is stored.** Whether a rung is staffed, and who stands on it, is read from roles, role
  assignments and delegated grants at every call (`approver-lookup.ts:23-75, 101-145`;
  `approver-level.ts:64-82, 106-122`). A rung nobody holds is stepped over, as the owner put it: «لو
  مفيش Branch Manager، يتخطى المستوى ده ويروح للـGeneral Department Manager» (`approval-chain.ts:74-92`).
- **The host owns the request.** It stores the trail as `DecidedEntry` rows and owns its status, its
  write and every effect (`approval-trail.ts:26-36`; `approval.service.ts:150-157`). The engine reads
  the status, the trail and the current approvers back from those rows (`approval.service.ts:109-148,
  227-233`). `decide` returns the entries to append (`:158-224`). Decisions run on the host's own
  routes (`approval.controller.ts:1-2`).
- **Configuration and override.** `GET`, `PUT` and `DELETE` on `/api/v1/platform/approvals`, all
  under `approval.configure` (`approval.routes.ts:17-43`; `apps/api/src/app.ts:226`).
  `approval.override` lets a person who is not on the chain decide, recorded as `overriddenWith`
  (`approval.service.ts:173-185`). A save checks its keys against the **permission registry**, the
  keys the boot sync registered (`approval.service.ts:262`).
- **The barrel** (`index.ts:1-9`) exports `approvalService`, `APPROVAL_OVERRIDE_KEY`, the types
  `ApprovalSubject` (a request's type, Unit and decided entries), `DecidedEntry`, `ChainStatus` and
  `Unit`, the request-type registry's `registerApprovalRequestType`, `listApprovalRequestTypes` and
  `getApprovalRequestType`, and `buildApprovalsRouter`.

ADR-011 names an Approval Engine that "holds the transition until the chain resolves", and points to
platform core §11 (`docs/03-decisions/ADR-011-workflow-engine.md:24-26`). At `f48918ad`, §11
described a different engine: quorum rules, escalation, a decision trail held by the engine, an
event `platform.approval.completed`, and the collections `approval_chains`, `approval_requests` and
`approval_decisions` (`docs/02-architecture/platform-core.md:183-191, 271`). PX-1.0, the pull request
that carries this ADR, rewrites §11 and that row (Consequences, Docs).
`docs/07-workflows/workflow-engine.md` §1 and §4 and the database page's approval section
(`docs/05-database/database-design.md:247-256`, under a drift banner at `:220-224`) describe the same
engine, and keep that text under a pointer to this ADR. None of that engine exists.

**What is wrong for money.** Purchase requests and orders will be the first approvals on the engine
that lead to spending (design §18.1 note A4). The design found seven engine defects they must not
carry (design §15.2.1):

- **R1, the chain is not pinned.** `chainFor` resolves the chain again on every call, and entries are
  keyed by rung index only (`approval.service.ts:73-98`; `approval-trail.ts:26-36`). `setWorkflow`
  edits a chain in place (`approval.service.ts:273-297`). An edit maps recorded decisions onto other
  rungs. A deleted or deactivated chain falls back to the next wider chain that matches, or comes
  back empty when none does (`approval-chain.ts:41-56`; `approval.service.ts:83`), and empty reads
  approved while the host waits.
- **R2, a chain with no staffed rung left reads approved.** `liveStep` finds nothing and `statusOf`
  answers approved (`approval-chain.ts:83-92`; `approval-trail.ts:59-65`). Two cases reach it:
  - **all rungs unstaffed.** Leave stamps `pendingApproval` whenever the chain has rungs
    (`leave-request.service.ts:293-300`), so `decide` refuses it as already decided
    (`approval.service.ts:164-165`), and nobody can decide it;
  - **an unstaffed tail.** An approval that leaves no staffed rung above it writes every rung above as
    `skipped`, so the chain reads approved without them (`approval-trail.ts:109-127`;
    `approval-trail.spec.ts:127-143`). The owner's rule steps over an empty level to the next one;
    finishing a chain with no level left is the engine's own extension of it (its comment,
    `approval-trail.ts:109-112`).

  Design §15.2.1's fix for R2 covers both: the engine reports "no staffed rung" "at submission and at
  every decision, never as 'approved'".
- **R3, expired grants decide.** `ownStepsOf` reads `findActiveForUser`, which ignores the validity
  window (`approver-lookup.ts:107`; `apps/api/src/platform/rbac/rbac.repository.ts:171-176`).
  Staffing reads `findActiveForRoles`, which applies it (`rbac.repository.ts:245-259`).
- **R4, the override ignores scope.** Holding `approval.override` at any scope, even `own`, is enough
  (`approval.service.ts:179`). The same test drives `viewerMayOverride` (`:143-146`).
- **R5, the engine audits before the host commits.** `decide` records `platform/approval`
  `${requestType}:${stepIndex}` itself (`approval.service.ts:202-221`). The row's only link to a
  document is the HTTP request id (`apps/api/src/platform/audit/audit.service.ts:161-170`). Leave can
  still refuse after it: its attachment gate and its conditional write run later
  (`leave-request.service.ts:575-581, 589-611`).
- **R8, accounts that are not active count as approvers.** `approversFor` reads no account status
  (`approver-lookup.ts:23-75`). Accounts are `invited`, `active`, `suspended` or `archived`
  (`packages/contracts/src/platform/users.ts:11`).
- **R9, a chain may name any registered key, and a save carries no version.** `setWorkflow` checks a
  key against the permission registry, not the type's own `permissionKeys`, and skips the check when
  that registry is empty (`approval.service.ts:253-271`); the type's keys feed only the configuration
  screen (`request-type.registry.ts:9-12`). The body has no version
  (`packages/contracts/src/platform/approvals.ts:62-70`), and the update passes the `__v` the server
  read a moment earlier (`approval.service.ts:296`), so a save from a screen that loaded an older chain
  overwrites a newer one without warning.

The no-chain default also reads approved (`approval.service.ts:100-108`); design RK-10, the risk that
lists the engine's defects, names both defaults. R2 is its unstaffed counterpart. The engine enforces
no separation of duties either (R6, R7), which the design routes to hosts (§15.2.1, second table).

**What the owner decided.** OD-19 asked whether a document may pass with no chain or no staffed rung.
OD-20 asked whether the engine is fixed before money approvals rely on it. OD-69's override
sub-question asked whether `approval.override` may decide these approvals. The recommendations were
OD-19 A (refuse submission, and flag a document left with nobody to decide as stuck), OD-20 A (a
platform slice, PX-1, first, covering R1–R5, R8 and R9, the pin kept by the host, the engine
stateless, chain edits never moving documents already submitted) and OD-69 (i) (override decides
within its own reach, recorded as `overriddenWith` and bound by the host's separation-of-duties pairs,
design §6.6). On 2026-11-24 the owner took every recommended default as the working answer: «بص اعمل
انت الـ Recommendations من عندك دلوقتى وبعدين نبقى نعدل» (design §16.12).

## Decision

1. **The approvals contract.** The engine is a stateless service over chains stored as data, as
   Context describes. It stores no request and no person. A host registers its request types, stores
   its own trail and pin, builds its request's Unit, owns its status, its transitions and its write,
   and decides on its own routes. For approvals this replaces ADR-011's "the Approval Engine … holds
   the transition until the chain resolves": the engine holds nothing, and the host keeps its document
   where it is until a decision settles the chain. The rest of ADR-011 is untouched; the platform
   workflow engine it describes (`workflow_definitions` and the rest) was never built, and
   Recruitment's pipeline engine is the module's own
   (`apps/api/src/modules/hr/recruitment/workflow/workflow-engine.ts`). The engine's in-process surface
   is the barrel's exports. PX-1 adds `pinOf`, `readApprovalPin`, `approvalPinFields` and the types
   `ApprovalChainPin` and `LiveChain`, and widens `ChainStatus`, `ApprovalSubject`, `decide`'s result
   and `registerApprovalRequestType`. Its HTTP surface is configuration only. How a host uses it, from
   PX-1:

   ```mermaid
   sequenceDiagram
       participant H as Host module
       participant E as Approval engine
       participant A as Audit
       Note over H,E: Submission
       H->>E: chainFor(type, unit)
       E-->>H: rungs, staffing, status
       H->>H: its policy for noChain and unstaffed
       H->>H: store pinOf(chain) in the write that starts the round
       Note over H,E: Decision
       H->>E: decide({ type, unit, decisions, pin }, actor)
       E-->>H: entries to append, status, auditChanges
       H->>H: conditional write: append the entries, map the status
       alt type registered with audit 'host'
           H->>A: its own row on its document, after the commit
       else audit 'engine', the default
           Note over E,A: the engine recorded its row before it returned
       end
   ```

2. **No chain and no staffed rung are answers of their own, never "approved" (OD-19, R2).**
   `ChainStatus` (`approval-trail.ts:39`) becomes `pending | approved | rejected | unstaffed |
   noChain`. `statusOf` answers:
   - `rejected` once any rung is rejected, as today;
   - `noChain` when the chain has no rungs;
   - `pending` while a staffed rung waits at or after the first unsettled rung;
   - `approved` only when every rung is settled;
   - `unstaffed` otherwise: rungs remain unsettled and none of them is staffed.

   **An empty rung is passed only on the way to a staffed one.** A decision settles its own rung and
   the unsettled rungs below it, each written `covered` or `skipped` as today. It never settles a rung
   above it. So a rung nobody holds is stepped over only when a staffed rung above it decides, which
   is the owner's rule: skip the level and go to the next. An approval that leaves only empty rungs
   above it closes none of them; the chain reads `unstaffed`, and decision 3 applies. The engine's tail
   closure (`approval-trail.ts:109-127`) is removed: design §15.2.1 R2's fix ("at every decision,
   never as 'approved'") and OD-19 A (a document left with nobody to decide is flagged as stuck) both
   rule it out.

   **The host applies its policy.** At submission Administrative Affairs refuses `noChain` and
   `unstaffed` with `ADMINISTRATION_APPROVAL_CHAIN_MISSING` (OD-19 A; design §6.4 item 5, P2), and a
   document a decision leaves `unstaffed` waits for OD-61's stuck-approval sweep (design §5.2). HR
   leave keeps its submission rule: no chain sends the request down its manager and HR path, and a
   chain with rungs is stamped `pendingApproval` (`leave-request.service.ts:293-300`). What leave should
   do instead is the owner's question PXQ-1 (re-detail §2).
3. **An unstaffed chain is stuck, not approved (R2).**
   - **At submission.** `chainFor` also returns `status`, the chain's answer with no decisions yet:
     `noChain`, `unstaffed` or `pending`.
   - **At a decision.** `decide` checks the status first, then the actor. It refuses
     `approvals.nothingToDecide` on `noChain`, and `approvals.alreadyDecided` on `approved` or
     `rejected`. On `pending` or `unstaffed`, an actor who neither stands on a rung at or above the
     waiting one nor holds an override that reaches the rung to decide (decision 6) is refused
     `approvals.notYourStep`. On `unstaffed` nobody stands on a rung that is left, so only an override
     decides. An unstaffed request is still waiting, so "not your step" is its answer rather than
     "nothing to decide"; design §5.15 maps the two to different codes for Administrative Affairs
     (`docs/12-planning/administration-module-design-flows.md:1461`).
   - **The override's rung.** On an unstaffed chain the override decides the first unsettled rung,
     by that rung's level, and nothing above it (decision 2). A chain with several empty rungs needs
     one decision per rung, each by an override that reaches it, so an override never settles a rung
     it does not reach.
   - **Reading it.** `statusFor` answers `unstaffed`. In the trail, `currentStep` is the rung to
     decide, so the panel's "waiting here" mark
     (`apps/web/src/platform/approvals/ApprovalChainPanel.tsx:61, 84-88`) shows the rung an override
     settles and where the request stopped, and `viewerMayOverride` follows decision 6. `currentStep`
     is null only on a finished chain or one without rungs, as the contract says ("null when the chain
     is finished", `packages/contracts/src/platform/approvals.ts:155`). The trail gains no field.
   - **The stuck list is the host's.** The engine holds no requests, so it cannot list stuck ones. A
     host's sweep or report asks `statusFor` per document. For Administrative Affairs that is OD-61's
     stuck-approval sweep, in P2.
4. **The host pins the chain at submission, and the engine stays stateless (R1).**
   - **The fields.** The host stores `approvalWorkflowId`, the id of the `approval_workflows` row
     `chainFor` chose (an ObjectId; null while the request is not pinned), and `approvalChainShape`,
     the chain's rungs in order, each `{ permissionKey, level, label }` as the chain row stores it
     (empty while not pinned). The host declares both by spreading the barrel's `approvalPinFields`
     into its schema, as every schema spreads `baseFields`
     (`apps/api/src/shared/base/base.model.ts:17-24`). The spread carries the two fields, their
     defaults, the chain row's own rung schema (`workflow.model.ts:31-42`), so a stored rung is
     validated as a chain row's is, and a validator that refuses an id with no rungs. The host reads
     them back with `readApprovalPin(document)`, null when `approvalWorkflowId` is missing or null. The
     pin is the chain the request was submitted on, captions included.
   - **When.** The host writes both in the write that starts a round, from `pinOf(chainFor(...))`, and
     never rewrites them during that round. The next round stamps them again. HR leave has one round
     per request, so it writes them once.
   - **The engine reads the pin.** `ApprovalSubject` gains a required `pin: ApprovalChainPin | null`,
     where `ApprovalChainPin` is `{ workflowId: string; steps: readonly ApprovalStep[] }`
     (`packages/contracts/src/platform/approvals.ts:40-51`). With a pin, `statusFor`, `trailFor`,
     `decide` and `currentApprovers` take the rungs and their captions from it and read no chain row.
     Staffing stays current, for the Unit the host hands over at each call. With `pin: null` they read
     the current chain, as today.
   - **The Unit is the host's.** The pin fixes the rungs, not the Unit. Leave builds its Unit from
     the employee's current placement (`leave-request.service.ts:101-111`), so an employee's transfer
     moves who staffs a pinned request's rungs. Administrative Affairs builds it from the document's
     own fields, so moving the requester does not move the request (design §7.6).
   - **A pin with no rungs reads `noChain`.** `pinOf` never returns one, and `approvalPinFields`
     refuses one at write. Should one be stored anyway, the engine reads it as it reads any chain
     without rungs: `decide` refuses it for everyone, it never reads as approved, and the request stays
     readable, so the host's cancel, which reads no chain (leave's,
     `leave-request.service.ts:933-976`), is reachable from the screen.
   - **Keys that disappear.** A pinned rung whose key nobody holds any more, or that its type no
     longer offers (decision 9), is unstaffed, so it is passed only on the way to a staffed rung above
     it (decision 2).
   - **Edits.** `setWorkflow` keeps editing a row in place (`approval.service.ts:273-297`). The pin is
     what makes an edit, a deactivation or a deletion apply to new submissions only. For requests
     submitted after their host pins, that is the part of ADR-011's versioning ("in-flight instances
     complete on their definition version", `ADR-011-workflow-engine.md:19-20`) that approvals need.
   - **HR leave pins too.** Its own comment says a request "keeps that chain's shape"
     (`leave-request.service.ts:285-288`), which the code did not do, and OD-20's adopted
     recommendation, chain edits never move documents already submitted, holds for every host. Leave's
     audit is treated differently (decision 7), because the design keeps it as it is (design §18.3.1
     item 5).
5. **Only grants in force decide (R3).** `ownStepsOf` reads
   `roleAssignmentRepository.findInForceForUsers` (`rbac.repository.ts:183-197`) in place of
   `findActiveForUser`. `findActiveForUser` stays unfiltered: it is `loadGrants`' one read behind
   both SA-4's effective-permissions screen, which explains every grant, in force or not, and the
   enforcement path, which drops the grants out of force itself (`rbac.service.ts:1230-1252, 1264`).
   Delegated grants have no validity
   window (`apps/api/src/platform/rbac/delegation.model.ts:12-41`), so nothing changes for them.
6. **An override decides only within its own reach (OD-69 (i), R4).** This is OD-69 (i)'s "within its own
   reach", read rung by rung. Its "bound by §6.6" binds the host (decision 11). The override must reach
   the rung to decide as far as the rung's level asks. Reach is read from the actor's context, which
   holds grants in force only (`rbac.service.ts:123-127`), so an expired or not-yet-started
   `approval.override` reaches nothing.

   | Rung's level | The Unit must have | `approval.override` must… |
   |---|---|---|
   | `organization` | nothing | be held at organization scope |
   | `department` | its company department | cover that department in every branch |
   | `branch` | its branch | reach that whole branch |
   | `unit` | its branch and that branch's department copy | cover that copy in its branch |

   Organization scope passes every level, whatever the Unit has. Below it, a rung whose coordinates
   the Unit lacks fails closed, and that check comes before the reach check: the shared reach helper
   reads a missing department copy as a question about the whole branch
   (`apps/api/src/shared/types/index.ts:173-174`). `own` and `section` pass none. The refusal is
   `approvals.notYourStep`, as for an actor with no override at all (decision 3). An actor may
   override only when they have no decision of their own on the chain, that is no rung of theirs at or above
   the waiting one (`viewerDecision`, `approval-trail.ts:139-148`). `decide` and `viewerMayOverride`
   apply the same two tests.
7. **A host may record the decision after its own commit (R5). It is opt-in per request type.**
   - **The opt-in.** Each type declares it at its registration:
     `registerApprovalRequestType(type, { audit: 'host' })`. The default is `'engine'`. One host may
     register types of both kinds. Design §15.2.1, §18.3.1 item 5 and §20 say "per host"; per type is
     the finer grain, and for a host whose types are all of one kind the two read the same.
   - **What `decide` returns.** It always returns `auditChanges` as well: the decision, its rung's
     index, level and key, `overriddenWith` and the covered rungs. These are the change rows the
     engine's own row carries today (`approval.service.ts:209-220`), and the facts design §5.2's
     decision step 5 asks the host's row to carry.
   - **A `'host'` type.** `decide` records nothing. The host records one row on its own document,
     with its own entity and verb, after its commit. For Administrative Affairs the verb is OD-82's,
     in P2.
   - **An `'engine'` type.** Nothing changes. HR leave stays one: the engine records its row before it
     returns, so leave's later refusals can still leave that row behind. Moving leave is a separate
     HR slice (design §18.3.1 item 5).
8. **Only active accounts count as approvers (R8).** `approversFor` keeps only the accounts
   `userRepository.activeIdsAmong` returns (`apps/api/src/platform/users/user.repository.ts:44-63`):
   `status` `active` and not deleted. That is the predicate ADR-026 SA-6 shares with sign-in, so
   standing on a rung, counting as Super Admin cover and opening a session share one account
   predicate (`docs/03-decisions/ADR-026-role-administration-guards.md:308-312`; `rbac.service.ts:972`).
   Standing on a rung also needs the key at the rung's level. `hasApprovers` and `currentApprovers`
   inherit it, so a rung held only by accounts that are not active is unstaffed. The decider's own path needs no check: every authenticated request refuses an
   account that is not active (`apps/api/src/platform/auth/auth.service.ts:1018-1020`).
9. **A chain save names only its type's keys and the chain row it replaces (R9).**
   - **Keys.** Each rung's key must be one of the type's `permissionKeys`, read from the request-type
     registry, also when the permission registry is empty. A miss is refused with
     `approvals.unknownPermissionKey`, the key the permission-registry check already throws
     (`approval.service.ts:265-266`). The permission-registry check and the duplicate-rung check stay.
   - **The chain it replaces.** `SetApprovalWorkflowSchema` gains a required
     `basedOn: { id: string; version: number } | null`: the id and `__v` of the chain row the screen's
     draft started from, or null when the screen saw no chain at that place. A body without it is
     refused 400. `ApprovalWorkflowDto` gains `version`.
   - **Conflicts.** A save is refused 409 `STALE_DOCUMENT`
     (`apps/api/src/shared/errors/index.ts:57-61`) when the place's row is not `basedOn.id`, when its
     `__v` is not `basedOn.version`, when a row exists and `basedOn` is null, or when none exists and
     `basedOn` names one. A row deleted and recreated at the same place has a new id, so a save based
     on the old row is refused although both rows start at version 0. Two first saves at once meet the
     unique index; the create's `ConflictError`, 409 `DUPLICATE`
     (`apps/api/src/shared/base/base.repository.ts:501`; `errors/index.ts:51-55`), is answered as
     `STALE_DOCUMENT`. So is a row deleted between the place lookup and the update, which the update
     reports as 404 `NOT_FOUND` (`base.repository.ts:595-596`). The screen meets one code.
   - **Delete.** `DELETE` names the row id, so it never removes a chain recreated at the same place.
     It carries no version, so it can remove a chain another administrator edited after the screen
     loaded it. That is accepted: a delete removes the place's chain whatever its rungs, a pinned
     request does not see it, and design §15.2.1 R9 names saves only.
   - **Chains already stored.** A stored rung, on a chain row or in a pin, whose key is not one of its
     type's current `permissionKeys` counts as unstaffed. Staffing and the reader's own rungs both
     leave it out, so no holder of an unrelated key decides it as their own rung, and by decision 2 no
     chain finishes by passing over it. An override within reach may decide it, because reach is read
     by the rung's level (decision 6); that and a cancel are the way through for a request stuck on
     such a rung. This also covers a key a module stopped declaring: the boot sync deletes undeclared
     permissions (`rbac.service.ts:591`), but a custom role keeps the string. Such a chain is refused
     at its next save until that rung is removed. A read-only count of stored chains with such rungs
     is reported before this change merges (count C3, re-detail §10).
10. **Requests in flight keep reading their chain live, with no backfill.** A request submitted before
    its host pins has no pin and reads the current chain, which decisions 2, 3, 5, 6, 8 and 9 now
    judge. Writing a pin into such rows would be an operator migration (design D-17: an operator-run
    command, dry-run by default, run only with the owner's explicit approval; §15.3.7 class 3, the
    operator-run kind of data write). It is not planned.
    - **Its chain deleted or deactivated.** The request falls back to the next wider chain that
      matches, or reads `noChain`, which `decide` refuses for everyone. Its way out is the host's
      cancel and a new submission.
    - **The null path's end.** `pin: null` serves only these requests: a host that joins the engine
      after PX-1 pins from its first request, as P2 does. Once every registered host pins and no
      unpinned request awaits approval (count C2 of re-detail §10 reads zero), `pin` can become
      required and non-null. That changes this contract, so it is a new ADR.
11. **The engine enforces no separation of duties.** The requester may stand on a rung (R6), and one
    person may decide consecutive rungs (R7). Both are host rules (design §15.2.1, second table).
    Administrative Affairs applies design §6.6's pairs under OD-21, override decisions included
    (OD-69 (i), "bound by §6.6"). Leave keeps its own rule that nobody decides their own leave
    (`leave-request.service.ts:443-446`). R10, no "waiting for me" list, is a screen concern (design
    §13).
12. **Nothing else.** PX-1 adds no permission key, page, route, audit verb, event, notification or
    realtime topic. The engine's refusal keys stay the six it throws today:
    `approvals.unknownRequestType`, `approvals.unknownPermissionKey`, `approvals.duplicateStep`,
    `approvals.alreadyDecided`, `approvals.nothingToDecide` and `approvals.notYourStep`
    (`approval.service.ts:164-185, 254-269`). They stay untranslated: R11 stays with RK-23, the
    design's risk of untranslated refusals in the Arabic interface.
13. **Value bands need no engine change.** How a purchase order's approval follows its value is OD-18
    (P4; P3 under OD-23 A, whose quotation rule needs the thresholds first). Its recommended answer, a
    request type per band with the thresholds in a module setting, is module configuration: the host
    stamps the band's type at submission (design §2.1), and the engine runs that type as any other.
    Design §20 planned to add bands to this ADR later. They will not be added to it: a merged ADR is
    never edited (`docs/README.md` rule 2), and an amount condition inside the engine (OD-18 B) would be
    a new ADR.

## Alternatives considered

For OD-19, OD-20 and OD-69's override sub-question the owner adopted the recommended answers, A, A
and (i) ([design §16.12](../12-planning/administration-module-decisions-and-phases.md#1612-decision-log));
their other options are listed below with what each would have cost.

- **The engine stores the pin** (an `approval_requests` collection, platform core §11's shape). A
  request's state would live in two places, written by two writes that must agree, and the engine
  would learn request ids. The design keeps the engine stateless (design §15.2.1 R1).
- **A new chain row per edit, with the host storing only the row id.** The id would then be enough.
  But it changes `setWorkflow`, the one-row-per-place index (`workflow.model.ts:61-68`), the screen's
  list and the org-catalog migration's survey, which reads the rows directly
  (`apps/api/src/org-catalog-migration/apply.ts:546-590`). It is a larger change than a pin.
- **The pin as `permissionKey@level` strings**, design §15.2.1's proposal. It was made for OD-20 B,
  where the module compared its stored shape with the current chain (design §5.2, "Chain changes").
  Under OD-20 A the pin is the engine's input. Strings would need a parser, a failure for an entry
  that does not parse, and a second read of the pinned row to find each rung's caption. Rungs in the
  chain row's own schema need none of these.
- **The pin without captions, which are read back from the pinned row.** The caption would follow a
  later edit, at the cost of a row read on every call and a match of each rung by position, key and
  level. Captions are for display only, so that cost buys nothing the engine uses, and keeping them
  in the pin shows each request with the captions it was submitted under.
- **The engine keeps "no chain ⇒ approved", and only hosts refuse.** Any host that read `statusFor`
  would then approve silently, a second auto-approval path (design §15.2.1 R2).
- **The tail closure kept.** An approval would then finish a chain over rungs nobody reached. With R8,
  the unit manager's approval would finish a chain [unit, organization] whose organization rung's only
  holder is suspended; with the override, a decision held over one branch would finish an
  organization rung. Design §15.2.1 R2 and OD-19 A rule it out.
- **One override settles a whole stuck chain when it reaches every rung.** Fewer decisions, but reach
  would be read over several rungs at once. One rung per decision keeps decision 6's test whole and
  records each rung's override.
- **R4 by reach over the request's Unit, whatever the rung's level.** An override held over one
  branch could then decide an organization rung. Read by level, an override replaces a rung only
  where it reaches as far as the rung asks. That is the check the design wrote for its stopgap
  (design §15.2.1 R4).
- **OD-69 (ii), override never decides an administration type.** A stuck purchase request or order
  would lose the override exit, leaving a return under OD-72 B or a cancel, which loses a PO's band
  (design §5.2).
- **OD-69 (iii), override only below a named band.** A check per band (OD-69), on bands that do not
  exist before OD-18 is answered in P4.
- **OD-19 B, auto-approve.** Spend risk, and it needs lifecycle edges design §5 does not draw:
  `draft → approved` with the claims taken at submission, and a submission that posts for counts and
  adjustments (OD-19).
- **OD-19 C, a fixed fallback rule.** A fallback approver outside every chain is a second routing
  rule, one the chain screen does not show.
- **OD-20 B, module stopgaps in P2.** Duplicated logic: three stopgaps ship in P2 (R1's pin compare,
  R3's exact-level check, R4's override reach), and every later host would repeat them (OD-20).
- **OD-20 C, accept the defects in writing.** Risk on money, accepted in writing (OD-20).
- **R5 after commit for every host now.** It would move HR leave's audit, which the design keeps as it
  is and leaves to a separate HR slice (§18.3.1 item 5). The move itself is small: leave already
  writes its own row after its conditional write
  (`apps/api/src/modules/hr/leave-management/leave-requests/leave-request.service.ts:613-621`), so it
  would register with `'host'` and add `auditChanges` to that row.
- **R5 chosen per call.** A per-type declaration keeps every decision of one type alike. A call site
  that forgot the option would audit twice, or not at all.
- **R9's version from `updatedAt`.** `__v` is what `updateById` already compares
  (`base.repository.ts:579-583`), and what ECMS screens send as `version` (leave's DTO,
  `apps/api/src/modules/hr/leave-management/leave-requests/leave-request.mapper.ts:46`).
- **R9's version without the row id.** A row deleted and recreated at the same place starts at
  version 0 again, so a save from a screen that saw the deleted row would pass.
- **Backfill a pin into requests in flight.** It would be an operator migration, and nobody can know
  that today's chain is the one each request was submitted on. How many requests it would touch is
  count C2 of re-detail §10.

## Consequences

- **Administrative Affairs (P2 on).** Each approval host stores the two pin fields and hands the pin
  over, and builds its Unit from the document (design §7.6). Its types register with
  `audit: 'host'`. It maps `noChain` and `unstaffed` at submission to
  `ADMINISTRATION_APPROVAL_CHAIN_MISSING` (OD-19 A), sends a document a decision leaves `unstaffed` to
  OD-61's sweep, and applies design §6.6's pairs. It ships none of OD-20 B's stopgaps, and the remap
  of the engine's keys that design §5.15 specifies for its adapter needs no change.
- **HR leave.** Requests submitted from PX-1's pin pull request on keep the rungs they were submitted
  on. An expired assignment no longer decides. An override must reach the rung, by its level. A rung
  held only by accounts that are not active, or naming a key other than `leave.approve`, is
  unstaffed. A request with no staffed rung left, at submission or after an approval, waits in
  `pendingApproval` reading `unstaffed`, and an override within reach can decide it, one rung at a
  time. Today the first case waits with no exit, and the second is approved by the lower approval.
  Its trail marks the rung such a request waits on. On such a request `decide` refuses
  `approvals.notYourStep` to anyone without an override within reach, and on a request whose chain was
  deleted `approvals.nothingToDecide`; both refused `approvals.alreadyDecided` before. Leave's own
  trail also stops offering a decision on a request that is no longer pending (re-detail §6.1). The
  engine's audit row is unchanged. What leave should do in these cases is the owner's question PXQ-1
  (re-detail §2).
- **Requests in flight.** They have no pin, so an edit can still remap them, as today. The
  org-catalog migration refuses to link a department while leave requests awaiting approval sit under
  a chain that would then start applying (`apply.ts:538-545, 571-582`). It stays as it is, because
  unpinned requests still re-read their chain. It also counts pinned requests, which would not, so
  the migration stays blocked until those are decided or cancelled too.
- **The chain screen** sends `basedOn` for the chain it shows. A stale save gets a 409 and must
  reload. A stored chain that names another key is refused at its next save until that rung is
  removed.
- **Docs.** The documentation pull request (PX-1.0) rewrites platform core §11 and its collection row
  (`platform-core.md:183-191, 271`) to decision 1, marking what PX-1's code pull requests bring. It
  points `workflow-engine.md` §1 and §4 and the database page's approval section at this ADR.
- **Risks and limits.**
  - **Cost per read.** R8 adds one id-only user read per distinct key and level, inside the memo
    `chainFor` already keeps (`approval.service.ts:85-91`).
  - **Deploy.** A tab opened before the deploy omits the required `basedOn` and gets a 400 until it
    is reloaded. Because the schema is `.strict()`, a rolled-back API refuses the new web's `basedOn`,
    so the API and the web deploy and roll back together.
  - **Stuck chains.** An unstaffed chain needs one override decision per empty rung (decision 3),
    and nobody who can decide it is notified: its rungs have no holder, and leave's reminder goes to
    company-wide `leave.approve` holders. The re-detail counts the leave chains and requests this
    reaches before the change deploys (re-detail §10).
  - **Remaps.** Unpinned requests can still be remapped by an edit (decision 10), and a pinned request
    keeps a misconfigured rung until it is cancelled.
  - **The after-commit audit can be missing.** A `'host'` type's only audit row is written after its
    commit, and `auditService.record` queues and never throws (`audit.service.ts:218-227`). A process
    that stops between the commit and the record leaves a decision with no audit row; the document's
    own trail is then the record of the decision. Accepted, as ADR-021's amendment accepted the same
    trade (`docs/03-decisions/ADR-021-it-asset-custody-and-history.md:125-128`).
  - **Leave's Unit moves with the employee** (decision 4).
  - The re-detail's risk table (PX-R1 to PX-R9) carries the delivery risks.
- **Later changes.** Any change to these decisions, including another answer to OD-19, OD-20 or
  OD-69's override sub-question (design §16.12), is a new ADR that supersedes the decisions it
  changes.
