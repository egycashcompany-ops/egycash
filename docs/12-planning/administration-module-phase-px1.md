# Administrative Affairs — platform slice PX-1: approval-engine hardening (re-detail)

**Status:** DRAFT v0.3 (2026-11-25), design-reviewed (§13). The re-detail that the design's §18 and
§21 ask for before a phase's first pull request: "a later phase's re-detail, a §19-shaped section …;
its design review is the gate before the phase's first pull request" (§21). §22 of
[administration-module-decisions-and-phases.md](administration-module-decisions-and-phases.md)
records this re-detail and points to its review. The decision it carries out is
[ADR-041](../03-decisions/ADR-041-money-approvals-on-the-platform-engine.md), Accepted with PX-1.0.

The design is FROZEN v1.0, in four files: §0–§3 in [administration-module-design.md](administration-module-design.md),
§4–§7 in [administration-module-design-flows.md](administration-module-design-flows.md), §8–§14 in
[administration-module-design-integration.md](administration-module-design-integration.md) and §15–§22 in
[administration-module-decisions-and-phases.md](administration-module-decisions-and-phases.md). "Design §n"
below means those sections.

**Drift check** (design §18). Every code citation was checked on `main` at `f48918ad`. The defects are
as design §15.2.1 describes them. What moved is line pins (for example `findInForceForUsers` is at
`rbac.repository.ts:183-197`, where §15.2.1 cites `:178-197`) and the ADR's number: §20's "next free
number" ADR-039 is taken, so the ADR is ADR-041. Three points of the plan of record change, all in
ADR-041 and recorded in §22: the pin stores its rungs as subdocuments rather than §15.2.1's
`permissionKey@level` strings; R5's after-commit audit is opt-in per request type, where design
§15.2.1, §18.3.1 item 5 and §20 say per host (ADR-041 decision 7); and value bands are not added to
the ADR later (ADR-041 decision 13). Each pull request re-pins the lines it touches, as design §19.1
does.

**Paths.** Engine paths are under `apps/api/src/platform/approvals/` unless they say otherwise, and
"the service" is `approval.service.ts` there. HR leave's files are in
`apps/api/src/modules/hr/leave-management/leave-requests/`; "the leave service" is
`leave-request.service.ts` there.

**Terms.** ADR-041's Context defines the Unit, levels, scopes, rungs "below" and "above", staffed,
settled and waiting rungs, the rung to decide, grants in force and rounds. This document also uses the
engine's own words:

- `ApprovalSubject` is what a host hands the engine about one request: its type, its Unit, its
  decided entries and, from PX-1.4, its pin. A `DecidedEntry` is one settled rung, as the host stores
  it; leave keeps them in `approvalSteps[]`. A `LiveChain` is what `chainFor` returns: the chosen row's
  id and its rungs, each marked staffed or not.
- `statusOf` (in `approval-trail.ts`) is the pure rule; `statusFor` (in the service) resolves the
  chain and calls it. `progressOf` is the first unsettled rung, and `liveStep` finds the waiting rung.
- A rung's outcome is `approved` or `rejected`, or one of three for a rung nobody decided: `skipped`
  (nobody held it), `covered` (a holder of a higher rung decided first) and `unreached` (the request
  was rejected below it) (`packages/contracts/src/platform/approvals.ts:116-130`).
- **Deciding early**: a holder of a rung above the waiting one may decide; the waiting rungs below theirs
  are then `covered` (`approval-chain.ts:141-164`).
- Leave runs on the engine (`onEngine` in the leave service) only when a chain with rungs applies at
  submission; otherwise it runs its own manager and HR path.
- **P2's adapter** will be `modules/administration/shared/approvals.ts`, the module file that
  registers its request types and builds each subject (design §5.2). It does not exist yet.

## 1. Scope

PX-1 is a platform slice. It ships in its own pull requests and is never mixed with Administrative
Affairs code (design §18.1, §18.4). It does change HR leave, the engine's only host: PX-1.2 carries
one leave change of its own (§6.1), PX-1.4 carries leave's side of the pin, and ADR-041 decision 4
says why R1 reaches leave now while R5 does not. It
lands before P2. It also comes before P6 and P7 if the owner brings the warehouse half (P5 without
receipts and supplier returns, P6's material requests, P7's transfers and counts) ahead of P2, and
before P5 if design §18.1 row A11 brings stock adjustments into P5, because those phases' approval
types run on the engine (design §18.1, prerequisites table).

**Why now.** Purchase requests and orders (P2, P4) are the first approvals on the engine that lead to
spending (design §18.1 note A4), and the defects below would carry into them.

**When it starts.** PX-1.0, these documents, is written before the phase, as design §18 and §20 ask:
it needs only its design review, and it may merge while Phase 1 is open. PX-1's code starts with
PX-1.1, once Phase 1 is closed, its exit criteria met and the owner told (design §16.12, «وامشى Phase
واحده وبعد ما نقفل كل واحده ندخل على اللى بعدها»). The pull requests are planned in §3.

It fixes seven engine defects (design §15.2.1), one test per defect (design §18.3.1), and adds R12's
missing tests as the baseline. R6, R7, R10 and R11 are not PX-1's (§9).

| Defect | Today | After PX-1 |
|---|---|---|
| **R1** chain not pinned | the chain is resolved again on every call, and an in-place edit maps recorded decisions onto other rungs (`approval.service.ts:73-98, 273-297`; `approval-trail.ts:26-36`) | the host stores a pin at submission and hands it to the engine, which decides on the pinned rungs; staffing stays current |
| **R2** no staffed rung reads approved | `statusOf` answers approved when no staffed rung is left, whether none was ever staffed or an approval closed the empty rungs above it (`approval-trail.ts:59-65, 109-127`) | the engine answers `unstaffed` (and `noChain`), never approved, at submission and after every decision; an empty rung is passed only on the way to a staffed one; an override within reach can decide a stuck request, one rung at a time |
| **R3** expired grants decide | `ownStepsOf` reads every assignment, in force or not (`approver-lookup.ts:107`) | only grants in force decide |
| **R4** override ignores scope | any scope of `approval.override` is enough (`approval.service.ts:179`) | the override must reach the rung it decides, by the rung's level |
| **R5** audit before commit | `decide` writes its own audit row before the host's write (`approval.service.ts:202-221`) | a request type may opt in, at registration, to have its host record the decision after its commit; leave does not opt in |
| **R8** inactive accounts staff rungs | `approversFor` reads no account status (`approver-lookup.ts:23-75`) | only `active` accounts count |
| **R9** any registered key; no version | a save accepts any key in the permission registry (any key when that registry is empty), and carries no version (`approval.service.ts:253-271, 296`) | a save names only its type's keys and the chain row and version it replaces; a stored rung with another key counts as unstaffed |
| **R12** no tests (coverage, not one of the seven) | no spec for the service or the lookup; no integration suite writes a chain | unit specs for both, and one integration file that drives leave through the engine |

The owner took the recommended defaults as working answers on 2026-11-24 (design §16.12): OD-19 A,
OD-20 A and OD-69 (i). How each one is applied, and the shape PX-1 settles, are in ADR-041. In short:

- **The pin.** The host stores `approvalWorkflowId` (an ObjectId, null while not pinned) and
  `approvalChainShape` (the rungs in order, `{ permissionKey, level, label }` subdocuments in the
  chain row's own schema), declared by spreading the engine's `approvalPinFields`. The engine stays
  stateless.
- **Five answers.** A chain's status is `pending`, `approved`, `rejected`, `unstaffed` or `noChain`.
  Each host applies its own policy to the last two: Administrative Affairs OD-19 A, leave its current
  submission rule (PXQ-1, §2).
- **Override reach.** It is read rung by rung, by the rung's level, from the actor's grants in force.
- **R5's opt-in.** It is a registration option per request type, `{ audit: 'host' }`. `decide`
  always returns the audit changes.
- **R9's version.** A save names the chain row it replaces, `basedOn: { id, version } | null`.

**HR leave**, today the engine's only host (`leave-request.service.ts:65-71`,
`registerApprovalRequestType`), changes in seven ways. Six are direct effects of an engine fix, with
no leave-specific rule:

- its new requests keep the rungs they were submitted on (R1);
- expired grants stop deciding (R3);
- an override must reach the rung, by its level (R4);
- a rung held only by accounts that are not active is unstaffed (R8), and so is a rung whose key is
  not `leave.approve` (R9);
- a request with no staffed rung left, at submission or after an approval, waits reading
  `unstaffed`, its trail marks the rung it waits on, and an override within reach can decide it, one
  rung at a time; today the first case waits with no exit, and the second is approved by the lower
  approval (R2);
- on such a request `decide` refuses `approvals.notYourStep` to anyone without an override within
  reach, and on one whose chain was deleted `approvals.nothingToDecide`; both refused
  `approvals.alreadyDecided` before (R2, §4's refusal table).

The seventh is leave's own, and PX-1.2 carries it because R2 widens it: leave's trail offers no
decision on a request that is no longer `pendingApproval` (§6.1). Its audit stays the engine's (R5 is
opt-in), and its submission rule stays as it is.

