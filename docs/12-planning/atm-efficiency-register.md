# ATM Efficiency & Investigations — the machine register and the Data Report

**Status:** implementation spec, owner decisions D1–D8 final (2026-10-13); revision 2 (same day)
applies the independent review — every finding and its disposition is in Appendix A; revision 4
(2026-10-28) adds the bank catalog, bilingual areas and data-edit adds that land in the register —
it amends D2, D5, D7, DEC-4, DEC-10, DEC-16, DEC-25 and EG-6 and adds DEC-35–DEC-41 (§1.3) · **Source of truth:** the
owner's workbook `Comprehensive ATMs report 16-03-2026.xlsx` (sheets `ATMs` and `Data Report`,
last saved 2026-09-29) and the legacy system `/home/user/ATM` · **Target:** ECMS module `atm`
(this manifest grows, never a second one — `apps/api/src/modules/atm/atm.module.ts:5-7`).

This document is precise enough for five engineers to build in parallel without asking questions.
Every precedent is cited as `file:line` on branch `claude/atm-operations-ecms-442l5r` (= main,
HEAD `0e7ad591`). Workbook figures were verified twice by independent read-only scripts; the
ExcelJS streaming feasibility (§6.2) was re-verified for this spec (4.1 s, 152 MB RSS for the full
37,639-row sheet). **No value of the safe-door combination (AO) or of any key column (J..Q) appears
in this document or was printed while writing it.**

> **Governing rules (apply to every work package).** The legacy sources are the specification. No
> self-invented behaviour; never delete a legacy feature (gate it instead); never invent data; a
> conflict is documented with a mapping and left to the owner; never trust a branch id from the
> browser on its own; no change to `/home/user/ATM` or `/home/user/Automation`.

---

## Contents

1. Decisions (owner D1–D8, designer DEC-n)
2. GAP register (EG-n)
3. Contracts (`packages/contracts`)
4. Column catalogue — Excel A..AW → register field
5. API — model, coupling, services, routes, report, export, secrets, audit, realtime, settings
6. Import pipeline (API)
7. Data-edit permission split, navigation, seed, page registry
8. Web
9. i18n keys (en + ar)
10. Tests — new, and every existing test/count that changes
11. Work packages and file ownership
12. Rollout and cut-over
13. Risks
- Appendix A. Review log (revision 2)

---

## 1. Decisions

### 1.1 Owner decisions (final — implement exactly)

| # | Decision | Where implemented |
|---|---|---|
| D1 | New collection `atm_register_entries`, **one document per Excel row = one custody period** (receipt from the bank → handover to the bank), linked by `machineId` to the existing Operations master `atm_machines` (schema and `ux_branch_code` unchanged — `apps/api/src/modules/atm/machines/machine.model.ts:13-25, 45-49`). `status` is derived and stored, never accepted as input: `pending` (no startDate) / `open` (startDate, no endDate) / `ended` (endDate). | §3.4, §5.1 |
| D2 | Efficiency controls machine existence through the register: RECEIVE creates / reactivates / links the master (`isActive:true`); HANDOVER archives it (`isActive:false`, code stays reserved, re-receipt reactivates the same row); edits of an open entry's name/area/bank sync to the master in the same transaction; soft-deleting a mistaken entry archives the master if it was the only open entry. `/atm/data-edit` stays the OPERATIONS page with delete removed for Operations: they may add/rename/archive-toggle BANKS and AREAS and move a machine to another AREA (which also moves its open register entry); machine add (single + bulk), archive, delete-by-codes, label DELETE and reassign-area stay under `atmMachine.manage` only. Enforced server-side by new keys. The `/atm/data-edit` nav row key changes through the repo's correction mechanism. **Amended 2026-10-28 (revision 4, §1.3):** a machine added on `/atm/data-edit` is ALSO recorded in the register — an OPEN receipt dated the add day, linked to the machine and flagged «بيانات ناقصة» for Efficiency to complete (DEC-36, DEC-37). The add stays `atmMachine.manage` only, and the key must now reach the acting branch (DEC-39). The register still controls existence: handing that entry over, or deleting it, archives the machine like any receipt's. Operations' bank list is now their per-branch SPELLINGS of the catalog's banks (DEC-35); the company-wide catalog is Efficiency's and the administrators'. | §5.5, §5.6, §7, §5.12 |
| D3 | AO `Combination Safe Door P.W` sealed through the platform secret store (AES-256-GCM, context-bound); the DTO carries only `safeCombinationSet`; plaintext only through an audited reveal endpoint under `atmRegister.viewSecrets`. J..Q, AN (`Notes Received`), AU (`Notes Delivered`) returned only to `viewSecrets` holders (null + `secretsVisible:false` otherwise) and redacted in audit diffs, logs and exports. No secret in import previews or error messages. | §5.4, §6.6 |
| D4 | Branch field on the receive form (Excel col A). Server: branch exists and is active AND `keyReachesBranch(ctx,'atmRegister.create',branchId)`. ATM setting maps `EGYCASH-1..7` → ECMS branchIds (admin-configured; sheet labels 1 المهندسين, 2 طنطا, 3 أسيوط, 4 الإسكندرية, 5 أكتوبر, 6 بور سعيد, 7 وصال). Branch immutable; a move = handover in the old branch + receive in the new. | §3.2, §5.3, §5.6 |
| D5 | Fixed company-wide bank enum `NBE, BM, CIB, HDB, BRK, NXT` with the Data Report's Arabic names; import maps `نيكست` → NXT. Setting maps bankCode → Operations bank label (defaults NBE→NBE, BM→MISR, CIB→CIB, HDB→HDB, BRK→BRK, NXT→NXT; legacy labels at `/home/user/ATM/views/events/reports_atm.ejs:350, 403-417`). An entry may carry an explicit `opsBankLabel` override picked from the branch's existing bank labels (e.g. `NBE FOREX`). A receipt that LINKS an existing active master keeps and adopts the master's `bankName`. NBE rows whose Area ends with ` FX` (verified: 83 rows, 72 open) are a separate import category `NBE + FX area → NBE FOREX` that the owner approves. **Amended 2026-10-28 (DEC-35):** the fixed enum became the company-wide bank catalog `atm_banks`, seeded at boot with these six (codes, names, colours and labels unchanged). A bank added there is a full register bank: the register, the Data Report, the settlements and the map all use it. Each bank's own `opsLabel` replaced the bankCode → label setting, which is retired (the seed reads it once). The per-bank ID formats stay in code, for the six only; a bank without one never warns. The override must now be a spelling OF the entry's bank (DEC-25). The ` FX` import category is unchanged (DEC-16). | §3.1, §5.5, §6.4, §5.12 |
| D6 | Block a second OPEN period for the same machineCode company-wide (mail matcher needs one active machine per code: `apps/api/src/modules/atm/mail-tickets/mail-ingestion.service.ts:55-82`; partial-unique precedent `apps/api/src/modules/it/assets/assignment.model.ts:52-60`). Area REQUIRED for new open receipts. Per-bank ID format and serial duplicates are WARNINGS only. Imported historical rows keep their blanks and carry `importIssues`. | §5.1, §5.6 |
| D7 | One ACTIVE definition everywhere: `branch set ∧ startDate set ∧ endDate null` (Excel helper CI). End date only, no as-of date. Keep the Excel's three sections, orders, labels (typo fixes: الاسكندية→الإسكندرية, `فرع إيجي بور سعيد`→`فرع إيجي كاش بور سعيد`, `NXT  BANK`→`NXT BANK`), bank series colours (NBE #385723, BM #AC2100, CIB #FFD966, HDB #B4C7E7, BRK #F4B183, NXT #000099), total bars, 0 shown not blank, an as-of stamp = server `generatedAt`. Separate permission `atmRegisterReport.view`. **Amended 2026-10-28 (DEC-40):** the report's banks come from the catalog. The six are always shown, at their sheet positions and in their sheet colours. A bank added since follows them (after BRK in section 1, after NXT in section 3) in its catalog colour. The import's 57-number check still folds the workbook's six. | §3.5, §5.8, §8.5, §5.12 |
| D8 | Import ALL 3,542 rows (rows 3..3544: 2,607 open, 912 ended, 23 pending) through upload → PREVIEW → explicit APPLY under `atmRegister.import`. Bind columns by (exact header, nth occurrence); stream; stop at the `END` sentinel (row 5000); read A..AW only; formula cells via `result`. Preview: counts by status; the 57 Data Report numbers recomputed next to the verified snapshot — apply BLOCKED unless they match or the owner explicitly overrides; per-row issues; reconciliation categories vs live `atm_machines` (link / reactivate / create / cannot-create / active-master-without-open-entry (report only) / NBE-FX → NBE FOREX), each approved individually. Idempotent by `importRow` through a run record. Secrets sealed on write, never echoed. File never stored. Excel frozen after cut-over. | §6, §12 |


### 1.0 Lead overrides (revision 3 — these SUPERSEDE any conflicting text below)

| # | Override | Why |
|---|---|---|
| O-1 | **No one-time widening (DEC-5 narrowed).** `widenDataEditRoles()`, the `rbac.service.ts` / `rbac.repository.ts` / `delegation.repository.ts` changes and their tests are DROPPED. Kept from DEC-5: the nav row `/atm/data-edit` moves to `atmRefLabel.create` through the new `previousPermission` correction (mirrors `previousIcon`), and the route guard accepts any of `atmRefLabel.create, atmRefLabel.edit, atmMachine.moveArea, atmMachine.manage`. Super-admin gets every new key from `atm.seed.ts` as today. Granting the new keys to existing Operations roles (and removing `manage` from them) is an **administrator step** in §12.2. | The widening edits platform RBAC code and live role/delegation data to save one admin step; this feature does not need it. A manage-only holder keeps the page through the route guard (by URL) until an admin grants a new key. |
| O-2 | **No change to `REALTIME_BROADCAST_ACTIONS` (DEC-6 narrowed).** `packages/contracts/src/platform/realtime.ts` is NOT modified. Register writes audit with verbs that already broadcast: a new open or pending entry → `create`; Receive of a pending entry (pending→open) → `statusChange`; Handover (open→ended) → `statusChange`; edits → `update`; delete → `delete`. The transition is recorded in the audit `changes` (`status: {from, to}`) so the audit log still reads as a receipt / handover. The master machine keeps its own audits (`create`/`update`). `secretRevealed` and `atmRegisterImport` stay NEW verbs and do not broadcast. | Adding `receive`/`deliver` globally would change Gold and IT realtime behaviour, which is outside this feature's scope. |

### 1.2 Designer decisions (the owner did not specify these; each is the narrowest choice that keeps D1–D8 true)

| # | Decision | Rationale |
|---|---|---|
| DEC-1 | Register contracts live in a NEW file `packages/contracts/src/modules/atm-register.ts`, exported from `packages/contracts/src/index.ts`. | Module sub-feature files are the convention: `gold-portal.ts`, `fleet-odometer-bracket.ts`, `hr-*.ts` (`packages/contracts/src/index.ts:31-67`). Keeps `atm.ts` (617 lines) Operations-only and gives WP-A one new file. |
| DEC-2 | Keys: `atmRegister.{view,create,edit,delete,export}` + specials `handover`, `viewSecrets`, `import` (page `atm.register`); `atmRegisterReport.view` (page `atm.register-report`); `atmRefLabel.{create,edit}` (page `atm.machines`); `atmMachine` special `moveArea` (page `atm.machines`). Total ATM keys 15 → 27. | Standard actions are a closed list (`packages/contracts/src/permissions/def.ts:8-18`); every other verb is a named special (`:100-143`). A separate `atmRefLabel` resource lets a role hold "add bank/area" without any machine authority. |
| DEC-3 | Operations' "move machine to area" is a NEW route `PATCH /atm/machines/:id/area` (`atmMachine.moveArea` or `manage`). `POST /atm/machines/reassign-area` stays manage-only. | D2 says reassign-area stays manage-only AND Operations keep the legacy move capability (`/home/user/ATM/contad_app.js:2529-2541`); the only way to satisfy both is a second, area-only path. |
| DEC-4 | Every master AREA write (manage `PATCH /:id`, manage `/reassign-area`, `moveArea`) moves the machine's open register entries to the same area in the same transaction. Master NAME/BANK edits by admins (manage `PATCH /:id`) do NOT flow back into the register. **Note 2026-10-28 (DEC-36): unchanged.** A data-edit ADD now writes the register. A later edit still reaches it only through the area: a name or bank edit does not flow back, a changed `bankName` is not validated, and turning a machine back on through `PATCH /:id` creates no receipt (a DEC-24 correction, which `masterState` already shows). | D2 states the area rule for Operations; the area is the same fact whichever key changed it. Name/bank on the register are Efficiency's record (bank is an enum, the master holds an Operations label that cannot be mapped back). Drift is visible through `masterState`/warnings, never silently rewritten. Since DEC-35 a label can be mapped back to a catalog bank, but the rule stands: an edit corrects the master, it is not a receipt. |
| DEC-5 | **(Narrowed by O-1 — no widening.)** Nav row `/atm/data-edit` key → `atmRefLabel.create` through a new `previousPermission` field that mirrors `previousIcon` (`apps/api/src/seed-navigation.ts:28-37, 1232-1241`). Route guard accepts any of `atmRefLabel.create, atmRefLabel.edit, atmMachine.moveArea, atmMachine.manage`. ONE-TIME widening: every role AND every live ADR-032 delegated grant (`platform/rbac/delegation.model.ts:12-41`, its own `permissionKeys` per user and unit) that holds `atmMachine.manage` gains `atmRefLabel.create`, `atmRefLabel.edit`, `atmMachine.moveArea`, guarded by "the nav row still carries `atmMachine.manage`". A role or delegation given `manage` AFTER the first boot is not widened (the guard is false by then): §12.2 step 4 tells the administrator to add `atmRefLabel.create` beside it. | `syncNavigationCatalog` only fills a null key (`seed-navigation.ts:1243-1251`); `previousIcon` is the repo's only "correct a shipped value" mechanism. Without the widening, admin roles and delegated deputies holding only `manage` would lose the sidebar row. The widening adds nothing a manage holder could not already do (every widened route accepts `manage`). Module seeds run before the nav sync (`apps/api/src/server.ts:42-44`, `platform/kernel/bootstrap.ts:138-141`), so the guard turns false after the first server boot and the widening never repeats. |
| DEC-6 | **(Superseded by O-2 — verbs are create/statusChange/update/delete; realtime.ts unchanged.)** Audit verbs: `receive` (receipt), `deliver` (handover), `create` (pending entry), `update`, `delete`, `export` — all existing (`packages/contracts/src/platform/audit.ts:26, 109, 147`). Two NEW verbs: `secretRevealed` (the audited read) and `atmRegisterImport` (one row per apply). `receive` and `deliver` are ADDED to `REALTIME_BROADCAST_ACTIONS` (`packages/contracts/src/platform/realtime.ts:19-27`). | The only audited-read precedent is `medicalRecordRead` (`audit.ts:84-93`); an import over thousands of rows audits as one record (`attendancePunchImport`, `audit.ts:125-129`). Without the broadcast change a receipt/handover would never refresh other viewers' screens (`platform/realtime/realtime-publisher.ts:55` filters on that list). Side effect, accepted: gold receiving/delivery confirmations (`modules/gold/receiving/receiving.service.ts:412`, `modules/gold/delivery/delivery.service.ts:239`) and IT part receipts (`modules/it/spare-parts/part.service.ts:150`) also start signalling their already-registered topics — a refetch, never data (ADR-029). |
| DEC-7 | Write implies read: setting any K or S field (keys, receiptNotes, handoverNotes, safeCombination) on receive/edit/handover/import-apply requires `atmRegister.viewSecrets` (403 otherwise). | A caller who cannot see a value would otherwise overwrite it blind; same reason the employee DTO pairs a gated block with a `…Visible` flag (`modules/hr/employee-management/employees/employee.mapper.ts:1-7`). |
| DEC-8 | LINK never writes the master. It adopts `master.bankName` into `entry.opsBankLabel` (D5); if the request named a different override → warning `opsBankLabelIgnored`; if master name/area differ from the entry → warning `masterDiffers` (manual) / listed difference (import). | D5 fixes the bank half; extending "keep" to name/area is the narrowest reading and avoids rewriting up to 2,607 Operations names at cut-over. Later edits of the open entry sync (D2). |
| DEC-9 | A receipt is refused (409 `ATM_REGISTER_CODE_ACTIVE_ELSEWHERE`) when an ACTIVE master with the same code exists in ANOTHER branch, even without an open entry there. The refusal names the other branch only to a caller whose `atmRegister.view` reaches it. The import shows these rows as their own report category `activeElsewhere` with from-branch → to-branch counts; how to resolve them is an owner question (EG-19), not a designer default. | D6's stated reason is the mail matcher, which needs exactly one active master per code company-wide (`mail-ingestion.service.ts:59-81`). Archiving the other branch's master silently would be an invented hand-over. How often this fires depends on how production `atm_machines` were loaded (EG-19). |
| DEC-10 | A receipt's branch must be mapped in `atm.register.branchCodes` (422 `ATM_REGISTER_BRANCH_UNMAPPED`). **Amended 2026-10-28 (DEC-36):** a data-edit add in an unmapped branch still adds the machine, so Operations are never blocked, and records nothing in the register (`register.action: 'none'`, `reason: 'branchUnmapped'`). The add dialogs say so beforehand (`registerMapped: false`). | The register's Branch column shows the EGYCASH code and the report's categories are the mapped codes; an unmapped branch would make Section 1 and Section 2 totals disagree (D7 "one definition"). |
| DEC-11 | `openPeriodExempt: boolean` on entries; the import sets it on BOTH rows of a duplicate-open pair (rows 456/2314 = 2013, 457/2315 = 2015), and on every OPEN row whose code is a placeholder (`#`, `********` — such a code names no machine and is never coupled, but two of them would collide on the index and abort their apply batch with a bare E11000: review finding DATA-2; the snapshot has none). The partial unique index excludes exempt rows; the service check does not, so no new receipt of 2013/2015 is possible while either is open. An edit that changes an open entry's code re-derives the flag (true only for a placeholder), so a new real code is held to the index. | D8 imports all rows; D6's index would otherwise refuse the second row of each pair. Which row is right is EG-8. |
| DEC-12 | Pending entries can be created manually (`startDate` optional) and become open through `POST …/receive`. A branch-less pending entry (5 imported rows) cannot be received — delete it and receive anew. | The Excel lets a row exist without a start date (23 rows); its meaning is EG-9, so the register neither forbids nor interprets it. Branch is immutable (D4). |
| DEC-13 | No "reopen a handover" action in v1. | Not in the owner's action list (Receive, Edit, Handover, Delete, Reveal, Export). EG-15. |
| DEC-14 | Handover with `endDate < startDate` or a future date is accepted with a warning. | D6 lists the only blocks; the Excel has 2 such rows (1062, 2508) and planned future ends (EG-10). |
| DEC-15 | Import apply audits ONE `atmRegisterImport` row per apply; per-row outcomes live in the run record; writes are committed in batches of 200 rows per transaction; one running import at a time. | Attendance precedent (`audit.ts:125-129`); IT/Fleet run-record precedent (`modules/it/go-live/go-live-run.model.ts:1-57`); a single 6,000-write transaction risks the 60 s transaction limit. Idempotency is the unique `importRow` index, so a crashed batch is simply re-run. |
| DEC-16 | `nbeForex` is applied only in branches that hold an ACTIVE bank label named exactly `NBE FOREX`; elsewhere the item is reported `labelMissing`. **Note 2026-10-28 (DEC-35): the rule is unchanged.** `NBE FOREX` stays a per-branch spelling, never a company-wide alias, and the import still asks for an ACTIVE label named exactly `NBE FOREX`. Spellings now name their bank (`bankCode`); the boot backfill gave `NBE FOREX` → NBE. | D5: the override is "picked from the branch's existing bank labels". Operations can add the label themselves (D2). |
| DEC-17 | Export = server-streamed CSV with UTF-8 BOM, audited `export`, Excel header texts, P-class columns only, a derived `Status` column appended, cells beginning with `= + - @ TAB CR` (other than a lone `-` or a number) prefixed with `'`. | Server CSV precedent `modules/hr/attendance/day-records/attendance-export.ts:88-130`; BOM precedent `apps/web/src/modules/atm/pages/MachinesPage.tsx:20-29`. Server-side is the only way the export is audited and the K/S fields never leave the server. |
| DEC-18 | Reveal is `POST …/reveal` (side effect = audit row); every `/atm/register/entries*` response carries `Cache-Control: private, no-store`; the web shows the value for 30 s, the reveal mutation has `gcTime: 0` and is `reset()` when the value is cleared, and register queries use `gcTime: 0` for `viewSecrets` holders (the medical precedent, `apps/web/src/modules/hr/medical/api/medical-queries.ts:33-49`). | No reveal-a-sealed-value endpoint exists (`modules/automation/credentials/credential.routes.ts:24-28`); the closest "own grant" reveal is GET `modules/fleet/fuel-cards/fuel-card.routes.ts:105-112` (plain text, unaudited). POST cannot be prefetched. ADR-034 records the pattern. |
| DEC-19 | Data Report: the three charts AND their tables render `dir="ltr"` inside the RTL page, so the order on screen is the Excel's (the sheet has no `rightToLeft` and every category axis is `minMax`: first category — NXT, وصال, المهندسين — at the LEFT, total bar at the RIGHT; tables start at AD on the left); each label keeps `dir="auto"`. Charts 1–2 are single-series in the Excel's own colour, theme `accent1` `#4472C4` (`ATM_REPORT_TOTALS_COLOR`, both themes; the gradient and shadow are not reproduced); chart 3 uses the owner's bank colours in both themes; the platform surface replaces the mint `#00FFCC` canvas; every bar carries its value label, every chart has its table and chart 3 its legend. | D7 says keep the Excel's orders and colours: mirroring the order or recolouring charts 1–2 would be a designer change (review finding F-15). The dataviz validator FAILS the owner palette (adjacent NBE/BM protan ΔE 4.4; CIB/HDB/BRK contrast < 3:1 on light, NBE/BM/NXT < 3:1 on dark); the colours are mandated (D7), so the relief the validator demands — visible labels + table — is mandatory. |
| DEC-20 | Register settings are edited on a card on the import page through the platform `setting.edit` (`PATCH /platform/settings/values`). | Module-card precedent `apps/web/src/modules/it/components/TechnicianDepartmentsCard.tsx:1-13`; the generic settings screen cannot edit arrays of objects (its list editor parses strings only: `apps/web/src/modules/system-admin/settings/lib/settings-view.ts:243-255`). |
| DEC-21 | Default register order = Excel order (`createdAt asc, _id asc`; imported rows are inserted in row order). | Faithful to the sheet (append-only, oldest first). Users sort by any server-sortable column. |
| DEC-22 | English names of banks/branches/columns are translations; Arabic Data Report labels are verbatim except the three D7 fixes; `Alanki`, `HUB` and the numeric headers `200/100/50` stay untranslated; every register column header shows the exact Excel header as its tooltip. | Never invent meaning (EG-1). |
| DEC-23 | Legacy-imported master rows lacking `createdAt/updatedAt/__v` are backfilled at boot for `atm_machines` and `atm_ref_labels` (`$exists:false` guards), tolerated at runtime in the coupling path, and tolerated in the two mappers. | Rows written by `npm run atm:import` bypass Mongoose (`modules/atm/migration/legacy-import.ts:60-74`); the mapper would throw (`modules/atm/atm.mappers.ts:31`) and every versioned write would 409 (`shared/base/base.repository.ts:432-458`). Boot-migration precedent `modules/hr/recruitment/recruitment.migration.ts:1-12, 524-531`. |
| DEC-24 | Admin (`manage`) actions on a master that has an open entry stay allowed (nothing is removed). The resulting drift is surfaced: `masterState` on the entry DTO (`active/archived/deleted/missing`) and a badge in the grid. | "Never delete a legacy feature — only gate it" (D2). |
| DEC-25 | Changing an entry's `bankCode` clears its `opsBankLabel` override unless the same request sets one. **Amended 2026-10-28 (DEC-35): also enforced by the server.** An override that is sent must be an active spelling of THIS entry's bank, else 400 `body.opsBankLabel` `OTHER_BANK`. A spelling mapped to no bank cannot be chosen as a new override (`UNMAPPED`). An override already stored is not checked again unless it is sent again. | An override chosen for one bank is meaningless for another (e.g. `NBE FOREX` on a BM machine). Until spellings carried their bank, only the screen could know that. |
| DEC-26 | The ATM schemas' indexes (machines, ref labels, register entries, import runs) are built at boot one at a time, duplicates reported never resolved. | `autoIndex` is off in production (`infrastructure/database/mongo.ts:10`); precedent `modules/fleet/fleet-indexes.ts:1-33`. Without it `ux_open_period_per_code` would not exist in production and the first insert into a not-yet-existing collection would happen inside a transaction (`modules/it/assets/receipt.repository.ts:15-27`). |
| DEC-27 | Report scope: the branches shown are derived from the SAME selector as the data match (`registerScopeBranches`, §5.2): organization → every mapped branch; a reach → the mapped branches in `branchIds ∪ departmentBranchIds`; no reach → the home branch for branch/department/section; `own` → every mapped branch, with the data narrowed to `createdBy` (the Fleet dashboard's fallback). So Section 1 and Section 2 always count the same entries. | `modules/fleet/dashboard/dashboard.service.ts:66-69`; `shared/base/org-scope-match.ts:87-106`. A viewer must not see a branch outside their reach as zeros, and D7's "one definition" needs the two totals to agree. |
| DEC-28 | **Provisional — owner to confirm (EG-21).** The total label is written «إجمالي عدد الماكينات» (the sheet has «اجمالى عدد الماكينات»). Every other sheet label is verbatim apart from D7's three fixes. | Two owner rules conflict: D7 lists exactly three label fixes, and the owner's standing rule that product Arabic is formal is enforced by the repository's guard, which rejects «اجمالى» (`scripts/check-formal-arabic.mjs:106`, run by `apps/web/src/platform/localization/formal-arabic.spec.ts` and CI). The mapping «اجمالى» → «إجمالي» is recorded as EG-21 and shipped provisionally because the verbatim string cannot pass CI; if the owner rejects it, the fix is one i18n value plus a guard exception, owned by WP-A. |
| DEC-29 | **Register scope rule.** `AtmRegisterEntryRepository` overrides `scopeFilter` with `registerScopeMatch(selector)` = `orgScopeMatch(selector, { branch: 'branchId' }, { finerNarrowsToBranch: true }) ?? { createdBy }`, so a department- or section-scoped grant narrows to its branch instead of widening to the company. Every WRITE (create, receive, update, link, handover, delete) and the REVEAL additionally require `keyCoversEntry(ctx, key, entry)` = the key is organization-wide, or `entry.branchId !== null ∧ keyReachesBranch(ctx, key, entry.branchId)`; the DTO's `secretsVisible` is the same predicate for `viewSecrets`. Department-, section- and own-scoped holders can therefore READ within their branch / their own rows, but never write, reveal or see K/S values. The same "the authorizing key must reach the target branch" check is added to the Operations paths that this spec widens (`moveArea`, ref-label create/edit, §7.1). | `BaseRepository.scopeFilter` passes no options to `orgScopeMatch` (`shared/base/base.repository.ts:143-154`), whose fallback for a department/section scope over a branch-only collection is `{}` = company-wide (`shared/base/org-scope-match.ts:79-85, 111`); `keyCoversUnit` is false for own/section and for a home-only department grant (`shared/types/index.ts:162-186`). Without this, a department-scoped `viewSecrets` (the natural shape for الكفاءة والتحقيقات, EG-11) reveals any branch's combination (review finding F-1). |
| DEC-30 | **Deferred coupling.** An OPEN entry with `machineId:null` (imported `blankArea`/`activeElsewhere`/`noName`, or not approved) has DTO `masterState:'unlinked'` and can be coupled later: automatically when an edit SETS its `area`, and explicitly through `POST /entries/:id/link` (`atmRegister.edit`). Both run `coupleReceipt` in the same `unitOfWork` with the same refusals. | D2: the register controls machine existence; §12.4 promised that an entry gets its Operations machine "once an area is entered", which needs a code path (review finding F-10). The explicit action covers entries that need no edit (e.g. after an admin resolves an `activeElsewhere` conflict). |
| DEC-31 | **Import stops instead of diverging.** Three new apply blockers, each listing its rows: `dateUnreadable` (a non-empty AQ/AR cell that is not a readable date — the Excel's CI would read it differently), `openInRegister` (an OPEN row whose code already has an open entry in the register — the insert would abort its batch), `changedSinceImport` (a row already imported whose values in this file differ from the stored entry). Each is resolved by the owner in the Excel or in the register, then the file is previewed again. | Silent null/skip would make the register disagree with the Excel the owner is freezing (D7/D8); a blocker is the conservative choice that leaves the decision to the owner (governing rules). |
| DEC-32 | **Imported blanks stay blank — including Name.** `name` is `string \| null` on entries; manual writes still require it (Zod), imports keep a blank as null with issue `noName`, and such a row cannot create or reactivate a master (reason `noName`; master `name` is required, `machines/machine.model.ts:32`). | D6: imported historical rows keep their blanks. A required Mongoose `name` would abort a 200-row batch on the first blank (review finding F-28). The snapshot has 0 blank names. |
| DEC-33 | **Combination key rotation.** A nightly scheduled task `atm.rotateRegisterCombinationKeys` rewraps every sealed combination not on the current key (soft-deleted entries included), mirroring `automation.rotateCredentialKeys` (`modules/automation/automation.module.ts:68-81`, `credentials/credential.service.ts:288-320`). | The documented rotation procedure drops the old key after `rewrap()` (`docs/02-architecture/platform-crypto.md` "Key ring and rotation"); without a sweep every reveal would fail afterwards. |
| DEC-34 | **Error tracking never receives register request bodies.** Sentry's HTTP integration is configured to ignore incoming bodies on `/api/v1/atm/register*`, and a `beforeSend` scrubs the register's K/S field names anywhere in an event. | The installed `@sentry/node` 10.75 attaches request bodies to error events by default (`maxIncomingRequestBodySize` default `'medium'`), and `captureError` runs on every unexpected error (`infrastructure/http/error-handler.ts:32-37, 54-55`); `sentry.ts` claims scrubbing it does not configure (review finding F-2). |
| DEC-35 | **The bank catalog `atm_banks` (revision 4; amends D5).** Owned by ATM (port doc D1), company-wide, one row per bank: `code` (`^[A-Z][A-Z0-9]{1,9}$`, unique `ux_bank_code`, never changed and never reused — there is no DELETE); `name {ar, en}` (both required, 1–80, unique per language with case ignored — 409 `ATM_BANK_NAME_TAKEN`); `opsLabel` (1–64, default the code — the ONE text a receipt writes on `atm_machines.bankName`); `formerOpsLabels` (system-managed: a label change appends the old one); `opsLabelKeys` (system-managed: the current and former labels trimmed and upper-cased, behind the unique multikey `ux_bank_ops_label_keys`); `color` (`#RRGGBB`, default the first `ATM_BANK_EXTRA_COLORS` no bank wears, else the least-worn one); `sortOrder` (the seeds 10–60 in section-3 order, a new bank max + 10); `isActive` (archive: no longer offered or accepted for new receipts and machine adds, still named and counted wherever it is stored); `isSeed`. Refusals: `ATM_BANK_CODE_TAKEN`; `ATM_BANK_LABEL_TAKEN` when a label key is another bank's, current or former, or a live branch spelling's mapped to another bank (archived spellings included). Contracts: `ATM_BANK_CODES`, `ATM_BANK_NAMES`, `ATM_BANK_REPORT_COLORS` and `ATM_DEFAULT_OPS_BANK_LABELS` are deleted with no alias; `AtmBankCode` is a `string` and the six are `ATM_SEED_BANK_CODES` / `ATM_BANK_SEED` (§3.1). Boot seed `seedAtmBankCatalog`: the six with `$setOnInsert` only; each label is the retired `atm.register.bankLabels` value when one is stored (the D5 default then kept as a former label), else the default; the pure planner `planBankSeed` sends every colliding override back to its default before any write; an E11000 from two instances booting at once is logged and skipped; the setting is read only while a seed is missing and stays declared, described as retired. A machine's bank text resolves (`resolveBankOfLabel`) to a catalog key, else the branch's ACTIVE spelling with exactly that name and a mapped `bankCode`, else no bank. Spellings (`atm_ref_labels` kind `bank`) stay per branch and now name their bank (`bankCode`): the boot `backfillBankLabelCodes` maps every row without one, once — a catalog key → that bank, `NBE FOREX` → NBE, `نيكست` → NXT, anything else → null (listed for Operations to map, §8.7). | The owner: «… وبرضو يقدروا يضيفوا مناطق وبنوك (عربي وأنجليزي)», and the owner's call (final) that a bank added at runtime is a FULL register bank — the enum could not stay. The code keys entries, plans, plan lines, preparations, standard loads, layout-import runs, the note counter (`atm-note:<branch>:<bank>`), URLs and report keys, so it never changes. Unique label keys mean a machine's text can never mean two banks (critic gap 6); catalog keys resolve first, so a label taken from a branch spelling would silently move that branch's machines. The setting allowed one label for two banks (only `bankCode` was unique), which the unique index refuses: the planner keeps the boot from ever failing on it. One lean read per request and no cache, so several API instances agree the moment a bank is archived. The ID formats stay in code: a user-typed regex would run on every register write (a ReDoS risk) for what is only a warning. |
| DEC-36 | **A data-edit add is recorded in the register (revision 4; amends D2).** `POST /atm/machines` and `/bulk` run `recordOperationsIntake` (`register/operations-intake.ts`), ONE `unitOfWork` per machine, after three checks: `atmMachine.manage` reaches the acting branch (DEC-39); the bank text is resolved (DEC-35) — an ARCHIVED bank is 400 `body.bankName INACTIVE`, a text that maps to no bank goes on (`noBank`); a code ACTIVE in this branch is 409 (single) or `skippedCodes` (bulk). Then, in order: (a) an OPEN entry of the code in ANOTHER branch (a null branch and the DEC-11 pairs count; placeholder codes are exempt) → 409 `ATM_REGISTER_OPEN_PERIOD_EXISTS`, nothing written; (b) `coupleReceipt`, unchanged — active in another branch → 409 `ATM_REGISTER_CODE_ACTIVE_ELSEWHERE`, archived here → reactivated with the form's name, area and bank, else a new machine; (c) branch unmapped (DEC-10) or placeholder code → `none` (`branchUnmapped` / `placeholderCode`), the machine committed; (d) open entries of the code HERE: one linked to this machine → `existing`, else each unlinked one, or one pointing at a machine no longer live, is linked → `linked`, its data and flag untouched (when every one points at another live machine, nothing is relinked and the answer is `existing`); (e) the newest PENDING entry of (branch, code) is received — start = Cairo today, open, linked, flagged, only a null area, bank or name filled from the form → `received`; (f) else, when the text resolved to a bank, a new OPEN entry with the branch, area, bank, code, machine and name, `opsBankLabel` null when the text is the bank's `opsLabel` else the text (`NBE FOREX`, a former label), start = Cairo today, `source: 'operations'`, flagged, every other field empty → `created`; with no bank → `none/noBank`. A race on `ux_open_period_per_code` rolls back the WHOLE unit, machine included, as the same 409. No register key is checked and no K/S field is written. Audits after commit: the machine's, then the entry's `create` / `update` / `statusChange` with the redacted diff. A refusal names the other branch only to a caller whose `atmMachine.view` or `atmRegister.view` reaches it (F-9). The single add answers 201 `AtmMachineCreateResultDto` — the machine, `reactivated` and `register {action, reason, entryId, bankCode}`; the bulk add runs one unit per row and adds `reactivatedCodes`, `refused` (`activeElsewhere` / `openElsewhere`) and `register {created, received, linked, existing, notRecorded}`. | The owner: «عايز لما يتضاف حاجة هنا /atm/data-edit تتضاف هنا /atm/register بحيث شغل العمليات ميعطلش ويبقى بتاع الكفاءة والتحقيقات يكمل بياناتها براحته», and the owner's call (final): an OPEN, linked receipt dated the add day. OPEN, not pending: only an open entry counts in the Data Report and gives the settlements a bank (`settlements/shared/register-bank.ts`), which ends the `noRegisterBank` refusals for the machines Operations add. The entry is the add's side effect — the mirror of a receipt writing the machine under register keys — so no register key is asked. A code active or open in another branch was accepted before, and broke the mail matcher (DEC-9) and D6. Receiving the pending entry keeps it from being left behind as a duplicate (critic gap 5). An unmapped spelling never blocks Operations: the machine is added, only the entry is skipped. |
| DEC-37 | **«بيانات ناقصة» is a stored flag**, `dataIncomplete` on entries (required, default false; a row written before reads false), with the partial index `ix_incomplete` `{ branchId, dataIncomplete }` over flagged rows only. Set only by DEC-36 steps e and f; set or cleared by `PATCH /entries/:id { dataIncomplete, version }` under `atmRegister.edit` (`keyCoversEntry`); never cleared automatically; kept across a handover. `GET /entries` and the export take `incomplete` (`true` → flagged, `false` → not flagged), and the CSV gains a last column `Data incomplete` (`yes` / `no`) after `Status`. The entry snapshot carries `source` and `dataIncomplete`, so the audit diff shows the flag being set and cleared. Web (§8.7): an amber badge, the «بيانات ناقصة فقط» filter (`incomplete=1`, remembered), a checkbox on the edit form. | The owner wants Efficiency to complete Operations' receipts «براحته»: they need to find them. Derived from blank fields it would flag most of the 3,542 imported rows, whose blanks are legitimate (D6, DEC-32, EG-1), and key fields cannot be judged without `viewSecrets`. The receipt date is corrected through the open entry's existing `startDate` edit. |
| DEC-38 | **Areas reach data-edit as labels written on save, plus a boot backfill (amends EG-6).** `ensureAreaLabels` (`catalogs/area-labels.ts`) upserts one label per (branch, trimmed area) AFTER a write commits, best effort — a failure is logged and never fails the write — from: register create, an update that changes the area, receive-pending and link; machine add and bulk add; a machine area change through `update`, `moveArea` and `reassignArea`; the import apply, once after the run. Ended entries and archived machines never create labels. The upsert's filter is `{ branchId, kind: 'area', $or: [{ name }, { formerNames: name }] }` with NO `isDeleted` and no `isActive`, so a name that was deleted, archived or renamed is never inserted again; blanks and values starting with `#` are skipped; a concurrent insert's E11000 is swallowed; each row inserted is audited `atm.refLabel` `create`. `backfillAtmAreaLabels` runs every boot over the areas of active machines and of open or pending entries that have a branch (no audit; `origin: 'backfill'`). Labels gain `nameAr` / `nameEn` (display only), `formerNames`, `bankCode` (spellings) and `origin` (`manual` / `backfill` / `register` / `machine` / `import`). A NEW area from a dialog needs Arabic AND English and STORES the English (`name := nameEn`); a legacy `{ name }` gets its display name from its script. A rename works as before, with no cascade, and moves the old name to `formerNames`. The display rule `labelText` — the reader's language, else the other, else the stored name — is used only where areas are listed or chosen (data-edit, the register's area suggestions and area filter); boards, reports, the map and exports keep the stored string. | The owner: «البنوك والمناطق مش مسمعه !! من /atm/register» — the register's areas never became `atm_ref_labels` rows, so data-edit never showed them. «الإنجليزي تمام، كمّل» settles which name is stored: the stored values are Latin (MOHNDESSEN, ALEX) and the import's ` FX` rule needs Latin. Written after commit, so no WriteConflict on the label collection reaches a register or machine transaction, and the next boot repairs a label that was missed. No merge: one spelling per label keeps EG-6's "merging would invent data", and every downstream reader (boards, daily report, leader cascade, map) matches the exact string, so the second language is display only. |
| DEC-39 | **Permissions of revision 4.** New resource `atmBank` (`create`, `edit`; page `atm.register`), both refused (403) unless held at ORGANIZATION scope. `GET /atm/banks` accepts any ATM key (the list is derived from `atmPermissions` in `atm.module.ts`). Efficiency add AREAS with the register keys they hold: `POST /atm/ref-labels/:kind` also opens to `atmRegister.create` / `atmRegister.edit`, which the service limits to kind `area` in a branch they reach; a bank spelling stays `atmRefLabel.create` / `manage`. A label may be filed in a named `branchId`, which the authorizing key must reach. `GET /atm/ref-labels/options?branchId=` (declared before `/:kind`) accepts any data-edit key — `atmMachine.view`, `atmMachine.manage`, `atmMachine.moveArea`, `atmRefLabel.create`, `atmRefLabel.edit` — reaching the branch, or `manage` at home. Machine add and bulk add stay `atmMachine.manage` only, now with `manageActsInBranch` (the key reaches the acting branch, or "manage at home" for a department, section or own grant) — else 403. Navigation and the data-edit route guard are unchanged; there is no `atmMachine.create`. | A bank is one fact about the company: a branch-scoped holder would be adding it for every branch. Every ATM screen names and colours banks, so any ATM key reads the list, while an account outside ATM learns nothing about runtime banks; deriving the keys keeps the list from drifting. Efficiency hold no `atmRefLabel.*` (§12.3), and the owner wants them to add areas too. The add now writes the company-wide register, so it must not land in a branch only an unrelated key reaches (DEC-29's rule); nobody who could add in their own branch loses it. Who may add machines was left at its default, `manage` only. |
| DEC-40 | **Report order for banks added since the workbook.** `atmReportBankOrders(extras)`: section 1 = the sheet's six then the extras (a new bank after BRK), section 3 = the sheet's six then the extras (after NXT). The extras are every non-seed ACTIVE catalog bank, plus an ARCHIVED one while it still has machines in operation, in `sortOrder` then code, then any counted code the catalog does not know (sorted, drawn grey `#A6A6A6`). `foldAtmRegisterReport(groups, branches, banks)` folds those banks; a group with an unlisted code is appended, so the section-1 and section-2 totals always agree. `buildAtmReportCells` gives a non-seed bank no sheet cell (`cell: ''`), and `ATM_DATA_REPORT_CELLS` is still the same 57 cells (pinned by a spec). The DTO gains `banks {code, name, color, isActive, isSeed}`, `section1Banks` and `section3Banks`; the page draws its bars and series from them in each bank's colour, and falls back to the sheet's six when an older server omits them. The import's 57-number check folds the six only. | D7 keeps the sheet's sections and orders, so the six stay where the owner reads them and every new bank comes after; the owner's call (final) is that a new bank counts in the Data Report. An archived bank is still counted (DEC-35), never hidden while it holds a number. The workbook knows six banks, so its check is untouched. |
| DEC-41 | **What data-edit's add now refuses, and brings back.** An ARCHIVED code in the acting branch is reactivated with the form's name, area and bank — single 201 with `reactivated: true`, bulk `reactivatedCodes` — instead of 409 / skipped. A code ACTIVE in another branch → 409 `ATM_REGISTER_CODE_ACTIVE_ELSEWHERE` (bulk `refused: activeElsewhere`); a code with an OPEN register period in another branch → 409 `ATM_REGISTER_OPEN_PERIOD_EXISTS` (bulk `refused: openElsewhere`) — nothing written either way. An archived catalog bank → 400 `body.bankName INACTIVE`. Each bulk row is its own unit, so a refused row undoes nothing else; a same-branch race on adding the machine lands in `skippedCodes`. The web says each outcome in words (§8.7): «تمت إضافة الماكينة.» or «أُعيدت الماكينة المؤرشفة للعمل.», then what the register recorded; the bulk result lists the reactivated, refused and unrecorded codes. Existing cross-branch duplicates are left alone (R-9). | A machine handed back and later returned could not be re-added by Operations at all (critic gap 1) — only a register receipt reactivated it. Refusing a code that lives in another branch is what the register's receipt already did (DEC-9, D6); before, data-edit allowed it and the mail matcher stopped matching that code («active in N branches»). One unit per row keeps the legacy's skip-and-name bulk behaviour. |

### 1.3 Revision 4 (2026-10-28) — the bank catalog, bilingual areas, and data-edit adds in the register

The owner's request of 2026-10-27, on `/atm/data-edit`:

> «وبالنسبة لإضافة الماكينات /atm/data-edit البنوك والمناطق مش مسمعه !! من /atm/register ·
> مع العلم عايز لما يتضاف حاجة هنا /atm/data-edit تتضاف هنا /atm/register بحيث شغل العمليات
> ميعطلش ويبقى بتاع الكفاءة والتحقيقات يكمل بياناتها براحته وبرضو يقدروا يضيفوا مناطق وبنوك (عربي
> وأنجليزي)»

Three calls settle it (final):

1. **A bank added at runtime is a FULL register bank.** It appears in the register, the Data Report,
   the settlements and the map. D5's fixed enum becomes the catalog `atm_banks`, seeded with the
   workbook's six (DEC-35, DEC-40).
2. **A machine added on data-edit is recorded in the register** as an OPEN, linked receipt dated the
   add day, flagged «بيانات ناقصة», with a filter for it (DEC-36, DEC-37, DEC-41).
3. **For a new area entered in Arabic and English, the ENGLISH name is stored** on machines —
   «الإنجليزي تمام، كمّل» (DEC-38).

**Defaults kept:**
- Machine add and bulk add stay `atmMachine.manage` only; there is no `atmMachine.create` (DEC-39).
- Machines already active in the Operations list with no open entry are NOT backfilled into the
  register. Efficiency receive them by hand, and the receipt links the existing machine.
- The register import is unchanged. An intake entry made before the cut-over is an `openInRegister`
  blocker, exactly like a manual receipt (DEC-31; §12.2 step 6, R-15).

**Amended by this revision:**
- Decisions: D2, D5, D7, DEC-4 (note), DEC-10, DEC-16 (note), DEC-25, EG-6, EG-11.
- Sections: §3.1, §3.3, §3.5, §5.1, §5.3, §7.1, §8.2–§8.6, §12 and §13. New: §5.12 (server) and
  §8.7 (web).
- Code: `catalogs/bank*.ts`, `catalogs/catalog.migration.ts`, `catalogs/area-labels.ts` and
  `register/operations-intake.ts` (API); `lib/bank-catalog.ts` and `components/catalog/*` (web).

---

## 2. GAP register (recorded, not guessed)

| # | Unknown | What v1 does | Why deferred |
|---|---|---|---|
| EG-1 | Meaning of column M `Alanki` (red header): not-received 862, 0 535, 1 400, يوجد 73, لا يوجد 65. | Stored verbatim in `keys.alanki` (K-class); header shown untranslated. | No source explains it; translating would invent meaning. |
| EG-2 | Manual fills: red fill on 2,106 Area cells (those rows are ~4× less likely to be ended — 11% vs 47%), red headers M/O/Z/AP, pastel rows 1863–2216, yellow 31 rows, light-blue A..E 16 rows, pink 7, orange 3 — and fills that are NOT on column A (re-verified for revision 2: yellow on 27 rows, e.g. 15 only on C and 4 only on AQ; pink on 6 rows 2046–2049, 2224–2225; red beyond B on rows 2309, 3014, 3304, 3343, 3345; mint on AN of 2044–2045). | Import keeps EVERY non-default solid fill of A..AW in `legacyMarks.cellFills` (plus the derived `areaRedFill`/`rowFill`), and the header fills on the run record (`headerFills`); never in any DTO, never displayed. A fill colour is not a secret, so K/S columns are included. | Not random, not documented. |
| EG-3 | AT `Delivered Name`: EgyCash staff or bank-side person (24 cells carry military titles)? Only 331 of 912 ended rows have it; 8 rows have it without an end date. | Free text `handoverName`, label "Delivered name / اسم التسليم" (neutral). | Semantics unknown. |
| EG-4 | Column AX (no header): 21 Google-Maps URLs (rows 1054–1889), `تعديل` ×2, a stray formula-like text. | Not read (D8: A..AW only). | Whether the URLs belong to `locationUrl` of rows whose AV is empty is unknown. |
| EG-5 | Column AY: `=B{r}` with 26 hand overrides (ALEX rows 2203–2217, EL MAHALA 2218–2226, Faisal 2246, `0` 2510). | Not read. | May be intended Area corrections; only Sheet1's VLOOKUP uses them. |
| EG-6 | Area canon: 118 raw / 99 normalized values, 18 case/space collision groups (MOHNDESSEN/Mohndessen/المهندسين …), FX-suffixed and CIB-prefixed names, 13 names under two branches, 297 open rows with no Area. | Areas stored as typed (trimmed). Import: an open row with a blank area LINKS when an active master exists in its branch, otherwise it cannot create/reactivate one (`cannotCouple: blankArea`) and stays `unlinked` until an area is entered (DEC-30). **Amended 2026-10-28 (DEC-38):** still no merge and no rewrite. Each exact trimmed spelling on an active machine, or on an open or pending entry, now becomes a data-edit area label of its branch, on save and through a boot backfill. MOHNDESSEN, Mohndessen and المهندسين are therefore three labels. Operations can add the other language as a display name, or archive one of a pair. A name that was deleted, archived or renamed is never brought back. | Merging would invent data. |
| EG-7 | Canonical HDB ID spelling (`HDB - n` 44, `HDB-ATM n` 32, `HDB-ATMn` 26, 5 bare numbers; 10 machines under two spellings). | Stored as typed (normalized by `normalizeAtmMachineCode` only); import issue `hdbSpelling`; format check is a warning. | `normalizeAtmMachineCode` (`packages/contracts/src/modules/atm.ts:23`) does not unify them; choosing one would rename machines. |
| EG-8 | IDs 2013 and 2015 are open twice (rows 456/2314, 457/2315); also the open row is not the newest for 4670083 and 27740059; 25990095 has an ended and an open row with the same serial and start. | Imported faithfully; pair rows `openPeriodExempt:true` (DEC-11); issues `duplicateOpen`, `openNotNewest`. Both 2013/2015 rows count in the report, as in the Excel. | Which row is correct is the team's answer. |
| EG-9 | Meaning of rows without a start date (23: rows 2958, 3002, 3114, 3343, 3345 with no branch; 3304; 3416; the 16 EGYCASH-7 Badr rows 3372–3387). | Status `pending`, label "No start date / بدون تاريخ بدء"; no master effect; can be received later (DEC-12). | "Planned" vs "should not exist" is undecided. |
| EG-10 | Mobile ATMs / Mid-Bus units: 16 IDs redeploy every 1–3 weeks with PLANNED future end dates (e.g. 23000017, 9 periods). Under end-date-only (D7) typing a planned end date archives the machine for Operations immediately. | Allowed with warning `futureDate`; imported future ends are `ended` (as the Excel counts them). | Needs an owner rule (as-of handling) that D7 deliberately excluded. |
| EG-11 | Efficiency users: one central team or per-branch staff; do Operations need read access to the register? | Grants are data: a central team gets organization scope; per-branch teams get branch scope. No role is seeded (§12.3 lists the bundles). Since revision 4 this includes the bank catalog keys `atmBank.create` / `atmBank.edit`: after the deploy only super-admin holds them (§12.3 rollout note). | Owner/HR decision. |
| EG-12 | Received/Delivered names as free text vs employee pick-lists (271–307 distinct people after folding; multi-person cells; placeholders `الخط`, `توريد`). | Free text, as in the Excel. | Not specified. |
| EG-13 | Other workbook sheets: `movement NBE` (could be generated from the register: 216/217 receipts and 53/55 handovers match AQ/AR), `Sheet1` (re-exposes AO and J via VLOOKUP), `Vandalizm` (5 incidents keyed by ATM ID), `معاينة أمنية`, hidden `اصلاح كاسيتات`. | Out of scope. | Not requested. Sheet1 keeps exposing secrets outside ECMS until retired (risk R-1). |
| EG-14 | Print and export expectations for both pages (Excel print area A1:AV4999 excludes HUB; Data Report prints portrait at 19%). | Register: CSV export (D-listed action). Report: no print/export in v1. | Unstated. |
| EG-15 | Undoing a mistaken handover. | No reopen action (DEC-13). | Not in the owner's action list. |
| EG-16 | `/atm/machines` loads at most 100 rows with no pager (`apps/web/src/modules/atm/pages/MachinesPage.tsx:44-65`; `MAX_PAGE_SIZE=100`, `packages/contracts/src/common/index.ts:81`). After cut-over every branch has > 100 active machines (EGYCASH-1: 1,061). | Unchanged (out of scope). | A separate Operations fix; flagged to the owner. |
| EG-17 | Accepting a pending mail ticket for a machine the register has archived still opens a maintenance (`modules/atm/maintenances/maintenance.service.ts:177-180`). | Unchanged (pre-existing). | Operations behaviour; owner to decide. |
| EG-18 | `EGYCASH-7 = وصال`: the IT go-live records the owner's statement that وصال is الشروق (`modules/it/go-live/inventory-import.ts:136-137`). | The admin picks the ECMS branch in the settings card; nothing is pre-filled. | Branches come only from the workforce import (`workforce-import/org.ts:8-11`); the mapping is the admin's act. |
| EG-19 | Production `atm_machines` / `atm_ref_labels` contents and branch layout are unknown (not visible to this design; synthesis gaps EG-6 second half and EG-7), including whether `npm run atm:import` has run. Legacy ATM ran as FOUR deployments — HQ :3000, Alex :4000, Tanta :4001 (`/home/user/ATM/contad_app.js:220-224`), Port Said :4002 (`views/events/data_edit_atm.ejs:288-290`) — while the register has SEVEN codes, and the importer files a whole deployment under ONE ECMS branch (`apps/api/src/atm-import.cli.ts:1-9`; port doc §7). If HQ's machines (serving e.g. أكتوبر, أسيوط, وصال) sit in one ECMS branch, every open row of the other branches whose code is active there is refused by DEC-9. | The preview shows these rows as the report category `activeElsewhere` with from-branch → to-branch counts and items; nothing is moved. The owner decides the resolution (e.g. an admin archives the other branch's master in data-edit, then `POST /entries/:id/link` couples the entry — DEC-30). | Moving a machine between branches' Operations lists is the owner's decision; v1 does not invent a "move" category. |
| EG-20 | Time cells holding a day or more under an `h:mm` format: AK 19 + AL 53 cells equal exactly 1.0 (Excel shows `0:00`; probably typed `24:00`), AK 5 + AL 1 exceed one day (Excel shows the wrapped time of day). | Stored as Excel SHOWS them (time of day, `HH:mm`), with issue `timeOverDay` whose detail keeps the number of days (`1`, `3.75`) — nothing is lost and nothing is interpreted. | Whether 1.0 means 24:00 is the owner's answer. |
| EG-21 | Total label spelling: the sheet writes «اجمالى عدد الماكينات» (AJ2, AK4); the repository's formal-Arabic guard rejects «اجمالى» (`scripts/check-formal-arabic.mjs:106`). D7 lists only three label fixes. | Provisional mapping «اجمالى» → «إجمالي» (DEC-28). | Two owner rules conflict; the owner chooses. |

---

## 3. Contracts — `packages/contracts/src/modules/atm-register.ts` (NEW, WP-A)

Everything below is normative: names, values and shapes are the contract between work packages.
Imports: `import { z } from 'zod'; import { PaginationQuerySchema, booleanQuery, listQuery, objectId, type LocalizedString } from '../common/index.js'; import { normalizeAtmMachineCode } from './atm.js';`
Export from `packages/contracts/src/index.ts` with `export * from './modules/atm-register.js';`
directly after the `atm.js` line (`index.ts:67`).

### 3.1 Banks (D5, as amended by DEC-35)

**Amended 2026-10-28.** The six-code enum this section first declared is now the bank catalog's seed
(DEC-35). `ATM_BANK_CODES`, `ATM_BANK_NAMES`, `ATM_BANK_REPORT_COLORS` and
`ATM_DEFAULT_OPS_BANK_LABELS` are deleted with no alias: every `X[code]` that assumed six banks
stopped compiling, and that compiler list was the migration checklist. The code SHAPE lives in
`atm.ts`, because the ref-label schemas there validate a spelling's `bankCode` with it and `atm.ts`
may not import this file back (a module cycle).

```ts
// atm.ts
export const ATM_BANK_CODE_PATTERN = /^[A-Z][A-Z0-9]{1,9}$/;

// atm-register.ts
/** The shape only — whether a code EXISTS is the server's question (the catalog). */
export const AtmBankCodeSchema = z.string().regex(ATM_BANK_CODE_PATTERN);
export type AtmBankCode = string;                       // a seventh bank is data, not a type
export const ATM_SEED_BANK_CODES = ['NBE', 'BM', 'CIB', 'HDB', 'BRK', 'NXT'] as const;
export type AtmSeedBankCode = (typeof ATM_SEED_BANK_CODES)[number];
export const isAtmSeedBankCode = (code: string): code is AtmSeedBankCode => …;

/** The six seeds — the Data Report's names, the chart-3 colours (D7), the D5 labels, section-3 order × 10. */
export interface AtmBankSeed { code: AtmSeedBankCode; name: LocalizedString; color: string; opsLabel: string; sortOrder: number }
export const ATM_BANK_SEED: readonly AtmBankSeed[] = [
  { code: 'NBE', name: { ar: 'البنك الأهلي المصري', en: 'National Bank of Egypt' }, color: '#385723', opsLabel: 'NBE', sortOrder: 10 },
  { code: 'BM', name: { ar: 'بنك مصر', en: 'Banque Misr' }, color: '#AC2100', opsLabel: 'MISR', sortOrder: 20 },
  { code: 'CIB', name: { ar: 'البنك التجارى الدولى', en: 'Commercial International Bank' }, color: '#FFD966', opsLabel: 'CIB', sortOrder: 30 },
  { code: 'HDB', name: { ar: 'بنك التعمير والاسكان', en: 'Housing and Development Bank' }, color: '#B4C7E7', opsLabel: 'HDB', sortOrder: 40 },
  { code: 'BRK', name: { ar: 'بنك البركة', en: 'Al Baraka Bank' }, color: '#F4B183', opsLabel: 'BRK', sortOrder: 50 },
  { code: 'NXT', name: { ar: 'NXT BANK', en: 'NXT BANK' }, color: '#000099', opsLabel: 'NXT', sortOrder: 60 },
];
export const atmBankSeedOf = (code: string): AtmBankSeed | undefined => …;
/** Charts 1–2: the workbook theme's accent1 (xl/theme/theme1.xml), the Excel's single series (DEC-19). */
export const ATM_REPORT_TOTALS_COLOR = '#4472C4';
export const ATM_BANK_COLOR_PATTERN = /^#[0-9A-F]{6}$/;
/** A new bank's default colour, the first no bank wears — none equals a seed's or the totals colour. */
export const ATM_BANK_EXTRA_COLORS = ['#7030A0', '#00B0F0', '#00B050', '#FF66CC', '#7F6000', '#008080', '#C55A11', '#92D050'];
/** Import-only spellings (exact match after trim). Row 2120 is the only one. */
export const ATM_REGISTER_BANK_ALIASES: Readonly<Record<string, AtmSeedBankCode>> = { 'نيكست': 'NXT' };
export const ATM_NBE_FOREX_LABEL = 'NBE FOREX';

/** D6: per-bank ID shapes — a WARNING, never a block. The six only, kept in code (DEC-35); a Map, so a crafted key cannot reach Object.prototype. */
export const ATM_REGISTER_ID_FORMATS: ReadonlyMap<string, RegExp> = new Map([
  ['NBE', /^\d{8}$/], ['BM', /^\d{7}$/], ['CIB', /^\d{1,4}$/],
  ['HDB', /^HDB(?: - |-ATM ?)\d+$/], ['BRK', /^BRK[NW]\d+$/], ['NXT', /^ATM\d{4}$/],
]);
export const atmRegisterIdFormatOk = (bank: AtmBankCode, code: string): boolean =>
  ATM_REGISTER_ID_FORMATS.get(bank)?.test(code) ?? true;   // a bank with no format never warns

// The bank catalog (DEC-35) — GET/POST /atm/banks, PATCH /atm/banks/:code
export interface AtmBankDto { id; code; name: LocalizedString; opsLabel; formerOpsLabels: string[]; color; sortOrder;
  isActive; isSeed; hasIdFormat; version; createdAt; updatedAt }
export const CreateAtmBankSchema;   // strict: code (trimmed, upper-cased, the pattern), name { ar, en } (trimmed, 1–80 each),
                                    // opsLabel? (1–64, default the code), color? (trimmed, upper-cased hex), sortOrder? (0–100000)
export const UpdateAtmBankSchema;   // strict: name?, opsLabel?, color?, sortOrder?, isActive?, version
export const atmBankLabelKey = (label: string): string => label.trim().toUpperCase();
export const atmBankName = (code, locale, banks?) => …;    // the catalog's name, else the seed's, else the code
export const atmBankColor = (code, banks?) => …;           // the catalog's colour, else the seed's, else null (the web draws grey)
```

### 3.2 Branch codes (D4)

```ts
export const ATM_REGISTER_BRANCH_CODES = [
  'EGYCASH-1', 'EGYCASH-2', 'EGYCASH-3', 'EGYCASH-4', 'EGYCASH-5', 'EGYCASH-6', 'EGYCASH-7',
] as const;
export const AtmRegisterBranchCodeSchema = z.enum(ATM_REGISTER_BRANCH_CODES);
export type AtmRegisterBranchCode = z.infer<typeof AtmRegisterBranchCodeSchema>;
/** The sheet's own branch names (ATMs DE1..DK1 + Data Report row 4), D7 typo fix applied. */
export const ATM_REGISTER_BRANCH_NAMES: Readonly<Record<AtmRegisterBranchCode, LocalizedString>> = {
  'EGYCASH-1': { ar: 'المهندسين', en: 'Mohandessin' },
  'EGYCASH-2': { ar: 'طنطا', en: 'Tanta' },
  'EGYCASH-3': { ar: 'أسيوط', en: 'Asyut' },
  'EGYCASH-4': { ar: 'الإسكندرية', en: 'Alexandria' },
  'EGYCASH-5': { ar: 'أكتوبر', en: 'October' },
  'EGYCASH-6': { ar: 'بور سعيد', en: 'Port Said' },
  'EGYCASH-7': { ar: 'وصال', en: 'Wisal' },
};
```

### 3.3 Settings value schemas (D4, D5) — keys added to `AtmSettingKeys` in `atm.ts:559-579`

```ts
// in packages/contracts/src/modules/atm.ts, inside AtmSettingKeys:
RegisterBranchCodes: 'atm.register.branchCodes',
RegisterBankLabels: 'atm.register.bankLabels',

// in atm-register.ts:
const uniqueBy = <T>(pick: (row: T) => string) => (rows: readonly T[]): boolean =>
  new Set(rows.map(pick)).size === rows.length;
export const AtmRegisterBranchCodesSettingSchema = z
  .array(z.object({ code: AtmRegisterBranchCodeSchema, branchId: objectId() }).strict())
  .max(7)
  .refine(uniqueBy((r) => r.code), 'each code once')
  .refine(uniqueBy((r) => r.branchId), 'each branch once');
export type AtmRegisterBranchCodesSetting = z.infer<typeof AtmRegisterBranchCodesSettingSchema>;
/** RETIRED (DEC-35): read once, by the bank catalog seed. Still the six only — no catalog bank was ever in it. */
export const AtmRegisterBankLabelsSettingSchema = z
  .array(z.object({ bankCode: z.enum(ATM_SEED_BANK_CODES), label: z.string().trim().min(1).max(64) }).strict())
  .max(6)
  .refine(uniqueBy((r) => r.bankCode), 'each bank once');
export type AtmRegisterBankLabelsSetting = z.infer<typeof AtmRegisterBankLabelsSettingSchema>;
export const ATM_DEFAULT_BANK_LABELS_SETTING: AtmRegisterBankLabelsSetting = ATM_BANK_SEED.map(
  (seed) => ({ bankCode: seed.code, label: seed.opsLabel }),
);
```
Default of `branchCodes` is `[]` (no branch is guessed — EG-18). A stored `bankLabels` value that
omits a bank falls back to the default label for that bank. Since DEC-35 that fallback happens once,
when the catalog seed first inserts the six; afterwards each bank's `opsLabel` is the label.

### 3.4 Status, dates, active (D1, D7)

```ts
export const ATM_REGISTER_STATUSES = ['pending', 'open', 'ended'] as const;
export const AtmRegisterStatusSchema = z.enum(ATM_REGISTER_STATUSES);
export type AtmRegisterStatus = z.infer<typeof AtmRegisterStatusSchema>;
/** D1 — the ONLY way a status is produced. Never read from input. */
export const deriveAtmRegisterStatus = (
  startDate: string | Date | null, endDate: string | Date | null,
): AtmRegisterStatus => (endDate !== null ? 'ended' : startDate !== null ? 'open' : 'pending');
/** D7 — Excel helper CI `=IF(A>0,IF(AQ>0,IF(AR="",1,0)))`. */
export const isAtmRegisterActive = (e: {
  hasBranch: boolean; startDate: string | Date | null; endDate: string | Date | null;
}): boolean => e.hasBranch && e.startDate !== null && e.endDate === null;

/** Calendar date `YYYY-MM-DD`; stored as UTC midnight (the HR business-date convention). */
export const AtmRegisterDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => { const d = new Date(`${s}T00:00:00.000Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; }, 'not a calendar date');
```

### 3.5 Data Report — orders, cells and the ONE fold (D7)

**Amended 2026-10-28 (DEC-40).** The orders below are the SHEET's six; the report folds the
catalog's banks, so a bank added since is appended by `atmReportBankOrders` (after BRK in section 1,
after NXT in section 3). The fold's `banks` defaults to the six, which is what the import's
57-number check passes — so that check is still the workbook's arithmetic.

```ts
export const ATM_REPORT_SECTION1_BANKS: readonly AtmSeedBankCode[] = ['NXT', 'NBE', 'BM', 'CIB', 'HDB', 'BRK']; // AD2..AI2
export const ATM_REPORT_SECTION2_BRANCHES: readonly AtmRegisterBranchCode[] =
  ['EGYCASH-7', 'EGYCASH-1', 'EGYCASH-2', 'EGYCASH-3', 'EGYCASH-4', 'EGYCASH-5', 'EGYCASH-6']; // AD4..AJ4
