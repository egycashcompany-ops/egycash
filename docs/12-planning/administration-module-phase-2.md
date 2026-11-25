# Administrative Affairs — Phase 2: purchase requests (re-detail)

**Status:** DRAFT v0.4 (2026-11-25), its design review recorded in §18 and its second drift check, on the engine PX-1
built, in §1.2 E. This is the P2 re-detail that design §18 and §21 require before a phase's first pull request: the
plan of record "re-checked against the code (a drift check) and re-detailed as a §19-shaped section" in a sibling file,
whose design review "is the gate before that phase's first pull request"
(`administration-module-decisions-and-phases.md:2006-2010`); design §22 records it. The platform slice P2
builds on is re-detailed in [administration-module-phase-px1.md](administration-module-phase-px1.md), and its decision
is ADR-041, Accepted (`docs/03-decisions/ADR-041-money-approvals-on-the-platform-engine.md`).

The design is FROZEN v1.0, in four files: §0–§3 in [administration-module-design.md](administration-module-design.md),
§4–§7 in [administration-module-design-flows.md](administration-module-design-flows.md), §8–§14 in
[administration-module-design-integration.md](administration-module-design-integration.md) and §15–§22 in
[administration-module-decisions-and-phases.md](administration-module-decisions-and-phases.md). "Design §n" below
means those sections; a bare §n is this document's. Since the owner's approval of 2026-11-24 the freeze covers
D-1…D-22, the design §2.4.4 posting invariant and the design §2.4.5–§2.4.6 arithmetic, the design §3.6 dependency
graph, the states and edges of design §5, the scope rules of design §7, the realtime rules of design §9 and every name
design §2 fixes. P2 touches no stock rule (design §2.4.4–§2.4.6 start in P5) and relies on the design §3.6 graph twice
(§1; §1.2 item 14). Routes, bodies, DTOs, fields beyond their names and exit criteria are the plan of record, which this
document re-details (`administration-module-decisions-and-phases.md:2003-2006`).

**Paths.** Code paths are from the repository root, with three shorthands. Module paths are under
`apps/api/src/modules/administration/` unless they say otherwise, and "the PR feature" is
`procurement/purchase-requests/` there. Engine paths are under `apps/api/src/platform/approvals/`. HR leave's files are
in `apps/api/src/modules/hr/leave-management/leave-requests/`, and "the leave service" is `leave-request.service.ts`
there. Documents in `docs/12-planning/` are cited by file name, other documents by their path from the repository
root; an ADR is named by its number, with its path when a line is cited. A bare `:n` cites the file named last before
it.

**Drift check** (design §18), on `main` at `de38fd71`, and a second one on the engine PX-1 built, read on `a4434d00`,
PX-1.6's head (§3). Since `de38fd71` the code has changed only in the engine and its tests, its contract, HR leave's
service and model, the chain screen's files and their source scan, and `i18n.ts`, so every other code citation below
still holds as read on that commit; those in the changed files were read again on `a4434d00`, and the lines that moved
are re-pinned (§1.2 E). §1.2 details each finding; three shape the phase:

- **P2 is written against the engine PX-1 built.** The first check ran when only PX-1.0, the documents, had merged.
  The second read PX-1.1 to PX-1.6 against §1.2 A items 1–5, item 17 and the calls of §8, and found the engine as
  ADR-041 leaves it: five statuses, the pin and the audit option (`approval-trail.ts:46`; `index.ts:1-18`;
  `request-type.registry.ts:37-43`). It corrected this re-detail's wording, its pins and four of its rules, and asks
  for no engine change (§1.2 E).
- **ADR-041 supersedes five points of the P2 text** (§1.2 A, items 1–5): the pin holds rung subdocuments, not
  `string[]`; the type opts into the after-commit audit, and `decide` returns the audit changes; `chainFor` returns a
  status; the engine itself drops inactive accounts and off-type keys, so two of the module's planned submission
  checks go; and the engine's refusals on a decision are ADR-041 decision 3's.
- **The code Phase 1 left differs from the P2 text in eight places** (§1.2 B, items 6–13): the counter's names, the
  floor read, the order of the stale check, filing under the top bar, the feature index exports, the missing unit-lock
  registry, the attachment limit, and one citation error in the design.

No other drift was found in the platform code P2 relies on. No file under `apps/api/src/platform/audit/` or
`apps/api/src/platform/notifications/` has changed since the design's drift check at `9efdcbd9`; the engine, HR
leave and the chain screen changed in PX-1, and §1.2 E records what that moved. Each pull request re-pins the lines it
touches, as design §19.1 does.

**Terms.** ADR-041's Context defines the Unit, levels, rungs, staffed and settled rungs, the waiting rung, the rung to
decide, a grant's scope and reach, grants in force and rounds. This document adds:

- A **PR** is a purchase request, «طلب شراء»; here it never means a pull request. A **slice** is one of P2's code pull
  requests, P2.0 to P2.W2 (§3). A PR's **requester** is the person who raises it: always the caller of the create
  (design §7.3), and the only person who edits, submits or attaches files to its draft (§4.2; §1.2 item 22).
- The **live rung** is ADR-041's waiting rung, read from the PR's pin: the first staffed rung at or after the first
  unsettled one. `currentApprovers` names its holders, and on a `pending` chain the trail's `currentStep` points at it.
  An `unstaffed` chain has no live rung; its `currentStep` is the rung to decide, the first unsettled one, which only
  an override settles (ADR-041 decision 3). `currentStep` is the same for every viewer (`approval.service.ts:181-214`;
  `rungToDecide`, `approval-trail.ts:89-96`), so a host that holds an `AuthContext`, as a decision does, can read the
  live rung from the trail; the sweep acts for nobody and holds none. Who holds a rung is the engine's: no per-rung
  holder lookup is exported (`approversFor`), only the live rung's holders through `currentApprovers` (§8.2 step 5).
  From its own entries the host can tell the **first unsettled rung**, the highest `stepIndex` among the round's
  entries plus one (`progressOf`, `approval-trail.ts:55-56`), and so the **rungs left**, from that rung to the last
  pinned one, by which P2 chooses the stuck audience (§1.2 item 24).
- The **A1 set** of a PR is its `requesterUserId`, `createdBy` and `submittedBy`: the people pair A1 keeps off every
  rung (design §6.6). OD-21 B names the three roles for every administration type; on a PR they are one person, because
  only the requester creates, edits and submits it. Pair **B1** keeps one person to one rung per round.
- An **eligible approver** is a holder of the live rung, as `currentApprovers` returns them, who is not in the A1 set
  and has not decided another rung of the current round.
- A PR is **stuck** when it waits in `pendingApproval` with no eligible approver on its live rung, or with no staffed
  rung left (`unstaffed`, ADR-041 decision 3).
- A **department copy** is one branch's row for a company department. The company department is a catalog entry
  (ADR-031), which a copy names in its `catalogId`, null until the copy is linked (design §7.6, Uncataloged copy). A
  PR's `departmentId` is the copy. The Unit also carries the copy's `catalogId`, as `departmentCatalogId`, because
  `department`-level rungs and grants over a company department match on it (ADR-041 Context). The org-catalog
  migration, which links and merges copies, rewrites every field named `departmentId` (design §7.7).
- **Unit**, capitalized, is the approval Unit. Lower-case "unit" is a rung's `unit` level or an item's base unit, as
  the sentence says. "Section" is a navigation section (OD-62) or the `section` grant scope, which reaches no Unit.
- **Concurrency classes** are design §5.1.3's: **V**, the versioned update of a draft through `updateById`; **C**, a
  conditional write on `{ _id, status, __v }` whose miss is re-read and answered 409 or 422; **T**, a transaction
  (`unitOfWork`) whose first write is the counter; **A**, the approval append, **C** plus the entry-count filter of
  §8.3. An **in-state** act writes the PR and keeps its status (design §5.4).
- **Register ids** are the design's: D-n its own decisions (design §0.3), OD-n the owner's (design §16, answered in
  design §16.12's log), RK-n its risks (design §17), PC-n its platform changes (design §15.2.2, timed in design §18.1).
  An option marked (S), (M) or (L) states its effort: inside the phase, an extra slice, or a platform change (design
  §16.1).
- **The adapter** is `shared/approvals.ts`, the module file that registers the request type and builds each subject
  (design §5.2, §5.16). It does not exist yet.

## 1. Scope

P2 ships purchase requests: drafted by a department's focal point, numbered on submission, approved on the platform
engine at the PR's Unit, returned for amendment or rejected, cancelled or withdrawn, with request attachments, notices
to approvers, requesters and procurement, and a daily reminder and stuck-approval sweep. It is the first document of
the module and the first approval host after HR leave. What P2 does not touch is listed in §14.

**Why now.** A purchase request is the first step of the purchasing cycle the owner asked for, «Purchase Request →
Approval → RFQ/Quotation → Supplier Selection → Purchase Order → Receiving» (design §0), and the later documents cite
it: the RFQ (P3), the PO (P4) and, through the PO, the goods receipt (P5). It is the next phase in design §18.2's order,
after Phase 1's master data and PX-1's engine fixes.

Nothing in P2 can be ordered: RFQs are P3 and purchase orders P4 (design §18.2). So every PR line's `orderedQty` stays
0 in P2, an approved PR's only exit in ECMS is a cancel, and the acts that need an order wait for the phases that make
them reachable (§1.2, C). Whether PRs are used in production before P4 is PRQ-3 (§2).

P2 also makes two changes to items, both named by the design for this phase:

- items gain `stockTracked`, the non-stock kind of OD-14 C (design §2.3.4, §19.2);
- once a PR line names an item, the item edit refuses to change its base unit. The check runs before the write,
  through the checker registry design §3.6 places in `catalog/items`, which design §22's P1a.2 entry leaves to ship
  "with its first registrant" (`administration-module-decisions-and-phases.md:3130-3131`); P5's posting is the binding
  guard (§6.2).

**When it starts.** This re-detail is written before the phase. P2's code starts once PX-1 has closed: PX-1.6 merged,
its exit criteria met and the owner told (`administration-module-phase-px1.md:200`). PX-1's own code starts only once
Phase 1 is closed, "its exit criteria met and the owner told" (`administration-module-phase-px1.md:66-68`). Design §22
records Phase 1's pull requests merged and criteria 1 to 8 checked, with criterion 9, the owner's acceptance on staging,
"the one left" (`administration-module-decisions-and-phases.md:3397-3402`). The order was the owner's rule:
«وامشى Phase واحده وبعد ما نقفل كل واحده ندخل على اللى بعدها» (design §16.12). On 2026-11-25 the owner told the work
to carry on and finish P2, merge it, and stop there, «كمل وخلص P2 وأدمجها وأقف عندها» (design §16.12): PX-1 and P2 run to their merge with
criterion 9 still owed, and nothing after P2 starts. Criterion 9 stays open, and is recorded in design §22 when the
owner gives it.

### 1.1 The owner's answers P2 applies

On 2026-11-24 the owner adopted every recommended default as the working answer
(`administration-module-decisions-and-phases.md:1929-1939`). P2 applies these:

| Decision | Answer | What it means in P2 |
|---|---|---|
| OD-14 | C, a non-stock kind on items | `stockTracked` on items, absence-safe: a row without the field reads as a stock item, today's behavior (§6.2). Every PR line names an item, so a line has no free text (§6.1) |
| OD-16 | A, department focal points | `administrationPurchaseRequest.create` at department scope; the requester is a placed employee; no filing for another department; no `sectionId` |
| OD-17 | A, the requester's Unit; lowering (ii) | the chain of `administration.purchaseRequest` at the PR's Unit (§8); an approver may lower a line, never raise it, the cut kept as the line's `cancelledQty` (§7.3) |
| OD-19 | A, refuse | a submission with no chain, no staffed rung or no eligible approver on the live rung is refused (§8.2) |
| OD-20 | A, PX-1 first | P2 ships none of OD-20 B's three module stopgaps (R1's pin compare, refused with `ADMINISTRATION_APPROVAL_CHAIN_CHANGED`; R3's exact-level check; R4's override reach; design §15.2.1), so that code is not added either |
| OD-21 | B | pair A1 on every decision and every return, pair B1 on every decision, override holders and delegates included (§8.4) |
| OD-26 | A, no change in place | no amend act. A decrease after approval is a remainder cancel from P4 (§1.2 C); until then it is a cancel and a new PR with a new number. An increase is a new PR |
| OD-28 | A; OD-28.3 (i); OD-28.4 (i) | a cancel under `.cancel` while nothing is ordered, with a reason except on a draft that never took a number; the requester's own withdrawal under `.view` before a decision (§7.4) |
| OD-57 | A, calendar year, Cairo | the number's year is the Cairo year of its business date |
| OD-58 | A; cancelled numbers (i) | `PR-{YYYY}-{seq:6}`, one series for the company, taken on leaving draft, gap-free; cancelled PRs stay listed. B, per-branch series, is the fallback if criterion 8's contention test misses (§16) |
| OD-59 | A | no PR paper: the PO, GRN and issue papers are the papers of record, and the RFQ's is the first paper (design §11.6.1) |
| OD-60 | A; OD-60.2 (i) | no export in P2 (§2) |
| OD-61 | A | the approvers, the requester and procurement are told. The keeper OD-61 A also names is a warehouse's, told of stock documents; a PR names no warehouse, and design §5.4 row 3 names only the requester and procurement. `approval` and `workflow` categories; a daily reminder; no automation; no PC-8 (§11) |
| OD-62 | A, sections later | one navigation row, no section (§2) |
| OD-64 | A, keep; names (ii) | `administration_purchase_requests` kept by the workforce reset; `requesterName` scrubbed by HR's permanent delete (§6.4) |
| OD-69 | A; override (i) | an override decides within its own reach, recorded as `overriddenWith`, bound by the pairs. No PR key is on design §6.7's list of keys held only at organization scope, so `.approve` is granted at each rung's own scope |
| OD-71 | A, one desk per level | at most four rungs (unit, department, branch, organization) |
| OD-72 | B | a host `return` act; `rejected` stays final (§7.2) |
| OD-76, OD-77 | A; formats (i); after submission (i); retention A | request attachments: PDF and images, files only while a draft, `retentionDays: null`, none required (§4.3) |
| OD-78 | A | the department requester bundle, and the PR keys added to four existing bundles (§9.3) |
| OD-81 | A | several pull requests (§3) |
| OD-82 | A | a new audit verb, `approvalDecision` (§10.2) |

OD-73's default (A, prices only for PO viewers) touches nothing: PRs carry no prices (design §2.5).

### 1.2 Drift check: what moved, and what this re-detail changes

**A. The engine P2 assumes (ADR-041).** P2 is written against the engine as PX-1 leaves it (ADR-041 decisions 1–13;
PX-1 re-detail §4–§6). Where the P2 text predates the ADR, the ADR wins:

1. The pin. `approvalChainShape` holds the chain row's rungs as `{ permissionKey, level, label }` subdocuments,
   declared by spreading the barrel's `approvalPinFields`, and `approvalWorkflowId` is an ObjectId (ADR-041 decision
   4). Design §2.1 and §5.2 proposed `string[]` of `permissionKey@level`
   (`administration-module-design.md:651`; `administration-module-design-flows.md:730-734`).
2. The audit. The type registers with `{ audit: 'host' }`, `decide` writes no row and returns `auditChanges`, and the
   module records the decision after its commit (ADR-041 decision 7). Design §4.1 note 1 and design §5.2 step 2
   describe the engine auditing before the host commits (`administration-module-design-flows.md:33-34, 785-786`).
3. The submission test. `chainFor` returns `status` (`noChain`, `unstaffed` or `pending`), and the module refuses the
   first two (ADR-041 decisions 2 and 3). Design §4.1 tests `chain.steps.some((s) => s.staffed)`
   (`administration-module-design-flows.md:24`).
4. Two module checks go. The engine counts only active accounts (decision 8) and treats a rung with another key as
   unstaffed (decision 9). So design §6.4 item 5's "minus accounts that are not `active`" and item 1's refusal of a
   chain that names another key (`administration-module-design-flows.md:1723-1725, 1753-1755`) are not repeated in
   the module.
5. The engine's answers on a decision. `noChain` refuses `approvals.nothingToDecide`, `approved` and `rejected`
   refuse `approvals.alreadyDecided`, and on `pending` or `unstaffed` an actor with no rung and no override within
   reach is refused `approvals.notYourStep` (ADR-041 decision 3). The adapter's remap of design §5.15 is unchanged
   (`administration-module-design-flows.md:1461`).

**B. Where the code Phase 1 left differs from the P2 text.**

6. The counter. The code has `ensureCounter(key, floor)` and `nextNumber(key, session)`, one number per call
   (`shared/counter.model.ts:32-43`); design §2.3.1 and §5.1.2 name `takeNumbers`
   (`administration-module-design.md:813-814`). P2 uses the code's names.