## 2. What PX-1 needs from the owner

Nothing new for the slice itself: the defaults answer it. A re-detail adds no owner approval of its
own unless a business decision or an architectural change outside the plan arises (design §18). One
business question arises about HR leave, PXQ-1 below. PX-1 does not wait for its answer: until the
owner answers, such a request waits and an override within reach can decide it, which is the safe
side, and leave's submission rule is unchanged. PX-1.2 is where the change lands, so its description
reports counts C1 and C2 (§10) before it deploys; if either is not zero, PXQ-1 is put to the owner,
with the numbers, before PX-1.2 deploys.

| Piece | As designed when… | Otherwise |
|---|---|---|
| The slice, before P2 | OD-20 A, adopted 2026-11-24 | B: P2 ships three stopgaps in the module instead (design §15.2.1). C: the owner accepts R1–R5 in writing |
| No chain, or no staffed rung | OD-19 A, adopted: the engine answers `noChain` or `unstaffed`; Administrative Affairs refuses the submission in P2 (design §6.4 item 5) | B: auto-approve, which needs lifecycle edges design §5 does not draw (`draft → approved`, and a submission that posts). C: a fixed fallback rule |
| Override | OD-69 (i), adopted: override decides within its own reach, recorded as `overriddenWith` | (ii): override never decides an administration type; P2's adapter refuses it, and the engine rule stays. (iii): override only below a named band, at P4 |
| Deputies | OD-20 A, adopted: time-bound role assignments, which stop deciding at their `validTo` once R3 lands; no new feature | — |
| Edits never move a request already submitted | OD-20 A, adopted; leave adopts the pin too, which its own comment already promises (`leave-request.service.ts:285-288`) | if the owner wants leave to keep reading its chain live, they say so before PX-1.4 opens; PX-1.4 then drops its leave part, and R1 is proven by the service spec alone |

### PXQ-1: a leave request nobody can approve

- **Question.** When a leave request reaches a point where nobody can approve the remaining steps of
  its chain, from the start or after earlier steps approved, what should happen?
- **Evidence.** Today a request with nobody at the start is stamped `pendingApproval` and nobody can
  decide it (`leave-request.service.ts:293-300`; `approval.service.ts:164-165`). One whose remaining
  steps have no holder is approved by the earlier step's approval (`approval-trail.ts:109-127`).
  After PX-1 both wait, reading `unstaffed`, and a holder of `approval.override` within reach can
  decide them, one step at a time (ADR-041 decisions 2 and 3). Nobody who can decide them is told:
  the notice to the next approvers finds nobody (`leave-request.service.ts:693-697`), and the stale
  reminder goes to company-wide `leave.approve` holders (`:1280-1293`), who are not on that step. The
  engine answers the same for every host; what leave does with that answer is leave's own rule.
- **Options.**
  1. Send it to HR: down leave's manager and HR path at submission, as when no chain exists, and to
     HR for the remaining steps after earlier approvals (M: an HR slice).
  2. Do as Administrative Affairs does under OD-19 A: refuse the submission, and after earlier
     approvals keep it waiting for an override or a cancel (S).
  3. Keep it waiting in both cases until an override decides it (none: what PX-1 does).
- **Recommendation.** 1: the employee is not blocked by a chain nobody staffs, and a person
  responsible for leave still decides.
- **Answered** (2026-11-25, design §16.12): option 1, the recommendation, «موافق على كل التوصيات، كمّل». It is applied in an
  HR slice of its own after PX-1.6, as below; PX-1 does not carry it, and option 3 holds until that slice ships.
- **Until the owner answers.** Option 3.
- **Arabic.** إذا وصل طلب إجازة إلى مرحلة لا يوجد فيها من يستطيع اعتماد الخطوات الباقية في مسار
  اعتماده، سواء من البداية أو بعد اعتماد خطوات سابقة، فماذا يحدث؟ (١) يُحوَّل إلى الموارد البشرية
  لتقرر فيه، وهذا ما نوصي به؛ (٢) يُرفض الإرسال إن لم يوجد أحد من البداية، ويبقى في الانتظار إن حدث
  ذلك بعد اعتماد خطوات سابقة؛ (٣) يبقى في الانتظار في الحالتين حتى يقرر فيه من يملك صلاحية التجاوز،
  وهذا ما سيحدث إلى أن تجيب.
- **Where the answer goes.** It is recorded, dated and with the owner's words in «», in design
  §16.12's decision log, and this section then names it. Applying the answer is an HR slice of its
  own, not part of PX-1.

## 3. PR plan

Seven pull requests, in number order. PX-1.2, PX-1.4, PX-1.5 and PX-1.6 all edit the service, so they
land one at a time; the true dependencies are in the third column. Each code pull request (PX-1.1 to
PX-1.6) states its size and its CI minutes (RK-01, the 45-minute CI budget), adds its CHANGELOG
entry, and carries a short rollback note (RK-30, what a rollback leaves behind). Each fix pull request
(PX-1.2 to PX-1.6) also shows its new cases failing on its base commit, except the guard cases §7
marks (exit criterion 1). Sizes are estimates. CONTRIBUTING asks to split above about 500 changed
lines (`CONTRIBUTING.md:53`).

| Pull request | Content | Depends on | Size |
|---|---|---|---|
| **PX-1.0** | Documentation, listed below the table | its design review; it may merge while Phase 1 is open (§1) | docs only |
| **PX-1.1** | R12's baseline, no behavior change: `approval.service.spec.ts` and the integration file `apps/api/tests/integration/approvals.spec.ts` over today's behavior (§7) | PX-1.0 merged; Phase 1 closed | about 450, tests only |
| **PX-1.2** | R2 and R4. `statusOf`'s five answers; an approval no longer closes the empty rungs above it; `chainFor` returns `status`; `decide`'s refusals; the trail's `currentStep` on the rung to decide; override reach by the rung's level in a new pure `override-reach.ts`. Leave's trail offers no decision on a request that is not pending; the chain screen's hint and three comments are rewritten. Its description reports counts C1 and C2 (§10) | PX-1.1 | about 350 |
| **PX-1.3** | R3 and R8. `ownStepsOf` reads grants in force; `approversFor` keeps the accounts `activeIdsAmong` returns. `approver-lookup.spec.ts` | PX-1.2 (§6.4 says why) | about 300 |
| **PX-1.4** | R1. The pin: `pinOf`, `readApprovalPin`, `approvalPinFields`, `ApprovalSubject.pin`, the subject calls taking the rungs from the pin. Leave stores its pin at submission and hands it over wherever it builds the engine's subject | PX-1.2 | about 350 |
| **PX-1.5** | R5. The registration option `{ audit: 'host' }`; `decide` returns `auditChanges` and writes no row for a `'host'` type | PX-1.1 | about 200 |
| **PX-1.6** | R9. The contract's `basedOn`, the DTO's `version`, `setWorkflow`'s type-key and `basedOn` checks; stored rungs outside the type's keys, on a chain row or a pin, count as unstaffed; the chain screen sending `basedOn`; the web contract spec; the §22 entry that closes PX-1. Its description reports count C3 (§10) before it merges | PX-1.2; PX-1.4, for the pinned case | about 400 |

PX-1.0 holds:

- ADR-041 and this re-detail, with its review (§13);
- the ADR's README row, and the §22 entry;
- platform core §11 and its collection row, rewritten to ADR-041 decision 1, with each part that
  PX-1.1 to PX-1.6 bring marked "from PX-1";
- pointers to ADR-041 in `docs/07-workflows/workflow-engine.md` (§1 and §4) and in the approval
  section of `docs/05-database/database-design.md`;
- a last commit that makes ADR-041 Accepted (§11, criterion 6).

PX-1 closes when PX-1.6 has merged, the exit criteria of §11 are met, and the owner is told.

## 4. API and contract changes

**HTTP.** There is no new route, and no gate changes: every route stays under `approval.configure`
(`approval.routes.ts:21-41`).

- `PUT /api/v1/platform/approvals` (PX-1.6): the body gains a required
  `basedOn: { id: string; version: number } | null`. Null says "I saw no chain at this place";
  otherwise it is the id and `__v` of the chain the screen's draft started from. Refusals:
  - 409 `STALE_DOCUMENT` (`apps/api/src/shared/errors/index.ts:57-61`) when the place's row is not
    `basedOn.id` or its `__v` is not `basedOn.version`, when a row exists and `basedOn` is null, when
    none exists and `basedOn` names one, when two first saves meet the unique index (the create's
    409 `DUPLICATE`, `apps/api/src/shared/base/base.repository.ts:501`, is answered as
    `STALE_DOCUMENT`), and when the row is deleted between the place lookup and the update (the
    update's 404 `NotFoundError`, `base.repository.ts:595-596`, is answered as `STALE_DOCUMENT`);
  - a rung naming a key outside the type's `permissionKeys`: 422 `approvals.unknownPermissionKey`,
    the key the permission-registry check throws today (`approval.service.ts:265-266`);
  - a body without `basedOn`: 400, because `basedOn` is required (nullable, with no default). The
    schema's `.strict()` is what refuses the opposite case, a `basedOn` sent to an API without it
    (§10, rollback).
- `GET /api/v1/platform/approvals` and the `PUT` response: `ApprovalWorkflowDto` gains `version: number`.
- `DELETE /api/v1/platform/approvals/:id`: unchanged, with no version; ADR-041 decision 9 says why
  that is accepted.
- Leave's routes and DTO: unchanged (`apps/api/src/modules/hr/leave-management/leave-requests/leave-request.routes.ts:91-102`;
  `leave-request.mapper.ts:12-49`).