export const ATM_REPORT_SECTION3_BRANCHES: readonly AtmRegisterBranchCode[] =
  ['EGYCASH-1', 'EGYCASH-5', 'EGYCASH-2', 'EGYCASH-3', 'EGYCASH-4', 'EGYCASH-6', 'EGYCASH-7']; // AD8..AD14
export const ATM_REPORT_SECTION3_BANKS: readonly AtmSeedBankCode[] = ['NBE', 'BM', 'CIB', 'HDB', 'BRK', 'NXT']; // AE7..AJ7

/** DEC-40: the six at their sheet positions, then every other bank in the order given (seeds and repeats dropped). */
export const atmReportBankOrders = (extras: readonly AtmBankCode[]): { section1: AtmBankCode[]; section3: AtmBankCode[] } =>
  ({ section1: [...ATM_REPORT_SECTION1_BANKS, ...tail], section3: [...ATM_REPORT_SECTION3_BANKS, ...tail] });

/** One group of ACTIVE entries. `branchCode:null` = branch set but not mapped. */
export interface AtmRegisterReportGroup {
  branchCode: AtmRegisterBranchCode | null;
  bankCode: AtmBankCode | null;
  count: number;
}
export interface AtmRegisterReportCounts {
  /** One cell per bank folded (the six, then any catalog bank) + `total` (= Σ the bank cells, as `=SUM(AD3:AI3)`). */
  section1: Record<AtmBankCode, number> & { total: number };
  /** AD5..AJ5 + AK5 (total = Σ the branch cells shown). Only branches in `branchesShown`. */
  section2: Partial<Record<AtmRegisterBranchCode, number>> & { total: number };
  /** rows 8–14 × one column per bank folded. No totals (the Excel has none). */
  section3: Partial<Record<AtmRegisterBranchCode, Record<AtmBankCode, number>>>;
  /** ACTIVE with a branch outside the mapping: counted in section 1 only. */
  activeWithUnmappedBranch: number;
  /** ACTIVE with no bank: counted in sections 2/3 rows only, never in a bank cell. */
  activeWithoutBank: number;
}
/**
 * The single implementation of D7 — used by the report endpoint AND the import's 57-number check.
 * Every cell is a number (0 when nothing), never absent.
 */
export const foldAtmRegisterReport = (
  groups: readonly AtmRegisterReportGroup[],
  branchesShown: readonly AtmRegisterBranchCode[] = ATM_REGISTER_BRANCH_CODES,
  banks: readonly AtmBankCode[] = ATM_SEED_BANK_CODES,   // the report passes the catalog's (DEC-40)
): AtmRegisterReportCounts => { /* the cells are `banks`, then any code a group carries that `banks` lacks
  (sorted — so section 1 and section 2 can never disagree);
  section1[bank] += count for every group with bankCode (any branch);
  section2[branch] += count for every group whose branchCode ∈ branchesShown;
  section3[branch][bank] += count for groups with both, branch ∈ branchesShown;
  activeWithUnmappedBranch += count where branchCode === null;
  activeWithoutBank += count where bankCode === null;
  totals = Σ of the cells of that section. */ };

/** One numeric cell — the sheet's 57, or a catalog bank's (`cell: ''`, the workbook has no such cell). */
export interface AtmReportCellRef { key: string; cell: string; section: 1 | 2 | 3;
  branchCode: AtmRegisterBranchCode | null; bankCode: AtmBankCode | null; isTotal: boolean }
/** The cells for any bank orders: a seed keeps its sheet letter at its sheet position, a catalog bank gets cell ''. */
export const buildAtmReportCells = (section1Banks: readonly AtmBankCode[], section3Banks: readonly AtmBankCode[]): AtmReportCellRef[];
export const ATM_DATA_REPORT_CELLS: readonly AtmReportCellRef[] =
  buildAtmReportCells(ATM_REPORT_SECTION1_BANKS, ATM_REPORT_SECTION3_BANKS); // the same 57, byte for byte (pinned by a spec):
// section 1: AD3..AI3 (banks in SECTION1 order) + AJ3 total  → keys 's1.NXT' … 's1.total'
// section 2: AD5..AJ5 (SECTION2 order) + AK5 total          → keys 's2.EGYCASH-7' … 's2.total'
// section 3: rows 8..14 (SECTION3_BRANCHES) × AE..AJ (SECTION3_BANKS) → keys 's3.EGYCASH-1.NBE' …
// 7 + 8 + 42 = 57 (verified count: dataVerify "Data Report has 57 numeric formula cells").
/** A branch outside `branchesShown`, or a bank not folded, reads 0. */
export const readAtmReportCell = (counts: AtmRegisterReportCounts, ref: AtmReportCellRef): number;
```

### 3.6 Column catalogue (single source for import binding, export, grid, i18n tests)

```ts
export const ATM_REGISTER_GROUPS = ['identity','keys','cassettes','hours','secret','location','lifecycle','hub'] as const;
export type AtmRegisterGroup = (typeof ATM_REGISTER_GROUPS)[number];
/** P = everyone with atmRegister.view; K = viewSecrets only; S = sealed, reveal endpoint only. */
export type AtmRegisterSensitivity = 'P' | 'K' | 'S';
export interface AtmRegisterColumnDef {
  excel: string;            // 'A' … 'AW'
  header: string;           // the EXACT row-1 text, newlines and stray spaces included
  occurrence: number;       // 0-based nth occurrence of `header` in A..AW
  field: AtmRegisterField;  // dotted path into the entry, e.g. 'keys.supervisorCode'
  group: AtmRegisterGroup;
  sensitivity: AtmRegisterSensitivity;
  excelWidth: number;       // the sheet's <col width>, for the grid (§8.3)
}
export const ATM_REGISTER_COLUMNS: readonly AtmRegisterColumnDef[]; // the 49 rows of §4, in A..AW order
/** Display order (the owner's register layout: the Location group is AP + AV): A..AO, AP, AV, AQ..AU, AW. */
export const ATM_REGISTER_DISPLAY_ORDER: readonly string[]; // Excel letters
```
`AtmRegisterField` is the union of the 49 field paths in §4.

### 3.7 Input schemas

```ts
/** Trim (JS `\s` covers NBSP and TAB), '' → null. Messages never echo the value. */
const text = (max: number) =>
  z.string().max(max).transform((s) => (s.trim() === '' ? null : s.trim())).nullable();

export const AtmRegisterKeysInputSchema = z.object({
  supervisorCode: text(500).optional(), supervisorCount: text(200).optional(),
  safeDoorCount: text(200).optional(), alanki: text(200).optional(),
  combinationKeyCode: text(500).optional(), combinationKeyCount: text(200).optional(),
  cashUnitCode: text(500).optional(), cashUnitCount: text(200).optional(),
}).strict();
export const AtmRegisterCassettesInputSchema = z.object({
  withdrawalType: text(120).optional(), withdrawalCount: text(120).optional(),
  withdrawal1: text(120).optional(), withdrawal2: text(120).optional(), withdrawal3: text(120).optional(),
  withdrawal4: text(120).optional(), withdrawal5: text(120).optional(),
  depositType: text(120).optional(), depositCount: text(120).optional(), collectionCount: text(120).optional(),
  recycle200: text(120).optional(), recycle100: text(120).optional(), recycle50: text(120).optional(),
  spareCount: text(120).optional(),
  spare1: text(120).optional(), spare2: text(120).optional(), spare3: text(120).optional(),
  spare4: text(120).optional(), spare5: text(120).optional(),
}).strict();

const commonFields = {
  area: text(120).optional(),
  bankCode: AtmBankCodeSchema.nullable().optional(),
  opsBankLabel: text(64).optional(),
  name: z.string().trim().min(1).max(300),
  operationType: text(120).optional(), vendor: text(120).optional(),
  model: text(120).optional(), serial: text(120).optional(),
  keys: AtmRegisterKeysInputSchema.optional(),           // K — viewSecrets (DEC-7)
  cassettes: AtmRegisterCassettesInputSchema.optional(),
  openTime: text(120).optional(), closeTime: text(120).optional(),
  accessHoursNotes: text(2000).optional(),
  receiptNotes: text(4000).optional(),                   // K
  locationPlusCode: text(500).optional(), locationUrl: text(2048).optional(), hub: text(200).optional(),
  receivedByName: text(300).optional(),
};

/** POST /atm/register/entries — Receive (startDate set) or a pending entry (startDate absent/null). */
export const ReceiveAtmRegisterEntrySchema = z.object({
  branchId: objectId(),
  machineCode: z.string().max(64).optional(),            // normalized server-side (atm.ts:23)
  ...commonFields,
  safeCombination: text(200).optional(),                 // S — viewSecrets (DEC-7)
  startDate: AtmRegisterDateSchema.nullable().optional(),
}).strict().superRefine((v, ctx) => {
  if (v.startDate === undefined || v.startDate === null) return;
  if (v.bankCode === undefined || v.bankCode === null) ctx.addIssue({ code: 'custom', path: ['bankCode'], message: 'required when startDate is set' });
  if (v.machineCode === undefined || normalizeAtmMachineCode(v.machineCode) === '') ctx.addIssue({ code: 'custom', path: ['machineCode'], message: 'required when startDate is set' });
  if (v.area === undefined || v.area === null) ctx.addIssue({ code: 'custom', path: ['area'], message: 'required when startDate is set' }); // D6
});
export type ReceiveAtmRegisterEntry = z.infer<typeof ReceiveAtmRegisterEntrySchema>;

/** PATCH /atm/register/entries/:id — partial; `keys`/`cassettes` merge per sub-field. */
export const UpdateAtmRegisterEntrySchema = z.object({
  area: text(120).optional(),
  bankCode: AtmBankCodeSchema.nullable().optional(),
  opsBankLabel: text(64).optional(),
  machineCode: z.string().max(64).optional(),            // pending, or open ∧ unlinked (§5.6, DEC-30)
  name: z.string().trim().min(1).max(300).optional(),
  operationType: text(120).optional(), vendor: text(120).optional(),
  model: text(120).optional(), serial: text(120).optional(),
  keys: AtmRegisterKeysInputSchema.optional(),           // K
  cassettes: AtmRegisterCassettesInputSchema.optional(),
  openTime: text(120).optional(), closeTime: text(120).optional(),
  accessHoursNotes: text(2000).optional(),
  receiptNotes: text(4000).optional(),                   // K
  safeCombination: z.union([z.string().trim().min(1).max(200), z.null()]).optional(), // S; null clears, absent keeps
  locationPlusCode: text(500).optional(), locationUrl: text(2048).optional(), hub: text(200).optional(),
  startDate: AtmRegisterDateSchema.optional(),           // open/ended only, never cleared
  endDate: AtmRegisterDateSchema.optional(),             // ended only, never cleared
  receivedByName: text(300).optional(),
  handoverName: text(300).optional(),                    // ended only
  handoverNotes: text(4000).optional(),                  // ended only, K
  version: z.number().int().min(0),
}).strict();
export type UpdateAtmRegisterEntry = z.infer<typeof UpdateAtmRegisterEntrySchema>;

/** POST /atm/register/entries/:id/receive — pending → open. */
export const ReceivePendingAtmRegisterEntrySchema = z.object({
  startDate: AtmRegisterDateSchema,
  area: text(120).optional(), bankCode: AtmBankCodeSchema.optional(),
  machineCode: z.string().max(64).optional(), opsBankLabel: text(64).optional(),
  receivedByName: text(300).optional(),
  version: z.number().int().min(0),
}).strict();

/** POST /atm/register/entries/:id/handover — open → ended. An ABSENT field keeps the stored value
 *  (8 imported open rows already carry AT, 7 carry AU); a sent value — `null`/'' included — replaces it. */
export const HandoverAtmRegisterEntrySchema = z.object({
  endDate: AtmRegisterDateSchema,
  handoverName: text(300).optional(),
  handoverNotes: text(4000).optional(),                  // K
  version: z.number().int().min(0),
}).strict();

/** DELETE /atm/register/entries/:id (body). */
export const DeleteAtmRegisterEntrySchema = z.object({ version: z.number().int().min(0) }).strict();