7. The floor. Design §2.8 reads the floor "through `ux_number` by prefix"
   (`administration-module-design.md:1424-1425`). Phase 1 found that the plain read, newest number first, is wrong past
   five digits, and reads only the formatter's own spelling, grouped by length (`shared/document-number.ts:8-16,
   47-70`). The yearly series follow Phase 1's rule (§6.3); the file's header says they join its table (`:5-6`).
8. The stale check. Phase 1's master data answers 409 `STALE_DOCUMENT` before any rule
   (`shared/master-data.ts:62-72`). Design §5.15 ranks "never writable" (422) above stale (409), as the base repository
   does (`apps/api/src/shared/base/base.repository.ts:594-600`). A PR is not master data: its writes answer in the
   order 404, 403, 422 for the status, 409 for the version, then 422 for the rules (§4.2). Master data keeps its
   order.
9. Filing and the top bar. Design §7.5 files a PR on "the branch of the requester's department copy; never the switcher"
   (`administration-module-design-flows.md:2142`). Phase 1's warehouse create applies ADR-028's "the same value decides
   where a new document is filed" (`docs/03-decisions/ADR-028-active-branch-narrowing.md:40`) and refuses a branch
   outside the top bar's choice with 400 `OUT_OF_REACH` (`warehouses/warehouses/warehouse.service.ts:189-194`). P2 keeps
   design §7.5's filing rule as it is and adds one check before the write: a create whose placement branch the top bar
   excludes is refused 400 `OUT_OF_REACH` (§4.2), so a narrowed holder never files a PR that their own register then
   hides. The top bar narrows to the chosen branch a `.create` grant held at organization scope, and a department-scope
   grant whose reach goes beyond the holder's home copy (a delegation, or several copies); it leaves alone a
   department-scope grant over the home copy only (`scopeSelector`, `apps/api/src/shared/types/index.ts:219-254`). A
   focal point who holds only the department requester bundle, over their own copy, is never refused this way. The
   narrowed case is reachable: the switcher is shown to every account that holds any key at organization scope, whatever
   its placement, and to an account whose grants reach several branches
   (`apps/web/src/platform/layout/BranchSwitcher.tsx:50-65, 112`), although ADR-028 says it is not rendered for an
   account placed in a branch (`docs/03-decisions/ADR-028-active-branch-narrowing.md:58-59`). *Rejected:* filing on the
   placement with no refusal, which leaves the creator's own register hiding the draft they just made. The check is not
   a filing rule, but it does let the top bar refuse a filing, so the design review is asked to confirm it against
   design §7.5's frozen wording.
10. Feature exports. A feature reaches another only through its `index.ts`
    (`administration-isolation.spec.ts:149-157`). `catalog/items/index.ts` exports no `activeFor` and no read of
    several items by id (`catalog/items/index.ts:1-2`), which the PR lines need. P2.2 adds both.
11. The unit lock. No checker registry exists for items; only the warehouse's does
    (`warehouses/warehouses/warehouse-holds.ts:1-34`), and the item edit still changes the unit freely
    (`catalog/items/item.service.ts:229-231`). P2.2 ships the registry and the PR as its first registrant (§6.2).
12. The attachment limit. Request attachments inherit Phase 1's bound, `ADMINISTRATION_MAX_LIST_ATTACHMENTS` (20,
    `packages/contracts/src/modules/administration.ts:120`), and its refusal `ADMINISTRATION_ATTACHMENT_LIMIT`
    (`packages/contracts/src/errors/index.ts:732-737`), which design §5.15's P2 table does not list.
13. An older citation error. Design §7.5's basis for refusing an unplaced account, `leave-request.service.ts:85-90`
    (leave's `ownEmployee`, now at `:87-92`), refuses only a login with no employee; an employee with no department is
    filed with a null department (`unitOf`, `leave-request.service.ts:103-113`). P2 refuses both (§4.2).

**C. Plan-of-record changes this re-detail makes, and its one reading of ADR-041 (item 17).** Each item that sets a
new rule names the alternative it rejects.

14. **Acts that cannot run before an order exists move to the phase that makes them reachable.** In P2 nothing is
    ordered, so `POST /:id/cancel-remainder` would only ever refuse (with nothing ordered "the act is row 8",
    `administration-module-design-flows.md:900-906`), the close of row 9 runs only inside a PO act or a remainder
    cancel (`:898`), the open-claim checker is registered by `purchase-orders` (design §3.6), and OD-28.3's check
    needs RFQs. So the remainder cancel, the `.closed` event and the checker ship in P4, and OD-28.3's RFQ check in
    P3. Design §5.4's table still holds all nine rows from P2 (§7). This changes design §18.2's and §18.3's P2 rows,
    which list `.closed` and `/cancel-remainder` (`administration-module-decisions-and-phases.md:2164, 2230`), in line
    with the rule that an event ships with its emitter (design §8.1, D-13). *Rejected:* shipping them in P2 as those
    rows list them, a route that can only refuse and an event no act emits.
15. **The PR line names an item.** Under OD-14 C a service or an uncataloged good is a non-stock item, so `itemId` is
    required and the line has no `description`; design §2.5's `itemId | null` and `description | null` serve OD-14 B's
    free text (`administration-module-design.md:1329`). If the owner later answers OD-14 B, the two fields return,
    absence-safe. *Rejected:* keeping both nullable fields now, for a free-text line no answer asks for.
16. **The module's first scheduled task is P2's sweep**, not P6's leaver sweep
    (`administration-module-decisions-and-phases.md:2169`). OD-61's daily reminder and the stuck-approval sweep of
    ADR-041 decision 3 are both P2's (§11).
17. **The sweep asks `currentApprovers`, not `statusFor`: a departure from ADR-041 decision 3's wording, not from its
    decision.** Decision 3 says "A host's sweep or report asks `statusFor` per document. For Administrative Affairs that
    is OD-61's stuck-approval sweep, in P2"
    (`docs/03-decisions/ADR-041-money-approvals-on-the-platform-engine.md:240-242`). What it decides is that the stuck
    list is the host's, because the engine holds no requests; P2 keeps that, since its own sweep lists stuck PRs
    (§11.2). The sweep asks `currentApprovers` because one read per PR gives both the reminder's recipients and the
    stuck test: it answers no holders on an `unstaffed` chain, which has no live rung, and it reads the pinned chain
    (`currentApprovers` over `chainOf`, `approval.service.ts:310-317`); and it also shows a live rung held only by the
    A1 set, which `statusFor` reads as `pending`. So design §5.16 spec 12, "no `approvalService.statusFor(`", stands as
    written (`administration-module-design-flows.md:1550`). No new ADR is needed: ADR-041 asks for one when its
    decisions change (`docs/03-decisions/ADR-041-money-approvals-on-the-platform-engine.md:512-514`), and none does.
    *Rejected:* `statusFor` and then `currentApprovers` for each PR, two engine reads where one answers both questions.
    The second drift check (§3) confirmed both answers in the engine PX-1 built: no holders on an `unstaffed` chain, and
    on a `pending` one the live rung's holders, the A1 set included.
18. **No export, paper, section or setting.** Design §14.5 gives the PR register's export as "client, on request"
    (`administration-module-design-integration.md:2502`), and no request had come by 2026-11-25 (design §16.12's log
    holds none); OD-59 A prints no PR; OD-62 A ships sections later. So PC-11 (the shared export code) and the
    settings inventory spec (`settings-inventory.spec.ts`, §14) are not P2's.
19. **The return is gated as the decision is**, `authorizeAny(.approve, approval.override)`. OD-72 B as adopted reads "a
    host `return` act (the approve key)" (`administration-module-decisions-and-phases.md:1124-1125`), and design §5.4
    row 5 gives the return `.approve`, while design §5.2 names "a return by an override holder (OD-72 B)" as one of a
    stuck document's exits (`administration-module-design-flows.md:763`). P2 reads the two together, as the decision
    already does under OD-69 (i): the approve key gates the return, and `approval.override` stands in for it within its
    reach. §7's table shows rows 3 to 5 with both keys, and design §5.16 spec 5's case maps row 5 to `.approve`, with
    the override as its platform substitute, as for rows 3 and 4 (`administration-module-design-flows.md:1543`).
    *Rejected:* `.approve` only, which removes the return from a stuck PR's exits and leaves an override's decision or
    a cancel.
20. **The requester's screens refresh live in P2, without PC-7.** Design §18.3's P2 row has the requester's screen
    refresh on a decision "once PC-7 has landed", and on navigation and `staleTime` until then
    (`administration-module-decisions-and-phases.md:2230`), and PC-7, "requester liveness", rests on own scope joining
    no room (`:92`). Under OD-16 A the requester holds `.view` at department scope, which joins the branch rooms
    (`apps/api/src/platform/realtime/realtime-rooms.ts:18-20, 29-34`), so the branch signal refreshes their register
    and record now. Criterion 6 states this, and PC-7 is left to approvers who hold `.approve` without `.view` (§10.1).
    *Rejected:* criterion 6 as the row words it, which describes an own-scope requester OD-16 A does not seed.
21. **A new refusal code for the unit lock**, `ADMINISTRATION_ITEM_UNIT_LOCKED` (422). Design §2.3.4 has the item
    edit refuse a unit change while a line names the item, but design §5.15 names only the posting's binding guard,
    409 `ADMINISTRATION_ITEM_UNIT_CHANGED`, a P5 code (`administration-module-design-flows.md:1465`). *Rejected:*
    `ADMINISTRATION_TRANSITION_BLOCKED` with a detail, since an item edit is not a transition; and the 409 code, which
    says a posting met an item whose unit had changed, a different fact.
22. **A draft is its requester's.** An edit, a submission and an attachment write on a draft also need
    `requesterUserId` to be the caller, else 403: the ownership check of the withdrawal (§7.4). The design gates them by
    key and Unit only (design §5.4 rows 1 and 2), so a second focal point of the department could rewrite a
    colleague's lines and then, holding `.approve` at a rung through the department manager's role (design §6.5, Lower
    rungs), decide the PR: pair A1 names the requester, the creator and the submitter, not an editor. With the check,
    the A1 set is one person in every round, and an earlier round's submitter is the requester too. A focal point who
    takes over a colleague's need raises a new PR, and the old one is withdrawn or cancelled. *Rejected:* adding every
    editor and every past submitter to the A1 set, which the document would have to track, and which changes OD-21 B's
    set; a further pair is the owner's to decide, each alone (`administration-module-decisions-and-phases.md:917-930`).

**D. Moved and corrected line pins** that P2's pull requests touch (no behavior changed; the counts they pin are in
§12.3):

- web `FRIENDLY` is `apps/web/src/shared/lib/errors.ts:8-307` (design §5.15 cites `:8-266`);
- the module's realtime rows are `apps/api/src/platform/realtime/realtime-registry.ts:245-259`, and `platform.approval`
  is classified at `:331-335`;
- the module's web rows are `apps/web/src/platform/realtime/invalidation-registry.ts:652-672`, and
  `ALL_REALTIME_KEY_PREFIXES` is at `:740`;
- the workforce reset's warehouses row is `apps/api/src/workforce-reset/targets.ts:245-255`; the integration
  `untouched` list is `apps/api/tests/integration/workforce-reset.spec.ts:223-246`, and its recruitment count is at
  `:363` (design §15.3.3 still pins 12);
- the navigation pins are `apps/api/src/seed-navigation.spec.ts:84` and
  `apps/api/tests/integration/auth-seed-login.spec.ts:40`, with the breakdown at `:299-308` and the groups at `:325`;
- corrected, not moved: the audit service's `recordMany` is `apps/api/src/platform/audit/audit.service.ts:251-273`.
  Design §10.1 cites `:229-274`, which starts at its doc comment (`administration-module-design-integration.md:499`);
  the file has not changed since `9efdcbd9`.

**E. The second drift check, on the engine PX-1 built** (2026-11-25, §3). It read `a4434d00`, PX-1.6's head, against
§1.2 A items 1–5 and 17, Terms, §4.4, §8, §10.2 and §12's engine-facing cases, and against how HR leave now hosts the
engine. Items 1 to 5 and 17 hold as written: the pin fields (`workflow.model.ts:74-86`), the audit option
(`request-type.registry.ts:37-43`), `chainFor`'s three statuses (`approval.service.ts:152-164, 540-562`), active
accounts and off-type keys, `decide`'s refusal keys (`:245-265`) and `currentApprovers` (`:310-317`). Where the code
differs from this re-detail:

23. **The decision's audit fields** (§10.2; §12.1). `auditChanges` is a list of `{ field, old: null, new }`
    (`approval.service.ts:283-294`): `decision`; `step`, the decided rung's index as a string; `level` and
    `permissionKey`, that rung's; `overriddenWith`, only on an override; and `covers`, only when the actor decides early
    from a rung of their own above the waiting rung, the indexes from the waiting rung to the rung below theirs,
    comma-joined (`decisionFor`, `approval-chain.ts:154-164`). An override never carries `covers`, and `covers` never
    names the empty rungs below the waiting rung, which the decision appends as `skipped` entries all the same
    (`entriesForDecision`, `approval-trail.ts:113-145`). This re-detail had named a `key` and "covered rungs". §10.2's
    row and the audit spec now use the engine's names and expect `overriddenWith` and `covers` only where the engine
    writes them; a reader who needs every rung a decision settled reads the PR's `approvalSteps`.
24. **The live rung can be read from the trail** (Terms; PRQ-2 (b); §11). `trailFor(subject, viewer).currentStep` is the
    live rung on a `pending` chain and the first unsettled rung on an `unstaffed` one, the same for every viewer
    (`approval.service.ts:181-214`; `rungToDecide`, `approval-trail.ts:89-96`). So a host reads the live rung wherever
    it holds an `AuthContext`, as a decision does; the sweep acts for nobody and holds none. Who holds a rung stays
    inside the engine (`approversFor`), and `currentApprovers` names the live rung's holders only, so §8.2 step 5
    stands. Terms and PRQ-2's evidence, which said the host could not tell the live rung, are corrected. The stuck
    audience is still chosen by the rungs left, counted from the first unsettled rung, in the decision's notice (P2.4)
    and in the sweep (P2.7) alike, as PRQ-2 (b)'s answer words it. The audience's organization-scope and whole-branch holders
    reach every rung left; a delegate confined to one department copy, or a holder barred by pair A1 or B1 (§8.4), may
    still be told of a rung they cannot decide, since the audience filters by key, scope and the PR's read only. It can
    leave out someone who can: when the empty rungs below
    a live rung held only by the A1 set include a `department` or `organization` rung, the audience is the organization
    one, although an override then decides the live rung alone, by its level, and those rungs are appended as `skipped`.
    *Rejected:* counting from `currentStep` in P2.4, an extra engine read per decision that the sweep cannot make, which
    would send one stop's notices to two audiences under one idempotency key (§11.2).
25. **Off `pendingApproval` the trail marks no rung** (§8.6; §12.2). Leave's `trailFor` returns the engine's trail with
    `currentStep: null` as well as the four fields this re-detail names (`leave-request.service.ts:701-711`): a
    cancelled request's chain still reads `pending` or `unstaffed` to the engine, and the panel marks "waiting here"
    from `currentStep` alone (`apps/web/src/platform/approvals/ApprovalChainPanel.tsx:61, 84-88`). This re-detail copied
    the four fields of PX-1's re-detail (`administration-module-phase-px1.md:362-371`), which leave's later fix for a
    cancelled request's panel extended (`46e1b345`, CHANGELOG "marks no rung as waiting"). §8.6 now clears `currentStep`
    too, and §12.2's cancel case checks that no rung is marked waiting. On an approved or rejected PR the engine already
    answers `currentStep` null.
26. **The subject maps the stored entries** (§8.1; §8.3 step 6). `DecidedEntry.deciderUserId` is a string or null
    (`approval-trail.ts:26-36`), while a PR's stored `ApprovalEntry` holds an ObjectId and two snapshots (design §2.1,
    `administration-module-design.md:735-738`). Leave's `subjectOf` maps each stored entry to the engine's six fields,
    the id as a string (`leave-request.service.ts:124-138`), and its append turns the returned ids back into ObjectIds
    (`:630-634`). Passed raw, the PR's entries would not typecheck, and `trailFor` would collect decider ids and look up
    their names by an ObjectId (`approval.service.ts:187-199`). The adapter maps them as leave does, for every call that
    passes a subject (§8.1), and the append converts back (§8.3 step 6).
27. **No rung has a caption** (§6.1; §8.6; §9.5; criterion 13). The chain screen writes none: a rung row offers a key
    select and a level select only, and Add step writes `{ permissionKey, level: 'unit', label: null }`
    (`apps/web/src/modules/system-admin/approvals/pages/ApprovalWorkflowsPage.tsx:327-379, 390`), as it did on
    `de38fd71`. The API accepts a caption (`packages/contracts/src/platform/approvals.ts:44-48`), but no screen or seed
    writes one. So every rung written at `/system/approvals` has none: every PR's `stepLabel` is null, the panel shows
    the level's name, and an archived round, whose entries store no level, has no rung name to show. P2 keeps the entry
    as design §2.1 fixes it, and P2.W1's earlier-rounds block names a rung by its `stepLabel` in the reader's language,
    else by its position, "Step n" / «الخطوة n», n being `stepIndex` plus one. *Rejected:* a level stored on each entry,
    a third snapshot in design §2.1's `ApprovalEntry` for a fallback; and a caption field in P2.0's chain editor, a
    platform screen change nothing asks for, after which a rung may still have no caption. P4's re-detail, whose PO
    paper reprints the rounds (design §2.1 note 6), may add the level, absence-safe. This is settled here as an
    engineering choice with its alternatives recorded; P2.W1's pull request shows it.
28. **The pin is written by an update** (§8.2 step 7). `approvalPinFields`' validator, which refuses an id with no
    rungs, runs only where Mongoose validates a document, at create and save; no update in ECMS runs validators
    (`workflow.model.ts:44-61, 74-86`). Leave pins inside its create, where it runs
    (`leave-request.service.ts:334-341`). P2 is the first host to pin through an update, the submission's conditional
    write, so that write alone keeps the two fields together: it sets `approvalWorkflowId` to an ObjectId of
    `pin.workflowId` and `approvalChainShape` to `pin.steps`, from one `pinOf` result. After §8.2 step 3, `pinOf` never
    returns null or an id without rungs (`approval.service.ts:119-127`).
29. **The audit option cannot be read back** (§12.1). `getApprovalRequestType` returns the type's DTO, and the audit
    mode is kept beside it (`request-type.registry.ts:25-28, 48-49`); `auditModeOf` is internal to the engine's folder
    (`:51-56`), and the barrel does not export it (`index.ts:13-17`). The module's isolation spec scans spec files too,
    `vi.mock` paths included, and refuses any platform path that is not a barrel
    (`administration-isolation.spec.ts:29-34, 83-92`). So `shared/approvals.spec.ts` checks the option by mocking the
    barrel and asserting `registerApprovalRequestType`'s second argument, `{ audit: 'host' }`, and P2.4's integration
    case, two `approvalDecision` rows and no `platform/approval` row, proves it end to end.
30. **A source scan reads the chain screen** (§12.3).
    `apps/web/src/modules/system-admin/system-admin-api-contract.spec.ts:444-543`, which PX-1.6 extended, reads
    `ApprovalWorkflowsPage.tsx` and pins how it builds a draft: `const emptyDraft = … => placed(`, exactly four
    `setDraft(placed(` calls, no `basedOn: null` and no `basisAt(` (`:508-520`); a `<field>:` for each field of the
    save's schema, `basedOn` included (`:479-506`); `APPROVAL_LEVELS.map` (`:527`) and `keysFor(draft.requestType).map`
    (`:538`). P2.0 changes the option labels of the three selects whose handlers hold three of those calls, and keeps
    every pinned string; §12.3 lists the spec among those that stay.
31. **Moved pins** (no behavior changed). PX-1 changed fourteen engine and contract files, HR leave's service and model,
    and the chain screen; these citations are re-pinned where they stand:
    - the engine: `progressOf`, `approval-trail.ts:48-49` → `:55-56` (Terms); `currentApprovers`,
      `approval.service.ts:226-233` → `:310-317` (item 17), which now reads the pinned chain through `chainOf` (`:312`);
      the registration, `request-type.registry.ts:17-20` → `:37-43` (§8.1); `setWorkflow`'s key check,
      `approval.service.ts:262-267` → `:342-361` (§9.1), which now also refuses an unregistered type (`:343-344`) and a
      key the type does not offer (`:351-356`), neither of which P2 meets, since its type offers `.approve`; the decider
      names, Arabic first, `:331-345` → `:585-600` (criterion 13); `DecideApprovalSchema`,
      `packages/contracts/src/platform/approvals.ts:184-189` → `:212-217` (§5);
    - HR leave: the registration, `leave-request.service.ts:65-71` → `:67-73`; the unplaced-login refusal, `:85-90` →
      `:87-92`; the Unit, `:101-111` → `:103-113` (item 13; §8.1); the conditional append, `:589-611` → `:619-641`
      (§8.3); PX-1's leave-trail paragraph, `administration-module-phase-px1.md:360-369` → `:362-371` (§8.6), and that
      file's other cited lines by two (`:198` → `:200`, `:765-817` → `:767-819`);
    - the chain screen (§3, the P2.0 row and note 1): the Arabic names, `ApprovalWorkflowsPage.tsx:91-92, 97-101, 260,
      282, 298` → `:102-103, 108-114, 275, 299, 317`; the rung keys, `:214, 323-327` → `:229, 342-346`. PX-1.6 also
      added the reader's `locale` (`:73`) and `errorMessage(save.error, locale)` (`:402-404`), which P2.0 can reuse;
    - the design: every citation of `administration-module-decisions-and-phases.md` past its §16.12 log moved three
      lines down when the owner's answers of 2026-11-25 were logged (`:1940-1942`).

Not drift, and kept as written: leave's append filter also carries `isDeleted: false` (`leave-request.service.ts:624`),
which §8.3's leaves out, since no PR is soft-deleted in P2; and `LiveChain.status` is typed with all five statuses
(`approval.service.ts:87-97`), while `chainFor` gives only the three of item 3.

## 2. What P2 needs from the owner

Nothing new for the phase itself: the defaults of §1.1 answer it. Four business questions arise, PRQ-1 to PRQ-4
below: two where OD-17 and OD-61 answer in outline only, one on when PRs are used in production, and one, raised in
this re-detail's review (§18), on what OD-21 B means for overrides. The owner answered all four on 2026-11-25 with their recommendations, «موافق على كل التوصيات، كمّل» (design §16.12); each question below names its answer. P2 did not wait for them. Under the owner's instruction of 2026-11-24, «بص اعمل انت الـ Recommendations من عندك دلوقتى وبعدين
نبقى نعدل» (design §16.12), the slice that carries each answer builds its recommendation, and the question goes to the
owner before that slice merges. Another answer to PRQ-1 changes the return alone (P2.4); to PRQ-2, the recipients of
the approved and stuck notices (P2.4, P2.7); to PRQ-3, when the PR roles are assigned in production, and no code; to
PRQ-4, pair B1's check alone (P2.4). Each
answer is recorded, dated and with the owner's words in «», in design §16.12's decision log, and its question here then
names it.

| Piece | Default | Otherwise |
|---|---|---|
| Exports | none in P2: design §14.5 gives the PR register's export as "client, on request" (`administration-module-design-integration.md:2502`), and no request had come by 2026-11-25 | the owner asks: PC-11 first moves Fleet's and IT's export code (the whole-catalog walk, the sheet writer, the report form and the export buttons) to `apps/web/src/shared/` (design §18.1), then a client Excel of the register under `.view`, in its own pull request after P2.W2 |
| Navigation sections | OD-62 A, sections later: one flat row | the owner wants the Procurement section now: P2.W1 adds it with the row (design §13.2) |

**Setup before the owner's acceptance** (steps, not decisions). Without them every submission is refused (§8.2).
Administrators grant `administrationPurchaseRequest.approve` "through a role assigned at that rung's scope" (design
§6.5), since no bundle is seeded for the unit, department or branch rungs, and write the chains at `/system/approvals`,
as for leave; the module adds no chain page (design §13.4 rule 6). Whoever is given `approval.override` for PRs also
needs `.view` or `.approve` at the same scope to open a PR (§8.6). An approver given `.approve` alone reaches PRs
through the notices, the record's breadcrumb to the module home and the home's awaiting-decision count (§9.2); giving
them `.view` at the same scope adds the register's sidebar row and the live refresh (§10.1). Criterion 15's staging run
starts from these.

### PRQ-1: lowered quantities on a returned request

- **Question.** When approvers have lowered quantities on a purchase request and the request is then returned to the
  requester for amendment, does the returned draft keep the lowered quantities, or go back to the quantities submitted
  in that round?
- **Evidence.** OD-17 (ii) lets an approver lower a line, never raise it, and keeps the cut as the line's
  `cancelledQty` (design §2.5, §5.4 row 3). OD-72 B's return sends the request back to draft, keeps its number and
  archives the round (design §5.2). Neither says what happens to a cut. A cut is an approver's act and a draft is the
  requester's to edit (§1.2 item 22), so a draft line carries no cut: the return must either fold the cut into the
  quantity or drop it. A line may be cut to nothing (§7.3), while a draft line's quantity is at least 1 (design §2.1,
  Quantities). Business users see no audit rows (OD-73's action log (i), design §10.5): the next round's approvers see
  the quantities as they stand and the archived round's decisions (§6.5).
- **Options.**
  1. Keep the lowered quantities (S). The return sets each line's quantity to what the approvers left and its cut to
     0, and removes a line cut to nothing. The return's audit row records each folded line's quantity before and after
     (§10.2). The requester may raise a quantity again before resubmitting, and the whole chain then decides again.
  2. Restore the submitted quantities (S). The return sets each cut to 0, so every line, a fully cut one included,
     comes back at the quantity submitted in that round. The cuts stay in the round's `approvalDecision` audit rows
     only.
- **Recommendation.** 1: the requester starts from what the approvers accepted, asks for more only by raising a
  quantity on purpose, and every raise goes through the whole chain again.
- **Answered** (2026-11-25, design §16.12): the recommendation, «موافق على كل التوصيات، كمّل».
- **Before the answer.** P2.4 builds option 1; option 2 changes the return alone. A PR returned before the answer
  keeps its folded quantities, and its return's audit row holds the quantities it had.
- **Arabic.** إذا خفّض المعتمِدون كميات في طلب شراء، ثم أُعيد الطلب إلى الطالب لتعديله، فهل تبقى الكميات المخفَّضة في
  الطلب المُعاد، أم تعود الكميات التي أرسلها الطالب في تلك المرة؟ (١) تبقى الكميات المخفَّضة، ويُحذف من الطلب البند
  الذي خُفّض بالكامل، ويجوز للطالب أن يرفع الكمية مرة أخرى قبل إعادة الإرسال، وعندها يبت في الطلب كل المعتمِدين من جديد؛
  وهذا ما نوصي به، لأن الطالب يبدأ مما قبله المعتمِدون، ولا يطلب أكثر منه إلا عن قصد. (٢) تعود الكميات التي أرسلها الطالب
  في تلك المرة، ويبقى التخفيض مسجَّلًا في سجل التدقيق فقط.

### PRQ-2: who in procurement is told, and who hears of a stuck request

- **Question.** (a) When a purchase request is approved, who in procurement is told? (b) When a request is left with
  nobody who can decide it, who is told?
- **Evidence.**
  - A notice goes to listed users, or to the holders of one key at organization scope or in one branch; a branch's
    holders include those at organization scope and the branch's delegates
    (`apps/api/src/platform/notifications/notification.service.ts:37-41, 67-74`;
    `apps/api/src/platform/rbac/rbac.service.ts:1438-1458`). The module can list the holders of two keys and send to
    those who hold both.
  - (a) OD-61 A tells "approvers, requester, keeper, procurement", and design §5.4 row 3 tells "requester and
    procurement" on approval. In P2 no key belongs to procurement alone: the procurement officer's bundle gains only
    `administrationPurchaseRequest.view`, which the auditor and the Administrative Affairs manager also gain, and the
    procurement manager's gains `.cancel` (design §6.5). Before P3, procurement can only read or cancel an approved PR
    in ECMS.
  - (b) Design §6.4 item 5 flags a stuck request "for OD-61's notice" without naming its readers. Its exits are a
    decision or a return by an override within reach, a cancel by a `.cancel` holder, or, while the round has no
    decision yet, the requester's withdrawal (design §5.2; §7.4). An override reaches a rung by the rung's level: one
    held at organization scope reaches every rung, one held over a branch only `unit` and `branch` rungs, and a
    `department` rung needs that department in every branch, which no branch audience addresses (ADR-041 decision 6).
    The daily sweep, which acts for nobody, cannot ask the trail which rung a stopped request waits on, only which rungs
    are left (Terms), and an override decides one rung at a time, so the audience is chosen by the rungs left, after a
    decision as in the sweep (§1.2 item 24). An override holder opens the record only with `.view` or `.approve` (§8.6).
- **Options.**
  - (a)
    1. The holders of `administrationPurchaseRequest.cancel` at organization scope, the procurement manager's key (S).
       The audience is a key, so anyone later given `.cancel` at that scope is told too; P3's re-detail replaces this
       audience with the RFQ creators' key.
    2. Every holder of `administrationPurchaseRequest.view` at organization scope (S): the auditors and the
       Administrative Affairs manager are told of approvals they take no part in.
    3. Nobody in procurement before P3 (S): procurement learns of an approved need only by reading the register.
  - (b)
    1. The `approval.override` holders who reach every rung left and can open the PR (S): when every rung left is a
       `unit` or `branch` rung, the PR's branch audience, which includes the organization-scope holders; otherwise the
       organization audience; in each case only those who also hold `.view` or `.approve` in that audience.
    2. Those, and the requester (S): the requester can act only while the round has no decision (a withdrawal), and is
       otherwise told why the request waits.
    3. Those, and the `.cancel` holders at organization scope (S), who can end the request.
- **Recommendation.** (a) 1: the procurement manager hears of each approved need, and nobody else is told of approvals
  they take no part in. (b) 1: the notice goes to the people who can open the request and decide it wherever it stopped,
  up to its last rung; the requester is told when it moves, and a cancel stays the procurement manager's choice from
  the register.
- **Answered** (2026-11-25, design §16.12): the recommendation, «موافق على كل التوصيات، كمّل».
- **Before the answer.** P2.4 builds (a) 1 and (b) 1; P2.7's sweep repeats (b) daily.
- **Arabic.** (أ) عند اعتماد طلب شراء، مَن يُبلَّغ في إدارة المشتريات؟ (١) مَن يملكون صلاحية «إلغاء طلبات الشراء» على
  مستوى الشركة، وهي صلاحية مدير المشتريات، ويحل محلهم في المرحلة الثالثة مَن يُنشئون طلبات عروض الأسعار؛ وهذا ما نوصي به،
  لأن مدير المشتريات يعرف بكل احتياج معتمد، ولا يُبلَّغ غيره بما لا شأن له به؛ (٢) كل من يملك صلاحية «عرض طلبات الشراء» على
  مستوى الشركة، ومنهم المراجعون الداخليون ومدير الشئون الإدارية، وهم لا شأن لهم بالاعتماد؛ (٣) لا يُبلَّغ أحد من المشتريات
  قبل المرحلة الثالثة، فلا يعرفون بالطلب المعتمد إلا من السجل. (ب) إذا توقف طلب لأنه لا يوجد من يستطيع اعتماده، فمَن
  يُبلَّغ؟ (١) مَن يملكون صلاحية التجاوز في الاعتماد ويستطيعون البت في كل المستويات المتبقية في الطلب، ويملكون أيضًا
  صلاحية فتح الطلب: أصحابها على فرع الطلب أو على مستوى الشركة إذا كانت المستويات المتبقية كلها مستوى الإدارة في الفرع أو
  مستوى الفرع، وأصحابها على مستوى الشركة فقط إذا بقي فيه مستوى الإدارة العامة أو مستوى الشركة؛ وهذا ما نوصي به، لأنهم
  من يستطيعون البت فيه حيثما توقف، حتى آخر مستوى فيه؛ (٢) هؤلاء، والطالب أيضًا، وهو لا يستطيع إلا سحب الطلب قبل أول
  قرار فيه؛ (٣) هؤلاء، ومدير المشتريات الذي يستطيع إلغاء الطلب.

### PRQ-3: purchase requests in production before orders exist

- **Question.** Are purchase requests used in the live system from P2, while ECMS cannot yet turn an approved request
  into a request for quotations (P3) or a purchase order (P4)?
- **Evidence.** Until P4 an approved PR's only exit in ECMS is a cancel (§7.4 row 8): the remainder cancel and the close
  move to P4 (§1.2 item 14), and RFQs arrive in P3 (design §18.2). P2 tells procurement of each approval (PRQ-2 (a)),
  so procurement buys outside ECMS meanwhile. A PR bought that way stays `approved` and `notOrdered`, so P3's
  awaiting-sourcing queue would list it as an open need (`ix_sourcing`, §6.1), which invites a second purchase;
  cancelling it instead reports a met need as cancelled. Who uses the module in production is set by role
  assignment, not by code (D-19; OD-80, `administration-module-decisions-and-phases.md:1852-1866`).
- **Options.**
  1. Not before P4 (S): P2 is accepted on staging (§16 criterion 15), and the PR roles are assigned in production when
     P4 ships, so every approved request can be ordered in ECMS.
  2. From P2 (S): procurement buys approved requests outside ECMS and cancels each one bought, with a reason that says
     so. The register then shows those as cancelled, and P3's re-detail decides how its queue treats requests approved
     before P3.
- **Recommendation.** 1: no request is approved in the live system without a way to order it there, and no need that
  was bought is reported as cancelled.
- **Answered** (2026-11-25, design §16.12): the recommendation, «موافق على كل التوصيات، كمّل».
- **Before the answer.** No code changes either way; the answer sets only when the PR roles are assigned in
  production.
- **Arabic.** هل نبدأ استخدام طلبات الشراء على النظام الفعلي من المرحلة الثانية، مع أن النظام لن يستطيع تحويل الطلب
  المعتمد إلى طلب عروض أسعار قبل المرحلة الثالثة، ولا إلى أمر شراء قبل المرحلة الرابعة؟ (١) لا، نجرّبها على نسخة الاختبار،
  ونعطي صلاحياتها على النظام الفعلي عند تشغيل أوامر الشراء في المرحلة الرابعة، فيكون لكل طلب معتمد طريق إلى أمر الشراء
  داخل النظام؛ وهذا ما نوصي به؛ (٢) نعم من المرحلة الثانية، وتشتري المشتريات الطلبات المعتمدة خارج النظام، ثم تلغي كل طلب
  تم شراؤه مع ذكر السبب، فيظهر في السجل ملغى لا مُشترى.

### PRQ-4: one override for several empty approval levels

- **Question.** When a purchase request waits on two or more approval levels that nobody holds, may one person with
  the override permission settle all of them, or must a different person settle each level?
- **Evidence.** OD-21 B, as adopted, keeps one person to one rung per round (pair B1) and binds override holders too
  (design §6.6, `administration-module-design-flows.md:1835`). An override settles one empty rung per decision
  (`docs/03-decisions/ADR-041-money-approvals-on-the-platform-engine.md:230-233`). Together, a PR whose last k rungs
  are empty needs k different override holders (§8.4). A chain has at most four rungs (OD-71 A), so k is at most three.
  The other ways out are an administrator giving the empty rung's key to someone, whom the engine counts at once
  (ADR-041 decision 4), and a cancel.
- **Options.**
  1. A different person for each level (S): pair B1 as adopted; nothing changes.
  2. One override holder may settle every empty level left (S): B1 stops binding an override's decision on a chain
     with no staffed rung left, which changes OD-21 B for that case; one person then approves one request at several
     levels.
- **Recommendation.** 1: the separation of duties the owner adopted holds for overrides too, and the case is rare and
  has two other ways out.
- **Answered** (2026-11-25, design §16.12): the recommendation, «موافق على كل التوصيات، كمّل».
- **Before the answer.** P2.4 builds option 1; option 2 changes pair B1's check alone.
- **Arabic.** إذا توقف طلب شراء عند مستويين أو أكثر من مستويات الاعتماد لا يشغلهما أحد، فهل يجوز لشخص واحد يملك صلاحية
  التجاوز في الاعتماد أن يبت فيها كلها، أم يجب أن يبت في كل مستوى شخص مختلف؟ (١) يبت في كل مستوى شخص مختلف، كما تقضي
  قاعدة الفصل بين المهام التي اعتمدتموها، ويمكن أيضًا إسناد المستوى الفارغ إلى أحد الموظفين أو إلغاء الطلب؛ وهذا ما
  نوصي به، لأن الحالة نادرة ولها طريقان آخران؛ (٢) يجوز لشخص واحد أن يبت في كل المستويات الفارغة المتبقية، فيعتمد
  شخص واحد الطلب في أكثر من مستوى.

## 3. Delivery plan: pull requests

Eleven code pull requests follow the docs pull request that carries this re-detail: one of platform prerequisites, seven
API slices, then three web slices, as Phase 1 cut its own (P1a.1 … P1b.W, design §19.1). Each API slice is contracts
plus API plus tests, each reviewed in its own pull request, and the web follows (design §18.4). The platform pull
request is never mixed with module code (design §18.1, §18.4).

Every pull request states its size and its CI minutes (RK-01, the 45-minute job, `.github/workflows/ci.yml:16`), its
table of existing tests and counts that change (RK-17; §12.3 lists them by slice), its CHANGELOG entry and a short
rollback note (RK-30, §15). CONTRIBUTING asks to split above about 500 changed lines (`CONTRIBUTING.md:53`); P2.2,
P2.3, P2.4, P2.W1 and P2.W2 exceed it, because a feature's coupled files travel together (design §18.4), and each says
why in its description.

**Dependencies outside the module.** P2's code waits for PX-1 to close (design §18.2's graph, PX-1 → P2,
`administration-module-decisions-and-phases.md:2189-2190`): PX-1.4 brings the pin fields P2.2's model spreads, PX-1.5
the audit option P2.3 registers with, and PX-1.6 the chain save P2's integration file writes through. PX-1 itself
waited for Phase 1 to close; the owner's instruction of 2026-11-25, «كمل وخلص P2 وأدمجها وأقف عندها», lets PX-1 and P2 run to their merge
with Phase 1's criterion 9 still owed (§1). PC-7, requester liveness from notices, is soft:
P2 ships without it (design §18.1; §1.2 item 20).

**A second drift check, on the merged engine.** This re-detail's drift check ran before the engine code P2 calls
existed. After PX-1.6 merges, a drift check reads the merged engine against §1.2 A items 1–5, item 17 and the calls of
§8: `chainFor`'s `status`, `pinOf`, `readApprovalPin`, `approvalPinFields`, the `{ audit: 'host' }` option, `decide`'s
`auditChanges` and refusal keys, and `currentApprovers` with a pin and on an `unstaffed` chain. A docs pull request of
its own carries it, with its entry in design §22 and any difference folded into this re-detail; it is reviewed and
merged before P2.0 opens. It ran on 2026-11-25, on `a4434d00`, PX-1.6's head before PX-1.6 merged (if PX-1.6
merges with a change to a file §1.2 E cites, those pins are read again before P2.0), and read HR leave's hosting and the
chain screen as well. It found the engine as §1.2 A describes it and asks for no engine change; its differences are
§1.2 E's items 23 to 31, folded into the sections each names.

| Pull request | Content | Depends on | Size |
|---|---|---|---|
| **P2.0** | Platform prerequisites. The audit verb `approvalDecision` in `AUDIT_ACTIONS`, with its rationale comment and its en and ar labels, "approval decided" and «البت في اعتماد», the catalog's wording (`packages/contracts/src/events/catalog.ts:872`). The approval panel, which shows the Arabic caption today, shows a rung's caption in the reader's language, else the level's name, which is what it shows in practice, since the chain screen writes no caption (§1.2 item 27), and drops the raw `permissionKey · level` line (`apps/web/src/platform/approvals/ApprovalChainPanel.tsx:76-79, 95-97`; note 1). The chain screen, which shows Arabic names today, names request types and places in the reader's language, in its list and in its editor's three selects (`apps/web/src/modules/system-admin/approvals/pages/ApprovalWorkflowsPage.tsx:102-103, 108-114, 275, 299, 317`), with the reader's `locale` it already reads (`:73`), and keeps every string its source scan pins (§1.2 item 30) | PX-1 closed (PX-1.6 edits the same page); deployed before P2.4 as §15 orders | about 250 |
| **P2.1** | Numbering and the item's kind. The yearly formatter and parser in contracts; the yearly series key and floor in `shared/document-number.ts`; `shared/cairo-day.ts`, a re-export of the contracts' Cairo calendar; items gain `stockTracked` (contract, model, service, DTO, audit snapshot). No key, route or page | PX-1 closed | about 350 |
| **P2.2** | Drafts. Keys `.view`, `.create`, `.edit` and `.approve`, and the page (§9.1); the model with every field of §6.1 and its indexes; `shared/lifecycle.ts` and the whole lifecycle table (§7); the register, the record, create, and draft edits that only the requester may make (§1.2 item 22); the item reads opened to `.create` for the picker, `activeFor` and the many-id item read exported; the item unit lock and its first registrant; the topic and its web row; audit `create` and `update`; the census rows of §6.4; the department requester bundle, `.view` in four bundles and `.approve` in the Administrative Affairs manager's (§9.3) | P2.1; PX-1.4 (the pin fields) | about 1,200 |
| **P2.3** | Submission. The adapter: registration with `{ audit: 'host' }`, the Unit, OD-19 A, the eligible-approver check, the remap; `POST /:id/submit`, the number and the pin; the approvers' notice and its template, and the seed-coverage spec; the event `.submitted`; criterion 8's contention script (§16) | P2.2; PX-1.5 | about 700 |
| **P2.4** | Decisions and returns. `POST /:id/decide` with OD-17's cuts, pairs A1 and B1, the conditional append and the after-commit `approvalDecision` row; `POST /:id/return`; `GET /awaiting-decision`; the trail on the detail (§8.6); the notices of §11.1; the race-test hook (`shared/test-hooks.ts`, §12.2); the events `.approved` and `.rejected`; the automation design's correction (§10.3) | P2.3; P2.0 deployed | about 950 |
| **P2.5** | Cancel and withdrawal. Key `.cancel`; `POST /:id/cancel` for rows 6–8; the current approvers' notice; the event `.cancelled`; `.cancel` in the procurement manager's bundle | P2.4 | about 350 |
| **P2.6** | Request attachments. The category `administration-request-attachments`, the `purchaseRequest` authorizer, the three routes, scan states on the detail | P2.2 | about 450 |
| **P2.7** | The daily sweep and the register's summary: the manifest's first scheduled task, with reminders and the stuck notice (§11.2), and `GET /summary` (§4.1, §6.5). They share a slice because neither waits on the other and together they come to about 400 lines; nothing in the web reads the sweep, and P2.W2's grouped counts read the summary | P2.4 | about 400 |
| **P2.W0** | Web: `ReferencePicker`, and Phase 1's `EmployeePicker` moved onto it with no change of behavior (§9.4), with the keeper picker's guard spec rewritten to read both files (§12.3). No P2 key, route or page, so a regression in the warehouse form is reviewed alone | PX-1 closed | about 300 |
| **P2.W1** | Web: the register, the record and the editor (§9.5); `ItemPicker` on `ReferencePicker`; the submit, decide, return and cancel dialogs; the approval panel on the record; the navigation row and its pins; the PR route in `ENTITY_ROUTES`, so notices open the record from this slice (§11.1); the module's error words | P2.W0; P2.2–P2.5; P2.0 | about 1,250 |
| **P2.W2** | Web: the awaiting-decision page; the attachments card; the home's tile and counts (§9.2); the register's grouped counts; the item form's kind | P2.W1; P2.6; P2.7 (the summary) | about 700 |

1. **Why the panel shows no key.** Its readers are requesters and approvers, who need not hold the permission
   catalog's key (`authorize('permission.view')`, `apps/api/src/platform/rbac/rbac.routes.ts:34`), and the trail gains
   no field (ADR-041 decision 3). *Rejected:* the key's catalog name, which needs that catalog read widened or a new
   trail field, and on a PR names the type's one key on every rung. The panel's override line keeps the key it
   records, `approval.override` (`ApprovalChainPanel.tsx:106-110`), one of the owner's four facts, which its spec pins
   (`ApprovalChainPanel.spec.tsx:172-182`); the chain screen keeps the rung keys an administrator configures
   (`ApprovalWorkflowsPage.tsx:229, 342-346`).

P2 closes when P2.W2 has merged, the exit criteria of §16 are met, and the owner is told.

## 4. API endpoints

Under `/api/v1/administration`; each route is `authenticate → authorize → validate → asyncHandler`, as Phase 1's are
(design §19.3). Every `:param` route validates its params, every write on an existing PR carries `version`, and lists
page at most 100 rows (design §19.3). The bodies are §5's schemas, all `.strict()`.

### 4.1 Routes

`purchase-requests` routes; literal segments sit before `/:id`.

| Method and path | Gate | Body or query | Slice |
|---|---|---|---|
| `GET /purchase-requests` | `administrationPurchaseRequest.view` | the list query (§5): `page`, `pageSize`; `sortBy` (`number`, `createdAt`, `submittedAt`, `neededBy`; default `createdAt`) and `sortDir` (default `desc`); `search`, the start of a number as typed, matched from its first character without regard to case (`PR-2026-00` finds every number that begins so); `status`, a comma-separated list (`listQuery`, `packages/contracts/src/common/index.ts:39-48`); `departmentIds`, a comma-separated list of department copies, at most 200, which only narrows: a copy outside the caller's reach adds no row and is not refused, because a company department picked in the filter sends every copy it has, other branches' included (`expandOrgUnitSelection`, `packages/contracts/src/platform/org-unit-groups.ts:100-110`; §9.4); `requesterUserId`; `from` and `to`, Cairo dates `YYYY-MM-DD`, both inclusive, bounding `createdAt` from `cairoDayStart(from)` to before the start of the day after `to` (`packages/contracts/src/common/cairo-date.ts:147-151`). `orderStatus` joins the filters in P4, when a line can first be ordered | P2.2 |
| `GET /purchase-requests/summary` | `.view` | the list's filters; answers `AdministrationPurchaseRequestSummaryDto` (§6.5), counts by status, by department copy and by Cairo month (design §14.5's grouping) | P2.7 |
| `GET /purchase-requests/awaiting-decision` | `.approve` | paging; every PR in the `APPROVAL_PENDING` set (`pendingApproval`) that the caller's `.approve` grant reaches, read through that key's scope selector (design §5.14, §13.4). It is not "mine to decide now": a holder whose own rung is already settled still sees the PR, as does a holder of a higher rung, who may decide early (ADR-041 decision 3); the record's panel says whether the reader may decide | P2.4 |
| `GET /purchase-requests/:id` | `authorizeAny(.view, .approve)` | — ; the detail DTO. Each key is tried with its own scope, `.view` first, and the first that finds the PR wins; `widestScopeSelector` is not used (design §11.3) | P2.2 |
| `POST /purchase-requests` | `.create` | `CreateAdministrationPurchaseRequestSchema` | P2.2 |
| `PATCH /purchase-requests/:id` | `.edit` | `UpdateAdministrationPurchaseRequestSchema` | P2.2 |
| `POST /purchase-requests/:id/submit` | `.create` | `SubmitAdministrationPurchaseRequestSchema { version }` | P2.3 |
| `POST /purchase-requests/:id/decide` | `authorizeAny(.approve, approval.override)` | `DecideAdministrationPurchaseRequestSchema` | P2.4 |
| `POST /purchase-requests/:id/return` | `authorizeAny(.approve, approval.override)` | `ReturnAdministrationPurchaseRequestSchema { version, reason }` | P2.4 |
| `POST /purchase-requests/:id/cancel` | `.view`; the service admits a `.cancel` holder or the requester's own withdrawal (§7.4) | `CancelAdministrationPurchaseRequestSchema { version, reason? }` | P2.5 |
| `POST /purchase-requests/:id/attachments` | `authorizeAny(.create, .edit)` | multipart: `file`, and `label` and `version` in `AddAdministrationPurchaseRequestAttachmentSchema` (Phase 1's supplier shape) | P2.6 |
| `DELETE /purchase-requests/:id/attachments/:attachmentId` | `authorizeAny(.create, .edit)` | `?version=`, `AdministrationPurchaseRequestAttachmentVersionQuerySchema` | P2.6 |
| `GET /purchase-requests/:id/attachments/:attachmentId` | `authorizeAny(.view, .approve)` | — ; the bytes, `private, no-store` (design §11.5) | P2.6 |
| `GET /items`, `GET /items/:id` | widened from `authorize('administrationItem.view')` (`catalog/items/item.routes.ts:29, 38`) to `authorizeAny('administrationItem.view', 'administrationPurchaseRequest.create')`, design §13.6 D's keys (`administration-module-design-integration.md:2213-2214`) | unchanged | P2.2 |

There are 13 purchase-request endpoints. None deletes a PR; the one `DELETE` removes a file's link (design §11.4).

### 4.2 What each write checks, in order

Every write on an existing PR loads it through the scope of its route's key. A route gated by two keys tries each
key's scope in turn, and the first that finds the PR wins, as the detail read does (§4.1); a miss under every key is
404. An edit, a submission, a `.cancel` holder's cancel and an attachment write then check that the act's key covers
the PR's Unit, `keyCoversUnit(ctx, key, branchId, departmentId)` (`apps/api/src/shared/types/index.ts:157-181`; 403);
a decision's reach is the engine's (§8.3), and a withdrawal's is the ownership check (§7.4). An edit, a submission and
an attachment write are also the requester's own: `requesterUserId` must be the caller, else 403 (§1.2 item 22). Then
come the status (422), the version (409) and the act's rules (422). This is the base repository's order, "this row may
never be written" before "someone else wrote it first" (`apps/api/src/shared/base/base.repository.ts:594-600`),
applied before the write too (§1.2 item 8). §4.4 lists every refusal with its details.

- **Create** (row 1). The requester is the caller's own employee, read through the platform directory
  (`getSelfDirectoryEmployee`, `apps/api/src/platform/directory/index.ts:419-422`), never through HR, and snapshotted
  by `people`'s `resolvePerson` (§6.1). A login with no employee, and an employee with no branch or no department, are
  refused 422 `ADMINISTRATION_TRANSITION_BLOCKED` (OD-16 A). An `exited` employee is refused 422
  `ADMINISTRATION_EMPLOYEE_EXITED`, the code Phase 1 gives a keeper who has left, since the fact is the same
  (`packages/contracts/src/errors/index.ts:716-722`; IT's exited test,
  `apps/api/src/modules/it/people/people.service.ts:258-272`); HR's exit suspends the login
  (`apps/api/src/modules/hr/employee-management/employee-actions/employee-action.service.ts:6-7`), so this is a
  backstop. `departmentId` is the employee's department copy, and `branchId` the branch that copy lies in, read through
  `departmentRepository.findById` (design §7.5); an employee whose own `branchId` is another branch is refused 422
  `ADMINISTRATION_TRANSITION_BLOCKED`, detail `placementMismatch`, because HR's record then disagrees with itself.
  `.create` must cover that Unit (403), and the top bar's choice must include that branch (400 `OUT_OF_REACH`,
  `narrowToBranch`, `apps/api/src/shared/base/branch-scope.ts:65-79`, as `warehouse.service.ts:189-194` applies it).
  `keyCoversUnit` reads the login's placement (`ctx.branchId`, `ctx.departmentId`), which HR sets to the employee's on
  every transfer (`employee-action.service.ts:652-669`); the integration harness sets both (§12.2). Every line's item
  must exist (404) and be active for a new reference (`activeFor`, `catalog/items/item-rules.ts:104-107`; 422
  `ADMINISTRATION_REFERENCE_INACTIVE` with the line's index). The server writes the snapshots of §6.1. Audit `create`.
- **Draft edit** (in-state, V). `.edit`, the requester's own; status `draft` (422
  `ADMINISTRATION_INVALID_TRANSITION`); version (409). `lines` replaces the list: a line sent with its `lineId` keeps
  its `_id`, a line sent without one is new, and a `lineId` the PR does not have is refused 422
  `ADMINISTRATION_TRANSITION_BLOCKED`, detail `unknownLine`. The create's item rules run on every new line and on every
  kept line whose `itemId` changed; a kept line naming the same item keeps it, retired or not (`existingReference`).
  Every snapshot is rewritten. Audit `update` through `diffChanges`, only if non-empty (design §10.2).
- **Submit** (row 2, T): §8.2.
- **Decide** (row 3, row 4, or in-state, A): §8.3.
- **Return** (row 5, C): §8.5.
- **Cancel** (rows 6–8): §7.4.
- **Attachments**: §4.3.
- **A requester moved after create.** The PR stays filed on its copy (§8.1). A requester moved to another copy no
  longer holds `.view` or `.edit` over the old one, so their own draft leaves their reach, and item 22 keeps colleagues
  from editing it: a `.cancel` holder ends it, and the requester raises a new PR from the new copy (P2-R17).

Every write is followed, after commit, by its audit row, then `signalPurchaseRequest(id, branchId)`, then its
notices through `.catch()`, then its event (design §5.1.2; §10, §11).

### 4.3 Request attachments (P2.6)

- **Category** `administration-request-attachments`: `application/pdf`, `image/jpeg`, `image/png`, `image/webp`
  (OD-76 formats (i)); 10 MB; `retentionDays: null` (OD-77 A); ensured in the seed before any upload, with a cached id
  that a `NotFound` drops, as the supplier papers do (`procurement/suppliers/supplier-files.ts:67-76, 277-300`;
  design §11.1–§11.2). The multipart cap is `multipartUpload(10)`: 15 MB (10 + 5), never above the deployment's
  `MAX_UPLOAD_MB` (`shared/file-upload.ts:19-28`).
- **Authorizer** `purchaseRequest`: read under `.view` or `.approve`; write under `.create` or `.edit`, by the
  requester only (§4.2) and only while the PR is a draft (`CONTENT_EDITABLE`), read on the same scoped `findById`. Each
  held key is tried with its own scope selector, the first that finds the PR winning (design §11.3). The platform's own
  file paths ask the write intent too, replace, update, archive, restore and delete among them
  (`docs/03-decisions/ADR-023-entity-derived-file-authorization.md:63-73, 160-169`), so after submission nobody changes
  the files the approvers read, through the module or through `/platform/files`. It does not opt into the separate
  delete intent, so a removal is asked as a write (`supplier-files.ts:83-98`).
- **List B**, design §11.4's typed list, editable only while the PR is a draft (OD-76 after submission (i)): an add's
  filter carries `status: 'draft'`, the version and the 20-entry bound, so two racing adds cannot both pass it
  (`administration.ts:112-120`); a full list answers 422 `ADMINISTRATION_ATTACHMENT_LIMIT`. A failed link write
  soft-deletes the new file (design §11.4), under the same write intent: if the requester's own submission lands
  between the upload and the link, that cleanup is refused and the file stays unlinked. Nothing lists it, since the
  list and the scan states read the links, and it is accepted. The link audits `update` with an `attachment`
  pseudo-field, and bumps `__v`, as the supplier's does.
- **No required file.** OD-76 A requires a file per quotation and evidence for write-offs, not a PR file, so the
  submission has no attachment gate.
- **Scan states** come from the linked files, read once per detail by entity and category (design §11.5). A file's
  read goes through `readEntityOwnedBuffer`, which keeps the platform's scan gate (design §11.5).

### 4.4 Refusals and available actions

Each refusal's `message` is English for the log; the web words it by code and detail (P2.W1's `lib/refusals.ts` and
`FRIENDLY`). `NotFoundError` carries no details (`apps/api/src/shared/errors/index.ts:45-49`).

| Act | When | HTTP · code | Detail `field` · `code` |
|---|---|---|---|
| any | the route's key is not held; the act's key does not cover the PR's Unit; an edit, submission or attachment write by anyone but the requester | 403 `FORBIDDEN` | — |
| any on a PR | no scope of the route's keys finds it | 404 `NOT_FOUND` | — |
| create | no employee; no branch or no department | 422 `ADMINISTRATION_TRANSITION_BLOCKED` | `requester` · `noEmployee`, `unplaced` |
| create | the employee has left | 422 `ADMINISTRATION_EMPLOYEE_EXITED` | `requester` · `exited` |
| create | the employee's branch is not their copy's | 422 `ADMINISTRATION_TRANSITION_BLOCKED` | `requester` · `placementMismatch` |
| create | the top bar excludes the PR's branch | 400 `VALIDATION_FAILED` | `branchId` · `OUT_OF_REACH` |
| create, edit | a line's item does not exist | 404 `NOT_FOUND`, message `lines[<i>]: item not found` | — |
| create, edit | a new line names a retired item | 422 `ADMINISTRATION_REFERENCE_INACTIVE` | `lines.<i>.itemId` · `inactive` |
| edit | a `lineId` the PR does not have | 422 `ADMINISTRATION_TRANSITION_BLOCKED` | `lines.<i>.lineId` · `unknownLine` |
| edit, submit, cancel, attachment write | the status does not allow the act | 422 `ADMINISTRATION_INVALID_TRANSITION` | `status` · the current status |
| decide, return | the status is not `pendingApproval`; the engine's `approvals.alreadyDecided` or `approvals.nothingToDecide` | 422 `ADMINISTRATION_APPROVAL_NOT_PENDING` | `status` · the current status |
| any write on a PR | the version moved | 409 `STALE_DOCUMENT` | — |
| submit | `submitProblem` (§8.2 step 2) | 422 `ADMINISTRATION_TRANSITION_BLOCKED` | `lines` · `noLines`; `lines.<i>.qty` · `notPositive`; `lines.<i>.itemId` · `itemMissing`, `itemInactive` |
| submit, decide, return | the copy no longer lies in the PR's branch (§8.1) | 422 `ADMINISTRATION_TRANSITION_BLOCKED` | `departmentId` · `copyMoved` |
| submit | OD-19 A (§8.2 steps 3–4) | 422 `ADMINISTRATION_APPROVAL_CHAIN_MISSING` | `approval` · `noChain`, `unstaffed`, `noEligibleApprover` |
| decide, return | pair A1 or B1 (§8.4) | 403 `ADMINISTRATION_SEPARATION_OF_DUTIES` | `actor` · `A1`, `B1` |
| decide, return | the engine's `approvals.notYourStep`; for a return, neither trail flag (§8.5) | 422 `ADMINISTRATION_APPROVAL_NOT_YOUR_STEP` | — |
| decide | a rejection without a comment | 422 `ADMINISTRATION_REASON_REQUIRED` | `comment` · `required` |
| decide | a cut above the open quantity; a cut on a line the PR does not have; cuts that leave nothing (§7.3) | 422 `ADMINISTRATION_TRANSITION_BLOCKED` | `cuts.<i>.qty` · `cutTooLarge`; `cuts.<i>.lineId` · `unknownLine`; `cuts` · `nothingLeft` |
| cancel | neither a `.cancel` holder over the Unit nor the requester; the requester on an approved PR | 403 `FORBIDDEN` | — |
| cancel | the requester's withdrawal after the round's first entry | 422 `ADMINISTRATION_TRANSITION_BLOCKED` | `approvalSteps` · `decided` |
| cancel | no reason where §7.4 requires one | 422 `ADMINISTRATION_REASON_REQUIRED` | `reason` · `required` |
| attachment add | the list holds 20 entries | 422 `ADMINISTRATION_ATTACHMENT_LIMIT` | `attachments` · `limit` |
| item edit | a checker answers that a PR line names the item (§6.2) | 422 `ADMINISTRATION_ITEM_UNIT_LOCKED` | `unitId` · `purchaseRequestLine` |

`noEligibleApprover`'s words name its three remedies (§8.2 step 4).

**Available actions.** The detail's `availableActions` holds one `AdministrationAvailableActionDto
{ key, permission, enabled, reason }`, recruitment's shape
(`packages/contracts/src/modules/hr-recruitment-workflow.ts:355-360`), for each act below whose row starts at the
PR's status (§7) and whose key the caller holds; `withdraw` is listed for the requester. It is computed from the whole
table, the pairs and the trail's flags.

| `key` | Rows | `permission` | `enabled` when |
|---|---|---|---|
| `edit` | in-state, `draft` | `.edit` | the caller is the requester |
| `submit` | 2 | `.create` | the caller is the requester |
| `decide` | 3, 4, in-state | `.approve` when the trail's `viewerMayDecide`, else `approval.override` | `viewerMayDecide` or `viewerMayOverride`, and the pairs pass |
| `return` | 5 | as `decide` | as `decide`, with pair A1 only |
| `cancel` | 6, 7, 8 | `.cancel` | the key covers the PR's Unit |
| `withdraw` | 6, 7 | `.view` | the caller is the requester, and on row 7 the round has no entry |

`reason` is null when `enabled` is true, else one of `notRequester`, `notYourStep` (neither trail flag),
`separationOfDuties`, `decided` (a withdrawal after the round's first entry) and `outOfReach` (the key does not cover
the Unit). Attachment writes are not acts of the table: the record offers them while the PR is a draft and the caller
is its requester.

## 5. Contracts

| File | P2 adds |
|---|---|
| `packages/contracts/src/modules/administration.ts` | `ADMINISTRATION_DOCUMENT_KINDS = ['purchaseRequest']`, their prefixes (`PR`) and `ADMINISTRATION_DOCUMENT_DIGITS = 6`; `formatAdministrationNumber(kind, year, seq)` and `parseAdministrationNumber(number)`, which read only the formatter's own spelling, as the master-code pair does (`:38-68`); `ADMINISTRATION_MAX_DOCUMENT_LINES = 100`; `AdministrationAvailableActionDto { key, permission, enabled, reason }`, recruitment's shape (design §5.1.4); `ADMINISTRATION_ITEM_UNIT_LOCKS = ['purchaseRequestLine']`, the unit-lock checkers' answers (§6.2); `AdministrationEvents`, one flat `as const` with the four P2 names, and their `…PayloadV1` schemas (§10.3); `AdministrationTemplates`, the template keys of §11.1, HR leave's shape (`packages/contracts/src/modules/hr-leave.ts:554-564`); `ADMINISTRATION_REQUEST_ATTACHMENTS_FILE_CATEGORY` and its MIME list |
| `packages/contracts/src/modules/administration-procurement.ts` | `ADMINISTRATION_PURCHASE_REQUEST_STATUSES` (six) and `…_ORDER_STATUSES` (three); the guard sets `PR_SOURCEABLE`, `APPROVAL_PENDING`, `CONTENT_EDITABLE` and `PR_CANCELLABLE`, each a `Readonly<Record<status, boolean>>` (design §5.14); `CreateAdministrationPurchaseRequestSchema { neededBy?, justification?, notes?, lines }`, each line `{ itemId, qty, notes? }`, 0 to 100 lines, `qty` an integer from 1 to 1,000,000 (design §2.1, Quantities), `neededBy` a `YYYY-MM-DD` date (`isYmd`, `packages/contracts/src/common/cairo-date.ts:89`), past dates allowed, since a returned draft may carry one; `UpdateAdministrationPurchaseRequestSchema` with `version`, `null` clearing a field and `lines` replacing the list, each line `{ lineId?, itemId, qty, notes? }` (§4.2); `SubmitAdministrationPurchaseRequestSchema { version }`; `ListAdministrationPurchaseRequestsQuerySchema`, `PaginationQuerySchema` extended with §4.1's filters, `status` as `listQuery(status)` and `departmentIds` as `listQuery(objectId(), 200)`; `ADMINISTRATION_PURCHASE_REQUEST_ACTIONS` and `…_ACTION_REASONS`, §4.4's keys and reasons; `DecideAdministrationPurchaseRequestSchema`, the platform's `DecideApprovalSchema` (`packages/contracts/src/platform/approvals.ts:212-217`) plus `version` and `cuts?: { lineId, qty }[]`, at most 100 with distinct `lineId`s, each `qty` an integer from 1 to 1,000,000 that the service bounds by the line's open quantity (§7.3), refusing cuts on a rejection; `ReturnAdministrationPurchaseRequestSchema { version, reason }` and `CancelAdministrationPurchaseRequestSchema { version, reason? }`, a reason being 1 to 1,000 characters; `AddAdministrationPurchaseRequestAttachmentSchema` and `AdministrationPurchaseRequestAttachmentVersionQuerySchema`, as the supplier's (`administration-procurement.ts:100-117`); the list, detail, summary and attachment DTOs (§6.5) |
| `packages/contracts/src/modules/administration-catalog.ts` | `stockTracked` on the item create (default `true`), update and DTO (`:223, 254, 270`); the item list's `stockTracked` filter is not added |
| `packages/contracts/src/errors/index.ts` | eight codes, the seven of design §5.15 and one more: `ADMINISTRATION_INVALID_TRANSITION`, `…_TRANSITION_BLOCKED`, `…_REASON_REQUIRED`, `…_APPROVAL_CHAIN_MISSING`, `…_APPROVAL_NOT_PENDING`, `…_APPROVAL_NOT_YOUR_STEP` (422) and `…_SEPARATION_OF_DUTIES` (403); and `ADMINISTRATION_ITEM_UNIT_LOCKED` (422, §1.2 item 21). Each ships in the slice that first raises it, with its doc comment naming its details (§4.4). An exited requester reuses Phase 1's `ADMINISTRATION_EMPLOYEE_EXITED`, whose comment gains the PR's case |
| `packages/contracts/src/events/catalog.ts` | `ADMINISTRATION_EVENT_PAYLOAD_SCHEMAS`, `ADMINISTRATION_EVENT_SOURCE` appended to `buildEventCatalog` (`:1486-1492`), `EVENT_MODULE_NAMES.administration` (`:657-664`) and the entity word `purchaseRequest` (design §8.3). Every action word exists |
| `packages/contracts/src/platform/notification-target.ts` (P2.W1) | `'administration/purchaseRequest': (id) => '/administration/purchase-requests/' + id` in `ENTITY_ROUTES` (`:36-42`), in the slice that mounts the route, since every entry must be a route the client declares (`:33-34`); until then a PR notice opens the inbox (`:56-57`) |
| `packages/contracts/src/platform/audit.ts` (P2.0) | `approvalDecision`, appended after `applicantFolderDeleted` (`:214`) with its rationale comment |

`packages/contracts/src/index.ts` needs no new line: the four administration files are exported (`:82-85`). The
contracts gain no settings key and no notification category (OD-61 A).

## 6. Data model

### 6.1 `administration_purchase_requests`

The common fields of design §2.1: `baseFields`, `timestamps` and `__v`.

| Field | Type | Written | Notes |
|---|---|---|---|
| `number` | string \| null | the first submission | `PR-2026-000001`; kept by a return and on every terminal status (OD-58 A) |
| `status` | enum, six values | every transition | default `draft` |
| `orderStatus` | `notOrdered` \| `partiallyOrdered` \| `fullyOrdered` | create | `notOrdered` through P2: only P4's claims move it (design §5.12) |
| `branchId`, `departmentId` | ObjectId | create | the requester's department copy and the branch it lies in (design §7.5; §4.2); the repository's scope fields |
| `requesterUserId` | ObjectId | create | the caller; the repository's owner field |
| `requesterEmployeeId`, `requesterName` | ObjectId, string | create; the name rewritten on every draft save | the directory's `employeeId` and `fullNameAr` (D-22) |
| `requester` | `PersonSnap` | the same | `employeeCode`, `jobTitle`, `departmentId` (reference-only), `departmentName`, from `resolvePerson` |
| `branch` | `BranchSnap` | the same | `code`, `name`, from `branchSnap` |
| `neededBy` | Date \| null | create, draft edit | a Cairo date at UTC midnight |
| `justification`, `notes` | string \| null | create, draft edit | at most 2,000, the catalog's `notes` bound (`administration-catalog.ts:221`) |
| `businessDate` | Date \| null | the first submission | its Cairo date (`cairoCalendarDate`, `packages/contracts/src/common/cairo-date.ts:106`); the number's year |
| `lines` | array, 0 to 100 | create, draft edit; counters by decisions | `{ _id, itemId, itemCode, itemName, unitName, unitId, qty, orderedQty, cancelledQty, notes }`; `unitId` is the item's, never the client's (OD-07); `orderedQty` stays 0 in P2; line `notes` at most 500 |
| `attachments` | list B (design §11.4) | P2.6 | `{ attachmentId, fileId, categoryKey, label, fileName, mime, size, addedByUserId, addedAt }` |
| `approvalRequestType` | string \| null | each submission | `administration.purchaseRequest` |
| `approvalWorkflowId`, `approvalChainShape` | the spread of `approvalPinFields` | each submission; cleared by a return | ADR-041 decision 4 |
| `approvalSteps` | `ApprovalEntry[]` | each decision | the engine's entries, `deciderUserId` stored as an ObjectId (§8.1), plus `stepLabel`, the rung's caption from the pin, null when the rung has none, as no rung written at `/system/approvals` has one today (§1.2 item 27), and `deciderName`: the two snapshots design §2.1 fixes in `ApprovalEntry` for every approval host (`administration-module-design.md:735-738`). On the current round the record shows `trailFor`'s captions and names (§8.6). A return clears the PR's pin, and `trailFor` does not read archived rounds, so the two snapshots are what the record shows of `approvalRounds`; P4's PO paper reprints them (design §2.1 note 6). Their cost is RK-34 (§6.4) |
| `approvalRounds` | `{ round, endedBy: 'returned', at, steps }[]` | each return | design §5.2, Rounds; `round` is 1 for the first round a return archives and one more for each later one, so it is the entry's position plus one |
| `submittedBy`, `submittedAt` | ObjectId, Date | each submission | design §2.1 note 4 |
| `approvedAt` / `approvedByUserId`, `rejectedAt` / `rejectedByUserId` | Date, ObjectId | the settling decision | the rejection's reason is its entry's `comment` |
| `returnedAt` / `returnedByUserId`, `returnReason` | Date, ObjectId, string | the latest return | earlier ones are in the audit trail |
| `cancelledAt` / `cancelledByUserId`, `cancelReason` | Date, ObjectId, string \| null | the cancel | the reason is null only on a cancelled unnumbered draft |

**Snapshots.** `ItemSnap` (`itemCode`, `itemName`, `unitName`), `PersonSnap` and `BranchSnap` are design §2.1's
shapes (`administration-module-design.md:725-732`). They are rewritten from live data on every draft save and once
more by each submission, and frozen from then on (design §2.1, Snapshots). Each has one builder, owned by the row it
copies (design §3.5, `administration-module-design.md:1674-1676`):

- `resolvePerson(employee: DirectoryEmployee): Promise<{ name: string; snap: PersonSnap }>` in
  `people/people.service.ts`, exported by `people/index.ts`: design §3.5's copy of IT's `readReceiptHolder`
  (`apps/api/src/modules/it/assets/receipt-holder.ts:55-81`) without its identity-facts call. `name` is the
  directory's `fullNameAr`; `employeeCode` its `code`; `jobTitle` and `departmentName` the localized names that
  `jobTitleRepository` and `departmentRepository` (`platform/organization`) hold for its `jobTitleId` and
  `departmentId`, each null when the id is null or names no row, as `receipt-holder.ts:46-53` reads them. It never
  refuses; the create's refusals come before it (§4.2).
- `branchSnap(branchId): Promise<BranchSnap>` in `procurement/purchase-requests/purchase-request-snapshots.ts`, over
  `branchRepository` (`platform/organization`): the branch's `code` and `name`.
- `itemSnapsOf(itemIds)` in `catalog/items/item.service.ts`, exported by its index: one `findByIdsSystem` read of the
  items, unfiltered (`apps/api/src/shared/base/base.repository.ts:303`), and the unit names through the service's
  existing `labels` (`item.service.ts:123-127`), giving each item's `{ item, snap }`; an unknown id is absent, which
  §4.2 refuses 404. Localized snapshots are plain nested objects, as an item's `name` is
(`catalog/items/item.model.ts:42`). `deciderName` is the decider's Arabic display name at the decision
(`apps/api/src/infrastructure/http/request-context.ts:14-18`; `apps/api/src/shared/types/index.ts:78`), null on an
entry nobody decided.

**Indexes:**

- `ux_number`, unique, partial on `{ number: { $type: 'string' } }`: drafts never collide and a number is never reused
  (design §2.1, Indexes). RK-04, the risk of wrong index options on documents numbered after draft, asks for the
  options to be "reviewed once before P2"; this list is what that review reads, in this re-detail's design review
  (§18);
- `ix_branch_status_created { branchId, status, createdAt: -1 }`, `ix_department_status { departmentId, status }`,
  `ix_requester_created { requesterUserId, createdAt: -1 }`;
- `ix_sourcing { status, orderStatus }`, which serves P2's sweep (status first) and P3's awaiting-sourcing queue.

The model joins `administrationModels` (`administration-indexes.ts:22-31`), so the seed builds its indexes first, and
the repository awaits `collectionReady` before its first write and before every transaction that writes it (D-16,
RK-03; design §2.1 note 10). No index carries `departmentId` with uniqueness (design §7.7).

### 6.2 Items (P2.1, P2.2)

- **`stockTracked`** (OD-14 C): `boolean`, default `true`, so a row written before P2.1, which lacks the field, reads
  as a stock item, today's behavior (design §2.3.4). Set on create and edit by the master-data desk. It changes no
  rule in P2: nothing posts stock before P5, where a non-stock line posts no movement (design §2.6, the GRN row). The
  item audit snapshot carries it. Reads are `.lean()` (`apps/api/src/shared/base/base.repository.ts:277-283`), which
  applies no schema default, so the item DTO mapper (`administration.mappers.ts`) and the audit snapshot read
  `stockTracked ?? true`.
- **The unit lock.** `catalog/items/item-unit-lock.ts` owns a registry written as the warehouse's is
  (`warehouses/warehouses/warehouse-holds.ts:16-34`): `ItemReferenceChecker = (itemId: string) =>
  Promise<AdministrationItemUnitLock | null>`, `registerItemReferenceChecker(checker)` and `itemUnitLocks(itemId)`,
  which answers each lock once, in `ADMINISTRATION_ITEM_UNIT_LOCKS`' order (§5). The PR feature registers at module
  load, in `procurement/purchase-requests/purchase-request-item-lock.ts`, a checker that answers
  `purchaseRequestLine` when a PR line names the item, in any status except a cancelled draft that never took a
  number: such a draft had no effect, and a draft re-reads the item's unit on every save, so an abandoned one does not
  fix a wrong unit for ever. An item edit that changes `unitId` asks the checkers first and is refused 422
  `ADMINISTRATION_ITEM_UNIT_LOCKED` when one answers (§4.4). It is a hint, read outside the write; P5's posting is the
  binding guard (design §2.3.4). The check scans `lines.itemId` with no index; its only caller in P2 is an item edit
  that changes the unit.
- **Exports.** `catalog/items/index.ts` adds `activeFor as itemActiveFor`, `itemSnapsOf` (§6.1) and the registry's
  two functions.

### 6.3 Numbering

| Series | Counter key | Taken | Floor |
|---|---|---|---|
| `PR-{YYYY}-{seq:6}` | `purchaseRequest:{YYYY}` | the first submission, as the transaction's first write (`nextNumber`, `shared/counter.model.ts:42-43`) | the highest number of that year's prefix, in the formatter's spelling only, grouped by length, as the master codes' floor is (`shared/document-number.ts:47-70`), through a new pair beside it |

- `{YYYY}` is the Cairo year of the submission's `businessDate`, computed once from one instant for both the key and
  the field (OD-57 A; RK-13); `shared/document-number.spec.ts` pins the year turning at Cairo midnight.
- `ensureCounter(key, floor)` runs before the transaction (`shared/counter.model.ts:32-35`). The floor matters only
  when a counter row is missing, after a restore without the counters or a dropped row: the counter then comes back at
  the highest number used, never at 0. Only the server writes PR numbers; the formatter-spelling rule is the master
  codes' (`shared/document-number.ts:8-16`), kept so the module has one floor read and a number written outside the
  server, by an operator's hand fix, cannot floor the series wrongly. The seed also ensures the current year's
  counter, as it does the code counters (`administration.seed.ts:35-44`).
- A refused submission rolls its increment back, so the series has no gap (`apps/api/src/shared/base/counter.ts:7-12`).
  A returned PR keeps its number, and its next submission takes none.
- Width: six digits; a number past them grows wider with no leading zero, as the master codes do
  (`packages/contracts/src/modules/administration.ts:24-28`).
- The floor read. `highestCodePipeline` and `floorFrom` read the `code` field and master codes
  (`shared/document-number.ts:52-70`), so `shared/document-number.ts` adds `DocumentNumberSeries { kind, year, key,
  prefix }`, `highestNumberPipeline(series)` and `numberFloorFrom(series, rows)`. The pipeline's `$match` reads
  `number: { $type: 'string', $regex: '^PR-2026-(?:[0-9]{6}|[1-9][0-9]{6,})$' }`, the `$type` being `ux_number`'s
  partial filter, so the planner can use that index; the floor parses with `parseAdministrationNumber` and counts a
  number of another kind or year as none.

### 6.4 Census rows

The workforce reset removes the employees and their records so that HR can load them again. Every collection with an
`*employeeId*` path is classified: `purge` removes its rows, `keep` writes nothing to it
(`apps/api/src/workforce-reset/targets.ts:16-39`). Its integration spec pins the exact list of kept collections, which
its report calls untouched, and that list's length when the reset also empties recruitment, which moves
`hr_job_offers` out of it: the recruitment count (`apps/api/tests/integration/workforce-reset.spec.ts:223-246`,
`:363`). On every `keep` collection, HR's permanent delete («مسح نهائي») rewrites a purged person's name copies, path
by path (design §2.1, Workforce reset).

| Census | P2's rows | Pins that change |
|---|---|---|
| The workforce reset (`/employeeid/i`, `apps/api/src/workforce-reset/targets.ts:23`) | `administration_purchase_requests: keep`, "a need and a spending decision that later documents cite" (OD-64 A; design §15.3.3) | `targets.spec.ts:76-91` gains the collection; the integration `untouched` list (`workforce-reset.spec.ts:223-246`) gains it first, and the recruitment count (`:363`) changes (§12.3) |
| HR's permanent delete (`/name$/i`, `apps/api/src/modules/hr/employee-management/employees/employee-name-copies.ts:32`) | `requesterName`: `scrub`, by `requesterEmployeeId` (employee); `approvalSteps.deciderName`, `approvalRounds.steps.deciderName` and `attachments.fileName`: `leave` | `employee-name-copies.spec.ts:43-60` gains `administration_purchase_requests.requesterName <- requesterEmployeeId`, and the copy count changes (§12.3) |

The walker tests every key of a schema's `paths` against `/name$/i`, whatever its type, and recurses into every path
that carries a `.schema`, subdocument arrays and single nested subdocuments alike (`employee-name-copies.ts:201-218`).
The localized snapshots are declared as plain nested objects (§6.1), so Mongoose lists their leaves, such as
`lines.itemName.ar` and `requester.departmentName.en`; those end in `.ar` and `.en`, and need no row. Declared as a
subschema, `itemName` or `departmentName` would match themselves and need one, which is why §6.1 fixes the plain
declaration. A `scrub` inside an array is refused (`:250-261`), so `deciderName` stays `leave`. That is RK-34, a
deleted person's name kept inside an approval trail: the recorded cost of the two snapshots (§6.1). The HR file's edit
travels in P2.2, reviewed by HR's owner (design §18.1). The org-catalog merge sweeps `departmentId` and
`requester.departmentId` by name (design §7.7); neither sits in an array.

### 6.5 DTOs

- **List row:** `id`, `number`, `status`, `orderStatus`, `branchId` and `branchName` (the `branch` snapshot's name),
  `departmentId` and `departmentName` (the `requester` snapshot's), `requesterUserId`, `requesterName`, `neededBy`,
  `lineCount`, `submittedAt`, `createdAt`, `version`. The names are the PR's own snapshots, so a page reads no other
  collection. Lists carry no trail (design §5.1.4).
- **Detail:** the row, plus `justification`, `notes`, `businessDate`, `requester`, the lines with their snapshots and
  counters, the attachments with `scanStatus`, `approvalTrail: ApprovalTrailDto | null` (§8.6: null whenever the PR
  holds no pin), `approvalRounds` as stored, the stamps and reasons of §6.1, and `availableActions` (§4.4).
- **Summary:** `AdministrationPurchaseRequestSummaryDto { total, byStatus: { status, count }[], byDepartment: {
  departmentId, name, count }[], byMonth: { month, count }[] }` for the filtered set, where `name` is the copy's
  localized name, read through `departmentRepository`, and `month` the `YYYY-MM` of `createdAt`'s Cairo date, the date
  the list's `from` and `to` bound. The rows group by copy; the web folds the copies of one company department together
  with `orgUnitGroupKeys`, as its filter does (§9.4). Fleet's custody list with its `/summary` is the precedent
  (`apps/api/src/modules/fleet/custody/custody.routes.ts:14-16`).

## 7. State machine

Design §5.4 is frozen, and P2's table keeps its nine edges and their conditions, in
`procurement/purchase-requests/purchase-request-lifecycle.ts` with `submitProblem`, `cancelProblem`, `closeCondition`
and `orderStatusOf`, over `shared/lifecycle.ts` (design §5.16). Its Key column adds `approval.override` to rows 3 to 5,
where design §5.4 gives `.approve` only (`administration-module-design-flows.md:892-894`): the override stands in for
the approve key within its reach (§1.2 item 19; ADR-041 decision 6). The whole table ships in P2.2, and specs 1–8 read
it whole. Spec 5, "every non-system action maps to one key, and that key is declared in the manifest"
(`administration-module-design-flows.md:1543`), meets `.cancel` before P2.5 declares it, so its case carries a list of
keys not yet declared, `['administrationPurchaseRequest.cancel']`, which P2.5 empties and removes. The **Conc.** column
is the concurrency class (Terms; design §5.1.3).

| # | Edge | Key | Conc. | In P2 |
|---|---|---|---|---|
| 1 | — → draft | `.create` | — | P2.2 |
| 2 | draft → pendingApproval | `.create` | T | P2.3 |
| 3 | pendingApproval → approved | `.approve`, or `approval.override` (§8.3) | A | P2.4 |
| 4 | pendingApproval → rejected | `.approve`, or `approval.override` (§8.3) | A | P2.4 |
| 5 | pendingApproval → draft | `.approve`, or `approval.override` (§1.2 item 19) | A | P2.4 |
| 6 | draft → cancelled | `.cancel`, or the requester's withdrawal | V | P2.5 |
| 7 | pendingApproval → cancelled | `.cancel`, or the requester's withdrawal before a decision | C | P2.5 |
| 8 | approved → cancelled | `.cancel` | C | P2.5 |
| 9 | approved → closed | system | T | in the table; performed from P4 (§1.2 item 14) |

The detail's `availableActions` (§4.4) is computed from the whole table, so from P2.2 to P2.4 it can list an act whose
route a later slice mounts. No screen reads it before P2.W1, which follows P2.5, so no reader is offered such an act.

### 7.1 Guard sets

| Set | Members | Used in P2 by |
|---|---|---|
| `PR_SOURCEABLE` | approved | nothing yet (P3, P4) |
| `APPROVAL_PENDING` | pendingApproval | decide, return, the awaiting-decision read, the sweep |
| `CONTENT_EDITABLE` | draft | the repository's `writeConditions()` (design §5.1.4), attachment links |
| `PR_CANCELLABLE` | draft, pendingApproval, approved | cancel |

### 7.2 Rejection and return

- A rejection is final (OD-72 B). Its reason is required (design §5.1.2 item 5) and is the decision's `comment`: a
  `rejected` decision with an empty comment is refused 422 `ADMINISTRATION_REASON_REQUIRED`. `DecideApprovalSchema`
  keeps `comment` optional for approvals.
- A return moves `pendingApproval → draft`, keeps the number, archives the round and clears the pin (§8.5).

### 7.3 Lowering (OD-17 (ii))

- A decision of `approved`, at any rung, may carry `cuts`. Each `{ lineId, qty }` removes `qty` from that line's open
  quantity (`qty − cancelledQty`) by adding it to `cancelledQty`. OD-17 (ii) lets "an approver" lower a line, and the
  material request's (MR, P6) twin rule says "a reduction at the decision"
  (`administration-module-design-flows.md:1155`), so an intermediate rung may cut too.
- **Bounds.** A cut's `qty` is the amount removed: an integer from 1 to the line's open quantity, so a cut only lowers
  a line, and may bring its open quantity to 0. A decision cuts a line at most once. The contract bounds the list and
  each `qty` (§5); the service refuses a cut above the line's open quantity, or one naming a line the PR does not have,
  422 `ADMINISTRATION_TRANSITION_BLOCKED` with the cut's index and the detail `cutTooLarge` or `unknownLine`.
- A cut that would leave no open quantity on any line is refused 422 `ADMINISTRATION_TRANSITION_BLOCKED`, detail
  `nothingLeft`. Such a PR could never be sourced, and its close runs only inside a PO act or a remainder cancel (row
  9), so it would wait in `approved` for ever. The approver rejects it instead.
- A cut is written in the decision's own conditional append (§8.3), with `arrayFilters` on the line ids; `orderStatus`
  stays `notOrdered`, because `orderStatusOf` answers it whenever nothing is ordered.
- The audit row carries the cuts as `cuts [{ itemCode, qty }]` (§10.2).
- A return folds the cuts into the quantities (PRQ-1, option 1): each line's `qty` becomes its open quantity and its
  `cancelledQty` 0, and a line left at 0 is removed, so every line of a returned draft is at 1 or more; the
  `nothingLeft` rule leaves at least one line. The return's audit row records each folded line (§10.2).

### 7.4 Cancel and withdrawal (P2.5)

The route is gated by `.view`; the service picks the row from the status and the authority from the caller:

| Status | A `.cancel` holder whose key covers the PR's Unit (`keyCoversUnit`, §4.2) | The requester (`requesterUserId` = the caller) | Reason | Conc. |
|---|---|---|---|---|
| draft (row 6) | yes | yes | when the draft carries a number (a returned PR) | V |
| pendingApproval (row 7) | yes | only before a decision: the current round has no entry | required | C |
| approved (row 8) | yes, every `orderedQty` 0 in the filter (always so in P2) | no | required | C |
| rejected, cancelled, closed | 422 `ADMINISTRATION_INVALID_TRANSITION` | | | |

- **"Before a decision"** means before the current round's first entry. Row 7 is already "before the decision" that
  settles the chain, so its qualifier would add nothing if it meant the settling one. After a return, the new round
  starts empty, so the requester may withdraw again.
- **Load.** The PR is loaded under `.view`'s scope, the route's key, which the top bar narrows; the `.cancel` holder's
  authority is then `keyCoversUnit`, which it does not (§4.2).
- **Refusals** (§4.4). A caller who is neither, and the requester on row 8, are refused 403; the requester on row 7
  after the round's first entry is refused 422 `ADMINISTRATION_TRANSITION_BLOCKED`, detail `decided`. A missing reason
  is 422 `ADMINISTRATION_REASON_REQUIRED`.
- **Effects.** Row 7 tells the current eligible approvers. Rows 7 and 8 emit `.cancelled`; a draft's cancel emits
  nothing, numbered or not, because nothing that happens to a draft is an event (design §8.1).
- **OD-28.3** (a line a live RFQ cites) arrives with RFQs in P3 (§1.2 item 14).

## 8. Approval integration

### 8.1 The request type and the Unit

- **Registration** at module load, beside the permissions (`request-type.registry.ts:37-43`; leave's,
  `leave-request.service.ts:67-73`): key `administration.purchaseRequest`, module `administration`, name «طلبات
  الشراء» / "Purchase requests", `permissionKeys: ['administrationPurchaseRequest.approve']`, option
  `{ audit: 'host' }` (ADR-041 decision 7). It lives in `shared/approvals.ts`, which imports no feature
  (`administration-isolation.spec.ts`).
- **The Unit** is `{ branchId: PR.branchId, departmentId: PR.departmentId, departmentCatalogId }`, the last read from
  the department copy at every call through `departmentRepository.findById` (design §7.6), never from the current
  placement as leave's is (`leave-request.service.ts:103-113`). So moving the requester does not move the request,
  while a copy linked to a company department after submission gains its `catalogId`, and with it the rungs and grants
  that match on the company department (P2-R13; ADR-041 decision 4 keeps staffing current). A guard refuses 422
  `ADMINISTRATION_TRANSITION_BLOCKED` when the copy no longer lies in the PR's branch (design §7.6). The PR's own fields
  are written once, at create, so only an operator's data fix or the org-catalog merge, which rewrites `departmentId`
  fields (design §7.7), could bring that about; the guard keeps such a PR from being decided on another branch's Unit.
- **The subject** is `{ requestType: PR.approvalRequestType, unit, decisions, pin: readApprovalPin(PR) }`, built by
  one helper in the adapter for every call that passes one: the submission's `currentApprovers`, `decide`, `trailFor`
  for the return and the detail, and the notices' `currentApprovers`. `decisions` maps each entry of
  `PR.approvalSteps` to the engine's `DecidedEntry`, its six fields only, with `deciderUserId` as a string or null,
  as leave's `subjectOf` does (`leave-request.service.ts:124-138`; `approval-trail.ts:26-36`): a stored entry holds an
  ObjectId and the two snapshots, and the engine collects decider ids and looks up their names as strings
  (`approval.service.ts:187-199`; §1.2 item 26). P2 always pins, so `pin` is never null after submission (ADR-041
  decision 10).

### 8.2 Submission (P2.3)

1. Load under `.create`'s scope; `.create` covers the Unit; the caller is the requester (§1.2 item 22); status
   `draft`; version.
2. `submitProblem`: at least one line; every line's `qty` above 0 (design §5.4 row 2); every line's item exists and is
   active for a new reference. A failure is 422 `ADMINISTRATION_TRANSITION_BLOCKED` with one detail per failed rule.
3. `chainFor(type, unit)`. A `noChain` or `unstaffed` status is refused 422 `ADMINISTRATION_APPROVAL_CHAIN_MISSING`,
   with the status as its detail (OD-19 A; ADR-041 decisions 2 and 3).
4. The pin is `pinOf(chain)`. The eligible approvers are `currentApprovers({ …subject, decisions: [], pin })` minus
   the A1 set, the caller included as submitter. None is refused 422 `ADMINISTRATION_APPROVAL_CHAIN_MISSING`, detail
   `noEligibleApprover`: a live rung whose only holders are the requester, creator or submitter counts as unstaffed
   (design §5.2, §6.4 item 5). The refusal stands even when a staffed rung above has other holders who could decide
   early (ADR-041 decision 3), so a department whose only unit-rung approver is its own focal point can submit
   nothing. The remedies are outside the PR: an administrator gives that rung to a second person or removes it from
   the department's chain, or another focal point of the department raises the PR. The refusal's detail is the code
   `noEligibleApprover`, whose words in the web name the three remedies (§4.4), and P2-R3 records the limit.
5. Only the live rung is checked: no per-rung holder lookup is exported (`approversFor` stays inside the engine, and
   `chainFor`'s `staffed` flag says whether anybody holds a rung, not who), so a later rung held only by the A1 set
   passes and is caught after the decision before it (§8.3 step 7; design §5.2, "What submission cannot see").
6. A first submission: `ensureCounter` for the year, outside the transaction.
7. `unitOfWork`: the number first, when the PR has none; then one conditional write on `{ _id, status: 'draft', __v
   }` that sets the status, the number and `businessDate` (first submission only), `approvalRequestType`, the pin,
   `approvalSteps: []`, `submittedAt` and `submittedBy`, the snapshots rewritten once more, and bumps `__v`. A miss is
   re-read and answered 422 or 409. The pin is step 4's `pinOf` result written whole, `approvalWorkflowId` as an
   ObjectId of its `workflowId` and `approvalChainShape` as its `steps`, as leave's create sets them
   (`leave-request.service.ts:334-341`). The fields' own check that an id comes with its rungs runs only at create and
   save, never in an update (`workflow.model.ts:44-61`), so this write is the pin's only guard; after step 3 `pinOf`
   never returns null or an id without rungs (§1.2 item 28).
8. After commit: audit `statusChange` with `number`; the signal; the awaiting-decision notice to the eligible
   approvers; the event `.submitted`.

The chain is read before the transaction, so an edit between the read and the commit applies to the next submission,
not this one: the PR is decided on the pin it stored (ADR-041 decision 4).

### 8.3 Decision (P2.4)

`POST /:id/decide { decision, comment, version, cuts? }`, gated `authorizeAny(.approve, approval.override)`, as design
§6.4 item 3 asks and unlike leave's authenticate-only routes (`leave-request.routes.ts:91-102`).

1. Load under `.approve`'s scope, then, if that finds nothing, under `approval.override`'s, each only if the caller
   holds it; a miss under both is 404 (§4.2). The key that found the PR decides nothing else: the engine judges the
   caller's rungs and override reach from the Unit (ADR-041 decision 6), and the pairs judge the caller's login id. So
   a caller with `.approve` on a unit rung in one branch and `approval.override` at organization scope finds, and may
   override, a stuck PR in another branch.
2. Status in `APPROVAL_PENDING`, else 422 `ADMINISTRATION_APPROVAL_NOT_PENDING`; version, else 409.
3. Pairs (§8.4), else 403 `ADMINISTRATION_SEPARATION_OF_DUTIES`.
4. A rejection needs a comment; the cuts pass §7.3.
5. `approvalService.decide(subject, ctx, { decision, comment })`, once, outside any transaction (design §5.16 spec
   12). Its refusals are remapped by their message key: `approvals.alreadyDecided` and `approvals.nothingToDecide` to
   422 `ADMINISTRATION_APPROVAL_NOT_PENDING`, `approvals.notYourStep` to 422 `ADMINISTRATION_APPROVAL_NOT_YOUR_STEP`
   (design §5.15). An override within its reach decides, recorded as `overriddenWith` (OD-69 (i); ADR-041 decision 6).
6. The conditional append, one `findOneAndUpdate` on `{ _id, status: 'pendingApproval', __v: version,
   'approvalSteps.<n>': { $exists: false } }`, where `<n>` is the number of entries read at load, so the filter fails
   once anyone has appended since. It is the shape of leave's (`leave-request.service.ts:619-641`) with the version
   added (design §5.1.3, A). It pushes the entries `decide` returned, one per rung the decision settles (its own, and
   the rungs below it that it covers or skips, ADR-041 decision 2), each with `deciderUserId` back as an ObjectId, as
   leave's does (`:630-634`), its `stepLabel` from the pin and the actor's `deciderName`, writes the cuts, maps the
   engine's status (`pending` and `unstaffed` keep `pendingApproval`; `approved` and `rejected` set their status and
   stamp), and bumps `__v`. A miss is re-read and answered in §4.2's order: a status that has left `pendingApproval` is
   422 `ADMINISTRATION_APPROVAL_NOT_PENDING`, whatever the version; a PR still pending with a moved version, or a new
   entry, is 409 `STALE_DOCUMENT`. Every status move also moves `__v`, so a race lost to the settling decision answers
   422, and a race lost to a decision that leaves the PR pending answers 409. No other document moves in P2, so the
   append needs no transaction.
7. After commit: the `approvalDecision` row (§10.2); the signal; then by status:
   - `pending`: the awaiting-decision notice to the new live rung's eligible approvers; with none, the stuck notice
     to the audience its rungs left choose, counted from the first unsettled rung as the sweep counts them (§11.1;
     §1.2 item 24);
   - `unstaffed`: the stuck notice, likewise;
   - `approved`: the requester's and procurement's notices (PRQ-2 (a)); the event `.approved`;
   - `rejected`: the requester's notice; the event `.rejected`.

A refused host write leaves no orphan audit row: with `{ audit: 'host' }` the engine writes none (ADR-041 decision 7).

### 8.4 Pairs A1 and B1 (OD-21 B)

| Pair | Refused when the caller is… | On |
|---|---|---|
| A1 | the PR's `requesterUserId`, `createdBy` or `submittedBy` | every decision and every return |
| B1 | the decider of an entry already in the current round's `approvalSteps` | every decision |

Both bind override holders and delegates (design §6.6). B1 does not bind a return, which decides no rung: design §6.6
applies it when a rung is decided. The pairs compare login ids (`userId`), never employee ids. B1 reads only the
current round, so a person who decided in a round a return archived may decide again in the next. A small branch may be
left one decider short; a higher rung or an override then decides (design §6.6, Small branches). The web's decide entry
is enabled only when `viewerMayDecide || viewerMayOverride` holds and the pairs pass (design §6.4 item 6).

B1 also binds an override's decisions on an `unstaffed` chain, where an override settles one empty rung per decision
(ADR-041 decision 3). A PR whose last k rungs are empty therefore needs k different override holders, each reaching
its rung: the one who settled the first is refused 403, pair B1, on the next. The other remedies are staffing the
rung, which the engine reads live under the pin (ADR-041 decision 4), so its new holder decides it, and a cancel.
P2-R3 records it beside the submission limit, and PRQ-4 asks the owner whether it should hold (§2).

### 8.5 Return (P2.4)

`POST /:id/return { version, reason }`, gated as the decision is (§1.2 item 19). It loads as the decision does, under
`.approve`'s scope and then `approval.override`'s (§8.3 step 1), checks `APPROVAL_PENDING`, the version and pair A1 (not
B1, §8.4), and requires `viewerMayDecide || viewerMayOverride` from `trailFor(subject, ctx)` (design §5.2), else 422
`ADMINISTRATION_APPROVAL_NOT_YOUR_STEP`. One conditional write on `{ _id, status: 'pendingApproval', __v,
'approvalSteps.<n>': { $exists: false } }`, the decision's filter, so a decision that lands first makes the return miss
(design §5.1.3, A):

- `status: 'draft'`, the number kept;
- `approvalSteps` moved to `approvalRounds` as `{ round, endedBy: 'returned', at, steps }`, and emptied;
- the pin cleared (`approvalWorkflowId: null`, `approvalChainShape: []`), for the next submission to stamp again
  (ADR-041 decision 4);
- each line's cut folded into its quantity, and a line cut to nothing removed (PRQ-1, §7.3);
- `returnedAt`, `returnedByUserId` and `returnReason`; `__v` bumped.

After commit: audit `statusChange` with the reason, the archived round's number and the folded lines; the signal; the
requester's notice. No event: a return emits nothing (design §8.2).

### 8.6 Stuck requests and the trail

- After every decision the host re-reads the live rung's eligible approvers (§8.3 step 7). A PR left with none waits
  in `pendingApproval`, never approved (ADR-041 decision 3). Its exits are an override within reach, a return by such
  an override, or a cancel (design §5.2), and, while the round has no entry, the requester's withdrawal (§7.4).
- **The detail's trail.** A PR that holds no pin answers `approvalTrail: null`: every draft, whether never submitted or
  returned, and a draft that was cancelled. With `pin: null` the engine would read the current chain live (ADR-041
  decision 4), so a returned draft would show a fresh pending chain and offer its holders a decision. A PR that holds a
  pin answers `trailFor(subject, ctx)`. On a stuck PR its `currentStep` names the rung an override would decide (ADR-041
  decision 3). Outside `APPROVAL_PENDING` (approved, rejected, or cancelled from `pendingApproval` or `approved`, which
  keeps its pin and its partial decisions) the trail comes back with `currentStep` null, `viewerMayDecide` and
  `viewerMayOverride` false, `viewerStep` null and `viewerCovers` empty, as leave's does
  (`leave-request.service.ts:701-711`; `administration-module-phase-px1.md:362-371` names the last four). The panel
  offers its actions on the two flags alone (`ApprovalChainPanel.tsx:130-132`) and marks a rung "waiting here" from
  `currentStep` alone (`:61, 84-88`), and a cancelled PR's chain still reads `pending` or `unstaffed` to the engine; on
  an approved or rejected PR the engine already answers `currentStep` null (§1.2 item 25).
- **Earlier rounds.** A returned draft, and any later status, shows each archived round from `approvalRounds`: its
  rungs by their stored `stepLabel`, else by position, "Step n" / «الخطوة n» with n the entry's `stepIndex` plus one,
  since an entry stores no level and the chain screen writes no caption (§1.2 item 27); each entry's outcome,
  `deciderName`, `decidedAt` and comment (§9.5). The trail covers the current round only.
- An `approval.override` holder decides through the API on override alone, but opens the record only with `.view` or
  `.approve`, the two keys a read tries (design §13.4 note ³). §2's setup gives whoever holds the override for PRs
  `.view` or `.approve` at the same scope, and the stuck notice goes only to override holders who also hold one of
  them (PRQ-2 (b)).

## 9. Pages, keys and navigation

### 9.1 Keys and the page

Declared literally in `administration.module.ts`, one `declarePermissions` call and one page row (design §13.4 rule 5):

| Key | Label en / ar | Slice |
|---|---|---|
| `administrationPurchaseRequest.view`, `.create`, `.edit` | the standard labels over "Purchase requests" / «طلبات الشراء» | P2.2 |
| `administrationPurchaseRequest.approve` | the standard label | P2.2: the detail read admits it from P2.2 (§4.1), and P2.3's chains name it (§8.1), which `setWorkflow` refuses for a key the type does not offer or the booted registry lacks (`approval.service.ts:342-361`; ADR-041 decision 9) |
| `administrationPurchaseRequest.cancel` (special) | "Cancel purchase requests" / «إلغاء طلبات الشراء» | P2.5 |

The page is `administration.purchase-requests`, "Purchase requests" / «طلبات الشراء», sort order 50, route
`/administration/purchase-requests`. The page registry's totals change as §12.3 gives; `.approve`'s scope is the
OD-69 row's (§1.1).

### 9.2 Routes and navigation (P2.W1, P2.W2)

| Route under `/administration` | Page | `RequirePermission` | Slice |
|---|---|---|---|
| `purchase-requests` | `PurchaseRequestsPage` | `.view` | P2.W1 |
| `purchase-requests/awaiting-decision` | `AwaitingDecisionPage`, written for PRs; P4 gives it the approval type as a parameter when the PO's list arrives (design §13.4 mounts one per type) | `.approve` | P2.W2 |
| `purchase-requests/new` | `PurchaseRequestEditorPage` | `.view`, nesting `.create` | P2.W1 |
| `purchase-requests/:id` | `PurchaseRequestDetailPage` | `anyOf` `.view` / `.approve` (design §13.4 note ³) | P2.W1 |
| `purchase-requests/:id/edit` | `PurchaseRequestEditorPage` | `.view`, nesting `.edit` | P2.W1 |

- **The editor is a page.** Design §13.4 rule 2 lets P2's UI pass choose between editor routes and lines in a dialog,
  once for every document. This re-detail makes that choice: routes, since a request of up to 100 lines, each with an
  item search, is a page, the shape of Fleet's `CustodyMemoEditorPage` reference (design §13.5), without Fleet's
  `new`-plus-`:id` editor (rule 2). P2.W1 runs the `ui-consistency` pass first, which counts how the project's
  existing pages build this kind of page and writes the checklist §9.5 feeds. If its count contradicts a choice made
  here, the difference is recorded in this re-detail as a deviation and reviewed before P2.W1 merges (§13, Docs).
- **Transitions are dialogs on the record**, never routes (rule 1): submit, decide, return and cancel.
- **The navigation row.** «طلبات الشراء» / "Purchase requests", `/administration/purchase-requests`, key `.view`, icon
  `clipboard`, which is registered (`apps/web/src/platform/navigation/app-icon.tsx:61`) and unused in the module. The
  row is the sixth of the category, after the suppliers (`apps/api/src/seed-navigation.ts:1346-1352`). Its pins are
  §12.3's.
- **The home's tile** (P2.W2). `ADMINISTRATION_SHORTCUTS`
  (`apps/web/src/modules/administration/pages/AdministrationHomePage.tsx:40-69`) gains one `ShortcutCard`, the
  register, `to: '/administration/purchase-requests'` under `.view`: it has a sidebar row on that key, as the routes
  spec holds every tile to (`administration-routes.spec.ts:207-213`).
- **The home's counts** (P2.W2). `Counts` (`:101-142`) gains two `StatCard`s. PRs awaiting approval, under `.view`, read
  from the register with `{ page: 1, pageSize: 1, status: 'pendingApproval' }`, not `COUNT_PARAMS`, whose `isActive` the
  PR list query refuses (`:72`), and linked to `COUNT_LINKS.purchaseRequests =
  '/administration/purchase-requests?status=pendingApproval'`. PRs awaiting a decision within the reader's `.approve`
  reach (§4.1), under `.approve`, read from the awaiting-decision list with `{ page: 1, pageSize: 1 }` and linked to
  `COUNT_LINKS.awaitingDecision = '/administration/purchase-requests/awaiting-decision'`. Each link's query string says
  what is counted (`:74-83`).
- **The awaiting-decision list** has no tile and no row, since OD-62 A ships one row. It is opened from its home count
  and from a link on the register shown to `.approve` holders.
- **Who reaches the home.** The home row stays on `administrationItem.view` (`seed-navigation.ts:1316-1322`). A
  department requester, and an approver who holds `.approve` alone, see no home row and reach the home through any
  record's breadcrumb (design §13.3 note ¹); an approver's first way in is a notice, which opens the record from P2.W1
  (§11.1). §2's setup note recommends `.view` beside `.approve`, which adds the register's row.

### 9.3 Bundles (OD-78 A)

In `administration-roles.ts`, each key joining in the slice that declares it (design §6.5):

| Bundle | Gains | Slice |
|---|---|---|
| `administration-department-requester`, new, "Department requester" / «منسق طلبات الإدارة» (design §6.5's candidate, OD-67 A), placed after the storekeeper | `.view`, `.create`, `.edit`; assigned at department scope, the requester's own copy | P2.2 |
| the procurement officer and the procurement manager (`PROCUREMENT_OFFICER_KEYS`, `:31-35`) | `.view` | P2.2 |
| the procurement manager | `.cancel` | P2.5 |
| the Administrative Affairs manager | `.view`, `.approve` | P2.2 |
| the auditor | `.view` | P2.2 |

### 9.4 The pickers and the page parts

- **`ReferencePicker`** (P2.W0) is rebuilt in the module after IT's `VendorPicker` (D-21; design §13.6 D): a server
  search, enabled only on a non-empty search, 8 rows, the caller's search hook's page (`PEOPLE_PICKER_ROWS`;
  `useItemSearch` asks the same; design §22 "P2.W0 built"), a picked chip, `aria-pressed` results, a spinner, a
  no-results sentence and a no-access sentence. Its props are `{ value, valueLabel, onChange(id, label), error?,
  allowed, useSearch(search, enabled), rowId(row), rowLabel(row), renderRow(row), texts: { placeholder, noResults,
  noAccess, clearPick } }`, the last four i18n keys. P2.W0 also moves Phase 1's `EmployeePicker`, the warehouse keeper
  box written by hand after IT's pattern (`apps/web/src/modules/administration/components/EmployeePicker.tsx:35-62`),
  onto it with no change of behavior: `EmployeePicker` keeps its props, `ADMINISTRATION_PEOPLE_GRANTS` and
  `pickerLabel`, and passes `allowed`, `usePeopleSearch` and the `administration.people.*` texts. The module then has
  one implementation with two users: "one control and one behaviour to fix"
  (`docs/03-decisions/ADR-019-reference-pickers-search-not-load-all.md:118-119`).
- **`ItemPicker`** (P2.W1) is its second user: active items only for a new line, the picked id resolved even when the
  item is retired, `allowed` through `useCan` over exactly the item reads' two keys (§4.1). A non-stock item carries a
  mark. Its search hook, `useItemSearch(search, allowed)`, joins `api/catalog-queries.ts`, keyed
  `itemListKey({ picker: search, isActive: true })` (`api/administration-keys.ts:31-32`), so the existing `.item` row
  refreshes it (`apps/web/src/platform/realtime/invalidation-registry.ts:657`).
- **Remembered filters.** Every new `*Page.tsx` is classified in `remembered-filters-coverage.spec.ts` (`:12-21`):
  the register COVERED, every param it reads remembered, as Phase 1's registers are (`:46-51`); the record and the
  editor NOT_FILTER_CAPABLE, as Phase 1's records are (`:290-292`); the awaiting-decision page NOT_FILTER_CAPABLE with
  the note "a `page`-only list", the spec's own kind (`:287`).
- **Department filter.** It offers each company department once (`orgUnitGroupKeys`, `expandOrgUnitSelection`,
  `packages/contracts/src/platform/org-unit-groups.ts:71, 110`; design §14.5) and sends the ids of its copies, since a
  PR's `departmentId` is a copy (Terms).

### 9.5 What each page shows

In the shape of design §13.6 A–E. Every text is an i18n key under `administration.purchaseRequests.*` (§13), and
every refusal is worded from its code and detail (§4.4).

- **The register** (`PurchaseRequestsPage`, P2.W1). Columns: number (an unnumbered draft shows "Draft" / «مسودة»),
  status, requester, department, branch, needed by, lines, submitted, created. Filters, each in the address bar and
  remembered: search (the number), status (several), department (§9.4), "Mine" (sends the caller's own
  `requesterUserId`; no person picker, §14), and created from and to. Sorted by created, newest first. Actions: "New
  purchase request" under `.create`, to `/new`; "Awaiting decision" under `.approve`, to the awaiting-decision list. A
  row opens its record. Empty states: none yet (with the create action for `.create` holders), and none matching the
  filters; a failed read shows the shared error state with a retry. P2.W2 adds the grouped counts above the table from
  `/summary`, under the same filters: the total, by status, by company department and by month.
- **The record** (`PurchaseRequestDetailPage`, P2.W1). The header: number or "Draft", the status, and one button per
  enabled act of `availableActions`; a listed act that is not enabled is shown disabled, titled with its reason's
  words. Sections: the request (the requester's snapshot, the branch, needed by, justification, notes, submitted at and
  by, the business date); the lines (item code and name, a non-stock mark, unit, quantity, the cut when above 0, the
  open quantity, notes); the approval panel on the current trail, with the decide and return buttons as its actions
  (§8.6); the earlier rounds, one block per `approvalRounds` entry, each rung's `stepLabel`, else "Step n" (§8.6),
  outcome, `deciderName`, date and comment; the outcome stamps and reasons of §6.1. P2.W2 adds the attachments card.
- **The editor** (`PurchaseRequestEditorPage`, P2.W1). Needed by, justification and notes; a lines table with, per
  line, the `ItemPicker`, an integer quantity from 1 and notes. Add line, until the 100th, after which the button is
  disabled and a sentence gives the cap; remove line. Lines keep the order entered, and no reorder is offered. A kept
  line sends its `lineId`, also when its item is changed (§4.2). Save creates, then opens the record, or patches with
  the version; a 409 shows the shared stale-version message with a reload. Submission is on the record.
- **The submit dialog**: a confirmation naming the line count; a refusal is shown in the dialog, `noEligibleApprover`
  with its three remedies.
- **The decide dialog**: approve or reject; a comment, required to reject; on approve, one row per line with "reduce
  by", an integer from 0 to the open quantity, and the quantity it leaves; when the cuts would leave nothing, a
  sentence says to reject instead, and the confirm button is disabled.
- **The return dialog**: a reason, required, 1 to 1,000 characters.
- **The cancel dialog**, one dialog for both acts, titled "Cancel" for a `.cancel` holder and "Withdraw" for the
  requester: the reason field shows where §7.4 requires one, and is required there; an unnumbered draft shows none.
- **The awaiting-decision page** (`AwaitingDecisionPage`, P2.W2). Columns: number, requester, department, branch,
  submitted, lines. Paging only. A row opens its record. Empty: no PR within the reader's reach awaits a decision.

## 10. Realtime and audit

### 10.1 Realtime

| Topic | Permission | Web key prefixes | Signal |
|---|---|---|---|
| `administration.purchaseRequest` | `administrationPurchaseRequest.view` | `['administration', 'purchaseRequests']` | `signalPurchaseRequest(id, branchId)`, a literal pair in `purchase-request-audit.ts`, after every audited act, whatever its verb (design §9.1) |

- `approvalDecision` is not a broadcast verb, so the branch signal is what refreshes the record after a decision
  (design §9.1).
- The requester holds department-scope `.view` under OD-16 A, so they join the branch room and their screens refresh
  live (`apps/api/src/platform/realtime/realtime-rooms.ts:29-34`).
- An approver who holds `.approve` without `.view` joins no PR room. Until PC-7 lands, they refresh on navigation and
  after `staleTime`, 30 s (`apps/web/src/shared/lib/query-client.ts:18`; design §9.5). So does an `own`-scope holder,
  of whom OD-16 A seeds none.
- `platform.approval` stays classified with no topic: the PR's own topic carries the decision
  (`realtime-registry.ts:331-335`).
- `EXPECTED_DYNAMIC_SITES` stays where it is, because every pair is literal (design §9.8).

### 10.2 Audit

After commit, each act's rows are recorded once; a transaction's rows are built inside its `unitOfWork` callback, fresh
on every attempt (design §10.1). The entity is `{ moduleId: 'administration', entityType: 'purchaseRequest' }`:

| Act | Verb | `changes`, beyond `status` old → new |
|---|---|---|
| create; draft edit | `create`; `update` | `diffChanges` of the snapshot, only if non-empty |
| submit | `statusChange` | `number` when taken |
| decide, any rung | `approvalDecision` (OD-82 A) | the engine's `auditChanges` as it returns them (ADR-041 decision 7; `approval.service.ts:283-294`): `decision`, `step` (the decided rung's index as a string), `level`, `permissionKey`, `overriddenWith` on an override only, and `covers` only on an early decision over rungs below the actor's own (§1.2 item 23); plus `requestType`, `comment` and, with a cut, `cuts [{ itemCode, qty }]`. Every rung the decision settled, skipped ones included, is in the PR's `approvalSteps` |
| return | `statusChange` | `reason`; the archived round's number; each folded line as `folded [{ itemCode, from, to }]`, `to` 0 for a line removed (PRQ-1) |
| cancel | `cancel` | `reason`, except on an unnumbered draft, which has none |
| a file linked or withdrawn | `update` | `attachment` (`<categoryKey>:<label>`) |
| the sweep | none | it only notifies, and a sweep that only notifies writes nothing (design §10.1) |

An old worker refuses a job with an unknown verb (`apps/api/src/platform/audit/audit.model.ts:46`), so the verb has
a deploy order, RK-29's, which §15 states.

### 10.3 Events

In-process, after commit, one literal emit per helper with one key per line (design §8.1), each `stable` with its
emitter:

| Event | Fires on | Payload |
|---|---|---|
| `administration.purchaseRequest.submitted` | row 2 | `purchaseRequestId`, `number`, `branchId`, `lineCount`, `departmentId`, `requesterUserId`, `requesterEmployeeId` |
| `….approved`, `….rejected` | rows 3 and 4 | the same, plus `status` |
| `….cancelled` | rows 7 and 8 | the same, plus `status` and `orderStatus` |

No names and no amounts (design §8.1). A return emits nothing, nor does an intermediate rung (design §8.2). `.closed`
ships in P4 with its emitter (§1.2 item 14). Each event slice runs `scripts/check-event-reachability.mjs` locally,
keeping the module at 100 % (design §8.4). P2.4, which ships `.approved`, corrects the automation design's
`Purchase.Request.Approved` row (`docs/12-planning/automation-module-design.md:257`, design §8.7): its event,
`purchasing.request.approved` today, becomes `administration.purchaseRequest.approved`, and its status, "module not
built" today, becomes **exists**.

## 11. Notifications and reminders

### 11.1 Notices (OD-61 A)

Each template is ensured in `administration.seed.ts`, in-app and email with an en and ar subject and body, as leave's
are (`apps/api/src/modules/hr/hr.seed.ts:410-478`). Each send runs after commit through the host's `.catch()` (§4.2):
the service throws on a missing template (`notification.service.ts:115-116`), and the catch swallows it, so a missing
template sends nothing and says nothing (RK-22). A module seed-coverage spec in the `hr.seed.spec.ts` shape
(`apps/api/src/modules/hr/hr.seed.spec.ts:1-15`) fails CI on a sent key the seed does not ensure. Every notice carries
the PR's `entityRef`; from P2.W1, `ENTITY_ROUTES` opens it on the record, and before P2.W1 it opens the inbox (§5).

| Template (`AdministrationTemplates`) | Category | To | When | Slice |
|---|---|---|---|---|
| `administration.purchaseRequest.awaitingDecision` | `approval` | the live rung's eligible approvers | submission; a decision that leaves the chain `pending` | P2.3 |
| `administration.purchaseRequest.approved` | `workflow` | the requester; procurement (PRQ-2 (a)) | row 3 | P2.4 |
| `administration.purchaseRequest.rejected` | `workflow` | the requester | row 4 | P2.4 |
| `administration.purchaseRequest.returned` | `workflow` | the requester | row 5 | P2.4 |
| `administration.purchaseRequest.stuck` | `approval` | PRQ-2 (b): the `approval.override` holders of the audience the rungs left choose (the branch audience when each is a `unit` or `branch` rung, else the organization audience), kept only if they also hold `.view` or `.approve` there, sent as a list of users | a decision that leaves the PR stuck; daily while it is (§11.2) | P2.4, P2.7 |
| `administration.purchaseRequest.cancelled` | `workflow` | the current eligible approvers | row 7 | P2.5 |
| `administration.purchaseRequest.reminder` | `approval` | the live rung's eligible approvers | daily (§11.2) | P2.7 |

The one variable is `number`, and nothing personal goes with it. No PC-8 category (OD-61 A), and no automation. The
wording, in the shape of leave's (`hr.seed.ts:410-478`):

| Template | Subject en / ar | Body en / ar |
|---|---|---|
| `awaitingDecision` | Purchase request awaiting your decision / «طلب شراء بانتظار قرارك» | Purchase request {{number}} is awaiting your decision. / «طلب الشراء {{number}} بانتظار قرارك.» |
| `approved` | Purchase request approved / «تم اعتماد طلب شراء» | Purchase request {{number}} was approved. / «تم اعتماد طلب الشراء {{number}}.» |
| `rejected` | Purchase request rejected / «تم رفض طلب شراء» | Purchase request {{number}} was rejected. / «تم رفض طلب الشراء {{number}}.» |
| `returned` | Purchase request returned for amendment / «أُعيد طلب شراء للتعديل» | Purchase request {{number}} was returned to you for amendment. / «أُعيد إليك طلب الشراء {{number}} لتعديله.» |
| `stuck` | Purchase request with nobody to decide it / «طلب شراء لا يوجد من يبت فيه» | Purchase request {{number}} is waiting, and nobody on its approval chain can decide it now. / «طلب الشراء {{number}} متوقف، ولا يوجد الآن في سلسلة اعتماده من يستطيع البت فيه.» |
| `cancelled` | Purchase request cancelled / «تم إلغاء طلب شراء» | Purchase request {{number}}, which was awaiting your decision, was cancelled. / «تم إلغاء طلب الشراء {{number}} الذي كان بانتظار قرارك.» |
| `reminder` | Purchase request still awaiting your decision / «طلب شراء ما زال بانتظار قرارك» | Purchase request {{number}} is still awaiting your decision. / «طلب الشراء {{number}} ما زال بانتظار قرارك.» |

The `FRIENDLY` words of §5's codes and the `administration.purchaseRequests.*` keys are written in P2.W1, and the
verb's labels in P2.0, in the shape of Phase 1's administration entries; `scripts/check-formal-arabic.mjs` and the
i18n and errors specs check them in the pull request (§12.3), and the owner reads them in criterion 15's staging run.

### 11.2 The daily sweep (P2.7)

The manifest's first `scheduledTasks` entry (`apps/api/src/platform/kernel/module-registry.ts:66, 150`), declared in
`ScheduledTaskDeclaration`'s shape (`apps/api/src/platform/scheduler/scheduler.service.ts:15-30`):

- `key: 'administration.purchaseRequestApprovals'`; `description: 'Remind approvers of purchase requests awaiting a
  decision, and report the stuck ones'`; `ownerService: 'administration'`; `handler`, `purchaseRequestSweeps.run()`
  in `purchase-request-sweeps.ts`.
- `cron: '0 6 * * *'`, the hour of leave's approval reminder (`apps/api/src/modules/hr/hr.module.ts:2276-2278`), so an
  approver's reminders arrive together: 06:00 UTC, which is 08:00 or 09:00 in Cairo as its offset is two hours or three
  (`packages/contracts/src/common/cairo-date.ts:141-146`). Cron has no time zone (RK-13).
- `retry` keeps its default, true (`scheduler.service.ts:23-29`): a retry starts after the failed run has ended, and
  the idempotency keys skip what that run sent. The key's check is a read, then a create
  (`notification.service.ts:226-231`), so only two runs at once could both send, which a retry does not cause.

What each run does:

- **Paging.** A system read of the PR repository, `pendingApprovalAfter(lastId)`: `{ status: 'pendingApproval', _id:
  { $gt: lastId } }`, sorted by `_id`, 100 rows, unscoped, as `findByIdsSystem` is, because the sweep acts for nobody.
  An `_id` cursor neither skips nor repeats a PR when decisions move others out of the set during the run; offset
  paging would skip some.
- For each PR it reads the live rung's eligible approvers (`currentApprovers` minus the A1 set and the round's
  deciders).
- **Reminder.** When there are eligible approvers and the PR's wait began on an earlier Cairo date (its submission or
  its latest decision), each gets one reminder.
- **Stuck notice.** When there are none, the stuck notice goes to PRQ-2 (b)'s readers, chosen by the rungs left (§11.1).
- **Idempotent.** Each notice carries the key `<template>:<prId>:<first unsettled rung>:<Cairo date>`, a no-op for a
  recipient who already has it (`notification.service.ts:226-231`). A rerun, or a decision's stuck notice earlier that
  day on the same rung, sends nothing twice, while a PR that moves on and stops at another rung the same day is
  reported again. No sweep marks are needed (design §18.1 note A10).
- **What it writes.** No PR and no audit row: it only notifies (design §10.1).
- **Why not `statusFor`.** It never calls `approvalService.statusFor`; §1.2 item 17 gives the reason.

## 12. Tests

C = create, M = modify. Pure specs first, no database and no clock (design §19.7).

### 12.1 Unit specs

Feature specs sit beside their files in the PR feature, `procurement/purchase-requests/` (Paths).

| Spec | C/M | Slice | Checks |
|---|---|---|---|
| contracts `administration.spec.ts` | M | P2.1; P2.2–P2.7 | `PR-2026-000001` formats and parses; widths past six; 0, negatives, fractions, unknown kinds and other spellings refused (P2.1); the unit-lock vocabulary (P2.2); the events and templates constants, as each slice adds its own |
| contracts `administration-procurement.spec.ts` | M | P2.2–P2.6 | strict schemas; 101 lines refused; `qty` 0 and 1,000,001 refused; a `neededBy` that is not `YYYY-MM-DD` refused; `status` and `departmentIds` read as comma lists, 201 departments refused; cuts on a rejection, two cuts on one line and 101 cuts refused; a reason over 1,000 refused; each guard set's members, one reason per status (spec 8); the attachment schemas (P2.6) |
| contracts `administration-catalog.spec.ts` | M | P2.1 | `stockTracked` defaults to `true` on create and is optional on update |
| `shared/document-number.spec.ts` | M | P2.1 | the yearly key and its year from one instant: 2026-12-31T21:59:59.999Z keys 2026 and 2026-12-31T22:00:00.000Z keys 2027 (RK-13); `highestNumberPipeline`'s `$match`, with `$type: 'string'` and the yearly pattern, and its grouping by length; a hand-typed `PR-2026-0000042` never outgrows `PR-2026-000500`; `numberFloorFrom` counts another year's or kind's number as none |
| `shared/lifecycle.spec.ts` | C | P2.2 | `findTransition`, `availableActions`, `statusesWhere`, `reachableFrom` |
| `purchase-request-lifecycle.spec.ts` | C, M | P2.2; P2.5 | design §5.16 specs 1–7 over the nine rows, spec 5 with its list of keys not yet declared, which P2.5 empties and removes (§7); `submitProblem` with each detail code, `cancelProblem`, `orderStatusOf` (zero lines, cuts), `closeCondition` |
| `purchase-request-rules.spec.ts` | C, M | P2.2; P2.3–P2.5 | the requester refusals and their details, and the draft's ownership; a cut's bounds (1 to the open quantity, once per line, a known line), a cut to 0, and never every line at 0; the return's fold, a line cut to nothing removed; "before a decision"; the cancel table of §7.4; pairs A1 and B1 over every round shape, B1 refusing an override's second empty rung; the rungs left and the stuck audience they choose; `availableActions` for each status, with each `enabled` and `reason` of §4.4 |
| `shared/approvals.spec.ts` | C | P2.3 | the registration and its option, read as `registerApprovalRequestType`'s second argument, `{ audit: 'host' }`, through a `vi.mock` of the platform barrel, since the registry gives no host the mode back and the isolation spec admits only barrel paths (§1.2 item 29); the subject's entries mapped to `DecidedEntry`, `deciderUserId` as a string (§8.1); the Unit from the document; the copy-in-branch guard; `noChain` and `unstaffed` refused; the A1 exclusion at submission; the remap by message key |
| `purchase-request-audit.spec.ts` | C, M | P2.2; P2.3–P2.6 | the literal pair, each act's verb and changes; `approvalDecision`'s fields, the engine's `decision`, `step`, `level` and `permissionKey` always, `overriddenWith` on an override only and `covers` on an early decision only (§10.2), with `requestType`, `comment` and `cuts`; the branch signal after every act (`consumable-history.spec.ts` shape) |
| `purchase-request-events.spec.ts` | C, M | P2.3; P2.4, P2.5 | each helper's payload parses against its schema and carries exactly the catalog's keys (design §8.4) |
| `purchase-request-files.spec.ts` | C | P2.6 | the authorizer: each key with its own scope; write only by the requester and only on a draft, so a write on a submitted PR is denied; the delete asked as a write |
| `purchase-request-sweeps.spec.ts` | C | P2.7 | the declaration's key, cron and owner; reminders only after an earlier Cairo date; the stuck notice and its audience; idempotency keys with the rung; the `_id` cursor across pages; no write |
| `catalog/items/item-unit-lock.spec.ts` | C | P2.2 | no registrant passes; a registrant's answer refuses the unit change and only that |
| `purchase-request-guards.spec.ts`, the source-scan guards | C, M | P2.2; P2.3, P2.4 | design §5.16 specs 9–13: one writer of `status`; every status write filtered on `__v` or `status`; pair A1 in decide and return, B1 in decide; no `approvalService.statusFor(` and no `decide(` inside `unitOfWork(`; no content write matches a terminal status |
| `administration.module.spec.ts`, `administration-scope-guards.spec.ts`, `administration-indexes.spec.ts` | M | P2.2–P2.7 | the surface pinned; the PR repository's scope fields and its section-as-own reading (design §7.3); the model list |
| `administration.seed.spec.ts` | C, M | P2.3; P2.4, P2.5, P2.7 | every sent template seeded |

### 12.2 Integration

One file, `apps/api/tests/integration/administration-purchase-requests.spec.ts`, created in P2.2 and grown by each
slice (RK-01). Its setup:

- **Harness.** The shared fixtures (`apps/api/tests/integration/helpers/administration-fixtures.ts`). `plantEmployee`
  (`:334-368`) gains an optional `userId`, written on the employee, so the directory's self lookup finds the
  requester; the suite creates that login with the employee's branch and department as its placement (`mkUser`,
  `:152-165`), so `keyCoversUnit` reads the Unit the PR is filed on (§4.2). A planted employee's `jobTitleId` names no
  row, so its snapshot's `jobTitle` is null (§6.1).
- **Places and people.** Two branches; in branch A two department copies, one linked to a catalog entry.
- **Chains** are written through `PUT /api/v1/platform/approvals` with `basedOn`, the id and version of the chain row a
  save replaces (ADR-041 decision 9; PX-1.6).
- **Concurrency.** Races run through the module's hook, `shared/test-hooks.ts` (P2.4), written after ATM's
  (`apps/api/src/modules/atm/settlements/shared/test-hooks.ts:1-38`): a test registers a callback at a named point,
  `purchaseRequest.decide.beforeWrite` or `purchaseRequest.return.beforeWrite`, which the service runs once between its
  checks and its conditional write. Nothing is registered in production, so each point does nothing there, and each
  interleaving in the suite is deterministic.
- **Refusals** assert status, code and detail.

| Case | Slice |
|---|---|
| A focal point creates, edits and reads a draft. A login with no employee and an unplaced employee are refused 422 `ADMINISTRATION_TRANSITION_BLOCKED`, an exited employee 422 `ADMINISTRATION_EMPLOYEE_EXITED`, and an employee whose branch is not their copy's, detail `placementMismatch`. A narrowed organization holder whose top bar excludes the placement is refused 400 `OUT_OF_REACH`. A retired item is refused on a new line and kept on a kept line; an unknown `lineId` is 422. A stale edit is 409; an edit of a submitted PR is 422, also when its version is stale (§4.2's order). A colleague focal point's edit of another's draft is 403 | P2.2 |
| Scope: a department reader sees its copy only; a branch reader its branch; another branch 404; `own` its own rows; a `section` grant nothing (RK-15); a holder of `.approve` alone reads a PR's detail | P2.2 |
| The list's filters and sorts: two statuses at once; `departmentIds`, a copy outside reach adding no row; `requesterUserId`; `from` and `to` on Cairo days, a PR created at 23:30 Cairo time counted on its own day; `search` on a number's start; each of the four sorts, both ways | P2.2 |
| The item picker opens to a requester without `administrationItem.view`; an item's unit change is refused once a PR line names it | P2.2 |
| Submission: no chain, a chain whose rungs nobody holds, and a live rung held only by the requester are each 422 `ADMINISTRATION_APPROVAL_CHAIN_MISSING`, with their details; a chain written for another department does not apply; a colleague's submission of another's draft is 403 | P2.3 |
| A live rung held only by the focal point, with a staffed rung above it, is refused with detail `noEligibleApprover`; once a second person holds that rung, the submission passes | P2.3 |
| Submission takes `PR-<year>-000001`; ten drafts submitted at once take ten consecutive numbers; a refused submission among them takes none; a returned PR keeps its number | P2.3 |
| The live rung's approvers, minus the requester, get one awaiting-decision notice each, whose `entityRef` is the PR | P2.3 |
| A two-rung chain written at `/system/approvals`: rung 0 approves with a cut, and rung 1's eligible approvers, none of the A1 set, get one awaiting-decision notice each; rung 1 approves; the PR is `approved`, its cut in `cancelledQty`, two `approvalDecision` rows and no `platform/approval` row; a cut above a line's open quantity is 422 | P2.4 |
| A rejection without a comment is 422; with one, `rejected`, the requester told | P2.4 |
| Pair A1: the requester holding `.approve`, holding an override and holding a delegated `.approve` are each 403. Pair B1: rung 0's decider holding rung 1 is 403, as rung 0's decider holding an override, and a delegate who decided rung 0, are. After a return, the same person decides the next round. A delegated `.approve` stands on a unit rung | P2.4 |
| On rung 0 of a two-rung chain, two decisions through the hook: one appends, the other 409 `STALE_DOCUMENT`; exactly one entry and one audit row. A return and a decision on rung 0, interleaved by the hook: the second to write is 409. Two decisions on the settling rung: the loser is 422 `ADMINISTRATION_APPROVAL_NOT_PENDING` | P2.4 |
| A return archives the round, clears the pin, folds the cut, removes a line cut to nothing and keeps the number; the returned draft's detail answers `approvalTrail: null` and the round in `approvalRounds`; resubmission pins again | P2.4 |
| A later rung held only by the requester passes submission; after rung 0's approval the PR stays `pendingApproval`, and the stuck notice goes out (design §5.16 spec 15) | P2.4 |
| A chain left with nobody on its next rung, an `organization` rung, after rung 0's approval: the PR stays `pendingApproval`; the stuck notice goes to the organization-scope override holders who hold `.view`, and not to a branch-scope override holder or to an override holder with no read key; an organization override decides it | P2.4 |
| A chain whose last two rungs are empty: one organization override settles the first and is refused 403, pair B1, on the second, which a second override holder settles | P2.4 |
| A caller holding `.approve` on a unit rung of branch A and `approval.override` at organization scope finds and decides a stuck PR of branch B | P2.4 |
| On an approved PR, the detail's trail offers no decision: both flags false for a rung holder and for an override holder | P2.4 |
| The awaiting-decision read lists every PR in `pendingApproval` that the caller's `.approve` grant reaches, a settled lower rung's holder included, and none outside it | P2.4 |
| Cancel: each row of §7.4's table and each refusal; the approvers' notice on row 7; no event on a draft; a PR cancelled from `pendingApproval` keeps its trail with both flags false and `currentStep` null, so no rung is marked waiting (§8.6); once a PR naming an item is a cancelled unnumbered draft, the item's unit change passes | P2.5 |
| Attachments: a file links in draft and is refused after submission; the 21st is 422; a link's `DELETE` unlinks it, and with a stale version is 409; a colleague's write on another's draft is 403; a platform file write (`replace`, `softDelete`) on a submitted PR's file is 403; a reader under `.approve` alone reads it; a file whose scan has not passed is refused by the platform's scan gate | P2.6 |
| The sweep: one reminder per eligible approver on a later day, none the same day, one stuck notice, nothing twice on a rerun | P2.7 |
| The summary: counts by status, by department copy and by Cairo month for a filtered set, equal to the list's totals under the same filters | P2.7 |
| From P2.W1, a role holding only the department requester bundle sees exactly the PR row from `GET /platform/me/applications` | P2.W1 |

Suites that stay unchanged and green: `hr-leave.spec.ts` and PX-1's `approvals.spec.ts`.

### 12.3 Existing tests and counts that change (RK-17)

This table gives every count P2's pull requests pin, from its value on `de38fd71`, which PX-1 left unchanged on
`a4434d00`; other sections refer to it.

| Pin | Change | Slice |
|---|---|---|
| `scripts/check-page-registry.mjs` totals | 121 → 122 pages and 441 → 445 keys (P2.2), then 445 → 446 keys (P2.5) (`administration-module-decisions-and-phases.md:3400`) | P2.2, P2.5 |
| `apps/web/src/platform/approvals/ApprovalChainPanel.spec.tsx` | the caption in each locale; the level's name without one; no `permissionKey · level` line; the override line as it is (`:172-182`) | P2.0 |
| `apps/web/src/modules/system-admin/approvals/pages/ApprovalWorkflowsPage.spec.tsx` (C) | request types, departments and branches named in each locale, in the list and in the editor's three selects | P2.0 |
| `apps/web/src/modules/system-admin/system-admin-i18n.spec.ts` | + a case pinning `approvalDecision` in `AUDIT_ACTIONS` and its en and ar labels to the catalog's `approvalDecided` words (`EVENT_ACTION_NAMES`), since its census only checks that each verb has a label | P2.0 |
| `targets.spec.ts:76-91`; `workforce-reset.spec.ts:223-246, :362-363` | +1 `keep`; the untouched list 14 → 15 entries; the recruitment count 13 → 14, and its comment's "The other thirteen" (`:362`) "The other fourteen" | P2.2 |
| `employee-name-copies.spec.ts:36, :43-60` | 16 → 17 copies, and the comment's "Sixteen copies across eight collections" "Seventeen copies across nine collections" | P2.2 |
| `packages/contracts/src/events/catalog.spec.ts:147, :181` | each event in `ALL_SCHEMAS` and the "invents nothing" set | P2.3–P2.5 |
| `packages/contracts/src/platform/notification-target.spec.ts` | the PR route's case: a PR notice's target is its record | P2.W1 |
| `administration-catalog.spec.ts` (integration) | `stockTracked`; the widened read gate | P2.1, P2.2 |
| `apps/web/src/modules/administration/administration-employee-picker.spec.ts:78-83` | the no-access case reads `ReferencePicker.tsx` for `if (!allowed)`, and holds `EmployeePicker.tsx` to passing `allowed`, `usePeopleSearch` and `administration.people.noAccess`; the keeper-only case (`:113-116`) stays | P2.W0 |
| `seed-navigation.spec.ts:84`; `auth-seed-login.spec.ts:40, :299-308, :325`; `apps/api/src/seed-navigation-administration.spec.ts:39, :127` | 145 → 146 rows; the breakdown's Administrative Affairs 5 → 6; the groups stay 9; the row ⇄ route ⇄ key ⇄ icon; the icon list gains `clipboard`; `ROWLESS` gains `purchase-requests/new` and `purchase-requests/:id/edit` (P2.W1) and `purchase-requests/awaiting-decision` (P2.W2), each with the page that links to it | P2.W1, P2.W2 |
| `apps/web/src/modules/administration/administration-routes.spec.ts:207-223` | the PR tile on `.view`, under its row; the untiled routes gain `/new`, `/:id` and `/:id/edit` (P2.W1) and `/awaiting-decision` (P2.W2) | P2.W1, P2.W2 |
| `apps/web/src/modules/administration/pages/home-screen.spec.tsx` | the PR tile, and the two counts with their params and links | P2.W2 |
| `apps/web/src/shared/lib/errors.spec.ts`; `apps/web/src/shared/lib/remembered-filters-coverage.spec.ts`; `apps/web/src/modules/administration/administration-{i18n,api-contract,realtime}.spec.ts` | the new codes in `FRIENDLY`, en and ar; the new pages' classes (§9.4); the new keys, calls and topic | P2.W1, P2.W2 |

These stay: the audit filter's two label cases, one per locale, in
`apps/web/src/modules/system-admin/audit/audit-screens.spec.tsx:362-368`, which read `AUDIT_ACTIONS` and pass once
P2.0's `i18n.ts` labels the verb (`systemAdmin.users.audit.approvalDecision`, en and ar);
`apps/web/src/modules/system-admin/system-admin-api-contract.spec.ts:444-543`, the chain screen's source scan, whose
pinned strings P2.0's renamed options leave intact (§1.2 item 30); `realtime-registry.spec.ts`
and `realtime.spec.ts`, whose registries gain one row each; the event publishers spec, which discovers the new
constant; the settings counts, the print-window list, the stream-rows list and the notification categories, none of
which P2 touches.

## 13. The file list

API paths follow the front matter's rule. In the web table, a path that starts with `apps/` is from the repository
root, and every other path is under `apps/web/src/modules/administration/`. "C, M" = created in the first pull request
listed, then modified.

**Contracts**

| File | C/M | Slice | Purpose |
|---|---|---|---|
| `packages/contracts/src/modules/administration.ts` + spec | M | P2.1; P2.2–P2.7 | numbering; lines cap; available actions; the unit-lock vocabulary; events; templates; the request-attachments category |
| `packages/contracts/src/modules/administration-procurement.ts` + spec | M | P2.2–P2.6 | PR statuses, guard sets, schemas, DTOs, action keys and reasons |
| `packages/contracts/src/modules/administration-catalog.ts` + spec | M | P2.1 | `stockTracked` |
| `packages/contracts/src/errors/index.ts` | M | P2.2–P2.5 | §5's eight codes; `ADMINISTRATION_EMPLOYEE_EXITED`'s comment |
| `packages/contracts/src/events/catalog.ts` + `catalog.spec.ts` | M | P2.3–P2.5 | the module's source, name and word |
| `packages/contracts/src/platform/notification-target.ts` + spec | M | P2.W1 | `ENTITY_ROUTES` |
| `packages/contracts/src/platform/audit.ts` | M | P2.0 | `approvalDecision` |
| `packages/contracts/src/platform/approvals.ts` | M | P2.0 | the caption's comment: an uncaptioned rung is named by its level, never by its key (§3 note 1) |

**API module**

| File | C/M | Slice | Purpose |
|---|---|---|---|
| `administration.module.ts` + `.spec.ts` | M | P2.2–P2.7 | keys, page, routes, collection, the file authorizer (P2.6), `scheduledTasks` (P2.7) |
| `administration.seed.ts` | M | P2.2–P2.7 | the year's counter (P2.2); each template in its slice (P2.3–P2.5, P2.7); the request-attachments category (P2.6) |
| `administration.seed.spec.ts` | C, M | P2.3; P2.4, P2.5, P2.7 | every sent template seeded |
| `administration-indexes.ts` + `administration-indexes.spec.ts` | M | P2.2 | the PR model |
| `administration-roles.ts` | M | P2.2, P2.5 | §9.3 |
| `administration.mappers.ts` | M | P2.1; P2.2 | `stockTracked ?? true` on the item DTO; the PR DTOs |
| `administration-scope-guards.spec.ts` | M | P2.2 | the PR repository's fields |
| `shared/document-number.ts` + spec | M | P2.1 | the yearly series and its Cairo-year key; `highestNumberPipeline`, `numberFloorFrom` |
| `shared/cairo-day.ts` | C | P2.1 | re-exports of the contracts' Cairo calendar (`cairoCalendarDate`, `cairoYmd`, the day bounds), nothing copied (design §3.5), as HR's `apps/api/src/modules/hr/shared/business-date.ts:4-10` does; no spec of its own, because the contracts spec covers the calendar (`packages/contracts/src/common/cairo-date.spec.ts:37-40`) |
| `shared/lifecycle.ts` + spec | C | P2.2 | design §5.16's helpers |
| `shared/approvals.ts` + spec | C | P2.3 | the adapter |
| `shared/test-hooks.ts` | C | P2.4 | the race tests' named points, `purchaseRequest.decide.beforeWrite` and `purchaseRequest.return.beforeWrite`, which do nothing in production (§12.2) |
| `catalog/items/item.{model,repository,service}.ts`, `item-audit.ts` + spec, `index.ts` | M | P2.1, P2.2 | `stockTracked`; `itemSnapsOf` over `findByIdsSystem`; the lock check; the exports |
| `catalog/items/item.routes.ts` | M | P2.2 | the widened reads |
| `catalog/items/item-unit-lock.ts` + spec | C | P2.2 | the registry |
| `people/people.service.ts`, `people/index.ts` | M | P2.2 | `self(userId)` over `getSelfDirectoryEmployee` and `resolvePerson` (§6.1), so every person the module names comes through one door (`people/people.service.ts:1-19`); the `ADMINISTRATION_PEOPLE_GRANTS` comment (`:41-44`) rewritten (§14) |
| `procurement/purchase-requests/purchase-request.{model,repository,service,controller,routes}.ts`, `index.ts` | C, M | P2.2; P2.3–P2.7 | the feature; the repository's `pendingApprovalAfter` (P2.7) |
| `procurement/purchase-requests/purchase-request-snapshots.ts` | C | P2.2 | `branchSnap` |
| `procurement/purchase-requests/purchase-request-item-lock.ts` | C | P2.2 | the unit-lock checker, registered at load (§6.2) |
| `procurement/purchase-requests/purchase-request-lifecycle.ts` + spec, `purchase-request-rules.ts` + spec | C, M | P2.2; P2.3–P2.5 | §7, §8.4, §4.4 |
| `procurement/purchase-requests/purchase-request-audit.ts` + spec | C, M | P2.2; P2.3–P2.6 | literal ref, verbs, `signalPurchaseRequest` |
| `procurement/purchase-requests/purchase-request-events.ts` + spec | C, M | P2.3; P2.4, P2.5 | emit helpers |
| `procurement/purchase-requests/purchase-request-notices.ts` | C, M | P2.3; P2.4, P2.5, P2.7 | the sends of §11.1 |
| `procurement/purchase-requests/purchase-request-files.ts` + spec | C | P2.6 | category, authorizer, the three routes' service |
| `procurement/purchase-requests/purchase-request-sweeps.ts` + spec | C | P2.7 | §11.2 |
| `procurement/purchase-requests/purchase-request-guards.spec.ts` | C, M | P2.2; P2.3, P2.4 | §12.1's source-scan guards |

**Platform registries, census, seeds and scripts**

| File | C/M | Slice | Purpose |
|---|---|---|---|
| `apps/api/src/platform/realtime/realtime-registry.ts` | M | P2.2 | the topic |
| `apps/web/src/platform/realtime/invalidation-registry.ts` | M | P2.2 | its row |
| `apps/api/src/workforce-reset/targets.ts` + `targets.spec.ts` | M | P2.2 | `keep` |
| `apps/api/tests/integration/workforce-reset.spec.ts` | M | P2.2 | the list, the count and its comment |
| `apps/api/src/modules/hr/employee-management/employees/employee-name-copies.ts` + spec | M | P2.2 | §6.4, reviewed by HR's owner |
| `apps/api/src/seed-navigation.ts`, `apps/api/src/seed-navigation.spec.ts` | M | P2.W1 | the row and its count |
| `apps/api/src/seed-navigation-administration.spec.ts` | M | P2.W1, P2.W2 | the row, the icon and `ROWLESS` (§12.3) |
| `apps/api/tests/integration/auth-seed-login.spec.ts` | M | P2.W1 | the navigation count and the breakdown (§12.3) |
| `scripts/check-page-registry.mjs` | M | P2.2, P2.5 | its totals (§12.3) |
| `scripts/measure-purchase-request-contention.mjs` | C | P2.3 | criterion 8's staging run: the staging URL and ten focal points' tokens read from the environment, ten 100-line drafts created and then submitted at once, each submission's status and time printed; nothing secret in the file |

**Integration tests**

| File | C/M | Slice | Purpose |
|---|---|---|---|
| `apps/api/tests/integration/administration-purchase-requests.spec.ts` | C, M | P2.2; P2.3–P2.7, P2.W1 | §12.2 |
| `apps/api/tests/integration/helpers/administration-fixtures.ts` | M | P2.2 | linked logins and their placement, chains |
| `apps/api/tests/integration/administration-catalog.spec.ts` | M | P2.1, P2.2 | items |

**Web**

| File | C/M | Slice | Purpose |
|---|---|---|---|
| `apps/web/src/platform/approvals/ApprovalChainPanel.tsx` + spec | M | P2.0 | locale captions |
| `apps/web/src/modules/system-admin/approvals/pages/ApprovalWorkflowsPage.tsx` + `ApprovalWorkflowsPage.spec.tsx` (C) | M | P2.0 | locale names |
| `apps/web/src/modules/system-admin/system-admin-i18n.spec.ts` | M | P2.0 | the verb's pin (§12.3) |
| `apps/web/src/platform/localization/i18n.ts` | M | P2.0; P2.W1, P2.W2 | the verb's labels; `administration.purchaseRequests.*`, `administration.nav.purchaseRequests`, `ItemPicker`'s texts (a caller's keys; `ReferencePicker` names none, P2.W0, design §22 "P2.W0 built") |
| `routes.tsx` | M | P2.W1, P2.W2 | §9.2, and its header table |
| `api/administration-keys.ts` | M | P2.W1 | `purchaseRequests` and its keys |
| `api/catalog-queries.ts` | M | P2.W1 | `useItemSearch` (§9.4) |
| `api/purchase-requests-{api,queries}.ts` | C, M | P2.W1; P2.W2 | calls and hooks |
| `pages/{PurchaseRequestsPage,PurchaseRequestDetailPage,PurchaseRequestEditorPage}.tsx`; `pages/{purchase-requests,purchase-request-detail,purchase-request-editor}-screen.spec.tsx` | C | P2.W1 | §9.2, §9.5 |
| `pages/AwaitingDecisionPage.tsx`; `pages/awaiting-decision-screen.spec.tsx` | C | P2.W2 | §9.2, §9.5 |
| `pages/AdministrationHomePage.tsx`; `pages/home-screen.spec.tsx` | M | P2.W2 | the tile and the two counts |
| `components/ReferencePicker.tsx`; `components/reference-picker.spec.tsx` | C | P2.W0 | §9.4; the picker rendered in each state and the keeper box on it (design §22 "P2.W0 built") |
| `components/EmployeePicker.tsx`; `administration-employee-picker.spec.ts` | M | P2.W0 | moved onto `ReferencePicker`, behavior unchanged; its guard spec (§12.3) |
| `components/ItemPicker.tsx` | C | P2.W1 | §9.4 |
| `components/PurchaseRequestActionDialogs.tsx` | C | P2.W1 | submit, decide (with cuts), return, cancel (§9.5) |
| `components/PurchaseRequestAttachments.tsx` | C | P2.W2 | after `SupplierDocuments.tsx` |
| `components/ItemFormDialog.tsx`, `lib/item-form.ts` + spec | M | P2.W2 | the item's kind |
| `lib/purchase-request-form.ts` + spec | C | P2.W1 | form state mirroring the contracts |
| `lib/refusals.ts` + spec | M | P2.W1 | the new refusal fields and details (§4.4) |
| `apps/web/src/shared/lib/errors.ts` + `errors.spec.ts` | M | P2.W1 | `FRIENDLY`, en and ar |
| `apps/web/src/shared/lib/remembered-filters-coverage.spec.ts` | M | P2.W1, P2.W2 | the new pages |
| `administration-routes.spec.ts`, `administration-{i18n,api-contract,realtime}.spec.ts` | M | P2.W1, P2.W2 | the guard specs (§12.3) |

**Docs**

| File | C/M | Pull request | Purpose |
|---|---|---|---|
| `docs/12-planning/administration-module-phase-2.md` | C, M | this docs pull request; the second drift check's docs pull request; P2.4 and P2.7; P2's closing docs pull request; a pull request that deviates | this re-detail; the second drift check's differences (§3); PRQ-1's, PRQ-2's and PRQ-4's answers in P2.4 and P2.7, the slices that carry them, and PRQ-3's, which changes no code, in the closing docs pull request (§2); a deviation, in the pull request that makes it, P2.W1's UI pass included (§9.2) |
| `docs/12-planning/administration-module-decisions-and-phases.md` | M | this docs pull request; the second drift check's docs pull request; P2.4 and P2.7; P2's closing docs pull request | design §22: re-detailed, with this review; the second drift check (§3); design §16.12, PRQ-1's, PRQ-2's and PRQ-4's answers (P2.4, P2.7) and PRQ-3's (closing); criterion 8's figures, the owner's acceptance and P2's closing entry, in the closing docs pull request, after P2.W2 has merged and the staging run is done |
| `docs/12-planning/automation-module-design.md` | M | P2.4 | `:257` (§10.3) |
| `CHANGELOG.md` | M | each code pull request | `[Unreleased]` |

## 14. What P2 does not touch

- **RFQs, POs and their effects.** No PO claim, no remainder cancel, no close, no `.closed` event, no open-claim
  checker, no OD-28.3 check (§1.2 item 14), no awaiting-sourcing queue (P3), no `orderStatus` filter on the register
  (P4).
- **Papers, exports, settings, sections.** No print path or `.print` key (OD-59 A); no export (§2); no
  `administration.settings.ts`, so `settings-inventory.spec.ts` and `SettingsPage.spec.tsx` are untouched; no
  navigation section (OD-62 A).
- **The approval engine.** No file under `apps/api/src/platform/approvals/` changes: PX-1 is its own phase. No
  re-route act and no per-rung holder lookup (design §5.2).
- **Platform permissions.** No file under `apps/api/src/platform/rbac/` or `packages/contracts/src/permissions/`
  changes, so the permission-matrix check has nothing to regenerate and the CODEOWNERS second-reviewer paths are not
  touched (`.github/CODEOWNERS:9-13`).
- **Platform web beyond P2.0.** PC-7 (requester liveness from notices), PC-11 (the shared export code) and PC-5
  (binary downloads that send the top bar's branch) do not land in P2.
- **HR.** No ESS key: OD-16 A's requester is a department focal point, so OD-16 B's employee self-service requester
  gets none. No HR import (`administration-isolation.spec.ts`). The one HR file P2 edits is the name census, with its
  spec (§6.4). Leave, its routes and its suites are unchanged.
- **Stock.** No movement, balance or warehouse document. `stockTracked` changes no rule (§6.2).
- **People.** `ADMINISTRATION_PEOPLE_GRANTS` does not grow (`people/people.service.ts:45-48`), although its comment
  says the list "grows with each document that names a person, by its create key" (`:41-44`): under OD-16 A the
  requester is the caller, read through `self`, so no picker names a person. P2.2 rewrites the comment to say so.
- **Entrypoints.** No CLI and no boot step: `server.ts`, `worker.ts`, `sync-indexes.models.ts` and `tsup.config.ts`
  are untouched.

## 15. Migration posture

- **No migration.** The new collection, its indexes, its yearly counter rows, the request-attachments category, the
  templates and the new bundle are created by the module's create-if-missing seed and by its writes. There is no
  backfill and no boot step.
- **Items.** Rows written before P2.1 lack `stockTracked` and read it as `true`, today's behavior; no row is rewritten.
- **The owner's rule.** No destructive operation and no production migration runs without the owner's explicit
  approval («لا تعمل destructive operation أو production migration بدون موافقتي الصريحة», design §0, D-17). P2 needs
  neither.
- **Deploy.** P2.0 deploys at least one release ahead of P2.4, the verb's first writer, or P2.4's API and worker
  deploy together (RK-29), because an old worker refuses a job with an unknown verb (§10.2). The P2.0 row, §10.2 and
  P2-R2 refer here.
- **Rollback** (RK-30). Each pull request rolls back as a whole.
  - The boot sync then deletes the keys no longer declared (`apps/api/src/platform/rbac/rbac.service.ts:591`).
  - The navigation row, the collection, its counter rows, the category and the templates stay.
  - A rolled-back P2.4 leaves PRs in `pendingApproval` that nobody can decide until it is redeployed, and a rolled-back
    P2.3 leaves submitted PRs readable.
  - Any cleanup of data is an operator act, approved by the owner (design §15.3.7 class 3), never a side effect of the
    rollback.

## 16. Exit criteria

Design §18.3's P2 row (`administration-module-decisions-and-phases.md:2230`), made checkable, with thresholds, and
with one premise corrected: criterion 6 has the requester refresh live now, where the row waits for PC-7 (§1.2 item
20). Each names what shows it.

1. **Decided on a written chain.** The integration file writes a two-rung `administration.purchaseRequest` chain
   through `PUT /api/v1/platform/approvals` and drives a PR through `pendingApproval` to `approved` and, separately, to
   `rejected` (§12.2).
2. **OD-19 A at the PR's own Unit.** No chain, no staffed rung and a live rung held only by the A1 set are each refused
   422 `ADMINISTRATION_APPROVAL_CHAIN_MISSING`, with their details, and a chain written for another department does
   not apply (§12.2, P2.3's submission cases).
3. **The pairs.** A1 is refused 403 `ADMINISTRATION_SEPARATION_OF_DUTIES` for the requester holding `.approve`, an
   override and a delegated `.approve`; B1 for rung 0's decider holding rung 1, holding an override, and for a delegate
   who decided rung 0; B1 resets in a second round, and binds an override's second empty rung (§12.2, P2.4). The source
   scan pins A1 in decide and return, and B1 in decide. A colleague's edit (P2.2), submission (P2.3) and attachment
   write (P2.6) on another's draft are refused 403.
4. **Concurrent decisions.** On rung 0 of a two-rung chain, of two decisions interleaved by the hook exactly one
   appends: one entry, one `approvalDecision` row, and the other caller gets 409 `STALE_DOCUMENT`. On the settling rung
   the loser gets 422 `ADMINISTRATION_APPROVAL_NOT_PENDING` (§8.3 step 6).
5. **Approvers are notified.** The submission and the decision that leaves the chain `pending` each send exactly one
   awaiting-decision notice to each eligible approver of the live rung, and none to the A1 set; a decision that leaves
   the PR stuck sends the stuck notice to the audience of PRQ-2 (b) (§12.2, P2.3 and P2.4). The seed-coverage spec finds
   every sent template seeded.
6. **The requester's screen.** Under OD-16 A the requester's department-scope `.view` joins the branch room, so the
   register and the record refresh on the decision's signal (§1.2 item 20); the audit spec pins the signal after every
   act. An approver with `.approve` alone refreshes on navigation and after `staleTime`, 30 s, until PC-7 lands.
7. **Gap-free numbers.** Ten drafts submitted at once in one series take ten consecutive numbers; a submission refused
   between them takes none; a returned PR keeps its number. The year boundary cases of
   `shared/document-number.spec.ts` pass.
8. **Series contention (RK-33).** On staging, before P2 closes, ten concurrent submissions of 100-line PRs in one
   series all commit, none exhausts the driver's 120 s retry, and the slowest commits within 5 s. That is design
   §18.3.2's threshold for P5's postings (`administration-module-decisions-and-phases.md:2285-2286`), the only measured
   threshold for a numbered write, borrowed here. `scripts/measure-purchase-request-contention.mjs` runs it (§13), and
   the figures are recorded in design §22. A miss is put to the owner with OD-58 B, a series per branch, before P2
   closes.
9. **CI and boot.** Every P2 pull request is green within the 45-minute job and reports its minutes. The page
   registry's totals reach §12.3's, in `scripts/check-page-registry.mjs`, the CI half of the check boot also runs
   (`scripts/check-page-registry.mjs:1-8`). The module spec validates the manifest, its keys, page and scheduled task,
   and pins the surface.
10. **Census.** The workforce reset keeps `administration_purchase_requests` (the untouched list and the recruitment
    count of §12.3), and HR's permanent delete scrubs `requesterName` (§12.3's copy count); both specs and the
    integration suite are green.
11. **Navigation.** §12.3's row count. A role holding only the department requester bundle sees exactly the PR row
    through `GET /platform/me/applications`; the super-admin sees the module's rows of §12.3's breakdown.
12. **Audit.** Every decision writes one `approvalDecision` row on the PR after its commit, carrying the engine's
    audit changes, and the engine writes none for the type.
13. **Language.** Every new code has en and ar words in `FRIENDLY`; the formal-Arabic, placeholder and module i18n
    specs are green. The approval panel shows each rung's caption in the reader's language, else its level's name,
    which is what a chain written at `/system/approvals` shows, since that screen writes no caption (§1.2 item 27),
    and no rung key; its override line keeps the key it records (§3, note 1). The record's earlier rounds name a rung
    by its `stepLabel`, else "Step n" (§8.6). The chain screen names request types, departments and branches in the
    reader's language, in its list and its editor, and keeps the rung keys an administrator configures. Person names
    are shown as recorded, Arabic first (D-22; `approval.service.ts:585-600`). The panel's and the chain screen's specs
    show it (§12.3).
14. **Docs.** CHANGELOG entries, the automation design's correction, PRQ-1's to PRQ-4's answers in design §16.12 once
    given, the second drift check's entry (§3) and design §22's closing entry.
15. **Owner acceptance.** With §2's setup in place, the owner raises, approves on a two-rung chain, returns, rejects and
    cancels PRs on staging, and accepts the result; the date and the owner's words are recorded in design §22.

## 17. Risks

Likelihood (L) and impact (I) are H, M or L, judged before mitigation, as design §17 rates them
(`administration-module-decisions-and-phases.md:1948`).

| # | Risk | L | I | Mitigation |
|---|---|---|---|---|
| P2-R1 | **PX-1 slips**, and P2 waits: OD-20 A ships no stopgaps | M | M | PX-1's own plan and gates; P2's pull requests are written against ADR-041's interface, so only their order waits; the second drift check (§3) compared the engine PX-1 built with that interface on 2026-11-25, found no difference that needs an engine change, and folded its differences into this re-detail (§1.2 E) |
| P2-R2 | **A worker refuses `approvalDecision` jobs** after a deploy that skips the verb's order (RK-29) | L | M | §15's deploy order |
| P2-R3 | **Stuck requests on small branches.** A1, B1 and one desk per level can leave a live rung with nobody eligible | M | M | refused at submission when it is the live rung, even with a staffed rung above; the remedy is a second person on that rung, the rung removed from the chain, or another focal point raising the PR (§8.2 step 4). After a decision, the stuck notice and the daily sweep; an override within reach or a cancel moves it (§8.6). A PR whose last k rungs are empty needs k different override holders, because B1 binds overrides; staffing a rung, which the engine reads live under the pin, or a cancel are the other ways out (§8.4) |
| P2-R4 | **Approvers without `.view` see no live change** | M | L | navigation and `staleTime`; the notices; PC-7 when platform review accepts it |
| P2-R5 | **Series contention** (RK-33) on `purchaseRequest:{YYYY}` | L | M | criterion 8's staging measurement; OD-58 B, a series per branch, if it misses |
| P2-R6 | **A number takes the wrong year** at the turn of the Cairo year (RK-13) | M | M | one instant for key and date; boundary specs; the sweep's dates in Cairo |
| P2-R7 | **HR's census file changes without HR's review**, since this module edits it | M | L | reviewed by HR's owner (design §18.1); its spec pins the list |
| P2-R8 | **Names in the trail stay after HR's permanent delete** (RK-34) | M | M | recorded gap, the cost of the snapshots design §2.1 fixes (§6.1); `requesterName` scrubbed (D-22) |
| P2-R9 | **Pull requests above 500 lines** | H | L | each states its size and why its files travel together (design §18.4) |
| P2-R10 | **The zod waiver ends on 2026-12-26** (`scripts/dependency-audit.waivers.json`), which may fall inside P2 (RK-09) | M | H | the owner renewed it on 2026-11-24 for 30 days («موافق على Zod», `scripts/dependency-audit.waivers.json:7-8`); whoever runs P2 asks the owner by 2026-12-19 to renew it again under review, or the zod 4 migration lands as its own change before that date |
| P2-R11 | **PRQ-1 to PRQ-4 answered otherwise** | M | L | PRQ-1 changes the return, PRQ-2 the recipients of the approved and stuck notices, PRQ-3 no code, PRQ-4 pair B1's check (§2) |
| P2-R12 | **CI runs past its 45 minutes** (RK-01) with one more integration file | M | M | one file for the phase; races deterministic through the hook; minutes reported |
| P2-R13 | **The Unit moves under a pinned PR.** The rungs are pinned, but the Unit's catalog id is read live, so an org-catalog link or merge changes who staffs a rung | L | M | accepted by ADR-041 decision 4 (staffing stays current); the copy-in-branch guard; the stuck notice catches a rung left empty |
| P2-R14 | **Notices silently not sent** (RK-22) | M | M | every template seeded; the seed-coverage spec |
| P2-R15 | **Scope widens** on an undeclared field (RK-15) | M | H | declared fields; section read as own; the scope-guard spec; the department, branch and delegated cases of §12.2 |
| P2-R16 | **Approved PRs have no exit in ECMS before P4.** Procurement buys outside ECMS; P3's queue would then list those PRs as open needs, or they are cancelled although bought | M | M | PRQ-3: under its recommendation no PR role is assigned in production before P4; under its other answer each PR bought is cancelled with a reason that says so, and P3's re-detail decides how its queue treats PRs approved before P3 |
| P2-R17 | **A requester moved after create loses their own draft.** Their grants then cover the new copy, and item 22 keeps colleagues off the old draft | L | L | a `.cancel` holder ends it and the requester raises a new PR from the new copy (§4.2); HR's transfer moves the login's placement with the employee's (`employee-action.service.ts:652-669`), so the case arises only from a transfer |

## 18. Review

Design review of this re-detail, **Full** preset, 2026-11-25, as the design-review skill runs it
(`.claude/skills/design-review/SKILL.md`), modeled on PX-1's record (`administration-module-phase-px1.md:767-819`). The
feature range is the front matter to §2; the detailed range starts at §3, the delivery plan. The review is the gate
before P2.0, P2's first code pull request.

- **Reviewers run.** A `egm-zoom-out`; B `egm-comprehension`; C `egm-design`, `egm-structural` and `egm-style`; the
  fixes; D `egm-zoom-out`, with A's findings; E `egm-implementation-readiness`, `egm-codebase-details` and
  `egm-style`. Not run: none.
- **Dropped under (a)–(d).**
  - Round 1: one finding, under (a): that P2.4 and P2.7 might merge before the owner answers PRQ-1 and PRQ-2; the
    owner's instruction of 2026-11-24 («بص اعمل انت الـ Recommendations…», §2) lets each slice build its
    recommendation. One part of another, under (a): `stockTracked` as a later phase's feature, since OD-14 C is P2's.
  - Round 2: four parts of findings. Under (d): that an exited requester can still submit, since HR's exit suspends
    the login (`apps/api/src/modules/hr/employee-management/employee-actions/employee-action.service.ts:6-7`); that
    only the Arabic label of `approvalDecision` is given, since the catalog line carries both
    (`packages/contracts/src/events/catalog.ts:872`); that an attachment link's effect on `__v` is open, since the
    supplier link bumps it. Under (a): exempting overrides from pair B1, which OD-21 B's pairs bind (design §6.6); the
    risk it shows went to the owner as PRQ-4. One more part was softened: approvers holding `.approve` alone also reach
    the home through a record's breadcrumb.
- **Round 1 (A–C): 76 findings; 74 fixed, 1 escalated, 1 dropped.**
  - *Fixed.* Terms gained the live rung, the first unsettled rung, the A1 set, the department copy, the concurrency
    classes and the register ids; "PR" never means a pull request, and the plan's columns say "Slice". The drift
    check maps to §1.2's items, and a second drift check reads the merged engine before P2.0 (§3). §1.2 states its
    departures and their rejected alternatives: item 17's reading of ADR-041 decision 3, item 19's return gate, item 9's
    top-bar check, and item 22's draft owned by its requester. The start gate waits on Phase 1's criterion 9. PRQ-1
    removes a fully cut line and records the fold; PRQ-2's audiences can open what they are told about. §12.3 holds
    the counts; design references carry "design".
  - *Escalated.* PRQ-3, whether PRs are used in production before P4; recommended: not before P4.
- **Round 2 (D–E): 72 findings, 2 Blocker, 32 Major and 38 Nit, merged by the verifier into 56 groups; all fixed.**
  - *Keys and slices.* `.approve` is declared in P2.2, so P2.3's chains can name it and P2.6's reader case holds
    (§9.1). The whole lifecycle table ships in P2.2, spec 5 carrying the one key not yet declared until P2.5 (§7).
    `ENTITY_ROUTES`' PR route moves to P2.W1, which mounts the record (§5). A web slice, P2.W0, moves `EmployeePicker`
    onto `ReferencePicker` alone, with its guard spec (§3). The automation correction moves to P2.4.
  - *Authority.* Decide and return try `.approve`'s scope, then `approval.override`'s (§8.3). The file authorizer
    writes only on a draft, so the platform's file paths cannot change a submitted PR's files (§4.3). The detail's
    trail is null on a PR with no pin and offers no decision outside `pendingApproval` (§8.6). B1 binding overrides
    means one override holder per empty rung, stated, tested and put to the owner (§8.4; PRQ-4).
  - *Contracts.* A refusal table with every code and detail, and `availableActions`' keys and reasons (§4.4); the list
    query's encodings and bounds, the summary DTO, the line semantics of a draft edit, `neededBy`'s format and the
    schema names (§4.1, §5, §6.5). The PR is filed on its department copy's branch, with a placement check (§4.2);
    the snapshot builders are named (§6.1); an exited requester reuses `ADMINISTRATION_EMPLOYEE_EXITED`.
  - *The sweep and the notices.* The task's declaration, cron and paging (§11.2); the stuck audience chosen from the
    rungs left, which the host can read, and the idempotency key carrying the rung (§11.1, PRQ-2); the templates'
    wording.
  - *The web.* The home's tile and counts against the page's own rules, and how approvers reach PRs (§9.2); what
    each page and dialog shows, the editor's route made final, and the remembered-filter classes (§9.4, §9.5);
    criterion 13 narrowed to what P2.0 changes, which now includes the chain screen's selects.
  - *Tests and files.* The cases the verifier listed (§12.2); the spec pins and comments that change (§12.3); the file
    list completed as a write allowlist, the docs rows naming each pull request (§13).
  - *Wording.* §7's opener, "every write on an existing PR", the `approvalSteps` note, criterion 6's correction of
    design §18.3's P2 row (§1.2 item 20, which replaces the withdrawn `.edit` widening of the item reads), the
    walker's description (§6.4), the risk table's columns and titles, and repeated or off-by-one pins.
- **Contested, accepted, declined, open.** None.
- **Escalated.** PRQ-3 (round 1) and PRQ-4 (round 2), with PRQ-1 and PRQ-2 from the draft: four questions, none
  answered yet (§2). P2 does not wait for them; each goes to the owner before the slice that carries it merges.