**Contracts** (`packages/contracts/src/platform/approvals.ts`):

- PX-1.6: a named `ApprovalWorkflowBasisSchema =
  z.object({ id: objectId(), version: z.number().int().nonnegative() }).strict()` is declared above
  `SetApprovalWorkflowSchema` (`:62-70`), which gains, as its last field,
  `basedOn: ApprovalWorkflowBasisSchema.nullable()`. Naming it keeps a single `.strict()` inside the
  schema's object, so the web contract spec's lazy match, which ends at the first `.strict()`
  (`apps/web/src/modules/system-admin/system-admin-api-contract.spec.ts:477-489`), still captures
  every field and the outer `.strict()` it guards.
- PX-1.6: `ApprovalWorkflowDto` (`:73-81`) gains `version: number`.
- PX-1.2: `ApprovalTrailDto` (`:151-182`) keeps its fields. Its `currentStep` now also names the rung
  an `unstaffed` chain waits on (§6.1), so the panel marks the rung an override would decide; its
  comment ("null when the chain is finished", `:155`) and `ResolvedStepDto.staffed`'s ("SKIPPED rather
  than blocking", `:102-109`) are rewritten to say so.
- Nothing else in the file changes.

**The engine's in-process API** (the barrel, `index.ts:1-9`):

| Change | PR |
|---|---|
| `ChainStatus` (`approval-trail.ts:39`) becomes `'pending' \| 'approved' \| 'rejected' \| 'unstaffed' \| 'noChain'` | PX-1.2 |
| `LiveChain` (`approval.service.ts:53-56`) gains `status: ChainStatus`, the answer with no decisions (`noChain`, `unstaffed` or `pending`), and is exported from the barrel | PX-1.2 |
| `ApprovalSubject` (`approval.service.ts:46-50`) gains a required `pin: ApprovalChainPin \| null` | PX-1.4 |
| New exports: `type ApprovalChainPin = { workflowId: string; steps: readonly ApprovalStep[] }`; `pinOf(chain: LiveChain): ApprovalChainPin \| null`, the chain's id and rungs without their staffing, null when the chain has no row or no rungs; `approvalPinFields`, the two host fields as a spread for a host's schema, the pattern of `baseFields` (`apps/api/src/shared/base/base.model.ts:17-24`): their defaults, the chain row's rung schema (`workflow.model.ts:31-42`), and a validator that refuses an id with no rungs; `readApprovalPin(doc)`, which builds `ApprovalChainPin \| null` from a host document, null when `approvalWorkflowId` is missing or null. The rung schema itself is not exported | PX-1.4 |
| `decide`'s result (`approval.service.ts:162`) gains `auditChanges: AuditChange[]` (`packages/contracts/src/platform/audit.ts:219`) | PX-1.5 |
| `registerApprovalRequestType(type, options?: { audit?: 'engine' \| 'host' })` (`request-type.registry.ts:18-20`); `'engine'` by default. `getApprovalRequestType` and `listApprovalRequestTypes` still return the DTO only; the service reads the option through `auditModeOf(key)`, internal to the folder (§6.6) | PX-1.5 |