/** POST /atm/register/entries/:id/link — couple an OPEN, unlinked entry to Operations (DEC-30). */
export const LinkAtmRegisterEntrySchema = z.object({ version: z.number().int().min(0) }).strict();

export const ATM_REGISTER_SORT_FIELDS = ['createdAt','branchId','area','bankCode','machineCode','name','startDate','endDate','status'] as const;
export const ListAtmRegisterEntriesQuerySchema = PaginationQuerySchema.extend({
  branchId: objectId().optional(),
  banks: listQuery(AtmBankCodeSchema),
  statuses: listQuery(AtmRegisterStatusSchema),
  area: z.string().trim().min(1).max(120).optional(),
  search: z.string().trim().min(1).max(100).optional(),
  withIssues: booleanQuery().optional(),
}).strict();
export type ListAtmRegisterEntriesQuery = z.infer<typeof ListAtmRegisterEntriesQuerySchema>;
export const ExportAtmRegisterEntriesQuerySchema = ListAtmRegisterEntriesQuerySchema.omit({ page: true, pageSize: true });
export const AtmRegisterBranchOptionsQuerySchema = z.object({ branchId: objectId() }).strict();
```
Rule for every schema carrying a K/S field: no `.regex`, `.enum`, `.email` or custom refinement on
that field — Zod's default `max` and type messages never contain the input; an enum or regex
message could.

### 3.8 DTOs

```ts
export interface AtmRegisterKeysDto { supervisorCode: string | null; supervisorCount: string | null;
  safeDoorCount: string | null; alanki: string | null; combinationKeyCode: string | null;
  combinationKeyCount: string | null; cashUnitCode: string | null; cashUnitCount: string | null }
export interface AtmRegisterCassettesDto { /* the 19 cassette fields of §3.7, each string | null */ }
/** `unlinked` = an OPEN entry with no `machineId` (DEC-30); the other four describe a linked master. */
export const ATM_REGISTER_MASTER_STATES = ['active', 'archived', 'deleted', 'missing', 'unlinked'] as const;
export type AtmRegisterMasterState = (typeof ATM_REGISTER_MASTER_STATES)[number];
export interface AtmRegisterImportIssueDto {
  code: AtmRegisterImportIssueCode; column: string | null;
  /** Only for P-class columns; ALWAYS null for J..Q, AN, AO, AU. */
  detail: string | null;
}
export interface AtmRegisterEntryDto {
  id: string;
  branchId: string | null;
  branchCode: AtmRegisterBranchCode | null;     // resolved from the setting at read time
  area: string | null;
  bankCode: AtmBankCode | null;
  opsBankLabel: string | null;                   // the stored override (null = automatic)
  effectiveOpsBankLabel: string | null;          // override ?? setting label for bankCode
  machineCode: string | null;
  machineId: string | null;
  masterState: AtmRegisterMasterState | null;    // 'unlinked' when open ∧ machineId null; null for pending/ended without machineId (DEC-24, DEC-30)
  name: string | null;                           // null only on an imported row with a blank E (DEC-32)
  operationType: string | null; vendor: string | null; model: string | null; serial: string | null;
  secretsVisible: boolean;                       // DEC-7 / D3, per entry (§5.4)
  keys: AtmRegisterKeysDto | null;               // null when !secretsVisible
  cassettes: AtmRegisterCassettesDto;
  openTime: string | null; closeTime: string | null; accessHoursNotes: string | null;
  receiptNotes: string | null;                   // null when !secretsVisible
  safeCombinationSet: boolean;                   // the ONLY trace of AO in any DTO
  locationPlusCode: string | null; locationUrl: string | null; hub: string | null;
  startDate: string | null; endDate: string | null;   // 'YYYY-MM-DD'
  receivedByName: string | null; handoverName: string | null;
  handoverNotes: string | null;                  // null when !secretsVisible
  status: AtmRegisterStatus;
  source: 'manual' | 'import';
  importRow: number | null;
  importIssues: AtmRegisterImportIssueDto[];
  version: number; createdAt: string; updatedAt: string;
}
export const ATM_REGISTER_WARNINGS = ['idFormat','serialDuplicate','endBeforeStart','futureDate','masterDiffers','opsBankLabelIgnored','codeActiveElsewhere'] as const;
// codeActiveElsewhere: an edit that set the area of an unlinked entry could not couple it (DEC-9/DEC-30); the edit is saved.
export type AtmRegisterWarning = (typeof ATM_REGISTER_WARNINGS)[number];
export const ATM_REGISTER_MASTER_ACTIONS = ['link','reactivate','create','archive','sync','none'] as const;
export type AtmRegisterMasterAction = (typeof ATM_REGISTER_MASTER_ACTIONS)[number];
export interface AtmRegisterWriteResultDto {
  entry: AtmRegisterEntryDto;
  warnings: AtmRegisterWarning[];
  master: { action: AtmRegisterMasterAction; machineId: string | null };
}
export interface AtmRegisterRevealDto { safeCombination: string | null }
export interface AtmRegisterMetaDto {
  banks: { code: AtmBankCode; name: LocalizedString; opsLabel: string; color: string }[];
  branches: { code: AtmRegisterBranchCode; name: LocalizedString; branchId: string | null;
    branchName: LocalizedString | null; branchActive: boolean; canView: boolean; canCreate: boolean }[];
}
export interface AtmRegisterBranchOptionsDto {
  branchId: string;
  areaLabels: string[]; bankLabels: string[];     // ACTIVE atm_ref_labels of that branch
  areas: string[]; operationTypes: string[]; vendors: string[]; models: string[]; hubs: string[]; // distinct entry values
}
export interface AtmRegisterReportDto {
  generatedAt: string;                            // ISO — the as-of stamp (D7)
  branchesShown: AtmRegisterBranchCode[];         // mapped ∩ in scope (DEC-27)
  counts: AtmRegisterReportCounts;
}
```

### 3.9 Import vocabulary (§6)

```ts
export const ATM_REGISTER_IMPORT_ISSUES = [
  'noBranch','unknownBranchCode','areaError','openNoArea','bankAlias','unknownBank','noBank',
  'noCode','placeholderCode','codeWhitespace','idFormat','hdbSpelling','duplicateOpen','openNotNewest',
  'serialDuplicate','exactDuplicate','timeOverDay','aoShape','dateSerial','dateInvalid',
  'endBeforeStart','futureStart','futureEnd','dateInText','errorValue','noName',
] as const;
export type AtmRegisterImportIssueCode = (typeof ATM_REGISTER_IMPORT_ISSUES)[number];
/** Approvable, applied only when named in `apply`. */
export const ATM_REGISTER_IMPORT_CATEGORIES = ['entries','link','reactivate','create','nbeForex'] as const;
export type AtmRegisterImportCategory = (typeof ATM_REGISTER_IMPORT_CATEGORIES)[number];
/** Report-only. The last two are the item lists behind the blockers of the same name (DEC-31). */
export const ATM_REGISTER_IMPORT_REPORTS = ['cannotCouple','activeElsewhere','activeMasterWithoutOpenEntry','openInRegister','changedSinceImport'] as const;
export const ATM_REGISTER_IMPORT_REASONS = ['blankArea','activeElsewhere','noCode','placeholderCode','noBank','noName','labelMissing','keepsMasterLabel','notImported'] as const;
export const ATM_REGISTER_IMPORT_BLOCKERS = ['branchUnmapped','branchInactive','branchOutOfReach','secretsOutOfReach','reportMismatch','dateUnreadable','openInRegister','changedSinceImport','secretStoreUnavailable','runInProgress'] as const;
export const ATM_REGISTER_IMPORT_RUN_STATES = ['running','completed','failed','abandoned'] as const;
/** Keys of `counts` on an applied result / run (§6.6). */
export const ATM_REGISTER_IMPORT_OUTCOMES = ['imported','alreadyImported','linked','reactivated','created','nbeForex','cannotCouple','notApproved','openInRegister'] as const;

export interface AtmRegisterImportItemDto {
  importRow: number; branchCode: AtmRegisterBranchCode | null; machineCode: string | null;
  name: string | null; area: string | null; bankCode: AtmBankCode | null;
  machineId: string | null;                 // the master this item links/reactivates
  masterBankLabel: string | null;           // link: the label adopted (D5)
  reason: (typeof ATM_REGISTER_IMPORT_REASONS)[number] | null;
  differences: ('name' | 'area')[];         // link only (DEC-8)
  /** activeElsewhere / openInRegister: where the conflicting master or entry is — named only when
   *  the importer's `atmRegister.import` reaches that branch (else both null). */
  otherBranchCode: AtmRegisterBranchCode | null; otherBranchName: LocalizedString | null;
  entryId: string | null;                   // openInRegister / changedSinceImport: the stored entry
  columns: string[];                        // changedSinceImport: Excel letters that differ — NEVER values
}
export interface AtmRegisterImportCategoryDto {
  key: AtmRegisterImportCategory | (typeof ATM_REGISTER_IMPORT_REPORTS)[number];
  approvable: boolean; count: number; items: AtmRegisterImportItemDto[];
  /** activeElsewhere only: one row per (other branch → this row's branch); [] elsewhere. */
  pairs: { fromBranchCode: AtmRegisterBranchCode | null; fromBranchName: LocalizedString | null;
           toBranchCode: AtmRegisterBranchCode; count: number }[];
}
export interface AtmRegisterImportReportCellDto extends AtmReportCellRef {
  expected: number; recomputed: number; matches: boolean;
}
export interface AtmRegisterImportResultDto {
  mode: 'preview' | 'applied';
  fileName: string; fileSha256: string;
  sheet: { firstDataRow: 3; lastDataRow: number; sentinelRow: number | null };
  counts: { rows: number; open: number; ended: number; pending: number; alreadyImported: number };
  blockers: (typeof ATM_REGISTER_IMPORT_BLOCKERS)[number][];
  report: { cells: AtmRegisterImportReportCellDto[]; allMatch: boolean };
  issues: { byCode: { code: AtmRegisterImportIssueCode; count: number }[];
            rows: { importRow: number; issues: AtmRegisterImportIssueDto[] }[] };
  branches: { code: AtmRegisterBranchCode; branchId: string | null; branchName: LocalizedString | null;
              active: boolean; inReach: boolean; rows: number; openRows: number }[];
  categories: AtmRegisterImportCategoryDto[];
  applied: { runId: string; categories: AtmRegisterImportCategory[]; reportOverride: boolean;
             counts: Record<string, number> } | null;
}
export interface AtmRegisterImportRunDto {
  id: string; fileName: string; fileSha256: string;
  state: (typeof ATM_REGISTER_IMPORT_RUN_STATES)[number];
  startedAt: string; finishedAt: string | null; actorName: string | null;
  categories: AtmRegisterImportCategory[]; reportOverride: boolean; counts: Record<string, number>;
}
```

### 3.10 Other contract changes (WP-A)

| File | Change |
|---|---|
| `packages/contracts/src/modules/atm.ts` | `AtmSettingKeys` += `RegisterBranchCodes`, `RegisterBankLabels` (§3.3). New `UpdateAtmMachineAreaSchema = z.object({ area: z.string().trim().min(1), version: z.number().int().min(0) }).strict()` + type, placed after `ReassignAtmMachineAreaSchema` (`:167-170`). |
| `packages/contracts/src/platform/audit.ts` | Append to `AUDIT_ACTIONS` before `] as const` (`:155`), with a comment block in the file's style: `'secretRevealed'` (an audited READ of a sealed value — written even when nothing is recorded, the `medicalRecordRead` rule) and `'atmRegisterImport'` (one row per apply, the `attendancePunchImport` shape). |
| ~~`packages/contracts/src/platform/realtime.ts`~~ | **Not modified (O-2).** |
| `packages/contracts/src/errors/index.ts` | New codes: `ATM_REGISTER_OPEN_PERIOD_EXISTS`, `ATM_REGISTER_CODE_ACTIVE_ELSEWHERE`, `ATM_REGISTER_BRANCH_UNMAPPED`, `ATM_REGISTER_BRANCH_REQUIRED`, `ATM_REGISTER_AREA_REQUIRED`, `ATM_REGISTER_NOT_OPEN`, `ATM_REGISTER_NOT_PENDING`, `ATM_REGISTER_NOT_ENDED`, `ATM_REGISTER_IMMUTABLE_FIELD`, `ATM_REGISTER_ALREADY_LINKED`, `ATM_REGISTER_IMPORT_LAYOUT`, `ATM_REGISTER_IMPORT_BLOCKED`, `ATM_REGISTER_IMPORT_FILE_CHANGED`, `ATM_REGISTER_IMPORT_RUNNING`. |

---

## 4. Column catalogue — Excel `ATMs` A..AW → register field

`ATM_REGISTER_COLUMNS` (§3.6) is this table, row for row. Headers are the EXACT row-1 strings
(`\n` = a newline inside the cell; trailing spaces are part of the header). AB/AC/AD headers are
NUMBER cells (200/100/50) and are compared as `String(value)`. Verified by streaming the real
workbook with ExcelJS 4.4.0 (all 49 bound). Edit column: R = receive/create, E = edit, H = handover
only, — = system. Class: P public to `atmRegister.view`, K `viewSecrets` only, S sealed.

| Col | Exact header (occ.) | Field | Group | Cls | Width | Import conversion (§6.3 helpers) | Edit |
|---|---|---|---|---|---|---|---|
| A | `Branch` | `branchCode` → `branchId` | identity | P | 11.71 | `EGYCASH-n` → setting → branchId; blank → null + `noBranch`; other → null + `unknownBranchCode` | R (immutable) |
| B | `Aria` | `area` | identity | P | 16.57 | text; error value `#N/A` → null + `areaError`; open ∧ null → `openNoArea` | R/E |
| C | `BANK` | `bankCode` | identity | P | 9.14 | enum; `نيكست` → NXT + `bankAlias`; other → null + `unknownBank`(detail=value); open ∧ null → `noBank` | R/E |
| D | `ATM ID` | `machineCode` (+`machineId` system) | identity | P | 13.14 | number → integer string; text → `normalizeAtmMachineCode`; NBSP/edge space → `codeWhitespace`; `#`/`********` kept + `placeholderCode`; blank → null + `noCode`; shape → `idFormat` | R (immutable once linked to a master — editable while pending or open-and-unlinked, DEC-30) |
| E | `Name` | `name` | identity | P | 42.57 | text (100% filled in the snapshot; a blank in a later copy → null + `noName`, DEC-32) | R/E (required on manual writes) |
| F | `opration type` | `operationType` | identity | P | 13.43 | text | R/E |
| G | `ATM type` | `vendor` | identity | P | 9.14 | text | R/E |
| H | `Model` | `model` | identity | P | 14.14 | text (number → integer string) | R/E |
| I | `Serial` | `serial` | identity | P | 12.43 | text (10-digit numbers safe); `serialDuplicate` | R/E |
| J | `Supervisor\nKeys` | `keys.supervisorCode` | keys | K | 16.29 | text | R/E |
| K | `Number` | `keys.supervisorCount` | keys | K | 19.29 | text | R/E |
| L | `Safe Door\nKeys` | `keys.safeDoorCount` | keys | K | 9.29 | text | R/E |
| M | `Alanki` | `keys.alanki` | keys | K | 9.29 | text (EG-1) | R/E |
| N | `Combination safe Door\nKeys` | `keys.combinationKeyCode` | keys | K | 11.29 | text | R/E |
| O | `Number of\nkeys` (0) | `keys.combinationKeyCount` | keys | K | 9.29 | text | R/E |
| P | `CASH Unit \nKeys` | `keys.cashUnitCode` | keys | K | 11.14 | text | R/E |
| Q | `Number of\nkeys` (1) | `keys.cashUnitCount` | keys | K | 9.29 | text | R/E |
| R | `Withdrawall\nCassettes ` | `cassettes.withdrawalType` | cassettes | P | 16 | text | R/E |
| S | `Number of\nloading cassettes` (0) | `cassettes.withdrawalCount` | cassettes | P | 9.29 | text | R/E |
| T–X | `Cassette -1`…`Cassette -5` (0) | `cassettes.withdrawal1..5` | cassettes | P | 9.29 | text | R/E |
| Y | `Deposit Cassettes` | `cassettes.depositType` | cassettes | P | 17 | text | R/E |
| Z | `Number of\nloading cassettes` (1) | `cassettes.depositCount` | cassettes | P | 9.14 | text | R/E |
| AA | `Collection` | `cassettes.collectionCount` | cassettes | P | 9.29 | text | R/E |
| AB | `200` (number) | `cassettes.recycle200` | cassettes | P | 9.29 | text | R/E |
| AC | `100` (number) | `cassettes.recycle100` | cassettes | P | 9.29 | text | R/E |
| AD | `50` (number) | `cassettes.recycle50` | cassettes | P | 9.29 | text | R/E |
| AE | `Withdrawall \nCassettes Spear` | `cassettes.spareCount` | cassettes | P | 13.71 | text | R/E |
| AF–AJ | `Cassette -1`…`Cassette -5` (1) | `cassettes.spare1..5` | cassettes | P | 9.29 (AJ 9.14) | text | R/E |
| AK | `Open time` | `openTime` | hours | P | 9.29 | time rule (§6.3; ≥ 1 day → `timeOverDay`, EG-20) | R/E |
| AL | `End time` | `closeTime` | hours | P | 9.29 | time rule | R/E |
| AM | `Notes lemite time` | `accessHoursNotes` | hours | P | 15.43 | time rule (only its 12 `h:mm` Date cells convert; text and General numbers kept) | R/E |
| AN | `Notes Received` | `receiptNotes` | hours | K | 27.29 | text (505 cells match key-code patterns) | R/E |
| AO | `Combination\nSafe Door\n P.W` | `safeCombination` | secret | S | 18.29 | §6.3 AO rule → sealed; never echoed | R/E |
| AP | `LOCATION\nGPS` (0) | `locationPlusCode` | location | P | 9.14 | text | R/E |
| AQ | `Start Date\nOpration` | `startDate` | lifecycle | P | 12.14 | date (§6.3; 46034 → 2026-01-12 + `dateSerial`; unreadable non-empty → `dateInvalid` + blocker `dateUnreadable`) | R/E |
| AR | `End Date\nOpration` | `endDate` | lifecycle | P | 14 | date (as AQ) | H (E on ended) |
| AS | `Received\nName` | `receivedByName` | lifecycle | P | 14.57 | text | R/E |
| AT | `Delivered\nName` | `handoverName` | lifecycle | P | 16.57 | text (EG-3; 8 open rows carry one — kept, a handover that omits the field keeps it) | H (E on ended) |
| AU | `Notes\nDelivered` | `handoverNotes` | lifecycle | K | 9.14 | text (16 cells hold the row's own combination digits; 7 open rows carry one — kept as AT) | H (E on ended) |
| AV | `LOCATION\nGPS` (1) | `locationUrl` | location | P | 9.14 | text (rendered as a link only when `http(s)`, `rel="noopener noreferrer"`) | R/E |
| AW | `HUB` | `hub` | hub | P | 14.57 | text | R/E |

System fields (never input): `status`, `machineId`, `source`, `importRunId`, `importRow`,
`importIssues`, `legacyMarks`, `openPeriodExempt`, base fields. Columns AX..NJ (scratch, AY copy,
helpers, sentinel) are not read (D8, EG-4, EG-5).

---

## 5. API (WP-A unless marked)

All paths below are under `apps/api/src/modules/atm/`. New code lives in `register/`.

### 5.1 Model — `register/register.model.ts`

```ts
export interface AtmRegisterEntryDoc extends BaseDocFields {
  branchId: Types.ObjectId | null;      // null only for imported rows with a blank col A
  area: string | null;
  bankCode: AtmBankCode | null;         // a catalog code (DEC-35); the model has no enum, the service checks it
  opsBankLabel: string | null;
  machineCode: string | null;
  machineId: Types.ObjectId | null;
  name: string | null;                  // null only on an imported blank (DEC-32)
  operationType: string | null; vendor: string | null; model: string | null; serial: string | null;
  keys: AtmRegisterKeysDto;             // every sub-field string | null
  cassettes: AtmRegisterCassettesDto;
  openTime: string | null; closeTime: string | null; accessHoursNotes: string | null;
  receiptNotes: string | null;
  safeCombination: SecretRef | null;    // sealed (D3); NEVER plaintext
  locationPlusCode: string | null; locationUrl: string | null; hub: string | null;
  startDate: Date | null; endDate: Date | null;   // UTC midnight
  receivedByName: string | null; handoverName: string | null; handoverNotes: string | null;
  status: AtmRegisterStatus;            // derived (deriveAtmRegisterStatus) on every write
  openPeriodExempt: boolean;            // DEC-11
  source: 'manual' | 'import' | 'operations';  // 'operations' = recorded by a data-edit add (DEC-36)
  dataIncomplete: boolean;              // «بيانات ناقصة» (DEC-37); required, default false
  importRunId: Types.ObjectId | null;
  importRow: number | null;
  importIssues: { code: string; column: string | null; detail: string | null }[];
  legacyMarks: {                        // EG-2, import-only, never in a DTO
    areaRedFill: boolean;                // derived: B has solid FFFF0000
    rowFill: string | null;              // derived: A's solid fill
    cellFills: { column: string; fill: string }[];  // EVERY non-default solid fill in A..AW
  } | null;
}
```

Schema rules (the zone/senderEmail lesson — `machines/machine.model.ts:33-37`,
`mail-tickets/mail-ticket.model.ts:45-48`, port doc §8): **no `required: true` on any String that
can legitimately be empty**. Every text field — `name` included (DEC-32: an imported blank stays
null; manual writes get a non-empty name from Zod) — is `{ type: String, default: null }`; only
`status`/`source` are `{ type: String, required: true, enum: … }`. **No Mongoose validator (maxlength, enum, match) on any
K or S field** — a Mongoose validation message can echo the value. `keys` and `cassettes` are
nested objects with `_id: false`, every leaf `{ type: String, default: null }`. `safeCombination`
uses the credential precedent's sub-schema (`modules/automation/credentials/credential.model.ts:36-41`,
copied — ATM imports no other module): `{ _id:false, provider:{type:String,required:true}, keyId:{type:String,default:null}, ref:{type:Schema.Types.Mixed,required:true} }`, the whole field `default: null`.
`importIssues`: array of `{ _id:false, code:String, column:{type:String,default:null}, detail:{type:String,default:null} }`.
`legacyMarks`: `{ _id:false, areaRedFill:Boolean, rowFill:{type:String,default:null}, cellFills:[{ _id:false, column:String, fill:String }] }`, the whole field `default: null`.
`...baseFields`, `baseSchemaOptions` (`shared/base/base.model.ts:17-29`). Collection `atm_register_entries`, model `AtmRegisterEntry`.

