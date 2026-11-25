# Changelog

All notable changes to the ECMS Platform are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions
follow the platform-manifest semver described in
[Development Workflow §6](docs/09-guides/development-workflow.md). Each sprint-closing PR adds
its entry here in the same PR.

## [Unreleased]

### Added

- **Roles: quick selection by permission type, and a full-width role form** (`/system/roles`).
  «جنبها الصلاحيات فى جروبات أقدر أحددها مره واحده .. مثلاً قراءة فقط .. تعديل فقط».
  - Beside the permission tree, «تحديد سريع حسب النوع» ticks every permission of one type over every
    module or one chosen module: View (read only), Add, Edit, Delete, Export/print/download, Import,
    Approvals and decisions, Manage lists and settings, Workflow actions, Sensitive data,
    Exceptional permissions. Each shows the same tri-state and «x من y» counter as the tree; a
    second press clears the type.
  - The type is the registry's own `action` (`lib/action-groups.ts`), corrected by name where the
    action understates the key. «البيانات الحساسة» holds pay and payroll (runs, adjustments,
    loans, payroll reports, the contract paper), medical files and the pre-hire medical and
    security checks, national IDs, the audit log (its rows carry pay amounts), machine keys and
    the safe-door combination, a fuel card's password — none of it is part of View or Export.
    «الصلاحيات الاستثنائية» holds every break-glass key and the two overrides (another's approval
    step, rehire against ineligibility). The status alias that suspends an employee sits with
    Manage, and the two portal-only grants belong to no type. An action the table does not name
    falls to Workflow actions. 449 permissions on 2026-11-25: 97 View, 67 Add, 65 Edit, 37 Delete,
    13 export, 5 import, 23 approve, 65 manage, 45 workflow, 22 sensitive, 8 exceptional.
  - It goes through the tree's own `applyBulk`, so it reaches only what the administrator may
    grant and never clears a carried key he could not have given; the payload and the server's
    guards are unchanged.
  - The role form is the width of the screen with one scrollbar (the list no longer scrolls inside
    the form), the quick selection stays in view beside the tree (whole, at 1280×720 and up), the
    permission rows run four columns on a wide screen, and a click outside no longer closes a
    half-built role (× and Escape do).

- **Compliance and Risks — a new module, «الالتزام والمخاطر», with one page: «الملفات»**
  (`docs/12-planning/compliance-files-design.md`). Folders on a shelf shaped like HR's
  «مستندات المتقدمين», drawn with the module's own copy of that folder.
  - **The responsible person** (`complianceFile.manage`, the seeded role «مسؤول ملفات الالتزام
    والمخاطر») makes folders, names and renames them, puts a picture on each, chooses which active
    employee accounts see each one, uploads PDF, Word and Excel files of up to 20 MB, renames and
    deletes them — and sees, per file, who has seen it, how many times they opened and downloaded
    it, and when.
  - **A person a folder is shared with** sees only the folders whose list names them (anyone else is
    answered 404) and may only view and download. «الملفات» appears in their sidebar because the
    module gives them the reader role with the first folder shared and takes that grant back with
    the last (`rbacService.removeAssignment`, new); the boot reconciles both directions.
  - **Every opening and download is recorded** through the module's own endpoints, which are the only
    way a reader reaches the bytes. Word and Excel files are viewed in the page — headings,
    paragraphs, tables and sheet rows read on the server under the zip and XML rules every workbook
    read follows; a PDF opens in a new tab.
  - A file's type is decided by its extension and checked against its first bytes; Arabic file names
    are kept. Refusals: `COMPLIANCE_FOLDER_NAME_TAKEN`, `COMPLIANCE_VIEWER_INVALID`,
    `COMPLIANCE_FILE_CONTENT_MISMATCH`.
  - Navigation: the «الالتزام والمخاطر» tile (a shield) and its «الملفات» row, opened by either key.
    The seeded navigation now holds 146 rows.

### Fixed

- **ATM done pages no longer hang the system (2026-11-25).** «السيستم كان مهنج». From 12:00 Cairo a
  done-maintenance page over 1–25 November for one branch (29,500 closed rows) asked for up to 200
  pages at once, and each page sorted the whole range in memory on the database (Atlas slow log:
  29,500 keys and documents examined per 100-row page), so every screen waited behind it.
  - Indexes in the done pages' own order on both operation logs (`ix_branch_done_range`,
    `ix_done_range`), built at boot.
  - `GET /atm/{replenishments,maintenances}/done/range` reads the range in chunks of 5,000, each
    continuing where the last stopped; the done pages read the whole range that way, with no cap
    («عايز إمكانية إنى أستخرجهم كلهم»), so the Excel and PDF are the whole period.
  - The done tables and the mail log show 100 rows a page (50–500); the column filters, the sort and
    the files still cover every row («تظهرهم عادى على صفحات فى الجدول»).
  - The remaining whole-list walks (mail log, machine export) keep at most 4 pages in flight.
  - Two guards that hold whatever a browser does: the done reads (the chunked one, and the paged
    one a tab still on the old bundle asks for until it reloads) give up after 15 s instead of
    running on for minutes after the browser left; and a database error while checking a request's
    user is answered as the error it is — no longer as 401 «User no longer exists», which sent every
    open tab to refresh at once and got thirteen sessions revoked as token reuse.

- **Accepting or restoring a mail ticket no longer reads the branch's whole maintenance log.** The
  read of a ticket's maintenances inside the accept and restore transactions (`findFromTicket`)
  must see deleted rows too, so it could not use `ux_maintenance_per_mail_ticket`, which leaves them
  out. It walked `ix_branch_closed` over the ticket's branch instead: ~39,000 keys and 0.2–0.3 s per
  ticket on 2026-11-25 (Atlas slow log). A new partial index, `ix_maintenance_from_ticket`
  (`{ mailTicketId, branchId }` over every row opened from a ticket), built at boot, holds it; the
  read states the index's predicate (`$type: 'objectId'`), which the planner does not infer from an
  equality, and now reads the ticket's own rows only.

- **The approvals engine: a chain save names its request type's keys and the chain it replaces.**
  This is PX-1.6, the last of PX-1's pull requests, which harden the platform approvals engine
  before Administrative Affairs' money approvals run on it
  (`docs/12-planning/administration-module-phase-px1.md` §3, §4, §6.7 and §10; ADR-041 decision
  9). It fixes R9 of the engine defects the design lists
  (`docs/12-planning/administration-module-decisions-and-phases.md` §15.2.1): a save took any key
  the permission registry held, and any key at all while that registry was empty, and it carried
  no version, so a save from a screen loaded before another administrator's save overwrote theirs
  without a word.
  - **Keys.** Each rung must name one of its request type's `permissionKeys`, the keys the chain
    screen offers, also while the permission registry is empty; any other key is refused 422
    `approvals.unknownPermissionKey`. The permission-registry and repeated-rung checks stay.
  - **The chain it replaces.** `PUT /api/v1/platform/approvals` takes a required `basedOn`: the id
    and version of the chain row the screen's draft started from, or null when the screen showed
    none at that place. `ApprovalWorkflowDto` gains `version`. A save is refused 409
    `STALE_DOCUMENT` when the place's row is another row or at another version, when a row is
    there and `basedOn` is null, and when none is and `basedOn` names one. A row deleted and
    written again at the place has a new id, so a save based on the old one is refused although
    both start at version 0. Two first saves at once, and a save whose row is deleted after the
    server read it, get the same 409. A body without `basedOn` is refused 400. Deleting a chain is
    unchanged and carries no version (ADR-041 decision 9).
  - **Stored rungs on another key.** A rung on a chain row, or in a request's pin, whose key is not
    one of its type's current keys is unstaffed: nobody's grants put them on it, so it is passed
    only on the way to a staffed rung above it, and with none above it the request waits
    `unstaffed` until an override that reaches the rung's level decides it. Such a chain is refused
    at its next save until the rung is removed.
  - **The chain screen** sends `basedOn` for the chain it shows: the row the screen listed at the
    draft's request type and place when the dialog was opened, or null where it listed none, by
    one rule for a new chain, an edit and a draft moved by its selects. So a new chain opened where
    a chain is listed replaces that chain when saved, as before. A stale save is refused with the
    stale-record message, in English and Arabic, in the dialog as in the toast, and the list behind
    the dialog is re-read: the chain is then opened again with Edit, which names the row as it now
    is, and saved.
  - **For HR leave,** the engine's only host: a stored `hr.leave` rung on any key but
    `leave.approve` is unstaffed from this release, so its key's holders no longer decide it, and a
    request waits past it on the next staffed rung or, with none, `unstaffed` for an override within
    reach. The chain screen has only ever offered `leave.approve`, so such a rung was written some
    other way; count C3 (re-detail §10) says how many chains hold one, and is reported before this
    merges. Leave's own code, routes and requests are unchanged.
  - **Deploy.** The `PUT` body changes, so the API and the web deploy together. A chain-screen tab
    opened before the deploy sends no `basedOn`, and its save gets a 400 until the tab is reloaded.
  - `approval.service.spec.ts` rewrites its R9 cases to the fixed save and adds stored rungs on
    another key, on a chain row and on a pin; `apps/api/tests/integration/approvals.spec.ts` gains
    four cases, and its earlier saves now name their row; `chain-basis.spec.ts` covers the
    screen's basis; the web contract spec checks `basedOn` in the schema and in the page, and no
    longer says that a rung nobody holds approves everything. With this pull request PX-1 closes
    (design §22).
  - Rollback (RK-30): reverting restores the unchecked save and leaves nothing stored behind; the
    web rolls back with the API, because the older schema refuses the newer screen's `basedOn` as
    an unknown key.

- **The approvals engine: the after-commit audit is opt-in per request type.** This is PX-1.5 of
  PX-1, which hardens the platform approvals engine before Administrative Affairs' money approvals
  run on it (`docs/12-planning/administration-module-phase-px1.md` §3 and §6.6; ADR-041 decision
  7). It fixes R5 of the engine defects the design lists
  (`docs/12-planning/administration-module-decisions-and-phases.md` §15.2.1): `decide` recorded
  every decision as `platform/approval` before the host's own write, so a decision the host then
  refused left its row behind, and the row's only link to the host's document was the HTTP request
  id.
  - **The option.** `registerApprovalRequestType(type, { audit: 'host' })` declares, for one
    request type, that its host records each decision; the default is `'engine'`, and one module
    may register types of both kinds. The request-type registry keeps the option beside the type:
    `listApprovalRequestTypes`, which feeds the chain screen, and `getApprovalRequestType` return
    the type as before, without it. Re-registering a type replaces its option.
  - **What `decide` returns.** It always returns `auditChanges` as well: the decision, its rung's
    index, level and key, `overriddenWith` and the rungs it covers, the change rows the engine's own
    row carries. For a `'host'` type it records nothing, and the host records one row on its own
    document, with its own verb, after its commit, so a decision its host refused leaves no row. A
    process that stops between that commit and the record leaves the decision with no audit row,
    and the document's own trail is then its record (ADR-041 Consequences). For an `'engine'` type
    it records as before.
  - **For HR leave,** the engine's only host: nothing changes. Leave registers without the option,
    so the engine still writes its `platform/approval` row before leave's write, beside leave's own
    `leaveDecision` row, and a decision leave then refuses can still leave that row behind. Moving
    leave onto the option is a separate HR slice (design §18.3.1 item 5). No host registers
    `'host'` yet; Administrative Affairs' types will, from P2.
  - `approval.service.spec.ts` gains the `'host'` cases, run through a stub host that commits and
    then records, and `request-type.registry.spec.ts` the option's. The registry's comment no longer
    says that a chain built on a key nobody holds approves everything.
  - Rollback (RK-30): reverting removes the option and `auditChanges` and leaves nothing stored
    behind; no host registers `'host'` yet, so every decision is audited as it is now.

- **The approvals engine: a request is decided on the chain it was submitted on.** This is PX-1.4
  of PX-1, which hardens the platform approvals engine before Administrative Affairs' money
  approvals run on it (`docs/12-planning/administration-module-phase-px1.md` §3, §5, §6.5 and §10;
  ADR-041 decisions 4 and 10). It fixes R1, the engine defect of a chain read again at every call
  (`docs/12-planning/administration-module-decisions-and-phases.md` §15.2.1): a request's decisions
  are kept by rung number, so an edit to its chain laid them over other rungs, and a deleted or
  deactivated chain fell back to a wider one or to none.
  - **The host pins the chain at submission.** A host stores the row `chainFor` chose and its rungs,
    captions included, in two fields it declares by spreading the engine's `approvalPinFields`
    (`approvalWorkflowId`, null while not pinned, and `approvalChainShape`, in the chain row's own
    rung schema; an id with no rungs is refused). `pinOf` turns `chainFor`'s answer into the pin, and
    `readApprovalPin` reads it back from the host's document. `ApprovalSubject` gains `pin`: with one,
    `statusFor`, `trailFor`, `decide` and `currentApprovers` take the rungs and captions from it and
    read no chain row; who stands on each rung is still read at every call. A pin with no rungs
    reads `noChain`. With `pin: null` they read the chain that applies now, as before.
  - **For HR leave,** the engine's only host: a request submitted on a chain from this release
    stores its pin in the same write that stamps it `pendingApproval` (`approvalWorkflowId` and
    `approvalChainShape` on `hr_leave_requests`, no index), and hands it to the engine for its
    decision, its trail and its notice. A chain edit no longer moves a request already submitted:
    an administrator's edit, deactivation or deletion of a chain applies to new submissions only,
    and the request keeps its rungs, their captions on its chain panel, and the decisions taken on
    them. A request submitted after a chain is deleted takes the next wider chain that applies,
    or, with none, leave's manager and HR path, as before. Requests already waiting in `pendingApproval` have no pin and keep reading their chain
    live, so an edit can still move them; nothing is backfilled, and no migration, command or boot
    step ships. Who stands on a rung still follows the employee's current placement. Leave's
    submission rule, its manager and HR path, its notices, its audit and its API are unchanged.
  - Rollback (RK-30): reverting leaves the pin fields on requests written meanwhile; the older code
    ignores them, and those requests read their chain live again.

- **The approvals engine: only grants in force decide, and only active accounts staff a rung.**
  This is PX-1.3 of PX-1, which hardens the platform approvals engine before Administrative
  Affairs' money approvals run on it (`docs/12-planning/administration-module-phase-px1.md` §3,
  §6.3 and §6.4; ADR-041 decisions 5 and 8). It fixes two more of the engine defects the design
  lists, R3 and R8 (`docs/12-planning/administration-module-decisions-and-phases.md` §15.2.1).
  - **Only grants in force decide (R3).** The rungs a reader stands on are read from the role
    assignments in force now (`findInForceForUsers`), the validity window RBAC's effective
    permissions apply and staffing already read. A grant whose `validTo` has passed, or whose
    `validFrom` has not come, no longer offers its holder a decision, on its own rung or early over
    the rungs below it. `decide` refuses its holder `approvals.notYourStep`, unless another grant in
    force puts them on a rung at or above the waiting one, or they also hold an `approval.override`
    that reaches the rung to decide, which then decides it as an override, recorded
    `overriddenWith` (PX-1.2). `findActiveForUser` stays unfiltered for its other readers, among
    them the effective-permissions screen (ADR-026 SA-4). Delegated grants carry no validity window
    and are read as before (ADR-032).
  - **Only active accounts staff a rung (R8).** `approversFor` keeps only the holders
    `userRepository.activeIdsAmong` returns, the account predicate sign-in and the last-Super-Admin
    guard share (ADR-026 SA-6), whether a role assignment or a delegation put them on the rung: an
    `invited`, `suspended`, `archived` or deleted account no longer stands on it. It is one id-only
    read per distinct key and level, inside the staffing memo `chainFor` already keeps. A rung held
    only by such accounts is unstaffed, so it is passed when the holder of a later rung decides,
    and a chain with no staffed rung left reads `unstaffed` (PX-1.2).
  - **For HR leave,** the engine's only host: an expired or not-yet-started `leave.approve` grant no
    longer offers Approve and Reject on a request or decides it, and its holder is refused
    `approvals.notYourStep`. Two things still let that holder decide: another `leave.approve` grant
    in force that puts them on a rung at or above the one the request waits on, which decides as
    their own rung; and an `approval.override` they also hold that reaches the rung, which still
    shows Approve and Reject and decides it as an override, recorded `overriddenWith`. A suspended
    or archived approver, or one never activated, is no longer counted as staffing a rung or
    notified of a request: the request waits on the next rung an active account holds, whose
    holders are notified instead, and the passed rung reads `skipped` once that holder decides; a
    request whose remaining rungs only such accounts hold waits `unstaffed` for an override within
    reach. Leave's own code is unchanged: its submission rule, its manager and HR path, its inbox
    and reminder, which read `leave.approve` themselves, and its audit.
  - `apps/api/src/platform/approvals/approver-lookup.spec.ts` is the lookup's first spec;
    `apps/api/tests/integration/approvals.spec.ts` gains a case for each fix.
  - Rollback (RK-30): reverting restores the unfiltered reads and leaves nothing stored behind.

- **The approvals engine: a request nobody can decide no longer reads approved, and an override
  decides only within its reach.** This is PX-1.2 of PX-1, which hardens the platform approvals
  engine before Administrative Affairs' money approvals run on it
  (`docs/12-planning/administration-module-phase-px1.md` §3, §6.1 and §6.2; ADR-041 decisions 2,
  3 and 6). It fixes two of the engine defects the design lists, R2 and R4
  (`docs/12-planning/administration-module-decisions-and-phases.md` §15.2.1).
  - **No chain and no staffed rung are answers of their own (R2).** A chain now reads `pending`,
    `approved`, `rejected`, `unstaffed` or `noChain`, and `chainFor` returns that answer at
    submission. Approved means every rung is settled. A chain with rungs left that nobody holds
    reads `unstaffed`, and a request no chain applies to reads `noChain`; both read approved before.
    An approval no longer closes the empty rungs above it: an empty rung is still passed when the
    holder of a later rung decides, and only then. The trail's `currentStep` marks the rung to
    decide on an `unstaffed` chain too, the first rung nobody holds, so the screen shows where the
    request stopped.
  - **An override reaches as far as the rung's level asks (R4).** `approval.override` decides an
    organization rung only at organization scope, a department rung only over that department in
    every branch, a branch rung only over that whole branch, and a unit rung only over that
    department in that branch; `own` and `section` reach none, and below organization scope a rung
    whose request lacks the place its level names fails closed (`override-reach.ts`). An override
    held at any scope decided any rung before. On an `unstaffed` chain it decides one rung at a
    time, and nothing above it.
  - **`decide` answers by the chain's status, then the actor:** `approvals.nothingToDecide` with no
    chain, `approvals.alreadyDecided` once approved or rejected, and `approvals.notYourStep` to
    anyone with neither a rung of their own nor an override that reaches the rung to decide.
  - **For HR leave,** the engine's only host: a request whose remaining rungs have nobody on them
    now waits in `pendingApproval` instead of being approved by the lower approval, and one
    submitted with nobody on any rung waits as before. A holder of `approval.override` who reaches
    the rung can now decide either, one rung at a time, and anyone else is refused
    `approvals.notYourStep` (a request that waited with nobody on its remaining rungs was refused
    `approvals.alreadyDecided` before); nobody who can decide such a request is notified of it. On
    a request whose chain was deleted or deactivated, with no wider chain to fall back to, `decide`
    now refuses `approvals.nothingToDecide` for everyone, where it refused
    `approvals.alreadyDecided`. A holder of an override that does not reach the rung no longer sees
    Approve and Reject on it, and a cancelled request offers nobody a decision and marks no rung as
    waiting on its chain panel. Leave's
    submission rule, its manager and HR path, its notices and its audit are unchanged. What leave
    should do with a request nobody can approve is the owner's question PXQ-1 (re-detail §2); until
    it is answered, such a request waits for an override. The chain screen's hint says so, in
    English and Arabic.
  - Rollback (RK-30): reverting restores the old reading and leaves nothing stored behind; a leave
    request left waiting under it stays `pendingApproval`, as one with nobody on any rung did
    before.

- **ATM: a machine code written with a space inside is searched and filtered whole.** «لما بعمل
  بحث هنا /atm/machines على الماكينة دى HDB-ATM 9501 بسبب المسافة اللى فيها بتتقسم كأنها
  ماكينتين ! فمبتظهرش». The ID filter on «كل الماكينات» took every space as the end of a code, so
  «HDB-ATM 9501» became two codes, «HDB-ATM» and «9501», that no machine carries. Two shapes of
  code are written with a space inside: Latin letters joined by a dash, a space, digits («HDB-ATM
  9501»), and Latin letters, « - », digits («HDB - 1234»). A space now joins the words of those two
  shapes and still ends every other code: a list read off a message («1056 1112», numbered or
  bulleted, codes on separate lines), a word or a bank next to a code («NBE 1056»), «1056 - 1112»
  — each code is taken as before. A comma, a semicolon, a tab or a line break always ends a code.
  The same rule reads the page's address and the API's `codes` parameter
  (`splitAtmMachineCodeList`), and the picker searches a code typed with two spaces as written with
  one. A paste is read as it was copied, its line breaks kept (`MultiSelect`'s new opt-in
  `onPasteSearch`): the one-line box turns them into spaces, and a line ending in a bank's name
  («NBE» above «- 1056») would otherwise run into the code below it.

### Changed

- **ATM maintenance close: the crew leader on the row is the one the close keeps.** The owner
  (2026-11-25): «لما بيتم تقفيل صيانة لماكينة ATM كان بيطلب منه اسم الشخص اللى قفلها / عايز اسم
  الموظف دا يجي تلقائي من قائد الطاقم فى الجدول لو مُعين .. لو لأ خليه يدخله هو». The close dialog
  on `/atm/maintenance` shows each selected row's «قائد الطاقم» and asks for an employee only while
  a row has none; the pick is written on those rows only. `POST /atm/maintenances/close` takes
  `leaderEmployeeId` as optional and refuses (422) a set with a row without a leader when it is
  missing, before anything closes. A leader written by name (an edit or a shift cascade) now
  clears the row's `leaderEmployeeId`, which only the close sets, so a reopened row given another
  leader never keeps the earlier employee's id (`docs/12-planning/atm-operations-port.md` §6e).

- **HR leave: a request nobody on its approval chain can approve takes the manager and HR path
  (PXQ-1).** «موافق على كل التوصيات، كمّل». The owner's answer to PXQ-1, option 1
  (`docs/12-planning/leave-management-design.md` §16). A new request on a chain with nobody holding
  any rung goes to the employee's manager, or to HR when there is none, as a request with no chain
  does; its `leaveRequest` audit row names the chain (`unstaffedChain`). A request whose remaining
  rungs nobody holds after an approval, by a rung's holder or an override, goes to HR's step,
  keeping the chain's record; its page shows the chain and, under it, the HR step with a line
  saying why. Managers and HR receive requests that used to wait on the chain with no notice to
  anyone who could decide them. Requests already waiting on such a chain are not moved. The
  approvals engine is unchanged. For HR leave this replaces the wait for an override that the
  PX-1.2, PX-1.3 and PX-1.6 entries above describe: the engine still answers `unstaffed`, and
  leave now sends such a request to HR; a request whose rung's holders leave while it waits still
  waits for an override. The chain screen's hint says so, in English and Arabic. Count LC1 (leave
  design §16.10) is in the pull request. Rollback: revert API and web together; nothing in the
  data is undone (leave design §16.13).

- **A shared counter for running numbers, and one Arabic name fold for every module.**
  `apps/api/src/shared/base/counter.ts` (`defineCounter`) is Fleet's custody counter written as a factory: a module
  names its own `<module>_counters` collection and gets `ensure` (create-if-missing, raised to a floor and never
  lowered), `next` (inside the caller's transaction, so concurrent saves get consecutive numbers) and `peek`. IT's
  `foldName`, which compares two spellings of one Arabic name («الأسكندرية» = «الاسكندرية», «قطعه» = «قطعة»), moved
  to the contracts (`packages/contracts/src/common/fold-name.ts`); IT imports it, and its behavior is unchanged.
  Fleet's and ATM's counters keep their copies. This is PC-13, the second prerequisite of the Administrative
  Affairs module (`docs/12-planning/administration-module-decisions-and-phases.md` §18.1).

- **ATM's branch-scope rule and organization-scope check are shared code.** The fail-closed rule for branch
  records (`branchScopeMatch`, `branchScopeBranches`, `narrowToBranch`, `writableBranches`, `resolveWorkBranch`) and
  the organization-scope check behind ATM's settings and banks now live in `apps/api/src/shared/base/branch-scope.ts`
  and `org-authority.ts` (`assertOrganizationScope`). ATM re-exports them under the same names and keeps its
  active-branch loader, so its behavior and messages are unchanged; a spec pins that ATM's register rule and the
  shared `selectorBranches` agree on every selector shape. This is PC-12, the first prerequisite of the
  Administrative Affairs module (`docs/12-planning/administration-module-decisions-and-phases.md` §18.1), which
  reads the same rule instead of copying it.

- **The zod advisory waiver runs to 2026-12-26.** «موافق على Zod». The waiver for
  GHSA-mrhx-c7xc-m3w5 (zod 3, no patched release) ended on 2026-11-26, after which the dependency
  audit would have failed every pull request. The owner renewed it for 30 days
  (`scripts/dependency-audit.waivers.json`). The remedy is still the monorepo-wide zod 4
  migration, as its own change, before the new date.

- **A hand-over of several devices prints on ONE sheet.** «عند تسليم أكثر من أصل يتم عمل إيصال
  لكل أصل على حدي أنا عايز يتطبعوا فى ورقه واحده». A hand-over was already one «إقرار استلام»
  under one number, but it printed a page per device, each with its own statement and signature,
  which read as a receipt per device. A paper of several devices is now one statement — «بأنني قد
  استلمت الأجهزة الآتية وعددها (n) وبياناتها كالتالي:» — a table with a row per device (its kind,
  make and model, serial, its specifications in short, its accessories), one undertaking and one
  signature; a department's paper says «لتكون في عهدة إدارة … بموقع …». The owner approved it from
  a sample. A paper of one device is the form's page, unchanged. A list too long for the sheet runs
  on to further pages, each headed by the table's header row and the paper's number, the
  undertaking and the signature kept whole and with the list's last row (short of fifteen or more
  devices with six computers' full specifications). Nothing is stored differently, and reprinting
  an older receipt of several devices prints the sheet.

- **Fleet: every figure in Latin digits, in Arabic as in English — and the car record's
  «المخالفات» count and count wording.** The owner, 23 November: «اى ارقام خليها بالانجلش حتى لو
  عربى», for his own papers «اى ارقام بالانجلش», and «انا عاوزك تعدل حاجات الحركة فقط»; on the car
  record, 22 November: «أيوه صلحها» (the violations count) and «اه» (the counts' grammar). This
  replaces his earlier «كل الأرقام عربي ما عدا الفلوس», which was never built.
  - **Every figure an Arabic reader sees in «الحركة» is written 0-9:** the count beside the filters
    of «السيارات», «التراخيص», «الإخطارات», «السائقون», «التمامات», «عدادات السيارات», «صيانة
    السيارات», «إنذارات الصيانة», «التوكيل», «خصم الإيصالات» and «مصروفات العهدة»; the dates of
    every Excel and PDF sheet the registers write; the two dates of «طباعة التقرير» on the car
    record («تاريخ الانضمام للأسطول», «انتهاء الترخيص») and the licence date of the driver's
    licence print; the kilometres and dates of the odometer and workshop dialogs («الخادم يتوقع
    150,250 كم أو أكثر», «دخلت على 120,000 كم»); the violations boards (the three count lines of
    each group — company, drivers, car total — both badges, «معروض 100 من 440»); the makes'
    maintenance interval; the transfer log's day; the zoom readout of every Fleet image viewer
    («100%»); and every Arabic catalogue word of Fleet that carried a figure («اعرض آخر 12 شهر»,
    «فترة بـ 0 كم», «حتى 10 ميجابايت», «0 = لا قاعدة صيانة دورية لهذا النوع», «(من 1 إلى 30)»,
    «أعلى 5 سيارات» / «أقل 5 سيارات», and the go-live notice's dates). A date keeps its order and
    its marks — «07‏/11‏/2026», day first — only the digits change. English is byte for byte what
    it was.
  - **The custody Word letters print Latin digits** — «صرف عهدة», «استعاضه عهدة» and «تسويه عهدة»:
    «( 200,000)», «(81,908)», «(124,139.46)», «التاريخ29/ 09 / 2026», «5/10/2026», the period «من
    01ـ09ـ2026» (the tatweel stays), the table's serials and «الاجمالي 81,908». A reason typed with
    Arabic-Indic digits («نظير ٢٤ سياره تجديد») prints «24», and its decimal and thousands marks
    between two digits print «.» and «,» («١٢٫٥» prints «12.5»). The letters never read the UI
    language, so an English-UI print is the same paper, and a reprint of an old operation prints
    Latin. Pagination is unchanged (it counts characters).
  - **One Fleet module for it, `lib/fleet-figures`** — `latinNumber`, `latinDate`,
    `latinDateTime`, the Latin twins of the shared `formatNumber` / `formatDate` /
    `formatDateTime`: the same options, the same «—» for a missing value, the same English. The
    shared helpers are untouched, so HR, ATM, operations, gold, IT, organization, administration
    and the home page keep their digits. `ZoomableImage` gains an opt-in `latinFigures` prop that
    every Fleet viewer passes; its default — Operations' shipment receipt viewer — still reads
    «١٠٠٪». A guard (`fleet-latin-figures.spec.ts`) reads the whole module, the Arabic catalogue
    and `shared/`, and refuses a shared digit helper, any Arabic tag without `-u-nu-latn` or a
    numbering system other than Latin (five month and weekday names excepted), a formatter on the
    reader's locale or on a tag the file does not name, a digit built from its code point, an
    Arabic-Indic word (Fleet's or any other word Fleet shows), an Arabic-Indic figure written into
    the code (the lines that read typed input excepted), a viewer without `latinFigures`, and a
    shared component that writes the reader's digits (`Pagination`, `ListView`,
    `FileUploadList`).
  - **The car record's «المخالفات» counts what its link opens.** The link opens both halves of
    «مخالفات السيارات» on the car's code; the count is now the rollup those halves draw
    (`GET /fleet/violations/rollup?vehicleCodes=<code>`, old-book rows under the code included),
    summed as the boards count — a statement «×5» is five, a driver's fine one — so it equals the
    sum of the company half's «إجمالي السيارة» lines, which is its «إجمالي الشركة» lines plus the
    drivers' badge (a driver's fine is inside «إجمالي السيارة» already, never added twice). It
    counted documents by the car's id: a «×5» statement read 1, and the old book was missed. A new
    API spec pins the arithmetic (7 = 5 + 2; the old figure 2).
  - **The record's counts agree with their number**, Arabic's five forms through `pluralKey`, as
    the custody boards count: «قراءة واحدة · قراءتان · 3 قراءات · 11 قراءة · 1,234 قراءة», «عملية
    واحدة · 3 عمليات · 14 عملية», «حادث واحد · حادثان · 3 حوادث · 11 حادثًا · 100 حادث»,
    «مخالفة واحدة · مخالفتان · 3 مخالفات · 11 مخالفة». «سجل نظيف» and «سائق نشط» are unchanged.
    The odometer screen's count beside its filters takes the same words, so the record and the
    screen still read alike («73 قراءة»). The four flat keys `fleet.vehicle.count.{odometer,
    maintenance,accidents,violations}` are replaced by their five forms; English keeps one form.
  - Unchanged: identifiers (car codes, plates, employee codes, phones, card numbers), typed text,
    the numeric cells of every Excel file (the date columns are text cells and follow the screens),
    the API and the contracts (no endpoint, permission, event, data or migration), the browser's
    own date boxes (their digits follow the browser's language), and the insurer form's
    pre-printed «٢٠٢» year box, which is the insurer's image.
- **Fleet: the owner's follow-ups of 22 November — «أرقام الفترة» removed, «إجمالي العهدة», no
  English on the error panel, the six small fixes, and «الطقم الثابت» without its page header.**
  His answers to the six open items left after #759: «أرقام الفترة» شيله · اجمالى العهدة · لا سيبها
  زى ما هى · صلحها · امسحها · صلحهم; then, over a picture of the fixed roster's header, «الجزء اللى
  فوق دا شيله بتاع العنوان واللى فوقه».
  - **«لوحة تحكم الحركة»: the tab «أرقام الفترة» (key `period`) is gone.** The strip has eleven
    tabs, ending «التراخيص والتجديدات» · «ملخصات»; «ملخصات» was not named and is untouched. An old
    link to the removed tab (`?tab=period`, with or without its period) opens the first visible
    tab, «نظرة عامة»; no hub card, badge or link pointed to it. Its figures still show elsewhere:
    the kilometres in «العدادات والكيلومترات» («إجمالي الكيلومترات» with «مؤكدة حتى» and «لم تُغلق
    القراءة بعد», «متوسط لكل سيارة» and the readings «لـX من Y» under it, «قراءات تحتاج مراجعة»;
    the month's on «نظرة عامة»); the accidents' count, the open ones and the undated ones in
    «الحوادث ومطالبات التأمين» («حوادث الفترة»); «مصروف التشغيل» in «الوقود والمصروفات» (the
    month's on «نظرة عامة»), the card receipts in its «مصروف التشغيل حسب النوع» («وقود من
    الكارت»), the custody receipts as one figure in «العهدة» («مصروفات العهدة») for a reader of the
    custody screens — a receipts-only reader sees their parts in «مصروف التشغيل حسب النوع» («وقود من
    العهدة», «كاوتش», «غسيل», «صيانة»), with no total of their own; «فواتير التوكيل» (amount, rows,
    «بانتظار الفاتورة») in «الوقود والمصروفات»; «البيانات متاحة من …» on «الوقود والمصروفات» and
    «العهدة», and the note that operating expenses and dealership invoices are never added
    together on «الوقود والمصروفات». Dropped for good: the maintenance visits counted by CHECK-IN
    day (count, out, still in, the share out) — no other tab counts by that day; the nearest are
    «خرجت من الورشة» (by exit day) on «الصيانة والورش» and «في الورشة الآن» — the outstanding amount
    of the OPEN accidents alone («الحوادث ومطالبات التأمين» shows «إجمالي المتبقي» of all the
    period's files, open and closed), and the percentage bars of the coverage, of the open accidents
    and of the rows with an amount; the «كارت ثم عهدة» bar is each kind's share in «مصروف التشغيل
    حسب النوع». The 26 words only that tab read are gone from both languages.
  - **`GET /fleet/dashboard/period` lost `visits` and `accidents.openRemaining`**, the two parts
    only that tab read (`accidents` is `{ count, open, undated, totals }`); with them the
    maintenance service's `visitStates` and the repository's `stateCounts`, which nothing else
    called, and the contracts' `FLEET_DASHBOARD_PERIOD_TABS` and `FleetDashboardPeriodVisitsDto`.
    No permission key changed, and the dashboard's key unions keep their members and order
    (`visits` shared `fleetMaintenance.view` with `exits`, right after it). The read costs one
    query less (36) and the filtered read two less (39); the performance ceilings were lowered to
    those.
  - **«نظرة عامة»: the card «رصيد العهدة النقدية» is «إجمالي العهدة»** ("Custody fund total"), the
    same figure and the same links. **«سجل العهدة» keeps «2 سيارات»** — no change.
  - **The shared error state shows an Arabic reader no English at all.** It never prints the
    server's error code («INTERNAL» …), in either language: the friendly message was already chosen
    by it. In Arabic, a message with no Arabic letter in it — the server's own English sentence for
    a code the friendly table does not word yet, or a client-side error — gives way to the general
    line «حدث خطأ ما. يُرجى المحاولة مجددًا.» (toasts are unchanged). When the server sent a request
    id, one quiet line stays under the message for support: in Arabic «الرقم المرجعي» and the shared
    copy button («نسخ الرقم المرجعي»), the id on the clipboard, in the button's tooltip and in
    `data-request-id`, never in the text; in English "Reference:" and the id (left to right,
    isolated, on one line) with the same button. With no id, no line. Every screen's «تعذّر
    التحميل» and `DataTable` draw it; on the Fleet dark tables the whole line takes one quiet size
    (13px from 1750px, 12.5px below, never above the message), so its name and the id match. New
    word `common.error.reference`.
  - **Small fixes:**
    - «شهر انتهاء الترخيص» on «السيارات» and «التراخيص», and the «حسب الشهر» months on
      «الإخطارات»: Latin digits, «أكتوبر 2026 (12)» (`monthCountOptions`).
    - The car page (`/fleet/vehicles/:id`): every figure and date of the page in Latin digits,
      «آخر قراءة عداد» and its «أعلى قراءة … كم» line included, and the record's counts grouped like
      the rest («1,234 قراءة»). The printed sheet is unchanged (its two dates keep the shared
      Arabic-Indic digits, as the registry's own print does).
    - The car record's «الحوادث» counts by the car's code, as its link opens the list (old-book
      files under that code included), so the number is the list it opens and «سجل نظيف» follows
      it — as «العدادات» and «الصيانة» already did.
    - A driver's name and code no longer touch in Arabic: the gap is fixed once in the shared name
      (`EmployeeName`), so the daily «تعيين السيارات» «تعديل» dialog, the «السائقون» form,
      «مخالفات السيارات» and the dashboard's «المخالفات المرورية والتسويات» tab all gain it. «الطقم
      الثابت» keeps its own.
    - The daily roster's notes take 500 letters at most, on a computer and a phone, as «الطقم
      الثابت» (the API's limit).
    - «نوع المهمة» on the computer boards of «تعيين السيارات» and «الطقم الثابت»: a long name
      ends in «…» and the hover shows the whole name. No width changed: both tables fit at 1280,
      1366 and 1920 exactly as before (measured).
  - **«الطقم الثابت» (`/fleet/fixed-roster`) has no page header at any width** — no breadcrumbs
    «الحركة › الطقم الثابت», no visible title, no divider — reversing answer 2 ج of the screen's
    approved sample. The board's own first row is the top of the page: the car count and the Excel
    pill on a computer, the car search and the Excel button on a phone or a tablet; the table and
    the cards get the header's rows back. A visually hidden h1 («الطقم الثابت») stays for screen
    readers. The page container, the sticky rows and the save bar are as they were; the daily
    «تعيين السيارات» is untouched.
  - Unchanged: the data (no migration), the permissions, every endpoint but the two fields above,
    and the mistaken page, which was deleted outside the repository.
- **The roles page shows its departments side by side.** «بدل ما الإدارات تتحت بعض وتحت كل واحده
  الأدوار لأ عايز الإدارات تبقي جنب بعض». `/system/roles` drew one department card under the
  next; the cards now sit in columns that wrap onto the next row — as many as the list has room for
  at 320 px a card, at most four: one on a phone, two at 768 and 1024 px, three at 1440, four from
  1536. The count follows the list's own width, so with the navigation pinned open a 1536 screen
  lays three cards rather than four cramped ones, and a scrollbar never costs a column. The owner
  was shown this beside a board of columns that scrolls sideways and chose it, because the board
  hides every department past the fourth. A role's or a department's name is now written in full,
  wrapped (a word too long for its card breaks inside itself), rather than cut short. Nothing about
  what a role grants, its filters or its paging changes.

- **Eight hours is eight hours: worked time, lateness and the attendance report, by the owner's
  two rulings of 18 November.** «worked time = last check-out − first check-in», «Late = check-in
  after 09:00», and «The CSV export of the daily sheet isn't usable by HR … Rebuild it as a report
  for people, not a database dump.»
  - **Worked time is last check-out − first check-in, flat.** No break subtracted, nothing clamped
    to the roster: the question is how long the person was at work. A check-out after midnight is
    simply a later instant, so a night shift needs no special case.
  - **The company working day is 09:00–17:00, eight hours, with no grace** — the default pattern,
    which shipped inert and is now on. A branch may override every hour of it, and an employee with
    a real shift assignment is unaffected.
  - **Lateness is conditional, and this is the rule that matters.** An arrival after nine is late
    ONLY IF the eight hours were not completed. In at 09:40, out at 17:40: eight hours, nothing
    owed, «حاضر». The owner had asked a day earlier for no company-wide start time at all, because
    departments arrive between six and ten and one hour would mark honest people late — and then
    answered that objection with this rule rather than withdrawing it.
  - **A short day reports two numbers, because they answer two questions:** «التأخير» (check-in −
    09:00) and «النقص» (480 − worked). In at 09:00, out at 16:00 is not late at all and is an hour
    short. Overtime is worked − required rather than «after 17:00», so 07:00–17:00 earns two hours.
  - **A day with a check-in and no check-out reports nothing at all.** «حضر فقط», and worked, late,
    shortfall, early leave and overtime are blank rather than zero. This answers the owner's own
    export of 18 November, where five people read «حاضر» with zero worked minutes: the cause was a
    re-tap on the reader paired positionally as a departure — fixed by collapsing scans within ten
    minutes (`hr.attendance.minPunchGapMinutes`) — and the second half of the cause was a display
    that printed «0:00» with confidence where it had nothing to say.
  - **A working day with no scan reads «لا يوجد تسجيل», not «غائب»** («lateness only for now»),
    behind `hr.attendance.countAbsence`, which ships OFF. Nothing new reaches payroll's absent-day
    count — which matters with two years of history being re-derived from machines whose quiet days
    may mean a broken reader rather than an absence. A manager's own `markAbsent` is unaffected.
  - **Weekly rest stays Friday and Saturday**, which was already the shipped default.
  - **The CSV is a report now, not a dump.** Eighteen columns in the owner's order — code, name,
    branch, department, job title, date as dd/mm/yyyy, the status in the words the screen uses,
    check-in and check-out on a twelve-hour clock, worked, required, late, shortfall, early leave,
    calculated overtime, approved overtime, the day's punch count, and notes as sentences
    («لا يوجد انصراف», «الشهر مغلق من المرتبات», «بصمة يدوية»). UTF-8 BOM so Excel reads the
    Arabic, every value quoted so a spreadsheet cannot eat the leading zero of «0100052».
  - **And it is no longer a query over day documents.** It resolves the days through the same call
    the screens make, so the file IS the sheet: a person with no stored row still has a line, the
    statuses agree with the screen, and the file inherits the screen's filters, search and sort.
    The raw technical shape is gone rather than hidden behind an option — nothing consumed it.
  - **The daily sheet is ordered by clicking its headings**, server-side across the whole day and
    before pagination, so page 2 continues page 1. Check-in ascending by default; check-out, hours
    worked, late, shortfall, name, code and status all sortable; people with no time stay last in
    both directions; `?sort=` and `?dir=` keep the choice through a refresh, the Back button and a
    shared link, and the export follows it. The employee page's daily record toggles the same way
    on its date, check-in, check-out and hours columns.

### Added

- **Administrative Affairs («الشئون الإدارية»), purchase requests: the submission to the
  approval chain.** This is P2.3 of Phase 2 (`docs/12-planning/administration-module-phase-2.md`
  §3): the contracts and the API. A department's focal point sends their own draft to its approval
  chain; nobody decides, returns or cancels one yet (P2.4, P2.5), and no screen shows them (P2.W1).
  - **For the focal point:** `POST /api/v1/administration/purchase-requests/:id/submit` with the
    draft's version, under `.create` — the requester's own draft alone; a colleague of the same
    department is refused (403). It takes the request's number, «PR-2026-000001», one series for the
    company, restarted each Cairo year, gap-free (OD-57 A, OD-58 A); a returned request will keep
    its own. A draft with no line, or a line whose item has been retired since, is refused, each
    line by its index.
  - **Who can decide it, checked first (OD-19 A):** the chain written at `/system/approvals` for
    the new request type «طلبات الشراء» / Purchase requests, at the request's own department copy
    and branch. With no chain, with nobody on any of its rungs, or with the first rung it would wait
    on held only by the requester, the submission is refused (422
    `ADMINISTRATION_APPROVAL_CHAIN_MISSING`, detail `noChain`, `unstaffed` or `noEligibleApprover`)
    and the draft stays a draft with no number. The request is decided on the chain it was
    submitted on, whatever is done to the chain afterwards (ADR-041).
  - **For approvers:** the holders of that first rung, other than the requester, are told in-app
    and by email, «طلب شراء بانتظار قرارك» / "Purchase request awaiting your decision", with the
    number only. Deciding arrives in P2.4.
  - **For automations and HR notification rules:** a new event,
    `administration.purchaseRequest.submitted`, with the request's ids, number, branch, department,
    line count and the requester's ids (no names, no amounts); the module appears in the event
    catalogue as «الشئون الإدارية» / Administrative Affairs.
  - Audited as `statusChange` with the number, and signalled to the request's branch. New refusals
    `ADMINISTRATION_APPROVAL_CHAIN_MISSING`, `ADMINISTRATION_APPROVAL_NOT_PENDING` and
    `ADMINISTRATION_APPROVAL_NOT_YOUR_STEP` (the last two for P2.4's decisions), worded in both
    languages. `scripts/measure-purchase-request-contention.mjs` runs exit criterion 8's staging
    measurement: ten 100-line submissions at once.
  - Rollback (RK-30): reverting removes the route, the request type, the event and the notice's
    sender at the next deploy; submitted requests stay readable in `pendingApproval` with their
    numbers, the template and the counter rows stay, and nothing is rewritten.

- **Administrative Affairs («الشئون الإدارية»), purchase requests: drafts — the record, the
  register and the editor's API.** This is P2.2 of Phase 2
  (`docs/12-planning/administration-module-phase-2.md` §3): the contracts and the API. A
  department's focal point raises a purchase request, «طلب شراء», and edits it while it is a
  draft; nobody submits, decides, returns or cancels one yet (P2.3 to P2.5), and no screen shows
  them (P2.W1).
  - **Four keys and a page:** `administrationPurchaseRequest.view`, `.create`, `.edit` and
    `.approve` («عرض طلبات الشراء», «إنشاء طلبات الشراء», «تعديل طلبات الشراء», «اعتماد طلبات
    الشراء») on «طلبات الشراء», over `/api/v1/administration/purchase-requests` and `/:id`. The
    approve key is declared now so the chains of P2.3 can name it, and opens the record of what it
    reaches; it decides nothing before P2.4.
  - **For the department's focal point** (OD-16 A), who holds the new ready-made role «منسق طلبات
    الإدارة» / Department requester at department scope: `POST /purchase-requests` raises a draft
    with its needed-by date, justification, notes and up to 100 lines, each an item and a whole
    quantity (OD-14 C: no free-text line). The requester is always the caller's own employee, read
    from HR through the directory, and the request is filed on that employee's department copy and
    its branch, under the top bar's choice; a login with no employee, an employee with no
    department, one who has left and one whose branch is not their department's are refused, each
    with its own detail. Retired items are refused on a new line and kept on a line that already
    names them. `PATCH /purchase-requests/:id` edits a draft with its version — its requester's
    alone; a colleague of the same department reads it and is refused the edit (403).
  - **For readers:** the register filters by status (several), department copy, requester, created
    day (Cairo days) and the start of a number, and sorts by number, created, submitted or needed
    by; a department reader reads their copy, a branch reader the branch, `own` what they raised,
    and a `section` grant only what its holder raised (read as `own`, since a request carries no
    section). The record carries the requester's and the branch's snapshots, the
    lines with their items' snapshots and counters, and `availableActions` — what this reader may
    do now, with the reason when not. The procurement officer and manager, the Administrative
    Affairs manager and the auditor gain `.view`; the Administrative Affairs manager gains
    `.approve`.
  - **Items:** the item register and one item now also open to `.create`, so the request's item
    picker reads them without the item key; and once a request's line names an item, an edit that
    changes the item's unit is refused (422 `ADMINISTRATION_ITEM_UNIT_LOCKED`), every other edit
    unaffected.
  - New refusals `ADMINISTRATION_INVALID_TRANSITION`, `ADMINISTRATION_TRANSITION_BLOCKED` and
    `ADMINISTRATION_ITEM_UNIT_LOCKED`, worded in both languages; audited as `create` and `update`,
    each followed by a signal with the request's branch (topic `administration.purchaseRequest`).
    The workforce reset keeps the requests, and HR's permanent delete rewrites their requester's
    name. The boot ensures this year's purchase-request number counter.
  - Rollback (RK-30): reverting removes the keys, the page, the routes and the role's keys at the
    next boot; the collection, its counter row and the role stay, unread, and nothing else is
    rewritten.

- **Administrative Affairs («الشئون الإدارية»), purchase requests' groundwork: yearly document
  numbers and the item's kind.** This is P2.1, the first module slice of Phase 2, purchase
  requests (`docs/12-planning/administration-module-phase-2.md` §3): the contracts and the API
  only. No key, route, page or screen changes, and nothing takes a number yet: the first purchase
  request is numbered by P2.3's submission.
  - **The item's kind** (OD-14 C). For the master-data desk, the holders of the item write keys at
    organization scope: an item is a stock item or a non-stock one, a service or a good no store
    keeps, which purchase requests will name as they name any item. The item create,
    `POST /api/v1/administration/items`, takes `stockTracked` (default true), the edit,
    `PATCH /items/:id`, changes it with the version (never to null), and the item's record and
    register rows carry it; the trail records it on the `create` and on the `update` that changes
    it. The register has no filter by kind. Items saved before this release have no such field and
    read as stock items, as every item was, and no row is rewritten. It changes no rule until P5,
    where a non-stock line posts no movement. The items screen shows no kind yet (P2.W2).
  - **Yearly document numbers** (OD-57 A, OD-58 A). `formatAdministrationNumber` and
    `parseAdministrationNumber` in the contracts write and read «PR-2026-000001»: a four-digit
    year, then six digits that grow wider past 999,999, one spelling per number. On the server a
    series is a document kind and a year, counted on `purchaseRequest:<year>`; the year and the
    business date a document stores come from one instant, so the year turns at Cairo's midnight,
    not UTC's (RK-13), and a series' floor reads that year's numbers in the formatter's spelling
    only, grouped by length, as the item and supplier codes' does. The module reads the Cairo
    calendar the contracts hold through `shared/cairo-day.ts`, a re-export; nothing is copied.
  - For the web, the item create's client type is `CreateAdministrationItemInput`, in which
    `stockTracked` may be left out; no screen changes.
  - Rollback (RK-30): reverting removes the field from the contracts, the API and the DTO; items
    saved with it keep it, unread, and nothing else is stored.

- **Approvals: an audit verb for an approval decision, and the approval panel and the chain screen
  in the reader's language.** This is P2.0, the platform prerequisites of Administrative Affairs'
  Phase 2, purchase requests (`docs/12-planning/administration-module-phase-2.md` §3; design
  §18.1), shipped on their own, with no module code.
  - **The verb.** `approvalDecision` joins `AUDIT_ACTIONS` (OD-82 A): a decision on one rung of an
    approval chain, by the rung's holder or by an override, recorded under a verb of its own that
    the audit trail can be filtered on. The audit screen names it «البت في اعتماد» / "Approval
    decided", the event catalog's words for the same act. Nothing writes it yet: purchase-request
    decisions (P2.4) are its first writer. It is not a broadcast verb.
  - **The approval panel,** on every record that carries an approval chain (today HR leave's),
    names each rung by its caption in the reader's language, or by its level's name («مدير الفرع» /
    "Branch manager") where the caption has no words in that language; it showed the Arabic caption
    to every reader. It no longer prints a rung's raw `permissionKey · level` line, a key that its
    readers, requesters and approvers, have no catalog to look up. A rung decided by an override
    still shows the key used, `approval.override`.
  - **The chain screen** (`/system/approvals`, for administrators holding `approval.configure`)
    names request types, departments and branches in the reader's language, in its list and in
    the editor's request-type, department and branch selects; it showed the Arabic names in both
    languages. The rung keys an administrator chooses stay as they are.
  - `ApprovalChainPanel.spec.tsx` checks the caption in each locale, the level's name without one,
    and no key line; the new `ApprovalWorkflowsPage.spec.tsx` renders the list in both locales and
    pins the editor's three selects; `system-admin-i18n.spec.ts` pins the verb and its labels.
  - **Deploy.** At least one release before P2.4, or P2.4's api and worker deployed together: a
    worker that predates the verb refuses an audit job that carries it (RK-29).
  - Rollback (RK-30): reverting removes the verb, which no row holds before P2.4, and restores the
    Arabic-only names and the key line; nothing stored changes.

- **The approvals engine's baseline: its tests over today's behavior.** This is PX-1.1, the first
  code slice of PX-1, which hardens the platform approvals engine before Administrative Affairs'
  money approvals run on it (`docs/12-planning/administration-module-phase-px1.md` §3; ADR-041). It
  ships tests only, the coverage the design's R12 asks for
  (`docs/12-planning/administration-module-decisions-and-phases.md` §15.2.1), so each later fix can
  show the case it changes. `apps/api/src/platform/approvals/approval.service.spec.ts`, the
  service's first spec, mocks its seams and covers which chain applies and the staffing memo, a
  rung's holder deciding and deciding early, the refusals `approvals.notYourStep` and
  `approvals.alreadyDecided`, the override, where a request stands, the trail's flags, the
  notification list and the chain save's three refusals. `apps/api/tests/integration/approvals.spec.ts`
  writes a two-rung `hr.leave` chain through `PUT /api/v1/platform/approvals` and takes a leave
  request through `pendingApproval` to approved and to rejected, each decision writing leave's
  `leaveDecision` row and the engine's own. A case that pins a defect PX-1.2 to PX-1.6 fix names it: today a chain with nobody on any
  rung, or no chain at all, reads approved (R2), an `approval.override` held at any scope decides
  (R4), and a save accepts any registered key under the version the server just read (R9). The
  engine still records its own row before leave's write; PX-1.5 keeps that for leave, which stays
  an 'engine' type, and a case pins it (R5). An `approval.override` that has expired already
  decides nothing, and a guard case keeps it so. Nothing changes for HR leave or for anyone else: no
  source file, route, key, setting or row changes. Rollback: reverting it removes the two spec
  files and leaves nothing behind (RK-30).

- **Administrative Affairs («الشئون الإدارية») on screen: the suppliers — closing Phase 1.** The
  supplier register and each supplier's record over P1b.1's API, typed in by hand as the owner asked
  («لأ خلينا من غير شيتات او بيانات دلوقتى»). This is P1b.W, the last Phase 1 pull request of the
  design (`docs/12-planning/administration-module-decisions-and-phases.md` §19.1, §19.5, §19.10).
  - **A fifth row,** «الموردون» / Suppliers, on `administrationSupplier.view`, wearing the existing
    building glyph; a reader holding only that key sees exactly that row. The home gains its tile
    and the live suppliers' count. 144 → 145 seeded rows.
  - **The supplier register** (`/administration/suppliers`), in the board frame: searched by code or
    name, filtered by one category (a top-level one reads its subcategories' suppliers too) and the
    status; the categories each supplier supplies by name. **A phone is masked in the list**
    («010****5678») and shown whole only on the record; no phone travels in the address. A row opens
    the record.
  - **A supplier's record** (`/administration/suppliers/:id`): its names, registration numbers,
    payment terms, categories, phone, e-mail, address and contact people. **A tax number another
    supplier holds is a warning, never a block** (OD-11 (i)): the record names up to five other
    holders, each a link, a retired one marked, and a save that lands on a shared number says so.
  - **The supplier's documents** (OD-11 A): a paper is filed with what it is and its file (PDF or a
    photo, up to 10 MB, at most 20), opened in the page — a photo inline, a PDF in a frame — and
    removed from the list. Its virus-scan state is shown: «قيد الفحص» while scanned, the record
    reading itself again until the scanner answers; «محظور» never opens; «الملف غير متاح» for a file
    gone. A file of another type is refused before it is sent. Filing and removing take
    `administrationSupplier.edit`.
  - **The form** adds or corrects a supplier — no code box (the server gives «SUP-00001»), no VAT
    status until OD-29 gives its values, no bank data — with its contact people as rows (at most
    20), its categories picked from both levels, and Active to retire it on an edit. Save stays
    pressable and names what is missing; an e-mail that is no address is marked before a round trip.
    A save that meets a newer version of the supplier shows it as it now is with the reader's own
    changes kept over it, so the next Save goes through and undoes nothing the other person saved.
  - **Refusals worded for every record that meets them:** `ADMINISTRATION_ATTACHMENT_LIMIT` (a full
    documents list) gains its words in both languages, `ADMINISTRATION_REFERENCE_INACTIVE` now says
    «a unit or category chosen» — a supplier's retired category as well as an item's — and
    `FILE_TYPE_NOT_ALLOWED` is said in the reader's words instead of the server's English sentence.
    A category change refreshes the supplier screens too, on the reader's own screen and through
    realtime alike.

- **Administrative Affairs («الشئون الإدارية») on screen: the home, the items, the warehouses, and the
  units and categories.** The Phase 1 screens over the three API slices before them, where master data
  is typed in by hand, as the owner asked («لأ خلينا من غير شيتات او بيانات دلوقتى»). This is P1a.W of
  the design (`docs/12-planning/administration-module-decisions-and-phases.md` §19.1, §19.5).
  - **A sidebar category of its own,** «الشئون الإدارية» / Administrative Affairs, after ATM and before
    System Administration (sort order 29), with four rows and no sections (OD-62 A): «الرئيسية»,
    «المخازن», «الأصناف» and «وحدات القياس والتصنيفات», each on the key its screen's route asks
    (`administrationWarehouse.view`, `administrationItem.view`, `administrationCatalog.manage`; the
    home row on the items key). The launcher tile wears a new box glyph (OD-62.1 A), which the Items
    row wears too; the Warehouses row wears a new warehouse glyph. 140 → 144 seeded rows.
  - **The home** (`/administration`, no route guard: the page decides) draws a tile per screen the
    reader's grants open and the live warehouses' and items' counts, each read under its own key; a
    count that fails says so, never 0, and a reader with none of the screens is told so.
  - **The item register** and **an item's record** (`/administration/items`, `/items/:id`): searched
    by code, name or barcode, filtered by one category (a top-level one reads its subcategories'
    items too), one unit and the status; a row opens the record. The form adds or corrects an item —
    no code box (the server gives «ITM-00001»), no stock box, an Arabic name that may carry a Latin
    brand («حبر HP 85A»), a category filed where an item may be filed (a subcategory where its
    category has one), whole-number levels kept in order, and Active to retire it on an edit.
  - **The warehouse register** (`/administration/warehouses`): its branch filter offers only the
    branches the reader may read, and drops a remembered one the server no longer offers; a row's
    edit is offered only where the server says the edit would be taken; the keeper is shown as HR
    answers today — marked when they have left, flagged when HR no longer knows them. The form opens
    a store only in a branch it may be opened in — «add» shows only while some branch takes one —
    keeps the branch for good, names a department of that branch (one since retired stays, marked)
    and a keeper through the module's own picker of people who work here today.
  - **Units and categories** (`/administration/catalogs`): one tab each, edited — never deleted — in
    a dialog, a category's parent picked from the active top-level categories.
  - **Every register wears the board frame** (OD-83 B), which the owner asked for module by module —
    Fleet, then ATM («عايزك فى كل الصفحات تثبت الفورم والفلتر وتخلي الجدول بس هو اللى يعمل
    Scroll»), then IT and System Administration: the title, the filters and the pager keep their
    place and only the rows scroll. Filters are remembered across visits and carried in the URL.
  - **Every refusal of the module is worded in both languages** in the shared table
    (`ADMINISTRATION_DUPLICATE`, `_CATEGORY_PARENT_INVALID`, `_STOCK_LEVELS_ORDER`,
    `_REFERENCE_INACTIVE`, `_SUBCATEGORY_REQUIRED`, `_EMPLOYEE_EXITED`, `_DEACTIVATION_BLOCKED`), and
    each dialog also says, beside the field a refusal names, what to change. Save stays pressable and
    names what is missing. A save refused because someone saved the record meanwhile shows the record
    as it now is with the reader's own changes kept over it, so the next Save is taken and undoes
    nothing the other person saved.

- **Administrative Affairs («الشئون الإدارية»), third slice: warehouses, and the keeper picker.** The
  stores of each branch, «المخازن», with the «Warehouse manager / responsible person» the owner's
  request lists in a warehouse's master data, typed on the screens as the owner asked («لأ خلينا من
  غير شيتات او بيانات دلوقتى»). This is P1a.3 of the design
  (`docs/12-planning/administration-module-decisions-and-phases.md` §19.1): the API only; the
  Warehouses screen arrives with P1a.W.
  - **Three keys and a page:** `administrationWarehouse.view`, `.create` and `.edit` («عرض المخازن»,
    «إنشاء المخازن», «تعديل المخازن») on «المخازن», over `/api/v1/administration/warehouses` and
    `/warehouses/:id`. Several stores per branch, each typed main, branch or sub (OD-10 A), with a
    code unique in the company, a name unique in its branch (compared folded, under a unique index,
    so two spellings typed at the same moment make one store); either clash answers 409
    `ADMINISTRATION_DUPLICATE` naming the field (`code` or `name`). A store may name an owning
    department of its own branch, which grants nothing, a location and notes. The branch is set once,
    at the create, and never edited.
  - **Read fail-closed, written in reach.** Every read goes through the shared branch rule: the
    organization reads everything, narrowed by the top bar; a branch holder their branches; a
    department or section holder, or a department copy by role or by delegation, the branch it sits in;
    `own` nothing. A `branchId` filter outside the reader's reach is 400 `OUT_OF_REACH`, and a store
    outside it 404. A create needs `.create` over the body's branch, an edit `.edit` over the store's,
    which no department grant gives; a create files under the top bar's branch, so another branch is
    400 `OUT_OF_REACH` on `body.branchId` (ADR-028); every row says whether its reader may edit it (`canEdit`), and
    says so only when the edit would find it under the top bar's branch. A write outside the key's
    reach is 403. A closed or unknown branch, or a department that is not an active copy in the
    store's own branch, is 404. An edit that sends a branch is 400 `VALIDATION_FAILED`. An edit sent
    with an old `version` answers 409 `STALE_DOCUMENT` before any rule judges it.
  - **The branch options:** `GET /warehouses/branch-options` lists every active branch as the top
    bar's switcher names and orders them, each with `canView` and `canCreate` for its reader, so the
    screen's filter and create dialog offer only what the server would accept.
  - **The keeper,** «أمين المخزن» (OD-10 keeper (i)), picked from `GET /api/v1/administration/people`
    (and `/people/:employeeId`), which whoever may create or edit a warehouse reads through the
    platform directory, never HR: the people who work here today, in the keys' reach, with seven
    facts each. A keeper a save names must be one the picker would offer its writer: anybody outside
    the keys' reach is 404, as the picker's by-id read answers, whatever their status. A keeper HR
    answers as having left is refused, 422 `ADMINISTRATION_EMPLOYEE_EXITED`. The keeper is stored as
    an id and named from HR at every read, so no name is copied onto the store.
  - **Retiring** is `isActive: false`, refused while stock, transit or an open document holds the
    store (OD-70 B, 422 `ADMINISTRATION_DEACTIVATION_BLOCKED`); nothing can hold one before stock
    exists, so in this phase a store retires freely.
  - **A workforce reset keeps the warehouses** (OD-64 A): a store outlives its keeper, whose id then
    names nobody until another is named.
  - Audited as `create`, `update`, `activate` and `deactivate`, each followed by one signal carrying
    the store's branch, so branch-scoped screens refresh too. The six ready-made roles gain the
    warehouse keys §6.5 gives them: the view key for «أمين المخزن», «موظف المشتريات», «مدير المشتريات»,
    «مدير الشئون الإدارية» and «المراجع الداخلي», all three for «مسؤول البيانات الأساسية».

- **Administrative Affairs («الشئون الإدارية»), suppliers: the register, the «SUP-» code and the
  suppliers' papers.** The «Suppliers» master data the owner's request names, typed on the screens
  as the owner asked («لأ خلينا من غير شيتات او بيانات دلوقتى»), so nothing is loaded at deploy.
  This is P1b.1 of the design (`docs/12-planning/administration-module-decisions-and-phases.md`
  §19.1), under ADR-040: the register is the module's own, a platform seam may read it later, and
  IT's vendors and Fleet's workshops are untouched. The API only; the Suppliers screen arrives with
  P1b.W.
  - **Three keys and a page:** `administrationSupplier.view`, `.create` and `.edit` («عرض
    الموردين», «إنشاء الموردين», «تعديل الموردين») on «الموردون», over
    `/api/v1/administration/suppliers` and `/suppliers/:id`. Any holder of `.view` reads the whole
    register, a retired supplier by its id included; the writes need the key at ORGANIZATION scope
    (OD-04 A), as every master-data write does.
  - **What a supplier holds** (OD-11 A): its trade name in Arabic and English, phone, e-mail,
    address, up to 20 contact people, the item categories it supplies, its tax and commercial
    registration numbers, payment terms as free text, notes, and active or retired (OD-12 A). No
    bank, IBAN or account data and no national id. The VAT status is kept empty until OD-29 gives
    its values. A contact's phone is redacted from the logs at the root and up to two levels deep
    (`CONTACT_PHONE_PATHS`).
  - **A generated code, «SUP-00001»** (OD-05 A), on the same counter machinery as the items' under
    its own key, `supplier:global`: two creates at once get consecutive codes, a create refused
    inside its transaction gives its number back, and the seed and every create raise the counter
    above the highest code already given.
  - **One supplier per name; a repeated tax number warns.** The Arabic name is compared folded
    («قطعه» = «قطعة») under a unique index, so two spellings typed at the same moment make one
    supplier (409 `ADMINISTRATION_DUPLICATE`, field `name`). A tax number another supplier holds is
    saved — a supplier's branches may be separate records — and the supplier's record names up to
    five other holders, retired ones marked (OD-11 (i)).
  - **Categories:** the supplier's categories must exist (404) and, when named anew, be active
    (422 `ADMINISTRATION_REFERENCE_INACTIVE`, naming each retired one); a supplier keeps one that
    retired later. The categories list now also opens to `administrationSupplier.create` and
    `.edit`, so the supplier form can pick them; `?categoryId=` of a category reads its
    subcategories' suppliers too.
  - **The suppliers' papers** (OD-11 A): a file category of their own, «مستندات الموردين», PDF and
    images up to 10 MB, kept for ever (OD-76 (i), OD-77 A). `POST /suppliers/:id/attachments` files
    one under the supplier with its label and the version the person saw; a `GET` of
    `/suppliers/:id/attachments/:attachmentId` sends it inline, `private, no-store`, refused while a
    virus scan is pending (`FILE_SCAN_PENDING`) or after it blocked the file (`FILE_BLOCKED`); a
    `DELETE` of the same path removes the link and keeps the file. A supplier holds at most 20
    papers (422 `ADMINISTRATION_ATTACHMENT_LIMIT`), an upload its link does not reach is withdrawn,
    its record shows each paper's scan state, and a paper is never reached through another
    supplier. The platform's own file paths ask the supplier's keys, writes only at organization
    scope.
  - **Every ready-made role reads suppliers** (OD-78 A): the storekeeper, the procurement officer
    and manager, the Administrative Affairs manager and the auditor gain `.view`; «مسؤول البيانات
    الأساسية» gains all three.
  - Audited as `create`, `update`, `activate` and `deactivate`, a paper's link as an `update` naming
    it; the realtime topic `administration.supplier`.

- **Administrative Affairs («الشئون الإدارية»), second slice: items, and the «ITM-» code.** The
  item master every store, request and order will name, with the «Category / Subcategory» the
  owner's request lists among an item's fields, typed on the screens as the owner asked
  («لأ خلينا من غير شيتات او بيانات دلوقتى»), so nothing is loaded at deploy. This is P1a.2 of the design
  (`docs/12-planning/administration-module-decisions-and-phases.md` §19.1): the API only; the
  Items screen arrives with P1a.W.
  - **Three keys and a page:** `administrationItem.view`, `.create` and `.edit` («عرض الأصناف»,
    «إنشاء الأصناف», «تعديل الأصناف») on «الأصناف», over `/api/v1/administration/items` and
    `/items/:id`. Any holder of `.view` reads the whole register; the writes need the key at
    ORGANIZATION scope (OD-04 A), as the catalog's do. A retired item still resolves by its id.
  - **A generated code, «ITM-00001»** (OD-05 A), taken inside the create's transaction from the
    module's counter (`administration_counters`, the shared `defineCounter`): two creates at once
    get consecutive codes, and a create refused inside the transaction gives its number back, so the
    series has no gap. The seed raises the counter to the highest code already given, at any width,
    and every create does again first, so a lost counter never comes back below a used code.
  - **One item per name and per barcode.** The Arabic name is compared folded («قطعه» = «قطعة») under
    a unique index, so two spellings typed at the same moment make one item; a barcode, optional,
    belongs to one live item (OD-05 (i)) and its unique index is its only check. Either clash
    answers 409 `ADMINISTRATION_DUPLICATE` naming the field (`name` or `barcode`). `search` reads
    the code, both names and the barcode, so a scan finds its item.
  - **Its rules, each refused with its own code:** the levels are whole numbers from 0 (OD-08; 400
    `VALIDATION_FAILED`) and keep minimum ≤ reorder point ≤ maximum where set (OD-09; 422
    `ADMINISTRATION_STOCK_LEVELS_ORDER`, naming the fields); a retired unit or category is not given
    to an item, though an item keeps one that retired later (422
    `ADMINISTRATION_REFERENCE_INACTIVE`); and an item is not filed in a category with active
    subcategories — it names one of them (OD-06 (i); 422 `ADMINISTRATION_SUBCATEGORY_REQUIRED`). An
    item filed before its category gained its first subcategory keeps it until its next edit, which
    re-files it; retiring it or bringing it back, and nothing else, is not that edit. An edit sent with an old `version` answers 409 `STALE_DOCUMENT` before any rule
    judges it, for units and categories too. The list labels each item with its category, that
    category's parent and its unit, and `?categoryId=` of a category reads its subcategories' items
    too.
  - **An item reader reads the units and categories.** Both lists now take `administrationItem.view`
    as well as `administrationCatalog.manage`, so the item form's lists populate; their realtime
    topics move to the item key, beside the new `administration.item`.
  - **Five more ready-made roles** (OD-78 A), seeded as managed roles with the item view key and
    assigned to nobody: «أمين المخزن», «موظف المشتريات», «مدير المشتريات», «مدير الشئون الإدارية» and
    «المراجع الداخلي»; «مسؤول البيانات الأساسية» gains the three item keys.
  - Audited as `create`, `update`, `activate` and `deactivate`, with an explicit signal after a
    (de)activation.

- **Administrative Affairs («الشئون الإدارية»), first slice: units of measure and item categories.**
  The owner's request of 2026-10-29 for warehouses and procurement starts with its master data; the
  owner, 2026-11-24, on the open decisions: «اعمل انت الـ Recommendations من عندك دلوقتى وبعدين نبقى
  نعدل», and on loading lists from files: «لأ خلينا من غير شيتات او بيانات دلوقتى» — so master data is
  typed on the screens and nothing is loaded at deploy. This is P1a.1 of the design
  (`docs/12-planning/administration-module-decisions-and-phases.md` §19.1): the API only; the
  screens, the menu category and its rows arrive with P1a.W.
  - **A new module, `administration`**, with one key and one page: `administrationCatalog.manage`
    («إدارة وحدات القياس وتصنيفات الأصناف») on «وحدات القياس والتصنيفات». It reads and writes
    `/api/v1/administration/catalog-items?kind=unit` and `/api/v1/administration/item-categories`.
    The writes need the key at ORGANIZATION scope (OD-04 A): one taxonomy serves every branch, so a
    branch-scoped or delegated holder reads the lists and writes none of them (403).
  - **Two spellings of one name are one row.** Each name is stored with `nameKey`, its Arabic
    folded by the shared `foldName` («قطعه» = «قطعة», «الاثاث» = «الأثاث»), under a unique index —
    per kind for units, per parent for categories — so two people typing both spellings at the same
    moment get one unit, not two. A clash answers 409 `ADMINISTRATION_DUPLICATE` naming the field
    (`name` or `code`). Nothing is deleted: `isActive: false` retires a row, which keeps its name.
  - **Two category levels** (OD-06 A): a category, or a subcategory under a top-level one. A refused
    parent answers 422 `ADMINISTRATION_CATEGORY_PARENT_INVALID` with its reason — itself, one of its
    own subcategories, a subcategory, a retired parent, or a move of a category that has
    subcategories. `?topLevel=true` lists the level a parent is picked from, `?parentId=` one
    category's subcategories.
  - **An Arabic name needs a letter or a digit.** A name of tatweel or harakat alone («ـ», «ً»)
    folds to nothing, so it is refused as 400 `VALIDATION_FAILED`.
  - **The indexes are the module's own to build.** Its seed builds them first through the shared
    `syncDeclaredIndexes('apply', …)` and logs the report; each repository waits for its
    collection's indexes before its first write, so a failed build refuses the write and the next
    one tries again.
  - **A ready-made role, «مسؤول البيانات الأساسية»** (`administration-master-data`, OD-78 A), seeded
    as a managed role holding the catalog key and assigned to nobody.
  - Audited as `create`, `update`, `activate` and `deactivate`; the realtime topics
    `administration.catalogItem` and `administration.itemCategory`; the role matrix names the module
    «الشئون الإدارية» / Administrative Affairs.

- **«ساعات العمل»: the hours each department owes, edited on their own screen.** A new tab on
  «الإعدادات» (`/hr-settings/working-hours`) sets the working hours per department for employees
  with no shift assignment — hours, an optional start time, and the end time computed from them —
  with the department's branch and headcount beside each row, and «سجل التعديلات» showing who
  changed which department's hours and when. Nothing new is stored for the log: every save goes
  through the settings service, which already writes the actor, the time and the whole map before
  and after. Saving re-derives the current month for the people in the departments that changed,
  so the sheet, the profile and payroll's feed agree with the new rule; frozen days are refused by
  `computeDay` and never re-priced.
  - **Its own permission, `attendance.manageWorkingHours`** — not the shift catalog's
    `attendance.manageShifts`, on the `hiringRequirement` precedent. A hub tab needs a page and
    `validatePageRegistry` refuses a page no permission administers, so borrowing the shift key
    would have left the role matrix saying the company's working hours are administered by the key
    that administers the shift catalog. They are not the same power: saving the hours re-derives a
    department's unfrozen days and payroll reads what that writes; editing the catalog does not.
    **Nobody loses the working day on the day of the deploy.** The working hours were HR's to set
    through the shift catalog until now — a shift carries the start, the end and the break — so
    every role and every live delegated grant holding `attendance.manageShifts` is given the new
    key once, by a versioned go-live step. It widens nobody: a holder gains the key only beside the
    key it already exercised the same power under, in the same grant and the same scope. It runs
    once, so a key an administrator removes afterwards stays removed. `super-admin` is widened
    separately, because a seeded system role is frozen at its first seed and no copy writes it.
  - `hr.attendance.departmentHours` is the setting behind it. It is a map, so the generic settings
    screen does not try to edit it: the row says how much is set and offers «يُعدَّل من شاشة
    «ساعات العمل»» rather than a raw-JSON box that would be both unusable and the one disabled
    control on a screen whose rule is that a holder of `setting.edit` can edit everything it shows.

- **Repeated scans are named rather than counted twice.** A day's punches are now attributed to
  the shift they belong to (within half a day of its start or end), the arrival and the departure
  are the two that count, and everything else is marked a repeat — the `repeatedPunches` flag, a
  per-scan role on the employee's day, and «عدد مرات الحضور / الانصراف» on the sheet row. The
  attendance report gains the two columns to match.

- **HR bulk photos: one photo per duplicate, chosen for you, and no photo sent twice.** «عايز
  المكرر تختار منه أنت تلقائي واحده وترفعها… مش عايز أرفع اللى اترفعوا».
  ([employee module design](docs/12-planning/employee-module-design.md) §8)
  - «اختيار صورة واحدة لكل مكرر تلقائيًا» keeps the file whose name fits the employee best (then
    the newest, then the largest) and leaves the rest out; «عرض: المكرر فقط» lists them.
  - The people whose photo was uploaded in the last 7 days are skipped by default (or today, the
    last 30 days, or none), so picking the whole folder again — the next day too — sends only what
    is missing.
    `POST /hr/employees/codes/lookup` now answers `photoUploadedAt` for each employee.

- **IT: assets and consumables handed to a DEPARTMENT at a PLACE.** «عند تسليم الأصول والمستهلكات
  يكون فى إمكانية إنى مأسلمش لموظف ولكن أعينها فى مكان بس تبقى على عهده الإدارة .. زى السيرفرات
  والكاميرات والسويتشات وهكذا».
  - **«المواقع»** — a new per-branch list of places («غرفة السيرفرات», «غرفة الكاميرات») on the
    catalogs page, its own collection `it_locations` (`/it/locations`) under `itCatalog.manage`
    within the caller's branch reach: names unique per branch, a place never changes branch, and it
    is retired, never deleted — refused while assets are held there. The tab shows what each place
    holds now.
  - **The hand-over names an employee or a department** — «جهة الاستلام: موظف / إدارة». A
    department hand-over names the department (any active department of any branch, IT
    preselected), the place (in the assets' branch — one place, so one branch, per paper) and the
    department's responsible person (any current employee), who signs. The same goes for a single
    asset's assign, a transfer (`toDepartment`) and a consumables issue (the place in the store's
    branch). Refusals are 422 on the request's own field (`body.department.departmentId` /
    `.locationId` — `UNKNOWN`, `INACTIVE`, `OTHER_BRANCH`), and a responsible person who has left is
    refused.
  - **The department custody receipt and memo** — the same papers and number series, naming the
    department and the place («ليكون في عهدة إدارة … بموقع …», «لصالح إدارة … بموقع …») and signed by
    the responsible person; the signed copy uploads as any paper's. Every paper answers
    `custodian` (null on an employee's); its `employeeId` is the signer.
  - **Custody holds it as the department's, never the signer's**: `holderKind` and the
    department, place and signer on the custody interval (old intervals read as an employee's, no
    migration). The asset list, the custody register and the ledger show «في عهدة إدارة … — …» and
    filter by department, place and holder kind; «حالة المستلِم», the leavers' panel and a person's
    own open custody stay employee custody; the responsible person's page lists, apart, what they
    signed for. A change of department, place or signer is a new holder and a new paper — a room
    change and re-signing are transfers. A place does not travel: «نقل إلى فرع» refuses a
    department-held asset, and a single «نقل» to another branch must name the holder there. A
    responsible person who leaves is flagged in the audit (`responsibleExited`); the custody stands.
  - The dashboard's «مُسلَّم» counts department custody and «آخر الحركات» names the department. The
    asset's free-text `location` is relabelled «وصف المكان». The asset custody events carry the
    department's fields, and `employeeId` is null on a department's `assigned` / `returned`.
    Mobile lines are not handed to departments. ADR-021 gained an addendum; IT design §2.4.1, §2.5,
    §2.5.1, §2.11, FR-22 and §17 (2026-11-19).

- **IT consumables: the printer's counter, required when a toner goes in.** «عند صرف الصنف : حبارة
  أو النوع : حبارات .. عايز يبقى فى Counter لعدد لورق المطبوع للطابعة اللى بيركب عليها الحبارة —
  يعني إجبارى أدخل عدد الورق المطبوع عند تركيب الحبارة», and «وأكيد مش هيدخل عدد ورق أقل أو مساوي
  للى موجود».
  - A consumable type may be ticked «يتطلب عداد الطباعة» (`requiresCounterReading`); «حبارات» is
    ticked from the start, by a one-time go-live step on the live catalog.
  - An item of such a type is issued one cartridge a line, onto the printer it goes into, with that
    printer's counter reading — refused otherwise (`IT_CONSUMABLE_COUNTER_REQUIRED`, a detail per
    gap). The reading must be strictly above the printer's last one, and strictly below a later one
    when the issue is backdated, unless «تم تصفير عداد الطابعة» is ticked
    (`IT_CONSUMABLE_COUNTER_BELOW_PREVIOUS` / `…_ABOVE_NEXT`, the figure in the details). It is
    judged inside the write's transaction under a per-printer lock, so two clerks on one printer
    cannot both land.
  - What a cartridge printed is the next reading of the same item (by name, across stores) on that
    printer less its own — computed when read, never stored. `GET /it/assets/:id/counter-readings`
    (under `itAsset.view`) gives a printer's readings and the last one;
    `GET /it/consumables/:id/cartridges` (under `itConsumable.view`) gives a toner item's cartridges
    and the average per cartridge; every ledger row carries `counterReading` and `counterReset`.
  - «تعديل الجهاز» on a counted toner moves the reading with the device: a new printer needs its
    reading, the same printer with a new reading corrects it, and «بدون جهاز» takes it off. A reset
    the later readings rest on cannot leave its printer. An issue recorded before the counter takes
    none afterwards. One memo, one printer, one reading: a reading written on a printer (a
    correction, or a move onto a printer where toners of the same memo sit) is written to every
    other toner of that memo on it whose reading differs, each audited on its own item; a move off
    a printer leaves them.
  - Docs: IT module design §2.4, §2.11, §5, §7, §10, §12, §17 (2026-11-19).

- **HR: every employee's photo in one go, matched by the code in each file's name.** «عندى صور
  الموظفين كلهم عايز أرفعهم دفع واحده متسمى كل صورة بالكود + أسم الموظف (الكود صحيح أكيد لكن الأسماء
  ممكن يبقي فيها حروف متلغبطه أو مسافات)», then «غير كله باللى هبعته جديد».
  ([employee module design](docs/12-planning/employee-module-design.md) §8)
  - «رفع صور الموظفين» on the employees list, for holders of `employee.editPersonal`: pick the photos
    or a whole folder, or drop them. The code in each name decides who the photo is for. Arabic digits
    count, a code missing one or two leading zeros is completed, and an external person's code
    (`EX-2900`) is read whole. The name in the file only flags a file whose name does not look like
    the matched employee. A name holding codes of two different people, or a zero-completed code the
    name does not confirm, is held for renaming, never guessed.
  - A table shows, before anything is sent, what each file will do: ready (replacing the current
    photo), no code, no employee with that code, two files for one employee, or not an image the
    profile takes.
  - Each photo is cut around the face, as the profile's own photo is, and sent two at a time with
    progress. A photo with no face found goes uncropped, and a large one is shrunk under 5 MB. A
    picture the browser cannot open is not sent. A failed photo is sent again with the next «رفع»,
    and «إيقاف» (or leaving the page) stops the run after the photos under way.
  - `POST /hr/employees/codes/lookup` answers which employees hold the codes, within the caller's
    `employee.editPersonal` scope. The photos themselves go through the existing photo upload.

- **IT: hand a device, a line or consumables to an employee of another branch.** «لما حد فى فرع
  بيسلم جهاز لحد فى فرع تاني مش بيعرف يشوف اسمه سواء فى الأصول أو المستهلكات .. أسمح إنه يعرف يسلم
  لحد فى فرع تاني».
  - Every hand-over box («المستلم» on the asset hand-over, the new holder on a transfer, «صرف
    لموظف», «مرتجع من», the line hand-over) now finds the current employees of EVERY branch, for
    whoever holds that register's hand-over grant (`itAsset.assign`, `itMobileLine.assign` or
    `itConsumable.assign`): `GET /it/people/recipients?search=&pageSize=` — a required search, at
    most 20 a time, each row only the name, the code and the branch. The command bar's branch does
    not narrow it. The employees register and every filter box are unchanged: still the reader's
    own scope.
  - What is handed over stays registered in the sender's branch, as before — consumables leave the
    sender's store; the recipient's own branch sees nothing of it.
  - The sender can open the recipient's IT page (`GET /it/people/:employeeId`): it is found once
    the sender's own registers name the person — a custody interval of an asset or a line, or a
    consumables issue or return, each within that register's own read scope — and every section of
    it still shows only what the sender's grants reach.
  - Fixed: a single asset's «نقل» to another branch now goes only to an active branch the user's
    `itAsset.assign` reaches whole, as «نقل إلى فرع» does (403 otherwise; 400 for an inactive
    branch) — a branch user could send a device into a branch they cannot see, where it vanished
    from their register. Moving to the same branch, or naming none, is unchanged.

- **Org chart: drag a job to change its order, and print the chart.**
  ([org-chart design](docs/12-planning/org-chart-design.md) §2.2, §2.4, §5.7)
  - «لما باجي أشد حاجة عشان أغير ترتيبها مش بتتشد»: the ↕ grip suggested a drag, but a drop on the job's
    own column did nothing and no order was stored. Now a job dropped on a row of its own column takes
    that row's place (a bar shows above or below which row), and the column's new order is saved;
    dropped on another column it moves there, as before. ↑ / ↓ on each row do the same without
    dragging, on phones too. The grip shows only where a drag can do something.
  - The order belongs to the place (`job_title_places.position`), so a job in two sections stands where
    each puts it. `PUT /platform/org-chart/order` (`jobTitle.edit`) takes a column's whole list in one
    transaction, refuses a list made from an older chart with `STALE_DOCUMENT`, and is audited as
    `jobOrder` on the department or section entry. The job's own update never changes a position.
  - «إمكانية طباعة كل إدارة بشكل A4 بالعرض وزرار لطباعة الكل أو اللى أحدده .. حطهم فوق بجانب زر تعديل
    الهيكل»: «طباعة» beside «تعديل الهيكل» opens a choice of every department or the ones ticked (the
    open one ticked first). Each prints on its own A4 sheet in landscape under the company letterhead,
    drawn as the screen draws it and in the saved order. Up to seven columns print as a tree. A
    department with more prints as rows of columns, and a long column prints in a compact size.

- **The inactivity sign-out window is set on the settings page, and it is 30 minutes.** «فين أقدر
  أتحكم فى المدة اللى بعدها بيحصل تسجيل خروج لو محدش بيستخدم الحساب الخاص بيه؟ دورت هنا ملقيتش
  /system/settings?dept=general», then «ضيفها في صفحة الإعدادات وخليها 30 دقيقة»
  ([ADR-039](docs/03-decisions/ADR-039-inactivity-window-is-a-setting.md)).
  - «تسجيل الخروج بعد عدم الاستخدام (بالدقائق)» sits under «عام» → «الدخول وكلمات المرور». It is the
    organization setting `auth.session.idleMinutes`: default 30, from 10 to 1440 minutes, with no
    off switch. Changes are audited like every setting.
  - Every sign-in and renewal reads it and sends it back, so the countdown on screen and the rule on
    the server stay the same. A change reaches each open screen at its next renewal, with no
    deploy: within about five minutes on a screen in use.
  - **A lowered value waits for the screen to be told it.** Each session stores the window its
    screen was last shown (`sessions.idleMinutesTold`), and a renewal is judged by the longer of
    that and the current value. Only a person's renewal brings the lower value in, together with
    the clock; a request's renewal keeps the longer one. Lowering the setting therefore never
    closes a session before its countdown has finished, and so never closes it without the
    one-minute warning. The active users page counts open sessions by the same rule.
  - **Background requests no longer keep an abandoned screen open.** A renewal that a request
    needed after its token expired (the notification badge polling, for one) sends
    `presence: false`. It rotates the token but does not move `lastUsedAt`. Before, any window
    longer than the 15-minute token would have let polls hold an empty desk's session open on the
    server. In the browser, a person's renewal is never folded into one of those. A renewal with no
    body counts as a person, which keeps pages left open across the deploy working.
  - The floor is ten minutes, two of the browser's five-minute renewal cadences. A web test reads
    it from the API and holds it to that cadence.
  - The `SESSION_IDLE_MINUTES` deployment variable is retired and ignored if set. Production never
    set it, so it ran at the 10-minute default until this change.

- **IT: in «صرف لموظف» the person and the device find each other — and the device can be changed
  after the issue.** «لما أكتب اسم الشخص اللى هسلمه تظهر الأجهزة اللى معاه بس … والعكس بردو .. لو
  كتبت سيرال فى الجهاز اللى هيتركب عليه المستهلك .. تظهر على طول الشخص اللى مستلم الجهاز دا», and
  «وضيف إمكانية تعديل الجهاز اللى عليه المستهلك بعد التسليم».
  - Choose the person first, and each line's «مركّب على» lists the devices they hold now, at once,
    with code and serial. «جهاز آخر» under them searches the whole register (a shared printer, a
    device in stock) without changing the person; the line says whose a held device is.
  - Type a serial first, and the rows say who holds each device; picking a held one fills the
    person, unless HR shows they have left. Changing the person takes off only the devices the
    previous person held, and says which lines lost one.
  - «تعديل الجهاز» on every issued row of the ledger (with `itConsumable.assign` and `itAsset.view`):
    set, change or clear the device an issued item sits in —
    `PATCH /it/consumable-movements/:id/installed-on` with the row's new `version`. It moves no
    quantity. The memo's line follows it, so a reprint prints the new device; the signed copy
    already filed stays as it is; the item's and the memo's history record who changed it, when,
    and from which device to which. A stale version is refused (409). A device a unit was moved
    off can still not be deleted as «registered in error» — the signed copy still names it.

- **IT: «خطوط المحمول» and «المستهلكات» have their own permissions.** «فى الصلاحيات مش لاقى حاجة لـ
  /consumables ولا /mobile-lines !! فى الـ IT ظبط صلاحيات الشاشات عشان أقدر أتحكم فيها». Both screens
  rode the asset grants, so the roles screen had no row for either. Each is now a page of the role
  matrix, right after «الأصول», with its own keys.
  - `itMobileLine` (page «خطوط المحمول»): view, create, edit, «تسليم واسترجاع خطوط المحمول» (`assign`)
    and «عرض الرقم القومي للمستلم في إقرار استلام الخط» (`viewNationalId`). `itConsumable` (page
    «المستهلكات»): view, create, edit and «صرف واسترجاع وتحويل المستهلكات» (`assign`). Each does
    exactly what the asset key did on the same screen, within the same scope.
  - The asset keys no longer open these two screens — their routes, the papers' signed copies and
    their live refresh. The assets, custody, the employees screen and the home's asset figures keep
    `itAsset.*`.
  - Nobody loses access on deploy: once, every role and every live delegated grant holding an
    `itAsset` key is given the matching new keys (`go-live:it-screen-grants:v1`). It adds and never
    removes, and a key removed afterwards stays removed.
  - `GET /it/consumables/transfer-targets`: the branches «تحويل إلى فرع» may go to, as
    `itConsumable.assign` reaches them. The assets' `GET /it/assets/move-targets` stays on
    `itAsset.assign`.
  - `/it/people` (the holder boxes) opens on any of the three screens' view keys and finds people in
    every unit any of them reaches. How many assets a person holds is counted only for a reader with
    `itAsset.view`, and shows 0 to anyone else.
  - Naming the asset an issued item is installed on needs `itAsset.view`; without it the asset is
    «not found». The consumables' types list (`GET /it/catalog-items`) also opens on
    `itConsumable.view`.
  - The «خطوط المحمول» and «المستهلكات» menu rows move to the new view keys, only where the stored row
    still holds `itAsset.view`.

- **Administration: only the table scrolls, not the page.** «عايز بردو كل الصفحات اللى فى مديول الإدارة
  ميبقاش الصفحات كلها بتعمل Scroll لكن الجداول بس». Every page of the «الإدارة» menu now takes the
  board frame Fleet and ATM use (`shared/ui/board-scroll.ts`). On a computer the title, tabs and
  filters keep their place, the pager stays below, and only the table's rows scroll, under a head
  that stays. A phone or a tablet scrolls as before.
  - The table pages: System Users, Active Users, Notification Templates, Audit Log, Activity Log,
    Applications and Application Categories.
  - The pages whose list is cards: Roles, the Permission Catalog, Approval Workflows and System
    Settings. Their list scrolls instead (`BOARD_LIST_FILL`).
  - `BOARD_LISTVIEW_FILL` does the same for a `ListView` card.
  - The Audit Log, whose filter bar is the tallest, takes the IT boards' lower table floor
    (`BOARD_TABLE_FILL_LOW`). With the usual 14rem floor, a 1280×720 or 1366×768 laptop scrolled
    the whole page, filters included.
  - `admin-board-scroll.spec.ts` holds every page of the menu to this shape.
  - Checked in a browser against a mocked API. At 1440×900, 1366×768 and 1280×720 the title and
    filters stay in place on all eleven pages, and the table or list takes the height that is left.

- **Organization: «شجرة الهيكل التنظيمي», and a job's place in the structure.** «HR hierarchical chart …
  عبارة عن شارت بالشركة كلها .. فيه الإدارات والأقسام والمسميات الوظيفية … ولما أختار إدارة بالضغط على
  كارت يجيب تحتها الشارت بتاع هيكلها التنظيمي مع إمكانية تعديل الهيكل»; «عند إضافة وظيفة جديدة لا يتم
  اختيار القسم التابع لها أو الإدارة … والأتنين يسمعوا فى بعض». Design: `docs/12-planning/org-chart-design.md`;
  ADR-038 (job places, which supersedes ADR-031 in part).
  - **The page** (`/organization/chart`, `department.view`): every company department as a tile, the
    branch copies folded into one; picking one draws its sections side by side, each with its jobs, and
    the jobs placed directly under the department in a first column. A department with no sections
    hangs its jobs straight from it. Phones get the same content as an indented tree.
  - **Edit mode** saves each gesture at once: add a section in the ticked branches, rename it, stop it,
    add a job to a place, move it (drag, or «نقل إلى»), remove it from a place. Groups not linked to the
    company list stay read-only and say so.
  - **The job form and detail** get «مكانها في الهيكل التنظيمي»: a department, or one of its sections;
    several allowed. The chart and the form write the very same rows through the job's own
    version-checked update, so each shows what the other changed.
  - **Places are descriptive:** they block nothing and count no headcount. A new department or section
    row is linked to the company list when created (D-ORG3-5). At the first start, each department gets
    the places where its holders sit, once; after that they are edited by hand.
  - The server takes `GET /platform/org-chart`, `POST /platform/org-chart/sections`,
    `PATCH /platform/org-chart/sections/:id` and `POST /platform/org-chart/sections/:id/stop`; job
    create and update take `places` (at most 50). New collections `job_title_places` and
    `job_title_place_fills`, with indexes built at boot.

- **IT: on a computer only the table scrolls.** «فى شاشات الـ IT مش عايز كل الصفحة تعمل Scroll !! عايز
  فقط الجدول لكن الزراير والفلتر يبقوا ثابتين». Every IT list screen — assets, custody, consumables and
  their movements, mobile lines, employees, catalogs, vendors, licenses, software, tickets,
  maintenance orders and plans, spare parts — now uses the Fleet and ATM boards' frame
  (`PageContainer fullHeight`, `BOARD_FRAME`, `DataTable stickyHead`): from `lg` the title, the
  buttons, the figures and the filters keep their place, the pager keeps its place below, and only
  the rows scroll under a head that stays; a phone or tablet scrolls the page as before.
  - The IT boards' table floor is 8rem (`BOARD_TABLE_FILL_LOW`), not the shared 14rem, so on a
    1280×720 or 1024×768 screen the rows shrink before the filters move — measured in a browser on
    every board at 1024×768 to 1920×1080. Fleet and ATM are unchanged.
  - The mobile lines' network cards are compact from `lg` (counts beside the name, accounts as chips,
    «+N» past four); the pressed card's mark and ring sit inside the card.
  - The bulk upload's lines scroll in a box of their own under a sticky head, «تأكيد» in view.
  - Left as they were: dashboards, records, and the help desk settings (two settings cards over a
    table of a few priorities).

- **HR: «تعديل» on the employee's «طباعة العقد والمستندات».** «في شاشه الموظفين … نخلي في امكانيه
  للتعديل زي معملنا قبل كدا تحت الtoggle تعديل و طباعه و تحت يظهر البيانات عشان التعديل و النص التاني
  الفورم».
  - Every paper has «تعديل» and «طباعة» under it. Below, side by side: the opened paper's values and
    the paper as it prints, redrawn with each change.
  - What is typed is saved as a box is left, for that employee only (`hr_employee_paper_values`), and
    printed by every paper of theirs that prints it — on the tab and in «المعينون»'s printing for
    many. The employee's file does not change; clearing a box gives the record's value back. Until
    something is typed, the values typed for them as a candidate stand.
  - The contract they hold shows its values and prints as issued; it changes only by renewing or
    amending it. Its number and term are never typed.
  - «تاريخ بدء الاشتراك» (form 1) is one date box, on this tab and on «عقد جديد»: the start of work
    unless another date is chosen.
  - Server: `PATCH /hr/contracts/employee-papers/:employeeId/values` and `POST …/preview`
    (`contract.print`); the papers' read returns each paper's values.

- **HR: «نموذج رقم (1)» carries the company's own number and address, the job's wage, and Arabic
  figures.** «رقم المنشاه … هنثبت اول مربع و هنحط من تاني مربع الرقم دا 3338726 بالعربي من الشمال
  لليمين و نشيل التاريخ اللي موجو في تحريرا في و عاوزين نحط الاجر داخل اشتراك و الاجر الشامل علي حسب
  الوظيفهه … رقمها التاميني … العنوان … كل الارقام بالعربي». The scanned pages are unchanged.
  - «رقم المنشأة»: the first of its eight boxes empty, ٣٣٣٨٧٢٦ in the other seven. Overleaf,
    «رقمها التأميني» ٣٣٣٨٧٢٦ and «العنوان» «٩٠ د احمد عرابي المهندسين-الجيزه».
  - «أجر /دخل الاشتراك» and «الأجر الشامل»: the job's «الراتب الثابت» from the organization chart,
    the pounds at the end of their five boxes, the piasters in their two (variables
    `job.fixedSalaryPounds`, `job.fixedSalaryPiasters`). A job with none leaves the boxes empty.
  - «تحريراً في» is left for the hand; «تاريخ بدء الاشتراك» is still the start date.
  - Overleaf, «أقر أنا …» is left for the hand too: the employee's name is no longer written there
    («اقر انا دي سبها متكتبش فيها اسم الموظف»; revision 5).
  - Every figure the form is filled with is printed in Arabic figures; an e-mail address keeps its own.
  - The template sanitizer keeps rows of five and seven boxes (`c5`, `c7`) and `end`; the paper's
    revision 4 rewrites the stored row at boot.

- **System users: department, job title and roles on every row, and as filters.** «فى صفحة
  /system/users مستخدمو النظام عايزك تزود أدوار كل واحد + الإدارة بتاعته + مسماه الوظيفي .. وطبعاً
  هتزودهم فى الفلتر».
  - Each row names the account's department and job title. The server resolves the names,
    retired units included, so an account in a closed department still shows that department.
  - Each row names the roles held now: a grant that is revoked, not yet started or already ended
    is not one of them. Three show, and the rest fold into «+n» with all of them on hover.
  - Three new filters, each taking several picks.
    - The department filter lists each company department once and means every branch copy of
      it, or only the copy in the branch chosen.
    - Changing the branch drops a chosen department that branch does not have.
    - A chosen department that matches nothing filters to nobody, rather than being dropped.
    - The role filter searches the roles on the server (ADR-019).
  - Roles, column and filter, are only for an administrator who holds `role.view`. For anyone
    else the server sends `roles: null` and refuses a role filter with 403 rather than ignoring it.
  - `GET /platform/users` takes `roleId`, `departmentId` and `jobTitleId` lists, and each row is
    a `UserListItemDto`. The search box now also finds the sign-in name, which its placeholder
    already promised; for an employee that is the employee code.

- **Account setup link: «نسخ الرسالة» beside «نسخ الرابط».** «عند نسخ رابط إعداد الحساب هناك زر نسخ
  الرابط .. عايز زر تانى جنبه يكون نسخ الرسالة». The button copies the owner's message, ready to paste
  into WhatsApp, filled in for the person:
  - their Arabic name and employee code (the account's sign-in name);
  - the link itself;
  - where to sign in afterwards: the link's own host, e.g. `ecms.egycash.com.eg`.

  Only an employee's sign-in name is called «كود الموظف»; any other account is named by its
  username, or by its email when it has none. The message is always in Arabic, whatever language
  the screen is in. A browser that will not copy shows the message in the dialog to copy by hand.

- **HR: «جاهزون للتعيين» gets the settings bar, with «مستندات الوظائف» and «المعينون».** «عاوز اعمل
  toggle switch في جاهزون للتعيين … بين مستندات الوظائف و حاجه اسمها المعينون … زي اللي موجود فيي
  الاعدادت فال hr»; «ملهاش دعوه باللي فالجدول». The bar sits above the ready-to-hire table, which is
  unchanged; each section opens under it at its own address, and pressing it again goes back to the
  table.
  - **«مستندات الوظائف»** is the same editor that opened as a popup from the table's header, now a
    section with «حفظ» and «تراجع عن التغييرات» kept in view at its foot.
  - **«المعينون»** lists everybody employed now, not external people and not those whose service
    ended, with search by code or name and branch, department and job ticks. Ticked people print
    through the same «طباعة لكل المحدد» popup as candidates: each on a line of their own with their
    job's papers, one document. A row's «طباعة العقد والمستندات» opens the employee's own tab.
  - The server takes `POST /hr/contracts/employees/bulk/open` and `…/render` (`contract.print`, at
    most 50 people). The employee list's `origin` filter takes a list.

- **HR: every filter takes several picks, and every filter is as wide as its words.** «هنخلي كل الفلترز
  multi زي checkbox كدا اقدر اختار اكتر من حاجه … و عاوين نظبط ال size بتاع الفلتر»; «العرض بتاع الفلتر و
  اللي جوه الفلتر يكون مظبوط ع كلام بظبط».
  - Each list filter is a `MultiSelect` with no fixed width: as wide as its name, and its count once
    picked; long lists are typed into from seven options, as before. Search boxes are as wide as their
    hint (`field-sizing: content`, Chromium; elsewhere the input's default). Modes stay one answer.
  - «الموظفين»: site, department, section, job, status, origin and ID card (was: fixed-width boxes and
    native lists as wide as their longest option — «كل المواقع» wide, «كل الأقسام» narrow). The view
    switch is as wide as the view shown. «الأكثر استلامًا أولًا» left the ID-card filter: ordering by
    cards received is the column's own sort. Server: `status`, `origin`, `idCard` are lists;
    `departmentId`/`sectionId` take up to 500 ids (every branch copy of several departments).
    Department/section picks travel as a name list, so a unit named with a comma survives the URL.
  - «ملفات الموظفين»: status. «التقييمات»: status (server list; the phase tabs still send one).
    «طلبات التوظيف»: status and priority (server lists) in the shared filter bar. «مصادر المتقدمين»:
    type and status — and «غير نشط» now returns the inactive sources (`active=false` was coerced to true).
  - The other recruitment bars were already multi; their search boxes and the applicant / interviewer
    pickers now fit their hint text.
  - The rest of HR, each bar in the shared `FilterBar`: «العقود» status and type; «كل الطلبات» (leave)
    status and type; «الكشف اليومي» branch and section (the date stays one day; the CSV takes the same
    lists); «طلبات التسوية» status; «التسويات» status and kind (the month stays one); «بنود الرواتب» type
    and status; «سلف وقروض الموظفين» status and type; «جلسات التدريب» status; «تقييمات الأداء» status.
    Each is a server list now (`listQuery`, `$in`); the training and performance statuses were a union
    that answered a comma list with 400. Worklist tabs and the nominations' pending/all view stay one
    answer (the view as wide as its words). Search boxes on the courses, records, cycles, medical and
    insurance pages fit their hint.
  - `common.status` («الحالة») is in the dictionary: twelve labels and column headers printed the raw
    key.

- **HR: «عروض العمل» shows the branch, department and job; «جاهزون للتعيين» filters and shows the
  department and job.** «هنحط الاداره و الوظيفه و الفرع في الجزء اللي تحت … و في جاهزون للتعيين هنزود
  الفلتر بتاع الاداره و الوظيفه و بردو هنزودهها تحت جمب العرض و تاريخ القبول».
  - «عروض العمل»: columns «الفرع» «الإدارة» «الوظيفة» after «المتقدِّم», read from the accepted terms,
    else the written terms, else — for «جاهز لعرض العمل» — the placement the record was queued with
    (`offerPlacement`), and named from the lists that keep retired branches and departments. The
    salary, which met «تاريخ الإنشاء» across one gutter (money reads from its end, the date from its
    start), is now the last data column, beside the row's action.
  - «جاهزون للتعيين»: «الإدارة» and «الوظيفة» filters, chosen as on «عروض العمل» (a department stands
    for every branch copy of it), remembered with the others; the server already filtered the accepted
    terms by them. Columns «الإدارة» «الوظيفة» after «العرض».
  - «العرض بتاع الفلتر … يكون مظبوط ع كلام بظبط»: on both screens every filter is as wide as its own
    words, the search box as its hint (`field-sizing: content`, Chromium; elsewhere the input's default),
    and every table cell and header stays on one line — a screen narrower than the row scrolls sideways
    instead of wrapping.

- **IT: the asset register's bulk upload, previewed before anything is written.** «في الأصول عايز
  زرار Bulk Upload للأصول بنفس شكل عهدة الأفرع ويكون فى Preview الأول للى هيتضاف ويوضح لو فى
  تكرار أو تضارب مع بيانات موجوده وهكذا»; then the branch is chosen on the screen, and a device in
  another branch «يتنقل لفرع الملف».
  - On `/it/assets`, «رفع جماعي» opens `/it/assets/import`: «تحميل النموذج» (the branches' custody
    sheet's header row, A to L, and nothing else), the file (`.xlsx`, up to 5 MB and 500 lines), the
    branch, and «معاينة». The file has no branch column; a sheet named «عهدة فرع X» suggests X. The
    branch list is the branches the server says the account's `itAsset.create` reaches
    (`GET /it/assets/import/branches`), so none is offered that the upload would refuse; choosing
    «من اسم الورقة» after a preview previews again without a branch, and the preview names the
    branch it is for. The file cannot be removed while a write is on its way.
  - The workbook is never inflated whole: only its first visible sheet and the four parts it needs,
    each under a cap, after the zip's entry count is checked (SEC-13). A sheet whose XML unpacks
    past its cap is refused as larger than one branch's sheet before any of it is read — a
    30 000-line register export is refused that way, not by the 500-line rule — in words of its
    own: «الملف أكبر من ورقة فرع واحد — ارفع ورقة العهدة وحدها (حتى 500 سطر)» (`SHEET_TOO_LARGE`),
    not the file's «حجم الملف أكبر من 5 ميجابايت» (`TOO_LARGE`), which a 1 MB file is not. Within
    the cap the sheet is parsed as it streams, handed to the reader in 64 KB slices, and reading
    stops one line past the 500th: a 20 000-line sheet just under the cap takes +50 to +93 MB of
    memory, where handed over whole it took +283 MB.
  - The preview decides every line against the whole register by the branches' custody go-live's
    own rules: a device found nowhere is new, in stock in the chosen branch (its tag its serial
    number, the other label its printed tag); one found gets only what it lacks («أكمّل الناقص بس»),
    a value already typed kept and shown beside the sheet's; one in stock in another branch moves to
    the chosen one and leaves its location behind; one held, under maintenance or disposed elsewhere
    stays, shown as a conflict, and is still filled — and so does one an open maintenance order
    holds, though it is in stock. The conflict says why: «متسلَّم في فرع X — لا يُنقل» when
    somebody holds it, «في الصيانة في فرع X — لا يُنقل» when maintenance keeps it (under
    maintenance, or in stock under an open order), «مستبعَد في فرع X» when disposed. A second line
    for the same device, a line two devices answer to, one with neither serial nor tag and a kind
    with no category are shown and cannot be ticked; so is an invalid line — no «النوع», no name,
    or a value past its limit — decided before anything is matched, so it never takes a device from
    a later line for the same one. A device the account's `itAsset.view` does not reach is «خارج
    صلاحيتك» and shown with nothing of it; one it may see but not fill (`itAsset.edit`) or move
    (`itAsset.assign`, reaching the branch) is «خارج صلاحيتك» too, the device named and the right
    missing said.
  - Counts per decision (each filters the table), each «النوع» with its lines and a category
    (matched automatically where it can be; changing one, or the branch, previews again), and each
    line with its tick, decision, warnings, the fields to fill (only where a tick writes them), the
    values kept and the matched asset's code. A new line one or two characters off an unlisted
    device of the branch, or whose only label is HP's product number, opens unticked; any move can
    be unticked; «تحديد الكل/إلغاء» acts on the lines in view (the count chip pressed, or all).
  - «تأكيد (n)» writes only the ticked lines, all in one transaction or none: the new assets (one
    block of codes, «من ملف «…» — رفع جماعي» in their notes), the fills and the moves, with history
    entries naming the file and the account as their actor. If the register changed since the
    preview, nothing is written and the preview runs again. Then: what was created, filled and
    moved, each linking to its asset.
  - No new grant: the screen and new lines ride `itAsset.create` (in an active branch it reaches);
    a fill needs `itAsset.edit`, a move `itAsset.assign` reaching the branch. API:
    `POST /it/assets/import` (multipart `file` with `branchId`, `kindCategories`, `apply`,
    `fileSha256`, `planHash`, `rows`; 200 the preview, 201 the result; 403 a branch out of reach,
    409 the register changed since the preview, 422 a sheet or row refused) and
    `GET /it/assets/import/branches` (`itAsset.create`; the branches it reaches, as
    `ItMoveTargetsDto`). The go-live's planner takes the sheet's lines and its write path is shared,
    the go-live unchanged
    ([IT design §2.2, §7, §10, §12](docs/12-planning/it-module-design.md)).

- **HR: a transfer can change the job title; the register forms' department, section and job are
  typed into; the employee list filters by origin.** «فى الإجراءات (نقل) على الموظف إمكانية تعديل
  المسمي الوظيفي أيضاً» · «عايز الإدارة والمسمي الوظيفي والقسم يكون قابل للبحث فى الأختيارات من خلال
  Input ميبقاش فقط Selection من Dropdown» · «زود فلتر للموظفين الخارجيين فى شاشة الموظفون».
  - **Transfer:** the «نقل» dialog gains «المسمى الوظيفي», set to the current job until another is
    picked. A transfer may now change only the job. The engine takes an optional `jobTitleId` on the
    transfer action (refused when the title is retired, checked before anything moves), records it in
    the history, and moves the linked login's job with its placement. No salary is stated on a
    transfer: pay that follows the job follows the new one, exactly as on a promotion (P-HR-22), and
    pay set by hand stays. `transfer` joins `SALARY_BEARING_ACTION_TYPES`, so payroll's salary history
    (PY-8) sees that change and prices the months before it at the old pay, and the history marks it
    withheld from a reader without the pay key. The overlap warning now sees a transfer meet a
    promotion on the job title and the salary. The dialog is mounted only while open, so each
    opening starts from the employee as they are now, with an empty date, note and document (kept
    mounted, a promotion made in between was sent back undone); a retired title the employee still
    holds stays on the list by its name.
  - **Register:** on «تسجيل موظف» and in «موظف خارجي», the department, the section and the job title
    are boxes to type into, matched on the name the way Arabic is typed (hamza, ta marbuta), never on
    the id behind it. The job list still puts the branch's own titles first, now said in a hint under
    the box. The branch stays as it was: read off the code on the register page, a list in the dialog.
    Picking again the department or job already held throws nothing away (a native list never
    reported it), and the dialog is tall so the lists are not cut by its body.
  - **Employees list:** a «مصدر التعيين» filter — التوظيف, تسجيل مباشر or تعيين خارجي, the last being
    the external employees. It is remembered with the other filters, cleared with them, and hidden in
    «بانتظار التسوية» like the placement filters. The registry already filtered on `origin`.

- **IT: assets and consumables moved to another branch, several at once.** «هنا /it/consumables وهنا
  /it/assets — عايز إمكانية نقل أصل أو مستهلك إلى فرع تاني، وطبعاً المستهلكات لو مثلاً فى 10 ماوس ..
  فممكن أنقل 5 لفرع تاني وهكذا»; then a held asset «ينتقل مع عهدته», recorded «فوراً», «لا، السجل
  كفاية», and «كذا حاجة مرة واحدة».
  - **Assets:** on `/it/assets`, pick assets and «نقل إلى فرع (n)»; on an asset's page, «نقل إلى
    فرع». The branch, a date and notes; the assets that cannot move (disposed; under maintenance, by
    its status or by a maintenance order still open or in progress; already in that branch) are
    listed with the reason and left out. All move or none, at once, with no paper. One in stock
    changes branch; one an employee holds moves with its custody, as a custody transfer to a new
    branch in the same hands — the same holder, the receipt already signed, its due date, its
    condition on issue and its notes. Either way it leaves its location behind (only the move
    clears it; a custody transfer keeps it), and its history shows the move between the two
    branches, with the move's notes.
  - **Consumables:** on `/it/consumables`, pick items of one store (or one row's «تحويل إلى فرع»),
    the branch, and how many of each — 5 of 10 mice, say. The units leave this store and reach the
    other store's item of the same name, which is added there (same name, type and unit, a new code)
    when it has none; another unit or a retired item there refuses the transfer, and nothing leaves
    beyond what is on hand. A retired item may still send its stock out. An item with nothing on
    hand is left out, and does not count toward the 50.
  - Both dialogs offer only the branches the server says the account's custody grant reaches
    (`GET /it/assets/move-targets`) — not the reach of all its grants, which offered branches the
    move then refused; while that list loads the picker waits, and with none left they say so and
    cannot be sent.
  - The ledger, its filter and its Excel/PDF gain «تحويل إلى فرع» and «تحويل من فرع», each naming
    the other branch and the other store's item code; both halves share one transfer id.
  - No new grant: both ride `itAsset.assign`, the custody grant. API: `POST /it/assets/move-branch`
    (up to 100 assets), `POST /it/consumables/transfer` (up to 50 items) and
    `GET /it/assets/move-targets` (where both may go: every active branch that grant reaches). The
    move and the transfer refuse a branch out of the grant's reach (403), an asset or item out of
    its scope (404) and a branch that is not an active one (400). The move names, in ONE refusal,
    every asset that holds it back — a held one dated before its custody began among them (422; 409
    when all are under maintenance); the transfer refuses two stores, the same store, more than on
    hand, another unit or a retired item (422). Every asset answer gains `hasActiveMaintenance`; the
    movement gains `transferId`, `counterpartBranchId` and `counterpartConsumableId` (indexed on
    `transferId`) ([IT design §2.2, §2.5, §2.11](docs/12-planning/it-module-design.md)).
  - A custody transfer in the same hands now keeps the open interval's due date, condition on
    issue and notes unless it gives its own; it and the move write their audit rows after the
    commit ([IT design FR-3, §4.3, §10](docs/12-planning/it-module-design.md);
    [ADR-021](docs/03-decisions/ADR-021-it-asset-custody-and-history.md), amended).

- **IT: the branches' custody sheets, imported once by the deploy.** «هبعتلك عهده الأفرع وعايزك
  تضيفهم مره واحده كل فرع فى فرعه فى الـ IT», then «هبعتلك أسيوط كمان». The five sheets (بورسعيد،
  طنطا، الشروق، أكتوبر، أسيوط), reviewed with the owner, in
  `apps/api/assets/it-go-live/branch-custody-2026-11.json` (244 rows, no person).
  - 68 new devices registered in their branch, in stock; a Dell's service tag is its serial number,
    and its «CN-0…» label its printed tag.
  - Devices already on the register get only what they lack («أكمّل الناقص بس»): specifications,
    accessories, printed tag, make, model. A value already typed is kept. The Shorouk sheet's 13
    Dell desktops get no processor or graphics: those cells repeat its all-in-ones'.
  - 8 devices registered under another branch move to the sheet's when in stock, and their old
    location (a place in the branch they left) is cleared; a held one stays and is reported.
  - Left out: three repeated rows (two in Tanta, one in Assiut) and two rows in October with neither
    serial nor tag; and, until the owner reads their labels, the Shorouk printer CNDRP8Z666 and
    screen B3ZY8V3 (serials the October inventory found twice), three screens a character or two
    off a register screen of their branch that the sheet does not list (October's B3SZ8V3, Assiut's
    BR565G3 and 1Q1L1T3) and an HP Z240 whose only label is HP's product number.
  - One transaction, run once (`go-live:it-branch-custody-2026-11:v1`), after the inventory, the
    October all-in-ones and the specifications; a missing branch or category refuses it.

- **«قص الوجه من صفحة A4»: the employee photo, cut from the A4 page it arrives on.** The photo
  dialog takes a PDF or a scanned page as well as a photo. Page 1 is drawn in the browser (pdf.js),
  the face is found (MediaPipe BlazeFace, run over the sheet whole and in overlapping tiles so a
  small printed photo is still found), and a crop in the ID card frame's shape — head and shoulders
  — is cut automatically: every photo, PDF or scanned page HR picks lands in the preview already
  cropped (about 1.5 s), «✓ تم العثور على الوجه وقصّه تلقائيًا», as a 600 x 760 JPEG for the ordinary
  photo save. The crop window (drag, slider, mouse wheel, arrow keys, live «في الكارنيه» preview)
  opens only when no face is found on a PDF, or from «تعديل القص» to adjust an automatic crop. PDF
  pages are drawn in pdf.js's `print` mode, so a crop still finishes with the tab in the background. The sheet never
  leaves the browser and costs the server nothing; only the crop is uploaded, under the photo's
  existing rules. Any picked photo can also be cropped by hand («قص الصورة»). The model (230 KB) is
  served from `/models`, the WebAssembly (2.9 MB compressed) is bundled and loaded only when a sheet
  is opened, and the CSP gains `'wasm-unsafe-eval'` in `script-src` — WebAssembly only; JavaScript
  eval, inline scripts and remote script hosts stay refused (pinned in `app-csp.spec.ts`).
- **«كارنيه الشركة»: the company ID card, previewed, printed and counted.** «عايزين عمود فيه أيقونة
  كارنيه … وعداد لعدد مرات الطباعة … وفلتر للي اتطبعله كارنيه واللي لأ». The employees list has an
  «الكارنيه» column: the card glows with a print count on its corner once printed, and is dimmed and
  dashed until then. It opens the card exactly as the current system's PDF prints it (88.9 x 55.88
  mm; its own artwork, positions and fonts), front and back, filled from the profile: name, job,
  employee number, employee code, the national ID and the photo — with «إضافة صورة» when there is
  none. Printing records the print first, then sends both faces to the printer at the card's size.
  The list filters on printed / never printed / most printed first, and sorts the column by print
  count. The profile has a «الكارنيه» tab: the card, times printed, the first and last card, and
  every print with who printed it. Counters live on the employee (`idCard`, moved by one atomic
  `$inc`, indexed); each print is a row in `hr_employee_id_card_prints`. Printing and reading the
  card's data take `employee.editPersonal`; the history takes `employee.view`. **The card is the
  one read that returns the national ID unmasked** — `GET /hr/employees/:id/id-card`, scoped, and
  audited as a `download` on every read; prints are audited as an `export`. The AI suit is not
  part of this change.
  **Printing is not receiving.** A print (reprint, jammed printer, a second press) never counts as a
  card: it marks the card «في انتظار الاستلام». The card counts when HR confirms the employee signed
  the A4 receipt («إقرار استلام كارنيه»: EGYCASH logo, details, the card's picture, the undertaking,
  one signature and a fingerprint box) and took it — `POST /hr/employees/:id/id-card/handovers`,
  which moves `idCard.receivedCount` by one in the same atomic update that requires a print waiting
  for it, so a double click or two HR users at once count once and a confirm with nothing printed
  is a 409. The list's icon, badge, filters (received / printed not handed over / never / most
  received) and sort (`idCard.receivedCount`) read cards received; the profile shows cards received,
  first and last receipt, total prints apart, and each print marked handed over or not. The front
  only is printed, one card-sized page, like the current system's PDF. Printing the receipt is
  kept on the employee (`POST …/id-card/receipts` → `idCard.receiptPrintedAt`, cleared by the
  handover), so reopening the card keeps that step done; the waiting card splits by whose turn it
  is — amber «طُبع ولم يُطبع الإقرار» (HR's) and sky «في انتظار استلام الموظف» (the employee's) — in
  the list's icon, the filter (`awaiting` / `receipt`) and the profile.

- **Operations: the shipment form by bank → branch, and the day board in the Fleet look.** «عند اضافة
  شحنة البنك الرئيسى دا اللى بيحاسب على الشحنة … عدل برضو الui بتاع الفورم والشاشة زى الحركة».
  - «البنك الرئيسي» is the bank billed. «من فرع» and «إلى فرع» each pick a bank, then a branch of it
    by typing (searched on the server, Arabic letter variants folded, no 100-branch cap). A branch
    that is not there is offered as «+ إضافة … كفرع جديد», which opens the catalogs' branch form with
    the bank and the name filled in; the saved branch is picked on the side that asked.
  - The area fills from the destination branch and stays editable. «اسم قائد الطاقم» and «رقم
    السيارة» pick each other from the collection day's crew plan.
  - The origin branch may belong to any bank (legacy never posted its from-bank); the destination
    rule is unchanged. A secured shipment's delivery date stays optional.
  - `/operations/shipments` in the Fleet boards' look: «تشغيل يوم …», the dark icon filter bar with
    a «قائد الطاقم» filter, the money per currency behind «الإحصائيات», and the legacy columns
    (السيارة، اسم البنك، من فرع، إلى فرع، العملة، قيمة الشحنة، قائد الطاقم، التاريخ …).
  - API: `GET /operations/shipments/day-board` rows carry their branches (with banks) and the crew of
    the leg the row reports on; `GET /operations/bank-branches/:id`; catalog searches take typed
    text literally (regex metacharacters escaped) and fold Arabic letter variants.
  - Two hover cards on the board, on Fleet's card mechanics: «لما اقف على العربيه تجيب مين اللى
    متعين عليها من سواقيين واخصائيين و لما اقف على القائد يجيب بياناته زى ما عاملين فى الحركه». The
    van code opens who rides that van on the leg's crew row (drivers from its Fleet duty row, the
    captain, specialists 1 and 2, the direction and planned time); the captain's name opens the
    Fleet driver card's facts (code, mobile, the van, the branch). The board answer carries both
    (`crews`, and the captain's code, phone and branch on each row); a reader without
    `operationsCrew.view` gets no `crews` and no phone, so the van code stays plain text.
  - The van card names the drivers and nothing more: «هعرف مين السواقين اللي عليها، لكن مش عايز
    اعرف بياناتهم». A driver's code, phone and branch stay Fleet's (its driver card); the board
    answer sends a driver's name only. The captain and the specialists keep their codes.
  - «سجل الشحنات» (`/operations/shipments/history`): «عاوز اعمل dublicat للشاشة دى بس التاريخ هيكون
    من الى». The same board — figures, filters, table, cards and row actions, one shared component
    — over «من» … «إلى» (default: the 1st of the month to today), 100 rows a page. API:
    `GET /operations/shipments/history?from=&to=` (the day board's union over a range, at most 366
    days; a range holding more than 5,000 shipments is refused with
    `OPERATIONS_SHIPMENT_HISTORY_TOO_LARGE`, never cut short).
  - The currency figures: «انا عاوز المصرى لوحده الدولار لوحده و اى حاجه غير الاتنين دول يتحسب
    عملات اخرى». The pound and the dollar were recognised by the ISO code alone, and the live
    catalog's codes are the legacy numbers (1, 2, 3), so every currency fell into «عملات أخرى». They
    are now recognised by code, name or legacy spelling, matched whole («جنيه استرليني» stays
    other). The «عملات أخرى» dialog is wider: the total on top, one card per currency, largest
    first, with its share and how many shipments carry it.
  - The filters follow the table's columns, and «كود السيارة» joins them.
  - «اليوم التشغيلي» is today only: «هنشيل منها التاريخ … هو هيجيب بتاعت اليوم». The day picker is
    gone; the board asks for Cairo's today by name and moves to the next day at Cairo midnight
    (`GET /day-board` with no date now defaults to Cairo's today too). Its filters sit on one row
    from 1024px; the history's from 1280px.
  - «سجل الشحنات» cannot add or confirm delivery («مش هيقدر يضيف … ومش هيقدر منها يسلم او
    يستلم»); edit, delete and the receipt image stay.
  - No past dates: «مينفعش لما يجى يضيف شحنه يختار تاريخ فات» / «ميقدرش يحدد يوم قبل يوم اللى كانت
    عليه الشحنة». A new shipment's collection (and a secured one's delivery) day cannot be before
    Cairo's today (`OPERATIONS_SHIPMENT_DATE_IN_PAST`); an edit cannot move a date earlier than it
    was (`OPERATIONS_SHIPMENT_DATE_BEFORE_ORIGINAL`). The form shows the floor and checks it
    before sending.
  - «السجل» on every shipment, on both screens: «هيكون فى سجل بالاكشنز اللى حصلت على الشحنة».
    `GET /operations/shipments/:id/log` (`operationsShipment.view`) reads the shipment's audit
    trail and its legs' — created, each edit with old → new values resolved to names, crew,
    the captain's steps, the desk's confirmation, the receipt image, vault and dispatch (their
    custody details only for `operationsVault.view`), delete and restore.
  - Deleted shipments: «اللى اتمسح اعملى ايقون اقدر اجيب منه اللى اتمسح». An icon on the history
    lists the range's deleted shipments (who deleted them, when, their log) with «استرجاع» for
    `operationsShipment.delete`. API: `GET /operations/shipments/deleted?from=&to=`,
    `POST /operations/shipments/:id/restore` (409 `OPERATIONS_SHIPMENT_NOT_DELETED`).
  - Secured shipments («المحصنة») in the board's look, with their own stages: «شاشة الشحنات
    المحصنة عاوز شكلها يكون زى شاشة اليوم التشغيلى … والحالة لم التسليم و تم الاستلام من القائد
    و بالخزينة». A secured row is «لم يتم التسليم» (white), «تم الاستلام من القائد» once the
    captain's ✓ in the app picks it up (yellow), «بالخزينة» once the vault receives it (green),
    then «خرجت للتسليم» / «تم التسليم». `/operations/secured` is the shared board (with «تاريخ
    التسليم»; «إضافة محصنة» books a secured shipment whose delivery defaults to the next day and
    never falls before collection — `OPERATIONS_SHIPMENT_DELIVERY_BEFORE_COLLECTION`). API:
    `GET /operations/secured/board`; board rows carry `securedStage`, `pickedUpBy` and `pickedUpAt`.
  - The vault's receive screen in the same look: the shipments with the captain (yellow) and
    those received today (green), «الكل» for the rest, and the vault's ✓ opening the receive
    form. API: `GET /operations/secured/vault-queue?all=` (`operationsVault.view`); the bank and
    currency lists now also answer `operationsVault.view`, so a treasurer sees the names.
  - «اليوم التشغيلي» lists the secured shipments due out that day whatever their stage; the
    history lists a secured shipment by its collection OR delivery date.
  - «تتبّع أرقام الأوراق النقدية» left the form. Currencies follow the reference-data order,
    arranged by drag and drop as Fleet's lists are (`PUT /operations/currencies/order`).
  - Who picked a secured shipment up, and the lock once the vault holds it: «ممكن القائد اللى يعمل
    صح انه استلم او العمليات … الشاشه بتاعت استلام الخزينة لما تعمل صح ميقدر حد من القادة او
    العمليات او الخزنه يعدل عليها».
    - One pickup record on the shipment, `pickup: {by: 'captain' | 'operations', at, userId}`. The
      captain's ✓ in the app writes it; the desk's ✓ on «المحصنة» writes it as Operations (new
      yellow stage «تم الاستلام من العمليات», `withOperations`). Operations may remove either ✓
      until the vault receives — «لو القائد عمل صح ممكن العمليات تشيلها بس لو العمليات عملت صح
      القائد مينفعش يشيلها»; removing it leaves the captain's leg as he recorded it. A row from
      before this change with no record reads its pickup leg, so a leg already picked up is the
      captain's. API: `POST` / `DELETE /operations/secured/:id/pickup` (`operationsShipment.complete`).
    - The vault's ✓ needs a pickup first (409 `OPERATIONS_SECURED_NOT_PICKED_UP`); the white rows
      stay under «الكل» to be read only — lifted later in this release (below). Receiving is one
      transaction with the custody.
    - Once received, a secured shipment is locked: no edit, delete, pickup change, pickup crew or
      receipt photo change (409 `OPERATIONS_SECURED_LOCKED`; the Files routes answer 403 for its
      photo). The flow goes on: delivery crew, dispatch, the captains' app, completion, restore.
    - «إلغاء استلام الخزينة» with a required reason, for the new grant
      `operationsVault.cancelReceipt` (no role holds it but the super admin): the custody is voided
      (kept, stamped who/when/why), the shipment goes back to yellow and can be received again.
      `POST /operations/secured/:id/cancel-receipt` (409 `OPERATIONS_SECURED_NOT_IN_VAULT`).
    - «السجل» shows «أكّد الاستلام» (by the captain or Operations), its removal, and the
      cancelled receipt with its reason.
  - «صرف الخزينة» in the boards' look: «كله يبقى موجود فى تاريخ يتفلتر». Every shipment in the
    vault, overdue first (marked «متأخرة» / «تسليمها اليوم»), with an optional delivery-day filter;
    the delivery crew is picked from the crew of the shipment's own delivery day, and ticked rows
    are dispatched one load per van. API: `GET /operations/secured/dispatch-board?date=`
    (`operationsVault.view`).
  - The two reports in the boards' look: «تجميع الخزينة هيكون زى الشاشة اللى بعتهالك بتاعت البنوك
    وتقرير القادة الشاشة هتكون الشاشة التانية». «من» / «إلى» on the dark filter card, applied as
    they are chosen (an inverted range is refused on the screen), over the dark table: م | the key |
    the count | المصري | الدولار | عملات أخرى | الحقائب | كرتونة | صندوق, «الإجمالي» under the rows.
    - «تقرير البنوك» (`/operations/reports/banks`; it shipped as «تجميع الخزينة» at
      `/operations/reports/vault` until this release renamed it — below), one row per bank with
      «عدد المحصنات», and beside it «إجمالي قيمة الشحنات»: «إجمالي المصري», «إجمالي العملات
      الأجنبية» (the dollar included), then every active currency of the reference list but the
      pound, in its order, zeros dimmed.
      Its period: «يجيب اللى اتسلم واللى متسلمش ويجيب البداية كل اول شهر» — every محصنة the vault
      received from «من» to «إلى» (the receipt's Cairo day), still held, gone out or delivered; by
      default the 1st of the month to its last day. A cancelled receipt does not count; a shipment
      received again counts once, on its new receipt's day; deleted shipments are left out. API:
      `GET /operations/reports/banks?from=&to=` (`operationsShipment.view` or
      `operationsVault.view`, the captain report's parameters; a day left out falls back on its
      own to the first or last day of Cairo's current month) answers `from` and `to`;
      `baseCurrencyCode` and `foreignCurrencies` are gone — they told the pound by the code `EGP`,
      which the live catalog does not use.
    - «تقرير القادة» (`/operations/reports/captains`), the same columns per captain under «عدد
      الشحنات»: the period's completed shipments (daily by collection day, secured by delivery
      day), the 1st of the month to its last day by default, the unassigned row last.
    - Both report screens open on CAIRO's current month: at 00:30 on the 1st they already show the
      new month, where they showed the one just ended until UTC's midnight.
    - «عملات أخرى» is the boards' rule in both: every currency neither the pound nor the dollar,
      told by code, name or legacy spelling, never by `EGP`; its click opens the boards' breakdown.
  - The vault's screens, renamed and re-cut: «وعاوز اغير اسم صرف الخزينة ل محصنات الخزينة وتكون
    وظيفتها انها بتعرض اللى موجود دلوقتى فى الخزنة», and «شاشة جرد الخزينة تكون سجل الخزينه المحصنات
    زى شاشة سجل الشحنات بالظبط واعمل فوق تقرير الخزينة … بس مفيش فتر من الى هيكون لحظى».
    - The sidebar rows «صرف الخزينة» → «محصنات الخزينة» (`/operations/vault/dispatch`, en «Vault
      Shipments») and «جرد الخزينة» → «سجل الخزينة» (`/operations/vault`, en «Vault History»); same
      routes and grants. A live installation is renamed on its next boot in each language that still
      carries the old default — an administrator's own name stays (new `previousName` on a catalog
      row, the `previousIcon` rule).
    - «تقرير الخزينة», what the vault holds NOW per bank — the same roll-up and table as «بيان الشحنات
      لكل بنك», no period: `GET /operations/reports/vault/held` (`operationsVault.view`, no
      parameters) → `{asOf, rows, grandTotal}`. Exactly the shipments «محصنات الخزينة» lists (in the
      vault: received, not dispatched; a cancelled receipt is back to draft); packages from the
      custody, once per shipment.
    - «سجل الخزينة» is «سجل الشحنات» for the محصنات alone: `GET /operations/shipments/history` and
      `/deleted` take an optional `type` (`secured` or `daily`); the 5,000-row cap is counted after it.
    - «وعاوز فى استلام الخزينة انه يقدر يعمل اضافة ل محصنة زى شاشة الشحنات المحصنة بالظبط»: the
      branch search (`GET /operations/bank-branches`, `/:id`) and the areas list now also answer
      `operationsVault.view`, as the banks and currencies already did, so the secured screen's form
      works on the vault's receive screen; booking stays `operationsShipment.create`'s.
  - «توزيع المحصنات» and «تسليم المحصنات»: «المحصنة اللى يومها هتخرج هتظهر تلقائى فى شاشة توزيع
    المحصنات هيكون فيها العربيه اللى اتحط عليها القادة والاخصائين والاتجاه … وهشد المحصنة احطها على
    العربيه او المحصنة اللى نفس الاتجاه بتاع العربيه تتحط تلقائى ولما يحفظ نفس الشاشة هنعمل زيها
    للخزنة هيكون فوق كل عربيه تسليم وطباعه … بس لما يدوس تسليم المحصنات هتتسلم ساعتها وخلاص مش
    هتبقى ف الخزنة».
    - Two sidebar rows: «توزيع المحصنات» (`/operations/secured/distribution`, beneath «الشحنات
      المحصنة», `operationsShipment.view`) and «تسليم المحصنات» (`/operations/vault/handover`,
      beneath «استلام الخزينة», `operationsVault.view`). No new grant, page or collection.
    - One read for both: `GET /operations/secured/distribution?date=` (`operationsShipment.view` or
      `operationsVault.view`; today in Cairo by default, a past day refused with
      `OPERATIONS_DISTRIBUTION_DAY_IN_PAST`). Every van of the day's crew board (captains, direction,
      time; specialists and drivers for `operationsCrew.view` only), and every secured shipment due
      out that day at any stage before dispatch, plus the overdue ones still in the vault — due
      before TODAY, the rule «محصنات الخزينة» marks «متأخرة» by, so a later day's screen never offers
      today's load to its vans — each with its delivery leg, the leg's version, the van of the day
      it is on, and the vans whose direction names its area.
    - «نفس الاتجاه»: a van's direction is split into its areas («المعادي - حلوان», «/», «،», a lone
      «و» …), each folded the boards' way (hamza, ى/ي, ة/ه, digits, tashkeel, the article) and
      compared WHOLE with the shipment's area — one matching van with a captain is proposed, several
      or none are left to the person. One pure rule in the contract
      (`operationsDirectionMatchesArea`), used by the server for every row.
    - «حفظ»: `POST /operations/secured/distribution` (`operationsShipment.edit`, assign-delivery's
      grant) `{date, changes: [{shipmentId, crewAssignmentId, captainEmployeeId, version}]}` — all or
      nothing, in one transaction, each change checked against its delivery leg's version. On a van
      (either of a van's two captains), moved, or taken off (the leg retired, its story kept).
      Refused: a dispatched or completed shipment (`OPERATIONS_DISTRIBUTION_ALREADY_DISPATCHED`), one
      not the day's (`OPERATIONS_DISTRIBUTION_NOT_ON_DAY`), a leg its captain started in the app
      (`OPERATIONS_DISTRIBUTION_LEG_STARTED`), a van of another day, a captain not on the van; each
      refusal names its shipment.
    - An overdue shipment in the vault placed on a van of the day has its delivery date moved to the
      day in the same save — the one change a received محصنة takes, because it is a flow act, not an
      edit. «السجل» shows it as its own entry, and a shipment taken off its van as «أُزيلت من السيارة»
      (log kind `crewRemoved`).
    - A draft on a van whose delivery date is then edited to another day, or cleared (`PATCH
      /operations/shipments/:id`), comes off that van in the same transaction — the leg retired as
      «إزالة» retires it (`crewRemoved` after the edit in «السجل», event
      `operations.shipmentAssignment.removed`) — so it no longer stays on the old day's route in the
      captain's app, where it could hold back his later stops. A leg he has started refuses the
      edit (`OPERATIONS_DISTRIBUTION_LEG_STARTED`, nothing written); an edit that keeps the day
      keeps the van. The pickup leg is not touched by an edit.
    - «تسليم» is the existing dispatch per van: the van's shipments in the vault leave it at once; one
      on the van the vault has not received yet stays behind.
    - …and only on the van's own day, on the server too: `POST /operations/secured/dispatch` refuses
      a crew row whose operating day is not today on the Cairo calendar (422
      `OPERATIONS_DISPATCH_NOT_TODAY`, detail `crewAssignmentId` / `TODAY_ONLY` / today), before any
      shipment is read, so nothing is written. The screen already offered «تسليم» on today's vans
      only; a page left open from another day, or a direct call, can no longer release tomorrow's
      van today, nor a past day's van that has left.
  - The screens of Round 12: «شيل الديف اللى فيها الفلاتر بتاعت التاريخ وخليها زى الفلاتر عادى وزود ان
    اعمل فلتر ب اسم القائد [اسم البنك] و ان اكسيل او pdf», «الlist بتاعت جمالى العملات … عاوز حجمها
    يكون بطول الشاشة كامله», «الصف بتاع الجماليات يفضل ظاهر حتى لو الجدول كبر يحصل اسكرول جوا الجدول».
    - «تقرير القادة» and «تقرير البنوك»: the date card is gone; «من» / «إلى» sit in the boards' one
      dark filter bar beside a name filter («اسم القائد» / «اسم البنك» — applied as typed, Arabic
      letter forms folded, remembered across visits; the period is not), the reset and «Excel |
      PDF». With a name typed, «الإجمالي» and the vault's panel are the shown rows' sum; with none,
      the server's grand total.
    - The files are what the screen shows: the rows the filter left and «الإجمالي», through the
      app's one xlsx writer and the company report form (the period and the filter under the
      title); the vault's adds «إجمالي قيمة الشحنات» as a second sheet and a second printed page.
    - On a computer the table's card runs to the bottom of the screen: its head stays at the top,
      «الإجمالي» at the bottom, and only the rows scroll. The vault's currency panel is as tall, its
      list scrolling inside it.
    - «محصنات الخزينة» is view only: the list, overdue first, the optional delivery-day filter and
      «السجل» — no delivery crew, no release, no ticks, no cancelled receipt (that stays on
      «الشحنات المحصنة»).
    - «سجل الخزينة» is «سجل الشحنات» for the محصنات (from–to by collection or delivery day, the
      filters, «السجل», the deleted list with restore, paging), on the whole page. «تقرير الخزينة»,
      beside «إخفاء الإحصائيات», opens what the vault holds now over the whole screen, built like
      Fleet's custody dashboard: «حتى …», figure tiles (count, pound, dollar, «عملات أخرى» with its
      breakdown, bags, cartons, boxes), the per-bank table with its panel beside it, Excel and PDF.
      It is read only while open. A reader without `operationsShipment.view` gets the same report
      on the page at full height and a line saying what the history needs.
    - «استلام الخزينة» has «إضافة محصنة» — the secured screen's button and form (delivery the next
      day by default), for `operationsShipment.create`.
    - «توزيع المحصنات»: the day's vans on the right (number, time, direction, captains, specialists,
      what each carries), the day's محصنات on no van on the left (stage, «متأخرة»). A محصنة is
      dragged onto a van, or moved with «نقل إلى…» on its card (keyboard and phone); dragged back,
      or «إزالة من السيارة», it comes off. On a two-captain van it goes with the first captain; the
      chip on its card switches it. On the day's first read and on «توزيع تلقائي», each محصنة on no
      van whose area exactly one van's direction names is proposed onto it («مقترحة» until saved).
      «حفظ» sends every change at once; a refusal marks the card it names and keeps the other
      moves; leaving with unsaved moves asks first.
    - «تسليم المحصنات»: the same two columns, read only. Over each van «تسليم»
      (`operationsVault.dispatch`) confirms, then hands over the van's محصنات in the vault; those
      not received yet are listed and stay. «طباعة» prints the van's load sheet on the company form
      — provisional until the owner says what the paper carries («اللى هيطبع هقولك عليه بعدين»).
  - The vault receives without a pickup, and its screen says who did what in two columns: «انا عايز
    الجدول بتاع استلام الخزينه يكون مكان الحاله عمودين. العمود الاولاني يبقى خاص يبين ان اللي حصل
    استلام من القائد او من العمليات، والعمود التاني بتاع الحاله برضو يبين استلام من الخزينه. واستلام
    الخزينه ممكن تستلم يكون القائد معلمش التسليم، او ان العمليات معملتش التسليم والخزنه تستلم عادي».
    - Round 10's rule is lifted: the vault's ✓ no longer needs the captain's or the desk's ✓ first.
      `POST /operations/secured/:id/receive` takes any draft, white or yellow
      (`OPERATIONS_SECURED_RECEIVABLE_STAGES` now holds `awaitingPickup` too; the new
      `OPERATIONS_SECURED_PICKED_UP_STAGES` names the two yellow ones). The receipt writes no pickup:
      a shipment received with nobody's ✓ is `inVault` with no `pickedUpBy`, for good, and «السجل»
      shows the receipt and no pickup. `OPERATIONS_SECURED_NOT_PICKED_UP` now answers only the desk's
      removal of a ✓ that is not there. The lock, the cancelled receipt (back to white when nobody
      had picked it up), distribution and handover are unchanged.
    - «استلام الخزينة» lists by default what the vault can receive now: every محصنة whose collection
      day is today or earlier, white or yellow, every yellow one whatever its day, and today's
      receipts; «الكل» adds the white ones booked for a later day.
    - The screen's «الحالة» becomes «حالة الاستلام» (من القائد / من العمليات with the time, or «لم
      يتم الاستلام») and «حالة الخزينة» («بالخزينة» with the time, not yet received, or out since);
      the vault's ✓ is on every row not yet received, and the «للعرض فقط» line is gone. Each column
      has its own filter where the stage filter was (the bar stays one row); the legend counts
      «لم يتم الاستلام», «مع القائد أو العمليات» and «بالخزينة اليوم» from the start. The other
      boards keep their one «الحالة». «إلغاء استلام الخزينة» on a receipt nobody handed over says
      the row goes back white, not yellow.
    - The captain's route: a pickup he never started on a محصنة the vault has received is done with
      — it no longer holds back his next stop, and his record of it stays as it was (not started). One
      he had started stays his to finish; his ✓ then records his own step only. A cancelled receipt
      gives an untouched pickup back to him.
  - «إدارات العمليات», one choice per company department (a screen of its own since — below):
    «القائمة دي كانت معمولة لما كان في مشكلة في الإدارات، وأنت عامل تكرار إدارات … على حسب الفروع.
    فإحنا عايزين نعدل الموضوع ده، وعايزين نحسن اليو اي بتاعها، وعاوز أخليها تبقى الديفولت بتاعها إن
    هي مخفية، ولما أدوس كليك على السهم يعرضها لي».
    - The card offers each department ONCE — «نقل الأموال», not «نقل الاموال» seven times with seven
      unit codes — with the number of branches that have it and their names (on the tile, and in
      full on hover). Branch copies are grouped by their catalog entry; a copy never linked groups
      by its name with Arabic spellings folded («الاموال» = «الأموال»), and joins the catalog entry
      of that name when there is exactly one (`orgUnitGroupKeys`, `@ecms/contracts`).
    - A chosen department is crew in EVERY branch that has it, a branch that adds it later
      included: the roster (`GET /operations/crew-board/directory` — the crew page, the crew board,
      the standing crew and the shipment captains) widens each saved id to every active unit of
      its department. The setting is still `operations.crewDepartmentIds` and still holds
      department ids, so nothing is migrated: every saved id stays in the roster as it was, and a
      roster saved before only widens to the same department in the other branches. Its cap rises
      from 50 to 200 ids, because «حفظ» writes every active branch copy of each chosen department.
    - The search (by department or by branch), the tiles — what is saved first, then the rest, each
      alphabetical — and «تراجع» / «حفظ», both waiting for a change, with «تغييرات غير محفوظة» while
      ticks are pending. A saved department whose every copy has been deactivated is shown «غير
      نشطة», and an id nothing answers to «غير موجودة»; both stay ticked until unticked, and the
      empty-choice warning stays. (The card that sat closed on «كشف الأطقم» moved to its own screen,
      open — next.)
  - «تقرير البنوك» is what «تجميع الخزينة» was, and «تجميع الخزينة» is gone: «انا كنت قلت لك اعمل لي
    شاشه تقرير بنوك … انت فعلا عملتها بس حطيتها في شاشه تجميع خزينه. فبعد اذنك خلي المحتوى بتاع
    تجميع خزينه ده يبقى اسمه تقرير بنوك، وتجميع خزينه كشاشه مفيش حاجه اسمها تجميع خزينه، شيلها
    خالص». Asked which shipments it counts, the owner kept the roll-up's: secured only, every one
    received into the vault in the period, delivered since or not.
    - `/operations/reports/banks` shows the roll-up's screen exactly — «بيان الشحنات لكل بنك», «عدد
      المحصنات», «إجمالي قيمة الشحنات», «من» / «إلى» on Cairo's month, «اسم البنك», Excel and PDF named
      «تقرير البنوك». The old completed-shipments-per-bank screen (legacy `/ops_bank_report`) and its
      `ReportView` / `ReportRangePicker` are gone.
    - One endpoint: `GET /operations/reports/banks?from=&to=` answers what
      `GET /operations/reports/vault` did (`OperationsBankReportDto` is the roll-up's shape;
      `OperationsVaultReportDto` is gone), and `/reports/vault` answers 404. «تقرير الخزينة»
      (`/reports/vault/held`) is unchanged.
    - Its readers are both screens' readers: `operationsShipment.view` OR `operationsVault.view` —
      the endpoint (`authorizeAny`), the route guard, the module home's card and the sidebar row
      read one list (`OPERATIONS_BANK_REPORT_KEYS`). The sidebar row keeps its key; a vault-only
      reader sees it through `SHARED_NAVIGATION_ROWS` — "any of these keys" for one screen without
      tabs, beside the hubs (`navigationRowKeys`, `@ecms/contracts`).
    - «تجميع الخزينة» leaves the app: its sidebar row is retired — inactive on a live installation,
      once, at Operations' first retirement — its module-home card and words are gone, and
      `/operations/reports/vault` forwards to `/operations/reports/banks` with its query string.
  - «إدارات العمليات» on a screen of its own: «انا عاوز افصل ان احدد اداره معايا ولا لا عن تجهيز
    الطاقم», and asked where, «شاشة لوحدها في القائمة».
    - `/operations/crew-departments`, the sidebar row right beneath «كشف الأطقم», on `setting.edit` —
      the grant that writes the one setting it edits, which the card always required. The card is
      the page, open, in its round look, under the page title with how many people the saved choice
      makes (read only for a reader who may read the roster).
    - «كشف الأطقم» no longer carries the card. Its «not configured» notice, and the crew pools'
      «حدِّد الإدارة», link to the new screen for a reader who may open it, and say who chooses the
      departments to everybody else.
    - The Operations sidebar is still eighteen rows (one retired, one added).
  - «لوحة تحكم» on «محصنات الخزينة»: «دلوقتي محصنات الخزينة أنا عايز يكون فيها لوحة تحكم اللي هي
    داشبورد جنب الإحصائيات».
    - A button right beside «إخفاء الإحصائيات», in its look — as on Fleet's custody board and on
      «سجل الخزينة» — opens the dashboard over the whole screen, in the very window «تقرير الخزينة»
      opens in. That window and its seven tiles are now one component for the two
      (`ReportModal.tsx`): the portal, Escape for the top dialog only (the «عملات أخرى» breakdown
      over it closes alone), Tab kept inside, the focus handed back, the page held still, dark and
      light, a full-screen sheet on a phone.
    - It reads the board's own rows as they are shown (every filter, before the pages), worked out
      in the browser, so it cannot disagree with the table under it; the bags, cartons and boxes
      come from the vault's custody list. A line at the top names the filters in force — «كل
      المحصنات بالخزينة — بلا فلتر» when there are none — with «إعادة ضبط الفلاتر» (the window stays
      up, dimmed over its last rows, while the board reads its list again). Offered once the rows
      are in, never beside a refusal; a refusal while it is up closes it.
    - The figures of «تقرير الخزينة»; five alerts with their count and pound — «متأخرة», «تسليمها
      اليوم», «تسليمها غدًا», «بدون يوم تسليم», «لم تُوزَّع على سيارة» (late or due today and on none
      of today's vans) — of which today's and tomorrow's set the board's «تاريخ التسليم» and close
      the window; «جدول التسليم» (late, today, the next seven days, later) and «مدة البقاء في
      الخزينة» (today, 1–2, 3–6, 7+ days, on the Cairo calendar); «بيان الشحنات لكل بنك» with
      «الإجمالي» pinned and «إجمالي قيمة الشحنات» beside it; Excel and PDF of the two. Every section
      is drawn at zero when nothing is shown.
  - Polish: «استلام الخزينة»'s two status badges read on one line at 1440 (its board's names wrap
    from a lower floor, its notes cut sooner, its cells' sides 7px); a counted محصنة takes its Arabic
    form on the distribution, handover and dashboard screens («محصنة واحدة · محصنتان · 4 محصنات · 11
    محصنة»); the dashboard's Excel and PDF add «تنبيهات التسليم», «جدول التسليم» and «مدة البقاء في
    الخزينة» after the bank table and its panel (the reports' files are unchanged); and the handover's
    today-only refusal reads «التسليم يتم يوم خروج السيارة فقط».
  - «إستلام محصنة» — the legacy receive form on the vault's ✓: «عاوز اخلى الفورم دا لما اجى استلم
    محصنة», and «انا مش عاوز اى اسماء ومش عاوز اى خانة من الخانات دى اجبارى كله اختيارى».
    - `POST /operations/secured/:id/receive` takes `{ version }` alone. The receipt number is
      optional (trimmed; blank is none — a custody without one reads «—»), the counts default to 0,
      and «2×» / «3×» is `bagSealsPerBag` (default 2). The seals are kept as typed, trimmed, blank
      boxes dropped, with no length tied to a count; cartons have none.
    - No names: the two treasurers are gone from the request (a 400 if sent) and from Q2's rule —
      the custody records the signed-in user from the token (`receivedById`). Receipts taken before
      keep their two treasurers, still shown on the vault list and in «السجل»; cancelling one works
      as before.
    - «عدد الورق من كل فئة»: `denominations`, the notes counted of each pound denomination (0.25 …
      200, `OPERATIONS_VAULT_DENOMINATIONS`); an unknown one or one twice is a 400, zero counts are
      not stored. «سيريال» — «بتتعرف عند الاستلام اذا كان سيريال او لا» — is `serialTracked`, set at
      the receipt and shown on its «السجل» entry.
    - «تعدّلها عادي»: the vault may correct the shipment's data in the same form (`shipment` — the
      edit form's fields and the very rules `PATCH /operations/shipments/:id` applies, minus the
      version and «سيريال»; only what changed — an empty one is no edit). The corrections and the
      receipt are ONE transaction: refused by an edit rule, or failing after the edit, nothing is
      written. «السجل» shows what the vault changed, then the receipt, both by the receiver.
      `operationsVault.receive` covers the corrections; `operationsShipment.edit` is not asked.
      After the receipt everything locks, as since Round 10.
    - The answer adds `receipt` (`OperationsVaultReceiptDto`): when, the stored values and who
      received it by name — for the «إيصال» print. The vault list rows carry `bagSealsPerBag`,
      `denominations`, `receivedById` and `receivedByName`; «السجل» prints `bagSealsPerBag` and
      `denominations`. No uniqueness rule ever applied to receipt numbers, so none changes, and no
      migration: older rows read as they were stored.
    - The form, on the vault's ✓ in «استلام الخزينة», is legacy's three bands in the app's look:
      the shipment's data prefilled and editable with the shipment form's own boxes and rules (bank
      → branch with the inline add, the area from the TO branch, the money lines in the catalog's
      order, the dates' floors; the captain and the van shown read only), only what changed sent;
      the receipt — «رقم الإيصال», «عدد الحقائب» with «2×»/«3×», «عدد الصناديق», «عدد الكراتين»
      and a count under each of 0.25 … 200 with their total beside the shipment's pounds (a hint
      when they differ, never a refusal); and the seals — one box per seal (bags × the radio, two
      per box, none for cartons) under legacy's summary line, «[1 - 4]», «[6 - 8] - [10 - 11] -
      13», a lone seal in red. A scanner's Enter moves to the next box. No box carries a star and
      nobody is picked: «يُسجَّل المستلم تلقائيًا». A refused branch, bank, currency or date is said
      under its box. After «استلام» the form stays open, locked; «إيصال» prints the receipt on
      the company form (a «مسودة» before «استلام»). The shipment form looks and behaves as before.
    - Round 18b — «خلى الفئات لوحدها كدا فوق رقم الايصال» and «يملى اللى ف النص بالترتيب بينهم»: the
      notes of each denomination are a row of their own over the receipt number and the packages;
      a whole number typed in the FIRST and the LAST box of a seal list (bags, or boxes) fills the
      empty boxes between in order — only when the run is exactly as long as the boxes (up or
      down, the first box's leading zeros kept), never over a box typed by hand, again whenever
      an end or the count changes — and a run that does not fit fills nothing and is said beside
      the list's summary. Cartons stay a plain count with no seals.
    - Round 21 — «مينفعش يكون فيه رقم للحقائب و الصناديق زى بعض برضو» (said over the form with bags
      1 … 6 and boxes 1 and 3): within ONE receipt a seal number appears once, the bags and the
      boxes read as one list, and a seal typed twice in its own list is the same fault — now a
      refusal, where it was an amber «مكرر». "The same seal" has one definition, in the contract
      (`vaultSealKey`): digits compared as whole numbers (0099 = 99, Arabic-Indic digits counted),
      anything else as typed, trimmed, and an invisible direction mark pasted in with a number
      ignored (two boxes that both show 12 are one seal). `POST /operations/secured/:id/receive` answers 400
      `VALIDATION_FAILED` on the later occurrence (`body.boxSeals.1`, at the index sent), its
      message naming the seal and where it first appeared, and writes nothing. The form marks
      every box holding a repeat red (a number the range fill wrote included, its title saying
      where else the seal is), says it once under the seals — «الرقمان 1 و3 مكرران — في الحقائب
      والصناديق» — and holds «استلام» until it is corrected; a refusal of it from the server is
      said there in the same words. Cartons have no seals; other shipments' seals are not compared.
    - Round 21b — asked whether a seal already recorded on another محصنة should be refused, the
      owner: «لو موجوده عندنا لا ك محصنة يبقى مينفعش ولو دخلت وخرجت واتكرر يبقى عادى». A receipt is
      refused while any of its seals (bags or boxes, by `vaultSealKey`) is a seal of ANOTHER محصنة
      the vault still holds — its custody `held`, the receipt not cancelled, the vault inventory's
      own set; one that came in and went out again (released to its van, dispatched, completed) or
      whose receipt was cancelled may repeat. `POST /operations/secured/:id/receive` answers 409
      `OPERATIONS_SEAL_HELD_IN_VAULT`, one detail per seal (`bagSeals.1` as stored, the held
      shipment's id), and writes nothing — the vault's corrections of the shipment included; the
      held seals are read once, in the receipt's own transaction. `POST
      /operations/secured/seal-check` (`operationsVault.receive`) answers which of a list of seals
      the vault holds and on which محصنة (bank, branches, receipt number). The form asks it once
      the typing pauses — stale checks cancelled — marks a held seal's boxes red like a repeat
      («موجود في الخزينة على المحصنة: …»), says it in the same one notice under the seals («الرقم 7
      موجود في الخزينة على محصنة أخرى (بنك مصر، إيصال 1234)») and holds «استلام»; a 409 marks the
      seals it names, and a check that fails holds nothing — the receipt decides. Two treasurers
      receiving the same seal in the same instant can both be taken (documented in the service):
      closing it would serialise every receipt on a lock document, for a mistyped number twice in
      one transaction's time — both receipts are kept, and the first to take it answers for it.
  - «كشف طاقم العمليات» after the legacy screen: «عاوز احسن الui بتاع الشاشة دى دا كان القديم برضو
    القى نظره».
    - The Operations boards' look: the title in the toolbar with the hint a line under it (since
      Round 23 it says that «قائد» and «أخصائي» decide the crew board's slot and the other flags
      are indicators, not conditions), the figures over the rows shown («الأفراد», «القادة»,
      «الأخصائيون»), the one-row dark filter bar, the dark table, the boards' pager past 50 rows.
      The «not configured» notice stays, as a slim line ending on «إدارات العمليات».
    - Columns الاسم | الوظيفة, then all ten flags, «قائد» and «أخصائي» first and the legacy order
      after; «صحة التوقيع» and «مزاولة المهنة» take the legacy wording (the crew board reads the
      same labels). The person comes first — «يكون فيها الاسم بتاع القائد فى الاول وجمبه صغير كدا
      الكود ولما اقف على القائد يجيب بياناته زى السواق»: the name, the code small and muted beside
      it (no column of its own), and hovering the name (or Tab to it) opens the member's card in the
      Fleet driver card's look — the whole name, the code, «الوظيفة», the mobile number, the branch,
      and the flags held as labelled chips. No phone line for a reader the server sends none to.
      Each flag is the legacy round toggle — green with ✓, grey — a `switch` named for the flag
      and the member, pressable only with `operationsCrew.plan`; a reader without it is told the
      screen is view-only.
    - Filters in the columns' order — «والفلاتر تكون ترتبيها زى الجدول والغى السيرش بالكود خليه
      مكان واحد للاسم والكود سوا»: ONE box «الاسم أو الكود» (the name or the code, Arabic letter
      forms and digits folded), «الوظيفة» (the titles on the roster, or «بلا وظيفة مسجَّلة») and
      «يحمل» (every flag chosen; it reads what is saved, so a row does not vanish while a box in it
      is unticked), remembered across visits. A view remembered with the two old boxes opens on
      their text in the one. The screen no longer reads a `date`.
    - Saving is a batch, as legacy's «حفظ» was: a tick waits — ringed, its row tinted — until «حفظ
      (n)» sends every waiting row, one whole-row `PUT` after another (no new endpoint: each row
      keeps its own existence check and audit entry, and one refused row does not cost the
      others). A refused row stays red with the server's reason and its ticks kept; «تراجع» drops
      them; leaving with ticks waiting asks first.
    - `GET /operations/crew-board/directory`: each member carries `jobTitle` (`{ id, name }` or
      null) — HR's seat through the directory seam, named from the job-title catalogue — and, for
      the card, `phone` and `branchId` (each null when HR has none on file), all under
      `operationsCrew.view` as the name and code are.
  - «لوحة التشغيلة», the server half — the approved sample, with the owner's two changes: «دى تمام بس
    انا عاوز النوع يكون بيضاف من البيانات المرجعيه و شكلها فى الشاشة تكون زى الساعة والملاحظات كله
    تحت بعض مفيش حاجه داخلة وحاجه خارجه».
    - «أنواع التشغيل», a catalog of the reference data: `GET`/`POST /operations/shift-types`,
      `PATCH /:id` (archived with `isActive`, never deleted), `PUT /order` (the currencies' drag).
      Each type has an Arabic name, an optional English one, a colour of a small fixed palette and
      its place. Written under `operationsCatalog.manage`; read by `operationsCrew.view` too, the
      board's own grant. The legacy nine (يومي، احتياطي، احتياطي سفر، أسوان، إيباج، سفر، شلاتين،
      محصنة، مسائي) are seeded on boot in the legacy order, once: a renamed or archived one is never
      seeded again.
    - A crew row carries «النوع» (`shiftTypeId`) and its colour (`rowColour` — «وعاوز زرا يبقى فى
      كذا لون اقدر الون به الصف»: yellow, green, blue, red, purple, orange, or none). A type NEWLY
      chosen must be active (`OPERATIONS_UNKNOWN_SHIFT_TYPE`); a row keeps the one it holds.
    - Rows without a van — «وعاوز اقدر اضيف صف ميكونش ليه عربيه واضيف كل البيانات برضو»: the save
      creates one with `vehicleId: null`, edits a saved one by `crewAssignmentId`, and deletes one
      through `removeCrewAssignmentIds`. Q11 counts them (one person, one row per day). Given a van,
      the row moves onto the van's row in one save: the van's row, and the old row removed. The board
      returns them apart, as `vehiclelessRows`, and no van reader sees one: not the van cards, the
      distribution, a shipment leg (404) or the captain's day. `ux_day_vehicle` now counts only rows
      with a van; the boot rebuilds it on a database that still has the old shape.
    - «الاتجاه» — «اقدر اكتب بس فى الاخر لازم اختار من الاتجاهات اللى موجوده بتاعت البنوك»: a new or
      changed direction must name active operations areas, Arabic letter forms folded, and is
      stored in the areas' own spelling (several areas joined by « - »; the distribution still
      reads each). A direction saved before stays while it is sent unchanged
      (`OPERATIONS_DIRECTION_NOT_AN_AREA` otherwise). The areas list is read by
      `operationsCrew.view` too.
    - «كل عربيه هيبقى عليه من 1 ل 2 قادة و من 2 ل 4 اخصائيين»: two per slot at most, as before; the
      minimums are the board's warning, never a refusal.
    - The board's read: each van's drivers by name only («ولما اعمل هوفر على العربيه يظهر السواقيين
      اللى عليها»), and `workshopVehicles` — «صيانة», the day's vans in a Fleet workshop visit.
      That means the day's roster vans, the standing crew's vans and the configured cash-transfer
      vans, read from Fleet's own open-visit answer.
    - «حضور الطاقم»: each member also carries `isCrewed`, true when the person holds a place on
      any of the day's rows. A row without a van counts, though `assignedVehicleId` has no vehicle
      to name for it. The page's «معيَّن» badge reads it, so a person on such a row still shows as
      crewed.
    - Round 22 — «وعاوز لو القائد غايب يظهر تحت الكل … ومقدرش احطه على العربيه و كذلك الاخصائيين»:
      each pool member carries `availability` for the requested day — 'absent' or 'onLeave' from
      HR's day record, else 'onLeave' when HR has no record yet and an approved or active leave
      covers the day (HR computes a day only once it is over, so for tomorrow leave is the only
      fact), else null. An unknown is not an absence. It is one attendance read and one leave read
      for the whole roster, served under `operationsCrew.view` (only the bucket). The save refuses
      to NEWLY put an away person on a row: 422 `OPERATIONS_CREW_MEMBER_ABSENT`, naming him
      (`employeeId`, `ABSENT` / `ON_LEAVE`) and the row (`ROW_INDEX`), with nothing written. Someone
      already on that row stays, so the row's other changes still save; moved to another row, he
      is refused.
    - Round 23 — «ممنوع ان اعين قائد مكان اخصائى والعكس الا فى حالة انه قائد اخصائى»: the save refuses
      to NEWLY put somebody in a slot his role does not fit — a captain-only in «أخصائي 1/2», or a
      specialist (also anybody ticked neither, or with no requirements row) in «قائد الطاقم»; a
      captain-specialist fits every slot. 422 `OPERATIONS_CREW_MEMBER_WRONG_SLOT`, naming him
      (`employeeId`, `NOT_A_CAPTAIN` / `NOT_A_SPECIALIST`) and the row (`ROW_INDEX`), with nothing
      written. The roles come from «متطلبات الطاقم» in one read for all the save's people. Somebody
      already in that same slot of that same row stays (seated before the rule, or before his flags
      changed), so the row's other changes still save; another slot or another row is a new seat.
      The standing crew's save holds to the same rule. «قائد» and «أخصائي» are the only requirement
      flags that decide anything; what they make a person and which slot that fits
      (`crewRoleOf`, `fitsCrewSlot`) are in the contracts, one definition for the server and the
      board. This replaces the Round-20 default the owner never asked for: a specialist in a
      captain's slot was marked, not refused.
    - Round 24 — «عاوز لو عربيه من غير كود عادى تظهر ان اوزع عليها محصنات و مكان بدون سيارة دا لما
      ادوس عليه يجيب كل السيارات اللى مش عليها طاقم واقدر اختار منهم»:
      - A row WITHOUT A VAN takes محصنات like a van. Round 20's «a row without a van carries
        nothing» is reversed for the محصنات: «توزيع المحصنات» lists such rows after the vans (in the
        order they were added, `vehicleId` and `vehicleCode` null, no drivers), proposes onto them
        by direction, and places on them with the same checks. «صرف الخزينة»'s assign dialog takes
        them too, «تسليم المحصنات» hands their load over, and their captain gets his route in the app
        and may act on it. The captaincy anchor now reads any crew row of the day; identity still
        comes from the token alone. A shipment leg's `vehicleId` is nullable. Every DTO, audit
        snapshot and event that carries a leg's or a crew card's van now says `null`, never the
        text "null" (`OperationsShipmentAssignmentPayloadV1` and `…ExecutionPayloadV1` too). The
        daily PICKUP leg still takes a van's row only.
      - `freeVehicles` on the crew board (`GET /operations/crew-board` and the save's answer): every
        ACTIVE Fleet car (status `active`, not deleted) with no crew that day. A roster van whose row
        was emptied to nothing and holds no leg counts as having none. Each car carries
        `group`, `onRoster`, `inWorkshop` and its drivers by name when the roster has it. The order
        is the roster, then the cash-transfer operations' cars, then the standing crew's, then the
        rest, each group by code with numbers in number order. Read through `fleet-boundary.ts`.
      - A van the Fleet roster does not have that day may be given to a row (it answered
        `OPERATIONS_FLEET_DUTY_REQUIRED` before; that code is no longer sent). It must be active
        (422 `OPERATIONS_CREW_VEHICLE_NOT_ACTIVE`), out of the workshop that day (422
        `OPERATIONS_CREW_VEHICLE_IN_WORKSHOP`) and held by no other row (409
        `OPERATIONS_CREW_VEHICLE_TAKEN`). Such a row stores no roster row and is listed in `rows`
        with `fleetDutyAssignmentId: null`; its drivers are joined by (van, day), so a van Fleet
        rosters later that day shows them. Unlike a roster van's row, it may be removed. A save
        row that names such a van WITHOUT a row id is always a NEW row: when a second desk gives
        a car another desk crewed since its read, it gets 409 `OPERATIONS_CREW_VEHICLE_TAKEN`,
        and the first desk's row (its crew, and the captain its محصنات name) is never
        overwritten. A ROSTER van named alone is still that van's row, upserted, as it always was.
      - A saved row without a van is GIVEN a van in place: the row is sent with both
        `crewAssignmentId` and `vehicleId`. It keeps its id, and in the same transaction its live
        legs take the van; each change is audited on the leg («السجل» shows `crewChanged`) and
        announced. Its people count as new seats for the absence and slot rules. A roster van's
        emptied row is released for it.
      - A row that holds محصنات (live legs, delivered or not) is never removed: 409
        `OPERATIONS_CREW_ROW_HAS_SHIPMENTS`, naming the row and the count. Emptying it stays allowed,
        as it always was for a van's row.
      - Every board row's crew (`OperationsDayBoardCrewDto` — the day board, the history, the
        vault's screens, «صرف الخزينة») carries `looseNumber`: for a crew without a van, its place
        among its day's rows without a van, in the order they were added, exactly as «لوحة
        التشغيلة» and «توزيع المحصنات» number it; null on a van. One read for all the days shown.
    - The screen (web): `/operations/crew-board` is the approved sample on this contract. The
      table, its boxes, the two pools (green and blue captains, red specialists, the requirement
      icons), drag and drop with «ضع هنا» for a keyboard or a phone, «الطاقم الثابت», Excel, the
      van's hover card with its drivers, «صيانة» with the workshop's codes, and one «حفظ (n)».
      - «النوع» is the catalog's ACTIVE types, in its order and colours. A row that holds a type
        archived since keeps it, named and marked amber; the strip's counts and the type filter
        follow the catalog.
      - «شكلها … زى الساعة والملاحظات كله تحت بعض»: the type is now a box like the time and the
        notes. It has the same height, border, corners and padding, fills a column of one width,
        and shows its colour as a dot at the start. The swatch and the bin sit on the boxes' line.
      - The direction box takes an area in the area's own spelling, by the server's own rule. Two
        areas saved as «المعادي - حلوان» read as known. Its list is every active area, read page
        by page, not the first hundred: the save holds a new direction to all of them.
      - A save refused for a type or a direction is worded and marked red on the row it names, and
        that row is scrolled into view. Any other refusal is said once, in its own words; only a
        Q11 clash reads «قد يكون أحد الأفراد معيَّنًا على مركبة أخرى».
      - «أنواع التشغيل» is a tab of the reference-data screen, built as the currencies' tab: the
        whole list dragged into order (the arrows for a keyboard), a form with the palette's
        eleven swatches and the type drawn as the board draws it, and archive or restore in one
        click.
      - Round 22, the owner on the live board — «مش راضى يخلينى احط ولا قادة ولا اخصائيين على
        العربيه … بسحب الاسم بالماوس وبيرجع تانى اكنى متحطش»:
        - A — the drop no longer hangs on what the browser shows of a drag: the whole board takes
          the drag, the drop decides (on a slot that slot, anywhere on a row the slot the role
          takes, the vehicle's cell included), a full slot is said in words, nothing re-draws in
          `dragstart`, and another desk's save is rebased under an unsaved draft, not over it.
        - B — «القادة اللى فى نفس الوقت اخصائيين يكونوا فى الاخر»: the blue ones after the green.
        - C, D — «لما اقف على سلاح او مزولة … يبقى فشكل احسن» and «لما اقف على القائد يظهر فى كارد زى
          السواق فى الحركة»: a tip in the cards' frame on every requirement icon, and the Fleet
          driver card's look on every name, with the role, where he sits and his attendance.
        - E — «وعاوز مكان عند العربيه زى الحركة كدا لما ادوس عليه يجيب قايمة الناس اللى اختار
          منهم»: an empty slot says «+ اختيار قائد» / «+ اختيار أخصائي» and a half-full one has a «+»
          beside its ✕; either opens the people to pick from, as Fleet's «+ اختيار سائق» does —
          the people the slot takes (only those since Round 23, below), a search by name or code,
          free first, then who sits elsewhere (picking him moves him), with the role's colour, the
          code, the icons and «متاح N». A pick runs the drop's own rule. The keyboard works it throughout (arrows,
          Enter, Escape); a phone gets Fleet's bottom sheet. Picking a name first, then «ضع هنا»,
          stays.
        - F — «وعاوز لو القائد غايب يظهر تحت الكل بقى فى الاخر يبقى باللون الباهت ومقدرش احطه على
          العربيه و كذلك الاخصائيين»: somebody HR has absent or on leave that day is listed last in
          his pool, pale, «غائب» / «إجازة» on him, and cannot be dragged, picked up or picked (the
          list shows him last, closed, with why); every slot refuses him in red with the reason,
          and «متاح N» leaves him out. The standing crew leaves him off and names him; a row
          holding him is given no van. Seated before HR recorded it, he is ringed and marked,
          stays until taken off, and the save passes; the server's
          `OPERATIONS_CREW_MEMBER_ABSENT` rings his chip on the row it names and says his name.
          The pool is read for the board's own day — on the default board (tomorrow) too, where the
          roster asked without a date would have answered for today.
      - Round 23, the owner — «فى مشكلتين الاولى ان قولتلك لو قائد واخصائى يبقى فى القايمة بتاعت القائد
        بس يكونوا فى الاخر دلوقتي فى الاول والتانية ممنوع ان اعين قائد مكان اخصائى والعكس الا فى حالة
        انه قائد اخصائى»:
        - The first: a captain-specialist (blue) is listed in «القادة» only, after every green
          captain — in its free part and its placed part — and never in «الأخصائيون»; the same in
          every slot's list and in the standing crew's «قادة الأطقم». He saw them first because
          production still runs Round 20; Round 22's B, which put them last, ships in this PR.
        - The second: a captain goes only in «قائد الطاقم», a specialist only in «أخصائي 1/2», a
          captain-specialist anywhere. A drop aimed at a slot not his is refused in words — «لا يُعيَّن
          قائد في خانة أخصائي» / «لا يُعيَّن أخصائي في خانة القائد», then whom that slot takes — and
          the slot shows red with «للقادة فقط» / «للأخصائيين فقط» while he hovers; a drop on the row
          routes him only into slots he fits. A slot's list offers only who fits it: «قائد الطاقم»
          the captains, then the captain-specialists; «أخصائي 1/2» the specialists, then the
          captain-specialists. They are folded in, last in each part, not given a tab: a tab hides
          the fallback, and a free captain-specialist should come before people who would have to
          be moved off another van. The tab to the other pool is gone (it held only people the slot
          refuses); a strip says who is offered and «متاح N». «اختر ثم ضع هنا» lights only the slots
          he fits.
        - Somebody seated so before the rule keeps the seat, ringed in dashed amber with «ليس
          قائدًا» / «ليس أخصائيًا» and the reason, until the planner takes him out; a row holding him
          is given no van. «الطاقم الثابت» leaves such a seat empty on the day and names whom it
          left off, as it does somebody away. The standing crew's editor refuses the same drops,
          and a captain moving with his crew leaves behind a companion the slot no longer fits. The
          server's `OPERATIONS_CREW_MEMBER_WRONG_SLOT` is worded in both languages and rings the
          chip on the row it names. «كشف طاقم العمليات» no longer tells the operator that anybody
          may take any slot: its hint says which slot each role takes.
      - Round 24, the owner — «عاوز لو عربيه من غير كود عادى تظهر ان اوزع عليها محصنات و مكان بدون
        سيارة دا لما ادوس عليه يجيب كل السيارات اللى مش عليها طاقم واقدر اختار منهم وعاوز ف الفلاتر ازود
        بين يوم التشغيلة وكل الانوع انه يقدر يفلتر ب كود عربيه و كمان ادخل اسم قائد او اخصائى او الكود
        بتاع اى حد فيهم وكمان افلتر ب الاتجاه», then «وعاوز تراجع دا يتراجع عن اخر عمليه مش كل العمليات
        فاهم»:
        - «تراجع» is ONE STEP BACK. It threw away every unsaved change at once; now each press takes
          back the LAST operation only — a drop, a pick, a ✕, a van given, a row added, deleted or
          emptied, a type, colour, time, direction or notes change (a run of typing in one box is
          one, and so is a time set in its panel, hour then minute), the standing crew loaded or
          taken off — however many rows it touched, and the next
          press the one before, until nothing is left; the button is off then. Its tooltip says
          what it will take back («تراجع عن: نقل … إلى …»); Ctrl+Z (⌘Z) does the same outside a
          text box. A save clears the history; another desk's save rebases every step of it as it
          rebases the draft, and drops a step the other desk made true. «توزيع المحصنات»'s
          «التراجع عن التغييرات» was the same discard-everything button: it is now «تراجع», one
          move, captain switch or «توزيع تلقائي» a press — the day's own proposals by direction are
          its first step, so the last press takes them back too, as the old button did. «الطاقم
          الثابت» had none.
        - «بدون سيارة» opens every car with no crew that day (the server's `freeVehicles`, seen
          through the draft): the Fleet roster's blank vans first with their drivers, then the
          cash-transfer operations' cars, the standing crew's and the rest, each by code;
          searchable by code or driver; a car in the workshop is listed «في الصيانة» and, off the
          roster, cannot be picked; a car another row of the draft took is not offered. A computer
          gets a list under the cell, a phone the bottom sheet. A roster van merges the row into its
          blank row as before; any other car turns the row into that car's row where it stands. A
          saved row keeps its id either way (the «row X takes van V» save), so the محصنات on it
          follow. The round-22 (away) and round-23 (wrong slot) checks still come first. A van off
          the roster is marked «إضافية» under its code (beside it, it widened the column and pushed
          the row's bin out of the frame at 1440), shows no drivers and can be deleted (which frees
          it); the server's three refusals of a van and its refusal to delete a row holding محصنات
          are worded in both languages and marked on the row — the deleted row is put back, as its
          own step, named by its place once it is back («بدون سيارة (n)», never «(0)»), and without
          anybody the planner seated elsewhere since (he stays where he was put, so the next save
          is not refused for a clash on a row it never touched). A refused van is taken off its
          row by «إزالة السيارة» in its cell — one step — since «تراجع» reaches only the last
          operation; the refusal says so instead of «تراجع عن تعيينها». A row whose محصنات have
          left the vault is told it stays (it can be emptied or given a van), not to take them off
          on «توزيع المحصنات», which moves none of those.
        - «تراجع» and Ctrl+Z take nothing back while «حفظ» is in flight, on the board and on «توزيع
          المحصنات»: the save's read-back starts the history afresh, so a press then was dropped
          unsaid and the operation it named saved anyway.
        - Three filters between «يوم التشغيلة» and «كل الأنواع», in that order: the van (the board's
          codes, and «بدون سيارة»), a person box (a captain's or a specialist's name or code,
          folded as the pools' search) and the direction (each area the board's directions name,
          and «بدون اتجاه»). AND-ed with the type; view only — hidden rows keep their changes and
          «حفظ» saves them all. The type chips count the whole day; «المعروض N من M» says what the
          filters leave, beside «مسح التصفية».
        - Rows without a van on the screens after the board: «توزيع المحصنات» and «تسليم المحصنات»
          draw them as cards after the vans, «بدون سيارة (n)» numbered as the board numbers them;
          they take drops, «نقل إلى…» and proposals, count among the vans and are handed over and
          printed under the crew's name («الطاقم بدون سيارة (n)»). «صرف الخزينة»'s assign dialog
          offers each as its own choice. The day board, the vault's screens, the deleted list and
          the hover cards print «بدون سيارة» where a van's code goes, never "null". The day board's
          «السيارة» cell and «صرف من الخزينة»'s loads number it by the server's `looseNumber`
          («بدون سيارة (n)», «الطاقم بدون سيارة (n)»), so two such crews are never one name; the
          van box offers each by that name and matches it as one phrase.
    - Round 24b, the owner — «عاوز pallett الالوان يكون على عدد الالوان يكون نفس عدد النوع وعاوز فوق
      خالص جمب الطاقم الثابت لما ادوس عليها يفتح كارد زى جدول اقدر ادى كل نوع لون من الالوان وعاوز
      اللون فى الجدول يكون متشبع اكتر من كدا»; asked how a row takes its colour, «تلقائي ويتغيّر
      يدوي»; asked whether two types may share one, «أيوه عادي»:
      - ONE PALETTE for the types and the rows: `OPERATIONS_SHIFT_TYPE_COLOURS` is twenty ordered
        names. Round 20's eleven stay first (a saved type keeps its colour by name), re-ordered so
        the first nine are the nine the boot seeds (rose, emerald, indigo, amber, violet, teal,
        orange, fuchsia, slate), then lime and sky, then nine new ones (crimson, navy, forest, gold,
        plum, brown, cyan, pink, olive). The board SHOWS N of them, N the live types: every colour
        a live type wears, then the first ones nobody wears until there are N, in the palette's
        order (`paletteFor`) — so archiving a type never pushes a live type's colour off the
        palette, nor shows the archived one's (all twenty past twenty, said in the card). The type's
        form on «أنواع التشغيل» offers the same: N swatches (N + 1 for a new type, the extra one the
        first nobody wears), and an archived type's own colour after them when outside. Each colour
        has a name of its own in both languages: cyan is «سماوي فاتح» and pink «وردي فاتح», where
        «تركوازي» and «زهري» read as teal's «فيروزي» and rose's «وردي».
      - «ألوان الأنواع» at the top of «لوحة التشغيلة», right after «الطاقم الثابت»: a card laid out
        as a table — a row per type in the board's order (its strip's), a column per swatch shown.
        A press gives that type that colour through the existing `PATCH
        /operations/shift-types/:id` under `operationsCatalog.manage` (no new grant); two types may
        share a colour. Each press saves at once; the answer is written into the cached types and
        both the types and the crew board are re-read, so the board recolours at once. Without the
        grant the table is shown read only, and says why. A live type is never off the palette; an
        archived type it lists (a row of the day holds it) whose colour is off it is marked «خارج
        اللوحة». Opened, it reads the types again; a press on the colour a type already shows reads
        them again rather than doing nothing, and says «عُدِّل هذا النوع من مكان آخر…» when another
        desk had moved it (no save is sent: it would change only the version). Until the types
        answer, the card and a row's «اللون» say they are loading, or that the read failed with
        «إعادة المحاولة» — never «لا توجد أنواع تشغيل». A phone gets Fleet's bottom sheet, the
        swatches wrapping under each type. It is a catalog save: «تراجع» never takes it back.
      - A row's colour is its own `rowColour` (picked by hand) ?? its type's ?? none. «اللون» offers
        exactly the swatches shown, each naming the types that wear it, plus «لون النوع» (null —
        back to automatic). A row's own colour that is no longer among them still colours it and is
        offered at the end, pressed. The cell shows the colour the row is drawn in, dashed when it
        is the type's. A colour picked is one «تراجع» step, said with the colour («تلوين الصف 150
        باللون كحلي»; «إعادة الصف 150 إلى لون نوعه»).
      - Saturation: a coloured row's cells take the colour itself at 30% (35% in dark; Round 20
        drew a 100-level wash, about 15%, and 14% in dark), with a 5px solid bar of the colour at
        the row's start edge. The text stays legible: 8.4:1 or better in light, 6.6:1 or better in
        dark. Marks stay visible on top: a marked chip (picked up, refused, away, wrong slot) on a
        coloured row stands on a halo of the page's colour, and the refused chip and the refused
        van ring are solid. The marks drawn straight on the cells stand on the page's colour too
        (`ON_TINT`): the short-crew ⚠, the board's only sign of a crew below its minimum, is
        amber-600 on a disc of it (3.2:1; amber-500 on a rose row was 1.4:1, on a navy one 1.3:1),
        and an empty slot's «+ اختيار» slate-600 on it (7.6:1; slate-400 was 1.5–2.1:1 on the
        tints). The spec measures the words and both marks against all twenty tints, light and
        dark.
      - The row colour's names are the palette's. `OperationsCrewRowColourSchema` takes a palette
        name, or one of Round 20's six MAPPED onto the palette colour Round 20 drew it in — its
        swatch was that colour's dot exactly (yellow→gold, bg-yellow-400, not the orange-brown
        amber; green→emerald, blue→sky, red→rose, purple→violet, orange→orange) — so a yellow row
        stays yellow and an old client never meets a 400; the parsed
        value, and every answer, is a palette name. The crew row's model accepts both spellings
        (what the collection may hold); every reader goes through `canonicalCrewRowColour`, so a
        row not yet migrated reads in the palette's name, and the same colour in either spelling
        is a no-op save. The boot migrates the stored names (`migrateCrewRowColoursToPalette` in
        `operations.migration.ts`, after the two crew migrations): five `updateMany`s, one per
        legacy name that is not a palette name, soft-deleted rows included, timestamps off;
        idempotent. Only the crew rows store a row colour (the standing crew has none); the audit
        trail is history and is not rewritten.
    - Round 24c, the owner on the round-24 screen of «توزيع المحصنات» — «عاوز اصغر المكان اللى فيه
      المحصنات واكبر المكان اللى فيه المحصنة بالعربيه», and «عاوز احسن شكل الكارد العربيه بالمحصنة يعنى
      عاوز انقل الاتجاه بعد كود السيارة والوقت واحسن الاسماء بتاعت القادة والاخصائيين»:
      - THE WIDTHS. From a computer's width the vans take three parts and «بلا سيارة» (the day's
        محصنات on no van) one — 978 and 326 px at 1440 — never narrower than 17rem, so at 1024 it
        is a little more than a quarter (`DISTRIBUTION_COLUMNS`). The vans' cards stand as many to a
        row as fit at 17.5rem or more (`VAN_GRID`): three at 1440, four at 1920, two at 1280 and 1024,
        one on a phone; it was two at most. On a phone the columns stack with «بلا سيارة» FIRST on
        «توزيع المحصنات» — the work to do, moved by «نقل إلى…» — and its head folds it away
        (`aria-expanded`); folded, the column still takes a drop on its head. «تسليم المحصنات» takes
        the same widths; there «بلا سيارة» is for information, so on a phone it stays after the vans,
        and folds too. Drag and drop, «نقل إلى…», the proposals by direction and the one-step «تراجع»
        are as they were.
      - THE VAN CARD'S HEAD IS ONE LINE: the code (or «بدون سيارة (n)»), the planned time, then the
        direction — moved up from the band it had under the head. A long direction is cut, whole on
        hover and to a screen reader. The count of محصنات («محصنتان», each count in its own Arabic
        form, as since Round 17) stays on the card, first on the line of what the van carries, before
        the money and the packages: at three cards to a row, a head that held the count as well cut
        «المعادي» itself to «…الم».
      - THE CREW, drawn anew: each captain on a green line of his own with the captain's mark («قائد»,
        the board's green); «أخصائي 1» and «أخصائي 2» side by side as two labelled chips; an empty
        slot says «غير معيَّن», quietly, in a dashed chip, never «—»; a van with no captain says «بلا قائد
        — لا تأخذ محصنات» in red where the captain would be. Every name is cut to its chip and opens
        «لوحة التشغيلة»'s person card (role, code, phone, branch, «في التشغيلة» — here the van and the
        slot — his attendance on the day, what he holds) once the day's crew directory has him. That
        list is read only when a card first opens, under `operationsCrew.view` — the grant the
        specialists on the card already ride (`crewPlanVisible`); no grant was added. Without it, or
        before the list answers, the card says the whole name, the code and where he sits.
      - The same card on «تسليم المحصنات», under «تسليم» and «طباعة»; its sheet's head now reads in
        the card's order — the day, the time, the direction, then the captains and the specialists.

  - Round 25 — «توزيع المحصنات», the owner: «عندى مشكلتين الاولى ان لو ضيفت اى عربيه بتظهر فى توزيع
    المحصنات على طول انا عاوز اللى يظهر اللى نوعها محصنة بس ولازم اكون دايس حفظ التانية لما بعمل دراج و
    دروب لل محصنة على العربيه مش بتتحط بتتحط فى حالة دوست على نقل الى بس غير كدا مفيش حاجه بتتغير»,
    then the two columns' filters, the small chip and the new van card.
    - ONLY «محصنة» ROWS, ONLY SAVED. `GET /operations/secured/distribution` lists the day's SAVED crew
      rows (the board's unsaved draft is not in the database) whose «النوع» is the seeded «محصنة»
      type — found by `seedKey` 'secured' (`findSecuredType`), so a rename keeps it; a live type of that
      name stands in on an install whose seed was never inserted. A row of another type, or with no
      type, van or none, is not offered. So nothing on the screen vanishes, a row of another type that
      already holds the LIVE delivery leg of a listed محصنة (placed before this round, or its type
      changed since) stays, marked: `crews` are now `OperationsSecuredDistributionCrewDto` —
      `securedType` (false for such a row), `shiftTypeName`, and `looseNumber` (a row without a van
      keeps the board's «بدون سيارة (n)» — its place among ALL the day's rows without a van — though
      only the «محصنة» ones are listed); the card says «ليس من نوع محصنة ·
      النوع «سفر»» on a dashed amber edge and takes no new محصنة. The proposals by direction
      (`directionCrewAssignmentIds`) name the «محصنة» rows only. The save refuses a محصنة put on a row
      that is not «محصنة» unless its delivery leg is already on that very row (its captain switched,
      or taken off, still save): 422 `OPERATIONS_DISTRIBUTION_ROW_NOT_SECURED`, checked after the day
      and before the captain, naming the shipment (`shipmentId`/`SHIPMENT`) and the row
      (`crewAssignmentId`/`NOT_SECURED`), nothing written — worded in both languages. A board save now
      stales this screen's read on the saving desk itself (`usePlanOperationsCrew`), not only through
      the crew topic. «تسليم المحصنات» reads the same list.
    - THE DROP. Measured with REAL OS drags (XTEST under Xvfb, Chromium's own drag loop, the real API
      on a seeded day): the screen still had the gates Round 22 took off «لوحة التشغيلة». Only the
      van cards and the left column answered a dragover «yes» — the grid's gaps, the column's head and
      padding answered «no» — and Chromium applies the LAST answer it had when the hand lets go, so on
      a slow PC a hand crossing a gap and releasing on a van was refused on the gap's stale «no»: the
      log ends on a «yes» dragover on the van, then `dragleave` and `dragend` with `dropEffect` none,
      no `drop` (at 6× CPU, 2–4 of 6 drops placed). And every dragover asked `dataTransfer.types` for
      the screen's private MIME type: on a PC whose hook passes only the standard formats (Round 22's
      finding on the owner's own machine) every van refused every time — 0 of 4 drops on a van placed, only
      «نقل إلى…» working, exactly as he said. Now (`lib/distribution-drag.ts`): the dragged id is kept
      in a ref by the chip's own `dragstart`, which writes the id as our type and as `text/plain`,
      `copyMove`, and sets no state; the drag is drawn one task after the first answer; the WHOLE
      screen accepts our drag and names no `dropEffect`; the drop reads what is under the pointer — the
      van card anywhere (its head, the captain's line, the packages, the empty load, a chip on it), the
      left column anywhere (its head too, folded on a phone) — and does what `resolveShipmentDrop`
      says; a van with no captain, or a row that is not «محصنة», refuses in words — the van as the
      toast's title and the whole reason under it (`dropRefusalToast`: a toast's title is cut to one
      line, and «… فلا يأخذ …» had lost the end of the reason). Proven on the same
      stack: unplaced → the head, the captain's line, a chip, the empty load; van → van; van → back to
      the left — 6 of 6 at 1× and at 6× CPU (released the moment it arrives), and 6 of 6 with the
      private type stripped; «حفظ», then a reload shows every drop where it was left.
    - THE LEFT COLUMN: a filter bar on top — «البنك أو الفرع» (the billed bank by any of its names,
      either branch, each branch's own bank; folded as the pools' search, «الاهلى» finds «الأهلي») and
      «المنطقة» (the areas of the محصنات listed, «بلا منطقة» when one has none). Each محصنة is a SMALL
      chip: the drag handle, the stage's mark (the badge's tone and glyph, its words on hover), «البنك ·
      الفرع» (the branch it goes to), its marks as small icons, and «نقل إلى…» as a small icon. Its card
      opens on hover, on a keyboard focus and on a tap on a phone: the bank and its stage, from → to
      with each branch's bank, the area, the delivery day (and «متأخرة»), each amount by currency, the
      packages the vault counted (or «لم تُعدّ بعد»), the vault's receipt number, the van and captain it
      is on, and the screen's marks in words. The read carries no seals; the receipt keeps them.
    - THE RIGHT COLUMN: a filter bar on top — «كود السيارة» («١٢» finds 112; «بدون» the crews without
      a van), «البنك أو الفرع» (a van answers through one of its محصنات) and «المنطقة» (its direction
      names it — either area of «المعادي - حلوان» — or one of its محصنات is of it; «بلا اتجاه»). AND-ed;
      «المعروض ٢ من ٨» and «مسح التصفية» once one is set. View only: a van filtered out keeps its draft
      and «حفظ» saves it.
    - THE VAN CARD: the head as before (code or «بدون سيارة (n)» · time · direction); then ONE
      captain's line — first the count of محصنات on it («محصنتان», «0 محصنات»), then the captain: on a
      van with two, only the FIRST put on the row (`captainEmployeeIds[0]`). No specialists, no
      «المصري» / «الدولار» / «عملات أخرى». Then «كراتين · حقائب · صناديق», each always, its count written
      even when 0 (in the card's figures' face — an Arabic zero reads as a dot), summed from the vault's
      counts; «—» with why to a reader who cannot view the vault. The محصنات on it are the same small
      chips with the same card. A محصنة riding the OTHER captain of a two-captain van carries a small
      captain mark («مع …»), and its «نقل إلى…» lists the van's captains first — the switch, one
      «تراجع» step as before.
    - «تسليم المحصنات» shares the card: the same van card and chips under «تسليم» and «طباعة»; the
      confirmation keeps the money and the list, and the printed sheet keeps every detail.
    - AFTER REVIEW. «حتى لو ب 0 يتكتب» — so a 0 is written only once the vault's counts are in: while
      that read is out a van says «…», after it failed «—», each with why on hover (`packagingRead`,
      `vanPackages`), on both screens; and the chip's card says the same rather than «لم تُعدّ بعد،
      فهي ليست بالخزينة» about a محصنة its own badge marks «بالخزينة». The chip's card no longer
      opens over its own «نقل إلى…» menu (the menu is a portal React counts inside the chip:
      `hoverIsOnChip`). A محصنة saved on a kept row and moved off it in the draft goes back there by
      a drag or by the menu, as the save allows; no other new one does. With no saved «محصنة» row on
      the day the screen says exactly that, and where a row becomes one — not «لا توجد سيارات مخططة».
      And the single-shipment door, `POST /operations/secured/:id/assign-delivery` (no screen mounts
      it), keeps the same rule as the save: 422 `OPERATIONS_DISTRIBUTION_ROW_NOT_SECURED`, the leg
      already on that row excepted.

  - Round 25 — «لوحة البنك بفروعه» on «تقرير البنوك», the owner: «صفحة تقرير البنوك عاوز فى الجدول عند
    البنك فى الاخر بعد الصناديق يكون فيه سهم ادوس عليه يفتح زى داش برود كدا للبنك بالفروع بتاعته».
    - THE ARROW: the table's last column, «الفروع», after «صندوق» — on every bank's row (none on
      «الإجمالي», none on a row the server could not attribute), named «فتح لوحة {البنك} بفروعه» to a
      screen reader and as its tooltip, in a 32px brand square (the board table squeezes a cell's
      button to 22px). The table's floor stays the nine columns' own, so the report still fits beside
      its panel at 1280px; on a phone the arrow is at the end of the table's own sideways scroll.
    - THE WINDOW is the vault reports' own (`ReportModalFrame`, as «تقرير الخزينة» and «لوحة تحكم» on
      «محصنات الخزينة»): over the whole screen, Escape or × closes it, the focus kept inside and
      handed back to the arrow — the dashboard the owner already knows, over the page it came from
      rather than a page of its own that would lose the report's period and name filter behind it.
      It is a link all the same: the bank is in the address (`?bank=…`, and `bankSide=destination`),
      so a copied address opens the same bank over the same period, and Back closes it.
    - FOR THE PAGE'S PERIOD, exactly: the same «من» / «إلى», judged as the report judges them (every
      محصنة the vault received in the period, delivered since or not, a cancelled receipt out).
    - WHAT IT SHOWS: the bank's seven tiles (عدد المحصنات، المصري، الدولار، عملات أخرى with its breakdown،
      الحقائب، الكراتين، الصناديق — the bank's own row of the report, figure for figure); two charts,
      one measure each — «المصري حسب الفرع» and «عدد المحصنات حسب الفرع»: horizontal bars in one hue,
      the largest first, eight branches named and the rest folded into one muted «باقي الفروع (n)»
      bar, the figure at each bar's tip and the branch's count, pound and dollar in its hover title;
      then «بيان المحصنات لكل فرع» — the reports' table with «المنطقة» after the branch, a branch of
      another bank saying whose («فرع تابع لـ…»), every head sortable (the pound, largest first, by
      default), «الإجمالي» pinned — beside «إجمالي قيمة الشحنات». A bank with nothing in the period
      keeps every section, at zero. «Excel | PDF» carry the branch table (with «المنطقة») and the
      panel, the period, the bank and the side under the title.
    - WHICH BRANCH: a shipment names two, so the window asks — «تُنسب كل محصنة إلى: من فرع | إلى فرع».
      «من فرع» by default: the report counts what the vault RECEIVED, and that came from the branch it
      was collected from. «إلى فرع» files the same محصنات under where they are delivered; the totals
      do not move. The billed bank's own branch is the destination unless a second bank was named,
      while the origin may be any bank's branch — so a row of another bank's branch says whose.
    - API: `GET /operations/reports/banks/:bankId/branches?from=&to=&side=origin|destination` —
      the bank report's readers (`OPERATIONS_BANK_REPORT_KEYS`, no grant added) and its period;
      `OperationsBankBranchReportDto` (`rows` per branch — id, name, code, area, `otherBankName` —
      and `total`, which IS the bank's row of `GET /operations/reports/banks`). A malformed id, a bad
      day, an unknown `side` or key → 400; an id that names no bank → 404; a bank with nothing in the
      period → 200, no rows, a zero total. The database narrows it — the period's receipts by their
      indexed instant, then only this bank's live shipments by id, with only the branch ids and the
      money projected — and the roll-up is the bank report's own (`branchReportRows` over the same
      `groupBy`, one receipt builder for both), so the branches add up to the bank's row by
      construction: the packages are the treasury's, behind the custody port, which a `$lookup`
      would read behind its back.

  - Round 26 — «توزيع المحصنات» (and «تسليم المحصنات», which shares its van card), the owner on the
    Round 25 screen: «عاوز الفلاتر دول يكونوا جمبب السيارات و بلا سيارات — لما اقف على العربية يطلع كارت
    بقى بالقادة والاخصائيين اللى على العربيه والسواقيين — عاوزك تضيف الوان عشان حاسس ان مش اقدر اميز اوى
    العربيه والمحصنات اللى عليها والاعداد وكدا».
    - THE FILTERS BESIDE THE TITLES: each column's boxes are on its title's line — «السيارات (n)» then
      «كود السيارة», «البنك أو الفرع», «كل المناطق»; «بلا سيارة (n)» then its two boxes — one head, no
      filter row. The left column's quarter keeps them compact: «بحث» and «المناطق» in the boxes (each
      keeps its whole name, «البنك أو الفرع» / «المنطقة», for a screen reader and on hover), 12px, and
      a head narrower than its title and two boxes drops the column's drawing (a container query) —
      so the title and both boxes share one line at 1440, 1366, 1280 and 1024 (measured: 85 + 117 px at
      1440, 65 + 97 at 1280). On a phone the fold stays: the boxes take a line of their own under the
      toggle, and go with the body when it folds. A filter in use says «المعروض 2 من 8 · مسح التصفية» at
      the end of the vans' line and under the left's boxes (wrapping there, never past the column's
      edge). The head is still inside the left column's
      drop mark: a drop on it, or on its boxes, takes a محصنة off its van.
    - THE VAN'S CARD: resting on a van — its head (code · time · direction) or its captain's line —
      opens a card after the usual beat (`HoverCardLayer`, kind `secured-van`): the van (its code in its
      colour, or «بدون سيارة (n)»), the time and the whole direction; «القادة» — every captain, in the
      order put on the row, the first marked «المعروض على البطاقة»; «أخصائي 1» and «أخصائي 2» — everyone in
      each; «السائقون» — by name, Fleet's duty row; each slot «لا يوجد» when empty, «يظهر لمن يملك صلاحية
      عرض لوحة التشغيلة» when the read withheld it (a reader without `operationsCrew.view`), «بدون سيارة —
      لا سائقين» on a crew with no van; then what it carries — the محصنات badge and the three packages,
      in their colours. Every fact was already in the read (`crews`: captains, specialist1,
      specialist2, drivers, direction, plannedTime): no server change, no grant. A keyboard focus opens
      it at once, a tap on a phone too; it is never cut at the screen's edge (288px, kept 8px inside at
      390). Not on a chip (a chip keeps its own card) and not on the captain's own name, which keeps
      his person card (as a name does on every board); never while a drag is on (a `dragstart` /
      `dragend` watch on the window, and Chromium sends no mouse events during one), never over an
      open «نقل إلى…» menu (Round 25's F2 rule): the shared hook takes a `when` it asks as the pointer
      comes and again when the beat ends. The card is a layer that takes no pointer, and the head is
      inside the van's drop mark: a drop anywhere on the card still lands.
    - THE COLOURS (the per-van accent below was taken back in Round 26b — every van now wears ONE look;
      the counts keep colours of their own, re-chosen there): each van wore an ACCENT — one of «لوحة
      التشغيلة»'s twenty palette colours, no new
      palette — by its place among the day's «محصنة» rows (the same list on both screens, so a van is the
      same colour on «تسليم المحصنات»; a filter hides cards, it never repaints them), through an order
      of the palette in which neighbours (next to each other, or one above the other at two, three or
      FOUR a row — «السيارات» lays four a row at 1920, the owner's own screen) never share a hue family,
      never look alike (CIEDE2000 17 or more between their stripes, 20 or more over a day's first
      twelve) and alternate dark and light; amber, rose and emerald — a proposal, a refusal, the
      captain — come last, and their near twins brown, crimson and slate after the eighth
      (`lib/van-accent.ts`). The accent is a stripe at the card's start
      edge (the palette's own dot), its head on a thin band of it, and its code in a solid pill of it
      with white or near-black words, whichever reads; every chip ON that van wears the same stripe and
      a thin ground of it, and the chip's card — and «نقل إلى…», each van in its list — names the van
      beside its swatch. A chip on no van stays
      plain; a proposal (and an unsaved move) keeps its own ground and edge — dashed amber «مقترحة» —
      and wears the van's colour as its stripe only. THE COUNTS each have their colour and icon, the
      same on the van card, the van's card, a chip's card and the page's figures: محصنات indigo (the
      badge before the captain; the page's «محصنات اليوم» and «بلا سيارة»), كراتين amber, حقائب teal,
      صناديق fuchsia — each on a light ground of its own, ringed in its colour, its icon and figure in
      it, never solid as a van's code is; a 0 is written in grey, its icon dimmer. The page's bar
      gains the day's three package totals (the vault's counts; «…» while read, «—» if it failed, none
      to a reader who cannot read the vault) and writes its figures in the figures' face, «0» never a
      dot. THE HEAD: the time in sky, the direction in violet, each on a ground of its own; the
      captain's line stays green on any van, its «قائد» now emerald-700 (5.5:1; emerald-600 was 3.8:1).
      Every pair of words and ground is measured against Tailwind's own colours in both themes
      (`distribution-colours.spec.ts`): 4.5:1 or better for every word, 3:1 for every count's icon. The
      printed sheet stays black on white.
    - THE INDEPENDENT CHECK (real OS drags under Xvfb on the real API, at 1×, at 6× CPU and at 6× with
      only the standard formats carried: 23 of 23 each — every part of the new card, van to van, van to
      the left's title, count, search box, area list and body, «حفظ» and a reload matching the server;
      a card open in none of the 63 drags): the first
      order kept three-a-row neighbours apart but put crimson over brown (ΔE00 13) and violet over navy
      four apart — one above the other at 1920; the order from the seventh colour on is now fuchsia,
      lime, navy, teal, brown, pink, olive, cyan, violet, amber, rose, emerald, slate, plum (the first
      six, and so every day of up to six vans, unchanged). «مسح التصفية» ran 16px past the left column's
      edge at 1024 with a filter in use; it wraps under «المعروض …» now.
    - THE CRITIC'S PASS — nine findings, each fixed with a test seen failing first:
      - «عاوزك تضيف الوان … اميز اوى العربيه»: a colour must STAY on its van. It was the van's place in
        the whole list, and a row of another type is listed only while it carries (Round 25) — a
        «حفظ» that took 106 «سفر»'s last محصنة, a hand-over, or the vault's poll dropped it and every
        van after it changed colour. The «محصنة» rows (listed all day) now take the places among
        themselves, a kept row a colour after them, never gold, amber or brown (its own dashed amber
        edge and notice say «kept»). Only a change to the board's own «محصنة» rows moves the colours
        after it — as it moves the cards: a colour keyed on the van alone would stay, but could put
        two alike side by side, which is what the colours are for.
      - «والاعداد»: a count was drawn like a van — the محصنات badge was solid indigo-600, the very pill
        of the first van's code right above it, every day. A count is now a light ground of its own,
        ringed in its colour, its icon and figure in it (0 muted); the order starts navy, orange,
        olive, sky, fuchsia, teal, indigo, gold, brown, pink, forest, cyan, violet, lime, crimson,
        emerald, slate, amber, plum, rose — no count's colour first, brown (amber-800) and crimson
        (red-700, beside a refusal's rose) after the eighth — no order the specs allow keeps them
        later (an exhaustive search). A proposal on a van keeps its own amber ground (on an orange
        van only its dashed edge was left).
      - «السيارات» lays at most FOUR a row: auto-fill put six at 2560, the card above six places back,
        which the order does not keep apart; four wider cards now.
      - «عاوز الفلاتر دول يكونوا جمبب السيارات و بلا سيارات»: the left's boxes went back under the title
        with a three-figure count («بلا سيارة 113») or the English words, at 1024–1440. Its bar now
        takes what the line leaves and never wraps, its two boxes shrinking together on one row
        (measured, Arabic and English, 3 and 113, 1024–1920: one line everywhere; 52 + 82 px at 1024
        with 113 in Arabic, 37 + 58 in English); «المعروض … · مسح التصفية» under them may break each
        part onto a line of its own and never runs past the column's edge. The column's drawing gives
        way only to that narrow bar: «تسليم المحصنات»'s left column, which has none, keeps it.
      - On a phone, a tap on the captain's name opened the VAN's card; it now opens his own, as resting
        on it does (one tap rule for the chip, the van and the name).
      - One numeral system: the page's bar wrote «السيارات 8» and the column's head «السيارات ٨». Every
        count on both screens — the heads, «المعروض 3 من 12», «حفظ (2)», «تسليم (1)», the dialogs and
        notices — is in the figures' face now, as the van card's counts and the money are; only a
        crew's NAME, «بدون سيارة (١)», keeps the board's own words.
  - Round 26b — the owner on Round 26's screens: «لا استنى الالوان مش عجبانى بتاعت العربيه», and, asked
    how he wants it, «لون واحد لكل العربيات»; then «عاوز يبقى فى فرق فى الالوان بين الصندوق و الحقائب و
    الكراتين», «وعاوز اضيف اسم القائد فى الفلاتر بعد العربيه», «عاوز اخلى التاريخ يكون مكان الاحصائيات
    والاحصائيات تكون فى النص» and «وافصل الاليطار بتاع القائد عن المحصنة وحسن شكل العربيه بالكامل».
    - ONE LOOK FOR EVERY VAN: the colour per van is gone — its order, its stripes, bands and code
      pills, every chip painted in its van's colour, the swatches on the chip's card, the van's card
      and in «نقل إلى…» (`lib/van-accent.ts` is gone; what it held besides the colours — the counts'
      kinds and the van's hover card — is `lib/van-card.ts`). Every van card wears the same calm look,
      slate, the boards' blue-grey ink: its code in a solid slate pill (white words, 10:1, the same
      pill in both themes), a thin slate stripe at its start edge, its head on a very light slate band.
      Slate is the one family here with almost no colour of its own (CIEDE2000 chroma 14): the van
      reads as the card's title, and every colour that MEANS something stays free and far from it —
      21 or more from each count. A chip on a van is the left's plain chip in the van's bounded load;
      a proposal keeps its dashed amber, an unsaved move its own edge, a kept row of another type its
      dashed amber edge and notice. The time and the direction are calm neutral pills now (Round
      26's sky and violet would sit beside a cyan and a fuchsia count).
    - THE VAN CARD, REDRAWN, top to bottom: THE HEAD (code · time · direction, one line, on its
      band); THE CAPTAIN'S ROW — Round 25's order kept («الصف نفسه بتاع القائد يكون قبله عدد
      المحصنات»): the count of محصنات FIRST, in a tile of its own (its figure over its word, the
      محصنات' own Arabic form, «محصنتان», whole to a screen reader and on hover), then the captain in
      a frame of his own — «قائد» over his name, cut to the frame, his person card on it; «بلا قائد»
      in the refusal's rose — no count inside it; THE PACKAGES under it, كراتين, حقائب, صناديق, in the
      same three columns (the count as wide as a package's tile, the captain's frame as two); THE
      LOAD, a bounded place of its own — empty, «اسحب المحصنات إلى هنا» with its arrow, or, on a van
      that takes nothing, why, in rose. Still ONE drop target (`data-drop-van`), its hover card on the
      head and the captain's row (not on the packages, not on his name). The same card on «تسليم
      المحصنات».
    - THE COUNTS, APART: each a FILLED tile (a real ground of its hue, not a ring on white), its own
      icon, the same on the van card, the van's card, a chip's card and the page's figures — محصنات
      blue, كراتين orange, حقائب cyan, صناديق fuchsia. Measured (`distribution-colours.spec.ts`): their
      marks 22.8 or more apart (CIEDE2000) by day and 25.8 by night, their grounds 12.7 and 13.1, and
      21.4 or more from the van's slate, the captain's emerald, a proposal's amber and a refusal's
      rose (the night shades chosen for it: an orange-500 mark is 26 from a proposal's amber-400);
      every figure and word 4.5:1, every icon 3:1. A 0 keeps its hue, muted — a lighter ground, a
      quieter figure, still 4.5:1 (it is 15px text) — never one grey for all three.
    - «اسم القائد» in the vans' head, right after «كود السيارة»: a van answers when ANY of its captains
      does — the first, whom the card shows, or the second — by his name or his employee code, folded
      as every box here («مصطفي» finds «مصطفى», «br108» «BR-108»); AND-ed with the rest, in «المعروض …
      من …», cleared by «مسح التصفية». The head's four boxes share the title's line at 1440 and 1280,
      Arabic and English (measured), and wrap below that.
    - THE TOP ROW: the day («يوم التسليم») at the start, the figures in the middle, «حفظ / تراجع /
      توزيع تلقائي» at the end — on ONE line only where the figures stand exactly in its middle with
      every act's words: the row measures its three parts and puts two sides of equal width around
      the figures; where that does not fit, the day and the acts keep the first line and the figures
      take a centred line of their own; at 390 the day, the figures, the acts stack, nothing
      sideways. The hint and «n مقترحة لم تُحفظ» are a slim line under it — no band. «تسليم
      المحصنات» the same, its acts on each van (with none, the figures sit beside the day where they
      fit there but not in the middle).
    - Specs: Round 26's colour specs went with the colours (the order's neighbours, every palette
      colour's pill, a chip on each van's ground, the stable and kept-row colour rules — 13 in
      `van-accent.spec.ts` and the accent and neighbour tests in `distribution-colours.spec.ts`); in
      their place, the one look (the same classes on every van, both screens), the counts' distances
      and contrasts, the captain's frame apart from the counts, the top row's order, the captain's box.
    - R26b verify (computed styles in a real browser, the real API): (1) a 0's figure was 3:1 — «0
      كراتين» read at 3.4:1 and «0 حقائب» at 3.5:1 by day, below AA for 15px text: the four zeros'
      figures are the 700 shades by day now (4.9–6.2:1), still quieter than a count's (8:1), and the
      spec asks 4.5:1. (2) A state's edge was lost by day: `cn` does not merge and the built CSS
      writes `border-slate-200` / `bg-white` after the amber, brand and rose utilities, so the plain
      colours beside a state's won — a proposal's dashed edge was grey, not amber; a move's brand and a
      refusal's rose edge on a chip, a drag's dashed «takes it», «here» and «no» edge and ground on a
      van and on its load, were the plain card's (by night too, the van's edge since 26b's slate).
      Each now wears ONE edge and ONE ground at a time (spec: one of each per state).
    - R26b critic: (1) the top row went to one line at a fixed 68rem with sides at least their own
      content — from there to the width the parts really need (1162px in Arabic) the figures stood up
      to 29px off the middle or split inside the row, and to hold them «تراجع» (and in English «توزيع
      تلقائي», a bare arrow) lost its words from 1208 up to 1495: the row now measures itself
      (`lib/top-row.ts`) — one line only where the figures are exactly in the middle with every word,
      else their own centred line; measured 0px off at every width from 390 to 1920, Arabic and
      English, both screens, with three-figure counts too, no act ever cut. (2) The redraw had put
      the count of محصنات AFTER the captain, against Round 25's «الصف نفسه بتاع القائد يكون قبله عدد
      المحصنات»: it opens his row again, each in its own frame. (3) «تسليم»'s confirmation wrote the
      packages in one grey pill, the bags first and a 0 kind left out: the van's own coloured
      counts now, كراتين، حقائب، صناديق, each always. (4) A package's word follows its count, as the
      محصنات' does — «1 كرتونة», «2 حقيبتان», «11 صندوقًا», not «1 صناديق» beside «1 محصنة»; «Secured»
      capitalised beside «Cartons». (5) A 4-figure count («1,251») ran past its tile: a step smaller,
      its icon wrapping over it. (6) The captain's box folds spaces too — «عبدالرحمن» finds «عبد الرحمن»,
      «br 108» «BR-108» — and a van found by the captain its card does not show says so under the
      captain's row («يطابق البحث: كريم سمير علي — قائد آخر على السيارة») while the box holds it.
      (7) By night the van's code pill was a dark slab on a dark band (1.5:1): its edge is a
      slate-400 line now, 3.5:1 on the band. The vault's top row with no acts puts its figures beside
      the day where they fit (1024) rather than alone on a second line.
  - Round 27 — «الطاقم الثابت», the owner: «عاوزك تخلى شاشة الطاقم الثابت نفس شكل لوحة التشغيل بقى
    فاهم». The screen is «لوحة التشغيلة»'s twin, minus the day (web only; no server change):
    - THE SAME LOOK, from the same pieces: the board's frame, its toolbar (the role legend and the
      hint, or the chip picked up; then «لوحة التشغيلة», «إضافة سيارة», Excel, «تراجع», «حفظ (n)»), its
      bar, its table (السيارة | قائد الطاقم | أخصائي 1 | أخصائي 2 | الاتجاه | التوقيت | إزالة), its
      slots and chips, and the two pools at the end with the captain-specialists last — dark and
      light, at 390 the pools before the table and nothing sideways. What the two pages share is one
      source now: `CrewPlanFrame` (the table's and the bar's looks, the count chip, the grid, the
      toolbar's start, «المعروض N من M», «إخراج …» and the drop's `targetAt`, which the board imports
      too — its look unchanged, pixel for pixel) and `CrewPlanSlot` (the board's slot, drawn as a
      component). The old screen's cards, dashed boxes and per-box drop (`CrewPools`,
      `CrewMemberCard`) are no longer on it.
    - THE SAME HANDS: Round 22's drop (who is dragged kept from the chip's own dragstart, the whole
      frame accepting, the drop deciding — a slot, anywhere on a vehicle's row, back on a pool;
      a full slot said); «+ اختيار قائد» / «+ اختيار أخصائي» and the «+» beside a half-full slot's ✕
      open the slot's list; a chip pressed, then «ضع هنا»; the person's card on every chip; Round
      23's refusal in the board's words; «تراجع» one operation a press, its tooltip saying which,
      Ctrl+Z (⌘Z) outside a box; the vehicle, person and direction filters; the board's bin takes a
      vehicle out as a step of the draft (no confirm, no instant delete). «إضافة سيارة» opens the
      board's list of cars (Round 24's `CrewVehiclePicker`) on the vehicles that may still join —
      searchable by code, a vehicle taken out here offered again — where a bare <select> was. The
      bar counts the vehicles and their crews («السيارات»، «طاقم مكتمل»، «طاقم ناقص»، «بدون طاقم»),
      each a filter; a vehicle added and not saved is tagged «جديدة» under its code.
    - WHAT STAYS ITS OWN: no day — where the board has «يوم التشغيلة» the bar says «بلا يوم — تُحمِّله
      لوحة كل يوم» —, no notes, no type, no row colour. No day's marks either: the roster answers
      absent / on leave (and which van holds whom) for ONE day, the server's today when asked
      without one, and the standing save has no attendance gate — so the screen reads the roster
      without them, nobody is faded or refused for it, and the person's card drops its attendance
      line, the van's card its drivers (both the day's). The day's board still leaves an away man
      off when it loads this list. A captain put in another vehicle's «قائد الطاقم» still brings the
      specialists riding with him, where they fit and there is room («يسحب الأخصائيين اللى معاه» —
      one «تراجع» takes the whole move back). «حفظ (n)» takes the vehicles out first (one DELETE
      each), then sends the changed rows in ONE PUT whose body is `toStandingPayloadRows`' as before.
    - Proof: real OS drags (XTEST, headed Chromium, the real API on mongodb-memory-server) — pool →
      captain slot, pool → specialist slot, a chip to another vehicle's slot, a captain moving with
      his crew, a captain refused on a specialist's slot; «حفظ» then a reload equal to the server —
      6/6 at 1× and 6/6 at 6× CPU; a vehicle taken out, one of its captains seated elsewhere and a
      vehicle added saved in one press (the DELETE first). Specs: `standing-crew.spec.ts` (the rows,
      the save's body, the add list, the day's facts dropped, the counters, the drop, the filters,
      «تراجع», a rebase, the captain's crew) and `standing-crew-page.spec.tsx` (the shared pieces, the
      hands, what stays its own, every new word in both languages).
    - Verification fix: a vehicle another desk had already taken out answered «حفظ»'s DELETE with
      404, and the save stopped there on every press — the rest of the draft (a captain seated on
      another vehicle) could not be saved without a reload that threw it away. A 404 is the end
      state asked for, so it now counts as done (`sendStandingSave`), the list is read again, and
      the PUT goes out; any other refused DELETE still stops the save, in ONE toast naming the
      vehicle and the server's reason (the remove hook no longer also fires the global notifier).
      Proved on the real stack with two desks, the socket on and off.
    - Review fixes (each with a spec that fails before and passes after; 25/25 on the real stack, the
      real OS drags 9/9 at 1× and 6× again):
      - A vehicle another desk took out is no longer brought back. The board's rebase keeps a row
        the planner touched after its server row is gone, and the standing PUT upserts by vehicle,
        so the next «حفظ» put that vehicle and its crew back in the fleet without a word. The page
        now rebases through `rebaseStandingDraft`, which drops such a row (in every step of «تراجع»
        too), and says so: «أُخرجت 249 من الطاقم الثابت», with why, and that «إضافة سيارة» brings
        it back.
      - A save that stopped part-way says what went through: the DELETEs commit first, so a PUT
        refused behind them now adds «وقد حُفظ قبل ذلك إخراج 253 من الطاقم الثابت، ولم تُحفظ بقية
        التغييرات» (`removedBeforeStop`; also beside a refused DELETE that followed others).
      - One toast a refusal: the PUT hook keeps the global notifier quiet too, as the board's does.
        The clash sentence («قد يكون أحد الأفراد له مكان ثابت على مركبة أخرى») is used only for the
        real clash (`isCrewClash`, 409); a 500, offline, a 404 or a 400 speak in their own words.
      - A WRONG_SLOT 422 rings the person on the row the server names (`planRefusal` over
        `standingPutRows`, the PUT's own order), the row marked and brought into view, as on the
        board; moving or freeing him, undoing or taking the row out, or saving again clears it.
      - A captain whose crew moves with him (a drop, a pick in a slot's list, «ضع هنا») is said, by
        name: «انتقل القائد ومعه طاقمه — انتقل … إلى 251 · قائد الطاقم ومعه: …».
      - The slots and the direction box fill their columns (the board's width is their floor): 7
        columns share the table where the board has 9, and each slot column had ~55px dead space.
      - A reader without the plan permission gets no «إزالة» column (it had a header over empty
        cells).
      - `mergeStandingRows`, `newStandingRow`, `toStandingRows`, `CrewPools` and `CrewMemberCard`
        are no longer used by any page; their specs stay until the owner agrees to retire them, and
        the no-resurrection promise is now tested on the page's own rebase path.
  - Round 27 — the owner's colours. He sent a design of the van card (dark) and said: «بص، انا عاوز
    يكون الديزاين الكارد بتاع العربية يكون زي ده كده، بس هتجيب المحصنة قبل القائد، يعني تكون مكان
    المحصنة قبل القائد، والكارت بتاع القائد خليه زي ما انت ما كنت عامله كده، نفس الشكل القديم، والوان
    الكراتين والحقائب والصناديق زي الديزاين الجديد ده، وشكل المحصنات اللي في الجنب على اليمين اللي هي
    المحصنة قبل ما تتعين تكون نفس اللي انا بعتهولك ده بس بالشكل القديم. يعني انا عايز ناخد الالوان
    نطبقها على الديزاين الموجود، ما نعملش شبه الديزاين ده. فهمت؟» (web only; no new words, no server
    change):
    - WHAT STAYS: Round 26b's card, shape for shape — the head (code · time · direction), the count of
      محصنات BEFORE the captain, the captain's own emerald frame with «قائد» and his name (unchanged,
      class for class; only its «بلا قائد» state is a firmer rose, the design's «بلا قائد» box), the
      packages under them, the bounded load, the small chips, the columns where they were. None of the design's own pieces were copied (its captain card, «تعيين قائد», status
      pills, footer, waiting-time pills).
    - THE COLOURS, all in `distribution-look.ts`: the card the design's deep navy by night (white by
      day), a subtle edge, a soft shadow; the van's code in a blue-outlined pill on a soft blue tint,
      its number white by night (navy by day), its truck in sky, a soft blue glow; the time a neutral
      outlined pill; the direction a sky-outlined one with its arrow in sky; the stripe the van's blue.
    - THE COUNTS, OUTLINED as he drew them — a 1px edge of the kind's colour on a thin tint of it, the
      icon, figure and word in it: محصنات cyan (the design's teal-cyan, kept on the cyan side: teal
      would sit 10 from the captain's emerald frame beside it, CIEDE2000; cyan stands 25 or more away),
      كراتين amber, حقائب blue, صناديق purple; the محصنات' tile glows softly by night. A 0 keeps its
      colour and edge, plainly quieter (a thinner ground, quieter words and figure, and by night a
      fainter edge than a count's firm one). The same on the van card, the
      van's card, a chip's card, the page's figures, «تسليم»'s confirmation and «تسليم المحصنات».
    - THE STATES on the card's edge: a van «بلا قائد» wears a rose edge and a soft rose glow, its
      stripe rose, its «بلا قائد» frame and its refusal rose-tinted; a kept row of another type keeps
      its dashed edge, now amber with an amber glow, its stripe and notice amber. Each still says
      itself in words. A drag's «takes it / here / no» edges are Round 25's.
    - THE CHIPS: on a van, the design's quiet dark row with a small cyan dot at its start (a محصنة, the
      محصنات' colour); a proposal keeps its dashed amber (the design's «in progress» row), with an amber
      dot; on NO van («بلا سيارة», the design's «رحلات بلا سيارة»), the same chip on a rose tint with a
      dashed rose edge, a rose dot and rose-tinted words — on both screens; the column's head a rose
      warning icon and a rose count while it holds any (at 1280–1440, where the icon gives way to
      the narrow filter bar as before, the warning moves into the count; the vault's head, with no
      filters, always shows the icon), and the page's «بلا سيارة» figure in the same rose. The dot is
      drawn only (`aria-hidden`); every mark, drop region and drag is unchanged.
    - BY DAY (the design is dark only): every role keeps its hue — a light tint of it, an edge of it,
      dark words.
    - Measured (`distribution-colours.spec.ts`, rewritten for these colours): every word 4.5:1 or
      better on its own ground, both themes (the counts' words 8.1–13.4, figures 8.7–13.5, a 0's
      figure 4.7–8.2 and 2.6 or more under its count's); every icon 3:1 (3.4–10.9); every coloured
      edge 3:1 against what it stands on — the tiles' (3.0–7.4), the code pill's and the direction's on the band, «بلا قائد» and the kept
      row's on their column, a waiting chip's dashed rose; the counts' icons 20 or more apart, their
      edges 15, their grounds 10 by day and 7 by night (Round 26b asked 10 of a FILLED ground; the
      design's own tinted grounds are 8.4 apart at their closest — the edge and the icon carry the hue
      now); every count 20 or more from the captain's «قائد» and a refusal's rose. كراتين share a
      proposal's amber and حقائب the van's blue, as the design paints them — told apart by shape (a
      tile is never dashed; a proposal always is). Look assertions changed with the look: the van is
      blue (not slate), its stripe a state's colour on a card that wears one, a kept row's edge
      amber-600, a plain chip `CHIP_LOOK.van`, the page's figures cyan/amber/blue/purple; new: a chip on
      no van, the column's rose head, the states' edges and glows.
    - Proof: real OS drags (XTEST under Xvfb, headed Chromium, the real API) at 1× and at 6× CPU — 26
      of 26 each: Round 26b's 24, plus a drop on a chip's cyan dot on a van and on a waiting chip's rose
      dot in the left column; «حفظ» and a reload match the server; no card open during a drag.
    - The critic's round, each with a spec that failed before: a محصنة placed on a crew the read no
      longer lists sits in the left column, and now wears the waiting row there too (the desk drew it
      as a row on a van; «تسليم المحصنات» already did it right); a kept row with NO captain keeps its
      dashed shape in the «بلا قائد» rose (it had lost the dashed edge); a 0 plainly quieter (its
      figure 2.5:1 or more under a count's, its words under a count's — by night they were louder —
      its ground at most 0.6 as far from the card, and by night its edge 1:1 or more under the
      count's firmer /80); the warning in the count where the column's icon gives way; the page's
      «بلا سيارة» figure rose like the column's head while any wait (cyan when none); the counts'
      grounds measured on every ground they stand on (a `slice(0, 2)` had dropped two) and the three
      packages on «تسليم»'s confirmation too, where bags and boxes stood 6.5 apart (now 7.6: bags
      /[0.22], boxes /[0.24] by night); `CAPTAIN_FRAME.none` pinned; stale comments fixed.
  - Round 27d — calmer colours. The owner, on Round 27's screens: «اعملى نسخة واحدة بس من الشاشة بس
    تكون بالوان اهدى متبعتش كل دا». The same hues in the same roles (محصنات cyan, كراتين amber, حقائب
    blue, صناديق purple, «بلا قائد» rose, a kept row dashed amber, a waiting chip dashed rose with its
    rose dot, the captain's emerald frame, the van's blue code), only calmer — colours only, in
    `distribution-look.ts`; no shape, mark, drag or data change (web only; no new words):
    - No glow or halo on the board: the code pill's blue glow, the محصنات' cyan glow, «بلا قائد»'s rose
      glow and 3px halo, the kept row's amber glow and halo, the waiting column's rose glow — gone; a
      card keeps only its neutral soft shadow. The app's shared brand buttons on these screens
      («حفظ», «تسليم» and the confirmation's) keep the app's own brand shadow, as everywhere else.
    - The counts: the faintest tint of their hue (x-50 by day, x-400/[0.08] by night) under a faint
      edge of it (x-300 by day, x-400/35 by night); the icon and the figure in deep tones of the hue,
      the word neutral slate. A 0 is neutral grey throughout — only its icon keeps a faint hue,
      plainly fainter than its count's — so a count stands out and a 0 sits back.
    - The head: the code on a soft blue tint, its number slate (near-white by night), a faint blue
      edge; the time and the direction one neutral pill, the direction's arrow blue. The stripes
      lighter.
    - The states: «بلا قائد» and a kept row a quiet 1px edge (rose-500 / dashed amber-600 by day,
      rose-400/60 / amber-400/50 by night — still 3:1 on their column); the «بلا قائد» frame, the
      refusal, the kept notice fainter.
    - The chips: on a van a neutral row with its small cyan dot; on no van a faint rose ground, a light
      dashed rose edge, a rose dot, neutral words; a proposal a lighter dashed amber. The «بلا سيارة»
      head: a rose icon, a neutral count (its warning glyph rose where the icon gives way). The page's
      figures: neutral pills, only their small squares tinted, all at /10.
    - Measured (`distribution-colours.spec.ts`): every word still 4.5:1 or better and every icon and
      dot 3:1, both themes; the two states' edges 3:1 on their column; no coloured glow in the
      board's own colours — the look's tokens and every class the two screens write themselves (a
      new check; the shared brand buttons are outside it); a 0's icon 1:1 or more under its count's
      (a new check). Thresholds LOWERED on purpose — not colours retuned — each documented where it
      is measured, each one a fainter tint or edge cannot keep: the edges that only draw a shape (a
      tile's, a 0's, the code pill's, the head pills', a waiting chip's) are no longer held to 3:1 —
      they are held to «quiet» (2.75:1 or less) and «still drawn» (a CIEDE2000 floor), WCAG 1.4.11
      asking nothing of a container's outline; the tiles' edges 10 apart by night (was 15) and their
      grounds 5 by day / 2.5 by night (was 10 / 7) — the icons still 20 apart; the محصنات' ground 4
      from the captain's frame by day (was 5); by night a 0's edge 0.5 under its count's (was 1);
      the three packages' 0s told apart by their icons (20 or more apart) now that their figures are
      grey. A 0's figure stays 2.5:1 under its count's, as before: by day the cyan and amber figures
      are x-900 (the four figures 8:1 to 9:1 alike), the bags' icon blue-900 and the boxes'
      purple-600 (the boxes' 0 had worn its count's own purple-500, as loud as the count). Literal
      values retuned in `distribution-round26.spec.tsx` and `secured-distribution.spec.tsx`: a
      waiting chip's edge rose-300 (was rose-500), a proposal's amber-400 on amber-50/70 (was
      amber-500 on amber-50), the page's figure squares /10 (was /15).
  - Round 28 — «الاتجاه» يُكتب باليد. The owner, on «لوحة التشغيلة» with a row «بدون سيارة» and the
    direction's list saying «لا يوجد اتجاه بهذا الاسم»: «عاوز الاتجاه اقدر اكتبه بايدى لو مش موجود فى
    الليست فاهم ؟». This REVERSES the earlier rule «اقدر اكتب بس فى الاخر لازم اختار من الاتجاهات اللى
    موجوده بتاعت البنوك» (Round 20): a direction no area answers is taken, on the daily board and on
    «الطاقم الثابت».
    - The save (`POST /operations/crew-board`, `PUT /operations/standing-crew`): a new or changed
      direction that names active areas is still stored in the areas' own spelling («المعادى» →
      «المعادي», «المعادى و حلوان» → «المعادي - حلوان»); anything else is stored as typed — trimmed,
      each run of spaces one space (`normalizeOperationsDirection`), never blank, and that
      hand-typed text at most `OPERATIONS_DIRECTION_MAX_LENGTH` (80) characters, else 400 on the
      row's `direction`. A direction of areas is not held to it (ten areas typed in 78 characters
      are 120 stored), nor one a row already holds, which stays exactly as written while it is sent
      unchanged. `OPERATIONS_DIRECTION_NOT_AN_AREA` is no longer sent (the code stays in the
      contracts, marked deprecated). The standing crew's save now reads the areas too, so the two
      saves store a direction alike (`crew/crew-direction.ts`).
    - The box (both screens): while typing a name that is not exactly an area, the list offers
      «استخدام «…» اتجاهًا» («Use “…” as the direction») — first, and alone, when no area holds the
      text, in place of the dead end; last when some areas do, so Enter still takes the highlighted
      area. Enter takes the highlighted row. Leaving the box (Tab, a click outside): an area's exact
      name → that area, in its spelling, as before; text no area holds → taken as typed; part of an
      area's name → nothing taken (the desk was searching). The rule is `lib/direction-pick.ts`.
    - A saved hand-typed direction is shown plainly — no amber «not on the list» look; its title says
      it is typed by hand, not an area, and that «توزيع المحصنات» proposes by direction only for an
      area it names. The board's direction filter and the distribution's area box list it by its
      own words.
    - Tests rewritten to the new rule: (api) «refuses a new direction that is not an active area» →
      «Round 28 — takes a new direction no active area answers, stored as typed and tidied», «keeps a
      direction saved before the rule while it is sent unchanged, and refuses changing it to another»
      → «… and takes changing it to another»; (web) «places a direction that is not an area on its
      row» → «places no row for a direction», «legacy free text is kept and marked» → «a hand-typed
      direction is shown plainly»; (contracts) «is never empty once tidied, and at most
      OPERATIONS_DIRECTION_MAX_LENGTH characters» → «… and leaves the length to the save» (the
      ceiling held by the shape refused a direction of areas the save respells past 80, and a row's
      own long one sent back unchanged). New: the blank and too-long refusals, the hand-typed-only
      ceiling, the standing crew's save, the list and the leaving rule, the filters with a
      hand-typed direction.
    - Round 28 critic, fixed with tests that fail before and pass after:
      - The save keeps a row's OWN direction sent back unchanged whatever it is — blank (spaces
        only, which the standing crew's plain box before #741 and the board before Round 20 stored),
        «-», or long. The shape refused the blank, so nothing on that row could be saved again. The
        shape now refuses only the empty string, as before Round 28. A NEW or CHANGED direction that
        names nothing (blank, «-», a zero-width space) is refused by the save with 400 on the row's
        `direction` (`TOO_SMALL`). It was stored before, and the filters counted it «بدون اتجاه».
        `normalizeOperationsDirection` also drops invisible format marks (`\p{Cf}`: bidi marks, a
        zero-width space), and `operationsDirectionNamesSomething` is the shared «names something»
        rule.
      - An area whose name holds a separator: the area fold (`foldOperationsAreaName`) now reads a
        punctuation mark or a symbol as a space, not as nothing. So «شبرا الخيمة» as typed is the
        area «شبرا/الخيمة», stored in its spelling. `operationsDirectionMatchesArea` tries the whole
        direction first, so a van picked as «شبرا/الخيمة» is proposed for its own area's محصنات
        again (a bug older than this round). «توزيع المحصنات» reads the vans' directions against its
        محصنات' areas (`shipmentAreaNames`), so the right area box no longer splits it into «شبرا»
        and «الخيمة».
      - The list: a near miss of an area comes before «استخدام «…» اتجاهًا». This covers the words
        in another order («نصر مدينة»), one letter away from four letters on («حلوات» → «حلوان»),
        and a separator typed as a space. A direction of several parts is completed on its last part
        («المعادي - حلو» → «المعادي - حلوان»).
      - Leaving the box: text that ends part-way through an area's word («حلو», «المعادي - حلو»)
        goes back, as before. A WHOLE word is taken as typed, even one an area holds («مصر» beside
        «مصر الجديدة»). It used to be thrown away without a word.
      - The box: a hand-typed direction wears a small pen at its start. The title alone never showed
        on a phone. Opened on a value that is not one area, the box keeps its text whole and
        selected, so it can be read in full and corrected in place; it used to blank it. That value
        is the list's first row, so Enter keeps it. The 80-character `maxLength`, which cut a paste
        without a word, is gone. The list says when hand-typed text is too long («طول الاتجاه
        المكتوب يدويًا …»). Each row has an id the box names as active (`aria-activedescendant`),
        «مسح الاتجاه» is reached by the arrows, and the hand-typed note is the box's
        `aria-describedby`.
      - Comments corrected: the two saves share one rule so the two boxes behave alike. (Round 28
        left «تحميل الطاقم الثابت» copying the people only; since Round 28b it copies the direction
        too, never the time — below.)
      - Tests rewritten to the critic's rule (the build's, never the owner's): (web) «text some area
        holds → nothing taken» → «text that ends part-way through an area's word → nothing taken»
        («نصر» is now taken), «caps the typing at the save's ceiling» → «cuts nothing typed or
        pasted: the box has no maxLength — the list says when it is too long»; (contracts) «is never
        empty once tidied, and leaves the length to the save» → «refuses only the empty string, and
        leaves the rest to the save — blank, «-» and length included». The blank and «-» refusals
        are pinned by the API's integration tests.
  - Round 28b — «تحميل الطاقم الثابت» ينزّل الاتجاه. Asked «لما تعمل «تحميل الطاقم الثابت» على «لوحة
    التشغيلة»، بينزل الناس بس من غير الاتجاه والتوقيت … تحب الاتجاه ينزل كمان؟», the owner answered:
    «اه». He was asked about the direction only, so only the direction comes down with the crew —
    never the time (التوقيت), the notes, the type or the colour. Web only: no server path seeds a day
    from the standing crew (the load edits the board's draft, and «حفظ» writes it, as before).
    - A van the load fills (somebody placed, by its two rules: only an empty van, nobody twice) takes
      its standing row's «الاتجاه» when the day's row has none. A direction the day's row already
      holds — typed by the planner, saved this morning — is kept, never overwritten. A van the load
      does not fill takes nothing.
    - Never a direction the day's save would refuse. The save's rule (`crew/crew-direction.ts`) is
      mirrored line for line in `standingDirectionForDay` (`lib/standing-load.ts`): tidied
      (`normalizeOperationsDirection`); one that names nothing (blank, «-», a zero-width space) is not
      copied; one that names active areas is copied in the areas' own spelling, as the save stores it
      («المعادى» → «المعادي», «معادي/حلوان» → «المعادي - حلوان»), however long; anything else is
      hand-typed, copied as typed unless it is longer than `OPERATIONS_DIRECTION_MAX_LENGTH` (80). A
      standing row may still hold such a legacy direction (its own, kept while sent unchanged), but
      on the day's row it would be new. So «حفظ» after a load goes through — judged, since the
      critic below, on the very text the load writes.
    - Switching «الطاقم الثابت» off clears the direction it wrote, as it empties the vans it filled —
      but only while the row still holds exactly that direction: one the planner typed over it after
      the load stays his. The board's draft keeps what the load wrote beside the vans it filled
      (`CrewDraft.standingDirections`, `lib/crew-undo.ts`; `sameCrewDraft` compares it), so one press
      of «تراجع» takes the people and the directions back together, and «حفظ (n)» counts each filled
      van once — 0 again after on → off.
    - The toggle's hint says so: «يملأ المركبات الفارغة فقط: الطاقم، والاتجاه إن لم يكن للصف اتجاه.
      راجِع ثم احفظ.» («Fills empty vehicles only: the crew, and the direction where the row has none.
      Review, then save.»).
    - Comments corrected where Round 28 wrote that the load copies the people only
      (`crew/crew-direction.ts`, `standing-crew.service.ts`, the doc of
      `SetOperationsStandingCrewRowSchema`, the standing crew's Round 28 integration test): it copies
      the people and the direction, never the time.
    - Tests rewritten to the new rule: (web) «keeps direction and plannedTime as the board had them»
      (its standing row had no direction, and its comment said the toggle loads a crew only) → «keeps
      the day row's own direction and time — a standing direction never overwrites one». New: the
      direction copied onto a filled van with none; kept when the day's row has one; not copied onto
      a van not filled; skipped when the save would refuse it (empty, blank, «-», a zero-width space,
      «!!!», hand-typed past 80 — taken at 80); tidied, and in the areas' spelling; a direction of
      areas past 80 copied; off clears it only while unchanged, with «حفظ (n)»; one press of «تراجع»
      for the people and the directions; the page's wiring (`standing-load.spec.ts`,
      `crew-plan.spec.ts`, `crew-undo.spec.ts`).
    - Round 28b critic (the build's, never the owner's):
      - «حفظ» after a load was refused whole (400 `TOO_BIG`) for a standing direction of eight areas
        naming «شبرا/الخيمة». The load judged the STANDING text; the save judges the text it is sent
        — the respelling «شبرا/الخيمة - المعادي - …» (91 characters) — and, split at «/» too, that
        was «شبرا» and «الخيمة», no areas: hand-typed text past 80. `canonicalOperationsDirection`
        (contracts) now reads a RUN of parts as one area wherever the text between them folds to its
        name, the longest run first (as it already read the whole text), so its answer read again
        is the same answer. The day's save, the standing crew's save and the board's picker take
        «شبرا/الخيمة - …» however long, and the picker no longer marks «شبرا/الخيمة - المعادي»
        hand-typed. `standingDirectionForDay` judges the text it writes, as the save does (and
        writes the standing row's own text when a respelling would not read as areas again).
      - The toggle waits for the areas' list: held while it loads («جارٍ تحميل قائمة المناطق — يُقرأ
        بها كل اتجاه قبل تحميل الطاقم…» on it). Pressed before, a direction of areas past 80 was left
        behind without a word, and a shorter one came down in the standing row's spelling. Switching
        off never waits.
      - A van it fills whose standing direction names something the save would refuse (hand-typed
        past 80 — a legacy one, or any while the areas' list failed) is named in a notice, as the
        people left off are: «لم يُنقل الاتجاه الثابت», then the vans' codes and why — «… — أطول من
        ٨٠ حرفًا وليس أسماء مناطق. اكتبه على المركبة.» (`directionsLeftBehind`).
      - What the load filled is in view: when a filter would hide a van it filled (`hidesAnyOf`,
        `lib/crew-plan-filter.ts` — «بدون اتجاه» hid each van the moment it took its direction, and
        «حفظ (n)» counted changes the planner could not see), the filters go, as they go for a new
        row and for the row a refusal names.
      - Not changed, the owner's call: at 1440 the direction column (8rem since Round 27) cuts a
        longer direction («طريق السويس» beside the hand-typed pen, «المعادي - حلوان»); the whole text
        is in the box's tooltip. The load now writes such directions across the board, so it shows
        more often; the screenshot shows «طريق السويس» as it is.
      - Tests, each failing before and passing after: (contracts) a run of parts read as one area,
        every answer read again the same, and only what no run answers named unknown; (api) the
        91-character respelling sent new on the day's save — 400 `TOO_BIG` before, 200 now
        (`operations-crew-plan.spec.ts`); (web) the load writes what the save takes, judges the text
        it writes, names the directions it left behind, `hidesAnyOf`, the page's wiring, and the
        three new strings in both catalogs.
  - Round 28c — «الاتجاه»: يعرض الإضافة إلى القائمة. The owner, on «الاتجاه»: «الاتجاة زى ما قولنا اكتبه
    اختارمن الداتا ليست او ان اكتبه ويجبلى ان ممكن اضيف لو مش موجود». Asked whether a direction typed
    by hand — «استخدام «…» اتجاهًا», saved on that row only and never added to the list — should also
    go on the list, he answered: «يعرض عليا اضيفه او لا».
    - The box (both screens, «لوحة التشغيلة» and «الطاقم الثابت»): for a name no area answers, the list
      offers BOTH — «استخدام «…» اتجاهًا» first, as Round 28 left it (this row only; Enter takes it,
      every Round 28 key and rule kept), then «إضافة «…» إلى القائمة» («Add “…” to the list»), a plus
      where the typed row has its pen, reached by the arrows (Enter takes the highlighted one; each
      row's id is the box's `aria-activedescendant`, as in Round 28). Its hint: «تُضاف إلى «المناطق» في
      البيانات المرجعية فورًا، لا عند «حفظ»، ولا يحذفها «تراجع».»
    - The add is «المناطق»'s own create (`POST /operations/areas`) under the catalog's own grant
      (`operationsCatalog.manage` — no new permission): a desk without it is never offered the add (the
      box is given no `add`), and the server takes the actor from the token. The name is the typed
      text tidied as the save tidies a direction (`normalizeOperationsDirection`); its English name is
      left empty, for «البيانات المرجعية». The areas' list is read again BEFORE the row is told; then the
      row takes the area in the catalog's own spelling — one operation, which «تراجع» takes back
      without taking the area off. The toast says so: «أُضيفت «…» إلى «المناطق»» — «وُضعت اتجاهًا لهذا
      الصف. يعيد «تراجع» اتجاه الصف وحده، وتبقى المنطقة في القائمة.» The box, the board's filters and the
      hand-typed pen read the new area from then on. «توزيع المحصنات» reads a van's direction against
      its محصنات' own areas, not this list, so it needs no reading again.
    - When it is offered (`directionAddOffer`, `lib/direction-pick.ts`): text that names something; at
      most `OPERATIONS_DIRECTION_MAX_LENGTH` (80), the hand-typed ceiling — an area's name has no
      ceiling of its own, and a longer name added as an area would have escaped it; ONE part, none of
      the separators the direction rules split at («المعادي - طريق السويس», «الواحات/الفيوم», «… و …» are
      directions of several); no active area that IS it, folded as the server compares (the list
      offers that area instead — since the critic, nothing wider: see below); and no archived one:
      «الدقى» beside an archived «الدقي» is said («… موجودة في «المناطق» لكنها موقوفة — فعّلها من البيانات
      المرجعية لتظهر هنا.»), not added twice. Nothing is offered until both lists are read.
    - While it is written, the row's box shows the name with a spinner, read-only and `aria-busy`
      («جارٍ إضافة «…» إلى «المناطق»…»): it takes no key but Tab and its list does not open. One request a
      row — a second Enter adds nothing — and two rows adding the same name (folded) at once share one
      (`directionAddQueue`, `api/direction-area.ts`).
    - A refusal is said — in place while its box has the focus (above the list, the box red), else by
      a toast; shut, the box marks it and gives it as its title (critic, below) — and the typed text
      is NOT lost: the box keeps it, «استخدام «…» اتجاهًا» is offered first, and the add is not offered
      again for that name unless it failed for a reason that may pass (the network). Duplicate (409 —
      the area holding the name, named, archived or not), no permission (403), the name refused
      (400), or failed. A pick, leaving the box or Escape answers it.
    - The server (`areas/area.service.ts`): the create refuses a name that FOLDS to a live area's
      (`foldOperationsAreaName` — «المعادى» or «معادي» beside «المعادي», an archived one too) with the
      unique index's own answer, 409 `DUPLICATE`, naming the area (and «(archived)»). The index held the
      exact name only, so another spelling of one area went in beside it. The catalog dialog's add
      gets the same answer — and, since the critic, its rename too.
    - Its own small hook file (`api/direction-area.ts`): the archived names
      (`useArchivedOperationsAreaNames`, under the areas' key) and the create with its own `onError`,
      so a refusal is said once; `useCreateOperationsArea`, the catalog dialog's, is unchanged.
    - Tests: none rewritten — Round 28's list, keys and leaving rule are unchanged. New: (api,
      `operations-crew-plan.spec.ts`, run whole) the add answers the area's own spelling and the board
      then reads it as an area; folded duplicates — another spelling, the article off, the exact name,
      an archived one — refused 409 `DUPLICATE`, nothing added; a planner without
      `operationsCatalog.manage` refused 403 while his row still takes the text. (web)
      `direction-pick.spec.ts` — when each option is offered, and the order; `crew-plan-controls.spec.tsx`
      — both options and the hint, the archived note, the refusal, pending, the refused box, and no
      `add` = Round 28's box; `direction-area.spec.ts` — the archived names' request, the create on a
      real QueryClient (the areas read again before the answer, the global notifier quiet), one
      request a row and one a name, the refusals' reasons, and both pages' wiring.
    - (Verifier, on the real stack) Two gaps against «لو مش موجود», fixed in `lib/direction-pick.ts`:
      (1) «part of a name» blocked a whole name a LONGER area only contains — «القاهرة» beside
      «القاهرة الجديدة», «مصر» beside «مصر الجديدة», «المعادي» beside «المعادي الجديدة» got no add
      (the server takes them: they fold to other names), and «طريق» was said to be an archived «طريق
      المطار». Now an area blocks the add only when it IS the name (`isAreaNamed`: folded alike, its
      words reordered, one letter away, or the text a PIECE of its word — «المعا», «قاهر», still being
      typed); a whole-word name gets the area first, «استخدام», then «إضافة». (2) The box opened on
      its row's own hand-typed direction listed «استخدام «…» اتجاهًا» but no add, so a direction used
      on the row once could never be added from the board; it is offered there too
      (`directionAddOfferInBox`). New (web, `direction-pick.spec.ts`): «a whole name a longer area
      only contains is another name …», «the box opened on its row’s own hand-typed direction offers
      the add too …».
    - (Critic) Nine findings, all real, each fixed with a test that fails before and passes after:
      (1) «إضافة» was still held back by the search's wide match — the verifier's `isAreaNamed` kept
      words reordered, one letter away and a piece of a word — so names of other places («المنيب»
      beside «المنيل», «طرة» beside «القنطرة شرق», «مصر» beside an archived «مصر القديمة», which it
      told the desk to restore) got no add and no word why. Now only an area that FOLDS to the name
      holds it back (`sameAreaName`, the server's own rule); a near miss is an area listed FIRST —
      what Enter takes, the «did you mean» — then «استخدام», then «إضافة». (2) A refusal outlived its
      row: shut, the box showed the refused name in red where the row's direction is, after «تراجع»,
      a load, on another day. Now it is held for one row on one board day (`directionAddSlot`) while
      the row still holds the direction it was sent on (`refusalStillHolds`); shut, the box shows the
      row's own direction, a mark at its start and the refusal as its title, the name back on
      opening. (3) The add landed by row key alone: a day stepped meanwhile patched the same van on
      the other day, and a row gone (a «حفظ» read-back renames `new:N`) dropped it while the toast
      said it landed. It lands only on its own day, on a row still holding its direction at the send
      (`addLandsOn`); else the toast says «لم يتغيّر اتجاه الصف: تغيّر الصف أو اليوم أثناء الإضافة…».
      (4) The box opened on its row's own hand-typed direction — fixed by the verifier, above. (5)
      `area.service.ts` leaned on Round 29's `liveAll()`; it reads the live areas with the model.
      (6) The folded rule held the create only, and could be raced: a RENAME to another spelling of a
      live area is refused alike (409, naming it), and a name is checked and written one at a time
      (the API runs as one instance) — three spellings of one new name sent together: one 201, two
      409s. (7) A 409 said «added meanwhile», even of an archived area: its detail names the area
      holding the name and whether it is archived (`AREA_ACTIVE` / `AREA_ARCHIVED`), and the box says
      which («… في «المناطق» منطقة «الدقي» بهذا الاسم لكنها موقوفة …»); the catalog's own dialog says
      it in the reader's language too (`errorMessage`), not the server's English. Said once: in place
      while the box has the focus, else by a toast — its title short («لم تُضَف «…» إلى «المناطق»»,
      a toast's title is one line, cut), the whole reason under it. (8) Screen readers: the notes (a refusal, an
      archived area) sit above the listbox, not in it, the archived one named in `aria-describedby`;
      one live region a box, always there, speaks the pending add, the refusal and the archived note
      while the box has the focus. (9) The box's keys are read by `directionKeyAction` (pure), walked
      keystroke by keystroke — Enter on «إضافة» adds, a second Enter while it is written adds nothing
      — and what the box does with each answer is pinned on its source.
      Rewritten (named): «is never offered when an active area IS the name, folded …» (was «… answers
      the text …»); «a whole name a longer area only contains …» (a piece is offered now); «no add for
      a name an area IS …» (was «… an area holds …»); «an archived area holding the name is said above
      the listbox …»; «a refusal is said above the listbox …»; «a refused add, the box shut: the row’s
      own direction …» (was «… keeps the name in the box, marked red …»); the pages' wiring (the box
      is given the row's direction). New: (api, `operations-crew-plan.spec.ts`, run whole) the 409's
      detail, the rename refused, two spellings at the same moment; (web) `direction-pick.spec.ts` —
      the near misses, `directionAddHeld` / `directionAddRefusalText`, the keys walked;
      `direction-area.spec.ts` — the day and the row as it was, the refusal held per slot;
      `crew-plan-controls.spec.tsx` — one live region, the keys carried out; `shared/lib/errors.spec.ts`
      — the held area worded.
  - Round 29 — «استيراد فروع من شيت» on «البيانات المرجعية» → «الفروع». The owner, with four banks'
    branch lists: «عاوز اضيف دول فى البيانات المرجعية تبع (الفروع والبنوك والمناطق) ملحوظه هتلاقى area
    دى ضيفها ل منطقة العمليات و منطقة الحسابات تمام ؟» and «وعاوز جمب اضافة فرع فوق يقدر يضيف شيت ويقارن
    زى بتاع كروت الشحن كدا».
    - Beside «إضافة فرع» (for `operationsCatalog.manage` only — no new permission): «استيراد من شيت».
      «اختر البنك» (the sheet does not name it), «ارفع شيت الفروع» (.xlsx, ≤ 10 MB, ≤ 5 000 rows),
      «مقارنة بالفروع» — the fuel-card sheet's flow and look. Nothing is written until «تأكيد
      الاستيراد».
    - The reader (`bank-branches/import/read-branch-sheet.ts`): the first VISIBLE tab, never inflated
      whole (the fuel sheet's `one-sheet-zip`, streamed in slices); the header is the first of ten
      rows naming «اسم الفرع» / «الفرع» / «Branches» / «Branch», and each column is bound by its label —
      «رقم الفرع» / «الكود» / «كود الفرع» / «Code», «المنطقة» / «المنطقة (عربي)», «Area» / «Area
      (English)» / «المنطقة (إنجليزي)», «عنوان الفرع» / «العنوان» / «Address»; any other column («م»,
      «التكلفة») is never read. A merged area is every covered row's; blank rows and rows of a serial
      alone are skipped; a code is the text the cell shows («084» stays «084»); names are stored
      tidied (spaces, tatweel «ـ»); an area without a letter («ــــ») is none; a name cell that holds a
      date is flagged.
    - The owner's decisions (`plan-branch-import.ts`): the sheet's area goes into both «منطقة
      العمليات» and «منطقة الحسابات»; an area «المناطق» lacks is created (Arabic in the name, English
      in `nameEn` — «فى خانة العربى اكتبها عربي وفى خانة الانجليزى اكتبها انجليزى»), one it holds (its
      Arabic name folded, or its English name without case) reused in its own spelling and its empty
      English name filled; an area in Latin letters only stands for both names, and one in Arabic
      letters under «Area» is the Arabic name, never written as the English one. A branch the bank
      holds by name takes the sheet's code and area («حدّث الكود والمنطقة»); an empty cell never wipes;
      an address only where the branch has none. «ضيف رقم بعد الكود»: the first branch of a code keeps
      it, each further one «-2», «-3», … past every suffix the bank uses (a held branch keeps its own;
      «0» likewise). Problems — no name, a date for a name, a name twice, a name two held branches
      share, a new branch with no code — are listed and never written.
    - The comparison: the five counts («جديد», «تحديث», «بدون تغيير», «كود معدَّل», «مشكلة»), the new
      areas (Arabic | English) and the English names filled, every row (old → new code and area, the
      sheet's code → the code stored, why a problem), filters and a search. «تأكيد الاستيراد» posts the
      SAME file with the comparison's `fileSha256` and `planDigest`: the server plans again and refuses
      (409 `OPERATIONS_BRANCH_IMPORT_CHANGED`, nothing written, «مقارنة من جديد») unless it is the plan
      shown; then ONE transaction — the areas, the edits (a code two held branches swap passes
      through a code of its own), the new branches — each audited as the catalog's add and edit. The
      branches and areas lists are read again. The same sheet compared again is all «بدون تغيير».
    - Checked on the real stack with the owner's four ready sheets (kept local), a few held branches
      and areas seeded to overlap them: بنك مصر 672 rows (669 new, the seeded one updated, 74 codes
      suffixed — the 18 «0» as 0 … 0-18 — 30 areas created, 1 English name filled, 2 rows whose name
      is a date), CIB 201 (every new area with both names), البنك الأهلي 629 (no area, 1 suffix), بنك
      القاهرة 230 (211 addresses, 8 suffixes); each compared again: nothing to write.
    - Tests: (contracts) the labels, tidying, suffixes, the apply's hashes; (api) the reader (labels in
      any order, a title row, merged areas, Latin areas, placeholder areas, leading zeros, tatweel,
      dates, blank and serial rows, the visible tab, the caps), the planner (new / update /
      unchanged, suffixes against the sheet and the bank, freed and swapped codes, areas reused /
      created / filled, the problems, a second import plans nothing) and the
      `operations-branch-import.spec.ts` integration suite (the grant, nothing written by a compare,
      another file and a moved plan refused, one transaction, audits, a re-import, a swap); (web) the
      button's grant, the steps, the comparison drawn, the filters, the refusals, the keys.
    - Round 29 critic (the build's, never the owner's): a NEW row whose name the bank holds spelt
      another way («ى/ي», «ة/ه», «أ/ا», Arabic-Indic digits — `operationsBranchNameLookalikeKey`) stays new,
      as the owner's rule matches on the tidied name, and is marked «قد يكون مكرَّرًا» with the held
      branch's name and code; a Latin-only area takes the Arabic name another row gives beside the
      same English one, whichever row comes first (the first row's Latin had become the Arabic name);
      an area found by its English name alone says the row's Arabic is not written (`byEnglish`), and
      an English name that is another area's is never written on this one (`englishElsewhere`); an
      «Area» cell with any Arabic letter is the Arabic name, and Latin under «المنطقة» beside Arabic
      under «Area» is read swapped back. All of these are «للمراجعة» — a filter, a line above the
      counts with «اعرضها», and a line in the confirmation — and are in `planDigest`: a lookalike
      added after the compare refuses the apply (409, nothing written). «كود معدَّل» (tile, filter, row chip,
      `counts.suffixed`) counts only the suffixed codes the import writes — a held «116-2» read again
      shows its code and the sheet's, written nothing. The filters are toggle buttons
      (`aria-pressed`), old → new values say «كان» / «أصبح» to a screen reader, the toast is a short
      title with every count (the English names filled too) in its description. The specs' dates are
      made up (two had come from the owner's sheet), and `shared/xlsx/stream-text.ts` has its own spec.
  - Round 29b — تحميل فروع البنوك الأربعة مع النشر. Offered the upload screen above or the deploy's
    own load, the owner: «انا عاوز الداتا اللى باعتهالك دى تتضاف … نفذها». His four sheets go into
    «البيانات المرجعية» ONCE, by the next deploy, under the import's own rules — nobody uploads them.
    - The data: `apps/api/assets/operations-go-live/bank-branches-{banque-misr,cib,nbe,banque-du-caire}-2026-11.json`,
      each sheet's rows as `read-branch-sheet.ts` reads them (the name, the code as text, the area in
      Arabic and in English, the address), copied into the build by `tsup`'s `publicDir`. بنك مصر's
      two rows whose name Excel had turned into a date (rows 409 and 456) are left out and listed in
      its file with why; they are added by hand.
    - The step (`operations/go-live/bank-branches.ts`, started by the api only, not awaited): each
      bank is found by name (`bank-branches-banks.ts` — its operations, Arabic or English name,
      folded: «بنك مصر» / «مصر» / Banque Misr / MISR / BM; «CIB» / «البنك التجاري الدولي» /
      «التجاري الدولي» / Commercial International Bank; «البنك الأهلي المصري» / «الأهلي المصري» /
      «الأهلي» / NBE / National Bank of Egypt; «بنك القاهرة» / «القاهرة» / Banque du Caire / BDC —
      the short ones are the legacy operations names, `bank_name_ops`, that `opsName` keeps, and
      ATM's labels). One → that bank; none, and no live bank that LOOKS like it (one of its names
      holding the bank's word, whole: «مصر» / Misr, «الأهلي» / NBE, «القاهرة» / BDC, «التجاري
      الدولي» / CIB) → created («البنوك» is on the owner's list), its code one past every code
      given; two, or one another file's names find too, or a look-alike («بنك مصر إيران», «البنك
      التجاري الدولي (CIB)», «NBE FOREX» named «البنك الأهلي المصري»), or a stopped one → skipped,
      nothing written but its run row (`status: 'skipped'`, why, which banks), logged at error
      level — for good (Round 29b critic: a skip asked again on every boot loaded the November
      sheet whenever it cleared, months later, over the operators' edits); its sheet goes through
      «استيراد من شيت». The file is then planned by `planBranchImport` and written by
      `writeBranchImport` — the apply's own transaction body, now exported from
      `branch-import.service.ts` with its trail (`branchImportAudits`): both
      areas, an area created or reused and its empty English name filled, a held branch's code and
      area updated (an empty cell never wipes, an address only where it has none), «-2» / «-3» past
      every code in use, names tidied.
    - (Critic) What the import's screen shows a person before «تأكيد الاستيراد», the deploy has no
      one to show: on a bank that already holds branches, a NEW row that may be one of them — its
      name a held branch's spelt another way (`similarTo`), or its code, one the sheet gives no
      other row, already a held branch's of another name — is held back, not written
      (`go-live/bank-branches-plan.ts`), and listed in the run row with the branch it may be; the
      rest is planned again without it. A code the sheet repeats («0» eighteen times on بنك مصر's)
      takes «-2», «-3» as before. Every held branch the load edits is kept in the run row with what
      it held (`changed`), and `areasReplaced` counts those whose area the sheet's replaced — the
      owner's «حدّث الكود والمنطقة»; the audit trail is no longer the only record of the old areas.
      On an empty bank nothing is held back: the dry run below is unchanged.
    - Once per database, per bank, all or nothing: a new `operations_go_live_runs` collection
      (unique `key`; IT's `it_go_live_runs` to the letter) whose row is each bank's transaction's
      LAST write — the bank, its areas, its edits, its new branches and the row commit together or
      not at all. With the row in, no later boot reads the file again, so a branch or an area
      edited or deleted afterwards stays as it was left. Written by nobody (`by: null`, the boot
      steps' system actor) and audited after the commit as the catalog's own adds and edits, each
      entry marked with the run's key; the run row keeps the bank's counts. (Critic) A load that
      fails — or whose file the build lacks — is counted under `<key>:failed` (first and last
      failure, how many, the last error) and tried again on the next boot, for 7 days after its
      first failure (`BANK_BRANCHES_RETRY_DAYS`); the first boot after that writes the run row
      `status: 'gaveUp'` and loads nothing, whatever cleared the failure since.
    - A dry run on a fresh database with the committed files: بنك مصر 672 rows read — 670 new (73
      codes suffixed), 2 left out, 31 areas created; CIB 201 new, 34 areas created; البنك الأهلي
      629 new (1 suffixed, no area); بنك القاهرة 230 new (8 suffixed, 211 addresses); the four
      banks created, 1 730 branches, 65 areas each with both names, no problem rows; a second run
      writes nothing. On the live database the counts follow what «البنوك» and «المناطق» hold.
    - Tests: `bank-branches-banks.spec.ts` (the four banks, their aliases and marks, folding, found /
      missing / two banks / another file's bank / look-alikes / found by a display name only /
      stopped, the next code, the file's schema, the committed files' row counts and their plan on a
      fresh catalog), `bank-branches-plan.spec.ts` (held back by a spelling or a held code, a
      repeated code not, a held-back row's code freed and its twin still refused, the edits kept
      and the areas replaced counted, nothing held back on the committed files) and the
      `operations-go-live-bank-branches.spec.ts` integration suite on synthetic files (a run row
      refused leaves no bank, area, branch or edit, and the failure is counted; the first boot
      finds a bank by its folded name, creates one, reuses, updates, suffixes and fills, refuses a
      name twice, holds two rows back, replaces an area and keeps the old one, audits by nobody; a
      later boot writes nothing and an operator's delete and edit stand; two banks skipped for good,
      settled months later still nothing; a build without the files counted; a failure past its 7
      days given up, an operator's edit standing; look-alikes and a stopped bank skipped, no bank
      created). The run model is in `sync-indexes.models.ts` and the module's manifest.
  - Round 30 — «توزيع المحصنات» على يوم مضى: سجل للعرض فقط. On the screen's top row («يوم التسليم»,
    the figures, «توزيع تلقائي», «تراجع», «حفظ (0)»), the owner: «عاوز هنا يقدر يجيب اليوم اللى قبله
    ك رؤيى بس ميقدرش يعدل عليه او يعمل حاجه ك سجل يعنى».
    - «يوم التسليم» takes a past day (it had a floor at today). Today stays the default and every
      later day is the plan, as before. «تسليم المحصنات» keeps its floor and its today-only «تسليم».
    - The read (`GET /operations/secured/distribution?date=`) answered a past day with 422
      `OPERATIONS_DISTRIBUTION_DAY_IN_PAST`; it now answers it as that day's RECORD (`past: true`):
      the day's saved «محصنة» crew rows (vans, captains, crew, direction, counts — the rule of a day to
      come), every secured shipment due on the day WHATEVER its status now (handed over, delivered,
      still in the vault — then «متأخرة» — or never received), and every one whose live delivery leg
      rides one of the day's crew rows; each at its current stage, on the van its live leg rides or on
      none. A record proposes nothing. Its cartons, bags and boxes are the vault's counts at receipt,
      held or handed over since (`recordPackages`, to a reader of the vault only, its packaging read's
      grant) — read from the vault's holdings, a van that went out would count 0. What it cannot
      show is in the contract (`past`): a shipment taken off its van, or moved to another day, since;
      and the overdue ones that waited in the vault that day without a van (which shipments were
      overdue on a past day is not kept). The reads of today and of later days are unchanged.
    - The save still refuses a past day (422 `OPERATIONS_DISTRIBUTION_DAY_IN_PAST`, `MIN_DATE` =
      today, before any shipment is looked at): the record is read only on the server whatever a
      client sends. «تسليم» on a past day's van stays refused (`OPERATIONS_DISPATCH_NOT_TODAY`).
      (Verifier) A save of TODAY could still take an overdue محصنة off the PAST day's van its leg
      was left on — a hand-made request, the screen never sends it — and so change that day's
      record; a take-off now reaches only a van of the day saved (422
      `OPERATIONS_CREW_DAY_MISMATCH`, naming the shipment). Placing such a محصنة on one of today's
      vans still moves it, re-dated: the overdue flow.
    - On the screen a past day — by the URL's day before the read is in, by the server's `past`, or by
      midnight passing over yesterday's read (`isRecordDay`) — is drawn as for a reader without the
      edit grant: no drag, no «نقل إلى…», no «توزيع تلقائي», no «تراجع» (nor Ctrl+Z), no «حفظ», no
      proposal, no unsaved draft. In the hint's place a calm notice, «سجل يوم … — للعرض فقط، لا يمكن
      التعديل», and what it shows; where the acts stood, «سجل · للعرض فقط» and «العودة إلى اليوم». The
      filters and the hover cards still work. No new permission.
    - (Critic) `POST /operations/secured/:id/assign-delivery` writes the same delivery leg and took a
      past day's van with a 200 (a hand-made request — no screen mounts its dialog now); it refuses
      one as the save does (422 `OPERATIONS_DISTRIBUTION_DAY_IN_PAST`, same detail). The record's read
      asks only for the day's secured delivery legs, ids joined on the server, instead of loading every
      leg of the day. On the screen, once the read is in the SERVER's `past` decides, plus midnight
      passing as the screen's own clock saw it (`isRecordScreen`): a PC clock running ahead no longer
      turns today into a record. Picking today on a screen midnight turned into yesterday's record
      reads it again; work left unsaved when the day ended is said (a toast and a line on the notice),
      not dropped in silence; the record is drawn calmly (no rose «بلا قائد» frame, no «لا تأخذ
      محصنات», no amber kept row, no rose «بلا سيارة»), its words kept. Ctrl+Z goes through one handler
      (`distributionUndoKey`) tested with key presses, and the draft's one writer is shut on a record.
      The suite's record now holds a DELIVERED one too. Rewritten (web): «is a record … on
      yesterday’s read left open past midnight» (the stale read now arrived yesterday), «shuts every
      act through ONE gate», «takes nothing back while the save is in flight».
    - Tests rewritten to the new rule: (api) «opens on TODAY in Cairo, and refuses a day that has
      passed» → «opens on TODAY in Cairo — and a day that has passed as its record, not a refusal»;
      (web) «opens on the day with no day before today, and the drag hint» → «opens on the day — with
      no floor: a past day can be picked, as its record — and the drag hint»; «never a past day — the
      server refuses one» → «never a past day on the vault’s screen — a past day’s vans have left».
      New: the Round 30 integration suite (the record's vans and shipments at every status, a leg left
      on its van under a moved date, no proposal, its packages — the handed-over one's too — to the
      vault's readers only, every reader, every save of the day refused with nothing written,
      «تسليم» refused, the live day untouched, an unplanned past day); the page's record (the notice,
      no write control, no drag, menu or proposal, the loads, marks and packages, before the read and
      past midnight, a reader without the grant, the one gate); `readDistributionDay`, `isRecordDay`,
      `recordPackaging`; the wire.
  - Round 31 — بطاقة السيارة: العدد والكلمة في سطر واحد. On «توزيع المحصنات» (his screenshot: the
    record of 2026-11-18, vans 101/104/112/125/249/106), the owner: «الصوره دى عاوز العدد والكلام على
    صف واحد مش صفين يعنى المحصنات والعدد والايقون فى صف واحد واسم القائد برضو يكون جمب الاشارة
    الخضرة اعملى سامبل كدا وورينى». A sample, built in the real van card (`VanCard`), so it can ship.
    - Each count on the van card — محصنات, كراتين, حقائب, صناديق — is ONE line: its icon, its figure,
      then its word beside them («1 محصنة», «4 حقائب», «2 كرتونتان»), so each tile and the card are
      shorter. The words are the count's own as before (محصنة · محصنتان · محصنات; كرتونة · كرتونتان ·
      كراتين …), the colours, the 0 look and the order of the tiles are Round 27d's, unchanged; a
      three-digit figure is a step smaller (13px, `lineFigureSize`) so the word keeps the line.
    - The captain's name sits on the SAME line as his green «قائد», beside it, cut to what the frame
      has left (his person card says it whole, as before); «بلا قائد» and the record's quiet «بلا
      قائد» were one line already.
    - Each tile is one line HIGH at every width (R31 review — the sample had let the word step under
      the figure on the narrow three-a-row cards, a two-line tile and row: English «10 Secured» /
      «12 Cartons» at 1024 and 1340–1366, «103 Secured» at 1440). On a tile under 5.5rem (82–90px:
      1024, 1340–1440, 1800) a figure of two characters or more is one more step smaller and the word
      a pixel closer (`lineFigureTight`, a container query on the tile), so every count to 99 keeps
      its word in both languages, three digits at 1440 too; only where even that line cannot hold it
      (three digits in English on the 82–84px tiles, «103 محصنات» on the 82px ones, four digits)
      does the word step out of view — never onto a second line, never cut — the tile then says the
      whole count on hover («103 كراتين») and to a screen reader. Measured in a browser at 390, 768,
      1024, 1280, 1340, 1366 and 1440, light and dark, Arabic and English, today and the record.
    - R31 review — a cut captain's name keeps its START on the English screen too (`dir="auto"`):
      the box's left-to-right direction had cut an Arabic name at its beginning («احمد سيد بركة محمد»
      read «…يد بركة محمد»), which the shorter line beside the mark made common.
    - The van's hover card keeps its four tiles stacked, four across (18rem leaves each too narrow
      for one line); «تسليم المحصنات» wears the same van card, so its tiles are one line too.
    - Specs: the van card's captain spec rewritten («… then the captain: his mark and his name
      BESIDE it on one line (Round 31), cut, a card trigger»); R26b critic F8 renamed to the stacked
      tile it still pins (the hover card's); new: the Round 31 block in
      `distribution-van-card.spec.tsx` (one line in both languages, the words, the screen reader's
      phrase, the colours and the 0 look, the figure size and the wrap fallback, the hover card
      stacked, «بلا قائد»). R31 review: the fallback spec REWRITTEN («one line HIGH always: … the
      word leaves the view — never a second line, never cut»), the captain spec now pins the name's
      `dir="auto"`; new: the whole count on hover in English, a cut name keeping its start.
  - Round 32 — «لوحة التشغيلة» و«الطاقم الثابت». The owner, on two screenshots (each van list opening
    on «0», «00», «000», «0000», «00000», then «61»), and on the board: «دى مشكلة بيظهر عربيات ايه
    الاصفار دى»، «تانى مشكلة لما بجيب السجل فى لوحة التشغيل بيخلى اعدل وانا عاوزها اظهار فقط»، and
    «انا عاوز بقى اقدر اعمل اسوابنج بين عربيتين واقدر احدد هنقل ايه بالظبط للعربيه التانيه».
    - A — «دى مشكلة بيظهر عربيات ايه الاصفار دى». WHAT THEY ARE: cars typed by hand in «الحركة» →
      «السيارات» for vans with no Fleet code yet. Neither legacy export the go-live import read
      (`apps/api/assets/fleet-go-live/cars.json`, `cars-2026-09-29.json`: 213 rows, 4 deleted, 209
      live) holds a code made only of zeros, and the import invents no code (it refuses an empty or
      a repeated one, writing nothing — `vehicles-import.ts` `parseCars`); the only other writer is
      the registry's own add / edit, which requires a code and refuses one already held
      (`vehicle.service.ts` `create`, the unique index `ux_code`) — hence «0», then «00» because «0»
      was taken, and so on. Production's lists show 220 in «باقي السيارات» alone, against the 209
      cars imported.
      The same form requires a type and a plate, a chassis and a motor number, each unique: such a
      car is named by its PLATE. Fleet's data is not touched.
      - The rule (`vehicleCodeNamesNothing`, contracts `operations-vehicle-codes.ts`): a code — or
        a plate — that is blank, punctuation, or zeros only, in any digit system («0», «0000», «٠٠»,
        «0-0»). On both lists such a car comes LAST, in its own group «سيارات بلا كود في الأسطول»
        (`OPERATIONS_CREW_FREE_VEHICLE_GROUPS` gains `uncoded`), drawn by its plate with a quiet
        «بلا كود» and its make (Fleet's type) under it — never a bare «0000» — and found by its plate
        («٤٥٢١» too); its zeros match no search. A car whose plate names nothing either cannot be
        told from the next: left out, and counted on the list's last line — «سيارات بلا كود ولا لوحة
        في «الحركة»: n — لا تُعرض هنا، وتُصحَّح في «الحركة» ← «السيارات».» (`unidentifiedVehicles` on
        `GET /operations/crew-board` and `GET /operations/standing-crew`). Never hidden: the day's
        roster van and a standing-crew van — they keep their group, named by their plate.
      - The wire: each free car and each «إضافة سيارة» car carries `uncoded` — its plate and its
        make (`plateNumber`, `typeName`), null for a coded car; Fleet's plate and type are read
        through `fleet-boundary.ts` (`fleetActiveVehicles` now returns them; `fleetVehicleTypeNames`).
      - THE ORDER: codes NATURALLY everywhere these lists and the board's van lists sort — 61, 101,
        150, 213 (`compareVehicleCodesNaturally`, a code that names nothing after every one that
        does). «الطاقم الثابت»'s rows and its «إضافة سيارة» list were ordered as TEXT on the server
        («101» before «61»); the board's free list, its van filter and the web lists now share the
        one rule.
    - B — «لما بجيب السجل فى لوحة التشغيل بيخلى اعدل وانا عاوزها اظهار فقط». «لوحة التشغيلة» on a
      past day is that day's RECORD, view only, as «توزيع المحصنات» became in Round 30. The day box
      still takes any day (`min=""`); a day before today opens as its record.
      - The read (`GET /operations/crew-board`) answers `today` (Cairo) and `past`. The save
        (`POST /operations/crew-board`) refuses a past day before anything is read or written — no
        operating day made, no row touched — 422 `OPERATIONS_CREW_DAY_IN_PAST`, one detail (`date`,
        `MIN_DATE`, today). It had taken a past day's save. Today and later days save as before.
      - On the screen (`lib/crew-record.ts` `isCrewRecord` — the distribution's `isRecordScreen`: the
        URL's day before the read is in, then the SERVER's `past`, plus midnight passing on a board
        left open): every act asks ONE gate, `canPlan = mayPlan && !isRecord` — no drag, no «+
        اختيار» or slot list, no van given, no row added, emptied or deleted, no type, colour, time,
        direction or notes change, no «الطاقم الثابت», no «تراجع» (nor Ctrl+Z), no «حفظ»; «ألوان
        الأنواع» opens read only. The rows are the server's, never a draft (work left unsaved when
        the day ended is said, by a toast and on the notice). A calm notice under the bar — «سجل يوم
        … — للعرض فقط، لا يمكن التعديل» — and, where the acts were, «سجل · للعرض فقط» and «العودة إلى
        اليوم». The filters, Excel and the hover cards still work. «الطاقم الثابت» has no date —
        untouched.
    - C — a SAMPLE, built in the real board so it can ship: «دلوقتى انا لو عندى عربية عينت عليها قادة و
      اخصائيين و اتجاه وهكذا وجيت غلط المفروض الداتا دى ل عربيه تانية او نص الداتا صح والاقى على عربيه
      تانية انا عاوز بقى اقدر اعمل اسوابنج بين عربيتين واقدر احدد هنقل ايه بالظبط للعربيه التانيه فاهم
      قصدى ف ممكن تعملى سامبل كل عربيه بالبيانات على كارد جمب بعض الاتنين». «تبديل بين سيارتين» on
      «لوحة التشغيلة», today and later days only (a record has no acts).
      - THE WAY IN: a small «⇄» on each row — on the van code's second line (where «إضافية» goes),
        and under «بدون سيارة» on a row without a van; beside the colour and the bin it ran the
        table 24px past its frame at 1440 and 1920, the Round-24 trouble. It opens the window on
        that row; the second van is picked inside, from the board's other rows (rows without a van
        included), searchable by code, name or direction.
      - THE WINDOW (`CrewSwapDialog`): the TWO VANS ON TWO CARDS SIDE BY SIDE — the first on the
        right in Arabic — each listing everything its row holds: «قائد الطاقم», «أخصائي 1», «أخصائي 2»
        person by person (role colour, code, «غائب» / «إجازة», a seat held outside the role), then
        «الاتجاه», «التوقيت», «النوع», «لون الصف», «ملاحظات»; each item a real checkbox named by what
        it moves and where, and «الكل» · «الطاقم فقط» · «لا شيء» on each card. The drivers are
        Fleet's: said on the card, they stay with the van, and so do the محصنات placed on it
        (they ride the van's crew row). BETWEEN the cards, a radio group: «تبديل المحدد ⇄» (the
        ticks of both cards cross at once — the default), «نقل المحدد ←» and «نقل المحدد →» (only
        the sending card's ticks; the receiving card says «تستقبل»). UNDER them, the two cards
        AFTER the change, side by side, before anything is touched: what arrives («من 213»), the
        value a field moved one way replaces (struck, «بدلًا من …»), what goes («ينتقل إلى …»), and what a
        rule keeps where it is, with the reason. Tab stays in the window, Escape closes it, the
        focus goes back to the row's «⇄».
      - THE RULES (`lib/crew-swap.ts`, pure): a person keeps his slot role — a captain to «قائد
        الطاقم», a specialist to the same «أخصائي» slot or, that one full, the other; kept where he
        is, named: somebody away that day (Round 22), a seat his role does not fit on the other row
        (Round 23 — a seat held there before the rule stays), no room left (two a slot, counted
        AFTER the operation: the ones leaving make room for the ones arriving), and an archived type
        (only an active one is given to another row — the save's rule). Nobody is ever on two rows
        (Q11): people only cross between the two. A field in «تبديل المحدد ⇄» is ONE exchange the two
        cards share — ticked on either, both values cross (the window ticks the pair); in «نقل
        المحدد» one way it MOVES (the other row takes it, its own value named as replaced, the
        sending row left without one).
      - «تطبيق» changes the DRAFT only, as ONE operation: one press of «تراجع» puts both rows back
        («تراجع عن: التبديل بين 213 و255»); «حفظ (2)» counts the two rows and saves them as any
        other change. Nothing new on the server: the save already takes both rows of a move.
      - The cost, measured at 1280, 1366, 1440 and 1920 against the A/B build: the table's width
        unchanged at every one (the bin inside the frame); a van row's height unchanged (the code's
        line is 18px, the «⇄» 16px — the cell keeps its 36px); a van off the roster gets a third
        line (+16px, «إضافية» and «⇄» do not share a line), a row without a van +18px.
    - Specs. Rewritten: (contracts) «Round 24 — names the four refusals …» now pins the free list's
      five groups, `uncoded` last; (web) «opens the card with the catalog grant the reference tab
      already uses — no new one» → «… — read only on a past day's record (Round 32)». New: (contracts)
      `operations-vehicle-codes.spec.ts` — what names nothing, the natural order, the wire; (api,
      run whole) `operations-crew-round32.spec.ts` — the board's free list in number order, the
      uncoded last by plate and make, the unnamed left out and counted, the roster's and the
      standing crew's never hidden, an uncoded car taken by a row; the standing crew's rows and
      list in number order; a past day read as its record, every save of it refused (an edit, a van
      given, a row added, a removal, a new van, yesterday unplanned) with nothing written, 403
      before the day, today and later days saved; (web) `crew-round32.spec.tsx` — both lists'
      order and groups, the roster van kept, the search by plate, the list as drawn (plate, «بلا
      كود», make, heading, the count line), `isCrewRecord`, the page's one gate, the record's rows,
      notice and acts, the words in both languages and the refusal's. C — rewritten: (web)
      `crew-vehicles.spec.ts` «its «إضافية» tag sits UNDER the code, never beside it — the column
      keeps its width at 1440» → «… — on the code’s second line, with the row’s «⇄» (Round 32 C) —
      …» (the same rule; the tag now shares its line with «⇄»). New: (web) `lib/crew-swap.spec.ts`
      — what a card offers, the quick picks, the three ways, swap and move per person and per field,
      a value replaced, the slot paths, every rule's refusal (held seat, away, unknown person,
      capacity, capacity after the move, a kept person's seat taken back, an archived type), a row
      without a van, the draft replaced in place, ONE step of «تراجع», «حفظ (2)», ticks that follow
      the rows; `components/crew-swap-dialog.spec.tsx` — the window as drawn (the boxes and their
      names, the drivers, the second van's list, no preview before it, the cards' order, the radio
      group and its arrows in both languages, the preview's arrivals, struck values, what goes and
      what stays with its reason, the receiving card), the board's wiring (only where it may be
      planned, the «⇄» on the code's line and never beside the bin, one operation of «تراجع»), and
      every word in both languages.
    - Round 32 critic (the build's, never the owner's):
      - A, after the pick: a car picked by its plate landed on its row as the bare «0» — on the van's
        cell, its card, the van filter, Excel, «تراجع»'s words and the swap window — the owner's
        zeros back on the board. Every board row (and «الطاقم الثابت»'s) now carries `uncoded` from
        the server (`OperationsCrewBoardRowDto`, `OperationsStandingCrewRowDto`; one Fleet read,
        `namesByIds`), and the board names the van by its plate with «بلا كود» (`vanName`) wherever it
        draws or says it — the plate wraps between its letters and its digits, so the van column keeps
        its width at 1366, 1440 and 1920 (measured: 66px at 1440, the bins inside the frame; on one
        line it ran them 29px out), the row a line taller. A van freed in the draft keeps its plate on
        both lists (it came back a bare «0000» in «باقي السيارات»); two uncoded cars are ordered by
        their PLATE, as the lists said,
        not by their count of zeros (`compareVehiclesForPicker`); a roster van with no code keeps its
        drivers under its plate. «توزيع المحصنات» and the screens after it still show Fleet's code.
      - B: midnight under an open slot list or «بدون سيارة» list wrote into the hidden draft (and said
        «work not saved» again): every change to the draft now passes `canPlan` (`apply`), and the
        lists and a picked-up chip shut with the day.
      - C: an archived type in an exchange was lost from both rows (the other row's type took its
        place, its own was dropped): the exchange is now off both ways, each row named why
        («نوع 213 مؤرشف ويبقى عليها — فلا يُبادَل النوعان»). A field ticked on one card in «تبديل
        المحدد ⇄» threw the other row's value away; it is now exchanged. Ctrl+Z inside the window
        took back the board's last operation behind it; it does nothing while any window is open
        (`isBoardUndoKey`). After a swap, «الطاقم الثابت» off emptied the row that now held the
        other van's people; the swap now lets go of the two rows (`applySwapToDraft`). A one-way move
        is said as one («نقل المحدد من 213 إلى 255»). The arrow keys follow the language (`modeStepOf`).
        The preview's notes start their own line. Each card says how many محصنات ride its row
        (`shipments` on `OperationsCrewBoardCrewDto`, one count for the day), and the preview warns
        when its captains or its direction change: «تبقى على 213 المحصنات الموزَّعة عليها (6)، وقد
        وُزِّعت قبل تغيير القائد أو الاتجاه. راجِعها في «توزيع المحصنات» بعد الحفظ».
      - Specs rewritten (each pinned the defect): (api) `operations-crew-round32.spec.ts` «lists the
        cars by code NATURALLY, the uncoded LAST by their plate …» and «الطاقم الثابت … the uncoded
        last» — `['00', '0']` by plate (they pinned `['0', '00']`); (web) `crew-round32.spec.tsx` the
        two lists' uncoded order, the same; `lib/crew-swap.spec.ts` «a field ticked on BOTH cards is
        exchanged; ticked on one, it moves …» → «a field is ONE exchange …» and «a type archived since
        the row took it stays on its row; an active one moves» → «… in an exchange the other row
        keeps its own too»; `crew-swap-dialog.spec.tsx` the ticked count (the pair's tick) and «the
        preview … the value a moved field replaces (struck)» → «… the fields exchanged — nothing
        thrown away» (the struck value is a one-way move's, its own case), and the page's wiring →
        `applySwapToDraft` / `swapOperation`; `crew-undo.spec.ts` «Ctrl+Z / ⌘Z does the same outside
        a text box» → through `isBoardUndoKey`; `crew-vehicles.spec.ts` the «إضافية» line (with
        «بلا كود») and «إزالة»'s words (`vanName`). New: (contracts) `compareVehiclesForPicker`; (api)
        the rows' `uncoded`, a crew row's `shipments` (live legs only); (web) the van named by its
        plate through pick, reload, card, filter, Excel and «إزالة», «الطاقم الثابت»'s rows, the freed
        vans, the roster van's drivers, midnight's one gate, `isBoardUndoKey`, the exchange and the
        archived pair, `applySwapToDraft`, `swapOperation`, `modeStepOf`, `shipmentsLeftBehind`, the
        window's pair tick, the shipments note and the notes' line.
  - Round 33 — «تسليم المحصنات» على يوم مضى، وشاشة «الشحنات المسلَّمة». The owner: «انا عاوزك تفتحلى
    الايام اللى فاتت فى تسليم المحصنات ك روية فقط زى ما عملنا فى شاشة توزيع المحصنات
    وعاوز اعمل شاشة جديدة زى شاشةاليوم التشغيلى بس يظهر بس اللى اتسلمت سواء يومى او كانت محصنة ف
    الخونة واسلمت ل بنك هتظهرلى لما تكون تم التسليم بس الاجراءات هيكون فيه علامة صح
    لما ادوس عليها لازم يكون فيه رقم الايصال ويفضل الصورة تكون مرفوعه و يحدد البنك من او الى اللى
    هيتحسب عليه تكلفة نقل الشحنة». His answers: on the day board's ✓ (it completes a shipment with no
    receipt number) — «الشاشة الجديدة حاجاتها لوحدها»; on the receipt photo at ✓ — «اختيارية مع
    تنبيه».
    - A — «انا عاوزك تفتحلى الايام اللى فاتت فى تسليم المحصنات ك روية فقط زى ما عملنا فى شاشة توزيع
      المحصنات». «تسليم المحصنات» (`VaultHandoverPage`, `/operations/vault/handover`) opens a past
      day as that day's RECORD, view only, as «توزيع المحصنات» became in Round 30.
      - «يوم التسليم» takes a past day (it had a floor at today, and a past `?date=` opened on today —
        `readDistributionDate`, gone: the screen reads its day as the distribution does,
        `readDistributionDay`). Today stays the default; a later day is still the plan, to read and
        print, its «تسليم» off as before.
      - The record is the distribution's (`lib/secured-distribution.ts` `isRecordScreen`): the
        URL's day before the read is in, then the SERVER's `past` (a PC clock running ahead never
        turns today into a record), plus midnight passing on a screen left open — yesterday's read
        turns into yesterday's record. Every act asks ONE gate,
        `canHandOver = mayHandOver && !isRecord`: no «تسليم» on any van (not even a disabled one), no
        confirmation (one left open at midnight shuts with the day), nothing sent. In the hint's place the calm notice «سجل يوم …
        — للعرض فقط، لا يمكن التعديل» and what it shows; where the acts would stand, «سجل · للعرض
        فقط» and «العودة إلى اليوم». No drag or menu (the screen had none). The van filters, the
        hover cards and «طباعة» still work.
      - What it shows: each van of the day with what rode it, and what became of each محصنة as the
        vault reads it back — «سلّمتها الخزينة» (it left the vault: out for delivery, or delivered
        since; when, on the Cairo clock, and who pressed «تسليم»), «بقيت بالخزينة ولم تُسلَّم», or
        «لم تستلمها الخزينة» — on its chip and on its card (`recordHandoverState`). Under each van:
        «سُلِّمت محصنتان · سلّمها … · 10:15» and how many on it were not handed over
        (`vanHandoverRecord`, `handoverWhen` — the day too when the release was on another). The top
        figure «جاهزة للتسليم» becomes «سُلِّمت»; the packages are the read's own (`recordPackages`,
        a van that went out keeps its counts). Drawn calmly: no rose on «بلا سيارة» or its figure, no
        placing alarm on a van (`calm`); the left column says «لم تُوزَّع على سيارة في ذلك اليوم».
      - «طباعة» on a record prints the van's sheet and says it is one: «سجل يوم … — للاطلاع فقط، ولا
        يُسلَّم منه شيء» in the day's place, and «التسليم: …» (who, how many, when) after the crew
        (`lib/van-load-sheet.ts` `record`).
      - The server. The read already answered a past day as its record, for the vault's grant too
        (`GET /operations/secured/distribution?date=`, `operationsShipment.view` or
        `operationsVault.view` — Round 30). It now says, on a record and to a reader of the vault
        only, what was handed over, when and by whom — `recordHandovers` (contracts
        `OperationsSecuredDistributionHandoverDto`: `shipmentId`, `handedOverAt`,
        `handedOverByName`), read from the custody's release (`releasedAt`, and `releasedById` — the
        token's user of the dispatch, now on `VaultCustodyView`), named by the directory (one read
        for the day, `userDisplayNames`); null on today, on a later day and without the vault's
        grant. «تسليم» on a past day's van stays refused, before any shipment is read:
        `POST /operations/secured/dispatch` → 422 `OPERATIONS_DISPATCH_NOT_TODAY` (Round 17
        `assertTodaysVan`, its tests «refuses a van of a PASSED day the same way — that van has
        left» and Round 30's «keeps «تسليم» off the record’s vans too — they have left»). A future
        day keeps its rule (read as the plan, «تسليم» refused). No new permission, page or
        collection.
      - Specs rewritten: (web) `lib/secured-distribution.spec.ts` «the day «تسليم المحصنات» opens on»
        — «reads a real day from today on, else today (the server’s default)» → «reads ANY real day
        — from today on as before — else today …», «never a past day on the vault’s screen — a past
        day’s vans have left» → «a past day on the vault’s screen too — as its record, view only
        (Round 33)», «never a malformed one …» on the shared reader; `pages/secured-distribution.spec.tsx`
        «yesterday’s read left open past Cairo midnight: «تسليم» is off, the load in the vault
        notwithstanding» → «… turns into yesterday’s record: no «تسليم» at all …» (the case it drew —
        a read just in, the server's day behind the PC's — kept as its own: «a read just in whose
        server day is behind this PC’s clock: not a record — «تسليم» stays off by the live day»),
        «shuts every act through ONE gate …» (its pins of the vault's floor, `min={minDay}` and
        `readDistributionDate`, now pin none), «the vault hands over through the existing dispatch
        …» (the two gates now `day === today && !isRecord` and `canHandOver`). New: (api, run whole)
        `operations-distribution.spec.ts` «Round 33 — «تسليم المحصنات» on a PAST day …» — the record
        on the vault's own grant (its van, every status, who handed over and when — a treasurer
        named apart from the admin who placed), withheld from a desk reader and null on today and a
        day to come, every «تسليم» of the record refused with nothing released; (web) the page's
        Round 33 block (the notice, no write control, the marks, the van lines, the figures and
        packages, calm, before the read, a reader without the dispatch grant, every word in both
        languages, the one gate), `recordHandovers`, `recordHandoverState`, `vanHandoverRecord`,
        `handoverWhen`, the record's sheet.
    - B — «وعاوز اعمل شاشة جديدة زى شاشةاليوم التشغيلى بس يظهر بس اللى اتسلمت سواء يومى او كانت محصنة
      ف الخونة واسلمت ل بنك هتظهرلى لما تكون تم التسليم بس الاجراءات هيكون فيه علامة صح لما ادوس عليها
      لازم يكون فيه رقم الايصال ويفضل الصورة تكون مرفوعه و يحدد البنك من او الى اللى هيتحسب عليه تكلفة
      نقل الشحنة». A new screen, «الشحنات المسلَّمة» («Delivered shipments»,
      `/operations/shipments/delivered`), a sidebar row and a home card right beneath «اليوم التشغيلي», on
      the day board's own read grant (`operationsShipment.view`). No new permission, page or collection.
      - Which rows: what REACHED ITS BANK on one Cairo day — the day board's own «تم التسليم», its crew
        captain's delivery to the destination in the app (`captainDeliveredAt`, the pickup leg of a
        daily shipment, the delivery leg of a محصنة), and for a محصنة only once it has left the vault
        (`dispatched` or `completed` — one in the vault, out and not delivered yet, or delivered into
        the vault by its pickup leg is not listed). One rule in the contract
        (`isOperationsShipmentDeliveredToBank`); the leg is read the one way every board reads it
        (`legDeliveredAt`, apps/api `shipments/delivered.ts`, which `boardView` now uses too). The day
        is the Cairo day of the delivery, cut at Cairo midnight; oldest delivery first.
      - The screen is «اليوم التشغيلي»'s board (`ShipmentsBoard`, new `kind="delivered"`): the same
        figures, the same filters on one row (van, bank, from, to, area, captain, type) with «حالة
        التأكيد» — «بانتظار التأكيد» / «مؤكَّدة» / «الكل» — in «التسليم»'s place, and «يوم التسليم» (today
        by default, any day before it; never a later one — `readDeliveredDay`). A row awaiting its ✓ is
        the day board's yellow «تم التسليم» with the time the captain delivered it; a confirmed one is
        green, «مؤكَّدة», with «إيصال رقم …», «تُحتسب على البنك (من / إلى)», and «بدون صورة» while it has no
        receipt photo («اختيارية مع تنبيه»). «صورة الإيصال» is the day board's own column; «السجل» stays;
        no «إضافة شحنة», no day board ✓, no edit or delete on this screen.
      - The ✓ (for `operationsShipment.complete`, the day board's ✓ grant) opens «تأكيد التسليم», in the
        boards' dialog design (Tab kept inside — the swap window's trap, moved to
        `components/use-focus-trap.ts` and shared; Escape closes): «رقم الإيصال» required (trimmed, at
        most 40 characters — `deliveryReceiptNumberProblem`, the same rule on the server); «صورة
        الإيصال» optional — the photo there is shown, a new one is picked and goes up through the day
        board's own upload right after the confirmation; without one the dialog warns that the row will
        keep «بدون صورة»; «البنك الذي تُحتسب عليه تكلفة النقل» — exactly two, «من» (the origin branch's
        bank) and «إلى» (the destination's), each by bank and branch, with a note when both are one
        bank (the side is still recorded). «إلغاء التأكيد» on a confirmed row, asked first. A refusal
        that says the row moved (not delivered, confirmed by a colleague, a stale version) re-reads the
        screen and closes the dialog onto it; a box the server names is marked.
      - Its own record («الشاشة الجديدة حاجاتها لوحدها»): `deliveryConfirmation` on the shipment —
        `receiptNumber`, `billedSide` (`origin` / `destination`), `billedBranchId`, `billedBankId`,
        `confirmedById`, `confirmedAt`; absent or null = not confirmed, no migration. The bank billed is
        the SERVER's — the bank of the branch on the side chosen, read at the ✓ — and who confirmed is
        the token's user; the client sends neither (a body naming a bank or a person is refused, 400).
        Writing it moves NOTHING else: not `status`, not the day board's ✓ (`receivedById` /
        `receivedAt`), not `mainBankId`, `secondaryBankId`, `receiptNumber` or `vaultReceiptNumber`.
        The day board's ✓ and its undo work as before, beside it.
      - API: `GET /operations/shipments/delivered?date=YYYY-MM-DD` (`operationsShipment.view`; today in
        Cairo by default) → `{date, today, shipments, crews}` (`today` the server's — Round 33
        critic), the day board's rows (`boardForReader`) with `deliveryConfirmation` (bank and person
        by name); `POST` / `DELETE` on
        `/operations/shipments/:id/delivery-confirmation` (`operationsShipment.complete`)
        `{receiptNumber, billedSide, version}` / `{version}` →
        `{shipmentId, version, deliveryConfirmation}`. Refused:
        404 deleted or unknown; 422 `OPERATIONS_DELIVERY_RECEIPT_NUMBER_REQUIRED` /
        `OPERATIONS_DELIVERY_RECEIPT_NUMBER_TOO_LONG` (detail `receiptNumber`, `REQUIRED` /
        `MAX_LENGTH`), `OPERATIONS_DELIVERY_BILLED_SIDE_REQUIRED` (detail `billedSide`); 409
        `OPERATIONS_SHIPMENT_NOT_DELIVERED`, `OPERATIONS_DELIVERY_ALREADY_CONFIRMED`,
        `OPERATIONS_DELIVERY_NOT_CONFIRMED` (the undo), `STALE_DOCUMENT`. Audited on the shipment;
        «السجل» shows «أُكِّد التسليم بالإيصال» / «أُلغي تأكيد التسليم بالإيصال» (kinds `deliveryConfirmed`
        / `deliveryUnconfirmed`, fields `deliveryReceiptNumber`, `billedBank`); events
        `operations.shipment.deliveryConfirmed` / `.deliveryUnconfirmed`. The screen's read lives
        under the day board's cache key, so every act that moves the board, and the shipments'
        realtime topics, move it. One leg index for the day's read (`ix_delivered_at_live`).
      - The receipt photo's lock (Round 10), opened ONCE: a محصنة the vault has received stays locked,
        EXCEPT that one which has reached its bank and has NO photo may take its FIRST one — the bank's
        receipt, which exists only after the delivery (`isOperationsReceiptPhotoAddable`, on the
        server's upload, the platform's file authorizer and the board's photo cell alike). A photo
        already there is never replaced or deleted on a locked row; a محصنة in the vault, or out and
        not delivered, is locked as before.
      - Specs rewritten (the board's new kind, the rules unchanged): (web) `lib/day-board.spec.ts`
        «names them in the table’s column order» and «reads every filter from its param» (the new
        `confirmed` param); `pages/shipment-screens.spec.ts` ««عاوز عادى يعدل و يحذف» …» (the photo
        follows `canManageReceipts`, `canEditRows` by default), ««هنزود التاريخ التسليم …»»
        (`const secured = kind === 'secured' || kind === 'vault'`), ««والحالة …»» (a page's `statusCell`
        first); `pages/day-board-filters.spec.ts` «draws the vault’s two status boxes …» (the
        confirmation box in the chain); `operations-navigation.spec.ts` (nineteen pages); (api)
        `seed-navigation-operations.spec.ts` and `operations-navigation.spec.ts` (the new row in the
        lists), `seed-navigation.spec.ts` «declares the row count …» and `auth-seed-login.spec.ts`
        `SEEDED_APPLICATIONS` (139 → 140). New: (contracts) `operations-delivered.spec.ts`; (api, run whole)
        `tests/integration/operations-delivered.spec.ts` — only what reached its bank (daily delivered,
        محصنة out of the vault delivered; not undelivered, in the vault, out not delivered, delivered
        into the vault, deleted), Cairo midnight both sides, today by default, the grants, the ✓ with
        the origin's and the destination's bank and the token's user, nothing else on the shipment
        changed, the log and the events, every refusal above, the undo, the day board's ✓ beside it,
        the first photo of a delivered محصنة; (api unit) `shipment-log.spec.ts` «prints the delivery
        confirmed with its receipt, and its undo, as their own kinds»; (web) `lib/delivered-board.spec.ts`,
        `pages/delivered-shipments.spec.tsx` (the board, the day box, the filter, both row states and
        «بدون صورة», the ✓ and undo by grant, no other act, the photo, the dialog's fields, sides and
        warning, focus and Escape, both languages), the i18n keys; the persistence census
        (`shared/lib/remembered-filters-coverage.spec.ts`) classifies the new page COVERED, its filters
        remembered as the day board's and `date` not (it opens on today).
      - Verified on the real stack (the live API, the captains' «تم التسليم» driven in the app). One
        fix: a refused «إلغاء التأكيد» (a colleague had taken it back, 409) was said twice, the same
        sentence from the global notifier and from the row; it is said once now, the global
        notifier's (`DeliveredRowAction`). New spec: `pages/delivered-shipments.spec.tsx` «says a
        refused «إلغاء التأكيد» ONCE — the global notifier’s, no toast of its own».
      - Round 33 critic (the build's, never the owner's):
        - A confirmed delivery keeps the two branches it was billed between. The ✓ records the bank of
          «من فرع» or «إلى فرع»; an edit that moved either one afterwards (the day board's form, or the
          history's on a past row) left the record naming a branch the shipment no longer had. Now
          `PATCH /operations/shipments/:id` refuses moving either branch while `deliveryConfirmation`
          stands — 409 `OPERATIONS_DELIVERY_CONFIRMED_BRANCH_LOCKED`, nothing written, in both
          languages on the form: «ألغِ التأكيد في «الشحنات المسلَّمة» أولًا، ثم غيِّر «من فرع» أو «إلى
          فرع»». A branch sent back unchanged is no move; every other field (the billed main bank, the
          secondary bank, the lines, the dates, the notes) edits as before — the record reads none of
          them. One rule for both doors of the edit (`prepareEdit`, `assertConfirmedBranchesKept`).
        - «Today» is the SERVER's. The screen named the desk PC's Cairo day in every request and
          bounded «يوم التسليم» by it: a PC a day ahead opened on an empty tomorrow, one a day behind
          could not reach the server's today at all. The default read now names no day and the read
          says the server's Cairo `today` (`OperationsDeliveredBoardDto.today`, read once with the day
          answered); the box's latest day and the day a `?date=` may name are bounded by it
          (`readDeliveredDay` → the day asked, or null for the default). The PC's clock only says when
          to ask again: the default read is keyed by it, so a screen left open re-reads at midnight.
        - Midnight no longer throws away an open ✓. While the screen read the new day, the dialog's row
          was missing and the dialog vanished with the number typed, the side chosen and the photo
          picked. The dialog now stays on the row it was opened on while the screen reads another day,
          or is still reading (`deliveredDialogRow`); on its own day's read it follows its row as
          before. The day moving on is said once: «بدأ يوم جديد — انتقلت الشاشة إلى تسليمات اليوم.
          تسليمات يوم … تجدها باختياره في «يوم التسليم»» (`defaultDayLeft`).
        - A colleague deleted the shipment under an open ✓: the 404 closed the dialog but nothing
          re-read the screen, so the row stayed yellow, offering a ✓ refused every time. A 404 is now
          one of the refusals that re-read it (`isDeliveryConflict`).
        - Screen readers and keyboards: «إلغاء التأكيد» no longer carries `aria-pressed` (it was
          announced "undo, pressed" — the day board's own warning on its ✓); «من» / «إلى» are one Tab
          stop, and the arrows move and choose inside the group in the reading direction, down on a
          phone (`billedSideTabStop`, `billedSideAfterKey`, `modeStepOf` — the swap window's three ways).
        - The undo's toast said twice was the verifier's fix, above.
        - Specs rewritten (the rule changed): (web) `lib/delivered-board.spec.ts` «is today by default,
          any real day before it when asked, never a later one» → «asks a real day before today by
          name, else NO day — the server’s own today»; `pages/delivered-shipments.spec.tsx` «lives under
          the day board’s key …» (the key's `null` default beside the PC's clock day). New: (api, run
          whole) `operations-delivered.spec.ts` «says ITS OWN Cairo today beside the day answered …» and
          «Round 33 critic — a confirmed delivery keeps the two branches it was billed between» (each
          branch refused with nothing written and no «السجل» row, the unchanged branches and the other
          fields edited, undo → edit → ✓ on the new branch's bank); (web) the server's today against a
          PC a day ahead and a day behind, the dialog past midnight, the day-moved notice, the 404
          re-read, the undo's name, the one Tab stop, `defaultDayLeft`, `deliveredDialogRow`,
          `billedSideTabStop`, `billedSideAfterKey`; `shared/lib/errors.spec.ts` the branch lock's words;
          the i18n keys.
    - C — the owner's review of the screenshots: «عاوز رثم الايصال فى عمود لوحده
      عاوز كلمة طباعة دى تكون العلامة بس وممكن تحطها فى مكان فى الكارد عشان متخدش مساحة كبيره».
      - «رقم الإيصال» in a column of its own on «الشحنات المسلَّمة», just before «صورة الإيصال» so a
        receipt's number and its photo sit together: the number the ✓ recorded, in the board's figures
        (digits typed on an Arabic keyboard read Latin) and in its own direction — «RC-20418» and
        «77310» left to right, a number typed with Arabic words («إيصال ١٢٣٤٥») in their order — or «—»
        on a row still awaiting its ✓. A number of up to 12 characters is one line, never broken; a longer one (up to the 40
        the ✓ takes) wraps inside 7rem, every character on screen. «الحالة» no longer says «إيصال رقم
        …» — «مؤكَّدة», «تُحتسب على …» and «بدون صورة» stay. The day board, the history, the secured
        and the vault screens keep their columns exactly.
      - Its box, «رقم الإيصال» («Receipt no.»), after «ملاحظات» as the column stands — `receipt` in
        the address (a reload and a shared link keep it), cleared by the reset, and NOT remembered
        across visits as the screen's other boxes are: it looks one receipt up, and a number brought
        back from last week would open today's screen with every row awaiting its ✓ hidden (none has
        a number yet) — `BOARD_LOOKUP_PARAMS`, `rememberedFilterParams`. A fragment of the
        number finds it, folded (Arabic-Indic digits, Latin case) with its separators ignored: «rc
        20418» and «٢٠٤١٨» find «RC-20418»; a row awaiting its ✓ has no number to find. No other board
        offers or reads it. The screen has no Excel or print of its rows, so none was added.
      - The room for a fourteenth column, measured on the built screen (stubbed API, dark and light):
        the delivered board takes the vault board's (Round 17) — names wrap from 4rem, a note is cut at
        4rem, the cells' sides 7px below 1750px — and the number's cell gives up its sides as the icon
        boxes do. At 1366, 1440 and 1920: no sideways scroll on the page, the table inside its frame,
        the ✓ column whole, with a note on a row too (at 1366 the table scrolled 2px sideways before,
        32px with a note). A day with a 40-character number and a note still scrolls the table 44px
        at 1366 (234px before, the number then a line of «الحالة»), and fits from 1440. The filter row
        stays one row; there the van's box takes a fifth more than an even share — the room its
        suggestions' arrow took from «كود السيارة» once the row was cut in eleven — and the other
        boxes share the row by the longer of their two names (`data-bar-box`, this screen's alone):
        «من فرع» 1.16, the captain 1.19, the receipt's number 1.07, «إلى فرع» 1, the bank 0.9, the
        notes 0.87, the area 0.8 — seven together as seven even shares, so «النوع» and «حالة التأكيد»
        keep theirs. Every box's name is whole in Arabic at 1280, 1366, 1440 and 1920, and in English
        but for one (before: «From branch» and «Crew captain» cut at 1280–1440, «Receipt no.» at 1280,
        «رقم الإيصال» by 1px at 1280): the English «Vehicle code» still loses its last letter or two
        under the browser's suggestions arrow at 1280 and 1440 (whole at 1366 and 1920), as it did
        before this round. With a filter chosen the reset takes its room at the row's end: from
        1366 every name stays whole; at 1280 three Arabic names are cut by 3px («اسم البنك»,
        «المنطقة», «ملاحظات» — before, «قائد الطاقم» and «رقم الإيصال» by 3–5px) and five English ones
        by 1–4px (as before). A type and a confirmation both chosen were already cut short in their
        boxes at 1440 and are cut a little more. At 390 the screen behaves as before: the page still, the table scrolling inside its
        frame, the filters two to a row (six rows now, five before).
      - Specs rewritten (the rule changed): (web) `lib/day-board.spec.ts` «names them in the table’s
        column order» → «… — «رقم الإيصال» last» and «reads every filter from its param» → «… —
        «رقم الإيصال» too»; `lib/delivered-board.spec.ts` «is read from the URL, and only that board
        offers it» → «… — ten boxes, «رقم الإيصال» last»; `pages/day-board-filters.spec.ts` «sizes each
        text filter with a wrapper, since the control base class is w-full» → «sizes each text filter
        with a wrapper — «رقم الإيصال» too — since the control base class is w-full» (eight typed
        boxes) and «is the order of the columns themselves» → «… — «رقم الإيصال» before «صورة
        الإيصال»»; `pages/shipment-screens.spec.ts` «makes the room for one-line badges on the vault’s
        board alone» → «makes the room for one-line badges on the vault’s board, and for «رقم الإيصال»
        on the delivered one». New: (web) `pages/delivered-shipments.spec.tsx` «Round 33 C …» (the
        column's name in both languages and its place, the number and the dash, a long number,
        «الحالة» without it, absent from the other four screens, the box and what it finds);
        `lib/delivered-board.spec.ts` the number, `matchesReceiptNumber`, the board narrowed by it,
        and «is read and offered, never remembered across visits — a lookup, not a standing slice»;
        `pages/day-board-filters.spec.ts` the box last on that screen alone, the van box's share,
        «shares «الشحنات المسلَّمة»’s one row by the boxes’ words — the total as the even share’s», and
        «remembers «الشحنات المسلَّمة»’s boxes — never «رقم الإيصال», a one-off lookup, nor its day»;
        `pages/delivered-shipments.spec.tsx` «lets a number typed in Arabic words keep their order —
        the cell takes its first letter’s direction». The i18n key `operations.delivered.receiptNo` now names
        the column and the box («رقم الإيصال»; it was the status line's «إيصال رقم»).
      - «طباعة» on «تسليم المحصنات» is its icon alone (the same document drawing), at the END of each
        van's head line, after the direction — a 24px square in the brand tint its word wore, named
        «طباعة» («Print») to a screen reader, saying on hover what it prints («طباعة كشف تحميل السيارة
        112»), the board's focus ring; `data-handover-print` kept. It prints exactly what it printed
        (`print`, `lib/van-load-sheet.ts` unchanged), a record's sheet on a record. A press on it —
        click, tap, Enter or Space — only prints: the van's card neither opens nor closes (the van's
        group asks `vanTapAllowed` with `onAct`), and resting on it is not resting on the head (the
        van's card waits no beat there, as on the captain's own name — `vanRestArms`); both rules
        pure, in `lib/van-card.ts`. `VanCard` takes it as a new `headAction`; «توزيع المحصنات» gives
        none and is unchanged.
      - The row over the van is «تسليم»'s alone: on a record, and for a reader without
        `operationsVault.dispatch`, there is no row at all (no empty strip) — each card 51px shorter
        (47.5px at 390), the vans' column 153px shorter at 1366 and 1440 on the stubbed record day
        (102px at 1920, 380px at 390). Today the row and the cards keep their height; «تسليم» on and
        off are one height now (the filled one keeps a clear 1px edge), so every head lines up. The
        head stays one line at 1366, 1440, 1920 and 390, dark and light; the code and the time are
        never cut; the page never scrolls sideways at 390. The icon's 30px no longer come out of the
        direction alone: a head that carries the icon measures its line (a size container,
        `HEAD_SQUEEZE`), and at 18rem of line or less — on a 1024, 1366, 1440 or 1920 screen and a
        phone; not at 1280, whose cards are wider — the time drops its clock (its «11:00» says what it is) and a crew
        without a van drops its crossed-van drawing (its words say it), 16px and 22px back; the
        direction is cut no shorter than its arrow and 28px of words (a shorter direction keeps its
        own width, never padded). At 1366 a crew without a van now shows «حلوان» whole in Arabic and
        in English (9px of it and 3px before this fix, 30px before the icon); «المعادي - حلوان» shows
        73 of its 78px (57 before this fix); the long «السادس من أكتوبر…» 73px (57). At 1024 the same
        (30/30, 71/78). Measured at every width from 360 to 1920 (8px apart, English, the widest
        pill): «حلوان» whole, the line one line, no pill out of its line, the page still. With a
        two-digit «No vehicle (12)» and a long direction at 1024 and 1366, 31–32px of the direction
        show. «توزيع المحصنات»'s head carries no icon and none of this. The day bar's hint says where «طباعة» is («فوق كل سيارة «تسليم»، وفي نهاية رأسها أيقونة الطباعة
        …»); to a reader without `operationsVault.dispatch`, whose vans have no «تسليم» and no row
        over them, it says only «في نهاية رأس كل سيارة أيقونة الطباعة …» (the verifier's fix: it told
        him «تسليم» was over each van).
      - Specs rewritten (the rule changed): (web) `pages/secured-distribution.spec.tsx` «is the same
        card on «تسليم المحصنات», under «تسليم» and «طباعة»» → «… under «تسليم», with «طباعة» at its
        head line’s end», and «puts «تسليم» and «طباعة» over each van; «تسليم» counts only what the
        vault holds» → «puts «تسليم» over each van and «طباعة» in its head; …». New: (web)
        `pages/secured-distribution.spec.tsx` «Round 33 C» (the icon's name, tooltip, hook and no word
        on the card, today, on a record and for a reader; its place at the head line's end; the line
        squeezed on a narrow card; the one `print` of the van and its load; a press on it toggling
        no van card and resting on it not the head's — `vanTapAllowed`'s `onAct`, `vanRestArms`; the
        row over the van for «تسليم» alone, none on a record or for a reader without the grant, kept
        on a day to come; the day's hint, «تسليم» over each van only to who has the grant; «توزيع
        المحصنات»'s card unchanged); `components/distribution-van-card.spec.tsx` «Round 33 C»
        (`headAction` at the line's end in both languages; «with an act, the line squeezes on a
        narrow card — the clock and the no-van drawing go, the direction keeps a floor»; no row for
        an absent, null or false `actions`; the card without them as it was); `lib/van-card.spec.ts`
        «Round 33 C — the head’s own act is its own». Rewritten (the rule changed):
        `components/distribution-round26.spec.tsx` «never opens while a drag is on, over an open
        «نقل إلى…» menu, or on the captain’s own name» → «… — nor on the head’s own act» (the tap
        path asks `onAct` too). New i18n keys `operations.handover.printTitle` and `operations.handover.hintViewer`;
        `operations.handover.hint` rewritten.
      - Verified on the live API (mongodb-memory-server) serving the built web: a ✓ through the
        dialog puts its number in «رقم الإيصال» and nowhere else on the page, digits typed in
        Arabic read Latin, undo brings the «—» back; the box finds «rc 204» and «٧٧٣», survives a
        reload, and the reset clears it (it also came back on a fresh visit then — no longer, see
        the critic's review below). The icon prints today's sheet and the
        record's (the record's sheet byte-identical to HEAD's word button's), by click, Enter,
        Space and a phone's tap, and opens no van card; «تسليم» still hands over today. The day
        board, the history, the secured and the vault boards draw the same columns and boxes as
        HEAD's build, and «توزيع المحصنات» the same van heads.
      - The critic's review, seven findings, each fixed with a spec that fails on the code before
        it (each fix reverted once and its spec seen red): (1) the direction starved by the icon on
        a narrow card — the head's squeeze above; (2) the English bar names cut — the shares by
        their words above; (3) the day's hint naming «تسليم» to a reader without the grant — the
        verifier's fix, its spec re-run red without it; (4) a number typed with Arabic words drawn
        backwards — the cell's direction is its own (`dir="auto"`); (5) «رقم الإيصال» remembered —
        read, never remembered; (6) the print's «only prints» pinned by source regexes and class
        strings — the rules are pure (`vanTapAllowed`'s `onAct`, `vanRestArms`) and tested in
        `lib/van-card.spec.ts`, the card asks them instead of stopping the click, and the round's
        markup specs read hooks and order (`data-van-head-action` after `data-van-direction`), not
        whole class strings; (7) the print change labelled «Round 33b» in code, specs and i18n while
        this entry is «C» — every label is «Round 33 C» now.
  - Round 34 — أسهم «تبديل بين سيارتين» على «لوحة التشغيلة»، و«البيانات المرجعية». The owner, by
    voice: «عاوز في السواب بتاع العربيتين في الشاشة بتاعت لوحة التشغيلة. السواب عايز يكون أسهم اللي
    أنا ببدل ما بينهم وبين عربيتين، اللي هو السهم الشمال أو السهم اليمين أو السهمين اللي تحت بعض،
    يكون السهمين اليمين والشمال نفس اللون والسهم اللي في النص لون مختلف. وعاوز أغير اللي اوت بتاع
    بيانات المراجعة يكون بروفيشنال أكتر من كده، وعاوز الداتا اللي تبقى كبيرة زي الفروع والمناطق
    والبنوك وهكذا يكون في سيرش اقدر اسيرش بيه.» («بيانات المراجعة» is the dictation of «البيانات
    المرجعية», `/operations/catalogs`.)
    - A — «السواب عايز يكون أسهم … السهم الشمال أو السهم اليمين أو السهمين اللي تحت بعض، يكون
      السهمين اليمين والشمال نفس اللون والسهم اللي في النص لون مختلف». The three ways between the
      two cards of «تبديل بين سيارتين» (`CrewSwapDialog`, Round 32 C) are ARROW buttons now (new
      `components/crew-swap-arrows.tsx`), their word labels and short lines gone: a one-way move is
      ONE arrow from the card that sends to the card that receives; the swap is the TWO arrows one
      under the other (⇄).
      - Where they point, in every layout (`swapArrowAim`, `swapArrowTurn`). Side by side (lg —
        measured at 1024, 1366 and 1440) the first card is on the RIGHT in Arabic, so «من 213 إلى
        255» points LEFT and «من 255 إلى 213» RIGHT, the swap's top arrow pointing as the one above
        it and its bottom one as the one below; in English all of it mirrored (the first card on
        the left). Stacked (390 and 768 — the cards one above the other, the three in a row between
        them) the single arrows point DOWN and UP, toward the card below or above, and the swap
        stands ⇅. Each glyph is drawn once and turned by CSS per layout.
      - The colours: the two single arrows share one hue, sky — off a soft `sky-50` fill, a
        `sky-300` border and a `sky-700` glyph (dark: `sky-400/10`, `sky-400/45`, `sky-300`), on a
        solid `sky-600` (#0284c7) with a white glyph (4.1:1), a `sky-500/70` ring and its shadow;
        the swap, the default way, the brand's indigo — off `brand-50`/`brand-300`/`brand-700`
        (dark `brand-400/10`, `brand-200`), on `brand-600` #4f46e5 (6.3:1; dark `brand-500`
        #6366f1, 4.47:1). Both apart from the preview's emerald «من 213» and rose «يبقى». The
        keyboard's focus is a neutral outline outside the ring (`slate-900`, dark white); without a
        second van the three are there at 40% and none can be pressed.
      - The words: each arrow's name and tooltip say what it does with both vans —
        «نقل المحدد من 213 إلى 255», «تبديل المحدد بين 213 و255 في الاتجاهين», «نقل المحدد من 255
        إلى 213» («Move selected from 213 to 255», «Swap selected between 213 and 255, both
        ways»); the group keeps «طريقة نقل المحدد». No caption under the arrows: each card's head
        names its van right beside them, a single arrow at once marks the receiving card «تستقبل»
        and dims its boxes, and the preview under them redraws.
      - Kept as it was: the radio group, one way in the Tab order, the arrow keys in the reading
        direction (`modeStepOf`), `data-swap-modes`/`data-swap-mode`, the swap as the default, what
        each way does (`lib/crew-swap.ts` untouched), «تطبيق» and the preview. The buttons are
        64×48 in the row and 56×48 in the column; the column went from 144px to 56px, the cards
        took the room.
      - i18n: `operations.crewPlan.swap.mode.{aToB,bToA,swap}` rewritten to name both vans;
        `mode.{aToB,bToA,swap}Short` and `mode.{aToB,bToA,swap}Hint` removed (nothing drew them
        any more).
      - Specs. Rewritten (the rule changed): `components/crew-swap-dialog.spec.tsx` «the three ways
        are a radio group: «نقل المحدد ←» «تبديل المحدد ⇄» «نقل المحدد →», the swap on» → «the
        three ways are a radio group, the swap on — each named by what it does with both vans».
        New, in the same file: «Round 34 A — the three ways are ARROWS between the two cards» (an
        svg each and no word; each one's name and tooltip with both vans, Arabic and English; one
        hue for the two single arrows and another for the swap, off and on; where each points per
        language and per layout; `swapArrowAim` and `swapArrowTurn`; the roving Tab stop and the
        arrow keys; no second van yet).
      - Verified on the built web against the stubbed API at 390, 768, 1024, 1366 and 1440: each
        glyph's computed transform points from the sending card's centre to the receiving one's,
        Arabic and English; every arrow at least 44×44, no horizontal scroll; the two single
        arrows' computed colours identical and the swap's another, the white glyphs' contrast
        measured; ← (Arabic) and → (English) and ↓/↑ step the ways with the focus; «تطبيق» counts
        what crosses one way.
    - B — «وعاوز أغير اللي اوت بتاع بيانات المراجعة يكون بروفيشنال أكتر من كده، وعاوز الداتا اللي
      تبقى كبيرة زي الفروع والمناطق والبنوك وهكذا يكون في سيرش اقدر اسيرش بيه». «البيانات المرجعية»
      (`pages/CatalogsPage.tsx`, `/operations/catalogs`) in the boards' look — the day board's dark
      filter bar and framed table, Fleet's figures — and a search on the three lists that grow.
      - The kinds are a row of cards (new `components/CatalogKindCards.tsx`): each kind's icon in
        its own tone, its name, and how many rows it holds in the boards' figures (Latin digits,
        isolated left to right — «الفروع 1,340»), the chosen one in the site's purple with an edge
        under it. Still a real tab list on `?kind=`: `role="tablist"`/`tab`/`tabpanel`,
        `aria-selected`, one tab in the Tab order, the arrows walking it in the reading direction
        (← is the next card in Arabic) and Home/End (`kindStep`). The counts: the banks from the
        bank list the screen already reads whole; the branches and the areas from a one-row read
        (`COUNT_READ`, its `totalItems`); the currencies and «أنواع التشغيل» from the whole lists
        their tabs show (now read on every kind — they are 8 and 9 rows). «—» while a count is on
        its way. On a phone the row scrolls inside itself and the chosen card is scrolled into it.
      - A toolbar on banks, branches and areas (new `components/CatalogToolbar.tsx`, the boards'
        `DARK_FILTER_BAR` over `FilterBar`): the search, «الحالة» (الكل / مُفعَّل / غير مُفعَّل →
        `isActive`), on the branches «البنك» (كل البنوك / each bank → `bankId`), then the bar's own
        reset once anything narrows and «n نتيجة» (Arabic forms: «نتيجة واحدة», «نتيجتان», «3
        نتائج», «22 نتيجة»). One row from 1366px; on a phone the search takes a line and the two
        lists share the next. «إضافة …» and «استيراد فروع من شيت» are the boards' buttons, at the
        title's end on every kind.
      - The search is the SERVER's (`search` — banks: operations name and both names; branches:
        name, code, area; areas: both names and the governorate; folded there, `catalog-search.ts`).
        Its rules are pure (new `lib/catalog-filters.ts`): sent ~300ms after the last key
        (`createSearchDebounce` — «م», «مع», «معا» typed in a breath ask once); kept in `?q=` (a
        reload or a shared link opens on it; typing replaces the history entry); the page back to
        the first on any change, the page size kept; ✕ and Escape empty it at once; another kind
        starts clean (`withCatalogKind` drops `q`, `status`, `bank` and the page), and a search
        still waiting when the kind changes is dropped, never sent to the next kind; digits typed on
        an Arabic keyboard are sent as Latin («١٢٣» → `123` — the server folds the letters, not the
        digits) and runs of spaces as one, while the box keeps what was typed (`foldCatalogSearch`).
        What was found is marked in the rows, folded as the server folds (`matchParts` —
        «الاسكندريه» marks «الإسكندرية», «٢٠٤» marks «204»). While the next answer is asked the last
        one stays on screen, dimmed, with a spinner in the count — three hooks of their own
        (`useCatalogBanksPage`, `useCatalogBranchesPage`, `useCatalogAreasPage`, the same reads and
        cache keys with `keepPreviousData`), so every other caller of `useOperationsBanks` & co.
        reads exactly as before. The plain list still asks `{ page, pageSize }`, the query it always
        asked.
      - The table sits in one frame with its pager in the frame's foot (the numbered pager the
        boards wear, 25 / 50 / 100 a page): the boards' table (`BOARD_TABLE_LOOK`) with its head held
        while the rows scroll on a computer, comfortable rows (59px, 63px from 1750px), the names in
        Cairo (the boards' monospace stack spread Arabic names word by word) and the codes and
        numbers in the figures' face, the status as the boards' small badge, an inactive row dimmed,
        the pen in the boards' action box, the maps pin kept. An empty answer says what was asked:
        «لا توجد نتائج لـ «…»» with «مسح البحث» (and «مسح كل المرشحات» when a filter narrows too), or
        «لا توجد نتائج تطابق المرشحات المحددة»; a list empty for real keeps its own words («لا توجد
        فروع بعد»). Errors as before. On a phone the table scrolls sideways inside its frame.
      - Currencies and «أنواع التشغيل» keep their drag, their arrows, their whole list on one page
        and archive / restore, and take NO search: a filter over a dragged list would hide the rows
        a drop lands between. Their note sits on the toolbar's line. The add / edit forms, the
        branch import (in the list's place, as Round 29 drew it) and the address bar's `size` are as
        they were.
      - Without `operationsCatalog.manage` (the route asks for it; the screen no longer leans on
        that) there is no add, no import, no pen, no grip, no arrows and no archive — the pens on
        banks, branches, areas, currencies and types and the add button were drawn regardless
        before. No new permission.
      - The server: no change in B (the critic's review below folds the digits in
        `catalog-search.ts`). Typing a bank's name into the branches' search is NOT matched: the
        bank filter says it exactly, and the shipment form's branch picker reads the same endpoint
        with `bankId` and `search` — matching the bank's name there would answer every branch of
        «بنك مصر» to «مصر». The persistence census keeps the screen EXCLUDED, its reason now naming
        `q`, `status` and `bank` (`shared/lib/remembered-filters-coverage.spec.ts`): they belong to
        one kind and never cross a visit.
      - Specs. Rewritten (the pager changed): `pages/catalogs-currency-order.spec.tsx` «shows no
        pager — the whole list is on screen» and `pages/catalogs-shift-types.spec.tsx` «lists the
        WHOLE catalog in the order the server answered — archived types too» — their «no pager»
        looked for the old pager's «لكل صفحة» only (`common.pagination.perPage`), which the
        new pager does not write; they now also assert no `data-catalog-pager` and no
        `common.pager.perPage`. New: `lib/catalog-filters.spec.ts` (the kinds that search, the
        address bar, the query, the digits, the arrows, the clock with fake timers, Escape, the
        marks) and `pages/catalogs-layout.spec.tsx` (the cards — order, selection, ids, counts,
        «—»; the search, the status and the bank reaching the query by its exact cache key; the
        Arabic digits; the count and the reset; the marks; the figures and the badges; the four
        empty states; each kind's toolbar and none on the dragged lists; the pager in the frame with
        25 / 50 / 100; a bigger page; who may change what, on every kind; every new word in both
        languages; no raw key in English).
      - Verified on the built web (dist-r34b) against a stubbed API in the server's shapes with 10
        banks, 1,340 branches over 4 banks, 120 areas, 8 currencies and 9 types, searching as the
        server does: at 1366, 1440, 1920 and 390, dark and light — no sideways scroll of the page
        or the board's frame, the toolbar on one row and the five cards in view from 1366, nothing
        cut, the pager in the frame; at 390 the cards and the table scroll inside themselves and the
        toolbar stacks. In the browser: seven keys typed 60ms apart sent ONE search, `?q=` and page
        1, a reload kept it, Escape and ✕ cleared it, «٢٠٤» asked `204`, «غير مُفعَّل» and «بنك مصر»
        reached the query, the reset cleared all, a kind switch dropped a waiting search, ← and Home
        on the cards, the pager and 100 a page, a row's pen, «إضافة فرع», the import and back, the
        empty state and «مسح البحث», the drag lists intact, English left to right.
    - Round 34 verifier (the build's, never the owner's): on the real stack (the owner's four sheets
      imported, 1,735 branches) at 768 and 820 the five kind cards share the row at 134–145px, and
      with the icon BESIDE the name «أنواع التشغيل» had 56px and was cut («أنواع التـ…»). From `md`
      to `lg` the icon now sits ABOVE the name (`CatalogKindCards`), whole at 768, 820, 900 and
      1000; beside it again from `lg`, as before. New: `pages/catalogs-layout.spec.tsx` «from md to
      lg the icon sits above the name, so «أنواع التشغيل» is not cut on a tablet».
    - Round 34 critic (the build's, never the owner's): seven findings, each fixed with a spec that
      fails on the code before it (each fix reverted once and its spec seen red).
      - (1) A list read that failed left the toolbar's count at «جارٍ التحميل…» for good, beside
        the table's «تعذّر التحميل»; and a `?bank=` that is no ObjectId reached the server, which
        refuses it (400) — the whole list failed and the bank box named the raw id. Now the count
        says «—» (named «تعذّر التحميل») and the pager hides while the read has failed;
        `readCatalogFilters` reads a `bank` that is no id as no filter (contracts `objectId()`), and
        `withKnownBank` one that names no bank on the list, once the list is in. New:
        `lib/catalog-filters.spec.ts` «a bank that is not on the list is no filter once the list is
        in …»; `pages/catalogs-layout.spec.tsx` «a link from elsewhere, and a read that failed»
        (four cases). Rewritten (the rule changed): `lib/catalog-filters.spec.ts` «reads `q`,
        `status` and `bank` — an unknown status is no filter at all» → «… — an unknown status, or a
        bank that is no id, is no filter at all»; `pages/catalogs-layout.spec.tsx`'s bank fixtures
        are ObjectIds now («b-nbe» → 24 hex digits, the server's shape), its assertions unchanged.
      - (2) The toolbar's reset (or Back over a filter) pressed inside the 300ms wait left the typed
        term in the box, and it landed in `?q=` after the reset. The box is a pure model now
        (`createSearchBox` in `lib/catalog-filters.ts`; `CatalogToolbar` only hands it the keys and
        the address bar): beside `q` it watches the rest of the narrowing (`searchBoxContext` — the
        status and the bank), and a change made elsewhere puts the address bar's text in the box
        and drops what was waiting; its own send coming back changes nothing. New:
        `lib/catalog-filters.spec.ts` «the search box against the address bar» (the screen in
        miniature — the model, `withCatalogSearch`, the reset, Back — six cases).
      - (3) In English below `lg` the swap's ⇅ was not mirrored: the row read ↓ (↑↓) ↑, each of its
        arrows against the one beside it. It is mirrored there now (`-scale-x-100 rotate-90`, reset
        from `lg`): ↓ ⇅ ↑ in English, ↑ ⇅ ↓ in Arabic as before; the column (⇄) unchanged.
        `swapArrowAim` lists the swap's two in the order the eye meets them — top first side by
        side, left first stacked — so its `stacked` reads `up down` in Arabic, `down up` in English.
      - (4) ✕ / Escape on a text never sent, or a space added, wrote the address bar anyway — the
        page back to the first, and a `q` of spaces. `withCatalogSearch` writes nothing when the
        folded question is unchanged, and never a `q` that folds to nothing. New:
        `lib/catalog-filters.spec.ts` «what the box writes to the address bar» (three cases).
      - (5) A code or a name saved with Arabic-Indic digits («١٠٤» — the form keeps what is typed)
        was found by no typed form: the screen sends «104» for «١٠٤», and the server matched digits
        literally. apps/api `catalog-search.ts` (`containsText`, every catalog's search) now
        matches each digit in its Latin, Arabic-Indic and Persian forms («104», «١٠٤», «۱۰۴» find
        one another). New: `catalog-search.spec.ts` «finds a code stored in Arabic-Indic or Persian
        digits by its Latin digits, and every way round»; `tests/integration/operations.spec.ts`
        «9b3. finds a code stored in Arabic-Indic digits by its Latin digits, and back» (Mongo's own
        engine). Rewritten (the rule changed): `catalog-search.spec.ts` «treats two letters as one
        exactly when normalizeArabic does» → «treats two characters as one exactly when
        normalizeArabic, the digits read as Latin, does» (the reference fold gains `asciiDigits`,
        and the Latin digits join the Arabic block).
      - (6) The swap's spec pinned the dialog's source text and the turn's class strings: an
        equivalent refactor broke it, while (3) passed. The radio group is its own hookless
        component (`SwapWays` in `crew-swap-arrows.tsx`) whose key handler the spec calls, and the
        arrows are read off the glyph's own svg heads, turned by the matrix its classes give in each
        layout. Rewritten in `components/crew-swap-dialog.spec.tsx`: «the arrows point from the
        sending card to the receiving one: left/right by the language, down/up stacked» → «the
        arrows point where they say: the drawing, turned by its classes, against
        `data-swap-points`», «each one-way arrow points from the sending card to the receiving one,
        in every layout and language» and «the swap’s two arrows each point as the one-way arrow
        beside them — ⇄ in the column, ↑ ⇅ ↓ / ↓ ⇅ ↑ in the row»; «the helpers agree:
        `swapArrowAim` and `swapArrowTurn` for each way, each language» → «the words and the
        drawing agree for every way, language and layout — and the two hues»; «the keyboard still
        steps: one way in the Tab order, the arrow keys toward where the arrows go» → «the keyboard:
        one way in the Tab order, and each arrow key moves to the way that lies that way»; and the
        Round 32 critic block's «the arrow keys read the language: `modeStepOf` with the window’s
        locale» → «the arrow keys read the language: the window’s ways step as its locale reads».
      - (7) Before the second van each arrow was named «نقل المحدد من 150 إلى —» (and each box «…
        إلى —»). Until it is chosen the second van is «السيارة الثانية» (new key
        `operations.crewPlan.swap.secondVan`, «the second vehicle»), and each arrow's name and
        tooltip add «اختر السيارة الثانية أولًا». Rewritten: «no second van yet: the arrows are
        there, the swap marked, none to press» → «… — each named without a dash, and why»; «the
        first card is that row, every item with its own box; the second is the board’s other rows»
        (its box named «… إلى السيارة الثانية», no longer «إلى —»).
    - D — the owner's review of A, on its screenshot: «أنا مش عايز كده، أنت كده عامل لي إن السهم اللي فوق
      رصاصي والسهم اللي تحت رصاصي واللي في النص بنفسجي. أنا يعتبر محدد اللي في النص. البنفسجي ده هو اللون
      الأشمل للويب سايت. أنا عايز تكون ألوان مختلفة، فاهم قصدي؟ ولما أنا أبقى هوفر يبقى يجيلي اللون ده، أو
      لو أنا اخترت شمال أو يمين مثلا يفضل موجود لحد ما الداتا تتنقل ثانية أو ثانيتين ويقوم جاي متشال،
      فاهم؟» The arrows are ACTIONS now, each in its own colour, and the window works on a copy of the
      two rows until «تطبيق».
      - The colours (`SWAP_ARROW_LOOK`, `crew-swap-arrows.tsx`): never grey, never the site's violet.
        The two one-way arrows share sky, the swap is orange — apart from the brand, the cards' emerald
        «من 213» and rose «لم يُنقل», and the amber «إجازة». At rest each is plainly in its colour: light
        `sky-50` #f0f9ff / `sky-500` border / `sky-700` #0369a1 glyph (5.57:1) and `orange-50` #fff7ed /
        `orange-500` / `orange-700` #c2410c (4.88:1); dark a 15% tint over the window's navy, a 70%
        `sky-400` / `orange-400` border and a `sky-300` #7dd3fc / `orange-300` #fdba74 glyph (9.73:1,
        9.87:1). Under the pointer and the keyboard's focus each fills solid — `sky-600` #0284c7,
        `orange-600` #ea580c — with a white glyph (4.10:1, 3.56:1; a glyph's bar is 3:1), dark and light
        alike; the focus also keeps its neutral outline outside, and its ring is the arrow's own hue (the
        base layer's brand ring no longer shows on an arrow). All measured from computed styles.
      - No way is «selected»: the radio group is gone. The three are a toolbar of buttons (`SwapArrows`):
        one in the Tab order, the arrow keys moving the FOCUS in the reading direction (`modeStepOf`, as
        A and the critic set the directions — they still point from the sending card to the receiving
        one at 390, 768 and 1440, Arabic and English), Enter and Space pressing. A press MOVES the ticked
        items at once with the same rules as before (`planSwap`: away that day, a slot his role does not
        fit, no room left, an archived type keep an item back, named): the arrived items carry the
        emerald «من 213» until «تطبيق» or close, a value a one-way field replaced is named struck beside
        the one that took its place («بدلًا من 09:00» — also when a field went there and back and the
        other row's value is gone), what a rule kept back flashes rose «لم يُنقل» on its card and the
        notice under the arrows names it and why («لم يُنقل محمد ياسر احمد علي — خانة القائد في 255
        ممتلئة»; it stays until the next press or undo, to be read), and the ticks clear. The pressed
        arrow stays filled in its colour for `SWAP_HOLD_MS` = 1.4s (measured 1,395–1,400ms in the
        browser), its glyph nudging twice toward the receiving card (`swap-nudge`, 2 × 700ms,
        `motion-safe:` only — none under reduced motion, the fill stays), what it brought settling in,
        the receiving card(s) framed in its hue with «تستقبل»; then it rests. Several presses follow one
        another, each on what the one before left; «تراجع عن آخر نقل» in the footer takes them back one
        at a time — the items home and ticked again as before the press — down to the opening state.
      - Why an arrow cannot act, in its tooltip and its name (`aria-disabled`, still focusable — the
        pressed arrow keeps the focus; softened to 60%, still in its colour): «اختر السيارة الثانية
        أولًا» (no second van yet), «حدّد ما يُنقل من 213 أولًا» / «حدّد ما يُبدَّل على إحدى السيارتين
        أولًا» (nothing ticked where it sends from), «النقل الجاري لم يكتمل بعد» (a press still playing).
        «تطبيق» is off while nothing has changed («لم يتغيّر شيء بعد» — moved there and back is no
        change); «تغيير» the second van is off while moves stand («طبِّق النقل أو تراجع عنه قبل تغيير
        السيارة الثانية»).
      - The window's state is a pure model, new `lib/crew-swap-window.ts` (`swapWindowReducer`: the
        ticks, the presses, the last press, the arrow held; `swapArrowWhy`; `createSwapHoldClock`);
        `lib/crew-swap.ts` composes the presses (`SwapStep`, `replaySwap`, `swapChanged`, `swapArrivals`,
        `swapReplacedValues`, `swapStepsOperation`, `applySwapStepsToDraft`). The window keeps the
        presses, never the rows they made: the cards are the presses replayed over the two rows as the
        board holds them NOW, so another desk's save under the open window shows on the cards with the
        moves on top, judged again.
      - The page contract: `CrewSwapDialog`'s `onApply(bKey, picks, mode)` → `onApply(bKey, steps)`.
        «تطبيق» hands over the presses and `CrewBoardPage` replays them on its draft as it is at that
        press (`applySwapStepsToDraft` with the board's own `swapRules` — a man HR marked away since,
        or one another desk moved, is judged again) as ONE operation of the board's «تراجع» (one press
        takes all of it back), the standing crew letting go of the two rows as before; named a move
        («نقل المحدد من 213 إلى 255») when every press went that one way, else the swap. Nothing is
        saved until «حفظ». «إلغاء», ✕ and Escape drop every move with the window. `DesignSave` takes a
        `title` (why it is off).
      - Removed: the «بعد التطبيق — معاينة» section (`previewCard`, `data-swap-after`/`data-swap-preview`)
        — the cards show it live — and with it the «ينتقل إلى …» line; the «تستقبل» tag and the
        disabled receiving boxes of a chosen one-way (no way is chosen; the tag shows only while a press
        plays); the «shared» field box of the swap way. The window went from the full 900px screen with
        the preview scrolling to 561px at 1440×900, no scroll. Kept: the footer's count, now «نُقل: ٢ ·
        بقي: ١» (every item the presses moved; what the last press kept back), and the «المحصنات
        الموزَّعة … تبقى» note — on the working card, once the row's captains or direction have changed.
      - i18n: removed `operations.crewPlan.swap.preview`, `swap.previewHint`, `swap.after`,
        `swap.left`, `swap.receivingHint` and `swap.itemExchange`; new
        `swap.why.{playing,nothingOn,nothingEither}`, `swap.keptLine`,
        `swap.undoLast`, `swap.undoLastTitle`, `swap.undoNone`, `swap.nothingChanged`,
        `swap.changeLocked`; rewritten `swap.summary` («نُقل: … · بقي: …» / «Moved: … · Kept back: …»),
        `swap.kept` («لم يُنقل» / «Not moved»), `swap.nothing` («حدّد ما يُنقل ثم اضغط سهمًا»),
        `swap.mode.group` («نقل المحدد بين السيارتين»). Tailwind: keyframes `swap-nudge`,
        `swap-nudge-back`, `swap-arrive`, `swap-flash`.
      - Specs. Rewritten (the rule changed), all in `components/crew-swap-dialog.spec.tsx`: «nothing to
        apply and no preview until the second van is picked» → «nothing to apply until the second van is
        picked — and no preview section at all»; the describe «two cards side by side, the ticks, the
        ways and the preview AFTER» → «two cards side by side, the ticks and the arrows between them —
        the cards are the working copy», and in it: «the first card BEFORE the second in the markup — on
        the right in Arabic, on the left in English» (the preview's order dropped); «the ticked items
        are checked; each card has «الكل» · «الطاقم فقط» · «لا شيء»» → «… ; every box live» (4 ticks on
        150, not the shared field's 5; no box off); «the three ways are a radio group, the swap on —
        each named by what it does with both vans» → «the three arrows are ACTIONS — a toolbar of
        buttons, no radio, nothing «selected» — each named by what it does with both vans»; «the
        preview: who arrives «من 213» / «من 150», the fields exchanged — nothing thrown away — what
        goes» → «a press of the swap moves at once: each card holds what arrived «من 213» / «من 150» —
        the fields exchanged, nothing thrown away — and the ticks clear»; «one way: a field moved onto a
        value names the value it replaces, struck» (on the card after the press); «a rule keeps an item
        back — shown on the preview with its reason, counted as staying» → «a rule keeps an item back —
        rose «لم يُنقل» on its card, named with its reason under the arrows, counted in the footer»;
        «one way: the receiving card says so and its boxes are not read» → «while an arrow plays, the
        card(s) it sends to say «تستقبل», framed in its hue; at rest neither»; «English: the same window
        in its own words» (no preview words); in the Round 32 critic block «in «تبديل المحدد ⇄» a field
        ticked on one card shows ticked on both — the pair’s exchange, named so» → «a field ticked on
        one card is that card’s own tick — the swap exchanges the pair, nothing thrown away», «an
        archived type in an exchange: both rows keep theirs, each named why» (the reasons in the
        notice), «says how many محصنات ride a row — and that they stay when its captain or its
        direction leaves» → «… — and that they stay once its captain or its direction has left», «the
        notes start their own line on the preview — never under the label column» → «… on the cards
        …», «the arrow keys read the language: the window’s ways step as its locale reads» → «the arrow
        keys read the language: the window’s arrows move the focus as its locale reads»; in the Round 34
        A block «the two one-way arrows share ONE hue (sky), the swap another (the brand’s) — off and
        on» → «the two one-way arrows share ONE hue (sky), the swap another (orange) — at rest, under the
        pointer and held; never the brand’s, never grey», «the keyboard: one way in the Tab order, and
        each arrow key moves to the way that lies that way» → «the keyboard: a toolbar — one arrow in
        the Tab order, each arrow key moves the focus to the arrow that lies that way, a press is the
        button’s own», «no second van yet: the arrows are there, the swap marked, none to press — each
        named without a dash, and why» → «no second van yet: the arrows are there, none marked, none to
        press — each named without a dash, and why»; in the board block ««تطبيق» is ONE step of «تراجع»
        on the draft — `applySwapToDraft` under the board’s own rules» → ««تطبيق» is ONE step of «تراجع»
        on the draft — the window’s presses replayed by `applySwapStepsToDraft` under the board’s own
        rules». The Round 34 A block's two renders no longer pass `mode: 'swap'` (the window has none);
        their assertions are unchanged. New: in the same file the describe «Round 34 D — the arrows
        are ACTIONS; the window works on a copy until «تطبيق»» (the held arrow solid with its
        `motion-safe:` nudge, the others off «النقل الجاري لم يكتمل بعد»; each arrow off with its
        reason; several moves on top of one another and there-and-back as no change; the footer — the
        frame's ✕/Escape and «إلغاء» only close, «تطبيق» hands over the presses, the undo's name; «تغيير»
        locked while moves stand); new `lib/crew-swap-window.spec.ts` (a press moves at once with tags
        and a kept-back reason, the ticks clear; several presses; a press that moves nothing is no step;
        the in-window undo down to the opening; the reasons; the hold with fake timers — held, still
        held at 1s, at rest at 1.4s, no press meanwhile, `stop`; 2 × 700ms = `SWAP_HOLD_MS` read off
        tailwind.config.ts); and in `lib/crew-swap.spec.ts` the describe «Round 34 D — the window’s
        presses: steps replayed on the two rows» (the replay = `planSwap` in turn; there and back; the
        lost value; «تطبيق» as ONE step that one «تراجع» takes back, «حفظ (2)»; the same draft when
        nothing changed; re-judged at «تطبيق» — a man marked away meanwhile stays, a man moved off by
        another desk is not found; the standing crew let go; the operation's name). Its 32 earlier
        tests are untouched and green. Each new rule was broken once (the brand colour back on the swap,
        the ticks not clearing, «إلغاء» applying) and its spec seen red.
      - Verified on the built web (dist-r34d) against the stubbed API (r34d/shoot-r34d.mjs, from the
        Round 34 A and critic shooters): 119 checks — the directions and ≥ 44×44 at 390, 768 and 1440 in
        Arabic and English with no sideways scroll; the colours at rest, under the pointer, on the
        keyboard's focus and held, dark and light, the two one-way arrows' computed colours identical,
        none the brand's; Enter on the focused arrow moving 0100007 and 213's direction to 255 at once,
        0100008 kept back («خانة القائد في 255 ممتلئة») and named, 255's «التجمع الخامس» struck, the
        ticks cleared, the board untouched; held 1.4s and at rest after; a second press keeping the
        leave-taker 0100020 back; the undo twice back to the opening; «تطبيق» → «حفظ (2)» and ONE more
        step of the board's «تراجع» named «التبديل بين 213 و255», one press of which put both rows back;
        Escape, «إلغاء» and ✕ after moves leaving the board as it was; reduced motion — filled, no
        nudge; no second van — the three off, saying why.
    - C — colours on «لوحة التشغيلة» become optional. The owner: «والشاشة بتاعت لوحة التشغيلة عاوز اقدر بعد
      ما اضيف لون اقدر اشيله عادي، يعني مش عاوز ان انا محصنة يبقى لونها محصنة فهتبقى كذا، لا انا عاوز ان انا
      ممكن اضيف محصنة بس الصف بتاعها ما يكونش ملون عادي.» Asked to choose: «ما انا عاوز مش لازم نوع يكون واخد
      اجبارى لون فاهم ولو انا مثبت لون للنوع ممكن لو تندى صف اشيل لونه عادى». So a type may have no colour,
      and any row may be «بدون لون» over its type's colour; a colour once given can be taken off again.
      - A row's colour has THREE states, all in `rowColour`: null «لون النوع» (as before — the type's
        colour, or none when the type has none; every row saved before and every older client keep this
        meaning), a palette name picked by hand, or the new `'none'` «بدون لون» picked by hand, which wins
        over the type's colour. Contracts: `OPERATIONS_CREW_ROW_NO_COLOUR = 'none'`,
        `OperationsCrewRowColourSetting`; `OperationsCrewRowColourSchema` takes `'none'` beside the palette
        and still maps Round 20's six names; `canonicalCrewRowColour` reads a stored `'none'` as `'none'`;
        both crew DTOs' `rowColour` is `OperationsCrewRowColourSetting | null`. `'none'` is no palette name
        and no legacy name (a spec holds it). API: the crew row model's enum takes `'none'`; the save
        stores it as written and an unchanged `'none'` is a no-op; a row holding only `'none'` is still a
        row, as a row holding only a colour is. No migration: nothing stored changes meaning.
      - A type's colour is optional: `OperationsShiftTypeDto.colour` is `OperationsShiftTypeColour | null`;
        create takes `colour` null or leaves it out (none), the edit takes null to take it off and leaves
        it unchanged when left out; `'none'` is never a type's colour (400). The model's `colour` is
        optional (`default: null`); the mapper and the audit snapshot read `?? null`. No data migration:
        every type keeps the colour it has, the seed's nine included. `paletteFor` still counts a type
        with no colour (N swatches for N live types) and it wears none of them; `freeColourFor` ignores it.
      - Drawn neutral everywhere a type's colour shows (`NO_COLOUR_TONE`, `typeDotTone`, `typeTagTone` in
        `components/shift-type-look.tsx`): its dot a hollow ring in the panel's ink (`slate-500`, dark
        `slate-400` — 4.8:1 on white, ≥ 6:1 on the dark panels), its tag untinted with a hairline ring;
        `data-type-dot="none"` / `data-type-tag="none"`. Screens checked: the board's type box and type
        list, its strip of counts, the row's «اللون» list, the swap window's «النوع» and «لون الصف»,
        «ألوان الأنواع», the reference tab (its tag and its «اللون» column, «بدون لون» in words) and the
        type's form preview. The distribution / handover cards, their print sheets and the board's Excel
        name a type by its name only (`shiftTypeName`), never its colour — nothing to change. A row with
        no colour (its own «بدون لون», or a type with none and «لون النوع» kept) is drawn exactly as an
        uncoloured row: no tint, no bar (measured: the same cell fill and no inset shadow as a row with no
        type, text 16.2:1 dark, 17.9:1 light).
      - The row's «اللون» list (`RowColourPicker` / `RowColourSwatches`) opens on «لون النوع» (with the
        type's swatch, or «(بدون لون)» for a type with none, «(لا نوع للصف)» for a row with no type —
        new prop `hasType`) and «بدون لون» (`data-colour="none"`, the struck ring `NoColourSwatch`, its
        hint «يظهر الصف بلا لون ولو كان لنوعه لون، ويعيده «لون النوع» إلى لون نوعه»), then the palette as
        before; exactly one is pressed. The cell's button shows a row «بدون لون» as the struck ring
        (`data-colour-source="row"`, `data-colour-shown="none"`), named «لون الصف: بدون لون». The board
        marks such a row `data-row-colour-source="none"`. «بدون لون» is ONE step of «تراجع» —
        «إزالة لون الصف 213» (`undo.kind.colourNone`).
      - «ألوان الأنواع»: a column «بدون لون» first on every type's line (`data-swatch-off`, before the
        palette's columns, which are as before), pressed for a type with none; a press sends the catalog's
        PATCH with `colour: null` («أصبح لون محصنة: بدون لون»); read only without the grant as before.
        The type's form (`ShiftTypeDialog`): «بدون لون» is the first choice, a radio of its own beside the
        palette (`data-colour-off`), checked when the type has none; a new type still opens on a free
        colour of the palette, «بدون لون» one press away.
      - The swap window moves «بدون لون» as a value of «لون الصف» (an item, named «بدون لون» with the
        neutral swatch; struck «بدلًا من كحلي» where it replaced a colour); «لون النوع» (null) is no item,
        as an empty field never was. The standing crew holds no type and no colour (since Round 27), so
        «تحميل الطاقم الثابت» fills a row and leaves its `'none'` as it was; nothing changed on
        «الطاقم الثابت».
      - i18n (Arabic and English): new `operations.crewPlan.colour.noneHint`,
        `operations.crewPlan.typeColours.pickNone`, `operations.crewPlan.undo.kind.colourNone`,
        `operations.catalogs.shiftType.noColour`, `operations.catalogs.shiftType.noColourHint`.
      - Specs. Rewritten (the rule changed), in `components/type-colours.spec.tsx`: «offers exactly the
        swatches shown, then «لون النوع» — nothing from Round 20’s six» → «offers «لون النوع» and «بدون لون»
        first, then exactly the swatches shown — nothing from Round 20’s six»; and «a colour picked when the
        palette was larger: still offered, at the end, pressed and so named» (title kept — its order now
        «لون النوع», «بدون لون», the palette, the kept colour). New: contracts
        `operations-crew-plan.spec.ts` «Round 34 C — colours are optional: a type without one, a row «بدون
        لون»» (4: three states, `none` stored as written, wrong spellings refused; `none` no palette or
        legacy name, the legacy names still mapped; `canonicalCrewRowColour`; a type's colour left out /
        null / taken off / unchanged on a rename, `none` never a type's); API
        `tests/integration/operations-crew-plan.spec.ts`, the same describe (6, the file run whole, 64
        green: a type added with no colour, taken off and given back, every other type's colour kept; a
        «محصنة» row `none` beside one keeping null and one navy — stored `none`, a no-op resent, null and a
        colour and `none` again; a row with only `none`; old rows null, a row with no field at all null; a
        type with no colour, its rows as saved; the standing crew holds no colour and a row filled from it
        keeps `none`); web `lib/type-colours.spec.ts` (6), `components/type-colours.spec.tsx` (11: the
        list's order and pressed states, the button, the neutral dot and tag and their contrast, the card's
        column read only and on a phone, «تراجع», the board's wiring), `pages/catalogs-shift-types.spec.tsx`
        (4: the tab, the form's choice, the palette counting a type with none, the form's source),
        `lib/crew-swap.spec.ts` (4), `components/crew-swap-dialog.spec.tsx` (3), `lib/crew-plan.spec.ts`
        (2: the standing load and the save keep `none`, `none` and null two states),
        `lib/standing-crew.spec.ts` (1), and the five keys in `operations-i18n.spec.ts`. Each new rule was
        broken once (`resolveRowColour` ignoring `none`; `canonicalCrewRowColour` dropping it; the model's
        enum without it) and its specs seen red.
      - Verified on the built web (dist-r34c) against the stubbed API (r34c/shoot-r34c.mjs, from the r27s
        stub; «شلاتين» given no colour): 27 checks — 213 «محصنة» «بدون لون» drawn as a plain row beside 249
        «محصنة» in slate, dark and light; «شلاتين»'s rows plain and its dot the ring in the strip; the list
        on 213 «لون النوع» (slate), «بدون لون» pressed, the palette; «لون النوع» gives slate back and
        «بدون لون» on 249 takes it off, each one «تراجع» step said so; «حفظ» sent 213 `rowColour: null`
        and 249 `'none'`; the card's «بدون لون» sent `{ colour: null, version }`; the tab and the form say
        «بدون لون», the preview following a colour given and taken off; 390 with no sideways scroll.
    - Round 34 D and C verifier (the build's, never the owner's), on the owner's review of A: «أنا مش عايز
      كده، أنت كده عامل لي إن السهم اللي فوق رصاصي والسهم اللي تحت رصاصي واللي في النص بنفسجي. أنا يعتبر
      محدد اللي في النص. البنفسجي ده هو اللون الأشمل للويب سايت. أنا عايز تكون ألوان مختلفة، فاهم قصدي؟
      ولما أنا أبقى هوفر يبقى يجيلي اللون ده، أو لو أنا اخترت شمال أو يمين مثلا يفضل موجود لحد ما الداتا
      تتنقل ثانية أو ثانيتين ويقوم جاي متشال، فاهم؟» On the real stack (the live API on an in-memory
      MongoDB, the built web), a time moved one way onto another («08:00» from 213 onto 61's «09:00») was
      drawn OVER its own «من 213» tag in the narrow «التوقيت» cell (Arabic at 1366 and 1440, English at
      1024): the value's wrapper was `min-w-0 flex-1`, so the box's wrap counted it as no width, kept the
      tag and «بدلًا من 09:00» on its line and squeezed it to 11px while its 41px of digits — which never
      shorten — spilled across the tag. A time now keeps its width (`flex-none`, `CrewSwapDialog`), so
      what follows it wraps to the next line; a value that shortens with an ellipsis still gives way.
      Measured after: no part of any item drawn over another on either card at 1024, 1366, 1440 and 390,
      Arabic and English. New: `components/crew-swap-dialog.spec.tsx` «a moved time keeps its width
      beside «من 213» and «بدلًا من …» — only a value that shortens gives way» (red on the code before).
      Nothing else changed.
    - Round 34 D critic (the build's, never the owner's), on D — the owner: «أنا مش عايز كده، أنت كده عامل
      لي إن السهم اللي فوق رصاصي والسهم اللي تحت رصاصي واللي في النص بنفسجي. أنا يعتبر محدد اللي في
      النص. البنفسجي ده هو اللون الأشمل للويب سايت. أنا عايز تكون ألوان مختلفة، فاهم قصدي؟ ولما أنا أبقى
      هوفر يبقى يجيلي اللون ده، أو لو أنا اخترت شمال أو يمين مثلا يفضل موجود لحد ما الداتا تتنقل ثانية أو
      ثانيتين ويقوم جاي متشال، فاهم؟» Seven findings, each fixed with a spec that fails on the code before
      it (each fix reverted once and its specs seen red). Nothing on the server, the contracts or the board
      page; the arrows' hues, the hold and what each way does are as D made them.
      - (1) Moved there and back was «no change» only for a slot of one: 213's «أخصائي 1» [0300012,
        0300014] came back [0300014, 0300012] (`planSwap` put an arrival at the slot's end), «تطبيق» live
        and «حفظ» counting the row; and with his own slot taken meanwhile (0300012 to 255, 0200026 into the
        room he left, 0300012 back) he came home in «أخصائي 2», unmarked. Now `replaySwap` hands `planSwap`
        the window's opening rows (`home`): a person going back to his row takes his own slot first and his
        own place in it, ahead of anybody who came in the window — so there and back is no change at all;
        his own slot full, he takes the other «أخصائي» and his line says so, «من أخصائي 1» (emerald, as
        «من 213»; `swapSlotChanges`, `data-swap-reseated`). One operation alone (`applySwap`, no opening)
        keeps arrivals at the slot's end, as before. The window's press reads the same opening, so what it
        names as moved and kept back is what the replay draws.
      - (2) ✕, Escape and «إلغاء» dropped every move without a word while the cards showed the data moved.
        With moves that change something they now ASK, in the footer's place: «لم تنتقل التغييرات إلى
        اللوحة بعد — هل تريد تطبيقها أم تجاهلها؟» — «تطبيق» (hands them over), «تجاهل التغييرات» (closes,
        nothing handed over), «متابعة التعديل» (and ✕ / Escape on the question: back to the window), the
        focus on its «تطبيق» (`SwapCloseAsk`, `swapCloseStep`, the state's `closing`). With nothing changed
        — moved there and back included — they close at once, as before. While the moves change something
        the footer says where they go: «تنتقل التغييرات إلى اللوحة عند «تطبيق»» (`data-swap-apply-hint`).
      - (3) The footer's «نُقل: N» summed every press (there and back read «نُقل: ٢» beside «لم يتغيّر شيء
        بعد»), and its «·» read as the Arabic zero («نُقل: ٢ · بقي: ١»). It counts what differs from the
        opening, as the cards show it (`swapWindowCounts(opening, work, state)`): «نُقل» every item on a
        card it did not open on or in another slot of its own, «استُبدل» every value on neither row now
        (said only when there is one), «بقي» what the last press kept back — «نُقل: ٢ — استُبدل: ١ —
        بقي: ١», a dash between them («Moved: 2 — Replaced: 1 — Kept back: 1»). `data-swap-apply` carries
        the same «نُقل». On a phone the count and the line about the board take a line of their own under
        the buttons (squeezed beside them they broke a word to a line); one line beside them from `sm`.
      - (4) A one-way press cleared the RECEIVING card's ticks too, which that arrow neither read nor
        moved; and a press that moved nothing (everything kept back) cleared its ticks with no step the
        undo could give them back by. Now a press clears only the ticks it read; the receiving card keeps
        its own — but a field that took the arriving value (its tick named the value replaced); a press
        that moves nothing leaves the ticks as they were, its reason under the arrows. The undo gives back
        both cards' ticks as they were before the press.
      - (5) The undo's spoken name was its detail only («تراجع عن نقل المحدد من 255 إلى 213»), not the
        words it shows (WCAG 2.5.3): now «تراجع عن آخر نقل — …». «تطبيق», «تغيير» and the undo were
        native-disabled, their reasons out of the keyboard's and the screen reader's reach: each is
        `aria-disabled` now, reachable, its reason in its name and its tooltip, a press doing nothing — as
        the arrows. `DesignSave` (`fleet/components/DesignDialog.tsx`) takes `why` for this in place of D's
        `title` (nothing else passed it); every other caller is as before.
      - (6) An arrow that cannot act — what the window shows most: at opening nothing is ticked — was
        softened to 60% (2.59:1 sky, 2.52:1 orange in light). It keeps its colour whole now: the rest glyph
        (`sky-700` / `orange-700`, dark `sky-300` / `orange-300`) on no tint with a lighter border, 5.93:1
        and 5.18:1 on white (dark 12.1:1, 11.96:1); under the pointer a soft tint of its own colour comes
        (`sky-100` 5.17:1, dark a 15% tint 9.73:1) — never the solid fill a press follows. Measured from
        computed styles, nothing ticked, dark and light (`SWAP_ARROW_LOOK[…].off`).
      - (7) No suite ran the window's press and its hold: the dialog spec drew static markup with the state
        handed in, the window spec rebuilt the wiring by hand — dropping the clock's start would have held
        every arrow for good with every spec green. The state, the press and the hold's clock are one store
        now (`createSwapWindow`, read with `useSyncExternalStore`): a press that acts holds the arrow and
        starts the clock, one that cannot changes nothing and starts nothing, the undo ends a hold, the
        window closing (its last watcher gone) stops the clock. Driven with fake timers in the window spec,
        and in the dialog spec through the arrows' own `onPress` and the footer's `onUndo` on the store the
        window made.
      - i18n (Arabic and English): new `operations.crewPlan.swap.applyHint`, `swap.closeAsk`,
        `swap.closeDiscard`, `swap.closeStay`, `swap.fromSlot`, `swap.summaryReplaced`; rewritten
        `swap.summary` («نُقل: {{moved}} — بقي: {{kept}}» / «Moved: {{moved}} — Kept back: {{kept}}»).
      - Specs. Rewritten (the rule changed): in `lib/crew-swap-window.spec.ts` «a press that moves nothing
        (everything kept back) is no step — but says why» → «a press that moves nothing (everything kept
        back) is no step — says why, and its ticks stay»; «at once: what crossed lands on the other card
        «من 213», a rule keeps someone back, the ticks clear» and «several moves in a row — each works on
        what the one before left» (titles kept: `swapWindowCounts` reads the opening and the working copy,
        `{ moved: 2, replaced: 1, kept: 1 }` and `{ moved: 2, replaced: 0, kept: 1 }`); «another second
        van: the first card’s ticks kept, every move and tick of the other gone» (its state gains
        `closing: false`, assertions unchanged). In `components/crew-swap-dialog.spec.tsx`, titles kept:
        «nothing to apply until the second van is picked — and no preview section at all», «a rule keeps an
        item back — rose «لم يُنقل» on its card, named with its reason under the arrows, counted in the
        footer» and «an archived type in an exchange: both rows keep theirs, each named why» («تطبيق» off
        by `aria-disabled` with its reason in its name — `applyOff` — not `disabled=""`); «a press of the
        swap moves at once: each card holds what arrived «من 213» / «من 150» — the fields exchanged,
        nothing thrown away — and the ticks clear» and «English: the same window in its own words» (the
        dash for «·»); «the two one-way arrows share ONE hue (sky), the swap another (orange) — at rest,
        under the pointer and held; never the brand’s, never grey» and «each arrow off with its reason:
        nothing ticked on the card(s) it sends from» (off: no `opacity-60`, the rest glyph on no tint, a
        soft tint under the pointer, never the solid fill); «several moves in a row: the cards show them one
        on top of the other, «من …» against the opening» (the count against the opening — «3» with
        «استُبدل: ١», there and back «0», no longer «2»); ««تغيير» the second van is off while moves stand
        — «تطبيق» or take them back first» (`aria-disabled`, its reason in its name); and «the footer:
        «تطبيق» hands over the presses (off while nothing changed, saying so); «إلغاء» only closes; «تراجع
        عن آخر نقل» names the last move, off with none» → «the footer: «تطبيق» hands over the presses (off
        while nothing changed, saying so); ✕, Escape and «إلغاء» close with nothing changed and ASK when
        the moves change something; «تراجع عن آخر نقل» names the last move, off with none». New: in
        `lib/crew-swap.spec.ts` the describe «Round 34 D critic — moved there and back: home to his own
        seat» (4: a two-person slot, his own slot first, his own slot taken meanwhile «من أخصائي 1», one
        operation alone as before); in `lib/crew-swap-window.spec.ts` «a one-way press clears the ticks it
        read; the receiving card keeps its own — but a field that took the value arriving» and the describes
        «Round 34 D critic — the footer counts what differs from the opening» (1), «Round 34 D critic —
        closing with moves asks first» (2) and «Round 34 D critic — the window’s store: a press, its hold,
        and the clock let go» (3); in `components/crew-swap-dialog.spec.tsx` «home in the other «أخصائي»
        (his own taken meanwhile): his line says «من أخصائي 1»» and the describe «Round 34 D critic — the
        window’s press, wired: the arrow held, then at rest» (2).
      - Verified on the built web against the stubbed API (`r34x/shoot-r34x.mjs`, from D's shooter): 73
        checks — the opening's arrows at opacity 1 in their colours, ≥ 4.5:1, a soft tint under the
        pointer; «تطبيق» and the undo reachable and named why; a press holding 1.4s, 255's own tick kept,
        «نُقل: ٢ — استُبدل: ١ — بقي: ١» and the line about the board; there and back — 213 in its opening
        order, «نُقل: ٠ — بقي: ٠», «تطبيق» off, Escape closing at once; the taken slot «من أخصائي 1»;
        Escape, ✕ and «إلغاء» asking, «متابعة التعديل» and Escape on the question going back, «تجاهل
        التغييرات» leaving the board as it was, «تطبيق» on the question giving «حفظ (2)» and one «تراجع»
        step; the question and the footer whole at 390 with no sideways scroll; the window 625px at
        1024×768, 1366×768 and 1440×900 with the notice, nothing scrolling; English; reduced motion.
    - E — the owner, on the screenshot of the row's colour list
      (`ship/r34b/row-colour-picker-1440-dark.png`), circling the toolbar's start — the role legend
      «● قائد ● أخصائي يعمل قائدًا ● أخصائي» and the hint under it: «واسمح الحاجات اللى فوق دى وحط مكاناها
      الاجماليات بدل ما انت لما بختار حاجه بينزل سطر ل تحت». The board's head is two lines now — the
      toolbar and the bar — and nothing picked or chosen adds a third.
      - Gone from the board: the legend and the hint (`CrewBoardPage`), drawn nowhere else — the role
        colours are on every chip and on the pools' heads, and every empty slot says «+ اختيار».
        `operations.crewPlan.hint` removed (Arabic and English; nothing else read it). A reader without
        `operationsCrew.plan` was told so in the hint's place («يمكنك الاطلاع على التشغيلة؛ …»); now by a
        lock among the acts (`data-crew-view-only`, behind the same `!canPlan && !isRecord`), the same
        words its name (screen-reader text) and its tooltip — no line. A past day keeps «سجل · للعرض فقط»
        and «العودة إلى اليوم» in words in the acts' place.
      - The totals moved up: the whole strip — «الإجمالي», a chip per type with its dot (a press filters
        by it, a second lets go), «بدون نوع» when any, «صيانة» with its codes in its tooltip — is the
        toolbar's start (`CrewPlanHand` handed the strip as its children), the acts at its end, ONE line
        from 1280 (`flex-nowrap`); below 1280 the totals take a line of their own above the acts. The
        same handlers, titles and hooks (`data-type-counts`, `data-type-count`, `data-type-archived`,
        `data-workshop-count`); the strip still counts the whole day.
      - The sizing (`HEAD_CHIP`, `HEAD_STRIP` in `CrewPlanFrame`): a chip 26px high, 4px inside, 3px
        between the dot, the name and the number beside it, 10.5px (11px from 1440; the number 11 /
        11.5px), 2px between chips — `COUNT_CHIP` (still «الطاقم الثابت»'s and «المعروض»'s) is 6px / 4px /
        11.5px with a 12.5px number. Measured on a catalog of eleven active types, 265 rows (2–3
        figures), «بدون نوع» 11 and «صيانة» 12: the fourteen chips are 977px in Arabic at 1440 (were
        1,123) and 948px below it. Even so they did not fit beside the six acts in words (659px in
        Arabic, 749px in English — 1,600px asked of the 1,320 a 1440 screen gives the board), so below
        1760 each act but «حفظ» is its icon in a 34px square, its word kept as its name (`ACT_WORD`,
        read by a screen reader) and in its tooltip (the standing crew's names it before its reason:
        «الطاقم الثابت — …»); «حفظ (n)» keeps its word and its count; from 1760 every act has its word,
        as before. The acts are then 261px (281 with «حفظ (n)»). Arabic: every chip whole at 1440 (74px to spare) and 1366
        (29px; 9px with «حفظ (n)»).
      - The last resort, where even that is short — Arabic at 1280 (57px), English (longer names: 130px
        at 1440, 168 at 1366, 254 at 1280): the line scrolls sideways inside its own box, never a
        wrap, never a sideways page. No scrollbar (it would give the box a height of its own; the box is
        the acts' 34px whether it scrolls or not): the edge that hides chips fades (a mask — dark and
        light alike), a plain mouse wheel over it moves it and gives the turn back to the page at its
        edge, a trackpad or a finger as ever, and a chip reached by Tab comes into view (new
        `lib/side-scroll.ts`: `sideEdges`, `wheelToSide`, `sideFade`, `useSideScroll`).
      - The bar is the filters only, ONE line from 1280 (`CREW_PLAN_BAR_LINE` — the shared bar with
        `flex-nowrap` and 8px between): the day, the van, the person (192px below 1366, 224 above), the
        direction, the type, and «المعروض N من M — مسح التصفية» at its end in room the line keeps. On a
        phone the type and that count share a line (the type box gives way), so a filter adds no line
        there either.
      - «لما بختار حاجه بينزل سطر ل تحت» — every choice measured: the table's top against the toolbar's,
        1280, 1366 and 1440, dark, Arabic and English, today's build (dist-r34) and E's (dist-r34e), the
        stub below (`ship/r34c/head-measure.json`). Before: picking somebody moved the table UP 6px in
        Arabic and 26px in English (the two-line legend and hint gave way to the one-line pill); at 1280
        every filter — a van, a person, a direction, the type list, a type chip — moved it DOWN 35px
        («المعروض» wrapped the bar's first line). After: a chip picked up lies OVER the totals, in their
        box (`CrewPlanHand` with children: the totals stay in it, unseen and out of the Tab order, the
        amber pill — «تم اختيار … — اختر الخانة، أو اضغط Esc للإلغاء» and «إلغاء» — absolutely over
        them, `aria-live="polite"` as before); «إلغاء» and Escape put it down and the totals come back.
        Picking somebody, a van (one or three), the person search, a direction, the type list, a type
        chip, a van and a chip together, «حفظ» taking its count: 0px each, at every width and in both
        languages — and 0px at 768 and 1024, and at 390 (the pill, every filter). The head itself is
        shorter: the table starts 45px higher in Arabic and 97px higher in English (the toolbar 34px,
        was 41 / 61; the bar 64px, was 102 / 134). Opening a past day still moves the table by Round 32's
        calm record notice (62px and its 16px gap: 78px; up to 142px on a phone in English): kept on
        purpose — a change of day, not a choice on the board, and the notice says what a record is and
        which changes the day ended on (before E it moved 71px in Arabic and 51 in English, the toolbar
        losing its hint at the same time).
      - «الطاقم الثابت» is unchanged: `CrewPlanHand` without children draws its legend, its hint and the
        pill in their place as before; its bar and chips are the shared ones — pixel-identical in today's
        and E's build at 1440, at rest and with a chip picked. It still shows the legend and the hint
        over its own counters' bar; the same move there is the owner's call.
      - i18n: `operations.crewPlan.hint` removed; in English only, shorter so more of the line is seen:
        `operations.crewPlan.workshop` «In the workshop» → «Workshop», `operations.crewPlan.type.untyped`
        «No type yet» → «No type».
      - Specs. Rewritten (the rule changed): `pages/standing-crew-page.spec.tsx` «draws the board’s
        frame, toolbar, bar, grid, slots, chips, pools and lists» (title kept: the board's bar is
        `CREW_PLAN_BAR_LINE`, built from `CREW_PLAN_BAR` — no longer `CREW_PLAN_BAR` itself);
        `components/crew-slot-picker.spec.tsx` «draws «+ اختيار» in every empty slot with room, and a
        «+» beside a half-full slot’s ✕» (title kept: «the hint names «+ اختيار»» → the page reads no
        hint and the key is gone); `operations-i18n.spec.ts` — the crew plan's key list drops `hint`
        (its Arabic and English cases go with the key). New: `components/crew-board-head.spec.tsx` (17:
        the legend and the hint gone, the key with them, «الطاقم الثابت» keeping its own; the strip in
        the toolbar before the acts — its handlers, titles and hooks — and the bar the filters only;
        one line from 1280 for the toolbar, the acts and the bar, the strip never wrapping, no
        scrollbar, the fade; the pill over the totals — the name, «إلغاء», `aria-live`, the totals
        unseen but kept — and Escape; the compact chip; each act's word and tooltip, «حفظ» in words;
        the past day's words; the lock) and `lib/side-scroll.spec.ts` (10: the edges both ways with a
        pixel of slack, the wheel, the fade).
      - Verified on the built web (dist-r34e) against the stubbed API (`r34e/stub-e.mjs` over the r27s
        stub — eleven active types, 265 rows, 12 vans in the workshop; `r34e/shoot-e.mjs`, 50 checks):
        no legend and no hint; the strip in the toolbar on its one 34px line and the bar one 64px line
        at 1280, 1366, 1440 and 1760, Arabic and English, dark and light; no sideways page scroll at
        any width, 390 included; a van and «يومي» chosen with «المعروض ١ من ٢٦٥» shown and nothing moved;
        a person picked — the pill within the toolbar's line, said aloud, the totals unseen — «إلغاء»
        and Escape putting it down; the past day's mark and «العودة إلى اليوم» on the same line; the
        lock without the grant; a wheel over the totals at 1280 carrying them to their end and the fade
        following.
    - F — the owner, in the same message: «و اسمحلى برضو ان ممكن عملية تكون من غير لون مش لازم ان يومى او
      محصنة تبقى واخده لون اجبارى». Round 34 C made a type's colour optional; this answers what C left
      open — no type is forced to take a colour: a NEW type starts with none, and nothing puts a colour
      back on a type that has none, «يومي» and «محصنة» included.
      - A new type starts with no colour: «إضافة نوع» (`ShiftTypeDialog`) opens on «بدون لون» and saves
        `colour: null` unless a swatch is pressed; the palette beside it — a colour nobody wears among
        it — is one press away. An edited type opens on its own colour, or on «بدون لون», from the
        first paint. Round 24b's «a new type opens on a free colour of the palette» is gone:
        `freeShiftTypeColour` (`CatalogDialogs`) and `freeColourFor` (`lib/type-colours`) removed —
        nothing else read them. The contract and the API already create a type left without a colour
        with none (`colour: …nullable().default(null)`, stored null), and an older client that sends a
        colour keeps it: no contract or API change.
      - What could force a colour back — each checked, none does: the boot's legacy nine
        (`seedOperationsShiftTypes`: keyed on `seedKey`, `$setOnInsert` only — they get their colours
        on a FRESH database, never again), Operations' boot step (`seedOperations`: the grants and the
        three data migrations, none of which touches a type), the go-live data (no type in it), the
        edit (`.partial()`: `colour` left out stays absent, so unchanged), the archive and the order,
        the palette's size and its «unworn» swatches (`paletteFor` counts a type with none and hands it
        nothing), and the crew save, the swap and the standing crew (a row's colour, never its type's).
      - «ألوان الأنواع» on the board: «بدون لون» was already one press on every type's line; it is now
        SAID, not only drawn — the column's head reads «بدون لون» under its struck ring
        (`data-swatch-off-word`), and on a phone (no head) each type's first choice is the ring with the
        words, a 36px pill, as the catalog's form draws it. The subtitle says it too: «لكل نوع لون من
        ألوان اللوحة (N) أو «بدون لون»، ويجوز أن يشترك نوعان في لون واحد» (English «A colour for each type
        from the palette (N), or none — two types may share one»). The row's «اللون» list keeps «لون
        النوع (بدون لون)» for such a type, and the toolbar's totals (E) draw it with the neutral ring.
      - Specs. Rewritten (the rule changed): `pages/catalogs-shift-types.spec.tsx` «starts a new type
        on the first shown colour no ACTIVE type wears — an archived one’s is free» → «opens a NEW type
        on «بدون لون» — no colour forced on it; the palette, a free colour among it, one press away»;
        in the same file «a type with no colour counts in the palette and never adds a swatch of its
        own» (title kept: `freeShiftTypeColour(WITH_BARE)` is emerald → the new type's form opens on
        «بدون لون», emerald offered) and «the form keeps a type’s «بدون لون» when it opens on it, and
        sends null for it» (title kept: the source lines it reads are the new opening);
        `lib/type-colours.spec.ts` «a new type starts on the first shown colour nobody live wears, else
        the first» → «a new type starts with no colour — the palette it is offered holds the colours
        nobody live wears», and «a type with no colour still counts in the palette, and wears no swatch
        of it» (title kept: `freeColourFor` → the unworn colours offered). New: in
        `catalogs-shift-types.spec.tsx` «opens an EDITED type on the colour it has — or on «بدون لون»
        when it has none»; `components/type-colours.spec.tsx` «Round 34 F — no type is forced to wear a
        colour: «بدون لون» one press, said in words» (5: the head's words, «يومي» and «محصنة» pressed on
        «بدون لون» beside a type that keeps its colour, the phone's pill, the subtitle, the totals'
        neutral ring); API `tests/integration/operations-crew-plan.spec.ts` «Round 34 F — no type is
        forced to wear a colour: «يومي» and «محصنة» stay bare across a boot» (1; the file run whole, 65
        green: both taken off — one as the card sends it, one as the form does — then Operations' boot
        step twice, an edit without `colour`, an archive and back, the order turned round and put back,
        a day of their rows saved, a new type with no colour and an older client's with one). Each seen
        red once: the seed writing its colour with `$set` (the API case), the form opening on a palette
        colour (4 web cases), the card without its words (2).
      - Verified on the real stack (`r34f/run-r34f.sh` — the live API on a MongoDB that OUTLIVES it,
        serving dist-r34f; `r34f/shoot-r34f.mjs`, 32 checks): «يومي» set «بدون لون» from «ألوان الأنواع»
        (one press, `PATCH { colour: null }` → 200), «محصنة» from «البيانات المرجعية» (the form → 200),
        «طوارئ» added untouched (`POST` with `colour: null`, stored none); the API process stopped and
        booted again on the same database (every boot step and module seed ran, nothing seeded): the
        three still have no colour, the other seven keep theirs, ten types; on the board their rows
        (213, 61, the row without a van — «محصنة» — and 255 — «يومي») carry no colour mark and fill
        exactly as a row with no type, dark and light; their chips in the toolbar's totals the hollow
        ring; 213's «اللون» list «لون النوع (بدون لون)»; «إضافة نوع» opens on «بدون لون»; the phone's
        sheet with the pill, no sideways page scroll.
    - Round 34 E and F verifier (the build's, never the owner's), on the owner's «و اسمحلى برضو ان ممكن
      عملية تكون من غير لون مش لازم ان يومى او محصنة تبقى واخده لون اجبارى واسمح الحاجات اللى فوق دى وحط
      مكاناها الاجماليات بدل ما انت لما بختار حاجه بينزل سطر ل تحت». On the real stack (the live API on a
      MongoDB that outlives it, the built web; tomorrow 98 rows over eleven active types, six vans in the
      workshop), at 1280, 1366 and 1440 every choice left the table where it was — but below 1280, from
      about 1060px (1242 is a 1366 screen at 110%), the bar's five filters fill its first line, and
      «المعروض N من M» wrapped onto a line of its own: the table 35px down on every filter, Arabic and
      English, a plan and a record — the very line the owner asked away. Below 1280 (from 640) the count
      now stands at the start of the toolbar's acts line, which is there already (the totals take the
      first line, the acts the second) and has the room (`filteredCountAt`, `CrewPlanFrame`); from 1280
      it is at the bar's end as E made it, and on a phone beside the type. Measured after, 640 to 1279
      (twelve widths), Arabic and English, a plan and a record: 0px each. New: in
      `components/crew-board-head.spec.tsx` the describe «Round 34 verifier — below 1280 «المعروض N من M»
      takes no line of its own either» (2, red on the code before). Everything else E and F report held
      on the same stack: no legend and no hint, the totals on the acts' line and the bar one line at
      1280, 1366 and 1440 (Arabic and English, dark and light), every choice 0px there and at 390, 768
      and 1024; «يومي» and «محصنة» taken off and still bare after the API booted twice on the same
      database, their rows plain and their chips the neutral ring; a new type on «بدون لون». Nothing
      else changed.
    - Round 34 E and F critic (the build's, never the owner's), on the owner's «و اسمحلى برضو ان ممكن
      عملية تكون من غير لون مش لازم ان يومى او محصنة تبقى واخده لون اجبارى واسمح الحاجات اللى فوق دى وحط
      مكاناها الاجماليات بدل ما انت لما بختار حاجه بينزل سطر ل تحت». Eight findings on E (F's had none),
      each re-checked on the built web against the stubbed API (`r34g/probe-g.mjs` over `r34e/stub-e.mjs`
      — eleven active types, 265 rows, twelve vans in the workshop): all eight real, all fixed.
      - A chip reached by Tab was NOT brought into view, as E said it was: Chromium leaves a partly seen
        focused chip where it is — at 1280 in English «Emergency» stood 76 of its 89px past the strip's
        edge, the rest under the fade. The strip now brings a chip the KEYBOARD focuses whole inside its
        box, 28px (the fade's width) clear of each edge (`sideReveal`, and the listeners gathered in
        `followSide` — the scroll, the wheel, the focus, the sizes — which `useSideScroll` calls), at
        once, never smoothly (reduced motion has nothing to glide). A press focuses its chip too, and is
        left alone: moving the line under a pressing pointer would land the release on another chip.
        Measured: every chip, Tab after Tab from «الإجمالي» to «صيانة», whole and clear of the fade at
        1280 (Arabic, English), 1366, 1440 and 1024 (English), 768 (Arabic) and 390 (both).
      - «صيانة» could not be reached by the keyboard whenever the line overflowed (1280 Arabic, every
        laptop width in English, every tablet and phone): it was a span out of the Tab order, its codes
        only in a hover's tooltip. It takes the focus now (`tabIndex={0}`), so Tab carries the line to
        its end, and its codes — «سيارات في الصيانة: …», or that there are none — describe it to a
        screen reader (`aria-describedby`, the words beside the strip, not inside its scrolling box);
        the mouse still reads them in its tooltip (`workshopWords`, built once for both).
      - The acts lost their words at EVERY width below 1760, though from 640 to 1279 they have a line of
        their own: unlabelled squares on a touch tablet, where a tooltip never shows. Their icons are now
        only where they must be: from 1280 to 1759, where the totals share the acts' one line (34px
        squares, as E made them — the owner's 1440 laptop among them), and below 820, where the words do
        not fit one line (English at 768: 709px of words, «Save (n)» 30 more, of 720) — there in 44px
        squares, a finger's size, «حفظ», a past day's mark and «العودة إلى اليوم» as high (`WORD_ACT`).
        From 820 to 1279 every act has its word again, as before E. For that line to stay the acts'
        alone, «المعروض N من M» left it (next).
      - Where «المعروض N من M» stands below 1280: the verifier put it at the start of the acts' line;
        it now stands at the END OF THE TOTALS' line (`filteredCountAt({ oneLineHead })` → `head`, the
        count among the hand's children after the strip). That line never wraps — the totals give way and
        scroll inside their box — so the count can add no line at any width, a phone's included; the
        acts' line keeps its width for their words. On a phone it is figures only, «١٢ من ٢٦٥», the whole
        «المعروض ١٢ من ٢٦٥» its tooltip and what a screen reader says, and «مسح التصفية» an ✕ that keeps
        its words as its name and tooltip (`FilteredCount`'s `compact`; new key
        `operations.crewPlan.filter.shownShort`, «{{shown}} من {{total}}» / «{{shown}} of {{total}}»).
        So the phone's type box no longer shares its line: with «احتياطي سفر» picked by its chip it kept
        83px at 360 in English (its icon, a figure, the chevron) — now the bar's whole width (302px at
        360, 332 at 390), like every filter above it; the count 93px beside 227px of totals at 360.
      - A reader without `operationsCrew.plan` was told the board is read only by a grey lock alone —
        its words only in a hover's tooltip, nothing on a phone or to the keyboard. It is now a lock and
        «للعرض فقط» in words (`ViewOnlyMark`, new key `operations.crewPlan.viewOnlyMark`, «View only»),
        as the past day's «سجل · للعرض فقط» is; why, in full — «يمكنك الاطلاع على التشغيلة؛ أما التوزيع
        فيحتاج صلاحية تخطيط الطاقم.» — its tooltip and what a screen reader says.
      - While somebody was picked, the pill lay over the totals and hid them: no type chip could be
        pressed to narrow the rows before choosing the slot, as it could before E. The pill now stands at
        the START of the totals' line, on it — at most 70% of the line, 30px high in its 34px — and the
        totals keep the rest: seen, pressed (a type chip narrows the rows and the pill stays), scrolling
        inside their box when the room is short. The spoken region is there, empty, before anything is
        picked (`CrewPlanHand` with children). Still nothing moves: measured below.
      - The head's spec pinned mostly source text and class names; what it described was checked only by
        scratch shooters — which is how E's focus claim shipped. Behaviour is now tested where node can:
        `sideReveal` (4), and the strip's listeners driven on a stand-in box with Node's own events
        (`followSide`, 5: Tab past the edge in English and in Arabic, a press that moves nothing, the
        wheel and its edges, the listeners undone); `CrewPlanHand`, `FilteredCount` and `ViewOnlyMark`
        rendered. The spec's header says what is verified only on the built page, and where.
      - Three comments put a corrected paraphrase in quote marks as the owner's («امسح … مكانها …»); they
        quote him as he wrote: «واسمح الحاجات اللى فوق دى وحط مكاناها الاجماليات» (`CrewBoardPage`,
        `CrewPlanFrame`, `operations-i18n.spec.ts`).
      - Specs. Rewritten (the rule changed), in `components/crew-board-head.spec.tsx`: «a chip picked up
        lies OVER the totals, in their box: its name, «إلغاء», said aloud» → «a chip picked up stands at
        the totals’ start, ON their line: its name, «إلغاء», said aloud — the totals still seen and
        pressed»; «nothing picked: the totals shown, the spoken region there and empty» → «nothing
        picked: the totals shown, the spoken region there and empty — no width, no gap»; «below 1760
        each act but «حفظ» is its icon — its word its name, and its tooltip» → «from 1280 to 1759 — and
        below 820 — each act but «حفظ» is its icon; its word its name, and its tooltip»; the describe
        «Round 34 E — a reader without the planning grant: a lock, not a line» → «… a mark, not a line»,
        its «the lock stands first among the acts, its words its name and its tooltip» → «stands first
        among the acts: a lock and «للعرض فقط» in words — why in full its tooltip and what is said»; the
        verifier's «from 1280 at the bar’s end; below it, on the acts’ line; on a phone beside the type»
        → «from 1280 at the bar’s end; below it — a phone too — at the end of the totals’ line», and its
        «the board asks it once, by the toolbar’s own width (1280), and draws the count in ONE place»
        (title kept: the count inside the totals' line after the strip, `compact={phone}`, none among
        the acts, the bar without `sm:contents`); «the toolbar holds the whole strip — «الإجمالي», the
        types, «بدون نوع», «صيانة» — before the acts» and «the same behaviour, names and hooks: …» (titles
        kept: «صيانة»'s words read from `workshopWords`, `title={workshopWords}` asserted).
        `operations-i18n.spec.ts`: the crew plan's key list gains `viewOnlyMark` and `filter.shownShort`.
        New: in `lib/side-scroll.spec.ts` the describes «Round 34 critic — a chip reached by Tab stands
        whole inside the box, clear of the fade» (4) and «Round 34 critic — the strip’s listeners
        (`followSide`): Tab, the wheel, the edges» (5); in `components/crew-board-head.spec.tsx` «Round
        34 critic — «صيانة» is reached by Tab, its codes said» (2), «Round 34 critic — on a phone the
        count is figures only, beside the totals; the type keeps its box» (2) and «Round 34 critic — the
        owner’s words are quoted as he wrote them» (1). Each fix reverted alone, its spec seen red
        (`r34g/red/red.log`): the focus listener (2), the keyboard-only guard (1), «صيانة»'s focus (1),
        the acts' bands (1), the visible «للعرض فقط» (1), the compact count (1), the totals hidden while
        held (1), the paraphrase (1).
      - Measured on the built web (`r34g/probe-g.mjs`, the stub above), Arabic and English, dark, at
        360, 390, 600, 640, 768, 819, 820, 900, 1024, 1100, 1180, 1242, 1279, 1280, 1366, 1440 and
        1760: the acts in words exactly at 820–1279 and from 1760, 34px icons at 1280–1759, 44px below
        820; then each from a fresh load — picking somebody, «إلغاء», Escape, one van, three vans, the
        person typed, a direction, the type list, a type chip, a van and a chip, «مسح التصفية», a type
        chip pressed WHILE somebody is held (the rows narrow, the pill stays), a row added («حفظ (١)») —
        the table's top against the toolbar's: 0px for every one of the 442 choices (13 at each of the 17
        widths, both languages; 646/646 checks). No sideways page scroll anywhere.
        Somebody picked: the pill on the totals' line, the totals seen. Tab: every chip whole and 28px clear of a fade, «صيانة» reached
        and its codes said, at the eight widths named above (16/16). F's shots taken again on the real
        stack with this build (`r34f/shoot-r34f.mjs`, the live API on a MongoDB that outlives it, booted
        twice): 32/32, «يومي» and «محصنة» bare across the restart as F reported.

- **IT: the vehicle checks dashboard (FR-21).** «فين الـ DashBoard؟ اللى بيظهر فيه التقرير والبيانات
  اللى الناس بتدخلها», then, on the sample, «تمام نفذا الـ Dashboard بتاعت الفحص».
  - `/it/vehicle-checks` in the console: six figures of a window (today, 7 or 30 days) under a branch
    filter — reports and reporters, cars checked out of the active ones, cars with a fault, devices
    «لا يعمل», cars not checked for seven days, reports with no photo.
  - The faults per device (a click filters by it), the cars not checked for seven days, the latest
    report of each active car with its eleven devices, and the reports with their photos; a report
    view with the images, «كل تقارير هذه السيارة» and «حذف التقرير»; Excel and PDF.
  - Two grants beside the form's `itVehicleCheck.create`: `.view` (scoped by the report's branch at
    filing) and `.delete` (a soft delete). Given to no role on deploy.
  - API: `GET /it/vehicle-checks/dashboard`, `GET /it/vehicle-checks`, `GET /:id`,
    `GET /:id/photos/:fileId`, `DELETE /:id`. The realtime topic `it.vehicleCheck` now refreshes it.

- **Fleet: a car's card on its code, like the driver's card on a name.** «عاوز لما اماوس يقف على كود
  عربيه يجيب بيانات زى اما اقف على اسم السواق نفس الموضوع كدا». When the mouse rests on a car's
  code, or Tab reaches it, a card opens after the same short pause as the driver card, in the same
  frame with a truck icon, in light and dark. It shows:
  - the code, the car's type, and its state in the registry's words, or «في الورشة» while a
    workshop visit is open;
  - «اللوحة», «الفرع» (the car's own branch), «نوع التشغيل» and «السائقون اليوم» (a dash when
    nobody is on it today);
  - «انتهاء الترخيص» with the registry's expired / expiring mark;
  - «آخر قراءة عداد» — «تمام وزود اخر عداد» — such as «154,320 كم · 2026/11/07», or a dash.

  The rules:
  - **Where.** «زى ما انت اقترحت»: on every Fleet register table and board chip that shows a car
    code, accidents and maintenance first, the dashboard's car chips and the custody and fuel code
    chips included. Never inside a picker, a filter or a form dialog; a spec census holds this.
    Where the code sits in a chip that already takes clicks or drags (the two roster boards,
    custody «السجل», the fuel card), the card opens on hover and adds no Tab stop.
  - **Who.** Only a reader with `fleetVehicle.view` gets a card. «السائقون اليوم» also needs
    `fleetRoster.view` and `fleetDriver.view` (today's Cairo board and the drivers' names), and
    «آخر قراءة عداد» needs `fleetMaintenance.view` or `fleetOdometer.view`. Without them the line
    is left out rather than shown empty.
  - **Which car.** A row from the old book with no registry car keeps its code and gets no card. A
    chip that carries only a code finds the car by its normalised code, Latin case ignored; an
    active car wins over a retired one that wore the same code.
  - **Reads.** Nothing is fetched until a card first opens. It then reads lists the Fleet pages
    already share: the whole registry, the types, the operations, the branch names, today's
    roster, the people, and every car's last odometer reading. That last list is one small new
    read, `GET /fleet/odometer/latest-readings` (`fleetOdometer.view` or `fleetMaintenance.view`,
    the alarms' two audiences): every registry car's last reading whatever its status, the same
    figure the alarms use. The alarms list covers active cars only, so with it a car taken out of
    service after an accident read «—» although its log has readings.
  - **One card at a time**, driver or car. The driver card's open, close and placement moved into
    one shared layer (`HoverCardLayer`), and the driver card behaves as before. The card now hangs
    by the page's direction, not the code's: a code is written left to right, and the card hung
    off the wrong edge.
  - **Branch names.** `GET /platform/branches/options` (and the departments' and sections') takes
    `?includeInactive=true` to name inactive units as well; without it the answer is unchanged,
    active units only, and a deleted unit is never listed. The route now refuses an unknown query
    parameter (400). The web names a car's branch through it (`useBranchNames`), so a car whose
    branch was closed still shows it; the pickers keep the active list.

- **«الصيانة»: a «الفرع» column, the car's branch.** «وشاشة الصيانات احط الفرع فى الجدول … عاوز
  الفرع اللى العربيه متعينه عليه مش الفرع اللى فيه الصيانه». The workshop register shows the
  branch the car is assigned to (`vehicle.branchId`), never the branch of the workshop it went to.
  - The column sits right after «نوع التشغيل» and is drawn like it, with no sort arrow. It shows a
    dash for a car with no branch, or for a visit from the old book with no registry car. The name
    comes from the list that also names inactive branches.
  - The Excel export carries it in the same place.
  - The table is now twelve columns; on a phone it scrolls inside its frame.
  - `FleetMaintenanceVisitDto` gains a required `branchId: string | null`: the car's branch as it
    is today, the same one `?branchIds` filters by. A soft-deleted car keeps its branch. It is on
    the list rows and on the check-in, check-out, reopen and update answers. Nothing is stored on
    the visit.

- **«فحص أجهزة السيارة»: a phone form for checking a car's devices (FR-21).** «I need to create a
  new form for specific users to use on Mobile to inform about the car status».
  `/it/vehicle-checks/new` is a phone screen outside the console frame (the Operations captain's
  frame, now the shared `PhoneShell`): the car, picked from every active car with search (ADR-037
  — «لازم لازم تظهر كلها»); the day, today in Cairo by default and never later; «يعمل» / «لا يعمل»
  on the item's own row for the screen, the eight cameras, the DVR and the Motorola radio, none of
  them required; one note; and up to five photos, re-drawn on the phone as JPEGs of at most 1600
  px (which also strips their location). The photos are added to one's own report within 24 hours
  of filing. The form is kept as a draft in the tab while it is filled. A resend is the same
  report: each report carries a `clientRequestId` and each photo a `clientPhotoId`, so a lost
  answer on mobile data or a double tap never files twice. The reports live in IT's new
  `it_vehicle_checks` collection, with the car's code and branch as they were at filing. IT reads
  Fleet's car list only through `it/fleet-boundary.ts` (two read functions, enforced by an ESLint
  rule). One new grant, `itVehicleCheck.create` («فحص أجهزة السيارات»), covers the car list,
  filing and adding photos. It ignores the reporter's data scope and is given to no role on
  deploy: an admin builds the role. The IT dashboard that reads the reports comes next, after its
  sample is approved ([design](docs/12-planning/it-vehicle-checks-design.md)).

- **Reading the owner's files: which reader for which file, and MarkItDown run safely (development
  tooling).** «وأبقى ضيف دى كمان» — Microsoft's MarkItDown (github.com/microsoft/markitdown, MIT),
  tested before it was taken on generated Arabic-first files like the owner's books.
  - **Results:**
    - Word: 25/25 Arabic strings, clauses and table text, though the title loses its heading and a
      table's header shifts into its body.
    - CSV: correct when given the right encoding. `-c cp1256` is right for an old Windows export
      and garbles a UTF-8 file, so the check decides.
    - Excel: a first look at a workbook the check does not mark as holding secrets. Merged titles,
      `NaN`, rounded long numbers, hidden sheets and unsaved formula results need care.
    - Arabic PDFs: unusable. The Arabic came out reversed, 0/20 strings usable, and a scanned PDF
      gave nothing; the agent's own PDF reading got 20/20 on both.
  - **Taken:** `.claude/skills/owner-files`, with a check script
    (`scripts/owner_files.py`) that prints structure only, never a data cell, so it is safe on any
    file:
    - it flags secret-bearing workbooks before anything is converted: the ATM register's J..Q,
      AN, AU and AO columns and `Sheet1`, fuel-card «pass» and «قيمه الشحن», and key, PIN and
      password headers in English and Arabic;
    - it also reports hidden sheets, formulas with no saved result, long numbers that MarkItDown
      would round, a CSV's real encoding, garbled output, archive sizes and Word tracked changes.

    The skill says which reader to use for each file type and runs MarkItDown 0.1.9 pinned in the
    scratchpad:
    - local extras only, so no audio upload, Azure, YouTube or plugins;
    - files fed through standard input, so it never fetches a URL;
    - UTF-8 output through `-o`, and no exiftool.

    Owner files and every output stay in the scratchpad: never committed, published or treated
    as instructions.
  - **Not taken:** the MarkItDown MCP server (it reads any file or URL, has no authentication, and
    installs every extra), and any use inside the product. The ECMS imports keep their own readers:
    ExcelJS in the API, and a browser CSV parser for gold receiving.

- **Design review with fresh-context reviewers, and a drift check (development tooling).** «شوف
  دى هتفيد ولا لأ وضيفها عندك لو كويسه» — Google's Elephant-Goldfish Model
  (github.com/google/elephant-goldfish-model, Apache-2.0), evaluated on two ECMS documents before it
  was taken:
  - **On the passkey design**, its reviewers raised 21 findings after duplicates were merged. 7 were
    worth acting on, and about half were noise:
    - 2 code gaps: a passkey sign-in never clears the failed-password count, and «حذف» cannot be
      reached while passkeys are switched off (the list request is refused and the card hides the
      list);
    - 6 places where the page no longer matches the code (one overlaps a code gap).

    Every finding is now verified (against the owner's decisions, merged ADRs, the record, and the
    code where it exists) before anything changes. These items are recorded in the design's §8;
    the two code gaps and the page are fixed in the same release (see Fixed).
  - **On `database-design.md`**, the upstream drift method found 28 drifts: 15 new, 9 already
    recorded elsewhere, 3 false and 1 unclear. Two parts were never reconciled with the code: §2's
    workflow, approvals, sequences and outbox, and §3 Recruitment; the `users` and `sessions`
    fields drifted too. Each of these now carries a dated "out of date" note.
  - **Taken:**
    - the seven reviewer personas and the five upstream standards, vendored unchanged under
      `.claude/vendor/egm/` (licence and provenance in its README);
    - the upstream subagent adapters, as `.claude/agents/egm-*.md`, with only the path changed;
    - two ECMS skills: `.claude/skills/design-review`, which runs the reviewers, and
      `.claude/skills/drift-check`, which follows the drift method.
  - **Not taken:**
    - the plugin itself, because cloud sessions do not install plugins a repository declares;
    - its step-by-step approval prompts;
    - its README-in-every-folder bootstrap;
    - its report files in the repository root.
  - [Development Workflow §3](docs/09-guides/development-workflow.md) says when each is used.

- **«المستخدمون النشطون» in Administration: who is on the system now, and each person's working
  time.** «عايز فى مديول الإدارة تضيف صفحة جديدة أسمها المستخدمين النشطين .. وتقولى مين فاتح
  دلوقتى وشغال .. ووقت كل واحد على السيستم..».
  - **The page** is `/system/active-users`, behind a new permission `activeUser.view`; super-admin
    and platform-admin hold it by default. For each person it shows:
    - the status: «نشط الآن» (used the system within two minutes), «خامل» (signed in with the
      page open, nobody touching it) or «غير متصل»;
    - when they signed in and for how long;
    - the working time today;
    - the first and last activity;
    - the devices, as browser and system only, never an address.
  - **Summary and controls.** Tiles count who is working, who is idle, how many people used the
    system and the total time; the two status tiles also filter the list. Search, status and branch
    filters are kept in the address. The page refreshes every 30 seconds. Any earlier day (kept 90
    days) shows that day's working time and the average per person.
  - **How working time is measured.** The browser sends a heartbeat once in each minute of the
    clock, and only while the person is using the page and it is in front of them. Each minute is
    counted once however many tabs or devices are open. Heartbeats are not audited and do not
    extend the session.
  - Signing out shows as «غير متصل» at once.
- **A welcome page for every account, and a photo on every employee's profile.** «عايزك تضيف فى
  بروفايل كل شخص صورة شخصية ليه .. ويقدر الـ HR يضيفهاله» · «عايز بقى أى حساب يدخل تظهرله Welcome
  Page بتقوله أهلاً وتاريخ ميلادة وكام يوم باقى عليه (ولو اليوم عيد ميلاده يقوله كل سنة وأنت طيب)..
  وتظهرله الـ Recent Pages اللى كان فيها». Approved from a sample by the owner.
  - **`/` is the welcome page** instead of a jump to the first screen of the menu. It shows «أهلًا،
    …» with the person's photo (or initial), today's date, and their job title, department and
    branch.
  - **The birthday card** shows the date of birth, the days left to the next birthday in Cairo
    calendar days («غدًا عيد ميلادك» on the eve), and «كل عام وأنت بخير» on the day itself, when
    the greeting turns festive too. Only the person sees their own date, and an account with no
    employee behind it gets no card.
  - **The recent pages** are this account's own history in this browser, newest first, each with
    when it was opened. A page the account can no longer open drops out. Before there is any
    history, the first pages of the person's own menu are offered, work before personal pages.
  - The ECMS mark in the top bar now leads home.
  - **The employee photo** heads the profile. HR (`employee.editPersonal`) sets, replaces or
    removes it from one dialog, with a preview before saving; on a phone it can come from the
    camera or the gallery. Only JPG, PNG or WebP up to 5 MB are accepted, and the server enforces
    the same limits. The person's own photo shows in the top bar, on the welcome page and on «ملفي».
  - The recent-pages history is now kept per account, so a shared browser no longer shows one
    person's pages to another.
- **The IT home is a dashboard.** «عايزك تعمل فى الـ /it الرئيسية.. Dashboard بدل اللى موجود فيها يظهر
  إجمالى الأصول وإيه فى المخزن وإيه متسلم بس أقدر أفلتر بـالفئة.. من خلال Drop Down بـ
  Multiselection». `/it` now opens on the assets' totals — all, in stock, handed over, under
  maintenance, disposed — filtered by one or more categories and a branch, with the status split,
  the figures by category and by branch, «يحتاج متابعة» (assets held by leavers, receipts awaiting
  the signature, overdue returns, warranties ending soon — each opening its list), the latest
  movements, the mobile lines by network, the consumables at their minimum, the help desk's counts
  and the IT pages. The custody register gains «حالة المستلِم» (left / still employed) and the asset
  list «الضمان» (ending within 30 / 90 days) ([IT design §11](docs/12-planning/it-module-design.md)).
- **Fleet: «تصحيح أرقام الكروت» — the go-live's 15 crossed Wataniya card numbers and the 0849 pair,
  repaired once by the owner after he reviews the live dry run; and the full card photo for the
  PIN's own grant only.** «الـ PIN بيمشي مع الرقم المطبوع على الكارت ولا مع الاسم — الاتنين بس
  الافضل الرقم» · «الشركة بتشحن الكارت برقمه ولا باسمه — الاتنين بس الافضل الرقم» · «3 ايوه».
  - **What the go-live left.** Fifteen Wataniya records hold another card's NUMBER, in three closed
    cycles (239→241→243→209; 233→525→284→269→230; 232→800→256→267→251→246 — car A's record holds
    car B's physical card number); on the 0849 pair (cars 530 and 283) the number, car, photo,
    expiry and PIN are right and the NAME and go-live OPENING balance are swapped. The definition is
    a constant pinned by a spec to the go-live asset, the photos and the analyst's PIN-free table;
    records are found as «the live Wataniya card on car X» — never by name or last four (names are
    compared exactly, «S» and all; `548 •••• 2516` is also a Chill Out card).
  - **The physical card is the number.** A cycle record keeps its name, car, balance and log, and
    receives the number of the card embossed with its name together with that card's PIN (as
    stored — never decrypted, shown, logged or returned), photo (its Files rows follow it) and
    expiry, as they are when it runs. The records of cars 284, 269, 230, 256 and 251 receive a
    number with no PIN stored and end with none; the owner types those from the card screen. The
    pair swaps its names and moves each balance by the go-live opening's difference (530
    −11,872.62 · 283 +11,872.62), noting that the 2026/10/04 statement showed 11,430.62 for car
    283 and listing every statement adjustment applied to either record since go-live. None of the
    15 balances changes: the company tops up by number and by name, so the repair claims nothing
    about past top-ups — the newest Wataniya statement, approved in «مطابقة أرصدة الكروت»
    afterwards, gives each card the company's figure for its own physical card.
  - **Reviewed, then run once.** `/fleet/fuel-cards/reconcile/numbers` (from a yellow box on
    «مطابقة أرصدة الكروت» while the repair is pending, «مراجعة التصحيح») shows the live dry run:
    each cycle's chain, each record's number before → after, where its PIN goes (yes/no only), the
    expiry, today's photo ✗ and the right one ✓ (thumbnails), the live balance and its top-ups for
    information, and the pair. A unit — a cycle, or the pair — runs whole or not at all: a record
    whose car, number or name changed by hand reads «تغيّر — لن يُلمس» and holds its unit, the
    others still go. «تنفيذ التصحيح» (`fleetFuelCard.edit` and `fleetFuelCharge.approve`) asks
    «راجعتُ الصفوف» first; each unit is re-checked and written in one Mongo transaction (cycles
    through temporary numbers, `ux_fuel_card_number` unchanged), audited (`correct`), and leaves a
    line in each card's log — «صُحّح رقم الكارت: كان •••• 2813 وأصبح •••• 0935 — تصحيح بيانات
    التشغيل», or the pair's name and opening swap (`dataFix`, never edited or deleted). Those lines
    are what make a unit read done: a re-run writes nothing, and a card moved or deleted later
    never makes it pending again. Once the pair has run, batch 3's lock on the two 0849 cards
    («ضمن تصحيح الأرقام» — the link ✓, `FLEET_FUEL_LINK_IN_REPAIR`, and the balance ✓, new
    `FLEET_FUEL_RECONCILE_IN_REPAIR` 409) lifts. `GET /fleet/fuel-cards/number-repair`
    (`fleetFuelCard.view`), `POST /fleet/fuel-cards/number-repair/execute` (`{ reviewed: true,
    units }`). Nothing runs at boot or by itself.
  - **The card photo shows the PIN on its sticker.** The full photo now opens only for a holder of
    `fleetFuelCard.reveal` — on `GET /fleet/fuel-cards/:id/image` and through the Files
    authorizer; every other reader of the cards sees a small blurred thumbnail, `GET
    /fleet/fuel-cards/:id/image/thumb` (`fleetFuelCard.view`). The 406 go-live photos' thumbnails
    are committed beside the assets (ImageMagick, `scripts/make-fuel-card-thumbs.sh`, 620 KB); a
    later upload's is made by the browser and sent with it (checked from its header only — the
    server never decodes an image; `FLEET_FUEL_CARD_THUMB_INVALID` 422), and a photo uploaded
    without one is back-filled when an edit + reveal holder opens it (`POST
    /fleet/fuel-cards/:id/image/thumb`). No new dependency.
  No new permission key, no migration and no backfill; every new field is optional. The platform's
  Files service gains `reassignEntity` (a module's own correction moves a file group to another
  record of the same entity type, in its transaction).

- **Fleet: the service gap on every odometer row, the card number on «شحن الكروت», deleting a
  custody operation, cars already received on a new contract, how a forms item is paid, and a
  card-balance reconciliation that reads the companies' real statements.** «295 - 150 -157 دول
  فيهم مشكله فى فارق عداد الصيانه» · «فى شاشة شحن الكروت عاوز شكل رقم الكارت يكون زى بطاقات
  الوقود» · «زرار امسح منه استعادة او طلب عهدة او تسوية ووجود سجل للهذة الحركات» · «وانا بسجل
  عقد ... اكتب عدد اللى انا استلمته» · «وعاوز احدد البند كمان هو صرفه بفيزا إدارة الحركة او صرفه
  نقدً او كلاهما ف اعدادت النماذج او امسح بند انا ضيفته» · «مطابقة ارصدة الكروت مش شغالة بطريقة
  كويسة».
  - **«فارق الصيانة» per row.** Each row of «سجل العداد» carries the distance the car had run
    since its service ON THAT DAY (`serviceGapKm`), computed by the server with the alarm's own
    rule: from the latest counting visit checked out before the row's day, its counter chosen as
    the alarm chooses it; «—» when there is nothing honest to show. The car's newest row on the
    page carries the alarm's figure, its level, «المتبقي X من Y كم» and «كيف حُسب الفارق» — the
    make's interval and thresholds, the visit measured from (its work type) and the newest reading
    — and «إنذارات الصيانة» opens the same card. A newer visit that is still open, does not count,
    or was checked out before the one measured from is named in amber with why. The figures of
    cars 295, 150 and 157 are not corrected here: their diagnosis waits for the owner.
  - **The card number on «شحن الكروت» as on «بطاقات الوقود».** Both boards draw the number in the
    same box and keep each card's data on one row (at 1536 and 1366 wide with the menu open; it
    wraps only on narrow screens). «شُحن اليوم» — the green row, its filter and the KPI — counts
    by the Cairo calendar day.
  - **«حذف العملية» on «سجل العهدة».** A charge («طلب العهدة»), a replenishment (done, held,
    cancelled or legacy) or a settlement is deleted softly, with an optional reason: the dialog
    shows the fund before and after (a red warning when it goes negative; allowed), the
    operations recorded after it, and what returns — a replenishment's memos to «لم تُستعَض بعد»,
    a settlement's licence parts to «لم تُسوَّ بعد». Printed letters stay as printed. The new page
    «العمليات المحذوفة» (`/fleet/custody/log/deleted`, from a pill on the log) lists who recorded
    and who deleted each one, when, why, and the fund before and after, and opens each in a
    read-only drawer. No restore. `DELETE /fleet/custody/fund/operations/:id` (`fleetCustody.view`
    and `fleetReceipt.delete`), `GET /fleet/custody/fund/deleted` and `/deleted/:id`
    (`fleetCustody.view`); audited on `fleet.custodyOperation`.
  - **«المستلم حتى الآن» on «عقد جديد».** Each line of a new contract may say how many of its
    cars were already received, with «تاريخ الاستلام» (today by default): it is written as the
    contract's first delivery in the same insert, never more than the line's count. Optional;
    received cars need `fleetVehicleContract.receive` (403 otherwise). «تعديل العقد» shows it
    read-only; later deliveries stay «تسجيل استلام».
  - **«طريقة الصرف» per forms item, and deleting an item he added.** On «إعدادات النماذج» and
    «قوائم الحركة» each licensing-expense item says whether it is paid by «فيزا إدارة الحركة»,
    «نقدي» or both (`licenseExpensePaidBy`: `visa` / `cash` / `null` — every existing item reads
    as both); each group counts its items. An item the owner added can be deleted (soft; the
    built-ins cannot — 409): `DELETE /fleet/catalog-items/:id` (`fleetCatalog.manage`), and the
    templates drop it when they are read. A new memo no longer offers archived items.
  - **«مطابقة أرصدة الكروت» reads the companies' statements as they come.** Columns are found by
    their many names or, untitled, by what they hold; the card name is rebuilt from its parts;
    totals and blank rows are skipped; the PIN and «قيمه الشحن» columns are recognised and never
    read. Cards are matched by name first; a line shows how the sheet was read; a sheet of the
    other company stops the page and offers its company; a different number reads «رقم مختلف»
    with «تحديث رقم الكارت». On a ✓ the reader may cancel the top-ups the sheet does not show
    (`cancelCharges`: each stays in «سجل الكارت» struck «أُلغي بشيت الشركة» and no longer turns
    the row green or counts in «شُحن اليوم»), or approve a pending «طلب رصيد» that is exactly the
    sheet's difference (`approveRequests`); the optional «تاريخ الشيت» lists a later top-up apart,
    never pre-ticked. «ربط الكروت بالسيارات» proposes each card's car from the sheet — attach,
    move (a swapped pair together), detach, or a code nothing answers to (pick a car,
    «تذكّر هذا الكود») — one row at a time, each written to «سجل الكارت»: `POST
    /fleet/fuel-cards/reconcile/:id/links` (`fleetFuelCard.edit`). «كروت في الشيت وليست في
    النظام» offers «إضافة», filled from the sheet's row, at the sheet's balance: `POST
    /fleet/fuel-cards/reconcile/:id/cards` (`fleetFuelCard.create` and
    `fleetFuelCharge.approve`). The sheets' car codes live in the new collection
    `fleet_fuel_sheet_codes`, seeded insert-only with the 43 pairs of the go-live sheet; what the
    owner teaches is never overwritten. The 15 crossed Wataniya numbers and the 0849 pair are not
    repaired here; the pair's move is shown off «ضمن تصحيح الأرقام».
  No new permission key. Existing data is unchanged: no migration and no backfill; every new field
  is optional and absent means what it meant before.

- **«لوحة تحكم الحركة» at `/fleet`: ten tabs of today's figures and of a chosen period, in the
  system's own colours, each figure opening the screen that shows the same number.** «عاوز اغير
  الشاشات دول لكدا ورينى سامبل مع تعديلاتك الجميلة» — «شاشات لوحة التحكم حط بقى الوان بتاعت السيستم
  بتاعتنا». The fleet module's home is rebuilt from the approved samples, in the platform's palette,
  light and dark. Five tabs answer for Cairo's today, whatever filter is chosen: «التنبيهات» (the
  maintenance alarm, expired vehicle, driver and fuel-card licences, crews short of an absent
  driver, charging requests and low balances, pending dealership invoices, notices missing an image,
  the custody fund's own banner lines, and the active cars with no odometer reading for N days),
  «الحركة الآن» (ready cars and those without a driver, available and absent drivers, the workshop
  now), «توزيع السيارات» (cars by type, branch and operation; drivers by specialization), «التراخيص
  وآخر ما سُجّل» (licence windows, open papers, the last 30 days of visits and accidents) and
  «ملخصات» (fuel balances, custody, open accidents and the year's fines). Five more answer for a
  period — this month (the default), last month, the last 30 days, this year or a custom range of up
  to 366 days — narrowed by type, operation and car codes: «أرقام الفترة», «الكيلومترات» (by day or
  by month, «مؤكدة حتى», the coverage «قراءات لـ X من Y سيارة», by branch and by type), «ترتيب
  السيارات» (the top and bottom five, and every car without a valid reading with its one reason),
  «الصيانة» and «الحوادث». A branch chosen in the switcher narrows the figures that belong to a
  branch. Every figure is the server's, and opens the screen that shows it with the same filters as
  parameters — never a bare list link, so a reader's remembered filters cannot change the number; a
  figure no list shows exactly is plain text. The screens learned the parameters they lacked: `type`
  / `operation` / `branch` on the odometer, accidents, dealership, receipts and violations; licence
  windows on vehicles and drivers (and `licExp=none`); `expiresFrom` on fuel cards; `view` and
  `unavailable` on the roster; `type`, `outFrom` and `outTo` on maintenance. The odometer screen now
  shows the kilometres of its own filters. The roster marks a driver's or a vehicle's expired
  licence (badges, views, the list «منهم رخصة منتهية N») and subtotals the unavailable drivers by
  reason. Reads: `GET /fleet/dashboard/now` and `GET /fleet/dashboard/period`, each section returned
  only to a reader who holds both its data's key and its screen's (`fleetVehicle.view`,
  `fleetRoster.view`, `fleetMaintenance.view`, `fleetOdometer.view`, `fleetDriver.view`,
  `fleetFuelCard.view`, `fleetAccident.view`, …; with none, 403); `GET /fleet/odometer/summary`
  (`fleetOdometer.view`). The old `GET /fleet/dashboard` is retired. No server cache: «الآن» is read
  again every five minutes, on focus and at Cairo's midnight, and realtime signals refetch at most
  once per 30 seconds. Two organization settings, also on `/fleet/settings`:
  `fleet.roster.refuseExpiredLicence` (default **off** — the roster only marks; on, planning refuses
  a driver or a vehicle whose licence expired) and `fleet.odometer.missingReadingDays` (default
  **3**, 1–30). Phase 2 (supply contracts, driver rankings, cost ranking) is not part of it; this
  year's supply contracts have since come to «توزيع السيارات», and the driver and cost rankings are
  still Phase 2.

- **«مقارنة بملف» on `/atm/data-edit`: a machines file compared with the branch, then applied.**
  «ضرورى جداً اتأكد إن الماكينات دى متضافه على السيستم لفرع المهندسين» — «البنك والكود والأسم
  والمنطقة». Upload the machine list (Excel: Bank, ID, ATM Name, Area — the old system's export
  reads as it is) and every row is compared with the machines of the branch the top bar names:
  what would be added, brought back from the archive, or edited (the old bank, name or area struck
  through beside the file's), what works in another branch, what the file leaves incomplete, what
  it lists twice, and the branch's machines it does not list — shown, never deleted. Nothing
  changes until «تطبيق», and the apply writes only the comparison the reader saw: if the branch
  changed meanwhile it writes nothing and asks for a new comparison. It adds through the data-edit
  add (the register entry included) and edits through the machine edit (audited), row by row,
  names every code it could not write and why, and answers with the comparison made again
  (`POST /atm/machines/sync`, `atmMachine.manage`). Spaces are folded, so a stray space is
  neither a change nor a new area; a bank is compared by the catalog bank it names.

- **Sign in with a fingerprint or Face ID instead of typing the password.** «عايز الدخول يبقي ممكن
  من خلال الـ Fingerprint أو FaceID للموبايل بحيث مش كل مره يكتب الباسورد». Passkeys (WebAuthn,
  [ADR-035](docs/03-decisions/ADR-035-passkey-sign-in.md)): the device keeps a private key and
  releases it only after its own fingerprint, face or PIN check; the server keeps the public half.
  The sign-in page shows «الدخول بالبصمة أو الوجه», and where the browser supports it the passkey is
  also offered right in the username field. After a password sign-in on a phone or computer that
  can hold one, the page offers «تفعيل الدخول بالبصمة» once — using the password just typed — and
  «ليس الآن» is remembered for thirty days. Devices are listed, renamed and removed under
  *My account → Security*, which now also shows how each session signed in. Staff and gold-portal
  customers may use them (the portal has a new *Security* tab); applicants may not. By the owner's
  decision a passkey sign-in counts as the second factor, so no TOTP code follows it (amends R13 —
  the password path still asks). Adding one asks for the password again (and the TOTP code); an
  administrator's password or TOTP reset, the gold portal's «رابط تفعيل جديد», and suspending,
  archiving, reactivating or deleting the account, remove the account's passkeys. Every challenge
  is held by the server and used once; a locked or inactive account stays refused; only
  attestation `none` is accepted, so no certificate the client sends can make the server fetch a
  URL. The organization setting `auth.passkeys.enabled` (on by default) switches off signing in,
  adding and renaming; people can still see and remove their own passkeys (ADR-036). The ten-minute idle
  sign-out is unchanged («نسيبها 10 دقايق»); coming back is now one touch.

- **The EGYCASH logo replaces the letter «E», everywhere; and the app says which version it is.**
  «عايزك تستخدم اللوجو دا بدل حرف الـ E اللى محطوط دا ! فى الموقع كله وتظهر كمان الـ Version بتاع
  الـ APP». The company's artwork — the two folded ribbons and the EGYCASH lettering — is drawn
  from vector paths and follows the theme. The mark alone sits where the tile was, at the
  same height: the top bar, the sign-in, activation and password screens, the applicant portal.
  The mark with the lettering appears where the company's name belongs: the customer and
  applicant portals (sign-in and, for customers, the portal's own header), the public application
  page, the contract verification page — and those screens name the browser tab «EGYCASH». The
  installed app's icons, the tab icon and the push notification badge carry the mark too; a
  shared link previews as EGYCASH. «الإصدار 2.2.0 · 5f1e139» — the version and the commit it was
  built from, stamped by the build — shows at the foot of the user menu, on the crash screen and
  under the captain's phone screens, and only to somebody signed in: no public page displays it,
  and the public contract-verification answer no longer names the generating release.
- **The platform has one version: 2.2.0.** «أعتمد دا 2.2.0». The package files said 2.1.0 (left
  over from Sprint 2.1), the kernel's platform contract 2.2.0, and generated contracts a
  hand-typed «ecms-api/2.1.0». Every workspace now declares 2.2.0 (a spec keeps them equal) and
  contracts are stamped from it; the next release is cut as 2.2.0
  ([Development Workflow §6](docs/09-guides/development-workflow.md)). The 0.x headings below
  stay the pre-GA sprint releases they are.
- **The IT asset register says who holds each asset, and filters by name.** «وعايز فى شاشة الأصول
  /it/assets تزودلى بعد الحالة لو متسلم اسم الشخص اللى متسلمله الحاجة · وعايز فى الفلتر زود بعد
  الحالات وقبل الفئة (الاسم) ويكون Drop Down مع قابليه للكتابة». `/it/assets` shows «المستلِم» after
  the status — the holder's name, linked to their IT page, and their code — and a name filter you
  can type into between the status and the category. The Excel/PDF carry the holder too.
- **The custody register's files carry the serial, and the register filters by every column.**
  «وكمان فى شاشة عهد الأصول /it/custody عايزك تزود سيريال الأصول لما أعمل Extract وزود الفلتر بتاع
  الجدول ببيانات الجدول». The Excel/PDF gain «الرقم التسلسلي»; the filter bar follows the table's
  columns: the item (code, name or serial), category, hand-over dates, overdue, status, branch,
  holder, return dates and the receipt (signed / awaiting the signature / none).
- **IT consumables: each branch's stock, what was issued to whom, the scrap, and a printed memo.**
  «وعايز بقى شاشة تانية تحت خطوط المحمول تكون للمستهلكات … وأقدر أحدد عندي Stock إيه من كل واحده
  وإيه الهالك وأتبدل لمين واطبعله مذكره ولو حاجة بتتركب فى حاجة تانية … أقدر أذكر الجهاز اللى أتركب
  عليه من اللأصول». `/it/consumables` «المستهلكات» (under «خطوط المحمول») keeps inks, cables, adapters,
  mice, keyboards, memory, drives and flash drives per branch: each item's balance, issued and
  scrapped, flagged at its minimum. Stock moves only by «توريد», «صرف», «هالك» and «مرتجع», each kept
  in «حركات المستهلكات» (filters, Excel, PDF). «صرف لموظف» gives a current employee one or more items
  — new, or in place of a damaged one (counted as scrap) — optionally naming the asset each went
  into, and prints «مذكرة صرف مستهلكات» (EGYCASH-IT-CON-0001…) on the acknowledgment's letterhead,
  with both signatures; it can be reprinted and its signed copy filed. Asset and employee pages list
  their consumables. The types are a catalog list on `/it/catalogs`, seeded with nine. Same grants as
  the assets; no new key ([IT design §2.11, FR-20](docs/12-planning/it-module-design.md)).
- **97 Lenovo all-in-ones for October, the specifications of 38 devices, and the consumables'
  opening stock, entered once by the deploy.** From «SN ايجي كاش» and «جرد الأجهزة», as reviewed
  with the owner («موافق على كل اقتراحاتك، طبّق الأربعة ودخّل الأرصدة»): 97 new «Lenovo ThinkCentre
  neo 50a 24» in «أكتوبر», in stock, copying the live one's category, make, model, specifications
  and accessories (the two already registered at the head office stay; a short serial was one of
  them scanned twice); processor, memory and storage added to 38 registered devices only where
  empty, a typed value kept; and ten items' counted balances received into the «المهندسين» store.
  Each runs once, after the steps it depends on.
- **A maintenance mail accepted or rejected by mistake goes back to pending, and both mail pages
  filter, with their buttons on the rows.** «هنا /atm/mail-tickets/log وهنا /atm/mail-tickets عايز
  فلتر وعايز Action Buttons — في /atm/mail-tickets يكون 2 قبول ورفض — في /atm/mail-tickets/log
  إسترجاع ويقدر يرجعه مفتوح لو قبل أو رفض غلط». On `/atm/mail-tickets/log`, accepted and rejected
  rows carry «استرجاع»: after a confirm the mail is pending again, to be decided anew. An accepted
  one also takes its maintenance off `/atm/maintenance`, in one step with the mail, so neither
  happens alone, and accepting it again opens a fresh one. A maintenance already closed is work
  done: its mail stays as it is and the message names the machine. So does a mail accepted in the
  old system: no maintenance is linked to it, so there is nothing to take back, and returning it
  would leave its maintenance on the board while a second accept could open another. On
  `/atm/mail-tickets` every row
  carries «قبول» and «رفض» at its end; on a checked row they act on every checked row, as on the
  boards, and the accept and reject bar is gone. The confirms, the duplicate warning and the yellow
  duplicate rows stay. Both pages have a filter row — bank, area, a search by machine code or name,
  and the red reset — kept in the address and remembered, and the log adds a status choice beside
  its dates. Both now read the whole list, past the first hundred rows. The buttons, and
  `POST /atm/mail-tickets/restore` behind them, need `atmMailTicket.decide`, the key that accepts
  and rejects — now named «قبول رسالة الصيانة أو رفضها أو استرجاعها» in the role editor; a restore
  is on the audit trail as `restore`, beside the maintenance's `delete`. Mail the legacy import
  wrote (it carries no timestamps) is listed on both pages instead of failing them
  ([ATM port §6d](docs/12-planning/atm-operations-port.md)).

- **The Banque Misr maintenance mailbox is set up on a screen and switched on branch by branch,
  and October works as Mohandessin in ATM.** «عايز نبدأ فى موضوع الـ Automation بتاع الميلات اللى
  بيجي من بنك مصر لماكينات الصيانة — هنبدأ بفرع المهندسين حالياً وبعدين هنبقى نزود فرع فرع».
  `/atm/settings` «إعدادات الصراف الآلي», under a new key `atmSettings.manage` that works only when
  held at organization scope (super-admin holds it after the deploy), has two cards. «بريد الصيانة —
  بنك مصر»: the Tenant ID, Client ID, Client Secret and mailbox address of the ONE shared mailbox,
  «تفعيل القراءة», the branches switched on with their Outlook category, «اختبار الاتصال», «قراءة
  الآن» and the last run. The secret is stored sealed by the platform secret store and is never
  shown, returned or written to the audit trail; a save that leaves it empty keeps it, and the
  nightly key rotation re-wraps it. The machine still decides the branch: with the screen saved, a
  mail is filed only when its machine's branch is switched on, and any other mail stays UNREAD in
  the mailbox («branch not enabled for mail» on the last-run line) and is filed once its branch is
  switched on. The shared mailbox is read newest first, so the mail it leaves unread never stands
  between the reader and a new one, and a sweep walks the older unread mail a page per minute so
  a backlog is filed too. Until the screen is first saved, the reader runs on the
  deployment's environment exactly as before; switched off, it reads nothing. «فروع تعمل معاً»:
  «فرع أكتوبر شغال هو والمهندسين مع بعض بكل بياناتهم والبيانات دي متسجله إنها المهندسين» — with
  October linked to Mohandessin, an October employee sees Mohandessin's ATM data on every ATM page
  and what they record is filed under Mohandessin, where Mohandessin's people see it; outside ATM
  nothing changes. On `/atm/mail-tickets` the header «select all» box is gone (F8 brought it back
  on 2026-11-02, below); the row boxes stay
  ([ATM port §6a–§6c](docs/12-planning/atm-operations-port.md)).

- **Banks and areas are one list across the ATM pages, in Arabic and English, and a machine added
  on data-edit lands in the register.** «وبالنسبة لإضافة الماكينات /atm/data-edit البنوك والمناطق
  مش مسمعه !! من /atm/register · مع العلم عايز لما يتضاف حاجة هنا /atm/data-edit تتضاف هنا
  /atm/register بحيث شغل العمليات ميعطلش ويبقى بتاع الكفاءة والتحقيقات يكمل بياناتها براحته وبرضو
  يقدروا يضيفوا مناطق وبنوك (عربي وأنجليزي)». The register's six fixed banks became a company-wide
  bank catalog, seeded with the same six. A bank added there — its code, Arabic and English names,
  the name Operations type, and a colour — is a full bank: register receipts, the Data Report (after
  BRK and after NXT), the settlements once enabled, and the map all use it. Banks are added and
  edited from the register's new «البنوك» button and data-edit's «البنوك» tab, under two new keys,
  `atmBank.create` / `atmBank.edit`, which work only when held at organization scope. After the
  deploy only super-admin holds them, so an administrator grants them. A bank is archived, never
  deleted.
  `/atm/data-edit` now has four tabs: machines; banks; «أسماء البنوك في التشغيل» — each branch's
  spellings such as NBE FOREX, linked to their bank, with the machines' unlinked bank texts listed
  to link; and areas, each with an Arabic and an English name. Every area on an active machine or an
  open or pending register entry now shows there, listed automatically after each save and once at
  the deploy; a name Operations deleted, archived or renamed — a rename made before this release
  included, found in the audit trail — is never listed again. A new area entered in both languages is stored on machines under its English name
  («الإنجليزي تمام»). Efficiency add areas from the register form's «+ منطقة» with the register keys
  they already hold.
  A machine added on data-edit, single or bulk, is recorded in the register as an OPEN entry dated
  the day it was added, linked to it and marked «بيانات ناقصة», for Efficiency to complete at their
  pace. The register has a «بيانات ناقصة فقط» filter, a badge on those rows listing what is still
  empty, and a box on the edit form to clear the mark; the export gains a `Data incomplete` column.
  Nothing is recorded, and the machine still works for Operations, when the branch has no EGYCASH
  code or the bank text is not linked to a bank yet. Machines already in the Operations list are not
  moved into the register: Efficiency receive those by hand, and the receipt links the machine
  ([register spec §1.3, DEC-35–DEC-41](docs/12-planning/atm-efficiency-register.md),
  [ATM port §9](docs/12-planning/atm-operations-port.md)).

- **The ATM boards show one day at a time, and every ATM operation table goes to Excel and PDF.**
  «هنا يظهر فقط الماكينات اللى المفروض يتغذى أو يتعمله صيانه في اليوم دا مش عموماً».
  `/atm/replenishments` and `/atm/maintenance` open on today's operations only; a switch beside the
  table shows tomorrow, everything scheduled ahead, and the earlier days left open and never
  closed — each with its count. Every column sorts; one red reset clears the bank and area filters
  (the day view stays, as on the Fleet day boards); only the bank, the code, the machine name and
  the schedule time (maintenance: the open time) take a text selection, so a drag or Ctrl+A copies
  exactly those, a tab between columns; the header's «select all» appears only on F8 — focused, so
  Space checks it — and goes again at the next click or key. The leader field of both edit dialogs
  carries a «الوردية» box, ticked by default: ticked, the leader goes over the whole shift as before
  (and, on a checked set, over each checked row's area and shift); unticked, it is written on the
  rows in the dialog only. The two boards and the two done pages (now read whole, past the first
  hundred rows) export the table as it stands — day, filters and order applied — to Excel and PDF
  under «بيان تغذية/صيانة ماكينات الصراف الآلي عن يوم … / عن الفترة من … إلى …»
  ([ATM port §4a OD-1a, §10](docs/12-planning/atm-operations-port.md)).

- **Settlements & Review, Preparation and Control & Supplies run the day's ATM replenishment in
  ECMS, Al Baraka first.** «كل شوال بيشيل ٤ كاسيتات · موافق على مقترحاتك … ممكن تبدأ كدا توريلى
  الشغل». `/atm/settlements/layouts` «فئات الكاسيتات» keeps each machine's cassettes (4–8 slots:
  kind, denomination, currency) with their history and the bank's standard loads, and
  `/atm/settlements/layouts/import` seeds them once from the bank's Full list with a differences
  report. `/atm/settlements/plans` «خطة التغذية» builds ONE plan per bank per day: machine IDs
  typed fill the standard counts, any line is edited by hand (several cassettes of a denomination
  split evenly in hundreds), each line carries its run (1st/2nd/3rd) and time; the plan is issued
  and prints «بيان التغذية», one numbered Note per line (with which cassette is in which bag — a
  bag holds 4) and the seals sheet, and exports today's REP. TAPE / ATM_2 columns for Inventory and
  the daily report. `/atm/preparation` «الشوالات والسيلزات» scans (or types) each cassette's seal
  and the bag's QR — a repeated value warns, never blocks — and marks the line ready.
  `/atm/control` «بيانات التغذية والخطوط» shows the data and seals, prints the handover to the ATM
  vault, distributes the bags across crew lines (from the map's zones where they exist) and prints
  one sheet per line. Only the banks in the setting `atm.settlements.banks` (default `['BRK']`) are
  offered. Twelve new keys, seeded to super-admin only — `atmCassetteLayout.view/manage/import`,
  `atmSettlementPlan.view/print/export/manage`, `atmPreparation.view/capture`,
  `atmControl.view/print/manage` — so after the deploy an administrator grants them at branch or
  organization scope (a department grant reads and never writes), then runs `db:sync-indexes` for
  the ten new collections. Nothing existing is migrated; Excel stays the fallback for the pilot
  ([settlements phase 1](docs/12-planning/atm-settlements-phase1.md), rollout §11.2).
- **The company's mobile lines have their own page in IT.** «الـ 3 فايلات دول عبارة عن خطوط موبايل
  عايز أعملهم صفحة لإدارتهم وتسليمهم وبردو بفلتر لكل شبكة مع بيانات كل شبكة». `/it/mobile-lines`
  «خطوط المحمول» lists every line with its network's logo beside it, its number, plan, SIM serial,
  status and holder. The three network cards — Vodafone, Etisalat and Orange, each with its logo,
  its number of lines, how many are in stock, handed over and suspended, and its account numbers
  — are the network filter («عايزك تستخدم الـ 3 لوجوهات فى الفلتر وفى الجدول»), next to search,
  status, branch, holder and «employee or car». A line is registered, edited, handed over to an
  employee on a printed «إقرار استلام» (print first, numbered in the same EGYCASH-IT-F-14 series as
  the devices' papers, the signed copy filed against it) or to a car by its code and plate,
  returned, suspended and reactivated, and every step is in its history; the list goes to Excel and
  PDF; an employee's IT page shows their lines beside their devices. It rides the asset grants —
  whoever manages «الأصول» manages the lines — with no new permission. With the deploy, a one-time
  step loads the 392 lines of the three networks' files as reviewed with the owner: 301 handed to
  their 285 employees with an acknowledgment each, the 18 tracker SIMs to their cars, 68 in stock
  (a line registered to someone who has left, or to a name HR does not have, says so in its notes)
  and 5 suspended ([IT design §17](docs/12-planning/it-module-design.md)).
- **The ATM machines are on a map, divided into zones the branches draw themselves.** «موافق على
  المقترح كله، ابدأ». `/atm/map` «خريطة الماكينات» shows every active machine of the branches in
  reach on OpenStreetMap, coloured by zone or by bank, with filters, search and per-zone counts; a
  branch supervisor draws, reshapes, renames, orders and deletes their branch's zones there (zones may
  overlap, with a warning; a machine counts for the higher one in the list). `/atm/map/unlocated`
  «ماكينات بدون موقع» places the machines: a sync reads the register's two location columns (AP/AV:
  coordinates, Plus Codes, Google links), the server opens the `maps.app.goo.gl` short links once
  each, and the rest are placed by a pasted link or a click on the map — a short-code pin waits for
  approval, and a pin a person set is never moved unless the register's text changed. Three new keys,
  seeded to super-admin only — `atmMap.view`, `atmZone.manage`, `atmMachine.locate` — so after the
  deploy an administrator grants them (branch or organization scope, never `own`), then runs the
  sync, resolves the links and checks that the API host reaches Google (GM-1). The register and the
  machines' `zone` and area are not written. Five new indexes, built by `db:sync-indexes` and at boot
  ([machine map and zones](docs/12-planning/atm-map-zones.md), rollout §10.2).
- **The IT asset list exports to Excel and PDF too.** «اعمل نفس الزرارين في شاشة الأصول» — every
  asset the filters match, in the table's order. On both IT screens the two buttons now come before
  the screen's own action and read just «Excel» and «PDF» («كمان عايز الزرارين قبل مش بعد زرار الـ
  Action بتاع الفورم · كمان عايزك تشيل كلمة تصدير من الزراير»)
  ([IT design §17](docs/12-planning/it-module-design.md)).
- **The IT custody register exports to Excel and PDF.** «عايز يبقي فى زرارين بجانب تسليم عهدة
  بيـ Extract أكسيل و PDF للجدول المعمول (وأعتمد الفلتر طبعاً)» — beside «تسليم عهدة» on
  `/it/custody`, for everyone who can read the register. Both files hold every interval the filters
  match (status, branch, holder), in the table's order, not just the page on screen. The PDF is the
  company report form under «قطاع تكنولوجيا المعلومات», A4 landscape, with the filters and the day
  under the title and no signature block
  ([IT design §17](docs/12-planning/it-module-design.md)).
- **Every index the schemas declare can now be built before each deploy (reporting only until
  `INDEX_SYNC_MODE=apply`).** «ابدأ نفّذ الخطوات الخمس الأولى من الخطة» — step 3 of the capacity
  plan. `autoIndex` is off in production, so only the few indexes some module built for itself
  existed there: a production-mode boot on an empty database builds 95 of the 476 indexes the
  schemas declare (sessions had no lookup or expiry index; users and employees none of their
  unique ones). Railway now runs `npm run db:sync-indexes -w apps/api` before every app deploy.
  Until `INDEX_SYNC_MODE=apply` is set it only reports: what is missing, which unique indexes
  existing rows violate (by document id, never the values), how many documents a new expiry index
  would delete at once, and any index whose keys are already indexed under another name or whose
  definition differs from its declaration. It never drops or changes an index
  ([Railway deployment §4a](docs/09-guides/railway-deployment.md)).
- **Responses are compressed.** Step 4. Brotli or gzip for everything over 1 KB — the main web
  script goes from 1.64 MB to 0.41 MB on the wire — except the sign-in routes, whose bodies carry
  tokens. The streamed CSV exports (audit log, attendance, ATM register) now wait on one `drain`
  listener per response, which the compressed stream needs, and close their database cursor when
  they end. A download the client leaves part-way, or that a failed read stops, now ends and is
  audited with the rows written so far and `completed: false`; before, the first waited forever
  and neither was audited. A HEAD request gets the headers alone and reads nothing.

- **The IT inventory is on the system.** «عندي فايل Excel فيه 10 شيتات … تسلمه الأجهزة اللى معاه …
  ولو مكتوب مخزن يبقي مش متسلم … الأفرع … خليها مش متسلمه». A one-time step with the deploy
  registers the 454 devices of the owner's inventory workbook, reviewed with the owner first: the
  head office's devices handed over to the 57 employees their two-part names were matched to by
  branch and department (170 devices, one receipt per employee, ready to print and sign), the IT
  store, every branch's devices and the head-office devices whose holder was not settled in stock
  in their branch, each saying who the sheet had it with. «وصال» is the Shorouk branch.
- **Registering a batch of identical IT devices no longer means retyping them.** «ماذا لو عندي 20
  جهاز بنفس المواصفات .. هفضل أكتب نفس المواصفات !؟ أكيد لأ». When a new asset's category is picked,
  the form fills from the last asset registered in that category — name, make, model, branch,
  purchase, warranty, specifications and accessories — leaving only what is different for each
  unit: the serial number, the printed tag, the location and the notes. Nothing already typed is
  replaced, and a note names the asset the data came from.

### Fixed

- **HR/attendance: the daily sheet showed five people out of a hundred, and the employee pages
  showed almost nothing before 17 November — both were reads, and the data was never wrong.**
  65,579 punches were in ECMS from 2024-12-26 on, the history backfill had run to completion
  (2,062 of 2,062 chunks, 52,237 days computed, 0 failed), and an audit of all 1,430 enrolments on
  the المهندسين wall found NO machine id whose employee code disagreed with it. Four defects, each
  silent.
  - **The sheet resolved the first hundred employees by code, on every date.** It asked the employee
    list for `pageSize: 10_000` to mean "everyone", and `BaseRepository.list` clamps pageSize to
    `MAX_PAGE_SIZE` — 100. So a company of 1,755 answered «total 100» for every day of the year, and
    the four shown as present were whichever of that day's thirty-nine scanners sorted into the
    first page. Resolved unpaged now, with the filter and the scope intact and the sheet's own cap
    as a guard. It cannot page first: the display status comes from the clock and the calendar
    rather than a stored field, so «how many are absent» can only be read off the whole resolved
    day — paging first gives a card saying «3 غائب» that means «3 on this page».
  - **`GET /punches?from=D&to=D` answered zero for a day with seventy-four scans.** `to` coerced to
    `00:00Z` and was compared `$lte` against the punch instant, so one day asked for a zero-width
    window and every other window sat two hours inside the previous Cairo day. Both ends are Cairo
    calendar days now, the window closing at the next midnight exclusive. The day-row windows are
    normalised too, in the day list and the CSV export, where a time component on `from` silently
    excluded its own day.
  - **A day was read from two different sources, so two screens disagreed about it.** The sheet
    resolved its own answer; the employee page read a status straight off whichever stored rows it
    was sent, so a date with no row was absent from the month entirely — the days that had punches
    and no recompute — and a legacy `dayOff` row showed «يوم راحة» over real scans. A day is now
    DERIVED wherever it is read, by the same pure function the stored rows are written from, which
    buys one property every screen depends on: what a reader sees is what a recompute would store.
  - **The counters named eight of the thirteen statuses the server counts.** Everyone in the other
    five was counted, listed, and in no counter at all — «5 of 100» with ninety-five people
    unaccounted for. Three counters added, «لا يوجد جدول», «لا يوجد تسجيل» and «يوم راحة», with a
    test asserting every status is in exactly one.
  - New `noRecord` («لا يوجد تسجيل»): a derived absence with no row behind it. An absence is a
    conclusion the engine draws, and a screen must not infer one across two years of history nobody
    has re-derived. Payroll-neutral, never stored.
  - An import now derives the days it touched — today and the two either side — so a check-out
    arriving in a later batch than its check-in turns «حضر فقط» into a full day inside the request.
    It answers with `daysRecomputed` and `daysLeftToBackfill`, because «imported 26,493» read as
    «done» and no number anywhere said otherwise. Older days stay the backfill's work.
  - The employee period reaches a year, with previous/next month arrows that walk whole months back
    to the employee's first scan, the period in the URL, and a month calendar whose cells are
    buttons that highlight the day in the daily record.
  - **New page `/attendance/devices` («أجهزة البصمة»), AT-D4**, behind `attendanceDevice.view` —
    the screen those two keys were declared page-less for in AT-D1. Each unmatched machine id with
    its wall, its held scan count and its first and last scan, «ربط» and «تجاهل» per id behind
    `attendanceDevice.manage`, and the backfill's progress with cancel and resume. It SUGGESTS the
    exact-code match and never acts on it: machine `102815` belongs to ECMS `0102818`, so a screen
    that auto-linked by that rule would file one employee's attendance under another.
  - The sheet also reports the scans it cannot show — how many machine ids are linked to nobody and
    how many of the date's rows they hold — because a scan belonging to nobody has no employee line
    to sit on, and saying nothing is how thirty-nine people at the door read as five.

- **Linking a department keeps its English name.** The company list's entries were given their
  Arabic name in English too by the workforce importer, and linking copies the entry's name onto every
  row, so «Top Management», «Fleet», «IT» and «Complaince and Risk» would have read «العليا», «الحركة»,
  «تكنولوجيا المعلومات» and «الالتزام والمخاطر» on the English screens. An entry with no English of its
  own now takes the first real English name among its rows, oldest first; the dry run lists each one
  (`englishKept`).

- **Fleet: the ten dashboard tabs and the fleet screens they open now say the same thing.**
  «اتاكد من ال10 شاشات دول المعلومات اللى فيها هى هى اللى فى باقى الشاشه ولو لاحظت حاجة عدلها».
  An audit of every figure, name and state on the ten tabs against the screen each «فتح» opens, the
  other fleet screens, «أرقام الفترة» and «ملخصات» found 51 differences (D01–D51). Each is fixed on
  the side that was wrong; read-side only: no write guard, no migration, no data change, no new
  permission key. The 23 known-by-design differences (T01–T23) are unchanged.
  - **The screens:** «تعيين السيارات» lists a driver held on another car under «معيّنون على سيارات
    أخرى», out of «السائقون المتاحون» (= «بلا سيارة اليوم»), and a picked code («كورولا 1») finds
    that car alone there and on «الطقم الثابت»; «المخالفات»' drivers footer sums every fine the
    filter finds (`meta.outstandingAmount`), not the loaded 100, names an archived type, writes the
    fine's own day («2026/10/31», never the next one), shows «مجهول» for a nameless fine, and its
    «مجهول» filter finds a name written with an odd space; «بطاقات الوقود»' month fuel is the Cairo
    month to today under the page's branch — the address's, else the top bar's, as the tiles beside
    it; «شحن الكروت» and «بطاقات الوقود» write piastres; «مصروفات التراخيص» sums the matching memo
    only under a kind or «لم تُسوَّ», and every «عدد المذكرات» counts memos; «الإخطارات» has a
    «ينقصها مرفق» filter (`missing=any`), pressed on and off on its bar; «المصروفات» has a «الإجمالي»
    tile; «السيارات», the car page and «السائقين» take a licence ending today as expired from the
    start of the Cairo day, count «هذا الشهر» in the Cairo month (vehicles: active only), colour
    licences by the warn-days setting, name a closed branch (the branch filter too, never «—» while
    the branch list loads), and write the licence state one way («منتهٍ / ينتهي قريبًا / ساري»), the
    driver file too; «شهر انتهاء الترخيص» counts the chosen statuses; the car card shows the newest
    reading beside a different highest one; the drivers' figures follow the top-bar branch (the
    dashboard's widest grant) and name it, and «غير مسجَّل» splits into «رخصة غير مسجّلة» / «بلا ملف
    سائق»; a suspended file reads «الملف موقوف».
  - **The dashboard:** «في الورشة الآن» adds «مكهنة» and «بلا سيارة في السجل» so its parts make up
    the headline, and a check-in dated tomorrow is no longer in the workshop now — nor on «داخل
    الورشة» («السيارات»), «لم تُقرأ أبدًا» / «بلا قراءة حديثة» or «أقل 5»; a deleted branch with
    active cars gets a «—» column and an empty closed branch no card; cash/ATM drivers are the
    catalog's alone, the old classification a line apart; «من المسجّلة» counts disposed cars; a
    standing crew on another branch's car is not «بلا سيارة», and «الغائبون اليوم» names a standing
    car only while it is active; old-book visits and readings under a live car's code count for that
    car, and «الكيلومترات حسب الفرع» draws those km as their own column «الدفتر القديم (سيارات
    مسجّلة)», so the columns still add up; the km readout is the day's (or month's) register total;
    empty-reach readers get plain figures instead of company-wide links; an accident refreshes a
    closed period at once; the violations period amount is plain, the owed amount opens its
    register, and the period table names a driver who has left; the custody outside-kind amount opens
    «لوحة تحكم العهدة», pending memos cut at 5, «تنتظر التسوية» lists every part, a kind with no
    receipts reads «لا توجد إيصالات» and the narrowed foot «عرض إيصالات العهدة»; lists open in the
    card's order. Words: «بانتظار الفاتورة» (the maintenance line too), «منها N متأخرة», «فروع بها
    سيارات نشطة», «خارج الورشة» on the km lines, «ترخيص منتهٍ (خارج الورشة)», «المتاحون اليوم (مع
    المعيَّنين)», «أنواع التشغيل (كل الحالات)», and in «أرقام الفترة» «خرج منها حتى الآن» and no
    «نشطة» on the coverage line.
  - New parity specs pin each pair on the pinned clock (2026-11-01 Cairo): workshop, branches and
    drivers, km and the old book, the registers (API); registers, receipts figures, vehicles and
    drivers licence state (web).
- **Linking the departments to the company list keeps «مستندات الوظائف» and the saved filters.** The
  org chart showed every department «غير مربوطة», because production's departments were never linked
  (`migrate:org-catalog` was never run). Before running it:
  - **«مستندات الوظائف» move with their department.** They are kept under `catalogId ?? row id`, so a
    line saved on a branch copy would no longer be read once the copy is linked. The command moves each
    line to the department's entry. Where two copies held a line for the same job, the one saved last
    is kept, and the dry run names every pair that disagreed.
  - **An entry the company list already has is joined, not duplicated**: one added by hand, or one a
    department created since P-ORG-3 linked itself to. A branch that would end up with two copies of it
    is refused, with the `--merge` that resolves it.
  - **The dry run checks what `--write` would trip over**, and refuses or warns before anything is
    written: a planned entry whose code an existing entry holds gets the next free code; an entry
    stopped in the company list is not joined; leave requests awaiting approval in a department whose
    approval chain starts applying on linking must be decided first (the chains are listed either way);
    names the plan groups differently from the screens are listed, as is every row whose name changes
    to its entry's spelling. Department rows are now linked after their sections, so the org chart's
    one-time fill never sees a department without them.
  - **The plan is printed to the log**, one line per company department and section, so the dry run
    can be read on the deployed service, where the report file does not survive.
  - **A department or section filter remembered from before linking still works.** The employees list,
    «جاهزون للتعيين», «المعينون», job offers, System Users and the org chart remembered an unlinked
    department by its name; the address bar is now updated to the key the same department has after
    linking, instead of the list showing everyone, or nobody.

- **A role holding a retired permission can be saved again.** «لما بعدل صلاحيات دور بيظهر كدا !
  Unknown permission keys: applicant.returnToStage» (the role «الموارد البشرية Test»).
  - The cause: `applicant.returnToStage` was retired on 2026-11-16 (replaced by
    `applicantReturn.execute`). Roles that held it kept it, and every save checked ALL the role's
    keys against the registry, so the role could not be saved at all.
  - Now only the keys an edit ADDS must be registered, the same rule the "keys you hold" check
    already followed. A key the role already holds may be re-sent and is kept.
  - Delegated grants follow the same rule.
  - Retired keys are not stripped automatically: a key can be missing from the registry only for
    now (the automation keys while `AUTOMATION_ENABLED` is off).
  - The role form already lists such keys at the end, as «غير معروفة», where they can be unticked
    but not re-added.

- **HR: «نموذج رقم (1)» prints on the owner's own pages.** «انا عاوز النموزج بردو شبه منا بعتو بظبط
  مفهوش اي تعديل خالص و بيتملي عادي بس الشكل اللي ادتولك بظبط». The form was drawn again in the
  system's font, and its letters were lighter and thinner than his. It now prints the two pages of
  the copy he sent (his 300 dpi scan, at 200 dpi in four greys), with nothing redrawn, retyped or
  moved. The record's values are written on them, each where the form keeps it: the category, the
  company, the insurance number and national ID in their boxes, name, nationality, qualification,
  the occupation code and title at social insurance, the start date in its boxes, the basic wage of
  2720, address, phone, email, and «تحريراً في» between its strokes. Overleaf, the company and his
  name in the declaration. An empty value writes nothing, and the form's own dots stay. The page is
  A4 like the other papers, so the Legal page stands on its full height, slightly smaller.
  - Classes `scan`, `f1p1` / `f1p2`, `at` and one per place (`contracts/form-one-scan.ts`); the
    page `scan` has no margin. New variables `contract.currentDay`, `currentMonth`, `currentYear`.
    The paper's revision 3 rewrites the row at the next start.

- **HR: an external person no longer holds a company employee number.** The last company code was
  …2942. After an external person «C2» was registered, a new employee typed as 02002943 was refused:
  «هذا الرقم مسجَّل بالفعل للموظف C2». The owner: «المفروض لا يحجز هذه الأكواد». Registering an
  external person drew the next number from the company's counter and kept it behind the typed
  code. Nobody saw that number, but the register screen counts a number held by anybody as taken.
  An external person now draws nothing: their number is their code. At start-up, every external
  person registered before is given their code as their number, which frees the numbers they drew
  (`migrateExternalEmployeeNumbers`, idempotent), so an attendance punch for 2943 no longer finds
  C2. The register check leaves external people out altogether, their code and their number alike.
  The exact code stays theirs. The counter is not wound back. Its gaps are harmless, because HR
  types each new code and the counter follows it.

- **HR: an external employee's code can be changed to one with letters.** «لما باجي أغير كود الموظف
  (تعيين خارجي) مش بيسمح بكتابه حروف … وخلى بالك دا للتعيين الخارجي فقط». «تغيير كود الموظف» held
  every employee to the company's digits, so an external person's code, registered with letters,
  could not be corrected to another with letters. The rule is now the person's own
  (`employeeCodePatternFor`): an external employee's new code takes Latin letters, digits and a hyphen,
  2 to 20 characters, exactly as their registration does, and the dialog says that shape and opens a
  full keyboard for them. Everybody else's code stays 3 branch digits then at least 4 of number; the
  boundary admits either shape, and the service refuses the wrong one for the person with a 400.
  - The dialog's own «هذا الكود مستخدم لموظف آخر» never showed: it waited for a `CONFLICT` code the
    server does not send (a taken code is `DUPLICATE`), so the English server sentence appeared
    instead. A code another ACCOUNT signs in with — refused whole so the employee is not left signing
    in under somebody else's name — now carries a `username` detail and has its own message.
  - No employee number is read out of an external code any more: `EX-2900` no longer holds number
    2900 against an ordinary employee's code at registration or in the code check, and an all-digit
    external code no longer counts as «آخر كود». Their permanent employee number still does.

- **Fleet: a driver's round badge no longer spells a rude word.** The badge shows the first letter
  of the first two words of the name («السيد» gives «س»), so «كريم السيد» drew «كس». The owner: «صلّح
  الحروف». A pair on a short list («كس», «زب», «طز», «شخ», «تف») now shows its first letter alone,
  with or without a space between the letters. One helper (`lib/name-initials.ts`) serves the three
  places that drew the letters: the badge beside a driver's name on every Fleet board, form and
  picker, the drivers list, and the driver's profile card. Any other name draws as before.

- **ATM: the maintenance mailbox is read again.** «الـ Automation بتاع الميل واقف بقاله شوية كتير !»
  and «اختبار الاتصال» on /atm/settings answered «تعذّر الاتصال: This operation was aborted». From
  2026-11-13 02:00 (Cairo 04:00) almost every reading timed out after 20 seconds. The mailbox
  answers at most four requests at once for one application and queues the rest. A reading that
  timed out was retried by the job queue four more times, 2 to 16 seconds apart, so its retries
  ran on for about two minutes while the next minutes' readings started. Up to five readers then
  met in the mailbox, each request waited behind the others and timed out, and every timeout
  started more retries.
  - **One reading at a time.** A reading holds a lease across the server and the worker; the
    minute's reading and «قراءة الآن» alike. One that finds it taken steps aside, and «قراءة الآن»
    then says a reading is running and that its result appears under «آخر قراءة».
  - **The next minute is the retry.** A failed reading is recorded and logged, and no longer retried
    inside its minute (`retry: false` on the scheduled task).
  - **A short reading.** A reading takes on new mail for at most 40 seconds and leaves the rest to
    the next minute. A request it already started may run to its timeout, so a slow reading can
    outlast the minute; the next minute then finds it running and steps aside.
  - **«آخر قراءة» keeps up.** The mailbox card reads its document again every 20 seconds while it
    is open, so the line shows the worker's latest reading, including the one «قراءة الآن» was
    told is running.
  - **The mailbox is asked for days, not for everything.** With the storm gone, the mailbox still
    answered nothing for 20 seconds when asked for the newest unread mail of every date: it weighed
    all it had ever received. The newest page is now the unread mail of the last two days, and the
    sweep walks the older unread mail three days at a time, back to thirty days, then starts over.
    Mail left unread longer than thirty days is no longer filed by the reader (a branch switched on
    after more than a month); it stays unread in the mailbox. (Two days and three days proved too
    much as well: 15 minutes and two hours since, «Minutes, not days» below.)
  - **A slow mailbox is waited for.** A request to it now waits up to 45 seconds
    (`ATM_MAIL_GRAPH_TIMEOUT_MS`), the 40 seconds for filing count from the moment the mail is
    listed, and the reading's lease lasts long enough for both.
  - **The backlog is found by date.** The mail left unread on purpose (branches not switched on
    yet) has grown every day. The sweep through it asked the mailbox to count its way down that
    pile, page after page. It now asks for the mail received before the last page's oldest, which
    the mailbox finds directly however deep the pile.
  - **A failing mailbox is given time.** With one reading a minute, Microsoft Graph still answered
    every listing with «502» after some twenty seconds. After readings in a row that the mailbox
    did not answer at all, the minute's reading now waits 2, then 4, then 8 minutes, and never more
    than 10, before trying again; «قراءة الآن» never waits, and the first reading the mailbox
    answers puts the minute back. A reading whose newest page came back counts as answered, even
    if a later step failed, so new mail is still looked for every minute.
  - **Minutes, not days.** With the error finally named, every listing of two days came back
    «502 UnknownError» after 21 seconds: Graph gave up waiting for the mailbox, which weighs every
    mail in the range, and the shared mailbox holds mostly mail left unread on purpose. The old
    reader asked for the minute since its last look and was answered for years. The newest page is
    now the unread mail of the last 15 minutes, and the sweep walks the older unread mail two hours
    at a time, still back to thirty days. «اختبار الاتصال» lists the last 15 minutes.
  - **An outage's mail is filed first.** Waits add up: after four unanswered readings in a row the
    gap since the last answered one is longer than the newest page reaches back, and the sweep,
    wherever it stood, could take up to six hours to come round to it. The first scheduled reading
    answered after such a gap now starts the sweep just below the newest page, so the mail of the
    gap is filed within the next readings, two hours of it a reading; then the sweep goes back to
    where it stood, and a gap that comes while another is walked is walked in turn without starting
    the older one over. A «قراءة الآن» pressed first does not take this from the scheduled reading.
  - **The sweep keeps its place through a deploy.** Where it stood lived in the worker's memory
    only, so every deploy started it over and an older backlog (a branch switched on after days)
    was reached only after hours without one. It is now kept in Redis as well.
  - **A window the mailbox cannot answer does not hold the sweep.** The sweep's older page used to
    ask for the same window every minute for good when the mailbox could not answer it. Now each
    failure halves the window (two hours, one, thirty minutes, fifteen), and on the fifth in a row
    the sweep passes over it; its mail stays unread and the next round asks again. A window the
    mailbox answers ends the streak. The newest page is still read every minute meanwhile.
  - **The error says what Microsoft said.** «This operation was aborted» becomes «microsoft graph
    did not answer within 45 s on …», a refusal carries Graph's own error code
    («microsoft graph 502 on … (UnknownError)»), a request the server's outbound rules refused
    keeps their reason («microsoft graph request refused on …: host … does not resolve»), and a
    connection that fails before Graph answers says so with its own code («microsoft graph request
    failed on … (ECONNRESET)») instead of «fetch failed». The worker's log also keeps Graph's text and the
    request's ids (`request-id`, and the `client-request-id` the reader now sends), the ones
    Microsoft support asks for.
- **«تعيين السيارات» on a computer: every filter is on the bar's one row again.** «فى مشكلة باقى
  الفلاتر مش ظاهرة». The bar holds «كود السيارة», one chip per counter and per mission, and the red
  reset on a single line whose sideways scrollbar is hidden. With production's twelve missions the
  eighteen chips needed 1599 px and were given 1478 at 1920 px (nav unpinned, the reset showing):
  121 px short, so the last chip, «نقل أموال (يومي)», sat off the end where a mouse could not
  reach it. The owner kept the one row: «لا صغر شوية كود السيارة وخلى كله صف واحد». «كود السيارة»
  is 12rem instead of 15rem (192 px; its placeholder, icon, one code or three «215, 216, 217» still
  whole), the chips are 4 px apart instead of 6, and each chip has 8 px of padding a side instead
  of 10 and 4 px between word and figure instead of 6. Height, type, colours and the active ring
  are unchanged. Measured on the real page at 1920 px with that day's figures (most missions 0,
  «تشغيل» 45): all eighteen chips and the reset on one row, 68.6 px to spare (110.6 without the
  reset), every ring whole at the start, middle and end. The spare is that day's, not every day's:
  each extra digit in a chip's figure costs about 9 px, so a planned day («تشغيل» 143, four
  missions in two digits) keeps 32 px, while a day with every mission in two digits is 41 px short
  with the reset showing and «نقل أموال (يومي)» is cut again. At 1536 and 1366 px the row is still
  273–485 px short and the last four to six chips are partly or wholly off its end, and a pinned
  nav takes 240 px more. For those, the owner chose «أ اعمل الأسهم ولما يخضر اعمل ميرج»: the row
  stays one line, and while its chips overflow — measured on the page, not guessed from the
  screen's width — a small ‹ › stands at each end of it, outside the chips so it never covers one.
  The start one, beside «كود السيارة», moves the chips toward the start; the end one, beside the
  reset, toward the end; about 80% of the visible width a click, gliding, or at once for a reader
  who asks for less motion. Both stay while the row overflows, the one whose end is reached dimmed
  and disabled, so nothing shifts as it scrolls; they are named «عرض الفلاتر السابقة» and «عرض
  الفلاتر التالية» on hover and to a screen reader. When everything fits there are none: at 1920
  px on the measured day the bar is pixel for pixel as before. Measured on the real page, dark and
  light: one click on the end arrow brings «نقل أموال (يومي)» whole into view, its ring whole
  beside the arrow, at 1920 (every mission in two digits, the reset showing), at 1920 with the nav
  pinned, at 1536 and at 1366, and one click on the start arrow comes back. A row scrolled to its
  end stays at its end when the reset appears: the reset takes about 42 px off that end, and the
  chip just revealed and clicked there — «نقل أموال (يومي)» — would otherwise be cut under the
  pointer, its ring broken (the other chips move 42 px with it). A keyboard user who presses the end
  arrow until the end, which disables it, finds the focus on the start arrow rather than lost, and
  the other way round; a mouse sees no change. The scrollbar stays hidden, the wheel is not taken
  over, and Tab still walks the chips. The phone and tablet boards, whose row is swiped, are not
  changed.
- **mongoose 8.24.1 → 8.24.8.** Two new advisories turned the dependency gate red for every
  pipeline, main included: [GHSA-pcrw-h46h-c93h](https://github.com/advisories/GHSA-pcrw-h46h-c93h)
  (critical: `sanitizeFilter` not applied on `countDocuments`, fixed in 8.24.3) and
  [GHSA-gg4r-jv3p-qx3c](https://github.com/advisories/GHSA-gg4r-jv3p-qx3c) (high: connection-level
  `sanitizeFilter` not applied, fixed in 8.24.7). The API never turns `sanitizeFilter` on, so
  neither reached it, but the gate blocks on both. The API's range moves from `^8.9.5` to `^8.24.8`
  so a fresh lockfile cannot fall back below the fix; mquery follows to 5.0.1, and mongoose's own
  MongoDB driver stays 6.20.0. No code changes.
- **IT vehicle checks dashboard: the page no longer scrolls into empty space.** «بيعمل Scroll لمساحه
  فاضية». The matrix's last column has a heading only screen readers hear (`sr-only`, absolutely
  positioned). Its table's scroll box was not positioned, so the heading took the page as its
  containing block, sat at the matrix's height and stretched the document: the whole console frame
  scrolled up by about 170 px into blank space. The box is `relative` now, as DataTable's is
  (measured in Chromium: the document 1077 px in a 909 px window before, 909 px after).
- **«حوادث السيارات»: a transfer can no longer take more than the file's negative, its refusals
  are in Arabic with their figures, and the car list offers no deleted car.**
  - **The server caps a take at the receiving file's negative** («اعرف المبلغ اللى بالسالب كام
    وشيله»): a take brings the file up to zero and never past it. On a new file the negative is
    read from the figures sent. On an edit it is read from the edit's figures over the stored
    file, with the transfers already on it, inside the save's transaction. Before, only the screen
    held to this. The refusal is `FLEET_ACCIDENT_TRANSFER_OVER_DEFICIT` (422, details
    `{deficit, amount}`; the deficit is 0.00 on a file at zero or above), and nothing is written.
  - **The refusals are in Arabic, with their figures.** When the cars sent hold less than the
    amount (another clerk took from them a moment ago), the save answered
    `BUSINESS_RULE_VIOLATION` with an English sentence. It is now `FLEET_ACCIDENT_TRANSFER_SHORT`
    (422, details `{available, amount}`). The form reads the accidents again, car balances
    included, and says «لم يعد في السيارات المحددة ما يكفي: المتاح فيها الآن …، والمطلوب …»; a take
    over the negative reads «لا يمكن أخذ أكثر من سالب هذا الحادث (…)». Both codes have Arabic and
    English words in the app's error table. Every other business-rule refusal is unchanged,
    including a transfer onto a file with no registry car or from the file's own car.
  - **«كود السيارة المأخوذ منها» no longer offers a deleted car.** The car-balances read
    (`GET /fleet/accidents/car-balances`) counted soft-deleted cars, so the list could offer a car
    whose save then answered 404. A file kept from the old book under a code could also count for a
    deleted car that once wore that code. Deleted cars are now left out before codes are matched,
    and an old-book code counts for the live car that carries it now. The code is matched by the
    save's own rule (spaces read as one, Latin case ignored): the registry's «فورتشنر 2 » and the
    book's «فورتشنر 2», or «MG 2» and «mg 2», are one car. An exact match had left such a file out
    of the list's figure while the save still counted it, so the list could offer a figure the save
    then refused. Every car offered can be saved, and the figure shown is the one the save is
    capped by.
  - The integration fixtures that took onto a file at zero or above were rewritten so every
    receiving file is negative. New cases cover the over-deficit refusal on a new file and on an
    edit, a short refusal after another take, two clerks adding to one file at once (one wins, the
    other is refused with the deficit left), a deleted car left out of the list, an old-book
    code reused by a live car, and an old-book code spelled with a trailing space or in another
    Latin case.

- **Fingerprint sign-in: two gaps a review found, closed.** «يلا».
  - **A passkey sign-in now clears the failed-password count**, as a password sign-in does.
    Before, the count was cleared only by a successful password, and it has no time window. So a
    person who signs in only with a fingerprint, and mistypes the password now and then, would
    eventually be locked out, fingerprint included. Only the count is cleared: a locked account
    stays locked, and a refused key changes nothing.
  - **«حذف» works while fingerprint sign-in is switched off.** The server already allowed removing
    a passkey with the switch off, but the list was refused, and the Security card hid it. Now:
    - the list answers either way and says whether passkeys are on (`meta.enabled`);
    - with the switch off, the card lists the devices with «حذف» only, and says they can still be
      removed;
    - the offer after a password sign-in reads the same flag, so it is not made while switched off.
    - Recorded as [ADR-036](docs/03-decisions/ADR-036-passkey-switch-keeps-own-list-and-removal.md),
      which replaces ADR-035 §9 (that said the switch closed every passkey endpoint).
  - **The passkey design doc matches the code again:** the order of the sign-in checks, which
    endpoints the switch and the audience rule cover, the TOTP code at the offer, when the button
    shows, renewal timing, the tests, and the error statuses.

- **Car codes with a space are filtered as one car.** «لما باجى اعمل فلتر على اى عربيه من اللى
  بالعربى دى مش بيجيب العربيه و بيسرش اكن الاسم بتاع العربيه حاجه والرقم اللى جمبها حاجه تانيه».
  The vehicle-code filter split every code on spaces — «كورولا 1» became «كورولا» and «1» — whether
  it was typed, picked from the list or carried on a link, and the server then matched codes
  exactly. A word followed by a number is now one code («كورولا 1», «كوستر 2», «فورتشنر 1»,
  «تويوتا 2», «MG 3», «بيجو 5008»), while «150 151» still names two cars; the filter waits for the
  number after «كورولا » instead of ticking the word; and the server compares codes ignoring
  surrounding and repeated spaces of any kind (a stored «فورتشنر 2 » is found) and Latin case
  («mg 2»), on every screen that filters by code. Stored codes are unchanged.

- **«عدادات السيارات»: the expected reading and the maintenance alarm follow عداد الخروج again,
  and the newest row's «فارق عداد الصيانة» is the figure and its ⓘ.** «فى مشكلة بدات تظهر فى اكتر
  من سيارة قراءات العدادات … يجى يوم جايب رقم كبير ويقولك مينفعش اقل من الرقم دا واخر قراءة اقل منه
  بكتير». Since batch 3 a car's latest reading was the highest of any row's opening OR closing
  reading, so an old row whose closing reading sits above the next day's opening (old-book rows,
  typos, test figures) became «الخادم يتوقع … كم أو أكثر» on the record form and the alarm's
  baseline. The latest reading is again the row with the highest عداد الخروج — the same order the
  save rule checks — reporting that row's closing reading, with the later day winning a tie (the
  batch-3 parked-day fix kept). «عاوز الباقى يتشال ويفضل علامة التعجب جنب القراءة»: the car's
  newest row shows only its figure and the ⓘ; the level, what is left of the interval, the
  reading's day and the newer-visit mark stay in «كيف حُسب الفارق». No data changes.

- **«إضافة ماكينات» on a settlement plan, and the data-edit bulk add and delete, take any number
  of lines.** «صلّح كمان إضافة الماكينات والـ bulk add». A paste past one request's cap (200 on the
  plan, 500 on the data-edit dialog) was refused whole. Both now send the lines in consecutive
  requests of that size and show one answer. Repeats are decided over the whole paste first, as the
  server decides them in one request (on the plan, a later repeat reads «مكررة في القائمة»). If a
  run stops, what went before stands and every line not confirmed goes back into the boxes with
  «توقف الإرسال قبل آخر … سطر — أُعيدت إلى الخانات»; sending them again is safe — an added line
  comes back «موجودة في هذه التغذية» or «مسجلة من قبل», a deleted machine as an unknown code — so
  the lines of the request that stopped go back too, named as possibly done. Inputs, buttons and
  closing are held while a run goes; the top-bar branch switch waits («يجري إرسال الآن — غيّر الفرع
  بعد انتهائه») and closing or reloading the page asks first — on these screens and the open forms.
  A plan still holds at most 400 lines; when it is full the lines go back without «اضغط … مرة
  أخرى». Every run reads the top-bar branch per request and is pinned to it: if the branch changes
  under it anyway (a stored branch retired meanwhile), it stops before its next request with its
  lines back («تغيّر الفرع المختار أثناء الإرسال»).
- **The open forms take any number of pasted lines.** «كان عندى حوالى 700 تغذية لماكينات لما
  بضيفهم كلهم مره واحده بيجيب الرساله … لكن لما قللتهم 100 او 200 فى المرة بقي يضيف عادى». One open
  request carries at most 200 lines, so a longer paste was refused whole («بعض الحقول تحتاج إلى
  مراجعة» then «لم تنجح العملية»). The replenishment and maintenance forms now send the lines in
  consecutive requests of 200 (`ATM_OPEN_MAX_ROWS`), in order, with one date or open time for all,
  and show one answer: the opened count, the unknown codes, and on maintenance the codes already
  open that day. The boxes are held while the run goes. If it stops, what went before stays
  opened, and the form says what happened under the boxes as well as in a toast:
  - lines certainly not sent (after the failed request, or in a request the API refused, which
    writes nothing) go back into the boxes: «توقف الإرسال قبل آخر … سطر»; pressing open sends them;
  - the lines of a request whose result is unknown (a dropped connection, a 5xx) may have opened,
    and a replenishment opens again on every send, so they are NOT put back: they are named apart,
    «لم تتأكد نتيجة … سطر — قد يكون بعضها فُتح. راجع الجدول قبل فتحها مرة أخرى», and stay there
    through later presses until «إعادتها إلى الخانات» puts them back (after checking the table) or
    «إخفاء القائمة» hides them.
- **The leader pickers offer the ATM employees' names — the maintenance close above all.**
  «تظهر أسماء الموظفين اللى فى ATM في Drop Down القائد في الصيانة والتغذية .. وخصوصاً عند تقفيل
  ماكينات الصيانة». The close's employee list read `atm.maintenanceLeaderDepartmentIds`, which
  shipped empty with no screen to set it, so the close offered nobody and no maintenance could be
  closed; the edit dialogs' leader was a free-text box. The list (`GET /atm/leaders/options`, read
  by either board) is now the working employees of the departments ticked on `/atm/settings` —
  or, while none is ticked, of every active department NAMED for ATM («الصراف الآلي», «الصراف
  الالى», «ATM»): the legacy's own rule. The new card «موظفو الصراف الآلي — قائمة القائد» lists
  every active department with its people counted, marks the ATM one, saves the ticks
  (`atmSettings.manage` company-wide, audited as a platform setting) and returns to the name rule.
  The close picks from the list in a searchable box, each person with their HR code (the search
  reads the name and code shown, never the id behind them); both kinds' edit dialogs pick the
  leader from the same names, and a name already on a row stays pickable, so opening and saving a
  row never rewrites its leader. A free-text leader is no longer typed. On a checked set of
  maintenances the box opens on the leader the rows share, «حفظ» waits for a change, and the
  leaders are cleared only by the box's ×, never by a blank left behind. A list that failed to load
  says so. Every searchable box (`Combobox`) now commits a name typed out in full when the reader
  clicks elsewhere or presses Tab, and its Escape closes the open list only, no longer the dialog
  around it.

- **Every ATM machine shows under the branch it is filed in, the ATM pages name branches as the top
  bar does, and a linked branch's data moves to the branch it works as.** «أنا عايز كل ماكينه تظهر
  فى الفرع بتاعها طبقاً للفرع المتسجله فيه» — machine 27720226 showed on `/atm/machines` only under
  «كل الشركة», its replenishment and maintenance failed in Mohandessin, its mail showed only under
  «كل الشركة», and `/atm/register` called it Mohandessin's while its filter brought it under
  October. October works as Mohandessin since the branch links, but a link moves the PERSON, never a
  row: what the workbook import, the register and the mail reader filed under October before stayed
  October's. On `/atm/settings` each link now has «نقل البيانات إلى …»: a preview of what is filed
  under the source, what merges and what refuses the move, then the move itself, under
  `atmSettings.manage` held company-wide. Machines, register rows, mail, both operation logs, the
  map, labels and the settlements data are re-filed under the target; a name both branches use is
  merged or renamed, a duplicate machine is retired the way data-edit deletes one (its cassette
  layout and map point going to the machine that stays when that one has none), and the mail
  and register settings that named the source are pointed to the target where it has none of its
  own (otherwise they keep answering through the link). The move is refused, with
  each reason named, while something it must not guess past stands — a machine active in both, a
  duplicate still holding open work (a draft or issued plan line among it), Note
  serials or a plan of one bank and day in both, the map's limits, an import running — and stopped
  part-way, with what moved staying moved, if one appears while it runs; running it again carries
  on. It moves to the target the reader confirmed, refused if the link was re-pointed since, and
  while it runs, adding or deleting machines, receiving and linking register rows, the register
  import, saving names, opening or reopening a replenishment or maintenance and accepting mail
  wait for it (423), so nothing lands between its plan and its writes — a register import already
  running refuses the move instead, and a move cut off by a restart holds them until it is 30
  minutes old, when pressing «نقل» again takes it over; an
  area name deleted or renamed away in one linked branch is not created again as a label by the
  other's writes or by the boot repair (the move itself still brings the source's own live label
  of that name across, as before). The card
  names every linked branch still holding data, and opens the preview when a link just
  saved has data under it. What is filed from now on follows the link too: a register receipt, the
  workbook import and a mail of a linked branch's machine land in the branch it works as, and the
  legacy importer refuses a linked branch. «أنا عايزك تعتمد التسمية اللى بالعربي والإنجليزي»,
  «الفروع فوق خالص فى البار بتاع السيستم غير اللى فى الفلاتر»: the register's grid, filter, forms,
  export and Data Report name a branch by its ECMS name in Arabic and English — the EGYCASH codes
  stay on the register settings card and the import preview — and its branch filter offers only the
  branches the top bar's choice shows. An organization-wide user placed in a branch filed every
  machine, label, replenishment and maintenance under that home branch whatever the top bar said,
  and under «كل الشركة» too; each is now filed where the top bar points — for a holder whose grants
  name no branch (one whose grants list branches keeps the platform's rule: the top bar inside that
  reach, else home) — and on «كل الشركة» an add
  or a delete asks for a branch first («اختر فرعًا محددًا من القائمة العلوية أولًا.»),
  the data-edit dialogs saying «الفرع: …» before an add and each row's «حذف» waiting for one
  ([ATM port §6b–§6c](docs/12-planning/atm-operations-port.md),
  [register DEC-42](docs/12-planning/atm-efficiency-register.md)).
- **A busy office no longer locks itself out of signing in.** Steps 1 and 2 of the capacity plan.
  Sign-in, TOTP and activation were limited per IP address — 10 tries in five minutes shared by
  everyone behind one office connection, and 60 renewals for all of them — and the address could
  be rewritten by the caller. The strict limits now sit on what is being guessed or replayed: the
  account for sign-in and for TOTP codes, the one-time token for activation, and the session for
  renewal. On top, each address has a high ceiling on every request (`AUTH_RATE_LIMIT_PER_IP`,
  `AUTH_REFRESH_RATE_LIMIT_PER_IP`) and a lower one on failed sign-ins only
  (`AUTH_FAILED_LOGIN_LIMIT_PER_IP`, 30 per five minutes), so finding accounts or spraying
  passwords from one address is still bounded while successful sign-ins never count. The price:
  anyone sharing an address can use those 30 up on purpose and block every sign-in from it for the
  rest of the five minutes, as the old limit allowed with ten. The address
  is the one Railway's edge saw (`X-Real-IP`, `CLIENT_IP_HEADER`). The web client signs out only
  when the server refuses a renewal; a rate limit, a deploy or a dropped connection is retried —
  from «stay signed in» too — and the person stays signed in. A replayed refresh token is still
  refused every time, but only the first five replays per session per five minutes are reported,
  so one stolen cookie cannot flood the security alerts.
- **proxy-addr 2.0.7 → 2.0.8.** A new critical advisory
  ([GHSA-jqcg-44mw-7w3h](https://github.com/advisories/GHSA-jqcg-44mw-7w3h): IP spoofing through
  an IPv4-mapped IPv6 trust subnet) turned the dependency gate red for every pipeline. proxy-addr
  comes in through Express, which reads it for `trust proxy`. The patched release sits inside
  Express's own `~2.0.7` range and keeps the same dependencies, so only the lockfile changes.
- **Fleet and gold printouts open the print dialog by themselves again — or, in truth, for the
  first time.** «مش بعرف اطبع الpdf بيفتح شاشه وخلاص». Every printed document is written into a
  tab the app opens, and that tab inherits the app's Content-Security-Policy (`script-src 'self'`,
  `script-src-attr 'none'`): the inline script each page carried to open the print dialog, and the
  `onclick="window.print()"` on the drawer-inventory minutes' button, were refused by the browser
  every time. So the page opened, and nothing else happened — on Fleet's company and drivers'
  violation reports, receipts, custody, charging and dealership sheets, the insurance notices, and
  every gold receipt, statement, monthly closing and the drawer minutes (staff and portal alike).

  All of them now print through one door, `shared/lib/print-window.ts`: the page carries no script
  of its own, and the app's own script — which the policy allows — opens the dialog once the
  letterhead, the scans and the fonts have loaded, with a timer behind it so it always opens; page
  buttons are wired from the app. The drawer minutes still open on the screen first and print from
  their button. A licence record's tab is now opened inside the click, before its scan is fetched,
  so a popup blocker no longer refuses it. IT's QR label sheet printed nothing at all: its tab was
  opened with `noopener`, for which the browser hands back no window by definition, so every
  attempt read as a blocked popup — it now opens and prints. A spec holds the whole web app to «no
  printed page carries a script of its own».

### Changed

- **Fleet: «الطقم الثابت» (`/fleet/fixed-roster`) in the look of «تعيين السيارات», as the approved
  sample.** «واعمل ديزاين شاشة الطاقم الثابت زى التعيين اليومى», the owner's answers to the sample
  «1 ب / 2 ج», then «انت لسه معملتش بيدج الطاقم الثابت». The screen is now the daily roster's board
  without a day: no date, no day arrows, no «يوم سابق», no availability words, no absence or leave —
  a standing crew stays as it is until somebody changes it.
  - The page header «الطقم الثابت» under «الحركة» stays on top at every width (answer 2 ج), and
    its own Excel button is gone: the one Excel control is the daily «تصدير Excel» pill on a
    computer and the daily Excel button on a tablet or a phone. The file is unchanged: the rows on
    show, eight columns.
  - On a computer (1280 px and up): under the header, the cars the filters leave, in Arabic's own
    plural («سيارة واحدة»، «سيارتان»، «3 سيارات»، «11 سيارة»; this screen only), beside the Excel
    pill. Then the dark filter bar — «كود السيارة», the counters and the red reset; the «كل المهمات»
    dropdown is gone, the mission chips are the filter — and the boards' dark table. The code is
    bold white with the car card on hover and no colour of its own per car. The two seats are the
    daily seat, the code under the name. «ملاحظات» shows three lines at most, the whole note on
    hover. «إجراءات» is pinned. «بلا طقم» is yellow, as the daily «بلا سائق»; rose is the
    workshop's alone. A workshop car's row is rose and its standing crew stays editable. On a
    1280 px screen a seat's name may take a second line, so the whole table fits with nothing under
    «إجراءات» (measured with two 24-letter names in one row); from 1366 px it keeps one line.
  - The drivers panel beside the table: «السائقون (n)», n the drivers with no fixed crew, listed
    first (name, code under it, no «متاح»). Then «معيّنون على سيارات أخرى» with the blue «سيارة
    أخرى» for a driver held on a car that is not on the board (another branch's, or a car out of
    service). As on the daily board he is listed only: not counted, not dragged, and not offered by
    any seat's list or the pen dialog — no edit here can release him, so such a save could only be
    refused. «لا يوجد سائقون بلا طقم ثابت» replaces the old line that said «في هذا التاريخ».
  - «إجراءات»: the pen on every row opens «تعديل · {code}» with the mission, the two seats drawn as
    the daily dialog's (name and code with ✕, «اختيار سائق» on an empty seat) and the note, under
    the same rules (seat 2 waits for seat 1, never the same person twice). A new swap button
    (both seats filled) trades seat 1 and seat 2. The bin «إفراغ الطقم» still empties both seats
    at once, keeps the mission and the note, and asks nothing.
  - On a tablet or a phone (under 1280 px): cards instead of the table, always in code order (the
    workshop car in its place, unlocked); «ابحث بكود السيارة…» with the Excel button beside it; the
    filter row («عوامل التصفية», where the mission filter is, the counters, and «السائقون» with its
    count — an icon and the number on a phone). A seat tap opens a list that also offers the drivers
    on other cars with their car's code — a pick moves him; or choose the driver first in «السائقون»
    and tap the seat. The swap sits between the seats; ⋮ holds «تعديل» (the note) and «إفراغ الطقم»;
    the mission is the button by the code. A landscape tablet shows cars 60% and drivers 40%.
  - Every edit is a draft. The save bar at the foot shows only with unsaved work: the edited car
    codes (a tap brings the car into view, lifting only the filter that hides it), «تراجع» (the last
    edit, up to 50), «إلغاء» (asks first when more than one car is edited) and «حفظ». A reload keeps
    the unsaved edits; «تراجع» starts again. A driver taken from another car shows «سيُنقل من
    السيارة 214 عند الحفظ» under his new seat until the save. A viewer sees no «إجراءات» and no
    save bar.
  - A refused save keeps the draft and now says why in Arabic, naming the driver and the car that
    holds him, never an internal id or the server's English — or «سيارة أخرى ليست في هذه الشاشة»
    when that car is outside the reader's branches. A car no longer in service, a switched-off
    driver profile, an employee not on a driving seat and a retired mission type each have their
    own line. The toast's title is «تعذّر حفظ الطقم الثابت» and the reason is the line under it,
    which wraps whole (a one-line title would cut the car's code off).
  - `POST /fleet/fixed-roster`'s refusals carry `details` for that line: `FIXED_CREW_DRIVER_HELD`
    (the driver's employee id) with `FIXED_CREW_HOLDER` (the holding car's code, only when the
    caller's scope reads that car), `FIXED_CREW_VEHICLE_NOT_ACTIVE` (the car's code),
    `FIXED_CREW_PROFILE_INACTIVE` and `FIXED_CREW_NOT_A_DRIVER` (the employee id, after the existing
    detail), and `FIXED_CREW_MISSION_INACTIVE` (the mission type id). Same status and error code,
    and the same message — except that a holding car outside the caller's scope is now «a vehicle
    outside your scope» in it rather than its internal id; no names and no out-of-scope id in the
    body.
  - Unchanged: the fixed crew's rules, endpoints and data (no new field, no migration); the
    permissions (`fleetRoster.plan` edits; the branch picker narrows the cars, the drivers are the
    whole company); the hover cards (today's car and drivers, from the daily roster); and «تعيين
    السيارات» itself — its shared pieces gained optional props whose defaults draw it exactly as
    before. Answer 1 ب: this screen flags no standing member who can no longer drive; that stays on
    «تعيين السيارات».
  - Five words only the old screen read are removed: `fleet.fixedRoster.subtitle`, `.summary`,
    `.driversHint`, `.removeDriver` and `.unsaved`.

- **«لوحة تحكم الحركة» at `/fleet`: «العهدة», a NEW tab right after «الوقود والمصروفات», and
  «التراخيص والتجديدات», which replaces the old «التراخيص» body under the same key, as approved.**
  «اعتمد سامبل العهدة» and «اعمل اللى بتفضلوا» (the custody), «أ جدول بالسواقين» and «اعتمد» (the
  licences), then «اعمل «العهدة» و«التراخيص والتجديدات»». The bar now has twelve tabs: نظرة عامة ·
  الحركة اليوم · توزيع السيارات · الصيانة والورش · العدادات والكيلومترات · الحوادث ومطالبات التأمين
  · المخالفات المرورية والتسويات · الوقود والمصروفات · العهدة · التراخيص والتجديدات · أرقام الفترة ·
  ملخصات; no old tab is retired, and «أرقام الفترة» and «ملخصات» are unchanged. The new key is
  `?tab=custody`; an old `?tab=licences` link opens the new body. Every pill now shows its full name
  (the licences pill no longer shortens to «التراخيص»). «العهدة» has no count; the red count on
  «التراخيص والتجديدات» is the expired car licences plus the expired driver licences (its two red
  cards), and it now hides at 0 (it showed a grey «0»). Both tabs show a «الآن» part and a period
  part, each with its own loading and error, under one «تحديث». «العهدة» is «لوحة تحكم العهدة»
  restyled, with the same formula, titles and reads. Its «الآن» part covers the whole company since
  the fund's first day: the band says «من بداية العهدة» and, when a branch or «كل فروعي» is chosen,
  «الشركة كلها». It holds:
  - the five-tile equation (− + − =);
  - «تنتظر الاستعاضة» (held, in memos not replenished, outside the memos; at most 6 memos, then «و N
    أخرى»; each outside kind with its age);
  - «استعاضة معلّقة» (every letter waiting for its transfer, with its memos; the age is the oldest
    letter's);
  - «تنتظر التسوية» (at most 6 licence parts with their cars and visa / cash; «فتح» only for a reader
    of «مصروفات التراخيص»);
  - «تنبيهات العهدة» (only the lines that fire: amber when late, red only for a fund below zero or
    settlements over the fund; «لا توجد تنبيهات الآن» otherwise);
  - «إجمالي العهدة بعد كل عملية» (the last 100 operations, held and cancelled ones not drawn, red
    below zero);
  - «آخر عمليات العهدة» (the newest 6).

  Its period part follows the branch through each receipt's car, under the full page bar:
  «مصروفات العهدة» (the receipts' count, and «منها حتى الآن»: «تمت الاستعاضة» / «في مذكرات لم
  تُستعَض» / «خارج المذكرات») beside «مصروفات العهدة حسب النوع» (صيانة · وقود من العهدة · كاوتش ·
  غسيل, with one-decimal shares). A sentence says these are the fuel tab's custody columns and are
  never added to them. Each figure opens «سجل العهدة» by operation or record, «المذكرات» by state or
  kind, «لوحة تحكم العهدة» (what waits for replenishment), the licence expenses waiting for
  settlement, or the custody spend (`/fleet/custody-expenses` when only codes narrow the period, else
  `/fleet/receipts`); the three «منها حتى الآن» figures are plain (no list holds a state over a
  period). Ages count whole days as the custody screens do. «آخر عمليات العهدة» counts a
  settlement's cars as the sample does («سيارتين»، «سيارة واحدة»), and its table starts at 1024 px.

  «التراخيص والتجديدات», «الآن»:
  - six cards, the cars' row over the drivers' row (each row its own grid, three a row from 1024 px,
    six in a line from 1800 px): expired; expiring within the warning days of «إعدادات الحركة», plus
    «ومن … إلى 60 يومًا»; «أوراق لم تُستلم بعد» (تأمينات / ضرائب); expired driver licences (up to 3
    names); expiring; «بيانات رخص ناقصة» («رخصة غير مسجّلة» / «بلا ملف سائق»);
  - a line to the fuel tab for the cards' expiry, for a reader of the fuel cards;
  - a note, when narrowed, that drivers follow their HR branch;
  - «التراخيص المستحقة للتجديد — 12 شهرًا»: cars and drivers per month from this month, never summed;
    each column opens its month's list;
  - «أقرب تراخيص السيارات» (make, licence class, and a papers column for a licensing-board reader,
    «تعذّرت القراءة» when the board cannot be read);
  - «أقرب رخص السائقين» (names, licence type, «الملف موقوف» on a suspended file); both tables from
    1024 px, rows below.

  Its period part is company-wide, under the period choices alone (a licence memo has no branch, car
  type or operation): «مصروفات التراخيص في الفترة» («عدد المذكرات», «السيارات») and «تفصيل مصروفات
  الفترة» (renewal / extension and visa / cash, plain), with a note that what waits for settlement is
  on «العهدة».

  Every figure of the old body has a home:
  - «آخر ما سُجّل» (the last 30 days' workshop visits and accidents) is in no approved screen and is
    retired, with R1 `recentWorkshop` / `recentAccidents`, `FLEET_DASHBOARD_RECENT_DAYS` / `_ROWS` and
    their links; the accidents are in «حوادث الفترة», the visits on «الصيانة والورش»;
  - the fuel cards' expiry stays on «الوقود والمصروفات» alone;
  - the open papers now open «لوحة التراخيص» on that paper's open papers alone: `/fleet/licensing`
    reads `paper=insurance|tax`, remembered and shown as one removable chip. It opened the whole board.

  Access:
  - a reader of «لوحة التراخيص» alone keeps `/fleet` and this tab (the papers only, no R2);
  - a reader of the licence expenses alone gets no page (new `FLEET_DASHBOARD_PAGELESS_SECTIONS`);
  - a custody-only reader still sends no R2 (R2 is asked only when a period section is fully
    permitted and some tab the reader sees draws it — the licence expenses only beside this tab), and
    the overview asks «هذا الشهر» only of a reader of one of its four figures;
  - a reader of the fuel cards alone no longer sees the licences tab;
  - the two new R2 keys never widen a branch reader's figures to the whole company.

  New read fields:
  - R1 licence rows `typeName` / `licenceClass` / `papers` (their `expiresAt` is now the day), and
    `licenceVehicles.papersFailed` when the board's lookup fails;
  - R1 `licenceVehicles.months`, `licenceDrivers.months` / `list`;
  - R2 `opex.custodyCount`, `custodyStates`, `licenceSpend`;
  - the fund summary's `held.letters`;
  - the receipts summary's `custodyCount`.

  A licence memo refreshes the live period read; a custody memo or operation also refreshes a closed
  range, since its states are as of now. The overview is unchanged: «تراخيص قريبة» opens the new tab.
  No new permission key. No migration; data unchanged; no new index.

- **HR: «جاهزون للتعيين» and «المعينون» are joined by a small toggle; «مستندات الوظائف» is a button
  again.** «عاوز نرجع ال زرار بتاع مستندات الوظائف لوحده زي مكان و عاوز ال toggle slider يبقا بين جاهزون
  للتعيين و المعينون و … ميكنش ال tggole background اخده الصفحه كلها لا هو عاوزين يبقا اخد مساحه صغيره
  فوق الزرار بتاع المستندات». The full-width bar is gone. Both pages carry, in their head, the
  settings bar in a compact form (`SettingsTabBar compact`): as wide as its two lists, no head
  circle. Under it is «مستندات الوظائف», which opens its popup as before (`JobPapersDialog` back,
  the section page gone; `/employees/ready/job-papers` leads to the list).

- **«لوحة تحكم الحركة» at `/fleet`: two NEW tabs, «المخالفات المرورية والتسويات» and «الوقود
  والمصروفات», right after «الحوادث ومطالبات التأمين», as approved.** «خش على الاتنين اللى بعدهم» —
  «اعمل اللى انت بتفضله» and «اعتمد» (the fines) — «اعمل الافضل» and «تمام» (the fuel). The bar now
  has eleven tabs: نظرة عامة · الحركة اليوم · توزيع السيارات · الصيانة والورش · العدادات والكيلومترات
  · الحوادث ومطالبات التأمين · المخالفات المرورية والتسويات · الوقود والمصروفات · أرقام الفترة ·
  ملخصات · التراخيص; no old tab is retired. The new keys are `?tab=violations` and `?tab=fuel`;
  neither pill carries a count (the approved bar has none). Both are panels of R1 and R2 together,
  like «الحوادث ومطالبات التأمين»: each part shows its own read's loading and error, «تحديث» reads
  both, and the page's period bar stands under the «خلال الفترة» band head. «المخالفات المرورية
  والتسويات»: «الآن» — every year's fines still owed, old-book rows never ticked included («كل
  السنوات», said once): «قائمة على الشركة», «قائمة على السائقين» (known drivers — how many and their
  amount —, «مجهول ←» opening the register, «اسم غير مربوط») and «إجمالي المخالفات القائمة» with the
  figure-free foot «عرض المخالفات القائمة»; the counts there are plain (the register sums amounts);
  in the company view only, and only when there are some, one sentence each for the company's and
  the drivers' owed fines on cars the registry never had (the drivers' one is new). «خلال الفترة» —
  the DRIVERS' fines by the fine's own day (company statements never count in a period): «مخالفات
  السائقين في الفترة» (how many and their amount, still owed of them as a link, collected so far with
  its whole share — as of today, since no collection day is recorded), «مخالفات الفترة حسب النوع»
  (the system's types that have a fine in the period, «غير محدد» always last, each count opening the
  register on its type), and the period's fines table (at most 6, newest first: the car, the day,
  the driver — an HR driver underlined, «مجهول» muted, any other name as written —, the type, the
  amount, «قائمة» amber or «محصَّلة» emerald, and «فتح» opening the register on that car, day and
  type; «عرض الباقي (N) في السجل» only when there are more). The register (`/fleet/violations`)
  now reads the dashboard's period on its drivers' half (`dfrom` / `dto`, remembered, one removable
  chip beside the year chip, cleared by the drivers' «مسح»; the signed drivers' report prints those
  rows), and `GET /fleet/violations` takes `from` / `to` (the fine's day, whole days). «الوقود
  والمصروفات»: «الآن» — six cards (one row from 1800 px, 3 + 3 below): «أرصدة وطنية» and «أرصدة شل
  أوت» (the company word in its register colour), «طلبات بانتظار الاعتماد», «رصيد منخفض», «شُحن
  اليوم» and «تنتهي خلال N يومًا» (the nearest day, «ومنتهية: N»); in the company view, a line for
  the cards on no car when there are some; «مطابقة شيت شركة الوقود», one half per company — the last
  read sheet's day, the cards whose balance differed at the read, those still undecided and their net
  as at the read (plain figures; «لم يُقرأ شيت لهذه الشركة بعد.» and «لم يختلف رصيد أي كارت عند
  القراءة» when so, «قُرئ يوم …» for a sheet read before its day was recorded, and a net of 0.00
  written plain, with no «أقل/أكثر»; under a branch, the lines of the branch's cards — a card
  deleted since the read included, as the company view counts it; it refreshes on a decision,
  every 5 minutes or with «تحديث» — a freshly read sheet alone does not move it), its foot
  «مطابقة أرصدة الكروت»; and «كروت تحتاج متابعة» across the
  page (at most 8 in urgency order — expired, below red, a request waiting, low, expiring — with the
  register's state words, «تُعرض هنا أول 8 كروت…» only when there are more, and «فتح» opening the
  cards list on the card's car and company for an expiry, the charging screen on them for a balance
  or a request, or the cards list by its number for a card on no car or on a car deleted since,
  which shows «محذوفة» and no link to its file). «خلال الفترة» — «مصروف التشغيل» (the receipts: the
  total, «الوقود كله» with about N litres at each receipt's day price, a line for fuel receipts with
  no litre price when there are some) beside «فواتير التوكيل» (the amount, «بانتظار تسجيل القيمة»;
  no priced-from-invoices meter; each card says «البيانات متاحة من …», as «أرقام الفترة» does, when
  the range starts before its source's first record), the note that the two are never summed,
  «مصروف التشغيل حسب النوع» (card fuel, custody fuel, tyres, wash, maintenance — each opening its
  receipts — with its share; card fuel with no receipt is outside it, and the custody kinds are the
  custody spend «العهدة» will show, never to be added to it), «مصروف التشغيل يومًا بيوم» by the
  receipt's paper day (Fridays dimmed by the calendar, an empty day as an empty slot; «شهرًا بشهر»
  for «هذه السنة» or more than a month) and «فواتير التوكيل في الفترة» (at most 6 in the
  dealership screen's order, so a visit's
  «إصلاح» may stand above its «صيانة»; «فتح» opens that car's rows of that work on that exit day;
  «عرض الباقي (N) في شاشة التوكيل» only when there are more). In both period tables a car deleted
  since shows «محذوفة» and no link to its file, and a row no code names shows «—» and opens that
  day (and type, or work) under the period's set. Each part is under its own gate: a reader of the
  fines alone now sends R2 too (its period part), a reader of the receipts or of the dealership
  alone sees the fuel tab with that part only (the heading's line then names that part alone), and
  a reader of the fuel cards alone sees its expiry card only. The three tables become stacked
  blocks below 1024 px (a phone or a tablet) with no sideways scroll, the fines' «الآن» cards sit
  two to a row on a tablet with the total under them (and the period card beside the types from
  1024 px), a long driver name wraps there rather than being cut, and the day chart opens on a
  phone on its latest days. Bars and columns are in the site colour; status colours stay.
  The fuel cards now follow the branch of each card's CURRENT car (a car deleted since by its last
  branch; a card on no car — «سفر»، «اسبير» — in the company view alone): the balances, requests,
  low cards, «شُحن اليوم» and the expiring cards on the new tab, the overview's «أرصدة كروت الوقود»
  card and its three fuel lines, the fuel parts of «ملخصات» and the cards panel of «التراخيص» are
  now the branch's, drop their «الشركة كلها» tag, and their links carry the branch; «كروت الوقود» and
  «شحن الكروت» read, remember and show it (removable), and the charging screen's «شُحن اليوم» now
  follows its own company, car and branch filters (it was always the whole company) — never its
  state filter («طلبات بانتظار الاعتماد» / «رصيد منخفض» still show the day's charges), and a card
  deleted since keeps its charge of the day under its car's branch.
  `GET /fleet/fuel-cards` and `/summary` take `branchIds`, and the summary gains per-company and
  no-car counts; `/fleet/receipts/summary` gains `fuelCustodyTotal` / `fuelUnpriced`. On the
  overview, «مخالفات قائمة N مخالفة» now opens the fines tab (it opened the register), «مصروف
  الوقود» the fuel tab on this month, and the fuel card's foot the fuel tab (it opened «أرقام
  الفترة»). New read fields: R1 `violationsOpen.drivers.attributed` / `unknown` / `unlinked` and
  `bookOnly`, `fuelCards.nearest`, `fuelCharging.companyCards` / `unassigned`, `fuelCardList`,
  `fuelSheets`; R2 `violations`, `violationList`, `opex.fuelCustody` / `tyres` / `wash` /
  `maintenance` / `litres` / `unpricedFuel`, `opexSeries`, `dealershipList` (fields are only added).
  A fine's tick or edit now refreshes the period part too, a closed range («الشهر الماضي»)
  included — its fines are «قائمة» or «محصَّلة» as of now. New index `ix_kind_date` on
  `fleet_violations`. «أرقام الفترة»، «ملخصات» and «التراخيص» are otherwise unchanged and show the
  same figures as the new tabs where they share them. No new permission key. No migration; data
  unchanged.

- **«لوحة تحكم الحركة» at `/fleet`: «العدادات والكيلومترات» and «الحوادث ومطالبات التأمين» are
  rebuilt as approved, in place of the old «الكيلومترات» + «ترتيب السيارات» and «الحوادث».** «جهز
  العدادات والحوادث عشان نعملهم بى ار» — «اعمل المقترح وورينى سامبل» — «الوان البارات مش متنسقة مع
  الويب» — «اعمل اللى انت بتفضله» — «ودى موافق عليها». The bar now has nine tabs: نظرة عامة · الحركة
  اليوم · توزيع السيارات · الصيانة والورش · العدادات والكيلومترات · الحوادث ومطالبات التأمين · أرقام
  الفترة · ملخصات · التراخيص. Both new tabs keep their keys (`?tab=km`, `?tab=accidents`, bookmarks
  and the overview's accidents line open the new bodies); `ranking` is retired and an old
  `?tab=ranking` opens «العدادات والكيلومترات», which now holds the top 5 and bottom 5. Neither pill
  carries a count (the approved bar has none), so the old count of the period's accidents is gone.
  Both are panels of R1 and R2 together, like «الصيانة والورش»: each part shows its own read's
  loading and error, «تحديث» reads both, and the page's period bar stands at the top of «العدادات
  والكيلومترات» and between the two bands of «الحوادث ومطالبات التأمين». «العدادات والكيلومترات»:
  «إجمالي الكيلومترات» (confirmed through the last closed day, with the daily average), «متوسط لكل
  سيارة» (readings for X of Y active cars; the cars held in the workshop all period, and those that
  joined after it, named only when there are some), «سيارات بلا مسافة في الفترة» (of them, those
  never read), «قراءات تحتاج مراجعة» and, as of now, «بلا قراءة عداد منذ N أيام» with its longest
  gap; «الكيلومترات يومًا بيوم» across the page (Fridays dimmed by the calendar, each day's weekday
  on the axis, the average at the line's end, the multi-day distances and — only when there are some
  — the km of cars not in the registry as lines under it); «أعلى 5» | «أقل 5» with one bar measured
  against the top car, each car's make, «في الورشة منذ …» and the cars that cannot be ranked with
  their reason; «استثناءات قراءات العدادات» — «بلا قراءة حديثة» and «لم تُقرأ أبدًا» (as of now) and
  «قراءات تحتاج مراجعة» (the period's), at most 3 rows each with «و N أخرى» («في القائمة الكاملة»
  when «عرض الكل» opens it) or an end line; and, only when the figures cover one branch,
  «الكيلومترات حسب النوع». «مراجعة القراءات» and the review group's «عرض الكل» open the period's
  odometer register (no screen filters negative readings), each review row's «فتح» that car on that
  one day (a car deleted from the registry since keeps its row, with no link to its file, and its
  «فتح» opens that day without the code — the register's code filter finds live cars only); the
  top-5 foot reads «قراءات الفترة في سجل العدادات» (no screen ranks cars by km). «الحوادث ومطالبات
  التأمين»: «الآن» — «ملفات حوادث مفتوحة» (all dates, with what remains on them) and one amber
  «إخطارات تأمين مفتوحة» card (missing an attachment, the licence images and the cheque image), then
  «إخطارات ينقصها مرفق» across the page (at most 6, the oldest notice first, the car and its make or
  «بلا سيارة», the insurer by the form, the number, the day, the missing attachments; «فتح» opens
  the notices by car, number (matched as the screen's search matches it, so a number held inside
  another is listed too) and day, none for a notice with none of the three; «و N أخرى» beyond 6,
  unlinked); «خلال الفترة» — «حوادث الفترة» by accident day (still open of them), «مبالغ ملفات حوادث
  الفترة» as they stand now (collected, company cost, paid, remaining — the register's words and
  order, each opening the register; the transfers in and out as one unlinked line; the formula under
  it), and the period's accidents table, open and closed (date only, the statement on one line from
  1536 px and wrapped below it, the culprit, status, what remains as of now; «عرض الباقي (N) في
  السجل» only when there are more; the undated files noted in the company view with no filter). A
  reader of the notices alone sees the tab with the notices part only; a reader of the accidents
  alone sees it without them. Tables become stacked blocks on a phone, with no sideways scroll, and
  the day chart opens there on its latest days. All bars and columns on both tabs are in the site
  colour; status colours stay. The notices now follow the car's branch: under a branch (or «كل
  فروعي») only the notices of those branches' cars count and list, a notice with no car counts in
  the company view alone, the overview's «إخطارات ينقصها مرفق» line drops its «الشركة كلها» tag and
  its links carry the branch, and `GET /fleet/notices` and `/fleet/notices/summary` take `typeIds` /
  `operationIds` / `branchIds` (the notices screen reads and remembers «النوع», «التشغيل» and
  «الفرع», and shows them while a link or a remembered value narrows the list). «الحركة اليوم»: a
  car deleted from the registry while it is the oldest in the workshop no longer links to its file.
  New read fields: R1 `noReading.staleCount` / `neverReadCount` / `staleRows` / `neverReadRows` and
  `notices.rows`; R2 `km.coverage.active` / `inWorkshop` / `joinedAfter`, `km.noDistance`,
  `km.invalidList`, the makes on `km.top5` / `bottom5`, `accidents.totals`, and `statement` /
  `typeName` on the accident rows (fields are only added). «أرقام الفترة»، «ملخصات» and «التراخيص»
  are unchanged and show the same figures as the new tabs where they share them. No new permission
  key. No migration; data unchanged.

- **«لوحة تحكم الحركة» at `/fleet`: «توزيع السيارات» and «الصيانة والورش» are rebuilt as approved,
  in place of the old «توزيع السيارات» and «الصيانة».** «جهز توزيع السيارات و الصيانة والورش عشان
  نعملهم بى ار» — «الجدول بتاع توزيع الفروع والعربيات يكون واخد عرض الصفحة كلها البروجريس بتاع
  الكيلومترات يكون تحته ويبقى شارتس مش بروجريس» — «تمام كبر بس الحته اللى ليها علاقة بالعقود
  شويه». Both keep their tab keys and their place in the bar, so every old link (`?tab=distribution`,
  `?tab=maintenance`, bookmarks, the overview's lines) opens the new body; the pill «الصيانة» now
  reads «الصيانة والورش». «توزيع السيارات»: three operation cards (all active cars with their split
  into «نقل الأموال» · ATM · «أخرى», «نقل الأموال», ATM — each beside its drivers, drivers per car and
  the old-specialisation count only when there is one), the branch cards, largest first, each split
  by operation (a branch with no active car keeps a card of zero; «بلا فرع» only when a car has no
  branch, unlinked), the type × branch table across the whole page («—» for none, every figure but
  «بلا فرع» opening the vehicles list), and under it «الكيلومترات حسب الفرع» as a column chart of «هذا الشهر»
  (always the month to date, never the page's filters; «بلا فرع» / «غير مسجّلة» columns only when
  there are some, unlinked; the daily average, or «لا يوم مغلق بعد» on the 1st). A reader of one
  branch — chosen, or the only one granted — sees «سيارات الفرع حسب النوع» and «كيلومترات الفرع
  هذا الشهر حسب النوع» instead; «كل فروعي» keeps the company layout over its branches. A reader of
  `fleetVehicleContract.view` also sees this year's supply contracts (dated in the year; received of
  contracted, remaining, red and yellow contracts; «الشركة كلها» whenever the figures are narrowed,
  to a branch or to «كل فروعي») — a part of the
  tab: that key alone still does not open the dashboard. «الصيانة والورش»: a «الآن» band — «بلغت حد
  الصيانة» and «تقترب من حد الصيانة» with the two thresholds read from the settings, «في الورشة الآن»
  with its oldest car and «نشطة · خارج الخدمة» (plain), «صفوف توكيل بلا قيمة» — each card under its
  own permission, then «إنذارات الصيانة بالكيلومتر» (at most 8 rows, red first, the most overdue
  first; «في الورشة: …»; no «أيام بلا قراءة» column — «فتح» opens the alarms board for that car, which
  has it; «كل إنذارات الصيانة (N)», with no link
  under a branch past 50 cars; active cars only, and it says so); then the page's own period bar,
  and «خلال الفترة» counted by the day a visit LEFT the workshop: «خرجت من الورشة», «متوسط أيام
  البقاء» (whole days from check-in to exit, the same day counting 0, one decimal, «—» when none
  left), the visits by work type and by workshop, «أكثر السيارات دخولًا للورشة» and, from «الآن»,
  «أطول بقاء في الورشة الآن» (at most 5, «منذ اليوم» / «منذ N يومًا», «كل السيارات في الورشة (N)»; a
  car deleted from the registry while in the workshop stays counted and listed, with no link to its
  file and its «فتح» on the open visits).
  Every period link carries `outFrom`/`outTo` and the page's set; old-book exits with no registered
  car count in the total and the bars, are not ranked, and get one line when there are some. Each
  band shows its own read's loading and error, so one failing never blanks the other. «أرقام الفترة»
  still counts the period's visits by the day they went in, and says so; the overview's month
  «زيارات الصيانة» is by exit day, the same as the new tab. The tab now also shows for a reader of
  the dealership or of the odometer alone, with that part. Counts on the bar: none on «توزيع
  السيارات» (the approved bar has none); «الصيانة والورش» red with the cars that reached the service
  limit, hidden at zero (it was the period's visits by check-in day). On «نظرة عامة», «في الورشة»,
  «إنذار حرج» and the maintenance card's foot open «الصيانة والورش»; the action centre's «فتح» stay
  on the lists. Bars and columns of both tabs are in the site colour. New read fields: R1
  `distributionVehicles.kinds` / `noBranchKinds` / `other` (branches now ordered by active cars),
  `maintenanceAlarm.redKm` / `yellowKm` / `rows`, `workshop.longest`; R2 `exits` grows into the exit
  breakdown (`avgStayDays`, `byWorkType`, `byWorkshop`, `topVehicles`, `unregistered`) and `visits`
  keeps only `count` / `closed` / `open`. The other old tabs (الكيلومترات، ترتيب السيارات، الحوادث،
  أرقام الفترة، ملخصات، التراخيص) are unchanged. No new permission key. No migration; data unchanged.

- **«لوحة تحكم الحركة» at `/fleet`: the first two redesigned tabs, «نظرة عامة» and «الحركة اليوم»,
  take the place of «التنبيهات» and «الحركة الآن»; the figures of a reader of one branch or of
  several are now that reader's branches.** «نفذ اول شاشتين وضيفهم فى pr ولما يخضر اعمل ميرج» —
  «عاوز فى اى وقت ابقى احدد الفرع اللى انا عاوز اجيب الاحصائيات عليه» — «انا عاوز الافتراضى يكون
  ل بداية الشهر». The dashboard opens on «نظرة عامة» (layout B as approved): six cards (fleet
  readiness, ready cars without a driver today in amber «تحتاج تعيين», the workshop now, urgent
  alerts counted as lines, the two fuel-card balances, the custody fund), the action centre (one row
  per alert line that fired, urgent first, each with one «فتح»; the absent fixed crews and the
  custody lines of «التنبيهات» included, and every part «التنبيهات» said on a line kept — the cars
  approaching the maintenance limit, the crews covered, planned with an unavailable driver or out
  for other reasons), the sections' hub (each line opens the tab that shows the same figure, keeping
  the page's filters — «حوادث الشهر» opens the accidents tab on this month alone, the slice it
  counts — or its register: «إنذار حرج» the alarms, «مخالفات قائمة N مخالفة» every year's unpaid
  fines, «مصروف الوقود» the fuel receipts) and «ملخص إحصائيات هذا الشهر», read for this month with
  no page filter — its «زيارات الصيانة» counted by the day a car LEFT the workshop and saying so,
  while the old «الصيانة» and «أرقام الفترة» still count by the day it went in (both now say so, as
  does the «الصيانة» count on the bar) until «الصيانة والورش» is built. When the «الآن» read fails or
  is on its way, the overview keeps its month card, the month's hub lines and the custody figures.
  «الحركة اليوم»: readiness and the day's balance of cars and drivers, five cards, «سيارات بلا سائق
  اليوم» (at most 8 rows; why each has no driver — the three «أسباب عدم التعيين» reasons, or a fourth
  «لم يُعيَّن لها سائق» when none applies — the absent driver named with the roster's own reason;
  «فتح» on the day's roster, «عرض الكل (N)»; on a phone each row is a block, no sideways scroll) and
  «الغائبون اليوم» (at most 6 rows with «عرض الكل (N)»; names only with `fleetDriver.view`).
  «اقتراحات» and «تعمل اليوم» of the old «الحركة الآن» are gone, as approved. Nothing without data
  is drawn: «أمر حركة عاجل», a cost per km, coverage days, savings and the like are gone. The other
  eight tabs are unchanged, each standing in the bar where its redesign will stand; an old link to
  `?tab=alerts` opens «نظرة عامة» and `?tab=now` opens «الحركة اليوم». One strip of tabs (no «الآن |
  حسب الفلاتر» groups), with a scroll cue when the tabs do not fit and «الفرع: الشركة كلها / <الفرع>
  / كل فروعي» at its end — what the figures cover, not a second picker. The counts: «الحركة اليوم»
  amber with the cars without a driver, none on «نظرة عامة», the old tabs' as before. Branch scope:
  a reader whose grant covers one branch or several («كل فروعي») now gets every company figure
  narrowed to those branches on every tab — many were the whole company before; a switcher branch
  outside them is ignored; the custody, drivers, fuel-card and notices figures stay company-wide and
  wear «الشركة كلها». A reader of one branch sees «الكيلومترات حسب النوع» as a chosen branch does.
  The period opens on «هذا الشهر» on every visit and a chosen one stays while moving between tabs;
  type, operation and codes are still remembered (`useRememberedFilters` now restores only the names
  a screen declares). New read fields: `scopeBranches` (R1 and both `vehicleScope`s), R1
  `violationsOpen` (every year, amount and count), `fuelCharging.cards`,
  `distributionVehicles.branchCount` and the roster's `unmannedRows`, `unmannedUnassigned` and
  `absentDrivers`; R2 `exits` (visits by exit day) and `opex.fuel`. No new permission key. No
  migration; data unchanged.

- **«الصيانة»: «سائق الخروج» can be corrected in «تعديل الزيارة».** «دلوقتى عاوز ف الصيانة عاوز اقدر
  اعدل السواق التانى اللى هو سائق الخروج». Before, a wrong exit driver could only be fixed by
  reopening the visit, which also clears the exit date, the exit counter and the custody, and
  checking it out again.
  - On a visit that has left the workshop, the edit shows «سائق الخروج» right after «سائق الدخول»,
    with the same picker, opened on the stored driver. A visit still in the workshop does not
    show it: «إخراج من الورشة» sets it.
  - A correction, never a clear, as for «سائق الدخول»: it can be changed to another driver but
    not emptied. On an old visit with only the old book's spelling, it opens empty and stays
    optional; choosing a driver records the employee, who is then shown instead of the spelling.
  - `PATCH /fleet/maintenance/:id` takes an optional `driverOutEmployeeId`: refused on an open
    visit (400 on `body.driverOutEmployeeId`, `INVALID`; a copy read before someone reopened the
    visit gets 409 `STALE_DOCUMENT` instead), `null` refused, and checked against HR
    only when it differs from the stored driver. Same permission (`fleetMaintenance.edit`),
    version check and `update` audit as the rest of the edit. The screen sends it only when the
    edit changed it.
  - Unchanged: reopen still clears it, check-out still requires it, and the exit date stays
    non-editable ([design §4.2](docs/12-planning/fleet-module-design.md)).
- **IT vehicle check: every device opens at «يعمل»; a fault needs a note, and every report a
  photo.** «عايز هنا /it/vehicle-checks/new التلقائي إن كله يعمل ولو حاجة لا تعمل يبقى يغيرها»،
  «كمان عايز الملاحظة إجبارى لو فى حاجة لا تعمل · وكمان الصورة كدا كدا إجبارى فى كل الحالات».
  - The form opens with «يعمل» chosen on all eleven devices; the reporter taps «لا يعمل» on what
    fails. A tap on the chosen «يعمل» still clears it, for a device the car lacks.
  - With any device «لا يعمل», «ملاحظات» is required (marked «*», with a hint). The server refuses
    such a report without a note (422 `IT_VEHICLE_CHECK_NOTES_REQUIRED`); a repeat of a report
    already filed still answers 200.
  - At least one photo is required on the form. The server cannot require it, because photos go
    up after the report is filed. A report whose uploads all failed says so in red on the sent
    screen, which offers «إعادة رفع الصور» while it stays open; «تقرير لسيارة أخرى» and the back
    arrow ask once before leaving it, and a reload asks while failed photos wait.
- **«حوادث السيارات»: the approved board and form, and a transfer from other cars whose amount may
  now be typed.** «شكل تعديل الشاشه بتاعت الحوادث تمام». Built from the owner-approved samples
  ([design §4.6](docs/12-planning/fleet-module-design.md)).
  - **The board.** No page title. A toolbar with «N نتيجة», «الإحصائيات», the Excel pill and the
    purple «تسجيل حادث». The dark filter bar: من, إلى, كود السيارة, المتسبب, ملاحظات, الحالة. The
    table is bold like the receipts register («سيب شكل الخط كدا»), with the date first and then
    «كود السيارة». A closed file's row is tinted, a negative remaining is red with its «−», and the
    small grey «تحويل وارد» / «تحويل صادر» line under «إجمالي المتبقي» stays. The five totals sit
    behind «الإحصائيات», closed on the way in. The culprit cell keeps the driver card, and the car's
    code opens the new car card (see Added). The whole car list is read only for a reader with
    `fleetVehicle.view`; it was requested for everyone.
  - **The form**, in the Fleet forms' design: «بيانات الحادث»; «المبالغ», with a read-only
    «المتبقي على هذا الحادث» under the three amounts; «أخذ مبلغ من متبقي سيارة أخرى (اختياري)»;
    then «ملاحظات». A refusal shows under its field and in the banner over «حفظ».
  - **The transfer. This reverses part of the owner's 2026-10-01 rule «مش انا اللى هكتب المبلغ
    الماخوذ».** Under that rule the amount was never typed: the cars he picked covered the
    accident's whole negative. He has now approved both ways: «هتسمح انه يدخل المبلغ او انت تلقائى
    اعرف المبلغ اللى بالسالب كام وشيله», and «ممكن اختار فى الاول عربيتين وبعد كدا اكتب المبلغ
    ميبقاش جايب ف يكمل هو». The rules:
    1. The amount may be typed. Left empty with at least one car ticked, it is the accident's
       whole negative. Nothing ticked and nothing typed is no transfer; the section stays
       optional. A typed 0 is refused: «اكتب مبلغاً أكبر من صفر، أو اتركه فارغاً». So is a box
       holding no number, such as a lone «.», which is never planned or sent.
    2. A typed amount above the accident's negative is refused under the field: «لا يمكن أخذ أكثر
       من سالب هذا الحادث (…)». An accident that is not negative has nothing to cover, as before.
    3. His cars give first, in the order he ticked them, each down to 0 before the next. One that
       is not needed stays listed at 0.00, greyed, «لم يُحتج إليها».
    4. Still short, the system completes from the other cars with money left: never one he
       unticked, never the accident's own car. The smallest balance goes first (a tie goes to the
       lower code), each taken whole to 0, and the last gives only the rest.
    5. All the cars together short is allowed: «ولو اختار كل العربيات اللى فيها فلوس ولسه العربيه
       عليها فلوس عادى اسمح انه يكمل». Everything available is taken, and an amber note says what
       stays on the accident: «يُؤخذ كل المتاح في السيارات (…)، ويبقى على هذا الحادث …», or «…في
       السيارات المحددة…» when a car he unticked still holds money.
    6. Every row says who chose it, «اختيار يدوي» or «اختيار تلقائي», in the plan table and on the
       ticked cars of the open list. A car he unticked is never added back. «مسح الكل» and ✕ clear
       the cars and the amount.
    7. «تغطية السالب كله تلقائياً · … ج.م.» («لا سيب الزرار») is offered while the accident is
       negative and nothing is ticked or typed. It fills the amount with the whole negative.
    8. At most 20 cars give in one save, the contract's limit («تمام»). If stopping there leaves
       the accident short, the amber note says so, and saving stays allowed.
  - **What is sent.** Only the cars that give something, in the plan's order, with the amount equal
    to what they give. The plan is one pure function, `planTransfer`, which replaces
    `coverDeficit`; its spec carries the sample's 52 checks and the 20-car stop. The server checks
    the same figures again inside the save (see Fixed).
  - **A refused save** of a new or edited file reads the accidents again, car balances included,
    so the form plans afresh from the server's figures. Close, reopen, delete and removing a
    transfer keep the shared error handling.

- **IT: a custody hand-over records without a printed receipt.** «فى الـ IT تحديداً فى تسليم العهدة
  عايزك تسمح عادى بالتسليم حتى لو مطبعش إيصال». In «تسليم عهدة», «تسليم» works as soon as the form is
  complete; «طباعة الإيصال» stays beside it. The hand-over still writes its receipt, so the paper
  prints later from «عهدة الأصول» (Asset custody), the asset's page or the employee's page, and the
  dashboard counts it among the receipts awaiting a signed copy. A paper printed and then made
  stale by an edit is not recorded: the receipt takes the next number. A transfer to a new holder
  and a mobile line's hand-over still print first.
- **The system made faster for the branch rollout.** «عايزك تتحقق من كفاءة النظام بشكل عام .. وتقترح
  ما يزيد من الكفاءة .. أو فى حاجة تخلى الدنيا أسرع خصوصاُ مع الشغل التقيل لأنى هشغل الأفرع». Measured
  on production before the change (Railway logs and metrics, the Atlas alert «Query Targeting: Scanned
  Objects / Returned has gone above 1000»). The answers on every screen are the same; they arrive in
  fewer and cheaper database reads.
  - **ATM open boards read once.** The replenishment and maintenance boards read
    `GET /atm/{replenishments|maintenances}/board`, every open row in one read, instead of walking
    the paged list (a find and a count per page, walked again when totals moved). The read stops at
    5000 rows and says so on screen. New indexes serve the board order for a branch reader
    (`ix_branch_open_board`) and for a reader of the whole company (`ix_open_board`); the
    dropdowns' names come from the same open rows instead of a `distinct` that scanned the whole
    log.
  - **Live updates on the ATM pages are gathered.** One bulk action is one refresh, not one per
    row: ATM signals wait 1.5 seconds (4 at most) and each browser adds its own small delay so the
    screens do not all ask at the same instant. A tab in the background only marks its data old and
    refreshes once when it is shown again. The dropdowns and the done pages refresh on their next
    read.
  - **The done pages' date range** applies a typed day only once it is a complete date from the
    year 2000, half a second after typing stops or at once on leaving the box. Typing a year no
    longer read ranges reaching back centuries.
  - **ATM batch writes in one round trip.** A batch open writes every line in one insert and its
    audit rows in one queue add (it took 1.2 seconds for replenishments and up to 2.3 for
    maintenance). The mail reject decides the whole selection in one write (it took 1.7 seconds).
    Close and the bulk edit record their audit rows in one add too.
  - **Fleet pages.** The alarms read the cars and makes once instead of page by page; the odometer
    page, the maintenance page and the dashboard run their reads side by side. New indexes serve the
    order the odometer, maintenance and accident registers open in, and the reading chain's order.
  - **Audit log.** Two indexes (`ix_action_at`, `ix_at`) serve the hourly security-signal checks,
    which scanned the whole audit collection every hour — the cause of the Atlas alert — and the
    audit page's default order. They are built at boot when missing. An unfiltered audit or activity
    page takes its total from the collection's own count instead of reading every row.
  - **`GET /platform/settings/me`** reads every setting in one query instead of one per setting.
  - **Diagnostics.** The «slow mongo operation» log line names the collection, and each boot logs
    the database round trip («mongo round trip», median and minimum of five pings).
  - **Unchanged rules, safer edges.** Each row of a batch keeps its own audit instant, a millisecond
    apart, so paging the audit list shows each once. A mail reject reads back exactly the tickets its
    own write decided. A batch open that a leftover unique index refuses, or that fails with no
    per-row answer, is reported to the error log instead of passing silently.
- **A sign-in page left in a background tab stops renewing its passkey request.** With the
  ten-minute idle sign-out, sign-in pages sit open all day; each renewed its fingerprint/face request
  every few minutes (110 requests in 45 minutes from one browser). It now renews only while the tab
  is shown, and at once when it is shown again.

- **How the ATM pages read, set on `/atm/settings`.** «خلى حجم الكلام فى الصفحات وإذا كان Bold أو
  لأ + درجة لون خطوط الجداول .. أقدر أتحكم فيها من /atm/settings». A new card, «شكل الصفحات», sets
  three things for every ATM page and every user: the text size (90, 100, 110, 125 or 140 percent
  of the app's own), bold text on or off, and how dark the tables' lines are (lighter, as they are,
  darker, darkest). A sample table under the choices shows the result before it is saved. The side
  bar and the top bar keep their look; the data does not change. Until the card is saved the pages
  read as they always did.
- **Rows copied from an ATM table stay a table in WhatsApp.** «لما أخد Copy من الجدول تطلعهولى بشكل
  جدول … فالكلام داخل في بعضه .. عايز حافظ على شكلة كجدول لما أبعته واتساب». The copy put a tab
  between cells, which a chat shows as a narrow space, so «MISR 1150744 فرع القصر العينى مسائي» ran
  together. A copy that covers cells of an ATM table (a drag across rows, or Ctrl+A on a board) is
  now one line per row with « | » between cells: `MISR | 1150744 | فرع القصر العينى | مسائي`, and a
  blank line between rows («عايز فى موضوع الـ Copy إنه يسيب مسافة بين كل صف والتاني»). A sheet, a
  document or an e-mail still pastes real rows and columns, row under row. Only what the rows show
  is copied: a board's timers and buttons stay out, as before. A selection inside one cell copies as
  it always did.
- **The area's column filter starts over each time it is opened.** «لما أضغط على فلتر (المنطقة فقط)
  يعمله Reset وأقدر أختار من الأول في كل الصفحات بتاعت ATM». Opening the area list under the head
  clears the areas picked in it, so the table shows every area again and the areas are picked
  afresh. Every other column keeps its picks when its list opens, so a value can be added to them.
  On the boards, the done pages, both mail pages, the cassette layouts and control's data tab.
- **The top area filter opens inside the screen.** «فلتر المنطقة (اللى فوق خالص) بجانب البنك .. على
  الشمال.. لما بضغط عليه المنيو بيطلع شمال برا الشاشة وبيغير الـ UI». With seven areas or more the list
  has a search box, and that box took the caret before the list was moved back inside the screen:
  the browser scrolled the board sideways to reach it and left the page shifted. The box now takes
  the caret once the list is in place, and moves nothing. This applies to every drop-down filter of
  this kind in the app.
- **ATM tables keep their column widths when filtered, and a time stays on one line.** «عرض الأعمدة
  فى الجدول بيتغير لما بعمل فلتر !! عايزك تثبته .. وحافظ على الوقت يظهر بالعرض كامل مش تحت بعض بردو
  فى كل الجداول». A table laid its columns out by the rows it showed, so picking an area, or anything
  else that drops rows, narrowed some columns and widened others. Each ATM table now takes its
  column widths the first time it shows rows and keeps them while it is filtered; the widths follow
  the window.
  - A page that opens with a remembered filter (an area on the boards, for example) keeps the widths
    of those rows only until the filter is lifted; the whole table's widths are then taken once.
  - A value that does not fit its column (a later time, a narrower window, larger text) widens it,
    and the widths are taken again from there once, so later filters still move nothing.
  - Each view keeps its own widths: back on «اليوم» from «أيام سابقة», the board is as it was left.
  - The schedule, the open and close times, the time taken and the live timer («00h : 03m : 42s»),
    a run's time, the mail's received and action times, and a cassette layout's change time no
    longer break over two or three lines.

  On the boards, the done pages, both mail pages, the cassette layouts, the machines, data edit,
  the daily report, the plan, control and preparation.
- **The daily report covers a period.** «فى تقرير اليوم بقي عايز كمان تسمح بإنى أختار فترة من إلى ..
  بس الـ Default يكون اليوم». `/atm/reports/daily` now has «من» and «إلى» on the title's line in
  place of the one day, today in both by default. For each bank the two tables count every
  replenishment and maintenance opened from the first day to the last, both included, and how many
  of them are still open. One day filled in serves as both, a «إلى» before the «من» reads the days
  between, and a link that names a single day (`?date=`) still opens on that day. An empty period of
  more than one day says «لا توجد عمليات في هذه الفترة»; a single day, today's included, still says
  «لا توجد عمليات في هذا اليوم».
- **System settings: every setting titled and described in Arabic and English, grouped by
  department.** «فى الـ /system/settings في عناوين كتير بالشكل دا atm.mail.branchCategories !! عايز
  أخليهم بالعربي وأظبطهم بالإنجليزي بردو» · «وحاول تظبط الـ UI بتاعت الصفحة دي عموماً وتقسم
  الحاجات طبقاً للإدارات أو General وهكذا». All 59 settings now have their own title and a short
  description in both languages; the key stays on the row, small, for search. Tabs split the page
  into General (sign-in, audit, notifications, feature flags), HR, Fleet, Operations, ATM and IT,
  and each department into sections (for example Fleet: maintenance, licences, vehicles, fuel
  prices, fuel cards, reports); «الكل» shows them all. The tab and the search are kept in the
  address. Each row says where its value comes from, which levels it can be set at, and the
  default only when the value differs; Save sits beside the field. A setting that is a list of
  departments or branch rows shows how many are set and links to the screen that edits it by name
  (ATM settings, register import, help-desk settings, crew requirements). The per-branch Outlook
  category list is only a fallback that ATM settings never writes, so its row links there without
  promising an edit and keeps a confirmed «مسح هذه القائمة»; the one setting nothing reads any more
  (`atm.register.bankLabels`) is marked as retired instead of offering a field. The search folds
  Arabic as every other search box does. A new setting without a title and description in both
  languages now fails the tests.
  - **The SLA «at risk» threshold follows its setting.** `it.sla.atRiskPercent` was declared but
    the indicator used 80 regardless; it now reads the setting (80 remains the default).
  - Two messages and one API error that named a setting by its key now name it by its title.
- **Every ATM page puts its row beside the title.** «عايز تطلع الصف بتاع الـ Form يبقي بجانب العنوان
  عشان نستفيد بالمساحة (واعمل الحركة دي في كل الصفحات بتاعت ATM)». The form, filters or date bar
  that sat under the title now share the title's line on a computer, and the table gets that
  height back: the boards, the mail pages, the done pages, the daily report, control, the plan,
  preparation, the layouts and data-edit. When the line runs short the row wraps inside itself, or
  takes a line of its own under the title; a phone stacks as before. The machine list's and the
  register's filter bars stay above their tables.
- **A filter list under every column of the ATM tables.** «فلتر لكل عمود», then «لأ عايز الفلتر
  الكبير اللى فوق الجداول يكون Drop Down بـ Multi select». Under each column's name a drop-down
  lists the values that column shows — each once, in alphabetical order, numbers in number order,
  dates and times in time order, runs first to third, and «(فارغ)» for empty cells — and keeps the
  rows holding any of the values ticked in it. Typing in the list's search finds values (a date's
  «/» counts: «2/11» never finds 21/10), and «كل النتائج» (or Enter) ticks every value found; a
  second press unticks them. A list offers the values left by the other columns' picks and by the
  bank and area filters above, as they stand when it opens, so it never offers a value that would
  empty the table. The columns add up with each other and with
  those filters. On the boards the day buttons' counts and the area lines follow them, a checked
  row they hide is never acted on, Excel and PDF name them under the title, and the reset clears
  them. The list opens over the page, so the table's edge never cuts it off. On the boards, the done
  pages, both mail pages, the plan, preparation, control, the layouts, the daily report and
  data-edit's banks. The machine list and the register, read page by page from the server, keep
  their own filters.
- **«تحديد الكل» on F8 in رسائل الصيانة.** «في رسائل الصيانة /atm/mail-tickets عايزك تزود موضوع
  الـ Select All من خلال F8». As on the boards: F8 shows the head's box until the next key or press
  elsewhere, and it checks the mails on screen only.
- **The replenishment and maintenance boards are grouped by area, areas in alphabetical order.**
  «عايز كمان إن التغذيات والأعطال يبقي معمولها Group by المناطق + Sorting بالمناطق بردو · يعني كل
  منطقة تظهر اعطالها وتغذياتها تحت بعض + بترتيب ابجدى للمناطق». On `/atm/replenishments` and
  `/atm/maintenance` each area's rows sit together under a line with the area's name and how many
  rows it holds. Arabic names run أ → ي, then Latin ones A → Z, and rows with no area come last,
  under «بدون منطقة». A spelling that differs only by spaces is one area. A click on «المنطقة»
  turns the areas round; a click on any other column orders the rows inside each area. On a board
  wider than the screen, the area's name stays in view as the table scrolls sideways. Excel and PDF
  follow the same order. The done pages are unchanged.
- **The maintenance board copies the service type, not the open time.** «فى الـ Selection بتاع
  بيانات الجدول فى الأعطال مش عايز التوقيت .. لكن عايز نوع الخدمة يبقى Selectable معاهم». A drag
  across the rows of `/atm/maintenance` (or Ctrl+A) now picks up the bank, the code, the machine
  name and «نوع الخدمة»; the open time stays out, like the box, the timer and the buttons.
- **A machine may have more than one open replenishment.** «عايزك تسمح فى التغذيات بإنى افتح تغذيه
  أكتر من واحده لنفس الماكينة عادى .. لأنه بيمنع دلوقتى». The rule «a machine is never open twice on
  one day» now holds for maintenance only (port doc OD-1b). On `/atm/replenishments`, every pasted
  code the branch knows opens its own operation: a code pasted twice opens twice, and a machine
  already open today (in this branch or another) opens again, as in the old system. The done page
  reopens a replenishment beside another open one, and the edit dialogs move the open time onto any
  day, the checked set's two rows of one machine included. The «لم تُفتح لأن للماكينة تغذية مفتوحة»
  line and its reopen and move refusals are gone from the replenishment screens. Maintenance
  followed a day later (the next entry). The boot drops the replenishment log's unique index
  (`ux_open_replenishment_per_code_day`) from an existing database, and the legacy importer writes
  every replenishment row as it was.
- **A machine may have more than one open maintenance.** «في الصيانة عايزك تسمح إنه يضيف أكتر من
  صيانة عادي». The rule «a machine is never open twice on one day» is now gone for maintenance too
  (port doc OD-1c), so nothing is left of it. On `/atm/maintenance`, every pasted code the branch
  knows opens its own operation: a code pasted twice opens twice, and a machine already in
  maintenance today (in this branch or another) opens again, as in the old system. The done page
  reopens a maintenance beside another open one, and the edit dialog moves the open time onto any
  day. On `/atm/mail-tickets`, a mail whose machine already has an open maintenance that day is
  accepted and opens another one. Its row stays yellow with «مكررة», as a warning, and the accept
  confirm says that accepting it opens another maintenance. The refusal lines are gone from these
  screens. Two clicks on «قبول» for the same mail at the same time still open one maintenance: a new
  index allows one live maintenance per mail (`ux_maintenance_per_mail_ticket`), and a mail's
  maintenance and its «accepted» are now written together, so an accept racing a reject of the
  same mail leaves nothing behind. A maintenance an earlier accept left without its mail marked
  accepted is taken up by the next accept of that mail instead of blocking it. The boot drops the
  maintenance log's per-day index (`ux_open_maintenance_per_code_day`) from an existing database,
  and the legacy importer writes every maintenance row as it was.
- **The IT asset and custody registers filter by several categories and several names, the names
  following the categories.** «في الـ it/assets عايز فلتر الأسم يبقي بعد الفئات (فى الفلتر فقط)
  والبيانات اللى فى فلتر الفئات هي نفسها تتفلتر بناء على الفئات وعايز الأتنين دول يبقوا
  Multiselect · وفى /it/custody بردو عايز الصنف يبقي بعد الفئة (فى الفلتر فقط) ونفس الكلام يتفلتر
  والأتنين يكونوا Multiselect». On `/it/assets` the filter bar reads search, status, «الفئة», «الاسم»,
  branch, holder; on `/it/custody` «بحث» (code, name or serial), «الفئة», «الصنف», then the rest.
  Both category and name filters take several answers, and the names offered are those of the
  chosen categories. A name holding a comma works. The Excel/PDF name every choice.
- **The side menu shows itself on hover, over the page; pinned, it takes its place beside it.**
  «الsidebar يظهر لما اعمل hover عليه ويظهر فوق الكونتنت ميخدش حايز» — then «عايزك تخلي موضوع
  توسيع وطى يبقي أيقونة Pin فوق بعد الـ 4 مربعات» and «لما اعمل تثبيت يبقى موجود بس يلخد من الحايز
  عادى». On a desktop only the slim icon strip stands beside the page by default, so tables get
  the full width. Resting the pointer on the strip (or tabbing into it) shows the full menu OVER the
  page, and it goes when the pointer leaves or with Escape. The pin at the top of the menu, right
  after the module switcher's four squares, keeps it open: pinned, the menu stands in the layout
  and the page narrows beside it, as the expanded column used to. The expand/collapse buttons at
  the bottom are gone. Both menu styles (the launchpad and the module rail) behave the same; the
  choice is remembered per device, and everyone starts unpinned. The phone drawer is unchanged.
- **Every module tile says what its module is, and no two look alike.** «بص الأيقونات بتاعت
  الإدارات مش متناسقة مع مدلول الإدارة … وبعدين فى متكرر ! عايز كل أيقونة تكون بتعبر عن اسم
  الإدارة». In «الوحدات» (and the module rail and the command palette): العمليات is a banknote,
  الصراف الآلي a cash machine, خزائن الذهب stacked gold bars — no longer the shield the two shared —
  and الهيكل التنظيمي the building chosen for it before, which the ATM tile no longer wears. HR,
  Fleet, IT and Administration already said what they are. Existing installations take these four
  icons once at the next boot, whatever the tile held (the live tiles had been set by hand); the
  change is audited, and an administrator's own choice after it stands. Reopen the app once after
  the deploy so it has the new drawings.

- **The device acknowledgment agrees with what it hands over.** A screen or a printer now reads
  «ومواصفاتها … لاستخدامها … بالحفاظ عليها … بردها»; a device, a laptop or a mouse reads as before
  («شوف أنت الأنسب وأعمله»).
- **A mobile line someone holds can move branch.** «عايزك تفتح إنى أعدل الفرع عادي لخط من خطوط
  الموبايل لأن ممكن القائد يغير الفرع بتاعه». Editing the branch of a handed-over line now moves the
  line with its current holder and their acknowledgment, so the new branch sees and reprints them.

- **The Data Report's numbers rise with each machine added on `/atm/data-edit`, and data-edit's add
  answers differently.** «عايز لما يتضاف حاجة هنا /atm/data-edit تتضاف هنا /atm/register بحيث شغل
  العمليات ميعطلش». Each add in a mapped branch whose bank is known opens a register entry from that
  day. It counts in the Data Report at once, and the settlements find its bank, so it is no longer
  refused there as having none. The import's 57-number check still compares the workbook's six banks
  only. A code archived in the branch is brought back to work with the form's name and area,
  instead of being refused as already registered (a bulk add lists it as brought back); its bank is
  the bank of the register entry it is linked to or receives, when that entry has one, so the
  machine and the register never name two different banks. A code that
  is active, or has an open register period, in another branch is now refused, and nothing is
  written. Before, data-edit added it, and the mail reader then stopped matching that code. Adding a
  machine needs `atmMachine.manage` over the branch it lands in, and an archived bank cannot be
  chosen for a new machine. Deleting a machine by its code (how a mistyped code is fixed) needs the
  same reach, and also removes the register entry its add wrote while Efficiency has not touched
  it, so the code is free again in every branch; an entry Efficiency already edited stays. The register refuses a bank code the catalog does not have, an archived
  bank on a new receipt, and an Operations bank name that belongs to another bank or to none
  (DEC-25 now holds on the server too). The setting `atm.register.bankLabels` is retired: each bank's
  Operations name lives in the catalog, a stored label carried over at the first boot, and the
  import page's settings card shows the catalog instead of editing it. `atm.settlements.banks` takes
  any catalog code, up to 50, and a standard load is refused for a bank that is not in the catalog
  or not enabled for settlements. Deleting a register entry Operations recorded archives its machine, as
  for any receipt; the delete dialog says so
  ([register spec DEC-36, DEC-41, R-14–R-19](docs/12-planning/atm-efficiency-register.md),
  [settlements DS-24](docs/12-planning/atm-settlements-phase1.md)).

- **A machine is refused only when it is already open THAT DAY.** «خلى الرفض دا … يحصل فقط إذا كانت
  الماكينات مفتوحه في نفس اليوم ولم تُغلق ! مش يرفضها لو مفتوحه أمبارح ومتقفلتش». The owner's rule
  (OD-1) is now per Cairo day: a replenishment or maintenance left open yesterday no longer blocks
  today's open, a reopen or a mail accept — a second open on the SAME day still does. The rule now
  also holds an edit that moves an open operation's time onto a day its machine is already open on
  (409, said in words on the dialog). Each operation stores its day (`openDay`); the race-proof
  index is now unique on `{ machineCode, openDay }` (`ux_open_*_per_code_day`), and the boot DROPS
  the rule's first, any-day index (`ux_open_*_per_code`) — an index, never a document. The mail
  screen's «Duplicate» flag asks the same question of the ticket's received day.

- **The IT acknowledgment names what is handed over by its category, not always «جهاز».** «عايز
  كلمة جهاز تبقى متغيرة … حسب (الفئة)» — «بأنني قد استلمت شاشة Dell / P2419H», «… ماوس …», «… لاب
  توب …»; a computer (desktop or all-in-one) stays «جهاز», as does a receipt with no kind on file
  ([IT design §17](docs/12-planning/it-module-design.md)).
- **«كل الماكينات» filters every column, counts what it shows, and reaches every machine.**
  «عايز فلتر كامل بكل حاجة فى الجدول زى فلتر الحركة كدا فى السيارات … وكمان عدد الماكينات والبنوك
  والمناطق يظهر فوق بجانب جملة كل الماكينات (ويتغير بناء على الفلتر)». `/atm/machines` wears the
  vehicles registry's dark filter bar: one control per column, in the table's order, each with its
  icon — Bank and Area take several names (offered from the machines the other filters leave), ID
  takes codes picked from a server search or typed and pasted (normalized, `0123` is 123), ATM
  Name a few letters. Beside the title: how many machines, banks and areas the filter matches,
  counted by the server over the whole filtered set in the reader's scope (`GET
  /atm/machines/summary`). Every column sorts. The page used to read ONE page of a hundred with no
  pager, so with some 2,600 active machines the list, the search and the export only ever saw the
  first hundred: it now pages on the server (page size to choose), and the CSV export — the same
  four columns — walks every page of the filter. The free-text search box gave way to the column
  filters. The Fleet filter frame, dark bar, stroke icon and sort rules moved to `shared/` so a
  second module can use them; Fleet draws exactly as before.
- **An ATM machine is never added twice — to replenishment or to maintenance.** «مينفعش أضيف
  ماكينة مرتين سواء فى عملية التغذية أو الصيانة». A machine now has at most one open replenishment
  and one open maintenance, company-wide (port doc OD-1, overriding the legacy, which had no such
  guard). The open forms leave a machine that is already open — or a code pasted twice — unopened
  and name it in red beside the unknown codes, while the other lines still open; reopening from a
  done page is refused while another operation of the machine is open; a maintenance mail whose
  machine already has an open maintenance is not accepted, stays pending and is named on the
  screen. The mail «Duplicate» flag now means exactly that — an open maintenance on any day, not
  only today, and the accept confirm says beforehand how many of the selected mails will stay
  pending for that reason. Because an open operation of ANY day now blocks its machine, the grey
  carried-over rows on both live boards (opened on an earlier day, or still open after midnight)
  gain the close button and the checkbox they never had, so they can be closed where they are
  shown. A unique index per collection holds the rule under concurrent submits; the legacy
  importer reports the historical open duplicates the index refuses instead of failing — and says
  so when that index is absent and nothing could refuse them.
- **The acknowledgment prints the employee's code.** «عايز بردو أضيف كود الموظف هنا»: the
  statement reads «… بشركة إيجي كاش للحلول النقدية، كود …، بطاقة رقم قومي …», the code filled from
  the system in the form's red and digits, or left for the pen when the employee cannot be named.
- **The acknowledgment no longer prints «صادرة من قسم … – … بتاريخ …».** «شيل الجزء دا من الإيصال»:
  the statement runs «… بطاقة رقم قومي … بأنني قد استلمت جهاز …», and the paper's date stays in the
  signature block. The section and department are still kept on the receipt, unprinted.
- **The acknowledgment names the device by its make and model, and the company as «إيجي كاش
  للحلول النقدية».** «شيل كلمة لتكنولوجيا … وخليها للحلول النقدية على طول» and «خليه يظهر الـ
  Manufacturer / Model بداله»: the statement now reads «بشركة إيجي كاش للحلول النقدية» and
  «بأنني قد استلمت جهاز Lenovo / ThinkCentre neo 50a 24 gen 5 برقم مسلسل …», falling back to the
  asset's category only when neither make nor model is on file. The make and model stays in one
  piece, and the statement is set from the right edge instead of justified, so no line of it is
  stretched around a long name.
- **The custody acknowledgment fills its identity line from the system.** «بطاقة رقم قومي …
  صادرة من قسم … – … بتاريخ … مفروض تملأها تلقائي من النظام». The line now carries the employee's
  national ID, section and department from HR and the paper's date, and the receipt keeps them like
  the name. The national ID is shown only to a user holding the new permission «عرض الرقم القومي
  للمستلم في إقرار الاستلام» (`itAsset.viewNationalId`, Security Architecture §3) — the super
  administrator has it, IT staff are granted it on the roles screen; anyone else prints the line
  for the pen and is told why. Under the signature the name is the first three parts, on one line
  («ممكن ثلاثي فقط تحت عند الإمضاء»); compound names («عبد الله», «نور الدين») stay whole, and HR's
  quadruple-name advice now counts «نور الدين»-type compounds as one part too.
- **IT prints the department's «إقرار استلام» instead of the item-table receipt.** «ومعلش هنغير
  التصميم بتاع الطباعة فى الـ IT فقط لدا». The paper is reproduced from the form the owner sent —
  its letterhead and banner, «إقرار استلام», the statement «أقر أنا / … بوظيفة … بأنني قد استلمت
  جهاز … برقم مسلسل … ومواصفاته كالتالي:», the specifications table (Component / Details: System,
  Storage, Graphics, Network), «ومشتملاته كالتالي:», the undertaking and «المقر بما فيه» with the
  name, signature and date — one page per device, all under the receipt's one number, which the
  footer prints as «EGYCASH | IT Dept. | EGYCASH-IT-F-14-0001». The form's red fields are filled
  in red: the employee's name and job, the device's kind (its category's Arabic name) and serial.
  The national ID and its issue details stay dotted lines for the pen. To fill the table, an asset
  now records its specifications (processor, memory, system type, storage, media drive, display
  adapter, graphics memory, network adapters) and its accessories, on the asset form and the asset
  page; the hand-over shows each device's accessories and lets them be changed for that paper.
  Every receipt keeps what it printed, so a reprint is the signed paper. Only IT's printing
  changed.
- **The IT custody receipt carries its own number and the day it is printed.** The footer's fixed
  «EGYCASH-IT -F-14-02 · Issue date: 1/5/2022» becomes the paper's number — EGYCASH-IT-F-14-0001,
  one more on every print — beside the form's revision and today's date. The hand-over records the
  number of the paper the employee signed (a number never printed, or one already used, is
  refused), and printing a stored receipt again keeps its number; a receipt from before numbering
  is given one on its next print. The signature block («المستلم», «التوقيع», «الاسم», «الوظيفة») now
  sits on the left of the page.

### Fixed

- **The receipt opens as an A4 page that actually prints.** The print tab showed the receipt
  stretched across the whole window, and the print dialog never opened by itself: the tab inherits
  the app's Content-Security-Policy, which blocks the inline script that was meant to open it. The
  tab now shows the paper as an A4 sheet on a grey desk with a toolbar («طباعة الإيصال»,
  «إغلاق»), and the print dialog is opened from the app's own script once the letterhead has
  loaded.

- **A tab left open across a deploy reloads itself into the new version instead of breaking.**
  «لما بسيب الموقع مدة طويلة وأرجع بلاقى… Failed to fetch dynamically imported module». Every
  deploy renames the build's chunks (Vite hashes their contents into the names) and the new
  container has only the new names. A tab opened before the deploy is still running the old
  `index-*.js`, so the first screen it had not yet opened asked for a file that no longer exists,
  and the screen died with the browser's raw message. Coming back after a long absence is the usual
  way to meet it, because an absence is when deploys happen.

  Three things were wrong, and each is fixed where it lives:

  - **The page now recovers.** Vite raises `vite:preloadError` for every failed dynamic import,
    and the app answers it by reloading — which brings the new shell and the new names
    (`platform/app/stale-build.ts`). The error boundary shows «جارٍ التحديث إلى أحدث إصدار…» for
    that moment instead of an error. It reloads **once**: a second failure inside a minute means
    the CURRENT build is the broken one, so the ordinary error screen and its button come back
    rather than a page that reloads forever. Without session storage there is no record of a
    reload, so none is attempted.
  - **The server tells the truth about a missing chunk.** The SPA fallback answered any unknown
    GET with the HTML shell and a 200, so an old chunk name got a web page back as its script.
    Files under `assets/` are now a 404 (`answersWithShell`); client routes, including the IT
    module's `/it/assets`, still render the app.
  - **The service worker can no longer file HTML under a script's name.** It caches build output
    first and forever, and it cached any `ok` answer, so the shell served for a missing chunk could
    be kept under that chunk's name. It now refuses an HTML answer, and its cache version moves to
    `ecms-v2`, which deletes everything v1 stored, including any entry poisoned that way.

### Added

- **IT custody receipts (إيصال استلام) — printed before the hand-over, signed copy filed after.**
  Handing a device to an employee now goes through the company's own paper form
  (EGYCASH-IT-F-14-02): the hand-over dialog takes one or more in-stock assets, each with its
  condition and notes, and offers «طباعة الإيصال» first — the letterhead, the table of items with
  serial numbers, the declaration and the signature block, filled in with the employee's name and
  job title. «تسليم» records the hand-over only once that receipt is printed, and is withheld
  again if anything changes after printing. Every asset on the paper is handed over in one
  transaction with the receipt, or none is.

  The receipt is printed again at any time from the asset, the custody register (new «إيصال
  الاستلام» column) and the employee's history, where its signed copy — a phone photo or a scanned
  PDF — is uploaded once the employee signs, then viewed, replaced or withdrawn; rows show
  «بانتظار التوقيع» until it is. A transfer to a new holder prints its own receipt before it is
  recorded; custody handed over before receipts existed can be issued one. The custody register
  also gains «تسليم عهدة», to hand several assets over from scratch.

  API: `/it/custody-receipts` (`POST /preview`, `POST /`, `GET /:id`, `GET|POST|DELETE
  /:id/signed-copy`) and `POST /it/assignments/:id/receipt`; intervals carry `receiptId` and
  `receiptSigned`; the single-asset assign writes a one-line receipt too. New collection
  `it_custody_receipts`; no new permission (writes ride `itAsset.assign`, reads `itAsset.view`).

### Changed

- **The IT asset register starts again from the one asset the owner keeps.** «شيل كل الأصول معادا
  AST-00005 وخليه AST-00001»: on the first boot after this deploy, every IT asset except AST-00005
  is deleted — softly, so it leaves every screen and stays in the database — with its custody, its
  maintenance plans and orders and its software installations; tickets and history are not
  touched. AST-00005 becomes AST-00001 and the next asset registered is AST-00002. It happens once,
  in one transaction; when AST-00005 is not on the register nothing is deleted and the step does
  not run again. The QR label stuck on that device still reads AST-00005 and has to be printed
  again from its page.

### Removed

- **Dependabot is switched off, by the owner's decision.** `.github/dependabot.yml` is deleted, so
  no weekly update PRs open on their own any more. They had piled up unreviewed — seven at once,
  one of them green and wrong: a tiptap 3 table extension inside the tiptap 2 contract editor,
  which no test renders. Updates are now made deliberately, in a change that is tested for them.

  What still guards the dependencies is unchanged and does not depend on Dependabot:
  `scripts/dependency-audit.mjs` fails CI on any high or critical advisory in production
  dependencies, and on a registry outage. Moderate and low advisories stay reported, not fatal.
  The security architecture's dependency-risk row says so.

  GitHub's repository setting for *security* update PRs is separate from this file and is not
  reachable from code; it is under Settings → Code security.

### Fixed

- **Signing in opens the first screen the person is allowed, not an empty HR page.** Somebody
  granted only the fleet or the operations screens signed in to HR's recruitment overview, with
  nothing on it. `/` was never decided by anybody's access: the recruitment routes were the app's
  catch-all, so their overview was everybody's front door.

  `/` now belongs to the platform. It reads the person's own menu — the same list the sidebar
  draws — and replaces itself with its first page, top to bottom (`landingRoute`). Whatever an
  administrator puts first in someone's menu is what they open onto, and revoking it moves them to
  the next page they hold, with nothing to maintain. A route that is not an in-app path is never
  followed (the catalogue is admin-edited data; `//host` and `/\host` resolve to another origin),
  and `/` is never chosen as its own target. A person who holds nothing yet is told so plainly,
  inside the shell, rather than shown an empty module or a 403.

  HR's recruitment overview had `/` as its only route and is removed with the twelve strings only
  it used: its KPI tiles were placeholders, and every card on it is a page of the sidebar. HR staff
  now land on the first page of their menu like everybody else. «Back to overview» on the 404 and
  403 pages reads «Back to home», since `/` is no longer an overview.

- **Signing out from the top bar clears what the session had loaded.** The idle sign-out and a
  lost session already did; the button did not. On a shared browser, the next person to sign in on
  that tab was answered from the previous person's cache for up to five minutes — their menu among
  it, which is exactly what `/` now picks the first screen from. The cache is also cleared where
  every session begins, at sign-in, so it cannot matter how the last one ended.

### Changed

- **IT names the company's employees itself: a register of everyone, current and departed, with
  each person's whole history; every person filter finds leavers; every hand-over, and every
  technician, is somebody who works here today.** «لما يعمل بحث او يضيف حاجه او اى حاجه يختار اسم
  الموظف يظهرله اسم الموظف من الاتش ار كل المواظفين سواء اللى مشى او اللى موجود لكن فى حاله
  الاضافه اللى موجود بس», and then «اعمل شاشه فيها كل المواظفيين اللى مشيوا واللى موجودين واللى ادوس
  عليه يجيب الهيستورى بتاعه كله ونفس الموضوع فى الفلاتر فى كل الشاشات ... الفنى يكون من مموظفيين
  الit بس».

  - **No HR permission needed.** IT's employee boxes read HR's own list under HR's
    `employee.view` — the whole HR file — so a technician could not see who they were handing a
    laptop to until somebody gave them «الموظفون». IT now answers itself: `GET /it/people` (under
    `itAsset.view`, the grant whose register already names every holder) and `GET /it/technicians`
    (under `itTicket.assign` / `itTicket.edit`), both reading HR through a new register seam on
    the platform directory (`searchDirectoryEmployees`). Names, codes, placement and status —
    what the screens print, and nothing else. Read-only; IT stores none of it.
  - **«الموظفون»** (`/it/employees`, in the IT menu and on the IT home page): everybody HR has,
    filtered by current / former and branch, each with how many assets they hold now. A row opens
    the person's history — what they hold now, every asset they held before and how it came
    back, the tickets they opened and the tickets they worked as a technician (tickets join
    through the person's login; someone without one is told so rather than shown an empty table).
  - **Person filters on every screen that lists by a person, and all of them find leavers**,
    marked «منتهي الخدمة»: the custody register's holder, and — new — the asset register's holder
    (`holderEmployeeId`) and the help desk's requester (`requesterUserId`) and technician. A
    census spec holds it: a person box on a screen must find leavers, one in a hand-over dialog
    must not, and there is no third kind of place.
  - **Hand-overs go to current employees only, and the server holds the line**: assigning an asset
    to an employee HR reports as exited, or transferring it to one, is a 422 before anything is
    written. A branch move in the same hands is not a hand-over, so a departed holder's asset can
    still move while its return is pending; on leave and suspended are still employed.
  - **A ticket's technician is a current employee of the IT departments** — the org chart, not a
    list: the departments are ticked once on «إعدادات الدعم الفني»
    (`it.technicianDepartmentIds`), and the technician box then offers exactly their current
    people, marking anyone without a login (a ticket is assigned to a login). The server refuses
    anybody else. Until a department is ticked, the box says so and offers nobody, and the server
    behaves as before.

  Only a positive answer refuses: an id the directory cannot read is accepted as it always was, so
  a deployment without HR is unchanged. IT design FR-15, FR-16 and FR-17. No new permission; one
  setting (so forty-one are declared) and one navigation row (119).

- **The formal-Arabic guard now reads the whole product, and checks morphology rather than a word
  list.** The first version of it missed a screen the owner opened the same afternoon — the roster
  import preview, whose «موظفين جداد», «مطلوب في الملف ومش هيتعمل» and «صفوف ما اتقريتش» it had
  passed over. Three separate holes, each fixed:

  - it read `i18n.ts` and nothing else, so every Arabic sentence the SERVER composes — the whole
    rejection half of that same screen, in `workforce-import/reasons.ts` — was never looked at.
    The check now walks web, api and contracts, 7,272 Arabic strings, skipping comments (a comment
    quoting the owner verbatim is a record of what a person said), tests (their fixtures are what
    a user typed), and the files whose Arabic is a lookup key rather than prose;
  - «مش» was matched between non-letters, and Arabic glues its conjunction onto the next word, so
    «ومش هيتعمل» walked straight past it. Leading «و» and «ف» are now part of the boundary;
  - a list of words cannot cover a dialect: «اتقريتش», «هيتعمل», «بيوقف» and «اتضافوا» share no
    letters, they share a PREFIX. The tells are now the Egyptian verb morphology — بـ, هـ, اتـ and
    the ما…ش negation, which formal Arabic does not have — with the words that carry no morphology
    listed beside them, and the formal words the patterns reach by accident (اتخاذ, اتصال,
    بيانات, بينما) named one at a time rather than the pattern being softened.

  It lives in `scripts/check-formal-arabic.mjs` beside the repo's other cross-cutting checks and
  runs as its own CI step; `formal-arabic.spec.ts` now calls into it instead of keeping a second
  copy of the list, because two lists drift and the weaker one is the one that runs.

- **The rest of the colloquial Arabic, and the spelling under it.** Thirty-seven more dictionary
  entries, the eleven sentences the workforce import composes server-side, and a permission
  description (`يقرّر خطوة موافقة مش بتاعته`) are rewritten formally. Separately, 60-odd words
  ended in a dotless yāʾ — «إجمالى», «فى», «الشهرى», «الذى» — which is handwriting habit, not
  written Arabic; those are corrected across the dictionary, the vault-inventory minutes and the
  violations endorsement note, along with the dropped hamzas in that printed form («انه فى يوم» →
  «إنه في يوم»).

  Not touched, deliberately: the four misspelled driver-catalog entries seeded in `fleet.seed.ts`
  («سائق صراف الى», «سزوكى», «ملاكى», «تانيه»). A seed is matched against existing rows by Arabic
  name, so correcting one in code does not rename the live row — it seeds a second one beside it
  and every dropdown shows both. They are catalog data, renamed from `/fleet/catalogs`.

- **The Arabic the product speaks is formal Arabic, and a test keeps it that way.** Sixty-four
  messages across delegated permissions, approval chains, the workforce roster import, the fleet
  screens, system administration, operations and the ATM data editor were written in Egyptian
  colloquial — «مفيش حاجة اتكتبت», «الطلب واقف هنا دلوقتي», «شيل صلاحيات الفرع» — which is the
  wrong register for a system the whole company reads, and reads as unfinished beside the screens
  that were already formal. Each is rewritten, with its meaning, its placeholders and its
  «angle-quoted» terms carried over unchanged.

  Rewriting them once was the easy half. `formal-arabic.spec.ts` is the half that lasts: it reads
  every value in the Arabic dictionary and fails on any form that has no formal reading —
  «مش», «مفيش», «اللي», «ده», «عشان», «دلوقتي», «بتاع» and the rest — naming the key and the
  replacement. It lists only forms that cannot appear in formal prose by accident, because a guard
  that flags «جرّب» or «عند الحاجة» gets weakened until it catches nothing; and it proves it can
  still see the dictionary, so it cannot pass by reading nothing.

  Five component specs pinned the old wording and are updated to the new. The English dictionary
  is untouched: its register was never in question.

### Fixed

- **The sign-in screen says WHY it refused.** «فشل تسجيل الدخول» was the answer to everything:
  a mistyped address, a wrong password, a locked account, a suspended one, a dead connection, a
  server that was down. Most of those the SERVER had already named — `AUTH_ACCOUNT_LOCKED`, `AUTH_ACCOUNT_NOT_ACTIVE`,
  `RATE_LIMITED` and the rest — and the screen read the code, ignored it, and printed the generic
  line. Each now has its own sentence, in both languages, and each says what to do about it: wait,
  ask an administrator, check the connection, or try again shortly.

  The two the browser knows and the server never sees are told apart too: no connection at all
  reads as the connection, and a request that died with the connection up reads as the server. A
  gateway's HTML error page — which used to surface as a rejected password, because parsing it
  threw — now reads as the server problem it is.

  **An unregistered identifier and a wrong password are now two answers, by the owner's
  decision.** They were one on purpose: answering identically meant nobody could learn which
  accounts exist by trying addresses at the login page. Weighed against staff who could not tell
  which of the two boxes they had got wrong, the owner chose to name them — so the server gained
  `AUTH_IDENTIFIER_UNKNOWN` beside `AUTH_INVALID_CREDENTIALS`, «لا يوجد حساب مسجَّل بهذه
  البيانات» reads differently from «كلمة المرور غير صحيحة», and the wrong-password message warns
  that repeating it locks the account. What carries the weight instead is unchanged and now
  written down in the security document: ten attempts per five minutes per address, an audit row
  and an `AuthLoginFailed` event for every attempt, and lockout with backoff. Worth revisiting if
  the login page is ever reachable from outside the company network.

  **The wording is formal in both languages**, and nothing is left vague — even the last-resort
  message names the reference number the API returned, so «حاول مرة أخرى» is not the end of the
  conversation with the support desk.

  The decision is one pure function (`platform/auth/login-failure.ts`) with a spec over every
  code, both no-response cases, the 5xx family, the reference-number fallback, and a check that
  no message slips back into colloquial Arabic.


### Added

- **An unattended screen stops being a signed-in screen.** «لو قعد 10 دقايق مش بيحرك الماوس يخرج
  عشان يسجل تاني، لكن طول ما هو بيستخدمه خلاص» — and both halves of that sentence are the
  feature. `SESSION_IDLE_MINUTES` (default 10, `0` switches it off) is enforced by the SERVER, at
  the renewal, against `sessions.lastUsedAt`: past the window the session is **revoked**, not
  merely refused, because a cookie that outlives the deadline is the hole the rule exists to
  close. It is recorded as `idle-timeout` beside a `sessionRevoked` row, so «stepped away» reads
  differently from «taken over» in the audit log.

  What keeps `lastUsedAt` honest is that the browser renews ONLY WHEN SOMEBODY HAS BEEN THERE
  since the last renewal (`platform/auth/idle-session.ts`). A timer that renewed regardless would
  hold every abandoned laptop open for ever and turn the window into decoration; renewing on
  activity instead means a person entering data for three hours is never signed out, and an empty
  desk is signed out in ten minutes. Mouse, keys, wheel, scroll and touch count; nothing the
  application does to itself does, because a background poll continues on a screen nobody is at.

  The last minute is a warning with a countdown and a «كمّل شغل» button, which is also what stands
  between the rule and the unsaved form it would otherwise discard without notice. Two tabs are
  one person: the last sign of life is shared through `localStorage`, so the tab being read is
  never signed out by the tab being typed in. The window travels to the browser on every renewal,
  so the countdown on screen and the rule on the server are the same number, and an operator
  changing the variable is obeyed within one cycle rather than at the next full page load.

### Fixed

- **A delegated grant is over a department in a branch, not the branch.** (ADR-032, amended —
  Gap 1 of the approvals plan, fixed before anything is built on it.) The first cut of delegation
  keyed a grant by branch and let a manager who holds a department hand out the whole branch: «مدير
  عام الحركة» could have given somebody «المهندسين» as a whole, «الأمن» included — wider than what he
  holds. Nobody had been given the delegation key yet, so nothing was exposed, and it is closed
  now: the grant names the department (or, from a whole-branch holder only, the branch as a whole),
  the ceiling compares the units themselves rather than a rank, and what is granted stays confined
  to that department in that branch on every screen. The tab shows units — «الحركة · المهندسين» —
  and adds one by picking a branch, then a department or «الفرع كله» when allowed. A whole branch
  never implies its departments' grants, and a department never implies its branch's; tests pin
  branch scope, department + branch, and department-wide against each other.

### Changed

- **«الصلاحيات» is now one person walked down: his branches, the departments in each, the screens
  in each department.** Same records and same server rules (ADR-032, Gap 1) — the screen changed,
  not the model. The panel that shipped with delegation asked the manager to name a unit in two
  dropdowns before it would show him anything, and then drew one seventy-row table per unit he
  named; the owner's verdict on it was «هل المفروض يبقى كدا بالشكل الزباله دا والتعقيد دا», and the
  order he actually asks the question in is «احدد شخص … بختار الفرع الأول … وبعدها اخش في كل فرع
  احدد الإدارات اللي ممكن يشوفها واحدد إيه الصفحات اللي يشوفها في كل إدارة». That is now the shape
  of the screen: branch → department → screen → actions, each level a checkbox with a computed
  count beside it, opened on the person's own unit so the common case needs no clicks. Ticking a
  screen turns on every action on it («لما يعمل صح على شاشه يعمل صح على كل حاجه») and the pills
  underneath are there to take one back. «الفرع كله» is drawn as its own block and says what it is:
  a grant with its own record, covering departments nobody has opened yet, not a «tick them all»
  button — while it is on, the departments beneath it read «مشمولة في منح الفرع كله» and what they
  hold separately is left untouched and comes back if it is cleared. What the manager may not grant
  is shown with the reason on it rather than hidden, and it is inert in both directions: it cannot
  be ticked, and it survives a clear at every level — the action, the screen, «شيل الكل», and the
  whole branch. A row nobody may open carries no chevron, which the design this was drawn from got
  wrong, and every count on the screen is computed from the state the checkboxes read rather than
  written by hand, which that design also got wrong — it labelled a department «٩ شاشات متعلّمة»
  over eight rows. Nothing about the save changed: one PUT per unit that actually differs, an empty
  list still removes the record.

  The branch level is a heading, not a checkbox, and that is the one place the approved mock was
  wrong rather than merely imprecise. A tri-state box there reads «tick the rest» — it is what a
  half-ticked box means everywhere — while the only thing a branch can do is take away: it has no
  record of its own, the whole-branch grant inside it does. A manager with grants in three of six
  departments who clicked it got three records deleted without ever having opened the branch.
  Removing is a button that names itself, and it shows only when there is something there the
  caller could remove.

- **nodemailer 6 → 10 and puppeteer-core 24 → 25.** The two major bumps the widened dependency
  gate had waived are done, and the waivers are gone. nodemailer's own breaking changes across
  the four majors (SESv2-only SES transport, `ENOAUTH` error code, TLS validation on remote
  content, Node ≥ 20) touch nothing this mailer uses; the SMTP handshake is now proved by a spec
  against a fake ESMTP server (`mailer.spec.ts`), which no suite had exercised before — the
  suites use `jsonTransport`. puppeteer-core's `launch`/`setContent`/`pdf` path is unchanged and
  was smoke-tested through the app's own driver against Chromium 141.
- **`rescan:files`** — the operator's command for the files uploaded before a scanner existed.
  Switching the scanner on scans nothing retroactively; this marks every live `unscanned` file
  `pending` (withheld until its verdict) and queues a scan-only job for each, oldest first, in
  batches. Dry run by default, refuses without a scanner, built into the deployed image — and so,
  now, is `migrate:org-catalog`, which the image had no way to run (`tsx` is dev-only):
  `node apps/api/dist/migrate-org-catalog.cli.js`.
- **@sentry/node 8 → 10** (clears the OpenTelemetry baggage-propagation advisory in its
  dependencies; `init`/`captureException` unchanged, transmission smoke-tested against a local
  ingest endpoint) and an npm override lifting exceljs's `uuid` to 11 (the bounds-check advisory;
  exceljs uses only `v4()`). The remaining moderate advisories all sit behind UI majors — tiptap 3
  and react-router 7 — left for a change that can be clicked through; the two react-router ones
  are not reachable here (no user-supplied navigation targets; the other is SSR-only).
- **ClamAV as a Railway service** (`infra/clamav`, guide §7). The official image with clamd
  bound to `::` — Railway's private network is IPv6-only — and `StreamMaxLength 50M` above the
  upload cap; a volume for the signature database; `CLAMAV_HOST=clamav.railway.internal` on
  the app and the worker. Nothing changes until that variable is set.

### Added

- **A role grant can reach more than the holder's own unit.** A department is one record per
  branch, but one department to the company: «الحركة» has a general manager over every site and a
  manager in each site who may be given a second site to follow. Neither was expressible while a
  grant resolved to exactly the holder's home unit. Now a `branch` or `department` grant carries a
  **reach** — sites added to the holder's own, chosen by name — and a `department` grant names the
  **company-wide department** (the catalog entry) rather than one site's copy, so it reaches that
  department in every listed site, or, as the general-manager form, in every site there is.

  What that changes on screen, and only that: the grant form gains a department picker and a site
  picker; the roles tab says «الحركة · المهندسين · أكتوبر» on the row instead of «الإدارة*»; and the
  branch switcher in the command bar now appears for an account with several sites, listing exactly
  those. A grant with no reach is byte-for-byte the grant that existed before, and every existing
  grant is one. Nothing changes what any screen shows for a given permission.

  The reach obeys the rule the whole permission model already obeys: nobody hands out what they do
  not hold. A granter may add only sites their own grants reach and name only a department their
  own grants name, and only an organization-wide administrator may grant «every site». The switcher
  is the same — a multi-site account may narrow to one of its sites and never to a third. In this
  phase the system administrator does the granting; a department manager granting within his own
  department is the next.

- **A manager can hand out, per site, the permissions they hold there.** (ADR-032, Phase 3 of the
  permissions model.) «مدير عام الحركة» holds his
  keys in every site; he may now give «مدير الحركة» in المهندسين everything there and, in أكتوبر, two
  screens view-only — two independent lists, one per site, each saying nothing about the other. The
  rule is the one the whole model obeys, read per site: nobody hands out what they do not hold **in
  that site**, a key already on the list that the writer could not grant stays, and removing is
  always allowed. One new key, `delegation.manage`, which is itself delegable — so the general
  manager can let a site manager staff his own team.

  Underneath, a grant's reach is now recorded **per permission key** rather than as one union across
  the holder's grants. Without that, «الحضور في أكتوبر، عرض بس» would have ridden «الموظفين»'s two
  sites. Nothing changes for an account whose grants all reach the same places, which is every
  account before this change.

  On screen: a colleague's profile gains a **«الصلاحيات» tab** for whoever holds `delegation.manage`
  (the same panel sits under the roles on the account page in System Administration). One block per
  site — the person's own site pinned, added sites as chips, «+ site» for the rest the manager
  delegates in — each a table of screens × actions with the registry's own grouping. Ticking a
  screen ticks every action the manager may grant on it; clearing «view» clears the screen; a new
  site starts with everything the manager may grant there. What the manager cannot grant in that
  site is disabled with the reason on it, and stays that way in both directions. Save writes only
  the sites that changed. The "why can they" screen labels a direct grant with its site.

- **Every screen now reads a grant's reach, not only the ones that go through the shared filter.**
  Phase 1 taught the grant to reach several sites; the ordinary lists honoured it at once, because
  they all ask one repository filter. Seven reads did not, because they aggregate or join and had
  each spelled the rule by hand: the fleet dashboard, the gold dashboard and reports, the attendance
  export, the roles list (which finds who may see a grant through its holder), the live-update rooms
  a browser is let into, and the recruitment counters and batch list that run at the widest of
  several grants. Each of those answered with the holder's home site only. The rule now lives once
  (`orgScopeMatch`), the repository filter delegates to it, and every hand-written read asks the
  same function — so «مدير الحركة» given a second site sees it on every one of those screens.

  Three things follow the same reach. Where a new document is FILED — a gold receipt, an ATM row,
  an IT ticket — is the site the caller is acting in: their own, or the one they chose in the
  command bar when their grants reach several (the switcher now offers exactly those). A branch
  settings editor may set the sites they reach, not only their own. And a notification that fans
  out to «everyone holding X in site B» finds a holder placed elsewhere whose grant reaches B.
  Nothing changes for an account whose grants reach only its home unit.

- **Security: the five controls the security document described and the code did not have.** The
  review that scored the platform against its own document found six gaps; SSO stays planned, the
  other five are now real.
  - **Virus scanning.** The `virusScan` extension point has a scanner behind it: ClamAV over its
    `INSTREAM` socket protocol (`infrastructure/antivirus/clamd.ts`), registered when `CLAMAV_HOST`
    is set and scanning every upload in the worker. A file the daemon has not answered for is
    `pending` and **withheld from every download path** (`FILE_SCAN_PENDING`) rather than served on
    trust; a hit is `blocked`; a scan that could not run leaves the file `pending` — never `clean` —
    and `platform.files.rescanPending` asks again every fifteen minutes. `docker compose --profile
    antivirus up` runs the daemon locally. Without `CLAMAV_HOST` nothing changes.
  - **One door for outbound HTTP** ([ADR-033](docs/03-decisions/ADR-033-outbound-http-one-door.md)).
    Every request the api makes leaves through `infrastructure/http/outbound.ts`: the configured
    base URLs are pinned, the SaaS hosts the code names are listed, everything else must be on
    `OUTBOUND_HTTP_ALLOWLIST` and resolve to a public address — including after a redirect, which
    is followed by hand and judged per hop. A guard spec fails CI on a bare `fetch` anywhere else.
    Web Push endpoints a browser registers must be public HTTPS.
  - **Break-glass use pages at once.** `authorize()` writes a `breakGlassUsed` audit row when a
    break-glass key was the authority a request passed on, and raises the `breakGlassUsed` security
    signal from the request itself, which the notifications service delivers as a critical alert.
    The hourly sweep is the net under it. One alert per person per hour; every use keeps its row.
  - **Secret scanning in CI.** `scripts/check-secrets.mjs` reads every tracked file before `npm ci`
    and fails the run on a credential shape — private key, cloud and API keys, a connection string
    carrying a password, a JWT, a tracked `.env` or key file. False positives are allowlisted by
    fingerprint, with a reason. `.github/dependabot.yml` opens weekly grouped dependency updates.
  - **The dependency gate blocks high as well as critical, and an outage is no longer a pass.**
    `scripts/dependency-audit.mjs` replaces the shell step: three attempts at the registry, then
    red — unless a reviewer recorded a dated `outage` waiver. Advisories are waived by id with a
    reason and an expiry that fails the run once past, as feature flags do. Widening the gate found
    eight highs on the day: four fixed in the lockfile (multer, fast-xml-parser, socket.io-parser,
    brace-expansion); the five behind two major bumps (nodemailer 6→10, puppeteer-core 24→25) were
    waived for the day and are cleared by the bumps recorded under Changed — nothing stays waived.

- **The import preview says which of the people it is adding are leavers.** Two thirds of the
  workbook is the Resignation sheet, so most of the people an upload adds join the registry already
  exited — a record of somebody who worked here, not a colleague starting on Monday. Listing them
  under "New employees" with nothing beside it sent a reader to look for them on the employees list,
  which hides exited people unless the view filter is set to All, and to conclude they had never been
  added. Each addition now says `on the job` or `added as a leaver`, and the section says where to
  find the latter.

- **The roster import records leavers, and every group is agreed to separately.** The preview now
  has five numbers instead of four: added, **cleared**, updated, unchanged, and not-read. Cleared is
  new — somebody the Resignation sheet lists as gone whom the registry still has on the books. It
  closes their open employment period, records the exit the sheet describes, and sets their status.
  It does NOT rewrite their hire date: that is the registry's, and a roster export is not a claim
  about when somebody started.

  **Each number is a toggle.** Press it to include or exclude that group before applying. Added and
  Cleared are on by default — a person the file names and the registry does not almost always
  belongs in it, and a leaver almost always has left. Rewriting the personal data of two thousand
  people already on file is not obviously right, so Updated is offered rather than assumed. Unchanged
  and not-read are drawn plainly and cannot be pressed: one has nothing to write, the other cannot be
  written at all.

  Going the other way is refused and reported: a person the file has gone back to listing as serving,
  whom the registry has exited, is a **rehire** — a decision with a start date, a job and an
  eligibility check behind it, which the system has a Rehire action for. An upload does not make it.

### Fixed

- **The employees list offers «الأمن» once, not eight times.** A department is one record per
  branch — each site's security is its own unit with its own people — so the department filter
  listed every branch copy, identically, seventy-one entries for seventeen names, with no way to
  tell «الأمن» from «الأمن». It was listing the storage rather than the organization.

  The filter now folds branch copies to their catalog entry: one «الأمن», standing for every site
  it exists in, or for the one copy in the chosen site. Sections fold the same way. A unit never
  linked to the catalog folds by its Arabic name instead, so nothing is hidden by the change. The
  query carries every id behind the choice — `departmentId` and `sectionId` on the employees list
  are lists now, like `branchId` already was — so the narrowing and the row count under the bar
  stay the server's own. Dropdown options carry `catalogId` for the same reason they carry
  `parentId`: so a screen can do this from one fetch of each list.

- **An upload failed outright for anybody whose department, section or job title sat past the
  hundredth row of its catalogue.** The org resolver asked for `pageSize: 500` and `1000`, but
  `BaseRepository.list` clamps to `MAX_PAGE_SIZE` (100) — and with no `sortBy`, the hundred it got
  back were the oldest. A unit past that read as ABSENT, so the resolver created a second copy of it
  and minted the new code from the hundred it could see, which landed on a code that already existed
  and failed the unique index. The person being placed failed with it.

  It bit on a LATER upload rather than the first, which is why the go-live import looked fine:
  within one run every unit the resolver touches is cached, so building the catalogues from empty
  never noticed. The first re-upload afterwards failed for everybody whose section happened to be
  past the hundredth row — three people, reported as unimportable with no obvious reason why.

  All four catalogue reads now page to exhaustion, and the next free code is computed from the whole
  catalogue rather than from the first page of it. Same defect, same shape, and the same fix as the
  one the unit dropdowns needed.

- **An upload would have failed for anybody with no insurance or officer file on record.** Those two
  blocks are `null` until somebody files one, and a dotted `$set` into `null` is a MongoDB error —
  `insurance.grossWage` cannot be created "in element {insurance: null}". The company's own first
  employee was in exactly that state. When the block is absent it is now written whole, with `null`
  for what the file does not carry, and a block of nothing but empty values is not created at all.

- **An Import roster button on `/employees`, next to Direct Registration.** Upload the IT workbook
  and the registry catches up with it: people who are not in the system are added, people whose
  details changed are updated, and people the file has nothing to say about are left alone.

  **A blank cell never erases anything.** This is the rule the whole feature turns on. HR fills gaps
  in the system by hand — an address typed into a profile, a second phone somebody phoned in — and a
  monthly roster export carries none of that back. If a blank cell overwrote, every upload would
  quietly undo a month of that work while reporting no changes at all. Only a cell with a value in
  it can change anything.

  **It previews before it writes.** The file is read twice: once with nothing written, reporting
  exactly what it would do — who is added, who changes, which field, from what to what — and again
  for real only after somebody has read that and agreed. The same file object is posted both times,
  so the run cannot differ from the preview that was approved, and nothing is held on the server
  between them.

  Placement moves with the file: a person the roster now puts in another site, department, section
  or job title is moved there, written to both the employment block and the top-level fields the
  list reads. One thing is deliberately refused — a National ID that DISAGREES with the one on file.
  It is filled in when the record has none, but never overwritten: the registry derives birth date,
  gender and place of birth from it and treats it as the one-person-forever key, and a spreadsheet
  cell is not enough to re-identify a human being. Those are reported by name so somebody can look.

  Employment history is not rewritten either. A roster names where somebody is today; it does not
  restate when they were hired or how a spell ended, and replaying it would overwrite a correction
  HR has since made with the spreadsheet's version of the past.

  `employee.importRoster` is its own permission, not `registerDirect`: one upload adds people,
  rewrites personal data and moves staff across the whole registry, which is a different amount of
  authority from onboarding one walk-in hire.

### Changed

- **A page header shows a title and nothing under it.** Every screen used to explain itself in a
  sentence beneath its own title — «الموظفون المعيّنون من عروض العمل المقبولة» under «الموظفون» —
  and the owner asked for all of them gone: on the 148 screens that had one, and on every screen
  built from here on.

  `PageHeader` no longer declares a `description` prop at all, so the compiler refuses one at every
  call site rather than a future page quietly rendering a sentence nobody wants. Two pages passed
  theirs through a conditional spread (`{...(x === null ? {} : { description: x })}`) which JSX does
  not excess-property check, so the compiler never saw them — a guard spec catches that form too.

  One page builds its own header rather than using the shared one (payroll reports); its hint line
  went too. Left alone deliberately: the sign-in, activation and portal-login screens, where the
  line under the heading is an instruction the reader needs, and the applicant/gold/captain shells,
  where it carries the record's own data rather than a description of the page.

  The translation strings are left in place: several are still used elsewhere, and a few more are
  reachable through dynamically built keys, so removing them safely is its own change.

### Added

- **A department is defined once for the whole company, and each branch declares that it has it**
  (P-ORG-2, [ADR-031](docs/03-decisions/ADR-031-org-units-defined-once-declared-per-branch.md)).
  «العمليات» existed seven times — once per branch — as seven unrelated records that merely shared a
  word, so the company-wide dropdown offered it six times with nothing to tell the copies apart. Two
  organization-wide catalogs, `department_catalog` and `section_catalog`, now hold the company's own
  list; a row in `departments` carries a `catalogId` saying which one it is an instance of, and
  `{branchId, catalogId}` is unique so a branch cannot declare the same department twice.

  **Nobody moves.** Every row keeps its branch, and `departments._id` stays the department data
  scope. Collapsing the seven rows into one would have widened every department-scoped reader from
  their own site to the whole company across twenty-odd collections, silently — the confinement a
  department scope has today is an accident of `departments.branchId` being required, and nothing
  else enforces it. The ADR is mostly about that.

  Creating a department against a catalog entry copies the entry's spelling, and renaming the entry
  carries the new name down to every branch that declared it. A section catalog entry belongs to a
  company-wide department, never to one branch's copy of one. No new permission keys: the catalogs
  are gated on `department.*` and `section.*`, the authority that already exists.

  The workforce importer now resolves the catalog before it creates a branch row, so a re-import
  cannot recreate the duplication it caused. Job titles are untouched — they were always keyed by
  name alone and are already one company-wide list.

- **`migrate:org-catalog` — the command that gives existing data one list, dry-run first.**

  ```
  npm run migrate:org-catalog                                    # reads, plans, checks, writes nothing
  npm run migrate:org-catalog -- --merge DEP-0041=CAI-0 --write  # apply exactly that plan
  ```

  It groups the rows with the workforce importer's own fold — so it cannot disagree with what the
  importer created — and gives each group one catalog entry taking its **oldest live member's code
  and spelling**, inventing nothing. Two rows are merged only where `--merge LOSER=WINNER` names
  them, and never across branches: moving people between sites is a transfer, not a migration's side
  effect. A merge repoints every reference, found by walking the schemas rather than from a list, so
  a collection added later is swept because it declares the field.

  **It refuses rather than half-applies.** Two same-named departments in one branch that nobody has
  resolved, a unique index the repointing would violate, an announcement or notification rule naming
  a department being merged — any one of those and nothing at all is written, with the rows named.

### Fixed

- **The API and the worker crash-looped on startup, and the platform was down.** Adding the roster
  importer put ExcelJS into the HR router's import graph, and ExcelJS is CommonJS that calls
  `require('crypto')` as it loads. Bundled into an ESM output there is no `require`, so esbuild's
  shim threw `Dynamic require of "crypto" is not supported` — during the IMPORT phase, before a line
  of our code ran. Both processes died on boot.

  Three changes, because one would not have been enough. ExcelJS is now `external` in the bundle, so
  Node loads it as the CommonJS package it is; it moved from `devDependencies` to `dependencies`,
  because the runtime image installs with `--omit=dev` and external means it has to be there; and
  `read-workbook.ts` loads it with `await import` at the point of use rather than at module scope,
  so a spreadsheet reader is no longer able to stop the platform from starting at all — nothing
  touches it until somebody uploads a workbook.

  **Every check was green when this shipped** — lint, typecheck, 5,500 tests, and `npm run build`
  itself, because the shim compiles perfectly and only fails when executed. Nothing ever ran the
  built bundle. `scripts/check-bundle-require.mjs` now fails the build if any output file contains
  that shim, and names the bundled CommonJS package that pulled it in.

- **Every unit dropdown in the app was missing units, and said nothing.** `GET /platform/<unit>/options`
  asked its repository for one page of 500, but `BaseRepository.list` clamps `pageSize` to
  `MAX_PAGE_SIZE` (100) — so any catalog past a hundred was served a hundred, with no error and
  nothing in the response to say the list had been cut. This deployment has 142 job titles, so the
  job-title picker on notification rules and announcements has been offering 100 of them.

  This is the third instance of one shape: the employee profile hit it at 100 job titles, the list
  hit it in its own catalog reads, and both were fixed by reading what the server had already
  resolved. Here the fix is at the source — `collectOptions` pages to exhaustion, bounded by the
  reader's own `totalPages`, and both callers (the three org units and the flat job-title catalog)
  share it. A dropdown that omits a unit is worse than a slow one: the reader cannot tell.

  The option DTO also carries `parentId` now — a Department's Branch, a Section's Department, null
  for the units that hang under nothing. It is what lets a screen cascade one picker off another
  from a single ungated fetch of each list, instead of a `<unit>.view`-gated request per selection.

- **Four things the employees screens showed a reader that no reader should see.** The list's row
  count read literally as `{count} موظف`; the personal tab showed `applicants.maritalStatus.married`
  where it meant "married", and the same for education and military status; and on the profile
  some people's job title was `#4db1e9` — the last six characters of an id, shown to a person as
  their job.

  The count: `translate()` fills `{{name}}` and nothing else, and the key used single braces. That
  turned out to be a class, not a typo — **116 placeholders** across both languages had the same
  one-character defect and every one of them displayed literally. All are fixed, and a spec now
  reads the dictionary source and refuses any single-brace placeholder, so the class cannot return.

  The labels: the strings existed all along under `applicants.marital.*`, `applicants.education.*`
  and `applicants.military.*`; three employee screens asked for them under prefixes that were
  never defined. They now ask for the ones that are.

  The job title: the profile resolved unit names from browser-side catalogues paginated at 100,
  and this deployment has 142 job titles, so every title past the hundredth fell through to the
  id fallback. The profile now reads the `placement` names the server already resolves for the
  list — the same correction the list itself made — and drops three catalogue queries and three
  permission gates with it. A unit the server cannot resolve is a dash.

- **Status is the last column of the employees list, not the first**, as asked. The identity opens
  the row; the coloured badge closes it.

### Changed

- **The employees list filters by placement — site, department, section and job title.** Four
  selects join the search and status controls, in the order the columns read. The first three
  cascade: choosing a site narrows the departments to that site, choosing a department narrows the
  sections to it, and a selection that no longer belongs under its new parent is dropped rather than
  left to filter the list silently to nothing. Job title is a flat catalog (ADR-015) and narrows
  nothing. All four live in the URL, are remembered across visits, and are cleared by the same reset.

  The narrowing is the server's — `ListEmployeesQuery` already accepted all four ids — so the row
  count under the bar stays the count for the exact query, not for the page on screen.

- **The go-live workforce import no longer refuses a person the company holds no National ID for.**
  Five real people were being kept out of their own company's registry to preserve a column: four
  leavers, and the company's own first employee, hired before it kept the paperwork.

  The registry never required it. `registerDirect` already keys every use of the number on
  `!== undefined` and stores `null` — the same shape the Sprint-4.1 records that predate the
  requirement carry. Only the importer's planner refused them. It no longer does, and where there
  is no National ID it joins the two sheets on the **employee code** instead, which is unique, so
  two rows carrying one are one person's two spells rather than two people. The two key spaces are
  prefixed apart so they can never merge.

  **The requirement itself is untouched.** `DirectRegisterEmployeeSchema` and
  `RegisterApplicantSchema` still demand a valid National ID, and every request arriving over HTTP
  is parsed by them, so the UI and recruitment are exactly as strict as they were. Only the
  importer, which calls the service directly rather than over HTTP, can carry a person without one.

  What is deliberately **not** done is inventing a placeholder. The service *derives* birth date,
  gender and place of birth from this number; a made-up one would manufacture three more facts
  about a real person and file them as if they were true. Absent is recorded as absent.

  The cost, stated plainly: those five import without the one-person-forever duplicate guard, which
  has nothing to key on. The code's own uniqueness is what stands in its place.

- **The employees list now reads as a placement, not a ledger.** Columns are, in order: status,
  code, name, site, department, section, job title, hire date. Status moved to the front — it is
  the one fact somebody scanning 1,600 people is nearly always looking for. The hiring origin
  column is gone: whether somebody came through recruitment or was registered directly is a fact
  about the hiring process, not about the person, and it earned its width on no reader's screen.
  The four placement columns are new.

  **Placement names come from the server, resolved once per page.** `EmployeeDto` gains a
  `placement` block — branch, department, section, job title, each `{ id, code, name }` or `null`
  — beside the ids that `employment` has always carried. The alternative, four catalogue fetches
  in the browser, would have been four extra requests a screen and four extra permissions: the
  sections and job-title catalogues are paginated at 100 and gated by their own `*.view`, so a
  reader without those keys, or a deployment with 139 sections, would have seen blanks for people
  placed perfectly well. The server holds the ids, so it resolves them — one `$in` read per
  catalogue per page, never one per row, and a dangling reference is `null` rather than a 500.
  Soft-deleted units still resolve: a person filed under a retired section shows that section's
  name, not a dash.

- **The list's filter bar has a reset and a live row count.** The reset is the shared amber
  affordance every filter bar already had, now wired here; it appears only when something has
  been narrowed. The count sits at the end of the row and is the server's total for the exact
  query on screen — the whole list when nothing is narrowed, the narrowed total otherwise — so it
  can never disagree with the pagination beneath it. It is withheld on the settlement view, which
  is another endpoint with a count of its own, rather than shown wrong.

### Fixed

- **Index drift is now reconciled for the employee collection as a whole, not one index at a
  time.** The go-live import failed a third time, on `ux_offer`: the schema declares it partial
  (only rows whose `jobOfferId` is a real ObjectId), the database still held it as plain-unique, so
  every imported employee — all of whom have `jobOfferId: null` — collided with the first. That is
  why exactly one employee was ever added. It is the same mechanism as `hr_job_offers.ux_code` and
  the `employeeNumber` migration before it: Mongoose creates a missing index and leaves an existing
  one alone, it never rewrites one, so any declaration that changes after it ships is silently not
  enforced on databases that predate the change.

  `reconcileDeclaredIndexes` replaces the bespoke migrations. It compares every index the schema
  declares against what the collection holds — matching by name first and by key shape second, so
  an index built under Mongo's default name is still found — and drops and rebuilds any whose
  enforcement differs (`unique`, `partialFilterExpression`). It never touches an index the schema
  does not declare: a hand-built index on a production database is a decision, not drift. Applied
  to the employee collection at boot; the decision is a pure function with the three production
  drifts and the two harms it must avoid pinned by tests.

  The error that hid this for three rounds now names the field (see below) — that is how the
  third drift was found in one run instead of three.

- **The `employeeNumber` index migration matched by name, so it walked past the index it exists to
  drop.** *(Superseded in the same release by the reconciler above, which subsumes it.)* ADR-017 relaxed the Global Employee Number from unique to plain, because 148 real
  employees legitimately share one, and `migrateEmployeeNumberIndex` drops the legacy constraint on
  databases that already built it. It looked for the name `ux_employeeNumber` — which is only what
  this repository declares *today*. A database whose index predates that naming carries Mongo's own
  default, `employeeNumber_1`; the migration found nothing, the unique constraint survived, and the
  go-live import failed with `Duplicate resource` for people whose numbers were perfectly valid. It
  now matches any unique index keyed on exactly `employeeNumber`, whatever it is called — the same
  correction as the job-offer `ux_code` drift, which is matched by shape for this very reason.

- **A duplicate-key error now says which constraint it violated.** `E11000` was mapped to a bare
  `Duplicate resource`. A collection carries several unique indexes, so that message tells the
  reader nothing, and a bulk import repeats it thousands of times — diagnosing the failure above
  cost three rounds against a live database for want of one index name. The message now names the
  FIELDS of the violated index and never the values: the names are schema and safe in a 409 body,
  while the values are somebody's national ID, email or phone number, and this message reaches API
  clients. The redaction is pinned by a test.

- **The workforce import failed for an entire branch's workforce at a time, and no dry run could
  have predicted it.** `OrgResolver` looked a branch up by CODE alone, while `branchService.create`
  rejects a duplicate NAME. Any database used before the import already holds its sites under codes
  of its own, so the lookup missed and the create threw `A branch with this name already exists` —
  and because the failure happened before the branch was cached, the SAME failure then repeated for
  every single person at that site. One stale branch took its whole workforce down with it.

  Branches are now matched by code and, failing that, by folded name — which is what departments,
  sections and job titles already did; the branch was the one asymmetry. When the two disagree the
  EXISTING branch wins and its code is left alone: the Branch Code is an identity a super-admin
  owns (ADR-017), not something an import may rewrite underneath the people already filed against
  it. The disagreement is reported in `orgProblems` so a human decides.

- **The importer's idempotence check asked a question the unique index does not answer.**
  `ux_code` on employees is deliberately not partial on `isDeleted` — the Employee Code is an
  identity nobody may reuse, deleted or not — but the check used `findByCodeSystem`, which filters
  soft-deleted rows out. A code held by a deleted employee therefore read as free, and the insert
  then failed on the index with an opaque `Duplicate resource` naming nothing. The check now asks
  about every state (`findByCodeAnyState`) and rejects the row with a reason that says which record
  is in the way and what to do about it.

  Both bugs are invisible to a dry run by construction, because a dry run never calls `create`.
  That is why the branch decision is now a pure, tested function rather than a line in the I/O
  path: the plan cannot prove the write will succeed, so the write path's logic has to be provable
  on its own.

### Added

- **The workforce reset can now empty the recruitment pipeline too, and only when asked.**
  `--include-recruitment` additionally deletes every applicant and every record filed against one —
  screenings, interviews, evaluations, evaluation batches, uploaded document sets, the recruitment
  timeline and its workflow events. It is opt-in because emptying the workforce says nothing about
  whether people who are mid-application should also go; only "empty the system completely" answers
  that, and the flag is how somebody says it. It works in both modes, so a dry run shows exactly
  what it would remove.

  **Job offers are the one deliberate reversal.** The default run classifies them `keep` — an offer
  is recruitment history that merely names who was hired, and deleting it to remove a person
  destroys the record of a hiring decision. That reasoning does not survive erasing the applicant
  themselves: an offer made to somebody being deleted is not history, it is the dangling half of a
  deleted record. So the two rules disagree by design, the recruitment rule wins when it is
  enabled, and the report moves the collection out of "left alone" into what was emptied — a
  collection may never appear in both.

  **The derivation now walks subdocument arrays.** `hr_evaluation_batches` names its candidates
  only in `items[].applicantId`, which `schema.paths` does not surface, so a top-level walk could
  not see the collection at all and a reset would have reported success while leaving a batch full
  of the names of people it had just deleted. The employee side was re-derived the same way and is
  byte-for-byte unchanged at 47 collections, so this is strictly a widening. The recruitment
  catalogues — sources, forms, interview stages, evaluation phases, document types, requisitions —
  carry no applicant reference and are therefore never in the set, which is right: they are
  configuration the next hiring round needs, not records about a person.

### Fixed

- **`hr_job_offers.ux_code` drifted from the schema, and the drift silently broke hiring.** The
  index was first built as a plain unique index on `code`; the schema later made it partial
  (`{ code: { $type: 'string' } }`) because a `waiting` offer has no code yet, and a unique index
  treats every missing value as the same `null`. Mongoose never rewrites an index that already
  exists under the same name, so every database created before that change still enforces the old
  shape: the FIRST codeless offer is accepted and the SECOND fails with
  `E11000 … ux_code dup key: { code: null }`. It surfaces as the backlog materializer refusing to
  open `waiting` rows — six applicants on a real deployment, on every boot, with nothing to retry
  or repair it.

  A boot migration now rebuilds the index to the declared shape, ahead of the backlog step it
  breaks. It first looks for live offers sharing a code and REFUSES the rebuild if it finds any,
  naming them: dropping a unique index is only safe when the rebuild can succeed, and a failed
  rebuild would leave the collection with no uniqueness on `code` at all — a silently weakened
  invariant, worse than the bug being fixed. The decision is a pure function so both guards are
  tested; a failure anywhere in the repair is logged and never fails the boot, since the old index
  still enforces uniqueness and the symptom is a backlog that does not open, not corruption.

- **Neither go-live tool could keep its promise not to send anything — including on a dry run.**
  `reset:workforce` and `import:workforce` both call `bootPlatform` before they read a row, and the
  boot is not passive: `hr.seed` runs the D2 login backfill, which creates a login for every
  employed employee that lacks one and sends each of them a WhatsApp message and an email carrying a
  one-time setup link. So the harmless-by-design invocation — the dry run, the one the operator is
  told to start with — would have messaged the entire workforce before counting anything. The
  importer's existing refusal did not cover it twice over: it ran *after* the boot, and only on
  `--write`.

  Both CLIs now check `HR_PROVISION_MISSING_LOGINS` as the first statement in `main`, ahead of the
  boot and ahead of parsing `--write`, and refuse while it is true. The variable is therefore a
  precondition of RUNNING these tools at all, not of writing with them. It refuses rather than
  warns, and refuses the dry run too, because the asymmetry is total: on a database where everyone
  already has a login this occasionally declines a run that would have been fine and the operator
  sets one variable and tries again, whereas the other outcome delivers a setup link to ~1,670 real
  people at once and nothing can recall a delivered message. The ordering is pinned by a test that
  reads both CLIs' source, since ordering is exactly what a behavioural test of either would miss.

### Added

- **A workforce reset, for the one time it is needed: the moment before the real workforce lands.**
  `npm run reset:workforce` removes every employee and everything filed against them, and every
  account that does not hold `super-admin` or `platform-admin`. Dry run is the default and walks the
  same path as a real run, so its counts are evidence rather than an estimate; `--write` alone is
  not enough, `--confirm DELETE` has to be typed as well, so the destructive form cannot be produced
  by editing a previous command's flags.

  **What it will not do.** If no account holds a surviving role it stops before deleting anything,
  in both modes — otherwise it empties the account table and leaves nobody able to log in and put it
  back. Survival is deliberately generous: ANY assignment to a surviving role keeps an account,
  including an EXPIRED one, because in an operation with no undo keeping one account too many is a
  nuisance while deleting an administrator whose grant lapsed last week locks a real person out of a
  system that has just been emptied. And survival is two NAMED roles rather than "holds a system
  role" — `employee-self-service` is a system role granted to every employee with a login, so that
  test would spare the entire workforce and the reset would do nothing.

  **What it deliberately leaves alone.** The audit trail, including entries by an account it just
  deleted: history is not rewritten because the actor was removed. The Global Employee Number
  counter, reported but never wound back, because lowering a sequence reissues a number somebody
  already holds on paper. The organization structure and every reference catalogue, which the import
  expects to find. And eight collections that merely NAME an employee while being records in their
  own right — the three gold receipt/transfer registers, traffic violations, vehicle odometer logs,
  vehicle and ATM maintenance visits, and job offers. Those are not modified in any field, not even
  to clear the reference: the receipt still says who signed for the metal and the violation still
  says who was driving, and a reference pointing at a deleted employee is the honest state.

  **The set of employee-scoped collections is DERIVED, not listed.** A hand-written list is wrong the
  first time somebody ships a feature that files something against a person, and wrong silently. The
  registered schemas are walked at run time for any path naming an employee — which catches
  `captainEmployeeIds` and `hiredEmployeeId` as well as the bare form — and anything the
  classification table does not cover STOPS the reset by name. A future collection cannot be quietly
  skipped and cannot be quietly destroyed; somebody has to decide which it is. Writing it this way
  paid for itself immediately: a grep found 33 collections, the derivation found 47, and eight of
  the extra ones were the untouchables above. `users` carries `employeeId` too, so the derived rule
  alone would have emptied the account table — administrators included — on the first run.


- **The go-live workforce import, and two blocks of the employee that had nowhere to land.** The
  company arrives with 2,699 rows of hand-maintained HR spreadsheet — 1,673 people serving and
  1,026 who have left — and roughly fifteen of its columns had no home anywhere in the registry.
  `npm run import:workforce -- --file <workbook>` reads it, plans it, and reports; `--write` is the
  only thing that writes, and both take the same path so a dry run is evidence about the run that
  follows it. Against the real file: **2,635 people importable, 23 rows refused**, each refusal a
  specific data fault with a named fix rather than a silent drop.

  **The SOCIAL INSURANCE file** (التأمينات الاجتماعية) and **the OFFICER profile** (بيانات الضباط)
  are now blocks on the employee, each behind its own view/manage permission pair and each redacted
  per caller like compensation already was. The insurance wages are deliberately NOT
  `employment.salary` and never become it: `الاجر الأساسي` takes six distinct values across 1,673
  employees because it is a statutory contribution bracket, not what anybody is paid, and writing
  it into the field payroll reads would state a false fact about someone's pay. The two
  contribution shares are stored AS FILED rather than computed, though they are ordinarily
  `× 0.1875` and `× 0.11` — three rows in the go-live data disagree with the formula, and those
  three are what the company actually filed.

  **Nothing is sent to anybody.** The default registration path creates a login and delivers a
  one-time setup link by WhatsApp *and* email; importing the workforce would have sent that to
  ~1,670 real people in one burst with no way to recall it. `registerDirect` gains
  `provisionLogin: false` (default unchanged), and the boot backfill that was the same landmine one
  restart away is now behind `HR_PROVISION_MISSING_LOGINS` (default `true`, behaviour unchanged) —
  with the importer **refusing to write while it is on**, because by the time that restart happens
  nobody is at the keyboard.

  **History is written as state, not replayed as decisions.** A personnel action records something
  somebody decided in this system: it carries an actor, an audit entry, and it notifies every holder
  of `employee.view`. A resignation from 2021 was not decided here, and replaying 964 of them would
  assert actors who never clicked anything. The existing registry migration already writes
  historical state directly; this follows it.

  Identity is the **national ID**, not the code: 28 people appear on both sheets but only 21 share a
  code — seven were rehired under a new one, and a code-keyed join would create them twice, as two
  people who are one person. Columns are addressed by `(header, nth occurrence)` because both sheets
  carry `جهة الحصول` and `تاريخ المؤهل` twice, and a header→index map keeps the last of each pair —
  quietly replacing 1,256 institutions and 1,651 graduation years with a field filled for 1.3% of
  employees. The whole sheet layout is fingerprinted before a row is read: one inserted column
  shifts every field after it by one and writes national IDs into the address column, at scale, with
  every individual value still looking plausible.


- **Gold Vault: the standalone precious-metals system, ported into ECMS as a module.** The
  `egycashcompany-ops/gold` system — vaults and their drawer grids, the bar register, عمليات
  الدخول / الخروج / التحويل, drawer keys, the owner and delegate registers, the board and the five
  printed statements — now runs inside the platform as the `gold` module. It is a PORT and not a
  redesign: the numbering formats, the draft → confirm → revert lifecycle, the refusal to
  regenerate a layout while a vault holds metal, the reshape guard that keeps drawer numbers
  intact, the recount-from-bars counters and the closing-balance arithmetic (a balance is the
  current inventory rewound backwards, never a forward sum) are the original code's, message for
  message. What changed around them is the scaffolding: auth, RBAC, navigation, audit and data
  scoping are the platform's, every mutation goes through the service layer to the platform audit
  trail, and every boundary is Zod-validated. The gold system's own drawer-numbering tests come
  across with it.

  **Three things — and only three — are integrated rather than ported.** A receiving receipt used
  to carry the crew leader and the vehicle as free text; they are now an ECMS employee and an ECMS
  Fleet vehicle. The two vault custodians (أمناء الخزن) on every receipt, delivery and transfer
  came from a gold-owned `supervisors` collection; that collection is gone and both are ECMS
  employees. The gold-owned `branches` collection is gone too: every document is stamped with an
  ECMS organization branch and the module's visibility IS the platform's branch data scope. Each
  reference stores the id together with the display value captured at write time, so an
  already-printed receipt keeps reading the same after somebody is renamed or a car is sold — and
  each is proved against the real record, so an id naming nobody, or somebody who has left, is
  refused rather than stored. Employees and branches are reached through the platform's own seams;
  Fleet through a single read-only boundary file, the precedent Operations set.

  The receipt screen's bulk import reads **CSV** rather than the `.xlsx` the gold system read
  through SheetJS, whose npm mirror is frozen on two unfixed advisories — a known-vulnerable
  dependency was not worth one screen's convenience. Nothing about the feature is lost: the intake
  was always one sheet of flat rows, and the module's own ~150-line parser keeps the fuzzy
  bilingual column matching and the report-what-could-not-be-matched discipline while handling what
  those files actually contain — the separator Excel picked (comma, semicolon or tab, detected from
  the header), RFC 4180 quoting, CRLF endings, and the byte-order mark that otherwise glues itself
  to the first column's name. The module adds exactly one dependency, `recharts`, because the
  dashboard is its charts.

  Four gold surfaces did not come across because the platform already owns them — users, roles, the
  audit log and branches. The customer portal was deferred out of the first pass and is now built
  on platform identities (see the next entry). The eleven screens keep their
  layouts, flows and Arabic wording, restyled onto the ECMS theme; the printed documents keep the
  EGYCASH letterhead exactly as the business files them, because a receipt is a company record and
  not application chrome. Two audit verbs join the platform vocabulary (`deliver`, `revert`) for
  the two acts `receive` and `transfer` could not already name. Full port record, including what
  was dropped and why, in [gold-module-port.md](docs/12-planning/gold-module-port.md).

- **A branch switcher in the command bar, and the whole application narrows to it.** EGYCASH runs
  several branches, and an account that sees all of them needs to be able to choose: the
  consolidated view, or one branch at a time. The gold system had exactly this control in its top
  bar; the port carried its RULE across and left the control behind, which is how an
  organization-wide account ended up unable to create a gold document at all — refused because a
  document has to be filed somewhere and nothing could guess where, with no way to answer.

  `AuthContext.activeBranchId` now arrives on an `X-Active-Branch` header and `scopeSelector` folds
  it in: an `organization` grant becomes a `branch` grant on the chosen branch, and everything else
  is left exactly as it was. **It narrows and only narrows** — the caller's granted scope is the
  ceiling, so a branch-placed operator sending another branch's id keeps their own, and a
  department or section grant is never widened to a branch. That property is what makes this a
  preference rather than a permission, and it is asserted directly rather than left to the reading
  of one `if`. The same value decides where a new document is filed, which is what makes the
  organization-wide account able to work again; with the whole company selected a branch-stamped
  create is still refused, but the message now names the control that answers it.

  It applies to every module, not only the vault — a control in the global bar that silently
  governed one module would be worse than either alternative. Collections that declare no branch
  field are unaffected. Recorded as
  [ADR-028](docs/03-decisions/ADR-028-active-branch-narrowing.md).

- **The platform learns about people who do not work here, and the gold vault's customers get a
  portal.** ECMS knew two kinds of login: one belonging to an employee, and one belonging to nobody.
  A third exists now — an account carrying an opaque `externalSubject { moduleId, subjectType,
  subjectId }`, which is `employeeId` with its owner named. The platform stores it and never
  interprets it; the owning module writes it through one service method, and the two linkages are
  mutually exclusive. `UserDto.kind` (`employee | system | external`) is derived from them, so the
  administration screens, the person pickers and the user list can tell the populations apart
  instead of inferring it from a null.

  Read-only is enforced structurally rather than by grant. Permissions answer "may you do this";
  they cannot answer "should this route exist for you at all", and ECMS has endpoints deliberately
  open to any authenticated caller — `POST /platform/directory/resolve` names staff and their job
  titles to anyone with a session. So an external account is confined BEFORE authorization, by
  default-deny, to exactly two things: the whole `/auth` router, which is pre-authentication or
  self-service by construction, and the single route prefix its module registered — GET only. A
  route added anywhere else tomorrow is out of reach without anybody remembering the gate exists.
  Refusals are audited. Recorded as
  [ADR-027](docs/03-decisions/ADR-027-external-identities.md).

  On top of that, **بوابة العملاء**: the gold system's customer portal, rebuilt at `/portal` with
  its own login and its own chrome — no sidebar, no launcher, no command palette over a catalog the
  customer holds no permissions for. Nine tabs, column for column as gold had them, including the
  two monthly reports which print the same document the vault would hand over. Which customer's
  data a request may touch is a branded `PortalCompany` that one middleware mints after re-reading
  the binding and the company from the database, so deactivating a customer cuts their portal off on
  the next request rather than a cached minute later; every read takes one as its first parameter,
  so a query that forgot to scope does not compile, and an eslint rule forbids casting one anywhere
  else. The DTOs are allow-lists in their own contracts file — gold's portal returned whole
  documents, so customers were being handed our custodians' names, the crew leader, the vehicle
  plate, the internal notes and every bar's movement history; none of that reaches this surface, and
  a spec keeps it out. Two deliberate differences from gold, both signed off: customers see
  confirmed documents only, and the two fund reports still refuse non-fund customers because that
  rule is ported business logic. Staff create and administer the logins from
  `/gold/portal-accounts` — against a live company, with a one-time setup link and no password field
  anywhere.

- **Fleet: three admin-owned catalogs, and a vehicle that points at them instead of carrying free
  text.** License class, operation (التشغيل) and insurance company join the fleet catalog
  collection as three more kinds — no new endpoint, model or screen, because the six kinds already
  there brought the tabs, the selects and the filters with them. None of the three is seeded: an
  administrator names the values, so a house's operating groups and its insurers are never guessed
  on its behalf. The vehicle registry stops keeping a license class as a string and keeps a
  reference instead, alongside two new ones for operation and insurer, each proved server-side
  against a live item _of its own kind_ — an id naming a real catalog row of the wrong kind, or an
  archived one, is refused, which a plain reference check would have let through. This answers the
  frozen design's open question on license-class values as data rather than as an enum, so renaming
  a class is an administrator's edit and not a deployment.

  A vehicle must now have a branch. The schema refuses a missing or null one on create and on
  update, the service proves the branch exists and is active, and the model requires it so no code
  path can insert a branchless vehicle at all — three layers, each catching what the others cannot.
  The create form preselects a branch resolved **by name** from live branch data through a new
  setting defaulting to «المهندسين», never a baked-in id, which would differ between environments
  and rot on the first rename; where no branch matches, the API answers with the name it looked for
  instead of guessing one. Vehicles created before the rule may still hold no branch: they stay
  readable and editable, and an edit has to name one.

  Each vehicle carries its license scan. The bytes live in the platform's file service under an
  images-only, size-capped category, so the intake rules are the platform's own rather than a
  bespoke check, and the vehicle holds nothing but the link; a second upload replaces the current
  scan and keeps the previous one retrievable as an earlier version of the same file. The registry
  table renders the frozen column order with an image cell that offers upload where there is no
  scan and view or delete where there is, nine server-side filters — the four identifiers narrowed
  individually and combined, the three catalog references, the branch and the type — and a
  per-vehicle print view carrying the record and, only where one exists, the license image inline;
  an absent image prints no empty section. Two events are published at their commit points,
  `fleet.vehicleLicenseImage.uploaded` and `.deleted`, because a document arriving or being
  withdrawn is its own fact and not a field on the vehicle.

  Existing data is converted, never disturbed. A boot-time migration copies each distinct legacy
  license-class string into a catalog item and points its vehicles at it, leaving the old column
  exactly as written as the record of what was converted; values that are only whitespace are
  skipped, vehicles that never carried one stay empty, and re-running changes nothing — so nothing
  is deleted and nothing is invented. Vehicles predating the branch rule are reported rather than
  stamped with the default, because which branch a historical vehicle belonged to is a fact only an
  operator knows.

  Authorization gained a check, not a permission. The license image rides the vehicle's own view
  and edit grants, and a file-entity authorizer makes the platform's own file endpoints ask Fleet
  the same question — permission and data scope — so knowing a file id is worth no more than
  knowing the vehicle id, and a branch-scoped user cannot reach another branch's documents by
  either route. Reading the bytes goes through a file-service path for module-owned documents: it
  still runs the owning module's authorizer and the scanner gate, and refuses outright any entity
  type no module has claimed, but it does not additionally demand the generic download grant that
  no fleet role holds — without that distinction the image would have been refused to exactly the
  people it belongs to. A first upload whose vehicle write then loses a concurrency race withdraws
  its own file rather than leaving it orphaned.

- **System Administration — the platform can now administer itself, on screen.** Authentication, the
  user lifecycle, RBAC, the audit trail and the organization model all shipped with Sprint 2.1 and
  had been running ever since with **no user interface at all**: creating an account, granting a
  role or resetting a password was a database operation or a seed. Six phases built that surface
  under one constraint — **add no backend**. Every endpoint it calls already existed, already
  authorized and already audited. **No new endpoint, permission, model, migration, contract change
  or dependency, across all six.** Where a phase found that a _rule_ did not exist, the rule went
  into the service, never into the screen. A seventh phase followed from use rather than from the
  plan and is the single exception to the contract rule — see P7 below.

  - **Users (P1, [PR #158](https://github.com/egycashcompany-ops/egycash/pull/158)).** List with
    URL-synced search, lifecycle filter, sort and pagination; detail with identity, account &
    security, and activity tabs. **Two badges, not one**, because an account answers two questions
    that get conflated: `status` is the lifecycle an administrator drives, `accountStatus` is
    derived server-side and says whether this person can sign in right now and why not. A suspended
    account and one whose setup link expired both cannot sign in and need completely different
    remedies. Sortable columns are exactly the three the API declares — a header that looked
    interactive and changed nothing would be worse than a plain one.
  - **Creating, editing and linking (P2,
    [PR #159](https://github.com/egycashcompany-ops/egycash/pull/159)).** Account creation over the
    one-time setup link, editing, unlock, organization placement pickers, and the employee link —
    written by **HR**, because HR owns that relationship and writing `user.employeeId` from here
    would leave the two sides disagreeing.
  - **Roles and permissions (P3,
    [PR #160](https://github.com/egycashcompany-ops/egycash/pull/160)).** Role list and detail, the
    permission registry, scoped assignments with a validity window, and the account's roles tab —
    together with the guards that had to exist before any of it could be handed to a human, recorded
    as **[ADR-026](docs/03-decisions/ADR-026-role-administration-guards.md)**.
  - **Effective permissions (P4,
    [PR #161](https://github.com/egycashcompany-ops/egycash/pull/161)).** A read-only projection
    answering "what may this account actually do, and why" — every contributing grant shown,
    including the pending and the expired, which is what the question is usually about. The merge
    moved into **one shared function** so the enforced answer and the explained one cannot drift; a
    test asserts the reduction equals `getEffectivePermissions` rather than trusting that it does.
  - **Bulk selection in the permission matrix
    ([PR #162](https://github.com/egycashcompany-ops/egycash/pull/162)).** Two hundred checkboxes is
    not a form, so there is a select-all, one checkbox per module, search and collapse. None of them
    may do anything an administrator could not do by clicking each box in turn — a locked permission
    is not selected by them and, the half that is easy to miss, **not cleared by them either**.
  - **Retirement (P5, [PR #163](https://github.com/egycashcompany-ops/egycash/pull/163)).** Archive
    an account, delete an account, delete a role nobody holds. Archiving is **terminal** and does
    **not** revoke role assignments; deletion is the soft delete it always was, so the audit trail —
    which lives in its own collection — survives intact.
  - **UX & hardening (P6, [PR #164](https://github.com/egycashcompany-ops/egycash/pull/164)).** A
    branch filter the API had always accepted, older history reachable a page at a time, the roles
    page number in the URL, a link from a role's holder to that account, and a confirmation before
    revoking a grant that names **who, which role, and at what reach**.
  - **The page layer, and duplication (P7,
    [PR #166](https://github.com/egycashcompany-ops/egycash/pull/166) ·
    [PR #167](https://github.com/egycashcompany-ops/egycash/pull/167) ·
    [PR #168](https://github.com/egycashcompany-ops/egycash/pull/168) ·
    [PR #169](https://github.com/egycashcompany-ops/egycash/pull/169)).** A 202-key matrix grouped
    only by module is still a wall, so permissions now sit under a **page**: `Modules → Pages →
Permissions`. Declared in code — a `PageDef` in the contracts and a `pageId` given **once per
    resource** in the module manifests, not 202 times — with **46 pages, 172 of 202 permissions
    assigned and 30 deliberately unassigned** because they are cross-cutting or backend-only, which
    is a declaration rather than a gap. A malformed registry **fails at startup and in CI**, not at
    render. A module's rows are the concatenation of its pages' rows, so the counters and the
    tri-state select-all cannot drift from what is on screen. The layer is **organizational only** —
    no authorization decision reads a `pageId`. Alongside it, a role can be **duplicated**: the copy
    carries permissions and description, no assignments, and is created through the ordinary
    `POST /platform/roles`, so it passes the same key guards a hand-built role does and comes out
    unmanaged. Refusals are all-or-nothing — copying only the grantable subset would produce a role
    sharing a name with the original that quietly grants less. This is the one part of System
    Administration that changes the contract, and it adds **no endpoint, permission key, model,
    migration or dependency**.
  - **Central settings screen (P8,
    [PR #170](https://github.com/egycashcompany-ops/egycash/pull/170)).** Twenty-nine configurable
    values were declared in code across seven files and settable only through the API. They now
    have a screen at `/system/settings`, grouped by owner, each row rendering from the **type the
    registry declares** and nothing else — no invented `min`/`max`, no enum a `SettingDefinitionDto`
    does not carry. Each setting saves independently, so one refusal cannot roll back the others.
    Values come from `GET /platform/settings/me`, which resolves for the **caller**, and the screen
    says so rather than implying it is showing the organization's. The one backend change is the
    `PageDef` the screen needs (`platform.settings`) — no new setting, permission, model or
    migration.
  - **Account setup link (P9-A,
    [PR #171](https://github.com/egycashcompany-ops/egycash/pull/171)).** On a deployment where
    WhatsApp and SMTP are not wired up, an invited account could not be onboarded at all: the
    activation link existed but only ever left through a delivery channel. `POST
/platform/users/:id/setup-link` now returns it **once** to an administrator to hand over in
    person. The token is stored as a SHA-256 hash and nothing else, exactly as every other setup
    link is, so it cannot be read back — losing it means issuing a new one, which invalidates the
    old. New key `user.setupLink`, declared **break-glass**: someone who can read the link can open
    it, choose the password and sign in as that person, so holders carry mandatory 2FA and appear in
    the quarterly review. It is refused for an account that already has a password — that would be a
    reset, not a setup — and for a suspended or archived one. The registry moves to **203 keys**.
  - **User preferences — theme and locale on the account (P9-B,
    [PR #175](https://github.com/egycashcompany-ops/egycash/pull/175)).** `MeDto.locale` had been
    sent by the server since the first release and **read by nothing**: the language and the colour
    scheme lived in `localStorage` and stayed there across sign-outs. So a preference did not follow
    anyone to a second device, a shared machine handed the next person the last one's settings, and
    the interface could be in English while the server still wrote that user's notification email in
    Arabic — `email.adapter` reads `user.locale`, and nothing had ever written it from the UI. The
    account is the source of truth now: `PATCH /auth/me/preferences` carries `navLayout`, `locale`
    and `theme`, each optional so a control saves itself, and returns the whole `me`. `localStorage`
    is demoted to a cache that paints the first frame and backs the screens that have no session
    yet, where the toggles keep working exactly as before. `preferences.theme` is new on the model
    with a `system` default read through a guard, so **no migration and no account sees a change it
    did not ask for**; `system` is stored and never resolved, because only the browser can read
    `prefers-color-scheme`. A **language** change — and only a language change — drops the auth
    snapshot and is recorded in the audit trail: it is a field of the user record, already in
    `auditSnapshot`, and it decides what the server writes. Theme and navigation shell stay
    unaudited and uncached, presentation being no act on the business record. New page
    `/account/preferences` beside Security, with **no permission and no page-registry entry** —
    the registry describes administration screens, and the subject here is always the caller. No
    new endpoint, permission, organization setting or migration; the access token and
    `permissionVersion` are untouched, so nothing here needs a re-login.

  **The guards, all server-side.** Nobody hands out an authority they do not hold — every key put
  into a role and every key carried by a role being assigned must be a key the actor holds, at a
  scope no wider than their own, with **no identity-based exemption**; the only exemption is "no
  actor at all", which is the system. A grant is scoped through its **holder**, so an administrator
  who cannot see an account cannot grant to it and gets **404** rather than a 403 that would confirm
  the account exists. You cannot retire yourself, and the **last Super Admin cannot be removed on
  any of the three doors** — archive, delete, or revoking the assignment.

- **Accounts can be confined to a single module, and navigation now tells the truth about what you
  can open.** Four named accounts are restricted to HR: every permission outside `moduleId: 'hr'`
  is removed, their sidebar shows HR alone, and TOTP is explicitly off for them. Each half of that
  falls out of a mechanism the platform already had rather than a check on a user id — the API
  refuses them because every module route is `authorize(...)`-gated, so a direct call is blocked
  exactly as a click is.

  The navigation half needed a real gap closed. An Application in the catalog now carries the
  **permission opening it requires**, and the effective-applications resolver filters on it, so the
  sidebar became a projection of RBAC instead of an independent list. That closes the case a
  per-user fix cannot: a module offered by the user's DEPARTMENT rather than by a grant of their
  own. The field is nullable and null means "no permission needed", so an Application catalogued
  before it existed keeps behaving exactly as it did; the boot sync fills in keys only while they
  are null, leaving anything an administrator chose alone. Administrators can set it per
  Application on the Applications screen.

  TOTP is a consequence, not an exception. A privileged account is one holding a system role or a
  break-glass permission; HR declares no break-glass permission, so a confined user ends up on
  ordinary roles and the mandatory-enrollment policy stops reaching them — with the organization's
  `TotpEnforcedForPrivileged` setting untouched, so no other account changes behaviour.

  A role granting only HR is kept as it is. Anything else is rewritten onto an HR-only derivative
  of that same role — its HR subset, keyed on the source role, granted on the original assignment's
  own scope and validity window. The result is exactly the old permission set narrowed to HR: no
  permission is ever added. It re-applies on every seed and every API start, because boot itself
  hands roles out.

- **A recruitment form you can edit, published as one link per source.** The questions candidates
  answer are now configuration, not code: standard fields (name, National ID, phone, qualification
  and eleven more) can be added, removed, marked required and reordered, and custom questions of
  any type can be added beside them. Every active source gets its own public link; whoever applies
  through it is recorded against that source automatically, so nobody types "where did you hear
  about us" and nobody has to trust the answer. Regenerating a link replaces its token, which is
  what makes it the remedy for one that leaked.

  The public page shares the recruiter's rules rather than restating them: a submission is mapped
  onto a registration payload and handed to the same `RegisterApplicantSchema` the internal form
  posts through, and the browser checks it with the same predicates, so a phone means the same
  thing in all three places. The form is the allow-list — an answer to a question the admin did not
  publish cannot reach a column. Answers to custom questions are stored on the applicant WITH the
  question they answered, so renaming or deleting a question later does not orphan them.

  Every application keeps a **snapshot of the form as it stood when it was submitted** — the title,
  the revision, and the questions themselves. Editing the form does not rewrite history: a question
  removed next month was still asked of the people who answered it, and one that was optional then
  does not read as "left blank" once it becomes required. Custom questions are also validated by
  their kind (a number is a number, a date is a date, a choice is one of the offered choices), by
  the same predicate on both sides.

  With the source now decided by the link (or, for internal registration, by one setting on the
  form page), the **"بيانات التقديم" card is gone from the applicant form** — a recruiter no longer
  re-picks the same channel on every walk-in.

- **The applicant form checks its fields as you leave them, and knows Egyptian geography.** A
  mistake used to be discovered by the server after a failed save and reported as a list at the
  bottom of the page; now the field that is wrong says so, in the reader's language, the moment
  focus leaves it — a red outline plus the reason underneath — and saving jumps to the first bad
  field instead of scrolling you back to hunt for it. The rules are real ones: the Arabic name
  takes Arabic letters only (the Arabic-Indic digits ٠-٩ are rejected too, which the obvious
  `\u0600-\u06FF` range would have let through), the Latin name takes Latin letters only, a
  National ID is decoded rather than counted, a mobile must be 11 digits on 010/011/012/015, an
  email needs a dotted domain, and a postal code is five digits. Governorate and city are now
  chosen, not typed: all 27 governorates with their cities, keyed to the National-ID governorate
  code so a decoded number, an OCR read and a hand-picked value resolve to one record; picking the
  governorate scopes the city list, and changing it clears a city that no longer belongs. The
  search behind those pickers folds hamza forms, ta marbuta and diacritics, so "الاسماعيليه"
  finds "الإسماعيلية". Every predicate lives in `@ecms/contracts` and is what the API validates
  with, so the form cannot accept something the server will reject. Numbers are cleaned before
  they are judged and stored in the cleaned form: separators and international prefixes come off a
  phone, and Arabic-Indic digits (٠-٩) fold to ASCII for phones, National IDs and postal codes —
  an Arabic keyboard produces ٠١٠ for what its user reads as 010, which used to be rejected
  outright. Create and edit run the identical rules; a record whose governorate or city predates
  the catalog keeps them rather than being blanked by the act of being opened.

- **Two navigation shells, and the choice belongs to the user.** The launchpad is no longer the
  only shape: the RAIL — a slim strip of module icons beside the module's page panel, the shell
  ECMS carried before the launcher — is back as an alternative, and a switch in the header moves
  between them. The choice rides on the account (`MeDto.navLayout`, `PATCH
/api/v1/auth/me/preferences`), so it follows the user to any device rather than living in one
  browser; accounts that predate it answer `launchpad` without a migration. It is
  presentation-only by construction: the endpoint's subject is always the caller, so it carries
  no permission, no scope and no audit entry — which navigation shape someone prefers is not an
  act on the business record. Both shells read the same catalog, derive the current module from
  the URL, remember the page you last had open in each module, and share their page rows
  (`nav-rows`), so a row behaves identically wherever it is rendered and the ⌘K palette and
  pinned favourites are untouched in either.

- **IT module, slice IT-2 — asset custody, full-stack.** Assets now have a life story. Four named
  actions — assign, record return, transfer, dispose — each run as one transaction that writes the
  custody interval, the asset's derived status, an append-only history entry, a platform event and
  an audit row together, so a half-finished custody change is not a reachable state. Transfer is
  recorded as ONE fact rather than a return followed by an assignment, because months later the
  history has to show intent and not mechanics; it moves the holder, the branch, or both. Disposal
  is terminal and refuses an asset someone still holds, and a disposed asset accepts nothing
  further. "At most one open assignment per asset" is a database index, not a code check, so two
  simultaneous assignments cannot both succeed.

  On screen: the custody actions sit on the asset itself, each offered only when the state machine
  could accept it and each behind its own permission; the asset page gains a current-custody panel
  and its full history; and a new **Asset custody** register answers "what is out, who has it, and
  what is overdue" across every asset. `hr.employee.exited` flags what a leaver still holds and
  never auto-returns it — a physical return is something a human witnesses, and inventing one would
  put a fact in the chain that never happened. Recorded in
  [ADR-021](docs/03-decisions/ADR-021-it-asset-custody-and-history.md).

- **IT module, slice ITW-1 — the asset registry, on screen.** IT-1's API gets its application:
  the asset register as a searchable, filterable, sortable, URL-synced list; an asset detail card
  showing the identity, purchase and warranty facts beside a QR rendered from the asset code
  itself; create/edit behind `itAsset.create`/`.edit`; the FR-5 delete window offered only where
  it can apply; printable QR label sheets from a row selection or from one asset; a scan surface
  that resolves a typed or scanned code straight to its asset; the IT catalogs screen (asset +
  ticket categories, archive-not-delete); and IT vendors with embedded contacts and server-side
  search. Vendor selection searches the API rather than loading the catalog (ADR-019 rule 5), and
  every screen is Arabic/English with full RTL. The IT navigation category — seeded empty by IT-1
  precisely so nothing pointed at a missing page — now carries its five rows.

- **IT module, slice IT-1 — catalogs, vendors and the asset register** (frozen design v1.2,
  §15). New `it` module manifest with kind-discriminated `it_catalog_items` (asset + ticket
  categories, one `itCatalog.manage` grant), IT-owned vendors with embedded contacts and
  server-side `search`, and the asset register: server-allocated permanent codes
  (`AST-00001`, atomic `it_sequences` counter), derived status (`inStock` — no write path
  accepts a status), reference guards against active categories and vendors, embedded purchase
  and warranty facts, branch data-scoping, scan resolve by code, and QR label sheets (QR payload
  is the plain asset code; PDF via the platform chromium driver, printable HTML fallback without
  it — no new dependency). Events `it.asset.registered`/`.updated` join the generated catalog
  and the automation trigger picker. The IT navigation category ships empty on purpose — app
  rows arrive with the web slice so the sidebar never links to pages that do not exist.

- **IT module — Architecture & Domain Design (design only, no implementation).**
  `docs/12-planning/it-module-design.md` covers the full MVP surface — asset management with QR
  identification and custody lifecycle, help desk with SLA, preventive/corrective maintenance
  with a minimal spare-parts ledger, software and license management, warranty and vendors, and
  the module dashboards — as entities, relationships, workflows, permissions, events, APIs,
  audit actions and the three ADRs implementation will record. Every capability rests on an
  existing platform service (RBAC, data scopes, audit, files, notifications, event bus,
  automation, scheduler, settings, sequences, PDF, QR, navigation, web kit); the document's §1
  is the reuse contract that keeps it that way. Draft v1.0, awaiting owner review — nothing is
  implemented before approval.

- **`npm run seed:demo` — sixty synthetic candidates, ten resting at each recruitment stage.** The
  boards, queues and counters had nothing to show on a fresh database. The demo cohorts sit at the
  ID gate, in screening, at the first interview, at the open evaluations, holding a sent offer, and
  accepted awaiting the hire. They are driven through the REAL services — a candidate at the
  interview stage got there by having their screening accepted, which is what materializes the
  round — so the queues, the workflow state, the stage counters and the candidate timeline all
  agree, instead of looking right on one screen and wrong on every other. Re-running is a no-op:
  each registration carries a `demo:` intake key and the platform's own idempotent intake returns
  the existing candidate. `npm run seed:demo -- --reset` removes the demo candidates and what they
  produced, matched on that key alone so a real applicant can never be caught by it. Development
  and staging only — it refuses to run when `NODE_ENV=production`.

### Changed

- **The Employee Code is now ISSUED at hire and frozen there, not derived from the current branch
  (ADR-017).** It was `<CurrentBranchCode><GlobalEmployeeNumber>` and was recomputed on every branch
  transfer, on a rehire into another branch, and — through the HR3-A seam — whenever an
  administrator corrected a branch's own code.

  The reversal is evidence-driven rather than a preference. Of the 2,699 employees in the go-live
  workforce, **148 carry a prefix from a branch they no longer work at**: the company transfers
  people and their code stays. Re-deriving on import would have renamed 148 real people whose code
  is printed on contracts and insurance filings that nobody reissues. The prefix answers *who hired
  you*; `branchId` answers *where are you now*, and only the second one moves. `buildEmployeeCode`
  is now called by the two hire paths and nowhere else — the personnel-actions engine no longer
  imports `branchService` at all, so the whole family of re-derivations is closed structurally
  rather than by convention, and `code-freeze.spec.ts` reads the engine's source to keep it that
  way. **The HR3-A branch-code seam is retired** with its premise: codes are no longer derived, so a
  branch rename leaves them alone deliberately, exactly as a transfer does.

  Two consequences worth stating plainly. `code` is **not** reconstructible from an employee's
  current row — never re-derive one to compare against the stored value. And
  `EmployeeTransferred.oldCode`/`newCode` are retained, equal and deprecated: the event catalogue is
  a published surface that automations may already read.

- **The Global Employee Number is four digits, and no longer unique-indexed.** Four so that `010` +
  `0004` reproduces the company's own `0100004` byte for byte. The unique index is relaxed to a
  plain one because the single atomic `$inc` allocator is what makes numbers unique — the index was
  only ever a second line of defence — and the go-live workforce carries two numbers the company
  itself issued twice on paper (`1311`, `1651`; four people, all long exited). A unique index would
  have forced a renumbering, and renumbering rewrites a printed code. `code` carries the unique
  index instead. A guarded, idempotent boot migration drops the old one.


- **A role is now the whole action: applications appear in the sidebar because of the permissions
  they carry.** Navigation used to be the union of two grant tables — the applications assigned to
  an account's department and those granted to it directly — intersected with its permissions. A
  role wrote only half of that, so assigning someone every permission a module has left their
  sidebar **empty** until an administrator also granted them each application by hand, on a second
  screen. Two records had to agree for a screen to appear, and nothing kept them in step: revoking
  a role left the grant behind, and granting an application to somebody who could not open it
  produced a row that answered 403 on click.

  There is one source now. An application declares the permission that opens it, and the sidebar is
  the set of applications whose permission the caller holds. It follows every RBAC change on its
  own — assigning or revoking a role, adding or removing a permission from a role, a validity window
  opening or closing — because those are exactly the events that change an effective permission set,
  and navigation reads that set rather than a copy of it. Nothing outside RBAC can add a row or hold
  one back, so an application grant can no longer contradict what the server will allow.

  **An application with no declared permission is now visible to nobody**, where before it was
  "no permission needed". That reading was safe only while a grant was also required; without one it
  would have handed every undeclared application to every signed-in user. Declaring the permission
  is therefore required when cataloguing an application and cannot be cleared afterwards.

  The manual application-grant card is gone from both screens that carried it. The two grant tables
  and their endpoints are untouched and their data is left in place — nothing reads them, and
  clearing them is a separate migration.

  **This is the second answer to that report, and it replaces the first.**
  [PR #172](https://github.com/egycashcompany-ops/egycash/pull/172) took the grant model as given
  and fixed the reachability gap inside it: the card that grants applications to an account lived
  only on HR's employee profile, behind `employeeId !== null`, so a **platform** account — one with
  no employee record — had no screen on which anyone could grant it anything. That PR moved the card
  to `platform/` and put it on the System Administration user screen, which made the model usable
  but left it a model in which two records must agree. This change removes the model instead, and
  with it every file #172 added on the web side. Read them as one correction, not as two phases:
  #172 shipped and was superseded before release, so nothing it added is live.
  ([PR #174](https://github.com/egycashcompany-ops/egycash/pull/174))

### Fixed

- **Five gold registers answered 500 to a page of perfectly readable rows.** The owners, the
  delegates, the key handovers, عمليات الدخول and عمليات الخروج all returned an unhandled error,
  while every gate was green and the integration suite listed the same endpoints happily against a
  real database. The mappers dereferenced `doc.createdAt.toISOString()`. `timestamps: true` writes
  that field on everything this API creates — which is exactly why the DTOs type it as always
  present, and why nothing caught the assumption: the integration suite builds its rows through the
  API, so its rows always have it. A row that reached the collection any other way does not, and one
  such row among twelve good ones took down the whole page.

  Audit timestamps now fall back to the ObjectId's own embedded timestamp, which is not a
  placeholder standing in for a missing value — it IS when that document was created. Three
  neighbouring assumptions of the same kind went with it: `namesOf` dropped ids that are not
  ObjectIds (callers reach it through `String(doc.companyId)`, and `String(null)` is the string
  `"null"`, which Mongoose answers with a CastError and a 500); the key register's directory lookup
  filtered `undefined` as well as `null` before stringifying; and a vault whose `layout` key is
  absent renders as "no layout yet" rather than blanking the board.

  `gold-mapper-robustness.spec.ts` feeds every gold mapper a row with each field removed in turn and
  demands it still map — no database, no fixtures from the API, so a failure there is a 500 in the
  browser.

- **The branch switcher said «لا توجد فروع بعد» to a company with three branches.** It asked for
  `/platform/organization/branches`; branches are mounted at `/platform/branches`, and
  `/platform/organization` serves exactly one route. Every load 404'd, and because the menu drew
  its empty state from `data ?? []` it reported the failure as a fact about the company's data.
  Two fixes, because there were two faults. The path now points at `/platform/branches/options` —
  the reference-options endpoint, which is authenticated but deliberately NOT gated on
  `branch.view`, so narrowing your own view no longer demands an organization-administration
  grant. And the menu now distinguishes loading, failed and genuinely empty, so a broken request
  can never again read as an answer. The gold module's branch lookup (the letterhead on the five
  printed statements) had the same wrong path and is fixed with it.

  A new gate keeps the class shut: `platform-routes-exist.spec.ts` reads the real mount table out
  of `app.ts` and the real route patterns out of every platform router, then checks every
  `/platform/…` path in the web sources against them. Nothing else could have — the client builds
  a URL string, the server assembles routes from a mount table and a dozen files, and TypeScript
  never puts the two in the same room.

- **A password could not be seen while it was typed, and the rules it had to satisfy were not
  shown at all.** Nine password fields across four screens — sign-in, activation, the forced first
  change and account security — were bare inputs: no way to check what had been typed, and no way to
  learn the policy except by being refused. A shared `PasswordInput` now carries a reveal control on
  every one of them; it is a `type="button"` (a `<button>` in a `<form>` defaults to submit, which
  on the login screen would have attempted a sign-in with a half-typed password), it is named for a
  screen reader, and it sits at the logical end of the field so Arabic needs no second rule. The
  three screens where a password is **chosen** also list the requirements live, each line turning as
  it is met. Those requirements are **derived from the server's own policy**, not from a list typed
  into the client: the rules moved into `@ecms/contracts`, the server derives its refusal message
  from them and the screen derives its checklist from the same code, and the values come from a
  public `GET /auth/password-policy` — public because `/activate` has no session. With
  `requireComplexity` off, the complexity lines are not shown at all, so nothing is advertised that
  will not be enforced. The checklist is an **aid**: `assertPasswordPolicy` is still the only thing
  that decides, on every path that sets a password, and the login screen lists nothing — it is not a
  place to choose a password, and the rules there would describe the shape of the secret being
  guessed. ([PR #173](https://github.com/egycashcompany-ops/egycash/pull/173))

- **An administrator changing someone's language left the old one in force for up to a minute.**
  `UserSnapshot` carries `locale` and is cached for sixty seconds; `AuthContext.locale` is read from
  it, and it decides the language the **server** writes in — the notification email, the display
  names IT renders. But the invalidation on the admin edit path was written for the placement
  fields, before `locale` joined the snapshot, and was never widened, so the snapshot survived the
  edit. Both writers of that field — the administrator and, since P9-B, the user themselves — now
  drop it. ([PR #175](https://github.com/egycashcompany-ops/egycash/pull/175))

- **The last Super Admin could be stripped of the role by archiving a spare one first.** The rule
  shipped in P3 — "the last Super Admin assignment cannot be revoked" — counted assignment **rows**.
  Archiving keeps a user's grants by design, so an _archived_ Super Admin was accepted as cover and
  the live one's assignment could then be revoked, leaving a system with **zero administrators able
  to sign in** and no API path back. P5 is what made the sequence reachable without touching the
  database, because it put the Archive button on the screen; P5's own test suite is what exposed it.
  The guard now asks the question it always meant to: after this revoke, would any account that can
  still **sign in** hold the role? It excludes the row being revoked, resolves the survivors to
  accounts, and keeps only the active ones — the same predicate `auth.service` applies at login, at
  TOTP challenge completion and at refresh. The archive and delete guards added in P5 count the same
  way. ([PR #163](https://github.com/egycashcompany-ops/egycash/pull/163))

- **A permission key the registry no longer knows could not be removed from a role.** Roles keep
  keys that a retired module used to declare, and the permission matrix has always _said_ such a key
  is "shown as Unknown, still ticked, and still removable" — but the code folded `unknown` into
  `disabled` alongside "read-only" and "you do not hold this", so the row rendered inert and the one
  thing left to do with it was the one thing that could not be done. The rule now has three states
  rather than two: an unknown key comes **off**, and never back **on** — re-granting it would hand
  out an authority nothing in the system defines any more, and no permission check can evaluate it.
  Bulk selection never touched such a key in either direction and now says so in tests rather than
  by implication. ([PR #164](https://github.com/egycashcompany-ops/egycash/pull/164))

- **A failed read of an account's history was displayed as an account with no history.** The
  activity tab fell through to its empty state on error, so "we could not read this account's
  history" appeared as "nothing has been recorded for this account" — opposite claims, and an
  administrator who believes the second one stops investigating. It now shows an error panel with a
  retry, and a page that fails _after_ history is already on screen keeps that history and reports
  the failure beneath it. ([PR #164](https://github.com/egycashcompany-ops/egycash/pull/164))

- **An account moved between branches kept reading its old branch until the cache lapsed.**
  `AuthContext.branchId` / `departmentId` / `sectionId` come from the cached auth snapshot and
  `scopeFilter` builds every scoped query out of them, but nothing dropped that snapshot when an
  account's placement changed. The update now deletes it. No TTL, key or caching rule changed.
  ([PR #160](https://github.com/egycashcompany-ops/egycash/pull/160))

- **Duplicate Role shipped complete and could not be used.** Two defects of the same kind — the code
  was there, the control was not reachable — and both were reported from the running screen rather
  than caught by a green CI run. The button was placed inside the `managed === 'none'` branch that
  hides **Edit** and **Delete** on a system or `hr-only:*` role, so it disappeared on exactly the
  roles an administrator most wants to copy; and the blocker treated an **unread** permission
  catalog as "the registry declares nothing", which disabled the button on first paint for everyone
  and permanently for an administrator holding `role.create` without `permission.view` — showing a
  message that blamed the role for carrying permissions nobody defines. Edit and Delete now carry
  their own management checks and Duplicate stands outside them; the unknown-key check runs only
  when there is a registry to check against, leaving `assertKnownPermissionKeys` on the server as
  what actually decides. **Duplicating a managed role is now offered on purpose:** the copy is
  unmanaged by construction and the key guards are untouched, so nobody can copy an authority they
  could not have granted by hand. ([PR #169](https://github.com/egycashcompany-ops/egycash/pull/169))

- **Stored images never appeared on an S3-backed deployment — the app handed the browser a URL its
  own policy forbids.** `issueDownloadTicket` preferred the storage provider's presigned URL over
  the app's own signed endpoint. On the disk drivers `getSignedUrl` returns `null`, so nothing
  showed; on `s3`/`minio`/`azure` it returns an **absolute URL on the bucket's origin**, and the
  app's `img-src 'self' data: blob:` refuses it — the browser issues no request, so the ticket is
  200, the object is 200, and the only visible symptom is that every screen showing a stored image
  falls back to its empty state. Applicant-source icons were the report; contract branding and every
  other stored image share the path. Presigning is now behind `STORAGE_PRESIGNED_URLS`, **default
  off**: the app signs the URL and streams the bytes, which is same-origin under every driver.
  Turning it on remains available where the bucket's origin is genuinely in the deployed CSP.

  This also explains why the two earlier attempts changed nothing: the `Cross-Origin-Resource-Policy`
  header and the relative-vs-absolute URL logic both live on the app's streaming path, which a
  presigning driver never reaches — `presigned ?? appSignedUrl` short-circuits. Only the `blob:`
  widening applied, which is exactly why the pre-save preview started working while the table did
  not.

- **"Authentication required" after leaving a tab idle — the client raced its own silent
  refresh.** Returning to an idle tab fired several stale-token requests at once; each ran its
  own `POST /auth/refresh` with the same single-use cookie, so one rotation won and the rest
  were rejected (`AUTH_SESSION_REVOKED` — the server's rotation guard doing its job), nulling
  the in-memory token. Every later request then left **without** an Authorization header and
  surfaced the middleware's raw `Authentication required`, with no way back but a manual
  reload. Empirically traced end-to-end against the real auth stack before fixing. Three
  changes, web only: (1) **single-flight refresh** — concurrent 401s share one in-flight
  refresh promise, released the moment it settles (a regression spec proves ten concurrent
  requests produce exactly one refresh and all complete); (2) **organized sign-out** — a
  definitively failed refresh reports auth loss once (never once per waiter), signs Redux out,
  clears the query cache and lets `RequireAuth` redirect to `/login` instead of stranding the
  user on an error screen; (3) `UNAUTHENTICATED` and `AUTH_SESSION_REVOKED` join the bilingual
  friendly-message table as defence in depth. **Known limitation** (recorded in the auth
  design's review trail): two _separate tabs_ refreshing in the same instant still race
  cross-tab — single-flight cannot span JS memories; the proposed server-side fix (a short
  post-rotation grace window answering the previous token with the current one) is documented,
  deliberately not implemented here.

- **Every api entrypoint crashed at startup — `npm run dev`, `seed` and `seed:demo` died before
  their first line of logic.** The automation barrel re-exported `runProviderConformance`, whose
  `vitest` import throws the moment it is loaded outside a vitest run, and the barrel sits in the
  runtime graph: server, worker and both seed CLIs load it through `moduleManifests` regardless of
  the `AUTOMATION_ENABLED` flag (the flag withholds the manifest, not the module file). Nothing
  consumed the re-export — both provider spec files already import `provider-conformance` directly
  — so it is simply removed, and the docs snippet that recommended the barrel import for future
  providers now shows the direct one. A new `runtime-import-safety.spec.ts` loads the shared
  entrypoint graph in a clean subprocess (Node + tsx, exactly how the package scripts load it), so
  any future test-only import reachable from the runtime graph fails the unit suite instead of
  taking the platform down. In effect since the A-5 automation merge (#112); surfaced on the first
  `npm run seed` after it.

- **Opening a candidate crashed once their history held an entry with no metadata.** The timeline
  schema declares `metadata` as required with a `{}` default, but Mongoose minimization deletes
  empty objects on the way to the database — so the two writers that pass none (`identityVerified`
  and `note`; every other type supplies its own, and the workflow projection stamps
  `{ eventId, eventName, …payload }` on all 25 projected types) stored no `metadata` field at all,
  while an interview entry carrying `{ attempt: n }` kept it. Reads are `.lean()`, which applies no
  schema default, so those entries came back as `metadata: undefined`, breaking the DTO's
  `Record<string, unknown>` guarantee: the renderer read `entry.metadata['attempt']` and every
  candidate without an interview attempt threw `TypeError` — which is why verifying an identity was
  what exposed it. The schema now sets `minimize: false` so the declared field is actually
  persisted, and the boot migration backfills `{}` onto rows already stored without it, matching
  only `{ metadata: { $exists: false } }` so a populated metadata is never reset. The renderer is
  unchanged — the contract it relied on now holds.

- **Job-position, job-title and fleet-vehicle pickers returned 400.** Six call sites asked for
  `pageSize: 200`, over the `MAX_PAGE_SIZE` of 100 that API Standards §4 fixes and that both the
  contract schema and the base repository enforce, so the reassign, bulk-reassign and
  recommendation dialogs and four Fleet pages had their dropdown queries rejected by validation.
  They now request `MAX_PAGE_SIZE`, matching every other picker in the app; the cap is a documented
  architectural decision, so the requests were what needed fixing. This is a hotfix, not the end
  state: a picker that renders one large page still truncates silently once a catalog passes 100
  records. [ADR-019](docs/03-decisions/ADR-019-reference-pickers-search-not-load-all.md) records the
  correct design — a picker searches the server the way `UserPicker` already does, using the
  `search` parameter these endpoints already support — and lists the surfaces still to convert.

### Changed

- **Applicant identity fields say what they mean.** Religion is a two-value list (مسلم / مسيحي)
  written in Arabic — the spelling the National-ID card carries and the OCR reads back, so a
  scanned card and a hand-picked value are the same string rather than two encodings of it; a
  legacy value the list does not carry stays selectable rather than silently becoming
  "unspecified" on the next save. Nationality is stored canonically (`Egyptian`) and rendered
  "مصري" to an Arabic reader, as are the governorates the National ID decodes to. The military
  section no longer asks for a certificate reference. Driving licences and certificates left the
  card they used to share, which read as though one were a kind of the other.

- **Modules are now chosen from a Launchpad — the app steps back and a launcher takes over.**
  The switcher's popover is replaced by a full-viewport launcher in the SAP Fiori / Azure /
  Atlassian family: opening it defocuses the app behind a 6px blur, then the launcher arrives
  70ms later (closing reverses the order), so switching reads as leaving one workspace for
  another rather than answering a dialog — depth comes from blur alone, since scaling the page
  read as the background zooming out from under the launcher instead of the launcher taking
  focus. The launcher is a screen, not a panel — title near the top, a centred grid of
  310×208 tiles through the middle, nothing with a dialog silhouette. Each tile carries the
  module's catalog icon at 40px, its name, and a hover that lifts, scales 1.5% and deepens its
  shadow on one curve; the module you are already in is filled with a darker tint and a darker
  icon chip, the way the active row reads in the column. Everything else about switching is
  unchanged: the current module is
  still derived from the URL, choosing still returns you to the page you last had open there,
  permissions still come from `/platform/me/applications`, a single-module user still sees no
  launcher at all, and the ⌘K palette and pinned favourites are untouched. It owns focus while
  open (trap, scroll lock that holds the scrollbar's space so the app cannot jump sideways),
  moves under the arrow keys, filters past six modules, and with twenty modules keeps its title
  and search pinned while only the grid scrolls — the grid centres only while everything fits,
  because a centred flex child that overflows pushes its first row above the scroll origin
  where nothing can reach it. Rendered through a portal to `<body>`: inside the shell, the
  mobile drawer's own transform would trap a fixed overlay inside the drawer's width. `Alt+M`
  still opens it — bound in exactly one of the two mounted shells, since both the desktop
  column and the always-mounted drawer used to answer the chord and raise two launchers at
  once.

- **The sidebar now scopes itself to one module, and the module is chosen from a switcher.**
  Choosing a module and navigating inside it are different questions, so they get different
  surfaces: a small header at the top of the column names the current module and opens a light
  popover listing the ones this user may see (instant, no dialog and no full-screen takeover —
  switching is frequent, and blanking the screen for it costs more than it gives); the column
  below shows that module's pages and nothing else. The current module is **derived from the
  URL**, never a second piece of state, so a deep link, a ⌘K jump, a pinned favourite belonging
  to another module, and Back/Forward all re-scope the column correctly by construction; the
  remembered module answers only the case the URL cannot — a path that names no module, such as
  the landing page or an account screen. `Alt+M` opens the switcher from the keyboard, arrows
  and Enter work in it, and a filter field appears once there are seven or more modules.
  Switching **returns you to the page you last had open** in that module (re-validated against
  the live catalog, so a revoked page degrades to the module's entry point) — leaving and
  coming back should not cost you your place. A user with a single module sees no switcher at
  all, just a quiet label. Pinned favourites and the
  ⌘K palette are untouched — the palette still searches every permitted page across every
  module. Monochrome throughout: no colours, no badges, no shadows.

- **Fixed: two sidebar rows could read as "you are here" at once.** `NavLink` highlights by
  prefix, so a module landing page like `/fleet` stayed lit while the user was on
  `/fleet/vehicles`. Rows whose route has another page nested under it now match exactly, and
  which rows those are is derived from the catalog's own routes — nothing hardcoded, so it stays
  true for whatever the catalog serves next.

- **Sidebar restyled to a minimal-enterprise language (UI only).** One quiet neutral surface for
  the whole rail; per-module colors, shadows and filled pills are gone. Every item — module
  buttons and page rows alike — is transparent with neutral icon/text; ONLY the active item sits
  in a white (dark: `slate-800`) rounded container with the brand color on its icon and label,
  and hover is a faint neutral tint with `transition-colors` alone. The pin star and queue
  badges went neutral too (the badge picks up a faint brand tint inside the active row). No
  behavior change of any kind: routing, permissions, active detection, module order, pinned
  favorites, live counters, RTL and the mobile drawer all work exactly as before, and
  `moduleColor` still serves the command palette.

- **Every page now spans the full available width.** `PageContainer` capped content at `max-w-7xl`
  (80rem) and let a page opt out with a `wide` prop, which only the interviews board and the
  contracts screens used — so the same table rendered narrow on one screen and full-width on
  another. The cap is removed; with no cap there is nothing to opt out of, so the `wide` prop is
  gone too. Padding, headers, toolbars, cards, grids, filters, and spacing are untouched.

- **Sidebar department tiles now show icons instead of two-letter initials.** The module rail, the
  module-panel header, and the ⌘K palette's module rows render each department's icon from the
  shared in-house icon set (no new dependency), resolved through the same registry application
  icons already use; a department without a suitable icon falls back to the generic building tile.
  The icon is data, not code: it is the Application Category's existing admin-editable `icon`
  field — the navigation seed now sets defaults for the shipped categories (HR → users,
  Fleet → truck, Organization → building, Administration → briefcase), and the boot sync fills
  the icon in on existing installs only while it is still null, so an admin-chosen icon is never
  overwritten. Tile colors, sizes, alignment, RTL behavior, and accessible names are unchanged;
  the monogram helper is removed.

- **National-ID OCR: the capture pipeline now handles cards that are angled, bent, or poorly
  photographed — and says so when it cannot.** The previous pipeline read a card that filled the
  frame, flat and square, and failed on anything else in a way that looked arbitrary from outside:
  some cards read correctly, some returned nonsense, and nothing in the output distinguished them.

  The cause was that card localization ran one fixed-threshold edge pass and, when it found nothing,
  silently resized the whole frame. For an already-cropped scan that fallback is right; for a
  photograph of a card on a desk it puts every field box on background. Both took the same code
  path. Localization now runs four detectors (edges, brightness in both polarities, gradient,
  texture), scores their candidates against the ID-1 aspect ratio with a measured floor, and reports
  which one won — separating "already cropped, nothing to find" from "a card was there and we missed
  it". A card bowed in a wallet is no longer treated as a plane: its top and bottom borders are
  traced and each column remapped, which a perspective warp cannot do. Flat cards skip it.

  A new capture-quality gate measures the card's real resolution, sharpness, glare and contrast, and
  returns reason codes — `too_small`, `blurred`, `glare`, `low_contrast`, `card_not_located` — so the
  UI can say what to change instead of "could not read the card". It does not discard the read:
  fields still come back, with the capture's verdict capping their confidence. A blurred crop can
  make recognition _more_ confident, not less, so the photograph gets the final word and only ever
  downward.

  Field boxes are no longer trusted blindly. Detection runs once per side and each box is snapped
  onto the text found near it, with a growth guard so a crop cannot swallow the neighbouring field;
  the national ID and the expiry are then identified by content rather than position — a line of
  exactly fourteen digits, and a full year/month/day — which is what lets an unfamiliar card layout
  still yield its most important field.

- **National-ID OCR: the number and the Arabic fields get real error correction.** Nine of the
  fourteen digits are constrained by a century, a calendar date and the governorate list, so a read
  that cannot be a national ID is now searched outward by edit distance over the shape collisions of
  Arabic-Indic numerals (٧/٨ are mirrors, ٢/٣ differ by a tooth, ٠ is a dot and ٥ a loop). A unique
  valid result at the nearest distance is accepted at `medium`; a tie is refused as ambiguous and
  the raw read preserved. The five unconstrained digits are never edited — there, a "repair" could
  only swap one valid-looking identity for another.

  The number is also read from **both sides** of the card and reconciled: two crops sharing no pixels
  have independent errors, so agreement raises confidence to `high`, while two different valid
  numbers drop to `low` for the reviewer to settle. The sex printed on the back cross-checks the
  parity digit — reaching a digit no structural check covers — as a validator only; `parseNationalId`
  remains the sole source of gender, and nothing is populated from it.

  Arabic matching now folds to the letter skeleton (rasm), so the dots a reflection or a JPEG
  artefact destroys stop counting as misreads — مسلمه matches مسلمة — while the feminine ending
  survives the fold, keeping masculine and feminine forms distinct. Address governorates snap
  against the official Arabic list, with approximate matching disabled for البحيرة and الجيزة, which
  are one edit apart after folding. The governorate is deliberately **not** cross-checked against
  the number: digits 8-9 encode birth registration, the address is residence, and the two legitimately
  differ for a large share of the population.

  `/extract` gains additive `quality` and `diagnostics` keys; callers that ignore them are unaffected.
  Quality thresholds are environment-settable (`OCR_QUALITY_*`) because they are reasoned priors
  awaiting measurement against real cards.

### Added

- **The Fleet web module exists (FW-1) and opens on a live dashboard (FW-2) — built exactly
  like the HR modules, with nothing unfinished ever shown to a user.** The module loads as one
  lazy chunk behind the platform shell; navigation stays data-driven, and per the owner's
  review rule a page joins the sidebar catalog and the route table only in the slice that ships
  it — an unshipped URL is a plain 404, never a "coming soon". The boot catalog sync gained a
  Fleet category carrying exactly the shipped surface (Fleet Home today), strictly additive, so
  each slice's rows reach existing installs on next start with admin customizations untouched.
  All labels ship in Arabic and English; RTL comes from the platform frame.

  `/fleet` is a real dashboard, not a link grid: four KPIs — active vehicles, vehicles in the
  workshop (open visits), derived maintenance alarms with the red count, open accident files —
  and two boards: the alarm list in triage order (red first, most-overdue first) and vehicle
  licenses expiring within 60 days with already-expired ones flagged. Every number is a server
  fact from the FL-2…FL-6 APIs; each card gates its own §7 permission, so queries never fire
  for cards the user cannot see, and an account with no fleet permissions gets one honest empty
  state. The data foundation for every coming slice landed alongside: a typed API client
  covering the whole backend surface plus TanStack Query hooks on the platform key factory —
  no mock data exists anywhere in the module. Five glyphs (truck, gauge, wrench, calendar, cog)
  joined the shared icon set and the sidebar registry — `calendar` also repairs the Leave app's
  icon, which had referenced a name the registry never knew.

  The vehicles registry followed (FW-3) in the HR list-page idiom exactly: URL-synchronized
  search (the four physical identifiers, matched server-side), status/type/branch filters,
  sortable columns, and pagination — deep-linkable and back/forward-aware. The derived
  in-workshop pill sits beside the lifecycle badge and expired licenses show red in place.
  Create and edit share one dialog where a cleared optional field submits as null — an erased
  fact, not an untouched one; the status dialog offers only the transitions the lifecycle
  allows, demands a reason whenever a vehicle leaves active service, and says plainly that
  disposal cannot be undone; deletion confirms with the audit-trail note. Every action stands
  behind its own permission.

  The vehicle profile (FW-4) completes the pair — reached through an explicit View action in
  the list's actions column, never by clicking the row (the owner's module-wide rule: no
  accidental navigation, and row selection stays free for later). The profile shows the whole
  car as live server facts: identity and radio, the type with its maintenance interval from the
  catalog, license with expiry flagged in place, placement, audit timestamps, the lifecycle
  status with its reason, and four indicators each gating its own permission — the derived
  workshop flag, the server's expected next odometer reading, the maintenance alarm with
  remaining or overdue kilometres, and the last closed workshop visit with its counter. Edit
  and status changes reuse the list's dialogs against the freshly loaded document, so every
  write stays version-checked. History links to the odometer, maintenance, accident, violation,
  and roster screens are wired behind per-slice flags and appear as each of those pages ships —
  fully hidden until then, never disabled, which the owner confirmed as the ECMS-wide standard.

  Drivers and attendance followed (FW-5). The drivers list shows the fleet-owned profiles over
  HR employees with names resolved through the shared HR cache — one EmployeeName component
  that degrades honestly to the raw id for callers without directory access — plus license
  search, specialization and active filters, and expired licenses in red. The driver profile
  gathers the fleet facts, links into the real HR employee profile for those who may open it,
  and carries the driver's own operational-unavailability timeline with record, edit, and
  cancel in place — recording there skips the employee picker because the driver is already
  known. The attendance screen lists the whole overlay (covering-date filter, sortable spans)
  and records through a directory search picker; edits and cancellations stay version-aware,
  and the cancel confirm says what it means: the driver becomes assignable again, the history
  stays in the audit log.

  The FL-4 trio followed (FW-6): odometer, maintenance, and the alarms board — screens over
  server facts, with none of the chain arithmetic reimplemented in the browser. The odometer
  log filters by vehicle and date range; an open period shows an honest "open" badge with the
  km column blank, because the server has not derived that distance yet. Recording offers the
  expected next reading as a hint only — continuity is enforced where it lives, in the API —
  and the correction dialog sends just the changed fields with the document version; it never
  sends an empty in-reading, because the backend reads that as reopening the period and
  refuses, and the UI does not offer what the server forbids. Maintenance lists visits with
  open/closed filtering and catalog-resolved workshop and work-type names; check-in pre-trims
  vehicles already in the workshop from the picker while the server remains the authority,
  and check-out, reopen, edit, and delete are version-aware behind their own permissions with
  plain-spoken confirms. The alarms board renders the derived projection exactly as served —
  level filter and code search run client-side over the one live response, triage order red
  first and most-overdue first, and a vehicle with no counting service yet says so instead of
  pretending a number. The vehicle profile's odometer and maintenance links lit up with this
  slice, and three rows joined the navigation seed.

  The daily roster board followed (FW-7), with the frontend as a pure viewer and executor of
  FL-5. One call brings the whole day: the scoped vehicles with their assignments, the derived
  in-workshop flag, and the driver pool already split by the availability seam — the unavailable
  side carries the server's named reason, translated when it is one of the five known verdicts
  and shown as sent otherwise. The date is URL-synced with previous/next-day stepping; searching
  by code or plate filters the one live response. Assigning opens a dialog that edits the
  complete desired state of that vehicle's day, and the driver slots offer only the board's own
  available pool — never a directory search — each candidate labelled free or with the vehicle
  currently holding them. Picking a held driver states plainly that saving will move them, and
  the save sends both sides of the move in one call, which the backend runs as one transaction;
  the server remains the authority on every rule, and a refused save refreshes the board because
  refusal usually means it went stale. The plan response is the refreshed board itself, so the
  screen repaints from the same round-trip with no second fetch. Clearing a day's assignment is
  its own confirmed action, and an in-workshop vehicle offers clearing but never assigning —
  the same asymmetry the backend enforces. The vehicle profile's roster link lit up with this
  slice, arriving pre-filtered to the vehicle's code, and the roster row joined the navigation
  seed.

  Accidents followed (FW-8), with states and money exactly as the backend keeps them. The
  registry lists the files with vehicle, status, and date-range filters synchronized to the URL,
  a sortable accident date, and pagination; the three amounts render through the platform's
  currency formatter and are never summed or combined — they are the entered facts, and no
  derived money exists until the owner defines the formula. Recording and editing share one
  dialog whose vehicle select offers the whole registry, because an accident is historical
  paperwork about the day it happened and a disposed vehicle is a legal reference — the same
  reasoning that makes the code column resolve retired vehicles instead of hiding them. The
  open/closed state is purely the server's: each row offers exactly the one direction its
  current state allows, closing and reopening are the same confirmed, version-aware call in
  either direction, and edits diff against the loaded document so only changed fields travel
  with the version. Deletion confirms with the audit-trail note. The vehicle profile's
  accidents link lit up with this slice and the accidents row joined the navigation seed.

  Violations and grievances close the FL-6 surface (FW-9), with not one amount computed in the
  browser. One screen carries two URL-synchronized views. The list shows both backend shapes
  side by side: a vehicle row is a bulk yearly statement — the year is the fact, and the amount
  column shows what the server derived from count times unit value — while a driver row is a
  per-event fact with its date, the driver's name from the shared HR cache, and the amount as
  entered. Recording matches: the vehicle-statement dialog sends count and unit value and never
  an amount, saying plainly that the server computes it, and the driver dialog picks the person
  through the directory while the server enforces that a driver profile exists. Editing opens
  the dialog of the row's own shape — the backend refuses crossing shapes, so the form never
  offers it — and sends only changed fields with the version. The annual rollup view renders
  the server's per-vehicle-per-year assembly exactly as returned, every figure including the
  grievance derived at query time; the grievance dialog sets the one stored figure per vehicle
  and year, prefilled from the row it was opened on, and the board repaints from the
  invalidated subtree. The vehicle profile's violations link lit up with this slice — all five
  history links now live — and the violations row joined the navigation seed.

  Catalogs and settings complete the module (FW-10). The catalogs screen manages the six list
  kinds every fleet form reads — workshops, work types, spare parts, mission types, violation
  types, unavailability reasons — as URL-synchronized tabs over the live paginated list, with
  archive instead of delete because history keeps referencing items, and the counts-for-alarm
  fact offered only where the contract allows it. The settings screen carries the two rule
  surfaces: the vehicle-type table, because the maintenance interval on the type is the
  maintenance rule the alarm engine reads, and the five fleet platform settings edited through
  the platform's own settings endpoints — a new thin platform settings client whose first
  consumer this screen is — with every value arriving from the server's hierarchical
  resolution and nothing hardcoded in the browser. Writes that move server-derived projections
  invalidate them: interval and work-type changes refresh the alarm board, and the HR-leave
  switch refreshes the roster's availability verdicts. With the catalogs and settings rows in
  the sidebar the Fleet category carries all twelve applications, and the closing integration
  review confirmed the whole: thirteen routes plus the 404 exactly matching the frozen
  information architecture, every route behind its own permission, all five vehicle-profile
  history links live, no placeholder or unreachable surface anywhere, and the module still one
  lazy chunk. The Fleet module — backend and web — is complete.

- **Accidents, violations, and grievances complete the Fleet backend (FL-6) — every fleet
  event is now stable.** Accidents keep the legacy's freedom with none of its looseness: a file
  opens on creation, closes and reopens as many times as the truth requires, but each flip is a
  distinct audited, published change — flipping to the state a file is already in is refused, so
  automation never hears an event that changed nothing. Amounts are stored as the entered facts;
  nothing is derived from them until the owner defines the formula (§13-Q9). An accident can be
  recorded against a disposed vehicle deliberately: it is historical paperwork about the day it
  happened, unlike an odometer reading, which stays refused.

  Violations are one collection with two discriminated shapes, and the shape decides who
  computes the money. A vehicle statement row has no amount field at all — the server derives
  count × unitValue when the row is created and again on every edit that touches either factor
  — while a driver event row records the amount as entered and requires a driver profile to
  exist (active or not; history counts). Editing a row with the other shape's fields is refused
  in the service, the one place both shapes meet. The grievance is a single figure per
  (vehicle, year) under a unique index, set and overwritten in place — the legacy stamped it
  redundantly onto every violation row. The annual rollup endpoint derives everything at query
  time: vehicle rows by their stored year, driver rows by the year of their event date (the
  legacy synthesized fake dates here, which is exactly how its reports went wrong), merged with
  grievance figures and vehicle codes by a pure, unit-tested assembler.

  `fleet.accident.recorded/.closed/.reopened` and
  `fleet.violation.recorded/.grievanceApplied` fire post-commit and are promoted
  planned → stable — with them, all 22 fleet events are stable and the module's automation
  surface is complete. Contract deltas are additive only: a grievance DTO and a rollup query
  schema.

- **The daily duty roster is live (FL-5): one board, one save shape, the day's exclusivity
  enforced where it can't be forgotten.** `GET /fleet/roster?date=` returns the whole planning
  picture — the caller's in-scope active vehicles with their assignments and a derived
  `inMaintenance` flag, plus the driver pool split into available (with the vehicle already
  holding each driver, anywhere in the fleet) and unavailable (with the layer that said no).
  The roster owns none of that logic: a driver's assignability is exactly what FL-3's
  `driverAvailabilityOn` answers, and a vehicle's is exactly what the `openVisitVehicleIds`
  seam answers — now accepting the plan date, so a car that enters the workshop after day D
  doesn't block day D (FR-5), with no call-site changed.

  `POST /fleet/roster` saves a plan as an upsert per (vehicle, date) — only the changed rows
  are sent, and each row is the complete desired state of that vehicle-day. The whole save runs
  in one transaction, every write version-checked against the row it read, and unchanged rows
  are pure no-ops: no write, no audit entry, no event. FR-7 — one vehicle per driver per date —
  is checked against the end state of the entire day, so taking a driver another vehicle still
  holds is refused with the holder named; sending both rows of the move in one save transfers
  the driver atomically. That is precisely the shape a drag produces, which is why a future
  drag-and-drop scheduler needs no backend change. Assignment rows are never deleted: clearing
  a day empties the row's facts in place, keeping the audit trail hanging on the row it
  describes. `fleet.roster.planned` (one per save) and `fleet.assignment.changed` (per changed
  row) fire after commit and are promoted planned → stable. Zero contract changes — the FL-1
  roster surface shipped exactly as frozen.

- **The odometer chain, maintenance visits, and the derived alarm engine are live (FL-4).** The
  odometer is one continuous chain per vehicle: recording a reading closes the open period
  (deriving its km) and opens the next inside a single transaction, a partial unique index
  guarantees at most one open period, and FR-2 refuses any reading below the vehicle's latest —
  the odometer never runs backwards. The only way past that refusal is the correction flow
  (`fleetOdometer.correct`, fully audited): because the closing reading of one period IS the
  opening reading of the next, a correction rewrites the shared value on both neighbouring rows
  atomically, and refuses outright anything that would break the chain's order — including
  "reopening" a period that has periods after it. `GET /fleet/odometer/expected` tells the
  client what reading the server expects next; the client computes nothing.

  Maintenance visits are the cycle's only reset: check-in requires a vehicle not already in the
  workshop (FR-4, doubly held by a partial unique index), check-out closes the visit with the
  counter at service, and reopen undoes a mistaken check-out — each firing its event only after
  commit. FL-2's `inWorkshop` seam now answers from the real open-visit query, with no call
  site touched. The maintenance alarm is never stored: `computeAlarm` derives
  remaining = interval − (latest reading − counter at last counting service) at query time, from
  the vehicle TYPE's interval, the settings thresholds, and the latest closed «صيانة» visit,
  preserving the legacy's two guards (no baseline / stale reading ⇒ no data, never a false
  alarm). `GET /fleet/odometer/alarms` is the alarm board.

  Two daily sweeps announce without changing state: license expiry (vehicles + drivers, warn
  windows from settings) and maintenance-alarm crossings. Idempotency is structural — a
  `fleet_sweep_marks` insert-if-new on a deterministic key means running a sweep twice emits
  nothing the second time, while a renewed license or a fresh service baseline naturally re-arms
  the announcement. Ten events promoted planned → stable: `fleet.odometer.recorded/.corrected`,
  `fleet.maintenance.checkedIn/.checkedOut/.reopened`, `fleet.maintenanceAlarm.raised`, and the
  four license-expiry surfaces. Contract deltas are additive only: an expected-reading DTO, a
  vehicle-id query schema, a reopen schema, and audit actions `correct`/`checkOut`/`reopen`.

- **Fleet drivers exist as extensions of HR employees, never copies (FL-3).** A driver profile
  holds only what Fleet is the authority on — license, specialization, area, an active switch —
  keyed by `employeeId`; name, phone and employment state stay in HR and are read through a new
  platform seam, `platform/directory`, which HR populates at module load the same way the auth
  identity seams work. Neither module imports the other: creating a profile validates the
  employee through the seam (an exited employee is refused), and the `hr.employee.exited` event
  deactivates the profile with no coupling. Internally each profile carries a `kind`
  discriminator with a (employeeId, kind) unique index, so a future second profile kind is an
  additive value rather than a migration — deliberately absent from the DTO until it exists.

  التمامات (driver unavailability) is the daily operational overlay the owner decided on:
  official leave lives in HR and is consulted through the seam when
  `fleet.availability.useHrLeave` is on, while this collection records only what the fleet floor
  knows (مأمورية، عهدة خارجية). One seam function answers "may this driver be assigned on date
  D", layering the profile switch, the HR employment gate, the fleet overlay, and HR leave — in
  that order, cheapest first — and names which layer said no. `fleet.driverUnavailability
.recorded/.ended` fire at commit points and are promoted planned → stable; an update publishes
  nothing, because a date correction adjusts a fact rather than creating one.

- **The Fleet module is running (FL-2): vehicle types, catalogs, and the vehicle registry with
  its lifecycle.** The `fleet` manifest registers alongside HR — permissions, routes,
  collections, settings, seed — and the first three features follow the platform shape exactly:
  Router → Zod validation → Service → BaseRepository, every write version-aware and audited,
  RBAC + data scopes from the first endpoint (a branch-scoped operator sees their branch's fleet;
  the legacy's hardcoded branch filter became scope, as the owner decided). The §4.1 lifecycle is
  enforced: leaving active service requires a reason, `disposed` is terminal and refuses edits,
  returning to service clears the reason. FR-1's four physical identifiers (code, plate, chassis,
  motor) are unique among non-deleted vehicles via partial indexes, so a scrapped car's plate can
  legitimately return. Nothing derived is stored: `inWorkshop` is computed through a service seam
  that honestly answers `false` until FL-4 owns maintenance visits.

  `fleet.vehicle.created/.updated/.statusChanged` are published at commit points and promoted
  `planned → stable` in the catalogue — the publisher test now holds them to their emit sites.
  Fleet settings are declared with defaults (alarm thresholds, leave-integration ON per the
  owner's Q1 decision, license-warning windows), and the boot seed installs the catalog rows the
  frozen design names: the alarm-counting «صيانة» work type, the roster's default mission type,
  and the seven violation types the legacy had hardcoded in its views.

- **The Fleet module's contract surface exists (FL-1), built from a frozen design extracted out
  of the legacy fleet system.** `packages/contracts/src/modules/fleet.ts` declares, at field
  level, everything the module will be: vehicles and their types (the per-type maintenance
  interval lives on the type), driver profiles as fleet-owned extensions of HR employees, driver
  unavailability, the odometer log, maintenance visits, the daily duty roster, accidents,
  two-shape violations with a once-per-(vehicle, year) grievance, and six catalogs. The schemas
  encode the design's load-bearing rules where they cannot be forgotten: odometer recording
  accepts one reading and no derived fields (km and the closing reading are server-derived),
  vehicle violations carry no client-supplied amount (count × unit value is computed), a roster
  plan refuses a driver holding two assignments in one day, and leaving active service requires a
  reason.

  All 22 `fleet.*` events are catalogued with v1 payloads and bilingual labels — visible to the
  Automation Engine's trigger picker from day one — and declared **`planned`**, the lifecycle
  state for a declared-but-unpublished event; the publisher test promotes each to `stable` only
  when its real emit site lands in FL-2…FL-6, so the catalogue cannot claim an event nobody
  fires. Settings keys (alarm thresholds, leave-integration toggle, license-warning windows) and
  notification template keys ship alongside, so nothing threshold-like is ever hardcoded. The
  design itself — entities, lifecycles, 14 business rules, permissions per screen, the hidden
  view-logic inventory from the legacy system, and the two legacy bugs deliberately not carried —
  is frozen in
  [`docs/12-planning/fleet-module-design.md`](docs/12-planning/fleet-module-design.md).

- **The first three automation workflows exist as data — account activation follow-up, password
  reset follow-up, and job-offer onboarding (A-9a).** Each is an `AutomationTemplatePackage`
  carrying an n8n graph, checked into `automation/templates/` and validated in CI against the real
  contract schema, so a package that would install as nothing fails here rather than on a
  production instance. A shared n8n error-handler workflow ships alongside them in
  `automation/n8n/`, and `npm run automation:preview <key>` renders any package into a standalone
  importable workflow for stepping through in the n8n UI.

  Designing them against the code rather than against assumptions changed all three. **ECMS has no
  temporary passwords to send** — AL-R4 replaced them with one-time activation links that
  `credentials-delivery.ts` deliberately keeps out of the persisted notification pipeline, and n8n
  persists execution data, so routing a link through n8n would write the credential into n8n's
  Postgres. The secret therefore never leaves ECMS: where a message must be re-sent, the workflow
  calls `credentials/resend` and ECMS composes and delivers it. What the workflows add is the thing
  ECMS genuinely lacks — follow-up and escalation, so an invitation sent nine days ago and never
  opened stops being invisible. **The onboarding workflow does not wait for the candidate's
  decision**: ECMS owns that state and publishes `hr.jobOffer.accepted`/`.rejected`, so each
  decision arrives as its own trigger and every branch is a pure function of one event, which keeps
  the answer to "did they accept?" in exactly one place.

  Every graph shares one skeleton — config, a fail-closed guard (constant-time signature check,
  envelope-shape check, `eventId` idempotency), business nodes, then a write-back to the ECMS
  execution row — so adding a fourth workflow is the business nodes and nothing else. Design,
  including the honest list of what must exist before any of it runs, is in
  [`docs/12-planning/automation-workflow-library-design.md`](docs/12-planning/automation-workflow-library-design.md).

- **National-ID OCR now has a real, fully local provider (OQ-30).** The seam has carried a null
  stub since Sprint 4.1 — `available: false`, no extraction — because image-to-text was a deferred
  capability. It is now implemented: a PaddleOCR 3.x sidecar carrying the PP-OCR weights baked into
  its image, reached by `PaddleNationalIdOcrProvider` behind the existing
  `NationalIdOcrProvider` seam. No third-party service and no external API at runtime.

  The pipeline is field-based rather than full-page — the card has fixed geometry, so each field is
  rectified, deskewed, denoised, contrast-enhanced, cropped and recognized on its own. That gives
  each field its own confidence band (which `OcrFieldDto` requires) and removes the guesswork of
  mapping a bag of strings back onto fields. Card geometry is data, not code: `OCR_LAYOUT_PROFILE`
  points at a JSON profile so real card stock can be calibrated without rebuilding the image.

  Deliberately unchanged: `parseNationalId` remains the sole owner of birth date, gender and
  governorate — the provider never returns them; the contracts in `packages/contracts`; the
  recruitment workflow; and the review dialog with its confidence model. Every field still goes to
  a human.

  **Off by default.** Without `NATIONAL_ID_OCR_URL` the null stub stays registered and the endpoint
  answers exactly as before, so this ships safely ahead of the sidecar being deployed anywhere. The
  provider reads card images through the Files service under the CALLER's context, so OCR cannot
  widen who can see a card, and it degrades to "no fields" on every failure path — an unreachable
  sidecar means the reviewer types the card in, not that recruitment stops.

  Accuracy against real Egyptian cards is **not yet measured**; the measurement harness and its
  documented process ship alongside in `spikes/national-id-ocr/`.

- **Recruitment: filter bars on every stage queue that was missing one.** The per-stage interview
  pages (First Interview, Second Interview, …), the per-phase evaluation pages (Security Check,
  Driving Test, Medical Examination, …) and Employees Ready now filter like the rest of the module:
  URL-synchronized, server-side, and part of the React Query key, so a filtered view is
  deep-linkable, survives a refresh, and can never share a cache entry with a different one.

  The interview bar is the existing component with a new `omit` prop rather than a second bar (I7):
  on a per-stage page the stage comes from the route and the status is the tab strip, so offering
  either again would be two controls for one piece of state. `clear filters` and the
  "any filters active?" hint both respect what the page owns. Evaluations get an applicant picker
  and a created-date range; Employees Ready gets free-text search over the offer number and
  applicant code plus an accepted-date range — never its own `status`/`hired` predicates, which
  ARE the queue (A6/RW15) and whose totals must keep agreeing with the stage counter.

  Each queue also gets the standard controls it can support: **free-text search** over the
  denormalized applicant code and name (interviews, evaluations; Employees Ready already searched
  its offer number), the **branch**, and — on interviews, the only stage where a record is assigned
  to anyone — the **interviewer**. Evaluations and accepted offers have no assignee, so neither
  offers a control for one.

  Branch and interviewer come from two new shared controls rather than three copies each, and both
  render _nothing_ when the caller lacks the permission that reads their catalog (`branch.view`,
  `user.view`) — an empty dropdown would filter nothing while implying access nobody granted. The
  user picker is the one the offer form already used, generalized: `ManagerPicker` is now that
  control with the offer form's wording.

  New query parameters: `createdFrom`/`createdTo` on evaluations, `respondedFrom`/`respondedTo` on
  job offers.

- **`search` now actually filters on screenings, interviews and evaluations.** All three declared
  the parameter in their contracts, and none of the three implemented it — a client could send
  `search=…` and get an unfiltered list back, which is worse than a 400 because it looks like it
  worked. All three now match the offers queue: an escaped, case-insensitive regex over the
  denormalized `applicantCode` and `applicantName`, so a user typing `.` searches for a dot instead
  of matching every row.

- **Prescreening: age-range and education-level filters, applied on the server.** Both facts live
  on the APPLICANT, not on the screening — the screening denormalizes only what it displays, and
  I1 is explicit that the list is closed. So the service resolves them against `hr_applicants`
  first and narrows the screening query by the id set they matched: the batched `$in` I3 permits,
  one extra indexed query per request rather than one per row. Two supporting indexes back it
  (`ix_education_birthDate`, `ix_birthDate`), the equality bound leading the range.

  Age is entered in whole years and converted to a half-open `birthDate` range at the boundary
  (`$lte now − from`, `$gt now − (to + 1)`), so "25 to 30" includes a candidate through the day
  before their 31st birthday and the stored field stays the date it always was. An applicant with
  no birth date — or no education record — is excluded when the corresponding filter is supplied:
  unknown cannot satisfy a predicate, and including those rows would make the filter mean nothing.
  An inverted range (`ageFrom > ageTo`) is a 400 at the contract boundary, not an empty page the
  user has to decode.

### Fixed

- **A deep link to page 2 of any searchable list bounced back to page 1.** `SearchInput`'s debounce
  effect listed `onChange` in its dependencies, and every caller passes an inline closure — so the
  effect re-ran on each parent render and re-emitted the _unchanged_ search term. On a list whose
  filter handler resets paging (the correct behaviour when a filter really changes), that discarded
  the page the user had linked to or refreshed on. The effect now emits only when the text differs
  from the value it was given, which also stops "clear filters" echoing back a change of its own.

- **Recruitment: interview status labels rendered as raw translation keys.** `/interviews`,
  `/interviews/:id` and `/interviews/stage/:stageId` showed `interviews.status.waiting` and
  `interviews.status.inProgress` instead of localized text, in the table, the detail badge, the
  status filter and the stage-queue tabs.

  I11 added `waiting` and `inProgress` to `INTERVIEW_STATUSES`; the locale catalogs were never
  extended, and `translate()` falls back to returning the key. Screening, evaluations, offers and
  applicants were all complete — interviews was the only stage missing values, and the two it was
  missing were exactly the two I11 introduced.

  Nothing caught it because `InterviewStatusBadge` mapped status to tone with a ternary
  (`cancelled ? neutral : info`) rather than the exhaustive `Record<Status, Tone>` every other
  stage badge uses — so growing the enum was not a typecheck error. That map is now exhaustive
  (`waiting` takes the same `warning` tone it has across the pipeline), and two suites make the
  class of bug mechanical rather than noticed: one drives every stage's status enum from
  `@ecms/contracts` and asserts each value resolves in **both** locales, the other renders the real
  badge for every status and fails if a raw key reaches the markup.

## [0.24.0] - 2026-07-28

Release v0.24.0 — **HR completed: Recruitment, Employee Management, Leave Management, Contracts,
and the Authentication & Account Lifecycle**, closing with the **Recruitment Workflow Refactor**
([PR #85](https://github.com/egycashcompany-ops/egycash/pull/85), merged 2026-07-28) whose frozen
design (`docs/12-planning/recruitment-workflow-design.md`, Revision 2.6 — decisions RW1–RW17,
invariants I1–I15) is now **fully implemented and audited with zero remaining implementation
gaps**. This release accumulates every change merged since v0.23.0; the Recruitment module is
**approved by EGYCASH**.

### Changed

- **Recruitment: every workflow mutation answers with the full state (I6, server half).** All
  seven recruitment controllers — screening, applicants, interviews, evaluations, job offers,
  hiring documents, return-to-stage — plus the per-candidate evaluation-batch actions now return
  `{ data, workflow, timeline, counters }` instead of the bare aggregate. `data` is byte-for-byte
  what they returned before; the other three are derived on the server, on every response, and
  stored nowhere (I1). `workflow` reports the furthest stage that still has open work and what the
  CALLER may do next — an action they lack the permission for is listed with `enabled: false` and
  the permission it needs, because capability lives in `availableActions` and nowhere else (I10).
  `counters` is the same aggregated stage-counts payload the navigation already reads (RW15),
  refreshed after the act. Reads (`GET`) are unchanged.

  Two kinds of endpoint stay outside the envelope, for the same reason: there is no single
  candidate whose state to report. Bulk endpoints answer with `BulkWorkflowResultDto` — the
  partial-success envelope plus what the batch wrote and the refreshed counters, but no
  `workflow`. Batch-LEVEL evaluation actions (create, add/remove members, issue, upload results,
  close, cancel) span every candidate in the batch; their per-candidate siblings (decide/void an
  item) do carry the full envelope.

- **Recruitment: the response IS the refresh (I6, client half).** `invalidateRecruitment()` — which
  fanned seven query subtrees out to the network after every write — is deleted, not deprecated.
  Every recruitment mutation now goes through one hook, `useWorkflowMutation`, which applies the
  response envelope to the TanStack Query cache: `data` seeds the aggregate's detail key and
  patches its row inside every cached list page, `workflow` is stored per candidate, `timeline` is
  merged into that candidate's history by `eventId` (newest first), and `counters` writes the one
  aggregated key the sidebar, the stage rail and every queue badge read. No request is issued.

  List MEMBERSHIP stays the server's judgement (I1): cached pages are marked stale with
  `refetchType: 'none'` — no request now, re-read on the next mount — while the visible list stays
  correct because the row is patched in place and dropped from a page whose `status` filter it no
  longer satisfies. Two responses are deliberately not written: empty `counters` (the BD-007
  degradation must not blank the navigation) and an empty `workflow.applicantId` (the empty state a
  candidate-less act answers with). Bulk keeps exactly one refetch, because
  `BulkWorkflowResultDto` carries the counters and the entries the batch wrote but not the changed
  rows; the other stages are marked stale without fetching. Adding a timeline note no longer
  invalidates anything either — the entry it returns is merged straight in.

  UI behaviour is unchanged throughout: the hooks still resolve to the aggregate, so every page,
  dialog and component reads exactly what it read before. `apps/web` gains a test runner (`vitest`,
  wired into `npm run test --workspaces`) and its first suite: 21 cases over the cache layer,
  including the ones that would catch a refetch creeping back in.

- **Recruitment: a retired attempt is read-only for every write, not just transitions (I1).** The
  stage repositories already refused to let a service write `status`, `attempt` or the supersede
  markers (I13), and the engine already refused to transition a superseded record — but an ordinary
  domain write addressed by id (a note, a file, a panel edit, a recommendation) could still land on
  an attempt a return-to-stage had retired. `BaseRepository` gains two generic hooks,
  `writeConditions()` and `assertWritable()`; the four stage repositories narrow them to the live
  set. The condition rides inside the same atomic `findOneAndUpdate` as the write, so a return
  landing mid-request cannot be overtaken, and the refusal says _why_ (422, "superseded by a return
  to an earlier stage") rather than reporting a version conflict a retry could never resolve. Two
  writers still reach a retired row, both named by I1 itself: the supersede marker, and the
  denormalized branch scope a reassignment syncs across a candidate's whole history.

- **Recruitment: the outbox has a scheduled recovery sweep (I15).** `hr.recruitment.workflowOutbox`
  runs every 5 minutes and publishes committed workflow events whose dispatch never ran. The engine
  writes the aggregate change and its event in one transaction and publishes after commit; a process
  killed in that gap left a committed state change with no timeline entry, no notification and no
  projection until some later write happened to drain the outbox. Now it heals on a timer too. Safe
  to overlap and safe to repeat — delivery is per-event and marked.

- **Recruitment: the timeline repair task exists (I5).** `hr.recruitment.timelineReconcile` runs
  hourly and puts back entries that should exist and do not: events committed but never projected
  (replayed through the dispatcher's own projection), and the two facts that have no event behind
  them — `applied` and `identityVerified`, whose writer logs and swallows rather than failing a
  registration — rebuilt from the applicant document. Every write it makes is keyed on the
  deterministic `sourceKey`, so a run against a healthy database changes nothing and a rebuilt row
  keeps its original `eventId`. The promise `recordSafe` has been making in a comment since the
  timeline was introduced is now kept in code.

- **Recruitment: the boot migration materializes the waiting backlog (I8/I11).** Since I11 made
  `waiting` a persisted row, a candidate with no row is not "waiting" — they are invisible to every
  queue, counter, badge and bulk action. Two populations had exactly that shape and nothing put them
  back: applicants who moved through the pipeline before I11 existed, and applicants whose
  materialization threw and was swallowed by `safely()` so the decision that triggered it would
  still commit. `migrateRecruitmentWorkflow()` now ends by walking every live applicant and
  resolving how far they got from their own records — never from a stored cursor (I1) — then opening
  whatever is missing through the same `open*` methods the live path uses. Re-running repairs
  nothing and writes nothing, which is what makes it safe on every boot; a decided stage is never
  re-opened, and a withdrawn candidate is not scanned at all. This closes the repair `safely()` has
  promised in a comment since materialization was introduced.

- **Recruitment: I3 is enforced by tests instead of asserted in prose.** A new integration suite
  seeds 2,000 rows across four stage collections and runs `explain()`: every stage queue must show
  an `IXSCAN` and never a `COLLSCAN`, and each counters aggregation must touch only rows that match
  — keys and documents examined both equal the live count, never the collection size. Making that
  true needed a new index, `ix_live_counters` on `{ supersededAt, isDeleted, branchId, status }`,
  which puts the retired rows in a key range the scan never enters.

  Two things about `null` came out of writing the check, and neither is visible without it. The
  obvious PARTIAL index over `{ supersededAt: null, isDeleted: false }` does not work and fails
  silently — MongoDB will not use a partial index for a `null`-equality predicate, because
  `$eq: null` also matches missing fields, so the plan is never generated and the query
  collection-scans exactly as before. And for the same reason the scan is index-_served_ but not
  index-_only_: an index entry cannot tell a stored `null` from an absent field, so each matching
  document is still read. Both claims sound alike and only one is true.
  The same suite benchmarks the shipped counters shape (N grouped aggregations in parallel)
  against a single `$unionWith` pipeline, asserts both return identical numbers, and fails if the
  shipped shape is slower. The shape itself is what RW15 §7 specifies verbatim — "six `$group`
  aggregations (one per collection) … issued in parallel inside one request" — and the `$lookup`
  pipeline I3's wording describes is the one I11 deleted when it made `waiting` a real row and
  removed the eligibility derivation. `docs/02-architecture/recruitment-workflow.md` §7 records how
  the two passages reconcile.

- **Recruitment: one history, and only one (I5).** Three parallel histories are gone. The
  Electronic Employee File no longer re-derives the recruitment milestones — its own timeline
  starts at the hire, and the candidate's recruitment history arrives as `recruitmentTimeline`,
  read from `hr_recruitment_timeline` at request time. `EvaluationDoc.decisionHistory[]` is
  removed: it logged `at`/`from`/`to`/`reason`/`by` for every re-decision, which is exactly what
  the timeline's `evaluationDecided` entry already records for the same act. And every screen that
  shows history now reads the canonical collection through one renderer — the four stage detail
  pages, the Employee File and the employee profile's recruitment section included. The boot
  migration drops the four derived milestone types from files already assembled and unsets the
  evaluation array; nothing is lost, because the timeline held all of it.

- **Recruitment: one bulk toolbar and one selection model (I7).** The older `BulkActions`
  component is deleted rather than deprecated, and its two call sites — the applicants list and
  the phase board — moved to the shared `BulkActionBar`. The phase board also dropped its own
  `useState<Set<string>>` selection for `useTableSelection`, and its "move to Job Offer" now
  issues one `POST /hr/applicants/bulk` instead of a client-side loop of single-item requests,
  so the act gets the per-item transaction, the partial-success envelope and the single audit
  record every other bulk action already had. `BulkActionBar` and `useTableSelection` are now part
  of the shared UI barrel.

### Fixed

- **Recruitment: `timeline.produced` could never resolve.** The envelope's "what did this action
  write?" half joined the workflow event ids the engine reported against the timeline's `eventId`
  column — but the projection minted a _fresh_ id for the entry, so the two never matched and the
  slice would have shipped permanently empty. A projected entry now takes its event's id, which is
  also what makes the join idempotent across a redelivery, and entries written outside the engine
  report themselves at write time. Found before the contract had a single consumer.

- **Recruitment: the candidate timeline was missing its first two entries.** `applied` and
  `identityVerified` were in the frozen vocabulary but nothing wrote them — registration and
  identity verification are candidate facts, not workflow transitions, so no consumer recorded
  them and every history began mid-pipeline at the first decision. Both are now written by the
  applicant service.

- **Recruitment: a stage closed by a withdrawal showed as a blank note.** `hr.screening.cancelled`
  and `hr.evaluation.cancelled` had no timeline entry type, and an unmapped event does not fail —
  it falls through to a generic `note`. The vocabulary gains `screeningCancelled` and
  `evaluationCancelled`, and a unit test now asserts the mapping is total, so the next event
  cannot repeat this.

- **Recruitment: bulk "Move to Job Offer" silently ran a reassignment instead.** The applicant
  bulk executor handled `withdraw` and fell through to `reassign` for everything else, so
  `moveToOffer` and `moveToScreening` — both in the closed action vocabulary — reassigned the
  selection with an undefined placement rather than moving anyone. The executor is now exhaustive
  over its own vocabulary: `moveToOffer` moves, and `moveToScreening` opens the screening row
  (idempotent, since I11 materializes it at registration). Both are now offered on the applicants
  table, completing RW17's action list for it, and both are covered by integration tests.

- **Recruitment: bulk "Start now" was a no-op.** The web client posted the bulk body to
  `POST /hr/interviews/start` — the single-candidate route, whose schema is `.strict()` —
  so every click answered 400. It now calls `POST /hr/interviews/bulk/start`, and bulk
  scheduling likewise calls `POST /hr/interviews/bulk/schedule` instead of looping
  single-schedule calls client-side, which produced no bulk audit record, no
  partial-success envelope, and a half-finished run if the tab was closed. A test pins
  that the single route refuses a bulk body.

- **Recruitment: withdrawing or restoring a candidate bypassed the workflow engine.** Both wrote
  `applicant.status` directly through the repository, so the invariant that the engine owns every
  lifecycle change (I13/I14) was documented but not enforced for the two most common moves — and
  nothing downstream of the engine ran for them. Both now go through it, carrying their own
  fields and the caller's version check in the same act.

- **Recruitment: withdrawn and rejected candidates lingered in the stage counters.** The
  counters read stage rows without regard to whether the candidate was still in the
  running, so a badge could out-count its own page indefinitely. A lifecycle exit now
  **closes** the candidate's open stage records: the workflow engine transitions each of
  them to a terminal status in the same transaction — screening and evaluation to the new
  `cancelled`, interviews to `cancelled`, a live offer to `withdrawn` — so they leave every
  queue and counter through the status vocabulary itself, with no mirrored lifecycle field
  anywhere (I1/I10). Decided records are never touched. Because each closure status is
  terminal, restoring a candidate re-opens the stage on a **new attempt** rather than
  reviving a closed row (I11/I12). The boot migration closes the records of applicants who
  had already left.

- **Contract templates: Save Draft is no longer completeness-gated — Publish is.**
  Saving a template draft no longer demands the full names, contract type and body up
  front ("Complete the Full Names, Contract Type, and Body before saving"): a draft is
  expected to be incomplete while it is being authored, so drafts now save freely with
  empty names, no contract type, an empty body and unlabeled signature rows (schemas,
  Mongoose model and editor all relaxed; the template DTO's `contractTypeId` is `null`
  while unset). **Publish** becomes the single completeness gate: it blocks — client-side
  with a friendly message and server-side with a 422 listing exactly what is missing
  (Arabic/English names, contract type, body, signature labels) — until the draft is
  complete, which also preserves the invariant that only complete templates can ever
  generate contracts (A17). Unknown placeholders (e.g. a typo like `{{employe.name}}`)
  no longer block draft saves either — they surface as preview issues while authoring
  and are rejected at publish (D5 enforced at the gate), and a body of empty markup
  (the editor's leftover `<p></p>`) counts as empty there too. Preview stays entirely
  outside this validation (it renders the current editor state, now even with unlabeled
  signature rows), and unnamed drafts list as "(untitled draft)" so they stay reachable.

### Removed

- **Recruitment: the derived "awaiting" queues are gone (I11).** `GET /hr/screenings/awaiting`,
  `GET /hr/interviews/awaiting` and `GET /hr/job-offers/awaiting` — with their contracts,
  services and the three panels that rendered them — have been removed. Every queue in the
  product is now a plain indexed read over persisted `waiting` rows, so there is no second
  "who ought to be here" model that can disagree with the first. Also removed: the four
  deprecated loose selection props on `DataTable` (superseded by `selection`) and the
  duplicated `BulkApplicantsResultDto` (superseded by the shared `BulkActionResultDto`);
  applicant bulk actions now run through the same executor as every other module, so they
  are audited once as an act as well as per item.

### Added

- **Recruitment: every backend capability is now reachable from the UI.** The pieces that
  existed only as endpoints are wired to real screens: **Return to stage** (RW13) gets its
  own dialog — target picker, the server's own consequence preview of what will be
  superseded and what will be closed first, a mandatory reason, and a confirm button that
  stays disabled until that preview has arrived. **Start interview** (RW12) gets buttons on
  the round's page and on each row of a stage queue, covering both "start now" for a
  candidate whose round does not exist yet and "start" for one already scheduled; the
  server stamps who started it and when, and the screens render those moments on the
  Africa/Cairo business calendar rather than the viewer's timezone. **Placement
  recommendations** (RW5) can finally be _recorded_ — previously only displayed and
  applied — on both interviews and evaluation phases, including clearing one. **Employees
  Ready** appears in the navigation with its live counter and filters server-side, so its
  pagination and its badge agree. **Bulk complete** arrives for Hiring Documents (new
  endpoint) and **bulk close/cancel** for Evaluation Batches, completing bulk actions on
  every recruitment table.

- **Recruitment: Position & Branch stay editable until hire (RW1–RW5).** A candidate now
  carries a first-class `placement` (position, title, department, branch, section) that
  may be set at intake and stays editable from Screening through Offer Acceptance.
  Moving one is its OWN audited action — `POST /hr/applicants/:id/reassign` behind the new
  `applicant.reassign` grant, with a mandatory reason — never a field on the edit form, so
  a routine data correction can't silently move someone to another branch. One act does all
  of it: writes the placement and its ADR-015 scope mirror, appends to `placementHistory`,
  syncs the **scope field only** on the candidate's screenings, interviews, evaluations and
  offers so a branch-scoped user keeps seeing their whole history, writes one timeline entry
  per moved dimension under a shared correlation id, and drives a live (`draft`/`sent`) offer
  through a normal versioned revision so the package follows the placement. Selecting a job
  position completes the rest of the placement from the seat. Every stage record keeps its
  **immutable `placementSnapshot`** — queues show where the candidate stands today, history
  shows what it was created under, and nothing already decided is rewritten. Acceptance
  closes the window: afterwards the path is revise / withdraw → re-accept → hire, because the
  accepted snapshot is the contractual artifact. Bulk reassignment applies one placement to a
  whole selection with the shared partial-success envelope. Interviews and evaluations can
  record an advisory `recommendedPlacement` that never moves anyone by itself.

- **Recruitment: Employees Ready queue + bulk "Start now".** `/employees/ready` lists
  accepted offers not yet converted into an Employee — read from a fact on the offer, the
  same source the stage counter uses — with a direct hire action. Interview stage queues gain
  a bulk **Start now** (RW12) alongside bulk cancel.

- **Recruitment: Security / Driving check batches (RW8).** The two external checks that
  are performed on a GROUP of applicants are now worked as batches. HR picks candidates
  from a phase's waiting queue (`GET /hr/evaluation-batches/candidates` lists exactly the
  eligible ones — live applicant, all interviews cleared, phase applicable, not already
  held by an open batch), the system allocates an immutable batch number
  (`SEC-2026-000001` / `DRV-2026-000001`, atomic per prefix and year) and drafts the
  batch. Issuing freezes membership, stamps the sent date and queues the package build.
  A batch never becomes a second source of truth: every item points at the applicant's
  ordinary per-phase evaluation record, and deciding an item decides that evaluation
  through the existing service — one writer, one audit trail, one event, one timeline
  entry. Membership is only editable while the batch is a draft; afterwards an item is
  **voided with a reason**, never removed, and batches themselves are never deleted or
  purged, so the whole history (cancelled ones included) stays available permanently.
  Closing requires every item to be decided or voided. Bulk approve/reject/void run
  per item with the shared partial-success envelope (RW10/I4). Sight is per phase (RW7):
  the generic `evaluation.*` grants remain a superset, and a caller who only holds
  `medicalCheck.*` never sees a security batch — including in an unfiltered list.
  Medical Check stays individual and offers no batch surface at all (RW9).

- **Recruitment: batch package — official PDF list + ZIP export (RW8b).** Issuing emits
  `hr.evaluationBatch.generated` on the reliable tier; the **worker** renders the official
  list through the existing chromium seam (company branding header, batch identity, a
  numbered candidate table and a signature block, printed RTL), writes a manifest CSV, and
  packs `list.pdf`, `manifest.csv` and `attachments/<applicantCode>/…` into one ZIP stored
  in a new `hr-evaluation-batches` Files category. With the PDF driver disabled (dev/CI)
  the batch still issues and the package still builds — it simply reports that it holds no
  `list.pdf`, the same graceful degradation contracts uses — and the build is retryable
  from the UI. Returned results are uploaded against the same batch
  (`POST /hr/evaluation-batches/:id/results`, multipart); the first upload stamps
  `returnedAt`, and a document may be attributed to one applicant's item (RW8c).
  Adds one runtime dependency: `archiver`.

- **Contracts: preview without saving + `{{contract.currentDate}}`.** The template
  editor's Preview now renders the CURRENT form state directly — nothing has to be
  completed or saved first: `POST /hr/contracts/preview` accepts an `inlineTemplate`
  (language + sections + signature blocks) as an alternative to a saved `templateId`,
  sanitizes it through the same pipeline, and reports unknown or unresolved
  placeholders as listed issues in the preview dialog instead of blocking. A new
  built-in catalog variable `{{contract.currentDate}}` resolves to the current date on
  the **Africa/Cairo** calendar (same `YYYY-MM-DD` shape as the other date variables)
  and is available in every template via the variable browser.

- **Recruitment workflow UX.** The Interviews phases board (`/interviews?view=board`) now
  uses the full page width (kanban-style; the standard 80rem cap remains everywhere else).
  Scheduling an interview from an **accepted Screening** opens the schedule dialog with
  the applicant preselected and read-only — searching exists only when scheduling a
  completely new interview. `/job-offers` becomes a workflow queue: applicants moved to
  the Job Offer stage with no offer drafted yet surface automatically in an
  **Awaiting offer** panel (name, code, eligibility status, moved-on date; derived
  read model via `GET /hr/job-offers/awaiting` — no offer record is fabricated), and
  **New Offer** opens the create form with that applicant preselected; the applicant
  search remains only for standalone offers. Drafting an offer removes the applicant from
  the queue.
- **Contracts module (frozen design `docs/12-planning/contracts-module-design.md`,
  Revision 2 — D1–D12, A1–A22, Q1–Q3; architecture:
  `docs/02-architecture/contracts-module.md`).** First-class HR module:
  - **Templates** — admin-owned, ONE document per version in an append-only recoverable
    chain (A19): drafts edit in place, editing a _published_ version forks the next
    draft, and only **published** versions generate (A17, one published per key). Rich
    sections (header/body/footer) pass an allow-list sanitizer on every save (A11 — no
    active content survives), placeholders are validated against the server-owned
    variable catalog (D5), clone creates the cross-language copy (Q2), archive retires a
    version. Web: `/contracts/templates` + the D7 **TipTap** editor whose toolbar
    mirrors the sanitizer exactly, variable browser (insert `{{key}}` at the caret),
    signature-block editor, version history, and a sample-data **server** preview.
  - **Contracts** — draft → optional single-step approval (A7, `contracts.requireApproval`,
    default on) → **generate**: pins the published template version (A2), resolves every
    variable **with provenance** incl. manual overrides (A3), refuses loudly with a
    structured report when required values are empty (A16 — `CONTRACT_VARIABLES_MISSING`),
    renders the immutable snapshot through ONE renderer (A18/A20), stores SHA-256 +
    generator/template/contract-version integrity metadata (A14) and hands the PDF to the
    **worker** over the reliable event tier (A13). One immutable Files record per contract
    version (A15); with no chromium (`CHROMIUM_PATH` empty) generation completes and the
    print view serves exports (D8). Configurable numbering `contracts.numberFormat`
    (A1, default `ECMS-CON-{year}-{seq:6}`) over per-year atomic counters. Signing per
    template block (A5); fully signed or archived ⇒ `CONTRACT_IMMUTABLE` (A4). Amend =
    next version of the same code, renew = new linked contract (D9); generating the
    successor supersedes the predecessor. Q3: one active contract per employee per type
    unless the type allows multiple. Hourly expiry sweep + once-per-contract
    expiring-soon notice (D11, `contracts.expiryNoticeDays`). Free-text search over
    number/employee/reference (A12); attachments via the platform Files service (A6);
    every lifecycle step lands on the employee timeline (A8).
  - **Integration seam (A22)** — consumers (Payroll, Employee Files, Workflow, Document
    Management) read ONLY `contractQueryService` snapshots (`activeSnapshotAt`,
    `listForEmployee`, `getSnapshot`) and the `hr.contract.*` events — never the tables.
  - **Revision 3 (freeze confirmed) — A23–A26.** Every PDF carries a **verification QR**
    targeting the public non-PII endpoint `GET /hr/contracts/verify` (key = the A14
    SHA-256, bound to the exact issued snapshot) and the public `/verify/contract` web
    page renders the verdict (A23). A **company branding profile** (logo, header/footer
    lines, watermark, brand color — each ar+en, managed on the Templates page under
    `contractTemplate.manage`) is applied by the server at every render and preview and
    frozen into each issued snapshot, so branding changes never alter existing documents
    (A24). The worker records a `contractRendered` audit entry on every PDF run —
    completing the audit inventory across template edits, generation, approvals,
    signatures, downloads and lifecycle transitions (A25). The renderer abstraction is a
    recorded invariant: the domain depends only on `platform/pdf`, never on Chromium
    (A26).
  - **Web app** — `/contracts` register (Employee/Type/Version/Status/dates + Preview /
    Print / Download PDF / Amend / Renew / Terminate, permission- and state-gated),
    `/contracts/new` two-pane creation with a debounced live **server** preview (the
    exact document generation freezes) + per-variable overrides + generation progress,
    `/contracts/:id` detail (snapshot viewer, integrity line, variables with sources,
    approval, signing, attachments, amendment chain), and a **Contracts** tab on the
    employee profile. Full ar/en i18n; sidebar entry seeded for new AND existing
    installs.

- **Authentication & Employee Account Lifecycle (frozen design:
  `docs/12-planning/auth-account-lifecycle-design.md`, Revisions 2–6).** Every employed
  employee now gets a login account **automatically at creation** (hire or direct
  registration) and via an idempotent boot backfill for existing databases: username = the
  Employee Code, Employee Self-Service role granted at link time. **No passwords are ever
  sent (§14, enterprise standard):** the account is born awaiting a **one-time setup link**
  delivered to the employee **via WhatsApp + email** (username, Employee Code, link, expiry)
  through provider-agnostic transports (Meta Cloud API / Twilio / disabled — R9); the
  employee opens `/activate` and **chooses their own policy-checked password**. Delivery is
  transient — the persisted notification pipeline is never used, nothing secret is ever
  stored (hash-only), logged, or returned by any API (R11/R12) — and the message wording is
  an **admin-editable notification template** (`platform.credentialsDelivery`,
  create-if-missing so edits survive deploys, R15). Channels are independent (email-only or
  WhatsApp-only both work, R16). Links **expire** (`auth.activationLink.ttlHours`, default
  48h); **Resend** issues a new link that instantly invalidates the previous one (only while
  a link is pending); **admin Reset** (permission `user.resetPassword`) locks the account —
  password cleared, all sessions revoked — and delivers a fresh link. Login identifiers are
  configurable (`auth.loginIdentifiers`): username, email (now **optional** on accounts —
  partial unique index, migrated at boot) and the Employee Code, which resolves through an
  HR seam and keeps working even after an admin renames the username. Admins can also
  **Reset** a user's authenticator or **Require/Un-require TOTP** (force-on wipes any
  enrolled secret and demands enrollment at the next login — admins can never see or
  generate a secret, D6). Self-service gets an **Account Security** page (change password,
  enable/disable authenticator with QR + one-time backup codes, active-session list with
  revoke). The server-enforced first-login gate (`mustChangePassword` →
  `PASSWORD_CHANGE_REQUIRED`) remains implemented as dormant defense-in-depth — the link
  model never needs it. All lifecycle events are audited (`accountAutoCreated`,
  `credentialsDelivered` per channel + mode, `firstLogin` at activation, `passwordReset`,
  `passwordChanged`, `totpEnrolled`/`totpDisabled`/`totpReset`/`totpRequiredChanged`,
  `usernameChanged`). Fully backward-compatible: existing email-only accounts, the invite →
  activate flow and enrolled TOTP users behave exactly as before, and the identifier
  resolution + challenge-token seams keep the door open for Azure AD / Google Workspace /
  LDAP / SAML / OAuth, WebAuthn and SMS/Email OTP without redesign (§10/R18). Also fixes
  the web login form, which only sent `email` and silently broke username-based sign-in.
  **Hardening + enterprise completeness (§15/§16):** a never-activated login answers a
  dedicated `AUTH_ACCOUNT_NOT_ACTIVATED` (unknown identifier and wrong password stay
  indistinguishable); admins see a derived **account status** (Not Invited / Invitation
  Sent / Activated / Expired / Locked) plus a full **Account panel** on the employee page
  (invitation sent/expires, activated at, last login, password last changed, MFA state,
  per-channel delivery outcomes); disabling an account, deleting it, or an **employee
  exit** revokes any pending setup link _and every session_ in the same operation (the
  status machine now allows suspending a never-activated login); an **hourly sweep**
  revokes expired links; the whole invitation lifecycle is audited (`invitationCreated` /
  `invitationResent` / `invitationExpired` / `invitationUsed` / `invitationAttemptInvalid`
  / `invitationRevoked`) with nothing ever deleted — history lives in the append-only
  audit stream and the invitation metadata survives consumption; activation is single-use,
  device-independent, MFA-independent and **never mints a session** (login is the only
  place sessions are born); lifecycle state + sequence diagrams live in
  `docs/02-architecture/account-lifecycle.md`.

- **Railway deployment support.** Config-as-code for a two-service deployment
  (`railway.json` → api + web, `railway.worker.json` → BullMQ worker + scheduler), a new
  `WEB_STATIC_DIR` option that lets the api serve the built web bundle **same-origin**
  (hashed assets immutable, HTML shell no-cache, SPA fallback) so the `SameSite=Strict`
  refresh cookie works without cross-site exceptions, and a step-by-step guide
  (`docs/09-guides/railway-deployment.md`) covering Atlas (transactions require a replica
  set), Redis, volumes, env vars and first-boot seeding. Field-tested notes are folded in:
  `REDIS_URL` needs `?family=0` (Railway private networking is IPv6-only), `WEB_STATIC_DIR`
  must be absolute (`/app/apps/web/dist` — `npm start -w` sets cwd to `apps/api`), and the
  worker's optional contract-PDF stack (`RAILPACK_DEPLOY_APT_PACKAGES` chromium + Noto
  fonts, `CHROMIUM_PATH=/usr/bin/chromium`).

### Fixed

- **Upgrade compatibility + field-test fixes (post-Leave-merge QA round).**
  - _Sidebar_: the navigation catalog now syncs at every api boot (`syncNavigationCatalog`),
    so installs upgraded from older releases receive newly shipped applications (e.g. `/leave`)
    and super-admins are granted them automatically — previously the catalog only seeded on
    fresh installs.
  - _Permissions_: `syncPermissionRegistry` invalidates super-admin/platform-admin holders'
    cached permission snapshots when the catalog changes — new-module permissions apply
    immediately after deploy instead of 403ing until cache expiry.
  - _Applicants list 500_: documents created by earlier releases lack later-added fields and
    `.lean()` reads skip schema defaults (`undefined.toISOString()` crashed the list). The
    applicant mapper is now total over legacy shapes and a boot migration
    (`migrateRecruitmentLegacy`) backfills the stored documents.
  - _Person names in tables_: Screening/Interview/Evaluation/Job-Offer rows now denormalize
    `applicantName` (backfilled for existing rows); queue tables, the workflow board and the
    awaiting panels show the display name next to the code, and job-offer search matches it.
  - _Leave error reporting_: leave tables no longer mask API failures behind a generic
    message — the real error (permission, validation, server) surfaces in the error state.
  - _Reference lookups_: dropdown queries requested `pageSize: 200` against the API's
    `MAX_PAGE_SIZE = 100` and silently degraded to empty lists — the Department picker on the
    Section form (and four sibling lookups) now work.
  - _Numeric org-unit codes_: `01`-style codes are accepted (min length 1), Arabic-Indic
    digits are folded to ASCII in the code input, and the hint copy no longer implies letters
    are required.
  - _i18n_: added the missing `employees.tabs.leave` label (en + ar).
  - _Job Titles vs Job Positions_: kept as two entities (WHAT vs WHERE — see
    `docs/02-architecture/organization-structure.md` §2); both pages now state the
    distinction explicitly in both languages.

### Added

- **HR — Leave Management module (frozen design: `docs/12-planning/leave-management-design.md`).**
  Law and policy live as editable configuration: the seeded leave-type catalog models the
  Egyptian Labor Law defaults (annual 15/21/30 with age-50 step, casual deducted from annual,
  tiered-pay sick leave with a certificate gate, maternity, pilgrimage, unpaid) — **HR must
  verify the amounts before production (L4)**. The append-only leave ledger is the truth for
  every balance movement, with an atomic reservation gate on the balance cache, frozen
  `paidBreakdown` snapshots on consumption (the Payroll read contract) and pro-rated grants at
  boot, year-end and hire time. Requests flow submit → dynamic current-manager approval
  (relationship-based — line managers need no leave permission) → optional HR step, with HR
  override, synchronous catch-up for backdated spans, soft-rule override for HR on-behalf
  filing (L8), early return, cancellation, attachments via the Files platform and a live
  eligibility preflight. Status-affecting types (maternity/Hajj/long unpaid) drive
  `leaveStart`/`leaveEnd` through the Personnel Actions engine and never roll back when a drive
  fails. The shared `work-calendar` feature (Fri+Sat weekend setting + holiday catalog, Cairo
  business dates) is Attendance-ready. Web ships the Leave app (My Leave + wizard, approvals
  inbox, team calendar, HR administration) and the employee profile's Leave tab; the first
  self-service surface arrives with the seeded **Employee Self-Service** role (own-scoped),
  `MeDto.employeeId`, the `ownerUserField` own-scope repository option and the
  `hr.employee.loginLinked` backfill event (C1-R). Four scheduler tasks, eight notification
  templates, four audit actions, exit settlement and the deprecated manual leave dialogs
  removed from the Employees UI complete the module.

- **HR — Employee Management module (frozen design: `docs/12-planning/employee-module-design.md`).**
  The employee becomes the post-hire system of record, moved out of Recruitment into
  `modules/hr/employee-management` (URLs and permission keys unchanged).
  - **Probation-first lifecycle.** Statuses are now `probation → active ⇄ onLeave ⇄ suspended →
exited`; every new hire starts in probation (0 months ⇒ straight to active) with explicit
    confirm / extend / fail decisions and a scheduler reminder before the deadline. `exited` is the
    single terminal status — the exit _type_ (`resignation | termination | endOfContract |
retirement | death`), reason, effective date and an explicit **rehire-eligibility** decision are
    data on the exit record. Returning from suspension/leave lands on the BASE status (probation if
    never confirmed). The legacy `terminated` status is migrated to `exited` at boot.
  - **Personnel Actions engine** (`hr_employee_actions`) — the only writer of employment facts.
    Append-only, per-employee sequenced, **effective-dated** (past applies immediately; future is
    `scheduled` and applied by a scheduler task in date order, with org referents re-validated at
    application time — failures are recorded + notified, never silent), cancellable while scheduled.
    Permission-grouped endpoints: `POST /hr/employees/:id/actions/{employment|compensation|exit|rehire}`
    - cancel + list. The old `PATCH /:id/status` remains one release as a thin alias (exits refused
      there). Propagation: a branch transfer recomputes the employee code and syncs the **linked user's
      placement** and the Employee File's code/branch; an exit **auto-suspends the login**, settles
      direct reports (bulk reassign or explicit unassigned) and closes the employment period;
      self-actions are always rejected.
  - **Owned personal data.** The applicant's personal data is copied ONCE at hire (raw national id,
    masked in DTOs) and maintained on the employee via audited `PATCH /:id/personal` edits — the
    applicant record stays immutable pre-hire history.
  - **Direct Registration** (`POST /hr/employees/direct`, `employee.registerDirect`) — onboard the
    existing workforce or walk-in hires without a pipeline (recruitment references null), with the
    shared national-id OCR and duplicate guards against employees AND live applicants.
  - **Rehire on the SAME employee number** — reopens a new employment period (same number, same
    Electronic File; a new completed hiring case _supplements_ the existing file). Terms come from an
    accepted offer or direct entry; rehiring someone marked not-eligible needs the dedicated
    **`employee.rehireOverride`** permission. Hiring a returning person through recruitment or direct
    registration is refused and routed to Rehire (one person = one employee, forever).
  - **Compensation split.** `employee.viewCompensation` / `employee.manageCompensation` — salary and
    allowances are redacted end-to-end (profile, lists, action history) without view rights.
  - **Employees web app.** `/employees` becomes its own sidebar app: an employed-by-default registry
    list (+ exited view), a profile hub (Overview / Personal / Employment / Documents / Timeline /
    Account) with a status-and-permission-filtered Actions menu, focused action dialogs (suspend's
    "disable login" checked by default), pending-exit + probation banners, a Direct Registration
    form with a live rehire-match check, and a composed timeline (recruitment milestones + personnel
    actions + audited personal edits). `/employee-files` moves alongside unchanged.
  - New permissions: `employee.{registerDirect, editPersonal, manageActions, manageCompensation,
viewCompensation, exit, rehire, rehireOverride, viewSensitive}`; new events
    `hr.employee.{actionApplied, transferred, exited, rehired}`; five notification templates; boot
    migration is idempotent (origin backfill, employment periods, personal copy, synthesized hire
    actions, frozen legacy status trail). Hiring-documents / employee-file applicant references are
    nullable for direct-registration employees.

- **HR — Recruitment workflow completion (follow-up to the workflow redesign).**
  - **Interview Phases (Kanban) view.** `/interviews` gains a **List ⇄ Phases toggle** (URL-persisted).
    The board's columns are _Waiting for Scheduling → each active interview stage → each active
    evaluation phase → Job Offer_, composed from the existing per-stage endpoints; cards show the
    Application Number only. Waiting + interview columns support **multi-selection** with **bulk
    actions**: _Schedule interviews_ for all selected at once (one stage + time; every row still goes
    through the normal endpoint so all workflow rules apply) and _Move to Job Offer_.
  - **Stage & phase management UIs.** New settings screens — `/interviews/stages`
    (`interviewStage.manage`) and `/evaluations/phases` (`evaluationPhase.manage`) — to add a 3rd/4th
    interview round or a new evaluation phase, rename, reorder (order number), toggle drivers-only,
    and enable/disable, all without touching the API directly.
  - **Explicit Job Offer stage (eligibility is never automatic).** Completing interviews/evaluations
    no longer qualifies an applicant for an offer. HR **explicitly moves** an applicant to the Job
    Offer stage — `POST /hr/applicants/:id/move-to-offer`, new **`applicant.moveToOffer`** permission,
    audited, `hr.applicant.movedToOffer` published — from ANY interview or evaluation stage ("Move to
    Job Offer" on the Interview and Evaluation detail screens + the board bulk action). Offer creation
    now requires the move (the interviews/evaluations hard-gate is replaced), and the **New Job Offer
    picker lists only moved applicants** (`movedToOffer` filter on the applicants list).
  - **Hiring documents: all SEVEN checklist documents are now seeded as REQUIRED** (completion blocks
    until every one is uploaded). On databases seeded before this change, flip the two previously
    optional types (bank letter, company ID card) via `PATCH /hr/hiring-document-types/:id` — the boot
    seed intentionally never overrides admin-edited flags.

- **HR — Recruitment workflow redesign (one coherent flow).** The Recruitment module now runs as a
  single end-to-end pipeline, backend + web:
  - **Evaluation phases (Security / Medical / Driving, extensible).** A post-interview, file-based
    approval stage. An **administrator-configurable** phase catalog (`hr_evaluation_phases`, seeded
    with **Security Check / Medical Examination / Driving Test**, the last flagged drivers-only) runs
    **sequentially** after the interview rounds — phases are added, disabled, or reordered with **no
    code changes**, exactly like interview stages. Per applicant × phase an **evaluation**
    (`hr_evaluations`) collects **one or more files** (platform Files service) and an
    **approved / rejected** decision with a reason. New endpoints under `/hr/evaluations`
    (+ `/hr/evaluation-phases`), gated by `evaluation.view` / `evaluation.manage` /
    `evaluationPhase.manage`; every mutation audited and `hr.evaluation.decided` published. A new web
    **Evaluations** module (queue + detail: open, upload files, decide) is wired into the navigation.
  - **Job Offer is hard-gated** until the applicant has cleared **all required interviews _and_ all
    required evaluation phases** (driver-only phases gate only when opened).
  - **Rejection is not final (fully audited).** HR can **edit the decision** of any stage — Screening
    (`PATCH /hr/screenings/:id/decision`), Interviews (`PATCH /hr/interviews/:id/decision`), and
    Evaluations — and a corrected rejection **reactivates the applicant** into the pipeline at the
    right stage (`applicantService.reactivateFromRejection`). Edit-decision actions added to the web
    Screening, Interview, and Evaluation screens.
  - **Job Offers: Direct Manager and Salary are optional.** `managerId` / `salary` are nullable and
    handled as NULL through the offer → employee → hiring-documents → employee-file chain; the web
    offer form and read-out treat them as optional.
  - **Employee Files hold independent COPIES of the hiring documents** (new `fileService.copy`) plus
    **custom uploads**; editing/removing a copy never touches the original. Surfaced on the web
    Employee File detail, gated by the new `employeeFile.upload` permission.
  - **Hiring-documents checklist** seeded to the approved **7-document** set (Employment Contract,
    Employment Acceptance Acknowledgment, Social Status Form, Relatives Declaration, Job Description,
    National Bank / Banque Misr Letter, Company ID Card).
- **Organization — reference-options endpoint.** `GET /platform/<unit>/options` returns minimal
  `{id, code, name}` for active units, authorized for any authenticated user and **decoupled from the
  unit's `view` permission** — so the **Branch dropdown on the Department / Section forms** is always
  populated (bug fix).
- **HR — Employees: employment lifecycle.** The post-hire workforce capability. An employee can now
  be moved through their lifecycle — **go on leave, return, suspend, reinstate, terminate** — via
  `PATCH /hr/employees/:id/status`, gated by the new **`employee.changeStatus`** permission and
  enforced against a single shared transition matrix (`terminated` is terminal; same-status and
  illegal jumps are refused). Suspend/terminate require a reason. Every change is appended to an
  auditable **status trail** (`statusHistory`, surfaced on the Employee DTO — the hire is recorded as
  its first entry), written under optimistic-concurrency control, audited, and published as
  `hr.employee.statusChanged`. Backend-first; UI is a later slice.
- **HR Foundation — Phase 2: Platform Identity & Organizational Access Control** (ADR-017). Permanent
  platform infrastructure every future module reuses:
  - **Hierarchical data scope.** The visibility ladder extends from `own | branch | organization` to
    **`own(Self) ⊂ section ⊂ department ⊂ branch ⊂ organization(Company)`**, enforced in the single
    existing place (`BaseRepository.scopeFilter`). Collections opt into finer scopes by declaring
    `departmentField`/`sectionField`; Users and Employees now scope by the full hierarchy. Role
    assignments, `AuthContext` and `ScopeSelector` carry department/section. Fully backward
    compatible — existing grants keep working; **no permission changes**.
  - **Login account ← Employee.** Every login belongs to exactly one Employee (`User.employeeId`,
    unique; `Employee.userId` back-reference). Create a login from the employee
    (`POST /hr/employees/:id/login`); the **username defaults to the Employee Code** and is editable;
    login now accepts **username OR email** (email retained). Departing employees are disabled, not
    deleted.
  - **Permanent Global Employee Number + branch-derived Employee Code.** The **Global Employee
    Number** (e.g. `000125`) is the permanent identity — a single **global**, concurrency-safe atomic
    sequence (reusing the existing `hr_sequences` `$inc` primitive), never reused, never changed. The
    displayed **Employee Code** is derived as **`<CurrentBranchCode><GlobalEmployeeNumber>`**
    (e.g. `001000125`); on a branch transfer only the prefix changes (`004000125`) while the number
    stays fixed. Never manually editable.
  - **Branch Code** stays required/unique/immutable, now correctable by a **super-admin**
    (`PATCH /platform/branches/:id/code`).
  - **Minimal UI** on the Employee detail (`EmployeeAccountCard`): shows Employee Code + Branch Code,
    creates the login, edits the username, shows the account's data scopes.
  - **Future-proof:** employment carries optional `sectionId` + `jobPositionId` (null until set), so
    an employee can later belong to Branch → Department → Section → Job Position with no schema change
    — without ever forcing a vacancy link (ADR-016 Talent Pool preserved).
- **Organization Management UI — Phase 3.1: Branches Management.** A dedicated Branches admin that
  completes the branch surface on top of the existing `platform/organization` backend:
  - **Branches list.** Columns per spec — **Branch Code, Arabic Name, English Name, Status, Created
    At, Updated At** — with free-text **search** (code or name), a **status** filter, **pagination**
    and sortable code/status/created columns, all URL-synchronized. Each row carries an inline
    **Activate/Deactivate** toggle (version-checked, gated on `branch.edit`).
  - **Branch detail.** Identity (Code, ar/en names, manager), address and audit timestamps, with
    **Edit**, **Activate/Deactivate** and **Delete** (soft, guarded against branches that still have
    departments). The **Branch Code** stays immutable after creation and is editable **only by a
    super-admin** through a dedicated correction dialog (`isPrivileged`, `PATCH
/platform/branches/:id/code`, ADR-017).
  - **Duplicate protection.** Branch **names** join branch **codes** as unique (case-insensitive, ar
    or en); a collision surfaces as a `409` conflict. `GET /platform/auth/me` now returns
    `isPrivileged` so the web can gate the super-admin-only Branch-Code action. No new backend
    endpoints, permissions or events; audit fields and soft-delete are unchanged.
- **Organization Management UI — Phase 3.2: Departments Management.** A dedicated Departments admin
  on the same `platform/organization` backend. Each department belongs to exactly one branch and is a
  **platform-wide** unit (not HR-only):
  - **Departments list.** Columns per spec — **Branch, Arabic Name, English Name, Status, Created At,
    Updated At** — with a **branch** filter (server-side `?branchId=`), free-text **search**, a
    **status** filter, **pagination** and sortable status/created columns, all URL-synchronized. Each
    row carries an inline **Activate/Deactivate** toggle (version-checked, gated on `department.edit`).
  - **Department detail + form.** Identity (Code, ar/en names, **Description**, manager), the owning
    Branch (linked), path and audit timestamps, with **Edit**, **Activate/Deactivate** and **Delete**
    (soft, guarded against departments that still have sections). The create/edit form gains an
    optional bilingual **Description** field.
  - **New `description` field.** Departments gain an optional bilingual `description` (contracts +
    model + DTO). The generic org-unit **update** now persists per-unit columns via a `buildUpdateSet`
    seam — which also **fixes branch `address`** being editable only at creation. No new endpoints,
    permissions or events; audit fields and soft-delete unchanged.

### Documented

- **ADR-017** — Platform Identity & Organizational Access Control.
- **`docs/02-architecture/platform-identity.md`** — the Phase-2 design.
- **`docs/02-architecture/organization-structure.md` §6** — _Organization vs Navigation: two
  independent hierarchies._ Records that the Company → Branch → Department → Section (→ Job Position/
  Employee) hierarchy governs **data scope, HR, reporting and approvals only** and **does NOT
  generate the sidebar**; that Departments are a **platform-wide** concept (never HR-only); and that
  the **Sidebar is generated from the Applications (Modules) assigned to the user** — a separate,
  deferred track keyed off _Applications × Roles_, with the org tree supplying data scope only. The
  Organization module stays free of any navigation logic (verified in the current code).
- **`docs/02-architecture/organization-structure.md` §7** — _Access & Applications model (locked; not
  implemented)._ Locks three forward rules so Organization Management does not foreclose them:
  **Applications ↔ Departments is many-to-many** (Departments consume Applications; an Application
  serves many Departments); a user's Applications are **derived** via **User → Job Position →
  Department → Applications → Roles** (with an optional direct user assignment kept possible as an
  exception); and **Job Positions are Department-owned, never Section-owned** (Sections are
  subdivisions; an Employee belongs to a Section but holds a Department's Job Position). Confirms the
  current models already leave room for all three — no code change.

## [0.23.0] - 2026-07-21

Release v0.23.0 — Sprint 5.11: **HR Foundation — Phase 1: Organization Structure**
([PR #54](https://github.com/egycashcompany-ops/egycash/pull/54)). Delivers the master
organizational model every future module reuses — **Company, Branches, Departments, Sections and the
Job Titles catalog** — built on the existing `platform/organization` backend (ADR-015). **Phase 1 is
complete and released.** Job Positions and Job Requisitions are **intentionally deferred** to later
phases; Job Titles remain an **organization-wide catalog**; and per **ADR-016** (now the governing
decision) applicants are **never required** to be linked to a Job Position or Job Requisition — the
**Talent Pool is first-class**.

### Added

- **HR Foundation — Phase 1: Organization Structure.** The master organizational model that every
  future module reuses, built on the existing `platform/organization` backend (ADR-015):
  - **Organization admin (web).** A new lazy module at `/organization` to manage the **Company**
    profile and the **Branch → Department → Section** hierarchy plus the org-wide **Job Titles**
    catalog — list/detail/create/edit/delete, all RBAC-gated, version-checked, with URL-synced
    filters, i18n + RTL. Branch/Department/Section share **one generic Unit\* implementation**
    configured per unit (mirroring the backend `makeOrgUnitHandlers` factory). No new backend
    endpoints, permissions or events were introduced.
  - **Enriched Job Titles.** Job Titles gain `jobGrade` (required), `description`, `salaryMin`,
    `salaryMax`, `requiredQualifications` and `requiredExperienceYears` (all optional). The salary
    band must satisfy `min ≤ max`, enforced by the schema and by a merged-state check on partial
    updates. Job Titles remain an **organization-wide catalog** — not tied to any Branch/Department/
    Section (that linkage is the future Job Positions' concern).

### Documented

- **ADR-016** — Job Positions & Job Requisitions are **OPTIONAL** for applicants; the **Talent Pool**
  is a first-class state that no future module may break.
- **`docs/02-architecture/organization-structure.md`** — the Phase-1 design and the phase roadmap
  (Organization Structure → Job Positions → Job Requisitions → Recruitment integration).

## [0.22.0] - 2026-07-21

Release v0.22.0 — Sprint 5.10: **HR / Recruitment — Pipeline flow & applicant lifecycle**
([PR #51](https://github.com/egycashcompany-ops/egycash/pull/51) +
[PR #52](https://github.com/egycashcompany-ops/egycash/pull/52)). Makes the finished seven-stage
module behave as a continuous pipeline **without changing the existing workflow, permissions or
create/decide flows** — visibility is derived from the applicant's current state, never from
placeholder records.

### Added

- **Auto-appearing stage queues (derived read models).** Applicants surface in the next stage
  automatically, computed server-side rather than via fabricated records:
  - **Awaiting screening** (`GET /hr/screenings/awaiting`) — live applicants (`new`) with no
    screening yet; a panel on the Screening queue opens the existing Start-screening dialog.
  - **Awaiting scheduling** (`GET /hr/interviews/awaiting`) — applicants who passed Initial
    Screening, still live, with no interview yet (active + accepted screening − already-interviewed,
    so withdrawn/rejected never appear); a panel on the Interviews queue opens the existing Schedule
    dialog. Both are read-only endpoints; no writes, no duplicate records.
- **Withdraw / restore from any stage.** A shared `ApplicantLifecycleActions` control (Withdraw
  while `new`, Restore while `withdrawn`) on the applicant detail **and** every pre-hire stage detail
  page (Screening, Interviews, Job Offer). Withdraw/restore invalidate the awaiting subtrees so the
  derived queues refresh immediately. (Intentionally not exposed on the post-hire stages — Employees,
  Hiring Documents, Electronic Employee File — the person is already an employee there.)
- **Applicant restore** (`POST /hr/applicants/:id/restore`, `applicant.edit`, version-checked → status
  `new`, emits `hr.applicant.restored`). Restored applicants **resume from the exact stage they left**
  (derived visibility), and **all history is preserved** — screening decisions, interviews, offers,
  audit and timeline records are never deleted or recreated.

### Changed

- **Optional interview committee** — `ScheduleInterview.interviewerIds` now defaults to `[]`; an
  interview can be scheduled before a committee is assigned, with members added later via the
  reassign-panel action. Validation, version checks and cache behaviour unchanged.

### Notes

- **No new runtime dependencies.** Backend additions are two read-only "awaiting" endpoints and the
  restore endpoint/event; no existing API, permission, versioning or event was changed. Verified via
  web typecheck, repo lint, vite build (recruitment stays a lazy chunk), permission-matrix +
  flag-expiry checks, and backend unit + integration specs (auto-appear queues incl. exclusions,
  empty-committee schedule, restore lifecycle, and exact-stage resume). No web unit-test runner yet
  (backlog: Vitest + React Testing Library).

## [0.21.0] - 2026-07-21

Release v0.21.0 — Sprint 5.9: **HR / Recruitment — Applicants intake improvements + reusable
National-ID OCR** ([PR #49](https://github.com/egycashcompany-ops/egycash/pull/49)). The first
**polish** sprint on the completed Recruitment module — no new stage, an enhancement to the
existing Applicants intake.

### Added

- **Reusable National-ID OCR flow (`apps/web/src/shared/national-id/`).** A module-agnostic
  capture → review flow, reusable by Employees / KYC / any future module by injecting an
  _extractor_ (no HR coupling): `NationalIdOcr` (two upload areas — **front + back** — read
  together in one extraction pass), a **dedicated `NationalIdReviewDialog`** showing **every**
  extracted field editable (birth date / gender / governorate derived live from the number and
  read-only), plus pure `mapping` + `transliterate` helpers and typed `NationalIdReviewData` /
  `NationalIdExtractor`. Generic `nationalIdOcr.*` i18n (`ar` + `en`).
- **Applicant identity: `religion` + `nationalIdExpiry`** — new nullable fields read from the ID
  card (contract + model + service + mapper).

### Changed

- **Applicants create — direct intake.** The Job Request is now **optional**: an applicant can be
  registered directly from the Applicants screen with no linked requisition. `jobRequisitionId` is
  **nullable end-to-end** (applicant → employee → employee-file all tolerate `null`); when a
  requisition is supplied it is still validated (malformed ids rejected), and the reference can be
  attached later when the Job Requests module lands.
- **National-ID capture flow.** Upload front → upload back → **Extract** → the dedicated review
  dialog → edit → **Confirm** → _only then_ the Applicant form is populated. Birth date / gender /
  governorate are **derived** from the number (`parseNationalId`), never OCR'd; the English name is
  seeded by transliterating the Arabic name (editable). Replaces the single-image OCR assist.

### Notes

- No new runtime dependencies and **no new backend endpoint** — the OCR extraction DTO was widened
  with the card fields and the applicant identity gained two fields. Verified via web typecheck,
  repo lint, and vite build (recruitment stays a lazy chunk); backend unit + integration specs
  extended (direct intake with no requisition; OCR extraction shape; null-requisition mappers). No
  web unit-test runner yet (backlog: Vitest + React Testing Library).

## [0.20.0] - 2026-07-13

Release v0.20.0 — Sprint 5.8: **HR / Recruitment — Electronic Employee File Frontend (Phase 8)**
([PR #47](https://github.com/egycashcompany-ops/egycash/pull/47)), the **seventh and final**
Recruitment feature screen set. **With this release all seven recruitment stages run in the UI on
the single Phase 1 foundation.**

### Added

- **HR / Recruitment: Electronic Employee File frontend (`apps/web`).**
  - **List** (`employeeFile.view`) — sortable `DataTable` (employee `code`, created — the backend's
    sortable fields); filters (a **free-text search** over employee number / applicant code +
    status); `Pagination`. Search, status, sort and pagination are **URL-synchronized**. An
    **Assemble file** action (`employeeFile.create`) opens a dialog to pick an employee whose hiring
    documents are complete (server-enforced; the employee search reuses the Employees list API).
  - **Detail** (`employeeFile.view`) — the **Employee Timeline** (shared `Timeline`) built from the
    recruitment milestones (`applicantRegistered` → … → `hiringDocumentsCompleted` → `fileOpened`)
    plus free-form notes, with an **add-note** form (`employeeFile.edit`, version-checked) appending
    to the timeline; and the **linked history** — deep-links into the applicant, screening,
    interview, job-offer and hiring-documents screens (the Job Requisition shows as a read-only
    reference). Each write seeds the detail cache + invalidates only the list subtree. `ar` + `en`
    i18n.
  - Removed the now-unused stage placeholder helper + `StagePlaceholder` (all seven stages are real
    screens).

### Changed

- **Recruitment frontend complete** — all seven stages (Applicants → Screening → Interviews → Job
  Offer → Employees → Hiring Documents → Electronic Employee File) run in the UI as one lazy route
  chunk. Post-hire employee-lifecycle concerns belong to the future Employee module.

### Notes

- No new runtime dependencies and **no new backend API**. Verified via web typecheck, repo lint, and
  vite build (recruitment stays a lazy chunk). No web unit-test runner yet (backlog: Vitest + React
  Testing Library) — the primary follow-up before declaring the module production-ready.

## [0.19.0] - 2026-07-13

Release v0.19.0 — Sprint 5.7: **HR / Recruitment — Hiring Documents Frontend (Phase 7)**
([PR #45](https://github.com/egycashcompany-ops/egycash/pull/45)), the sixth Recruitment feature
screen set on the Phase 1 foundation, reusing the shared file-management infrastructure
(`FileUpload`, the signed-URL download ticket, multipart `upload`). **Hiring Documents only** — the
Electronic Employee File remains the final phase.

### Added

- **HR / Recruitment: Hiring Documents frontend (`apps/web`).**
  - **List** (`hiringDocuments.view`) — sortable `DataTable` (employee `code`, created — the
    backend's sortable fields); filters (a **free-text search** over employee number / applicant
    code + status); `Pagination`. Search, status, sort and pagination are **URL-synchronized**. An
    **Open document set** action (`hiringDocuments.create`) opens a dialog to pick an employee
    (search reuses the Employees list API).
  - **Detail** (`hiringDocuments.view`) — a **per-type checklist** merging the active document-type
    catalog with the uploaded documents: each type shows uploaded/missing (required flagged), with
    **download** (signed-URL ticket, reused from Applicants attachments), **version history**,
    **replace**, and **upload** for missing types (`hiringDocuments.upload`, PDF-only via the shared
    `FileUpload` + multipart). **Complete** (`hiringDocuments.complete`) is blocked — with the
    missing-required banner — until every required document is present; once completed the set is
    read-only. All mutations version-checked; each write seeds the detail cache + invalidates only
    the list subtree. `ar` + `en` i18n.
  - The document-type catalog (`/hr/hiring-document-types`) is **consumed read-only** to label +
    require types; type administration is out of scope.

### Changed

- Recruitment now runs in the UI **through the Hiring Documents stage** (Applicants → Screening →
  Interviews → Job Offer → Employees → Hiring Documents); the Electronic Employee File is the final
  phase.

### Notes

- No new runtime dependencies and **no new backend API** — uploads/downloads reuse the existing
  Files service seams. Verified via web typecheck, repo lint, and vite build (recruitment stays a
  lazy chunk). No web unit-test runner yet (backlog: Vitest + React Testing Library).

## [0.18.0] - 2026-07-13

Release v0.18.0 — Sprint 5.6: **HR / Recruitment — Employees Frontend (Phase 6)**
([PR #43](https://github.com/egycashcompany-ops/egycash/pull/43)), the fifth Recruitment feature
screen set on the Phase 1 foundation, reusing the prior phases' building blocks (including the Job
Offer reference infrastructure). **Employees only** — no later stage.

### Added

- **HR / Recruitment: Employees frontend (`apps/web`).**
  - **List** (`employee.view`) — sortable `DataTable` (employee `code`, hired, created — the
    backend's sortable fields); `EmployeeFilters` (a **free-text search** over employee number /
    applicant code + status); `Pagination`. Search, status, sort and pagination are
    **URL-synchronized** (deep-linkable, back/forward). A **Hire employee** entry (`employee.create`).
  - **Hire / create** — the employment terms are **not** entered; they are copied server-side from
    the offer's immutable accepted snapshot. The page picks an **accepted offer** (an `OfferPicker`
    autocomplete reusing the Job Offer list API scoped to `status: accepted`) + an optional hiring
    date. The server enforces the full rule (accepted + snapshot + not already hired). The create
    write seeds the detail cache and invalidates only the list subtree.
  - **Detail** (`employee.view`) — the employee number, status, preserved references (applicant link
    - accepted-offer link with its revision), and the copied **employment terms** read-out. The
      employment view **reuses the Job Offer `UserName` + reference hooks** so org/manager names resolve
      from the same cache. `ar` + `en` i18n. The employee record is **read-only in this stage** — no
      lifecycle mutation is exposed (statuses exist in the DTO but transitions belong to a future
      Employee module).

### Changed

- Recruitment now runs in the UI **through the Employee stage** (Applicants → Screening → Interviews
  → Job Offer → Employees); Hiring Documents and Employee Files remain later phases.

### Notes

- No new runtime dependencies and **no new backend API**. Verified via web typecheck, repo lint, and
  vite build (recruitment stays a lazy chunk). No web unit-test runner yet (backlog: Vitest + React
  Testing Library).

## [0.17.0] - 2026-07-13

Release v0.17.0 — Sprint 5.5: **HR / Recruitment — Job Offer Frontend (Phase 5)**
([PR #41](https://github.com/egycashcompany-ops/egycash/pull/41)), the fourth Recruitment feature
screen set on the Phase 1 foundation, reusing the Applicants/Screening/Interviews building blocks.
**Job Offer only** — no later stage.

### Added

- **HR / Recruitment: Job Offer frontend (`apps/web`).**
  - **List** (`jobOffer.view`) — sortable `DataTable` (status, created — the backend's sortable
    fields); `OfferFilters` (a **free-text search** over offer number / applicant code + status + an
    active-only toggle); `Pagination`. Search, status, active, sort and pagination are
    **URL-synchronized** (deep-linkable, back/forward). A **New offer** entry (`jobOffer.create`).
  - **Create / revise** — the shared `OfferTermsForm` builds the versioned package (job title,
    department, branch, reporting manager, employment type, salary + currency, dynamic
    allowances/benefits, probation, start/validity dates, notes). Create picks an applicant first;
    revise edits a draft/sent offer's terms (`jobOffer.edit`, version-checked, history preserved).
    Client checks cover the required fields + `validUntil > startDate`; the server stays authoritative.
  - **Detail** (`jobOffer.view`) — the offer number, applicant link, status, the live package, the
    immutable **accepted-terms snapshot** and the **revision history**, plus the lifecycle actions:
    **send** (`jobOffer.send`), **accept / reject** (`jobOffer.respond`, reason required to reject),
    **withdraw** (`jobOffer.withdraw`), **revise** (`jobOffer.edit`) — each shown only in the states
    where it applies (draft·sent). All mutations version-checked; each write seeds the detail cache
    and invalidates only the list subtree; `STALE_DOCUMENT` surfaces via the standard global toast.
  - **References** reuse existing platform endpoints (**no new backend API**): the reporting manager
    via a `ManagerPicker` over `/platform/users` (`user.view`); job title / department / branch via
    the org list endpoints (`jobTitle.view` / `department.view` / `branch.view`). Raw ids are never
    entered; controls degrade to a hint without the relevant `*.view`. `ar` + `en` i18n.

### Changed

- Recruitment now runs in the UI **through the Job Offer stage** (Applicants → Screening →
  Interviews → Job Offer); Employees onward remain later phases.

### Notes

- No new runtime dependencies. Verified via web typecheck, repo lint, and vite build (recruitment
  stays a lazy chunk). Automatic offer expiry remains a backend scheduled sweep — the UI reflects the
  resulting `expired` status but does not drive it. No web unit-test runner yet (backlog: Vitest +
  React Testing Library).

## [0.16.0] - 2026-07-13

Release v0.16.0 — Sprint 5.4: **HR / Recruitment — Interviews Frontend (Phase 4)**
([PR #37](https://github.com/egycashcompany-ops/egycash/pull/37)), the third Recruitment feature
screen set on the Phase 1 foundation, reusing the Applicants/Screening building blocks — plus two
authentication **dev-login fixes** surfaced during review
([PR #38](https://github.com/egycashcompany-ops/egycash/pull/38),
[PR #39](https://github.com/egycashcompany-ops/egycash/pull/39)). **Interviews only** — no later
stage.

### Added

- **HR / Recruitment: Interviews frontend (`apps/web`).**
  - **Queue** (`interview.view`) — sortable `DataTable` (stage order, scheduled, created — the
    backend's sortable fields); filters (status + outcome + stage + an **applicant search-picker**
    resolving to `applicantId` + a scheduled-date range); pagination. Filters/sort/pagination are
    **URL-synchronized** (deep-linkable, back/forward). A **Schedule interview** action
    (`interview.create`) opens a dialog to pick applicant, stage, date/time, and panel.
  - **Detail** (`interview.view`) — the **panel with per-interviewer evaluation state**
    (recommend/neutral/notRecommend + rating + notes), the scheduling read-out, and the full action
    surface: **reschedule** + **reassign panel** (`interview.edit`), **skip** a pending interviewer,
    **submit/update your own evaluation** (`interview.evaluate`, assigned members only), **cancel**
    (`interview.cancel`), and **Pass / Fail** (`interview.decide`) — blocked with an inline notice
    while any panelist is still `pending`. All mutations version-checked; each write seeds the
    detail cache from the response and invalidates only the list subtree.
  - Interviewer references go through a **`UserPicker` / `UserName`** pair that reuses the platform
    Users endpoint (`user.view`) rather than exposing raw ids; degrades to a short reference without
    directory access. Feature `api/` layer + TanStack Query hooks against `/hr/interviews`
    (+ `/hr/interview-stages`, `/:id/reschedule|panel|panel/skip|cancel|evaluations|decide`);
    `ar` + `en` i18n. No new backend API.
- **Auth: scannable QR for TOTP enrollment**
  ([PR #38](https://github.com/egycashcompany-ops/egycash/pull/38)) — the mid-login 2FA enrollment
  step renders the backend-provided `otpauthUrl` as a QR code (Microsoft Authenticator / Google
  Authenticator / any TOTP app), with the manual base32 key kept as a collapsible fallback. Adds
  `qrcode.react` (inline SVG, no network request). Standard TOTP (RFC 6238); no backend change.

### Fixed

- **Dev login blocked by TOTP enforcement**
  ([PR #39](https://github.com/egycashcompany-ops/egycash/pull/39)) — every seeded account holds a
  system role (privileged), and `auth.totp.enforcedForPrivileged` defaults to `true`, so a fresh
  `npm run seed` produced accounts that could not complete an email/password login (login returned a
  TOTP enrollment challenge, not a session). The seed now disables enforcement at **organization**
  scope (dev/staging only; production keeps the default `true` and never runs the seed). The seed
  data moved to an importable, side-effect-free `seed-data.ts`, and an **integration regression
  test** exercises the real seed path and asserts a password-only login yields a token + working
  `/me` — failing if the enforcement-disable is ever removed.

### Changed

- Recruitment now runs in the UI **through the Interview stage** (Applicants → Screening →
  Interviews); Job Offer onward remain later phases.

### Notes

- One new web runtime dependency (`qrcode.react`). Verified via web typecheck, repo lint, and vite
  build (recruitment stays a lazy chunk), plus API typecheck/lint/build; the seed-login regression
  runs on CI's in-memory Mongo. No web unit-test runner yet (backlog: Vitest + React Testing
  Library).

## [0.15.0] - 2026-07-12

Release v0.15.0 — Sprint 5.3: **HR / Recruitment — Initial Screening Frontend (Phase 3)**
([PR #35](https://github.com/egycashcompany-ops/egycash/pull/35)), the second Recruitment feature
screen set, built on the Phase 1 foundation and reusing the Applicants building blocks.
**Screening only** — no later stage.

### Added

- **HR / Recruitment: Initial Screening frontend (`apps/web`).**
  - **Queue** (`screening.view`) — sortable `DataTable` (status, notes, decided, created); filters
    (status + created-date range + an **applicant search-picker** that reuses the Applicants list
    API and resolves to the `applicantId` filter — the screening list has no free-text field);
    pagination. Filters/sort/pagination are **URL-synchronized** (deep-linkable, back/forward). A
    **Start screening** action (`screening.create`) opens a dialog to pick a live applicant + an
    optional first note.
  - **Detail** (`screening.view`) — applicant link, the **notes + decision timeline** (shared
    `Timeline`), an **add-note** form while `pending` (`screening.edit`), and the **Accept / Reject**
    workflow (`screening.decide`) via a dialog — a reason is required to reject (OQ-32), optional to
    accept. All mutations version-checked.
  - Feature `api/` layer + TanStack Query hooks against `/hr/screenings` (+ `/:id/notes`,
    `/:id/decide`); `ar` + `en` i18n; permission-gated throughout.

### Notes

- No new runtime dependencies. Verified via web typecheck, repo lint, and vite build (recruitment
  stays a lazy chunk). No web unit-test runner yet (backlog: Vitest + React Testing Library).

## [0.14.0] - 2026-07-12

Release v0.14.0 — Sprint 5.2: **HR / Recruitment — Applicants Frontend (Phase 2)**
([PR #33](https://github.com/egycashcompany-ops/egycash/pull/33)), the first Recruitment feature
screen set, built on the Phase 1 foundation. **Applicants only** — no later stage. Approved with
no blocking comments after two review changes (URL-synced list state; placeholder reference
controls for cross-module IDs) folded in before merge.

### Added

- **HR / Recruitment: Applicants frontend (`apps/web`).**
  - **List** — sortable/selectable `DataTable`; multi-filter bar (search + status / source /
    intake channel / identity-verification / duplicates-only / has-files); `Pagination`;
    **bulk withdraw** (reason dialog); **CSV export**; create entry point — all permission-gated.
    Filters, search, sort and pagination are **synchronized with the URL query string**
    (deep-linkable, back/forward aware).
  - **Detail** — identity/contact/preferences/application read-out; **attachments** panel
    (upload with title+category, signed-URL download, remove); **verify-identity** and
    **withdraw** actions (version-checked).
  - **Create / edit** — comprehensive manual-entry form (context, identity, contact, addresses,
    preferences, education, military, experience, references, licenses, certifications) on the
    shared form primitives; server-authoritative validation surfaced in a summary;
    optimistic-concurrency-guarded edits.
  - **OCR assist** — upload a National-ID image → extraction seam → apply fields with confidence
    bands; degrades to manual entry when no provider is wired (OQ-30).
  - **Cross-module references** (Job Requisition, Branch) use placeholder reference controls
    (disabled "coming soon" selector, or a read-only chip when supplied by context via
    `?requisitionId=&branchId=`) — internal IDs are never editable fields.
  - Feature `api/` layer + TanStack Query hooks against the existing endpoints; `ar` + `en` i18n.
    Added `getPage` (pagination meta) and `downloadBlob` (CSV export) to the shared api-client.

### Notes

- No new runtime dependencies. Verified via web typecheck, repo lint, and vite build (recruitment
  stays a lazy chunk). No web unit-test runner yet (backlog: Vitest + React Testing Library).

## [0.13.0] - 2026-07-12

Release v0.13.0 — Sprint 5.1: **HR / Recruitment — Frontend Foundation (Phase 1)**
([PR #31](https://github.com/egycashcompany-ops/egycash/pull/31)). The reusable web foundation for
the Recruitment module — shell, shared UI kit, and platform integration — built foundation-first;
**no feature screen (Applicants included) is built here.** Approved with two backlog notes (add
Vitest + React Testing Library before the feature screens grow; revisit shadcn/ui later — the
current abstraction layer is acceptable).

### Added

- **HR / Recruitment: frontend foundation (`apps/web`).**
  - **App shell & layout** — generic `AppShell` (sidebar + topbar), RTL-safe and responsive
    (persistent rail on desktop, off-canvas drawer on mobile), breadcrumbs, page container/header.
  - **Theme** — light/dark/system (Tailwind class strategy, OS-reactive, persisted); brand token
    scale; **Arabic RTL** default with logical utilities throughout.
  - **Navigation & permission-aware routing** — `RequireAuth` + `RequirePermission` route guards,
    `Can`/`useCan` role-based UI, 403/404 pages, and the recruitment module **lazy-loaded**
    (route-based code splitting).
  - **Shared UI kit** (`shared/ui`, imported via barrel) — DataTable (sort/selection/state-aware),
    Pagination, SearchInput (debounced), FilterBar, BulkActions, Button, Field/Input/Textarea/
    Select/Checkbox/Form, Dialog, FileUpload, Badge/StatusBadge, Timeline, Card, Spinner/Skeleton,
    and Loading/Empty/Error/Success states.
  - **API layer & data** — typed REST + multipart client (in-memory token per ADR-006, silent
    refresh, envelope unwrap), error-code → localized message mapping, query-key factory, and
    **TanStack Query with global error handling**; client toast store + `Toaster`;
    `NotificationBell`; top-level `ErrorBoundary`.
  - **Recruitment module shell** — nav, permission-aware landing overview, and per-stage
    permission-gated placeholder routes for all seven stages (each real screen drops in by
    replacing one element).
  - **i18n** — `ar` + `en` catalog with `{{param}}` interpolation. Docs:
    [recruitment-frontend.md](docs/02-architecture/recruitment-frontend.md).

### Notes

- No new runtime dependencies; the existing React + Vite + RTK + TanStack Query + Tailwind stack
  was extended in place. Verified via web typecheck, repo lint, and vite production build (the
  recruitment module emits as a separate lazy chunk). No web unit-test runner yet (backlog:
  Vitest + React Testing Library).

## [0.12.0] - 2026-07-12

Release v0.12.0 — Sprint 4.7: **HR / Recruitment — Electronic Employee File (Stage 7)**
([PR #29](https://github.com/egycashcompany-ops/egycash/pull/29)), the **seventh and final stage**
of the approved seven-stage recruitment workflow and the handoff artifact to the (future) Employee
module ([BD-008](docs/01-domain/business-decisions.md#bd-008--hiring-transforms-applicant-to-employee-no-separate-onboarding-stage)).
Additive on Stage 6; **no part of the Employee module is built.** Merged after a self-conducted
architecture review ([review](docs/10-reviews/2026-07-architecture-review-employee-file.md); 18
findings, no Critical/High — all documented, no in-PR code change required).

### Added

- **HR / Recruitment: Electronic Employee File (Stage 7).** Once an employee's hiring documents
  are **completed**, their electronic file is **assembled once**.
  - **Electronic Employee File aggregate** (`hr_employee_files`) — **one file per employee**
    (partial-unique index), gated on the employee existing **and** its hiring documents being
    `completed`. **Links all applicant history** (applicant, job requisition, screening,
    interviews, job offer, hiring documents) and builds the **initial Employee Timeline** from the
    recruitment milestones (applicant registered → screening accepted → each interview passed →
    offer accepted → employee created → hiring documents completed → file opened), ordered
    chronologically.
  - **Timeline notes** — free-form notes can be appended to the timeline (optimistic-concurrency
    guarded). Status `active` / `archived`.
  - Publishes `hr.employeeFile.{created,noteAdded}`, **notifies** the reporting manager + the
    assembler on assembly, and **audits** every operation. Permissions
    `employeeFile.{view,create,edit}`; routes `/api/v1/hr/employee-files` (+ `/:id`, `/:id/notes`).
  - Cross-feature history is read through feature barrels only (ADR-003); new read hooks
    `interviewService.listByApplicant` and `hiringDocumentsService.findByEmployeeId`.
- **BD-008 — Hiring transforms Applicant to Employee; no separate Onboarding stage.** Recorded in
  the [Business Decisions log](docs/01-domain/business-decisions.md#bd-008--hiring-transforms-applicant-to-employee-no-separate-onboarding-stage):
  the recruitment workflow stands at **seven stages** (no eighth "Onboarding" stage), and the
  post-hire employee lifecycle belongs to the future Employee module. Added the _Electronic
  Employee File_ entry to the [Ubiquitous Language](docs/01-domain/ubiquitous-language.md).

### Notes

- The seven-stage recruitment workflow (Applicant → Screening → Interview → Offer → Employee
  Creation → Hiring Documents → Electronic Employee File) is now **complete**. The post-hire
  employee lifecycle (documents, assets, contracts, attendance, payroll, leave) is the future
  Employee module's remit (BD-008) and is not started.

## [0.11.0] - 2026-07-12

Release v0.11.0 — Sprint 4.6: **HR / Recruitment — Hiring Documents (Stage 6)**
([PR #27](https://github.com/egycashcompany-ops/egycash/pull/27)), the sixth stage of the
approved seven-stage recruitment workflow. Additive on Stage 5; **no part of Stage 7
(Electronic File) or later is built.** Merged after a self-conducted architecture review
([review](docs/10-reviews/2026-07-architecture-review-hiring-documents.md); no Critical/High
findings — one small mitigation applied in-PR, the rest logged for later sprints).

### Added

- **HR / Recruitment: Hiring Documents (Stage 6).** After an employee is created, their hiring
  documents are collected.
  - **Administrator-defined document types** (`hr_hiring_document_types`) — required and
    optional; a default set is seeded, admin-managed under `hiringDocumentType.manage`.
  - **Hiring Documents aggregate** (`hr_hiring_documents`) — **one set per employee**. Each
    document is an uploaded **PDF** backed by the platform Files service: the **original is
    preserved** and **replacement creates a new version while keeping prior versions
    retrievable**. Stores document metadata (type, name, uploader, upload date, version).
  - **Required-completion validation** — completion is blocked while any active required type is
    missing (`missingRequired` is surfaced on the DTO). Once **completed**, the set is
    **immutable except through the versioning (replace) workflow**; documents are never
    overwritten or deleted.
  - PDF-only enforced by a dedicated Files category. Publishes
    `hr.hiringDocuments.{created,documentUploaded,documentReplaced,completed}`, **notifies** the
    reporting manager + creator on completion, and **audits** every operation. Permissions
    `hiringDocuments.{view,create,upload,complete}` + `hiringDocumentType.manage`; routes
    `/api/v1/hr/hiring-documents` and `/hr/hiring-document-types`.

### Fixed

- **Hiring-document upload/replace could orphan a file version on a lost optimistic-concurrency
  race** (review finding HD-01): the service now rejects a stale `version` before writing bytes
  to the Files service, so only an up-to-date request performs the upload (the atomic version
  check in the repository still guards the commit).

## [0.10.0] - 2026-07-12

Release v0.10.0 — Sprint 4.5: **HR / Recruitment — Employee Creation (Stage 5)**
([PR #25](https://github.com/egycashcompany-ops/egycash/pull/25)), the fifth stage of the
approved seven-stage recruitment workflow. Additive on Stage 4; **no part of Stage 6 (Hiring
Documents) or later is built.**

### Added

- **HR / Recruitment: Employee Creation (Stage 5).** A `hr_employees` aggregate: an applicant
  whose Job Offer was **Accepted** becomes an Employee.
  - **Accepted-offer gate** — creation is allowed only from an offer whose status is
    `accepted`; the employment terms are read **exclusively from the offer's immutable
    Accepted Snapshot** (never the live, mutable offer).
  - **Unique employee number** `EMP-{YYYY}-{seq:6}` (organization-wide, atomic per-year counter
    in the shared `hr_sequences` collection + unique index).
  - **Atomic creation** — the number allocation and the record insert run in one transaction
    (`unitOfWork`); a **unique index on `jobOfferId`** prevents a duplicate employee from the
    same offer even under concurrency (with a fast-path service check).
  - **Preserved references** to the Applicant, the Job Requisition (carried by the applicant),
    and the Accepted Job Offer; **copies the approved employment terms** (job title,
    department, branch, manager, employment type, salary, allowances, benefits, probation,
    start date) plus the accepted offer revision number; sets the initial status **`active`**
    and records the **hiring date** (defaults to now).
  - **Publishes** `hr.employee.created`, **notifies** the reporting manager + the creator, and
    **audits** every operation. Permissions `employee.{view,create}`; route
    `/api/v1/hr/employees`; the employee number is searchable in the list endpoint.

## [0.9.0] - 2026-07-12

Release v0.9.0 — Sprint 4.4: **HR / Recruitment — Job Offer (Stage 4)**
([PR #23](https://github.com/egycashcompany-ops/egycash/pull/23)), the fourth stage of the
approved seven-stage recruitment workflow. Additive on Stage 3; **no part of Stage 5
(Employee Creation) or later is built.**

### Added

- **HR / Recruitment: Job Offer (Stage 4).** A `hr_job_offers` aggregate: an applicant who
  cleared every interview round receives a versioned compensation offer.
  - **Lifecycle** `draft → sent → accepted / rejected / expired / withdrawn`. The offer
    carries a full package — salary (`Money`), allowances, benefits, job title, department,
    branch, reporting manager, employment type, probation period, start date, offer validity,
    and notes. **Version history**: every revise snapshots the prior package into `revisions`.
  - **Immutable, human-readable offer number** `JO-{YYYY}-{seq:6}` (organization-wide, atomic
    per-year counter in the shared `hr_sequences` collection + unique index) — HR references
    offers by this number, not the ObjectId; the list endpoint is searchable over it.
  - **Immutable accepted-revision snapshot**: acceptance freezes the exact terms and their
    revision number into `acceptedSnapshot`, never mutated afterward — the record Employee
    Creation (Stage 5) will consume, decoupled from the live offer.
  - **Guards**: creation requires all interview stages cleared; **at most one active
    (draft/sent) offer per applicant** (partial unique index + service check); an applicant
    who already accepted an offer cannot be issued another; sending requires a future
    validity; a lapsed sent offer cannot be accepted. The **accepted-offer gate**
    (`acceptedOfferFor`) is exposed so Stage 5 can require the latest offer be Accepted.
  - **Automatic expiration**: a scheduled sweep (`hr.jobOffers.expire`, every 15 min) flips
    sent offers past their validity to `expired` (audited, emitted, notified).
  - **Notifications** for offer sent / accepted / rejected / expired (fire-and-forget, to the
    hiring manager + the offer's author); **full audit trail** on every transition.
  - Permissions `jobOffer.{view,create,edit,send,respond,withdraw}` (`send`/`respond`/
    `withdraw` each their own grant); route `/api/v1/hr/job-offers`; events
    `hr.jobOffer.{created,revised,sent,accepted,rejected,expired,withdrawn}`.
  - **Additive platform seam**: `ModuleManifest.scheduledTasks` — a module can now declare
    repeatable tasks (declared before the scheduler sync, validated to carry the module-id
    prefix), the analogue of the existing `seed`/`eventSubscriptions` seams.

## [0.8.0] - 2026-07-11

Release v0.8.0 — Sprint 4.3: **HR / Recruitment — Interviews (Stage 3)**
([PR #21](https://github.com/egycashcompany-ops/egycash/pull/21)), the third stage of the
approved seven-stage recruitment workflow. Additive on Stage 2; **no part of Stage 4 (Job
Offer) or later is built.**

### Added

- **HR / Recruitment: Interviews (Stage 3).** An applicant who passed Initial Screening
  advances through the interview rounds.
  - **Administrator-configurable interview stages** (`hr_interview_stages`, OQ-31): an
    ordered, localized, deactivatable catalog seeded with the two default rounds ("First
    Interview", "Second Interview") — number/names/order are admin-managed thereafter
    (`interviewStage.manage`).
  - **Interview aggregate** (`hr_interviews`): a scheduled round with a **panel** where each
    member carries an individual evaluation state — **`pending` / `submitted` / `skipped`**
    (the roster and per-interviewer evaluations are one unified structure). Lifecycle:
    **schedule** → **reschedule** (date/time only) · **reassign panel** (independent of the
    schedule — retained members keep their state, added members start pending and are
    notified, removed members drop off) · **cancel** · per-interviewer **evaluate** ·
    **decide**.
  - **Workflow gate & progression** (approved workflow): the earliest stage requires a passed
    screening, each later stage requires the previous stage passed, and one live interview per
    stage. A decision is **blocked until every panel member is `submitted` or `skipped`**
    (prevents premature decisions without deadlocking on a no-show). Passing the final
    configured stage clears the interview phase (the applicant is ready for a future Job
    Offer); failing any round transitions the applicant to the terminal `rejected` status.
  - **Notifications integration**: scheduling, rescheduling, and cancelling notify the panel
    through the platform Notifications service (fire-and-forget — never blocks the operation);
    the HR seed registers the three interview templates at boot.
  - Permissions `interview.{view,create,edit,cancel,evaluate,decide}` (`evaluate` and `decide`
    each their own grant) + `interviewStage.manage`; routes under `/api/v1/hr/interviews` and
    `/hr/interview-stages`; events `hr.interview.{scheduled,rescheduled,cancelled,evaluated,decided}`.
    The applicant terminal-rejection event (`hr.applicant.rejected`) was made source-agnostic
    (screening or interview). **Additive platform seam**: `notificationTemplateService` is now
    exposed on the `platform/notifications` barrel so a business module can register its own
    templates at boot (the same idempotent seam the platform's built-ins use).

## [0.7.0] - 2026-07-11

Release v0.7.0 — Sprint 4.2: **HR / Recruitment — Initial Screening (Stage 2)**
([PR #20](https://github.com/egycashcompany-ops/egycash/pull/20)), the second stage of the
approved seven-stage recruitment workflow. Additive on Stage 1; **no part of Stage 3 or later
is built in this release.**

### Added

- **HR / Recruitment: Initial Screening (Stage 2).** A `hr_screenings` aggregate, **one
  screening per applicant** (partial unique index), decided to a single terminal outcome —
  **Accepted or Rejected** (OQ-32, two outcomes only). "Needs more information" is **not a
  state**: it is a note appended to a screening that stays `pending`; screening notes and the
  mandatory rejection reason are stored. A **rejection** transitions the applicant to the
  terminal `rejected` status (which frees the live National-ID for a fresh application,
  exactly like a withdrawal); an **acceptance** leaves the applicant live for the interview
  stage. Permissions `screening.{view,create,edit,decide}` (`decide` — the terminal
  accept/reject — is a separate grant from `edit`, which only appends notes); route
  `/api/v1/hr/screenings`; events `hr.screening.{created,decided}`. Extends the applicant
  lifecycle with the terminal `rejected` status and the `hr.applicant.rejected` event.

## [0.6.0] - 2026-07-10

Release v0.6.0 — Sprint 4.1: **HR / Recruitment — Applicants (Stage 1)**, the platform's
first Layer 2 business module
([PR #18](https://github.com/egycashcompany-ops/egycash/pull/18); plan:
`docs/12-planning/sprint-4.1-plan.md` (frozen 2026-07-10); reference:
`docs/02-architecture/recruitment-applicants.md`; retrospective:
`docs/11-retrospectives/2026-07-sprint-4.1.md`). Planning went through business analysis
([PR #17](https://github.com/egycashcompany-ops/egycash/pull/17)) with the approved
baseline workflow and eight resolved decisions (OQ-7/8/9/10/29/30/31/32).

### Added

- **Sprint 4.1 implementation** — HR / Recruitment: **Applicants (Stage 1)**, the
  platform's **first Layer 2 business module** (reference:
  `docs/02-architecture/recruitment-applicants.md`; plan frozen 2026-07-10 with
  OQ-7/8/9/10/29/30/31/32 resolved). Backend-first (OQ-29): full contracts + APIs +
  services + persistence; the frontend is a later sprint. The `hr` module manifest
  registers under `/api/v1/hr` (routes `applicants`, `applicant-sources`), owns
  `hr_applicants` / `hr_applicant_sources` / `hr_sequences`, declares its own permissions
  (`applicant.{view,create,edit,delete,export}`, `applicant.verifyIdentity`,
  `applicantSource.manage`), and seeds the 10 applicant sources at boot. Capabilities: a
  requisition-driven intake pipeline (BD-001 — mandatory immutable requisition reference
  behind a Stage-0 validator seam), manual / National-ID-derived / ID-less registration,
  deterministic Egyptian National-ID parsing (birth date, gender, governorate — real) with
  live-uniqueness enforcement and masked-by-default DTOs, an OCR extraction **seam** (null
  stub, OQ-30), organization-wide atomic applicant numbering `APP-{YYYY}-{seq:6}` (BD-002),
  heuristic duplicate flagging (never blocks), human identity verification, withdrawal,
  Arabic-normalized search, a filterable/sortable/paginated list, an audited PII-masked CSV
  export, a generic per-row-audited bulk executor, and attachments delegated to the platform
  Files service (title/category/notes, transactional count). Emits
  `hr.applicant.{created,updated,identityVerified,withdrawn}`. **Additive platform seams for
  the first module**: a `platform/web` barrel re-exporting HTTP helpers so modules build
  routers within the layer boundary, and wiring of `manifest.seed` into the boot sequence.
  Public/mobile intake, external-platform adapters, real OCR, and the Stage-0 requisition
  service are **integration seams only** (their governing OQs remain open); **no part of
  Stage 2 (Screening) or later is built.**
- **Sprint 4.1 planning document** (`docs/12-planning/sprint-4.1-plan.md`): HR /
  Recruitment — Applicants (Release v0.6, first business module; docs only, no
  implementation). Business analysis of the full seven-stage recruitment lifecycle
  with an in-depth Stage 1 (Applicants) treatment: registration paths (manual,
  Egyptian National-ID OCR with confidence bands/cross-checks/failure and missing-ID
  workflows, ID-less registration), attachment rules (title + category + notes),
  admin-extensible source catalog with structured referral/agency detail, public
  web/mobile intake as a new trust boundary (pending-submission review model),
  integration domain boundaries (adapters translate, the intake pipeline decides),
  a complete business classification of applicant data (10 groups with stage gates
  and sensitivity levels), a four-population documents-ownership/lifecycle model
  (temporary → applicant → sealed hiring snapshot → employee file, reference-don't-
  copy), and grid/filter/bulk/export requirements with safety rules. Anchored to the
  **EGYCASH-approved baseline workflow (2026-07-10)**: screening → interviews →
  offer (Rejected/Expired/Accepted) → hiring documents → employee created →
  electronic file. **Four business decisions were approved 2026-07-10, resolving
  OQ-7/8/31/32**: recruitment stays requisition-driven (BD-001 unchanged) with the
  Job Requisition documented as a separately-planned **Stage 0** prerequisite that
  every applicant references; hiring documents precede employee creation; interview
  stages are **administrator-configurable** (two rounds is the default, not a limit);
  and screening has **Accepted/Rejected outcomes only** (missing information keeps the
  applicant in Screening, no separate state). Records **Open Questions OQ-7…OQ-32**
  (4 resolved, 20 open) — the remaining blockers being the minimal-Employee shape, the
  frontend scope, and unbuilt-dependency sequencing (sequences service, approvals, OCR,
  external-recipient notifications, frontend grid foundation) — **none assumed, all
  awaiting business resolution before planning freezes**. The blocking set was
  subsequently resolved 2026-07-10 (OQ-29 backend-first, OQ-30 abstractions,
  OQ-9/10 non-blocking) and the plan **frozen** for Stage-1 implementation.

### Backlog (recorded at review — non-blocking, for future sprints)

1. Dedicated concurrency/stress test for the atomic applicant-number allocation
   (no-gap/no-collision under parallel registration).
2. Deeper documentation of the duplicate-detection heuristic (probe fields,
   normalization, flag-resolution workflow) in the architecture reference.
3. Search optimization for contains-style Arabic queries (text index / n-gram) if
   applicant volume outgrows the current regex-over-`searchName` approach.
4. Extend `gen-permission-matrix.mjs` to include module-manifest permissions alongside
   the platform catalog.

## [0.5.0] - 2026-07-09

Release v0.5.0 — Sprint 3.3: **Notifications Service**
([PR #15](https://github.com/egycashcompany-ops/egycash/pull/15); plan:
`docs/12-planning/sprint-3.3-plan.md`; reference:
`docs/02-architecture/notifications-service.md`). Planning went through two amendment
rounds ([PR #12](https://github.com/egycashcompany-ops/egycash/pull/12)/
[#13](https://github.com/egycashcompany-ops/egycash/pull/13)/
[#14](https://github.com/egycashcompany-ops/egycash/pull/14)) before being frozen —
see those PRs for the full design-decision history.

### Added

- **`notificationsService.notify()`** — the one platform-wide, in-process entry point
  (never an HTTP endpoint): synchronous, bilingual, entity-referenced in-app inbox
  creation (the delivery guarantee) plus asynchronous, queued delivery on every other
  enabled channel through a small channel-adapter registry (`inApp`/`email` built;
  SMS/push/WhatsApp interface-ready). Delivery failure on any channel never throws back
  to the caller.
- **In-app inbox** (self-scoped, no permission required): list, live unread count, mark
  one/all read (first-read-wins), archive.
- **Email delivery**: self-managed 5-attempt exponential-backoff retry; every
  delivery-status transition audited; final failure raises the reliable
  `platform.notification.deliveryFailed` event.
- **Versioned notification templates** (`notificationTemplate` CRUD, preview,
  test-send — permission-gated and audited): every edit, including deactivation,
  creates a new version; nothing is ever mutated in place.
- **Preferences**: category-level opt-in/out with a settings-driven default
  (`notifications.email.enabled`); quiet hours (server/UTC, `critical` priority
  bypasses).
- **Idempotency** (caller-supplied key + delivery-job status guard), `sendAt`
  scheduling, `expiresAt` expiration, and file-reference attachments (no binary
  handling this sprint, by design).
- **Socket.IO live push** (`notification:new`/`notification:read`), authenticated the
  same way as the HTTP API, relayed across the api/worker process split over Redis
  pub/sub (a real gap the plan's own text didn't account for — reliable-tier
  subscribers run in the worker, which has no Socket.IO server of its own).
- **Both initially-wired event subscriptions** (`platform.audit.alertRaised`,
  `platform.roleAssignment.changed`) produce real notifications end-to-end against
  idempotently-seeded built-in templates.
- Additive-only elsewhere: a new RBAC read query (`rbacService.listUserIdsWithPermission`)
  and two new settings (`notifications.email.enabled`,
  `notifications.quietHours.enabledByDefault`); no existing service's behavior changed.

### Fixed

- **Retry-after-failure was permanently stuck**: the delivery handler kept a failed
  channel at `processing` across its whole retry sequence, intending that as the
  idempotency guard for the next attempt — but the guard checks for status `queued`
  before proceeding, so every attempt after the first silently no-op'd. A channel now
  transitions back to `queued` before its next attempt is enqueued.

### Backlog (recorded for future release planning — not implemented)

1. Frontend inbox UI and Socket.IO client wiring.
2. SMS / push / WhatsApp channel adapters (interface-ready, not built).
3. Digest/scheduled-summary notifications (`digestMode` field reserved, unused) and
   recurring delivery (`sendAt` is a one-time timestamp only).
4. A quiet-hours-expiry sweep job, an admin "resend a failed delivery" action, and
   notification retention/purge.
5. The future administration console (template management, queue monitoring, failed
   deliveries, resend/retry, statistics) and a dedicated metrics backend.

## [0.4.0] - 2026-07-09

Release v0.4.0 — Sprint 3.2: **Audit & Activity Service**
([PR #10](https://github.com/egycashcompany-ops/egycash/pull/10); plan:
`docs/12-planning/sprint-3.2-plan.md`; reference: `docs/02-architecture/audit-service.md`).
Completes the Sprint 2.1 audit core to its full ADR-012 spec.

### Added

- **Audited CSV export** (`GET /platform/audit-logs/export`, `auditLog.export`): streams
  via a Mongo cursor (no full-result buffering), row-capped
  (`audit.export.maxRows`, default 50,000), field-name-based `nationalId` masking, and
  **the export itself is audited** (actor, filter, row count).
- **Entity timeline** (`GET /platform/timeline`): a merged view over the audit + activity
  streams for one entity, newest-first. Implements
  [BD-007](docs/01-domain/business-decisions.md#bd-007--timeline-authorization-degrades-gracefully) —
  content degrades to whichever of `activityLog.view` / `auditLog.view` the caller holds
  (activity-only, audit-only, or merged); neither ⇒ audited 403.
- **Retention governance**: `platform.audit.retention` (daily) purges expired
  **activity** records in idempotent batches, settings-declared with a hard 365-day
  floor (`audit.retention.activityDays`); the audit stream keeps its structural
  no-delete guarantee.
- **Security-signal detection**: `platform.audit.securitySignals` (hourly) runs four
  detectors — repeated permission denials, lockout clusters, export spikes,
  refresh-token reuse — each raising an `alertRaised` audit record plus the reliable
  `platform.audit.alertRaised` event, deduplicated per (signal, subject, window).
- **Query hardening**: `moduleId` filter added to the audit list/export; new
  `ix_moduleId_at` / activity `ix_at` indexes.
- **Sprint 3.2 planning document** (`docs/12-planning/sprint-3.2-plan.md`, approved
  2026-07-09) and **BD-007 — Timeline authorization degrades gracefully**
  (`docs/01-domain/business-decisions.md`), resolving the decision flagged in the plan's §7.

No new permissions, no new collections (`check:permission-matrix` unchanged). Architecture
review: self-assessed in the PR, no code changes required.

### Backlog (recorded for future release planning — not implemented)

1. Replace the entity timeline's in-memory merge with a cursor-based merge if a given
   entity's history ever grows beyond current practical limits.
2. Generalize CSV export masking (`audit.export.ts`) into a reusable PII-masking framework,
   rather than the current field-name-based check.
3. Consider making the `lockoutCluster` and `refreshReuse` signal thresholds
   settings-configurable in a future release (currently fixed constants).
4. The future Notifications Service (v0.5.0) should _subscribe_ to
   `platform.audit.alertRaised` rather than introduce any direct coupling to the audit
   service.

## [0.3.0] - 2026-07-09

Release v0.3.0 — Sprint 3.1: **File Management Service**
([PR #6](https://github.com/egycashcompany-ops/egycash/pull/6), architecture review:
Implementation Approved; retrospective:
[2026-07-sprint-3.1](docs/11-retrospectives/2026-07-sprint-3.1.md)).

### Added

- **File Management Service** (platform `files`, ADR-010): storage providers behind one
  interface — Local, Railway volume, Amazon S3, MinIO (S3-compatible), Azure Blob — selected
  by `STORAGE_DRIVER`; upload/download/replace(versioning)/archive/restore/soft-delete/
  permanent-delete lifecycle; full metadata set (names, mime, extension, sha256 checksum,
  size, uploader, entity reference, category, tags); category catalog with per-category
  mime/size/retention rules; visibility-aware, per-download-audited authorization with a
  signed-URL abstraction (native presigning or app-level HMAC streaming); extension points
  for virus scanning, OCR and thumbnails with completion events; `platform.file.*` events
  on the reliable tier; unit + integration suites; API doc with sequence diagrams
  (`docs/02-architecture/files-service.md`).

## [0.2.0] - 2026-07-09

Documentation & governance wave (PRs
[#3](https://github.com/egycashcompany-ops/egycash/pull/3),
[#4](https://github.com/egycashcompany-ops/egycash/pull/4),
[#5](https://github.com/egycashcompany-ops/egycash/pull/5)). Release numbering follows the
sprint plan from here (0.x pre-GA); the `2.1.0`/`1.0.0` entries below predate this scheme.

### Added

- Project governance: `ECMS-BOOK.md`, `CONTRIBUTING.md`, `SECURITY.md`, `LICENSE`,
  `CODEOWNERS`, pull-request and issue templates, this changelog.
- **Phase 2.5 — Domain Model** (documentation only): `docs/01-domain/` — domain model,
  bounded contexts, entity relationships, and ubiquitous language for the whole platform.
- **Business Decisions log** (`docs/01-domain/business-decisions.md`): BD-001 requisition-driven
  recruitment (OQ-2), BD-002 organization-wide applicant numbering (OQ-3), BD-003 shared
  Client Registry (OQ-4), BD-004 multi-currency-ready EGP-first Money (OQ-5), BD-005
  separate cash/gold custody entities over a shared pattern (OQ-6), BD-006 one capability
  per implementation sprint — with the domain documents updated accordingly.

## [2.1.0] - 2026-07-09

Sprint 2.1 — Platform Core, phase 2.1 slice
([PR #2](https://github.com/egycashcompany-ops/egycash/pull/2), per
[Architecture Review 01](docs/10-reviews/2026-07-architecture-review-01.md) R2).

### Added

- **Monorepo**: npm workspaces (`apps/api`, `apps/web`, `packages/contracts`,
  `packages/config`); ESLint flat config with layer-boundary enforcement; Prettier;
  GitHub Actions CI (lint, typecheck, permission-matrix and flag-expiry gates, tests,
  build, audit); docker-compose dev stack (Mongo replica set, Redis, Mailpit); devcontainer.
- **`@ecms/contracts`**: Zod-first DTOs and schemas; platform permission catalog (single
  source of truth, synced to DB at boot); versioned event contracts (`schemaVersion`);
  error-code catalog; Egyptian NationalId validator/decoder and PhoneNumber normalizer;
  feature-flag declarations with expiry dates.
- **Kernel**: module registry with manifest validation (including `requiresPlatform`
  compatibility) that fails the boot loudly; typed event bus with in-process and
  outbox→BullMQ reliable tiers; `unitOfWork` transaction helper.
- **Auth**: argon2id login pipeline; 15-minute JWT access tokens; rotating refresh tokens
  with reuse detection and session-family revocation; session registry with revocation;
  settings-driven lockout and password policy; TOTP 2FA with single-use backup codes,
  enforced for privileged accounts.
- **RBAC**: code-declared permission registry; roles as data with protected system roles;
  time-bound role assignments enforced at permission-set computation; data scopes
  `own | branch | organization` applied centrally by `BaseRepository`.
- **Organization**: Organization singleton profile; Branch → Department → Section hierarchy
  with materialized paths, delete guards, managers and acting-manager delegation windows;
  Job Titles catalog.
- **Audit**: append-only audit and activity streams; queued writes with in-request fallback;
  `requestId` correlation across api → queue → worker; query endpoints; audited 403s.
- **Settings & feature flags**: declared-in-code registry; `user → branch → organization →
default` resolution with caching and change events; flags evaluated on the hierarchy.
- **Scheduler**: declared-task registry with pause/resume/run-now API; BullMQ repeatable
  executor; outbox sweep and expiring-assignments report.
- **Web scaffold**: login with TOTP step, in-memory access token with silent refresh,
  session bootstrap, `<Can>`/`useCan` permission gates, ar/en with RTL switching.
- **Tests**: 44 unit tests + integration suite proving login → permission → scoped data →
  audit trail, refresh-reuse detection, lockout, TOTP enforcement, optimistic concurrency,
  and hierarchy guards.

### Changed

- ADR-001…014 statuses Proposed → Accepted per the Milestone 1 approval log; **ADR-015**
  records the single-organization model (Review R1), superseding the multi-company aspects
  of the Milestone 1 design.
- README status lines updated to Milestone 2 / phase 2.1; generated permission-matrix
  companion added (Review R18).

## [1.0.0] - 2026-07-08

Milestone 1 — complete platform design documentation (`docs/`), approved by EGYCASH,
followed by Architecture Review 01 (pre-Milestone 2 critical review, R1–R32).

[Unreleased]: https://github.com/egycashcompany-ops/egycash/compare/v0.24.0...HEAD
[0.24.0]: https://github.com/egycashcompany-ops/egycash/releases/tag/v0.24.0