**Refusals.** The engine keeps its six keys (ADR-041 decision 12 lists them), still untranslated (R11,
with RK-23, the design's risk of untranslated refusals in the Arabic interface); none is added. From
PX-1.2, `decide` checks the chain's status first, then the actor, and answers in one way for each
case:

| Chain's status | Actor | Answer |
|---|---|---|
| `noChain` | anyone | `approvals.nothingToDecide` |
| `approved` or `rejected` | anyone | `approvals.alreadyDecided` |
| `pending` | stands on a rung at or above the waiting one | decides their own rung |
| `pending` or `unstaffed` | otherwise, with an `approval.override` that reaches the rung to decide | overrides that rung |
| `pending` or `unstaffed` | otherwise: no override, or one out of reach | `approvals.notYourStep` |

On `unstaffed` nobody stands on a rung that is left, so only an override decides. Against today:
`noChain` and `unstaffed` answered `approvals.alreadyDecided`, because both read approved
(`approval.service.ts:164-165`); an override out of reach decided; and `approvals.nothingToDecide`
(`:168`) answered a pending chain with no waiting rung, which cannot occur. An unstaffed request is
still waiting, so "not your step" is its true answer rather than "nothing to decide". The codes differ
downstream: design §5.15 has P2's adapter remap `alreadyDecided` and `nothingToDecide` to
`ADMINISTRATION_APPROVAL_NOT_PENDING`, and `notYourStep` to `ADMINISTRATION_APPROVAL_NOT_YOUR_STEP`
(`administration-module-design-flows.md:1461`).

**Pages, keys, navigation, realtime and audit.** There is no permission key, page, navigation row,
audit verb, event, notification template or realtime topic. So the permission-matrix check, which CI
runs on every pull request (`.github/workflows/ci.yml:41-42`), has nothing to regenerate; RK-29's
deploy order, which ships a new audit verb a release ahead of its first writer, does not apply; and
none of design §18.4's coupled-file rows, the files a pull request must change together, fires.
PX-1.6's API and web deploying together (§10) is a different concern: its `PUT` body changes.

## 5. Data-model changes

**`hr_leave_requests`** (PX-1.4), in `leave-request.model.ts`:

| Field | Type | Default | Written | Read |
|---|---|---|---|---|
| `approvalWorkflowId` | `ObjectId \| null` | `null` | at submission, when the request enters the engine: the id of the row `chainFor` chose | each time leave builds the engine's subject |
| `approvalChainShape` | an array of the chain row's rung schema: `{ permissionKey, level, label }` per rung | `[]` | in the same write: the rungs and captions `chainFor` returned, in chain order | likewise |

- **Declared once.** The schema spreads `...approvalPinFields` from the engine's barrel, which the
  model imports as the leave service does (`leave-request.service.ts:40`). `LeaveRequestDoc` gains
  `approvalWorkflowId?: Types.ObjectId | null` and `approvalChainShape?: ApprovalStep[]` (`ApprovalStep`,
  `packages/contracts/src/platform/approvals.ts:51`), optional because older rows lack them. The
  model's own `approvalStepSchema` (`leave-request.model.ts:67-76`), the two-desk `approvals[]`
  record, is unrelated and keeps its name; the engine exports no schema under that name.
- **Absence-safe.** Rows written before PX-1.4 have neither field. Leave's subject paths read
  hydrated documents (`findRawById`, `leave-request.repository.ts:26-30`, and the conditional
  write's `findOneAndUpdate`, `leave-request.service.ts:589-611`), which fill a missing path with its
  default, `null` and `[]`; a `.lean()` read would leave both missing
  (`apps/api/src/platform/users/user.model.ts:125-126`). `readApprovalPin` reads a missing or null
  `approvalWorkflowId` as "not pinned" either way, and the engine then reads the current chain.
- **Written once.** Leave has one round per request: it never re-enters approval, and
  `pendingApproval` is set only at create (`leave-request.service.ts:293-321`). So the two fields are
  written in the create that stamps `pendingApproval` and never rewritten.
- **No index**, and no change to the existing indexes (`leave-request.model.ts:119-122`).
- **Census rows.** Two CI checks list the paths that name a person. The workforce reset, which removes
  a person's rows across collections, must classify every path matching `/employeeid/i`
  (`apps/api/src/workforce-reset/targets.ts:23`). HR's permanent delete must classify every path
  ending in `name` on a collection it keeps
  (`apps/api/src/modules/hr/employee-management/employees/employee-name-copies.ts:32`). No new path
  (`approvalWorkflowId`, and `permissionKey`, `level`, `label.ar` and `label.en` under
  `approvalChainShape`) matches either rule, and the reset deletes `hr_leave_requests` rows outright
  (`purge`, `targets.ts:148`), so neither list gains a row.

**`approval_workflows`**: no field, no index, and no data change. The row's existing `__v` becomes the
client version (PX-1.6). `setWorkflow` keeps editing a row in place (`approval.service.ts:273-297`).

**Administrative Affairs' own host fields** (design §2.1, host field #7) are the same two, declared by
the same spread of `approvalPinFields`, when P2 ships them. That is P2's work; PX-1 touches no
Administrative Affairs file.

## 6. Engine changes, defect by defect

Each item names the behavior and the interface. Private helpers and the exact edits are the pull
request's.

### 6.1 R2: five answers (PX-1.2)

- **`statusOf`** (`approval-trail.ts:59-65`) answers, in order:
  - `rejected` if any entry is rejected;
  - `noChain` if there are no rungs;
  - `pending` if `liveStep` finds a staffed rung at or after `progressOf`;
  - `approved` if every rung is settled, that is `progressOf` is at least the number of rungs;
  - `unstaffed` otherwise.

  Today the last three collapse into one line, where no waiting rung means approved (`:64`).
- **An approval closes nothing above it.** `entriesForDecision` (`approval-trail.ts:77-129`) keeps
  writing the decided rung and the unsettled rungs it passes below it, `covered` or `skipped`. Its
  closing of the empty rungs above an approval that leaves no staffed rung (`:109-127`) is removed.
  The spec case that asserts it (`approval-trail.spec.ts:127-143`) is rewritten: those rungs stay
  unsettled and the chain reads `unstaffed` (ADR-041 decision 2).
- **`chainFor`** (`approval.service.ts:73-98`) returns `status = statusOf(steps, [])`. With no
  matching row it returns `{ workflowId: null, steps: [], status: 'noChain' }`.
- **`decide`** answers as §4's refusal table says. On `unstaffed` the rung to decide is the first
  unsettled one, in place of the waiting rung; an override within reach decides it (§6.2), and the
  approval settles nothing above it.
- **`trailFor`**: `currentStep` is the rung to decide, the waiting rung on `pending` and the first
  unsettled rung on `unstaffed`, and null otherwise (today it is null unless the chain is pending,
  `approval.service.ts:133-136`). So the panel's "waiting here" mark
  (`apps/web/src/platform/approvals/ApprovalChainPanel.tsx:61, 84-88`) shows the rung an override would
  decide, and the employee sees where the request stopped. `viewerMayOverride` becomes: no own
  decision, the status `pending` or `unstaffed`, and the override reaches the rung to decide.
- **`statusFor`** is unchanged in code. Its comment (`approval.service.ts:100-108`) and `liveStep`'s
  (`approval-chain.ts:74-82`) are rewritten: no chain and no staffed rung are reported, and the host
  applies its policy.
- **Leave's submission and decision need no change.** Its submission branches on `chain.steps.length`
  (`leave-request.service.ts:293-300`). Its decision maps `approved` and `rejected`, and anything else
  to `pendingApproval` (`:583-588`), so a request a decision leaves `unstaffed` stays
  `pendingApproval`, and its notice to the next approvers finds nobody and sends nothing (`:693-697`).
- **Leave's trail offers no decision on a request that is not pending.** Leave computes the trail for
  any request with entries, whatever its status (`leave-request.service.ts:658`), and the detail page
  offers Approve and Reject on `viewerMayDecide || viewerMayOverride` alone
  (`apps/web/src/modules/hr/leave-management/pages/LeaveRequestDetailPage.tsx:67-70, 113`). Today a
  cancelled request whose waiting rung is staffed offers its holder the buttons, and the server
  refuses the click (`leave-request.service.ts:434-436`); after PX-1.2 every cancelled request left
  `unstaffed`, the way out §10 names, would offer them to override holders too. So leave's `trailFor`
  (`leave-request.service.ts:657-676`) returns the trail with `viewerMayDecide` and
  `viewerMayOverride` false, `viewerStep` null and `viewerCovers` empty when the request's status is
  not `pendingApproval`. The web is unchanged.
- **Text that R2 makes untrue** is rewritten in the same pull request:
  - the chain screen's hint (`apps/web/src/platform/localization/i18n.ts:1927-1928`, `:18053-18054`),
    which says an empty step "is skipped rather than blocking". New English: "A step nobody in the
    company can stand on is passed when the holder of a later step decides, and the trail shows that
    it was. A request with nobody left on its remaining steps waits until a holder of the override
    permission decides it." New Arabic: الخطوة التي لا يستوفيها أحد في الشركة تُتخطّى حين يقرر في
    الطلب صاحبُ خطوة تليها، ويُبيِّن المسار أنها تُخطِّيت. أما الطلب الذي لا يبقى أحد يستوفي
    خطواته الباقية فينتظر حتى يقرر فيه من يملك صلاحية التجاوز.
  - the contract's comments on `currentStep` and `ResolvedStepDto.staffed` (§4);
  - leave's comment in `notifyChainApprovers` that "the engine has already established that the rung
    is staffed" (`leave-request.service.ts:693-696`): after an approval that leaves the chain
    `unstaffed`, nobody stands on the next rung.

### 6.2 R4: override reach (PX-1.2)

- A new pure `override-reach.ts` exports `overrideReaches(actor: AuthContext, level: ApprovalLevel,
  unit: Unit): boolean`. `APPROVAL_OVERRIDE_KEY` moves into it, and the service re-exports it, so the
  barrel's `APPROVAL_OVERRIDE_KEY` export is unchanged. The rule is ADR-041 decision 6's table, over
  the Unit's coordinates (helpers in `apps/api/src/shared/types/index.ts`):

  | Rung's level | Coordinates it needs | Passes when |
  |---|---|---|
  | `organization` | none | the override is held at organization scope (`scopeOf`, `:106-107`) |
  | `department` | `unit.departmentCatalogId` | `keyCoversDepartmentEverywhere(actor, key, unit.departmentCatalogId)` (`:193-202`) |
  | `branch` | `unit.branchId` | `keyReachesBranch(actor, key, unit.branchId)` (`:205-209`) |
  | `unit` | `unit.branchId` and `unit.departmentId`, the branch's copy | `keyCoversUnit(actor, key, unit.branchId, unit.departmentId)` (`:157-181`) |

  The checks run in this order. Organization scope passes every level, as the helpers answer too
  (`:165`, `:200`). Then a rung whose coordinates are not all set fails closed. Only then is the
  helper called. The null check must come first: `keyCoversUnit` reads a null `departmentId` as a
  question about the whole branch (`:173-174`), so a branch-scope override would otherwise pass a
  `unit` rung on a request with no department. `own`, `section` and an unheld key pass nothing.
- **`decide`**: `overriddenWith` is set only when the actor has no decision of their own (no rung of theirs
  at or above the waiting one, `viewerDecision`) and `overrideReaches(actor, rung.level, subject.unit)`
  holds for the rung to decide. Otherwise it refuses `approvals.notYourStep` (§4's table).
- **`trailFor`**: `viewerMayOverride` uses the same two tests.
- **The web's code is unchanged.** It already shows the decision when
  `viewerMayDecide || viewerMayOverride` (`apps/web/src/platform/approvals/ApprovalChainPanel.tsx:125, 130`;
  `apps/web/src/modules/hr/leave-management/pages/LeaveRequestDetailPage.tsx:67-70`); the hint's new
  text is §6.1's.

### 6.3 R3: grants in force (PX-1.3)

- **`ownStepsOf`** (`approver-lookup.ts:107`) reads
  `roleAssignmentRepository.findInForceForUsers([new Types.ObjectId(userId)])`
  (`apps/api/src/platform/rbac/rbac.repository.ts:183-197`; already used at
  `apps/api/src/platform/rbac/rbac.service.ts:1512`) in place of `findActiveForUser` (`rbac.repository.ts:171-176`).
- **`findActiveForUser` stays unfiltered** for its other callers: `loadGrants`
  (`rbac.service.ts:1237-1252`), the one read behind both SA-4's effective-permissions screen and the
  enforcement path's `getEffectivePermissions` (`:1264`), which drops the grants out of force itself;
  `mirrorAssignment` and `ensureAssignment` (`:1694`, `:1725`); and the HR access reconcile
  (`apps/api/src/hr-only-access.ts:119`). PX-1 changes no file under `platform/rbac`.
- **Delegated grants** carry no validity window (`apps/api/src/platform/rbac/delegation.model.ts:12-41`),
  so `findForUser` (`apps/api/src/platform/rbac/delegation.repository.ts:12-18`) is unchanged.
- **Effect.** `trailFor`'s `viewerMayDecide` and `decide` both stop counting an expired or
  not-yet-started grant. Staffing already read the filtered `findActiveForRoles` (`rbac.repository.ts:245-259`).
  Override reach reads the actor's context, which holds grants in force only (`rbac.service.ts:123-127`),
  so an expired `approval.override` already reaches nothing; §7's PX-1.1 guard case shows it.

### 6.4 R8: active accounts only (PX-1.3)

- **`approversFor`** (`approver-lookup.ts:23-75`) returns only the ids
  `userRepository.activeIdsAmong` keeps (`apps/api/src/platform/users/user.repository.ts:44-63`):
  `status` `active`, not deleted, ids only. The same predicate counts Super Admin cover
  (`rbac.service.ts:972`; `apps/api/src/platform/users/user.service.ts:499`) and matches what sign-in
  requires (ADR-026 SA-6). That is one id-only query per distinct key and level, inside the memo the
  service already keeps (`approval.service.ts:85-91`).
- **`hasApprovers`** (`approver-lookup.ts:85-89`) and **`currentApprovers`** (`approval.service.ts:227-233`)
  inherit the filter.
- **The decider's own path needs no filter.** Every authenticated request refuses an account that is
  not active (`apps/api/src/platform/auth/auth.service.ts:1018-1020`).
- **Why after R2.** With R2 in place, a rung that R8 empties (held only by inactive accounts) is
  passed only on the way to a staffed rung above it, and a chain left with none staffed reads
  `unstaffed`, never approved. Before R2, R8 would make such a chain read approved.

### 6.5 R1: the pin (PX-1.4)

- **The engine:**
  - `pinOf(chain)` returns the chain's id and its rungs without their staffing, or null when the
    chain has no row or no rungs.
  - When `subject.pin` is set, `statusFor`, `trailFor`, `decide` and `currentApprovers` resolve
    staffing over `pin.steps`, through the same per-call memo `chainFor` uses, with `pin.workflowId`
    as the chain's id, and read no chain row. When it is null, they call `chainFor` as today.
  - **A pin with no rungs reads `noChain`**, as any chain without rungs does. `pinOf` never returns
    one, and `approvalPinFields`' validator refuses one at write, so only a write that bypasses
    validation could store it. Should one exist, `decide` refuses it for everyone, the panel shows its
    no-chain text (`apps/web/src/platform/approvals/ApprovalChainPanel.tsx:56-57`), and the detail
    page still loads, so the host's cancel is reachable from the screen.
  - `workflow.model.ts` builds `approvalPinFields` from its private rung schema (`stepSchema`,
    `:31-42`); the barrel exports `approvalPinFields` and `readApprovalPin`, not the rung schema.
- **Leave:**
  - **Model.** The two fields of §5, by spreading `approvalPinFields`.
  - **Submission** (`leave-request.service.ts:293-321`). When the chain has rungs, the create also
    writes `approvalWorkflowId` and `approvalChainShape` from `pinOf(chain)`. This makes true the
    comment at `:285-288`, "a request that starts on a chain keeps that chain's shape".
  - **The subject.** Wherever leave builds the engine's subject (before `decide`, in `trailFor`, and
    for `currentApprovers`), it adds `readApprovalPin(request)`, null when `approvalWorkflowId` is
    missing or null. One helper builds the subject for all three.
  - **Unchanged:** the notifications, the conditional write (`:589-611`) and the rest of the request.
- **Not changed in PX-1.4:** `setWorkflow` and `deleteWorkflow`. With the pin, an edit, a deactivation
  or a deletion applies to new submissions only. An unpinned request still reads the current chain
  (§10).

### 6.6 R5: after-commit audit, opt-in per request type (PX-1.5)

- **The request-type registry** (`request-type.registry.ts:15-29`) keeps each type's audit option in
  a second map beside the DTOs, read through `auditModeOf(key): 'engine' | 'host'`, which is internal
  to the folder and not exported from the barrel. `getApprovalRequestType` and
  `listApprovalRequestTypes` still return the DTO only, so the spec's "hands it back whole" case
  (`request-type.registry.spec.ts:37-40`) stands. Re-registering replaces the option, and
  `clearApprovalRequestTypes` (`:29`) clears both maps.
- **`decide`** (`approval.service.ts:202-221`) builds the change rows as today (`:209-220`) and returns
  them as `auditChanges`. It calls `auditService.record` only when `auditModeOf` answers `'engine'`.
- **For a `'host'` type** the host records `{ entityRef: <its document>, action: <its verb>,
  changes: auditChanges }` after its own commit. `auditService.record` never throws
  (`apps/api/src/platform/audit/audit.service.ts:218-227`); ADR-041's Consequences record what is lost
  when a process stops between the host's commit and its `record` call.
- **Leave registers without the option** (`leave-request.service.ts:66-71`). Its engine row is
  unchanged, and its later refusals can still leave that row behind: the attachment gate (`:575-581`)
  and the conditional write's conflict (`:611`). Moving leave onto R5 is a separate HR slice (design
  §18.3.1 item 5).
- **No new audited pair.** The realtime registry classifies every audited entity pair, with a topic or
  with none (design §18.1 A2). The engine's `platform.approval` stays classified with no topic,
  because the request's own topic carries the decision
  (`apps/api/src/platform/realtime/realtime-registry.ts:328-332`).

### 6.7 R9: the chain save (PX-1.6)

- **Keys.** `setWorkflow` (`approval.service.ts:253-271`) refuses a rung whose key is not in the
  request type's `permissionKeys`, from the type it already looks up in the request-type registry
  (`:254`), with `approvals.unknownPermissionKey`, even when the permission registry is empty. The web
  contract spec pins that message
  (`apps/web/src/modules/system-admin/system-admin-api-contract.spec.ts:500-507`). The
  permission-registry check and the duplicate-rung check (`:262-270`) stay.
- **`basedOn`.** At the place lookup (`:273-277`) the save refuses `StaleDocumentError` in the cases
  of §4. Otherwise `updateById` gets `basedOn.version` in place of the version the server read
  (`:296`), and the base repository refuses a mismatch with `StaleDocumentError`
  (`apps/api/src/shared/base/base.repository.ts:574-601`). A create that meets the unique index
  (`workflow.model.ts:61-68`; `base.repository.ts:501`) is answered `StaleDocumentError`, and so is a
  `NotFoundError` from `updateById`, which means the row was deleted after the place lookup
  (`base.repository.ts:595-596`).
- **DTO.** `toDto` (`approval.service.ts:348-365`) adds `version: row.__v`.
- **Stored rungs outside the type's keys.** Wherever the engine resolves rungs, from a chain row or a
  pin, a rung whose key is not in the type's current `permissionKeys` is unstaffed, and it is left out
  of the rungs the reader is measured against (`ownStepsOf`), so no holder of that key decides it as
  their own rung (ADR-041 decision 9). An override within reach may still decide it: `overrideReaches`
  reads the rung's level, not its key, and on such a chain that and a cancel are the way through.
- **The chain screen** (`apps/web/src/modules/system-admin/approvals/pages/ApprovalWorkflowsPage.tsx`):
  its draft carries `basedOn`. A new draft carries null; editing a row carries that row's id and
  `version`; changing the draft's place, or its request type (`ApprovalWorkflowsPage.tsx:251-256`),
  either of which moves it to another key of the unique index (`workflow.model.ts:61-68`), takes the
  listed row at the new type and place, or null. The save sends it. Errors show as today.
- **The web contract spec** adds `basedOn` to the fields the page and the schema must both carry
  (`system-admin-api-contract.spec.ts:482`). Its lazy match still ends at the outer `.strict()`,
  because `basedOn`'s object is the named `ApprovalWorkflowBasisSchema` (§4).
- For `hr.leave` the only key is `leave.approve` (`leave-request.service.ts:70`), and the screen
  offers only the type's keys (`ApprovalWorkflowsPage.tsx:94-95`), so a stored chain with another key
  was written some other way; count C3 (§10) says how many there are.

## 7. Tests

C = create, M = modify. "C, M" = created in the first pull request listed, then modified. A **guard**
case passes on its base commit by design, as a regression check; exit criterion 1 counts every other
case of a fix pull request.

**Unit specs**, pure or with their seams mocked, no database. `approval.service.spec.ts` mocks
`approvalWorkflowRepository`, the approver lookup (`approversFor`, `hasApprovers`, `ownStepsOf`),
`userRepository.findByIdsSystem`, `departmentCatalogRepository`, `branchRepository`,
`rbacService.registeredPermissionKeys` and `auditService.record`, the service's imports
(`approval.service.ts:21-41`). `approval-trail`, `approval-chain` and, from PX-1.2, `override-reach`
run for real. It seeds the request-type registry with `registerApprovalRequestType` and empties it
with `clearApprovalRequestTypes` after each case. "The staffing memo" is asserted as one
`hasApprovers` call per distinct key and level, and "writes no row" as no `auditService.record` call.
From PX-1.6 the earlier `setWorkflow` cases pass `basedOn`, which the body then requires.

| Spec | C/M | PR | Checks |
|---|---|---|---|
| `approval.service.spec.ts` | C | PX-1.1 | chain selection and the staffing memo; `decide`'s refusals `approvals.alreadyDecided` and `approvals.notYourStep`; own rung, deciding early and the rungs it covers; override as today; `trailFor`'s flags; `currentApprovers`; `setWorkflow`'s three refusals |
| | M | PX-1.2 | `chainFor` answers `unstaffed` and `noChain` at submission; each row of §4's refusal table, with its key; an override within reach decides the first unsettled rung of an `unstaffed` chain and settles nothing above it; on a chain with two empty rungs, `currentStep` is the first, and after one override it is the second while the chain still reads `unstaffed`; an actor with a decision of their own is not offered the override |
| | M | PX-1.4 | `pinOf` is null with no row or no rungs, and drops staffing; `readApprovalPin` is null for a missing or null id; a pinned subject keeps its rungs and captions when the row is edited, deactivated or deleted, and reads no chain row; a pin with no rungs reads `noChain`; `pin: null` reads the current chain |
| | M | PX-1.5 | a `'host'` type writes no row and returns `auditChanges`; a stub host that commits and then records writes one row naming its document id; a stub host whose commit throws records nothing; an `'engine'` type records as today |
| | M | PX-1.6 | an off-type key is refused even with an empty permission registry; each `basedOn` case of §4, including a row deleted and recreated at the same place and an `updateById` that throws `NotFoundError`; a stored off-type rung, on a chain row and on a pin, is unstaffed, its key's holder cannot decide it, and an override within reach can |
| `approval-trail.spec.ts` | M | PX-1.2 | `statusOf`'s five answers: an all-unstaffed chain with no decisions is `unstaffed`, never approved; an approval with only empty rungs above it settles none of them and reads `unstaffed` (the existing case at `:127-143`, rewritten); a chain whose next staffed rung lost its holder after a decision is `unstaffed`; no rungs is `noChain`; a rung below `progressOf` with no entry, a gap, counts as settled; the other existing cases stay |
| `override-reach.spec.ts` | C | PX-1.2 | each level against organization, branch, department-in-every-branch and department-in-one-branch grants, reaching and not; `own`, `section` and unheld refused; each coordinate of §6.2's table, when missing, fails closed on the levels that need it, including a branch-scope override on a `unit` rung with no department copy; organization scope passes with missing coordinates |
| `approver-lookup.spec.ts` | C | PX-1.3 | `ownStepsOf` reads `findInForceForUsers`, so an expired or not-yet-started grant stands on no rung; `approversFor` keeps only what `activeIdsAmong` returns, so `invited`, `suspended`, `archived` and deleted accounts drop out; `hasApprovers` is false when only they hold a rung; delegations unchanged |
| `request-type.registry.spec.ts` | M | PX-1.5 | `auditModeOf` returns the option, and `'engine'` by default; `getApprovalRequestType` and the list return DTOs without it; re-registering replaces it; clearing clears it |
| web `system-admin-api-contract.spec.ts` | M | PX-1.6 | `basedOn` is in the schema and in the page's body (`:477-489`), and the captured schema still ends at the outer `.strict()` |

**Integration: one file**, `apps/api/tests/integration/approvals.spec.ts`, one file for the slice
(RK-01). Its setup:

- **Harness.** It copies the leave suite's helpers (`mkUser`, `login`, `regEmployee`,
  `activateEssLogin`, `decide` and their neighbours, `apps/api/tests/integration/hr-leave.spec.ts:60-237`).
  It does not extract them into a shared helper, because criterion 5 keeps `hr-leave.spec.ts`
  unchanged.