Indexes (exact names — WP-B's tests and `atm-indexes.ts` rely on them):

```ts
schema.index({ machineCode: 1 }, { unique: true, name: 'ux_open_period_per_code',
  partialFilterExpression: { status: 'open', isDeleted: false, openPeriodExempt: false, machineCode: { $type: 'string' } } }); // D6
schema.index({ branchId: 1, status: 1, bankCode: 1 }, { name: 'ix_branch_status_bank' });        // report
schema.index({ machineCode: 1, status: 1 }, { name: 'ix_code_status' });
schema.index({ branchId: 1, machineCode: 1 }, { name: 'ix_branch_code' });
schema.index({ machineId: 1, status: 1 }, { name: 'ix_machine_status' });                        // coupling
schema.index({ importRow: 1 }, { unique: true, name: 'ux_import_row',
  partialFilterExpression: { importRow: { $type: 'number' } } });                                // D8 idempotency
schema.index({ 'safeCombination.keyId': 1 }, { name: 'ix_combination_keyId', sparse: true });   // the rotation sweep, DEC-33 (precedent credential.model.ts:68-70)
schema.index({ branchId: 1, dataIncomplete: 1 }, { name: 'ix_incomplete',
  partialFilterExpression: { dataIncomplete: true } });                                         // DEC-37: flagged rows only
```

### 5.2 Repository — `register/register.repository.ts`

`class AtmRegisterEntryRepository extends BaseRepository<AtmRegisterEntryDoc>` with
`super(AtmRegisterEntryModel, { branchField: 'branchId' })` (precedent `machines/machine.repository.ts:7-8`),
so ADR-028 narrowing applies (`shared/base/base.repository.ts:143-176`). Note
`list()` caps `pageSize` at `MAX_PAGE_SIZE=100` (`base.repository.ts:264`) — the register is paged
through, never truncated (the 100 cap is per page, not per register).

**Scope (DEC-29).** The file exports two pure functions and the repository uses the first:

```ts
/** The ONE match for every register read: entries, export, report. Finer scopes narrow to the branch. */
export const registerScopeMatch = (s: ScopeSelector): Record<string, unknown> =>
  orgScopeMatch(s, { branch: 'branchId' }, { finerNarrowsToBranch: true })      // shared/base/org-scope-match.ts:71-112
  ?? { createdBy: new Types.ObjectId(s.userId) };                               // own
/** The branch ids that match covers: 'all' (organization AND own — own is narrowed by createdBy, not by branch). */
export const registerScopeBranches = (s: ScopeSelector): 'all' | string[] =>
  s.scope === 'organization' || s.scope === 'own' ? 'all'
  : (s.branchIds?.length || s.departmentBranchIds?.length)
    ? [...new Set([...(s.branchIds ?? []), ...(s.departmentBranchIds ?? [])])]  // the reach (same lists the match uses)
    : s.branchId === null ? [] : [s.branchId];                                  // home, for branch/department/section
```
`protected override scopeFilter(selector)` returns `{}` for `undefined`/organization, else
`registerScopeMatch(selector)` — so `getById/list/updateById/softDeleteById(…, { scope })` all narrow
the same way. `registerScopeBranches` must stay in step with `orgScopeMatch`; its unit test (§10.2)
checks both on the same selectors.

`keyCoversEntry(ctx, key, entry)` (exported from `register-secrets.ts`, §5.4) = `scopeOf(ctx,key) === 'organization' || (entry.branchId !== null && keyReachesBranch(ctx, key, String(entry.branchId)))` (`shared/types/index.ts:111, 210-211`).

Extra methods, all session-aware (`.session(session ?? null)`):

- `findOpenByCode(machineCode, session?)` → non-deleted `status:'open'` rows with that code (exempt included).
- `findOpenByCodes(codes)` → `Map<code, {_id, branchId, importRow}[]>` of non-deleted open rows (import plan, §6.4).
- `listCombinationsNotOnKey(currentKeyId, limit)` → rows (deleted included) with `safeCombination` set and `safeCombination.keyId ≠ currentKeyId` (DEC-33; uses `ix_combination_keyId`).
- `countOtherOpenForMachine(machineId, excludeEntryId, session)`.
- `findOpenForMachine(machineId, session)`.
- `groupActive(match)` → `$match {isDeleted:false, status:'open', branchId:{$ne:null}, ...match}` → `$group {_id:{branchId,bankCode}, count:{$sum:1}}` (report, §5.8).
- `distinctValues(field, branchId|null, scope)` for branch options.
- `findSerialOnOtherOpen(serial, machineCode)` (case-insensitive exact, escaped).

### 5.3 Settings — `atm.settings.ts` (MOD) + `register/register-settings.ts` (NEW)

Two `declareSetting` calls beside the existing two (`atm.settings.ts:20-34` precedent), both
`allowedScopes: ['organization']`:

| Key | Schema | Default | Description (in the file) |
|---|---|---|---|
| `atm.register.branchCodes` | `AtmRegisterBranchCodesSettingSchema` | `[]` | The workbook's `EGYCASH-n` → ECMS branch. Empty means no register receipt is possible (DEC-10) and the import is blocked (`branchUnmapped`). |
| `atm.register.bankLabels` | `AtmRegisterBankLabelsSettingSchema` | `ATM_DEFAULT_BANK_LABELS_SETTING` | bankCode → the label written on `atm_machines.bankName` (D5). **RETIRED by DEC-35:** the description now reads "RETIRED — read once by the bank catalog seed (DEC-35) … changing it changes nothing". It stays declared so a stored value keeps validating. |

`register-settings.ts` exports `resolveRegisterSettings(session?): Promise<RegisterSettings>`. It
reads `branchCodes` through `settingsService.resolve(key, { userId: null, branchId: null })`
(precedent `mail-tickets/mail-poll.service.ts:45-52`) and, in parallel, the bank catalog
(`loadAtmBankCatalog(session)`, DEC-35). `RegisterSettings` is `{ codeByBranchId, branchIdByCode,
catalog, opsLabel(bank) }`; `opsLabel` is the catalog's, falling back to the seed's and then to the
code. The bank-labels setting is no longer read here. `effectiveOpsLabel(entry) = entry.opsBankLabel ?? (entry.bankCode ? opsLabel(entry.bankCode) : null)`.
Settings are written by the web card through the platform endpoint (DEC-20); the settings service
audits `settingChanged` (`platform/settings/settings.service.ts:184-195`). Since DEC-35 the card
writes the branch codes only; a bank's Operations label is edited in the catalog (§8.7).

`atm.settlements.banks` (settlements DS-24) is now `z.array(AtmBankCodeSchema).max(50)` — catalog
codes, not the six. `enabledSettlementBanks()` keeps the codes the catalog knows, archived ones
included, and ignores the rest.

### 5.4 Secrets and redaction — `register/register-secrets.ts`

| Concern | Rule (with precedent) |
|---|---|
| Sealing | `getSecretStore().seal(plaintext, combinationContext(entryId))` (`platform/secrets/secret-store.ts:42-45, 74-79`); context `` `atm_register_entries:${id}:safeCombination` `` (the `<collection>:<id>:<field>` AAD rule, `platform/crypto/crypto.service.ts:137-166`; precedent `contextFor`, `modules/automation/credentials/credential.service.ts:29`). The entry id is minted BEFORE the insert so the context can name it (`credential.service.ts:83-87`). If `!getSecretStore().available()` and a value is being written → `BusinessRuleError` (precedent `credential.service.ts:68-75`); the import reports blocker `secretStoreUnavailable`. |
| Opening | Only in the reveal path, and only after `secretsVisibleFor(ctx, doc)`: `getSecretStore().open(ref, combinationContext(id))`. Rotation never opens (`rewrap`). |
| DTO visibility | `secretsVisibleFor(ctx, entry) = keyCoversEntry(ctx, 'atmRegister.viewSecrets', entry)` (§5.2; `shared/types/index.ts:108-113, 210-211`) — the ONE predicate shared by the mapper, the DEC-7 write gate and the reveal (DEC-29). Mapper returns `keys/receiptNotes/handoverNotes = null` and `secretsVisible:false` when false (precedent `modules/hr/employee-management/employees/employee.mapper.ts:1-7`, `employee.controller.ts:30-44`). `safeCombination` is NEVER mapped — only `safeCombinationSet = doc.safeCombination !== null`. |
| Write gate (DEC-7) | If the body sets `keys`, `receiptNotes`, `handoverNotes` or `safeCombination` (any value, incl. null) and `secretsVisibleFor(ctx, entry)` is false (for a receipt: the target branch) → `ForbiddenError`. |
| Audit diffs | Build diffs with `redactedDiff(before, after)`: for every K path and `safeCombination` the change is written `{ field, old: before !== null ? '[redacted]' : null, new: after !== null ? '[redacted]' : null }`, only when the value actually changed (precedent `employee.service.ts:798`). `audit.masking.ts:18` is NOT extended (it masks national ids with a partial mask; write-time redaction is the precedent for fully secret values). |
| Logs | Add to `PII_REDACTION_PATHS` (`apps/api/src/infrastructure/logging/logger.ts:7-18`) the SAME depth set for all five names — `safeCombination`, `keys`, `receiptNotes`, `handoverNotes`, `plaintextCombination` (the import's in-memory field, §6.4) — at the root, one level and two levels deep: `'<name>'`, `'*.<name>'`, `'*.*.<name>'` (15 paths). Depth is a backstop, not the rule: an entry document, an entry DTO, a request body of a register route and a `ParsedRow` are NEVER passed to the logger — WP-A and WP-B acceptance each run `rg -n "logger\.(info\|warn\|error\|debug)\(" apps/api/src/modules/atm/register` and check every hit logs only ids, counts, codes and column letters. |
| Error tracking (DEC-34) | `apps/api/src/infrastructure/observability/sentry.ts`: `Sentry.init({ …, integrations: [Sentry.httpIntegration({ ignoreIncomingRequestBody: isSecretBodyUrl })], beforeSend: scrubSentryEvent })`, both exported for their spec. `isSecretBodyUrl(url) = url.includes('/api/v1/atm/register')` (covers the import upload too). `scrubSentryEvent(event)` deletes `event.request.data` when `event.request.url` passes `isSecretBodyUrl`, and removes the five names above, at any depth, from `event.request.data`, `event.extra` and `event.contexts`. The header comment's claim ("PII scrubbing reuses the Pino redaction path list") is corrected to say what the file does. (`@sentry/node` 10.75: `maxIncomingRequestBodySize` defaults to `'medium'`, `apps/api/node_modules/@sentry/node/build/types/integrations/http.d.ts:90, 105`.) |
| HTTP caching | Every response of `GET/POST/PATCH/DELETE /atm/register/entries*` (list, get, writes, reveal, export) sets `Cache-Control: private, no-store` (one router-level middleware in `register.routes.ts`; precedent `modules/fleet/fuel-cards/fuel-card.controller.ts:42`). Web: §8.2. |
| Key rotation (DEC-33) | `rotateRegisterCombinationKeys(batchSize = 200)` in `register-secrets.ts`, mirroring `credential.service.ts:288-320`: `status = getSecretStore().status()`; nothing to do unless `available ∧ rotatable ∧ currentKeyId !== null`; for each `repository.listCombinationsNotOnKey(currentKeyId, batchSize)`: `ref = await store.rewrap(doc.safeCombination)`, then a versioned raw update `AtmRegisterEntryModel.updateOne({ _id, __v }, { $set: { safeCombination: ref }, $inc: { __v: 1 } })` (raw, so soft-deleted entries are rewrapped too; a lost race is counted, never thrown); `logger.info({ provider, currentKeyId, rotated, failed })`. The context (AAD) is untouched by `rewrap` (`platform/crypto/crypto.service.ts:213-222`). Run by the manifest task `atm.rotateRegisterCombinationKeys` (§7.2). |
| Errors | Service error messages name codes, branches and fields — never a K/S value. The import's errors never contain cell values of J..Q, AN, AO, AU (§6.6). |
| Exports | §5.9: K/S columns are not in the CSV, for anybody. |
| Realtime | Signals carry no data (ADR-029); nothing to do. |

### 5.5 Master coupling — `register/register-coupling.ts`

Pure orchestration over `atm_machines` (`AtmMachineModel`, `atmMachineRepository`) and the
register repository. Every function takes the caller's `ClientSession`; reads use
`.session(session)`. It returns audit entries; the CALLER records them after the transaction
commits (DEC: audit rows are a queue write outside the session — `platform/audit/audit.service.ts:162-193` — and `withTransaction` may retry the callback, `platform/kernel/unit-of-work.ts:9`).

```ts
export interface PendingAudit { entityRef: EntityRef; action: AuditAction; changes: AuditChange[] }
export interface CouplingOutcome {
  action: 'link' | 'reactivate' | 'create';
  machineId: Types.ObjectId;
  adoptedBankLabel: string | null;          // link only (D5)
  differences: ('name' | 'area')[];         // link only (DEC-8)
  audits: PendingAudit[];
}
export type CouplingRefusal = { refused: 'activeElsewhere' | 'blankArea' | 'noName'; otherBranchId?: string };

/** RECEIVE (manual, pending→open, import). */
export const coupleReceipt = async (
  input: { branchId: string; machineCode: string; name: string | null; area: string | null; opsLabel: string },
  actorId: string | null, session: ClientSession,
): Promise<CouplingOutcome | CouplingRefusal>;
```

Algorithm (exact order):

1. `elsewhere = AtmMachineModel.findOne({ isDeleted:false, isActive:true, machineCode, branchId:{ $ne: branchId } })` → if found return `{refused:'activeElsewhere', otherBranchId}` (DEC-9). Manual callers throw `ConflictError('…', ATM_REGISTER_CODE_ACTIVE_ELSEWHERE)`; the message names the other branch's EGYCASH code only when `keyReachesBranch(ctx,'atmRegister.view', otherBranchId)`, else it says "another branch" (review finding F-9).
2. `master = AtmMachineModel.findOne({ isDeleted:false, branchId, machineCode }).lean()` (active OR archived — the `ux_branch_code` row, `machine.model.ts:45-48`).
3. If `master` lacks `__v`/`createdAt`: `ensureMachineVersioned(master._id, session)` — raw `collection.updateOne({_id, __v:{$exists:false}}, [{ $set: { __v: 0, createdAt: { $ifNull: ['$createdAt', { $toDate: '$_id' }] }, updatedAt: { $ifNull: ['$updatedAt', { $toDate: '$_id' }] } } }], { session })`, then re-read (DEC-23).
4. **LINK** — `master.isActive === true`: no master write. `adoptedBankLabel = master.bankName`; `differences` = `name`/`area` where `master.x !== input.x`. Return.
5. **REACTIVATE** — `master.isActive === false`: requires `area` non-null else `{refused:'blankArea'}`, and `name` non-null else `{refused:'noName'}` (DEC-32); `atmMachineRepository.updateById(id, { isActive:true, name, area, bankName: opsLabel }, { by, version: master.__v, session })` (`shared/base/base.repository.ts:432-458`). Audit `{ moduleId:'atm', entityType:'machine' }`, action `update`, changes = `diffChanges(snapshot(before), snapshot(after))` (the machine service's own snapshot, `machines/machine.service.ts:33-40` — export it).
6. **CREATE** — no live master: requires `area` non-null else `{refused:'blankArea'}`, and `name` non-null else `{refused:'noName'}`; `atmMachineRepository.create({ branchId, bankName: opsLabel, machineCode, name, zone:'', area, isActive:true }, { by, session })` (field rules as `machine.service.ts:125-136`). A duplicate-key race surfaces as `ConflictError` from the base repository (`base.repository.ts:394-405`). Audit action `create`.

```ts
/** HANDOVER / DELETE: archive the master when no OTHER open entry still holds it. */
export const archiveIfLastOpen = async (entry: AtmRegisterEntryDoc, actorId, session): Promise<PendingAudit[]>;
//   if entry.machineId === null → []
//   touch the ACTIVE master in the session first ($set updatedAt) — so two transactions ending
//   the two DEC-11 twins at once write-conflict and withTransaction re-runs the loser, whose
//   count then sees the other twin ended (review finding COUPLING-2; without it neither archives)
//   if countOtherOpenForMachine(machineId, entry._id) > 0 → []        (2013/2015 pairs, DEC-11)
//   master = live (isDeleted:false) row by id; null or already inactive → []
//   ensureMachineVersioned; updateById {isActive:false}; audit machine 'update'.

/** EDIT of an OPEN entry: copy changed name / area / effective bank label onto the master (D2). */
export const syncEntryToMaster = async (before, after, opsLabelBefore, opsLabelAfter, actorId, session): Promise<PendingAudit[]>;
//   only when after.status === 'open' && after.machineId !== null and master is live (not deleted);
//   set = { name? , area? (never set '' — refused earlier), bankName? }; nothing changed → [].
//   Does NOT change isActive (an admin-archived master stays archived — DEC-24).

/** DEFERRED COUPLING (DEC-30): an OPEN entry with machineId null. Same refusals as a receipt. */
export const linkUncoupled = async (entry, opsLabel, actorId, session): Promise<CouplingOutcome | CouplingRefusal>;
//   requires entry.status === 'open' && entry.machineId === null && branchId/machineCode/bankCode non-null
//   (a placeholder code — '#', '********' — is refused like noCode); → coupleReceipt({ branchId, machineCode,
//   name, area, opsLabel }); on success the CALLER sets machineId (+ opsBankLabel on link, DEC-8).

/** OPERATIONS AREA CHANGE (DEC-4): the master's open entries follow its area. */
export const syncMasterAreaToEntries = async (machineId, area, actorId, session): Promise<PendingAudit[]>;
//   findOpenForMachine(machineId) → updateById each { area } with its own __v; audit registerEntry 'update' (field area).
```

### 5.6 Service — `register/register.service.ts` (every write is ONE `unitOfWork`)

`unitOfWork` = `platform/kernel/unit-of-work.ts:5-17` (precedent `modules/it/assets/custody.service.ts:269, 391, 483`).
Audits collected inside, recorded after the transaction resolves. `entityRef = { moduleId: 'atm',
entityType: 'registerEntry', entityId }` — written as a LITERAL pair so `realtime-registry.spec.ts`
finds it. Dates in/out via `YYYY-MM-DD` ↔ UTC-midnight Date.

| Method | Key / scope | Steps |
|---|---|---|
| `list(query, ctx)` | `scopeSelector(ctx,'atmRegister.view')` (`shared/types/index.ts:221-257`), narrowed by the repository's `registerScopeMatch` (DEC-29) | Filters: `branchId`; `bankCode $in banks`; `status $in statuses`; `area` exact; `search` → escaped case-insensitive regex on `machineCode`, `name`, `serial` (escape like `modules/hr/employee-management/employees/employee.repository.ts:31`; the machine list's unescaped `$regex`, `machine.service.ts:48-52`, is NOT copied); `withIssues:true` → `importIssues.0:{$exists:true}`. Sort fields `ATM_REGISTER_SORT_FIELDS`; when `sortBy` is absent: `createdAt asc` (DEC-21). Mapper needs `masterState`: one `AtmMachineModel.find({_id:{$in: page machineIds}})` (incl. deleted) per page → `active/archived/deleted`, absent → `missing`; open with `machineId:null` → `unlinked`; and the settings for `branchCode`/`effectiveOpsBankLabel`. |
| `get(id, ctx)` | view scope (DEC-29) | `getById(id, scope)`. |
| `create(input, ctx)` (Receive / pending) | route `atmRegister.create` | (1) DEC-7 gate (`secretsVisibleFor` the target branch). (2) `branchRepository.findById(branchId)`; missing or `status!=='active'` → `ValidationError([{ field:'body.branchId', code:'UNKNOWN', message:'branch not found or inactive' }])` (`modules/fleet/vehicles/vehicle.service.ts:128-135`). (3) `keyReachesBranch(ctx,'atmRegister.create',branchId)` false → `ForbiddenError` (D4). (4) branch not in `branchCodes` → `BusinessRuleError(…, ATM_REGISTER_BRANCH_UNMAPPED)` (DEC-10). (5) `machineCode = normalizeAtmMachineCode(raw)` (`packages/contracts/src/modules/atm.ts:23`). (6) `opsBankLabel` given → must equal an ACTIVE `atm_ref_labels` bank label of that branch, else 400 `body.opsBankLabel`. (7) If `startDate`: `findOpenByCode(code)` non-empty → `ConflictError(…, ATM_REGISTER_OPEN_PERIOD_EXISTS)`; the message names the other entry's branch code only when `keyReachesBranch(ctx,'atmRegister.view', other.branchId)`, else "open in another branch" (review finding F-9). (8) Warnings (read-only): `idFormat` (§3.1), `serialDuplicate`, `futureDate` (startDate > Cairo today). (9) `unitOfWork`: mint `_id`; seal combination if given; if `startDate`: `coupleReceipt` (refusal → throw 409 `ATM_REGISTER_CODE_ACTIVE_ELSEWHERE`, same naming rule / 400 area — `noName` cannot occur, Zod requires `name`); on link set `opsBankLabel = adoptedBankLabel` and add `opsBankLabelIgnored` if the request named a different one, `masterDiffers` if `differences`; insert the entry (`status = deriveAtmRegisterStatus`, `source:'manual'`, `machineId`). A `ConflictError` from `ux_open_period_per_code` → rethrow with `ATM_REGISTER_OPEN_PERIOD_EXISTS`. (10) Audits: entry `receive` (open) or `create` (pending) with `redactedDiff({}, snapshot)`, plus the coupling audits. Response `AtmRegisterWriteResultDto` (201). |
| `update(id, input, ctx)` | `scopeSelector(ctx,'atmRegister.edit')` on `getById` and `updateById`; then `keyCoversEntry(ctx,'atmRegister.edit', entry)` else 403 (DEC-29; the entry was found in the caller's read scope, so 403 leaks nothing) | DEC-7 gate. Rules by current status: `machineCode` only while `pending` or while `open ∧ machineId === null` (an unlinked imported row may still need its code; the open-period check of create (7) applies to the new code) — else 422 `ATM_REGISTER_IMMUTABLE_FIELD`; `startDate` may not be SET on pending (use receive → 422 `ATM_REGISTER_NOT_OPEN`) — it may be changed (not cleared) on open/ended; `endDate`, `handoverName`, `handoverNotes` only on `ended` (422 `ATM_REGISTER_NOT_ENDED`), `endDate` never cleared; `area: null` on an open entry with a machine → 400 (D6); `name` may be set but never cleared (Zod); `bankCode` change clears `opsBankLabel` unless also given (DEC-25); `opsBankLabel` validated as in create; `safeCombination: string` reseals, `null` clears, absent keeps; `keys`/`cassettes` merge per sub-field. `unitOfWork`: `updateById(… { version, scope, session })` with `status` recomputed (never changes on edit); `syncEntryToMaster` when open ∧ linked; **when open ∧ `machineId === null` ∧ the request sets `area`** (DEC-30): `linkUncoupled` on the merged entry — success sets `machineId` (+ adopted label on link) in the same update and returns `master.action`; refusal `activeElsewhere` → warning `codeActiveElsewhere`, `blankArea`/`noName` → nothing (the edit is saved either way). Audits: entry `update` (redacted) + master audits. Warnings: `idFormat` (code change), `serialDuplicate`, `endBeforeStart`, `futureDate`, `codeActiveElsewhere`, and on link `masterDiffers`/`opsBankLabelIgnored`. 200. |
| `receivePending(id, input, ctx)` | `scopeSelector(ctx,'atmRegister.create')` + `keyCoversEntry(create)` else 403 | Entry must be `pending` (422 `ATM_REGISTER_NOT_PENDING`); `branchId` null → 422 `ATM_REGISTER_BRANCH_REQUIRED` (DEC-12); `keyReachesBranch(create)`; merged bank/code/area/name required (400); open-period check (naming rule of create (7)); `unitOfWork`: `coupleReceipt` + update entry (`startDate`, merged fields, `status:'open'`, `machineId`, adopted label). Audit `receive` + master. 200. |
| `handover(id, input, ctx)` | `scopeSelector(ctx,'atmRegister.handover')` + `keyCoversEntry(handover)` else 403 | Entry must be `open` (422 `ATM_REGISTER_NOT_OPEN`); DEC-7 gate for `handoverNotes`; `unitOfWork`: `updateById({ endDate, status:'ended', …(handoverName sent ? {handoverName} : {}), …(handoverNotes sent ? {handoverNotes} : {}) })` — an ABSENT field keeps the stored value (imported AT/AU on open rows, review finding F-18) — + `archiveIfLastOpen`. Audit `deliver` (entry) + master `update`. Warnings `endBeforeStart`, `futureDate` (DEC-14). 200. |
| `remove(id, version, ctx)` | `scopeSelector(ctx,'atmRegister.delete')` + `keyCoversEntry(delete)` else 403 | `getById`; `before.__v !== version` → `StaleDocumentError`; `unitOfWork`: `softDeleteById({ scope, session })` (`base.repository.ts:461-485`) + `archiveIfLastOpen` when `before.status==='open'` (D2). Audit `delete` with `redactedDiff(snapshot, {})` + master. 204. |
| `reveal(id, ctx)` | route `atmRegister.viewSecrets`; `scopeSelector(ctx,'atmRegister.viewSecrets')` + `secretsVisibleFor(ctx, doc)` else 403 before anything is opened (DEC-29 — the same predicate as the DTO) | `getById(id, scope)`; `secretsVisibleFor` check; `value = doc.safeCombination === null ? null : await open(...)`; ALWAYS audit `{ entityRef: registerEntry, action: 'secretRevealed', changes: [{ field:'safeCombination', old:null, new: value === null ? '[none]' : '[revealed]' }] }` (even when nothing is recorded — `modules/hr/medical/profiles/medical-profile.service.ts:73-80`). Response header `Cache-Control: private, no-store`. 200 `AtmRegisterRevealDto`. |
| `link(id, version, ctx)` (DEC-30) | route `atmRegister.edit`; `scopeSelector(ctx,'atmRegister.edit')` + `keyCoversEntry(edit)` else 403 | Entry must be `open` (422 `ATM_REGISTER_NOT_OPEN`) and `machineId === null` (422 `ATM_REGISTER_ALREADY_LINKED`); stale `version` → 409; `unitOfWork`: `linkUncoupled` — refusal `activeElsewhere` → 409 `ATM_REGISTER_CODE_ACTIVE_ELSEWHERE` (naming rule of create (7)), `blankArea` → 400 `ATM_REGISTER_AREA_REQUIRED`, `noName` → 400 `body.name`, missing/placeholder code or bank → 400; success → `updateById({ machineId, opsBankLabel? })`. Audit entry `update` (field `machineId`) + the coupling audits. 200 `AtmRegisterWriteResultDto`. |
| `meta(ctx)` | `authorizeAny(view, report.view, import)` | Banks with `opsLabel` from the setting; branches: every code with its mapped branch (name/status from `branchRepository`), `canView = keyReachesBranch(ctx,'atmRegister.view',id)`, `canCreate = keyReachesBranch(ctx,'atmRegister.create',id)`. |
| `branchOptions(branchId, ctx)` | `authorizeAny(view, create, edit)`; refuse 403 unless `keyReachesBranch` for view OR create | Active bank/area labels of that branch (`AtmRefLabelModel`, same module) + distinct entry values (`area`, `operationType`, `vendor`, `model`, `hub`) in that branch, sorted, ≤ 500 each. |

### 5.7 Routes

`register/register.routes.ts` → `buildAtmRegisterRouter()`, mounted at `/atm/register`. Every route:
`authenticate`, then the gate, then `validate(...)` (pattern `machines/machine.routes.ts:30-77`).
Declare literal paths BEFORE `/:id` paths. A router-level middleware on `/entries` sets
`Cache-Control: private, no-store` on every response under it (§5.4 "HTTP caching").

| Method | Path | Gate | Body / query | Response |
|---|---|---|---|---|
| GET | `/meta` | `authorizeAny('atmRegister.view','atmRegisterReport.view','atmRegister.import')` | — | `AtmRegisterMetaDto` |
| GET | `/branch-options` | `authorizeAny('atmRegister.view','atmRegister.create','atmRegister.edit')` | `AtmRegisterBranchOptionsQuerySchema` | `AtmRegisterBranchOptionsDto` |
| GET | `/report` | `authorize('atmRegisterReport.view')` | — | `AtmRegisterReportDto` |
| GET | `/entries/export` | `authorize('atmRegister.export')` | `ExportAtmRegisterEntriesQuerySchema` | CSV stream (§5.9) |
| GET | `/entries` | `authorize('atmRegister.view')` | `ListAtmRegisterEntriesQuerySchema` | `okPage(AtmRegisterEntryDto)` |
| POST | `/entries` | `authorize('atmRegister.create')` | `ReceiveAtmRegisterEntrySchema` | 201 `AtmRegisterWriteResultDto` |
| GET | `/entries/:id` | `authorize('atmRegister.view')` | — | `AtmRegisterEntryDto` |
| PATCH | `/entries/:id` | `authorize('atmRegister.edit')` | `UpdateAtmRegisterEntrySchema` | `AtmRegisterWriteResultDto` |
| POST | `/entries/:id/receive` | `authorize('atmRegister.create')` | `ReceivePendingAtmRegisterEntrySchema` | `AtmRegisterWriteResultDto` |
| POST | `/entries/:id/handover` | `authorize('atmRegister.handover')` | `HandoverAtmRegisterEntrySchema` | `AtmRegisterWriteResultDto` |
| POST | `/entries/:id/reveal` | `authorize('atmRegister.viewSecrets')` | — | `AtmRegisterRevealDto` (no-store) |
| POST | `/entries/:id/link` | `authorize('atmRegister.edit')` | `LinkAtmRegisterEntrySchema` | `AtmRegisterWriteResultDto` (DEC-30) |
| DELETE | `/entries/:id` | `authorize('atmRegister.delete')` | `DeleteAtmRegisterEntrySchema` | 204 |

`register/import/register-import.routes.ts` → `buildAtmRegisterImportRouter()` (stub by WP-A,
owned by WP-B), mounted at `/atm/register/import` and listed BEFORE `/atm/register` in the manifest:

| Method | Path | Gate | Notes |
|---|---|---|---|
| POST | `/` | `authorize('atmRegister.import')` + in-memory multer, 20 MB, 1 file (precedent `modules/hr/employee-management/employees/employee.routes.ts:50-69, 95-101`) | multipart: `file`, `apply` (comma list of categories; empty = preview), `fileSha256` (required when `apply` non-empty), `reportOverride` (`'true'`). Apply additionally requires `atmRegister.viewSecrets` (DEC-7) — 403 without the key; per-branch reach → blocker `secretsOutOfReach` (§6.4). |
| GET | `/runs` | `authorize('atmRegister.import')` | `AtmRegisterImportRunDto[]`, newest first, max 50 |

Machine and label routes (MOD, §7.1).

### 5.8 Data Report — `register/register-report.service.ts`

```
scope   = scopeSelector(ctx, 'atmRegisterReport.view')
match   = registerScopeMatch(scope)                           // §5.2 — the SAME function the entry list uses:
                                                              // finer scopes narrow to the branch, own → createdBy
                                                              // (modules/fleet/dashboard/dashboard.service.ts:66-69)
groups  = repository.groupActive(match)                       // {isDeleted:false, status:'open', branchId:{$ne:null}}
settings= resolveRegisterSettings()
mapped  = groups.map(g => ({ branchCode: settings.codeByBranchId.get(String(g._id.branchId)) ?? null,
                             bankCode: g._id.bankCode ?? null, count: g.count }))
covered = registerScopeBranches(scope)                        // §5.2 — derived from the same selector (DEC-27)
shown   = ATM_REGISTER_BRANCH_CODES.filter(code => (id = settings.branchIdByCode.get(code)) !== undefined
                                              && (covered === 'all' || covered.includes(id)))
counts  = foldAtmRegisterReport(mapped, shown)                // §3.5 — the ONE definition
return { generatedAt: new Date().toISOString(), branchesShown: shown, counts }
```

Because `match` and `shown` come from the same selector, every ACTIVE entry the match returns sits in a
shown branch (or in an unmapped one, counted in Section 1 only and flagged by
`activeWithUnmappedBranch`), so Section 1 and Section 2 totals agree for every scope — apart from the
two flagged counts `activeWithUnmappedBranch` / `activeWithoutBank`, exactly as in the Excel — `own` included
(an `own` viewer sees every mapped branch, each counting only the entries they created).

`status:'open' ∧ branchId≠null` IS D7's ACTIVE (status open ⇔ startDate set ∧ endDate null).
`orgScopeMatch` = `shared/base/org-scope-match.ts:71+`. No polling; no as-of parameter (D7).

### 5.9 Export — `register/register-export.ts`

Streamed like `modules/hr/attendance/day-records/attendance-export.ts`
(`drainingWriter` from `shared/utils/draining-writer.ts`, a lean cursor read through `streamRows`
from `shared/utils/stream-rows.ts`, which closes it, audit after the stream whatever its outcome). Headers `Content-Type: text/csv; charset=utf-8`,
`Content-Disposition: attachment; filename="atm-register-YYYY-MM-DD.csv"` (Cairo date),
`Cache-Control: private, no-store`. First bytes: the UTF-8 BOM (`\uFEFF`). Columns: the Excel header TEXT (newlines
replaced by a space) of every **P-class** column in A..AW order — A..I, R..AM, AP, AQ, AR, AS, AT,
AV, AW — then `Status`. Values: branch → EGYCASH code (or empty), dates `YYYY-MM-DD`, status
English token. Cells escaped with `csvEscape` (`platform/audit/audit.export.ts:25-28`) after the
DEC-17 injection guard. Scope `registerScopeMatch(scopeSelector(ctx,'atmRegister.export'))` (§5.2 — the cursor reads the model directly, so it must apply the same match the repository would), same filters as the list.
Audit after the stream: `{ entityRef: { moduleId:'atm', entityType:'registerEntry', entityId:'export' }, action:'export', changes:[rowCount, completed, filter] }`. A download the client leaves part-way, or that a failed read stops, is audited too, with the rows written so far and `completed: false`.

### 5.10 Audit and realtime

| Item | Change |
|---|---|
| Entity types | `atm.registerEntry` (all entry writes, reveal, export) and `atm.registerImport` (one row per apply). |
| `apps/api/src/platform/realtime/realtime-registry.ts` | `REALTIME_TOPICS` (`:18-24` ATM block) += `'atm.registerEntry': { permission: 'atmRegister.view' }`. `REALTIME_EXCLUDED_ENTITIES` (`:208+`) += `'atm.registerImport': 'one audit row per import run (the attendance-import shape); the importing screen refetches itself and the entries it wrote are not individually signalled'`. |
| Literal pairs (WP ordering) | `realtime-registry.spec.ts` fails on a classified entity no non-spec source names as a literal `moduleId/entityType` pair (`:59-74, 90-94`). Both literals therefore live in WP-A files: `registerEntry` in `register.service.ts`, and `registerImport` in `register/import/register-import-run.model.ts`, which exports `export const importAuditRef = (id: string) => ({ moduleId: 'atm', entityType: 'registerImport', entityId: id });`. WP-B's `apply-import.ts` calls `importAuditRef(runId)` and never retypes the pair, so WP-A is green on its own. |
| Broadcast | `receive`/`deliver` added to the broadcast list (DEC-6); `secretRevealed`, `export`, `atmRegisterImport` do not broadcast. |
| Web | §8.2. |

### 5.11 Legacy master rows and indexes — `machines/machine.migration.ts`, `atm-indexes.ts` (NEW)

`migrateAtmLegacyTimestamps()` (called from `seedAtm`): for `atm_machines` and `atm_ref_labels`,
raw driver (bypasses Mongoose timestamps):
`collection.updateMany({ __v: { $exists: false } }, { $set: { __v: 0 } })` and
`collection.updateMany({ createdAt: { $exists: false } }, [{ $set: { createdAt: { $toDate: '$_id' }, updatedAt: { $ifNull: ['$updatedAt', { $toDate: '$_id' }] } } }])`.
Idempotent; a second run matches nothing (precedent `modules/hr/recruitment/recruitment.migration.ts:524-531`).
Mappers tolerate the gap until it runs: `toAtmMachineDto`/`toAtmRefLabelDto` (`atm.mappers.ts:21-43`)
use `doc.__v ?? 0` and `(doc.createdAt ?? doc._id.getTimestamp())`, same for `updatedAt`.

`migrateAtmIndexes()` (`atm-indexes.ts`, called from `seedAtm`): mirrors `modules/fleet/fleet-indexes.ts`
(copy the pattern, do not import Fleet): for `AtmMachineModel`, `AtmRefLabelModel`,
`AtmRegisterEntryModel`, `AtmRegisterImportRunModel` (WP-A, §6.1) build each declared
index ONE AT A TIME with the forwarded options (`name, unique, partialFilterExpression, sparse`),
duplicate groups reported and the index skipped, never resolved (DEC-26).

`atm.seed.ts` (`:9-18`) becomes, in order: `addSystemRoleGrants` (unchanged) → `migrateAtmIndexes()`
→ `migrateAtmLegacyTimestamps()`. No role or delegated grant is widened (lead override O-1:
`widenDataEditRoles()` is DROPPED — granting the new keys is the administrator's step, §12.2).

### 5.12 Bank catalog, area labels and the data-edit intake (revision 4 — DEC-35 to DEC-41)

New files under `apps/api/src/modules/atm/`:

| File | What it holds |
|---|---|
| `catalogs/bank.model.ts` | `AtmBankModel`, collection `atm_banks` (DEC-35). Indexes `ux_bank_code` and `ux_bank_ops_label_keys` (unique multikey, partial on live rows), built at boot before the seed writes. |
| `catalogs/bank-catalog.ts` | `loadAtmBankCatalog(session?)` → `{ all, active, byCode, bankOfLabel, opsLabel, nameOf, extrasInOrder }`: one lean read, no cache. `resolveBankOfLabel` and the pure `pickBankOfLabel`. |
| `catalogs/bank.service.ts`, `catalogs/bank.routes.ts` | `buildAtmBanksRouter(readKeys)` at `/atm/banks`: `GET /` (any ATM key, catalog order, archived included), `POST /` (`atmBank.create`), `PATCH /:code` (`atmBank.edit`, versioned); no DELETE. The service requires organization scope, raises the three 409s, defaults the colour and `sortOrder`, and audits `atm.bank` `create` / `update`. |
| `catalogs/catalog.migration.ts` | `planBankSeed` / `seedAtmBankCatalog`, `bankCodeOfSpelling` / `backfillBankLabelCodes` (DEC-35). |
| `catalogs/area-labels.ts` | `ensureAreaLabels`, `backfillAtmAreaLabels` (DEC-38). |
| `register/operations-intake.ts` | `recordOperationsIntake` and its pure decision functions (DEC-36). |
| `register/register-refusals.ts` | `describeBranch(ctx, branchId, settings, namingKey = 'atmRegister.view')`, moved out of the register service so the intake can name a branch by `atmMachine.view` too. |

**Boot order** (`atm.seed.ts`):
1. Super-admin grants; the two `atmBank` keys come with `atmPermissions`.
2. `migrateAtmIndexes`, which now also builds `atm_banks` and `ix_incomplete`.
3. `migrateAtmLegacyTimestamps`.
4. `seedAtmBankCatalog`.
5. `backfillBankLabelCodes`.
6. `backfillAtmAreaLabels`.

Each step is idempotent, a second boot writes nothing, and the logs carry counts and bank codes only.

**What changed where:**

| Where | Now |
|---|---|
| `register.service.ts` `meta` | Every catalog bank, archived ones too, in catalog order, with `isActive`, `sortOrder` and `isSeed`. A picker offers the active ones plus the entry's own. |
| `register.service.ts` `assertBank` | In `create`, in `update` when the bank changes, and in `receivePending`. The code must be a catalog bank (400 `body.bankCode UNKNOWN`), and an active one unless it equals the stored value (`INACTIVE`). |
| `register.service.ts` `assertOpsBankLabel` | DEC-25 on the server: `UNKNOWN`, `UNMAPPED` or `OTHER_BANK` on `body.opsBankLabel`, checked only when an override is sent. |
| `register.service.ts` list and export filter; `update` | `incomplete` (DEC-37); `update` accepts `dataIncomplete` under `atmRegister.edit`. `entrySnapshot` carries `source` and `dataIncomplete`. |
| `register.service.ts` `branchOptions` | Adds `areaOptions` `{ name, nameAr, nameEn }` and `bankVariants` `{ name, bankCode }` from `branchLabelChoices`, the same choices data-edit's options give. `areaLabels` and `bankLabels` are kept. |
| Register create, update (area changed), `receivePending`, `link` | `ensureAreaLabels` after commit (DEC-38). |
| `register-report.service.ts` | `reportBanks(catalog, groups)` and the DTO's `banks`, `section1Banks`, `section3Banks` (DEC-40). |
| `register-export.ts` | The last column, `Data incomplete` (`yes` / `no`). |
| `register/import/` `cell-convert`, `parse-rows`, `expected-data-report`, `report-check` | Typed to the six seeds; the 57-cell check is unchanged. `plan-import.ts` and `apply-import.ts` are unchanged apart from the label pass after an apply, which is isolated so it can never mark a completed run `failed`. |
| The five settlement models (`plan`, `plan-line`, `line-preparation`, `standard-load`, `layout-import-run`) | `match: ATM_BANK_CODE_PATTERN` instead of the enum; every stored value already matched. |
| `settlements/shared/settlement-context.ts` | `enabledSettlementBanks()` keeps catalog codes only, archived ones included (DS-24). |
| `settlements/prints/print.service.ts` | The catalog's Arabic name, falling back to the code. |
| `settlements/import/master-profiles.ts` | Unchanged: a seventh bank answers `ATM_LAYOUT_IMPORT_UNSUPPORTED_BANK` until it has a profile. Manual layouts, standard loads and plans work. |
| `machines/machine.service.ts`, `machine.controller.ts` | `create` and `bulkCreate` go through the intake (DEC-36, DEC-41); the single add answers 201 `AtmMachineCreateResultDto`. `update`, `moveArea` and `reassignArea` write the area label after commit, only for an active machine whose area moved or that was brought back. |
| `shared/atm-context.ts` | `manageActsInBranch`, the "manage at home" rule, shared by the label add and the machine add (DEC-39). |
| `register/register.repository.ts` | `findNewestPendingByCode(branchId, code, session)` (DEC-36 step e). |
| `platform/realtime/realtime-registry.ts` | `'atm.bank': { permission: 'atmMachine.view' }`. |

**Label kind rules** (`catalogs/ref-label.service.ts`):
- **Bank spelling.**
  - `name` is required; display names are refused (400 `NOT_ALLOWED`).
  - A `bankCode` that is sent must be an ACTIVE catalog bank (`UNKNOWN` / `INACTIVE`). A legacy
    `{ name }` body gets the bank the boot backfill would give it (`NBE FOREX` → NBE), else null.
  - A text that IS a catalog key — any bank's current or former label, its own bank's included —
    is 409 `ATM_BANK_LABEL_TAKEN`, on create and on rename. Catalog keys resolve first, so such a
    spelling would be ambiguous for another bank and redundant for its own. Legacy rows like `NBE`
    → NBE stay valid, and are hidden from the pickers.
  - An edit may set `bankCode` to an active bank, or to null.
- **Area.**
  - A `bankCode` is refused (400 `NOT_ALLOWED`).
  - `{ nameAr, nameEn }` stores the English as `name`. A legacy `{ name }` fills one display name
    by script.
  - A live duplicate is 409, as before.
  - A rename appends the old name to `formerNames`. An edit may change `nameAr` / `nameEn`; blank
    becomes null.
- **Both.** A `branchId` naming no branch is 400 `body.branchId UNKNOWN`, checked after the
  authority check. Every row a dialog creates has `origin: 'manual'`. `list` takes a `branchId`
  filter.

**`GET /atm/ref-labels/options?branchId=`** answers `AtmRefLabelOptionsDto`:
- `branchId` and `registerMapped`.
- `banks`: first the active catalog banks (`value` = `opsLabel`, `kind: 'bank'`), then the branch's
  spellings mapped to an active bank and not themselves a catalog key (`kind: 'spelling'`).
- `areas`: the branch's active area labels with both display names, with no page cap.
- `unmappedBankNames`: the distinct `bankName` texts of the branch's active machines that resolve
  to no bank, at most 100.

**Rollback.** Every change is additive: one collection, nullable fields, optional request and
response fields. Rolling back costs nothing until a non-seed bank exists. After that, older code
fails on that bank's code (`ATM_BANK_NAMES[code]` is undefined) and the old settlement enums refuse
it, so roll forward instead. On a rollback, catalog `opsLabel` edits are lost to the older code,
which reads the retired setting's values again.

---

## 6. Import pipeline (WP-B; run model and route stub by WP-A)

Files under `apps/api/src/modules/atm/register/import/`. Precedent for the whole shape: the HR
roster import — one endpoint, preview unless actions are named, the browser posts the same file
twice, nothing stored between the calls (`modules/hr/employee-management/employees/employee-roster-import.ts:1-7, 35-48, 109-128`).

### 6.1 Run record — `register-import-run.model.ts` (WP-A creates; WP-B uses)

```ts
export interface AtmRegisterImportRunDoc {
  _id: Types.ObjectId;
  fileName: string; fileSha256: string;
  state: 'running' | 'completed' | 'failed' | 'abandoned';
  actorUserId: Types.ObjectId | null; actorName: string | null;
  startedAt: Date; finishedAt: Date | null;
  categories: string[]; reportOverride: boolean;
  counts: Record<string, number>;                                   // Mixed
  rows: { importRow: number; entryId: Types.ObjectId | null; outcome: string }[];  // no field values
  headerFills: { column: string; fill: string }[];                  // row-1 fills (M, O, Z, AP red — EG-2)
  error: string | null;                                             // never a cell value
}
export const importAuditRef = (id: string) => ({ moduleId: 'atm', entityType: 'registerImport', entityId: id }); // §5.10
// { versionKey: false } — operational bookkeeping, the go-live-run precedent (modules/it/go-live/go-live-run.model.ts:1-34)
index { state: 1 } unique 'ux_one_running' partialFilterExpression { state: 'running' }
index { startedAt: -1 } 'ix_startedAt'
collection 'atm_register_import_runs', model 'AtmRegisterImportRun'
```

### 6.2 Reading — `read-register-workbook.ts`

**Nothing touches the disk.** ExcelJS's streaming `WorkbookReader` writes every worksheet that
precedes `xl/sharedStrings.xml` in the zip to an OS temp file and deletes them only after its loop
ends (`node_modules/exceljs/lib/stream/xlsx/workbook-reader.js:107-129, 140-148`; `tmp.setGracefulCleanup`
at `:17`). The owner's workbook stores `sheet2..7.xml` BEFORE `sharedStrings.xml`, and `sheet5.xml` is
`Sheet1`, whose cached values re-expose AO and J (EG-13); ExcelJS's own writer puts every worksheet
first (`node_modules/exceljs/lib/xlsx/xlsx.js:655-662`), so a test workbook would spill its fake
secrets too. Re-verified for revision 2: a two-sheet workbook read directly leaves 2 temp files
after `break`; the reduced zip below leaves 0. So the upload is NEVER handed to `WorkbookReader`:

1. **Open the zip in memory** with JSZip (`jszip@3.10.1`, already installed as an ExcelJS
   dependency; ships its own types). WP-B declares `"jszip": "^3.10.1"` in `apps/api/package.json`
   `dependencies` (lockfile updated by `npm install`), loads it with `await import('jszip')` at the
   point of use, and adds `'jszip'` to `external` in `apps/api/tsup.config.ts` beside `exceljs`
   (`:49-60` — the same CJS-in-ESM reason). Any open/parse failure → 422 with the generic
   message (§6.7).
2. **Read only five entries**, each through `file.nodeStream('nodebuffer')` with a byte counter that
   destroys the stream past its cap (a zip bomb cannot inflate further than the cap; caps against
   the real file in brackets): `xl/workbook.xml` ≤ 2 MB (2.5 KB), `xl/_rels/workbook.xml.rels` ≤ 2 MB
   (1.7 KB), `xl/styles.xml` ≤ 10 MB (83 KB), `xl/sharedStrings.xml` ≤ 50 MB (1.1 MB), and the worksheet
   that `workbook.xml` names `ATMs` (resolved through its `r:id` in the rels) ≤ 150 MB (35.8 MB). Over a
   cap → 422 `ATM_REGISTER_IMPORT_LAYOUT` with `details: [{ field: 'file', code: 'TOO_LARGE', message: '<entry path>' }]`.
   No sheet named `ATMs` → 422 `ATM_REGISTER_IMPORT_LAYOUT`. No other worksheet is ever inflated.
3. **Re-zip in memory** with `new JSZip()`, adding in this order: `xl/_rels/workbook.xml.rels`,
   `xl/workbook.xml`, `xl/styles.xml`, `xl/sharedStrings.xml`, then the ATMs worksheet under its
   ORIGINAL path (so ExcelJS maps sheet number → name); `generateAsync({ type: 'nodebuffer', compression: 'STORE' })`.
   JSZip writes entries in insertion order (verified), so the worksheet arrives after the shared
   strings and the reader parses it straight from the stream.
4. **Stream it**:
   ```ts
   const reader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from(reduced),
     { sharedStrings: 'cache', hyperlinks: 'ignore', styles: 'cache', worksheets: 'emit', entries: 'emit' });
   for await (const ws of reader) { /* the only worksheet: ATMs */ for await (const row of ws) { … } }
   ```
   ExcelJS is loaded with `await import('exceljs')` at the point of use, never statically
   (`apps/api/src/workforce-import/read-workbook.ts:7-13, 113`; external in `apps/api/tsup.config.ts:60`).
   `styles:'cache'` is required: it turns date-formatted numbers into `Date`s and exposes
   `cell.numFmt` (AO reads `00 - 00 - 00`) and `cell.fill` (legacyMarks). Feasibility of the
   streaming reader on the real sheet: 37,639 rows in 4.1 s, 152 MB RSS (the non-streaming
   `wb.xlsx.load` ran an investigation out of memory on the 35.7 MB sheet XML, declared range `A1:XEY37639`).
5. **Bounds** (`REGISTER_WORKBOOK_LIMITS`, the second parameter of `readRegisterWorkbook` so tests can shrink them): at most 60,000 rows iterated in total (the real sheet has 37,639, but reading stops at
   the sentinel, row 5000) and 60 s wall-clock for the whole read; either → 422
   `ATM_REGISTER_IMPORT_LAYOUT` (`TOO_LARGE`). The upload itself is capped at 20 MB by multer (§5.7).

- Row 1: read cells 1..49 (A..AW) only; bind with `register-columns.ts` (§6.3). Any column of
  `ATM_REGISTER_COLUMNS` not found at its `(header, occurrence)` → 422 `ATM_REGISTER_IMPORT_LAYOUT`
  with `details: [{ field: '<letter>', code: 'MISSING_HEADER', message: '<expected header>' }]`
  (header texts are not secret). Comparison is EXACT except `\r\n`→`\n` and number headers via
  `String(value)` — deliberately stricter than the roster's loose `normalizeHeader`
  (`workforce-import/columns.ts:69-77`) because D8 says exact. Row 1's solid fills of A..AW are
  captured as `headerFills` (stored on the run, EG-2).
- Row 2 is skipped (SUM band). From row 3: if `trim(A) === 'END'` → `sentinelRow` and the loop
  `break`s (nothing to drain: the reduced zip holds one worksheet and nothing is on disk); a row
  with no value in A..AW is skipped; > 20,000 data rows without a sentinel → 422.
- Cell unwrapping as `read-workbook.ts:167-188` (`result` for formulas, `richText` joined, `text` of
  hyperlinks) plus `{ error: '#N/A' }` → an error marker. Only cells 1..49 are ever read.
- Per row it also captures `legacyMarks`: `cellFills` = every A..AW cell whose fill is a solid
  pattern other than none/white, as `{ column, fill }` with `fill` = `argb` or `theme:<n>:<tint>`
  (K/S columns included — a colour is not a secret); `areaRedFill` = B's fill is `FFFF0000`;
  `rowFill` = A's fill or null. `legacyMarks` is null when `cellFills` is empty.
- The buffer comes from multer memory storage and is dropped after the response; the reduced zip and
  the inflated entries are local variables of the request; nothing is written to disk (precedent
  `employee.routes.ts:43-49`); the run stores only `fileName`, `fileSha256` and `headerFills`.
  The import integration suite asserts that `os.tmpdir()` gains no file during preview or apply,
  with a fixture whose secret-bearing second sheet precedes `sharedStrings.xml` (§10.3).

### 6.3 Conversion — `register-columns.ts`, `cell-convert.ts`

| Kind (from §4) | Rule |
|---|---|
| text | `null/undefined/''/whitespace` → null; string → `trim()` (JS `trim` removes NBSP/TAB); number → `String(n)` (integers without exponent); boolean → `TRUE`/`FALSE`; `Date` → `YYYY-MM-DD` + issue `dateInText` (detail = the date, P columns only); error → null + `errorValue` (detail = `#N/A` etc., P only) — col B uses `areaError`. |
| code (D) | number → `String(n)`; string → raw; issue `codeWhitespace` when raw has NBSP or leading/trailing space; `normalizeAtmMachineCode(raw)`; `#` and `********` kept + `placeholderCode`; empty → null + `noCode`. |
| bank (C) | exact enum → code; `ATM_REGISTER_BANK_ALIASES` → code + `bankAlias` (detail = the alias); other non-empty → null + `unknownBank` (detail = value). |
| branch (A) | `EGYCASH-1..7` exact → code; empty → null + `noBranch`; other → null + `unknownBranchCode`. |
| date (AQ, AR) | `Date` → UTC `YYYY-MM-DD`; integer in `36526..54789` → Excel serial (1900 system, epoch 1899-12-30) + `dateSerial` (detail = resulting date) — the 3 BM rows 2546–2548 (`46034` → `2026-01-12`) MUST convert, they are counted by the Data Report; empty → null; ANY other non-empty cell (text, whitespace-only, out-of-range or fractional number, error value) → null + `dateInvalid` AND the file-level blocker `dateUnreadable` (DEC-31): the Excel's CI reads such a cell as "set" (`AR=""` is false, a text AQ is `>0`), so writing null would turn a handed-back row into `open` (and couple it) or an open row into `pending`. The snapshot has none (no string cell in AQ/AR, re-verified). |
| time (AK, AL, AM) | A `Date` (ExcelJS produces one only when the cell carries a time number format — verified: `h:mm` / `h:mm AM/PM`) → `days = (d − Date.UTC(1899,11,30)) / 86400000`; the stored text is what Excel SHOWS: the time of day of `days` (fraction of a day, minutes rounded, `HH:mm` 24-hour; a whole day shows `00:00`, as Excel shows `0:00`). When `days ≥ 1` (AK 19 + AL 53 cells equal exactly 1.0; AK 5 + AL 1 exceed a day — 3.75 shows `18:00`) the row also gets `timeOverDay` with detail = the day count as text (`1`, `3.75`), so the number is kept without interpreting it (EG-20 — whether 1.0 means `24:00` is the owner's answer). A NUMBER cell in General format (AK 68, AL 27, AM 25 — zeros, small integers, day fractions) is NOT converted: text rule, `String(n)`, which is what Excel displays for it. Strings kept as typed (`متاح 24 ساعة`, `9:00AM`, `15:00PM`, `أخر ضوء`). |
| AO combination | number: integer `0..999999` AND `numFmt` made of zero-groups and literals (`/^0+(\s*-\s*0+)+$/`) → digits zero-padded to the format's zero count and laid into the format (`00 - 00 - 00` → `NN - NN - NN`, what Excel displays); other numbers (7 digits, decimals) → `String(n)` + `aoShape`. string: trimmed, kept; `aoShape` unless `/^\d{2} ?- ?\d{2} ?- ?\d{2}$/`. **The value goes only to the sealer.** `aoShape.detail` is always null. |
| name (E) | text rule; null → issue `noName` (DEC-32; 0 in the snapshot). |
| K columns (J..Q, AN, AU) | text rule, but every issue `detail` is forced to null. |

### 6.4 Planning — `parse-rows.ts`, `plan-import.ts`

`parse-rows.ts` → `ParsedRow { importRow, values (all fields), status, issues[], legacyMarks, plaintextCombination: string|null }`
(the plaintext is held only in memory and is never serialized into any DTO, log or error).
File-level issues added after all rows are read:

| Issue | Rule |
|---|---|
| `duplicateOpen` | ≥ 2 open rows with the same non-placeholder code → on each, detail = the other row numbers (2013: 456/2314, 2015: 457/2315). These rows get `openPeriodExempt:true` (DEC-11). Every detail that lists other rows or spellings (`duplicateOpen`, `openNotNewest`, `hdbSpelling`, `exactDuplicate`, `serialDuplicate`) names at most 20 and counts the rest — `…, … (+n)` — and every file-level check is linear in the group, never quadratic (review finding SEC-3: 8,000 identical rows built 750 MB of detail text; `hdbSpelling`'s trailing digits are scanned by hand, not with a backtracking regex). |
| `openNotNewest` | an open row whose startDate is earlier than another row of the same code (4670083, 27740059). |
| `hdbSpelling` | HDB rows whose trailing digits occur under a different HDB spelling (detail = the other spelling) — EG-7. |
| `exactDuplicate` | rows whose 49 converted values hash identically (sha-256 in memory; detail = other row numbers, NEVER values) — 3365/3542, 3540/3541. |
| `serialDuplicate` | open rows sharing a serial (trim, case-insensitive) under different codes. |
| `idFormat` | bank set ∧ code set ∧ `!atmRegisterIdFormatOk`. |
| `endBeforeStart`, `futureStart`, `futureEnd`, `openNoArea`, `noBank` | as named; "future" = after the Cairo calendar day of the upload. |
| `noName`, `dateInvalid` | set per row by §6.3; listed here because they feed the coupling reason `noName` and the blocker `dateUnreadable`. |

`plan-import.ts` (DB reads, no writes) produces, in this order. **Reach rule (review finding F-3):**
everything the plan reads from the database or will write is limited to the importer's reach —
`inReach(b)` = `keyReachesBranch(ctx,'atmRegister.import', b)`; rows with no/unknown branch need an
organization-wide `atmRegister.import`.

1. **Branches**: for every code present: mapped branchId (setting), branch exists ∧ `status==='active'`, `inReach`. Rows whose column A is blank or unknown count as one more "branch" that is in reach only for an organization-wide importer. Blockers: `branchUnmapped`, `branchInactive`, `branchOutOfReach`.
2. **Secrets reach** (DEC-7 per branch): for every branch (and the no-branch group) whose rows carry ANY J..Q, AN, AO or AU value, the importer must hold `atmRegister.viewSecrets` there — `keyReachesBranch(ctx,'atmRegister.viewSecrets', b)`, organization scope for the no-branch group. Otherwise blocker `secretsOutOfReach` (apply also answers 403 when the key is absent altogether, §5.7).
3. **alreadyImported**: `importRow`s that already exist in `atm_register_entries` (`ux_import_row`) — skipped by `entries` — **only when nothing changed** (DEC-31): each already-imported row's converted P and K values (A..AN, AP..AW; AO is not compared — comparing would mean opening 3,000 sealed values) are compared with the stored entry; any difference → item in report category `changedSinceImport` (`importRow`, `entryId`, `columns` = the differing Excel letters, NEVER values) and blocker `changedSinceImport`. **The letters are an equality test per column, so they are computed only over what the importer may read** (review finding SEC-1): a stored entry whose branch `atmRegister.import` does not reach is never compared — the row is reported as differing in column A only (true: the file puts it in a branch in reach), with `entryId: null` — and the K columns (J..Q, AN, AU) are compared only where `atmRegister.viewSecrets` covers the stored entry's branch (the DTO's `secretsVisible` rule); otherwise a K difference is not looked at. All stored row numbers are still read, whatever their branch, because `ux_import_row` is company-wide. Re-applying the SAME unchanged file stays idempotent; a changed row is resolved by the owner (bring the entry in line through the register — edit/handover — or correct the file), then the file is previewed again.
4. **Report check** (§6.5) → blocker `reportMismatch` when `!allMatch`.
5. **Unreadable dates**: any row with `dateInvalid` on AQ or AR → blocker `dateUnreadable` (the rows are in the issues list) — DEC-31.
6. **Open in the register**: every OPEN row (not already imported, non-placeholder code) whose code has a non-deleted open entry in the register (`findOpenByCodes`, any branch) OTHER than an entry imported from a row of this same file (an in-file pair is `duplicateOpen`, handled by DEC-11 — so a re-run after a crash between the two rows of a pair is not blocked) → item in report category `openInRegister` (`entryId`; other branch named only when `inReach`) and blocker `openInRegister`. Inserting it would hit `ux_open_period_per_code` and abort its whole batch (`base.repository.ts:394-405`); which record is right is the owner's call (hand over / delete the register entry, or correct the file).
7. `secretStoreUnavailable` when any AO value exists and `!getSecretStore().available()`; `runInProgress` when a non-stale `running` run exists.
8. **Reconciliation** of OPEN rows with a mapped, IN-REACH branch and a non-placeholder code, in row
   order, against the live masters (`AtmMachineModel`, `isDeleted:false`) and against "masters this
   plan will create" (so the second row of a duplicate-open pair becomes `link`). Rows of
   out-of-reach branches are counted in the branches table only — no item, no master data, is
   shown for them (and the plan carries `branchOutOfReach`, so nothing is applied):

| Category | Condition | Effect when approved |
|---|---|---|
| `link` (approvable) | active master for (branch, code) ∧ no active master with the code in another branch — no area or name needed | `entry.machineId = master._id`, `entry.opsBankLabel = master.bankName` (D5); master untouched; `differences` listed (DEC-8). |
| `reactivate` (approvable) | archived master for (branch, code) ∧ no active master elsewhere ∧ area set ∧ name set | `coupleReceipt` path 5 with `opsLabel` (setting, or `NBE FOREX` under `nbeForex`). |
| `create` (approvable) | no live master ∧ no active master elsewhere ∧ area set ∧ name set | `coupleReceipt` path 6. |
| `nbeForex` (approvable) | bankCode NBE ∧ area ends with ` FX` (case-insensitive, after trim) ∧ plan is `create`/`reactivate` → item; plan `link` → listed with reason `keepsMasterLabel`; branch without an ACTIVE `NBE FOREX` bank label → reason `labelMissing`, not applicable (DEC-16) | `opsLabel = 'NBE FOREX'` for the create/reactivate of those rows (same apply) or, when they are already coupled with the default label, `entry.opsBankLabel = 'NBE FOREX'` + `syncEntryToMaster` (D2 edit sync). |
| `activeElsewhere` (report, EG-19) | an ACTIVE master with the code in ANOTHER branch, whatever this branch holds — `coupleReceipt` checks this first (§5.5 step 1, DEC-9) | none — the entry is written `unlinked`. The card shows `pairs` (other branch → this branch, count) and the items with `otherBranchCode/Name` when the other branch is in reach. The resolution is the owner's (EG-19); after it, `POST /entries/:id/link` couples the entry (DEC-30). |
| `cannotCouple` (report) | reason `blankArea` (no active master in the branch ∧ area null — a subset of the 297 open rows without an area: the rest LINK), `noName`, `noBank`, `noCode`, `placeholderCode` | none — the entry is written `unlinked` |
| `activeMasterWithoutOpenEntry` (report) | active master in a mapped, IN-REACH branch whose code has no open row in the file for that branch and no open entry in the register | none (owner decides in data-edit) |

`entries` (approvable) = all rows not `alreadyImported`: count, by status. Ended/pending rows are
written with `machineId` = the live master of (branch, code) when one exists (history link, no
master change).

### 6.5 The 57-number check — `report-check.ts`, `expected-data-report.ts`

`groups` = parsed rows with `isAtmRegisterActive({ hasBranch: branchCode!==null, startDate, endDate })`
grouped by (Excel branch code, bankCode) → `foldAtmRegisterReport(groups)` (§3.5 — the same code the
report endpoint runs) → for each `ATM_DATA_REPORT_CELLS` ref: `recomputed` vs `expected`.
`expected-data-report.ts` (counts only, safe to commit) — the verified 2026-09-29 snapshot
(cached values re-computed with 0 mismatches under both the Excel formulas and D7):

| Section | Values |
|---|---|
| 1 (AD3..AJ3) | NXT 4 · NBE 1212 · BM 1101 · CIB 107 · HDB 77 · BRK 106 · total 2607 |
| 2 (AD5..AK5) | EGYCASH-7 188 · -1 1061 · -2 211 · -3 154 · -4 294 · -5 475 · -6 224 · total 2607 |
| 3 rows 8..14 × NBE, BM, CIB, HDB, BRK, NXT | -1: 487, 412, 60, 43, 57, 2 · -5: 198, 177, 47, 27, 24, 2 · -2: 85, 126, 0, 0, 0, 0 · -3: 86, 68, 0, 0, 0, 0 · -4: 138, 156, 0, 0, 0, 0 · -6: 62, 162, 0, 0, 0, 0 · -7: 156, 0, 0, 7, 25, 0 |

`allMatch` = all 57 equal. Apply is refused with 422 `ATM_REGISTER_IMPORT_BLOCKED` (detail
`reportMismatch`) unless `allMatch` or the request carries `reportOverride=true` (D8). The
fresh cut-over copy will normally differ from the snapshot (receipts after 2026-09-29), so the
override is the expected path at cut-over and is recorded on the run and in the audit row.

### 6.6 Apply — `apply-import.ts`

1. Re-read and re-plan the uploaded bytes (no server state between preview and apply). Request
   `fileSha256` ≠ computed → 409 `ATM_REGISTER_IMPORT_FILE_CHANGED`.
2. Caller lacks `atmRegister.viewSecrets` altogether → 403. Blockers other than `reportMismatch`
   (incl. `secretsOutOfReach`, `dateUnreadable`, `openInRegister`, `changedSinceImport`) → 422
   `ATM_REGISTER_IMPORT_BLOCKED` (details = blocker codes); `reportMismatch` without override → same.
3. Mark any `running` run older than 30 min `abandoned`; insert a `running` run (`ux_one_running` →
   409 `ATM_REGISTER_IMPORT_RUNNING`).
4. `entries` approved: rows not yet imported, row order, batches of 200, each batch one
   `unitOfWork`: mint `_id`, seal AO, insert entry `{ source:'import', importRunId, importRow,
   status, openPeriodExempt, importIssues, legacyMarks, createdBy: actor }` (open rows `machineId:null`
   until coupled). Append `{importRow, entryId, outcome:'imported'}`. Race guard: inside the batch
   transaction, open rows are re-checked with `findOpenByCode(code, session)`; a row whose code
   has an open entry that was NOT imported from a row of this file (i.e. a receipt made during the
   apply — the plan's `openInRegister` blocker caught everything older; an exempt duplicate-open
   pair is therefore unaffected) is NOT inserted and
   gets outcome `openInRegister` — the batch never aborts on `ux_open_period_per_code`.
5. Coupling categories approved: over the imported open entries with `machineId:null` (this run or
   earlier) **whose `branchId` is one of THIS file's branches and in the importer's reach**
   (review finding F-3), row order, batches of 200: the category is re-decided LIVE inside the batch
   transaction; applied only if that category is approved, else outcome `notApproved`; refusals →
   outcome `cannotCouple:<reason>` (`activeElsewhere` included). `nbeForex` as in §6.4, under the same
   branch restriction.
6. Finish: run `completed`, `finishedAt`, `counts` (`ATM_REGISTER_IMPORT_OUTCOMES`: imported,
   alreadyImported, linked, reactivated, created, nbeForex, cannotCouple, notApproved,
   openInRegister); one audit row
   `{ entityRef: importAuditRef(runId), action:'atmRegisterImport', changes:[categories, reportOverride, fileSha256, counts] }`
   (`importAuditRef` from the run model, §5.10 — the pair is never retyped here).
   Machine audits for created/reactivated masters ARE recorded per master (they are Operations
   facts), entry audits are not (DEC-15). An exception → run `failed` with a message that contains
   no cell value; the committed batches stay (idempotent re-run).
7. Response: `mode:'applied'`, `applied` summary, plus the plan recomputed after the writes.

**Secrets in the import, restated:** plaintext AO and K values exist only in the parsed rows in
memory — never on disk (§6.2) and never passed to the logger (§5.4); the preview DTO carries no
field of J..Q, AN, AO, AU (items carry only `importRow`, branch, code, name, area, bank, and for
`changedSinceImport` the column LETTERS that differ); issue details for those columns are null;
errors carry codes and column letters; Sentry never receives the upload body (DEC-34).

### 6.7 Controller — `register-import.controller.ts`

Parses multipart fields (unknown `apply` names are DROPPED, never read as "all" — `employee-roster-import.ts:37-48`),
requires `file`, maps parse failures to 422 with a generic message ("not a readable .xlsx
workbook" — the library message is not echoed), returns `AtmRegisterImportResultDto`.
`GET /runs` maps run docs to `AtmRegisterImportRunDto` (no `rows`).

---

## 7. Data-edit permission split, navigation, seed, page registry (WP-A)

### 7.1 Server-side split (D2) — exact gates after the change

| Route | Today | After | File |
|---|---|---|---|
| `GET /atm/machines` | `atmMachine.view` | unchanged | `machines/machine.routes.ts:32-38` |
| `POST /atm/machines` (single add) | `manage` | **unchanged — manage only**. Since revision 4 the key must reach the acting branch (`manageActsInBranch`, DEC-39), and the add is recorded in the register (DEC-36); 201 `AtmMachineCreateResultDto` | `:41-47` |
| `POST /atm/machines/bulk` | `manage` | **unchanged — manage only**, with the same branch-reach check and register record per row (DEC-36, DEC-41) | `:48-54` |
| `POST /atm/machines/bulk-delete` | `manage` | **unchanged — manage only** | `:55-61` |
| `POST /atm/machines/reassign-area` | `manage` | **unchanged — manage only**; now also moves the open register entries' area (DEC-4) | `:62-68` |
| `PATCH /atm/machines/:id` (name/bank/area/isActive = archive) | `manage` | **unchanged — manage only**; an area change also moves the open entries' area (DEC-4) | `:69-75` |
| `PATCH /atm/machines/:id/area` | — | **NEW** `authorizeAny('atmMachine.moveArea','atmMachine.manage')`, body `UpdateAtmMachineAreaSchema` | declare before `/:id` |
| `GET /atm/ref-labels/options` | — | **NEW (revision 4)** `authorizeAny('atmMachine.view','atmMachine.manage','atmMachine.moveArea','atmRefLabel.create','atmRefLabel.edit')`; one of them must reach the branch, or `manage` at home (DEC-39). Declared before `/:kind` | `catalogs/ref-label.routes.ts` |
| `GET /atm/ref-labels/:kind` | `atmMachine.view` | unchanged; since revision 4 it takes a `branchId` filter | `catalogs/ref-label.routes.ts:65-71` |
| `POST /atm/ref-labels/:kind` | `manage` | `authorizeAny('atmRefLabel.create','atmMachine.manage')`. Since revision 4 also `atmRegister.create` and `atmRegister.edit`, which the service limits to kind `area` in a branch they reach (DEC-39) | `:72-78` |
| `PATCH /atm/ref-labels/:kind/:id` (rename / archive toggle) | `manage` | `authorizeAny('atmRefLabel.edit','atmMachine.manage')` | `:79-85` |
| `DELETE /atm/ref-labels/:kind/:id` | `manage` | **unchanged — manage only** | `:86-92` |
| `GET /atm/banks` | — | **NEW (revision 4)** any ATM key (`authorizeAny(...atmPermissions keys)`, passed in by `atm.module.ts`) | `catalogs/bank.routes.ts` |
| `POST /atm/banks` | — | **NEW (revision 4)** `atmBank.create`, and the service requires ORGANIZATION scope (DEC-39) | `catalogs/bank.routes.ts` |
| `PATCH /atm/banks/:code` | — | **NEW (revision 4)** `atmBank.edit`, organization scope, versioned; there is no DELETE | `catalogs/bank.routes.ts` |

`authorizeAny` exists and audits a denial as `permissionDenied` with the joined keys
(`platform/rbac/rbac.middleware.ts:52-75`; precedent `modules/fleet/dashboard/dashboard.routes.ts:15-26`).
Service changes:

- `machine.service.ts`: new `moveArea(id, { area, version }, ctx)` — **the authorizing key must reach
  the machine's branch** (DEC-29; `widestScopeSelector` alone is not enough: over the branch-only
  machine repository a department/section scope widens to the company, `org-scope-match.ts:79-85`):
  `before = atmMachineRepository.findById(id)` (unscoped, live rows) → allowed when
  `keyReachesBranch(ctx,'atmMachine.moveArea', before.branchId)` OR
  `atmMachineRepository.findById(id, scopeSelector(ctx,'atmMachine.manage')) !== null` (a `manage`
  holder keeps exactly today's reach — nothing removed); else 404. One `unitOfWork`:
  `ensureMachineVersioned`, `updateById({ area }, { version, session })`, `syncMasterAreaToEntries`
  (§5.5); audits after commit (machine `update` + entries `update`). Like `reassignArea` (`:212-228`)
  the server does not check the area against the label list; the dialog offers active labels only.
  `update()` (`:152-171`) and `reassignArea()` (`:212-228`) run inside a `unitOfWork` and call
  `syncMasterAreaToEntries` when the area changed. Export `snapshot` (`:33-40`) for the coupling.
- `ref-label.service.ts` `update()` (`:73-93`): `before = atmRefLabelRepository.findById(id)`
  (unscoped) → allowed when `keyReachesBranch(ctx,'atmRefLabel.edit', before.branchId)` OR the label
  is found under today's `scopeSelector(ctx,'atmMachine.manage')` (`:74`); else 404; the write then
  runs unscoped by id with the version.
  `create()` keeps `resolveAtmBranchId` (`:52`) to choose the branch, then asserts
  `keyReachesBranch(ctx,'atmRefLabel.create', branchId) || keyReachesBranch(ctx,'atmMachine.manage', branchId)
  || (hasPermission(ctx,'atmMachine.manage') && branchId === ctx.branchId)`
  else `ForbiddenError` — `currentBranchId` accepts any active branch in the UNION reach of all the
  caller's grants (`shared/types/index.ts:295-303`, `shared/atm-context.ts:19-29`), so without this an
  Operations user holding `atmRefLabel.create` in Alex and any unrelated key reaching Tanta could file
  labels (e.g. `NBE FOREX`, which drives D5/DEC-16) in Tanta. A `manage` holder at organization or
  branch scope is unaffected (`atm.spec.ts` operator bundle: branch scope, placed in Alex). A `manage`
  holder at department, section or own scope (no whole-branch reach) keeps today's add in the branch
  they are PLACED in — the third clause; nothing legacy is removed, and the placement is the one
  branch no other key can stretch (review finding F1, `atm-data-edit-permissions.spec.ts`).
  The fallback applies only to those three scopes AND only when the `manage` grant lists no units
  elsewhere: an ADR-032 deputy holding `manage` delegated over Alex while placed in Tanta answers
  through `keyReachesBranch` alone, so it cannot file a label into Tanta (review REG-2, test 9c).
  `remove()` keeps `manage` (`:96-106`).
- Route-file header comments (`machine.routes.ts:1-4`) restate the split.
- **Revision 4 (DEC-39).** The manifest declares the resource `atmBank` (`create`, `edit`; page
  `atm.register`; name «بنوك الصراف الآلي»), mounts `/atm/banks` and lists the collection `atm_banks`.
  The ref-label `create()` takes an optional `branchId`, defaulting to the acting branch as before.
  Its authority must cover THAT branch: today's rule (the label key, `manage` reaching it, or
  `manage` at home), or, for kind `area` only, `atmRegister.create` / `atmRegister.edit` reaching
  it. The "manage at home" rule moved to `shared/atm-context.ts` as `manageActsInBranch`, and the
  machine add now asks it too (otherwise 403).

### 7.2 Manifest — `atm.module.ts`

```ts
const machinePermissions = declarePermissions('atm', 'atmMachine',
  { en: 'ATM machines', ar: 'ماكينات الصراف الآلي' }, ['view'],
  [
    { action: 'manage', name: { en: 'Manage the machine master and its lists', ar: 'إدارة بيانات الماكينات وقوائمها' } },
    // Legacy «نقل ماكينة لمنطقة» (contad_app.js:2529-2541), kept for Operations (D2): the area only.
    { action: 'moveArea', name: { en: 'Move a machine to another area', ar: 'نقل ماكينة لمنطقة' } },
  ], 'atm.machines');
const refLabelPermissions = declarePermissions('atm', 'atmRefLabel',
  { en: 'ATM bank and area lists', ar: 'قوائم البنوك والمناطق للصراف الآلي' }, ['create', 'edit'], [], 'atm.machines');
const registerPermissions = declarePermissions('atm', 'atmRegister',
  { en: 'ATM register', ar: 'سجل الماكينات' }, ['view', 'create', 'edit', 'delete', 'export'],
  [
    { action: 'handover', name: { en: 'Hand a machine back to the bank', ar: 'تسليم ماكينة للبنك' } },
    { action: 'viewSecrets', name: { en: 'View machine keys and reveal the safe-door combination', ar: 'عرض مفاتيح الماكينة وكشف الرقم السري لباب الخزينة' } },
    { action: 'import', name: { en: 'Import the register workbook', ar: 'استيراد ملف سجل الماكينات' } },
  ], 'atm.register');
const registerReportPermissions = declarePermissions('atm', 'atmRegisterReport',
  { en: 'ATM Data Report', ar: 'تقرير بيانات الماكينات' }, ['view'], [], 'atm.register-report');
```

- **No parentheses inside any name string** in `atm.module.ts`: the CI parser counts `(`/`)` to find
  the end of each `declarePermissions(` call (`scripts/check-page-registry.mjs:35-63`); the pageId
  must stay the LAST string argument (`:51`).
- `atmPermissions` (`:103-108`) = replenishment, maintenance, mailTicket, machine, refLabel, register, registerReport.
- `atmPages` (`:110-139`) += `{ id: 'atm.register', moduleId: 'atm', name: { en: 'ATM register', ar: 'سجل الماكينات' }, route: '/atm/register', sortOrder: 50 }`,
  `{ id: 'atm.register-report', moduleId: 'atm', name: { en: 'Data Report', ar: 'تقرير البيانات' }, route: '/atm/register/report', sortOrder: 60 }`
  (keep `{ id: …, moduleId: …` order — `check-page-registry.mjs:24-32`; id regex `def.ts:74`).
- `routes` (`:148-156`) += `{ prefix: '/atm/register/import', router: buildAtmRegisterImportRouter() }`
  then `{ prefix: '/atm/register', router: buildAtmRegisterRouter() }`.
- `collections` (`:157-163`) += `'atm_register_entries'`, `'atm_register_import_runs'`.
- `scheduledTasks` (`:165-179`) += (DEC-33, the `automation.rotateCredentialKeys` shape, `modules/automation/automation.module.ts:68-81`):
  ```ts
  {
    key: 'atm.rotateRegisterCombinationKeys',
    description: 'Re-wrap register safe-door combinations still sealed under a retired key. Touches the data key only — no plaintext exists at any point.',
    cron: '45 2 * * *',            // nightly, after the automation sweep at 02:30
    ownerService: 'atm',
    handler: async () => { await rotateRegisterCombinationKeys(); },
  }
  ```
- Header comment (`:1-13`): the efficiency slice is now here; `Efficiency-admin` → the register keys.
- Totals: **27 permissions, 6 pages, 8 routes, 7 collections, 2 scheduled tasks**.

### 7.3 Navigation (DEC-5 as narrowed by O-1 — the widening below is DROPPED; keep only the `previousPermission` correction)

`apps/api/src/seed-navigation.ts`:

1. `interface AppDef` (`:23-45`) gains, beside `previousIcon` (`:28-37`):
   `previousPermission?: string` — "the key this row shipped with before; corrected only while the
   stored row still holds exactly this value, so an administrator's own choice survives".
2. New `correctApplicationPermission(def, by)` next to `backfillApplicationIcon` (`:1232-1241`):
   `if (def.previousPermission === undefined) return; existing = applicationRepository.findOne({ route }); if (existing === null || existing.permissionKey !== def.previousPermission) return; applicationService.update(id, { permissionKey: def.permission, version: existing.__v }, by)`.
   Called in `syncNavigationCatalog` right after `backfillApplicationIcon(app, actor)` (`:1301`).
3. ATM block (`:980-1060`): the `Machine Data` row (`:1052-1058`) becomes
   `permission: 'atmRefLabel.create', previousPermission: 'atmMachine.manage'`; append after it
   `{ en: 'ATM Register', ar: 'سجل الماكينات', route: '/atm/register', icon: 'shield', permission: 'atmRegister.view' }`
   and `{ en: 'Data Report', ar: 'تقرير البيانات', route: '/atm/register/report', icon: 'chart', permission: 'atmRegisterReport.view' }`
   (`shield`/`chart` are registered glyphs — `apps/web/src/platform/navigation/app-icon.tsx:40-93`).
   Update the block comment: the data-edit row key is the Operations key; route guard is any-of.
4. The import page has NO nav row (reached from the register page header).

**DROPPED by O-1 — not implemented; kept below only as the record of what was decided against.**
`atm.seed.ts` `widenDataEditRoles()` (runs before the nav sync — `server.ts:42-44`):
```ts
const row = await applicationRepository.findOne({ route: '/atm/data-edit' });
if (row === null || row.permissionKey !== 'atmMachine.manage') return;   // already corrected / fresh / admin-chosen
const changed = await rbacService.addGrantsToRolesHolding('atmMachine.manage',
  ['atmRefLabel.create', 'atmRefLabel.edit', 'atmMachine.moveArea']);
logger.info({ changed }, 'atm: roles holding atmMachine.manage widened with the data-edit split keys');
```
New `rbacService.addGrantsToRolesHolding(heldKey, keys): Promise<number>` in
`platform/rbac/rbac.service.ts` beside `addSystemRoleGrants` (`:1433-1444`): strictly additive,
idempotent, for every role from `roleRepository.findGrantingPermission(heldKey)` (`platform/rbac/rbac.repository.ts:52-57`)
`$addToSet: { permissionKeys: { $each: missing } }` through a new `RoleRepository.addPermissionKeys(roleId, keys)`,
then `invalidateUsersOfRole` (`rbac.service.ts:1087`). **And the same for ADR-032 delegated grants**
(review finding F-23): a new `DelegatedGrantRepository.addPermissionKeysWhereHeld(heldKey, keys)`
(`platform/rbac/delegation.repository.ts`) — for every live grant whose `permissionKeys` contains
`heldKey` and lacks one of `keys`: `$addToSet: { permissionKeys: { $each: keys } }`, `$inc: { __v: 1 }`,
`updatedAt` — returning the affected `userId`s, each then `invalidateUser` (`rbac.service.ts:1082`).
The deputy's granter holds `manage` in that unit (that is what let him delegate it), so the widened
keys stay within what he could have delegated himself. Returns roles + grants changed; the log
line reports both.

Route guard (web): `RequirePermission` (`apps/web/src/platform/router/RequirePermission.tsx:7-16`) gains
`anyOf?: string[]` (exactly one of `permission`/`anyOf`; `anyOf` → `anyOf.some(can)`), the
`Can` precedent (`apps/web/src/platform/rbac/Can.tsx:22-41`). `/atm/data-edit` uses
`anyOf={['atmRefLabel.create','atmRefLabel.edit','atmMachine.moveArea','atmMachine.manage']}`.

### 7.4 Seed, page registry, permission matrix

- Super-admin receives every new key automatically: `seedAtm` unions all `atmPermissions` (`atm.seed.ts:9-18`).
- No role is seeded (port-doc precedent; EG-11). Bundles are in §12.3.
- `npm run check:page-registry` must print `page registry OK` (two new pages, each pointed at).
- Permission matrix: **no change** — `scripts/gen-permission-matrix.mjs:10-19` renders platform
  permissions only; `npm run check:permission-matrix` stays green.
- Port doc `docs/12-planning/atm-operations-port.md`: privilege map row (`:45`) gains the new keys;
  delivery table (`:227-237`) gains a row pointing here. New `docs/03-decisions/ADR-034-audited-reveal-of-a-sealed-value.md`
  (the reveal pattern — DEC-18; the automation credentials' "an ADR, not a route" rule,
  `credential.routes.ts:24-28`, is why) and its line in `docs/03-decisions/README.md`.

---

## 8. Web (`apps/web/src/modules/atm/` unless stated)

### 8.1 Routes, nav, shortcuts (WP-A)

`routes.tsx` (header comment `:1-15` updated; pattern `:84-107`):

| Path | Guard | Page (file owner) |
|---|---|---|
| `register` | `<RequirePermission permission="atmRegister.view">` | `pages/RegisterPage.tsx` (stub WP-A → WP-C) |
| `register/report` | `atmRegisterReport.view` | `pages/RegisterReportPage.tsx` (stub WP-A → WP-D) |
| `register/import` | `atmRegister.import` | `pages/RegisterImportPage.tsx` (stub WP-A → WP-B) |
| `data-edit` | `anyOf={['atmRefLabel.create','atmRefLabel.edit','atmMachine.moveArea','atmMachine.manage']}` (§7.3) | unchanged file (WP-E edits its content) |

`pages/AtmOverviewPage.tsx` `ATM_SHORTCUTS` (`:30-103`): the data-edit card's `permission` becomes
`'atmRefLabel.create'` (`:95-102`, same key as its nav row); append
`{ to: '/atm/register', titleKey: 'atm.nav.register', descKey: 'atm.cards.register', icon: ShieldIcon, permission: 'atmRegister.view' }`
and `{ to: '/atm/register/report', titleKey: 'atm.nav.registerReport', descKey: 'atm.cards.registerReport', icon: ChartIcon, permission: 'atmRegisterReport.view' }`
(`ShieldIcon`, `ChartIcon` exist in `shared/ui/icons.tsx`). The ATM Home nav row stays on
`atmReplenishment.view` (`apps/api/src/seed-navigation.ts:990-995`): an Efficiency-only user reaches
the register through its own nav row (documented, not changed).

### 8.2 API client, hooks, invalidation (WP-A)

**Amended 2026-10-28:** the bank catalog's calls and hooks, the label options hook, and the wider
refreshes after machine and label writes — §8.7.

`api/register-api.ts` (NEW, ADR-013 shape of `api/atm-api.ts:1-40`):

| Function | Call |
|---|---|
| `listRegisterEntries(params)` | `getPage<AtmRegisterEntryDto>('/atm/register/entries' + buildQuery(params))` |
| `getRegisterEntry(id)` | `get('/atm/register/entries/:id')` |
| `receiveRegisterEntry(body)` | `post<AtmRegisterWriteResultDto>('/atm/register/entries', body)` |
| `updateRegisterEntry(id, body)` | `patch(…/:id)` |
| `receivePendingRegisterEntry(id, body)` | `post(…/:id/receive)` |
| `handoverRegisterEntry(id, body)` | `post(…/:id/handover)` |
| `deleteRegisterEntry(id, version)` | `del(…/:id, { version })` (`shared/lib/api-client.ts:267`) |
| `revealRegisterCombination(id)` | `post<AtmRegisterRevealDto>(…/:id/reveal, {})` |
| `linkRegisterEntry(id, version)` | `post<AtmRegisterWriteResultDto>(…/:id/link, { version })` (DEC-30) |
| `exportRegisterEntries(params)` | `downloadBlob('/atm/register/entries/export' + buildQuery(params), 'atm-register.csv')` (`api-client.ts:355`) |
| `getRegisterMeta()` / `getRegisterBranchOptions(branchId)` / `getRegisterReport()` | `get(...)` |
| `importRegisterWorkbook(file, { apply, fileSha256, reportOverride })` | `FormData` + `upload<AtmRegisterImportResultDto>('/atm/register/import', form)` (precedent `modules/hr/employee-management/employees/api/employee-api.ts:52-62`, `api-client.ts:401`) |
| `listRegisterImportRuns()` | `get('/atm/register/import/runs')` |

`api/register-queries.ts` (NEW): keys from `shared/lib/query-keys.ts` —
`registerEntries = featureKey('atm','registerEntries')`, `registerReport = featureKey('atm','registerReport')`,
`registerMeta = featureKey('atm','registerMeta')`, `registerBranchOptions = featureKey('atm','registerBranchOptions')`,
`registerImportRuns = featureKey('atm','registerImportRuns')`. Hooks: `useRegisterEntries(params, enabled)`,
`useRegisterMeta(enabled)`, `useRegisterBranchOptions(branchId | null)`, `useRegisterReport()`,
`useRegisterImportRuns(enabled)`; mutations `useReceiveRegisterEntry`, `useUpdateRegisterEntry`,
`useReceivePendingRegisterEntry`, `useHandoverRegisterEntry`, `useLinkRegisterEntry`,
`useDeleteRegisterEntry` — each invalidates `registerEntries`, `registerReport`,
`registerBranchOptions` and `featureKey('atm','machines')`, and EVERY register mutation (these six,
the reveal and the import) declares `onError` so the global toast stays silent: each dialog already
reports the refusal in the reader's language, and the global one added the server's English sentence
(review findings WEB-1, LIVE-1; `FormError` scrolls itself into view, as it is then the only report);
`useRevealRegisterCombination` (mutation with `gcTime: 0`, so TanStack's MutationCache does not keep
the value for its default 5 minutes; the dialog calls the mutation's `reset()` when it clears or
closes; the value is never put in the query cache); `useImportRegisterWorkbook` (on
`mode==='applied'` invalidates the same four + `registerImportRuns`).
**Caching of K values (DEC-18):** `useRegisterEntries` and the entry detail query take
`secretsHolder = can('atmRegister.viewSecrets')` and, when true, use `staleTime: 0, gcTime: 0` (the
medical precedent `apps/web/src/modules/hr/medical/api/medical-queries.ts:33-49`) — their payloads
carry key codes and notes; the server side is `Cache-Control: private, no-store` (§5.4).

`api/atm-api.ts` (MOD, `:43-58` block): `updateMachineArea(id, body: UpdateAtmMachineArea) → patch('/atm/machines/:id/area')`.
`api/atm-queries.ts` (MOD, `:36-82` block): `useUpdateAtmMachineArea()` invalidating
`atmKeys.machines` and `featureKey('atm','registerEntries')`.

`apps/web/src/platform/realtime/invalidation-registry.ts` (ATM block `:46-58`):
`'atm.registerEntry': [['atm','registerEntries'], ['atm','registerReport'], ['atm','registerBranchOptions']]`
and `'atm.machine'` (`:48`) gains `['atm','registerEntries']` (masterState). `'atm.registerImport'`
is server-excluded and gets no entry (`realtime.spec.ts:180-214` checks both directions).

`lib/register-labels.ts` (NEW, WP-A — shared by C and D): `bankName(code, locale)`,
`branchLabel(code, locale)` (contracts names), `statusLabelKey(status)`, `formatRegisterDate(iso)`,
`formatAsOf(generatedAt, locale)` → `dd / MMMM / yyyy` in `Africa/Cairo` (the Excel's U2 format,
D7) with Latin digits in both languages (`ar-EG-u-nu-latn`: the sheet's U2 format names no numeral
system, and every count on the report is Latin — review finding WEB-5), `columnHeaderKey(field)` →
`atm.register.col.<field>`.

### 8.3 Register page `/atm/register` (WP-C)

**Amended 2026-10-28:** banks from the catalog, the «البنوك» dialog, «+ منطقة», and «بيانات ناقصة»
(badge, filter, checkbox) — §8.7.

Layout: `<PageContainer fullHeight>` + the board frame (`apps/web/src/modules/fleet/components/board-scroll.ts:16-20`,
`platform/layout/PageContainer.tsx:20-41`), RTL by the app (logical properties only).

**Header** (`PageHeader`): title only — `PageHeader` has no subtitle by the owner's rule, enforced by `apps/web/src/platform/layout/page-header-has-no-subtitle.spec.ts:55-98`; actions — `Receive` (`Can atmRegister.create`), `Export`
(`Can atmRegister.export`, current filters), `Import` link (`Can atmRegister.import` →
`/atm/register/import`), `Data Report` link (`Can atmRegisterReport.view`). When
`meta.branches` has no mapped branch: an info banner `atm.register.noMapping`.

**Filters** (`FilterBar`, server-side, URL-synced, remembered): `REMEMBERED_FILTERS = ['branch','bank','status','area','q','issues','sort','size'] as const;`
`useRememberedFilters([sp, setSp], REMEMBERED_FILTERS)` (`shared/lib/useRememberedFilters.ts:159`,
precedent `pages/DataEditPage.tsx:35-41, 63`). The page reads ONLY these params plus `page`
(the census rule, `shared/lib/remembered-filters-coverage.spec.ts:354-366`). Mapping to the API:
`branch`→`branchId` (select of `meta.branches` with `canView`), `bank`→`banks` (multi, 6 codes),
`status`→`statuses` (multi), `area`→`area` (combobox from `useRegisterBranchOptions(branch)`;
disabled without a branch), `q`→`search` (debounced), `issues=1`→`withIssues=true`,
`sort`=`field:dir`, `size` (25/50/100). Default sort: none sent → server Excel order (DEC-21).

**Grid** — `components/register/RegisterGrid.tsx` (NEW). `DataTable` has no frozen columns and no
grouped header (`shared/ui/DataTable.tsx:13-36, 312-333`); the grouped sticky header is hand-built in
`modules/fleet/pages/LicensingPage.tsx:576-625` — RegisterGrid generalizes that:

- One scrolling wrapper (`overflow-auto`, fills the board) around `<table class="border-separate border-spacing-0">`
  (collapse breaks sticky borders).
- `<thead class="sticky top-0 z-20">`, OPAQUE (`bg-slate-100 dark:bg-[#0c121e]`, the LicensingPage
  colours): row 1 = group headers (`colSpan` per contiguous group of `ATM_REGISTER_DISPLAY_ORDER`:
  Identity A..I | Keys J..Q | Cassettes R..AJ | Hours & notes AK..AN | Secret AO | Location AP, AV |
  Lifecycle AQ..AU | HUB AW), row 2 = column headers (`atm.register.col.<field>`, `title` = the exact
  Excel header with `\n` → space, DEC-22); sortable headers for `branchId, area, bankCode, machineCode, name, startDate, endDate`.
- Frozen: Branch, Area, Bank, ATM ID, Name — `position:sticky; inset-inline-start:<offset>px`
  (offsets = cumulative widths; computed in `lib/register-grid.ts`), header cells `z-30`, body
  frozen cells `z-10`, every frozen cell has the row's opaque background; the last frozen cell carries
  an inline-end border. Actions column sticky at `inset-inline-end:0`. Freezing applies at `lg` and
  up; below `lg` only the header is sticky.
- Width per column: `max(72, round(excelWidth × 7 + 5))` px (Name → 303 px); Branch (A) at least
  96 px — its nine-character `EGYCASH-n` codes measure up to 70.3 px at the grid's 12 px, more than
  the 70 px the sheet's 87 px leave inside the cell padding, so `EGYCASH-4` was clipped (review LIVE-3).
- Cells: `text-xs`, one line, `truncate` with `title` (full text); `dir="ltr"` for ATM ID, serial,
  model, times, dates, URL, combination; `locationUrl` rendered as an `<a target="_blank" rel="noopener noreferrer">`
  only when it starts with `http://` or `https://`.
- K-class cells when `!row.secretsVisible`: a muted lock glyph (`LockIcon`) + `sr-only`/`title`
  `atm.register.secretHidden`. AO cell: badge `combinationSet`/`combinationUnset`; never a value.
- **Ended rows** (`status==='ended'`): the Excel shows dark green #375623 / white (conditional
  formatting `$AR>0`); token `REGISTER_ENDED_ROW = 'bg-emerald-900 text-white dark:bg-emerald-950 dark:text-emerald-50'`
  (Tailwind palette, `apps/web/tailwind.config.ts:1-12`), applied to every cell incl. frozen/sticky;
  the End-date cell is the non-colour cue. Pending rows: status pill in the Lifecycle group's
  Start-date cell (`atm.register.status.pending`).
- Drift badge next to the ATM ID when `status==='open'` and `masterState !== 'active'`
  (`atm.register.master.<state>`, `unlinked` included — DEC-30).
- Name cell: `—` when `name === null` (imported blank, DEC-32).
- Import notes: an `AlertIcon` in the Name cell when `importIssues.length > 0`, tooltip lists
  `atm.register.issue.<code>` (+ `column`).
- Loading/error/empty states (`shared/ui/states/*`); `Pagination` below (`shared/ui/Pagination.tsx`).

**Row actions** (`RegisterRowActions.tsx`): Edit (`atmRegister.edit`); Record receipt (`status==='pending'`
∧ `branchId` ∧ `atmRegister.create`); Hand over (`status==='open'` ∧ `atmRegister.handover`); Reveal
(`safeCombinationSet` ∧ `secretsVisible`); Link to the Operations list (`status==='open'` ∧
`masterState==='unlinked'` ∧ `atmRegister.edit` → `LinkEntryDialog`, DEC-30); Delete (`atmRegister.delete`).
Visibility by `can(key)` is a convenience; the server's `keyCoversEntry` (DEC-29) is the rule.

**Dialogs** (`components/register/*`, all version-aware, errors mapped by code to
`atm.register.error.<CODE>`, others → generic):

| Dialog | Fields / behaviour |
|---|---|
| `ReceiveEntryDialog` | Sections in display-group order. Identity: Branch (select of `meta.branches` with `canCreate`; default = the top-bar active branch when it is one of them), Area (combobox: `areaLabels` ∪ `areas`; required when Start date set), Bank (6), Ops bank label (select "automatic (label)" + `bankLabels` of the branch), ATM ID (`dir=ltr`, live `idFormat` hint via `atmRegisterIdFormatOk`), Name*, Operation type / ATM type / Model / Serial (comboboxes from branch options). Keys (8 fields; rendered only when `can('atmRegister.viewSecrets')`). Cassettes (19 fields, grid of 5). Hours & notes (open time, end time, time-limit notes; receipt notes only with viewSecrets). Secret (combination, `type=password` with show toggle; only with viewSecrets). Location (plus code, URL). Lifecycle (Start date — empty = pending, hint; Received by). HUB. Submit → toast `atm.register.received` + `masterAction.<action>` + each warning. |
| `EditEntryDialog` | Same sections pre-filled (a value stored on several lines — 1,531 imported cells — is edited in a text area: a single-line input strips the breaks when touched, review finding DATA-1; the handover dialog's delivered name likewise); Branch read-only; ATM ID editable only when pending or open-and-unlinked; Start date editable when open/ended; End date, Delivered name, Notes delivered editable only when ended (shown read-only when an open imported entry carries them); combination field empty = keep, plus a "clear" checkbox; on an unlinked open entry the Area field carries hint `atm.register.form.linkOnAreaHint` (setting it couples the entry, DEC-30). |
| `ReceivePendingDialog` | Start date* (default Cairo today), and Area / Bank / ATM ID / Ops label / Received by when missing on the entry. |
| `HandoverDialog` | End date* (default Cairo today), Delivered name and Notes delivered PRE-FILLED from the entry (Notes only when `secretsVisible`; otherwise the field is not rendered and not sent, so the stored value is kept — review finding F-18); hint `atm.register.form.handoverHint`. Only fields the user changed are sent. |
| `LinkEntryDialog` | `ConfirmActionDialog`; body `atm.register.form.linkBody`; on success toast `atm.register.masterAction.<action>`; error codes mapped as above. |
| `DeleteEntryDialog` | `ConfirmActionDialog` (`components/ReplenishmentDialogs.tsx`), body `atm.register.form.deleteBody`. |
| `RevealCombinationDialog` | Explains the reveal is logged; "Reveal" → mutation; the value shows large, monospace, `dir=ltr`, with a Copy button and a 30 s countdown, then is cleared from state AND the mutation is `reset()`; closing does the same; never logged to console or stored (§8.2: `gcTime: 0`). |

### 8.4 Data-edit changes (WP-E) — `pages/DataEditPage.tsx`, `components/DataEditDialogs.tsx`

**Amended 2026-10-28:** four tabs, catalog-backed dialogs and the add's register outcome — §8.7.

| Element (today) | After |
|---|---|
| Machines-tab actions column, rendered for `can('atmMachine.manage')` (`DataEditPage.tsx:151-183`) | Rendered for `manage` OR `moveArea`. Edit button: manage → existing `MachineDialog` (full edit + archive, unchanged); moveArea-only → new `MachineAreaDialog`. |
| Row DELETE (trash) button + confirm (`:168-178`, `:358-377`) | Rendered only for `can('atmMachine.manage')`. |
| Labels-tab Edit button, `can('atmMachine.manage')` (`:189-208`) | `can('atmRefLabel.edit') \|\| can('atmMachine.manage')`. `RefLabelDialog` unchanged (rename + archive toggle — D2). |
| Header actions inside `<Can permission="atmMachine.manage">` (`:226-241`) | Machines tab: "Bulk add / delete" + "Add machine" stay inside `<Can permission="atmMachine.manage">`. Bank/Area tabs: "Add bank/area" inside `<Can anyOf={['atmRefLabel.create','atmMachine.manage']}>`. |
| Bulk dialog incl. delete-by-codes (`DataEditDialogs.tsx:266-423`) | Unchanged (manage-only by the header gate). |
| Archive checkbox in `MachineDialog` (`:159-170`) | Unchanged (dialog is manage-only). |
| — | NEW `MachineAreaDialog` in `DataEditDialogs.tsx`: code and name read-only, Area select of active area labels (same source as `:113-118`), hint `atm.dataEdit.moveAreaHint`; submit `useUpdateAtmMachineArea` `{ area, version }`; toast `atm.dataEdit.areaMoved`. |
| Header comments `DataEditPage.tsx:1-15`, `DataEditDialogs.tsx:1-8, 266-270` | Restate who can do what after D2. |

The page keeps reading only `tab, active, q, sort, size, page` (its census entry stays
`['tab']`, `remembered-filters-coverage.spec.ts:47`).

### 8.5 Data Report page `/atm/register/report` (WP-D)

**Amended 2026-10-28 (DEC-40):** the bars, series, colours and legend come from the DTO's catalog
banks rather than `ATM_BANK_REPORT_COLORS` / `ATM_BANK_NAMES` — §8.7.

`pages/RegisterReportPage.tsx` is a THIN shell (no `DataTable`, no `rows=`, no `.items.map(`, no
`<Select`/`FilterBar`/`SearchInput`, no `sp.get(` — so it stays `NOT_FILTER_CAPABLE` without a note,
`remembered-filters-coverage.spec.ts:289-291`); the work is in `components/register-report/*`.

- Header: title `atm.registerReport.title`; the as-of stamp `atm.registerReport.asOf` with
  `formatAsOf(generatedAt)` (D7: computation time = data time); notices when
  `counts.activeWithUnmappedBranch > 0` / `activeWithoutBank > 0`.
- **Section 1** «اعداد ماكينات العملاء بالشركة»: bar chart, categories `ATM_REPORT_SECTION1_BANKS`
  then the TOTAL bar «إجمالي عدد الماكينات» (sheet: «اجمالى عدد الماكينات», DEC-28 — provisional, EG-21) as the 7th category (Excel chart 1); single series in
  the Excel's colour `ATM_REPORT_TOTALS_COLOR` `#4472C4` in both themes (DEC-19); no value axis (the Excel deleted it); value label
  at each bar end. Below: the 2-row table (labels row, values row) = AD2:AJ3.
- **Section 2** «اعداد الماكينات بأفرع الشركة»: categories `ATM_REPORT_SECTION2_BRANCHES ∩ branchesShown`
  with labels `atm.registerReport.branch2.<code>`, then the total bar; single series in
  `ATM_REPORT_TOTALS_COLOR` (DEC-19); table = AD4:AK5.
- **Section 3** «ماكينات العملاء بأفرع الشركة»: grouped bars, categories
  `ATM_REPORT_SECTION3_BRANCHES ∩ branchesShown` (labels `atm.registerReport.branch3.<code>`),
  6 series in `ATM_REPORT_SECTION3_BANKS` order coloured `ATM_BANK_REPORT_COLORS` (both themes,
  D7); legend with swatch + bank name (`ATM_BANK_NAMES`); light value gridlines; value labels on
  every bar incl. 0. Below: the 7×6 table with **0 shown, never blank**, no totals (the Excel has none).
- Chart construction: plain SVG + Tailwind, no chart library (precedent
  `modules/fleet/components/CustodyDashboardCharts.tsx:11-13`). Bars ≤ 24 px thick, 4 px rounded
  data end, square at the baseline, 2 px surface gap between adjacent bars; the total bar separated
  from the categories by a gap and a 1 px divider, label in bold. Each chart and each table is
  wrapped in `dir="ltr"` so the order on screen is the Excel's: first category at the LEFT, total
  bar at the RIGHT, tables read from AD at the left (DEC-19); every text node keeps `dir="auto"`
  so Arabic labels shape correctly. Labels/legend text use text tokens
  (never the series colour). Hover/focus tooltip per bar: "<category> · <series>: n". Each `<svg>`
  has `role="img"` and an `aria-label` summarising the section; the tables are the accessible view.
- Dataviz validation of the mandated palette (run for this spec with the dataviz validator): FAIL
  — lightness band, chroma floor, NBE↔BM protan ΔE 4.4, HDB↔BRK normal-vision ΔE 14.6; contrast
  < 3:1 for CIB/HDB/BRK on the light surface and NBE/BM/NXT on the dark surface. The colours are an
  owner decision (D7), so the required relief is mandatory, not optional: value labels on every bar,
  a legend, and the table under every chart (DEC-19). Charts 1–2's `#4472C4` clears 3:1 on both
  surfaces (4.7:1 on white, 3.8–4.0:1 on the dark slate surfaces).
- `lib/register-report-view.ts` (pure): turns `AtmRegisterReportDto` into the three sections'
  categories/series/table rows (unit-tested without rendering).
- Refresh: `useRegisterReport()` + realtime invalidation (§8.2); no polling, no as-of picker (D7).

### 8.6 Import page `/atm/register/import` (WP-B)

`pages/RegisterImportPage.tsx` is a THIN shell (same census rule as §8.5) whose `PageHeader` carries
the title only (no subtitle — `page-header-has-no-subtitle.spec.ts`); work in
`components/register-import/*`:

1. **`RegisterSettingsCard`** (DEC-20, precedent `modules/it/components/TechnicianDepartmentsCard.tsx:1-13, 39-56`):
   table 1 "Branch codes" — 7 rows: code, sheet name (`ATM_REGISTER_BRANCH_NAMES`), ECMS branch
   `Select` from `useBranchOptions()` (`modules/organization/shared/references.ts:36-43`, open to any
   signed-in user); table 2 "Operations bank labels" — 6 rows: bank, Arabic name, text input
   (default `ATM_DEFAULT_OPS_BANK_LABELS`). Save → `useSetSetting` (`platform/settings/settings-api.ts:39-48`)
   with `{ key, scope:'organization', value }`, then invalidate `registerMeta`. Rendered editable
   only with `can('setting.edit')`; read-only otherwise (values from `useRegisterMeta`).
   **Amended 2026-10-28 (DEC-35):** table 2 is a read-only list of the catalog with «إدارة البنوك»,
   and Save writes the branch codes only (§8.7).
2. **Upload** (`ImportUploadPanel`, a card — its first line is the body text
   `atm.registerImport.intro`, NOT a PageHeader child): `FileUpload` (`shared/ui/FileUpload.tsx`,
   `accept=".xlsx"`, `maxSizeMb=20`) → Preview (`apply: []`). Preview is offered only while no run is
   in flight — the preview and the apply share one mutation, and a preview pressed mid-apply took
   the apply's summary and toast (review WEB-3). A refusal names the FILE's problem when the server
   gave one (`MISSING_SHEET`, `UNREADABLE`, `TOO_LARGE` → `atm.registerImport.error.*`, LIVE-2).
   Table cells never carry `dir="auto"` themselves: the text inside does, so a Latin value keeps
   the RTL column's alignment (LIVE-4). The runs card shows `ErrorState` with a retry when its
   request fails — never the "no import has run yet" text (WEB-6).
3. **Preview panel**: counts by status; blockers (`atm.registerImport.blocker.<code>`); the Data
   Report check table (57 rows: section, label, Excel cell, expected, from-file, ✓/✗; `allMatch`
   banner); issues summary by code + expandable rows (`importRow`, codes, column); branches table
   (code, branch, active, in reach, rows, open rows); one card per category
   (`atm.registerImport.category.<key>.title/.body`, count, item list with client-side paging,
   `reason` labels; `activeElsewhere` also renders its `pairs` table — from branch, to branch,
   count; `changedSinceImport` renders the differing column letters; `openInRegister` the other
   branch when named); an Approve checkbox on each approvable category; when `!allMatch`, a danger
   checkbox `atm.registerImport.reportOverride`. Report categories that back a blocker
   (`openInRegister`, `changedSinceImport`) and the `dateUnreadable` rows are shown first, under
   the blocker list, with the remedy text `atm.registerImport.blockerHint.<code>`.
4. **Apply**: enabled when ≥ 1 approved category and no blocker other than an overridden
   `reportMismatch`; `ConfirmActionDialog` listing the categories; posts the SAME `File` with
   `apply`, `fileSha256` from the preview, `reportOverride`; shows the applied summary and the
   recomputed plan.
5. **Runs** card: `useRegisterImportRuns()` table (started, finished, state, actor, categories,
   counts — each count labelled `atm.registerImport.outcome.<key>`).

### 8.7 Revision 4 (2026-10-28) — banks from the catalog, bilingual areas, the intake on screen

This section amends §8.2–§8.6 for DEC-35–DEC-41. Where it disagrees with them, it wins.

**Foundation.**
- **`api/atm-api.ts`:** `listBanks`, `createBank`, `updateBank` (`PATCH /atm/banks/:code`) and
  `refLabelOptions(branchId)`. `createMachine` returns `AtmMachineCreateResultDto`.
- **`api/atm-queries.ts`, new hooks:**
  - `useAtmBanks`: key `['atm','banks','list']`, stale after 5 minutes.
  - `useAtmBankLookup`.
  - `useCreateAtmBank` / `useUpdateAtmBank`: they opt out of the global error toast, and refresh
    `banks`, `registerMeta`, `registerReport`, `refLabelOptions` and `mapPoints`.
  - `useAtmRefLabelOptions(branchId, enabled)`.
- **`api/atm-queries.ts`, refreshes:**
  - Every machine write (create, bulk create, update, reassign, area move) also refreshes
    `refLabels`, `refLabelOptions`, `registerEntries` and `registerReport` (critic gap 4).
  - A label write also refreshes `refLabelOptions` and `registerBranchOptions`.
- **Realtime** (`platform/realtime/invalidation-registry.ts`): `'atm.bank'` refreshes the same five
  families as the bank write hooks. `'atm.refLabel'` also refreshes `refLabelOptions` and
  `registerBranchOptions`.
- **NEW `lib/bank-catalog.ts`** (pure). `makeBankLookup(banks?)` gives:
  - `ordered`, `active` and `codes`;
  - `name(code, locale)`: the catalog's, else the seed's, else the code;
  - `color(code)`: the catalog's, else the seed's, else `NO_ZONE_GREY`;
  - `isPale(code)`: `needsCasing(color)`.

  Before the catalog answers, the lookup holds the six seeds. The file also has `labelText`,
  `areaOptionText`, `bankOptionGroups`, `banksOnShow` and `inCatalogOrder`. No screen keeps its own
  list of six any more.
- **NEW `components/catalog/BankDialog.tsx`** adds or edits one bank:
  - fields: Arabic name, English name, code (upper-cased; read-only on edit), Operations label and
    colour. A new bank is offered the first unused extra colour.
  - It warns when the Operations label changes, and when an archive targets a bank enabled in
    `atm.settlements.banks`.
  - Each of the three `ATM_BANK_*` refusals has its own text.
- **NEW `components/catalog/BankCatalogDialog.tsx`:** the whole catalog as one table
  (`bankCatalogColumns`, shared with data-edit's «البنوك» tab).

**Data-edit (amends §8.4).** `ATM_DATA_TABS = ['machines', 'bank', 'bankLabel', 'area']`, each tab
one table in the board frame.
- **«البنوك»:** the whole catalog in catalog order: code, names, Operations label, colour and status.
  Add is gated by `Can atmBank.create`, edit by `Can atmBank.edit`.
- **«أسماء البنوك في التشغيل»:** the spellings, each with its bank's name or a «غير مربوط ببنك»
  badge. The table is scope-wide, like the machines tab.
  - An amber callout above it lists `unmappedBankNames`, each with «ربط ببنك».
  - The button edits the unlinked spelling of that name when one is listed; otherwise it opens
    "add" with the name filled in.
- **«المناطق»:** stored name, Arabic, English, an origin badge and status. The badge reads
  «من البيانات الحالية» for `backfill` and «أُضيفت تلقائيًا» for `register` / `machine` / `import`.
  - The add dialog needs Arabic AND English and shows «يُحفظ على الماكينات باسم: …».
  - The edit dialog shows the stored name and both translations, with «الماكينات الحالية تحتفظ
    بالاسم القديم».
- **The machine, bulk and area-move dialogs** read `useAtmRefLabelOptions` instead of the two
  100-row lists: the acting branch on add, `machine.branchId` on edit and move.
  - Banks are grouped per catalog bank (`<optgroup>`).
  - Areas show `labelText`, with the stored name in brackets when it differs.
  - The machine's current bank and area are always offered (critic gap 3).
  - When `registerMapped` is false, the add dialogs show an amber notice.
- **The add buttons stay `<Can permission="atmMachine.manage">`.** The outcome is said in words:
  «تمت إضافة الماكينة.» or «أُعيدت الماكينة المؤرشفة للعمل.», then one of «سُجلت في السجل — بيانات
  ناقصة.», «رُبطت بسجلها.», «للتشغيل فقط: الفرع غير مربوط بكود EGYCASH.», «للتشغيل فقط: الكود المؤقت
  لا يُسجَّل في السجل.» or «اسم البنك غير مربوط ببنك — لم تُسجَّل في السجل.» (a warning).
  - The two 409 codes and `INACTIVE` each have their own text.
  - The bulk result lists the reactivated, refused and unrecorded codes.

**Register (amends §8.3).**
- **Header:** «البنوك» (`Can anyOf atmBank.create, atmBank.edit`) opens `BankCatalogDialog`. This is
  where Efficiency curate banks, since they have no data-edit nav row.
- **Filters:**
  - The banks are every catalog bank, archived ones marked «(مؤرشف)», plus any URL code the catalog
    lacks. URL bank codes are read by pattern.
  - «بيانات ناقصة فقط»: URL `incomplete=1`, in `REMEMBERED_FILTERS`, sent as `incomplete=true` to
    the list and the export.
  - The area filter shows `labelText` and still matches the stored name.
- **Grid:**
  - An amber «بيانات ناقصة» badge (`data-register-incomplete`) sits beside the import-issues mark.
    Its tooltip (`missingForCompletion`) lists what is still empty among area, bank, ID, name,
    operation type, vendor, model, serial, open time, close time, received-by and HUB, and the
    groups keys, cassettes, combination and location. Keys and the combination count only when
    `secretsVisible`.
  - A `source: 'operations'` row says «أضافها التشغيل من صفحة «إضافة البيانات».».
  - The Bank cell's tooltip names the bank through the lookup.
- **Receive and edit form** (`EntryFormSections`):
  - **Bank:** the active `meta.banks` plus the entry's own (an archived one shown «… (مؤرشف)»).
    Beside it, «+» (`Can atmBank.create`) opens `BankDialog`.
  - **Operations name:** the `bankVariants` of the chosen bank, plus the stored value.
  - **Area suggestions:** `areaOptions` shown by `labelText` (the value stays the stored name), plus
    `areas`. Beside them, «+ منطقة» (`Can anyOf atmRefLabel.create, atmMachine.manage,
    atmRegister.create, atmRegister.edit`; disabled with no branch) opens the area dialog for that
    branch. A typed area no list holds shows «منطقة جديدة — ستُضاف إلى قائمة الفرع.».
  - **ID format:** the hint uses the widened check.
  - **Edit only:** the «بيانات ناقصة» checkbox, sent only when changed. On `source: 'operations'`
    rows, a note says where the row came from.
  - The form stays open while a nested bank or area dialog is open.
  - The bank and Operations-name refusals (`UNKNOWN`, `INACTIVE`, `UNMAPPED`, `OTHER_BANK`) have
    their own sentences.
- **`ReceivePendingDialog`:** the same banks, Operations names and area suggestions.
- **Delete** of a `source: 'operations'` row uses `deleteBodyOperations`, which says the machine is
  archived if this is its only open period.

**Data Report (amends §8.5).**
- Bars and series come from `dto.section1Banks`, `section3Banks` and `banks`, through
  `buildAtmReportCells`.
- Names and colours come from the DTO's `banks` (`atmBankName` / `atmBankColor`), else the seed's,
  else the code and `NO_ZONE_GREY`.
- Without the new fields (an older server), the page draws the sheet's six.

**Import page (amends §8.6 item 1).**
- `RegisterSettingsCard`'s table 2 is now a read-only catalog list (code, name, Operations name,
  status) with «إدارة البنوك», behind the `atmBank` keys, which opens the catalog dialog in place.
  Save writes the branch codes only.
- `ImportCategoryCard` and `ReportCheckTable` name banks through the lookup.

**Map and settlements** (all through the lookup).
- `map-colors.ts` lost `bankColor` and `paleBank`.
- The legend and the bank filter show the active banks plus any code the points carry
  (`banksOnShow`); the filter accepts any code of the right shape, or `none`.
- The settlement pages name banks through the catalog: `ControlPage`, `CassetteLayoutsPage`,
  `PreparationPage`, `LayoutImportPage`, `SettlementPlanPage` and `ControlDataTab`.

**i18n.** The new keys (`atm.dataEdit.*`, `atm.bankCatalog.*`, the register's incomplete, form and
refusal keys, `atm.registerSettings.manageBanks`) are in both locales, in formal Arabic, and in the
`atm-i18n` / `atm-register-i18n` censuses.

---

## 9. i18n keys (WP-A adds ALL of them to `apps/web/src/platform/localization/i18n.ts`)

Placement: en after `'atm.reports.empty'` (`i18n.ts:8033`), ar after `:15957`; the two audit labels
beside `'systemAdmin.users.audit.reject'` (`:6327` en, `:14283` ar). Placeholders use `{{name}}`
(`platform/localization/placeholders.spec.ts`). Arabic is formal (`formal-arabic.spec.ts` runs
`scripts/check-formal-arabic.mjs` over every product string). `{CODE}` rows expand to one key per value.
**Ownership:** `i18n.ts` and `atm-register-i18n.spec.ts` are WP-A files. This section lists every
visible string of §8.3–§8.6 (audited for revision 2, review finding F-25); if a B–E engineer still
finds one missing, they do not edit `i18n.ts` — they ask WP-A, which adds the key in a follow-up
commit on the feature branch (WP-A stays the single owner).

### 9.1 Navigation, cards, audit, data-edit

| Key | en | ar |
|---|---|---|
| `atm.nav.register` | ATM Register | سجل الماكينات |
| `atm.nav.registerReport` | Data Report | تقرير البيانات |
| `atm.cards.register` | Receipt from and handover to the banks, period by period. | استلام الماكينات من البنوك وتسليمها، فترةً بفترة. |
| `atm.cards.registerReport` | Machines in operation per bank and per branch. | الماكينات قيد التشغيل لكل بنك ولكل فرع. |
| `systemAdmin.users.audit.secretRevealed` | Revealed a protected value | كشف قيمة محمية |
| `systemAdmin.users.audit.atmRegisterImport` | Imported the ATM register workbook | استيراد ملف سجل الماكينات |
| `atm.dataEdit.moveArea` | Move to another area | نقل ماكينة لمنطقة |
| `atm.dataEdit.moveAreaTitle` | Move machine {{code}} to another area | نقل الماكينة {{code}} لمنطقة أخرى |
| `atm.dataEdit.moveAreaHint` | The machine's open register period moves to the new area too. | تنتقل فترة التشغيل المفتوحة للماكينة في السجل إلى المنطقة الجديدة أيضًا. |
| `atm.dataEdit.areaMoved` | Area changed. | تم تغيير المنطقة. |

### 9.2 Register page, columns, vocabularies

| Key | en | ar |
|---|---|---|
| `atm.register.title` | ATM Register | سجل الماكينات |
| `atm.register.receive` | Receive machine | استلام ماكينة |
| `atm.register.export` | Export (CSV) | تصدير (CSV) |
| `atm.register.import` | Import workbook | استيراد الملف |
| `atm.register.openReport` | Data Report | تقرير البيانات |
| `atm.register.noMapping` | Branch codes are not configured yet. An administrator sets them on the import page. | لم تُضبط أكواد الفروع بعد. يضبطها مدير النظام من صفحة الاستيراد. |
| `atm.register.empty` | No entries match. | لا توجد سجلات مطابقة. |
| `atm.register.filter.branch` / `.allBranches` | Branch / All branches | الفرع / كل الفروع |
| `atm.register.filter.bank` / `.allBanks` | Bank / All banks | البنك / كل البنوك |
| `atm.register.filter.status` / `.allStatuses` | Status / All statuses | الحالة / كل الحالات |
| `atm.register.filter.area` / `.allAreas` | Area / All areas | المنطقة / كل المناطق |
| `atm.register.filter.search` | Search by ATM ID, name or serial | ابحث برقم الماكينة أو الاسم أو الرقم التسلسلي |
| `atm.register.filter.withIssues` | Only rows with import notes | الصفوف ذات ملاحظات الاستيراد فقط |
| `atm.register.status.pending` | No start date | بدون تاريخ بدء |
| `atm.register.status.open` | In operation | قيد التشغيل |
| `atm.register.status.ended` | Handed back | تم التسليم |
| `atm.register.group.identity` | Identity | البيانات الأساسية |
| `atm.register.group.keys` | Keys | المفاتيح |
| `atm.register.group.cassettes` | Cassettes | الكاسيتات |
| `atm.register.group.hours` | Hours and notes | المواعيد والملاحظات |
| `atm.register.group.secret` | Combination | الرقم السري |
| `atm.register.group.location` | Location | الموقع |
| `atm.register.group.lifecycle` | Receipt and handover | الاستلام والتسليم |
| `atm.register.group.hub` | HUB | HUB |
| `atm.register.secretHidden` | Hidden: requires the keys permission | مخفي: يتطلب صلاحية عرض المفاتيح |
| `atm.register.combinationSet` / `combinationUnset` | Recorded / Not recorded | مسجّل / غير مسجّل |
| `atm.register.issues` | {{count}} import note(s) | {{count}} ملاحظة استيراد |
| `atm.register.actions` | Actions | الإجراءات |
| `atm.register.action.edit` | Edit | تعديل |
| `atm.register.action.receivePending` | Record receipt | تسجيل الاستلام |
| `atm.register.action.handover` | Hand over to the bank | تسليم للبنك |
| `atm.register.action.reveal` | Reveal combination | كشف الرقم السري |
| `atm.register.action.delete` | Delete | حذف |
| `atm.register.master.active` | In the Operations list | في قائمة التشغيل |
| `atm.register.master.archived` | Archived in the Operations list | مؤرشفة في قائمة التشغيل |
| `atm.register.master.deleted` | Deleted from the Operations list | محذوفة من قائمة التشغيل |
| `atm.register.master.missing` | Not in the Operations list | غير موجودة في قائمة التشغيل |
| `atm.register.master.unlinked` | Not linked to the Operations list | غير مربوطة بقائمة التشغيل |
| `atm.register.action.link` | Link to the Operations list | الربط بقائمة التشغيل |
| `atm.register.form.linkTitle` | Link machine {{code}} to the Operations list | ربط الماكينة {{code}} بقائمة التشغيل |
| `atm.register.form.linkBody` | The machine is linked to, reactivated in or added to the Operations list of its branch, as on receipt. | تُربط الماكينة بقائمة التشغيل لفرعها أو يُعاد تفعيلها فيها أو تُضاف إليها، كما عند الاستلام. |
| `atm.register.form.linkOnAreaHint` | Entering the area links this machine to the Operations list. | إدخال المنطقة يربط هذه الماكينة بقائمة التشغيل. |
| `atm.register.masterAction.link` | Linked to the existing machine in the Operations list. | رُبطت بالماكينة الموجودة في قائمة التشغيل. |
| `atm.register.masterAction.reactivate` | The machine was reactivated in the Operations list. | أُعيد تفعيل الماكينة في قائمة التشغيل. |
| `atm.register.masterAction.create` | The machine was added to the Operations list. | أُضيفت الماكينة إلى قائمة التشغيل. |
| `atm.register.masterAction.archive` | The machine was archived in the Operations list. | أُرشفت الماكينة في قائمة التشغيل. |
| `atm.register.masterAction.sync` | The Operations list was updated. | حُدّثت قائمة التشغيل. |
| `atm.register.received` / `saved` / `handedOver` / `deleted` | Machine received. / Saved. / Machine handed back. / Entry deleted. | تم استلام الماكينة. / تم الحفظ. / تم تسليم الماكينة. / تم حذف السجل. |
| `atm.register.form.receiveTitle` | Receive a machine | استلام ماكينة |
| `atm.register.form.editTitle` | Edit entry {{code}} | تعديل السجل {{code}} |
| `atm.register.form.receivePendingTitle` | Record the receipt of {{name}} | تسجيل استلام {{name}} |
| `atm.register.form.handoverTitle` | Hand machine {{code}} back to the bank | تسليم الماكينة {{code}} للبنك |
| `atm.register.form.handoverHint` | The machine is archived in the Operations list: it leaves the open forms and its maintenance mails stay unmatched. | تُؤرشف الماكينة في قائمة التشغيل: تختفي من نماذج الفتح وتبقى رسائل صيانتها دون مطابقة. |
| `atm.register.form.deleteTitle` | Delete entry | حذف السجل |
| `atm.register.form.deleteBody` | Delete this entry recorded by mistake? If it is the machine's only open period, the machine is archived in the Operations list. | هل تريد حذف هذا السجل المُدخل بالخطأ؟ إذا كان فترة التشغيل المفتوحة الوحيدة للماكينة فستُؤرشف في قائمة التشغيل. |
| `atm.register.form.opsBankLabel` | Bank name in the Operations list | اسم البنك في قائمة التشغيل |
| `atm.register.form.opsBankLabelAuto` | Automatic ({{label}}) | تلقائي ({{label}}) |
| `atm.register.form.startDateHint` | Leave empty to record the machine without a start date. | اتركه فارغًا لتسجيل الماكينة دون تاريخ بدء. |
| `atm.register.form.areaRequired` | The area is required when the start date is set. | المنطقة مطلوبة عند إدخال تاريخ البدء. |
| `atm.register.form.combinationKeep` | Leave empty to keep the recorded value. | اتركه فارغًا للإبقاء على القيمة المسجّلة. |
| `atm.register.form.combinationClear` | Clear the recorded value | مسح القيمة المسجّلة |
| `atm.register.form.codeLocked` | The ATM ID cannot change once the machine is linked to the Operations list. | لا يمكن تغيير رقم الماكينة بعد ربطها بقائمة التشغيل. |
| `atm.register.reveal.title` | Reveal the safe door combination | كشف الرقم السري لباب الخزينة |
| `atm.register.reveal.body` | Every reveal is recorded with your name and the time. | يُسجَّل كل كشف باسمك ووقته. |
| `atm.register.reveal.confirm` | Reveal | كشف |
| `atm.register.reveal.hidesIn` | Hidden again in {{seconds}} s | يُخفى مجددًا خلال {{seconds}} ث |
| `atm.register.reveal.copy` | Copy | نسخ |
| `atm.register.reveal.none` | No combination is recorded. | لا يوجد رقم سري مسجّل. |
| `atm.register.col.<field>` | 49 keys — table below | |
| `atm.register.issue.{ATM_REGISTER_IMPORT_ISSUES}` | 26 keys — table below | |
| `atm.register.warning.{ATM_REGISTER_WARNINGS}` | 7 keys — table below | |
| `atm.register.error.{CODE}` | 14 keys — one per new error code (§3.10) | |

Columns (`atm.register.col.<field>`):

| Field | en | ar | Field | en | ar |
|---|---|---|---|---|---|
| `branchCode` | Branch | الفرع | `cassettes.withdrawalType` | Withdrawal cassettes | كاسيتات السحب |
| `area` | Area | المنطقة | `cassettes.withdrawalCount` | Loading cassettes | عدد كاسيتات التحميل |
| `bankCode` | Bank | البنك | `cassettes.withdrawal1..5` | Cassette 1..5 | كاسيت 1..5 |
| `machineCode` | ATM ID | رقم الماكينة | `cassettes.depositType` | Deposit cassettes | كاسيتات الإيداع |
| `name` | Name | اسم الماكينة | `cassettes.depositCount` | Loading cassettes | عدد كاسيتات التحميل |
| `operationType` | Operation type | نوع التشغيل | `cassettes.collectionCount` | Collection | التجميع |
| `vendor` | ATM type | نوع الماكينة | `cassettes.recycle200/100/50` | 200 / 100 / 50 | 200 / 100 / 50 |
| `model` | Model | الموديل | `cassettes.spareCount` | Spare withdrawal cassettes | كاسيتات السحب الاحتياطية |
| `serial` | Serial | الرقم التسلسلي | `cassettes.spare1..5` | Cassette 1..5 | كاسيت 1..5 |
| `keys.supervisorCode` | Supervisor keys | مفاتيح المشرف | `openTime` | Open time | وقت الفتح |
| `keys.supervisorCount` | Number | العدد | `closeTime` | End time | وقت الإغلاق |
| `keys.safeDoorCount` | Safe door keys | مفاتيح باب الخزينة | `accessHoursNotes` | Time limit notes | ملاحظات قيود الوقت |
| `keys.alanki` | Alanki | Alanki | `receiptNotes` | Notes received | ملاحظات الاستلام |
| `keys.combinationKeyCode` | Combination safe door keys | مفاتيح الباب ذي الأرقام السرية | `safeCombination` | Safe door combination | الرقم السري لباب الخزينة |
| `keys.combinationKeyCount` | Number of keys | عدد المفاتيح | `locationPlusCode` | Location GPS (code) | الموقع GPS (رمز) |
| `keys.cashUnitCode` | Cash unit keys | مفاتيح وحدة النقدية | `startDate` | Operation start date | تاريخ بدء التشغيل |
| `keys.cashUnitCount` | Number of keys | عدد المفاتيح | `endDate` | Operation end date | تاريخ انتهاء التشغيل |
| `locationUrl` | Location GPS (link) | الموقع GPS (رابط) | `receivedByName` | Received name | اسم المستلم |
| `hub` | HUB | HUB | `handoverName` | Delivered name | اسم التسليم |
| | | | `handoverNotes` | Notes delivered | ملاحظات التسليم |

(`..5` rows expand to five keys each, `1`…`5`.)

Import issues (`atm.register.issue.<code>`):

| Code | en | ar |
|---|---|---|
| `noBranch` | No branch in the workbook | لا يوجد فرع في الملف |
| `unknownBranchCode` | Unknown branch code | كود فرع غير معروف |
| `areaError` | The area cell held an Excel error | خلية المنطقة تحتوي على خطأ من Excel |
| `openNoArea` | In operation without an area | قيد التشغيل دون منطقة |
| `bankAlias` | Bank written «نيكست», read as NXT | البنك مكتوب «نيكست» وقُرئ NXT |
| `unknownBank` | Unknown bank | بنك غير معروف |
| `noBank` | In operation without a bank | قيد التشغيل دون بنك |
| `noCode` | No ATM ID | لا يوجد رقم ماكينة |
| `placeholderCode` | Placeholder ATM ID | رقم ماكينة مؤقت |
| `codeWhitespace` | The ATM ID had extra spaces | رقم الماكينة به مسافات زائدة |
| `idFormat` | The ATM ID does not match the bank's usual format | رقم الماكينة لا يطابق الصيغة المعتادة للبنك |
| `hdbSpelling` | The same HDB machine is written another way | ماكينة بنك التعمير والإسكان نفسها مكتوبة بصيغة أخرى |
| `duplicateOpen` | The same ATM ID is in operation on another row | رقم الماكينة نفسه قيد التشغيل في صف آخر |
| `openNotNewest` | A later period exists for this ATM ID | توجد فترة أحدث لرقم الماكينة نفسه |
| `serialDuplicate` | The same serial is in operation under another ATM ID | الرقم التسلسلي نفسه قيد التشغيل برقم ماكينة آخر |
| `exactDuplicate` | Identical to another row | مطابق تمامًا لصف آخر |
| `timeOverDay` | A time value longer than one day | قيمة وقت أطول من يوم |
| `aoShape` | The combination is not in the NN - NN - NN form | الرقم السري ليس بالصيغة NN - NN - NN |
| `dateSerial` | A date stored as a number was converted | حُوِّل تاريخ مخزّن كرقم |
| `dateInvalid` | Unreadable date | تاريخ غير مقروء |
| `endBeforeStart` | The end date is before the start date | تاريخ الانتهاء قبل تاريخ البدء |
| `futureStart` | The start date is in the future | تاريخ البدء في المستقبل |
| `futureEnd` | The end date is in the future | تاريخ الانتهاء في المستقبل |
| `dateInText` | A date typed in a text column | تاريخ مكتوب في عمود نصي |
| `errorValue` | The cell held an Excel error | الخلية تحتوي على خطأ من Excel |
| `noName` | No machine name in the workbook | لا يوجد اسم للماكينة في الملف |

Warnings (`atm.register.warning.<code>`): `idFormat` "The ATM ID does not match the usual format for
this bank." / «رقم الماكينة لا يطابق الصيغة المعتادة لهذا البنك.»; `serialDuplicate` "Another machine in
operation has the same serial." / «توجد ماكينة أخرى قيد التشغيل بالرقم التسلسلي نفسه.»; `endBeforeStart`
"The end date is before the start date." / «تاريخ الانتهاء قبل تاريخ البدء.»; `futureDate` "The date is in
the future." / «التاريخ في المستقبل.»; `masterDiffers` "The Operations list has a different name or area for
this machine; it was left unchanged." / «لهذه الماكينة اسم أو منطقة مختلفة في قائمة التشغيل، ولم تُعدَّل.»;
`opsBankLabelIgnored` "The machine already exists in the Operations list, so its bank name there was
kept." / «الماكينة موجودة في قائمة التشغيل، لذا أُبقي على اسم البنك فيها.»; `codeActiveElsewhere` "This ATM ID is
active in another branch's Operations list, so the machine was not linked. The change was saved." /
«رقم الماكينة نشط في قائمة التشغيل لفرع آخر، لذا لم تُربط الماكينة. حُفظ التعديل.»

Errors (`atm.register.error.<CODE>`): `ATM_REGISTER_OPEN_PERIOD_EXISTS` "This ATM ID already has an
open period. Hand it over first." / «لرقم الماكينة هذا فترة تشغيل مفتوحة. سلّمها أولًا.»;
`ATM_REGISTER_CODE_ACTIVE_ELSEWHERE` "This ATM ID is active in another branch's Operations list." /
«رقم الماكينة هذا نشط في قائمة التشغيل لفرع آخر.»; `ATM_REGISTER_BRANCH_UNMAPPED` "This branch has no
register code." / «لا يوجد كود سجل لهذا الفرع.»; `ATM_REGISTER_BRANCH_REQUIRED` "This entry has no
branch; delete it and receive the machine again." / «هذا السجل بدون فرع؛ احذفه واستلم الماكينة من جديد.»;
`ATM_REGISTER_AREA_REQUIRED` "The area is required." / «المنطقة مطلوبة.»; `ATM_REGISTER_NOT_OPEN` "The entry
is not in operation." / «السجل ليس قيد التشغيل.»; `ATM_REGISTER_NOT_PENDING` "The entry already has a start
date." / «للسجل تاريخ بدء بالفعل.»; `ATM_REGISTER_NOT_ENDED` "The entry has not been handed back." /
«لم يُسلَّم السجل بعد.»; `ATM_REGISTER_IMMUTABLE_FIELD` "This field cannot change now." / «لا يمكن تغيير هذا
الحقل الآن.»; `ATM_REGISTER_ALREADY_LINKED` "This entry is already linked to the Operations list." /
«هذا السجل مربوط بقائمة التشغيل بالفعل.»; `ATM_REGISTER_IMPORT_LAYOUT` "The workbook does not have the expected columns." / «الملف لا
يحتوي على الأعمدة المتوقعة.»; `ATM_REGISTER_IMPORT_BLOCKED` "The import cannot be applied yet." / «لا يمكن
تطبيق الاستيراد بعد.»; `ATM_REGISTER_IMPORT_FILE_CHANGED` "The file changed since the preview. Preview it
again." / «تغيّر الملف منذ المعاينة. أعد المعاينة.»; `ATM_REGISTER_IMPORT_RUNNING` "Another import is
running." / «توجد عملية استيراد أخرى قيد التنفيذ.»

### 9.3 Data Report

| Key | en | ar |
|---|---|---|
| `atm.registerReport.title` | Data Report | تقرير البيانات |
| `atm.registerReport.asOf` | As of {{date}} | بتاريخ {{date}} |
| `atm.registerReport.section1` | Customer machines in the company | اعداد ماكينات العملاء بالشركة |
| `atm.registerReport.section2` | Machines in the company's branches | اعداد الماكينات بأفرع الشركة |
| `atm.registerReport.section3` | Customer machines in the company's branches | ماكينات العملاء بأفرع الشركة |
| `atm.registerReport.total` | Total machines | إجمالي عدد الماكينات |
| `atm.registerReport.legend` | Banks | البنوك |
| `atm.registerReport.empty` | No machines in operation. | لا توجد ماكينات قيد التشغيل. |
| `atm.registerReport.unmapped` | {{count}} machine(s) in operation belong to a branch without a register code and appear only in the bank totals. | {{count}} ماكينة قيد التشغيل تتبع فرعًا بلا كود سجل، وتظهر في إجماليات البنوك فقط. |
| `atm.registerReport.withoutBank` | {{count}} machine(s) in operation have no bank and appear only in the branch totals. | {{count}} ماكينة قيد التشغيل بلا بنك، وتظهر في إجماليات الفروع فقط. |
| `atm.registerReport.chartSummary` | {{title}}: {{total}} machines | {{title}}: {{total}} ماكينة |
| `atm.registerReport.branch2.EGYCASH-7` … `-6` | EgyCash Wisal branch · EgyCash Mohandessin branch · EgyCash Tanta branch · EgyCash Asyut branch · EgyCash Alexandria branch · EgyCash October branch · EgyCash Port Said branch | فرع إيجي كاش وصال · فرع إيجي كاش المهندسين · فرع إيجي كاش طنطا · فرع إيجي كاش أسيوط · فرع إيجي كاش الإسكندرية · فرع إيجي كاش أكتوبر · فرع إيجي كاش بور سعيد |
| `atm.registerReport.branch3.EGYCASH-1` … | EgyCash (Mohandessin) · (October) · (Tanta) · (Asyut) · (Alexandria) · (Port Said) · (Wisal) | إيجي كــاش ( المهندسين ) · إيجي كــاش ( أكتوبر ) · إيجي كــاش ( طنطا ) · إيجي كــاش ( أسيــوط ) · إيجي كــاش ( الاســكندرية ) · إيجي كــاش ( بور سعيد ) · إيجي كــاش (وصال ) |

(`branch2` values listed in Section-2 order 7,1,2,3,4,5,6; `branch3` in Section-3 order 1,5,2,3,4,6,7.
The Arabic is the sheet's text verbatim except the two D7 fixes; bank labels come from
`ATM_BANK_NAMES`, whose `NXT BANK` carries the third fix. `atm.registerReport.total` is the one
provisional spelling — DEC-28 / EG-21.)

### 9.4 Import page and settings card

| Key | en | ar |
|---|---|---|
| `atm.registerImport.title` | Import the register workbook | استيراد ملف سجل الماكينات |
| `atm.registerImport.intro` (upload-card body text, §8.6) | Preview first; nothing is written until you approve categories and apply. | عاين أولًا؛ لا يُكتب شيء حتى تعتمد الفئات وتطبّقها. |
| `atm.registerImport.upload` | Choose the workbook (.xlsx) | اختر الملف (.xlsx) — `(.xlsx)` wrapped in LRI…PDI (`\u2066…\u2069`), or the RTL line shows «(xlsx.)» (review WEB-4) |
| `atm.registerImport.error.missingSheet` / `.unreadable` / `.tooLarge` | The workbook has no sheet named ATMs. / This file is not a readable Excel workbook (xlsx). / The workbook is larger than the import reads. | لا يحتوي الملف على ورقة باسم ATMs. / تعذّرت قراءة الملف؛ يجب أن يكون مصنّف Excel بصيغة xlsx. / الملف أكبر مما يقرؤه الاستيراد. — chosen by the refusal's `file` detail (`MISSING_SHEET`, `UNREADABLE`, `TOO_LARGE`) before the error code (review LIVE-2) |
| `atm.registerImport.preview` | Preview | معاينة |
| `atm.registerImport.apply` | Apply the approved categories | تطبيق الفئات المعتمدة |
| `atm.registerImport.applyConfirmTitle` | Apply the import | تطبيق الاستيراد |
| `atm.registerImport.applyConfirmBody` | Apply: {{list}}? The Operations machine list changes accordingly. | تطبيق: {{list}}؟ ستتغير قائمة ماكينات التشغيل تبعًا لذلك. |
| `atm.registerImport.applied` | Applied: {{summary}} | تم التطبيق: {{summary}} |
| `atm.registerImport.counts.rows` / `.open` / `.ended` / `.pending` / `.alreadyImported` | Rows / In operation / Handed back / No start date / Already imported | الصفوف / قيد التشغيل / تم التسليم / بدون تاريخ بدء / سبق استيرادها |
| `atm.registerImport.reportCheck.title` | Data Report check | مطابقة تقرير البيانات |
| `atm.registerImport.reportCheck.section` / `.label` / `.cell` / `.expected` / `.recomputed` | Section / Label / Cell / Expected (snapshot) / From this file | القسم / البيان / الخلية / المتوقع (اللقطة) / من هذا الملف |
| `atm.registerImport.reportCheck.match` / `.mismatch` | Match / Differs | مطابق / مختلف |
| `atm.registerImport.reportCheck.allMatch` | All 57 numbers match. | جميع الأرقام الـ57 مطابقة. |
| `atm.registerImport.reportOverride` | Apply despite the differences | التطبيق رغم الاختلاف |
| `atm.registerImport.reportOverrideHint` | The file's numbers differ from the verified snapshot. Apply only if the differences are expected. | أرقام الملف تختلف عن اللقطة المُتحقَّق منها. لا تطبّق إلا إذا كانت الاختلافات متوقعة. |
| `atm.registerImport.approve` | Approve | اعتماد |
| `atm.registerImport.issues.title` / `.row` / `.codes` / `.column` | Row notes / Row / Notes / Column | ملاحظات الصفوف / الصف / الملاحظات / العمود |
| `atm.registerImport.branches.title` | Branches in the file | الفروع في الملف |
| `atm.registerImport.branches.code` / `.branch` / `.active` / `.inReach` / `.rows` / `.openRows` | Code / ECMS branch / Active / In your permission / Rows / In operation | الكود / الفرع في النظام / نشط / ضمن صلاحيتك / الصفوف / قيد التشغيل |
| `atm.registerImport.runs.title` | Previous imports | عمليات الاستيراد السابقة |
| `atm.registerImport.runs.started` / `.finished` / `.state` / `.actor` / `.categories` / `.counts` / `.empty` | Started / Finished / State / By / Categories / Results / No import has run yet. | البدء / الانتهاء / الحالة / بواسطة / الفئات / النتائج / لم تُنفَّذ أي عملية استيراد بعد. |
| `atm.registerImport.item.row` / `.reason` / `.differences` / `.otherBranch` / `.columns` | Row / Reason / Differs in / Other branch / Differing columns | الصف / السبب / يختلف في / الفرع الآخر / الأعمدة المختلفة |
| `atm.registerImport.pairs.from` / `.to` / `.count` | Active in / Row's branch / Machines | نشطة في / فرع الصف / عدد الماكينات |
| `atm.registerImport.outcome.{ATM_REGISTER_IMPORT_OUTCOMES}` | imported: Imported · alreadyImported: Already imported · linked: Linked · reactivated: Reactivated · created: Added · nbeForex: NBE FOREX applied · cannotCouple: Not linked · notApproved: Not approved · openInRegister: Already open in the register | imported: استُورد · alreadyImported: سبق استيراده · linked: رُبط · reactivated: أُعيد تفعيله · created: أُضيف · nbeForex: طُبّق NBE FOREX · cannotCouple: لم يُربط · notApproved: غير معتمد · openInRegister: مفتوح بالفعل في السجل |
| `atm.registerImport.category.activeElsewhere.title` / `.body` | Active in another branch / The machine is active in another branch's Operations list. The row is imported without a machine until the conflict is resolved. | نشطة في فرع آخر / الماكينة نشطة في قائمة التشغيل لفرع آخر. يُستورد الصف دون ماكينة حتى تُحل هذه الحالة. |
| `atm.registerImport.category.openInRegister.title` / `.body` | Already open in the register / The register already has an open period for this ATM ID. Hand it over or delete it, or correct the file, then preview again. | مفتوحة بالفعل في السجل / توجد في السجل فترة تشغيل مفتوحة لرقم الماكينة نفسه. سلّمها أو احذفها، أو صحّح الملف، ثم أعد المعاينة. |
| `atm.registerImport.category.changedSinceImport.title` / `.body` | Changed since the import / These rows were imported before and their values in this file differ from the register. Bring the register in line or correct the file, then preview again. | تغيّرت منذ الاستيراد / استُوردت هذه الصفوف من قبل، وقيمها في هذا الملف تختلف عن السجل. عدّل السجل أو صحّح الملف، ثم أعد المعاينة. |
| `atm.registerImport.blockerHint.{dateUnreadable, openInRegister, changedSinceImport, secretsOutOfReach}` | dateUnreadable: Correct the start or end date in the listed rows of the workbook, then preview again. · openInRegister: see the list below. · changedSinceImport: see the list below. · secretsOutOfReach: Ask for the keys permission in every branch of the file. | dateUnreadable: صحّح تاريخ البدء أو الانتهاء في الصفوف المذكورة بالملف، ثم أعد المعاينة. · openInRegister: انظر القائمة أدناه. · changedSinceImport: انظر القائمة أدناه. · secretsOutOfReach: اطلب صلاحية عرض المفاتيح في كل فروع الملف. |
| `atm.registerImport.category.entries.title` / `.body` | Register entries / Creates one entry per row not imported before. | سجلات الماكينات / يُنشئ سجلًا لكل صف لم يُستورد من قبل. |
| `atm.registerImport.category.link.title` / `.body` | Link / The machine already exists and is active in the Operations list; it is linked and left unchanged. | ربط / الماكينة موجودة ونشطة في قائمة التشغيل؛ تُربط دون تعديل. |
| `atm.registerImport.category.reactivate.title` / `.body` | Reactivate / The machine exists archived in the Operations list; it is reactivated with this row's name, area and bank. | إعادة تفعيل / الماكينة مؤرشفة في قائمة التشغيل؛ يُعاد تفعيلها باسم هذا الصف ومنطقته وبنكه. |
| `atm.registerImport.category.create.title` / `.body` | Create / The machine is not in the Operations list; it is added. | إضافة / الماكينة غير موجودة في قائمة التشغيل؛ تُضاف. |
| `atm.registerImport.category.nbeForex.title` / `.body` | NBE + FX area → NBE FOREX / NBE machines whose area ends with FX get the bank name NBE FOREX in the Operations list. | البنك الأهلي + منطقة FX ← NBE FOREX (an RLM `\u200F` after «FX», or the arrow reads backwards — review WEB-4) / ماكينات البنك الأهلي التي تنتهي منطقتها بـ FX تأخذ اسم البنك NBE FOREX في قائمة التشغيل. |
| `atm.registerImport.category.cannotCouple.title` / `.body` | Cannot be linked / These rows stay in the register without a machine in the Operations list. | تعذّر الربط / تبقى هذه الصفوف في السجل دون ماكينة في قائمة التشغيل. |
| `atm.registerImport.category.activeMasterWithoutOpenEntry.title` / `.body` | Active without an open period / Active in the Operations list with no open period in the register. Shown for review only. | نشطة دون فترة مفتوحة / نشطة في قائمة التشغيل دون فترة مفتوحة في السجل. للمراجعة فقط. |
| `atm.registerImport.reason.{ATM_REGISTER_IMPORT_REASONS}` | blankArea: No area · activeElsewhere: Active in another branch · noCode: No ATM ID · placeholderCode: Placeholder ATM ID · noBank: No bank · noName: No machine name · labelMissing: The branch has no NBE FOREX bank name · keepsMasterLabel: Keeps the bank name in the Operations list · notImported: The row is not imported yet | blankArea: بدون منطقة · activeElsewhere: نشطة في فرع آخر · noCode: بدون رقم ماكينة · placeholderCode: رقم ماكينة مؤقت · noBank: بدون بنك · noName: بدون اسم ماكينة · labelMissing: لا يوجد اسم بنك NBE FOREX في الفرع · keepsMasterLabel: يُبقي على اسم البنك في قائمة التشغيل · notImported: لم يُستورد الصف بعد |
| `atm.registerImport.blocker.{ATM_REGISTER_IMPORT_BLOCKERS}` | branchUnmapped: A branch code in the file has no ECMS branch · branchInactive: A mapped branch is inactive · branchOutOfReach: Your permission does not cover a branch in the file · secretsOutOfReach: Your keys permission does not cover every branch whose rows carry keys or the combination · reportMismatch: The Data Report numbers differ · dateUnreadable: Some start or end dates cannot be read · openInRegister: Some machines are already open in the register · changedSinceImport: Some imported rows changed in this file · secretStoreUnavailable: The secret store is not configured · runInProgress: Another import is running | branchUnmapped: كود فرع في الملف بلا فرع في النظام · branchInactive: فرع مربوط غير نشط · branchOutOfReach: صلاحيتك لا تشمل فرعًا في الملف · secretsOutOfReach: صلاحية عرض المفاتيح لا تشمل كل الفروع التي تحمل صفوفها مفاتيح أو رقمًا سريًا · reportMismatch: أرقام تقرير البيانات مختلفة · dateUnreadable: بعض تواريخ البدء أو الانتهاء غير مقروءة · openInRegister: بعض الماكينات مفتوحة بالفعل في السجل · changedSinceImport: تغيّرت بعض الصفوف المستوردة في هذا الملف · secretStoreUnavailable: مخزن الأسرار غير مُهيأ · runInProgress: توجد عملية استيراد أخرى قيد التنفيذ |
| `atm.registerImport.runs.state.{states}` | running: Running · completed: Completed · failed: Failed · abandoned: Abandoned | running: قيد التنفيذ · completed: مكتملة · failed: فشلت · abandoned: متروكة |
| `atm.registerSettings.title` | Register settings | إعدادات السجل |
| `atm.registerSettings.branchCodes` | Branch codes in the workbook | أكواد الفروع في الملف |
| `atm.registerSettings.code` / `.sheetName` / `.branch` / `.pickBranch` | Code / Name in the workbook / ECMS branch / Choose a branch… | الكود / الاسم في الملف / الفرع في النظام / اختر فرعًا… |
| `atm.registerSettings.bankLabels` | Bank names in the Operations list | أسماء البنوك في قائمة التشغيل |
| `atm.registerSettings.bank` / `.bankName` / `.label` | Bank / Name in the Data Report / Name in the Operations list | البنك / الاسم في تقرير البيانات / الاسم في قائمة التشغيل |
| `atm.registerSettings.save` / `.saved` | Save / Saved. | حفظ / تم الحفظ. |
| `atm.registerSettings.readOnly` | Only an administrator with the settings permission can change these values. | لا يغيّر هذه القيم إلا مدير لديه صلاحية الإعدادات. |

---

## 10. Tests

Integration suites boot a real replica set (`MongoMemoryReplSet`, needed for transactions) — the
`apps/api/tests/integration/atm.spec.ts:43-53, 89-199` harness (users, roles, branches via
`POST /platform/branches`, `ensureAssignment`). Run from `apps/api`:
`MONGOMS_SYSTEM_BINARY=/opt/mongod/mongod npx vitest run <file>`. Settings are written in test setup
with `settingsService.set(ctx, …)` exactly as `atm.spec.ts:103-117` does. **No test fixture may
contain the real workbook or any value from it**; workbooks are built in-test with ExcelJS.

### 10.1 Existing tests and counts that change

| File | Today | After |
|---|---|---|
| `apps/api/src/modules/atm/atm.module.spec.ts:1-4` (header) | "15 permissions, 4 pages, 6 routes, 5 collections" | "27 permissions, 6 pages, 8 routes, 7 collections" |
| `atm.module.spec.ts:22-38` (sorted keys) | 15 keys | `atmMachine.manage, atmMachine.moveArea, atmMachine.view, atmMailTicket.decide, atmMailTicket.view, atmMailTicket.viewLog, atmMaintenance.complete, atmMaintenance.create, atmMaintenance.delete, atmMaintenance.edit, atmMaintenance.view, atmRefLabel.create, atmRefLabel.edit, atmRegister.create, atmRegister.delete, atmRegister.edit, atmRegister.export, atmRegister.handover, atmRegister.import, atmRegister.view, atmRegister.viewSecrets, atmRegisterReport.view, atmReplenishment.complete, atmReplenishment.create, atmReplenishment.delete, atmReplenishment.edit, atmReplenishment.view` (27, JS default sort) |
| `atm.module.spec.ts:39-44` (pages, declaration order) | 4 | `atm.replenishments, atm.maintenance, atm.mail-tickets, atm.machines, atm.register, atm.register-report` |
| `atm.module.spec.ts:45-52` (route prefixes, sorted) | 6 | `/atm/machines, /atm/mail-tickets, /atm/maintenances, /atm/ref-labels, /atm/register, /atm/register/import, /atm/replenishments, /atm/reports` |
| `atm.module.spec.ts:53-59` (collections, sorted) | 5 | `atm_machines, atm_mail_tickets, atm_maintenances, atm_ref_labels, atm_register_entries, atm_register_import_runs, atm_replenishments` |
| `apps/api/src/seed-navigation.spec.ts:60` | `toHaveLength(126)` | `toHaveLength(128)`; plus a new `it`: every row with `previousPermission` actually changes (`!== permission`) and `/atm/data-edit` has `previousPermission: 'atmMachine.manage'`, `permission: 'atmRefLabel.create'` (the `previousIcon` test `:100-109` is the model) |
| `apps/api/tests/integration/auth-seed-login.spec.ts:36` | `SEEDED_APPLICATIONS = 126` | `128` |
| `auth-seed-login.spec.ts:245-255` | ATM `toContain` list | add `toContain('/atm/register')`, `toContain('/atm/register/report')` |
| `auth-seed-login.spec.ts:262-267` (stale breakdown "…= 117") | wrong sum | `38 (HR) + 21 (Fleet) + 15 (Operations) + 6 (Organization) + 14 (IT) + 12 (Gold Vault) + 12 (ATM) + 10 (Administration) = 128` (recounted from `NAVIGATION_CATALOG` for this spec: 38/21/15/6/14/12/10/10 today) |
| `apps/web/src/shared/lib/remembered-filters-coverage.spec.ts` | ATM entries today: 4 COVERED (`:47-50`), 4 EXCLUDED (`:142-145`), 2 NOT_FILTER_CAPABLE (`:172, :174`) | COVERED (`:46+`) += `['modules/atm/pages/RegisterPage.tsx', []]`; NOT_FILTER_CAPABLE (`:171+`) += `['modules/atm/pages/RegisterImportPage.tsx']`, `['modules/atm/pages/RegisterReportPage.tsx']` (no notes — both shells stay non-filter-shaped, §8.5/§8.6). `TAB_SCOPED` unchanged (7). DataEditPage entry unchanged (`:47`). |
| `apps/web/src/modules/atm/atm-i18n.spec.ts` | — | **unchanged**: no key is removed; its `ATM_SHORTCUTS` test (`:181-187`) automatically covers the two new cards. New keys are pinned in a NEW spec (§10.2). |
| `apps/api/tests/integration/atm.spec.ts` | operator bundle holds `atmMachine.manage` (`:136-159`) | **unchanged**: every write it exercises still accepts `manage`; that bundle predates D2 (the new Operations bundle is tested in the new suite). Its 403 tests (`:242-247`, `:338-355`) still hold (the reviewer bundle holds none of the new keys). Its label create/rename (`:307-335`) still passes the new branch-reach checks of §7.1: the operator holds `manage` at BRANCH scope placed in Alex, so `keyReachesBranch(manage, Alex)` is true. |
| `apps/web/src/modules/system-admin/system-admin-i18n.spec.ts:116-127`, `audit/audit-screens.spec.tsx:200-203, 362-368` | every `AUDIT_ACTIONS` value labelled | pass once §9.1 adds `systemAdmin.users.audit.secretRevealed` / `.atmRegisterImport` (en + ar) |
| `apps/api/src/platform/realtime/realtime-registry.spec.ts` | scans literal `moduleId/entityType` pairs both ways | passes with §5.10 (`atm.registerEntry` topic, `atm.registerImport` excluded) **at WP-A's merge already**: both literal pairs live in WP-A files (`register.service.ts`, `register-import-run.model.ts` `importAuditRef`); `EXPECTED_DYNAMIC_SITES` (`:48`) unchanged — no dynamic pair is added |
| `apps/web/src/platform/layout/page-header-has-no-subtitle.spec.ts` | no page passes a subtitle | unchanged and green: the three new pages pass none (§8.3, §8.6) |
| `apps/web/src/platform/realtime/realtime.spec.ts:180-214` | registry ↔ server | passes with §8.2 |
| `apps/api/src/platform/settings/settings-inventory.spec.ts` | registers no ATM setting (`:41-51`) | unchanged (48) |
| `scripts/check-page-registry.mjs` (CI) | — | passes: 2 new pages, all new keys assigned |
| `npm run check:permission-matrix` | — | unchanged (platform-only) |

### 10.2 New unit tests

| File (owner) | Scenarios |
|---|---|
| `packages/contracts/src/modules/atm-register.spec.ts` (A) | `deriveAtmRegisterStatus` 4 combos (end without start → ended); `isAtmRegisterActive`; `ReceiveAtmRegisterEntrySchema`: strict (rejects `status`, `endDate`, `machineId`), startDate ⇒ bank/code/area required (paths), pending without them OK, `''` → null; `UpdateAtmRegisterEntrySchema` strict, `safeCombination:null` allowed; ID formats (`20370003` NBE ok, `HDB - 4802`/`HDB-ATM 4802`/`HDB-ATM4802` ok, `4802` HDB warns, `BRKN0101` ok, `ATM0001` NXT ok); settings schemas reject duplicate code/branch; **fold**: S1 NXT handover (2 NXT open → hand one over → section1.NXT 1, both totals −1), S2 Alexandria NXT counted in `section3['EGYCASH-4'].NXT` and never in HDB, S3 Alexandria HDB counted once (HDB 1, NXT 0), S5 pending-with-bank not counted (fold gets only ACTIVE groups — assert via `isAtmRegisterActive` filter helper), S7 bank-null active → `activeWithoutBank` + branch cell only, unmapped branch → section1 only + `activeWithUnmappedBranch`, zeros present for every shown cell; the snapshot matrix (§6.5 section 3) folded reproduces sections 1 and 2 exactly; `ATM_DATA_REPORT_CELLS.length === 57` with the cell addresses AD3..AJ3, AD5..AK5, AE8..AJ14. |
| `apps/api/src/modules/atm/register/register.mapper.spec.ts` (A) | `!secretsVisible` → `keys/receiptNotes/handoverNotes` null and no `safeCombination` property at all; `safeCombinationSet` true/false; dates `YYYY-MM-DD`; `masterState` mapping incl. `unlinked` (open ∧ no machine) and null (pending/ended without machine); `name: null` passes through; `effectiveOpsBankLabel` precedence. |
| `register/register-secrets.spec.ts` (A) | context string; `redactedDiff` writes `[redacted]` for K paths and AO, `null` when unset, omits unchanged; `keyCoversEntry`/`secretsVisibleFor` for organization / branch in reach / branch out of reach / null branch / **department (home only and with a reach) / section / own → false** (DEC-29); `rotateRegisterCombinationKeys` with a fake store: not `rotatable` → nothing; rewraps only refs not on the current key; a lost version race is counted. |
| `register/register.repository.spec.ts` (A) | pure: `registerScopeMatch` and `registerScopeBranches` on the SAME selectors — organization, own, branch (home), branch with `branchIds`, department home-only, department with `departmentIds/departmentBranchIds`, section, and a caller placed nowhere — the branch set always equals the branches the match can return (department/section never `{}`). |
| `register/register-report.service.spec.ts` (A, pure part) | group → code mapping with unmapped ids; `branchesShown` for org, branch, multi-branch reach, department reach WITHOUT the home branch (home not shown), own (every mapped branch; S1 total = S2 total + unmapped). |
| `apps/api/src/infrastructure/observability/sentry.spec.ts` (A) | `isSecretBodyUrl` for `/api/v1/atm/register/entries`, `/api/v1/atm/register/import`, with a `BASE_PATH` prefix, and false for `/api/v1/atm/machines`; `scrubSentryEvent` on an event for `POST /api/v1/atm/register/entries` with a body → no `request.data`; nested `safeCombination`/`keys`/`receiptNotes`/`handoverNotes`/`plaintextCombination` removed from `extra`/`contexts`; an unrelated event unchanged. |
| `apps/api/src/infrastructure/logging/logger.spec.ts` (A) | a pino instance built with `PII_REDACTION_PATHS` writing to a memory stream redacts the five names at the root, one level and two levels deep. |
| `apps/api/src/modules/atm/atm.mappers.spec.ts` (A) | a lean machine/label doc without `__v/createdAt/updatedAt` maps (version 0, `_id` timestamp). |
| `register/import/register-columns.spec.ts` (B) | binds all 49 incl. `Number of\nkeys` #0/#1, `Number of\nloading cassettes` #0/#1, `Cassette -1..5` #0/#1, `LOCATION\nGPS` #0/#1, numeric 200/100/50; a missing/renamed header → error names the column letter and expected header only. |
| `register/import/cell-convert.spec.ts` (B) | time: an `h:mm` Date for 08:00 → `08:00`, 1.0 → `00:00` + `timeOverDay` (detail `1`), 3.75 days → `18:00` + `timeOverDay` (detail `3.75`), a General number `0` → `0` and `0.5` → `0.5` (not converted), text kept; date: Date → day, `46034` → `2026-01-12` + `dateSerial`, text / whitespace-only / `#N/A` / fractional → `dateInvalid`; blank E → null + `noName`; code: `20370003` number/text unify, NBSP → `codeWhitespace`, `0123` → `123`, `#` → `placeholderCode`; bank alias; `#N/A` in B → `areaError`; AO: 25 with `00 - 00 - 00` → `00 - 00 - 25`, 7-digit → `aoShape`, issue detail null; K-column issue detail always null. |
| `register/import/parse-rows.spec.ts` (B) | file-level issues on a synthetic row set: duplicateOpen (+ `openPeriodExempt`), openNotNewest, hdbSpelling, exactDuplicate (detail = row numbers, never values), serialDuplicate, end/future checks; `legacyMarks.cellFills` captures a yellow C, a pink AN and a red AW on rows whose A has no fill, `areaRedFill`/`rowFill` derived, `legacyMarks` null without fills; `headerFills` from row 1. |
| `register/import/read-register-workbook.spec.ts` (B) | the reduced zip holds exactly rels, workbook, styles, sharedStrings, the ATMs sheet — in that order — and nothing else; with the limits injected small (`readRegisterWorkbook(buffer, limits = REGISTER_WORKBOOK_LIMITS)`): an entry inflating past its cap → `TOO_LARGE` (the counter is checked per inflated chunk, so the overshoot is at most one chunk), too many rows → `TOO_LARGE`, the time limit → `TOO_LARGE`; `os.tmpdir()` gains no file while reading a workbook whose secret-bearing second sheet precedes `sharedStrings.xml`. |
| `register/import/report-check.spec.ts` (B) | rows generated from the snapshot matrix (2,607 active + some ended/pending) → `allMatch` true; one extra active NBE row → exactly `s1.NBE`, `s1.total`, its branch cell, `s2.<code>`, `s2.total` mismatch (5 cells). |
| `register/import/plan-import.spec.ts` (B) | category decisions with an in-memory master list: link (adopted label, differences; a blank-area row with an active master LINKS), reactivate, create, blankArea, noName, activeElsewhere as its own category with `pairs`, duplicate-open second row → link to the planned create, nbeForex with/without the branch label, activeMasterWithoutOpenEntry limited to in-reach branches; blockers `dateUnreadable`, `openInRegister` (an in-file pair is NOT flagged), `changedSinceImport` (columns listed, AO not compared), `secretsOutOfReach` (branch-scoped viewSecrets vs another branch's key values; no-branch rows need organization scope), `branchOutOfReach` for no-branch rows and a branch-scoped importer; out-of-reach branches produce no items. |
| `apps/web/src/modules/atm/atm-register-i18n.spec.ts` (A) | every key of §9 resolves in en and ar: all `ATM_REGISTER_COLUMNS` fields, statuses, issues, warnings, error codes, master states (incl. `unlinked`)/actions, import categories and report categories/reasons/blockers/blocker hints/outcomes/run states, the runs, branches, items, pairs and report-check column headers, report branch labels for all 7 codes, settings and data-edit keys; and NO key `atm.register.subtitle` / `atm.registerImport.subtitle` exists. |
| `apps/web/src/modules/atm/lib/register-grid.spec.ts` (C) | display order = A..AO, AP, AV, AQ..AU, AW; groups contiguous with the §8.3 spans; frozen offsets 0, w(A), … for the 5 frozen columns; width formula. |
| `apps/web/src/modules/atm/register-page.spec.tsx` (C) | `renderToStaticMarkup` with a pre-filled QueryClient (precedent `apps/web/src/modules/fleet/fleet-dashboard.spec.tsx:11-23`): ended row carries `REGISTER_ENDED_ROW`; K cells show the hidden marker when `secretsVisible:false`; no combination text ever rendered; action buttons per permission set (Link only for an open `unlinked` row); `unlinked` drift badge; `—` for a null name; group header row present; HandoverDialog markup pre-fills the entry's Delivered name. |
| `apps/web/src/modules/atm/lib/register-report-view.spec.ts` + `register-report-page.spec.tsx` (D) | section orders and labels (typo-fixed strings, `NXT BANK`, «إجمالي عدد الماكينات»), total bar last, the first category at the smallest x and every chart/table wrapped in `dir="ltr"` (DEC-19), zeros rendered as `0`, branch-scoped DTO shows only `branchesShown`, chart 3 series colours = `ATM_BANK_REPORT_COLORS`, charts 1–2 = `ATM_REPORT_TOTALS_COLOR`, as-of format. |
| `apps/web/src/modules/atm/data-edit-gating.spec.tsx` (E) | Operations permissions (`atmMachine.view`, `atmRefLabel.create/edit`, `atmMachine.moveArea`): no trash button, no bulk button, no add-machine button; area-move button present; label add/edit present. `manage`: everything present (regression). |
| `apps/web/src/modules/atm/register-import-view.spec.ts` (B) | apply-enabled logic (blockers, override), category approval list → `apply` field. |

### 10.3 New integration tests

`apps/api/tests/integration/atm-register.spec.ts` (WP-A). Fixture: branches Alex (`EGYCASH-4`) and
Tanta (`EGYCASH-2`) mapped; Efficiency org-wide role (all `atmRegister.*`, `atmRegisterReport.view`,
`atmMachine.view`); Efficiency-no-secrets role (same minus `viewSecrets`); Tanta branch-scoped
Efficiency role; the same Efficiency keys assigned at **department** scope (user placed in a Tanta
department), at **section** scope and at **own** scope (DEC-29); report-only role; Operations role
(§12.3) in Alex; admin (super-admin).

| # | Scenario | Expect |
|---|---|---|
| 1 | Receive NBE 27750059 in Alex with area | 201; entry `open`; master created (`isActive`, `bankName 'NBE'`, `zone ''`); audit `receive` (entry) + `create` (machine) |
| 2 | Tanta-scoped user receives into Alex | **403**; nothing written |
| 3 | unknown branch id / inactive branch / unmapped branch | 400 / 400 / 422 `ATM_REGISTER_BRANCH_UNMAPPED` |
| 4 | second receipt of the same code (same or other branch) while open | **409** `ATM_REGISTER_OPEN_PERIOD_EXISTS` |
| 5 | admin adds code X in Tanta via `/atm/machines`; Efficiency receives X in Alex | 409 `ATM_REGISTER_CODE_ACTIVE_ELSEWHERE` |
| 6 | receipt without area / pending without area | 400 / 201 pending, no master |
| 7 | **handover archives master**: hand over #1 | entry `ended`; master `isActive:false`; `atmMailIngestionService.ingest` for that code → `unmatched`; `POST /atm/replenishments` lists it in `unknownCodes`; audit `deliver` |
| 8 | **re-receipt reactivates**: receive 27750059 again in Alex | same master `_id`, `isActive:true`, name/area/bankName from the new entry; two entries (ended + open) |
| 9 | link: admin-added active master `MISR`/area A, receive BM code with different name | `master.action 'link'`, master unchanged, `opsBankLabel 'MISR'`, warning `masterDiffers` |
| 10 | edit open entry name/area/bankCode | master name/area/bankName updated in the same request; edit an ended entry → master untouched |
| 11 | Operations `PATCH /atm/machines/:id/area` | 200; master area + open entry area changed; audits machine + entry `update` |
| 12 | soft-delete the only open entry | 204; master archived; with two open entries on one master (insert an exempt pair directly) deleting one keeps it active |
| 13 | **secrets hidden**: Efficiency-no-secrets lists | `secretsVisible:false`, `keys/receiptNotes/handoverNotes` null, `safeCombinationSet:true`; the raw JSON contains neither the test combination nor any key code |
| 14 | **secrets present** for viewSecrets holder | keys/notes returned; still no `safeCombination` property |
| 15 | writing keys without viewSecrets | 403 |
| 16 | **reveal audited**: no-secrets user → 403; holder → value; an audit row `secretRevealed` with the actor; reveal on an entry without a value → `null` and still audited | |
| 17 | DB at rest: the raw `atm_register_entries` document JSON does not contain the plaintext combination | |
| 18 | **audit diff redacted**: update keys + combination → the audit row's changes are `[redacted]`; no audit document anywhere contains a plaintext key code or the combination | |
| 19 | export | CSV starts with BOM, P headers only (no `Supervisor`, `Combination`, `Notes Received`, `Notes Delivered` headers), `Status` last; audit `export`; 403 without `atmRegister.export` |
| 20 | **report numbers**: build entries — Alex NBE ×2, Alex HDB ×1 (S3), Alex NXT ×1 (S2), Tanta BM ×1, one pending NBE (S5), NXT handed over (S1) | section3 Alex: NBE 2, HDB 1, NXT 1 (not 0, not duplicated); section1 NXT counts only the open one; totals equal; pending excluded; zeros present; `generatedAt` set |
| 21 | report permission separation | report-only user: 200 on `/report`, 403 on `/entries`; Tanta-scoped report viewer sees only `EGYCASH-2` |
| 22 | stale version on edit/handover/delete | 409 `STALE_DOCUMENT` |
| 23 | legacy master without `__v/createdAt` inserted through `collection.insertOne` | receive links it; `migrateAtmLegacyTimestamps()` backfills; `GET /atm/machines` 200 |
| 24 | realtime: `publishAuditedChange` broadcasts for `receive`/`deliver` (unit-level spy on the publisher, `platform/realtime/realtime-publisher.ts:40-60`) | |
| 25 | **scope — no IDOR** (DEC-29): an Alex entry with a combination and key codes; the department-, section- and own-scoped Efficiency users (placed in Tanta) call `GET /entries/:id`, `POST …/reveal`, `PATCH`, `POST …/handover`, `DELETE`, `POST …/link` on it | 404 on every call (outside their read scope); the master is untouched; no `secretRevealed` audit row |
| 26 | the same users on a TANTA entry (inside their read scope) | `GET` 200 with `secretsVisible:false`, keys/notes null; reveal, edit, handover, delete, link → **403**; `GET /entries` lists Tanta rows only (department/section narrow to the branch, own lists only rows they created) |
| 27 | report for the department-scoped viewer whose department reach does not include the home branch / for the own-scoped viewer | `branchesShown` = the reached branches only / every mapped branch; Section 1 total = Section 2 total (+ unmapped) in both |
| 28 | the 409 for an open period elsewhere / an active master elsewhere, asked by the Tanta-scoped user about an Alex code | the message carries no Alex branch code; the org-wide user's message names `EGYCASH-4` |
| 29 | **headers**: list, get, write, reveal and export responses | each carries `Cache-Control: private, no-store` |
| 30 | **deferred coupling**: insert an open imported entry with `machineId:null`, no area (as the import writes it) | DTO `masterState:'unlinked'`; `PATCH` setting `area` → `master.action 'create'`, `machineId` set, master active; a second unlinked entry whose code is active in Tanta: `PATCH area` → 200 + warning `codeActiveElsewhere`, still unlinked; admin archives the Tanta master; `POST …/link` → `reactivate`/`create`; `POST …/link` again → 422 `ATM_REGISTER_ALREADY_LINKED` |
| 31 | **handover keeps imported values**: an open entry carrying `handoverName`/`handoverNotes` (inserted as the import writes it) handed over with `{ endDate }` only | both values unchanged; handed over with `handoverName:''` → null |
| 32 | **rotation** (DEC-33, precedent `tests/integration/automation-credentials.spec.ts:357-373`): seal under key `a`, switch the ring to `a,b` active `b`, run the `atm.rotateRegisterCombinationKeys` handler | `safeCombination.keyId === 'b'` (a soft-deleted entry too); reveal returns the same value; a second run rotates 0 |

`apps/api/tests/integration/atm-data-edit-permissions.spec.ts` (WP-A):

| # | Scenario | Expect |
|---|---|---|
| 1 | Operations role → `POST /atm/machines`, `/bulk`, `/bulk-delete`, `/reassign-area`, `PATCH /atm/machines/:id` (name) and (`isActive:false`), `DELETE /atm/ref-labels/area/:id` | **403** each |
| 2 | Operations → `POST /atm/ref-labels/bank` (`NBE FOREX`), `PATCH …/:id` rename + `isActive:false` | 201 / 200 |
| 3 | Operations → `PATCH /atm/machines/:id/area` | 200, open entry area synced |
| 4 | a role without moveArea/manage → `/:id/area` | 403; Tanta Operations on an Alex machine → 404 (scope) |
| 5 | manage holder → every route above | still 2xx (regression) |
| 6 | nav correction: insert application `/atm/data-edit` with `permissionKey 'atmMachine.manage'` → `syncNavigationCatalog()` | key `atmRefLabel.create`; a row an admin set to another key is untouched |
| 7 | ~~role widening~~ — **dropped by O-1** (no widening exists, so nothing is asserted about roles gaining keys) | — |
| 8 | ~~delegated widening~~ — **dropped by O-1** | — |
| 9 | ref-label create branch check (§7.1): an Operations user holding `atmRefLabel.create` at branch scope in Alex plus an unrelated key reaching Tanta, top-bar header naming Tanta → `POST /atm/ref-labels/bank` | **403**; without the header (home Alex) → 201 in Alex |
| 10 | department-scoped `atmMachine.moveArea` / `atmRefLabel.edit` on an Alex machine / label from a Tanta department | 404 each; a branch-scoped Alex holder → 200 |

`apps/api/tests/integration/atm-register-import.spec.ts` (WP-B). Workbook built in-test with
ExcelJS: sheet `ATMs`, row 1 = the 49 exact headers (numbers for AB/AC/AD, duplicates), row 2
empty, ~30 synthetic rows covering every issue code (fake codes like `99990001`, fake
combinations), an `END` row, optional trailing junk rows; a helper
`tests/integration/helpers/atm-register-workbook.ts` builds it.

| # | Scenario | Expect |
|---|---|---|
| 1 | preview | counts by status; issue codes per row; 57 report cells with `allMatch:false` (synthetic) and blocker `reportMismatch`; **no response JSON contains any fake combination or key value** |
| 2 | header renamed | 422 `ATM_REGISTER_IMPORT_LAYOUT` naming the column |
| 3 | unmapped `EGYCASH-n` / branch outside the importer's reach | blockers `branchUnmapped` / `branchOutOfReach`; apply 422 |
| 4 | apply without override | 422 `ATM_REGISTER_IMPORT_BLOCKED`; with `reportOverride` → entries written, run `completed`, one `atmRegisterImport` audit |
| 5 | apply requires viewSecrets | 403 for an importer without it |
| 6 | categories individually: apply `entries` only → no master change; then `link` only; then `create` | each pass changes only its category; `notApproved` outcomes recorded |
| 7 | **idempotency**: re-apply the same file | `alreadyImported` = all, no duplicate entries (`ux_import_row`), no master change |
| 8 | fileSha256 mismatch | 409 `ATM_REGISTER_IMPORT_FILE_CHANGED` |
| 9 | nbeForex: branch with an active `NBE FOREX` label → created master `bankName 'NBE FOREX'`; branch without → `labelMissing`, default label | |
| 10 | duplicate-open pair | both entries `openPeriodExempt:true`, one master, both linked |
| 11 | AO sealed: stored `safeCombination` is a SecretRef; reveal returns the `NN - NN - NN` text | |
| 12 | 403 without `atmRegister.import`; `GET /runs` lists the run without `rows` | |
| 13 | **no temp files**: fixture with a secret-bearing sheet BEFORE `sharedStrings.xml` (the ExcelJS writer's own order); snapshot `os.tmpdir()` before and after preview and apply | no new file |
| 14 | **branch scope of coupling** (review finding F-3): an org-wide import leaves an Alex open row uncoupled (`create` not approved); a Tanta-scoped importer (with Tanta viewSecrets) applies a Tanta-only file with `create` | Tanta rows coupled; the Alex entry still `machineId:null`; no master written in Alex; the preview lists no Alex master |
| 15 | `secretsOutOfReach`: Tanta-scoped viewSecrets, org-wide import, file with key values in Alex rows / in a no-branch row | blocker; apply 422 |
| 16 | `openInRegister`: a manual receipt of code X, then a file with X open | preview blocker + item (entry id); apply 422; nothing written |
| 17 | `changedSinceImport`: apply file 1; change AR of one ended row and AT of another in file 2 (same rows) | preview blocker listing the two rows with `AR` / `AT`; no value in the response |
| 18 | `dateUnreadable`: a text AR on an otherwise ended row | blocker; issue `dateInvalid` on that row |
| 19 | `noName`: an ENDED row and an OPEN row with blank E | entries written with `name:null` + `noName`; the open one is `cannotCouple` reason `noName` and `unlinked` |
| 20 | `activeElsewhere`: a master active in Tanta, the file has the code open in Alex | report category with one pair Tanta → Alex; apply writes the entry `unlinked`; outcome `cannotCouple:activeElsewhere` |

---

## 11. Work packages and file ownership

**Rule: no file is edited by two packages.** A "stub → X" file is CREATED by WP-A (so routes,
manifest and the census compile) and from WP-A's merge on is owned exclusively by package X;
WP-A never touches it again. Stubs never ship: all packages merge into the feature branch and
release together (the routes owner rule, `apps/web/src/modules/atm/routes.tsx:4-5`).

```
WP-A.1 (contracts + web wiring) ──► WP-C, WP-D, WP-E can start (UI against types + mocked tests)
WP-A.2 (API core)               ──► WP-B can start; integration of C/D/E against the real API
WP-A = A.1 + A.2 (one engineer or two, disjoint files below); B, C, D, E run in parallel after A.
```

### WP-A — contracts, API core, shared wiring (FIRST)

| Milestone | Files (NEW unless MOD) |
|---|---|
| A.1 contracts | `packages/contracts/src/modules/atm-register.ts`, `packages/contracts/src/modules/atm-register.spec.ts`, MOD `packages/contracts/src/modules/atm.ts`, MOD `packages/contracts/src/index.ts`, MOD `packages/contracts/src/platform/audit.ts`, MOD `packages/contracts/src/platform/realtime.ts`, MOD `packages/contracts/src/errors/index.ts` |
| A.1 web wiring | MOD `apps/web/src/platform/localization/i18n.ts` (ALL §9 keys), MOD `apps/web/src/platform/router/RequirePermission.tsx`, MOD `apps/web/src/platform/realtime/invalidation-registry.ts`, MOD `apps/web/src/modules/atm/routes.tsx`, MOD `apps/web/src/modules/atm/pages/AtmOverviewPage.tsx`, MOD `apps/web/src/modules/atm/api/atm-api.ts`, MOD `apps/web/src/modules/atm/api/atm-queries.ts`, `apps/web/src/modules/atm/api/register-api.ts`, `apps/web/src/modules/atm/api/register-queries.ts`, `apps/web/src/modules/atm/lib/register-labels.ts`, `apps/web/src/modules/atm/atm-register-i18n.spec.ts`, MOD `apps/web/src/shared/lib/remembered-filters-coverage.spec.ts`, stub → C `apps/web/src/modules/atm/pages/RegisterPage.tsx`, stub → D `apps/web/src/modules/atm/pages/RegisterReportPage.tsx`, stub → B `apps/web/src/modules/atm/pages/RegisterImportPage.tsx` |
| A.2 API | MOD `apps/api/src/modules/atm/atm.module.ts`, MOD `atm.module.spec.ts`, MOD `atm.seed.ts`, MOD `atm.settings.ts`, MOD `atm.mappers.ts`, `atm.mappers.spec.ts`, `atm-indexes.ts`, MOD `machines/machine.routes.ts`, MOD `machines/machine.controller.ts`, MOD `machines/machine.service.ts`, `machines/machine.migration.ts`, MOD `catalogs/ref-label.routes.ts`, MOD `catalogs/ref-label.service.ts`, `register/register.model.ts`, `register/register.repository.ts` (+`.spec.ts`), `register/register-settings.ts`, `register/register-secrets.ts` (+`.spec.ts`), `register/register-coupling.ts`, `register/register.mapper.ts` (+`.spec.ts`), `register/register.service.ts`, `register/register.controller.ts`, `register/register.routes.ts`, `register/register-export.ts`, `register/register-report.service.ts` (+`.spec.ts`), `register/import/register-import-run.model.ts`, stub → B `register/import/register-import.routes.ts` (router whose `POST /` and `GET /runs` answer 422 "not built yet" behind `authorize('atmRegister.import')`) — all under `apps/api/src/modules/atm/`; MOD `apps/api/src/platform/rbac/rbac.service.ts`, MOD `apps/api/src/platform/rbac/rbac.repository.ts`, MOD `apps/api/src/platform/rbac/delegation.repository.ts`, MOD `apps/api/src/platform/realtime/realtime-registry.ts`, MOD `apps/api/src/infrastructure/logging/logger.ts`, NEW `apps/api/src/infrastructure/logging/logger.spec.ts`, MOD `apps/api/src/infrastructure/observability/sentry.ts`, NEW `apps/api/src/infrastructure/observability/sentry.spec.ts`, MOD `apps/api/src/seed-navigation.ts`, MOD `apps/api/src/seed-navigation.spec.ts`, MOD `apps/api/tests/integration/auth-seed-login.spec.ts`, `apps/api/tests/integration/atm-register.spec.ts`, `apps/api/tests/integration/atm-data-edit-permissions.spec.ts` |
| A docs | MOD `docs/12-planning/atm-operations-port.md`, `docs/03-decisions/ADR-034-audited-reveal-of-a-sealed-value.md`, MOD `docs/03-decisions/README.md`, MOD `docs/02-architecture/platform-crypto.md` ("Key ring and rotation": the ATM register combinations are rewrapped by `atm.rotateRegisterCombinationKeys` — DEC-33) |

Stub shapes (so the census and the build pass): `RegisterPage.tsx` declares exactly
`const REMEMBERED_FILTERS = ['branch','bank','status','area','q','issues','sort','size'] as const;`,
calls `useRememberedFilters([sp, setSp], REMEMBERED_FILTERS)` and renders `PageContainer`+`PageHeader`
only; `RegisterReportPage.tsx`/`RegisterImportPage.tsx` render `PageContainer`+`PageHeader` only.

Interfaces WP-A guarantees to B: `coupleReceipt`, `linkUncoupled`, `syncEntryToMaster`, `PendingAudit`,
`ensureMachineVersioned` (register-coupling); `sealCombination(entryId, plaintext)`,
`combinationContext(id)`, `keyCoversEntry`, `secretsVisibleFor` (register-secrets);
`atmRegisterEntryRepository` (incl. `findOpenByCode(s)`), `registerScopeMatch`, `AtmRegisterEntryModel`,
`AtmRegisterImportRunModel`, `importAuditRef`; `resolveRegisterSettings()`; `snapshot` exported from
machine.service. To C/D/E: every hook of §8.2 and `lib/register-labels.ts`.

Acceptance: §10.1 rows all green — `realtime-registry.spec.ts` included, on WP-A's own merge
(both literal pairs are A's, §5.10); §10.3 `atm-register.spec.ts` and `atm-data-edit-permissions.spec.ts`
green; `atm.spec.ts` unchanged and green; every route of §5.7/§7.1 answers with the stated gate AND
the branch-reach rule of DEC-29 (tests 25–28, data-edit 9–10); no DTO/log/audit/CSV/Sentry/HTTP-cache
path can carry a K/S value (tests 13–19, 29; `sentry.spec.ts`; `logger.spec.ts`); every `logger.*(`
call under `apps/api/src/modules/atm/register` (checked with `rg -n "logger\.(info|warn|error|debug)\(" apps/api/src/modules/atm/register`)
logs only ids, counts, codes and column letters; `npm run check:page-registry` OK.
Commands: `npm run build -w packages/contracts && (cd packages/contracts && npx vitest run src/modules/atm-register.spec.ts)`;
`cd apps/api && npx vitest run src/modules/atm src/seed-navigation.spec.ts src/platform/realtime src/platform/settings src/platform/rbac src/infrastructure`;
`cd apps/api && MONGOMS_SYSTEM_BINARY=/opt/mongod/mongod npx vitest run tests/integration/atm-register.spec.ts tests/integration/atm-data-edit-permissions.spec.ts tests/integration/atm.spec.ts tests/integration/auth-seed-login.spec.ts tests/integration/legacy-upgrade.spec.ts`;
`cd apps/web && npx vitest run src/modules/atm src/shared/lib/remembered-filters-coverage.spec.ts src/platform/realtime src/platform/localization src/modules/system-admin`;
`npm run typecheck && npm run lint && npm run check:page-registry && npm run check:permission-matrix`.

### WP-B — import pipeline (API + page) — after A.2

| Area | Files (all NEW unless stated) |
|---|---|
| API `apps/api/src/modules/atm/register/import/` | `register-import.routes.ts` (from stub), `register-import.controller.ts`, `register-import.service.ts`, `read-register-workbook.ts` (+spec), `register-columns.ts` (+spec), `cell-convert.ts` (+spec), `parse-rows.ts` (+spec), `plan-import.ts` (+spec), `report-check.ts` (+spec), `expected-data-report.ts`, `apply-import.ts` |
| API dependency | **DONE by the lead before WP-A (`jszip ^3.10.2` in `apps/api/package.json` + lockfile) — WP-B must NOT run npm install.** MOD `apps/api/tsup.config.ts` (`external: ['exceljs', 'jszip']`, comment extended) — §6.2 |
| API tests | `apps/api/tests/integration/atm-register-import.spec.ts`, `apps/api/tests/integration/helpers/atm-register-workbook.ts` |
| Web | `apps/web/src/modules/atm/pages/RegisterImportPage.tsx` (from stub; stays a thin shell), `components/register-import/RegisterSettingsCard.tsx`, `ImportUploadPanel.tsx`, `ImportPreviewPanel.tsx`, `ReportCheckTable.tsx`, `ImportCategoryCard.tsx`, `ImportIssuesList.tsx`, `ImportRunsCard.tsx`, `lib/register-import-view.ts`, `register-import-view.spec.ts` (paths under `apps/web/src/modules/atm/`) |

Acceptance: §6 end to end; §10.3 import suite green; streaming reader never loads the whole sheet
(`await import('exceljs')` only, `WorkbookReader` fed the reduced in-memory zip — never the upload);
nothing written to `os.tmpdir()` (import test 13); preview and errors contain no J..Q/AN/AO/AU
value (asserted on the raw response text); no `logger.*(` call under `register/import` receives a
`ParsedRow`, a row's values or an entry (same `rg` check as WP-A); idempotent re-apply of an
unchanged file; categories applied one by one, coupling restricted to the file's in-reach branches;
`runtime-import-safety.spec.ts` green; `npm run build -w apps/api` bundles with `jszip` external. Commands: `cd apps/api && npx vitest run src/modules/atm/register/import src/runtime-import-safety.spec.ts`;
`MONGOMS_SYSTEM_BINARY=/opt/mongod/mongod npx vitest run tests/integration/atm-register-import.spec.ts`;
`cd apps/web && npx vitest run src/modules/atm`; `npm run typecheck && npm run lint`.

### WP-C — register page UI — after A.1

| Files (NEW, under `apps/web/src/modules/atm/`) |
|---|
| `pages/RegisterPage.tsx` (from stub), `components/register/RegisterGrid.tsx`, `RegisterFilters.tsx`, `RegisterRowActions.tsx`, `EntryFormSections.tsx`, `ReceiveEntryDialog.tsx`, `EditEntryDialog.tsx`, `ReceivePendingDialog.tsx`, `HandoverDialog.tsx`, `LinkEntryDialog.tsx`, `DeleteEntryDialog.tsx`, `RevealCombinationDialog.tsx`, `IssueBadge.tsx`, `lib/register-grid.ts`, `lib/register-grid.spec.ts`, `register-page.spec.tsx` |

Acceptance: §8.3 (frozen 5 columns + grouped sticky header, RTL, ended token, secrets masked,
reveal 30 s with `reset()`, actions per permission incl. Link for unlinked rows, handover pre-fill,
title-only header, server paging through all rows, remembered filters exactly the declared list);
census and no-subtitle specs still green without editing them. Commands: `cd apps/web && npx vitest run src/modules/atm src/shared/lib/remembered-filters-coverage.spec.ts`; `npm run typecheck && npm run lint`.

### WP-D — Data Report page UI — after A.1

| Files (NEW, under `apps/web/src/modules/atm/`) |
|---|
| `pages/RegisterReportPage.tsx` (from stub; thin shell), `components/register-report/ReportSection.tsx`, `BarChart.tsx`, `GroupedBarChart.tsx`, `ReportTable.tsx`, `AsOfStamp.tsx`, `lib/register-report-view.ts`, `lib/register-report-view.spec.ts`, `register-report-page.spec.tsx` |

Acceptance: §8.5 (three sections, Excel orders laid out left-to-right as in the sheet, labels with
the D7 fixes and the provisional DEC-28, total bars, zeros, as-of stamp, `#4472C4` for charts 1–2,
owner colours + labels + legend + tables for chart 3, scope-limited branches).
Commands: as WP-C.

### WP-E — data-edit Operations changes (web) — after A.1

| Files (MOD unless NEW) |
|---|
| `apps/web/src/modules/atm/pages/DataEditPage.tsx`, `apps/web/src/modules/atm/components/DataEditDialogs.tsx`, NEW `apps/web/src/modules/atm/data-edit-gating.spec.tsx` |

Acceptance: §8.4 table; delete/bulk/add-machine/archive visible only to `manage`; Operations see
add/edit labels and the area move; the census entry for `DataEditPage.tsx` still holds. Server
enforcement is WP-A's (tests in `atm-data-edit-permissions.spec.ts`). Commands: as WP-C.

---

## 12. Rollout and cut-over

### 12.1 Deploy (automatic at boot)
1. `seedAtm`: super-admin grants; ATM indexes built (DEC-26); legacy timestamps backfilled
   (DEC-23). **No role or delegated grant is widened** (O-1). Since revision 4 it then seeds the
   bank catalog with the six (DEC-35), gives the Operations bank spellings their `bankCode`, and
   lists every area of an active machine or an open or pending entry as a data-edit label of its
   branch (DEC-38) — §5.12. Every step is idempotent; a second boot writes nothing.
2. `syncNavigationCatalog`: two new rows; `/atm/data-edit` key corrected to `atmRefLabel.create`.
   From this boot on, a role or ADR-032 delegated grant holding only `atmMachine.manage` no longer
   shows the Machine Data sidebar row or the ATM overview card (both now need `atmRefLabel.create`);
   its holders still open `/atm/data-edit` by URL (any-of route guard) until §12.2 step 4 is done.
3. The scheduler picks up `atm.rotateRegisterCombinationKeys` (nightly 02:45, DEC-33). An operator
   rotating `PLATFORM_ENCRYPTION_KEYS` follows `docs/02-architecture/platform-crypto.md`; the old key
   may be dropped only after BOTH nightly sweeps (automation and ATM) report 0 left on it.

### 12.2 Administrator, before cut-over
1. Import page → Register settings: map `EGYCASH-1..7` to the ECMS branches (EG-18 — confirm
   EGYCASH-7 وصال); review the Operations bank labels (BM → MISR by default). Since revision 4 a
   bank's Operations label is its catalog `opsLabel`, reviewed on the register's «البنوك» dialog; a
   label stored in the retired setting was carried into the catalog at the first boot (DEC-35).
2. Operations (data-edit) add an `NBE FOREX` bank label in the branches whose FX machines should
   carry it (DEC-16). Since revision 4 that is a spelling on the «أسماء البنوك في التشغيل» tab,
   linked to NBE. The tab's callout lists the bank texts the branch's machines carry that map to no
   bank; map them there too, or the machines added with them are not recorded in the register
   (`noBank`, DEC-36).
3. Roles (§12.3). Grant the Operations role(s) `atmRefLabel.create`, `atmRefLabel.edit` and
   `atmMachine.moveArea`, then remove `atmMachine.manage` from them — until then they keep add,
   archive and delete (risk R-2).
4. **Every** role and every live ADR-032 delegated grant that holds `atmMachine.manage` (the ATM
   administrator's included, and any given it later) must also be granted `atmRefLabel.create`
   (plus `atmRefLabel.edit` and `atmMachine.moveArea` where wanted), or its holders lose the
   Machine Data sidebar row and the ATM overview card at the first boot — nothing grants these keys
   automatically (lead override O-1; review finding F2).
5. Owner questions to settle before the cut-over preview (they change what the preview shows,
   not the code): EG-19 (production masters vs the seven codes — how `activeElsewhere` rows are
   resolved), EG-20 (time cells ≥ 1 day), EG-21 (total label spelling).
6. No manual Receive of a machine that the frozen copy has OPEN between deploy and cut-over: it
   would raise the `openInRegister` blocker (DEC-31) until handed over or deleted. Since revision 4
   the same holds for a machine Operations ADD on data-edit: its intake entry is open (DEC-36), so
   a workbook row open for that code blocks the apply until Efficiency hand the entry over or
   delete it — and deleting it archives the machine (D2). The import does not adopt intake entries
   (R-15).
7. **Revision 4 (EG-11):** grant `atmBank.create` / `atmBank.edit` at ORGANIZATION scope to whoever
   curates the bank catalog — Efficiency & Investigations or the ATM administrator (§12.3). A
   branch-scoped grant is refused by the service (DEC-39).

### 12.3 Recommended role bundles (documented, not seeded — EG-11)

| Bundle | Keys | Scope |
|---|---|---|
| Efficiency & Investigations | `atmRegister.view/create/edit/delete/export/handover/viewSecrets`, `atmRegisterReport.view`, `atmMachine.view`; since revision 4 also `atmBank.create`, `atmBank.edit`, and optionally `atmRefLabel.edit` to correct area translations on data-edit | organization for a central team; branch for per-branch staff. Department, section or own scope gives READ access within the branch only — no write, no reveal, no keys (DEC-29). `atmBank.*` at **organization scope only** (DEC-39) |
| Register import (cut-over admin) | the above + `atmRegister.import` | organization |
| Data Report reader | `atmRegisterReport.view` | organization or branch |
| Operations — machine data | `atmMachine.view`, `atmRefLabel.create`, `atmRefLabel.edit`, `atmMachine.moveArea` | branch |
| ATM administrator | everything incl. `atmMachine.manage` and `atmBank.*` | organization |

**Rollout note (EG-11, revision 4).** After the deploy nobody but super-admin holds
`atmBank.create` / `atmBank.edit`: the boot gives super-admin every ATM key and widens no other role
(O-1). Until an administrator grants them (§12.2 step 7), nobody else can add, edit or archive a
bank. The register's «البنوك» button and the import card's «إدارة البنوك» stay hidden, and
data-edit's «البنوك» tab is read-only. Efficiency add areas from the register with the register
keys they already hold (DEC-39). Operations keep `atmRefLabel.*` for spellings and areas: the
"Operations — machine data" bundle is unchanged.

### 12.4 Cut-over day
1. The owner freezes the Excel (no more edits) and takes a fresh copy.
2. Preview. Expect `reportMismatch` (receipts after 2026-09-29): compare the "from this file"
   column with the copy's own Data Report sheet by eye, then override. Any other blocker
   (`dateUnreadable`, `openInRegister`, `changedSinceImport`, `secretsOutOfReach`, branch blockers)
   is resolved first and the copy previewed again — no override exists for them.
3. Approve and apply in passes: `entries` → `link` → `reactivate` → `create` (+ `nbeForex`).
   Review `cannotCouple` — open rows without an area that found no active master in their branch
   (`blankArea`, a subset of the 297 open rows without an area: the rest LINK), `noName`, `noBank`,
   `noCode`, `placeholderCode`; they stay in the register `unlinked` and get their Operations machine
   when Efficiency enters the area (edit) or uses "Link to the Operations list" (DEC-30) — and
   `activeElsewhere` (resolution per the owner's EG-19 answer, then Link), and
   `activeMasterWithoutOpenEntry` (decide in data-edit).
4. Check the Data Report page against the copy's Data Report; archive the Excel read-only. From
   here the register is the source of truth: the import page stays for reference, and a later
   preview of the frozen copy reports every register-side change as `changedSinceImport` — which
   is correct, and is why it is not re-applied.

## 13. Risks

| # | Risk | Mitigation in this spec |
|---|---|---|
| R-1 | Secret concentration: one combination value is shared by 1,719 machines (50.5%); key codes also sit in count columns and notes; the workbook and its `Sheet1` VLOOKUPs keep existing outside ECMS. | Sealing, per-entry visibility, write-implies-read, redaction in audit/logs/exports, audited reveal. Recommend changing the shared default combination at the banks and retiring the workbook (owner). |
| R-2 | Existing roles holding `atmMachine.manage` keep add/delete until an administrator removes it; and, with no widening (O-1), a manage-only role or delegation loses the Machine Data sidebar row and overview card until it is granted `atmRefLabel.create`. | Rollout steps 12.2.3 and 12.2.4: the administrator grants the Operations keys and then removes `manage`. |
| R-3 | A future end date (mobile ATMs) archives the master immediately; a future start date activates it before the receipt (EG-10). | Warnings `futureDate`; owner rule pending. |
| R-4 | Pending mail tickets for archived machines can still be accepted (EG-17). | Pre-existing; flagged. |
| R-5 | `/atm/machines` shows at most 100 rows (EG-16); after cut-over every branch exceeds it. | Flagged; out of scope. |
| R-6 | DEC-6 makes gold receiving/delivery and IT part receipts broadcast refetch signals too. | Signals carry no data and reach only view-permission rooms (ADR-029); the topics are already registered. |
| R-7 | Changing the branch-code mapping after cut-over moves entries in/out of report sections. | `activeWithUnmappedBranch` notice; mapping is admin-only and audited (`settingChanged`). |
| R-8 | Other ATM collections written by `npm run atm:import` (replenishments, maintenances, mail tickets) also lack `createdAt/__v`. | Out of scope; the same backfill pattern applies when needed. |
| R-9 | Indexes on legacy `atm_machines` may not build if duplicates exist (`ux_branch_code`). | Reported, never resolved (DEC-26); service checks still hold. |
| R-10 | The `ATMs` sheet layout changes before cut-over (a column inserted). | Exact header binding refuses with the missing column named (§6.2). |
| R-11 | Error tracking (Sentry) attaches request bodies to error events by default, which would carry combinations and key codes off the server. | DEC-34: bodies of register routes are never captured, K/S names scrubbed in `beforeSend`, unit-tested. Other modules' bodies are outside this spec (flagged). |
| R-12 | Production masters were loaded per legacy deployment (4) while the register has 7 codes; many open rows may land in `activeElsewhere` (EG-19). | Shown as its own category with from → to counts before anything is applied; the owner decides; `Link` (DEC-30) completes each row afterwards. |
| R-13 | A crafted upload exhausts memory or CPU. | 20 MB upload cap, per-entry inflate caps, row and time caps, only five zip entries ever inflated (§6.2). Every scan of an inflated part is linear (the workbook/rels tags and attributes are walked by hand — a backtracking `<sheet\b[^>]*>` over a 2 MB part of unclosed tags held the event loop for minutes, review finding SEC-2) and the deadline is re-checked between the steps no chunk counter sees; the parse phase is linear too (capped detail lists, a hand-scanned trailing-digit check — SEC-3). |
| R-14 | Revision 4: the Data Report and the settlements change from the first data-edit add. Every add in a mapped branch whose bank text resolves records an OPEN entry, so the report's numbers rise and the machine gets a settlement bank (DEC-36). | The owner's call. The import's 57-number check is pinned to the six by a spec (DEC-40), the CHANGELOG says so, and the «بيانات ناقصة» badge and filter show Efficiency exactly which rows to complete (DEC-37). |
| R-15 | Revision 4: an intake entry made before the cut-over is an `openInRegister` blocker (DEC-31), like a manual receipt. The import does not adopt intake entries, because whether a run has already been applied in production is unknown (EG-19). | §12.2 step 6: Efficiency complete or delete them before the preview. |
| R-16 | Revision 4: deleting an intake entry archives its machine (D2), which takes it out of Operations' open forms and the mail matcher. | The delete dialog says so on `source: 'operations'` rows (§8.7). |
| R-17 | Revision 4: data-edit's add behaves differently. An archived code is reactivated instead of refused; a code active or open in another branch is refused (DEC-41); `manage` must reach the acting branch (DEC-39). | Each outcome is said in words on the dialog (§8.7); `atm.spec.ts` pins the new answers. Existing cross-branch duplicates are left alone (R-9). In an unmapped branch two concurrent adds of one code can still race on the machine, exactly as before. |
| R-18 | Revision 4: automatic area labels add clutter — EG-6 counts 118 raw values, case and script variants included. | Nothing is merged; the origin badge shows where a label came from; Operations archive rather than delete; a name that was deleted, archived or renamed is never brought back (DEC-38). |
| R-19 | Revision 4: a rollback after the first non-seed bank exists breaks older code on that bank's code, and nobody but super-admin holds `atmBank.*` after the deploy. | Roll forward past that point (§5.12 "Rollback"); grant the bank keys at organization scope (§12.2 step 7, §12.3 rollout note). |

---

## Appendix A. Review log (revision 2)

Each finding of the independent review was re-verified against the code and the workbook before
it was applied (scripts outside the workbook's directory, `python3 -I`, counts only — no value of
AO or J..Q printed). F-n = the order the findings were received in.

| # | Lens · severity | Finding | Disposition |
|---|---|---|---|
| F-1 | security · blocker | Department/section/own grants widen the branch-only register repository → IDOR on reveal/writes | **Accepted** — verified (`base.repository.ts:143-154` passes no options; `org-scope-match.ts:79-85` returns `{}`). Fixed by narrowing, not by refusing scopes: DEC-29, §5.2 `registerScopeMatch` override, `keyCoversEntry` on every write and the reveal, same reach rule on `moveArea`/ref-label (§7.1); tests 25–28, data-edit 10. |
| F-2 | security · major | Sentry captures request bodies (combinations, key codes) on error events | **Accepted** — verified (`@sentry/node` 10.75 `maxIncomingRequestBodySize` default `'medium'`; `sentry.ts` has no scrubbing). DEC-34, §5.4 "Error tracking", `sentry.spec.ts`, R-11. |
| F-3 | security · major | Import couples/relabels other branches' entries; per-branch viewSecrets not checked; preview shows out-of-reach master data | **Accepted** — §6.4 reach rule (no-branch rows need organization scope), blocker `secretsOutOfReach`, items only for in-reach branches; §6.6 step 5 limited to this file's in-reach branches; import tests 14–15. |
| F-4 | security · major | Ref-label create files under any branch of the caller's UNION reach | **Accepted** — verified (`currentBranchId`, `shared/types/index.ts:295-303`). §7.1 key-reach assertion; data-edit test 9. |
| F-5 | security · major | `ix_combination_keyId` labelled "rotation sweep" but no sweep exists | **Accepted** — DEC-33, §5.4 "Key rotation", manifest task (§7.2), test 32, `platform-crypto.md` line, §12.1 step 3. |
| F-6 | security · minor | Uneven pino depths; `plaintextCombination` not redacted | **Accepted** — 15 paths (five names × root/1/2 levels, verified with pino), "never log a ParsedRow/entry/body" rule with an `rg` acceptance check, `logger.spec.ts`. |
| F-7 | security · minor | Reveal value kept in MutationCache; K values in HTTP/query caches | **Accepted** — DEC-18: `gcTime: 0` + `reset()` on the reveal; `gcTime: 0` register queries for viewSecrets holders; `Cache-Control: private, no-store` on every `/entries*` response; test 29. |
| F-8 | security · minor | Only the compressed size is bounded | **Accepted, fix adapted** — per-entry inflate caps enforced on the actual inflated bytes (stronger than trusting central-directory sizes), only five entries ever inflated (other sheets are never read, so "stop draining" is moot), row and time caps (§6.2 steps 2 and 5), injectable for tests; R-13. |
| F-9 | security · minor | 409 names another branch to a caller without view there | **Accepted** — named only when `atmRegister.view` reaches it (DEC-9, §5.5 step 1, §5.6 create (7)); test 28. |
| F-10 | faithfulness · major | Uncoupled imported open entries can never be coupled; no UI state | **Accepted** — DEC-30: auto-link when an edit sets the area, `POST /entries/:id/link`, `masterState:'unlinked'`, code editable while unlinked, warning `codeActiveElsewhere`; §12.4 count corrected (only rows with no active master are `blankArea`); test 30. |
| F-11 | faithfulness · major | activeElsewhere unknown not recorded; settled by a designer refusal | **Accepted** — verified 4 legacy deployments (HQ/Alex/Tanta/Port Said) vs 7 codes. EG-19, own report category with from→to `pairs`, R-12. The resolution is left to the owner: no designer "move" category is invented. |
| F-12 | faithfulness · major | legacyMarks drops fills not on A/B; header fills stored nowhere | **Accepted** — re-verified (yellow 27 rows, pink 6, red 5, mint 2 not on A). `legacyMarks.cellFills`, run `headerFills` (EG-2, §5.1, §6.1, §6.2); parse-rows spec. |
| F-13 | faithfulness · minor | Unreadable AQ/AR silently becomes null → wrong status vs CI | **Accepted** — DEC-31 blocker `dateUnreadable` (whitespace-only included); import test 18. Snapshot has none (re-verified). |
| F-14 | faithfulness · minor | DEC-28 settles an owner-rule conflict by itself | **Accepted** — EG-21 records the mapping «اجمالى» → «إجمالي»; DEC-28 marked provisional pending the owner. |
| F-15 | faithfulness · minor | RTL mirroring and chart 1–2 recolour depart from the Excel | **Accepted** — verified (no `rightToLeft`; `catAx` `minMax`; series fill = theme `accent1` `#4472C4`). DEC-19: charts and tables `dir="ltr"`, `ATM_REPORT_TOTALS_COLOR`. |
| F-16 | faithfulness · minor | 1.0 → `24:00` is an unrecorded interpretation | **Accepted** — re-verified (AK 19 + AL 53 equal 1.0; AK 5 + AL 1 > 1 day). Now stored as Excel shows it (`00:00`, `18:00`) with the day count kept in the `timeOverDay` detail; EG-20 asks the owner. |
| F-17 | faithfulness · minor | Idempotency by `importRow` alone silently skips changed rows | **Accepted** — DEC-31 blocker `changedSinceImport` listing rows and column LETTERS (AO not compared — it would mean opening every sealed value); unchanged re-apply stays idempotent; import test 17. |
| F-18 | faithfulness · minor | Handover wipes imported AT/AU on open rows | **Accepted** — re-verified (8 open rows with AT, 7 with AU). Absent field = keep (§3.7, §5.6), dialog pre-fills (§8.3); test 31. |
| F-19 | faithfulness · minor | Notes redaction lacks depth-2 paths | **Accepted** — same fix as F-6. |
| F-20 | feasibility · blocker | ExcelJS `WorkbookReader` writes earlier worksheets (incl. `Sheet1` with AO/J) to temp files | **Accepted** — verified in the library (`workbook-reader.js:107-129, 140-148`) and by a probe (2 temp files left after `break`; 0 with the reduced zip). §6.2 rewritten: JSZip in memory, five entries, re-zipped in the order the reader needs; jszip dependency (WP-B); tmp-dir assertions in unit and integration tests. |
| F-21 | feasibility · major | An open row whose code is already open in the register aborts its batch forever | **Accepted** — DEC-31 blocker `openInRegister` (in-file pairs excluded) + an in-transaction race guard that skips with outcome `openInRegister`; import test 16. |
| F-22 | feasibility · major | `atm.registerImport` exclusion fails WP-A's realtime spec until WP-B merges | **Accepted** — verified (`realtime-registry.spec.ts:90-94`). `importAuditRef` with the literal pair lives in the WP-A run model; WP-B calls it (§5.10, §6.6). |
| F-23 | feasibility · minor | One-time widening misses ADR-032 delegated grants and later grants | **Superseded by O-1** — there is no widening at all; every role and delegated grant holding `manage` is an administrator step (§12.2 step 4, review finding F2). |
| F-24 | feasibility · minor | PageHeader has no subtitle (guard spec) | **Accepted** — verified (`page-header-has-no-subtitle.spec.ts`). Subtitle removed; `atm.register.subtitle` dropped; import text moved to `atm.registerImport.intro`, upload-card body. |
| F-25 | feasibility · minor | §9.4 lacks keys WP-B's tables need | **Accepted** — every visible string of §8.3–§8.6 listed (runs/branches/items/pairs/report-check columns, outcomes, new categories, blockers, hints, settings columns) and the WP-A follow-up rule stated in §9. |
| F-26 | feasibility · minor | No rewrap job for sealed combinations | **Accepted** — duplicate of F-5. |
| F-27 | feasibility · minor | Ref-label create trusts the union reach | **Accepted** — duplicate of F-4. |
| F-28 | feasibility · minor | Required `name` aborts an import batch on a blank | **Accepted, fix adapted** — instead of a blocker, D6 ("imported rows keep their blanks") is applied: `name` nullable on entries, issue `noName`, coupling reason `noName`, manual writes still require a name (DEC-32); cell-convert spec, import test 19. |
| F-29 | feasibility · minor | Report `branchesShown` disagrees with the match for department reach and own | **Accepted** — verified against `org-scope-match.ts:87-106`. `registerScopeBranches` derived from the same selector (DEC-27, §5.2, §5.8); repository and report specs, test 27. |
