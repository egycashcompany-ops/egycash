# Administrative Affairs (الشئون الإدارية) — Warehouses & Procurement — Part 4 of 4

**Status:** DRAFT v0.1 (2026-11-17) — part of the design whose status, executive summary and contents are in [administration-module-design.md](administration-module-design.md). Section numbers run across the four files; decisions are `OD-xx` in [§16](administration-module-decisions-and-phases.md#16-open-business-decisions).

> Part 1: [administration-module-design.md](administration-module-design.md) (§0–§3) · Part 2: [administration-module-design-flows.md](administration-module-design-flows.md) (§4–§7) · Part 3: [administration-module-design-integration.md](administration-module-design-integration.md) (§8–§14) · Part 4: [administration-module-decisions-and-phases.md](administration-module-decisions-and-phases.md) (§15–§22)

---

## 15. Dependencies, migration and data

What the module takes from the platform as it is (§15.1), what it asks the platform to change (§15.2), what happens to
data (§15.3), what other modules feel (§15.4) and which decisions and prerequisites gate which phase (§15.5). Risks are
in §17; the decisions themselves in §16, the single source for them.

### 15.1 Platform services used as they are

| Capability | Where it lives | Used for | From |
|---|---|---|---|
| Manifest, boot, seed | `apps/api/src/platform/kernel/module-registry.ts:43-78`, `bootstrap.ts:35-148` | one manifest grown phase by phase. The seed runs on every boot of the api, the worker and each CLI that boots the platform: all of them except `db:sync-indexes` and `report:org-duplication`, which deliberately do not (`apps/api/src/sync-indexes.cli.ts:10-13`; `apps/api/src/org-duplication-report.cli.ts:16`) | P1 |
| Transactions | `platform/kernel/unit-of-work.ts:5-17` | a document and its number commit together: the counter row is ensured outside the transaction with a `$max` floor and moved by `$inc` inside it (the Fleet/ATM idiom, through PC-13's shared counter factory, §15.2.2; in P1 only if OD-05 picks generated codes, recommended default: A, generated item and supplier codes; otherwise from P2). From P5 the movements and their guarded `$inc` on balance rows join the same transaction; the balance rows themselves are ensured, with zero quantities, outside it (`ensureStockRows`) and never upserted inside it (§2.4.4) | P1 |
| Keys, pages, scopes | `packages/contracts/src/permissions/def.ts:100-143`; `platform/rbac/rbac.middleware.ts`; `shared/types/index.ts` (`scopeSelector`, `keyReachesBranch`, `keyCoversUnit`, `currentBranchId`); `shared/base/base.repository.ts`, `org-scope-match.ts` | `administration<Entity>` keys, each declared with its operation; the 18 page ids of §6.3, each arriving with its first key; declared scope fields; fail-closed branch records through the shared branch-scope rule (PC-12) | P1 |
| Organization | `platform/organization/index.ts` (unit repositories, `costCenterRepository` :62, `effectiveManagerId`) | warehouse branch, requester placement; cost-center names only under OD-41 B or C (recommended default: A, none) | P1 |
| Employees | `platform/directory/index.ts` (`searchDirectoryEmployees`, `getDirectoryEmployees`, `getSelfDirectoryEmployee`) | module-gated people search in `people/` (IT `/it/people` precedent); in P1 only while warehouses carry a keeper from P1a (OD-10's timing sub-question; recommended, as the owner's brief lists the keeper in warehouse master data) | P1 |
| Approvals | `platform/approvals/index.ts`; web `platform/approvals/ApprovalChainPanel.tsx` | request types registered at module load; the host stores its trail (`approvalSteps: ApprovalEntry[]`, leave's `DecidedEntry` plus the rung's label and the decider's name) and the other approval host fields of §2.1 | P2 |
| Audit | `platform/audit/index.ts`, `shared/utils/diff.ts` | after commit, one row per document act, plus one row on any other document whose lifecycle status the act changes (a GRN that closes its PO); verbs per §10.2, never `accept`/`reject` (ATM's labels) or `deliver`/`checkOut`; the approval-decision verb is OD-82; a print of record writes the module's own `administrationPrint` (§11.6.6) | P1 |
| Realtime | `platform/realtime/realtime-publisher.ts:40-74`, `realtime-registry.ts`; web `platform/realtime/invalidation-registry.ts` | one topic per audited entity type (§9.2's list, by phase in §18.2). Every audited act on a branch-scoped entity, whatever its verb, also sends an `update` signal carrying `branchId`, because `record()` passes none (`platform/audit/audit.service.ts:181-185`); transfers signal both branches; every posting also signals the signal-only topic `administration.stock` (gated by `administrationStock.view`) once per touched branch | P1 |
| Events, outbox | `platform/kernel/event-bus.ts:61-97`, `outbox.model.ts` | cataloged events; a fact a consumer must not lose is emitted, once that consumer exists (§12.11), with `{ reliable: true, session }` inside the transaction and nudged with `nudgeOutboxRelay()` after commit (`platform/users/user.service.ts:182-186`; §8.5) | P2 |
| Notifications | `platform/notifications/index.ts` | templates ensured in `administration.seed.ts`; `notify()` after commit; recipients and categories per OD-61 | P2 |
| Scheduler | manifest `scheduledTasks` (`platform/scheduler/scheduler.service.ts:15-30`) | `administration.*` reminders and sweeps (OD-61); cron runs in UTC while business days are Cairo dates (RK-13) | P2+ |
| Settings | `platform/settings/settings.registry.ts:7-23`; `settings.service.ts:180-200` | the paper signatories, one organization-scope string per paper role (§11.6.5), then the procurement-policy settings (value bands, tolerances: OD-18, OD-32), declared at module import, organization scope only. The settings service authorizes every write by the platform key `setting.edit` and its scope, so declaring a setting does not let a module key govern it. `/procurement-policy` therefore checks `administrationProcurementPolicy.manage` at organization scope (the module's `assertAdministrationOrgAuthority` over PC-12's shared check), then makes its one write with `setting.edit` added at organization scope, a module copy of ATM's `asSettingsEditor` (`apps/api/src/modules/atm/shared/settings-authority.ts:29-32`). The reverse path stays open: any `setting.edit` holder at organization scope can change these settings through the generic settings `PATCH` without the module key (RK-32; a sub-question of OD-18) | P3, or P2 if OD-59 prints PRs (§11.6.5); the policy P4 (P3 under OD-23 A) |
| Files | `platform/files` (`fileCategoryService.ensure`, `file-authorizers.ts:32-56`) | the eight `administration-*` categories of §11.2, each ensured with its first endpoint, and §11.4's link fields (`signedCopy`, `attachments[]`, …). Supplier papers come first if OD-11 files them (recommended default: A, it does), then request attachments (P2) and quotations (P3) | P1b (else P2) |
| Papers, exports | web `shared/lib/print-window.ts`, `shared/lib/xlsx-writer.ts`; api `shared/utils/stream-rows.ts`, `draining-writer.ts` | papers through one door (§11.6). The first paper is P2's purchase-request copy if OD-59 has PRs printed, otherwise P3's RFQ paper; `.print` keys exist only on the PO, the GRN and the stock issue. No exports in Phase 1 (OD-60.1, recommended default: (i), none; (ii) is a client Excel of master data on the owner's request). Server CSV under `<resource>.export` only where OD-60 picks server exports (recommended default: A; the first is P3's quotation comparison); client Excel under `.view` from P2's PR register | P2 or P3 |
| Money | `packages/contracts/src/modules/hr-payroll-money.ts`; web `shared/ui/MoneyInput.tsx` | prices and values as minor units | P3 |
| Sealed secrets | `platform/secrets` + ADR-034 | only if OD-11 stores bank data (recommended default: A, no bank data) | — |

**Rollout** carries no gate (D-19): a pilot runs by role assignment, and OD-80 asks whether it starts in a pilot
branch or in all branches; its answer is needed before the module's roles are assigned in production, not before code.
Its inputs: a page ships with its navigation row and keys ("only SHIPPED pages appear in
navigation", `apps/api/src/seed-navigation.ts:900-903`), and the boot sync gives super-admin every new key but
platform-admin only the platform's own (`apps/api/src/platform/rbac/rbac.service.ts:599-605`). A phase is therefore
visible to super-admin holders the day it deploys, and to other roles once their keys are granted, by hand or through
the managed role bundles (D-20; OD-78 asks which ready-made roles exist). An environment gate or a feature flag, D-19's
rejected alternatives, is one more switch to build and later remove, and a flag would be the first in ECMS: the flag
catalog is empty (`packages/contracts/src/flags/index.ts:19-23`).

### 15.2 Platform changes the module needs or recommends

#### 15.2.1 Approval-engine hardening: platform slice PX-1 (OD-20), before P2

The engine's authority model fits procurement, but it has five defects in `apps/api/src/platform/approvals/` that money
approvals must not carry. Platform slice PX-1 fixes them, and R8 and R9 of the second table, with a new platform
ADR (§20, "Money approvals on the platform engine"), under OD-20 (recommended default: A, the slice before P2). Under A
the module builds none of the stopgaps marked "OD-20 B only" below: PX-1 fixes R1, R3 and R4 in the engine, and the
module does not repeat those checks. Under OD-20 B those three stopgaps ship in P2 instead (§18.1 A4): R1's pin
compare, refused with `ADMINISTRATION_APPROVAL_CHAIN_CHANGED`, R3's exact-level check and R4's override reach. The last
column below outlines them and §6.4 item 4 names them; they are written out in detail only if PX-1 is deferred. Under C
the owner accepts R1–R5 in writing.

| Defect | Evidence | Effect on a PR or PO | Proposed platform fix | Module stopgap if the fix is late |
|---|---|---|---|---|
| **R1** chain not pinned | `chainFor` re-resolves on every call, and entries are keyed by `stepIndex` only (`platform/approvals/approval.service.ts:73-98`; `approval-trail.ts:26-36`). `setWorkflow` edits a place's chain **in place**: `updateById` on the existing `_id`, so only the row's `__v` and `updatedAt` move (`approval.service.ts:273-297`; `shared/base/base.repository.ts:574-592`) | an edited chain maps recorded decisions onto other rungs, or drops a rung the document still needed; a deleted or deactivated chain reads "approved" while the document stays `pendingApproval` | pin the chain's shape per request at submission (workflow id + ordered steps; staffing stays live); edits apply to new submissions — the pinning ADR-011 promised. The pin lives on the host, in `approvalWorkflowId` and `approvalChainShape` (host field #7, §2.1), and the engine stays stateless: the host hands it the pinned chain (the proposed PX-1 shape, settled in its ADR, §20) | the host stores the same two fields at submission, `approvalWorkflowId` **and** `approvalChainShape: string[]`, the ordered `permissionKey@level` of each rung, as `chainFor` returns them (`approval.service.ts:92-97`). OD-20 B only: a decision is refused with `ADMINISTRATION_APPROVAL_CHAIN_CHANGED` when either the id or the shape differs from the live chain (a check no ECMS host makes today); the way out is a cancel and a new submission, or, under OD-72 B, a return by a holder on the new chain, which keeps the number (§5.2). The id alone catches only a deleted, deactivated or newly more specific chain, never an edit |
| **R2** unstaffed chain: approved by the engine, stuck under the leave host | the engine reads a chain whose every rung is unstaffed as approved: `liveStep` finds nothing and `statusOf` answers `approved` ("approved by default … the caller's policy", `approval-chain.ts:74-92`; `approval-trail.ts:59-65`). Leave writes `pendingApproval` whenever `steps.length > 0` and never asks `statusFor` (`leave-request.service.ts:294-300`), so `decide` refuses (`approvals.alreadyDecided`, `approval.service.ts:164-165`) and `currentApprovers` is empty (`:226-233`) | a host that took its status from `statusFor` or `trailFor` would silently approve the PO: a second auto-approval path beside "no chain ⇒ approved". A host that stamps `pendingApproval`, as leave does, waits forever | the engine reports "no staffed rung" as its own answer, at submission and at every decision, never as "approved"; a stuck-request report | refuse submission without an active chain or a staffed rung (OD-19, recommended default: A); never take a status from `statusFor` alone (§5.2); after each decision, re-check the new live rung's eligible approvers and flag a document left without one for OD-61's stuck-approval notice and sweep (§6.4 item 5; §5.2) |
| **R3** expired grants decide | `ownStepsOf` reads `findActiveForUser`, unfiltered by `validFrom`/`validTo` (`approver-lookup.ts:107`; `platform/rbac/rbac.repository.ts:171-176`); staffing uses the filtered `findActiveForRoles` (`:245-259`) | an acting approver keeps approving after the window closes, on any rung their expired grant reached | apply the validity window inside `ownStepsOf` by reading `roleAssignmentRepository.findInForceForUsers([new Types.ObjectId(userId)])` (`platform/rbac/rbac.repository.ts:178-197`, already used at `rbac.service.ts:1512`) in place of `findActiveForUser`; keep `findActiveForUser` unfiltered: SA-4, the effective-permissions screen (`docs/03-decisions/ADR-026-role-administration-guards.md:233`), relies on it (`rbac.service.ts:1230-1237`) | OD-20 B only: §6.4 item 4's exact-level check: the decide route requires an active grant at exactly the picked rung's level over the Unit, read from `ctx`, which holds active grants only (`rbac.service.ts:123-127`): `ctx.userId` among `currentApprovers` on the live rung; on a higher rung, `scopeOf`, `reachOfKey`, `keyReachesBranch` or `keyCoversUnit` by its level; a key held at two scopes is refused, fail-closed. An active grant of the key at another level (a permanent branch grant, say) is not enough while the expired one still puts the actor on a higher rung |
| **R4** override is scope-blind | `actor.permissions['approval.override'] !== undefined` accepts any scope, even `own` (`approval.service.ts:179`) | an override holder in one branch decides another branch's PO | require organization scope or the override's reach over the request's Unit | OD-20 B only: an off-chain decision needs `approval.override`'s own reach over the live rung, by the rung's level: organization scope, `keyCoversDepartmentEverywhere`, `keyReachesBranch` or `keyCoversUnit` (§6.4 item 4). Whether override decides these approvals at all is OD-69's override sub-question (recommended default: (i), within its own reach, recorded as `overriddenWith` and bound by §6.6) |
| **R5** audit before commit, naming no document | `decide` records `platform/approval` `${requestType}:${stepIndex}` itself (`approval.service.ts:202-221`); the row carries the HTTP request id (`platform/audit/audit.service.ts:167`) but no document id | a refused host write leaves a row for a decision that never happened, linked to no document | `decide` returns the audit facts; the host records them after commit, with its document id (opt-in per host, so leave keeps its behavior, §20) | the module's own after-commit audit on its document is the trail of record (D-12); pre-checks before `decide` keep orphan engine rows rare (§5.2) |

The other engine defects are routed:

| Defect | Evidence | Where it goes | Module check meanwhile |
|---|---|---|---|
| **R6** the requester is a rung's only holder | staffing does not exclude the requester (`approver-lookup.ts:23-75`); the host forbids them, so the rung blocks | OD-19 and §6.6: the live rung is checked at submission (`currentApprovers` minus the requester); later rungs are re-checked after each decision, and a stuck document is flagged (§5.2, §6.4 item 5) | §6.4 item 5: eligible approvers exclude the requester and, under OD-21 A or B (recommended default: B), the creator and the submitter |
| **R7** one person decides consecutive rungs | `decisionFor` lets the holder of two rungs take each in turn (`approval-chain.ts:154-164`) | OD-21 (recommended default: B, with §6.6's pairs) | the §6.6 pair the owner adopts |
| **R8** accounts that are not `active` count as approvers | `approversFor` reads no account status (`approver-lookup.ts:23-75`), so a rung staffed only by a suspended account passes the staffing test, then waits: an R2 variant, not a separation-of-duties rule | PX-1: count only `active` accounts | §6.4 item 5: only `active` accounts count as eligible on the live rung |
| **R9** a chain may name any registered key | `setWorkflow` checks that a key is registered, not that it is among the type's `permissionKeys`, which feed only the configuration screen (`approval.service.ts:253-271`; `request-type.registry.ts:9-12`); a chain save carries no client version | PX-1: enforce the type's `permissionKeys`, and a client version on saves | §6.4 item 1: submission refuses a chain that names another key (`ADMINISTRATION_APPROVAL_CHAIN_MISSING`) |
| **R12** no tests | `approval.service.ts` and `approver-lookup.ts` have no specs, and no integration suite writes a chain | PX-1 brings unit and integration coverage (§18.3) | — |

PX-1 covers R1–R5 plus R8 (inactive approvers) and R9 (a chain may name any registered key; no client version), so
its exit criteria in §18.3 hold one test per defect for all seven, and its ADR's scope in §20 names all seven (OD-20).
The no-chain default "approved" (`approval.service.ts:99-112`) is OD-19. R10 (no "waiting for me" list) is a
screen concern (§13); R11, engine refusals as untranslated keys, joins RK-23.

#### 15.2.2 Other platform changes

| # | Change | Where | Kind | Needed by | Why |
|---|---|---|---|---|---|
| PC-1 | Mark an outbox delivery handled only after its handler succeeds, and set the `failed` status the model declares but nothing sets | `platform/kernel/event-bus.ts:100-109, 115-137`; `outbox.model.ts:14, 27` | recommended | the first reliable event with a cross-module consumer: P5 if OD-02 C or OD-65 B gives IT a consumer of `administration.goodsReceipt.posted`; the Finance handoff event only with its first consumer (§12.11) | the dedup row is written before the handler, so a handler that throws is skipped on every retry; `relayOutbox` marks a row `dispatched` once it is enqueued, before any handler runs |
| PC-2 | An employee's cost center on a date, through the directory | `platform/directory/index.ts` + `modules/hr/directory-seams.ts` | only if OD-41 C | P6 | `DirectoryEmployee` has no cost center (`apps/api/src/platform/directory/index.ts:16`) |
| PC-3 | Supplier lookup seam for IT and Fleet | new platform seam in the directory pattern (`apps/api/src/platform/directory/index.ts:147-462`) | only under OD-01 B, or C's second stage | when IT and Fleet switch to the registry; under C it may come before any merge (§15.3.5 a) | IT and Fleet may not import Administration |
| PC-4 (= PX-2) | Extract the sweep-mark idiom into a platform helper; `administration_sweep_marks` uses it | platform, from `it/shared/sweep-mark.model.ts` and `fleet/sweeps/sweep-mark.model.ts` | conditional: only if an announcement needs marks | the first such announcement (§18.1 A10; likely P9's digests or the integrity announcement, OD-61) | ADR-025 (`:47-50`) forbids a third copy; a fact stamped on its document, or a notification idempotency key, needs no mark |
| PC-5 | Send `X-Active-Branch` on binary downloads, and parse the JSON error envelope of a refused one | `apps/web/src/shared/lib/api-client.ts:514-537` | recommended | the first server export: P3's quotation comparison under OD-60 A | `fetchBlob` omits the header ADR-028 expects on every request (§11.7) |
| PC-6 | Align the web's friendly error keys with emitted codes | `apps/web/src/shared/lib/errors.ts:8-266` | recommended | any time | `BUSINESS_RULE`/`CONFLICT` never match `BUSINESS_RULE_VIOLATION`/`DUPLICATE` (`packages/contracts/src/errors/index.ts:47-49`) |
| PC-7 | Requester liveness: on `notification:new`, derive the topic from the notification's `entityRef` and invalidate it; a generic platform-web rule, with an administration-only allow-list as the fallback (§9.5) | web realtime client | ADR only if made a platform convention (§20) | P2, soft: P2 ships with `staleTime` and navigation refresh for requesters, and PC-7 lands when platform review accepts it | own scope joins no room (`platform/realtime/realtime-rooms.ts:29-35`) |
| PC-8 | A notification category | `packages/contracts/src/platform/notifications.ts:8-19` + labels | only under OD-61 B (an `administration` category); `approval`, `workflow` and the unused `finance` already exist | P2 | closed enum |
| PC-9 (= PX-3) | Split the CI job (its ceiling already went from 30 to 45 minutes) | `.github/workflows/ci.yml:16` (a CODEOWNERS path) | D-18: split in PX-3 | before P5 | RK-01 |
| PC-10 | None left: `EGYCASH_LOGO` already moved, to contracts, with gold re-exporting it (§11.6.3) | `packages/contracts/src/assets/egycash-logo.ts:7`, exported as `@ecms/contracts/egycash-logo` (`packages/contracts/package.json:14-16`); `apps/web/src/modules/gold/lib/egycash-logo.ts:1-5` (six web importers across four modules) | done upstream | — | the module imports the subpath, as HR's server letterhead does (`apps/api/src/modules/hr/contracts/contracts/letterhead.ts:4`) |
| PC-11 | Move the export walk and buttons and the company report form to `apps/web/src/shared/`, behind re-exports (§11.7) | `apps/web/src/modules/fleet/lib/whole-catalog.ts`, `fleet/lib/fleet-sheet.ts`, `fleet/lib/fleet-report-print.ts`, `it/components/RegisterExportButtons.tsx` | recommended; the fallback is importing them from Fleet and IT, as ATM does | the first client export: P2's PR register, or P1 if the owner asks for one (OD-60.1 (ii)) | the module would be their next cross-module importer |
| PC-12 | Write ATM's fail-closed branch-scope rule and its organization-scope check once, in `apps/api/src/shared/base/`: `branch-scope.ts`, beside `org-scope-match.ts` (`branchScopeMatch`, `branchScopeBranches`, `narrowToBranch`, and `writableBranches` and `resolveWorkBranch` taking the candidate branch ids as an argument), and `org-authority.ts` (`assertOrganizationScope(ctx, key, reason)`: 403, `ForbiddenError`, unless `scopeOf(ctx, key) === 'organization'`). ATM keeps its exported names as thin wrappers, and its active-branch loader; `assertAtmSettingsManager` and the bank service's check call the shared check; the module's `shared/org-authority.ts` wraps it as `assertAdministrationOrgAuthority`. The precedent: `selectorBranches` was written beside `scopeSelector` (a copy of ATM's `registerScopeBranches`, which ATM keeps; `apps/api/src/shared/types/index.ts:284-308`) | `apps/api/src/modules/atm/shared/branch-scope.ts:36-126`; `apps/api/src/modules/atm/shared/settings-authority.ts:12-20`; `apps/api/src/modules/atm/catalogs/bank.service.ts:131-138` | recommended | one pull request before P1a.1 (its org-authority check; the branch-scope rule's first caller is P1a.3) | a second copy of a scope rule whose defect shipped twice (RK-15). Layer 3, not Platform Core (`docs/02-architecture/module-structure.md:120-122`): these are pure, business-agnostic functions of the request's grants, like `scopeSelector`, `selectorBranches` and `orgScopeMatch`, which already live in `apps/api/src/shared/`. `shared` may import only `shared` (`eslint.config.js:70`), so the one data read, the active branch ids over `platform/organization`'s `branchRepository`, stays with each caller: ATM's `activeBranchIds`, and the module's own one-line loader. The module's `shared/branch-scope.ts` holds that loader (P1a.3) and its own two-branch helpers (`twoBranchScopeMatch`, `branchScopeMatchOn`) |
| PC-13 | (a) A counter factory, `apps/api/src/shared/base/counter.ts`, written from Fleet's custody counter: the ensure outside the transaction with a `$max` floor, create-if-missing; the next number inside the caller's transaction; a peek. It takes the model name and the `<module>_counters` collection as arguments, and the module is its first caller (`administration_counters`). (b) IT's `foldName` moves to `packages/contracts/src/common/`, and IT imports it from there, so the module's name fold (`nameKey`, §2.1) is that one function, not a copy | `apps/api/src/modules/fleet/custody/custody-counter.model.ts:36-90`; `apps/api/src/modules/it/go-live/inventory-import.ts:115-123`, imported by `apps/api/src/modules/it/assets/asset-import-plan.ts:47`, `apps/api/src/modules/it/go-live/consumable-type-defaults.ts:12` and `apps/api/src/modules/it/go-live/consumables-opening-import.ts:16`, and tested in `apps/api/src/modules/it/go-live/inventory.spec.ts:120-124` | recommended | one pull request before P1a.1 | Fleet and ATM (`apps/api/src/modules/atm/settlements/plans/note-counter.model.ts`) already hold one copy of the counter each; a module copy would be the third, against "Never copy-paste across modules" (`docs/02-architecture/module-structure.md:122`). The factory is S, where platform-core's sequence service is L (D-6). Fleet's and ATM's counters keep their copies and may move onto the factory later, which the cross-module findings list (`docs/10-reviews/2026-11-administration-design-cross-module-findings.md`, §21), not this design's work |

Cost-center names (OD-41 B or C; recommended default: A, none) need **no** platform change: `costCenterRepository` is
exported (`platform/organization/index.ts:69`) and `people/` serves options under a module key. No
`/platform/cost-centers/options` exists (`cost-center.routes.ts:26-58`; a web call to one fails
`platform-routes-exist.spec.ts`). B or C reverses the recorded D-CC-3 («employees only»), whose guard checks five named
files (`cost-center-guards.spec.ts:76-88`) and would not fail, so its wording is amended in the same pull request.
Serving the names under a module key also widens who reads the organization's cost-center list, today only holders of
`costCenter.view` (`cost-center.routes.ts:26-38`); who may read them belongs to OD-41 (recommended default, under B or
C: codes and names only, to holders of the MR create key). Options in `people/` page through `BaseRepository.list`'s silent
cap of 100 rows (`shared/base/base.repository.ts:363`; `MAX_PAGE_SIZE`, `packages/contracts/src/common/index.ts:139`) the
way `platform/organization/shared/all-options.ts` (`collectOptions`) does — a module copy, since the organization barrel
does not export it — or use server search.

The module's `shared/cairo-day.ts` re-exports the shared Cairo calendar in `@ecms/contracts`
(`packages/contracts/src/common/cairo-date.ts`), as HR's `business-date.ts` now does, instead of copying
IT's day window and HR's calendar-date and year helpers, an idiom IT, ATM (`atm/shared/cairo-time.ts`) and Fleet
(`fleet/fleet-cairo-day.ts`) still copy.

#### 15.2.3 Central files every phase registers in

None changes behavior; each is a census. Miss one and a spec fails, or CI silently passes. §18.4 restates the same
files as per-pull-request coupling rules.

| File | Change | When | If missed |
|---|---|---|---|
| `apps/api/src/modules/index.ts` | import + `moduleManifests` entry | P1 | nothing mounts; registry specs cannot see the keys |
| `scripts/check-page-registry.mjs:65` | add `'administration'` to `MODULES`. The script reads source, and only `<id>.module.ts` (`:21-63`): pages in the parsed shape (`export const administrationPages: PageDef[] = [`, with literal module and page ids), and `declarePermissions(...)` calls by bracket matching, so every call sits in `administration.module.ts` (calls in other files are invisible to it) and no permission name contains a parenthesis, which breaks its count (copy ATM's guard, `atm.module.spec.ts:170-174`). `page-registry.spec.ts:16` (hr, fleet, it only) is optional; a module-local manifest spec (`atm.module.spec.ts`) is preferred | P1 | the CI step does not see the module. Boot still validates the assembled registry and throws (`platform/kernel/bootstrap.ts:94-100`; `rbac.service.ts:648-654`), and 148 of the 167 integration files boot every manifest (RK-01), so a broken registry still fails CI, through the suites rather than this script |
| `apps/api/src/seed-navigation.ts` (+ `seed-application-sections.ts`) | a category whose English name is not `'Administration'` (`seed-navigation.ts:1302`), placed after ATM: both OD-62 (recommended default: A, "Administrative Affairs" / «الشئون الإدارية», after ATM). Categories match on `name.en` (`:1414-1416`), so the English name is permanent once seeded (RK-16) | P1 | rows merge into System Administration |
| `seed-navigation.spec.ts:81`; `tests/integration/auth-seed-login.spec.ts:37, :142-151, :291-298, :315` | 140 + n rows; the category order; the per-category breakdown; 8 → 9 groups | each phase adding rows | pinned counts |
| `apps/web/src/platform/navigation/app-icon.tsx:44-104`; `shared/ui/icons.tsx` | the new glyphs and keys `box` (the category) and `warehouse` in P1a.W, later `cart` (§13.1, §13.3); none exists today. The tile glyph is OD-62.1 (recommended default: A, a box); the `warehouse` row glyph is the design's. OD-62 also covers the names and labels and when nav sections arrive | P1 | an unknown row icon falls back silently (`resolveNavIcon`, `app-icon.tsx:106-109`); a module tile's is pinned by `apps/web/src/platform/navigation/module-icons.spec.ts:44-81`, which fails |
| `platform/realtime/realtime-registry.ts`; web `platform/realtime/invalidation-registry.ts` | one topic per audited entity type, with its view key, plus the signal-only `administration.stock` (`administrationStock.view`); on the web, each mapped to its key prefixes. The spec finds entities only as literal `{ moduleId, entityType }` pairs, so each `<entity>-audit.ts` writes its pair as a literal, as IT's `signalConsumable` does (`modules/it/consumables/consumable-history.ts:104-111`). A shared helper that takes the entity type as a variable (`posting-lifecycle.ts`, say) is a dynamic site: pinned by value in `DYNAMIC_ENTITY_KEYS` and counted in `EXPECTED_DYNAMIC_SITES`, 16 today and 10 at `b03522f` (`realtime-registry.spec.ts:18-65`) | every phase | `realtime-registry.spec.ts:100-129`; `realtime.spec.ts:166-215` |
| `packages/contracts/src/platform/audit.ts` + `systemAdmin.users.audit.<verb>` (en, ar) | none in P1: master data uses `create`, `update`, `activate` and `deactivate`, which exist (`audit.ts:111-112`); the last two are not broadcast (`packages/contracts/src/platform/realtime.ts:19-31`), so (de)activation also sends an explicit `update` signal. Later only verbs §10.2 justifies (`submit`, `approve`, `post`, `adjust` and `count` do not exist today). The module's print verb `administrationPrint` (en "Printed a paper of record", ar طباعة مستند رسمي) is appended after ATM's `atmSettlementPrint` (`audit.ts:193-198`) with the first paper of record (OD-59), shipped like OD-82's verb (RK-29). `accept`/`reject` (ATM's «قبول/رفض رسالة صيانة», `audit.ts:168-169`), `deliver` and `checkOut` are never reused (§10.3). The approval-decision verb is OD-82 (recommended default: A, a new `approvalDecision`), shipped a release ahead of its first writer or with api and worker deployed together (RK-29) | P2 (OD-82), then per phase | `system-admin-i18n.spec.ts:113-127`, `audit-screens.spec.tsx:361-368` |
| `packages/contracts/src/errors/index.ts` | module-prefixed codes (precedents `OPERATIONS_CUSTODY_NOT_HELD` `:230`, `ATM_PLAN_LINE_STATE` `:493`), each shipped with the first rule or transition that raises it and its en and ar text in the shared web `FRIENDLY` table (`apps/web/src/shared/lib/errors.ts`, IT's and Organization's precedent), with a case in `errors.spec.ts`: from P1, the six master-data refusals of §5.15 (`ADMINISTRATION_CATEGORY_PARENT_INVALID`, `…_STOCK_LEVELS_ORDER`, `…_REFERENCE_INACTIVE`, `…_DEACTIVATION_BLOCKED` and `…_EMPLOYEE_EXITED`, 422, and `…_DUPLICATE`, 409; a code with details is thrown as `new AppError(code, status, message, { details })`, `apps/api/src/shared/errors/index.ts:5-24`); from P2, the eight general codes (`ADMINISTRATION_INVALID_TRANSITION`, `…_TRANSITION_BLOCKED`, `…_REASON_REQUIRED`; the approval codes `…_APPROVAL_CHAIN_MISSING`, `…_APPROVAL_CHAIN_CHANGED` (OD-20 B only, §15.2.1), `…_APPROVAL_NOT_PENDING`, `…_APPROVAL_NOT_YOUR_STEP` and `…_SEPARATION_OF_DUTIES`); and from P5 §2.4.4's stock codes (`…_INSUFFICIENT_STOCK`, `…_OPENING_BALANCE_NOT_FIRST`, `…_ITEM_INACTIVE`, `…_ITEM_UNIT_CHANGED`, `…_WAREHOUSE_INACTIVE`, `…_STOCK_ROW_NOT_READY`; `…_STOCK_FROZEN` with counts, P7) | P1, then with each rule or transition | Arabic users read English refusals (RK-23) |
| `packages/contracts/src/events/catalog.ts`; `catalog.spec.ts:181-195`; `platform/kernel/event-publishers.spec.ts` | event source, `EVENT_MODULE_NAMES.administration`, lexicon words; constants in the "invents nothing" hand list (`catalog.spec.ts:181-195`); every emitted name cataloged (`event-publishers.spec.ts:165-170`) and a reliable event's payload keys within its catalog fields, `EVENT_MULTI_PUBLISHER` being the hand-written exception list (`:198-216`) | first emitting phase (P2) | compile error; spec |
| `apps/api/src/workforce-reset/targets.ts:133`; `targets.spec.ts:50-52`; `tests/integration/workforce-reset.spec.ts:223-243, :361` | classify each collection holding an employee path (§15.3.3) | P1a if warehouses keep a keeper (OD-10), then the phase adding each path | the unit spec fails CI on an unclassified path; the reset refuses to start; the exact `keep` list and its count fail |
| `apps/api/src/modules/hr/employee-management/employees/employee-name-copies.ts` (`CLASSIFICATION`); `employee-name-copies.spec.ts:43-60` | classify each path ending in `name` on a `keep` collection, subdocument arrays included: `scrub` with its `by`, or `leave`; a `scrub` also joins the spec's pinned list. Edited in the module's own pull request that adds the path, the exception §15.3.3 states | P2 (`requesterName`), then the phase adding each path; none in P1 | the spec fails CI on an unclassified path (`employee-name-copies.spec.ts:30-33`; `employee-name-copies.ts:268-275`) |
| `apps/web/src/platform/localization/i18n.ts` | `systemAdmin.roles.module.administration` (en, ar) | P1 | the role matrix shows the raw key |
| `apps/web/src/shared/lib/remembered-filters-coverage.spec.ts` | classify every `*Page.tsx`, Phase 1's `ItemDetailPage` and `SupplierDetailPage` included | each page | partition spec (`:502-506`) |
| `apps/web/src/shared/lib/print-window.spec.ts:138-155` | each paper composer | the first paper (P2 if OD-59 has PRs printed, else P3) | one-door list; a convention: only the global no-script rule fails CI (`:128-136`) |
| `apps/api/src/shared/utils/stream-rows.spec.ts:110-123` | each server export | the first server export (OD-60) | a convention, as for papers |
| `packages/contracts/src/platform/notification-target.ts:36-42` | `ENTITY_ROUTES` per entity type with a detail route; a notification about a quotation or a line carries its parent's `entityRef` (§8.6) | P2 | links open the inbox instead |
| `settings-inventory.spec.ts:89-103` (64), `SettingsPage.spec.tsx:279-284` (73), `settings-catalog.ts` `SETTING_DEPARTMENTS`, `SETTING_SECTIONS` and `PLACEMENTS` (`apps/web/src/modules/system-admin/settings/lib/settings-catalog.ts:12-32, 43-110`) | module settings; the screen groups keys by department and section, and a key whose first segment names no department it knows is filed under "Other" (`:98-110`) | the first signatory paper (P3; P2 if OD-59 prints PRs, §11.6.5), and again with the policy settings (P4, or P3 under OD-23 A) | counts; rows filed under "Other" |
| `apps/web/src/platform/app/App.tsx` | lazy `/administration/*` mounted above the `/*` catch-all | P1 | routes swallowed by the catch-all |
| `apps/api/src/sync-indexes.models.ts:10-13`; `server.ts`, `worker.ts`; `tsup.config.ts` entries and `package.json` scripts; `operator-cli-safety.spec.ts` (`BOOTING_CLIS`, `:16-22`), `operator-cli-build.spec.ts`, `runtime-import-safety.spec.ts` | `server.ts` and `worker.ts` start a go-live step (IT's precedent, §15.3.7); the module's run model is in `administrationModels`, which `./modules` loads, so `sync-indexes.models.ts` gains no line, unlike IT's (`:12-13`). The other files only for operator CLIs. `BOOTING_CLIS` is a hand list whose completeness test only checks that its five entries are wired to npm scripts (`operator-cli-safety.spec.ts:39-47`): four platform-booting CLIs are already missing from it, and `migrate:org-catalog` is guarded but unlisted. A new CLI is added by hand, as a pull-request checklist item (or the list is derived from `*.cli.ts`, a small platform change) | under OD-68 A, P1a.2 (units, categories, items) and P1b.1 (suppliers), the pull requests that load OD-68's files (§19.8); else P5 under OD-63 B; any migration CLI | `sync-indexes.models.spec.ts:61-74`; nothing fails if a CLI is left off the lists |
| `apps/api/src/org-catalog-migration/references.spec.ts:188-200` | see §15.3.4 | P5 (`inspection.members`, under OD-35 B only), P7 (`team`, OD-50) | the exact `documentArray` list |

`gen-permission-matrix --check` reads platform keys only; module keys need no regeneration.

### 15.3 Migration and data considerations

#### 15.3.1 Phase 1 changes no existing data

Phase 1 creates only new collections and their indexes: `administration_` + `counters` (if OD-05 picks generated
codes), `catalog_items`, `item_categories`, `items`, `warehouses`, `suppliers`, and `go_live_runs` only if OD-68 loads
master data from files (with the first load: P1a.2 for units, categories and items, P1b.1 for suppliers, §19.8). It writes
no row of another module, rewrites nothing and deletes nothing: `it_vendors`, Fleet's workshop rows and IT's stores
stay untouched (OD-01 and OD-02 at their recommended defaults, C and A). Boot writes are class 1 (§15.3.7): the
module seed's create-if-missing rows (counter documents with a `$max` floor, outside any transaction, the Fleet/ATM
idiom; later, file categories and templates), beside the platform's own additive sync — permission-registry upserts and the super-admin key set (`platform/rbac/rbac.service.ts:569-605`), navigation rows and
sections (`apps/api/src/server.ts:60-64`). Two boot writes are not create-if-missing: the permission sync deletes keys no
longer declared (`rbac.service.ts:591`; RK-30), and the module's managed role bundles (D-20) are re-asserted on
every boot, so a key an administrator added to one by hand is removed (`rbac.service.ts:1625-1656`). Master data enters
through the screens, or through an OD-68 load (§15.3.5 d). **Phase 1 needs no data migration.**

#### 15.3.2 The module builds its own indexes

`autoIndex` is off in production (`apps/api/src/infrastructure/database/mongo.ts:143`). The deploy's
pre-step, `db:sync-indexes` (`railway.json`, `deploy.preDeployCommand`), loads every model, the module's included through
`import './modules'` (`apps/api/src/sync-indexes.models.ts:10-11`), and builds what is missing — but only once an operator
sets `INDEX_SYNC_MODE=apply`: it defaults to `report` and builds nothing (`infrastructure/config/env.ts:194`;
`docs/09-guides/railway-deployment.md:164-167`). Whether production has been switched is for Ops to confirm; platform
code says it has not ("the pre-deploy index sync (sync-indexes.cli.ts) runs in REPORT mode there",
`apps/api/src/platform/audit/audit-indexes.ts:4-9`) and builds the audit log's two new indexes at boot for that
reason. Even in apply mode the step cannot be relied on: it exits 0 on every failure and the deploy goes on
(`apps/api/src/sync-indexes.cli.ts:15-22`).

Why the module guards its own writes: a unique index is the only race guard against two rows taking one number or one
name. ECMS code refuses writes until such an index exists (IT's `collectionReady`; the passkey credential index,
`apps/api/src/platform/auth/passkey.model.ts:49-66`) and declines to gate only for non-unique indexes
(`apps/api/src/platform/audit/audit-indexes.ts:18-26`). Therefore (D-16):

- `administration-indexes.ts` lists the module's models and, as the **first** step of `administration.seed.ts`, calls the
  shared `syncDeclaredIndexes('apply', administrationModels)` (`apps/api/src/shared/base/index-sync.ts:338-341`). That
  helper generalizes Fleet's builder (`:12-17`): definitions read from the schemas (`shared/base/index-plan.ts`), one
  index at a time, duplicates reported and never resolved, nothing dropped, and a failure on one index recorded while the
  sync moves on. The module copies no builder: ATM's copy (`atm-indexes.ts:1-3`) has drifted already, its forwarded
  options lacking `expireAfterSeconds` (`atm-indexes.ts:147` against `index-plan.ts:10-16`), and Fleet's logs the
  duplicated key values (`modules/fleet/fleet-indexes.ts:120-140, 185-186`). No module seed calls the shared sync today
  (only `sync-indexes.cli.ts` imports it); modules may import `shared/` (`eslint.config.js:73`). The seed logs the
  returned report through `reportLines` and `reportSummary` (`apps/api/src/shared/base/index-sync.ts:467-529`) and
  holds no state: it refuses nothing. Where the deploy step runs in apply mode, whichever of the two runs second finds
  the indexes present and builds nothing.
- **Fail closed, per collection.** `syncDeclaredIndexes` never throws: a failed build is a line in its report and the
  sync moves on (`apps/api/src/shared/base/index-sync.ts:333-337, 448-450`). So every module repository whose
  collection carries a `ux_*` index declares `readonly ensureCollection = collectionReady(Model)` (the bookkeeping
  models, which have no repository, hold one in their own functions, §2.1 note 10), from
  `shared/collection-ready.ts` (P1a.1), a copy of IT's (`apps/api/src/modules/it/mobile-lines/ensure-collection.ts:18-30`),
  and awaits it before its first write and before any transaction that writes the collection, as IT's store does
  (`apps/api/src/modules/it/consumables/consumable-history.ts:265-278`). The build runs once per process. A failed build
  throws, which refuses that write, and is forgotten, so the next write tries again; reads keep working and boot does
  not fail. The rule covers, each from the pull request that brings it (§19.8): units and categories (P1a.1), items
  and the counter (P1a.2), warehouses (P1a.3), suppliers (P1b.1), and the ledger and balances (P5). The ledger carries
  no `ux_*` index but is held the same way, because it is first written inside the posting transaction, where an
  insert must not be what creates the collection (§2.1 note 10). A module spec covers it (RK-03).
- **First** is a design choice with a reason, not a copied order: a counter's `$max`-floor upsert and the first
  transaction need their unique indexes and collections to exist. Fleet builds last among its migrations, before only
  its memo counter (`fleet.seed.ts:150-155`; `fleet.migration.ts:426-443`); ATM grants super-admin first
  (`atm.seed.ts:32-42`).
- A duplicate that blocks a unique index is reported by collection, index, counts and document ids, never by value (the
  shared sync's rule, `index-sync.ts:32-35`), and boot never fails over it (Fleet `migrateFixedCrewIndex`). It stays
  until an operator removes it (class 3, §15.3.7); until then every write to that collection fails at its
  `ensureCollection` and tries the build again.
- Unique options are settled before the first build, because Mongoose never rewrites an existing index
  (`hr/recruitment/job-offers/code-index-migration.ts:1-12`): never-reused system numbers unique and **not** partial; a
  number given when a document leaves draft (OD-58) partial on `{ number: { $type: 'string' } }`, or the second draft
  fails on `null`; a typed master code partial on `{ isDeleted: false }`.
- A module spec (`administration-indexes.spec.ts`, §19) checks that `administrationModels` equals the collections the
  module's `*.model.ts` files declare; that every declared option reaches `createIndex` is already checked
  platform-wide (`sync-indexes.models.spec.ts:77-91`). An after-boot check in the tests would always pass: they
  run with `autoIndex` on (`mongo.ts:143`).

#### 15.3.3 Workforce-reset classification (OD-64)

`reset:workforce` walks every schema for a path matching `/employeeid/i` (`apps/api/src/workforce-reset/targets.ts:23`)
and refuses to start while one is unclassified (`:133`); the unit spec fails CI on such a path first
(`targets.spec.ts:50-52`). The file's rubric: a record in its own right that happens to name an employee is `keep`, and
`keep` writes nothing, not even to clear the reference (`targets.ts:30-38`). OD-64's recommended default is A, `keep`
for all seven collections below (§2.1). Names omit the `administration_` prefix; the paths are §2's.

| Collection (phase) | Employee path | Recommended (OD-64 A) | Why |
|---|---|---|---|
| `warehouses` (P1a) | `responsibleEmployeeId` (OD-10) | keep | a warehouse is a record in its own right and outlives its keeper (`targets.ts:30-38`). After a reset the keeper id resolves to nobody; the screen flags it until a keeper is named again (OD-64, recommended default: keeper (i); §2.1) |
| `purchase_requests` (P2), `material_requests` (P6) | `requesterEmployeeId` | keep | a need and a spending decision that POs and issues refer to |
| `goods_receipts` (P5) | `inspection.members.employeeId`, under OD-35 B only | keep | a financial record (the gold receipts precedent) |
| `stock_issues` (P6) | `recipientEmployeeId` | keep | movements name the issue in `source.docId`; IT keeps its ledger for that reason (`targets.ts:236-243`). Purging, IT's memo choice (`:193-198`), would orphan ledger sources and add a delete path for posted documents (§15.3.6), so OD-64 B is not the recommendation |
| `stock_returns` (P6) | `returnedByEmployeeId` | keep | as for issues |
| `stock_counts` (P7) | `team.employeeId` (OD-50) | keep | a record about stock |

Every other collection holds no employee path: `items`, `item_categories`, `catalog_items`, `suppliers`, `counters`,
`rfqs`, `quotations`, `purchase_orders`, `opening_balances`, `supplier_returns`, `stock_movements` and
`stock_balances` (`byUserId` is a user id), `stock_transfers` (the carrier is text, OD-46), `stock_count_lines` and
`stock_adjustments` (user ids only), `supplier_invoices`, `finance_handoffs`, `sweep_marks` and `go_live_runs`. Each
`keep` extends the exact untouched list (`tests/integration/workforce-reset.spec.ts:223-243`; `toHaveLength(12)` at
`:361`) in the same PR.

HR's permanent delete («مسح نهائي», `DELETE /hr/employees/:id/purge` under `employee.purge`) reads the same
classification: it deletes the `purge` rows and, on `keep` rows, rewrites copies of the person's name to «موظف محذوف»
(`apps/api/src/modules/hr/employee-management/employees/employee-purge.ts:1-31`). Every path ending in `name` on a `keep`
collection must be classified in `employee-name-copies.ts`, or its spec fails CI (`:235-275`; spec `:30-33`, and
spec `:43-60` pins the whole scrub list); a `scrub` inside a subdocument or array is refused (`:250-261`). So a single
person on a `keep` document carries their name top-level beside their id (D-22), classified `scrub`; names inside
arrays (an approval trail's `deciderName`, a count team) stay nested and are classified `leave`, a recorded gap
(RK-34).

That HR file is the one exception to the rule that modules do not edit each other (§18.1's HR slice for ESS keys).
Like `targets.ts`, `employee-name-copies.ts` is a census of every `keep` collection's name paths, and its spec fails CI
on any path left unclassified (`employee-name-copies.ts:268-275`; `employee-name-copies.spec.ts:30-33`). The
classification therefore travels in the module's own pull request that adds the path, reviewed by HR's owner, rather
than in an HR slice (§18.4). Phase 1 adds no such path: warehouses store no `*name` path (the keeper is resolved at
read time), and their `name` is an inline `{ ar, en }`, whose paths `name.ar` and `name.en` do not end in `name`
(§19.9). Whether a name may stay at all is OD-64's question.

#### 15.3.4 Department references must survive an org-catalog merge

`migrate:org-catalog --merge` repoints only paths whose last segment is exactly `departmentId` (an ObjectId, at any
depth) or ends in `DepartmentIds` (`apps/api/src/org-catalog-migration/references.ts:51-54`). `Schema.Types.Mixed` is
invisible to its schema walk: it reads and refuses only two named carriers, `hr_announcements` and
`hr_notification_rules` (`:10-16, 178-201`), so an org id inside `Mixed` anywhere else silently keeps pointing at a
retired department (RK-31). So every department reference is named `departmentId` (the branch copy, ADR-031) — never
`requestingDepartmentId`, `toDepartmentId` or `departmentIds` — and no org id goes into `Mixed` (§2.1, §7.7). Scalar
sub-document paths such as `recipient.departmentId` are swept like any other. A `departmentId` inside an **array** of
sub-documents becomes a new `documentArray` path and changes the exact list `references.spec.ts:188-200` pins (four
today): `goods_receipts.inspection.members.departmentId` (P5, under OD-35 B only) and
`stock_counts.team.departmentId` (P7, OD-50), both from `PersonSnap.departmentId` (§2.1), and PR lines per department if OD-25 ever allows them. The
alternative, a `PersonSnap` held in an array without `departmentId`, is §2's choice to make.

#### 15.3.5 Future migrations and loads — each one separately approved

Migrations follow ADR-031's discipline (`docs/03-decisions/ADR-031-org-units-defined-once-declared-per-branch.md:62-73`;
`apps/api/src/migrate-org-catalog.cli.ts:1-50`): an operator-run CLI; a **dry run by default** printing the whole plan;
`--write` applies exactly that plan; rows merge only where a human names them (`--merge LOSER=WINNER`); refusal rather
than half-application; **never at boot** (class 3, §15.3.7). The CLI calls `assertLoginProvisioningDisabled()` before
`bootPlatform` and is added by hand to the operator-CLI lists (§15.2.3), where nothing fails if it is forgotten.
Go-live loads (c, d) are class 2, not migrations. A boot-time repair is class 1 only if it keeps Fleet's rules: nothing
deleted, nothing invented, re-running changes nothing (`modules/fleet/fleet.migration.ts:1-12`).

**a. Supplier registry merge (OD-01 B, or the second stage of C).** IT's design records the debt as "merge rows into a
platform registry, re-point `workshopId`/`vendorId`, alias module endpoints through a deprecation window"
(`docs/12-planning/it-module-design.md:1510`, §16 P4: "the only one needing a data migration", two to three slices).
This design departs from it in two flagged places: the target follows OD-01 (B: a platform registry; C's second stage:
`administration_suppliers` behind the PC-3 seam), and a distinct row keeps its ObjectId instead of being re-pointed
(OD-01's recommendation). It is two operations:

- **Move, with no rewrite.** A row with no duplicate keeps its `_id`, so `it_assets.purchase.vendorId`,
  `it_assets.warranty.vendorId`, `it_licenses.purchase.vendorId`, `it_maintenance_orders.vendorId` and
  `fleet_maintenance_visits.workshopId` (required; about 1,800 legacy visits, `fleet/go-live/maintenance.ts:1`) resolve
  unchanged. Audit rows and event payloads naming old ids are never edited.
- **Merge, with re-pointing.** Near-duplicates collapse only by `--merge LOSER=WINNER`, as ADR-031's catalog merge does.
  The loser's id is retired, so every IT and Fleet row naming it is re-pointed by the operator CLI itself, the way
  `migrate:org-catalog` re-points every module's departments, and the loser stays soft-deleted as a tombstone that names
  its winner, so audit rows and payloads that keep the old id still resolve (the tombstone's field is named when that
  merge is designed).
- Shapes differ: IT has a string `name`, contacts and `ux_name` (`it/vendors/vendor.model.ts:37, :50-53`); workshops have
  `{ar,en}` names, no contacts and Fleet's raw-name `ux_kind_name_ar` (`fleet/catalogs/catalog-item.model.ts:64-67`),
  where this module's suppliers fold the name under `ux_name_key` (§2.3.6).
- A fourth list exists: Fleet's vehicle supply contracts name their supplier as free text, with no id, and
  list the distinct names (`apps/api/src/modules/fleet/vehicle-contracts/vehicle-contract.model.ts:65, 118`;
  `vehicle-contract.repository.ts:173-176`). It cannot move by id: joining it takes a human-named name → supplier map in
  the operator CLI and a Fleet slice that stores the id instead. Whether it joins is OD-01's.
- One writer per collection: IT and Fleet switch validators and pickers to the seam (PC-3) in their own slices, with a
  deprecation window for `/it/vendors`; no module writes another's collections, and only the operator CLI re-points,
  under §15.3.7. The source rows are retired only after IT and Fleet have switched to the seam (§20).
- Whether insurers, fuel-card companies and the traffic authority join is part of OD-01 (recommended default: (i), they
  stay where Fleet keeps them).

**b. IT stores into Warehouses — only if OD-02 B.** It needs a design revision and an ADR first. ADR-024 already names
the boundary for spare parts: receipts become Procurement's output, "the movement shape does not change, only who writes
it", and on-hand may become Warehouses' number while IT keeps its ledger
(`docs/03-decisions/ADR-024-minimal-spare-parts-ledger.md:40-52`). Consumables (IT's requirement FR-20,
`docs/12-planning/it-module-design.md:1142`) are a separate ledger with no such clause (`it/consumables/consumable.model.ts:1-12`). A move must carry: per-branch `CON-` rows
(`it/consumables/consumable.model.ts:4-9`) becoming one item master through a human-named merge; «بدل تالف» moving
three counters in one row, so `scrappedQty` ≠ Σ scrap rows (`consumable-stock.ts:45-62`); memo lines'
`consumableId`/`movementId` still resolving; also each transfer pair's `transferId`, `counterpartBranchId`
and `counterpartConsumableId`, and the same-name `CON-` rows a transfer creates in the receiving store
(`apps/api/src/modules/it/consumables/consumable-movement.model.ts:91-100`; `apps/api/src/modules/it/consumables/consumable-transfer.service.ts:161-196`); a warehouse for spare parts; IT's FR-5 asset-delete guard
(`docs/12-planning/it-module-design.md:1059`; `it/assets/asset.service.ts:387-393`, which now also refuses an asset that a corrected issue once named, through the movement's `installedOnBefore`) and the `it.sparePart.belowMin` trigger intact. The recommended OD-02 (A now; C
when Procurement buys for IT, OD-65) needs no migration: under C a GRN reaches IT as a reliable event (§15.4).

**c. Opening balances at go-live (OD-63).** A load through the ledger, not a migration (class 2, §15.3.7). Recommended
default (OD-63 A): the in-app `OpeningBalance` document (`OB-`, movement kind `openingBalance`), one per warehouse,
posted by a second person (§4.3.1; a §6.6 candidate pair). Its legs are stamped at posting like every other leg (`at`
is the posting instant); its `asOfDate` is the counted date, a Cairo date no later than today, stored and printed,
never the movement's `at` (§2.6). Its movements carry `unitCostMinor` and `currency` (OD-37, recommended default: A,
quantities with the cost captured on receipts and openings). OD-63 B adds a deploy-time go-live file in the IT shape
(`it/go-live/consumables-opening.ts`: versioned run key `:77-78`, rows validated with the screens' own schemas, refusal
when a warehouse is missing, the run row in `administration_go_live_runs` written last, audit after commit; wiring in
§15.2.3). As in IT, the file loads in one transaction: each warehouse's opening is its own document, within the line
cap §2.1 sets for an opening balance, and the documents, their movements and counters and the run row commit together,
so a refused file loads nothing (§4.3.1 (a), §15.3.7). Balances are never written directly: Fleet's fuel-card import
set `balance` with no movement (`fleet/go-live/fuel-cards-import.ts:161-178`). An opening is the first movement of its
(warehouse, item) row (`lastMovementAt: null`, §2.4.4; §4.3.1), refused otherwise with
`ADMINISTRATION_OPENING_BALANCE_NOT_FIRST`, and a posted OB cancels only as a draft (§5.7), so a wrong opening is
corrected by a stock adjustment: §18.1 A11 recommends shipping adjustments in P5; if they stay in P7, the owner accepts
the P5–P6 gap in writing.

**Go-live order.** A procedure, not a guard: at go-live, post each warehouse's opening balance before its first other
posting (a GRN, an issue return, an inbound transfer leg). An opening-balance line on a row that has already moved is
refused (`ADMINISTRATION_OPENING_BALANCE_NOT_FIRST`); that row takes its opening stock through an approved
`adjustmentIn` instead (§18.1 A11: P5 under the recommended answer); if adjustments stay in P7, A11 lists this case among the gaps the owner
accepts in writing.

**d. Legacy master data (OD-68).** If lists exist (recommended default: A, the owner sends files and a one-time
versioned load follows, with `go_live_runs` in the first pull request that loads: P1a.2 for units, categories and
items, P1b.1 for suppliers), the precedents are the screens, a reviewed go-live file (class 2), an operator CLI in the
workforce-import shape, or an in-app preview/apply import in the ATM register shape (file SHA-256, per-row outcome,
unique import-row index; OD-68 C, which adds a collection of import runs and their rows, §4.3.1). Recommended: supplier
contacts' phones, e-mails and tax numbers never go into a committed file, because git history keeps it forever,
although Fleet's and IT's earlier go-live files do commit people's data (`apps/api/assets/fleet-go-live/`,
`drivers.json`; `apps/api/assets/it-go-live/mobile-lines-2026-10.json`). IT's newest one keeps people out by design:
"NOBODY IS IN THE FILE" (`apps/api/src/modules/it/go-live/branch-custody-import.ts:22-23`;
`apps/api/assets/it-go-live/branch-custody-2026-11.json`). Under OD-68 A those fields are typed in-app after the load;
a file the operator supplies at run time and never commits fits only the operator-CLI shape.

**e. A change to the name fold.** Master-data rows store `nameKey`, the contracts fold of `name.ar` (PC-13), under
unique indexes such as `ux_name_key` (§2.1, §2.3). A later change to the fold recomputes every stored `nameKey` by a
separately approved operator migration (class 3, §15.3.7), never at boot; its dry run lists the rows whose key changes
and any two live rows that would then share one key, which a person merges or renames before `--write`.

#### 15.3.6 Retention

What exists: the audit trail is never purged (`platform/audit/audit.retention.ts:1-3`); activity logs are purged after
`audit.retention.activityDays` (at least 365, default 730, `platform/audit/audit.settings.ts:9-16`); outbox rows are
never deleted and `processed_events` expire after 30 days (`platform/kernel/outbox.model.ts:44`); file categories carry
a `retentionDays` that no job reads (`platform/files/file-category.model.ts:22`). This design adds no delete path for
movements or documents (D-2): nothing is deleted over HTTP, and a draft ends as `cancelled` (§2.1). How long documents
and attachments (quotations, invoices, signed copies) must be kept is a legal and Finance policy: **OD-77** (recommended
default: A, keep everything, `retentionDays: null`; then B once Finance names the periods). If procurement papers and
store papers get different periods, `administration-signed-papers` splits before its first store paper (P5), and
preferably before P3 (§11.2).

#### 15.3.7 Three kinds of data write, and who approves each

| Kind | What | When it runs | Approved by | Rules |
|---|---|---|---|---|
| 1. Boot-safe | index builds (§15.3.2); create-if-missing seeds (counters with a `$max` floor, file categories, templates); the platform's own syncs; managed roles (D-20); repairs that only add | every boot (§15.1) | the pull request's review | Fleet's three rules: nothing deleted, nothing invented, re-running changes nothing (`modules/fleet/fleet.migration.ts:1-12`); duplicate-key tolerant, because seeds run concurrently (RK-28) |
| 2. Go-live loads | OD-63 B's counted opening file; OD-68's master-data load when it comes as a file | once per versioned run key, started by the deploy (IT's precedent: `server.ts:149` and `worker.ts:115` start `startItConsumablesOpeningGoLive`) | the owner, on the file itself, reviewed jointly in its pull request ("reviewed with the owner", `it/go-live/consumables-opening.ts:4`) | rows validated with the screens' schemas; refusal rather than a partial load; the run row written last; audit after commit. Recommended for OD-63 B's counted opening file, where a wrong quantity is the costly mistake (OD-68's master-data load follows IT's steps, which have no such mode): the first deploy only reports what it would load, behind an environment switch, as `INDEX_SYNC_MODE` does for indexes (`infrastructure/config/env.ts:194`), standing in for class 3's dry run |
| 3. Migrations and merges | the supplier merge (§15.3.5 a), IT stores (b), a change to the name fold (e), any backfill or destructive operation | operator CLI only; never at boot, never as a side effect of a feature slice (D-17) | the owner, on the production dry run's output | ADR-031's discipline (§15.3.5) |

No class-3 operation runs against production without the owner's explicit approval of its dry-run output (D-17). The
dry run can only run on the deployed image (`migrate-org-catalog.cli.ts:9-15`), after the pull request that ships the
CLI has merged, so the approval is dated and recorded with the owner's words in the decision log (§16.12), with the
output attached, before `--write`, and the pull request links to it. Recommended operator practice: a database snapshot immediately before
`--write`.

### 15.4 Other modules affected

| Module | What changes | Trigger | Done by |
|---|---|---|---|
| IT | Nothing in P1–P4 beyond PC-13's move of `foldName` (below) (OD-02, recommended default: A now). ADR-024's boundary is the precedent for OD-02 C: a received purchase order writes the receipt movement, whose shape does not change, and on-hand may become Warehouses' number while IT keeps its ledger (`docs/03-decisions/ADR-024-minimal-spare-parts-ledger.md:40-52`); the clause covers spare parts only, not consumables (FR-20). Under OD-02 C or OD-65 B a GRN reaches IT through the reliable `administration.goodsReceipt.posted` event (§8.2), which IT turns into its own receipt movement or asset; PC-1 lands first. IT movements carry internal references (consumables `memoId`, `assetId`; spare parts `orderId`) but no external GRN or PO source (`it/consumables/consumable-movement.model.ts:59-100`, `it/spare-parts/movement.model.ts:9-16`), and IT's receive services rely on route guards, so IT adds both. Vendor validators (`asset.service.ts:116-134`, `license.service.ts:100-104`, `maintenance/order.service.ts:92-103`) switch only with the §15.3.5 a merge. Whether a received device becomes an IT asset is OD-65 (recommended default: A in P5, IT registers devices by hand; B, the event, as a later IT slice). | OD-01, OD-02, OD-65 | IT slices |
| Fleet | Workshop references re-point only with the merge (`fleet/maintenance/maintenance.service.ts:138, 271, 431`, `fleet/maintenance/maintenance.repository.ts:535-558`, go-live imports, `FleetMaintenancePayloadV1.workshopId`). The custody fund, and the parts it buys outside any stock record, stay as they are until OD-66 (recommended default: A for v1, B, planned buys through PR and PO, as the target; never a second petty-cash system). | OD-01, OD-66 | Fleet slices |
| HR | No HR code in P1 (directory reads only). From P2 the module's own pull requests classify each `*name` path they add on a `keep` collection in HR's `employee-name-copies.ts`, reviewed by HR's owner (§15.3.3). P6, under OD-44 (recommended default: A, cancel the leaver's drafts and flag holdings only under OD-15 B; per act (i)): an `hr.employee.exited` subscription that only flags, the IT precedent (`it/it.module.ts:582-608`). The event is in-process and emitted before the employee is saved, carrying `effectiveDate` (`hr/employee-management/employee-actions/employee-action.service.ts:771-780`), so a draft cancellation runs from a daily sweep that reads the directory (status `exited`, effective date on or before the Cairo date), never from the event (RK-05). The cost-center seam (PC-2) if OD-41 C; self-service keys if OD-16 or OD-38 chooses ESS (recommended defaults: A, department focal points, no ESS), in an HR slice that keeps the four ESS declarations in agreement (`modules/hr/ess-grants.spec.ts`). HR notification rules see every cataloged `administration.*` event automatically. | OD-16, OD-38, OD-41, OD-44 | HR + platform |
| Gold, Fleet, IT (web) | Shared web pieces move to `apps/web/src/shared/` in their own pull requests, outside the module, before their first use (§18.1): PC-10 is done (`EGYCASH_LOGO` lives in `@ecms/contracts/egycash-logo`, §11.6.3); PC-11, the export walk and buttons and the company report form (`fleet-report-print.ts`, `fleet-sheet.ts`, `whole-catalog.ts`, `RegisterExportButtons.tsx`), of which the module is the next consumer, before the first client export (§11.7). The `xlsx-writer.ts` and `paper-fonts.ts` moves are the precedent. | the first paper (P2 or P3); the first client export (P2, or P1 on request) | web refactor pull requests |
| Operations, ATM, Automation | Operations and Automation: none. ATM: PC-12 writes its branch-scope rule and its organization-scope check once in `apps/api/src/shared/base/` (§15.2.2); ATM keeps its exported names as thin wrappers over them, and its active-branch loader, so ATM's callers do not change. The Finance seam is not a module-local port in the shape of `operations/treasury-boundary.ts`, whose weaknesses §12.6 lists, but a platform seam, `apps/api/src/platform/finance-handoff/` (directory-seam pattern, conformance spec), built with its first consumer (OD-55; §12.11). ATM seal stock waits for ATM's S-8 (c), seal-stock issuing on its Control & Supplies page, not requested (`docs/12-planning/atm-settlements-phase1.md:146`) (OD-03). Cataloged events become automation triggers once `AUTOMATION_ENABLED` is on. | PC-12, one pull request before P1a.1 | a platform pull request (PC-12) |
| IT, Fleet, ATM (PC-13) | IT's `foldName` moves to `packages/contracts/src/common/`, and IT's three importers and its spec read it from there (§15.2.2); its behavior does not change. Fleet's and ATM's counters keep their copies; moving them onto PC-13's factory is listed with the cross-module findings (`docs/10-reviews/2026-11-administration-design-cross-module-findings.md`, §21), not this design's work. | PC-13, one pull request before P1a.1 | a platform pull request (PC-13) |

### 15.5 Decisions and prerequisites per phase

§16 is the single source for which decision gates which phase (§16.2 for Phase 1, §16.3 for the later phases), and
§18.1's cross-cutting prerequisites table for what else each phase waits for outside the module.

---

## 16. Open business decisions

This register holds every business decision the design waits on, with the questions the other sections raise. **A
recommended default is a proposal, not a rule**. On 2026-11-24 the owner took every recommended default as the working
answer and answered OD-68 B (§16.12); a later answer replaces a default by revision (§22).

### 16.1 How to read the register

- **Phase** (in each heading): the earliest phase whose code needs the answer, or the owner's adoption of the default.
  The phases are §18's: P1a (master data) and P1b (suppliers) make Phase 1; PX-1 (approvals hardening, before P2), PX-2
  (sweep marks, conditional) and PX-3 (CI capacity, before P5) are platform slices; then P2…P9. A heading also names a
  later phase that applies part of the answer.
- **Impact**: what an option changes (data model, keys, lifecycle edges, the sections it touches, risk) and its
  effort: S inside the phase, M an extra slice, L a platform change or data migration.
- **Ids**: OD-01…OD-85. The entries are grouped by subject (§16.5–§16.11), so their numbers do not run in order;
  OD-66 and OD-67 are the ids §0 uses. An entry may hold sub-questions, each with its own options and recommended
  default. Where an entry's sub-questions would reuse option letters, each has an id of its own: OD-28.1…OD-28.4,
  OD-47.1…OD-47.4, OD-60.1, OD-60.2 and OD-62.1.
- **Answers**: by id (for example: موافق على OD-05 كما هو, or another option), a sub-question by its id where it has
  one ("OD-47.2 A"); an answer that names no sub-question adopts the entry's recommended defaults for all of them. Each
  answer is dated and recorded with the owner's words in the decision log (§16.12). An answer that changes a name this
  design fixes (a key, a field, an entity type) is a new revision (§22).

### 16.2 Blocks P1

§0's start gate means this table: Phase 1 code starts once the owner has answered each decision below or adopted its
default. Two more decisions gate the start without shaping code: OD-81 settles, before P1a.1, whether Phase 1 ships
as several pull requests (§19.1), and OD-03 names the item families entered on staging, which the owner's acceptance
needs (§19.10), not the code. OD-80 (a pilot branch or all branches) is needed only before the module's roles are
assigned in production (D-19), not before code. OD-83's default is applied unless the owner objects. Phase 1 has no
export unless the owner asks for one (OD-60.1). A non-recommended answer to a row below re-opens Phase 1 for the parts
it names (§19.2).

| OD | Decision | Recommended default | Phase 1 code it shapes | Phase 1 part |
|---|---|---|---|---|
| OD-01 | supplier registry | C: module-owned; a platform seam later | `administration_suppliers` | P1b |
| OD-04 | who maintains master data | A: central, organization scope | write authority (`assertAdministrationOrgAuthority`) | P1a, P1b |
| OD-05 | master-data codes, barcodes | A: generated `ITM-`/`SUP-`, typed short codes elsewhere; one item per barcode | counters, allocators, indexes | P1a, P1b |
| OD-06 | category depth | A: two levels; new items name the subcategory | categories, item rules | P1a |
| OD-07 | units | A: one base unit per item | unit list, items | P1a |
| OD-08 | decimal quantities | A: integers | quantity types | P1a |
| OD-09 | stock levels | C, starting with A: on the item, compared per warehouse | item schema (the comparison runs from P5) | P1a |
| OD-10 | warehouses | A: several per branch; keeper accountable, from P1a; department reference-only | warehouse schema (who may post: P5) | P1a |
| OD-11 | supplier fields | A: no bank data; papers filed; a repeated tax number warns | supplier schema, papers | P1b |
| OD-12 | supplier status | A: `active`/`inactive` | supplier lifecycle | P1b |
| OD-62 | names and menu | A: «الشئون الإدارية» / Administrative Affairs; tile picture OD-62.1 A, a box | navigation seed, pins, the launcher tile's glyph | P1a |
| OD-64 | workforce reset | A: `keep`; a keeper who no longer resolves is flagged | reset classification (a CI gate, §2.1) | P1a |
| OD-67 | vocabulary | B: the owner's words | labels; the titles of the roles OD-78 seeds, written once, when each role is created (§6.5) | P1a, P1b |
| OD-68 | legacy sources | answered B, typed by hand for now (§16.12; the recommendation was A, port the owner's files) | field set, data load | P1a, P1b |
| OD-76 | file formats, if OD-11 keeps supplier papers | A, formats (i): PDF and images | the supplier-papers category | P1b |
| OD-77 | retention, likewise | A: keep everything (`retentionDays: null`) | the same category | P1b |
| OD-78 | ready-made roles | A: §6.5's bundles as ready-made roles | module seed | P1a, P1b |
| OD-83 | page frame | B: board frame on registers, applied unless the owner objects (the owner's frame in Fleet, ATM, IT, System Administration) | the P1a.W and P1b.W pages | P1a, P1b |

A file category's rules are fixed when `ensure()` first creates it, so a later answer to OD-76 or OD-77 reaches the
supplier-papers category only through an operator `PATCH` (§11.1).

### 16.3 Blocking later phases

This is the gate list from PX-1 onward; §15.5 links to it rather than copying it, and §18.3's exit criteria name only the decisions they depend on. "Answer first"
holds each entry once, at its heading's phase. "Also applied" names entries answered earlier, or needed here only under
one option, that the phase applies in a new place. The §6.6 pairs OD-21 adopts are enforced phase by phase (§18.3).

| Phase | Answer first | Also applied |
|---|---|---|
| PX-1 approvals hardening (before P2) | OD-19, OD-20 | — |
| P2 purchase requests | OD-14, OD-16, OD-17, OD-21, OD-26, OD-28, OD-57, OD-58, OD-60, OD-61, OD-69, OD-71, OD-72, OD-82 | OD-19, OD-20 (P2 ships OD-20 B's stopgaps only if PX-1 is deferred); OD-64 (names on kept records, from P2); OD-76, OD-77 (the request-attachments category, unless OD-11 A filed supplier papers in P1b) |
| P3 RFQs and quotations | OD-22, OD-23, OD-24, OD-25, OD-29, OD-30, OD-31, OD-59, OD-73 | OD-18's thresholds under OD-23 A; OD-60 (the first server export); OD-76, OD-77 (the quotation and signed-paper categories) |
| P4 purchase orders | OD-18, OD-27, OD-56, OD-66 | OD-23 (per-band minimum), OD-26 (PO revisions, under B), OD-29 and OD-30 (document discount, rounding), OD-31, OD-59 (the PO paper), OD-60 |
| PX-3 CI capacity (before P5) | — | — (the CI split is D-18, not an owner decision) |
| P5 receiving and ledger | OD-02, OD-32, OD-33, OD-34, OD-35, OD-36, OD-37, OD-53, OD-63, OD-65, OD-70, OD-74, OD-79, OD-84, OD-85 | OD-09 (the comparison basis), OD-10 (who may post), OD-52 if §18.1 A11 brings adjustments into P5, OD-60 |
| P6 requests and issues | OD-15, OD-38, OD-39, OD-40, OD-41, OD-42, OD-43, OD-44, OD-75 | OD-28.1, OD-28.2 (MR cancellation) |
| P7 transfers, counts, adjustments | OD-45, OD-46, OD-47, OD-48, OD-49, OD-50, OD-51, OD-52 | OD-78 (the count team's found line) |
| P8 invoices and Finance | OD-13, OD-54, OD-55 | OD-60 |
| P9 dashboard and reports | — | OD-13 (supplier KPIs), OD-61 (digests; PX-2 if marks are needed) |

### 16.4 Settled by design or outside this module

D-1…D-22 (§0.3), §13.6 (digits), §14.1 (out-of-reach branches) and §14.8 (Cairo calendar) settle the technical
questions. The two below also follow a precedent; the owner may overturn either:

| Question | Settled as | Precedent |
|---|---|---|
| What `own` means on requests | the requester sees their own PRs and MRs (§7.3) | IT tickets: "a requester always sees their own tickets" (`apps/api/src/modules/it/tickets/ticket.repository.ts:13-15`) |
| Filing a stock document with «الشركة كلها» selected | the user picks the warehouse; the warehouse's branch files the document (§7.5) | Gold: "The key follows the DRAWER's branch, not the operator's" (`apps/api/src/modules/gold/keys/key-handover.service.ts:94-95`). IT: a movement copies its item's store branch (`apps/api/src/modules/it/consumables/consumable-history.ts:231-246`), and a memo is filed in its items' store, with items from two stores refused (`apps/api/src/modules/it/consumables/consumable-issue.service.ts:205-211, 412`). Gold's switcher-based `resolveCreateBranchId` (`apps/api/src/modules/gold/shared/ecms-refs.ts:82-95`) is not used |

Fleet's own cash fund raises further questions. This design keeps that fund unchanged until OD-66 (§0.2), so these
questions belong to their owners and are recorded here so that none is lost. Two others map to entries:
whether insurers, fuel companies and the traffic authority are suppliers is OD-01, and whether licensing fees move to
Administrative Affairs is OD-66.

| Question | Owner | Where it touches this design |
|---|---|---|
| Are dealership invoices supplier invoices to be handed to Finance? | Fleet, with Finance | OD-54, only if OD-66 B routes dealership buys through POs |
| Is a fuel-card top-up a payment to the fuel company or an internal allocation, and must its requester differ from its approver? | Fleet, with Finance | — |
| Which cost center does a vehicle's spend belong to? | Fleet, with Finance | D-CC-3 lets only employees carry a center (OD-41) |
| Does Finance approve the fund's replenishment and settlement, and is «تسوية» a write-off? | Finance | — |
| Who may correct a fund operation, and by what reversal? | Fleet, answered in 2026-11: no reversal entry; «حذف العملية» soft-deletes the operation with a reason under `fleetReceipt.delete`, frees what it claimed, logs the fund before and after and has no restore; a held replenishment is confirmed or cancelled instead (`apps/api/src/modules/fleet/custody/custody-fund-delete.ts:1-29`; `custody-fund-hold.ts:1-9`; `custody-fund.routes.ts:132-138`) | — |

### 16.5 A — Ownership and boundaries

#### OD-01: Supplier registry ownership (P1b)
- **Q** Who owns the supplier list, do IT vendors and Fleet workshops move into it now, and do other external parties
  belong in it? Arabic: من يملك سجل الموردين؟ وهل يُضم إليه موردو التقنية وورش الحركة الآن؟ وهل تدخل فيه شركات التأمين
  وشركات الوقود؟
- **Evidence** IT's plan: "Procurement owns the concept; extracting earlier buys nothing"
  (`docs/12-planning/it-module-design.md:1510`). Fleet workshops are name-only catalog rows
  (`apps/api/src/modules/fleet/catalogs/catalog-item.model.ts:1-3, 18-39`; `packages/contracts/src/modules/fleet.ts:55-56`),
  which maintenance visits cite by `workshopId` (`apps/api/src/modules/fleet/maintenance/maintenance.model.ts:15, 50`).
  Fleet also keeps insurers as a catalog kind (`fleet.ts:68`) and its two fuel companies as a code constant
  (`fleet.ts:3637`); whether they, and the traffic authority, are suppliers is asked below. Fleet's vehicle supply
  contracts «عقود توريد السيارات» name their car suppliers as free text, filtered by distinct name
  (`apps/api/src/modules/fleet/vehicle-contracts/vehicle-contract.model.ts:65, 118`; `vehicle-contract.routes.ts:51-52`).
- **Options** **A** module-owned; IT and Fleet untouched (S; a third copy persists). **B** a platform registry now, with a
  staged migration (L; ADR; delays P1b). **C** module-owned now, a platform lookup seam later, migration only on an
  owner GO (S, then M; §15.3.5).
  - *Other external parties:* **(i)** insurers, fuel companies and the traffic authority stay where Fleet keeps them; a
    later merge stage may bring them in (S). **(ii)** they join the supplier list now (M; they supply no goods to the
    stores, and Fleet's references would re-point, an operator migration under D-17).
  - *Fleet's vehicle suppliers* (free text): **(i)** they stay text in Fleet until a merge stage (S; a
    fourth list, RK-18). **(ii)** the merge maps each distinct name to a registered supplier through a human-named list,
    and Fleet stores the id (M; a Fleet slice and an operator step, §15.3.5 a).
- **Recommendation** C, on the directory-seam pattern (`apps/api/src/platform/directory/index.ts:1-11`); a merge keeps
  ObjectIds (§2.3.6). Other parties: (i). Fleet's vehicle suppliers: (i).

#### OD-02: IT stores and Warehouses (P5)
- **Q** Do IT's two registers stay with IT, merge into Warehouses, or receive Procurement's GRNs? Arabic: هل يبقى
  مخزنا التقنية لديها أم ينتقلان إلى المخازن؟
- **Evidence** IT keeps two registers: spare parts, one organization-wide store with no branch field
  (`apps/api/src/modules/it/spare-parts/part.model.ts:9-16`; `part.repository.ts:9`), and consumables, one store per
  branch: "The branch IS the store" (`apps/api/src/modules/it/consumables/consumable.model.ts:4-9`). ADR-024 hands the
  spare-parts ledger's receipts, and perhaps its on-hand, to Procurement and Warehouses
  (`docs/03-decisions/ADR-024-minimal-spare-parts-ledger.md:15-19, 40-52`); consumables borrowed only its counter rule
  (`consumable.model.ts:14-17`).
- **Options** **A** coexist, each item in one ledger (S). **B** merge; IT reads on-hand through a port (L; a migration
  that keeps «بدل تالف», `apps/api/src/modules/it/consumables/consumable-stock.ts:33-62`). **C** a GRN writes IT's
  `received` movement by reliable event (M; IT-side change).
- **Recommendation** A now, C when Procurement buys for IT (OD-65). By analogy with BD-005's "shared pattern, separate
  entities" (`docs/01-domain/business-decisions.md:100-107`), which was written for cash and gold custody.

#### OD-03: Item families in scope (P1a data entry; no code)
- **Q** Which kinds of goods will the warehouses hold? Arabic: ما أنواع الأصناف التي تديرها المخازن (مكتبية، نظافة،
  ضيافة، أثاث، زي، مطبوعات)؟
- **Evidence** No non-IT stock exists. Fleet keeps a name-only spare-parts catalog (`sparePart`,
  `packages/contracts/src/modules/fleet.ts:58`), recorded on maintenance visits (`sparePartIds`,
  `apps/api/src/modules/fleet/maintenance/maintenance.model.ts:27, 53`), outside any stock. ATM: "Seal stock (c) is not
  requested" (`docs/12-planning/atm-settlements-phase1.md:146`).
- **Options** **A** the owner lists families; categories follow (no code). **B** an open list (S; sprawl). **C** office
  and cleaning only (S; later families need categories).
- **Recommendation** A. ATM seals and vehicle parts wait for ATM's S-8 (c), seal stock, which ATM's plan records as not
  requested (`docs/12-planning/atm-settlements-phase1.md:146`), and OD-66; IT's families stay in IT's ledgers
  (OD-02 A).

#### OD-04: Who maintains master data (P1a, P1b)
- **Q** Who maintains items, categories, units and suppliers: a central team or each branch's keeper? Arabic: من
  يعرّف الأصناف والموردين: جهة مركزية أم أمين مخزن كل فرع؟
- **Evidence** No delegate passes an organization-scope check such as `assertAtmSettingsManager`
  (`apps/api/src/modules/atm/shared/settings-authority.ts:12-20`), because a delegated grant is department or branch
  scope, never organization (`apps/api/src/platform/rbac/rbac.service.ts:304-313`). Per-branch master rows are the
  ADR-031 lesson (RK-12).
- **Options** **A** central: item, catalog and supplier write keys at organization scope, checked by
  `assertAdministrationOrgAuthority` (S; one taxonomy). **B** branch keepers (S–M; duplicates; a new owning-branch field
  on every master collection, §2.3, checked with `keyReachesBranch`; a merge tool later). **C** central, branches
  request new items (M; a request queue). Under every option, `own`, `section` and `department` grants never write
  master data (§6.7).
- **Recommendation** A (§6.7), the ATM settings-authority precedent.

#### OD-65: IT goods bought through Procurement (P5)
- **Q** Which IT purchases become stock, and does a received device become an IT asset? Arabic: ما الذي يدخل المخازن
  من مشتريات التقنية؟ وهل يُسجَّل الجهاز أصلًا عند استلامه؟
- **Evidence** RAM and disks are IT consumable types (`apps/api/src/modules/it/go-live/consumable-type-defaults.ts:36-48`);
  a device is one `it_assets` row with custody intervals (`apps/api/src/modules/it/assets/assignment.model.ts:87-95`).
- **Options** **A** IT's GRN lines post no stock; IT registers devices by hand (S; double entry). **B** a reliable GRN
  event IT turns into assets or receipts (M; IT-side, idempotent by GRN line). **C** devices stocked until issued
  (rejected: a second count of registered devices).
- **Recommendation** A in P5, B as a later IT slice: IT owns devices and their custody (ADR-021), so no second custody
  chain exists (§4.4).

#### OD-66: Fleet spend and Procurement (P4)
- **Q** Which Fleet purchases go through Procurement, are vehicle parts stock, who owns Fleet's cash fund, and do
  licensing fees move to Administrative Affairs? Arabic: ما مشتريات الحركة التي تمر بالمشتريات؟ وهل قطع الغيار أصناف
  مخزنية؟ ومن يملك عهدتها النقدية؟ وهل تنتقل رسوم الترخيص إلى الشئون الإدارية؟
- **Evidence** Fleet runs one imprest fund (`apps/api/src/modules/fleet/custody/custody-fund.service.ts:93`); tires and
  «صيانة» are receipts from it (`apps/api/src/modules/fleet/custody/custody-dashboard.spec.ts:3-5`), outside any stock or
  purchase record. Fleet's parts are a name-only catalog (`packages/contracts/src/modules/fleet.ts:58`) recorded on visits
  (`apps/api/src/modules/fleet/maintenance/maintenance.model.ts:27`). Fleet also records the cars it buys as vehicle
  supply contracts «عقود توريد السيارات», outside any request, approval or PO: a free-text supplier, makes and
  counts with unit prices, a deadline and deliveries
  (`apps/api/src/modules/fleet/vehicle-contracts/vehicle-contract.model.ts:1-11`).
- **Options** **A** Fleet unchanged; parts not stock (S; consumption invisible). **B** planned buys above an owner
  threshold go PR → PO; emergencies stay on the fund (S; policy). **C** parts become stock issued to vehicles (L; a new
  issue target, and Fleet's parts catalog reconciled into items with its ObjectIds kept).
  - *Licensing fees:* **(i)** they stay with Fleet (S; fees paid to an authority are not purchases). **(ii)** they move
    to Administrative Affairs (M; outside this design's scope, §0.1).
  - *Vehicle supply contracts:* **(i)** they stay Fleet's register (S; cars never enter stock, and the supplier stays
    free text, RK-18). **(ii)** vehicle purchases go PR → PO, as non-stock lines (OD-14), to a registered supplier (L;
    Fleet's contracts and deliveries re-pointed by an operator migration under D-17).
- **Recommendation** A for v1, B as the target; never a second petty-cash system. Licensing fees: (i). Vehicle supply
  contracts: (i).

#### OD-69: Organization-wide acts, delegation and override (P2)
- **Q** Which acts are held only organization-wide, may any approve key never be delegated, and may `approval.override`
  decide administration approvals, and on which bands? Arabic: ما الصلاحيات المقصورة على مستوى الشركة؟ وهل من اعتماد
  لا يجوز تفويضه؟ وهل يجوز الاعتماد بصلاحية التجاوز، وفي أي الشرائح؟
- **Evidence** Every key held at department scope or wider is delegable within its reach, and no key, break-glass
  included, is marked non-delegable (`apps/api/src/platform/rbac/delegation.service.ts:71-72, 219-240`); keys held at
  `own` or `section` scope cover no Unit (`apps/api/src/shared/types/index.ts:163-164`). An `organization` rung is never
  a delegate's (`apps/api/src/platform/approvals/approver-level.ts:104-105`). This entry answers RK-26.
- **Options** **A** §6.7's organization-scope list; top PO bands and write-offs on `organization` rungs (S). **B** also
  refuse delegates on named approve keys (M; a check per key). **C** split keys (M; the key list changes;
  `rbacService.grantAlongside` can give the old key's holders the new keys once, roles and delegated grants alike, in a
  run-keyed go-live step, IT's precedent `apps/api/src/modules/it/go-live/screen-grants.ts:1-40`; a key split off to
  keep it from delegates is left out of that copy).
  - *Override* (may `approval.override` decide administration approvals, and on which bands?): **(i)** yes, on any band
    within its own reach, recorded as `overriddenWith` and bound by §6.6 (S; §6.4). **(ii)** override never decides an
    administration type (S). **(iii)** override only below a named band (M; a check per band).
- **Recommendation** A; override (i): yes, within its own reach, recorded as `overriddenWith`, bound by §6.6.

### 16.6 B — Master data

#### OD-05: Master-data codes and barcodes (P1a, P1b)
- **Q** Are codes for items, suppliers, warehouses, categories and units generated or typed, and may two items share a
  barcode? Arabic: هل يولّد النظام الأكواد أم يكتبها المستخدم؟ وهل يجوز أن يشترك صنفان في باركود واحد؟
- **Evidence** IT's `CON-{seq:5}` codes are global, permanent and never reused
  (`apps/api/src/modules/it/consumables/consumable-number.ts:1-19`); org units take typed codes
  (`packages/contracts/src/platform/organization.ts:52-55`).
- **Options** **A** generated `ITM-{seq:5}` and `SUP-{seq:5}`; typed short codes for the rest; an optional barcode (S).
  **B** all generated (S; a counter per kind). **C** all typed (S; only with OD-68's coded lists; no counter until P2).
  - *Barcodes:* **(i)** unique among live items, so a scan resolves to one row (S; `ux_barcode`, §2.3.4). **(ii)** two
    items may share one (S; a scan offers a choice).
- **Recommendation** A; legacy codes kept beside; barcodes by keyboard wedge
  (`apps/web/src/modules/it/pages/AssetScanPage.tsx:1-10`). Barcodes: (i).

#### OD-06: Category depth (P1a)
- **Q** Two classification levels or an open tree, and which level does an item name? Arabic: هل التصنيف مستويان
  (رئيسي وفرعي) أم شجرة مفتوحة؟ وبأي مستوى يرتبط الصنف؟
- **Evidence** The owner's request lists «Category / Subcategory» among an item's fields. No open tree exists in ECMS:
  org units are a fixed three-level hierarchy (`apps/api/src/platform/organization/shared/org-unit.ts:1-3`); IT asset
  categories are flat by owner decision (`docs/12-planning/it-module-design.md:1438`); cost centers forbid a parent (D-CC-4,
  `apps/api/src/platform/organization/cost-centers/cost-center-guards.spec.ts:69-74`); Fleet catalogs are flat kind and
  name rows (`apps/api/src/modules/fleet/catalogs/catalog-item.model.ts:18-39`).
- **Options** **A** two levels (S). **B** n levels with a path (M; subtree filters; the org-unit `path` shape,
  `org-unit.ts:29-36`). **C** flat (S; no grouping).
  - *The item's level:* **(i)** the subcategory whenever its category has one, for new items and edits; an item whose
    category later gains its first subcategory keeps its category until it is next edited, so adding a level
    invalidates no item (S; §2.3.3). **(ii)** any level (S; reports group unevenly).
- **Recommendation** A; the item's level (i).

#### OD-07: Units of measure (P1a)
- **Q** One unit per item, or purchase and issue units with a factor (a box of 12)? Arabic: هل للصنف وحدة واحدة، أم
  وحدة شراء ووحدة صرف بمعامل تحويل؟
- **Evidence** IT units are free text (`apps/api/src/modules/it/consumables/consumable.model.ts:28-29`); no conversion
  exists anywhere.
- **Options** **A** one base unit from a managed list (S). **B** A plus a purchase unit and factor on PO and GRN lines (M,
  additive). **C** a conversion table (L).
- **Recommendation** A; B can follow without migration.

#### OD-08: Decimal quantities (P1a)
- **Q** Whole numbers of the base unit, or fractions for kg, m and L? Arabic: هل الكميات أعداد صحيحة فقط، أم يُسمح
  بالكسور للكيلو والمتر واللتر؟
- **Evidence** Every counted stock quantity in ECMS is an integer
  (`packages/contracts/src/modules/it.ts:2100, 2179, 2926`). The one decimal measure, Gold's gram weights, is an
  unconstrained float
  (`apps/api/src/modules/gold/bars/bar.model.ts:74`; `packages/contracts/src/modules/gold.ts:409`), printed to two
  decimals (`apps/web/src/modules/gold/lib/gold-print.ts:253-254`). Mongo `$round` rounds half to even
  (`apps/api/src/modules/fleet/custody/custody-memo-totals.ts:19-26`).
- **Options** **A** integers; small base units where needed (S). **B** decimals per unit as scaled integers (M; every
  rule and report scales). **C** floats (rejected: drift, as Gold's weights show).
- **Recommendation** A.

#### OD-09: Minimum, reorder and maximum levels (P1a; the comparison basis at P5)
- **Q** Are stock levels set per item, or per item in each warehouse, and which quantity is an item-level threshold
  compared with? Arabic: هل تُحدَّد حدود الطلب على الصنف عمومًا أم لكل مخزن؟ وبأي رصيد تُقارَن: رصيد كل مخزن أم
  رصيد الشركة كلها؟
- **Evidence** IT's `minQty` is "a reorder hint, never a block"
  (`apps/api/src/modules/it/consumables/consumable-stock.ts:94-99`), and it sits on a per-branch row, so IT compares it
  per store (`apps/api/src/modules/it/consumables/consumable.model.ts:4-9`). Settings are organization
  scope only (§15.1) and hold no per-item values.
- **Options** **A** on the item, min ≤ reorder ≤ max (S). **B** per item × warehouse (M; a threshold record from P5, a
  new collection, §2.2; never the balance projection). **C** A now, a per-warehouse override later (S, additive).
  - *Comparison basis* (under A or C's item-level values): **1** each warehouse's on hand (S; one level suits stores of
    one size, so a minimum of 100 flags every small store until C's override exists). **2** the organization-wide
    total (S; hides a stock-out in one store). **3** the per-warehouse value, by construction, under B or C's override
    (M). How often an alert repeats and who receives it are OD-61.
- **Recommendation** C, starting with A; basis 1, IT's per-store reading (§2.3.4).

#### OD-10: Warehouses (P1a; who may post at P5)
- **Q** How many warehouses per branch, of which types, under which department, may only the named keeper post, and is
  the department a write axis? Arabic: كم مخزنًا في الفرع وما أنواعها وتبعيتها؟ وهل يقتصر التسجيل على أمين المخزن؟
- **Evidence** No warehouse scope exists (`packages/contracts/src/common/index.ts:105-125`). A department delegate whose
  grant reaches several units reads a whole branch of a branch-only collection
  (`apps/api/src/shared/base/org-scope-match.ts:93-97`). A home department or section grant reads organization-wide on a
  branch-only collection unless the repository fails closed (`apps/api/src/shared/base/base.repository.ts:248-252`;
  `org-scope-match.ts:79-86, 107-111`): §7.2, D-10.
- **Options** **A** several per branch, typed `main`, `branch`, `sub` (+ `quarantine` under OD-34 B); an optional
  department, reference-only (§7.2); the keeper for accountability; any key holder in reach posts; a moved store is a new
  warehouse, because the ledger never re-files rows (§2.4.1) (S). **B** keeper-only posting (M; every posting checks the
  user against the named keeper, and a cover rule is needed for the keeper's leave). **C** one per branch (S; no
  sub-stores).
  - *The department as a write axis:* **(i)** reference-only; writes check `keyReachesBranch` (S). **(ii)** a write
    axis: writes use `keyCoversUnit`, so a home-only department holder writes the warehouses of their own department
    (S–M; §19.2).
  - *When the keeper is recorded:* **(i)** from P1a, as the owner's request lists
    «Warehouse manager / responsible person» in warehouse master data (S–M; Phase 1 then also carries OD-64's reset
    classification and the employee search, §19.2). **(ii)** from P5, when receiving starts (S; until then a
    warehouse names no person).
- **Recommendation** A; department (i); keeper (i), as the request asks.

#### OD-11: Supplier fields (P1b)
- **Q** What does a supplier record hold, are its papers filed, is bank data stored, and is a repeated tax registration
  number refused? Arabic: ما بيانات المورد المطلوبة؟ وهل نحفظ صور مستنداته وحسابه البنكي؟ وهل يُرفض تكرار رقم التسجيل
  الضريبي؟
- **Evidence** No counterparty model holds tax or bank data: an IT vendor keeps name, code, phone, email, address,
  services and contacts (`apps/api/src/modules/it/vendors/vendor.model.ts:15-22`), and a Fleet workshop a name
  (`apps/api/src/modules/fleet/catalogs/catalog-item.model.ts:18-39`). Only the Organization singleton stores the
  company's own `taxNumber` and `commercialRegistry` (`apps/api/src/platform/organization/organization.model.ts:11-12`);
  §2.3.6 gives the supplier the same names, `taxNumber` and `commercialRegistry`. Payroll contracts reject `iban`
  (`packages/contracts/src/modules/hr-payroll.spec.ts:440-445`); a revealed secret follows ADR-034.
- **Options** **A** identity, contacts, `taxNumber`, `commercialRegistry`, `vatStatus` (its values arrive
  with OD-29), `paymentTerms` (free text until OD-29); papers in `administration-supplier-documents`; no bank data (S).
  **B** A plus a sealed account, an audited reveal and its key (M; ADR-034; one more permission key, the reveal).
  **C** plain bank data (rejected).
  - *A repeated tax registration number:* **(i)** a warning, never a block (S; a supplier's branches can be separate
    records). **(ii)** refused by a unique index (S; one record per legal entity).
- **Recommendation** A; B only if OD-54 needs payee data. Repeats: (i), as OD-58 treats a repeated delivery-note number.

#### OD-12: Supplier status (P1b)
- **Q** Is a supplier usable once recorded or after approval, and is there a blocked list? Arabic: هل يُستخدم المورد
  فور تسجيله أم بعد اعتماده؟ وهل توجد قائمة محظورين؟
- **Evidence** IT vendors are active or inactive, never deleted (`apps/api/src/modules/it/vendors/vendor.routes.ts:23-58`).
- **Options** **A** `active`/`inactive` (S). **B** approval before first use (M; a request type and key). **C** A plus
  `blocked` with a reason, which RFQs and POs refuse (S; a status whose absence reads as active, §2.3.6).
- **Recommendation** A, the IT vendor precedent; C if a blacklist exists.

#### OD-13: Supplier evaluation (P8)
- **Q** How are suppliers rated? Arabic: كيف يُقيَّم أداء المورد؟
- **Evidence** No rating exists. Reports derive and store nothing: "Nothing here is stored"
  (`apps/api/src/modules/fleet/custody/custody-ledger.ts:3`); history reads through `ix_supplier_received`
  (§2.5).
- **Options** **A** derived on-time and rejection shares (S). **B** manual ratings (M; a form and a collection). **C**
  both (M).
- **Recommendation** A, the derived-report precedent.

#### OD-14: Non-stock lines on purchase requests (P2)
- **Q** May a PR ask for services or uncataloged items? Arabic: هل يجوز طلب خدمة أو صنف غير مُعرَّف في دليل الأصناف؟
- **Evidence** Every movement names an `itemId` (§2.4.1). A non-stock flag is absence-safe (§2.3.4), as Fleet's optional
  `licenseExpenseKind` reads an absent value as "both"
  (`apps/api/src/modules/fleet/catalogs/catalog-item.model.ts:25-29`).
- **Options** **A** cataloged items only (S; new items wait). **B** free-text lines (S; spend per item lost). **C** a
  non-stock kind on items (S, additive).
- **Recommendation** C.

#### OD-15: Durable items issued to a person (P6)
- **Q** Must an employee return a durable item (furniture, a tool, a uniform) issued to them? Arabic: هل يلتزم الموظف
  بردّ الأصناف المعمّرة المصروفة له (أثاث، عُدد، زي)؟
- **Evidence** IT keeps durables as custody (ADR-021); consumables are "used up, not handed back"
  (`apps/api/src/modules/it/consumables/consumable-memo.model.ts:4-8`); «عهدة» already has three meanings (§0.4).
- **Options** **A** every issue is consumption (S). **B** a returnable flag; holdings flagged on exit (M–L; a holdings
  ledger). **C** registered assets, a later module (L).
- **Recommendation** A, IT's consumables rule; under B the term comes from OD-67.

#### OD-67: Business vocabulary (P1a, P1b)
- **Q** Which words does the company use for the supplier, the papers and the roles? Arabic: ما المسميات المعتمدة:
  المورد، إذن الاستلام أو الإضافة، إذن الصرف، محضر الجرد، أمين المخزن؟
- **Evidence** IT's consumables words exist (`apps/web/src/platform/localization/i18n.ts:26468-26556`), and so does
  «جرد»: Gold's «جرد الدرج» and «محضر جرد درج» (`i18n.ts:29568`; `apps/web/src/modules/gold/lib/gold-print.ts:236, 306`)
  and ATM's «محضر جرد ماكينة الصراف الآلى» (`apps/web/src/modules/atm/lib/papers/settlement-paper-wording.ts:11, 47`).
  «جرد» is reused (§0.4); only the count document's name is open. "Vendor" is the word of IT's code and
  English UI ("IT Vendors", `apps/api/src/seed-navigation.ts:1008`; "Add vendor", `i18n.ts:9596`); "supplier" appears
  in Fleet's fuel label (`i18n.ts:5712`) and an IT page subtitle (`:9594`); Arabic uses «مورد» for both
  (`i18n.ts:21750, 25213`). The business validates terms (`docs/01-domain/ubiquitous-language.md:11-22`).
- **Options** **A** §0.4's candidates (S). **B** the company's words, from its forms (S; OD-68). **C** IT's words where
  they overlap (S; «توريد» for a receipt).
- **Recommendation** B, A as fallback; identifiers unchanged.

#### OD-68: Legacy sources (P1a, P1b: field set and data load)
- **Q** Is there a legacy system, Excel item or supplier lists, or paper forms to follow? Arabic: هل توجد نظم أو قوائم
  Excel أو نماذج ورقية قديمة نلتزم بها؟
- **Evidence** IT's opening stock came from the owner's count by a versioned go-live step
  (`apps/api/src/modules/it/go-live/consumables-opening.ts:1-2, 77-78`); Fleet came from a legacy repository
  (`docs/12-planning/fleet-module-design.md:3-11`).
- **Options** **A** the owner sends files; fields follow; a one-time versioned load (S–M; `administration_go_live_runs`
  comes with the first Phase 1 pull request that loads a file: P1a.2 for units, categories and items, P1b.1 for
  suppliers, §19.8). **B** typed by hand (S; slow go-live). **C** an in-app import
  with preview (M; ATM's register import keeps a run collection, one more collection here; IT's asset upload and ATM's
  machine sync keep none: a hash-checked apply of the previewed file, §4.3.1).
- **Recommendation** A.
- **Answer** B for now (2026-11-24, §16.12): master data is typed in on the screens; a load from files later is its own
  change (A or C).

#### OD-70: Retiring an item or warehouse that holds stock (P5)
- **Q** What does retiring an item or warehouse mean while stock remains, and which acts does a retired row refuse?
  Arabic: ماذا يعني إيقاف صنف أو مخزن ما زال به رصيد؟
- **Evidence** IT's retired item refuses receipts and issues (`REFUSED_WHEN_INACTIVE`,
  `apps/api/src/modules/it/consumables/consumable.repository.ts:21-25`) but may still be scrapped, and returns are taken
  back into it (`apps/api/src/modules/it/consumables/consumable.service.ts:333-357`).
- **Options** **A** a per-kind refusal map (`REFUSED_WHEN_INACTIVE`, §2.4.4): a retired item takes no new purchase or
  receipt lines and refuses only `goodsReceipt` and `openingBalance` legs; outflows, returns, write-offs, count postings
  and the legs of a transfer already dispatched pass, so its stock leaves until zero (S). **B** retirement refused while
  stock, transit or an open document remains (S; the checkers of §3.6). **C** write the rest off (rejected).
- **Recommendation** A for items, after IT's map but wider, so no document is stranded; B for warehouses (§2.3.5).

### 16.7 C — Procurement policy

#### OD-16: Who raises a purchase request (P2)
- **Q** Who may raise a PR (any employee, department focal points, or procurement), and for another department?
  Arabic: من يحق له إنشاء طلب شراء؟ وهل يجوز الطلب نيابة عن إدارة أخرى؟
- **Evidence** ESS keys are "Asking, never deciding" (`apps/api/src/modules/hr/employee-loans/ess-grants.ts:19-35`); the
  ESS set is pinned (`apps/api/src/modules/hr/ess-grants.spec.ts:42-48`). Leave refuses an account with no employee
  record (`apps/api/src/modules/hr/leave-management/leave-requests/leave-request.service.ts:85-90`).
- **Options** **A** focal points with department-scope `administrationPurchaseRequest.create` (S; section focal points
  need a new `sectionId` field on the PR, §2.5, §7.3). **B** every employee via ESS (S; the pinned set and volume
  grow; an HR slice). **C** procurement only (S; needs arrive outside ECMS).
- **Recommendation** A; requesters are placed employees; no filing for another department.

#### OD-17: Purchase-request approval (P2)
- **Q** Who approves a PR, whose Unit picks the chain, and may an approver lower a quantity? Arabic: من يعتمد طلب
  الشراء: مدير الإدارة الطالبة أم سلسلة الاعتمادات؟ وهل يجوز للمعتمِد تخفيض الكمية؟
- **Evidence** Chains are picked by type × (department catalog, branch)
  (`apps/api/src/platform/approvals/approval-chain.ts:41-56`); requisitions decide by relationship
  (`apps/api/src/modules/hr/recruitment/job-requisitions/job-requisition.service.ts:236-262`). For an edit, a requisition
  goes back for approval when the quantity rises, never when it falls
  (`apps/api/src/modules/hr/recruitment/job-requisitions/job-requisition-rules.ts:95-107`).
- **Options** **A** `administration.purchaseRequest` at the requester's Unit; admins set rungs (S). **B** the manager by
  relationship, then procurement (M; custom steps). **C** by value (M; needs prices and OD-18).
  - *Lowering a quantity:* **(i)** no; the approver rejects or returns the PR (S). **(ii)** lower, never raise, the cut
    recorded as the line's `cancelledQty`, no new field (S; the MR rule, §5.8, §2.5).
- **Recommendation** A, as leave does: the PR approves the need, the PO the spend. Lowering: (ii), as OD-39 A for MRs.

#### OD-18: Purchase-order value bands (P4; P3 under OD-23 A)
- **Q** Does PO approval depend on value, with which thresholds and approvers, keyed on what, organization-wide or per
  branch, edited by whom, and how does an over-receipt tolerance meet the band? Arabic: هل يختلف اعتماد أمر الشراء حسب
  قيمته؟ وما الحدود ومن يعتمد كل شريحة؟ وعلى أي قيمة تُحسب الشريحة؟
- **Evidence** The engine has no amount field (`apps/api/src/platform/approvals/workflow.model.ts:12-29`); automation
  may never own entity state (`docs/03-decisions/ADR-018-automation-engine.md:38`). A chain row is scoped by branch and
  department catalog (`apps/api/src/platform/approvals/workflow.model.ts:21-26`), while module settings are organization
  scope only (§15.1).
- **Options** **A** `administration.purchaseOrder.band<N>`, thresholds in a setting under
  `administrationProcurementPolicy.manage` (S). Any organization-scope `setting.edit` holder can also rewrite the
  thresholds through `PATCH /api/v1/platform/settings/values`, with only a `platform/setting` audit row
  (`apps/api/src/platform/settings/settings.routes.ts:19-25`; §6.7); whether to close that bypass is a sub-question
  below. **B** an amount condition in the engine (L; ADR). **C** one chain for all POs (S).
  - *Basis:* **1** the PO total at submission, plus a derived split-purchase report: POs to one supplier in a period,
    or from one PR, whose sum crosses a higher band (S). **2** the total of the PR lines the PO claims (M; PRs would
    carry price estimates). **3** a cumulative total per supplier and period (M; a per-supplier-period counter written
    in the same transaction, or two POs submitted at once both stay under the band: write skew).
  - *Tolerance* (only if OD-32 allows one): **(i)** capped so the received value stays inside the PO's approved band
    (S; it bounds the GRN claim, §4.3.2). **(ii)** receipts beyond the band need the next band's approval (M; an
    override act and one more key).
  - *Scope of the thresholds:* **(i)** organization-wide (S; organization-scope settings, so
    `administrationProcurementPolicy.manage` is checked at organization scope, §6.7; the chains behind each band can
    still differ per branch). **(ii)** per branch (M; a module-owned policy record, a new collection).
  - *The settings bypass* (holders of the platform `setting.edit` key rewriting the thresholds through the generic
    settings `PATCH`): **(i)** closed: the thresholds live in a module-owned policy record, or the platform's setting
    declarations gain an owning key that the generic `PATCH` also requires (M for the record, a new collection; L for
    the owning key, a platform change; §6.7).
    **(ii)** accepted: the declaration's Zod schema carries every domain check, the generic settings screen shows the keys
    with no field and a link to the policy page (`MANAGED_ELSEWHERE`, a System Administration web list,
    `apps/web/src/modules/system-admin/settings/lib/settings-catalog.ts:131-161`), and the audit shows only
    `platform/setting` (S; §6.7's mitigations; the `PATCH` stays open). The risk is RK-32 (§17).
- **Recommendation** A; basis 1; tolerance (i); thresholds organization-wide; the bypass (i), a module-owned
  policy record or an owning key. The band is stamped at submission, so a threshold edit never re-routes an in-flight
  PO (§6.4).

#### OD-19: No chain configured (PX-1, before P2)
- **Q** With no chain, or no staffed rung, may a document still pass? Arabic: إذا لم تُضبط سلسلة اعتماد، هل يُعتمد
  المستند تلقائيًا أم يُمنع إرساله؟
- **Evidence** No chain → approved: "A chain with NO steps … leaves the request approved. That is a policy"
  (`apps/api/src/platform/approvals/approval.service.ts:100-108`). A chain whose rungs are all unstaffed also reads
  approved in the engine, which steps over unstaffed rungs (`apps/api/src/platform/approvals/approval-chain.ts:74-81`;
  `apps/api/src/platform/approvals/approval-trail.ts:59-65`). A host that enters the engine on `steps.length > 0`, as
  leave does (`apps/api/src/modules/hr/leave-management/leave-requests/leave-request.service.ts:293-300`), is then left
  in `pendingApproval` where nobody can decide (`approval.service.ts:164-165`; §15.2.1 R2).
- **Options** **A** refuse submission when no active chain applies or no rung is staffed
  (`chain.steps.some((s) => s.staffed)`); the live rung is also checked at submission for an approver other than the
  requester (its current approvers minus the requester), and later rungs are re-checked after each decision, a
  document left with nobody to decide being flagged as stuck (S; §4.1, §5.2, §6.4 item 5). **B** auto-approve (S;
  spend risk; already the engine's reading of both cases, but it needs edges §5 does not draw: `draft → approved` with
  the claims taken at submission, and a submission that posts for counts and adjustments). **C** a fixed fallback rule
  (S).
- **Recommendation** A.

#### OD-20: Approval-engine hardening (PX-1, before P2)
- **Q** Is the engine fixed before money approvals rely on it, and are temporary deputies needed? Arabic: هل نُصلح
  محرك الاعتماد قبل اعتماد المال؟ وهل نحتاج معتمِدًا بديلًا؟
- **Evidence** §15.2.1: chains are not pinned (R1); a chain with no staffed rung reads approved (R2, OD-19); expired
  assignments decide (`apps/api/src/platform/approvals/approver-lookup.ts:107`, R3); override ignores scope
  (`apps/api/src/platform/approvals/approval.service.ts:179`, R4); the engine audits before the host commits
  (`apps/api/src/platform/approvals/approval.service.ts:202-221`, R5); accounts that are not `active` count as
  approvers (`apps/api/src/platform/approvals/approver-lookup.ts:23-75`, R8); a chain may name any registered key, and
  a chain save carries no client version (`apps/api/src/platform/approvals/approval.service.ts:253-271`, R9).
- **Options** **A** a platform slice first: PX-1 covers R1–R5 plus R8 (inactive approvers) and R9 (any registered key;
  no client version) (L; a new platform ADR, "Money approvals on the platform engine", §20; R8 and R9 widen §18.3.1's
  exit criteria, one test per defect). The per-request pin lives in the host's `approvalWorkflowId` and
  `approvalChainShape`, and the engine, which stays stateless, is handed the pinned chain by the host (the proposed
  PX-1 shape, settled in its ADR, §20); the module adds no checks of its own for R1, R3 or R4. **B** module workarounds
  before P2 (M; duplicated logic: three stopgaps ship in P2, and only under B: R1's pin compare, refused with
  `ADMINISTRATION_APPROVAL_CHAIN_CHANGED`, R3's exact-level check and R4's override reach; §15.2.1's stopgap column,
  §6.4 item 4). **C** as is (S; risk on money, accepted in writing).
- **Recommendation** A; deputies as time-bound assignments after the R3 fix; chain edits never move in-flight
  documents.

#### OD-21: Separation of duties (P2)
- **Q** Which acts must different people do? Arabic: ما المهام التي يجب أن يقوم بها أشخاص مختلفون؟
- **Evidence** "One key held by one person is not a two-person rule" (`apps/api/src/modules/hr/hr.module.ts:955-956`);
  the engine has no requester or two-rung rule (`apps/api/src/platform/approvals/approval.service.ts:150-224`). A run's
  freezer may not approve it (`apps/api/src/modules/hr/payroll/runs/payroll-run.service.ts:207-209`).
- **Options** **A** §6.6's A pairs: A1, the requester, creator and submitter never decide any rung of any
  administration type (the widening of the requester rule to creators and submitters follows the loans precedent); A2,
  a PO's approver never posts its GRN; A3, a counter never approves the variance (S). **B** A plus §6.6's B pairs: B1,
  one decider per round; B2, dispatcher ≠ receiver; B3, awarder ≠ PO approver; B4, GRN poster ≠ invoice hand-over (S
  each; a small branch may need a higher rung or an override for B1). **C** requester ≠ approver only (S; the floor
  §5.2 keeps under every option).
  - *Further pairs, each decided alone:* receiver ≠ resolver of a transfer shortage (recommended default: enforce,
    OD-47.2 A); opening-balance drafter ≠ poster (recommended default: enforce, OD-63 A); invoice recorder ≠ hand-over
    actor (candidate; recommended default: enforce, or one person types and releases the payable, OD-54, §12.4); buyer
    (the PO's creator or issuer) ≠ GRN poster (candidate; recommended default: not enforced, since A2 already keeps the
    PO's approvers off the GRN); quotation recorder ≠ awarder (candidate; recommended default: not enforced, since B3
    keeps the awarder off the PO); supplier maintainer or policy setter ≠ awarder or PO approver (recommended default:
    separate bundles only, §6.5); PR requester ≠ the PO's approver (recommended default: not enforced, because the PR
    chain already separated the need from its requester).
- **Recommendation** B, with the further pairs as listed (§6.6).

#### OD-22: Central or branch buying (P3)
- **Q** Does one central unit buy for every branch, or each branch for itself; whose chain approves the spend; and may
  goods be received into a store other than the one the PO line names? Arabic: هل الشراء مركزي لكل الفروع أم يشتري كل
  فرع لنفسه؟ وهل يجوز الاستلام في مخزن غير المحدد في أمر الشراء؟
- **Evidence** No ECMS module runs a purchase cycle (request, quotation, approval, order). Fleet records the cars it
  buys as vehicle supply contracts, organization-wide (no branch on the contract): a free-text supplier, lines of make ×
  count × unit price, a deadline and deliveries per line, entered after the fact with no request or approval
  (`apps/api/src/modules/fleet/vehicle-contracts/vehicle-contract.model.ts:1-11, 57-69`). Fleet's one fund, which pays
  for every vehicle (`apps/api/src/modules/fleet/custody/custody-fund.service.ts:93`), is the nearest analogy for
  central buying. §7.1
  assumes RFQs and POs are scoped by the purchasing branch.
- **Options** **A** central, organization-scope buyers; PO lines name delivery warehouses (S). **B** per branch (S; no
  consolidation). **C** central plus local buying under a threshold (M; two paths).
  - *Whose chain approves the spend:* **(i)** the purchasing unit's, because one PO may consolidate several
    departments' lines (S; §7.5, OD-25). **(ii)** the requesting department's (S; one department per PO).
  - *Delivery redirection:* **(i)** refused: goods are received where ordered, then transferred (S; the claim checks
    the line's `deliveryWarehouseId`, §2.6). **(ii)** allowed with a reason (M; the claim filter and the keeper's queue
    change).
- **Recommendation** A, unless branches buy locally today; spend chain (i); redirection (i).

#### OD-23: Quotation rules (P3)
- **Q** How many quotations, when is one source acceptable, how long is a quotation valid, and may a supplier withdraw
  and quote again? Arabic: كم عرض سعر مطلوب، ومتى يُقبل مورد وحيد، وما مدة صلاحية العرض؟ وهل يجوز للمورد سحب عرضه
  وتقديم غيره؟
- **Evidence** No ECMS rule counts quotations. `expired` derives from `validUntil` (§5.5). PR and RFQ lines
  carry no price (§2.5), so a value exists only once quotations are in. `ux_rfq_supplier` keeps one live quotation per
  supplier per RFQ, and a withdrawn one frees its slot (§2.5).
- **Options** **A** a minimum per value band, judged at award on the awarded total, and a written reason when fewer
  valid quotations came back (M; `administrationProcurementPolicy.manage`, its page and OD-18's thresholds move from P4
  to P3, so OD-18's thresholds are answered before P3, §18.2). **B** always three (S; slows small buys). **C** no rule
  (S; audit risk). **D** a flat minimum at issue until P4's bands exist, then per band at award (S; nothing moves from
  P4).
  - *One live offer per supplier:* **(i)** revised by editing while `received` and the RFQ is `issued`; a withdrawn
    quotation frees its slot, so a supplier may withdraw and quote again before bidding closes (S; `ux_rfq_supplier`
    is partial on the live statuses, §2.5). **(ii)** a withdrawal ends the supplier's part in that RFQ (S; the index
    also counts withdrawn rows).
  - *Late and expired quotations:* **(i)** a quotation is recorded only while bidding is open (`issued`), from an
    invited supplier; the officer closes bidding at or after `responseDueAt`; an expired quotation is never awarded
    (S; §5.5). **(ii)** also refuse one received after `responseDueAt` while bidding is still open (S). Validity
    reminders ride a notification idempotency key, or PX-2's marks (§18.1 A10).
- **Recommendation** A, numbers from the owner; D if the policy key must wait for P4. One live offer (i); late and
  expired (i).

#### OD-24: Selection and award (P3)
- **Q** Must the lowest price win, may lines be split, and is the award approved apart from the PO? Arabic: هل يُرسى على
  أقل سعر؟ وهل تُقسَّم البنود؟ وهل تُعتمد الترسية منفصلة؟
- **Evidence** RFQs end `awarded` under `administrationRfq.award`; quotations end `selected` or `notSelected` (§5.5);
  awards are stored per line (`awards[]`, §2.5). No ECMS precedent exists.
- **Options** **A** lowest compliant price, else justified; per-line award; the PO approval covers it (S; one approval
  per spend, OD-17). **B** a separate award approval (M; one more approval type and its chains; slower). **C** one
  supplier per RFQ (S; loses savings). Re-awarding inside an RFQ (`notSelected → selected`) would come only with
  OD-26 B.
- **Recommendation** A.

#### OD-25: Consolidation (P3)
- **Q** May one RFQ or PO combine PR lines from several departments or branches, and in which order are its sources
  filled and given back? Arabic: هل يجوز جمع طلبات إدارات أو فروع مختلفة في أمر شراء واحد؟
- **Evidence** A PR's `orderStatus` derives from the PO lines claiming it (§2.5), and a consolidated PO line stores a
  quantity per source (`sources[].qty`, §2.5). The claim and its give-back follow leave's reservation
  (`apps/api/src/modules/hr/leave-management/leave-balances/leave-balance.service.ts:116-145, 171-183`).
- **Options** **A** yes, within the buyer's reach (M; line claims). **B** one PR, one PO (S). **C** one department (S).
  - *Order of sources:* **(i)** a partial receipt fills the oldest approved source first, and a short-closed remainder
    goes back to the newest source first (S; an order rule of the module's own, applied by every partial receipt and
    every short-close or remainder cancel; §4.5 Q13). **(ii)** pro rata (M; integer quantities need a rounding rule).
- **Recommendation** A, following OD-22; order (i).

#### OD-26: Changes after approval (P2; PO revisions at P4)
- **Q** Which changes are allowed after a PR or PO is approved, and which need approval again? Arabic: ما التعديلات
  المسموح بها بعد الاعتماد، ومتى يعود المستند للاعتماد؟
- **Evidence** Requisitions are amended in place; increases and placement or job changes go back to the manager step,
  decreases do not (`apps/api/src/modules/hr/recruitment/job-requisitions/job-requisition-rules.ts:95-142`). Job offers
  keep `revisions[]` (`apps/api/src/modules/hr/recruitment/job-offers/job-offer.service.ts:202-248`); an HR contract
  amendment is a new version under the same code (`apps/api/src/modules/hr/contracts/contracts/contract.service.ts:396-462`).
- **Options** **A** decreases cancel lines; increases, price rises and supplier changes cancel and re-raise (S; §5's
  lifecycles unchanged). **B** amendments in place: a PR goes back `approved → pendingApproval`; a PO revision waits
  through an approval round of its own while the PO keeps receiving under its approved terms, then replaces them, the
  old terms kept; a supplier change may re-award within the RFQ (M). Its impact, not designed here (§5.6): an `/amend`
  act, `administrationPurchaseOrder.edit` covering the revision (§6.2); a PR amendment row
  `approved → pendingApproval`, not drawn (§5.4); on the PO, `pendingRevision`, `revisions[]` and a moving
  `revisionNumber`, one pending revision at a time, short-close and cancels refused while it waits; a `revision` value
  of `endedBy` and the pending revision in `APPROVAL_PENDING` (§5.2, §5.14), each resubmission after a revision round
  re-picking the band (§6.4 item 2); a `notSelected → selected` re-award row on quotations, not drawn (§5.5). Under B a
  PO revision also adds: the event `administration.purchaseOrder.amended` (`supplierId`, `revisionNumber`) when a
  revision takes effect, its round emitting nothing (§8.2); a revision approved or applied signals as both a
  PR-quantity act and a receivability act (§9.3); an applied revision audits `update` with the terms' diff and
  `revisionNumber`, and its round decides under the OD-82 verb (§10.2); the PO paper prints `revisionNumber` beside the
  number, a print after an applied revision shows the new terms, and the acknowledgment already filed covers the
  earlier terms (re-issuing a revised PO is OD-31's; §11.6.4). **C** every change re-approves (M; slow; the same PR
  amendment row and `/amend` act as B). Rejection and return for amendment are OD-72.
- **Recommendation** A.

#### OD-27: PO lines beyond approved PRs; urgent buying (P4)
- **Q** May a PO order without, or beyond, an approved PR line, and is there an urgent path? Arabic: هل يتجاوز أمر
  الشراء الطلب المعتمد؟ وما مسار الشراء العاجل؟
- **Evidence** PO lines claim PR quantities (§4.1, Claim), and the claim refuses more than the open quantity, as leave's
  reservation refuses more than the balance
  (`apps/api/src/modules/hr/leave-management/leave-balances/leave-balance.service.ts:116-145`). §4 assumes OD-33's
  default: goods are received only against an issued PO.
- **Options** **A** claims only, never more; urgent PRs take the normal path, notified at once (S). **B** excess up to a
  pack multiple or a tolerance, with a reason (M; the claim rule; a setting under `administrationProcurementPolicy.manage`;
  the queue and reports show the excess). **C** PO lines without a PR, justified (S; weaker control).
- **Recommendation** A; no cash fund here (OD-66).

#### OD-28: Cancellation and short-close (P2; MR part at P6)
- **Q** Who may cancel a PR, PO or MR at each stage, how is an unfilled remainder closed, and who closes it when the
  store cannot supply? Arabic: من يلغي طلب الشراء أو أمر الشراء أو طلب الصرف في كل مرحلة؟ وكيف يُغلق الجزء غير
  المنفَّذ؟ ومن يغلقه إذا تعذّر الصرف من المخزن؟
- **Evidence** Precedents cancel only before anything moves
  (`apps/api/src/modules/hr/employee-loans/employee-loan.service.ts:407-430`), then correct forward. IT lets a requester
  cancel their own ticket under the view key, ownership checked in the service
  (`apps/api/src/modules/it/tickets/ticket.routes.ts:121-128`).
- **Options** **A** cancel with a reason until something is ordered (PR), received (PO) or issued (MR), then only the
  remainder (`cancel-remainder`); a PO closes when fully received, an MR when every line is issued or cancelled, a
  transfer when emptied (S). Auto-close means a later return or correction cannot reopen the PO (§4.2.3); an explicit
  `.close` offered once `receiptStatus = fullyReceived` keeps OD-36 A's and OD-84's reopen reachable. **B** cancel any
  time (M; breaks the append-only ledger). **C** the approver alone cancels (S).
  - *OD-28.1, an MR rest the store cannot supply:* **(i)** the storekeeper bundle gains
    `administrationMaterialRequest.cancel` (S; OD-78; the key also cancels requests before approval). **(ii)** a keeper's
    "cannot supply" act, the MR's `POST /material-requests/:id/cancel-remainder` under `administrationStockIssue.create`
    on the MR's warehouse (§5.8), closes the remainder with a reason, as OD-47.1 A closes an undispatched rest (S; an act
    on another document's key, as a GRN moves its PO).
  - *OD-28.2, an approved MR the store cannot supply at all (nothing issued):* **(i)** only a `.cancel` holder cancels
    it (§5.8 row 8) (S). **(ii)** the keeper's "cannot supply" act also ends it `cancelled`, under
    `administrationStockIssue.create` on the MR's warehouse (S; row 8 gains a second key, gated `authorizeAny` as the MR's
    `/cancel-remainder` is, §5.1.4).
  - *OD-28.3, a PR cited by a live RFQ:* **(i)** cancel refused, naming the RFQ (S). **(ii)** cancel, and the RFQ's
    officer is notified (S); either way the PO's claim filter (`PR_SOURCEABLE`) binds.
  - *OD-28.4, withdrawing one's own request before a decision:* **(i)** under `.view` plus an ownership check, as IT
    lets a requester cancel their own ticket (IT's FR-14, cited above) (S). **(ii)** only `.cancel` holders cancel (S;
    the requester asks the procurement manager).
- **Recommendation** A, under `administrationPurchaseRequest.cancel`, `administrationPurchaseOrder.close` and
  `administrationMaterialRequest.cancel`; OD-28.1 (ii); OD-28.2 (i); OD-28.3 (i) (§4.5 Q6); OD-28.4 (i).

#### OD-29: VAT, discounts, withholding, currency (P3; PO parts at P4)
- **Q** Are prices recorded net of VAT, with discounts and withholding, and may purchases be in foreign currency?
  Arabic: هل تُسجَّل الأسعار قبل الضريبة مع الخصومات والخصم تحت حساب الضريبة؟ وهل نشتري بعملة أجنبية؟
- **Evidence** No tax or discount exists in ECMS (`apps/api/src/modules/hr/payroll/pay-items/pay-item.model.ts:4`;
  `apps/api/src/modules/hr/payroll/payslips/payslip.model.ts:10`; `packages/contracts/src/modules/hr-payroll-money.ts:20`);
  money defaults to `'EGP'` (`hr-payroll-money.ts:148`); currencies never mix silently (BD-004, the approved business
  decision "Multi-currency ready, EGP first", `docs/01-domain/business-decisions.md:79-98`); no exchange rate exists
  (§12.7). Quotations, the first priced documents, arrive in P3 (§2.5). Outside this module, Fleet's vehicle supply
  contracts store unit prices excluding VAT with no tax field and print «غير شامل ضريبة القيمة المضافة 14%» as
  fixed text (`apps/api/src/modules/fleet/vehicle-contracts/vehicle-contract.model.ts:20`;
  `apps/web/src/modules/fleet/components/vehicle-contract-record-parts.tsx:179-183`): net only, none of A–D.
- **Options** (§12.8) **A** gross only: amounts as printed, no tax field (S; quotes cannot be compared net). **B** tax
  typed, record only: net lines, tax and total as printed; ECMS checks only net + tax = total; EGP only (S–M; no tax rule
  in ECMS; Finance gets the figures). **C** rate-based: a VAT rate per item, tax computed (M; rates and exemptions become
  ECMS knowledge). **D** full tax: VAT, withholding, e-invoice (L; the Finance module's job). Foreign currency needs
  exchange rates under any option (L).
  - *Also decided here:* net or gross amounts for value bands (OD-18) and the comparison (OD-24); discounts as amounts
    or percentages; where a rounding step sits (`scaleMinorUnits`, §12.7). The PO's document discount and line
    rounding apply again at P4.
- **Recommendation** B (§12.8), EGP only.

#### OD-30: Unit-price precision (P3)
- **Q** Are two decimals enough for a unit price? Arabic: هل يكفي رقمان عشريان لسعر الوحدة؟
- **Evidence** `MoneyAmountSchema` refuses a third decimal (`packages/contracts/src/modules/hr-payroll-money.ts:128-141`);
  quotation lines carry `unitPriceMinor` from P3 (§2.5).
- **Options** **A** two (S). **B** a four-decimal scaled price (M; ADR if shared). **C** pack prices (M; OD-07 B).
- **Recommendation** A, the shared money discipline (D-7).

#### OD-31: Sending RFQs and POs to suppliers (P3)
- **Q** Are RFQs and POs sent on paper, e-mailed by ECMS, or stored as verifiable PDFs? Arabic: كيف يصل طلب العروض
  وأمر الشراء إلى المورد: ورقيًا، أم بالبريد، أم ملفًا موثقًا؟
- **Evidence** Notifications reach users only (`apps/api/src/platform/notifications/notification.service.ts:37-41`).
  Server PDFs go through `platform/pdf` (Chromium, off in dev and CI without `CHROMIUM_PATH`,
  `apps/api/src/modules/hr/contracts/contracts/contract-pdf.ts:1-5`). Stored PDFs exist for HR contracts, with a SHA-256
  line and a verification QR (`contract-pdf.ts:57-66`, stored at `:78-95`), and for HR evaluation-batch packages,
  without a hash (`apps/api/src/modules/hr/recruitment/evaluation-batches/evaluation-batch-package.ts:402, 437-442`);
  IT label sheets are rendered and not stored (`apps/api/src/modules/it/assets/asset.service.ts:408-427`).
- **Options** **A** printed and sent by hand; channel recorded; signed acknowledgment filed (S). **B** ECMS e-mails
  suppliers (L; a path to non-users; outside this design: it reopens §0.2's non-goal). **C** a stored PDF with hash and
  QR, printed or handed over, never sent (M; the `platform/pdf` seam and the contract precedent exist; Chromium on the
  worker; the conditional `administration-generated-pdfs` category, §11.6.7).
- **Recommendation** A (§11.6.7).

#### OD-71: Two approvers at the same level (P2)
- **Q** Does any chain need two desks (rungs) at one level (e.g. the director, then the general manager)? Arabic: هل
  تحتاج سلسلة اعتماد إلى معتمِدَين في المستوى نفسه، كمدير الشئون الإدارية ثم المدير العام؟
- **Evidence** A chain may not repeat a key at a level (`apps/api/src/platform/approvals/approval.service.ts:269`).
- **Options** **A** one desk per level (S). **B** a second approve key for the upper desk (M; one more approve key per
  such type, §6.2, §6.4). **C** a host step outside the engine (M; two mechanisms).
- **Recommendation** A; B if the owner names such a chain.

#### OD-72: Rejection and return for amendment (P2)
- **Q** When an approver says no, is the document finished, or sent back to be amended? Arabic: عند الرفض: هل ينتهي
  المستند أم يعود للطالب لتعديله وإعادة إرساله؟
- **Evidence** Engine rejection is final: "the requester files again"
  (`apps/api/src/platform/approvals/approval-trail.ts:54-57`); loans return to `draft`
  (`apps/api/src/modules/hr/employee-loans/employee-loan.service.ts:294`).
- **Options** **A** final; the requester copies it into a new draft (S). **B** A plus a host `return` act (the approve
  key): `pendingApproval → draft`, number kept, claims given back, round archived in `approvalRounds[]` (M). **C**
  rejection returns to `draft` (M; a `rejected → draft` edge on PRs, POs, MRs, transfers and adjustments, so
  `rejected` is no longer terminal; §5 does not draw it).
- **Recommendation** B (§5.2): the loans shape as a separate act; `rejected` stays final.

#### OD-73: Who sees prices, quotations and stock values (P3)
- **Q** Who may see quotations, prices and stock values, are those reads recorded, do audit rows carry prices, and may
  amounts travel in notifications or events? Arabic: من يطّلع على عروض الأسعار والأسعار وقيم المخزون؟ وهل يُسجَّل كل
  اطلاع؟
- **Evidence** `auditLog.view` reads every audit value; masking covers `nationalId` only
  (`apps/api/src/platform/audit/audit.masking.ts:17-30`); only download tickets audit file reads
  (`apps/api/src/platform/files/file.service.ts:777`). HR keeps pay behind its own key, `employee.viewCompensation`
  (`apps/api/src/modules/hr/hr.module.ts:575`); payroll's run events carry no amount
  (`packages/contracts/src/modules/hr-payroll.ts:1386-1389`).
- **Options** **A** quantities only on stock surfaces, prices only to PO, RFQ and invoice viewers: stock screens carry
  quantities only; the RFQ, quotation, PO and invoice DTOs carry prices; GRN DTOs, the receivable-lines read and
  movement rows show a price only to a caller who also holds the PO view key (S; as §4.3.2, §6.8 and §7.10 build).
  **B** A plus a values key, once OD-37 values stock, for readers who hold no procurement key (M; one more key).
  **C** A plus one audited `download` row per quotation or invoice file read (M; §11.5 builds the hook; `download` is
  not broadcast). **D** every holder of a document's or the stock's view key sees its prices and values
  (S; keepers see cost). **E** A plus quotation files read by fewer people than the holders of
  `administrationRfq.view` (M; the files leave the `rfq` entity type for one of their own, keyed by the RFQ id, with
  its own authorizer and realtime classification: a new entity type, §11.4).
  - *Audit rows:* **(i)** prices in clear, because a price trail without prices settles nothing (S; §6.8). **(ii)**
    document totals only, the price fields masked or redacted at write time (M; ATM's `redactedDiff`, at the cost of
    the evidence).
  - *A document's action log* (`auditService.trailOf` reads several entities' rows of one module in one read,
    `apps/api/src/platform/audit/audit.service.ts:346-375`; Operations serves its shipment log with it under the
    module's own read grant, `apps/api/src/modules/operations/shipments/shipment.routes.ts:160-168`): **(i)** none: a
    document's history is its approval trail, its stamped acts and, for stock, the ledger (S; §10.5). **(ii)** a module
    read of the document's own rows and its linked documents' under the document's read key (S–M; the rows' `changes`,
    prices included under audit rows (i), reach every viewer of the document, not only `auditLog.view` holders).
  - *Notifications and events:* **(i)** no amounts (S; §8.1). **(ii)** amounts on spend-decision events (S; additive
    on the V1 payload; every cataloged event reaches notification-rule and automation authors).
- **Recommendation** A; C if bids are confidential; B once OD-37 values stock. Audit (i); notifications and events (i);
  action log (i).

### 16.8 D — Receiving

#### OD-32: Partial receipts and over-receipt (P5)
- **Q** May a PO arrive in several deliveries, and may a delivery exceed the order, by how much? Arabic: هل يُستلم أمر
  الشراء على دفعات؟ وهل تُقبل زيادة عن المطلوب، وبأي نسبة؟
- **Evidence** `receiptStatus` tracks partial receipt; no tolerance exists anywhere. Fleet's vehicle supply contracts
  take several deliveries per line and refuse one that brings more than is still owed («أكثر من المتبقي»,
  `apps/api/src/modules/fleet/vehicle-contracts/vehicle-contract.figures.ts:124-154`), which is option A's rule. The
  receipt claim bounds a PO line's `receivedQty`, as leave's reservation bounds a balance
  (`apps/api/src/modules/hr/leave-management/leave-balances/leave-balance.service.ts:116-145`).
- **Options** **A** partial yes, excess no (S). **B** a tolerance, an override beyond it (S–M; the tolerance is a setting
  under `administrationProcurementPolicy.manage`, the override one more key; a tolerance may push the
  received value past the PO's band, which OD-18 caps). **C** free excess (S; value overrun).
- **Recommendation** A.

#### OD-33: Receipt without a PO (P5)
- **Q** May goods enter stock without a PO (samples, donations)? Arabic: هل يجوز إدخال أصناف بدون أمر شراء (عينات،
  تبرعات)؟
- **Evidence** Of the on-hand in-legs (§2.4.2), `goodsReceipt` (against a PO) and `openingBalance` bring goods from
  outside; `adjustmentIn` and `countGain` are governed by OD-52 and the count; `issueReturn`, `transferReceipt` and
  `transferReturn` move goods already counted. ADR-024: once Procurement exists, "a received purchase order is what
  creates" a receipt (`docs/03-decisions/ADR-024-minimal-spare-parts-ledger.md:44-46`); IT receives with no order today
  (`apps/api/src/modules/it/consumables/consumable.service.ts:318-332`).
- **Options** **A** never; an approved `adjustmentIn` instead (S; needs adjustments outside counts, OD-52 A, from P5
  under §18.1 A11). **B** an approved GRN without PO (M; a second path; `purchaseOrderId` null). **C** free for keepers
  (S; unapproved stock).
- **Recommendation** A, ADR-024's boundary.

#### OD-34: Goods rejected at receipt (P5)
- **Q** What happens to goods refused at delivery? Arabic: ما مصير الأصناف المرفوضة عند الاستلام؟
- **Evidence** No precedent exists. The ledger records the goods the company holds, so a refusal moves nothing
  (§2.6: `rejectedQty` with a `reasonCode`).
- **Options** **A** recorded on the GRN line, never stocked; the PO line stays open for a replacement or a short-close
  (S). **B** a quarantine warehouse until returned (M; it fits neither a one-warehouse GRN nor the rule that only
  accepted quantity enters stock: two warehouses per GRN or a second document, and a return for goods never accepted,
  which the SRN claim on `acceptedQty` cannot cover; a §2 change, §4.3.2). **C** accept, then return (S; extra
  documents, and a debit-note claim under OD-36).
- **Recommendation** A.

#### OD-35: Receiving committee and "two people" (P5)
- **Q** Does the keeper post a GRN alone or with a receiving committee (لجنة الفحص والاستلام), and what are "two
  people"? Arabic: هل يعتمد أمين المخزن إذن الاستلام وحده أم مع لجنة فحص واستلام؟
- **Evidence** Operations refused two equal treasurer ids, checking neither logins nor the actor, until Round 18, when
  the owner dropped the names («انا مش عاوز اى اسماء»): a vault receipt now records one receiver, the signed-in user
  (`apps/api/src/modules/operations/vault/vault-custody.service.ts:99-103`;
  `packages/contracts/src/modules/operations.ts:2957-2970`).
  The question to the owner says so: A is the shape the owner chose for the vault's cash receipt. The owner's request lists one
  «Receiving user» among a goods receipt's fields.
- **Options** **A** the keeper alone (S). **B** named, distinct, current employees, the poster among them (S–M; a
  directory check; `inspection.members`, §2.6, under B only). **C** two sign-ins (M; a status and a rule).
- **Recommendation** A: the signed-in poster is the receiver, the shape the owner chose for the vault receipt
  («انا مش عاوز اى اسماء»), with pair A2 keeping the PO's approvers off the GRN (OD-21); B only if the owner asks for a
  receiving committee.

#### OD-36: Supplier returns after acceptance (P5)
- **Q** When accepted goods go back, does the PO quantity reopen, and what does Finance receive? Arabic: هل يعيد ردّ
  الأصناف للمورد فتح الكمية في أمر الشراء؟ وماذا يُبلَّغ للمالية؟
- **Evidence** Returns post `supplierReturn` (§2.4.2); no debit note exists. A give-back is the opposite `$inc`, as leave
  releases a reservation (`apps/api/src/modules/hr/leave-management/leave-balances/leave-balance.service.ts:171-183`).
- **Options** **A** reopens the PO line until the PO closes; each return joins the handoff (S). Under OD-28 A a fully
  received PO is already `closed`, so a return against it ends with a debit note and a replacement is a new PO; an
  explicit close keeps the reopen reachable (§4.3.3). **B** never reopens (S). **C** returns only before the invoice
  (S). An approval type for returns would be one more approval type under any option (§4.3.3). A correction of a mis-keyed
  receipt is OD-84, not a return: it creates no debit note or handoff line only while nothing of that GRN line has
  been handed over, and otherwise cuts the post-hand-over notice.
  - *After the hand-over:* a return of goods already handed over, or an `entryError` correction of a quantity already
    handed over, reaches Finance through OD-54's post-hand-over notice (recommended default: a return notice, §12.5);
    before the hand-over, a return lowers what can be billed.
- **Recommendation** A; after the hand-over, OD-54's return notice.

#### OD-37: Valuation (P5, schema)
- **Q** Is stock valued in money, by which method, and who owns cost? Arabic: هل يُقيَّم المخزون ماليًا؟ وبأي طريقة؟
  ومن يملك التكلفة؟
- **Evidence** No ECMS ledger carries cost: "no valuation" (`apps/api/src/modules/it/spare-parts/part.model.ts:5`);
  ADR-024 leaves valuation to Warehouses (`docs/03-decisions/ADR-024-minimal-spare-parts-ledger.md:15-19`).
- **Options** (§12.9) **A** quantities; receipt and opening-balance movements keep `unitCostMinor` and `currency` (S).
  **B** weighted average per item and warehouse (M; every movement valued; a new balance field, §2.4.3; past
  outflows valued through a valuation record or a D-17 backfill, because movements have no update path; a rounding
  rule for the average, which the module must define). **C** FIFO layers (L; a collection of cost layers). **D** a
  reference value: the last PO price at read time (S; not an accounting value, but easily taken for one). Who sees
  values is OD-73.
- **Recommendation** A, capturing `unitCostMinor` and `currency`, so that B or C can later be computed from the ledger
  without re-keying history; B still needs a valuation record or a D-17 backfill (§12.9).

#### OD-84: Correcting a posted goods receipt entered in error (P5)
- **Q** How is a posted GRN corrected when it was keyed wrongly (100 typed, 10 delivered), so that stock, the PO and the
  invoice match agree? Arabic: كيف يُصحَّح إذن استلام مُرحَّل أُدخِل بالخطأ (سُجِّل 100 والمستلم 10)؟
- **Evidence** Nothing posted is edited; an opposing document corrects it (D-2): ADR-024's movements are "positive on
  receipt, negative on consumption" (`docs/03-decisions/ADR-024-minimal-spare-parts-ledger.md:26-28`), and attendance
  corrections "flow forward as adjustments, never as restatements"
  (`apps/api/src/modules/hr/attendance/day-records/day-record.repository.ts:23-29`). A posted GRN is final (§5.7). An
  `adjustmentOut` of 90 fixes the stock but leaves PO `receivedQty` at 100 and the PO auto-closed, so the §12.4 match
  passes a 100-unit invoice and the §2.4.8 check stays green; a plain SRN records a return that never happened and,
  under OD-36, a debit-note claim (§4.3.2).
- **Options** **A** a correcting document with opposing receipt legs: it gives back PO `receivedQty` and reopens a PO
  the GRN closed (M–L; a new movement kind in the closed list, §2.4.2, its legs and its document, and the PO
  `closed → issued` edge). **B** a supplier return with `reasonCode: 'entryError'`: it always gives back PO
  `receivedQty`, whatever OD-36 says of real returns; it creates no debit note or handoff line only while nothing of
  that GRN line has been handed over, and otherwise cuts the post-hand-over notice (OD-54, §12.5); and it is reported
  apart from real returns (S–M; one reason code in the closed list, §2.4.1, and the same `closed → issued` edge, unless
  OD-28 keeps closing explicit, §4.2.3). **C** block the Finance hand-over of an invoice while its GRN is disputed (S;
  the ledger is untouched, so the stock stays wrong until a correction posts). A and B both need the
  `closed → issued` edge under OD-28 A's auto-close; they differ in that A adds a movement kind and B a reason code.
  Under every option the §2.4.8 check counts PO `receivedQty` as Σ accepted − Σ returned quantities that gave
  `receivedQty` back, while the §12.4 match nets every posted return (kept = Σ `acceptedQty − returnedQty`). Without
  an answer only an adjustment fixes the stock, and the PO and the match stay wrong.
- **Recommendation** B: the same opposing-document correction as A (D-2, ADR-024), correcting forward (§5.13), with one
  reason code instead of a new movement kind. It ships with P5's supplier returns (§18.1 A11); see OD-28 and OD-36.

### 16.9 E — Issues, transfers, counts, adjustments

#### OD-38: Who requests materials (P6)
- **Q** Do employees request materials through self-service, or department focal points? Arabic: من يطلب الصرف: كل
  موظف عبر الخدمة الذاتية أم منسّق كل إدارة؟
- **Evidence** As OD-16; own-scope users join no realtime room (`apps/api/src/platform/realtime/realtime-rooms.ts:29-32`).
- **Options** **A** focal points (S). **B** ESS (S–M; the ESS spec; volume; an HR slice). **C** both (S–M).
- **Recommendation** A.

#### OD-39: Material-request approval (P6)
- **Q** Who approves an MR, and may quantities be reduced? Arabic: من يعتمد طلب الصرف؟ وهل يجوز تخفيض الكمية؟
- **Evidence** §6.4 and §7.6 assume `administration.materialRequest` runs at the requester's Unit, built as leave builds
  its Unit (`apps/api/src/modules/hr/leave-management/leave-requests/leave-request.service.ts:101-111`). A requisition's
  lower quantity never costs a fresh approval, a higher one does
  (`apps/api/src/modules/hr/recruitment/job-requisitions/job-requisition-rules.ts:95-107`).
- **Options** **A** the department chain; lower, never raise, the cut recorded as `cancelledQty` (S; §5.8). **B** none
  (S; weaker control). **C** above a rule only (M).
- **Recommendation** A.

#### OD-40: Issue without a request (P6)
- **Q** May a keeper issue without an approved MR? Arabic: هل يجوز الصرف بدون طلب صرف معتمد؟
- **Evidence** IT issues directly on a signed memo, with no request
  (`apps/api/src/modules/it/consumables/consumable-issue.service.ts:178-442`); here the approved MR is the control on
  consumption (OD-39).
- **Options** **A** never (S; every issue claims an approved MR line in `MR_ISSUABLE`). **B** with a reason, reviewed
  later (S; `materialRequestId: null` issues, an unclaimed outflow, and a review report). **C** for categories the owner
  names (S–M; a per-category flag, a §2 addition).
- **Recommendation** A, or C.

#### OD-41: What an issue is charged to (P6)
- **Q** Is consumption charged to the requesting department only, or to a cost center too? Arabic: يُحمَّل الصرف على
  الإدارة الطالبة فقط أم على مركز تكلفة أيضًا؟
- **Evidence** D-CC-3: "employees only. Nothing else may carry a centre yet"
  (`apps/api/src/platform/organization/cost-centers/cost-center-guards.spec.ts:76-88`); the guard pins five master
  models only. A document already snapshots a center: the payslip's nullable `costCenterId` under D-CC-5
  (`cost-center-guards.spec.ts:90-95`; `apps/api/src/modules/hr/payroll/payslips/payslip.model.ts:60, 93`). The rule for
  a center on a date lives in HR
  (`apps/api/src/modules/hr/employee-management/cost-center-assignments/cost-center-resolution.ts:1-30`), and no
  platform seam exposes it.
- **Options** **A** department plus recipient snapshot (S; keeps D-CC-3). **B** a picked center (M; reopens D-CC-3;
  a module-gated options read). **C** the requester's HR center on the date (M; a new directory seam, PC-2; the payslip
  shape).
  - *Who may read cost-center names (under B or C):* **(i)** codes and names only, to holders of the MR create key,
    `administrationMaterialRequest.create`, through the module-gated read (S; it widens who reads the organization's list,
    today only `costCenter.view` holders, `apps/api/src/platform/organization/cost-centers/cost-center.routes.ts:26-39`,
    and an ESS-raised MR would open it to every employee, §7.9, §15.2.2). **(ii)** only holders of the platform's
    `costCenter.view`, as today (S; whoever picks a center needs that key too).
- **Recommendation** A (§12.10); under B or C, names (i).

#### OD-42: Reservations (P6)
- **Q** Does an approved MR reserve stock, or is availability checked at issue? Arabic: هل يحجز اعتماد طلب الصرف
  الكمية؟
- **Evidence** Leave reserves at submission and releases on failure
  (`apps/api/src/modules/hr/leave-management/leave-requests/leave-request.service.ts:323-334`;
  `packages/contracts/src/modules/hr-leave.ts:369-377`).
- **Options** **A** check at issue (S). **B** reserve on approval (M; a third bucket, `reservedQty`, and release rules,
  §2.4.3). **C** priority items only (M).
- **Recommendation** A.

#### OD-43: Returns from departments (P6)
- **Q** Do returned items go back to stock, or are damaged ones written off, and how is an issue posted against the
  wrong MR corrected? Arabic: هل يعود المرتجع إلى الرصيد أم يُعدم التالف؟ وكيف يُصحَّح صرفٌ سُجِّل على طلب صرف غير
  صحيح؟
- **Evidence** IT returns carry no issue link (`apps/api/src/modules/it/consumables/consumable.service.ts:358-378`); here
  a return claims its issue line (§2.6).
- **Options** **A** every return posts `issueReturn`; damaged lines are then written off (S; an adjustment per damaged
  return, so adjustments outside counts, OD-52 A). **B** damaged lines never enter stock (S; the line's `condition`
  decides whether a leg posts). **C** unopened items only (S; a rule at return).
  - *An issue posted against the wrong MR:* **(i)** a stock return plus a new issue against the right MR; the wrong
    MR's `issuedQty` is never given back, IT's rule that the counter is "everything EVER issued"
    (`apps/api/src/modules/it/consumables/consumable-stock.ts:37-38`) (S; §5.7; the wrong MR keeps that quantity as
    issued, so it may read as served although its requester received nothing). **(ii)** the return gives `issuedQty`
    back, as OD-84 B gives a GRN's `receivedQty` back (M; IT's rule set aside, and an MR that issue closed would need
    to reopen).
- **Recommendation** A, each line citing its issue line; the wrong MR (i).

#### OD-44: Leavers and movers (P6)
- **Q** When an employee leaves or moves, what happens to their open requests and issued items, and which acts refuse a
  leaver? Arabic: ما مصير طلبات الموظف وما صُرف له عند انتهاء خدمته أو نقله؟
- **Evidence** IT flags, never auto-returns (`apps/api/src/modules/it/it.module.ts:582-608`). IT's `refuseLeaver` refuses
  only a positive `exited` answer (`apps/api/src/modules/it/assets/custody.service.ts:95-114`); Gold's resolver also
  refuses an id HR cannot read (`apps/api/src/modules/gold/shared/ecms-refs.ts:46-55`).
- **Options** **A** cancel their drafts; flag holdings under OD-15 B (S). **B** cancel all (S). **C** nothing (S;
  orphans).
  - *Per act:* **(i)** IT's rule: a leaver is refused as a requester or a recipient, and may still be a stock return's
    `returnedBy` (S; §2.6, §3.5). **(ii)** Gold's stricter rule (S; a deployment without HR refuses every person).
- **Recommendation** A; per act (i); documents keep their filing snapshot.

#### OD-74: Back-dating and period locks (P5)
- **Q** May a movement carry a date before its posting, and are closed months locked? Arabic: هل يجوز تسجيل حركة
  بتاريخ سابق؟ وهل يُقفل الشهر بعد إقفاله؟
- **Evidence** IT accepts any client date: `at` is an optional date with no bound on receive, scrap and return
  (`packages/contracts/src/modules/it.ts:2972, 2983, 2993`), defaulting to now
  (`apps/api/src/modules/it/consumables/consumable.service.ts:327, 346, 370`). HR freezes correct forward
  (`docs/12-planning/retro-post-freeze-corrections.md:8-47`).
- **Options** **A** `at` is the posting instant for every movement, opening balances included; an opening balance
  also stores its `asOfDate`, the counted date, a Cairo date no later than today, printed and never used as the
  movement's `at` (S; §2.6). **B** a window with a reason (S; past cards change, and a card
  may show a negative intermediate balance the guard never saw, §2.4.7). **C** B plus a monthly close (M; a new
  period-close record).
- **Recommendation** A; C with Finance.

#### OD-75: Fulfilling warehouse (P6)
- **Q** Who picks the warehouse serving an MR, may it sit in another branch, and may one request draw on several?
  Arabic: من يحدد المخزن الذي يصرف الطلب؟ وهل يُصرف من مخزن في فرع آخر أو من أكثر من مخزن؟
- **Evidence** §2.6 assumes A's schema: an MR names one `warehouseId`, which feeds that keeper's queue. IT's store is the
  branch, and a memo lists one store's items (`apps/api/src/modules/it/consumables/consumable-issue.service.ts:205-211`).
- **Options** **A** the requester picks one warehouse in their branch; supply from another branch first moves the stock
  by a transfer (S). **B** any warehouse, a central store included: the MR and its issues become two-branch documents,
  the keeper reads through a second-anchor read (§7.4), and the MR stores the warehouse's branch (M; a §2 addition).
  **C** a service list on each warehouse, naming the branches or departments it serves (M; master data; the warehouse
  may sit in another branch, as under B). **D** several warehouses of the requester's branch on one MR (M; several
  keepers' queues per MR).
- **Recommendation** A.

#### OD-45: Transfer approval and initiation (P7)
- **Q** Do transfers need approval, and does the sender (push) or the receiver (pull) start them? Arabic: هل يحتاج
  التحويل إلى اعتماد؟ ومن يبدؤه: المخزن المُرسِل أم المستلم؟
- **Evidence** A document filed in two branches has no ECMS precedent (§7.4). A stock paper is filed where its stock
  is: IT's memo, in its items' store (`apps/api/src/modules/it/consumables/consumable-issue.service.ts:205-211`). IT's
  own transfers between branches need no approval and start at the sending side: one act under `itConsumable.assign`,
  which must reach the destination, moves the stock at once
  (`apps/api/src/modules/it/consumables/consumable-transfer.service.ts:57, 107-118`).
- **Options** **A** approval for inter-branch only; the source creates (S; an intra-branch transfer takes the
  conditional `draft → approved` edge, with an empty trail and an audit row saying no approval was required; its number
  is still taken at submission, §2.8). **B** pull (M; create scoped on `toBranchId`; the Unit on the destination).
  **C** always approve (S; slower). Whatever the answer, a transfer's creation checks no chain; its submission checks
  one only where OD-45 asks for approval (OD-19). Under OD-47.4 (ii)'s loss round a transit loss needs an
  `administration.stockTransfer` chain with a staffed rung over the transfer's Unit: the `writtenOff` resolve is
  refused until one applies, which an administrator configures, and OD-61's notice flags a loss round left with
  nobody to decide (§4.3.5, §5.9, §6.4 item 5).
- **Recommendation** A.

#### OD-46: Goods in transit (P7)
- **Q** Who answers for goods in transit, is the carrier recorded, and how long may it last? Arabic: من المسؤول عن
  الأصناف أثناء النقل؟ وما مهلة الاستلام؟
- **Evidence** No stock ledger has an in-transit balance (ADR-024 leaves inter-store transfers out,
  `docs/03-decisions/ADR-024-minimal-spare-parts-ledger.md:36-38`; Gold transfers move ownership only,
  `apps/api/src/modules/gold/transfers/transfer.service.ts:1-5`). The nearest precedent is Operations' secured
  shipment: `dispatched` between vault release and delivery, with the carrier recorded as crew legs
  (`packages/contracts/src/modules/operations.ts:46-56, 88-96`) and vault custody held, then released (`:2895`;
  `apps/api/src/modules/operations/vault/vault-custody.service.ts:104-140, 161-183`).
- **Options** **A** the destination's in-transit balance; the carrier as text; overdue after N days (S; the overdue
  reminder rides a notification idempotency key, or PX-2's marks, §18.1 A10). **B** the source's (M; a ledger change).
  One step is not offered: the owner's request asks for Dispatch, Receipt, Partial receipt and Difference handling, and
  says «ولا تعتبر الكمية انتقلت نهائيًا بمجرد الضغط على "Transfer"» (D-3). IT's one-step transfer, «فوراً», was the owner's
  choice for IT consumables (`apps/api/src/modules/it/consumables/consumable-transfer.service.ts:5-11`), not for these
  warehouses.
- **Recommendation** A.

#### OD-47: Transfer differences (P7)
- **Q** May less be dispatched than listed; who resolves an arrival shortage; who posts a return to the source; and who
  approves a transit loss? Arabic: هل يجوز إرسال أقل من المطلوب؟ ومن يسوّي الفرق عند الاستلام؟ ومن يسجّل الارتجاع
  للمخزن المُرسِل؟ ومن يعتمد الفاقد؟
- **Evidence** `discrepancy` resolves by `transferReceipt`, `transferReturn` or `transitLoss` (§2.4.2, §2.4.5).
  Operations' dual-control receipt is gone: a vault receipt records one receiver, the signed-in user (OD-35). An
  in-state approval round runs while the document keeps its status; a transfer's loss round, OD-47.4 (ii), is the
  design's only one (§5.2, §5.14).
- **Options**
  - *OD-47.1, short dispatch:* **A** the undispatched rest is cancelled with a reason, in the one dispatch act (S).
    **B** refuse a short dispatch; cancel and re-raise (S). **C** keep the remainder open for later dispatches (M; a
    dispatch-progress axis on transfer lines and repeated dispatch batches, §2.6, §5.9).
  - *OD-47.2, who resolves:* **A** a person other than the receiver; `shortDeclaredByUserId` shows who declared (S; an
    OD-21 pair). **B** the receiver may resolve (S; one person declares and writes off).
  - *OD-47.3, return to the source:* **A** the destination's resolve posts `transferReturn` at once (S; it raises source
    stock before the goods are back, under a key that may not reach `fromBranchId`, and nothing records goods that
    never arrive). **B** the destination declares the quantity "returning to source" (`returningQty`, the outcome
    `returningToSource`, under `.receive` at the destination); it stays in the destination's `inTransit`, and the
    SOURCE keeper posts `transferReturn` on arrival, under `administrationStockTransfer.receive` reaching
    `fromBranchId`, never under `.resolve`; a return that never arrives is resolved `returnNotArrived`, either
    re-declared a loss (OD-47.4) or put back in the plain in-transit share (S–M; a new §7.4 act row, §4.3.5). **C** a
    source-side in-transit leg tracks the return trip (L; a source-side in-transit bucket, a ledger change, §2.4.5).
    **D** the destination receives what arrived, and goods going back travel on a new transfer to the source (S; no
    `returningQty`, `returningToSource`, `returnNotArrived` or source-side `/receipts`; costs: refused goods pass
    through the destination's on hand, a count freeze delays the receipt, and an inter-branch return needs OD-45's
    approval).
  - *OD-47.4, transit loss:* **(i)** the resolver posts `transitLoss` alone (S; a one-person write-off path, a control
    gap). **(ii)** a loss round: the declared `lossPendingQty` opens an in-state approval round on the `dispatched`
    transfer (`administration.stockTransfer`; an earlier round moves into `approvalRounds[]`, `endedBy: 'loss'`), which
    `APPROVAL_PENDING` covers, and `transitLoss` posts in the final approval's transaction; a rejected round returns the
    quantity to the open in-transit share (M). **(iii)** an adjustment line of kind `transitLoss` on the in-transit
    bucket, approved on the write-off chain (M–L; changes `MOVEMENT_LEGS` and the adjustment kinds, §2.4.2).
- **Recommendation** OD-47.1 A; OD-47.2 A; OD-47.3 B: the destination declares `returningQty`, and the SOURCE keeper
  posts the return on arrival under `administrationStockTransfer.receive` reaching `fromBranchId`, so refused goods
  never enter the destination's on hand, and a count at the destination does not hold them up; D is the simpler path
  if the owner prefers it. OD-47.4 (ii), the loss round. Until this is answered, a one-person loss is a known control
  gap (§4.3.5).

#### OD-48: Count freeze (P7)
- **Q** Do movements of counted items stop during a count, or is a snapshot compared; what does a "full" count cover;
  and what happens to goods that arrive during a count? Arabic: أثناء الجرد: هل تتوقف الحركة على الأصناف محل الجرد؟
  وما مصير الأصناف التي تصل أثناء الجرد؟
- **Evidence** From P7, balance rows carry `frozenByCountId` (§2.4.3); the freeze guards on-hand legs only, so a
  dispatch to the warehouse waits in its `inTransit` and its receipt is refused with 422 `ADMINISTRATION_STOCK_FROZEN`
  until the count posts (§2.4.6). The stamp in the write's filter is the attendance freeze's idea
  (`apps/api/src/modules/hr/attendance/day-records/day-record.repository.ts:14-29`), released here, which is new
  (§5.13); every "is it locked?" check must widen with new states (§5.14).
- **Options** **A** freeze the counted items until posting (S). **B** a snapshot (M; the variance nets out the movements
  made during the count). **C** the whole warehouse (S; stops the store).
  - *A "full" count:* every row the warehouse holds at start, plus found lines (S; §2.4.6).
  - *Arrivals during a count:* **(i)** they stay in transit, set aside and left out of the count until it posts (S;
    the bucket-aware freeze). **(ii)** the count owner cancels the count, which releases the freeze, receives them and
    counts again (S; operational; the counted work is lost).
- **Recommendation** A; reminders, no automatic release; "full" as above; arrivals (i).

#### OD-49: Blind count (P7)
- **Q** Do counters see the book quantity? Arabic: هل يرى فريق الجرد الرصيد الدفتري؟
- **Evidence** No count capture exists in ECMS (`apps/web/src/modules/gold/lib/gold-print.ts:236-330` prints minutes,
  not a capture). The counter bundle holds no `administrationStock.view` (§6.5).
- **Options** **A** blind (S). **B** visible (S; anchoring risk). **C** per count (S; a flag, `blind`, §2.6).
- **Recommendation** A.

#### OD-50: Count team (P7)
- **Q** Does the keeper count alone, or a team? Arabic: هل يجرد أمين المخزن وحده أم لجنة؟
- **Evidence** Gold's drawer count minutes carry two signatures, the owner's delegate and the treasury supervisor
  (`apps/web/src/modules/gold/lib/gold-print.ts:321-322`). The count team is decided here, whatever OD-35 answers for
  goods receipts.
- **Options** **A** named counters, one not the keeper (S; `team: MemberSnap[]`, `countedByUserId` per line, and pair
  A3, §6.6). **B** the keeper (S; the variance approver is the only second person). **C** two sign-ins (M; a status and
  a rule, beyond Operations' typed ids).
- **Recommendation** A.

#### OD-51: Variance approval and recounts (P7)
- **Q** Who approves count variances, above which thresholds, when is a recount required, how often, and do counts with
  no variance need approval? Arabic: من يعتمد فروق الجرد؟ ومتى تُعاد العدّة؟ وما دورية الجرد؟
- **Evidence** Under the recommended default a rejection returns the count to `inProgress`, and no `rejected` status
  exists (§2.4.6). A counter never approves the variance, as a payroll run's freezer never approves
  it (`apps/api/src/modules/hr/payroll/runs/payroll-run.service.ts:207-209`).
- **Options** **A** the branch chain for every variance; a rejection means a recount, the round archived (S). **B** small
  variances post unapproved (M; needs OD-37 or a quantity rule). **C** one key, rejection final (S; adds a final
  `rejected` status that releases the freeze, which §5.10 does not draw).
  - *Counts without variance:* **(i)** they go through approval too, which releases the freeze (S; §4.3.6). **(ii)**
    they post at submission (S; an edge §5 does not draw).
  - *A recount before approval:* **(i)** the count owner reopens chosen lines with a reason (`/recount`,
    `submitted → inProgress`, §5.10 row 4), the freeze held (S). **(ii)** none before approval: a recount comes only
    from a rejection under A (S).
  - *Abandoning a count after counting* (cancel from `submitted` or `pendingApproval`, §5.10 rows 11–12): **(i)**
    allowed under `.create` with a reason; the current approvers are notified, and the counted lines and their variance
    stay on the cancelled document (S). **(ii)** refused once counted: a counted count ends only by its decision (S).
- **Recommendation** A; zero-variance (i); recount before approval (i); abandoning after counting (i); frequency from
  the owner.

#### OD-52: Adjustments and write-offs (P7; P5 under §18.1 A11)
- **Q** Are adjustments allowed outside counts, with what evidence, approved by whom? Arabic: هل تجوز التسوية المخزنية
  خارج الجرد؟ وما مستندات الإعدام؟ ومن يعتمدها؟
- **Evidence** IT scraps unapproved (`apps/api/src/modules/it/consumables/consumable.service.ts:338-351`), deferring
  disposal approval (`docs/12-planning/it-module-design.md:1444`). §18.1 A11 recommends shipping adjustments in P5, the
  only correction for an opening balance keyed wrongly, and the only way to give opening stock to a (warehouse, item)
  row that moved before its opening balance (an approved `adjustmentIn`, §15.3.5 c).
- **Options** **A** reason code, evidence, chain; write-offs on `organization` rungs (S–M). **B** counts only (S; no
  correction outside counts, and OD-33 A loses its path). **C** keepers alone (S; risk).
- **Recommendation** A.

#### OD-53: Negative stock (P5)
- **Q** May stock go below zero? Arabic: هل يجوز أن يصبح الرصيد سالبًا؟
- **Evidence** The guard sits in the update filter (`apps/api/src/modules/it/consumables/consumable.repository.ts:115-157`);
  ADR-024: "Consumption that would drive `onHandQty` below zero is a `BusinessRuleError`"
  (`docs/03-decisions/ADR-024-minimal-spare-parts-ledger.md:31-32`).
- **Options** **A** never (S). **B** allowed (M; breaks the guard; reconciliation).
- **Recommendation** A: no, stock never goes below zero.

### 16.10 F — Finance

#### OD-54: Where Procurement ends (P8)
- **Q** Does Procurement end at the GRN, at a matched supplier invoice, or at payment, and how strict is the match?
  Arabic: أين تنتهي مسؤولية المشتريات: عند الاستلام، أم بمطابقة فاتورة المورد، أم بالسداد؟
- **Evidence** No Finance code exists; `accounting` is reserved (`docs/01-business/module-hierarchy.md:76`); "ECMS is not
  the ledger" (`docs/01-domain/domain-model.md:228-232`).
- **Options** (§12.3) **A** the GRN (S; the PO and the receipt are handed to Finance on OD-55's record and memo; it
  saves `administration_supplier_invoices`, the `invoicedQty` claims on GRN lines and the withdrawal of an `FH-`
  handoff back to a draft invoice, §12.4–§12.5; it departs from the owner's example chain
  «Procurement → PO → Receiving → Invoice → Finance»). **B** invoice registration and three-way match (M;
  `administration_supplier_invoices`; the match computes what the supplier is owed, a departure from the domain rule
  "Operations never compute money owed", `docs/01-domain/bounded-contexts.md:105`, §12.2). **C** B plus record-only
  payment facts (M; the same departure).
  - *Match rule:* **(i)** an exact match: billed quantity ≤ received and not yet billed, net of returns, and price = PO
    price (S). **(ii)** tolerance bands under the policy key, with the variance path beyond them (M).
  - *A difference* (a price, a quantity beyond what is billable, a charge with no PO line, a document discount, a
    rounding piastre): **(i)** handed over as a variance: the hand-over actor, who did not record the invoice (OD-21),
    gives a reason, and the variance is frozen in the snapshot and printed on the memo for Finance to decide (S).
    **(ii)** the hand-over is blocked until the paper changes (S; a dead end when the supplier will not re-issue,
    §12.4).
  - *Which GRNs:* **(i)** cumulative per PO line, over the GRNs the invoice cites, claimed oldest posting first (S).
    **(ii)** per delivery: each invoice line cites one GRN line (S).
  - *Billing past the order:* **(i)** never: billing stops at the ordered quantity, even where OD-32 B accepted more,
    and the excess is a variance (S). **(ii)** bill what was kept (S).
  - *Non-stock lines (OD-14 C):* **(i)** received on the GRN as an accepted line that posts no movement, so the match
    treats every line alike (S; a §2.6 change). **(ii)** the requester confirms the service, or the line is billed
    against the ordered quantity alone (S).
  - *POs per registration:* **(i)** one registration bills one PO, and a PO may be billed by several (S; §2.5's single
    `purchaseOrderId`). **(ii)** one registration cites the lines of several POs of one supplier and one purchasing
    branch (M; a §2.5 change: the PO moves from the header to each line).
  - *Duplicates:* a second live invoice with the same supplier and number is refused, and a cancelled registration frees
    its number (S; §2.5).
  - *The post-hand-over notice* (shared with OD-36): a supplier return of goods already handed over, or an
    `entryError` correction of a quantity already handed over (OD-84), leaves a filed handoff billing more than was
    kept. **(i)** a return notice: the SRN posting cuts a second kind of handoff for the handed-over share it returned,
    with its own `FH-` number, record and memo, and its event only once a consumer exists (OD-55) (M; a `kind` and a
    `supplierReturnId` on `finance_handoffs` and a second partial unique index, a §2.5 change). **(ii)** the
    supplier's credit note, registered as an invoice of a credit kind and handed over (M; nothing reaches Finance until
    the supplier sends the paper; §12.5). **(iii)** nothing in ECMS (S; the live handoff overstates the payable until
    a person notices).
- **Recommendation** B (§12.3): the owner's own example chain puts the invoice in Procurement, before Finance
  («Procurement → PO → Receiving → Invoice → Finance»), and the owner's request lists «Invoices» among procurement's
  documents; so whoever ordered and received checks the bill. Choose A if the rule that Operations never compute money
  owed is to hold. Under B: match (i); a difference (i); GRNs (i); billing (i); non-stock lines (i); one PO per
  registration (i); duplicates refused; the post-hand-over notice (i) (§12.4, §12.5).

#### OD-55: Handoff to Finance (P8)
- **Q** Until Finance has a module, how does it receive the handoff, and does it need the files? Arabic: كيف تتسلم
  المالية ما تحيله المشتريات؟ وهل تحتاج صور المستندات؟
- **Evidence** Today's handoff is paper: Fleet's custody letters carry a Finance signature block (`LETTER_SIGN_ROLES`,
  `packages/contracts/src/modules/fleet.ts:5545-5550`). P-HR-14, HR's payroll-to-GL design: "a read plus an event"
  (`docs/12-planning/payroll-to-gl-discovery.md:36-57`). No software can receive a handoff yet (§12.1).
- **Options** (§12.5) **A** paper (S; nothing to read later). **B** event only (S; no consumer). **C** export file (S;
  no idempotency). **D** a record and a signed memo, which Finance staff read and sign today (M); the reliable event,
  and PC-1 beneath it, are recorded with the platform seam as integration requirements (§12.11) and built only with
  their first consumer.
  - *Per invoice or batched:* per invoice, one key per payable; a dated «كشف» is a report (§12.5).
  - *Acknowledgment:* the filed signed copy, not an in-app Finance act (§12.5).
  - *Withdrawal window:* until the signed copy is filed; later, a supplier return or credit note plus a new handoff
    (§12.5).
- **Recommendation** D, per invoice, with no event until a consumer exists; the sub-questions as listed; files on
  request.

#### OD-56: Budget control (P4 if wanted)
- **Q** Must PRs and POs be checked against department budgets? Arabic: هل تُراجَع أوامر الشراء على موازنة الإدارة؟
- **Evidence** No budget concept exists (`docs/12-planning/training-module-design.md:51`); budgets are a non-goal of this
  design (§0.2).
- **Options** **A** none (S). **B** advisory committed spend (M; budget data; outside this design: it reopens §0.2).
  **C** blocking at PO approval (L; likewise).
- **Recommendation** A.

#### OD-57: Fiscal year (P2)
- **Q** Do yearly numbers and reports follow the calendar year (Cairo) or a fiscal year? Arabic: هل الترقيم والتقارير
  بالسنة الميلادية أم بالسنة المالية؟
- **Evidence** `fiscalYearStartMonth` is shown and edited on the company page
  (`apps/web/src/modules/organization/company/CompanyPage.tsx:63, 77, 129`;
  `apps/api/src/platform/organization/organization.service.ts:21, 48-49, 76`) and consumed by no rule
  (`apps/api/src/platform/organization/organization.model.ts:30`). HR's yearly series use the UTC year
  (`apps/api/src/modules/hr/recruitment/applicants/applicant-sequence.ts:31`;
  `apps/api/src/modules/hr/recruitment/job-offers/offer-sequence.ts:29`;
  `apps/api/src/modules/hr/recruitment/job-requisitions/job-requisition-sequence.ts:33`;
  `apps/api/src/modules/hr/training/sessions/session-sequence.ts:33`).
- **Options** **A** calendar, Cairo date (S). **B** fiscal (S–M; its first consumer). **C** no reset (S).
- **Recommendation** A.

### 16.11 G — Numbering, documents, exports, notifications, rollout

#### OD-58: Document numbers (P2)
- **Q** What format, given when, one series or per branch, gap-free, and how do cancelled numbers show? Arabic: ما شكل
  أرقام المستندات ومتى تُعطى؟ وهل المسلسل واحد للشركة؟ وكيف تظهر الأرقام الملغاة؟
- **Evidence** No sequence service exists: one was planned (`docs/02-architecture/platform-core.md:212-214`) and never
  built (no sequence directory under `apps/api/src/platform/`). Gap-free only inside the transaction
  (`apps/api/src/modules/fleet/custody/custody-counter.model.ts:4-9`); per-branch series collide on moves
  (`apps/api/src/modules/atm/branch-links/branch-move.service.ts:466-490`).
- **Options** **A** `<PFX>-{YYYY}-{seq:6}`, organization-wide, given on leaving draft (S; the transaction that numbers a
  document writes its series' counter first and holds it until commit, so same-series submissions and postings wait on
  each other, RK-33). **B** per branch (S; numbers collide when a branch moves, but documents of different branches no
  longer contend for one counter). **C** at draft (S; gaps).
  - *Cancelled numbers:* **(i)** they stay listed, and a cancelled document's paper prints «ملغى» (S; §2.8, §11.6.6).
    **(ii)** hidden from default lists (S; a gap readers cannot explain).
  - Prefixes are decided here; paper form codes are OD-59.
- **Recommendation** A; B only if RK-33's P5 measurement misses §18.3.2's threshold (a miss of §18.3.3's P7
  threshold splits counts by category scope instead, OD-48). Cancelled numbers (i). A supplier's delivery-note number
  warns on repeat, never blocks, by analogy with ATM's S-7, "Duplicate seals/QRs WARN, never block"
  (`docs/12-planning/atm-settlements-phase1.md:145`).

#### OD-59: Printed papers and signatories (P3; P2 if PRs are printed)
- **Q** Which documents are printed and signed, by whom, in whose wording, with which form codes, how is a reprint
  marked, and who maintains the signatories' names? Arabic: ما المستندات المطبوعة ومن يوقّعها؟ وهل نلتزم بنص النماذج
  الحالية؟ ومن يحدّث أسماء الموقّعين؟
- **Evidence** Snapshot, print, signed copy (`apps/api/src/modules/it/consumables/consumable-memo.service.ts:33-134`);
  signatures snapshotted per paper (`apps/api/src/modules/fleet/custody/custody-papers.service.ts:104-114`). Fleet keeps
  its report signatories as organization-scope settings, edited on the generic screen
  (`apps/api/src/modules/fleet/fleet.settings.ts:57-103`); ATM writes its settings through a module key at organization
  scope (`apps/api/src/modules/atm/shared/settings-authority.ts:21-32`). Verbatim owner wording needs a fifth exempt
  file: `VERBATIM_PAPERS` lists four, HR's hiring papers the latest (`scripts/check-formal-arabic.mjs:153-158`; OD-68).
- **Options** **A** PO, GRN and issue papers are records (`print` keys; counted; each print audited under the module's
  own verb `administrationPrint` with `paper` and `printNumber`, which the `exportSpike` signal does not count, since it
  counts only `export`, `apps/api/src/platform/audit/audit.signals.ts:129-142`; §10.2, §11.6.6); other papers, the
  RFQ's first, ride `.view`; formal Arabic; signatories from settings (S). **B** owner wording verbatim (S; a spec
  change). **C** none (S).
  - *Who maintains signatory names:* **(i)** `setting.edit` holders on the generic settings screen, as in Fleet (S; the
    same bypass OD-18 notes). **(ii)** a module key at organization scope through the module's own card, as in ATM
    (S–M; this design's only settings key, `administrationProcurementPolicy.manage`, arrives at P4, or P3 under
    OD-23 A). **(iii)** a module screen whose row and route ride the platform's `setting.edit` itself, as Operations'
    «إدارات العمليات» does (`apps/api/src/seed-navigation.ts:705-719`;
    `apps/web/src/modules/operations/routes.tsx:123-131`) (S; no module key and nothing to bypass, but every `setting.edit`
    holder maintains the names, and the route gates on a platform key, which §13.4 rule 3's module-keys-only check would
    have to allow).
  - *Approval lines:* **(i)** decided rungs print as electronic lines (rung, decider, date); wet signatures only for
    hand-over acts: receipt, issue, dispatch and the count result (S; each decision stores its rung's label and the
    decider's name, which no engine host stores today, §11.6.4). **(ii)** every approver also signs
    (S; papers wait for signatures).
  - *Who signs a stock issue:* its recipient, as on IT's memo, "the paper an employee signs for what they are issued"
    (`apps/api/src/modules/it/consumables/consumable-memo.model.ts:1-2`) (S; §11.4).
  - *Transfer receipt notes:* **(i)** one signed note per delivery (M; one more numbered document and series, with a
    collection, a counter and a paper, for what a receipt act on the transfer already records with its own audit row;
    §11.4). **(ii)** one cumulative note, filed again after each receipt (S; earlier signatures become history no
    screen lists).
  - *Withdrawing a signed copy:* **(i)** a replace keeps history; withdraw is refused once the PO is `closed`, once a
    live handoff cites the document, and on a filed handoff memo; a replace after hand-over needs an audited reason (S;
    §11.4). **(ii)** a filed copy is final (S; a wrong scan stays).
  - *Print marks:* only decided rungs print; a draft prints only as an unnumbered «مسودة» preview; a paper of record
    prints «أصل», then «نسخة رقم n», and a cancelled document «ملغى» (§11.6.6).
  - *Form codes:* a code and title tell apart the two papers that share one number (RFQ, transfer, count; §11.6.1); the
    codes come from the owner's forms (OD-68), else none.
- **Recommendation** A (§11.6); signatory names (i), with defaults that name offices only and a keeper block taken from
  the warehouse's keeper (OD-10); approval lines (i); the stock issue signed by its recipient; receipt notes (ii), the
  cumulative note (§11.4); withdrawal (i); the print marks as listed.

#### OD-60: Exports (P2; Phase 1 only on the owner's request)
- **Q** Must exports of stock, prices and values be audited server exports, and does Phase 1 export anything? Arabic:
  هل تُصدَّر الأرصدة والأسعار من الخادم مع تسجيلها في التدقيق؟ وهل تحتاج المرحلة الأولى إلى تصدير؟
- **Evidence** Screen exports are unaudited (`apps/web/src/modules/fleet/lib/fleet-sheet.ts:28-50`); "a server-side export
  is the only kind that is audited" (`apps/api/src/modules/atm/register/register-export.ts:1-3`). The first register
  with an export is P2's purchase requests (§14.5); Phase 1 has none unless the owner asks (OD-60.1). Two client
  exports already carry money: Fleet's vehicle supply contracts
  (`apps/web/src/modules/fleet/components/VehicleContractsExport.tsx:53, 97, 112-118`) and Operations' captain and bank
  reports, which export exactly the table on screen
  (`apps/web/src/modules/operations/lib/report-export.ts:1-16`).
- **Options** **A** server CSV under `.export` keys for registers with money or stock (RFQ P3, PO P4, stock and GRN P5,
  invoices P8); client Excel under `.view` otherwise, from P2's PR register (M). **B** client only (S; unaudited egress).
  **C** server only (M; a register's export waits for its `.export` key, and this design names five).
  - *OD-60.1, Phase 1:* **(i)** no export (S). **(ii)** a client Excel of items, warehouses and suppliers under
    `.view` (S; the shared export walk moves first, §18.1).
  - *OD-60.2, a register with no export key that outgrows the client walk* (purchase requests, MRs, issues, transfers,
    counts; the walk stops at 20,000 rows without saying so, §11.7, §14.9): **(i)** the client export stays, filtered
    under the cap, and a register the owner names gets a server export with a key of its own in its phase (S each; one
    more key per register, §14.7). **(ii)** each such register gets a server export from its phase (M; five more
    keys).
- **Recommendation** A (§11.7); OD-60.1 (i); OD-60.2 (i).

#### OD-61: Notifications, reminders, automation (P2; digests need PX-2)
- **Q** Who is told what, which reminders run, which category applies, and is automation in scope? Arabic: من يُبلَّغ
  بكل خطوة؟ وما التذكيرات؟ وهل نستخدم الأتمتة؟
- **Evidence** Recipients are users or key holders (`apps/api/src/platform/notifications/notification.service.ts:37-41`);
  categories are a closed opt-out list (`packages/contracts/src/platform/notifications.ts:8-19`). Automation is off by
  default (`apps/api/src/infrastructure/config/env.ts:95-103`) and may never own entity state
  (`docs/03-decisions/ADR-018-automation-engine.md:38-41`). A reminder rides a notification idempotency key, once per
  recipient and key (`notification.service.ts:226-231`); an announcement made once per date whatever its recipients needs
  PX-2's marks (§2.7).
- **Options** **A** approvers, requester, keeper, procurement; `approval` and `workflow` categories; daily reminders and a
  low-stock digest; no automation (M). **B** A with an `administration` category (S; contracts change; separate
  opt-outs). **C** later (S).
  - *Level alerts:* the at-or-below-minimum crossing event is immediate (§8); a daily reorder alert per (warehouse,
    item) and the digests need PX-2's marks.
  - *Deep links:* a notification about a record without a page of its own (a quotation, a line) carries its parent
    document's `entityRef`, the RFQ's for a quotation, and `ENTITY_ROUTES` gains entries only for entity types with a
    detail route (§8.6, §13.4 rule 4).
- **Recommendation** A; B for separate opt-outs.

#### OD-62: Names and menu (P1a)
- **Q** What are the module's names and menu labels, which spelling, how is the menu grouped, when do its sections
  arrive, and which picture does its launcher tile wear? Arabic: ما اسم القسم ومسميات صفحاته في القائمة؟ وأي إملاء
  نعتمد: «الشئون» أم «الشؤون»؟ ومتى تُقسَّم صفحاته إلى مجموعات؟ وما الصورة التي تظهر على مربع القسم؟
- **Evidence** An `Administration` / «الإدارة» category holds System Administration, matched by English name
  (`apps/api/src/seed-navigation.ts:1301-1308, 1414-1431`). The product writes «الشؤون الطبية»
  (`apps/web/src/platform/localization/i18n.ts:18855`). «الشئون الإدارية» is the owner's own spelling; the repository
  holds the department only in test fixtures, once so (`apps/api/tests/integration/org-catalog.spec.ts:276`) and once
  without the hamza, «الشئون الادارية» (`apps/api/src/org-catalog-migration/plan.spec.ts:236`). The platform size
  snapshot lists the module as still to come, «الشؤون الإدارية» — «المشتريات والمخازن والخدمات»
  (`docs/12-planning/platform-size-snapshot-2026-09.html:681`).
- **Options** **A** one category "Administrative Affairs" / «الشئون الإدارية» after ATM; sections later (S). **B** two
  categories (S). **C** A plus renaming the system category «إدارة النظام» (S; a separate change).
  - *When sections arrive:* **(i)** later: Phase 1 renders every row flat under the category, and §13.2's two sections
    arrive at a phase the owner names; a natural trigger is the phase in which a section would hold more than one row
    (P2 for Procurement) (S; §13.2). **(ii)** now: Warehouses with P1a.W, Procurement with P1b.W's supplier row (S; the
    section entry goes before `HR: [`, §13.2).
  - *Labels:* the row labels belong here, with their terms from OD-67 (§13.3). The launcher tile's glyph is OD-62.1;
    the row glyphs (`box` for Items, `warehouse` for Warehouses) are the design's (§13.3).
  - *OD-62.1, the launcher tile's picture:* the owner personally chose the tiles of Operations, Organization, Gold Vault and ATM
    and asked that each say its department, «عايز كل أيقونة تكون بتعبر عن اسم الإدارة»
    (`apps/web/src/platform/navigation/module-icons.spec.ts:3-4, 68-72`); a box shows the stores, while the department
    later takes on facilities and office services (§13.1). **A** a box, for the stores (S; a new `BoxIcon`, §13.1).
    **B** another picture the owner names (S; one new glyph, worn by no other tile).
  - *One row over several screens* (a sidebar row may open on any of several keys, listed in
    `packages/contracts/src/platform/navigation-hubs.ts`: a hub is one row over a page of tabs, each tab on its own key, as
    HR's «الإعدادات»; a shared row is one screen two grants open, as Operations' «تقرير البنوك»): **(i)** one row per
    screen, the home row on `administrationItem.view` alone, as IT's home stays on `itAsset.view` after its own key split,
    and reports reached from their registers and the home page (S; §13.3). **(ii)** a «الإعدادات» hub over the
    configuration screens, units and categories and, from P3 or P4, the procurement policy, each tab on its own key (M; a
    platform contracts entry, a hub layout and its routes after `apps/web/src/modules/hr/settings/`; decided before those
    rows ship, or their rows are `retired` and their addresses redirected, §13.3). **(iii)** a «التقارير» hub over the
    report pages, each tab on its §14.5 key (M; the same pieces). **(iv)** the home row as a shared row, shown to a holder
    of any of the module's register keys (S; one contracts entry, grown each phase).
- **Recommendation** A; sections (i); one row per screen (i), a hub only on the owner's request, as HR's was;
  the tile picture OD-62.1 A, a box.

#### OD-63: Opening balances (P5)
- **Q** From which counted source and date, with or without cost, approved by whom, loaded how? Arabic: ما مصدر
  الأرصدة الافتتاحية وتاريخها؟ ومن يعتمدها؟
- **Evidence** IT loaded once, one movement per item (`apps/api/src/modules/it/go-live/consumables-opening.ts:7`), under
  a versioned run key (`:77-78`); ATM previews and applies with an audited override
  (`apps/api/src/modules/atm/register/import/register-import.service.ts:106`).
- **Options** **A** an in-app document per warehouse, posted by a second person (M). **B** a go-live file (S). **C**
  adjustments (rejected). Under every option an opening balance is the first movement of its (warehouse, item) row,
  refused once the row has moved (`lastMovementAt: null` in the leg's filter, else
  `ADMINISTRATION_OPENING_BALANCE_NOT_FIRST`, §2.4.4), and its legs are stamped at posting like any other (OD-74 A).
  At go-live each warehouse's opening balance is posted before its first other posting (§15.3.5 c); a row that moved
  first takes its opening stock through an approved `adjustmentIn` (OD-52; P5 under §18.1 A11).
- **Recommendation** A; B for one counted file.

#### OD-64: Workforce-reset classification (P1a; names at P2)
- **Q** On a workforce reset, are records naming employees kept or purged, and when an employee is permanently deleted,
  may their name stay on the module's records? Arabic: عند إعادة تهيئة بيانات العاملين: نحتفظ بالسجلات التي تذكرهم أم
  نحذفها؟ وعند المسح النهائي لموظف: هل يبقى اسمه على طلبات الشراء وأذون الصرف ومحاضر الجرد وسجل الاعتمادات؟
- **Evidence** Unclassified employee paths stop the reset (`apps/api/src/workforce-reset/targets.ts:15-25`), and `keep`
  writes nothing, not even to clear a reference (`targets.ts:28-38`); IT purges its memos (`targets.ts:195`).
- **Options** **A** `keep` all seven (§2.1) (S). **B** purge person papers (S; orphans ledger sources). **C** purge all
  (S; it would delete the warehouse rows the ledger cites).
  - *The warehouse keeper after `keep`:* **(i)** the screen flags a keeper id that resolves to nobody until one is named
    again (S; §2.1). **(ii)** warehouses store no keeper at all (S; the coherent alternative to `keep`, §19.2).
  - *Names on kept records under HR's permanent delete* («مسح نهائي», `employee.purge`), which rewrites a purged
    person's name copies on `keep` collections and fails CI on any unclassified `*name` path there
    (`apps/api/src/modules/hr/employee-management/employees/employee-name-copies.ts:235-275`): **(i)** the names stay
    (S; the name stays on requests, issues, returns, counts and approval trails, though HR's delete removes it
    elsewhere). **(ii)** they are removed where HR's delete reaches them: from P2, each single-person name is stored
    where HR's scrub rewrites it (the storage shape is D-22), and names inside lists, a count team and the approval
    trail, stay, a recorded gap (S–M; RK-34). **(iii)** they are removed everywhere, lists included (M; HR's scrub
    learns positional updates, an HR-module change). Moving from (i) to (ii) after P2 would rewrite posted documents, a
    class-3 backfill (§15.3.7).
- **Recommendation** A; keeper (i); names (ii) from P2, the names inside lists a recorded gap (RK-34).

#### OD-76: Required attachments and accepted formats (P1b if OD-11 keeps supplier papers, else P2)
- **Q** Which files must exist before which step, which formats are accepted, and may files be added after submission?
  Arabic: ما المرفقات الإلزامية قبل كل خطوة؟ وما صيغ الملفات المقبولة؟ وهل تُضاف مرفقات بعد الإرسال؟
- **Evidence** Categories enforce MIME and size on every upload (`apps/api/src/platform/files/file.service.ts:194-200`),
  the generic `POST /platform/files` included (`apps/api/src/platform/files/file.routes.ts:99-105`), but no category can
  require a file: a required attachment is a module check (§11.4). A pending scan blocks reads
  (`file.service.ts:48-58`). A category's rules are fixed when it is first ensured, and the supplier-papers category is
  ensured in P1b (§11.1, §11.2).
- **Options** **A** a file per quotation; evidence for write-offs (S). **B** none (S; a weaker trail). **C** files at
  every step (S; blocks work).
  - *Formats:* **(i)** PDF and images only, previewable in the browser (S). **(ii)** Office files also accepted for
    quotations (S; download-only, a macro risk).
  - *After submission:* **(i)** files are added only while the document is a draft; an approver who needs one returns
    the document (OD-72 B) (S). **(ii)** files may be added while pending, as HR leave does
    (`apps/api/src/modules/hr/leave-management/leave-requests/leave-request.service.ts:1032-1041`) (S; the approver may
    decide on a changing file set).
- **Recommendation** A; a pending scan satisfies, a blocked file never. Formats (i); after submission (i) (§11.4).

#### OD-77: Retention (P1b if OD-11 keeps supplier papers, else P2)
- **Q** How long are documents and files kept, and may any be purged? Arabic: ما مدة الاحتفاظ بالمستندات ومرفقاتها؟
- **Evidence** `retentionDays` is stored and never enforced (`apps/api/src/platform/files/file-category.model.ts:22`);
  audit "has NO delete path" (`apps/api/src/platform/audit/audit.retention.ts:1-3`); a category's value is fixed when it
  is first ensured (§11.1).
- **Options** **A** keep everything (`retentionDays: null`) (S). **B** periods set with Finance, recorded on the
  categories (S; an operator `PATCH` per category; no job enforces them). **C** a purge job (L; a platform capability and
  an ADR; posted documents and the ledger never purge, D-2).
  - *Splitting a category:* if procurement papers and store papers get different periods,
    `administration-signed-papers` splits before its first store paper (P5), and preferably before P3 (§11.2).
- **Recommendation** A, then B once Finance names the periods.

#### OD-78: Ready-made roles (P1a, P1b; the found line P7)
- **Q** Which ready-made roles should the module offer (a storekeeper, a procurement officer, a count team, …), or are
  all roles left to administrators? Arabic: هل نُنشئ أدوارًا جاهزة كأمين المخزن وموظف المشتريات، وما هي؟
- **Evidence** New keys reach only super-admin (`apps/api/src/platform/rbac/rbac.service.ts:599`), so without
  ready-made roles an administrator grants every key by hand. How ready-made roles are kept (re-asserted at every boot,
  as managed roles are, `apps/api/src/platform/rbac/rbac.service.ts:1625-1656`, or seeded once) is D-20.
- **Options** **A** §6.5's bundles as ready-made roles (S). **B** none (S; slower rollout).
  - *The count team's found line* (§4.3.6: a found item is picked through the `ItemPicker`, which admits
    `administrationItem.view` or a document's create key, §13.6 D; the count-team bundle holds neither): **(i)** the
    bundle also holds `administrationItem.view`, which shows the catalog and no quantity (S). **(ii)** the picker also
    admits `administrationStockCount.count` (S; one more key in the picker gate, §7.1).
- **Recommendation** A; the found line (i).

#### OD-79: First reports and report access (P5)
- **Q** Which reports come first, is a report-only reader key wanted (§6.2), and are scheduled e-mailed reports
  needed? Arabic: ما التقارير المطلوبة أولًا؟ وهل نحتاج صلاحية لقراءة التقارير وحدها؟ وهل تُرسل دوريًا بالبريد؟
- **Evidence** Reports are derived reads. A Reports Engine was planned (`docs/02-architecture/platform-core.md:202-210`)
  and never built: no reports service exists under `apps/api/src/platform/`. The item card is P5 and the module
  dashboard P9 (§18.2). The dashboard is §14.2–§14.3's board of the tiles the owner's request lists, and a role sees
  the figures its grants leave non-null, so it asks nothing here. Reports ride the view keys of what they show; Gold,
  ATM and HR give their reports a key of their own (§6.2).
- **Options** **A** §14.5 by phase, on demand, under the view keys (S each). **B** a report key per family (S; one
  report key per family in §6.2's table, a `…Report` resource with `view`, as Gold, ATM and HR do). **C** scheduled
  e-mail (M; a job and templates).
- **Recommendation** A.

#### OD-80: Rollout (before the module's roles are assigned in production; no code)
- **Q** Does the module start in all branches at once, or in a pilot branch first? Arabic: هل يبدأ التشغيل في كل
  الفروع أم في فرع تجريبي؟
- **Evidence** ATM's Settlements phase 1 started with one bank, Al Baraka (S-10,
  `docs/12-planning/atm-settlements-phase1.md:1, 148`): a pilot by bank, an analogy for a pilot by branch. A pilot needs
  no code: the module's pages show only to holders of their keys, so roles given in one branch make that branch the
  pilot. How unfinished work is hidden (no gate, an environment gate or a feature flag) is D-19: "only SHIPPED pages
  appear in navigation" (`apps/api/src/seed-navigation.ts:900-903`), and the flag machinery exists
  (`apps/api/src/platform/settings/settings.registry.ts:34`; `apps/api/src/platform/settings/settings.service.ts:284-292`;
  `scripts/check-flag-expiry.mjs:3-18`), but the catalog is empty (`packages/contracts/src/flags/index.ts:19-23`), so
  no feature evaluates a flag.
- **Options** **A** all branches at once (S). **B** a pilot branch first, the others on the owner's word (S; the
  module's roles are given in the pilot branch only).
- **Recommendation** A, or B if the owner wants a pilot; neither changes the code, so the answer is needed only before
  the module's roles are assigned in production (D-19), not before P1a.1.

#### OD-81: Pull requests per phase (before P1a.1)
- **Q** May a phase be delivered as several smaller pull requests, each on its own branch and each reviewed in full and
  green before the next (six for Phase 1, §19.1), instead of the one pull request per phase the owner's request sets?
  Arabic: هل يجوز تسليم المرحلة الواحدة في عدة طلبات دمج (pull requests) أصغر، يُراجَع كل منها كاملًا وينجح فحصه قبل
  التالي، بدل طلب دمج واحد لكل مرحلة؟
- **Evidence** The owner's request sets, «لكل Phase», one branch, a full-diff review, one pull request and green CI
  before the next phase. BD-006 asks one capability per sprint (`docs/01-domain/business-decisions.md:121-133`);
  "> ~500 changed lines should be split" (`docs/09-guides/development-workflow.md:67`; `CONTRIBUTING.md:53`); the
  sizes of earlier module pull requests are in §18.4. How the review is done is the owner's own rule and is not asked
  again; the CI split is D-18 (PX-3).
- **Options** **A** several pull requests per phase, IT-style slices (S; each one small enough to review in full).
  **B** one pull request per phase, the owner's current rule (S; a Phase 1 pull request of every slice at once is hard
  to review). **C** pull requests of at most about 500 changed lines (S; coupled files break, §18.4).
- **Recommendation** A.

#### OD-82: Audit verb for approval decisions (P2)
- **Q** Is an approval decision audited under its own verb, or as a generic status change? Arabic: هل يُسجَّل قرار
  الاعتماد بفعل خاص في سجل التدقيق؟
- **Evidence** Leave has its own `leaveDecision` verb (`packages/contracts/src/platform/audit.ts:38`), and HR attendance
  has three decision verbs, `attendanceDecision`, `attendanceDecisionApproval` and `attendanceDecisionRevoke`, a
  manager's decision being "a different act from an employee requesting a correction and [one that] must be filterable
  on its own" (`:148-154`); "a dispute … is settled by filtering the trail on the act"
  (`packages/contracts/src/platform/audit.ts:80-83`). `accept`, `reject`, `deliver` and `checkOut` carry other
  modules' labels and are never reused (§10.3).
- **Options** **A** a new `approvalDecision` verb with en/ar labels (S; §10.2; a contracts append that ships ahead of
  its first writer, §18.1). **B** `statusChange` on the settling rung, `update` on the others (S; the payroll
  precedent; harder to filter). **C** `update` everywhere (S; least filterable).
- **Recommendation** A.

#### OD-83: Page frame (P1a)
- **Q** Do list pages fix filters and scroll only the table, as Fleet, ATM, IT and System Administration do? Arabic:
  هل نثبّت الفلاتر ويتحرك الجدول وحده، كشاشات الحركة والصراف وتقنية المعلومات وإدارة النظام؟
- **Evidence** The owner asked for this frame in Fleet, then ATM, then on 2026-11-17 on IT's boards and on every page of
  the System Administration menu (`apps/web/src/shared/ui/board-scroll.ts:1-15, 46-55`): `PageContainer fullHeight` is
  in 73 module pages and `BOARD_FRAME` in 59, in six modules (35 and 28, in Fleet and ATM only, at `b03522f`), and 37
  of 71 list pages are plain (54 of 69 at `b03522f`, §13.6); IT's registers, this module's references (§13.5), now
  wear it. Whether `Fact`, `Tabs` and `ReferencePicker` move to `shared/ui` or are rebuilt in the module from IT's
  pattern is D-21, not this entry: `Fact` is declared separately in 13 module files (for example
  `apps/web/src/modules/it/pages/AssetDetailPage.tsx:74`), and Phase 1's `ItemDetailPage` and `SupplierDetailPage`
  (§19.5) are this module's first consumers of `Fact`, and `CatalogsPage` of the tablist.
- **Options** **A** plain `PageContainer` (S; as 37 of 71 list pages are). **B** the board frame on registers (S;
  `BOARD_FRAME`, `stickyHead`).
- **Recommendation** B, applied as the default unless the owner objects: the owner has asked for this frame module by module,
  in Fleet, ATM, IT and System Administration, and the IT pages this module follows wear it (§13.5, §13.6); A only if
  the owner wants this module's registers to scroll as one page.

#### OD-85: Volumes and success measures (P5)
- **Q** How many warehouses, items and stock documents a month are expected, how many keepers post at the same time,
  and how will the owner judge the module a success? Arabic: كم مخزنًا وصنفًا نتوقع، وكم مستندًا مخزنيًا في الشهر؟
  وكم أمين مخزن يسجّل في الوقت نفسه؟ وبأي مقياس نحكم على نجاح الموديول؟
- **Evidence** The owner's request names the cycles and the phases, but no volumes and no measure of success (§0).
  The design's capacity assumptions stand in for the figures (§2.4): at most 30 warehouses, 5,000 items, 3,000 stock
  documents a month, 100 lines a document and 5 postings a minute in one series. RK-33 measures a 100-line posting in
  P5 and a count's start and posting in P7, against the thresholds of §18.3.2 (P5) and §18.3.3 (P7), which the phase's
  re-detail re-sets if this entry's figures differ. Phase 1's exit criteria are CI, scope and the owner's acceptance on
  staging (§19.10).
- **Options** **A** the owner gives the figures and the measures of success now (S; the assumptions are checked
  against them before P5). **B** the design's stated assumptions stand until P5 measures them (S; success is judged
  only at each phase's acceptance).
- **Recommendation** A, with B's assumptions as the defaults until the owner answers.

### 16.12 Decision log

Each answer is recorded here when it is given: the entry or sub-question, the option chosen, the date and the owner's
words in «». An answer that changes this design is applied as a revision (§22).

| OD | Answer | Date | Owner's words |
|---|---|---|---|
| OD-01…OD-85, every entry and sub-question | its recommended default, as each entry states it (conditional defaults as stated), as the working answer | 2026-11-24 | «بص اعمل انت الـ Recommendations من عندك دلوقتى وبعدين نبقى نعدل» |
| OD-68 | B: typed by hand through the screens; no go-live file load in Phase 1 | 2026-11-24 | «لأ خلينا من غير شيتات او بيانات دلوقتى» |
| Delivery (Status, §18) | one phase at a time; each phase is closed, its exit criteria met and the owner told, before the next starts | 2026-11-24 | «وامشى Phase واحده وبعد ما نقفل كل واحده ندخل على اللى بعدها» |
| RK-09, the zod waiver | renewed for 30 days, to 2026-12-26; the zod 4 migration stays its own change | 2026-11-24 | «موافق على Zod» |
| Phase 1's readings (the close report of 2026-11-25; §22, "P1a.2 built" to "Phase 1 closed") | kept as built: a retire or bring-back re-files no item; stock levels whole numbers 0 to 1,000,000 in order; the item unit editable until P2 or P5; no new warehouse in a closed branch; a warehouse names an active department of its own branch; a keeper from another branch allowed; top-bar filing (ADR-028); tax numbers compared as typed and a repeat only warned; VAT status hidden until OD-29; a retired supplier's papers list open; role titles §6.5's candidates (OD-67) | 2026-11-25 | «موافق على كل التوصيات، كمّل» |
| PXQ-1 (PX-1 re-detail §2), a leave request nobody can approve | (1): it goes to HR, down leave's manager and HR path at submission and to HR for the remaining steps after earlier approvals; applied in an HR slice of its own after PX-1.6, option 3 holding until then | 2026-11-25 | «موافق على كل التوصيات، كمّل» |
| PRQ-1 to PRQ-4 (P2 re-detail §2) | each its recommendation: PRQ-1 (1), a returned PR keeps the lowered quantities and a line cut to nothing is removed; PRQ-2 (a) 1 and (b) 1, the procurement manager hears of approvals and the override holders who reach every rung left and can open the PR hear of a stuck one; PRQ-3 (1), no PR roles in production before P4; PRQ-4 (1), a different person settles each empty level | 2026-11-25 | «موافق على كل التوصيات، كمّل» |

---

## 17. Risks

Likelihood (L) and impact (I) are H / M / L, judged before mitigation. Owners: **Module** — this module's delivery
slices; **Platform** — a platform slice; **Owner** — a §16 decision; **Repo** — CI and repository governance;
**Ops** — deployment.

**Act first:** RK-09 (§18.1).

| # | Risk (evidence) | L | I | Mitigation | Owner |
|---|---|---|---|---|---|
| RK-01 | **CI time budget.** One job, 45-minute ceiling (`.github/workflows/ci.yml:16`), raised from 30 after a green run took 29m41s on 2026-11-07 and the next was cancelled at 30m13s with every test passing (the workflow's own note, `:11-15`); earlier green runs took about twenty minutes (16–24; API tests about 17). 154 of the 167 integration files start a replica set and 148 of them boot every manifest (118 and 112 of 118 at `b03522f`), so from P1 the module's seed, its index step included, runs in each. A timeout fails every pull request in the repository, as RK-09 does. | H by P5 | H | Rules as pure functions with unit specs; few integration files, each covering many cases; concurrency tests only where they test an invariant; a light, create-if-missing seed; each phase's pull request reports its CI minutes; PX-3 before P5 (PC-9; D-18, split the job). | Module, Repo |
| RK-02 | **Lint does not enforce module isolation.** `modules → modules` is allowed (`eslint.config.js:73`), and the element-types rule does not stop the imports it disallows: 120 files under `apps/api/src/modules` import `infrastructure/` (116 without specs; 107 and 105 at `b03522f`), although the rule lists no such edge. | M | H | A module-local spec refusing `../hr/`, `../it/`, `../fleet/` imports (Fleet `drivers-are-derived.spec.ts:108-116` precedent; §19.7); boundary files only by ADR; the pull-request checklist. | Module |
| RK-03 | **Indexes absent in production** (§15.3.2): `autoIndex` is off and the deploy step only reports until `INDEX_SYNC_MODE=apply`, so document numbers can repeat and a warehouse × item can get two balance rows. | H if unbuilt | H | The seed's index step first (D-16), through the shared `syncDeclaredIndexes`, its report logged; every module repository whose collection carries a `ux_*` index awaits `collectionReady` before its first write and before any transaction that writes it, so a failed build refuses that write and the next write retries (§15.3.2); module specs that the model list is complete and that a repository's first write awaits its collection; the deploy step switched to apply. | Module, Ops |
| RK-04 | **Index options wrong for late-numbered documents.** A non-partial unique number breaks the second draft, and Mongoose never repairs it — the job-offers production incident (`code-index-migration.ts:1-12`). | M | H | Partial `{$type}` filters for numbers given after draft (OD-58); options reviewed once before P2. | Module |
| RK-05 | **Reliable delivery is at most once per failing handler.** The dedup row precedes the handler (`event-bus.ts:100-109`); a `failed` status is declared but never set (`outbox.model.ts:14, 27`), and `relayOutbox` marks a row `dispatched` once it is enqueued (`event-bus.ts:115-137`). HR's exit event is in-process and emitted before the employee is saved, carrying `effectiveDate` (`employee-action.service.ts:771-780`). | M | H | The Finance handoff is a persisted module record with a signed memo (OD-55, recommended default: D); its reliable event, only a nudge, is built with its first consumer (§12.11); idempotent, non-throwing handlers; PC-1 before the first reliable event with a cross-module consumer (P5 under OD-02 C or OD-65 B; otherwise the handoff event's first consumer); exit flags (OD-44) re-derivable by a report; a destructive effect of an exit, such as OD-44 A's draft cancellation, runs from a daily sweep that reads the directory, never from the event, which fires before the save. | Platform, Module |
| RK-06 | **Live updates miss branch keepers and requesters.** `record()` never passes `branchId` (`audit.service.ts:181-185`); named verbs, `activate` and `deactivate` included, do not broadcast (`packages/contracts/src/platform/realtime.ts:19-31`); own scope joins no room. | H | M | An `update` signal with `branchId` after commit on every audited act of a branch-scoped entity, whatever its verb (IT `signalConsumable`); transfers signal both branches; postings also signal `administration.stock` once per touched branch; a spec pinning pairs and signals (`consumable-history.spec.ts`); requester refresh on `staleTime` and navigation, then from notifications once PC-7 lands (D-11). | Module |
| RK-07 | **Formal-Arabic false positives.** The repository's own `offendersIn` (`scripts/check-formal-arabic.mjs:183`) flags «مفارش», «مفرش», «بيضاء», «هيدروليك», «بيبسي», «مشمش» as dialect morphology, «اتلاف» by the passive اتـ rule (`:55-58`), and «ارصدة», «ادارة», «إجمالى» as misspellings (`:106-114`); `VERBATIM_PAPERS` is pinned to four files (`formal-arabic.spec.ts:101-109`). | H | L | Spelling only, where these words are used: «إتلاف», «أرصدة», «إدارة», «إجمالي» pass (the stock-adjustment term itself is §0.4's candidate, OD-67); item names are data (the database, `*.seed.ts` and `assets/` are not scanned, though seeded templates still get review); add a genuinely formal word to `FORMAL` one at a time; verbatim papers via OD-59 and a spec change. | Module |
| RK-08 | **Signed money cannot be typed.** `MoneyInput` never accepts a minus (`shared/lib/money-input.ts:25`) and `money-input.spec.ts` bans `type="number"` amount inputs, while `MoneyAmountSchema` accepts signed values (`hr-payroll-money.ts:134-141`). | H | M | Direction is always its own field (gain/loss, in/out, credit/debit) over a non-negative amount; values computed server-side (quantity × unit cost, OD-37) and shown with `formatMoney`; quantities likewise positive with a derived direction. | Module |
| RK-09 | **The zod waiver expires 2026-11-26.** `scripts/dependency-audit.waivers.json` (`GHSA-mrhx-c7xc-m3w5`, "Owner-approved (2026-10-27) temporary waiver") is valid through that date; CI compares it with the UTC date (`scripts/dependency-audit.mjs:31, 102`), so from 2026-11-27 the dependency audit (`.github/workflows/ci.yml:78-79`) fails every pull request, documentation ones and this design's own included. The remedy is the monorepo zod 4 migration (the fix starts at zod 4.6.6). | H | H | Act now, separately from this module: the owner renews the waiver under review, or schedules the zod 4 migration to land before the date; §18.1 makes it the first prerequisite of any pull request after 2026-11-26. Module contracts use only the contracts' existing idioms, so they add nothing to the migration. | Repo, Owner |
| RK-10 | **Approval-engine defects** R1–R5 (§15.2.1), R8 and R9, and the engine's two defaults, "no chain ⇒ approved" and "no staffed rung ⇒ approved". | M | H | PX-1 and its ADR before P2 (OD-20, recommended default: A), the host keeping the per-request pin (`approvalWorkflowId`, `approvalChainShape`); under OD-20 B only, §15.2.1's stopgaps: the R1 refusal comparing the pin with the live chain, and §6.4 item 4's level and override checks (R3, R4); OD-19 (recommended default: A, refuse submission); §6.4's staffing and key checks (R8, R9); OD-21's pairs host-side. | Platform, Owner |
| RK-11 | **Two stock numbers for IT items.** IT runs two ledgers; RAM, SSDs, cables and mice could be stocked twice — the failure ADR-024 names (`ADR-024-minimal-spare-parts-ledger.md:15-19`). | M | H | OD-02 (recommended default: A now): an item lives in exactly one ledger, so Warehouses does not stock IT's families; OD-03 lists the families; the ledger ADR (§20) extends ADR-024, whose boundary clause (`:40-52`) is OD-02 C's precedent for spare parts. | Owner, Module |
| RK-12 | **Duplicate items (the ADR-031 lesson).** Per-branch rows recreate «العمليات» seven times; collapsing them later rewrites references (`ADR-031-org-units-defined-once-declared-per-branch.md:9-31`). Suppliers share the risk. | M | M | One organization-wide master, maintained centrally (OD-04, recommended default: A); stock per warehouse only in balances; generated item codes (OD-05, recommended default: A) and one folded Arabic name per live item: the service stores `nameKey`, the contracts fold of `name.ar` (PC-13), and `ux_name_key`, partial on live rows, is the race guard (§2.1, §2.3.4); server-search pickers so people find before they create (ADR-019); any later merge by operator `--merge` (§15.3.5). | Module, Owner |
| RK-13 | **Cairo versus UTC boundaries.** HR yearly series take the UTC year (`applicant-sequence.ts:31`); cron runs without `tz` (`infrastructure/queue/jobs.ts:207-218`); Operations' days and Fleet's roster cut days in UTC; IT, ATM, HR, Fleet's dashboard and Operations' reports in Cairo. The UTC date lags for the first two hours of each Cairo day (three in summer time), so a 1 January document can take last year's number. | H | M | The module's `shared/cairo-day.ts` over `@ecms/contracts`' shared Cairo calendar (`cairo-date.ts`); the year from the Cairo business date (D-6); movements carry `at` and `createdAt`; reports and sweeps compute days in Cairo; boundary tests around 22:00 UTC on 31 December. | Module |
| RK-14 | **Print tabs inherit the app's CSP.** `script-src 'self'` and `script-src-attr 'none'`: no script or inline handler runs in a paper (`shared/lib/print-window.ts:1-14`); server PDFs need Chromium, installed on the worker only (`docs/09-guides/railway-deployment.md:90-100`). | M | M | Every paper goes through `print-window.ts` with `data-print`/`data-close`, inline CSS, fonts and logo, and joins its spec list; browser print by default; a stored supplier-facing PDF only if OD-31/OD-59 asks, on the worker (HR contracts pipeline). | Module |
| RK-15 | **Scope widens when fields are undeclared** (ADR-026's open item G-2). An undeclared `departmentField` reads organization-wide (`docs/03-decisions/ADR-026-role-administration-guards.md:160-178`; `org-scope-match.ts:79-86`); a delegated department copy reads the whole branch on branch-only collections (ADR-032); `scopeSelector` on an unheld key yields `own`. The defect shipped twice before (`docs/12-planning/cross-module-dependency-audit.md:156-161`). | M | H | D-10 explicit fields on every repository; the shared fail-closed `branchScopeMatch` (PC-12); scoped reads behind `authorize` of the same key; a scope-field guard spec (payroll `department-scope-guards.spec.ts`); integration cases for department-scoped and delegated users. | Module |
| RK-16 | **Navigation name collision.** `'Administration'`/«الإدارة» is System Administration (`seed-navigation.ts:1302`). Categories match on `name.en` (`:1414-1431`), so renaming the module's category after P1 would create a second one: OD-62's English name is effectively permanent. | L | M | OD-62 (recommended default: A, "Administrative Affairs" / «الشئون الإدارية», after ATM) answered before P1a.W; the category outside the spans other specs parse; a nav ↔ route ↔ key spec (Operations precedent). | Module, Owner |
| RK-17 | **Central census specs break on additions** (§15.2.3). | H | L | Each phase's pull request carries an "existing tests and counts that change" table (`docs/12-planning/atm-efficiency-register.md` §10.1 precedent); `check-page-registry.mjs` updated in P1; §18.4's coupling rules. | Module |
| RK-18 | **A fourth supplier list.** `it_vendors`, Fleet's `workshop` and `insuranceCompany` catalog rows, the hard-coded `FLEET_FUEL_CARD_COMPANIES` (`packages/contracts/src/modules/fleet.ts:67, :3601`) and the free-text `supplier` of Fleet's vehicle supply contracts (`apps/api/src/modules/fleet/vehicle-contracts/vehicle-contract.model.ts:65`) already exist. | H | M | OD-01 (recommended default: C): one module registry now, a seam later (PC-3), a merge only through §15.3.5 a; the supplier-registry ADR. | Owner |
| RK-19 | **Fleet spend bypasses stock.** Fleet's custody fund (`modules/fleet/custody/custody-fund.ts:1-12`) pays for parts and tires by receipt, outside any stock record; a second petty-cash book would split cash further. | M | M | OD-66 before P4 (recommended default: A for v1, B as the target); no petty-cash feature in this design. | Owner |
| RK-20 | **Cost centers on issues reverse D-CC-3.** | M | M | OD-41 (recommended default: A, which keeps D-CC-3); B or C amends the record, and who may read cost-center names comes with it (§15.2.2); the read path stays module-gated. | Owner |
| RK-21 | **Event names are permanent; the lexicon is global.** `issued` already means «إصدار», `custody` vault custody (`packages/contracts/src/events/catalog.ts:826, :778`); every cataloged event feeds HR rules and automation. | M | M | §8.2's catalog (`administration.stockIssue.posted`); events declared only with their emitter (`cross-module-dependency-audit.md:99-118`); no per-line or high-frequency events; no sensitive payload fields. | Module |
| RK-22 | **Notifications silently not sent.** `notify()` throws on an unseeded or deactivated template (`platform/notifications/notification.service.ts:112-116`) and callers swallow it (`leave-request.service.ts:710`); the category choice is stored on every notification. | M | M | Every template ensured in the seed; a copy of HR's "every sent template is seeded" spec (`modules/hr/hr.seed.spec.ts`); OD-61. | Module |
| RK-23 | **English refusals in the Arabic UI** (PC-6; services answer in English; the engine's own refusals are untranslated keys, R11). The shared error panel already shows the general Arabic line in place of a message with no Arabic letter (`apps/web/src/shared/ui/states/ErrorState.tsx:35-38`); toasts and form messages still show the English text. | H | L | Module error codes worded in the shared web `FRIENDLY` table, en and ar (IT's and Organization's precedent, `apps/web/src/shared/lib/errors.ts:148-153`, `:10-18`), which the shared error panel and the toasts both read; PC-6. | Module |
| RK-24 | **Exports not branch-narrowed or not audited.** `fetchBlob` omits `X-Active-Branch`; client-side Excel leaves no trail. | M | M | OD-60 (recommended default: A, server CSV under `<resource>.export` for registers with money or stock, with an explicit branch filter); PC-5 before the first server export. | Module, Platform |
| RK-25 | **The audit trail exposes commercial data.** `auditLog.view` reads every module's `changes` with no row scope; masking covers `nationalId` only (`platform/audit/audit.masking.ts:17-18`). | M | M | No bank data (OD-11, recommended default: A). Prices in audit rows are OD-73's audit sub-question (recommended default: (i), prices in clear, because a price trail without prices settles nothing): under it the exposure is accepted, and the holders of `auditLog.view` are the control; (ii) masks them at write time, at the cost of the evidence. | Owner, Module |
| RK-26 | **Approval keys can be delegated per site.** Every key a manager holds is delegable within its reach, and no key is marked non-delegable (`platform/rbac/delegation.service.ts:71-72, 219-240`). | M | H | Acts that must stay organization-wide check organization scope in the service, through PC-12's shared check (written from `atm/shared/settings-authority.ts:12-20`), which a delegated grant never passes; which acts is OD-69 (recommended default: A, §6.7's organization-scope list, top PO bands and write-offs on `organization` rungs; override (i)); key splits only under OD-69 C. | Owner, Module |
| RK-27 | **Lock predicates not widened when states are added.** Payroll added states after `frozen`, but `frozenPeriods()` still matches `frozen` only (`hr/payroll/runs/payroll-run.service.ts:431-432`); counts (P7) and any period lock OD-74 adopts (recommended default: A, no back-dating and no lock; C, a monthly close, with Finance) have the same shape. | M | H | One pure "is locked" predicate per lock, used by every write path, with a spec over all statuses; the count freeze sits in the `$inc` filter of onHand legs (`frozenByCountId: null`), and inTransit legs are not frozen (§2.4.6). | Module |
| RK-28 | **Seeds run concurrently** in the api, the worker, every CLI that boots the platform and all integration suites (`bootstrap.ts:143-145`). | M | M | Create-if-missing only; indexes before counters; duplicate-key-tolerant ensures; no long work in the seed (go-live pattern). | Module |
| RK-29 | **Rolling deploy with a new audit verb.** The audit enum is enforced by the writer (`platform/audit/audit.model.ts:46`), so a worker not yet upgraded rejects jobs carrying a new verb; they wait in the failed set (`infrastructure/queue/jobs.ts:111`). | L | L | Ship a verb in contracts a release ahead of its first writer (OD-82 A's `approvalDecision` first; the print verb `administrationPrint` before the first print of record), or deploy api and worker together. | Ops |
| RK-30 | **Rolling a phase back leaves rows behind.** Redeploying an earlier release re-runs the boot sync, which deletes permissions no longer declared (`platform/rbac/rbac.service.ts:591`) and rewrites super-admin's keys (`:599`), while navigation rows are additive and never removed (`seed-navigation.ts:902`): rows whose keys have vanished stay, and so do the phase's collections, counters, indexes, file categories and templates. | L | M | Each phase's pull request carries a short rollback note: what stays, and what an operator may clean and how; roll forward by preference; any cleanup of data is class 3 (§15.3.7), never a side effect of the rollback. | Ops, Module |
| RK-31 | **A department reference the org-catalog merge cannot see.** `migrate:org-catalog --merge` repoints only paths named exactly `departmentId` or ending in `DepartmentIds` (`apps/api/src/org-catalog-migration/references.ts:51-54`), and reads `Mixed` only in two named carriers (`:10-16, 178-201`); a reference named otherwise, or held in `Mixed`, silently keeps pointing at a retired department. | M | M | §15.3.4's naming rule (§2.1, §7.7), checked in review; `references.spec.ts:188-200`'s exact list catches a new array path, but nothing catches a misnamed scalar, so the rule is a pull-request checklist item. | Module |
| RK-32 | **Procurement policy changed outside the module key (the settings bypass).** The value bands and tolerances are organization-scope platform settings (§15.1), and the settings service authorizes every write by the platform key `setting.edit` and its scope (`apps/api/src/platform/settings/settings.service.ts:179-200`). Any `setting.edit` holder at organization scope can therefore change them through the generic `PATCH /api/v1/platform/settings/values` (`apps/api/src/platform/settings/settings.routes.ts:19-25`) without `administrationProcurementPolicy.manage`, and the audit records only `platform/setting` (`settings.service.ts:249-259`); `platform-admin` holds every platform key (`platform/rbac/rbac.service.ts:602-604`). | M | H | The declaration's Zod schema carries every domain check; an object value is read-only on the generic screen (`apps/web/src/modules/system-admin/settings/lib/settings-view.ts:69-81`), and the screen can show a key with no field and a link to its owning screen instead (`MANAGED_ELSEWHERE`, `apps/web/src/modules/system-admin/settings/lib/settings-catalog.ts:131-161`), which leaves the `PATCH` open; a band is stamped at submission, so an edit never re-routes an in-flight PO (§6.4 item 2). Closing the bypass is a sub-question of OD-18 (recommended default: a module-owned policy record or an owning key; §6.7). | Owner, Module, Platform |
| RK-33 | **Series contention and long posting transactions.** A posting's first write is its series counter's `$inc` (§2.4.4), held until commit, so every other posting of that series meets a write conflict and retries for as long as the holder's transaction runs. `unitOfWork` is a plain `session.withTransaction` (`apps/api/src/platform/kernel/unit-of-work.ts:5-17`), whose driver retry stops after 120 s (MongoDB driver 6.21.0, `package-lock.json:9827-9829`). No length is measured for a 100-line posting or for a count start that claims every row of a warehouse, and in-transit legs write the same balance rows as a count's posting (§2.4.6). | M | M | §2.4's capacity assumptions until OD-85 is answered (≤ 30 warehouses, ≤ 5,000 items, ≤ 3,000 stock documents a month, ≤ 100 lines a document, ≤ 5 postings a minute per series). Gates, each on staging before its phase ships, against the thresholds of §18.3.2 (P5: the slowest of 5 concurrent 100-line postings in one series commits within 5 s) and §18.3.3 (P7: a count's start and its posting on the largest warehouse each commit within 10 s alongside a concurrent posting). If the P5 measurement misses its threshold, per-branch series (OD-58 B) are adopted before P5 ships; if the P7 measurement misses its threshold, counts are split by category scope (OD-48). | Module, Owner |
| RK-34 | **A permanently deleted employee's name on kept records.** HR's permanent delete rewrites a purged person's name copies on `keep` collections, so that the person is removed everywhere, but refuses any path inside a subdocument or array (`apps/api/src/modules/hr/employee-management/employees/employee-name-copies.ts:9-12, 250-261`). Names inside arrays (approval trails, count teams) therefore stay on posted documents. | M | M | D-22 from P2: a single person on a document carries a top-level name the purge scrubs; names inside arrays are classified `leave`, a recorded gap (§15.3.3). OD-64 asks whether a name may stay at all. Changing the shape after P2 is a class-3 backfill of posted documents (§15.3.7). | Owner, Module |

---

## 18. Implementation phases

Delivery follows the HR / Fleet / IT method: one manifest, extended slice by slice ("extending THIS manifest, never
adding a second one", `apps/api/src/modules/it/it.module.ts:1-15`). A slice is one pull request (under OD-81 B, one
step of the phase's one pull request, §18.4); the owner's brief asks for one pull request per phase, and OD-81 asks
whether a phase may ship as several. The business order is the owner's. ECMS changes it where its own code forces a change; §18.1
lists those, and separately the moves this design only recommends, which wait for the owner's approval. The owner's
recommended defaults are the working answers (§16.12), and delivery goes one phase at a time: a phase starts once the
previous one is closed (its exit criteria met and the owner told) and its own re-detail has passed its design review.

Since the owner's approval (2026-11-24), the freeze covers, inside §2–§14: D-1…D-22; the §2.4.4 posting invariant and the §2.4.5–§2.4.6
arithmetic; the §3.6 dependency graph; the states and edges of §5; the scope rules of §7; the realtime rules of §9; and
every name §2 fixes (§16.1). Everything else this design gives for P2–P9 (fields beyond names, routes, DTOs, tiles, exit
criteria) is the plan of record (Status). Before a phase's first pull request its plan of record is re-checked against
the code (a drift check) and re-detailed as a §19-shaped section — scope and pull requests, the owner's answers
applied, endpoints with gates and bodies, contracts, pages and keys, realtime and audit, tests and pins, file list, exit
criteria with thresholds — written to a sibling file `docs/12-planning/administration-module-phase-<n>.md`. Its design
review is the gate before that phase's first pull request, and §22 records it. A re-detail adds no owner approval of its own («لا تتوقف
بعد كل مرحلة لطلب موافقتي»), unless a business decision or an architectural change outside the plan arises; closing a
phase before the next is the owner's rule of 2026-11-24 (§16.12). Since that approval, Phase 1 (§19) is frozen in
full (Status).

### 18.1 Where ECMS changes the order, and what is only recommended

The Kind column separates the moves ECMS's code forces (Forced) from those this design recommends (Recommended), one an
open decision gates (Gated by a decision) and one that applies only if its condition arises (Conditional). A cell
ending "(note A1)" and so on is explained in the numbered notes at the end of §18.1.

| # | Kind | Concern | Where the owner's order (or a naive plan) puts it | Where it ships | The ECMS fact behind it |
|---|---|---|---|---|---|
| A1 | Forced | Approvals | after the documents | **with the document it decides**: PR (P2), PO (P4), MR (P6), transfer, count, adjustment (P7) | A key ships with its operation, and the engine reads a request no active chain matches, or a chain with no staffed rung, as approved, so each document's approvals ship with it (note A1). |
| A2 | Forced | Audit and realtime | a closing phase | **every slice, every audited entity** | CI fails on an unclassified literal `{ moduleId: 'administration', entityType }` pair and on a topic whose key no manifest declares (`apps/api/src/platform/realtime/realtime-registry.spec.ts:100-129`), and on a server topic with no web row (`apps/web/src/platform/realtime/realtime.spec.ts:166-215`). Review rejects unaudited mutations (`CONTRIBUTING.md` §5; `.github/pull_request_template.md:10-19`). |
| A3 | Forced | Notifications to approvers and requesters | the same closing phase | **with each approval type** (P2, P4, P6, P7) | The engine notifies nobody: the host asks `approvalService.currentApprovers` (`approval.service.ts:226-233`; the leave host, `leave-request.service.ts:679-711`). Own-scope requesters join no realtime room (`apps/api/src/platform/realtime/realtime-rooms.ts:29-35`), so a notification is their only live signal (D-11; PC-7). A missing template makes `notify()` throw (`apps/api/src/platform/notifications/notification.service.ts:112-117`), and callers swallow the error. Template, seed and the module's own seed-coverage spec (the `apps/api/src/modules/hr/hr.seed.spec.ts` shape, from HR's slice P-HR-07: "Every notification this module SENDS has a template behind it", `:1`) therefore ship together: no global spec checks a module's templates. Who else is told: OD-61. |
| A4 | Recommended | Approvals-engine hardening | outside the plan | **platform slice PX-1, before P2** (OD-20, recommended default: A) | The engine has defects money approvals must not carry (R1–R5, R8, R9, §15.2.1), and PRs are its first consumer whose approval leads to spending (note A4). |
| A5 | Forced | Opening balances | master data (P1) | **P5, with the ledger** | Opening stock is a movement; there is no "set on hand to N" (ADR-024; `apps/api/src/modules/it/go-live/consumables-opening.ts` header). |
| A6 | Forced | Item card, running balance | reports (P8) | **P5** | They are the ledger's read view, computed at read time (§2.4.7, §14.6); §14.5 lists the item and warehouse cards among the P5 reports. |
| A7 | Gated by a decision | Suppliers | P1 with the rest | **P1b, gated separately** | OD-01 decides the registry's shape, and its ADR is written with it (§20). IT §16 P4 names this design as its trigger (`docs/12-planning/it-module-design.md:1510`). |
| A8 | Forced | Navigation rows | the API slice (IT-1, the IT module's first slice, `docs/12-planning/it-module-design.md:1481`, seeded an empty category) | **each phase's web slice** | A screen is routed and joins navigation in the same slice (`apps/web/src/modules/it/routes.tsx:4-6`; `apps/api/src/seed-navigation.ts:900-903`). `syncNavigationCatalog` creates a category only with its first row (`seed-navigation.ts:1705-1729`), and an empty category is not returned (`apps/api/tests/integration/auth-seed-login.spec.ts:135`). |
| A9 | Recommended | CI time | — | **PX-3, before P5** (D-18) | One job, 45-minute limit (`.github/workflows/ci.yml:16`), raised from 30 after a green run took 29m41s on 2026-11-07 and the next was cancelled at 30m13s (`:11-15`). API tests take about 17 minutes of a run, and 167 of the 186 integration files boot every manifest (RK-01). P5–P7 will bring the heaviest suites (an estimate: the ledger, two-branch and count races). |
| A10 | Conditional | Date-keyed announcements | — | **PX-2, before the first phase that needs one** | ADR-025 asks for the sweep-mark seam with the next module that needs marks, and only an announcement made once per date needs them (note A10). |
| A11 | Recommended | Corrections of postings | after the postings: counts and adjustments (P7) | **a correcting document from the first posting phase**: recommended, stock adjustments (OD-52) ship in P5 | The ledger has no update path, so a posted document is corrected only by an opposing one (D-2; §4.1, Correct) (note A11). |

**What ECMS does not force.** Beyond the rows above, the order of the business phases stays the owner's to choose. The
warehouse half (P5 without GRNs and supplier returns, P6, P7) needs P1, PX-1 (its approval types run on the engine,
A4), PX-3 (A9) and the ledger, so the owner may bring it forward without another technical change. Stock would then
enter only through opening balances, or through an approved `adjustmentIn` (OD-33 A, the recommended default); a
receipt without a PO is OD-33 B.

**Cross-cutting prerequisites.** This table is the single source for what each phase waits for outside the module
(§15.5 and §18.3 point here; §18.2 draws the platform slices and PC-1, PC-12 and PC-13 among them). Each lands before the first phase that needs it, as its own
pull request outside the module, never mixed with module code.

| Prerequisite | Before | Why |
|---|---|---|
| The zod waiver renewed under review, or the zod 4 migration landed (RK-09) | any pull request after **2026-11-26**, P1 included | the waiver in `scripts/dependency-audit.waivers.json` ends that day, and every pull request then fails the dependency audit |
| PC-12, shared scope rules: ATM's fail-closed branch-scope rule in `apps/api/src/shared/base/branch-scope.ts`, and `assertOrganizationScope(ctx, key, reason)` in `apps/api/src/shared/base/org-authority.ts` (note PC-12) | P1a.1, whose master-data writes are the org-authority check's first caller; the branch-scope rule's first caller is P1a.3 | the module imports the shared rules instead of a second copy of a scope rule (D-10, RK-15) |
| PC-13, shared counter and name fold: a counter factory in `apps/api/src/shared/base/counter.ts`, and IT's `foldName` moved to `packages/contracts/src/common/` (note PC-13) | P1a.1, whose unit and category names are the fold's first callers; the counter's first caller is P1a.2 under OD-05 A | one counter rule and one fold, where the module would otherwise make a third counter copy and a second fold ("Never copy-paste across modules", `docs/02-architecture/module-structure.md:122`) |
| PX-1, approvals hardening (OD-20 A) | P2 (under OD-20 B, A4's stopgaps ship in P2 instead); P6 and P7 if the warehouse half comes before P2; P5 if A11 brings adjustments into P5 | A4 |
| PC-7, requester liveness: on `notification:new`, invalidate the topic of the notification's `entityRef` (§9.5) | P2, soft: it lands when platform review accepts it, and P2 ships without it if platform review has not accepted it when P2 is ready | until it lands, a requester's reads refresh on navigation and after `staleTime` (30 s, `apps/web/src/shared/lib/query-client.ts:18`), and P2's exit criterion says so (§18.3). It is platform web code, with an ADR only if it becomes a convention (§20) |
| The `ApprovalChainPanel` fixes: it shows `label.ar` in both locales and a raw `permissionKey · level` (§13.5). The same platform fix covers the chain screen, which shows request types and places by `name.ar` in both locales (`apps/web/src/modules/system-admin/approvals/pages/ApprovalWorkflowsPage.tsx:91-92`, `:97-101`; §13.4 rule 6) | P2 | the panel is the trail every approval page shows, and the chain screen is where the module's six types are configured: unfixed, they read Arabic on the English screen |
| Under OD-82 A, the `approvalDecision` verb in contracts a release ahead of its first writer, or api and worker deployed together (RK-29) | P2 | an old worker refuses an audit job with an unknown verb (`apps/api/src/platform/audit/audit.model.ts:46`) |
| The module's print verb `administrationPrint` (§11.6.6) in contracts a release ahead of its first writer, or api and worker deployed together (RK-29) | the first paper of record: P4's PO under OD-59 A, earlier if OD-59 makes an earlier paper a record | the same unknown-verb refusal; prints are audited under their own verb, as ATM's `atmSettlementPrint` (`packages/contracts/src/platform/audit.ts:193-198`), so they never count toward `exportSpike`, which counts only `export` (`apps/api/src/platform/audit/audit.signals.ts:129-142`) |
| PC-8, a notification category | P2, only under OD-61 B | `NOTIFICATION_CATEGORIES` is a closed enum (`packages/contracts/src/platform/notifications.ts:8-19`) |
| `EGYCASH_LOGO` shared: done, in `@ecms/contracts/egycash-logo` (§11.6.3) | — | nothing to move; the first paper imports the subpath |
| PC-11: the export walk and buttons, and the company report form, moved to `apps/web/src/shared/` behind re-exports (§11.7, §15.4) | the first client export: P2's PR register (§14.5), or P1 under OD-60.1 (ii); none under OD-60 C | the module would otherwise be their next cross-module importer |
| PC-5: `fetchBlob` sends `X-Active-Branch` and parses the JSON error envelope (§11.5, §11.7) | the first server export: P3 under OD-60 A (the RFQ comparison; P5's exports if the warehouse half comes first), P2 under C, none under B | server exports and byte reads otherwise ignore the branch switcher (`apps/web/src/shared/lib/api-client.ts:514-537`) |
| PX-3, CI capacity (D-18) | P5 | A9 |
| PC-2, an employee's cost center through the directory | P6, only under OD-41 C | §7.9 |
| An HR slice for ESS keys, keeping the four declarations `apps/api/src/modules/hr/ess-grants.spec.ts` compares in agreement | P2 under OD-16 B; P6 under OD-38 B | the ESS role is HR's, and modules do not edit each other (§6.5) |
| PC-1: an outbox delivery is marked handled only after its handler succeeds | the first reliable event with a cross-module consumer (§15.2.2): P5's GRN event only if OD-02 C or OD-65 B gives IT one; P8's handoff event only once Finance has a consumer (§12.11); neither at first under the recommended defaults | the dedup row is written before the handler runs, so a handler that throws is never retried (`apps/api/src/platform/kernel/event-bus.ts:100-109`; RK-05) |
| PX-2, the sweep-mark seam (PC-4) | the first announcement that needs marks (A10) | ADR-025 |

**Notes to §18.1.**

1. **Note A1.** A key ships with its operation (`apps/api/src/modules/it/it.module.ts:69-71`), so
   `administrationPurchaseRequest.approve` and `administration.purchaseRequest` exist only where PRs are decided. The
   engine picks, among the type's chains, the one that matches the request's **Unit** (the branch copy of a department,
   §7.6; a chain with no department and no branch matches every Unit): a request whose Unit no active chain of its type
   matches gets no steps (`apps/api/src/platform/approvals/approval.service.ts:73-83`; `approval-chain.ts:41-56`), and
   no steps, like a chain whose every rung is unstaffed, reads as approved (`approval-trail.ts:59-65`;
   `approval-chain.ts:74-82`; "That is a policy", `approval.service.ts:100-112`). PRs shipped "before approvals" would
   all be approved, and so would a PR from a Unit no chain covers. The P2 host therefore asks
   `approvalService.chainFor(type, unit)` at every submission and applies OD-19 to that Unit's chain (§6.4), as the
   leave host reads it (`apps/api/src/modules/hr/leave-management/leave-requests/leave-request.service.ts:293-295`).
   The other way out is an interim status machine in the host; leave's (`pendingManager` → `pendingHr`) still runs
   beside the engine for every employee whose place has no chain (`leave-request.service.ts:286-300`). RFQs (P3) start
   from approved PR lines.
2. **Note A4.** R1–R5 (§15.2.1): chains are not pinned, an all-unstaffed chain sticks, expired grants decide
   (`apps/api/src/platform/approvals/approver-lookup.ts:107`), override is scope-blind (`approval.service.ts:179`), and
   the engine audits before the host commits, on a row keyed `<requestType>:<step>` that names no document
   (`approval.service.ts:202-221`; the row does carry the HTTP request id,
   `apps/api/src/platform/audit/audit.service.ts:167`). PX-1 also takes R8, accounts that are not `active` counting as
   approvers, and R9, a chain that may name any registered key and is saved with no client version (§15.2.1). PRs are
   the engine's first consumer whose approval leads to spending (the PO, P4).
   - Under every option of OD-20, the host stores `approvalWorkflowId` and `approvalChainShape` at submission (host
     field #7, §2.1; proposed: `string[]` of `permissionKey@level`, its rungs in order; PX-1's ADR, §20, fixes its name
     and type before P2; under OD-20 B the module keeps this shape for its R1 check), refuses an unstaffed
     submission under OD-19 (recommended default: A; R2), and keeps its after-commit audit as the trail of record
     (R5, D-12).
   - Under OD-20 A, the host hands the pinned chain to the engine, which stays stateless; the module does not repeat
     the checks PX-1 makes.
   - Under OD-20 B only, P2 ships three of §15.2.1's stopgaps instead: (a) a decision refused with
     `ADMINISTRATION_APPROVAL_CHAIN_CHANGED` when the id or the shape differs from the live chain (R1); (b) §6.4 item
     4's exact-level check, an active grant at exactly the rung's level (R3); (c) the override's own reach over the
     live rung (R4).
   - Under OD-20 C the owner accepts R1–R5 in writing.
3. **Note A10.** "The seam extraction — not a third copy — is the correct response to the next module that needs it"
   (`docs/03-decisions/ADR-025-sweep-announcement-marks.md:47-50`). A stamp on the document
   (`apps/api/src/modules/it/tickets/ticket-sweeps.ts:34-69`) needs no marks, and neither does a notification
   idempotency key, which holds once per recipient and key (`notification.service.ts:226-231`). P2's reminders
   (OD-61), quotation validity (P3, OD-23), overdue transit (P7, OD-46) and count reminders (P7, OD-48) can ride such
   keys. Marks serve an announcement made once per date whatever its recipients, such as a sweep that emits an event,
   which carries no idempotency key; the likely first is P9's digests or the integrity announcement (§2.4.8, OD-61).
4. **Note A11.** Opening balances and GRNs cancel only as drafts (§5.7), and an opening balance must be its row's first
   movement (§4.3.1). So the go-live order is a procedure: each warehouse's opening balance is posted before its first
   other posting (§15.3.5 c), and a (warehouse, item) row that moved first takes its opening stock through an approved
   `adjustmentIn` (OD-52). With adjustments in P7, three gaps last through P5–P6: an opening-balance keying error has no
   correction; a row that moved before its opening balance cannot take its opening stock; and the samples and
   donations of OD-33 (recommended default: A, an approved `adjustmentIn`) have no way in. A GRN keyed in error is
   OD-84 (recommended default: B, a supplier return with the reason code `entryError` that gives back PO
   `receivedQty`, which P5 already ships; §4.3.2). Adjustments need only the ledger and PX-1; P7 keeps transfers and
   counts. The owner decides when approving the plan: if adjustments stay in P7, the owner accepts those gaps in writing.
   Under OD-52 B (counts only) there are no standalone adjustments, and the gaps last until P7's counts.
5. **Note PC-12.** `apps/api/src/shared/base/branch-scope.ts`, beside `org-scope-match.ts`, holds ATM's fail-closed
   branch-scope rule (`apps/api/src/modules/atm/shared/branch-scope.ts:36-126`): `branchScopeMatch`,
   `branchScopeBranches` (over the shared `selectorBranches` in place of ATM's `registerScopeBranches`) and
   `narrowToBranch`, and `writableBranches` and `resolveWorkBranch` taking the candidate branch ids as an argument.
   `apps/api/src/shared/base/org-authority.ts` holds `assertOrganizationScope(ctx, key, reason)`, a 403
   (`ForbiddenError`) unless `scopeOf(ctx, key) === 'organization'`; ATM's `assertAtmSettingsManager`
   (`apps/api/src/modules/atm/shared/settings-authority.ts:12-20`) and its bank rule
   (`apps/api/src/modules/atm/catalogs/bank.service.ts:131-138`) call it, and the module's `shared/org-authority.ts`
   wraps it as `assertAdministrationOrgAuthority`. Neither file imports `platform/`: `apps/api/src/shared` may import
   only shared (`eslint.config.js:70`). The one data read, the active branch ids (ATM's `activeBranchIds` over
   `platform/organization`'s `branchRepository`, `apps/api/src/modules/atm/shared/branch-scope.ts:79-82`), stays with
   each caller: ATM keeps its loader and its exported names as thin wrappers, and the module has its own one-line
   loader over `platform/organization`, in its own `shared/branch-scope.ts` (§3.5, §19.8).
   These go to Layer 3 rather than to Platform Core (`docs/02-architecture/module-structure.md:120-122`) because they
   are pure, business-agnostic functions of the request's grants, like `scopeSelector`, `selectorBranches` and
   `orgScopeMatch`, which already live in `apps/api/src/shared/`. They are written there as `selectorBranches` was
   written beside `scopeSelector` (a copy of ATM's `registerScopeBranches`, which ATM keeps;
   `apps/api/src/shared/types/index.ts:284-308`).
6. **Note PC-13.** (a) `apps/api/src/shared/base/counter.ts` is a counter factory written from Fleet's
   `apps/api/src/modules/fleet/custody/custody-counter.model.ts`: ensure outside the transaction with a `$max` floor,
   create-if-missing; take the next number inside the caller's transaction; peek. It takes the model name and the
   `<module>_counters` collection as arguments, and the module is its first caller (`administration_counters`).
   Fleet's and ATM's counters (`apps/api/src/modules/atm/settlements/plans/note-counter.model.ts`) keep their copies
   and may move onto it later; that is listed with the cross-module findings
   (`docs/10-reviews/2026-11-administration-design-cross-module-findings.md`, §22), not this design's work. (b) IT's
   `foldName` (`apps/api/src/modules/it/go-live/inventory-import.ts:115-123`) moves to
   `packages/contracts/src/common/`, with IT importing it, so the module's fold (§2.1) is that one function, not a copy.
   D-6, §1.7 and §3.5 weigh the three counter options (a module copy; this shared factory, S; a platform sequence
   service, L) and adopt the factory.

**HR's name-copy census travels with the module.** HR's `employee-name-copies.ts` is a census of every `keep`
collection's name paths, like `targets.ts`: its spec fails CI on any unclassified path
(`apps/api/src/modules/hr/employee-management/employees/employee-name-copies.ts:268-275`;
`employee-name-copies.spec.ts:30-33`). So the classification of a module path travels in the module's own pull request
that adds the path, reviewed by HR's owner, rather than in an HR slice (§18.4; §15.3.3). Phase 1 adds no such path
(§19.9).

### 18.2 Phase table

The prefixes are dropped: `administration` from keys, `administration_` from collections, `administration.` from pages.
Event names are §8.2's. Print keys exist only for the PO, the GRN and the stock issue; `.export` keys exist only if
OD-60 picks server exports (§6.2).

| Phase | Scope | Collections | Pages | Keys | Approval types · events |
|---|---|---|---|---|---|
| **P1a** | scaffold, units, item categories, items, warehouses (§19) | counters (only if OD-05 picks generated codes, else from P2), catalog_items, item_categories, items, warehouses (+ go_live_runs under OD-68 A, in the first Phase 1 pull request whose data it loads from files: P1a.2, or P1b.1 if only suppliers load; §19.8) | catalogs, items, warehouses | Catalog.manage · Item.view/create/edit · Warehouse.view/create/edit | — · none |
| **P1b** | suppliers (§19) | suppliers | suppliers | Supplier.view/create/edit | — · none |
| **PX-1** | platform approvals hardening + the new platform ADR "Money approvals on the platform engine" (§20; OD-20) | (platform) | — | — | — |
| **P2** | purchase requests, approval, return for amendment (OD-72), approver and requester notifications, reminders (OD-61) | purchase_requests | purchase-requests | PurchaseRequest.view/create/edit/approve/cancel | `administration.purchaseRequest` · `administration.purchaseRequest.{submitted, approved, rejected, cancelled, closed}` |
| **P3** | RFQs, quotations and files, derived comparison, award, derived awaiting-sourcing queue; the procurement policy if OD-23 A | rfqs, quotations | rfqs (+ procurement-policy if OD-23 A) | Rfq.view/create/edit/award (+ .export if OD-60 A) · ProcurementPolicy.manage if OD-23 A | — · `administration.rfq.{issued, awarded, cancelled}` |
| **P4** | purchase orders, value bands, procurement policy, PO paper, issue, close / short-close / cancel, changes after approval as cancel and re-raise (OD-26) | purchase_orders | purchase-orders, procurement-policy (unless P3 shipped it) | PurchaseOrder.view/create/edit/approve/print/issue/close (+ .export if OD-60 A) · ProcurementPolicy.manage (unless P3) | `administration.purchaseOrder`, or `.band<N>` under OD-18 A · `administration.purchaseOrder.{submitted, approved, rejected, issued, cancelled, closed}` |
| **PX-3** | CI capacity (D-18) | — | — | — | — |
| **P5** | ledger + balances, opening balances, GRN, supplier returns (OD-84's correction included), stock views, the stock reports of §14.5 (item and warehouse cards, the on-demand integrity report), below-minimum signal, IT coexistence (OD-02); stock adjustments too if the owner adopts A11 | stock_movements, stock_balances, opening_balances, goods_receipts, supplier_returns (+ go_live_runs under OD-63 B, unless a Phase 1 pull request brought it) | stock, goods-receipts, supplier-returns | Stock.view/openBalance (+ .export if OD-60 A) · GoodsReceipt.view/create/print (+ .export if OD-60 A) · SupplierReturn.view/create | — · `administration.goodsReceipt.posted`, `administration.supplierReturn.posted` (both reliable), `administration.item.belowMin` |
| **P6** | material requests + approval, stock issues and paper, stock returns, the flag-only HR-exit handler (OD-44) and, beside it under OD-44 A (the recommended default), the scheduled sweep that reads the directory and cancels a leaver's drafts (the module's first scheduled task; §8.6) | material_requests, stock_issues, stock_returns | material-requests, stock-issues, stock-returns | MaterialRequest.view/create/edit/approve/cancel · StockIssue.view/create/print · StockReturn.view/create | `administration.materialRequest` · `administration.materialRequest.{submitted, approved, rejected, cancelled, closed}`, `administration.stockIssue.posted`, `administration.stockReturn.posted` |
| **P7** | two-step transfers (two branches), counts with freeze (OD-48), adjustments and write-offs (unless A11 brings them into P5) | stock_transfers, stock_counts, stock_count_lines, stock_adjustments | stock-transfers, stock-counts, stock-adjustments | StockTransfer.view/create/approve/dispatch/receive/resolve · StockCount.view/create/approve/count · StockAdjustment.view/create/approve | `administration.stockTransfer` (OD-45), `.stockCount`, `.stockAdjustment` · `administration.stockTransfer.{dispatched, received, closed, cancelled}` (+ `.{submitted, approved, rejected}` on a chain, OD-45), `administration.stockCount.{started, approvalRequested, posted, cancelled}`, `administration.stockAdjustment.{submitted, posted, rejected, cancelled}` |
| **P8** | supplier invoices and matching (OD-54), Finance handoff (OD-55), registers, the received-not-invoiced report (§14.5) | supplier_invoices (OD), finance_handoffs (OD) | supplier-invoices | SupplierInvoice.view/create/handOver (+ .export if OD-60 A) | — · none until a consumer exists: `administration.financeHandoff.{created, withdrawn}`, reliable through the outbox, is a recorded integration requirement (§12.11) |
| **P9** | module dashboard, cross-document reports, the nightly integrity check and its announcement (§2.4.8), supplier KPIs (OD-13), digests (OD-61) | sweep_marks, only through PX-2 | none: reports ride view keys (§6.2) | none new | — · none planned |

**Entity types** (audit `entityRef` = realtime topic = file authorizer, §9.2) arrive with their phase: P1a
`catalogItem`, `itemCategory`, `item`, `warehouse`; P1b `supplier`; P2 `purchaseRequest`; P3 `rfq`, `quotation`; P4
`purchaseOrder`; P5 `goodsReceipt`, `supplierReturn`, `openingBalance`, plus the signal-only topic `administration.stock`
(`administrationStock.view`), signaled once per touched branch by every posting; P6 `materialRequest`, `stockIssue`,
`stockReturn`; P7 `stockTransfer`, `stockCount`, `stockAdjustment`; P8 `supplierInvoice`, `financeHandoff` (OD-54,
OD-55).

What each phase needs before it can ship (an arrow reads "is needed by"; the owner orders the branches that do not
depend on each other, §18.1). Dashed arrows are conditional and carry their condition:

```mermaid
flowchart LR
  P1a["P1a master data"] --> P1b["P1b suppliers"]
  PC12["PC-12 shared scope rules"] --> P1a
  PC13["PC-13 shared counter and fold"] --> P1a
  P1a --> P2["P2 purchase requests"]
  PX1["PX-1 approvals hardening"] --> P2
  P2 --> P3["P3 RFQs and quotations"]
  P1b --> P3
  P3 --> P4["P4 purchase orders"]
  P1a --> P5L["P5 ledger and opening balances"]
  PX3["PX-3 CI capacity"] --> P5L
  P5L --> P5R["P5 goods receipts and supplier returns"]
  P4 --> P5R
  P5L --> P6["P6 material requests and issues"]
  P5L --> P7["P7 transfers, counts, adjustments"]
  PX1 --> P6
  PX1 --> P7
  PX1 -.->|"only if A11 brings adjustments into P5"| P5L
  P5R --> P8["P8 invoices and Finance handoff"]
  PC1["PC-1 outbox retry"] -.->|"only once the handoff event has a consumer"| P8
  PC1 -.->|"only under OD-02 C or OD-65 B"| P5R
  P6 --> P9["P9 dashboard and reports"]
  P7 --> P9
  P8 --> P9
  PX2["PX-2 sweep marks"] -.->|"only if marks are needed"| P9
```

### 18.3 Endpoints and exit criteria

Paths are under `/api/v1/administration`; a transition is `POST /<plural>/:id/<action>` with the body §5.1.4 gives
(`{ version, reason?, comment? }` plus its payload; decide takes `DecideApprovalSchema` plus `version`). Action paths
are verbs, as IT's named actions are, a departure from the naming standard that §1.11 records. The detail `GET` of the
six approvable documents (PR, PO, MR, transfer, count, adjustment) is
`authorizeAny('<resource>.view', '<resource>.approve')`, and each approval type ships with an awaiting-decision list
read, `GET /<plural>/awaiting-decision` under `<resource>.approve` (the `APPROVAL_PENDING` set within the `.approve`
key's reach, §13.4): P2, P4, P6, P7. The decisions each phase waits for are §16.3's ("Answer first" and "Also
applied"; Phase 1's are §16.2 and §19.2), and this table does not copy them: a phase cannot start without its "Answer
first" answers. What a phase waits for outside the module is §18.1's cross-cutting table, and what it waits for inside
the module is §18.2's diagram. An exit criterion that depends on an open decision names it, with its recommended
default.

| Phase | Endpoints (rough) | Exit criteria |
|---|---|---|
| P1a, P1b | §19.3 | §19.10 |
| PX-1 | platform approvals only | see §18.3.1 |
| P2 | `/purchase-requests`: list, get (`.view` or `.approve`), `/awaiting-decision` (`.approve`), create, `PATCH` draft, `/:id/submit`, `/:id/decide`, `/:id/return` (OD-72 B), `/:id/cancel`, `/:id/cancel-remainder` (OD-28); attachments (§11.5); the information-copy paper if OD-59 has PRs printed (on `.view`) | A PR is decided on a chain written at `/system/approvals`. Submission follows OD-19's answer for the PR's own Unit (recommended default: A, refused when no chain of the type matches that Unit or no rung is staffed; §18.1, A1). The service refuses the §6.6 pairs OD-21 adopts (recommended default: B; for PRs, pair A1: the requester, creator and submitter never decide, and pair B1: one decider per round). Of two concurrent decisions on one rung, one appends and the other is refused (the conditional append, §5.1.3). Approvers are notified. The requester's screen refreshes on the decision once PC-7 has landed; until then the requester's reads refresh on navigation and after `staleTime` (30 s, `apps/web/src/shared/lib/query-client.ts:18`; §9.5). Numbers stay gap-free under concurrent submits. |
| P3 | `/purchase-requests/awaiting-sourcing` (derived); `/rfqs` (list, get, create from PR lines, patch, `/:id/issue`, `/:id/close-bidding`, `/:id/award`, `/:id/cancel`, papers on `.view`); quotations, every route nested under `/rfqs/:id/quotations` (record with their file, patch, withdraw; §3.3); their files at `POST /rfqs/:id/quotations/file` (upload first) and `POST /rfqs/:id/quotations/:quotationId/file` (replace) (§11.4); the comparison (derived); `/procurement-policy` if OD-23 A; the RFQ export if OD-60 A | An RFQ runs `draft → issued → evaluating → awarded` (§5.5). Quotation files are guarded (§11.3) and uploaded first (§11.4). `expired` is derived, never stored. Concurrent recordings keep one live quotation per supplier per RFQ, if OD-23 keeps that rule (recommended default: yes, `ux_rfq_supplier`, §2.5). |
| P4 | `/purchase-orders` (list, get (`.view` or `.approve`), `/awaiting-decision` (`.approve`), create, patch draft, `/:id/submit`, `/:id/decide`, `/:id/return` (OD-72), `/:id/print`, `/:id/issue`, `/:id/close` (short-close), `/:id/cancel`, `/:id/cancel-remainder`, signed copy); `/procurement-policy` (the ATM `asSettingsEditor` precedent, `apps/api/src/modules/atm/shared/settings-authority.ts:29-32`); the PO export if OD-60 A | A PO is decided on the chain of the request type stamped at submission (OD-18; recommended default: A, the band's `administration.purchaseOrder.band<N>`). PR `orderStatus` moves in the PO's transaction. Two concurrent POs never claim more than a PR line's open quantity, and a PO's rejection, return or short-close gives its claims back in the same transaction. The service refuses the §6.6 pairs OD-21 adopts (recommended default: B; here pair B3, the awarder never approves the PO, besides pairs A1 and B1). The paper is numbered and re-printable (OD-59). Money is in minor units (`packages/contracts/src/modules/hr-payroll-money.ts`). |
| PX-3 | none: the CI job only (`.github/workflows/ci.yml:16`; PC-9) | `ci.yml`'s one job is split into parallel jobs (static gates; contracts and web tests; API unit; API integration, sharded), each with its own `timeout-minutes`; every step still runs as a required check, and the longest job of a green run on `main` finishes in under 30 minutes. It lands before P5 brings the heaviest suites (D-18; A9; RK-01). |
| P5 | `/stock-balances` and `/stock-movements` (reads, §3.3); `/reports/{stock-balance, stock-movements, item-card, warehouse-card, low-stock, stock-integrity}` (§14.5); `/opening-balances` (create, patch, `/:id/post`, `/:id/cancel`); `/goods-receipts` (create, patch, `/:id/post`, `/:id/cancel`, `/:id/print`, signed copy, attachments) and the receivable PO lines (§7.10); `/supplier-returns` (create, patch, `/:id/post`, `/:id/cancel`); exports if OD-60 A | see §18.3.2 |
| P6 | `/material-requests` (as PRs, with get (`.view` or `.approve`) and `/awaiting-decision` (`.approve`)); `/stock-issues` (create, patch, `/:id/post`, `/:id/cancel`, `/:id/print`, signed copy); `/stock-returns` (create, patch, `/:id/post`, `/:id/cancel`) | An issue posts its movements and the MR `issueStatus` together. Concurrent issues never issue more than an MR line's open quantity, and concurrent returns never return more than an issue line's quantity. An own-scope requester reads only their own MRs (§7.3); who requests is OD-38 (recommended default: A, department focal points). The service refuses the §6.6 pairs OD-21 adopts (recommended default: B; for MRs, as for PRs, pair A1 and pair B1). |
| P7 | `/stock-transfers` (get (`.view` or `.approve`), `/awaiting-decision` (`.approve`) where OD-45 or OD-47.4's loss round asks for a decision, create, patch, `/:id/submit`, `/:id/decide`, `/:id/return`, `/:id/dispatch`, `/:id/receipts`, `/:id/resolve`, `/:id/cancel`); `/stock-counts` (get (`.view` or `.approve`), `/awaiting-decision` (`.approve`), create, `/:id/start`, `PATCH /:id/lines`, `/:id/submit`, `/:id/recount` (OD-51), `/:id/request-approval`, `/:id/decide`, `/:id/cancel`); `/stock-adjustments` (get (`.view` or `.approve`), `/awaiting-decision` (`.approve`), create, patch, `/:id/submit`, `/:id/decide`, `/:id/return`, `/:id/cancel`), unless A11 brought them into P5; papers on `.view` (§11.6) | see §18.3.3 |
| P8 | `/supplier-invoices` (create, match, hand over); `/finance-handoffs` (list, get, signed copy); registers; `/reports/received-not-invoiced` (§14.5) | The handoff record and its signed memo are the source: a future consumer can rebuild its state from `finance_handoffs` (§12.5). No handoff event is emitted until a consumer exists (§12.11). When one does, the event commits with its row through the outbox, after PC-1 (§18.1). `ux_supplier_invoice` refuses a second hand-over of one invoice. The service refuses the §6.6 pairs OD-21 adopts (pair B4: a GRN's poster never hands over its invoice; the further pair invoice recorder ≠ hand-over actor, recommended default: enforce, §12.4). |
| P9 | `/dashboard` (`authorizeAny` over the section keys; a section whose key the caller lacks is `null`, §14.2), `/reports/*` (cross-document), the nightly integrity check | `/administration` stays unguarded on the web, as IT's, ATM's and Operations' indexes are (§13.3, §19.5); the API gates the dashboard's tiles per section, and each tile reads through its view key's scope. The integrity check reports zero drift on staging. |

#### 18.3.1 PX-1 exit criteria

1. One test per defect fails before the fix and passes after (§15.2.1):
   - R1, a pinned request keeps its chain's shape when the chain is edited or deleted;
   - R2, an all-unstaffed chain is reported at submission and at decision;
   - R3, an expired assignment cannot decide;
   - R4, an override outside its reach is refused;
   - R5, the host records the decision after its own commit, with its document id;
   - R8, only `active` accounts count as approvers, so a rung staffed only by accounts that are not `active` reads as
     unstaffed;
   - R9, a chain save that names a key outside its type's `permissionKeys`, or carries a stale client version, is
     refused.
2. `approval.service.ts` and `approver-lookup.ts` gain specs (none today, §15.2.1 R12).
3. An integration spec writes a chain through `PUT /api/v1/platform/approvals`
   (`apps/api/src/platform/approvals/approval.routes.ts:28-34`, mounted at `apps/api/src/app.ts:226`) and drives a
   leave request through `pendingApproval` to a decision. That is the engine path's first integration coverage:
   `apps/api/tests/integration/hr-leave.spec.ts` never writes a chain, so every request there runs leave's pre-engine
   statuses (`pendingManager`, `pendingHr`).
4. Requests submitted before the deploy keep reading their chain live; a backfill would be a D-17 operator migration.
5. R5's after-commit audit is opt-in per host (a PX-1 proposal, §20), so leave, today the engine's only host
   (`leave-request.service.ts:66`), keeps its behavior, and its unchanged suite staying green is a second check that
   nothing else moved. Moving leave onto it is a separate HR slice.
6. The new platform ADR "Money approvals on the platform engine" (§20) is accepted, in a documentation pull request
   before PX-1's first code pull request.

#### 18.3.2 P5 exit criteria

1. Σ movements = Σ balances after concurrent posts (Invariant I, §2.4.4). Balance rows are ensured outside the posting
   transaction and change only inside it, by guarded `$inc`; a first-use race on one (warehouse, item) leaves one row.
2. Negative stock follows OD-53 (recommended default: A, never, so an overdraw race answers `[201, 422]`,
   `apps/api/tests/integration/it-consumables.spec.ts:600-615`).
3. Concurrent GRNs never receive more on a PO line than OD-32 allows (recommended default: A, its open quantity), and a
   GRN post racing its PO's close either commits whole or is refused.
4. An opening balance must be its row's first movement: a second one for one (warehouse, item), or one on a row that
   has already moved, is refused with `ADMINISTRATION_OPENING_BALANCE_NOT_FIRST`, concurrent ones included
   (`lastMovementAt: null`). Its legs are stamped at posting like every other leg: `at` is the posting instant, and
   `asOfDate`, the counted date, is printed, never the movement's `at` (§2.4). Posting each warehouse's opening balance
   before its first other posting is a go-live procedure (§15.3.5 c); a row that moved first takes its opening stock
   through an approved `adjustmentIn` (A11).
5. A GRN post moves the PO and the ledger in one transaction; a GRN that closes its PO adds one audit row on the PO,
   and each posting signals `administration.stock` once per touched branch. GRN and opening-balance movements carry
   `unitCostMinor` and `currency`.
6. The service refuses the §6.6 pairs OD-21 adopts (pair A2: a PO's approver never posts its GRN; under OD-63 A, the
   further pair opening-balance drafter ≠ poster, recommended default: enforce).
7. Movements have no update or delete path (guard spec).
8. RK-33's P5 measurement passes on staging when, with 5 concurrent 100-line postings in one series, every posting
   commits, none exhausts the driver's 120 s retry, and the slowest commits within 5 s; otherwise per-branch series
   (OD-58 B) are adopted before P5 ships.
9. The ledger ADR (§20) is accepted before the phase's first code pull request.

#### 18.3.3 P7 exit criteria

1. The §2.4.5 arithmetic holds. Both branches read and are signaled (§7.4).
2. Under OD-48 (recommended default: A, freeze) the freeze is bucket-aware (§2.4.6): a frozen row refuses its onHand
   legs, receipts and outflows alike, with 422 `ADMINISTRATION_STOCK_FROZEN`, while a dispatch into a warehouse under
   count passes and waits in its `inTransit` bucket, and a loss passes.
3. A count's cancel and its posting release the freeze in the same transaction; under OD-51 A (the recommended
   default) a rejection is a recount and keeps the freeze.
4. A transfer closes only when every line's in-transit remainder is zero, and a pure liveness spec shows that from
   every reachable line state, a `returnNotArrived` resolution included, received + returned + lost = dispatched can
   still be reached (§5.9).
5. No chain is required at a transfer's creation. A `writtenOff` resolve, which opens a loss round, is refused under
   OD-19 A while no `administration.stockTransfer` chain with a staffed rung covers the transfer's Unit, until one is
   configured, and OD-61's stuck notice names the transfer (§5.9). Under OD-45 A, an intra-branch transfer goes
   `draft → approved` with an empty trail and an audit row that says no approval was required.
6. The service refuses the §6.6 pairs OD-21 adopts (recommended default: B; pairs A1 and B1 on every transfer, count
   and adjustment round; pair A3: a counter, a line's `countedByUserId` or its recount's `recountedByUserId`, never
   approves the variance; pair B2: the dispatcher never receives, with B1's small-branch escape, another holder of the
   key or a higher rung; the further pair receiver ≠ resolver of a shortage, OD-47.2 A, recommended default: enforce).
7. RK-33's P7 measurement passes on staging when a count start and a count posting on the largest warehouse (§2.4's
   assumed size) each commit within 10 s alongside a concurrent posting; otherwise counts are split by category scope
   (OD-48).
8. The two-branch ADR (§20) is accepted before the phase's first code pull request.

The 5 s and 10 s limits are this design's thresholds, set against §2.4's assumed volumes; the phase's re-detail
re-sets them if OD-85's volumes differ.

### 18.4 The slicing rule per pull request

- **The unit.** "Each slice = contracts + api + tests, PR-reviewed; web follows"
  (`docs/12-planning/it-module-design.md:1477`). IT-1 was contracts, scaffold and manifest, nav category, catalogs,
  vendors and the asset register (`:1481`). ITW-1 shipped its screens: home, assets, scan, asset detail, catalogs and
  vendors (`apps/web/src/modules/it/routes.tsx:6-14`; `CHANGELOG.md:6307`), although the plan's ITW-1 was scaffold
  and navigation (`it-module-design.md:1487`). Phase 1 here is the same pair, cut finer (§19.1).
- **Inside a phase.** If OD-81 lets a phase ship as several pull requests (recommended default: A), one pull request
  per feature (a feature folder, §3; e.g. P1a.1–P1a.3, §19.1), the API pull request before its web pull request;
  otherwise these are the steps of the phase's one pull request. A platform slice (PX-*) or a cross-cutting
  prerequisite (§18.1) is never mixed with module code.
- **Size.** CONTRIBUTING says "> ~500 changed lines should be split" (`CONTRIBUTING.md:53`), and BD-006 says one
  capability per sprint (`docs/01-domain/business-decisions.md:121-133`). Practice has drifted to pull requests of
  17,501, 34,022 and 28,614 added lines (`c97667f`, `74264cb`, `264ee87`). A feature with its tests and the coupled
  files below exceeds 500 lines even when cut six ways (an estimate). Recommended under OD-81: the IT model, with each
  pull request stating its size and why its coupled files travel together.
- **Coupled files.** A pull request carrying the left column without the right is red or silently wrong. Two pairs
  cross workspaces: an API slice carries web invalidation rows, and a web slice carries the API navigation seed and its
  pins. "Convention" means a hand-written list: nothing fails if the file is left out of it.

| If the pull request adds… | it must also change… | What catches an omission |
|---|---|---|
| a manifest or pages | `MODULES` in `scripts/check-page-registry.mjs:65` | a silent CI skip; boot validation in every suite |
| an audited entity | `REALTIME_TOPICS` **and** the web `INVALIDATION_REGISTRY` | `realtime-registry.spec.ts:100-129`; `realtime.spec.ts:166-215` |
| a path matching `/employeeid/i` | `apps/api/src/workforce-reset/targets.ts:133`; if `keep`, the integration `untouched` list and the `includeRecruitment` count, and by precedent the keep list in `targets.spec.ts:76-91` (`c97667f`) | `targets.spec.ts:50-52`; `apps/api/tests/integration/workforce-reset.spec.ts:223-243, :361` |
| a path ending in `name` (case-insensitive, subdocument arrays included) on a `keep` collection | `CLASSIFICATION` in `apps/api/src/modules/hr/employee-management/employees/employee-name-copies.ts` (`scrub` with `by`, or `leave`), and for a scrub the pinned list in `employee-name-copies.spec.ts:43-60`, in the module's own pull request, reviewed by HR's owner (§18.1) | `employee-name-copies.spec.ts:30-33`: `nameCopiesToScrub` throws on an unclassified path (`employee-name-copies.ts:268-275`) |
| an `emit(...)` | the `packages/contracts/src/events/catalog.ts` source and lexicon, the `catalog.spec.ts` declared list | `event-publishers.spec.ts:165-170`; `catalog.spec.ts:181-195` |
| an audit verb (OD-82's `approvalDecision`; `administrationPrint`, §11.6.6) | `AUDIT_ACTIONS` + `systemAdmin.users.audit.<verb>` in en and ar; RK-29's deploy order | `system-admin-i18n.spec.ts:113-127`; `audit-screens.spec.tsx:361-368` |
| a `notify()` call | the seeded template and the module's seed-coverage spec (the `hr.seed.spec.ts` shape); an `ENTITY_ROUTES` link (`packages/contracts/src/platform/notification-target.ts:36-42`) | the module's spec only. A missing template makes `notify()` throw (`notification.service.ts:112-117`); a caller that swallows the error, as leave does (`leave-request.service.ts:710`), sends nothing and reports nothing (A3). A missing route opens the inbox instead (`notification-target.ts:51-57`) |
| a notification category (OD-61 B) | `NOTIFICATION_CATEGORIES` (`packages/contracts/src/platform/notifications.ts:8-19`) + `systemAdmin.templates.category.<c>` in en and ar | `system-admin-i18n.spec.ts:56-60, :116-127` |
| a nav row | its route, `seed-navigation.spec.ts:81`, `auth-seed-login.spec.ts:37` (+ `:142-151`, `:291-298`, `:315` for a category; and `apps/web/src/platform/navigation/module-icons.spec.ts:49-58`, `:65-74` for its module tile) | two specs pin 140 rows (136 at `b03522f`) |
| a nav icon key | the registry in `apps/web/src/platform/navigation/app-icon.tsx` and, for a new glyph, `apps/web/src/shared/ui/icons.tsx` | the module nav spec (Operations precedent); otherwise an unknown key falls back silently (`app-icon.tsx:106-109`) |
| a `*Page.tsx` | its class in `apps/web/src/shared/lib/remembered-filters-coverage.spec.ts` | the partition, `:502-506` |
| a module error code | `packages/contracts/src/errors/index.ts`, module-prefixed (`ATM_WORK_BRANCH_REQUIRED`, `:475`), and its en and ar text in the shared `FRIENDLY` table (`apps/web/src/shared/lib/errors.ts`) | the module's case in `apps/web/src/shared/lib/errors.spec.ts` (Operations' precedent, `:87-127`) |
| a printed paper | the list in `apps/web/src/shared/lib/print-window.spec.ts:138-155` | convention (`c97667f` added its paper); only the global no-script rule (`:128-136`) fails CI |
| a server export | the list in `apps/api/src/shared/utils/stream-rows.spec.ts:110-123` | convention, as for papers |
| a module setting | `registerAdministrationSettings()` at module import; `settings-inventory.spec.ts` (its registrations, `:41-50`, and the count of 64, `:89-103`), `SettingsPage.spec.tsx` (its `DECLARED_KEYS` and the count of 73, `:279-287`; a title and a description in both languages for every declared key, `:290-294`), an `administration` department, its sections and placement rules (`apps/web/src/modules/system-admin/settings/lib/settings-catalog.ts:12-32, 43-110`) and labels | the two count pins; without the department, rows fall under "Other" |
| the stock ledger (P5) | the `no-restricted-imports` rule that keeps `warehouses/stock/*.model` and `*.repository` behind `stock/index.ts` (`eslint.config.js`, payroll's two-ports precedent `:109-140`; §3.7) | lint |
| ESS keys (OD-16 B, OD-38 B) | the four ESS declarations in `modules/hr`, in an HR slice | `apps/api/src/modules/hr/ess-grants.spec.ts` |
| a go-live model, an operator CLI, or `departmentId` inside a sub-document array | `sync-indexes.models.ts` for a model reached only from `server.ts` and `worker.ts` (not one in `administrationModels`, which loads through `./modules`, `sync-indexes.models.ts:4-11`); `tsup.config.ts` and the CLI lists; the exact list in `references.spec.ts:188-200` | `sync-indexes.models.spec.ts:61-74`; the CLI lists are convention (`operator-cli-safety.spec.ts:16-22` checks only the CLIs it names); `references.spec.ts`; §7.7 |

### 18.5 Gates every slice passes

All steps run in one CI job, and the first failure skips the rest (`.github/workflows/ci.yml`), until PX-3 splits it
(§18.3).

| Gate | Command | First phase it checks | What a slice does |
|---|---|---|---|
| Secrets | `node scripts/check-secrets.mjs` | P1 | no JWT-shaped fixtures, no supplier credentials |
| Contracts build | `npm run build -w packages/contracts` | P1 | exports from `index.ts` with the `.js` suffix |
| Lint | `npm run lint` | P1 | no `console`, floating promises or `any`. The boundary rule allows `modules → modules` (`eslint.config.js:73`) and its element typing does not stop the imports it disallows: 120 module files import `infrastructure/` (RK-02). So the module isolation spec (§19.7) and review keep out imports of `modules/it`, `fleet`, `hr` and `atm`. From P5, the ledger-door rule (§18.4). |
| Typecheck | `npm run typecheck --workspaces --if-present` | P1 | strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`; integration specs included |
| Permission matrix | `node scripts/gen-permission-matrix.mjs --check` | PX-1, only if a platform key changes | module keys never appear. A hand-written Administrative Affairs section in `docs/06-security/permission-matrix.md` would revive governance rule 2 (`:105`), which no module since Recruitment has followed (§6.1): new practice, settled at approval (§19.2) |
| Flag expiry | `node scripts/check-flag-expiry.mjs` | only if a feature flag ships (none: D-19) | owner + `expiresAt`; `settings-inventory.spec.ts:160-166` changes |
| Page registry | `node scripts/check-page-registry.mjs` | P1 | literal module and page ids in every `declarePermissions` call; the parsed `administrationPages` shape |
| Automation templates | `node scripts/automation-templates.mjs` | only if a template ships | none planned (engine off) |
| Formal Arabic | `node scripts/check-formal-arabic.mjs` + web spec | P1 | labels, i18n, server messages and papers formal: «إدارة», never «ادارة». A verbatim owner paper also changes the four-file pin (`formal-arabic.spec.ts:101-109`, OD-59). |
| Tests | `npm run test -w …` (contracts, api, web) | P1 | rules in pure specs; integration only for transactions, scope, concurrency and authorization |
| Build and bundle | `npm run build` | only if a slice adds a CommonJS runtime library (none planned) | externalize it (`apps/api/tsup.config.ts:68`; the reason, `:51-67`) |
| Dependency audit | `node scripts/dependency-audit.mjs` | every pull request | keep the waiver valid (§18.1, RK-09) |
| Event reachability | `node scripts/check-event-reachability.mjs` (not in CI) | P2 | CI already fails on a `stable` event nothing references (`apps/api/src/platform/kernel/event-publishers.spec.ts:180-185`). Run the script locally for an event that is referenced but never emitted (the dependency audit's finding F1, D-13) |

The architecture guards start checking in this order:

- **P1:** route-param validation, outbound-only fetch, both realtime registries, page header without subtitle,
  ungated reference options, remembered filters, platform routes exist, workforce reset (the keeper), single-brace i18n
  placeholders (`apps/web/src/platform/localization/placeholders.spec.ts`), and runtime import safety
  (`apps/api/src/runtime-import-safety.spec.ts`: the module joins the `./src/modules/index.ts` graph, which must load
  outside vitest).
- **P2:** the event catalog and publishers; the audit-verb and category label specs if OD-82 adds a verb or OD-61 a
  category. Templates are checked only by the module's own seed-coverage spec: the platform's spec covers its three
  built-ins (`apps/api/src/platform/notifications/notification.builtin-templates.spec.ts:36-37`).
- **P3–P4:** money format and money input; print window (the global no-script rule; its list is convention); the
  settings inventory (with the first signatory paper: P3, or P2 if OD-59 prints PRs, §11.6.5; again with the policy
  settings: P4, or P3 under OD-23 A); the audit-verb label specs with `administrationPrint`, which ships with the first
  paper of record (P4 under OD-59 A, §18.1).
- **P5:** the ledger-door lint rule; stream rows (convention) for server exports under OD-60 A. A go-live step under
  OD-63 B changes `server.ts` and `worker.ts` only: its run model is in `administrationModels`, so
  `sync-indexes.models.ts` and its spec gain nothing (§18.4).
- **P6:** nothing new in CI. D-CC-3 (OD-41) is a recorded decision whose spec reads five named models only
  (`apps/api/src/platform/organization/cost-centers/cost-center-guards.spec.ts:76-88`), so review, not CI, enforces it.
- **P7:** module specs rather than global ones: the two-branch scope guard (§7.4), and one "is locked" predicate per
  lock, specified over every status (RK-27); print window for the transfer and count papers.
- **P8:** the money guards on invoice screens; stream rows for invoice exports under OD-60 A. The publishers spec's
  payload-key check (`event-publishers.spec.ts:198-216`) applies only once the handoff event ships with a consumer.
- **P9:** nothing new (§18.3).

---

## 19. Recommended Phase 1

### 19.1 Scope and pull requests

Phase 1 ships master data and nothing that moves stock or money. It is the IT-1 + ITW-1 equivalent, in six pull
requests if OD-81 lets a phase ship as several (else six steps of one). The design was drift-checked against `main` at
`9efdcbd9` before its first pull request (§22). Each Phase 1 pull request still uses the pins, counts and line numbers
the code holds when it is written, since other modules keep merging; a moved pin is re-pinned in that pull request,
and only a change of behavior is a design question.

| Pull request | Content | Depends on |
|---|---|---|
| **P1a.1** | Catalog contracts. Scaffold: manifest (with `name` and `pages`), seed, the model list the seed passes to the shared `syncDeclaredIndexes` (no copied builder; the seed logs its report and holds no state, §15.3.2), `shared/collection-ready.ts`, which every repository with a `ux_*` index awaits before its first write (RK-03), `shared/org-authority.ts` over the shared check (PC-12), the module isolation spec. Units (`administration_catalog_items`, kind `unit`) and item categories, each name stored with its `nameKey`, folded by the shared `foldName` (PC-13). Registries: module index, page-registry list, two realtime topics with their web rows (under `administrationCatalog.manage` until P1a.2), role-matrix module label. | PC-12, PC-13; OD-04, 06, 07, 62, 67 (role titles), 78, 81 |
| **P1a.2** | Items, with `shared/counter.model.ts` (built with PC-13's shared counter factory), `shared/document-number.ts` and the contracts code formatter for the `ITM-` code (OD-05 A; with typed codes, no counter until P2); one topic; the two catalog topics move to `administrationItem.view` (§9.2); the catalog read gate widened to `authorizeAny('administrationItem.view', 'administrationCatalog.manage')`. Under OD-68 A, the go-live load of units, categories and items (§19.8). | P1a.1; OD-05, 08, 09, 68 (field set and, under A, the owner's files) |
| **P1a.3** | Warehouses, on the shared fail-closed branch-scope rule (PC-12; the module's own `shared/branch-scope.ts` holds only its `activeBranchIds` loader until its two-branch helpers arrive, P5 and P7), the branch-options read (§19.3), the `people/` keeper picker, one topic with a branch signal, the workforce-reset classification. | P1a.1, PC-12; OD-10, 64 |
| **P1a.W** | Web: the `/administration/*` mount, home, catalogs, items and item detail, warehouses screens, i18n (`administration.module.*`, `administration.nav.*` and the feature keys), the nav category with four rows and its pins, two new icon glyphs (`box`, `warehouse`), remembered filters, module guards, nav spec. | P1a.1–3; OD-62 (names), OD-62.1 (tile glyph), 67, 83 (default B applied unless the owner objects) |
| **P1b.1** | Suppliers: contracts, API, topic, tests, the `SUP-` code and its counter (OD-05 A), the categories read gate widened for supplier editors (if OD-11 keeps `categoryIds`), supplier papers (if OD-11 keeps them: category, authorizer, three endpoints). Under OD-68 A, the go-live load of suppliers (§19.8). | P1a.1, and P1a.2 for the counter under OD-05 A; the supplier-registry ADR, accepted (§20); OD-01, 11, 12, 68 (field set and, under A, the owner's files), and 76, 77 if OD-11 keeps supplier papers (§16.2) |
| **P1b.W** | Suppliers screen and supplier detail (with a documents card under OD-11), nav row, pins. | P1b.1, P1a.W; OD-67 |

### 19.2 What Phase 1 needs from the owner

| Piece | As designed when… | Otherwise |
|---|---|---|
| Item and supplier codes, `administration_counters` | OD-05 (recommended default: A): generated `ITM-{seq:5}` and `SUP-{seq:5}` (counters `item:global`, `supplier:global`, §2.8); typed short codes for warehouses, categories and units | B: a counter per master kind, warehouse and category codes included. C: typed codes everywhere, each a unique index partial on live rows, and no counter until P2 |
| Two category levels | OD-06 (recommended default: two levels) | n levels: parent-chain and cycle rules grow (a materialized `path`, §2.3.3) |
| One base unit | OD-07 (recommended default: a base unit only) | conversions: one sub-document, one pure spec |
| Integer quantities and levels | OD-08 (recommended default: integers) | B: decimals per unit as scaled integers; every rule and report scales (OD-08) |
| Item-level min / reorder / max | OD-09 A, or C starting with A (recommended default: C, starting with A) | B: a per item × warehouse threshold record from P5, a new collection with its own writes (OD-09 B; §2.3.4). Never the balance projection, whose only writer is the posting transaction. None in P1 |
| Organization-scope check on master-data writes | OD-04 (recommended default: A, central) | not called; any key holder maintains (`it_vendors` precedent) |
| Non-stock items | not in P1: `stockTracked` joins with OD-14's answer (recommended default: C, a non-stock kind), absence-safe (§2.3.4) | — |
| Keeper (`responsibleEmployeeId`), `people/`, reset classification | OD-10 keeps a keeper (recommended default: A) from P1a, as the owner's brief lists «Warehouse manager / responsible person» in warehouse master data (OD-10's timing sub-question, recommended default), and OD-64 A, `keep` (recommended default: the warehouse is a record that names its keeper) | a keeper from P5 (OD-10's cheaper timing) or none: none of the three in Phase 1. With a keeper, `purge` for this collection (OD-64 C, purge all) would delete the warehouse rows the ledger and every document cite (`apps/api/src/workforce-reset/targets.ts:28-39`: a purged row "goes"), so here the coherent alternative to `keep` is storing no keeper |
| Warehouse `departmentId` | OD-10 A (recommended default): an optional owning department, reference-only (§2.3.5); writes stay `keyReachesBranch` (§7.2) | if OD-10 makes the department a write axis (OD-10's department sub-question, (ii)), writes use `keyCoversUnit` (`apps/api/src/shared/types/index.ts:157-181`), and a home-only department holder writes the warehouses of their own department (§19.7) |
| Suppliers (P1b) | OD-01 (recommended default: C); OD-11, OD-12 answered | A or B: the registry slice of §20; B adds an operator-run migration, approved separately (D-17) |
| Supplier papers | OD-11 keeps them (recommended default: A) | no category, no authorizer, no paper endpoints (§11.2) |
| Seeded role bundles | OD-78 (recommended default: A, §6.5's ready-made roles), seeded as managed roles (D-20) through `rbacService.ensureManagedRole` (`apps/api/src/modules/gold/gold.seed.ts:40-44`); a bundle is created, with its OD-67 title, in the first pull request that gives it a key (§19.8) | keys reach super-admin only (`apps/api/src/platform/rbac/rbac.service.ts:599`) |
| Nav name, order, sections | OD-62 (recommended default: A, «الشئون الإدارية» / Administrative Affairs, sort order 29, sections later); the launcher tile wears a box (OD-62.1, recommended default: A) | sections now (§13.2): `APPLICATION_SECTION_DEFAULTS` gains the entry before `HR: [`, or the span the spec reads is bounded (pin #3, §19.7); another tile picture the owner names (OD-62.1 B); the Procurement section ships with P1b.W's supplier row |
| Screen terms | OD-67, the role titles before P1a.1 seeds the roles | i18n edits only; a role title changed after seeding is renamed by hand or by a run-keyed step (§19.8) |
| Page frame, shared pieces | OD-83: default B (the board frame on registers) applied unless the owner objects; `Fact` and the catalogs tablist rebuilt page-local after IT's pattern (D-21; §19.8), `ReferencePicker` with `ItemPicker` in P2 | A: plain `PageContainer` |
| Rollout | OD-80 answered before the module's roles are assigned in production: a pilot branch or all branches. It gates no code: the build carries no gate either way, and a pilot runs by role assignment (D-19) | — |
| Data load | OD-03; OD-68 answered B (§16.12): master data is typed in on the screens, so no go-live step ships in Phase 1 and the §19.8 rows marked "if OD-68 A" do not apply | a later load from files (OD-68 A, a versioned go-live step, IT `go-live/`) or an in-app import with preview (OD-68 C), each its own change |
| Permission-matrix section | adopted at approval by the owner or reviewers: an Administrative Affairs section in `docs/06-security/permission-matrix.md` under governance rule 2 (`:105`), per phase | not adopted: §6.2 is the module's matrix, as the owner's brief item 5 asks |

A non-recommended answer to any row above re-opens Phase 1 for the parts it names: the §19.1 rows, §19.3
routes, §19.4 contracts, §19.7 specs, §19.8 files and §19.10 criteria those parts touch are re-detailed, design-reviewed
and recorded in §22 before the first pull request that carries them. The freeze then covers the revised §19.

### 19.3 API endpoints

Under `/api/v1/administration`; each route is `authenticate → authorize → validate → asyncHandler`
(`apps/api/src/modules/it/vendors/vendor.routes.ts`).

| Method and path | Gate | Notes |
|---|---|---|
| `GET /catalog-items?kind=unit`, `GET /item-categories` | `authorizeAny('administrationItem.view', 'administrationCatalog.manage')` | manage alone until P1a.2. The IT precedent: "Managing a catalog you cannot read is not a permission boundary, it is a broken one" (`apps/api/src/modules/it/catalog-items/catalog-item.routes.ts:26-45`). P1b.1 adds `administrationSupplier.create` and `.edit` to the categories read if OD-11 keeps `categoryIds` (§7.1: picker gates grow with the keys that need them) |
| `POST`, `PATCH /:id` on `/catalog-items`, `/item-categories` | `administrationCatalog.manage` + org authority (OD-04) | deactivate = `isActive: false` with `version` |
| `GET /items`, `GET /items/:id` | `administrationItem.view` | server-side `search` over code, name and barcode (ADR-019 rule 5; §19.4); resolve-by-id not filtered on active |
| `POST /items`, `PATCH /items/:id` | `administrationItem.create` / `.edit` + org authority | under OD-05 A the `ITM-` code is taken inside the create transaction |
| `GET /warehouses`, `GET /warehouses/:id` | `administrationWarehouse.view` | fail-closed (§7.2); a `branchId` filter only narrows, else 400 `OUT_OF_REACH` (`apps/api/src/modules/atm/shared/branch-scope.ts:60-76`); 404 outside reach |
| `POST /warehouses` | `administrationWarehouse.create` | `keyReachesBranch` on the body's branch (OD-10 A, §19.2) |
| `PATCH /warehouses/:id` | `administrationWarehouse.edit` | scoped load, then reach. `branchId` is not editable: the P5 ledger copies it onto every row, as in IT ("an item never changes branch", `apps/api/src/modules/it/consumables/consumable-history.ts:233`). Re-homing is OD-10's question. |
| `GET /warehouses/branch-options` | `administrationWarehouse.view` | declared before `/:id`. Every active branch, named and ordered as the branch switcher names and orders them (§13.4), each with `canView` (the reach of `administrationWarehouse.view` under the top bar's choice) and `canCreate` (`keyReachesBranch` on `administrationWarehouse.create`); a branch outside both reaches carries both false, as in the ATM register meta (`apps/api/src/modules/atm/register/register.service.ts:1297-1323`). The register's branch filter offers `canView` and the create dialog's branch `Select` `canCreate`; a filter outside reach still answers 400 `OUT_OF_REACH` |
| `GET /people`, `GET /people/:employeeId` | `authorizeAny('administrationWarehouse.create', 'administrationWarehouse.edit')` | the keeper picker (§7.8), only with a keeper |
| `GET /suppliers`, `GET /suppliers/:id` | `administrationSupplier.view` | P1b; as for items |
| `POST /suppliers`, `PATCH /suppliers/:id` | `administrationSupplier.create` / `.edit` + org authority | P1b; under OD-05 A the `SUP-` code is taken inside the create transaction |
| `POST /suppliers/:id/attachments`, `DELETE /suppliers/:id/attachments/:attachmentId` | `administrationSupplier.edit` + org authority (OD-04) | P1b, only if OD-11 keeps supplier papers: list B (§11.4), category `administration-supplier-documents`. Suppliers carry no scope field, so the authorizer finds any supplier under any scope of the key (§11.3); the organization-scope check is what keeps branch holders out |
| `GET /suppliers/:id/attachments/:attachmentId` | `administrationSupplier.view` | the bytes through `readEntityOwnedBuffer`, sent `private, no-store` (§11.5) |

There are 21 endpoints with a keeper (OD-10 A), 19 without; supplier papers (OD-11) add 3. None deletes a record
(§6.1); the one `DELETE` removes a paper's link (§11.4).

- Every `:param` route validates (`apps/api/src/infrastructure/http/route-param-validation.spec.ts:50-63`).
- Every update carries `version` and answers 409 `STALE_DOCUMENT` on a mismatch.
- Lists page at most 100 rows (`apps/api/src/shared/base/base.repository.ts:362-491`).
- Audit happens after commit (D-12).
- The warehouse DTO carries `canEdit`, because web gates are scope-blind and cannot compute per-key reach (§1.2; the
  `viewerMayDecide` precedent). For the same reason the branch-options read answers `canView` and `canCreate` per
  branch.

### 19.4 Contracts

| File | Holds |
|---|---|
| `packages/contracts/src/modules/administration-catalog.ts` | `ADMINISTRATION_CATALOG_KINDS = ['unit']`. `.strict()` create, update (with `version`) and list schemas and DTOs for catalog items, categories and items, named like `CreateItVendorSchema`. No on-hand field (ADR-024). No client `code` when codes are generated, and never a client `nameKey`: the service folds it from `name.ar` (§2.1). |
| `packages/contracts/src/modules/administration-warehouses.ts` | `ADMINISTRATION_WAREHOUSE_TYPES` (OD-10); schemas, where update has no `branchId`; a DTO with the keeper summary and `canEdit`; the branch-option DTO (`canView`, `canCreate`, §19.3) |
| `packages/contracts/src/modules/administration.ts` | no fold of its own: names are folded by the shared `foldName` PC-13 moves to `packages/contracts/src/common/` (§2.1). The master-code formatter and parser under OD-05 A (`ITM-`, `SUP-`; formatters live in contracts, §2.8 and §3.7; IT's `formatConsumableCode` shape, `apps/api/src/modules/it/consumables/consumable-number.ts:1-19`); the module-wide people query, id parameter and person DTO (§7.8 fields only). From P2 it gains the enums, events and document-number formatters (§3.7, §8.3) |
| `packages/contracts/src/modules/administration-procurement.ts` | P1b supplier schemas and DTO (OD-11, OD-12); PR, RFQ and PO shapes join later |

No events, settings keys, template keys or audit verbs. The only file-category key is
`administration-supplier-documents`, if OD-11 keeps supplier papers.

**List queries and DTO labels.** Every list takes `page`, `pageSize`, `sortBy` and `sortDir` from the shared
`PaginationQuerySchema`: `pageSize` defaults to 25, at most 100, and `sortDir` to `desc`
(`packages/contracts/src/common/index.ts:141-146`). A `sortBy` outside the list's sortable fields falls back to
`createdAt` (`apps/api/src/shared/base/base.repository.ts:367-370`); each service declares its fields, as IT's do
(`apps/api/src/modules/it/vendors/vendor.service.ts:90`). Labels resolve through `findByIdsSystem`, and the keeper
through `getDirectoryEmployees` (§19.8, the mappers).

| List | Query fields | Sortable fields | Labels on the DTO |
|---|---|---|---|
| `GET /catalog-items` | `kind` (required), `search` (code, name), `isActive` | `sortOrder`, `name.ar`, `createdAt` (IT's set less `kind`, which this list requires, `apps/api/src/modules/it/catalog-items/catalog-item.service.ts:68`) | — |
| `GET /item-categories` | `parentId`, `search` (code, name), `isActive` | `sortOrder`, `name.ar`, `createdAt` | the parent's name |
| `GET /items` | `search` (code, name, barcode), `categoryId`, `unitId`, `isActive` | `code`, `name.ar`, `createdAt` | the category's name and its parent's, the unit's name |
| `GET /warehouses` | `search` (code, name), `branchId` (narrows only, §19.3), `type`, `isActive` | `code`, `name.ar`, `createdAt` | the branch name, the keeper summary, `canEdit` |
| `GET /suppliers` | `search` (code, name), `categoryId` (if OD-11 keeps `categoryIds`), `isActive` | `code`, `name.ar`, `createdAt` | the category names (if OD-11 keeps `categoryIds`) |

### 19.5 Pages, keys and navigation

The 10 keys on 4 pages are those of §6.2–§6.3. P1a declares 7 keys on 3 pages; P1b adds `administrationSupplier.*` and
`administration.suppliers`. Pages ship in the API slice with their keys. This module's keys all name a page, so a key
whose page is missing fails boot (`unknown-page`, `packages/contracts/src/permissions/def.ts:193-199`), and a page
without a key fails boot too (`empty-page`, `:211-215`). Screens, routes and rows ship in the web slice.

| Route | Screen | Guard | Nav row (en / candidate ar) |
|---|---|---|---|
| `/administration` | `AdministrationHomePage`: tiles per grant, counts via `pageSize: 1` (IT's help-desk counts, `apps/web/src/modules/it/pages/ItHomePage.tsx:933-942`) | none (the page decides) | Administrative Affairs Home / الرئيسية → `administrationItem.view` |
| `/administration/items` | `ItemsPage` + `ItemFormDialog` | `administrationItem.view` | Items / الأصناف |
| `/administration/items/:id` | `ItemDetailPage` (§13.6 B) | `administrationItem.view` | — (opened from the list) |
| `/administration/warehouses` | `WarehousesPage` + `WarehouseFormDialog` | `administrationWarehouse.view` | Warehouses / المخازن |
| `/administration/catalogs` | `CatalogsPage` (units, categories) | `administrationCatalog.manage` | Units and categories / وحدات القياس والتصنيفات |
| `/administration/suppliers` (P1b.W) | `SuppliersPage` + `SupplierFormDialog` | `administrationSupplier.view` | Suppliers / الموردون |
| `/administration/suppliers/:id` (P1b.W) | `SupplierDetailPage` (§13.6 B; a documents card under OD-11) | `administrationSupplier.view` | — (opened from the list) |

- **Dialogs, not routes.** Create and edit are dialogs (`apps/web/src/modules/it/it-routes.spec.ts`); the detail pages
  edit through the list's dialog (§13.6 B).
- **The category.** Its English name must not be `'Administration'`, because `ensureCategory` matches `name.en`
  (`apps/api/src/seed-navigation.ts:1414-1431`). It sits after the ATM block, outside the parsed spans
  (`seed-application-sections.spec.ts:20-28`; `seed-navigation-operations.spec.ts:39-47`).
- **Sections.** None under OD-62's recommended default (A: sections later). §13.2's two sections ship only if the owner
  asks for them now (§19.2).
- **Icons.** Only registered icon keys; an unknown one falls back silently
  (`apps/web/src/platform/navigation/app-icon.tsx:106-109`). P1a.W registers two new glyphs and keys with the rows that
  name them: `box` (the category and Items) and `warehouse` (§13.1, §13.3). Units and categories use `tag`, Suppliers
  `company` and Administrative Affairs Home `home`, which exist. The launcher tile's picture is OD-62.1
  (recommended default: A, a box); the `warehouse` row glyph is the design's.

### 19.6 Realtime and audit

| Topic | Permission | Web key prefixes `['administration', …]` | Signal after commit |
|---|---|---|---|
| `administration.catalogItem` | `administrationCatalog.manage` in P1a.1, `administrationItem.view` from P1a.2 (§9.2) | `catalogs`, `items` | the audit's `create` / `update`; an explicit `update` after a (de)activation |
| `administration.itemCategory` | the same | `catalogs`, `items` | the same |
| `administration.item` | `administrationItem.view` | `items` (+ `stock` from P5) | the same |
| `administration.warehouse` | `administrationWarehouse.view` | `warehouses` (+ `stock` from P5) | the audit, plus `publishAuditedChange({ action: 'update', branchId })` after every act (`apps/api/src/modules/it/consumables/consumable-history.ts:104-111`) |
| `administration.supplier` (P1b) | `administrationSupplier.view` | `suppliers` (+ `rfqs` from P3, `purchaseOrders` from P4) | as for items; a paper link writes one `update` row (§11.4) |

- **The topic key.** A topic's key must be one a manifest declares (`realtime-registry.spec.ts:117-129`). In P1a.1 only
  `administrationCatalog.manage` exists, so P1a.2 moves the two catalog topics to `administrationItem.view`, the wider of
  their two read keys (§9.2).
- **Verbs.** Create and edit audit `create` and `update`, one row per act, through `diffChanges`. Deactivation and
  reactivation audit `deactivate` and `activate` with the `isActive` change (§5.3, §10.2), as IT's maintenance plans do
  (`apps/api/src/modules/it/maintenance/plan.service.ts:139-143`); a `PATCH` that flips `isActive` is that one row. IT
  vendors audit the same flip as `update` with an `isActive` diff
  (`apps/api/src/modules/it/vendors/vendor.service.ts:108-114`), which §10.2 does not follow. All four verbs exist,
  so `AUDIT_ACTIONS` is untouched.
- **Signals.** `activate` and `deactivate` are not among the eight broadcast actions
  (`packages/contracts/src/platform/realtime.ts:19-31`), so a (de)activation also sends
  `publishAuditedChange({ action: 'update' })` after commit, which reaches the organization room
  (`apps/api/src/platform/realtime/realtime-publisher.ts:40-74`). A warehouse sends it with its `branchId` after every
  audited act, whatever the verb (§9.1).
- **Literal refs.** One literal entity-ref helper per entity, in its `<entity>-audit.ts` (§10.1), keeps
  `EXPECTED_DYNAMIC_SITES` where it stands, 16 today (`apps/api/src/platform/realtime/realtime-registry.spec.ts:65`;
  10 at `b03522f`). A supplier paper's file uses the same literal `administration` / `supplier` pair, so it needs no
  new classification (§11.1).
- **Limitation.** Branch-scoped readers of organization-wide master data refetch on navigation, accepted ADR-029
  behavior (`docs/03-decisions/ADR-029-realtime-invalidation-over-the-audit-chokepoint.md:77-79`). From P1a.2, a
  holder of `administrationCatalog.manage` without `administrationItem.view` gets no live signal on /catalogs and
  refreshes on navigation and `staleTime` (§9.2; no seeded bundle is in that position).

### 19.7 Tests

**Pure specs first.** No database and no clock, in the shape of
`apps/api/src/modules/it/consumables/consumable-stock.spec.ts`.

| Spec | Checks |
|---|---|
| contracts `administration.spec.ts` | under OD-05 A, `ITM-00001` and `SUP-00001` format and parse; 0, negatives, fractions and overflow are refused (the `apps/api/src/modules/it/consumables/consumable-number.spec.ts` shape) |
| `shared/document-number.spec.ts` | the series keys (`item:global`, `supplier:global`) and the prefix the floor reads |
| `shared/collection-ready.spec.ts` | the first call builds once per process and later calls wait on it; a failed build throws, which refuses the write, and the next call builds again |
| the shared branch-scope spec (PC-12) | the §7.2 table, row by row: ATM's `apps/api/src/modules/atm/shared/branch-scope.spec.ts`, carried to `apps/api/src/shared/base/branch-scope.ts` with the rule; the module's `shared/branch-scope.spec.ts` covers only its two-branch helpers, from P5 and P7 |
| `shared/org-authority.spec.ts` | organization passes; every other scope and an unheld key get 403, through `assertOrganizationScope` (PC-12) |
| `catalog-item-rules.spec.ts` | a unit's `deactivationProblem`, which answers none (a unit has no deactivation rule, §5.3), and `activeFor` (§5.3, §5.16) |
| `item-category-rules.spec.ts` | depth (OD-06); no self-parent, no cycle; the parent is active; a category with children never moves; each refusal carries its `ADMINISTRATION_CATEGORY_PARENT_INVALID` detail code |
| `item-rules.spec.ts` | `minQty` ≤ `reorderPointQty` ≤ `maxQty` (OD-09); integers ≥ 0 (OD-08); inactive unit or category refused |
| `warehouse-rules.spec.ts`, `supplier-rules.spec.ts` | the type list (OD-10) and fixed branch; a warehouse's `deactivationProblem` under OD-70 (§5.3), which answers none in Phase 1, because nothing holds stock and no document names a warehouse; the OD-11 shape |
| `*-audit.spec.ts` | literal refs; `create`, `update`, `activate`, `deactivate`; the explicit `update` signal after a (de)activation, and the warehouse signal's `branchId` after every act (`consumable-history.spec.ts:152-264` precedent) |
| `people.service.spec.ts` | §7.8 fields only; new references search `employed` |
| `go-live/<list>-import.spec.ts` (OD-68 A) | the file's shape; every row passes the screen's Create schema; a row whose folded name matches a live row is that row, never a second one |
| contracts `administration-*.spec.ts` | strict schemas; unknown keys and any on-hand field refused (`packages/contracts/src/modules/it.spec.ts:390-412`); a supplier with 21 contacts is refused |
| `administration.module.spec.ts`, `administration-scope-guards.spec.ts`, `administration-indexes.spec.ts`, `administration-isolation.spec.ts` | the manifest validates and its surface is pinned (`apps/api/src/modules/atm/atm.module.spec.ts:26-80`); no permission name contains a parenthesis, which `scripts/check-page-registry.mjs` counts (ATM's guard, `atm.module.spec.ts:170-174`; §15.2.3); every repository declares its scope with a reason (the `apps/api/src/modules/hr/payroll/department-scope-guards.spec.ts` shape; `docs/12-planning/cross-module-dependency-audit.md:163-167`); the model list the seed passes to `syncDeclaredIndexes` covers every collection the module's `*.model.ts` files declare (the `apps/api/src/modules/fleet/fleet-indexes.spec.ts` shape; §15.3.2); a repository's first write awaits `ensureCollection`, so a failed build refuses the write and the next write retries (RK-03; the mock shape of `apps/api/src/modules/it/consumables/consumable-issue.spec.ts:51-67`); no file imports another module's folder (Fleet's `apps/api/src/modules/fleet/driver-profiles/drivers-are-derived.spec.ts:108-116`, widened; §3.7, RK-02) |
| web `lib/*-form.spec.ts`, `administration-{routes,i18n,api-contract}.spec.ts`, `administration-employee-picker.spec.ts` | the IT web guard trio, and IT's fourth guard: the keeper picker offers current staff only (`apps/web/src/modules/it/it-employee-picker.spec.ts`) |
| web `shared/lib/errors.spec.ts` (the module's case), `pages/{items,warehouses,suppliers}-screen.spec.tsx` | every Phase 1 code (§5.15) has en and ar text in `FRIENDLY`; the screens render (`renderToStaticMarkup`, IT's `apps/web/src/modules/it/pages/assets-screen.spec.tsx`) |

**Integration, three files (one more per loaded list under OD-68 A).** They follow the
`apps/api/tests/integration/it-consumables.spec.ts:59-270` harness, with shared module fixtures. Each refusal asserts
its code (§5.15) as well as its status; codes with details are thrown as
`new AppError(code, status, message, { details })` (`apps/api/src/shared/errors/index.ts:5-24`).

- **`administration-catalog.spec.ts`.**
  - CRUD for units, categories and items.
  - Refusals: 400 `VALIDATION_FAILED` for a schema error (`apps/api/src/shared/errors/index.ts:27-29`); 422 for a
    rule: `ADMINISTRATION_STOCK_LEVELS_ORDER` (levels out of the order `minQty` ≤ `reorderPointQty` ≤ `maxQty`, one
    detail per field out of order), `ADMINISTRATION_REFERENCE_INACTIVE` (an inactive unit or category) and
    `ADMINISTRATION_CATEGORY_PARENT_INVALID` (self, cycle, depth, an inactive parent, a category with children
    moved); 409 `ADMINISTRATION_DUPLICATE` with its field; 409 `STALE_DOCUMENT`; 403 without the key; 403 below
    organization scope (OD-04). A unit or category deactivates freely (§5.3).
  - An item viewer reads units and categories.
  - Two simultaneous creates of «قطعه» and «قطعة» → one 201, one 409 `ADMINISTRATION_DUPLICATE` (field `name`), for
    units, categories and items: the folded `nameKey` index is the race guard (`ux_kind_name_key`,
    `ux_parent_name_key`, items' `ux_name_key`; §2.1).
  - Under OD-05 A, two simultaneous item creates both answer 201, with consecutive codes. A create carrying a live
    item's barcode fails on `ux_barcode` inside its transaction with 409 `ADMINISTRATION_DUPLICATE` (field `barcode`;
    barcodes have no service pre-check, so the index is the check), and the next create takes the same `ITM-` number,
    so the series has no gap. An item is found by its barcode through `search`.
  - A category move racing a child create under it can leave three levels; it needs two organization-scope catalog
    managers on one category at once (OD-04 A) and is accepted for Phase 1; an edit repairs it.
- **`administration-warehouses.spec.ts`.**
  - An organization holder reads everything, and `X-Active-Branch` narrows it. A branch-A holder gets 404 on B's
    warehouse, on GET and on PATCH. `own` reads nothing.
  - Department grants. A home-only department holder reads their branch and cannot write while the department is
    reference-only (OD-10 A); if OD-10 makes it a write axis, they write their own department's warehouse and nothing
    else. Department copies, by role reach or ADR-032 delegation, read the copies' branches and never write (§7.2;
    RK-15).
  - A create in B with an A key answers 403, and an out-of-reach `branchId` filter answers 400.
  - The branch-options read lists every active branch, each with `canView` and `canCreate` by its own key's reach, a
    branch outside both carrying both false.
  - A duplicate code or name answers 409 `ADMINISTRATION_DUPLICATE` with its field, and a stale `version` 409
    `STALE_DOCUMENT`. Two simultaneous creates in one branch of «مخزن الأدوات» and «مخزن الادوات» → one 201, one 409
    `ADMINISTRATION_DUPLICATE` (field `name`): `ux_branch_name_key` is the race guard (§2.1, §2.3.5).
  - A warehouse deactivates freely: nothing holds stock in Phase 1 (§5.3).
  - The keeper picker answers 403 without create or edit, and an exited employee is refused as keeper with 422
    `ADMINISTRATION_EMPLOYEE_EXITED`.
  - From P1a.W, a role holding only `administrationWarehouse.view` gets exactly the Warehouses row from
    `GET /platform/me/applications` (the `apps/api/tests/integration/operations-navigation.spec.ts` precedent).
- **`administration-suppliers.spec.ts`** (P1b).
  - CRUD, search, organization scope, and resolve-by-id of an inactive supplier; a duplicate name answers 409
    `ADMINISTRATION_DUPLICATE` and a stale `version` 409 `STALE_DOCUMENT`.
  - Two simultaneous creates of «قطعه» and «قطعة» → one 201, one 409 `ADMINISTRATION_DUPLICATE` (field `name`;
    suppliers' `ux_name_key`, §2.1).
  - Under OD-05 A, concurrent creates get consecutive `SUP-` codes, and a rolled-back create leaves no gap.
  - A supplier editor reads the categories, if OD-11 keeps `categoryIds`.
  - Under OD-11 A, a paper is filed and read under the supplier's keys; a branch-scoped `administrationSupplier.edit`
    holder is refused (OD-04 A); a link to a file of another category or entity is refused (§11.4).
- **`administration-go-live-<list>.spec.ts`** (OD-68 A; the
  `apps/api/tests/integration/it-go-live-consumables-opening.spec.ts` precedent).
  - The step loads its file in one transaction and writes its run row; a second boot finds the run row and writes
    nothing; a row whose folded name matches a live row is that row.

**Existing pins** (numbered #1–#26; each one either changes or stays).

- **These change:**
  - #1 `seed-navigation.spec.ts:81`: 140 → 144 (P1a.W) → 145 (P1b.W) (136 at `b03522f`).
  - #2 `auth-seed-login.spec.ts`: `:37` (the same numbers; the breakdown comment still adds up to 139, with Operations at 18, one row behind the constant), the order list `:142-151`, the breakdown comment and its
    sum before the length assertion (`:291-298`; the comment still reads 18 Operations rows and 139, one behind the seed's
    19 and 140, so it is re-counted from `seed-navigation.ts`), the category comments `:133-141` and `:313-314`, and
    `:315` (8 → 9).
  - #2b `apps/web/src/platform/navigation/module-icons.spec.ts`: the tile list (`:49-58`) and the glyph map
    (`:65-74`) gain `'Administrative Affairs'` and `BoxIcon` (§13.1, §13.3).
  - #7 `check-page-registry.mjs:65`.
  - #8 remembered filters: seven pages. Items, Warehouses and Suppliers are COVERED; Catalogs is COVERED as
    `ItCatalogsPage` is, with `['kind']` (`apps/web/src/shared/lib/remembered-filters-coverage.spec.ts:153`); Home,
    ItemDetail and SupplierDetail are NOT_FILTER_CAPABLE (the `AtmOverviewPage` and `AssetDetailPage` precedent,
    `:285`, `:401`; `ItHomePage` became COVERED with the IT dashboard's filters, `:156`).
  - #15 `targets.ts`.
  - #16: if `keep`, `administration_warehouses` sorts first in `untouched`, which grows 13 → 14
    (`apps/api/tests/integration/workforce-reset.spec.ts:223-243`), and the `includeRecruitment` count goes 12 → 13
    (`:361`).
  - #26: new module pins: `administration.module.spec.ts`, `seed-navigation-administration.spec.ts` and the module's
    other specs of this section.
  - #3, only if OD-62 ships sections now: `seed-application-sections.spec.ts` reads from `HR: [` to the object's end
    (`:43-45`) and counts six HR sections (`:72`), so the entry goes before `HR: [`, or the span it reads is bounded.
- **These stay**, because:
  - #3 (`apps/api/src/seed-application-sections.spec.ts:20-28`) and #4
    (`apps/api/src/seed-navigation-operations.spec.ts:39-47`): the category is placed after ATM, outside both parsed
    spans (and, for #3, no sections ship under OD-62 A).
  - #5: `apps/api/src/platform/kernel/page-registry.spec.ts:16` pins hr, fleet and it only.
  - #6: `packages/contracts/src/permissions/pages.spec.ts:144-148` pins 18 platform pages and 69 platform permissions;
    no platform pages or keys change.
  - #9 (`apps/api/src/platform/realtime/realtime-registry.spec.ts:100-129`) and #10
    (`apps/web/src/platform/realtime/realtime.spec.ts:166-215`): the registries they read (`realtime-registry.ts`,
    `invalidation-registry.ts`) gain five topics; the specs themselves do not change.
  - #11 (`apps/api/src/platform/settings/settings-inventory.spec.ts:89-103`) and #12
    (`apps/web/src/modules/system-admin/settings/pages/SettingsPage.spec.tsx:279-287`): no settings. #13
    (`packages/contracts/src/events/catalog.spec.ts:181-195`) and #14
    (`apps/api/src/platform/kernel/event-publishers.spec.ts:165-170`): no events.
  - #17 (`apps/api/src/org-catalog-migration/references.spec.ts:188-200`): no `departmentId` in arrays.
  - #18: models load through `./modules` (`apps/api/src/sync-indexes.models.ts:10-11`), the go-live run model
    included, because it is in `administrationModels` (§19.8).
  - #19–#24: no printed papers, operator CLIs, server exports, audit verbs, notification categories or notification
    templates (OD-11 A's supplier file category is not a notification category): #19
    `apps/web/src/shared/lib/print-window.spec.ts:138-155`, #20 `apps/api/src/operator-cli-safety.spec.ts:16-22`, #21
    `apps/api/src/shared/utils/stream-rows.spec.ts:110-123`, #22
    `apps/web/src/modules/system-admin/system-admin-i18n.spec.ts:113-127`, #23 `system-admin-i18n.spec.ts:56-60`, #24
    `apps/api/src/platform/notifications/notification.builtin-templates.spec.ts:36-37`.
  - #25 (`apps/api/src/platform/platform-routes-exist.spec.ts:150-170`): only existing `/platform/*/options` calls.

### 19.8 The file list

C = create, M = modify; "C, M" = created in the first pull request listed and modified in the later ones; "C if …" or
"M if …" = only under that decision. Module paths are relative to `apps/api/src/modules/administration/`. Each
`x.{model,repository,service,controller,routes}.ts` group follows the IT feature shape (`it/vendors/`).

**Contracts**

| File | C/M | Pull request | Purpose |
|---|---|---|---|
| `packages/contracts/src/modules/administration-catalog.ts` + `.spec.ts` | C | P1a.1–2 | units, categories, items |
| `packages/contracts/src/modules/administration-warehouses.ts` + `.spec.ts` | C | P1a.3 | warehouses, and the branch-option DTO (§19.3) |
| `packages/contracts/src/modules/administration.ts` + `.spec.ts` | C, M | P1a.2; P1a.3 | the master-code formatter and parser (OD-05 A, P1a.2) and the people shapes (P1a.3); no fold of its own: names fold through the shared `foldName` (PC-13), so the file is created in P1a.3 if OD-05 picks typed codes |
| `packages/contracts/src/modules/administration-procurement.ts` + `.spec.ts` | C | P1b.1 | suppliers |
| `packages/contracts/src/index.ts` | M | each | `export * from './modules/administration….js'` (`:65-81`) |
| `packages/contracts/src/errors/index.ts` | M | P1a.1–3 | the Phase 1 refusal codes of §5.15, module-prefixed like `ATM_WORK_BRANCH_REQUIRED` (`:475`): `ADMINISTRATION_CATEGORY_PARENT_INVALID` and `ADMINISTRATION_DUPLICATE` (P1a.1); `ADMINISTRATION_STOCK_LEVELS_ORDER` and `ADMINISTRATION_REFERENCE_INACTIVE` (P1a.2); `ADMINISTRATION_EMPLOYEE_EXITED` and `ADMINISTRATION_DEACTIVATION_BLOCKED`, with the warehouse rule that raises it, first met once stock or documents exist (P1a.3). The transition codes of §5.15 arrive from P2 |

**API module**

| File | C/M | Pull request | Purpose |
|---|---|---|---|
| `administration.module.ts` | C, M | P1a.1; P1a.2, P1a.3, P1b.1 | manifest: `id: 'administration'`, `name` (en "Administrative Affairs", ar per OD-62), `version: '0.1.0'`, `requiresPlatform: '^2.2'`, permissions, `pages: administrationPages`, routes, collections, `eventSubscriptions: []`, seed; in P1b.1, `fileEntityAuthorizers: [supplierFileAuthorizer]` if OD-11 keeps papers (`apps/api/src/platform/kernel/module-registry.ts:43-78`) |
| `administration.module.spec.ts` | C, M | P1a.1; every later pull request | manifest validates; surface pinned |
| `administration.seed.ts` | C, M | P1a.1; P1a.2, P1b.1 | indexes first, through the shared `syncDeclaredIndexes('apply', administrationModels)` (`apps/api/src/shared/base/index-sync.ts:338-341`; §15.3.2), its report logged through `reportLines` and `reportSummary` (`:467-529`); the seed holds no state, and `collectionReady` guards each write (RK-03). Then counters (`item:global` P1a.2, `supplier:global` P1b.1, under OD-05 A); the supplier-papers category (P1b.1, OD-11); the ready-made roles OD-78 A keeps, as managed roles (D-20; `rbacService.ensureManagedRole`, `apps/api/src/modules/gold/gold.seed.ts:40-44`). A bundle is created in the first pull request that gives it a key (the master-data administrator in P1a.1; the storekeeper, procurement officer, procurement manager, Administrative Affairs manager and auditor in P1a.2, §6.5), with its OD-67 title; a title changed after seeding is renamed by hand or by a run-keyed step, because `ensureManagedRole` never rewrites a name (`apps/api/src/platform/rbac/rbac.service.ts:1646-1656`) |
| `administration-indexes.ts` + `.spec.ts` | C | P1a.1 | `administrationModels`, the model list the seed passes to the shared `syncDeclaredIndexes`; no copied builder (§15.3.2) |
| `administration.mappers.ts` | C, M | P1a.1; P1a.2, P1a.3, P1b.1 | doc → DTO; the labels of §19.4's list table via `findByIdsSystem`, the keeper via `getDirectoryEmployees` |
| `administration-scope-guards.spec.ts` | C, M | P1a.1; P1a.3, P1b.1 | scope options declared everywhere (the payroll `department-scope-guards.spec.ts` shape) |
| `administration-isolation.spec.ts` | C | P1a.1 | no import from another module's folder (§3.7) |
| `shared/collection-ready.ts` + `.spec.ts` | C | P1a.1 | `collectionReady(model)`, a copy of `apps/api/src/modules/it/mobile-lines/ensure-collection.ts:18-30`: built once per process, a failure forgotten so the next write retries. Every module repository declares `readonly ensureCollection = collectionReady(Model)`, and the bookkeeping models (counter, balances, go-live runs) hold one in their own functions (§2.1 note 10); each awaits it before its first write, and before any transaction that writes it (`apps/api/src/modules/it/consumables/consumable-history.ts:265-278`): units and categories (P1a.1), items and the counter (P1a.2), warehouses (P1a.3), suppliers (P1b.1), the balances and the ledger (P5; the ledger has no `ux_*` index but is first written inside the posting transaction) |
| `shared/org-authority.ts` + `.spec.ts` | C | P1a.1 | `assertAdministrationOrgAuthority` (§6.7), naming the module's keys over `assertOrganizationScope` (`apps/api/src/shared/base/org-authority.ts`, PC-12), which ATM's `assertAtmSettingsManager` (`apps/api/src/modules/atm/shared/settings-authority.ts:12-20`) and its bank rule ("a bank is company-wide", `apps/api/src/modules/atm/catalogs/bank.service.ts:131-138`) call |
| `shared/counter.model.ts` | C | P1a.2 under OD-05 A (P1a.1 under B, P2 under C) | `administration_counters`, the module's counter model built with the shared counter factory (`apps/api/src/shared/base/counter.ts`, PC-13): ensured outside the transaction, moved inside it |
| `shared/document-number.ts` + `.spec.ts` | C | with the counter | series keys and floors: the master codes now, document series from P2; the formatters live in contracts (§2.8) |
| `shared/branch-scope.ts` + `.spec.ts` | C, M | P1a.3 (the loader); P5, P7 (the helpers and their spec) | `activeBranchIds()`, one line over `platform/organization`'s `branchRepository` (P1a.3): the candidate list PC-12's shared `writableBranches` and `resolveWorkBranch` take, and the branch-options read's branch list (ATM's loader, `apps/api/src/modules/atm/shared/branch-scope.ts:79-82`). Then the module's own two-branch helpers, `branchScopeMatchOn` (P5) and `twoBranchScopeMatch` (P7), and the `isNeverMatch` they use (§3.5, §7.4). The fail-closed rule itself is imported from `apps/api/src/shared/base/branch-scope.ts` once PC-12 has written it there (its `branchScopeBranches` reading the shared `selectorBranches`, `apps/api/src/shared/types/index.ts:284-308`, in place of ATM's `registerScopeBranches` import, `atm/shared/branch-scope.ts:33`), so no ATM file is imported or copied |
| `catalog/catalog-items/catalog-item.{…}.ts`, `catalog-item-rules.ts` + spec, `catalog-item-audit.ts` + spec, `index.ts` | C | P1a.1 | units |
| `catalog/item-categories/item-category.{…}.ts`, `item-category-rules.ts` + spec, `item-category-audit.ts` + spec, `index.ts` | C | P1a.1 | categories |
| `catalog/items/item.{…}.ts`, `item-rules.ts` + spec, `item-audit.ts` + spec, `index.ts` | C | P1a.2 | items |
| `warehouses/warehouses/warehouse.{…}.ts`, `warehouse-rules.ts` + spec, `warehouse-audit.ts` + spec, `index.ts` | C | P1a.3 | warehouses, and the branch-options read (§19.3) |
| `people/people.{service,controller,routes}.ts`, `people.service.spec.ts`, `index.ts` | C if keeper | P1a.3 | keeper picker through `platform/directory` (`it/people/`) |
| `procurement/suppliers/supplier.{…}.ts`, `supplier-rules.ts` + spec, `supplier-audit.ts` + spec, `index.ts` | C | P1b.1 | suppliers |
| `procurement/suppliers/supplier-files.ts` | C if OD-11 | P1b.1 | category `administration-supplier-documents`; authorizer `administration/supplier` (read `.view`, write `.edit`, §11.3); the three paper endpoints, with the organization-scope check |
| `go-live/<list>-import.ts` + spec | C if OD-68 A | P1a.2 (units, categories, items); P1b.1 (suppliers) | pure: the file's shape and rows, validated with the screens' Create schemas, and the folded-name match that makes a row naming a live record that record (IT's `apps/api/src/modules/it/go-live/consumables-opening-import.ts` shape) |
| `go-live/<list>.ts` | C if OD-68 A | the same | the boot step: it creates each row through the owning feature's exported create function with its session (§3.4), so `catalog/*` and `procurement/suppliers` stay the sole writers of their collections (§3.3); every collection the transaction writes awaits its `ensureCollection` before it (`apps/api/src/modules/it/go-live/consumables-opening.ts:161-163`); a versioned run key in IT's shape (`go-live:administration-<list>-<yyyy-mm>:v1`, as `apps/api/src/modules/it/go-live/consumables-opening.ts:77-78`); the run row written last, in the same transaction; an audit `create` per row after commit |
| `shared/go-live-run.model.ts` | C if OD-68 A | the first of those pull requests | the run marker (`it/go-live/go-live-run.model.ts`), in `administrationModels`, so `sync-indexes.models.ts` does not change; otherwise it arrives in P5 under OD-63 B |
| `apps/api/assets/administration-go-live/<list>-<yyyy-mm>.json` | C if OD-68 A | the same as its step | the owner's file, reviewed with the owner before it is committed, as IT's are (`apps/api/assets/it-go-live/`; `tsup.config.ts:47` copies `assets/` into the build); no supplier contact data: contacts are typed in the app after the load (§15.3.5 d) |

**Platform registries and global specs**

| File | C/M | Pull request | Purpose |
|---|---|---|---|
| `apps/api/src/modules/index.ts` | M | P1a.1 | import and `moduleManifests` entry, with no env gate (D-19) |
| `scripts/check-page-registry.mjs` | M | P1a.1 | `'administration'` in `MODULES` (`:65`) |
| `apps/api/src/platform/realtime/realtime-registry.ts` | M | P1a.1–3, P1b.1 | the §19.6 topics; P1a.2 changes the two catalog rows' key |
| `apps/web/src/platform/realtime/invalidation-registry.ts` | M | same | their rows |
| `apps/web/src/platform/localization/i18n.ts` | M | P1a.1 | `systemAdmin.roles.module.administration` in en (`:11257-11265`) and ar (`:27147-27155`) |
| `apps/api/src/workforce-reset/targets.ts` | M | P1a.3 | classify `administration_warehouses` (OD-64) |
| `apps/api/src/workforce-reset/targets.spec.ts` | M if `keep` (optional) | P1a.3 | the keep spot list (`:76-91`), by the `c97667f` precedent |
| `apps/api/tests/integration/workforce-reset.spec.ts` | M if `keep` | P1a.3 | the `untouched` list (`:223-243`, 13 → 14) and the `includeRecruitment` count (`:361`, 12 → 13) |
| `apps/api/src/server.ts`, `apps/api/src/worker.ts` | M if OD-68 A | P1a.2; P1b.1 | each go-live step's start call, beside IT's (`server.ts:149`, `worker.ts:115`) |

**Seeds and navigation**

| File | C/M | Pull request | Purpose |
|---|---|---|---|
| `apps/api/src/seed-navigation.ts` | M | P1a.W, P1b.W | `CategoryDef` after ATM; four rows, then suppliers |
| `apps/api/src/seed-navigation.spec.ts` | M | P1a.W, P1b.W | 140 → 144 → 145 (`:81`) |
| `apps/api/tests/integration/auth-seed-login.spec.ts` | M | P1a.W, P1b.W | `:37`, `:142-151`, `:291-298`, `:315`, and the category comments `:133-141`, `:313-314` |
| `apps/api/src/seed-navigation-administration.spec.ts` | C, M | P1a.W, P1b.W | rows ⇄ routes ⇄ guard keys ⇄ icons; block placement (Operations precedent) |
| `apps/api/src/seed-application-sections.ts` | M if OD-62 wants sections now | P1a.W, P1b.W | `APPLICATION_SECTION_DEFAULTS['Administrative Affairs']`, placed before `HR: [` (`seed-application-sections.spec.ts:43-45`, `:72`); the Procurement section only with the supplier row, because a section route must be a seeded row (`seed-navigation.spec.ts:48-57`) |

**Integration tests**

| File | C/M | Pull request | Purpose |
|---|---|---|---|
| `apps/api/tests/integration/helpers/administration-fixtures.ts` | C | P1a.1 | users, scoped roles, branches, planted employees, written once (module helpers already live in `helpers/`) |
| `apps/api/tests/integration/administration-catalog.spec.ts` | C | P1a.1, P1a.2 | §19.7 |
| `apps/api/tests/integration/administration-warehouses.spec.ts` | C, M | P1a.3; P1a.W | §19.7; P1a.W adds the `GET /platform/me/applications` case (§19.10.2) |
| `apps/api/tests/integration/administration-suppliers.spec.ts` | C | P1b.1 | §19.7 |
| `apps/api/tests/integration/administration-go-live-<list>.spec.ts` | C if OD-68 A | P1a.2; P1b.1 | §19.7, one per loaded list |

**Web** (under `apps/web/src/`; module files under `modules/administration/`)

| File | C/M | Pull request | Purpose |
|---|---|---|---|
| `platform/app/App.tsx` | M | P1a.W | lazy `AdministrationRoutes`; `/administration/*` above the `/*` catch-all (`:433-447`, `:538`) |
| `routes.tsx` | C, M | P1a.W, P1b.W | `AppShell`, `RequirePermission` per route, `NotFoundPage`, route → key table |
| `api/administration-keys.ts` | C | P1a.W | the module's key subtrees (`catalogs`, `items`, `warehouses`, `people`, later `suppliers`), built with `featureKey`, `listKey` and `detailKey` (`shared/lib/query-keys.ts`, ADR-013). One file because several `*-queries.ts` share them (ATM re-declares the register's keys in `apps/web/src/modules/atm/api/atm-queries.ts:53-56` to match `register-queries.ts`); the invalidation rows repeat them as literal prefixes (`apps/web/src/platform/realtime/invalidation-registry.ts` imports nothing). A departure from ATM and IT, which keep their keys inside `*-queries.ts` (`atm/api/atm-queries.ts:46-60`, `it/api/it-queries.ts:76`) |
| `api/{catalog,warehouses,people}-{api,queries}.ts` | C | P1a.W | calls and hooks; module-own branch options, and department options if OD-10 gives warehouses a department, over `/platform/branches/options` and `/platform/departments/options` (IT `it/api/it-api.ts:142-158`; §13.6 A); the warehouses branch filter and the create dialog's branch `Select` over `/administration/warehouses/branch-options` (§19.3); people only with a keeper |
| `api/suppliers-{api,queries}.ts` | C | P1b.W | suppliers |
| `pages/{AdministrationHomePage,ItemsPage,ItemDetailPage,WarehousesPage,CatalogsPage}.tsx` | C | P1a.W | §19.5 |
| `pages/{SuppliersPage,SupplierDetailPage}.tsx` | C | P1b.W | the supplier register and record |
| `components/{ItemFormDialog,WarehouseFormDialog,UnitDialog,ItemCategoryDialog,CatalogSelect,EmployeePicker}.tsx` | C | P1a.W | dialogs and selects (IT `CatalogItemDialog`, `ItCatalogSelect`, `EmployeePicker`) |
| `components/AdministrationDialogFrame.tsx` | C | P1a.W | the Cancel / Save frame with `dismissOnOutsideClick={false}` that the four P1a.W dialogs and, in P1b.W, the supplier dialog share (§13.6 E; IT's file-local `Shell`, `apps/web/src/modules/it/components/ConsumableDialogs.tsx:137`) |
| `components/SupplierFormDialog.tsx` | C | P1b.W | |
| `components/SupplierDocuments.tsx` | C if OD-11 | P1b.W | the documents card over the module's paper routes (rebuilt from IT's `CustodyReceipt.tsx` pattern; §11.5) |
| `lib/{item-form,warehouse-form}.ts` + specs | C | P1a.W | form state mirroring the contracts |
| `lib/supplier-form.ts` + spec | C | P1b.W | |
| `shared/lib/errors.ts` + `errors.spec.ts` (shared web) | M | P1a.W; P1b.W | the module's codes in `FRIENDLY`, en and ar, and its case in the spec (IT's and Organization's precedent, `:148-153`, `:10-18`); the shared error panel words them too (`shared/ui/states/ErrorState.tsx:35-38`) |
| `administration-{routes,i18n,api-contract}.spec.ts` | C, M | P1a.W, P1b.W | the IT guard trio |
| `administration-employee-picker.spec.ts` | C if keeper | P1a.W | current staff only (`it-employee-picker.spec.ts`) |
| `pages/{items,warehouses}-screen.spec.tsx` | C | P1a.W | `renderToStaticMarkup` checks (IT `assets-screen.spec.tsx`) |
| `pages/suppliers-screen.spec.tsx` | C | P1b.W | the same for suppliers |
| `platform/localization/i18n.ts` | M | P1a.W, P1b.W | `administration.module.*`, `administration.nav.*` and `administration.<feature>.<area>.<key>` in en and ar |
| `platform/navigation/app-icon.tsx`, `shared/ui/icons.tsx`, `platform/navigation/module-icons.spec.ts` | M | P1a.W | the glyphs and keys `box` and `warehouse` (§13.1, §13.3); the launcher spec's tile list and glyph map gain `'Administrative Affairs'` → `BoxIcon` |
| `shared/lib/remembered-filters-coverage.spec.ts` | M | P1a.W, P1b.W | Items, Warehouses, Suppliers COVERED; Catalogs as `ItCatalogsPage` (`:153`); Home, ItemDetail and SupplierDetail NOT_FILTER_CAPABLE; `TAB_SCOPED` stays 7 |

`Fact` and the catalogs tablist are page-local, as in IT (`apps/web/src/modules/it/pages/AssetDetailPage.tsx:74`,
`apps/web/src/modules/it/pages/ItCatalogsPage.tsx:201`), inside `ItemDetailPage.tsx`, `SupplierDetailPage.tsx` and
`CatalogsPage.tsx`; `ReferencePicker` ships with `ItemPicker` in P2 (§13.6 D).

**Docs**

| File | C/M | Pull request | Purpose |
|---|---|---|---|
| the four design files (`docs/12-planning/administration-module-design.md`, `-design-flows.md`, `-design-integration.md`, `-decisions-and-phases.md`) | M | each | a §22 revision per deviation; §22 is in `administration-module-decisions-and-phases.md` |
| `CHANGELOG.md` | M | each | `[Unreleased]` entry: owner quote, keys, design link |
| `docs/06-security/permission-matrix.md` | M if adopted (§19.2) | P1a.1, P1b.1 | an Administrative Affairs section under governance rule 2 (`:105`). New practice: no module since Recruitment has added one (§6.1) |
| `docs/03-decisions/ADR-0NN-…supplier-registry.md`, and its row in `README.md` | C (the ADR), M (`README.md`) | a docs pull request before P1b.1 | numbered when taken (next free ADR-040; ADR-039, the inactivity-window setting, was taken after `4c0fa1b0`, `docs/03-decisions/README.md:50`); accepted before P1b.1's first code (§20) |
| `docs/12-planning/it-module-design.md` §16 P4, §17 | M | P1b.1 | the registry trigger has fired (OD-01) |
| `docs/01-business/module-hierarchy.md` | M | at freeze (§21); P1a.1 checks it | the reserved `administration` row (`:75`): display name (OD-62), sub-modules, a link to this design |

### 19.9 What Phase 1 does not touch

- **Stock and documents.** No movements, balances, opening balances, PRs, RFQs or POs. Items carry no on-hand field.
  `cairo-day.ts` waits for the P2 yearly series.
- **Approvals, events, notifications, scheduler.** No request type and no `platform/approvals` change (PX-1 is its own
  slice). The event catalog, templates, `NOTIFICATION_CATEGORIES`, `ENTITY_ROUTES`, scheduled tasks, job handlers and
  sweep marks are untouched.
- **Settings and flags.** No `administration.settings.ts`. `settings-inventory.spec.ts`, `SettingsPage.spec.tsx`, the
  settings screen's catalog (`settings-catalog.ts`) and `featureFlags` are untouched.
- **Audit vocabulary.** `AUDIT_ACTIONS` is untouched: `create`, `update`, `activate` and `deactivate` exist.
- **Papers, exports, files.** No print path, `.print` or `.export` key, or server export. A client Excel of a register
  rides `.view` and comes only if the owner asks; the shared export walk then moves first (§18.1). No file category
  unless OD-11 keeps supplier papers.
- **Other modules (IT, Fleet, HR, ATM).** `it_vendors`, `it_consumables`, `it_spare_parts` and Fleet workshops are
  unchanged. Nothing imports another module, and no data migrates (D-17, OD-01, OD-02). ATM changes only through PC-12,
  its own pull request ahead of Phase 1, which writes its branch-scope rule and organization-scope check in
  `apps/api/src/shared/base/` and keeps ATM's exported names as thin wrappers, without changing their behavior; IT
  changes only through PC-13, which moves `foldName` to contracts with IT importing it (§18.1). HR's
  `employee-name-copies.ts` gains no path: warehouses store no `*name` path (the keeper is resolved at read time), and
  `name` is an inline {ar, en} whose paths, `name.ar` and `name.en`, do not match its `/name$/i`
  (`apps/api/src/modules/hr/employee-management/employees/employee-name-copies.ts:32`).
- **Platform code.** No platform behavior changes. Under `apps/api/src/platform/`, only the realtime registry gains
  rows (`platform/realtime/realtime-registry.ts`); on the web, the platform files §19.8 lists gain the module's entries
  (`platform/app/App.tsx`, `platform/realtime/invalidation-registry.ts`, `platform/localization/i18n.ts`,
  `platform/navigation/app-icon.tsx`), and the shared `shared/lib/errors.ts` gains the module's codes (§19.8). Nothing under `platform/auth`, `platform/rbac` or
  `packages/contracts/src/permissions/` changes, so the generated matrix, `pages.spec.ts` and the CODEOWNERS
  second-reviewer paths (`.github/CODEOWNERS:9-13`) are not touched.
- **Org, entrypoints, environment.** No `departmentId` in arrays and no cost center (D-CC-3).
  `sync-indexes.models.ts`, `tsup.config.ts`, `env.ts` and `.env.example` are untouched; `server.ts` and `worker.ts`
  change only under OD-68 A, for each go-live step's start call (§19.8).

### 19.10 Exit criteria

1. **CI and boot.** Every Phase 1 pull request is green. `check-page-registry` passes with its total up by 4 pages and
   10 keys (it prints totals only, `scripts/check-page-registry.mjs:85-89`), and `administration.module.spec.ts` pins
   the 4 page ids. Every integration suite boots with the manifest. Every repository whose collection carries a `ux_*`
   index awaits `ensureCollection` before its first write, so a failed index build refuses that write and the next
   write retries, and a spec pins it (§19.7).
2. **Navigation.** A role holding only P1 keys sees exactly the rows of its keys:
   `seed-navigation-administration.spec.ts` checks rows against keys, and the `administration-warehouses.spec.ts` case
   reads `GET /platform/me/applications` (§19.7). Super-admin sees five rows. The item and supplier detail routes open
   from their lists.
3. **Warehouse scope.** The §7.2 matrix is covered by specs: 404 outside reach, writes refused outside reach,
   active-branch narrowing, department copies that read and never write. The branch-options read lists every active
   branch with `canView` and `canCreate`, so the register's branch filter offers no branch outside reach (§19.3).
4. **Master-data writes.** They are refused below organization scope if OD-04 is central (recommended default: A),
   supplier papers included (OD-11).
5. **Concurrency.** Under OD-05 A, concurrent item creates, and in P1b supplier creates, get consecutive, distinct
   codes, and a rolled-back create leaves no gap. A stale `version` answers 409. Two spellings of one name never make
   two rows (the folded `nameKey` index, §2.1).
6. **Realtime.** Five topics are classified and mapped; the two catalog topics carry `administrationItem.view` from
   P1a.2 (§9.2). A (de)activation sends its explicit `update` signal, and the warehouse signal, with its `branchId`,
   follows every warehouse act; both are pinned (§19.6).
7. **Language.** The formal-Arabic, placeholder and module i18n specs are green, and no raw key shows in the role
   matrix.
8. **Docs.** CHANGELOG entries, the permission-matrix section if adopted (§19.2), the supplier-registry ADR (accepted
   before P1b.1), and §22 entries for any deviation are written.
9. **Owner acceptance.** The owner accepts the result on staging with real item families (OD-03), entered by hand
   (OD-68 B, §16.12).

---

## 20. Required ADRs

ADR numbers follow the order in which decisions are **taken**, never the order of this table; the next free number is
**ADR-039** (`docs/03-decisions/README.md`; ADR-035 to ADR-038 were taken after discovery). Numbers are therefore
**not** reserved here — the IT design reserved three and had to renumber twice (`docs/12-planning/it-module-design.md`
§14). Each ADR below is written in a documentation pull request, after its decision is taken and before the first code
pull request that depends on it (`CONTRIBUTING.md:27-28`; the owner's brief lists ADRs among what is reviewed before
implementation).

| ADR (title) | Records | Accepted before | Depends on |
|---|---|---|---|
| **Stock is a movement ledger owned by Warehouses** | D-2/D-3: append-only movements, the projection and its single writer, guarded `$inc`, no negative stock, two-step transfers and the in-transit bucket, read-time running balance; **extends ADR-024** and states what happens to its "boundary Procurement and Warehouses inherit" — who writes IT receipts, whether IT's `onHandQty` stays IT's | P5's first code pull request (the first movement) | OD-02, OD-53 |
| **The supplier registry** | where the one registry of external parties lives, its seam for IT/Fleet, and the staged path that retires `it_vendors` and Fleet workshop rows, and whether Fleet's free-text vehicle-contract suppliers join through a human-named map (OD-01) (IT design §16 P4 — its trigger is this design) | P1b.1 (suppliers), in a docs pull request before it | OD-01 |
| **Money approvals on the platform engine** | the no-chain policy, chain pinning per request (proposed: the host stores the pin in `approvalWorkflowId` and `approvalChainShape`, §2.1, and hands it to the engine, which stays stateless; this ADR settles it), and the engine fixes R1–R5 plus R8 (inactive approvers) and R9 (a chain may name any registered key; no client version) (§15) — a new **platform** ADR that records the approvals contract (platform-core §11; ADR-011 names the engine, `docs/03-decisions/ADR-011-workflow-engine.md:24-26`, but no ADR records it); value bands (per-band request types or an engine condition) are added to it when OD-18 is answered (P4, or P3 under OD-23 A; §16.3). It also records two PX-1 proposals the engine does not make today: the after-commit audit row (R5) is opt-in per host, so HR leave keeps its behavior unchanged; and requests already in flight keep reading their chain live, with no backfill | PX-1's first code pull request, before Phase 2 (§18.3.1) | OD-19, OD-20 (OD-18 for the value-band addition) |
| **The Finance handoff before Finance exists** | what fact ends Procurement's responsibility and the persisted handoff record with its signed memo; the reliable event and the platform seam through which Administrative Affairs registers its handoff reader and a future accounting module consumes it (a `PLATFORM_VERSION` minor bump, `requiresPlatform`), recorded as integration requirements and built with their first consumer (§12.11); the "ECMS is not the ledger" boundary (`docs/01-domain/domain-model.md`) and the new Procurement → Finance context edge (`docs/01-domain/entity-relationships.md:151` makes any new cross-context edge ADR-level) | P8's first code pull request | OD-54, OD-55 |
| **Visibility of a document that belongs to two branches** | the transfer scoping rule (source **or** destination reach) and its realtime fan-out, which `orgScopeMatch`, taking one branch field, cannot express (§7.4's `twoBranchScopeMatch`) | P7's first code pull request | OD-45, OD-46 |
| **Requester liveness from notifications** *(only if adopted as a platform convention)* | invalidating an own-scope reader's queries when a notification for the entity arrives, because own scope joins no realtime room (ADR-029) | PC-7, once platform review accepts it (Phase 2 or later, §18.1) | — |

ADR-022 (help-desk lifecycle placement) stays a recorded IT debt; this design neither writes nor depends on it.

---

## 21. Documentation that changes with this design

This design's pull request touches documentation only. Code-carrying phases update the rest in the same pull request as
the code ("docs travel with code", `CONTRIBUTING.md` §4).

| Document | Change | When |
|---|---|---|
| the four design files: `docs/12-planning/administration-module-design.md`, `-design-flows.md`, `-design-integration.md` and `-decisions-and-phases.md` | this design, frozen at approval as Status and §18 define. Revisions go in §22, in `administration-module-decisions-and-phases.md` | now; frozen at approval |
| `docs/12-planning/administration-module-phase-<n>.md` | a later phase's re-detail, a §19-shaped section (§18); its design review is the gate before the phase's first pull request, and §22 records it | before that phase's first pull request |
| `docs/01-business/module-hierarchy.md` §3 | `administration` row: sub-modules `catalog`, `warehouses`, `procurement` | at freeze |
| `docs/01-domain/ubiquitous-language.md` | the validated terms of §0.4 (OD-67) | at freeze |
| `docs/01-domain/domain-model.md`, `bounded-contexts.md`, `entity-relationships.md` | replace the indicative "Administrative Request" entry with this module's aggregates; the Procurement → Finance edge (ADR) | at freeze / Phase 8 |
| `docs/06-security/permission-matrix.md` | an Administrative Affairs section per phase, only if §19.2 adopts it at approval — governance rule 2 asks for it (`docs/06-security/permission-matrix.md:105`), but no module since Recruitment keeps one, so adopting it revives the rule | each phase, if adopted (§19.2) |
| `docs/12-planning/it-module-design.md` §16 P4, §17 | the external-party-registry trigger has fired; who owns `it_vendors` | when OD-01 is answered |
| `docs/03-decisions/README.md` | one row per new ADR | with each ADR |
| `CHANGELOG.md` `[Unreleased]` | one entry per phase | each phase |
| `docs/10-reviews/2026-11-administration-design-cross-module-findings.md` | what this design's review found in other modules and repository-wide documents | now |

Repository-wide findings outside this module are listed for the owner in
`docs/10-reviews/2026-11-administration-design-cross-module-findings.md`, not handled here.

---

## 22. Review trail

- **v0.1 DRAFT** (2026-11-17) — discovery across 16 ECMS subsystems (kernel, RBAC, organization, approvals, audit/events/
  realtime, notifications/scheduler/settings, files/printing, numbering/money/data, IT stores, Fleet, Operations/ATM/Gold,
  HR finance-adjacent, web, domain docs, dashboards, tests/CI), each section drafted from what it found, then
  checked by two independent reviewers (code-truth against the repository; invented-policy and logic) and revised.
  Awaiting the owner's answers to §16 and approval. No implementation exists or begins before approval.
- **Re-based to `4c0fa1b0`** (2026-11-17). `main` moved from `b03522f`, where discovery ran, to `4c0fa1b0` while the
  draft was reviewed. Every `path:line` citation was mapped through the diff and resolved on `4c0fa1b0` at re-base
  (2,391 checked then); the 257 whose cited lines had changed, and 376 statements that something exists or does not,
  were re-read against the new code by six reviewers, and their 238 proposed corrections, 59 of them overlapping, were
  merged by hand. Bare `:line` citations that a paragraph's later file name had captured were found and pinned to their file.
  What changed in the design:
  - *Evidence only.* Fleet's rebuilt dashboard (§14.1, §14.2); Operations' vault receipt, now without its two-person
    check (OD-35 states it, and OD-21 and OD-47 cite it; OD-35's question now cites the owner's
    «انا مش عاوز اى اسماء»); IT's one-step branch transfers (D-3, OD-45, OD-46); Fleet's vehicle supply contracts
    (OD-01, OD-29, OD-32, OD-66, RK-18); the navigation and settings pins and the settings screen's catalog (§13.3,
    §19.7); CI's 45-minute limit (RK-01, D-18); and the next free ADR, ADR-039 (§20).
  - *Reuse instead of a copy.* `shared/cairo-day.ts` re-exports the Cairo calendar that now lives in `@ecms/contracts`
    instead of copying IT's and HR's helpers, as the first draft did (§1, §3.5, §14.8);
    `shared/branch-scope.ts` imports the platform's `selectorBranches` instead of inlining ATM's
    `registerScopeBranches` (§7.2); an act's audit rows go through one `recordMany` (§10.1); P9's board isolates a
    failing figure as Fleet's does (§14.2).
  - *Done upstream.* PC-10: the logo lives in `@ecms/contracts/egycash-logo`, so no move precedes the first paper
    (§11.6.3, §15.2.2).
  - *Changed choice.* §7.8's people search ORs one selector per held key (`anyOfScopes`), as IT's does, instead of
    `widestScopeSelector`; OD-83's recommended default moves from A to B, the board frame on registers, because the
    owner asked for it in Fleet, ATM, IT and System Administration and the IT pages this module copies wear it (§13.6).
  - *New sub-questions*, each with a recommended default: OD-01, Fleet's free-text vehicle suppliers; OD-59 (iii), a
    settings screen on `setting.edit`; OD-62, one row over several screens; OD-64, names on kept records under HR's
    permanent delete; OD-66, vehicle supply contracts; OD-73, a document's action log.
- **Design review, stages A–C** (2026-11-17). The repository's `design-review` skill, Full preset, with the `egm-*`
  reviewer subagents: A zoom-out and B comprehension over the whole document, C design, structure and style over the
  feature range (§0–§17). All five completed. Their 85 findings merged into 59 (3 Blocker, 25 Major, 31 Nit). Four fresh
  read-only verifiers tried to refute each against the owner's brief, the merged ADRs, the review registers and the
  code: three were dropped — one-step transfers (they contradict the owner's brief, which this review quoted into §0),
  a naming-standard divergence (the contracts allow per-resource special actions) and the adjustment rows of P5
  (already a conditional revision below); 32 were kept and 24 kept in part. The citations this round added were written
  against `4c0fa1b0`; they are not in the re-base's count and were not yet re-counted. What changed:
  - *The document stands alone.* The owner's request of 2026-10-29 is quoted in §0, with what it leaves unknown (OD-85);
    an English executive summary sits beside the Arabic one; every reference to the author's working files (the name
    list fixed before drafting, the discovery reports, the open-decisions draft) is gone, each rule cited to the section
    that states it and each rejected option to its concrete cost; the freeze covers the architecture and Phase 1, and
    each later phase's detail is re-checked before it starts (Status).
  - *Design changes.* Prints of record take the module's own audit verb, `administrationPrint`, so they never trip the
    platform's `exportSpike` alert (§10.3, §11.6.6); ATM's branch-scope rule and its organization check move to
    `apps/api/src/shared/` (PC-12) instead of being copied; this replaces the re-base's `selectorBranches` import in a
    module copy; the approval stopgaps ship only under OD-20 B; a warehouse is opened (`openedAt`) before anything
    else posts into it, and an opening balance carries a bounded `asOfDate`; a
    per-row `moveSeq` orders the item card; a posting refuses a line whose unit changed; the seed keeps the module's
    writes refused while one of its unique indexes is missing; a transfer line can always close (`returnNotArrived`, a
    chain required at creation, B2's small-branch escape, a liveness spec); a single person on a document is stored with
    the name beside the id (D-22, RK-34); non-recommended options are described by their impact, not designed; the P7
    count freeze leaves the P5 schema; the reliable handoff event waits for a consumer.
  - *Contested with the owner's words* (kept as designed, with the owner's words as the reason; the nearest change is
    the freeze above, which leaves P2–P9's detail as the plan of record): a business discovery before P2–P9, and
    approving only the architecture — the brief asks for the whole cycle now and for delivery without stopping between
    phases; the keeper stays in Phase 1, as the brief lists «Warehouse manager / responsible person» in warehouse
    master data (OD-10 offers P5); `administrationItem` keeps its name (§6.1).
  - *Declined (Nits, recorded):* rewriting every bare `:line` citation (the convention is stated in the reading note);
    linking every cross-file reference; removing every dated aside.
  - *For the owner*, beyond §16.2: volumes and success measures (OD-85); one approval for all phases (Status); two-step
    transfers although IT moves in one step (D-3); where Procurement ends (OD-54); when the keeper is recorded (OD-10);
    whether a deleted employee's name may stay (OD-64); pull requests per phase (OD-81); when a requester sees a
    decision without refreshing (PC-7).
- **Design review, stages D–E** (2026-11-17). The same skill and reviewers: D zoom-out over the whole document, with
  stage A's findings in hand; E implementation readiness, codebase details and style over §18–§22. All four completed.
  Their 70 findings (32 Major, 38 Nit) merged into 52. Eight fresh read-only verifiers tried to refute each against the
  owner's brief, the merged ADRs, this trail and the code: none was dropped; 28 were kept and 24 kept in part. What
  changed:
  - *Stage A–C choices revised.* The module-wide write refusal while a unique index is missing
    (`ADMINISTRATION_INDEXES_NOT_READY`) gives way to IT's per-collection `collectionReady`: every module repository
    whose collection carries a `ux_*` index builds it once per process before its first write, a failed build refuses
    that write and the next one retries (§15.3.2). A warehouse is no longer "opened" (`openedAt`, the opens-empty act
    and `ADMINISTRATION_WAREHOUSE_NOT_OPENED` are gone): the per-row first-movement rule stays, the go-live order is a
    procedure, and a row that moved first takes its opening stock through an approved `adjustmentIn` (§15.3.5 c, A11).
    An opening balance's legs are stamped when posted, like every other leg; its `asOfDate` is stored and printed only
    (OD-74 A). A transfer is no longer checked for a chain when created; the loss round's `writtenOff` resolve is the
    only check (§4.3.5).
  - *Phase 1 made implementation-ready.* PC-12 names its files and exports and imports nothing from `platform/`; PC-13
    adds a shared counter factory and moves IT's `foldName` into the contracts, so the module copies neither (D-6).
    Phase 1's six refusal codes (§5.15); a stored folded name, `nameKey`, under a unique index, so two spellings of one
    name never make two rows; the list queries and DTO labels (§19.4); the go-live load's files, pull requests and
    wiring (§19.8); the module's dialog frame; every census pin with its spec; thresholds for RK-33's measurements and
    PX-3's split (§18.3, §18.3.2, §18.3.3); a category-move race accepted and stated instead of guarded (§19.7).
  - *Plan rules.* The freeze names what it covers inside §2–§14 (Status, §18); each later phase is re-detailed in
    `docs/12-planning/administration-module-phase-<n>.md` and design-reviewed before its first pull request, with no
    added owner approval; a Phase 1 decision answered other than as recommended re-opens the parts it names (§19.2).
    Each ADR is accepted in a documentation pull request before the first code that depends on it; PX-1's is a new
    platform ADR (§20). §18.1 is the one list of prerequisites, with a column saying which moves the code forces and
    which are only recommended.
  - *Simpler.* OD-26 B, OD-72 C and OD-51 C are impact lines, no longer drawn into §2 and §5; §6.4's stopgaps are named,
    detailed only if PX-1 is deferred.
  - *Recommendations.* OD-35 now recommends A, the signed-in receiver, as the owner chose for the vault receipt. OD-47.3
    gains option D (send goods back on a new transfer); B stays recommended. OD-54 stays B, now with the owner's own
    chain as its reason. OD-80 no longer gates code; OD-83's default applies unless the owner objects; OD-79 asks about
    reports, not boards.
  - *Base.* `main` moved past `4c0fa1b0` while this stage ran; the citations stay pinned to `4c0fa1b0`, and Phase 1's
    first pull request opens with a drift check that re-pins what moved (§19.1).
  - *Moved out.* The findings about other modules are now in
    `docs/10-reviews/2026-11-administration-design-cross-module-findings.md` (eleven items).
  - *For the owner*, new from this stage: the launcher tile's picture (OD-62.1); a receiving committee or the signed-in
    receiver (OD-35); goods sent back on a new transfer (OD-47.3 D); whether Procurement checks supplier bills (OD-54).
- **FROZEN v1.0** (2026-11-24). The owner approved the design. The owner took every recommended default in §16 as the working
  answer, to be changed later by revision, answered OD-68 B (no data files for now: master data is typed in on the
  screens) and asked for one phase at a time, each closed before the next; the owner also renewed the zod waiver to 2026-12-26
  (§16.12). OD-68 B removes the go-live rows from Phase 1: the §19.8 rows marked "if OD-68 A" do not apply, and nothing
  else changes.
- **Drift check against `9efdcbd9`** (2026-11-24, the repository's `drift-check` skill). `main` had moved 59 commits
  past this design's merge. Of 2,561 citations, 1,927 were untouched, 429 had only shifted and were re-pinned
  mechanically, 115 sat in changed files on unchanged lines, and 90 sat on changed lines; four read-only reviewers
  re-read those 90, a fifth compared the shared and platform code that changed, and a sixth re-counted Phase 1's pins.
  Their 190 edits (139 re-pins, 25 counts, 21 changed facts, 5 new capabilities) were applied after 37 overlaps were
  merged by hand. What changed:
  - *A design change.* The module's error codes go into the shared web `FRIENDLY` table, in en and ar, as IT and
    Organization now do, instead of a module-local map: the shared error panel reads only that table and replaces a
    message with no Arabic letter by the general Arabic line (§5.15, §13.6, §19.8, RK-23).
  - *Facts.* Phase 1's pins moved (140 navigation rows, the settings pins at 64 and 73, the realtime and audit lines);
    IT's movement ledger now corrects one fact of an issued row in place; IT's catalog keeps one boolean field on one
    kind. PC-5 is still open upstream; RK-23 is partly mitigated by the shared error panel.
  - *Noted for their phases' re-details:* IT's unscoped recipients read for hand-over boxes (P6's issue recipient; Phase
    1's keeper picker stays scoped, §7.8); Fleet's dashboard asks a read only for a fully permitted section (P9); HR's
    working-hours page as a second precedent for a module-owned setting (P4's policy); attendance sizes an export window
    by its shape (P5's reports); organization unit groups for department filters (P2, P6); the shared streaming sheet
    readers for any in-app import (OD-68 C); `MultiSelect` filters (P1a.W's pattern pass).
- **P1a.1 built** (2026-11-24). Phase 1's first pull request ships as §19.1 says, under the owner's answers (§16.12).
  OD-67's recommendation, B (the company's own words), had no words to apply, so the master-data administrator is seeded
  with §6.5's candidate title, A, the fallback; once seeded, a title changes only by hand or by a run-keyed step (§6.5).
  Three fresh reviewers (design conformance, correctness and tests, ECMS conventions) raised 15 findings, all fixed
  before the pull request; the largest, a category stored as its own parent through an upper-case id, is closed by
  canonical ids in the rule. Where the code had to choose what the design leaves open:
  - *One shared file more.* `shared/master-data.ts` holds what all five master registers do alike: the
    `ADMINISTRATION_DUPLICATE` answer, §10.2's verb table for master data (`create`, `update`, `activate`,
    `deactivate`) and the server-side search. Each feature's `<entity>-audit.ts` keeps its literal ref, snapshot and
    signal. The role titles sit in `administration-roles.ts`, the non-seed file §6.1 asks for.
  - *Refusal details.* `ADMINISTRATION_DUPLICATE`'s detail carries `code: 'duplicate'` beside its `field`, since a
    detail must have a code; both detail vocabularies are contract constants
    (`ADMINISTRATION_DUPLICATE_FIELDS`, `ADMINISTRATION_CATEGORY_PARENT_PROBLEMS`) for P1a.W to word. A `parentId` that
    names no category answers 404 `NOT_FOUND` (the attendance-enrollment precedent): §5.15 names no answer for it.
  - *Which index refused.* `BaseRepository.create` keeps only the field names of a duplicate key, so after a write a
    unique index refused, the service re-runs its own check against the row that won and names that field.
  - *Search.* Besides code and name, `search` matches the folded `nameKey`, so «قطعه» finds «قطعة».
  - *One more query field.* `GET /item-categories` takes `topLevel` beside §19.4's `parentId`, one of the two:
    `topLevel=true` is the level a parent is picked from, which the categories tab's parent `Select` (§13.6 C) and
    P1a.2's item form (category, then subcategory, OD-06) both read; `false` is every subcategory.
  - *An Arabic name must survive its fold.* A name of tatweel or harakat alone folds to an empty `nameKey`, so the
    contract refuses it (400 `VALIDATION_FAILED`) rather than letting the database refuse it as a 500 on a create and
    store it on an edit.
  - *A second accepted race.* Beside §19.7's move racing a child create (three levels), two crossing moves of two
    childless top-level categories, A under B and B under A, both pass their checks and leave each the other's parent,
    with no root. It needs the same two organization-scope managers at one moment, and is accepted for Phase 1 on the
    same terms; moving either category to the top level, which no rule refuses, repairs it.
  - *Deferred to P1a.2,* with the item keys: the read gate `authorizeAny('administrationItem.view', …)`, the topics'
    move to that key, and the §19.7 case "an item viewer reads units and categories".
- **P1a.2 built** (2026-11-24). Phase 1's second pull request ships as §19.1 says, under the owner's answers
  (§16.12): items, the `ITM-` code on `administration_counters`, the widened catalog read gate and the topics' move,
  and the five bundles §6.5 opens with `administrationItem.view`, titled with §6.5's candidates (OD-67's fallback, as
  in P1a.1). OD-68 B: no go-live step, no run model, no entrypoint change. Three fresh reviewers (design conformance,
  correctness, ECMS conventions) raised 10 findings, all fixed before the pull request; the largest, an edit that kept
  a category its first subcategory had left above the level, now re-files the item as §2.3.3 says. Where the code had
  to choose what the design leaves open:
  - *The item's level (OD-06 (i)) has a code of its own.* §5.15 lists none for it, so an item a write leaves in a
    category with active subcategories answers 422 `ADMINISTRATION_SUBCATEGORY_REQUIRED`
    (`[{ field: 'categoryId', code: 'subcategoryRequired' }]`), on a create and on every edit. "Has any" reads "has an
    active one": a category whose subcategories all retired takes items again, or nothing under it could be filed. An
    item filed before its category gained its first subcategory keeps it until it is next edited (§2.3.3), and that
    edit, whatever it changes, must move it to a subcategory. A PATCH that only retires the item or brings it back
    (`isActive` and `version`, nothing else) is not that edit (`isStatusChangeOnly`, `item-rules.ts`): §2.3.4's
    "retiring is an edit" says a retirement is a versioned PATCH and not a delete, and holding it to the level would
    make a new level the thing that stops an item from being retired, against "adding a level invalidates no item".
    Adopted as the recommended reading under the owner's 2026-11-24 instruction, and listed for the owner at Phase 1's
    close. A subcategory is judged on its own `isActive`, not its parent's.
  - *A stale edit is answered first.* Every register's edit compares its `version` with the row it read before any
    rule judges the body merged with that row (`assertCurrentVersion`, `shared/master-data.ts`), so a body written
    against an older row is 409 `STALE_DOCUMENT` (§19.3, §19.10.5), never a 422 over a field its sender did not see;
    P1a.1's units and categories take it too. `updateById`'s version filter still catches a write that lands after
    the read.
  - *References.* An item asks the unit's and the category's own `activeFor` (§5.3), exported from their feature
    indexes; one it already names is not read. A `unitId` or `categoryId` that names nothing is 404 `NOT_FOUND`, as a
    category's missing parent is (P1a.1).
  - *Levels.* "One detail per field out of order" names both ends of every comparison that fails, each field once,
    detail code `outOfOrder`; they are judged on the row every write leaves. Whole numbers from 0 are the contract's
    (400), bounded at a line quantity's 1,000,000 (§2.1; `ADMINISTRATION_STOCK_LEVEL_MAX`).
  - *Barcode.* Trimmed, 1–64 characters, no space inside (what a keyboard wedge types), case kept, `null` clears it.
    `ADMINISTRATION_DUPLICATE_FIELDS` gains `barcode`; after an index refusal the name is asked first, then the
    barcode.
  - *The code's contract.* `formatAdministrationMasterCode(kind, seq)` and `parseAdministrationMasterCode(code)` in
    `administration.ts`, over `ADMINISTRATION_MASTER_KINDS` and a prefix table keyed by it (`ITM` now, `SUP` in
    P1b.1); the formatter throws on a number no counter hands out, and the parser reads only the formatter's own
    spelling, so «ITM-000001» is not «ITM-00001».
  - *The floor* is read through `ux_code` by an anchored prefix, over the formatter's spelling only (five digits, or
    more with no leading zero, so a hand-typed «ITM-000042» hides no real code), grouped by length, greatest of the
    longest: the plain newest-first read breaks past five digits («ITM-99999» sorts after «ITM-100000»). `shared/`
    imports no feature, so `document-number.ts` holds the key, the pipeline and the parse, and the items repository
    runs it. The floor and the ensure run at every boot and before every create, outside its transaction (Fleet's
    posture); the seed logs a failed ensure rather than failing the boot. The shared factory hands out one number per
    call (`next`), so `counter.model.ts` exports `ensureCounter` and `nextNumber`; `peekNumber` waits for a caller.
  - *Indexes.* `ux_code` and `ux_counter_key` are the module's only unique indexes not partial on live rows (the
    indexes spec names them); `ix_unit_active` sits beside `ix_category_active` for the register's unit filter.
  - *The register.* `search` adds the barcode, as typed, to P1a.1's code, names and `nameKey`; `?categoryId=` of a
    top-level category reads its subcategories' items too. The DTO's labels are `categoryName`,
    `categoryParentId`, `categoryParentName` and `unitName`.
  - *The unit stays editable.* §2.3.4's immutability needs a line or a movement that names the item, which nothing
    can before P2 and P5, so the checker registry of §3.6 ships with its first registrant.
- **Supplier-registry ADR accepted** (2026-11-24). §20's "The supplier registry" is written as
  [ADR-040](../03-decisions/ADR-040-supplier-registry-module-owned-with-a-seam.md), Accepted under the owner's
  adoption of OD-01's recommended default (§16.12): C, with (i) for insurers, fuel companies and the traffic authority,
  and (i) for Fleet's free-text vehicle-contract suppliers. It is the documentation pull request §20 and §19.8 ask for
  before P1b.1's first code. §20's "the next free number is **ADR-039**" was overtaken meanwhile: ADR-039 was taken by
  the inactivity window (`docs/03-decisions/ADR-039-inactivity-window-is-a-setting.md`), so this ADR is ADR-040, as
  §19.8 already says. The IT design's §16 P4 and §17 carry the dated note §21 asks for. Its review found two facts
  §15.3.5 a leaves out, and the ADR records them for the next stage's ADR to settle: Fleet's boot seed re-creates any
  house-vocabulary workshop with no live row, so a retired or merged workshop row comes back with a new id
  (`apps/api/src/modules/fleet/fleet.seed.ts:127-148`; `apps/api/src/modules/fleet/go-live/vocabulary.ts:52-62`); and
  137 imported visits name the import's «غير محدد» placeholder row, not a workshop
  (`apps/api/src/modules/fleet/go-live/maintenance-import.ts:25-27, 228-229`). Nothing else in this design changes.
- **P1a.3 built** (2026-11-24). Phase 1's third pull request ships as §19.1 says, under the owner's answers
  (§16.12): warehouses on the shared fail-closed branch rule, the branch-options read, the `people/` keeper picker,
  the `administration.warehouse` topic with its branch signal, `keep` for `administration_warehouses` (OD-64 A), and
  the warehouse keys in the six bundles §6.5 gives them. OD-68 B: nothing loaded, no entrypoint change. Four fresh
  reviewers (design conformance, correctness and tests, ECMS conventions, scope and data) raised 13 findings, 10
  distinct, all fixed or recorded before the pull request; the largest, a keeper any writer could name from outside
  their reach, which the DTO then printed, is closed by holding the write to the picker's own reach. Where the code
  had to choose what the design leaves open:
  - *The branch list.* `shared/branch-scope.ts`'s `activeBranchIds` reads `platform/organization`'s
    `branchService.options()`, the top bar's own `/platform/branches/options` read, paged to exhaustion, in place of
    the `branchRepository` list §19.8 names: ATM's loader reads one page of 200, which the base repository clamps to
    100. It is the branch-options list and the create's candidates; names come from `findByIdsSystem`, as the DTO's
    `branchName` does.
  - *What a write may name.* A create's branch must be one of those active branches, and a department named anew an
    active copy in the warehouse's own branch, which §7.6's Unit pairs with it; anything else is 404 `NOT_FOUND`, the
    P1a.1 precedent, since §5.15 names no answer. A department or keeper the row already names is kept by an edit
    that leaves it, retired or gone. The answers come in the order 404 (the scoped load), 403 (the key's reach),
    409 `STALE_DOCUMENT`, then the rules. A keeper named anew must be somebody the picker would offer the writer:
    the people reads' own reach (`peopleScopesOf`, `people.service.ts`: one `scopeSelector` per held
    `administrationWarehouse.create` or `.edit`, OR-ed, so the top bar narrows it as it narrows each register), checked
    through the picker's by-id read, so a person outside it is 404 `NOT_FOUND` as `GET /people/:employeeId` answers.
    It is asked before the leaver rule, so nobody's status is told outside the reach; an id the directory cannot read
    still passes (OD-44). §7.8 keeps the picker scoped ("a warehouse's keeper works in its branch"), and a write that
    could name anybody would print, on the DTO, a person that read hides. Adopted as the recommended reading under
    the owner's 2026-11-24 instruction, and listed for the owner at Phase 1's close, with one question the design
    leaves open: no rule refuses a keeper placed in another branch than the warehouse's, so a writer whose keys reach
    both branches (organization-wide, or over several branches) may name one.
  - *The keeper on the DTO.* `keeper` is `{ employeeId, code, fullNameAr, status }`, read through
    `getDirectoryEmployees` at every read; it is null both with no keeper and with an id that resolves to nobody,
    which the screen tells apart by `responsibleEmployeeId` (OD-64 keeper (i)). No name is stored, so HR's
    `employee-name-copies.ts` gains no path. The DTO carries no department name: §19.4 lists none, and the web's
    department options name it (§19.8).
  - *Refusal details.* `ADMINISTRATION_EMPLOYEE_EXITED`'s detail carries `code: 'exited'` beside its `field`
    `responsibleEmployeeId`, since a detail must have a code (the P1a.1 precedent for `duplicate`);
    `ADMINISTRATION_DEACTIVATION_BLOCKED`'s details use the contract's `ADMINISTRATION_DEACTIVATION_PROBLEMS`. Both
    codes get their en and ar FRIENDLY text in P1a.W.
  - *`canEdit` is what the edit would do:* `.edit` reaches the warehouse's branch (`keyReachesBranch`) and its
    selector, which the top bar narrows, loads the row (`branchScopeBranches`), so the screen never offers an edit
    the server answers 404.
  - *The top bar files a new store (ADR-028).* §19.3 gives `canCreate` as `keyReachesBranch`, after the ATM register
    meta, which the top bar does not narrow, while §7.8 builds the picker's reach, and so the keeper check, from
    `scopeSelector(ctx, key)`, which it does, and `canEdit` follows the edit's narrowed load. Read literally, an
    organization-wide editor narrowed to A would be offered B in the create dialog, find none of B's people, get 404
    on a B keeper, and see the new store answer `canEdit: false`. ADR-028 settles it: "the same value decides where a
    new document is filed". So `canCreate` is `.create`'s reach AND the top bar's choice (`canCreateIn`), and the
    create agrees: a branch outside the choice is 400 `OUT_OF_REACH` on `body.branchId`, as a register filter outside
    it is. To open a store in B, the editor chooses B, or the whole company, in the top bar, where the picker, the
    keeper check and `canEdit` then agree. An engineering reading of the platform rule, not a business rule.
  - *The picker.* `GET /people` searches the employed only and takes no status, with `branchId` narrowing inside the
    keys' reach and `sortBy` name or code; `GET /people/:employeeId` reads every status through the same scoped
    search, so a stored keeper who left still shows, as one.
  - *The retirement registry.* `warehouse-holds.ts` holds it, exported through the feature's index as
    `registerWarehouseHoldChecker`; a checker answers `holdsStock`, `openDocument` or null, the contract's
    `ADMINISTRATION_DEACTIVATION_PROBLEMS`, and the refusal names each hold once, in that order. It is asked on a
    retirement only, never on a reactivation. The warehouse's `activeFor` (§5.16) waits for its first caller, the
    first document that names a warehouse (P5).
  - *Fields.* `location` is free text up to 200 characters, `notes` up to 2,000 as an item's; the code is required,
    trimmed, in the org units' pattern. `GET /warehouses/branch-options` takes no query: a stray one is a 400.
- **P1b.1 built** (2026-11-24). The supplier register ships as §19.1 says, under the owner's answers (§16.12) and
  ADR-040 (OD-01 C: module-owned now, a platform seam later, IT vendors and Fleet workshops untouched): suppliers,
  the `SUP-` code on `supplier:global`, the categories read widened for supplier editors, and supplier papers (OD-11
  A) with their category, authorizer and three endpoints; every bundle §6.5 gives a supplier key gains it, titled as
  before. OD-68 B: no go-live step, no run model, no entrypoint change. Built beside P1a.3 and rebased onto it, so
  the shared lists (manifest, roles, errors, realtime registries, this section) hold both. Where the code had to
  choose what the design leaves open:
  - *The tax-number warning (OD-11 (i))* rides the record, after ATM's seal duplicates (`duplicates` on its DTO):
    every single-supplier answer (`GET /:id`, the create, the edit and both paper writes) is the detail DTO, whose
    `taxNumberMatches` names up to five other suppliers holding the same number, newest first, retired ones marked
    `isActive: false`; the register's rows carry none. The number is compared as typed, trimmed; whether
    «123-456-789» and «123456789» are one number is for the owner, so no normalisation is applied.
  - *The VAT status* has no values until OD-29 gives them, so it ships holding null alone
    (`ADMINISTRATION_SUPPLIER_VAT_STATUSES = []`), any value refused (400): the stored shape is final and the values
    join without a migration. Listed for the owner with OD-29.
  - *Categories.* Each must exist (404, as P1a's references) and one named anew must be active, by the category's
    own `activeFor` ("stays out of every new choice"): 422 `ADMINISTRATION_REFERENCE_INACTIVE`, one detail per
    retired category, field `categoryIds`, its `message` the id (IT's value-in-message precedent); a supplier keeps a
    category that retired after it was named. Either level may be named; how an RFQ matches a top-level category to
    its subcategories' items is P3's. Ids are canonical and named once, in the order first given, at most 100 (a
    stored list's bound, not a business rule). `?categoryId=` reads a category with its subcategories, as the item
    register does. Only `.create` and `.edit` join the categories read (§19.3), so `.view` alone fills no category
    filter; every seeded bundle with the supplier view key also holds `administrationItem.view`.
  - *A paper's link is versioned.* §11.4's "link writes are version-guarded" is read literally: the link takes the
    multipart fields `label` (1–200, a file's display name) and `version` (the HR hiring-documents shape), the
    removal `?version=` (ATM's `AtmVersionQuerySchema`), and both move the supplier's `__v`, so an edit decided before
    a paper was linked is stale. The bound of 20 rides in the link write's filter and, since §5.15 names no code for
    it, answers a new module-wide one, 422 `ADMINISTRATION_ATTACHMENT_LIMIT` (`ADMINISTRATION_MAX_LIST_ATTACHMENTS`);
    a full list is refused before a byte is stored. The collection is made ready before the upload, so a failed
    index build stores nothing, and a link write that misses or throws withdraws its upload (§11.4's "failed link
    write", as IT's signed copy does on any throw). The endpoint takes an upload only, never a JSON link of an existing
    file, so §19.7's "a link to a file of another category or entity" cannot be made: the strict schema refuses a
    `fileId`, and a paper is never reached through another supplier (404).
  - *OD-76 on a record with no draft.* No supplier paper is required (OD-76 A names none), so no gate reads the scan
    states, which the detail shows per paper (`scanStatus`, null for a file gone or archived, «الملف غير متاح»; the
    file id stays on the server). A writer holding `.edit` without `.view` (a custom role: every §6.5 bundle with a
    write key holds `.view`) gets each write's detail with every `scanStatus` null and Files not asked, since the
    authorizer would refuse each lookup and audit it as `permissionDenied` in their name. "After submission (i)" has
    nothing to apply to, so the list is open at every status, retired included; whether a retired supplier's papers
    freeze is for the owner.
  - *The authorizer's write branch* takes `.edit` at organization scope, the paper endpoints' own OD-04 A rule, so a
    branch holder of `.edit` with a `file.*` key cannot write the papers through `/platform/files` (§11.3's table
    names only the key). The category resolver ensures the category once more when the cached one is no longer found.
  - *The intake* is the module's `shared/file-upload.ts`: one helper, its cap `min(category + 5, MAX_UPLOAD_MB)`, with
    the latin1 file-name decode Fleet's and ATM's uploads apply, written here because the module imports no other
    (§3.7). A paper's display name in Files is its label.
  - *Words and logs.* The keys' Arabic resource name is the genitive «الموردين», so the labels read «عرض الموردين»
    as Fleet's read «عرض السائقين»; the page keeps «الموردون». §6.8's nested contact phones join the logger's
    redaction list at three depths (`CONTACT_PHONE_PATHS`), the slice's one change outside the module's registries;
    masking phones in the register is P1b.W's (§13.6 B). Registration numbers are trimmed, 1–50 characters, the
    Organization's own bounds, with no format imposed.
  - *Roles.* §6.5's "+ create/edit if OD-04 gives suppliers to procurement" is not met under OD-04 A, so only the
    master-data administrator writes suppliers.
  - *For P1b.W:* the supplier rows show category names, so the category topics' web rows gain `suppliers` with the
    screen that shows them; the new refusal code needs its en and ar `FRIENDLY` text then.
- **P1a.W built** (2026-11-25). Phase 1's fourth pull request ships as §19.1 says, under the owner's answers
  (§16.12): the `/administration/*` mount, the home, the item register and record, the warehouse register, units and
  categories, the category «الشئون الإدارية» with its four rows (140 → 144) and the `box` and `warehouse` glyphs, every
  `ADMINISTRATION_*` refusal in the shared `FRIENDLY` table, and §19.7's sidebar case. Built from the UI checklist
  re-run on 2026-11-24 (§13.6 asks for it), which settles what §13.6 left to the pattern pass: single-valued filters
  (the list contracts take one value each), `SearchableSelect` for the category and unit, `BOARD_TABLE_FILL` (the
  family's majority, not IT's `_LOW`), a row click that opens the item, and the detail's edit as a dialog. Where the
  code had to choose what the design leaves open:
  - *Files beyond §19.8.* `lib/catalog-form.ts` (the units' and categories' form state) and `lib/refusals.ts` (each
    refusal detail worded beside its field), with specs; a screen spec for every page, not only items and warehouses;
    `screen-fixtures.tsx`, the specs' shared reader and records.
  - *The selects read whole.* One cached read of every unit and every category, both statuses and every page (the
    server caps a page at 100), filtered in the browser, serves the item form, the register's filters and the parent
    select — in place of separate `isActive=true` and `topLevel=true` reads — so a retired current value keeps its
    name (IT's `ItCatalogSelect` rule) and a catalog write re-reads one list. A subcategory is offered on its own
    `isActive`, under a retired parent too, as the server judges it.
  - *Names from the reads that carry them.* The branch filter and the create dialog name branches from
    `GET /warehouses/branch-options`, which carries them, so no `/platform/branches/options` hook is written. The
    department is picked from `/platform/departments/options`, narrowed to the store's branch by `parentId`; the one
    a store already names stays — when it has been retired since, the active list no longer holds it, so it is named
    from the same read with `?includeInactive=true` (the platform's rule: for naming, never for choosing) and marked
    «موقوف», and one no read names still holds the box as «—» rather than «بلا إدارة». The register shows no
    department, since the DTO names none (§19.4).
  - *The keeper picker searches the reach, not the dialog's branch:* no `branchId` is sent, so the box offers whom
    the server would accept; whether a keeper must work in the store's branch is the question P1a.3 left open.
  - *Defaults.* The registers open on the live rows with the server's own order, the catalogs on every status sorted
    by sort order (each its reference's). A store's kind is chosen, never assumed; its code box upper-cases what is
    typed, the only case the contract takes. Status words are «نشط» / «موقوف»: §0.4 lists none, so they are the
    reference register's (IT's consumables, «الأصناف النشطة» / «الأصناف الموقوفة»), «نشط» also the product's
    commonest.
  - *Before the round trip.* The item's levels are checked as the server checks them — whole numbers to 1,000,000
    as typed, the order on Save — and so is a barcode with a space inside, whose contract refusal is a plain 400
    naming no box; the order, the barcode and a warehouse code in the wrong pattern are marked on the same press of
    Save that names a missing value. The server still decides. A stale edit (409 `STALE_DOCUMENT`) re-reads the
    register and the record, and the open dialog rebases on the record as it now is (the item and the warehouse by
    id, a unit or category from its catalog read whole): the refusal stays in the alert box, the boxes show what was
    saved meanwhile, and the next Save carries the new version. Keeping the reader's typing on the old version
    would only meet the same refusal again — or, sent with the new version, silently undo the other person's save.
    A re-read underneath with no refusal (a realtime signal) still leaves the typing alone.
  - *A stray branch is never asked for.* While the branch options are on their way, a remembered branch is not
    sent: one the reader no longer reaches would answer 400 before the page could drop it. If the options cannot
    be read at all, the branch is sent as the URL says, so the page shows the server's answer — rows, or the error
    panel with its retry — rather than loading for ever.
  - *The home* counts the live warehouses and items, each under its read's key; the catalogs' key reads no
    register, so it gets a tile and no count. Each count opens its register on the view it counts
    (`?active=true`, as IT's help-desk counts carry theirs): a bare link would restore the reader's remembered
    filters, and the list could disagree with the figure.
  - *«Add warehouse»* shows only while some branch takes a new store (`canCreate` of the branch options): `can()` is
    blind to scope, and with the top bar on a branch the create key does not reach — or the options unread — the
    form's branch box would offer nothing.
  - *Empty registers* pass the module's sentence as a plain string, as the reference does (the checklist's
    default, item 6): a centred `EmptyState` panel in the table's cell spans the table's scroll width and leaves
    the sentence off screen on a phone (the live check measured it). The catalogs' sentence claims no filter,
    since they open on every status.
  - *A stale save* (409 `STALE_DOCUMENT`) re-reads the record and lays the reader's own changes over it: a box
    they did not touch takes the other person's value, one they changed keeps their typing, so the next Save
    sends only their changes against the new version and never undoes the other save. Codes and names in the other script are isolated
    in a `<span dir>` inside their cell or `<dd>`, never on the `<dd>` itself, so in Arabic they sit under their
    label; the item's Arabic name keeps its order in the English screen.
  - *Words.* The English says «warehouse» throughout (the glossary's term; «store» was a second name for it). A
    keeper who has left is «منتهي الخدمة», HR's and IT's word. The duplicate refusal no longer says the holder is
    active: a retired record holds its name, code and barcode too, and the registers open on active rows.
  - *§19.7's case* runs the boot's `syncNavigationCatalog` in the warehouses suite: an `administrationWarehouse.view`
    holder's whole sidebar is the Warehouses row, and the super-admin sees the four rows (five from P1b.W).
- **P1b.W built** (2026-11-25). Phase 1's last pull request ships as §19.1 says, under the owner's answers
  (§16.12), built on P1a.W and from the same UI checklist (its register, detail, documents-card and dialog lines):
  the supplier register and record with the documents card (OD-11 A), the supplier form, the fifth row «الموردون»
  on `administrationSupplier.view` with the existing `company` glyph (144 → 145), the home's supplier tile, the
  `FRIENDLY` words for `ADMINISTRATION_ATTACHMENT_LIMIT`, `ADMINISTRATION_REFERENCE_INACTIVE` worded for any record
  that names a unit or category, and §19.10.2's supplier sidebar case. With it every §19.10 criterion a pull request
  can meet is met; §19.10.9, the owner's acceptance on staging, remains. Where the code had to choose what the design
  leaves open:
  - *Files beyond §19.8.* `lib/supplier-view.ts` (the phone mask, the papers' scan-state rules, the re-read backoff)
    with its spec, `supplier-fixtures.ts`, and a screen spec for the record besides `suppliers-screen.spec.tsx`.
  - *The phone mask* is the list shape `docs/06-security/security-architecture.md` writes (`298*******4567`): the
    first three digits and the last four, every other digit a star, spaces, dashes and `+` kept; a number of seven
    digits or fewer keeps only its last half, so no list shows a phone whole. A digit is a digit in any script: a
    phone is stored as typed, so «٠١٠…» from an Arabic keyboard is masked as «010…» is, and shown in a `<bdo dir="ltr">`
    so its two ends stay where they were typed (Arabic-Indic digits would otherwise swap round the stars). The record
    shows it whole, and
    the contact people's phones appear on the record only. The register's columns are the code, the name, the masked
    phone, the e-mail, the categories and the status, after IT's vendor register less its contact count; the code
    and the masked phone never break across lines, the table scrolling sideways on a phone instead.
  - *The category filter* shows only to a reader the categories' read admits (`authorizeAny` over the item, catalog
    and supplier write keys, §19.3); for a `.view`-only reader, a remembered `category` is not sent either, so the
    rows never narrow by a filter the screen does not show. The form picks the categories with the shared
    `MultiSelect` (the contract takes a list) over both levels, the live ones and any already picked, a retired one
    kept as `ItCatalogSelect` keeps it; the register's filter stays single-valued.
  - *The tax-number warning* appears three ways and blocks none: a status panel on the record, each holder a link,
    a retired one marked; the `Field` warning beside the box in the edit opened from the record while it holds the
    record's number (a register row carries no matches); and a warning toast after any save whose answer names
    other holders, the create included.
  - *No VAT status anywhere.* Its list is empty until OD-29, so a field or fact would always read «—» or offer
    nothing: under the no-placeholder rule (§13) it joins the screens with its values.
  - *The papers.* Filing is the module's dialog frame with two required values, the paper's label (1–200) and its
    file through the shared `FileUpload` (the category's PDF and images, 10 MB); at 20 papers the card stops offering
    the add and says why, and a raced 21st meets `ADMINISTRATION_ATTACHMENT_LIMIT`. The shared picker checks only a
    dropped file's size, so the dialog refuses a file of another type itself, before it is sent; the server's
    `FILE_TYPE_NOT_ALLOWED`, whose sentence names the category's internal key, gains its en and ar `FRIENDLY` words.
    Removal is confirmed first and says the file stays in the system's records (the link alone goes). While a paper is
    `pending` the record reads itself again after 5 s, then after about as long as the paper has waited (5, 5, 10, 20,
    40 s, then each minute), measured in time from the read that first shows that paper pending, so a write's
    realtime echo a moment later skips no step (a paper filed meanwhile starts the wait over), and stops when none
    is; a 422 on the bytes
    is read as the scan not yet answered (§11.5, until PC-5) and re-reads the record. Each act carries the version
    the record was read at, and the record is mounted afresh for each `:id`, so a dialog left open across Back or
    Forward never acts on another supplier.
  - *The home* gives the supplier register its tile and a live count, P1a.W's rule: a key that reads a register gets
    its count.
  - *Realtime.* Only `administration.itemCategory` gains `['administration', 'suppliers']`: no supplier names a unit,
    so the unit topic does not refetch the supplier screens. The category writes' own re-reads reach `suppliers` too
    (`CATEGORY_SUBTREES` in P1a.W's `catalog-queries.ts`, the one change P1b.W makes there), so the row and the writes
    say the same thing (§9.4) and a category's new name reaches the supplier screens with realtime down.
  - *A stale save* (`STALE_DOCUMENT`) is handled as P1a.W's dialogs handle it: the supplier is read afresh and the
    reader's own changes are laid over it (`carryEdits`, comparing a list by what it holds), so a box they did not
    touch shows the other save and the next Save, carrying the new version, never undoes it; the dialog says so.
    The paper acts read the live record, so their retry carries it.
  - *Refusals beside the field.* A supplier's retired category (`categoryIds`) is worded beside the categories box,
    in general words; the detail's id is not turned into a name, since the select offers only live categories and
    only a race reaches it. An e-mail that is no address is marked on Save before a round trip (a loose check; the
    server decides), and every contact person listed needs a name, as the missing-fields banner says.
  - *§19.10.2's case* for suppliers runs in the suppliers suite: an `administrationSupplier.view` holder's whole
    sidebar is the Suppliers row; the warehouses suite's super-admin case now reads five rows.
- **PX-1 re-detailed** (2026-11-25). The platform slice is re-detailed in
  [administration-module-phase-px1.md](administration-module-phase-px1.md), as §18 and §21 ask, under the owner's
  adoption of OD-19 A, OD-20 A and OD-69 (i) (§16.12). §20's "Money approvals on the platform engine" is written as
  [ADR-041](../03-decisions/ADR-041-money-approvals-on-the-platform-engine.md), Accepted in its documentation
  pull request (PX-1.0). §20's "the next free number is **ADR-039**" was overtaken again: ADR-039 and ADR-040 are taken
  (`docs/03-decisions/README.md`), so this ADR is ADR-041. The ADR settles the shape §15.2.1 proposed, with three
  departures from the plan of record. The host keeps `approvalWorkflowId` and `approvalChainShape`, and the engine
  stays stateless, but the shape holds the rungs as subdocuments in the chain row's own schema rather than
  `string[]` of `permissionKey@level` (§2.1 left the type to the ADR): the strings served OD-20 B's compare, and under
  OD-20 A they would need a parser and a second read for captions. R5's after-commit audit is opt-in per request
  type rather than per host (§15.2.1, §18.3.1 item 5, §20), so one host may register types of both kinds. And
  value bands are not added to the ADR later, as §20 planned: OD-18 A needs no engine change, an engine condition
  (OD-18 B) would be a new ADR, and ADRs are immutable (`docs/README.md` rule 2). The ADR also drops the engine's closing of empty rungs above an approval, as
  §15.2.1 R2's fix ("at every decision, never as 'approved'") asks. The re-detail plans seven pull requests, PX-1.0
  (these documents, with platform core §11's rewrite) to PX-1.6, and records one question for the owner about HR
  leave, PXQ-1, which PX-1 does not wait for. Their design review (Full preset, 2026-11-25) is recorded in the
  re-detail's §13; it is the gate before PX-1.1, which also waits for Phase 1 to close.
- **Phase 1 closed** (2026-11-25). Its seven pull requests are merged: P1a.1 (#780), P1a.2 (#781), the supplier-registry
  ADR-040 (#782, accepted before P1b.1), P1a.3 (#783), P1b.1 (#785), P1a.W (#786) and P1b.W (#787), each green in CI.
  §19.10's criteria 1 to 8 were checked on merged main (`4c6457d4`) by running the specs they name: the page registry
  rose by 4 pages and 10 keys (117 → 121 pages, 431 → 441 keys), the super-admin sees the module's five rows, and the
  scope, concurrency, realtime, language and docs criteria hold. Criterion 9, the owner's acceptance on staging with real
  item families typed in by hand, is the one left; its date and the owner's words are recorded here when it is given.
  - *The permission-matrix section* (§19.2) is not adopted: §6.2 is the module's matrix, as the owner's brief item 5
    asks, and no module since Recruitment keeps a section in `docs/06-security/permission-matrix.md`.
  - *Gaps the check found, none against a criterion:* a role holding only `administrationItem.view` or only
    `administrationCatalog.manage` is checked by the seed spec's row-to-key mapping, not over
    `GET /platform/me/applications`; the §7.2 rows for several listed branches and for section scope are covered by the
    shared rule's unit specs, not by a warehouse integration case; and no spec pins the module's label in the role
    matrix (§6.1 says nothing catches the omission; the label is present today).
- **P2 re-detailed** (2026-11-25). Phase 2, purchase requests, is re-detailed in
  [administration-module-phase-2.md](administration-module-phase-2.md), as §18 and §21 ask, under the owner's
  adoption of every recommended default (§16.12). Its drift check, on `main` at `de38fd71`, found no change since
  `9efdcbd9` in the platform code P2 relies on. P2 is written against the engine as ADR-041 leaves it, which PX-1's code
  pull requests have yet to build, so P2's code waits for PX-1 to close (§18.2), and a second drift check reads the
  merged engine, in a docs pull request of its own, before P2.0. ADR-041 supersedes five points of the P2 text, and the
  code Phase 1 left differs from it in eight places; the re-detail's §1.2 details each, with the plan-of-record changes
  it makes. It plans eleven code pull requests, P2.0 to P2.W2, and records four questions for the owner, PRQ-1 to
  PRQ-4, which P2 does not wait for. Its design review, Full preset, ran on 2026-11-25 and is recorded in its §18: 148
  findings over two rounds, 146 fixed, one escalated (PRQ-3) and one dropped, and a few parts dropped under (a) and
  (d), one of which went to the owner as PRQ-4. It is the gate before P2.0.
- **PX-1 closed** (2026-11-25, when PX-1.6 merges). The platform slice's seven pull requests
  ([administration-module-phase-px1.md](administration-module-phase-px1.md) §3): PX-1.0, the re-detail, ADR-041 and
  their docs (#788), PX-1.1 (#789), PX-1.2 (#790), PX-1.3 (#791), PX-1.4 (#793) and PX-1.5 (#795) are merged, and this
  entry is PX-1.6's. The seven engine defects of §15.2.1 that PX-1 takes
  (R1–R5, R8, R9) are fixed, with R12's tests as their baseline. The re-detail's §11 criteria, checked against merged
  main with PX-1.6 on it:
  1. *One test per defect, failing before its fix.* Each fix pull request's description shows its new cases failing on
     its base commit's source and passing on its head, guards excepted: PX-1.2 for R2 and R4 (on `099b23f1`, PX-1.1's
     merged head; its engine, leave and contract sources are identical to `c95674c4`, the pre-rebase base PX-1.2's
     description names), PX-1.3 for R3 and R8 (on `46e1b345`, no guard), PX-1.4 for R1 (on `46e1b345`; the unset-pin
     case is its guard), PX-1.5 for R5 (on `b07e2f00`; the leave audit case is its guard) and PX-1.6 for R9 (on
     `4816dd97`, no guard).
  2. *The two unit specs exist.* `approval.service.spec.ts` (PX-1.1) and `approver-lookup.spec.ts` (PX-1.3) are under
     `apps/api/src`, which `npm run test -w apps/api` runs.
  3. *Integration coverage.* `apps/api/tests/integration/approvals.spec.ts` (PX-1.1) writes a chain through
     `PUT /api/v1/platform/approvals` and drives a leave request through `pendingApproval` to approved and to rejected.
  4. *Requests in flight read live.* PX-1.4's unset-pin case passes. PX-1's diff, from `4c6457d4` to PX-1.6's head,
     adds no `*.cli.ts` file and does not change `apps/api/src/platform/kernel/bootstrap.ts`.
  5. *Leave keeps its audit.* That diff does not change `apps/api/tests/integration/hr-leave.spec.ts`, which is green on
     PX-1.6's head. Leave registers without the audit option (PX-1.5), and PX-1.1's case of the engine's row beside
     leave's own is green.
  6. *The ADR was accepted first.* PX-1.0 made ADR-041 Accepted (`c49f0cfe`), with its README row and ADR-011's row
     naming the superseded bullet, and merged (#788) ahead of PX-1.1 (#789). Its last commit is the Phase 1 close above
     (`050fa94f`), a docs commit after the acceptance that does not touch the ADR.
  7. *Gates.* PX-1.0 to PX-1.5 merged green in CI; PX-1.6 passes §18.5's gates locally, and CI runs them on its pull
     request. No permission key changed, so the permission matrix has nothing to regenerate.
  8. *Docs.* Each code pull request carries its CHANGELOG entry. Platform core §11 matches ADR-041 from PX-1.0 on; its
     "from PX-1" marks stay true once PX-1 has shipped, and the re-detail asks for no change to them. This entry records
     the close; the owner is told when PX-1.6 merges.
  - *Still open after PX-1:* PXQ-1 (re-detail §2) was answered on 2026-11-25, option 1 (§16.12): a leave request nobody
    can approve goes to HR. It is an HR slice of its own, planned in `leave-management-design.md` §16, after PX-1.6;
    until it ships such a request waits for an override within reach. The read-only counts of re-detail §10 (C1 and C2
    before PX-1.2 deployed, C3 before PX-1.6 merges) were not run: they need production access, which this work does
    not have (the organization's MongoDB Atlas access for AI clients is off). PX-1.2 and PX-1.6 shipped on the safe side
    the plan states (a request nobody can decide waits; an off-type rung is unstaffed), and the counts stay the owner's
    or an operator's to run.
- **P2 engine drift check** (2026-11-25). The second drift check the P2 re-detail asks for before P2.0 (its §3) read
  the engine PX-1 built, PX-1.1 to PX-1.6, on `a4434d00`, PX-1.6's head, and its hosts as they now stand: HR leave's
  service and model, and the chain screen at `/system/approvals` with its source scan. It compared them with the
  re-detail's §1.2 A items 1–5 and 17, its Terms, §4.4, §8, §10.2 and §12's engine-facing cases. The engine is as
  ADR-041 leaves it, and nothing asks for an engine change. The re-detail, now v0.4, records nine differences as its
  §1.2 E, items 23 to 31, each folded into the sections it names:
  - *Rules.* Off `pendingApproval` the detail's trail also clears `currentStep`, as leave's does, so a cancelled PR
    marks no rung as waiting. The subject maps each stored entry to the engine's `DecidedEntry`, the decider's id as a
    string, and the append turns it back into an ObjectId, as leave's do. The submission's conditional write sets both
    pin fields from one `pinOf` result, since the pin's own check runs only at create and save. The record's earlier
    rounds name a rung by its caption, else "Step n", since the chain screen writes no caption and an entry stores no
    level; the re-detail's review is asked to confirm it.
  - *Wording.* The `approvalDecision` row carries the engine's own fields, `permissionKey` and `covers` among them, with
    `overriddenWith` and `covers` only where the engine writes them. The trail's `currentStep` gives the live rung to a
    host that holds an `AuthContext`; the stuck audience is still chosen by the rungs left, after a decision and in the
    sweep alike. The audit option is checked through a mock of the platform barrel, and the chain screen's source scan
    joins the specs that stay.
  - *Pins.* The engine, leave and chain-screen lines PX-1 moved are re-pinned, and so are the re-detail's citations of
    this file past §16.12's log, which moved three lines when the owner's answers of 2026-11-25 were logged.
  - *Next.* Nothing in the engine holds P2 back: P2.0 may open once PX-1.6 and this docs pull request have merged.
- **Findings about other modules** (not this design's work, and not in `docs/10-reviews/technical-debt.md`, which
  holds only items someone decided to defer) are listed for their owners in
  `docs/10-reviews/2026-11-administration-design-cross-module-findings.md`.
- **Conditional revisions already identified** (recorded here when the owner's answer triggers them): under OD-23 A,
  `administrationProcurementPolicy.manage`, its page and the band thresholds move from P4 to P3; under §18.1 A11, stock
  adjustments move from P7 to P5; under OD-01 B, the supplier registry becomes a platform service (a platform ADR and a
  staged migration replace Phase 1b's module collection); under OD-06 B, a materialized `path` on
  `administration_item_categories` (§2.3.3), the depth rule of `item-category-rules.spec.ts` and the category cases of
  §19.7; under OD-07 B or C, the item's unit sub-document and its pure spec (§2.3.4, §19.7); under OD-08 B,
  scaled-integer quantity types (§2.3.4), the integer rule of `item-rules.spec.ts` (§19.7) and the quantity inputs'
  `Input rule="integer"` (§13.6). Each of the last three re-opens Phase 1 for the part it names (§19.2).
-