- **Its administrator.** The leave suite's administrator holds `super-admin` at organization scope
  (`hr-leave.spec.ts:246-252`), and the boot sync gives that role every registered key
  (`apps/api/src/platform/rbac/rbac.service.ts:595-599`). That user would stand on every `organization` rung
  of `leave.approve` and hold `approval.override` everywhere. This file's administrator holds a role
  of its own, every platform and HR key except `leave.approve` and `approval.override`, at
  organization scope.
- **Places and people.** Two branches; in one of them a department copy linked to a catalog entry,
  with the requesting employees. Each approver and override holder gets the grant a case names through
  `ensureAssignment`. An override holder who must open the request also holds `leave.view` at
  organization scope, because leave's detail read checks visibility (`leave-request.service.ts:1086-1103`)
  and `decide` does not.
- **Expired grants** are written as `platform.spec.ts` writes one
  (`apps/api/tests/integration/platform.spec.ts:1222`).
- **Chains** are written through `PUT`. From PX-1.6 every `PUT` sends `basedOn`, so that pull request
  adds it to the earlier cases' calls.
- **Reading `unstaffed`.** No DTO carries the engine's status (`ApprovalTrailDto`,
  `packages/contracts/src/platform/approvals.ts:151-182`). A case asserts it in-process, calling
  `approvalService.statusFor` on a subject built from the request row and the Unit the case set up,
  as the suite already imports platform services; over HTTP it shows as a request in
  `pendingApproval` whose trail's `currentStep` is the first unsettled rung.
- **Each refusal** asserts its status and its key.

| Case | PR | Defect |
|---|---|---|
| `PUT /api/v1/platform/approvals` writes an `hr.leave` company default with two rungs, and `GET` lists it | PX-1.1 | R12 (criterion 3) |
| A leave request goes to `pendingApproval`; the first rung's holder approves (still pending, rung 0 approved), the second approves (approved). Each decision writes one `platform/approval` row and one `hr/leaveRequest` `leaveDecision` row | PX-1.1 | R12; R5's leave baseline |
| A second request is rejected at rung 0; rung 1 reads `unreached` | PX-1.1 | R12 |
| On a staffed chain, an organization-scope `approval.override` grant that ended yesterday reads `viewerMayOverride: false` and is refused 422 `approvals.notYourStep` | PX-1.1 | R4, guard |
| A chain whose only rung nobody holds: the request still goes to `pendingApproval`, reading `unstaffed` with `currentStep` 0; an override over the other branch reads `viewerMayOverride: false` and is refused `approvals.notYourStep`; an organization-scope override decides it to approved | PX-1.2 | R2, R4 |
| A chain of a `unit` rung and an `organization` rung that nobody holds: the unit holder's approval leaves the request `pendingApproval`, reading `unstaffed` with `currentStep` 1 (today it is approved); an override that reaches the request's branch is refused `approvals.notYourStep` on the organization rung; an organization-scope override approves it | PX-1.2 | R2, R4 |
| On a staffed chain, an override that reaches the request's branch is refused `approvals.notYourStep` on an `organization` rung and passes on a `branch` rung | PX-1.2 | R4 |
| A request whose waiting rung is staffed is cancelled, and that rung's holder reads `viewerMayDecide: false`; a request left `unstaffed` and then cancelled reads `viewerMayOverride: false` for an override holder within reach | PX-1.2 | leave's trail (§6.1) |
| A person whose only grant at the waiting rung's level ended yesterday, on a rung a second holder in force keeps staffed, reads `viewerMayDecide: false` and is refused `approvals.notYourStep` | PX-1.3 | R3 |
| A rung whose only holder is suspended is passed when a staffed rung follows (the trail's `currentStep` moves to it); as the only rung it leaves the request `unstaffed` | PX-1.3 | R8 |
| A pinned request keeps its rungs after the chain is edited through `PUT`, and is decided on them; after the chain is deleted it is still decided to approved; a new request after the delete takes leave's manager and HR path | PX-1.4 | R1 |
| A request whose pin fields are unset (the shape before the deploy) reads the current chain | PX-1.4 | criterion 4, guard |
| Leave's decision still writes the engine's row (the PX-1.1 case stays green) | PX-1.5 | criterion 5, guard |
| A `PUT` naming `approval.configure`, a key in the permission registry but not an `hr.leave` key, is 422 `approvals.unknownPermissionKey`; a `PUT` without `basedOn` is 400 | PX-1.6 | R9 |
| A stale version, a null over a chain, a `basedOn` where no chain exists, and a `basedOn` naming a chain deleted and recreated at the same place are each 409 `STALE_DOCUMENT`; the right `basedOn` saves, and the response's `version` is one higher | PX-1.6 | R9 |
| A chain row inserted with an off-type rung leaves that rung unstaffed for a new request | PX-1.6 | R9 |

**Suites that stay unchanged** and must stay green: `hr-leave.spec.ts`, whose requests all run
leave's manager and HR path (`:378-420`), and `org-catalog.spec.ts`, which inserts a raw chain row for
the migration check (`apps/api/tests/integration/org-catalog.spec.ts:777-779`).

## 8. The file list

| File | C/M | Pull request | Purpose |
|---|---|---|---|
| `docs/03-decisions/ADR-041-money-approvals-on-the-platform-engine.md` | C | PX-1.0 | the decision |
| `docs/03-decisions/README.md` | M | PX-1.0 | ADR-041's row; ADR-011's row notes the part ADR-041 supersedes (criterion 6) |
| `docs/12-planning/administration-module-phase-px1.md` | C | PX-1.0 | this re-detail; M later only to record a deviation or PXQ-1's answer |
| `docs/12-planning/administration-module-decisions-and-phases.md` | M | PX-1.0; PX-1.6 | §22: re-detailed; closed |
| `docs/02-architecture/platform-core.md` | M | PX-1.0 | §11 and its collection row (`:183-191`, `:271`) rewritten to ADR-041 decision 1, PX-1's parts marked |
| `docs/07-workflows/workflow-engine.md` | M | PX-1.0 | §1's "Approval chain" row and §4 point at ADR-041 for approvals |
| `docs/05-database/database-design.md` | M | PX-1.0 | the approval section (`:247-256`) points at ADR-041 and `approval_workflows` |
| `apps/api/src/platform/approvals/approval.service.spec.ts` | C, M | PX-1.1; 1.2, 1.4, 1.5, 1.6 | §7 |
| `apps/api/tests/integration/approvals.spec.ts` | C, M | PX-1.1; 1.2, 1.3, 1.4, 1.6 | §7 |
| `apps/api/src/platform/approvals/approval-trail.ts` + `.spec.ts` | M | PX-1.2 | `ChainStatus`, `statusOf`, no closing above an approval |
| `apps/api/src/platform/approvals/approval-chain.ts` | M | PX-1.2 | `liveStep`'s comment only (`:74-82`) |
| `apps/api/src/platform/approvals/override-reach.ts` + `.spec.ts` | C | PX-1.2 | R4's rule; `APPROVAL_OVERRIDE_KEY` |
| `apps/api/src/platform/approvals/approval.service.ts` | M | PX-1.2, 1.4, 1.5, 1.6 | §6 |
| `apps/api/src/platform/approvals/index.ts` | M | PX-1.2; 1.4 | export `LiveChain`; then `pinOf`, `readApprovalPin`, `approvalPinFields`, `ApprovalChainPin` |
| `apps/api/src/platform/approvals/workflow.model.ts` | M | PX-1.4 | `approvalPinFields`, built from the private rung schema |
| `apps/api/src/platform/approvals/approver-lookup.ts` | M | PX-1.3 | R3, R8 |
| `apps/api/src/platform/approvals/approver-lookup.spec.ts` | C | PX-1.3 | §7 |
| `apps/api/src/modules/hr/leave-management/leave-requests/leave-request.model.ts` | M | PX-1.4 | the two fields, by spreading `approvalPinFields` |
| `apps/api/src/modules/hr/leave-management/leave-requests/leave-request.service.ts` | M | PX-1.2; 1.4 | no decision offered off a pending request, one comment (§6.1); then stamp the pin and hand it over |
| `docs/12-planning/leave-management-design.md` | M | PX-1.4 | §6's data-model summary (`:153-157`) gains `approvalSteps[]` and the two pin fields |
| `apps/api/src/platform/approvals/request-type.registry.ts` + `.spec.ts` | M | PX-1.5 | the audit option, `auditModeOf` |
| `packages/contracts/src/platform/approvals.ts` | M | PX-1.2; 1.6 | the comments on `currentStep` and `staffed`; then `ApprovalWorkflowBasisSchema`, `basedOn` in the schema, `version` in the DTO |
| `apps/web/src/platform/localization/i18n.ts` | M | PX-1.2 | the chain screen's hint, English and Arabic (§6.1) |
| `apps/web/src/modules/system-admin/approvals/pages/ApprovalWorkflowsPage.tsx` | M | PX-1.6 | sends `basedOn` |
| `apps/web/src/modules/system-admin/system-admin-api-contract.spec.ts` | M | PX-1.6 | the field list |
| `CHANGELOG.md` | M | each code pull request | `[Unreleased]` |

## 9. What PX-1 does not touch

- **Administrative Affairs.** Nothing under `apps/api/src/modules/administration/` or its web module
  changes (design §18.1, §18.4). The request types, the adapter, the host fields, OD-19 A's refusal and
  OD-82's verb are P2's.
- **Permissions, pages, navigation, audit verbs, events, notifications, realtime topics.** None is
  added or changed. No file under `apps/api/src/platform/rbac/` or `packages/contracts/src/permissions/`
  changes, so the CODEOWNERS second-reviewer paths (`.github/CODEOWNERS:10-13`) are not touched.
- **Leave beyond the pin and its trail's flags (§6.1).** Its submission rule (`leave-request.service.ts:293-300`), its manager and
  HR path, its inbox, which still lists `pendingApproval` requests to any `leave.approve` holder in
  scope (`:1106-1125`), its reminder to company-wide holders (`:1280-1308`), its own audit and
  notifications, and its DTO.
- **Separation of duties.** R6, the requester counted as a rung's holder (`approver-lookup.ts:23-75`),
  and R7, one person on two rungs (`approval-chain.ts:154-164`), are host rules (ADR-041 decision 11;
  design §15.2.1). R10 is a screen concern, and R11 joins RK-23.
- **Re-route, a per-rung lookup and value bands.** A re-route act and an exported per-rung holder lookup, either of
  which would widen PX-1 (design §5.2). Value bands, which are OD-18's: its recommended answer needs no
  engine change, and an engine condition would be a new ADR (ADR-041 decision 13).
- **Separate P2 prerequisites.** The `ApprovalChainPanel` and chain-screen label fixes (design §18.1,
  prerequisites table), and PC-7, which refreshes a requester's view of a document when a
  notification about it arrives (design §18.1).
- **A stuck-request listing.** The engine answers per request (`statusFor`). A listing needs the host's
  collection, so a host that needs one builds it: Administrative Affairs' is OD-61's sweep in P2, and
  leave has none.
- **The org-catalog migration's approval survey** (`apps/api/src/org-catalog-migration/apply.ts:538-590`).
  Before it links a department row to a catalog entry, it counts the leave requests awaiting approval
  under the chains that would then start applying, and refuses while any exist, because they would
  re-read their chain mid-way. It stays as it is, because unpinned requests still re-read their
  chain. It also counts pinned requests, which no longer would (`apply.ts:571-582`), so the migration
  stays blocked until those are decided or cancelled too. That is the cost of leaving it unchanged.
- **Deleting a chain** carries no version (ADR-041 decision 9).
- **Data.** No migration, backfill or boot step. PX-1 runs no data operation of its own: the new
  fields are written only by new submissions.

## 10. Migration posture

- **Requests in flight keep reading their chain live.** A leave request in `pendingApproval` from
  before PX-1.4 has no pin fields, so leave hands the engine `pin: null`, and the engine reads the
  current chain as today, judged by PX-1's other fixes. An edit can still remap such a request, which
  is the accepted cost (design §18.3.1 item 4).
- **A chain deleted or deactivated under such a request** makes it fall back to the next wider chain
  that matches, or read `noChain`, which `decide` refuses for everyone. Its way out is cancel and
  submit again (ADR-041 decision 10).
- **No backfill.** Writing pins into those rows would be an operator migration (design D-17: an
  operator-run command, dry-run by default; §15.3.7 class 3, the operator-run kind of data write),
  and nobody could know that today's chain is the one each request was submitted on. It is not
  planned.
- **The owner's rule.** No destructive operation and no production migration runs without the owner's
  explicit approval («لا تعمل destructive operation أو production migration بدون موافقتي الصريحة»,
  design §0, D-17). PX-1 needs neither.
- **New requests** carry the pin from PX-1.4's deploy.
- **Chains** are not changed. From PX-1.6, a stored rung whose key is outside its type's list counts
  as unstaffed, and its chain is refused at its next save (§6.7).
- **Read-only counts.** Three counts are run on the production database, read-only, by the owner or
  an operator the owner names, since the implementer may have no production access. They only read, so the
  owner's rule above does not cover them. In MongoDB a match on `null` also matches a missing field.

  | Count | `mongosh` | Reported | If it is not zero |
  |---|---|---|---|
  | **C1** leave chains | `db.approval_workflows.countDocuments({ requestType: 'hr.leave', isDeleted: false })` | in PX-1.2's description, before it deploys | with C2: PXQ-1 goes to the owner, with the numbers, before PX-1.2 deploys (§2) |
  | **C2** unpinned requests in flight | `db.hr_leave_requests.countDocuments({ status: 'pendingApproval', isDeleted: false, approvalWorkflowId: null })` | in PX-1.2's description; again whenever retiring `pin: null` is weighed | as C1. At zero, with every registered host pinning, `pin: null` can be retired (ADR-041 decision 10) |
  | **C3** stored chains with an off-type rung | `db.approval_workflows.countDocuments({ requestType: 'hr.leave', isDeleted: false, steps: { $elemMatch: { permissionKey: { $ne: 'leave.approve' } } } })` | in PX-1.6's description, before it merges | the owner is told, with each row's place, and PX-1.6 merges: each such rung reads unstaffed from the deploy, and its chain is refused at its next save until the rung is removed |

  C2 is the set the org-catalog survey counts for its departments (`apply.ts:571-575`), with the
  unpinned filter that leaves out requests pinned from PX-1.4. C3 needs `$elemMatch`:
  `{ 'steps.permissionKey': { $ne: 'leave.approve' } }` would match only rows where no rung names
  `leave.approve`. Rows of other request types are not counted, because `hr.leave` is the only type
  registered and no host resolves the others.
- **Deploy.** PX-1.6 changes the `PUT` body. Its API and web deploy together. A browser tab opened
  before the deploy sends no `basedOn`, gets a 400 because the field is required, and works again
  after a reload.
- **Rollback** (RK-30). Each pull request rolls back as a whole. If PX-1.4 rolls back, the pin fields on
  rows written meanwhile are ignored and those requests read their chain live again. If PX-1.6 rolls
  back, the web sends a `basedOn` the older schema refuses as an unknown key, so the web rolls back
  with it.

## 11. Exit criteria

Design §18.3.1, made checkable. Each item names what shows it.

1. **One test per defect, failing before its fix and passing after.** Each fix pull request's
   (PX-1.2 to PX-1.6) description shows its new cases failing on its base commit and passing on its
   head, except the cases §7 marks as guards:
   - R1: the PX-1.4 rows of §7;
   - R2 and R4: the PX-1.2 rows, and leave's trail row with them;
   - R3 and R8: the PX-1.3 rows;
   - R5: `approval.service.spec.ts`'s `'host'` cases, with a stub host, the only host that opts in
     during PX-1;
   - R9: the PX-1.6 rows.
2. **`approval.service.spec.ts` and `approver-lookup.spec.ts` exist** and run in
   `npm run test -w apps/api`.
3. **The engine path has integration coverage.** `approvals.spec.ts` writes a chain through
   `PUT /api/v1/platform/approvals` (`approval.routes.ts:28-34`, mounted at `apps/api/src/app.ts:226`)
   and drives a leave request through `pendingApproval` to approved and to rejected.
4. **Requests in flight read live.** The unset-pin case passes. No migration CLI or boot step ships:
   PX-1's diff adds no `*.cli.ts` file and does not change
   `apps/api/src/platform/kernel/bootstrap.ts`.
5. **Leave keeps its audit.** `git diff` over PX-1 shows no change to
   `apps/api/tests/integration/hr-leave.spec.ts`, and it is green. Leave registers without the audit
   option, and its decision still writes the engine's row (the PX-1.1 case).
6. **The ADR is accepted first.** PX-1.0's last commit, after its design review, rewrites ADR-041's
   Status line to `Accepted · Date: <that commit's date>` with its basis, as ADR-040's reads (its Date
   is its own commit's, `d4f2893a`; pull requests are squash-merged, `CONTRIBUTING.md:25`), sets its README
   row to Accepted, and notes on ADR-011's row that ADR-041 supersedes its approval-integration
   bullet. PX-1.0 merges before PX-1.1 opens.
7. **Gates.** Every pull request passes design §18.5's gates. The permission-matrix check runs in CI
   and has nothing to regenerate, because no key changes.
8. **Docs.** Each code pull request has its CHANGELOG entry. Platform core §11 matches ADR-041 from
   PX-1.0 on. §22 records PX-1's close, and the owner is told.

## 12. Risks

| # | Risk | L | I | Mitigation |
|---|---|---|---|---|
| PX-R1 | **Leave's approval behavior changes.** Expired grants stop deciding; an override out of reach loses its buttons; a rung held only by suspended or invited accounts is unstaffed, so a request may wait on a later rung and its notice goes there; a request with nobody left to approve waits instead of being approved by the lower approval, and nobody who can decide it is notified (PXQ-1, Evidence). Leave's suite exercises none of this (`hr-leave.spec.ts:378-420`) | M | M | The integration file covers each change; the CHANGELOG entries say what an approver will see; counts C1 and C2 come before PX-1.2 deploys, and PXQ-1 goes to the owner first if either is not zero (§10); R8 lands after R2 (§6.4) |
| PX-R2 | **Unpinned requests still remap.** An edit that shrinks a chain below an in-flight request's progress reads approved for it; `decide` refuses and the request waits | L | M | Accepted (criterion 4). Leave takes its status only from a successful `decide` (`leave-request.service.ts:583-611`), which refuses here, so the request is never approved by it. Cancel and submit again; count C2 sizes the set (§10) |
| PX-R3 | **Stuck chains need one override per empty rung.** On `unstaffed`, an override decides only the first unsettled rung, by that rung's level, and settles nothing above it | M | L | This is what keeps an override from approving past a rung it does not reach (ADR-041 decision 3); each decision is recorded with `overriddenWith`; it is the exit the design names for a stuck document (design §5.2) |
| PX-R4 | **Stored chains with other keys** lose that rung's holders from PX-1.6, and are refused at their next save | L | L | Count C3 before PX-1.6 merges, reported to the owner (§10); an override within reach or a cancel moves an affected request; the refusal names the rule; the screen offers only the type's keys |
| PX-R5 | **A stale tab after PX-1.6** sends no `basedOn` | M | L | API and web deploy together; a reload fixes it |
| PX-R6 | **P2 must handle the new answers** (`unstaffed`, `noChain`) and register `audit: 'host'` | M | M | ADR-041's Consequences list them; P2's re-detail carries them |
| PX-R7 | **Cost per read.** R8 adds one id-only user read per distinct key and level | L | L | It is by id, inside the per-call staffing memo (`approval.service.ts:85-91`); a pinned read adds no row read |
| PX-R8 | **The new integration file adds to CI time** against the 45-minute budget (RK-01) | M | M | One integration file for the slice; each pull request reports its minutes |
| PX-R9 | **PXQ-1 stays open**, so leave requests nobody can approve wait | M | L | An override within reach can now decide them; PXQ-1's answer is an HR slice (§2) |

## 13. Review

Design review of this re-detail and ADR-041, **Full** preset, 2026-11-25, as the design-review skill
runs it (`.claude/skills/design-review/SKILL.md`). The feature range is §1–§2; the detailed range
starts at §3, the PR plan. ADR-041 was read whole in every stage.

- **Reviewers run.** A `egm-zoom-out`; B `egm-comprehension`; C `egm-design`, `egm-structural` and
  `egm-style`; the fixes; D `egm-zoom-out`, with A's findings; E `egm-implementation-readiness`,
  `egm-codebase-details` and `egm-style`. Not run: none.
- **Dropped under (a)–(d).** Round 1: none. Round 2: part of one finding, under (a): the claim that
  "A for OD-69" is inconsistent with OD-69 (i). OD-69's recommended default is "A; override (i)"
  (`administration-module-decisions-and-phases.md:627`), and the owner adopted every default (§16.12).
  The rest of that finding, the misplaced adoption sentence, was fixed.
- **Round 1 (A–C): 75 findings, 22 Major and 53 Nit; 74 fixed, 1 contested.**
  - *Fixed.* The tail closure is removed, so an approval closes nothing above it and an override
    settles one rung, by its level (decisions 2 and 3). The pin is structured rungs in the chain
    row's own schema. R8 uses `activeIdsAmong`. Stored rungs with an off-type key count as unstaffed.
    R9's `basedOn` names the row id as well as its version. The ADR gained its Terms, a decision on
    separation of duties (11), its rejected options with their costs, its risks and limits, and a
    data-flow diagram; it plans no amendment of itself (decision 13, "Later changes"). PXQ-1 took the
    OD shape. Scope, start gate, wording, citations and the other documents' pointers were corrected.
  - *Contested.* "R5's `auditChanges` and the stub-host tests exceed the engine's job": both are the
    plan of record (design §15.2.1 R5, `administration-module-decisions-and-phases.md:65`; §5.2
    decision step 5, `administration-module-design-flows.md:792-794`; §18.3.1 item 1, `:2244`).
- **Round 2 (D–E): 67 findings, 19 Major and 48 Nit, merged by the verifier into 13 groups and 41
  single findings; all fixed.**
  - *Refusals and the trail.* `decide` checks the status first, then the actor, with one answer per
    case (§4's table): an actor without an override within reach gets `approvals.notYourStep` on
    `unstaffed` as on `pending`, and `approvals.nothingToDecide` answers `noChain` only. On
    `unstaffed`, `currentStep` is the rung to decide, so the panel marks it (§6.1; ADR decision 3).
    Leave's trail offers no decision on a request that is not pending (§6.1). The chain screen's hint,
    in English and Arabic, and three comments are rewritten in PX-1.2.
  - *Override reach.* A level-by-coordinate table, with the null check before the shared helpers
    (§6.2; ADR decision 6).
  - *The pin.* The barrel exports `approvalPinFields` and `readApprovalPin`, not a schema named like
    leave's own `approvalStepSchema`; a pin with no rungs reads `noChain` instead of throwing, so the
    request and its cancel stay reachable (§5, §6.5; ADR decision 4).
  - *Saves.* `basedOn` is the named `ApprovalWorkflowBasisSchema`, so the web spec's match still
    guards the outer `.strict()`; the 400 is due to the required field; a delete that races a save is
    answered `STALE_DOCUMENT`; a change of request type recomputes `basedOn` (§4, §6.7).
  - *Counts.* Three read-only counts, C1 to C3, with their `mongosh` commands, who runs them, when, and
    what a non-zero result does; C2 counts unpinned requests only; C1 and C2 come before PX-1.2
    deploys, and PXQ-1 goes to the owner first if either is not zero (§2, §10).
  - *Tests.* Exit criterion 1 excludes guard cases, which §7 marks; the expired-override case moved to
    PX-1.1; the service spec's mock seams, the integration harness and its administrator, the
    visibility grant, how `unstaffed` is asserted and the R3 case's second holder are stated.
  - *Smaller fixes.* `auditModeOf` and the registry's DTO-only getters; PX-1.6's dependency on PX-1.4;
    "settled" defined once; the third departure from the plan of record (R5 per request type) in the
    drift check and §22; platform core §11 marks every PX-1 change; the ADR's Context in the past
    tense for §11; the acceptance date; tense, citation, hedge and table-layout fixes.
- **Accepted, declined, open.** None.
- **Escalated.** No new question. PXQ-1 (§2) waits for the owner's answer; until then option 3
  applies, and it is put to the owner before PX-1.2 deploys if counts C1 or C2 are not zero.
