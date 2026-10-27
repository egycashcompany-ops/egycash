# ATM Settlements & Review → Preparation → Control & Supplies, phase 1 (Al Baraka pilot): implementation spec

**Status:** implementation spec, revision 2. Revision 2 applies the verified findings of three
reviews (security, money, paper fidelity); the Review log at the end lists each finding and what was
done with it. The owner's decisions S-1…S-10 are final (approved 2026-10-26: «كل شوال بيشيل ٤
كاسيتات · موافق على مقترحاتك الله ينور عليك فهمت الدنيا · ممكن تبدأ كدا توريلى الشغل»). **Target:**
ECMS module `atm`. This manifest grows; no second manifest is added
(`apps/api/src/modules/atm/atm.module.ts:7-9` names "back office, vaults, supplies, review,
preparation" as the slices still to come).
**Mockups:** seven boards were drawn for the owner (local sources in the session scratchpad,
`taswiat-canvas/project/{Main,Layouts,Note,Receipt,Handover,Prep,Control}.dc.html`). They are not
an approval. Where a mockup rearranged a paper, this spec follows the paper (§8.7 lists the
differences).

Two implementers follow this document literally: **WP-S1** (contracts + API) first, then **WP-S2**
(web). Every claim about existing code cites `file:line` on branch
`claude/atm-operations-ecms-442l5r` (HEAD `4d820f3b`). **No value from the owner's workbooks appears
here.** Machine IDs, amounts, seal/QR numbers and names are never quoted; the figures below are
counts, labels, headers and denominations from the research only.

> **Governing rules (every work package).**
> - «لا تعتمد على إدخال branchId من الـfrontend كحقيقة أمنية». The server scopes every read. A
>   branch sent by the browser may only NARROW a read inside the caller's reach, and every write
>   checks that the key reaches the record's branch.
> - «لا "تحسينات" behavior من عندك. لا حذف لأي legacy feature. لا اختراع بيانات غير موجودة. لا
>   تخمين؛ سجّل GAP صراحة.» What the paper does today is carried; only the improvements the owner
>   accepted are added (§2.1). An open question is a GAP in §11.1, not a guess.
> - **Privacy.** The workbooks are live financial records. Tests, fixtures, logs and this document
>   use invented codes (`BRKN9001` …) and invented names. No workbook, and no extract of its
>   values, is committed. The Al Baraka logo is part of the workbook and is not committed either
>   (DS-18).
> - UI strings are ar + en and formal Arabic (`scripts/check-formal-arabic.mjs`). The owner's
>   printed papers are reproduced word for word through the `VERBATIM_PAPERS` exemption
>   (`scripts/check-formal-arabic.mjs:140-150`). `PageHeader` has no subtitle
>   (`apps/web/src/platform/layout/PageContainer.tsx:48-57`).
> - **Concurrency.** Every guard is checked by the write that depends on it, inside the same
>   transaction: an `updateOne` whose filter carries the expected `__v` and status, and a
>   `matchedCount ≠ 1` that throws (`StaleDocumentError` or the named 409). A check made before the
>   transaction is a hint for the error message, never the guard.
> - `/home/user/ATM` and `/home/user/Automation` are read-only.

---

## Contents

1. Purpose and scope
2. Decisions (owner S-1…S-10, designer DS-n)
3. Domain rules (pure, shared by API and web)
4. Data model
5. The Full list seed import
6. API
7. Permissions, manifest, navigation, settings
8. Printed papers and the Excel export
9. Web
10. Tests
11. GAP register and rollout
- Appendix A. Work packages and file ownership
- Review log

---

## 1. Purpose and scope

### 1.1 Today

Every bank keeps one "Master" workbook per day. The Al Baraka copy (`26-10-2026 brk.xlsx`) is built
and printed the evening before the replenishment date: its `Print!G72 =NOW()` is cached at about
20:00 the day before the request date. It holds:

- **`Full list`.** 103 machines, at most 4 cassettes each.
  - Denominations sit in `Denom1..4`, and 0 means "no cassette". The four mixes are 200/200/100/50
    (43), 200/100/50/20 (24), 200/100/50/0 (23) and 0/50/100/200 (13, stored in reverse order).
  - Count columns are empty. The machine kind (`Deposit`: Deposit 53 / Withdrawall 40 / NEW 8 /
    `-` 2), a bank-plus-model `Bank` label (13 spellings + 2 blank) and the area name `Dep` (26
    names + 1 blank) are printed on the Note.
- **`REP. TAPE`.** The day's lines (100 slots; 25 used today, covering 23 machines, two of them
  twice, each first in the morning and then in the evening; 2 AM and 23 PM lines). Counts are typed
  per cassette.
  - Every line's total is one of two standard totals kept in white text at `D1:G2`: 24 lines use
    the first, 1 the second. Each standard row is a count of 200, 100 and 50 notes.
  - Two cassettes of one denomination always share the count equally (16 of 16 cases). 20 EGP
    cassettes are loaded with 0 notes (4 lines).
  - `R7:T7` = 200 / 100 / 50 and `R8:T107` give each line's notes per denomination; they equal the
    typed counts summed per denomination on 25 of 25 lines.
- **`Print`.** One «محضر جرد ماكينة الصراف الآلى» ("the Note") per line, a 72-row A4 block found
  by serial.
- **`بيان التغذية`.** The cash request to the open-cash vault.
- **`سيلزات`.** The handover list to the ATM vault, with a blank bag-QR column.
- **`ATM_2`.** A reordered copy of the lines.

Downstream, the Al Baraka Inventory (`INVENTORY (A)`, notes per denomination 200/100/50/20/10, one
row per line) and the DR (`On The Way`, 200/100/50/20) are filled from these lines, per
denomination (25 of 25 of today's lines match the Inventory's per-denomination counts).

ECMS has the machine master (`atm_machines`, `apps/api/src/modules/atm/machines/machine.model.ts:13-25`),
the Efficiency register whose open entry says which bank a machine serves
(`register/register.model.ts:44-60`), the replenishment board, and the map zones. Nothing in ECMS
models cassettes, denominations, plans, Notes, bags or seals (grounding B, G-1 and G-3).

### 1.2 What phase 1 adds (Al Baraka first, S-10)

1. **Cassette layouts («فئات الكاسيتات»).** One layout per machine, 4–8 slots, each with kind,
   denomination and currency. Every change keeps a version. A screen per bank shows and edits
   them, and a one-off seed import reads a bank's master workbook (preview, differences report,
   apply).
2. **Standard loads («الحمولة القياسية»).** Named count profiles per branch × bank. Al Baraka's
   two come from `REP. TAPE!D1:G2`. A machine may point at one.
3. **The daily plan («خطة التغذية»).** One plan per branch × bank × replenishment date. Each line
   is a machine or a spare set, with a run number (1–3) and a time. Counts per cassette start from
   the standard load, split evenly in hundreds, and stay editable. Lines are validated, carry a
   status and get a running Note number.
   - Outputs: the Notes, «بيان التغذية», the «سيلزات» sheet and an `.xlsx` in today's REP. TAPE and
     ATM_2 shape.
4. **Preparation («الشوالات والسيلزات»).** Scan or type each cassette's seal and the bag QR, with a
   second bag after 4 cassettes. Duplicates warn and never block.
5. **Control & Supplies («بيانات التغذية والخطوط»).** The day's lines with their bags and seals,
   the handover sheet to the ATM vault, and the distribution of lines over named crew lines
   («خطوط», called *routes* in code) with one sheet per route.

### 1.3 Out of scope for phase 1

| Item | Why |
|---|---|
| Inventory ledger, Daily Report (DR), vault position, System Atm MASTER | S-10: they stay in Excel; the `.xlsx` export feeds them (§8.5). |
| The return half of the Note (unload, short/over, «نتيجة جرد الماكينة») | Printed blank exactly as today; capture is phase 4. |
| Linking plan lines to the replenishment board | Phase 4. The board's one-open-row rule (OD-1, `replenishments/replenishment.model.ts:64-75`) is not touched (DS-9). |
| Bank request-file upload (BM tape), CIB/HDB per-machine standard tables, NBE forex, the other banks' Full list formats | Phase 2 (S-10). The import is built with a per-bank profile so they can be added (§5.2). |
| Seal stock issuing to Preparation (S-8 option c) | Not requested (S-8). |
| A bank logo on the Note | Not committed (DS-18, GS-19). |

---

## 2. Decisions

### 2.1 Owner decisions (final; implement exactly)

| # | Decision (from `DECISIONS.md`, 2026-10-26) | Where |
|---|---|---|
| S-1 | The cassette layout lives on the MACHINE. Settlements & Review edits it, and every change keeps history. The register's free-text cassette columns R..AJ stay as they are (`packages/contracts/src/modules/atm-register.ts:481-499`). Seed once from each bank's Full list and produce a differences report. | §4.1, §5 |
| S-2 | Each slot records denomination, kind (withdrawal / deposit / recycle / empty) and currency (EGP or foreign). Machines have 4–8 slots. Spare cassettes are not a slot. | §3.1 |
| S-3 | Counts come per bank "as today". A bank with a standard load per machine: type the machine IDs and the system fills the standard quantities. Any line can be edited by hand. Al Baraka: per-cassette counts as in REP. TAPE; its two standard totals are `REP. TAPE!D1:G2`. | §3.4, §4.3, §5.4 |
| S-4 | Several cassettes of one denomination: one method for every bank. Split evenly, rounded to 100 notes; Settlements can adjust before printing. | §3.3 |
| S-5 | ONE plan and ONE «بيان التغذية» per bank per day. Every line carries its run number (1st/2nd/3rd) and time, printed on the Note and the seals sheet. | §4.4, §8.2, §8.4 |
| S-6 | A bag («شوال») holds exactly 4 cassettes. More than 4 gets a second bag automatically. One Note per plan line, showing which cassette is in which bag. | §3.2, §8.2 |
| S-7 | Preparation scans (or types) the bag QR and each cassette's seal while closing the bag; Control & Supplies finds them ready. Duplicate seals/QRs WARN, never block. | §4.6, §6.8 |
| S-8 | Control & Supplies page: (a) see the data and the seals, print the handover sheet to the ATM vault; (b) distribute the bags across lines («خطوط») and print one sheet per line. Seal stock (c) is not requested. | §6.9, §9.7 |
| S-9 | A spare set is its own plan line, with a machine model/family and no machine, a Note and seals. When a machine is later replenished with it, record which machine. | §3.6, §6.6 |
| S-10 | Start with ONE bank, Al Baraka (BRK). Inventory and DR stay in Excel; the system exports the plan in today's sheet shape. | §7.4, §8.5 |
| — | **Improvements accepted on the papers:** the Note carries a serial, the REPLENISHMENT date (not the print day), the run, and 4–8 cassette rows. «بيان التغذية» counts distinct machines plus spare sets, not lines, and its 20/10/5 rows are summed. | §8 |

### 2.2 Designer decisions (the owner did not decide these; each is the narrowest choice that keeps S-1…S-10 true)

| # | Decision | Why |
|---|---|---|
| DS-1 | **A plan is per branch × bank × replenishment date.** «One plan per bank per day» (S-5) holds inside each branch. | **Data:** the Al Baraka Full list is one branch's book. All 61 of its machines found in the register belong to EGYCASH-1, while the 49 open Al Baraka machines of EGYCASH-5 and EGYCASH-7 are absent from it (grounding A §6). The cash it requests comes from a branch vault (the BRK DR keeps `موقف الخزينه` by branch code). **Code:** `machineCode` is unique per branch, not company-wide (`machine.model.ts:45-48`), so a company-wide plan would need a branch on every line. **Scoping:** every write checks `keyReachesBranch` on the record's branch (`apps/api/src/shared/types/index.ts:210-211`), so a branch-scoped Settlements user can own their branch's plan, and could not own a mixed one. |
| DS-2 | The layout is its own collection, `atm_cassette_layouts`, one document per machine (§4.1). Its history is an append-only `atm_cassette_layout_versions`, readable with the layout key. | The map's precedent: data about a machine that is not master data is kept off `atm_machines`, so its writes never bump the master's `__v`, its DTO or its audit snapshot (`map/machine-location.model.ts:4-7`; zones spec DM-5). Audit history needs the platform keys `activityLog.view`/`auditLog.view` (G-2), and S-1 wants Settlements to see the history. |
| DS-3 | **A machine's bank is the register's:** the common `bankCode` of the OPEN entries linked to it (`machineId`). A live machine with no such entry has **no register bank** (`noRegisterBank`). One whose open entries name two banks belongs to no bank (`otherBank`, GS-25). Neither can be planned. | `atm_machines.bankName` is free text (`machine.model.ts:15-16`) and nothing maps a label back to a code (G-4). The map already derives the code this way (`map/map.service.ts:216-231`; `commonBankCode`, `map/location/derive.ts:160-165`). `atm_machines` is filled by the legacy import separately from the register (`machines/machine.migration.ts:4-5`; `register/register-coupling.ts:11`), and open entries without a master exist (DEC-30, `register-coupling.ts:294-316`), so "no register bank" is a normal case and is not "another bank". |
| DS-4 | **Planned slots.** `isPlanned(s) = isFillable(s) && s.currency === 'EGP'`, where fillable = `withdrawal` or `recycle`. Only planned slots are filled, bagged, totalled and printed in the Note's filling section. Deposit, empty and foreign-currency slots are recorded on the layout and shown on screens. EGP denominations are the six on the paper (200, 100, 50, 20, 10, 5). A foreign fillable slot raises warning `FOREIGN_CURRENCY_NOT_PLANNED`, and the server refuses notes on any slot that is not planned (400 `SLOT_NOT_FILLABLE`). | Every paper today lists exactly these six (`بيان التغذية` rows 8–13; the Note's `L31:L41`). No ATM currency vocabulary exists (G-8), and NBE's forex is prepared outside Settlements by المركزية (GS-14). Every money figure is therefore EGP, and says so (DS-28). |
| DS-5 | The layout stores three labels from the Full list, verbatim after cleaning: `typeLabel` (`Bank`, e.g. "BRK (S2)"), printed as the Note's «البنك» and the sheets' TYPE; `featuresLabel` (`Deposit`, e.g. "Withdrawall"), printed after «هذة الماكينة تحتوى على»; and `hubLabel` (`Dep`, an area name), printed as the Note's «المنطقة» and as HUB on «سيلزات» and ATM_2. Cleaning removes control and format characters (`\p{Cc}\p{Cf}`), applies NFC and collapses spaces. A cell longer than its cap is `invalid` with flag `labelTooLong` and is never truncated. | The Note, «سيلزات» and ATM_2 print `Bank`, `Deposit` and `Dep` today through `VLOOKUP` into the Full list (grounding A §1, §3, §4: "HUB is not REP. TAPE's N"). ECMS has no model field on the master (G-5); the register's model column is per custody period and free text. A spare set's "model/family" (S-9) is the same `typeLabel`. |
| DS-6 | Import matching is EXACT: `normalizeAtmMachineCode` (`packages/contracts/src/modules/atm.ts:23`), in the import's branch, among machines that are not deleted. No fuzzy matching. | One Full list ID differs from ECMS only by zero-padding inside the code, which ECMS's own rule does not fix; 42 IDs are absent from the register entirely (grounding A §6). A guessed match would attach cassettes to the wrong machine. Each case is reported (§5.3) and fixed in the register by Efficiency (GS-1). |
| DS-7 | Import apply never deletes a layout and never reorders slots. `0/50/100/200` is imported as slot 1 empty … slot 4 = 200, and flagged `reversedOrder`. Apply has three modes: `newOnly`, `newAndChanged` and `overwriteManual`. A layout whose latest change was made by hand (`source: 'manual'`) is `changedManual` and is written only in `overwriteManual`. A row whose layout changed after the preview is a conflict and is never written. | The paper prints cassettes in the stored order (`K14:K20` follow `Denom1..4`); whether the order is physical is GS-9. Rollout step 2 corrects flagged machines by hand after the first apply; a second import must not undo those corrections silently. |
| DS-8 | Standard loads are **profiles per branch × bank**: an optional label, a count per EGP denomination, and one default. A layout may point at one (`standardLoadId`); otherwise the bank's default applies. The import reads `REP. TAPE!D1:G2` into profiles and marks the first row the default, if no default exists yet. A line keeps the counts its profile gave it (`standardNotes`), so editing a profile later changes no line. | S-3 places Al Baraka's two standard totals there. Which machine takes which total is not in the files (24/1 is one day's use) → GS-12. The per-machine pointer lets Settlements record it without inventing it. |
| DS-9 | Plan lines are **not** replenishment-board rows, and phase 1 never opens or closes a board row. | OD-1 allows one open row per machine company-wide (`replenishment.model.ts:64-75`; `shared/open-operation.ts`), while a plan may carry a machine in two runs. The link is phase 4. |
| DS-10 | **Line status:** `draft` → `issued` → `prepared`, plus `cancelled`. "Printed" in the brief is `issued`. Issuing assigns the Note serial and locks the counts. Printing is a repeatable read that is counted per line (`notePrintCount`) and audited. A reopen voids the serial and resets the print count, so the next serial's Note counts as not printed. | A serial that changed on every reprint would not identify a Note. Separating issue from print also lets lines added later be issued and printed alone. |
| DS-11 | **Serial = a running Note number per branch × bank** that never restarts. It comes from the counter document `atm-note:<branchId>:<bankCode>` in `atm_note_counters` (§4.9), incremented inside the issue transaction. A number is never reused; a voided one stays on the line's `voidedSerials`. «مسلسل» prints it. The lines of one issue get consecutive numbers in (run, time, position) order. | The owner accepted "Notes carry a serial number" as an IMPROVEMENT, and today's «مسلسل» (`Print!J6`) is already the line's 1–100 number in the day's file, so a per-plan 1..n would print what the paper prints now. The intent recorded with the owner is a document number (UNDERSTANDING §3: "the IT receipt-number pattern"). Fleet's in-transaction counter (`fleet/custody/custody-counter.model.ts:1-14`) gives unique, gap-free numbers: two issues at once meet a write conflict that `withTransaction` retries, and an aborted issue takes its increment back. The owner confirms the form under GS-34. |
| DS-12 | The split is exact (§3.3). The first cassettes of a denomination, in slot order, take the extra hundreds. A remainder under 100 goes to the last one, with warning `NOT_MULTIPLE_OF_100`. | S-4 plus a deterministic tie-break. The paper's counts are always multiples of 100 (grounding A). |
| DS-13 | **Bags:** a line's planned slots in slot order, 4 per bag (S-6), so 1 or 2 bags. A seal is REQUIRED for every bagged cassette with notes > 0 and optional for a 0-note cassette. A bag QR is REQUIRED unless every cassette in that bag holds 0 notes. | The Note lists Al Baraka's 0-note 20 EGP cassette with its seal box today. Whether a 0-note cassette travels, and whether a bag of 0-note cassettes is closed and sealed, is GS-8. |
| DS-14 | Preparation captures live in their own collection, `atm_line_preparations`, one per issued line. | Different writers (Preparation, not Settlements), a different realtime permission (§6.11), and seals kept out of the Settlements DTO. Preparation writes never collide with a Settlements line version. |
| DS-15 | **Scanned values** are stored as scanned (`value`, §3.5) with a normalised `key` used only to find duplicates. Every key is checked company-wide over all time against every bag QR AND every cassette seal, and against the line's other fields; a QR that equals a seal is marked `crossKind`. A match outside the caller's read reach is reported as `outsideReach` only. | S-7 says duplicates warn and never block. The scanning field moves focus on by itself (§9.6), so a second scan of a bag QR can land in a seal field. A match must not reveal another branch's lines. |
| DS-16 | «تم التجهيز» (mark `prepared`) requires every required QR and every required seal (DS-13). It answers 422 when something is missing. Duplicates still never block. | "Control & Supplies finds them ready" (S-7) means complete. Missing is not the same as duplicate. |
| DS-17 | **A crew line («خط») for v1:** a named group per branch × replenishment date, with an optional free-text leader and an order. It may hold lines of every bank's plan for that day. A plan line is assigned whole (all its bags), to at most one route. «إنشاء الخطوط من القطاعات» is an on-demand default: one route per map zone, each located machine's line placed by its primary zone. The membership rule is the map's, moved into contracts (`zoneMembership`, §6.9) so the map and this button run the same code; every located pin counts, under review or not, as on the map (`map/map.service.ts:115`). | S-8 (b) distributes bags; a machine's bags travel together. A street route serves every bank's machines, so it is not a plan's child. No line or crew entity exists in ECMS (G-9), and the board's leader is free text too (`replenishment.model.ts:24-25`). Zones are the owner-drawn division of a branch's machines; their membership rule is the map's (first zone in order, D-M7), and today it exists only in the web (`apps/web/src/modules/atm/lib/map-geometry.ts:157-168`). Zones are only READ and never changed (D-M8), and the button needs map reach too (§6.9). |
| DS-18 | Papers reproduce the paper's words through one verbatim wording file in `VERBATIM_PAPERS` (§8.1). Every new word on a paper (run, spare, route) is a formal i18n key, always rendered in Arabic. Papers print Western digits with `#,##0` grouping, as Excel does. **Dates** print `d/m/yyyy`, the papers' only explicit date format (`سيلزات!D1`, `[$-1010000]d/m/yyyy`); the Note's print timestamp keeps its own explicit `m/d/yy h:mm:ss` (`Print!G72`). The Note shows the replenishment date (accepted improvement); «بيان التغذية» and «سيلزات» keep the print day, as today (`=TODAY()`, GS-28). The Al Baraka logo box prints the bank's Arabic name. | The fleet precedent (`check-formal-arabic.mjs:140-150`; `formal-arabic.spec.ts:79-103`). `Print!B9`, `بيان التغذية!B3` and `REP. TAPE!O8` use Excel's built-in short date (numFmtId 14), which follows the PC's regional setting; openpyxl only labels it `mm-dd-yy` (GS-24). The logo is an extract of the workbook (privacy rule). |
| DS-19 | The Note keeps the paper's 13-column grid and row map (§8.2). More than 4 cassettes insert rows by a fixed rule and scale the block to stay on one A4 page. Two bags are shown in column F and in split bag boxes, under the paper's own word «الحقيبة». | The owner accepted "4–8 cassette rows" and "which cassette in which bag" on the SAME Note. |
| DS-20 | The `.xlsx` writer is promoted from Fleet to `apps/web/src/shared/lib/xlsx-writer.ts`, and gains a cell-addressed "grid" sheet (LTR, free cells, styles, merges, number formats). The REP. TAPE and ATM_2 columns stay exactly where they are, including REP. TAPE's per-denomination columns `R:T` (200 / 100 / 50), which the Inventory and the DR read. Cassettes 5–8 are appended after the last per-denomination column. REP. TAPE's `Dep` (N) is the ECMS area (GS-11); ATM_2's HUB is `hubLabel`. | The writer always writes «م» in column A, the header in row 1, and RTL (`fleet/lib/fleet-xlsx.ts:107-144`); REP. TAPE starts in column B at row 7 and is LTR. "Never copy-paste across modules" (`docs/02-architecture/module-structure.md:122`). `R:T` equal the per-denomination sums on 25 of 25 lines, and `INVENTORY (A)` G4:K4 and the DR's `On The Way` E2:H2 are per denomination. REP. TAPE's short `Dep` codes are not in ECMS (GS-11). |
| DS-21 | Each print is a POST that records the print, audits it (`atmSettlementPrint`, or `export` for the `.xlsx`) and returns the snapshot. The web opens the print tab inside the click; a blocked tab sends no request, and a failed request closes the tab (§9.4). | `openPrintWindow` must run in the click and may return null (`apps/web/src/shared/lib/print-window.ts:92-108`); the IT labels are the precedent (`it/components/useAssetLabels.ts:34-52`). The register export precedent audits a read (`register/register-export.ts:112-123`). |
| DS-22 | **Work branch:** every page works in ONE branch, `resolveWorkBranch(ctx, viewKey, writeKey)` with THAT page's key pair (§6.2). It returns the top bar's branch when readable, else the caller's only readable branch, else a 422 `CHOOSE_BRANCH` / `NO_BRANCH` block. `canWrite` is reported separately. | The map's GM-20 lesson (`map/map-scope.ts:99-120`): the branch a page loads must be the branch it writes. Read-only holders get a branch too. |
| DS-23 | Read scope = the map's rule. A finer scope narrows to the branch, `own` reads nothing, and a branch from the browser that is out of reach answers 400 `OUT_OF_REACH` (`map/map-scope.ts:31-72`). | Plans, layouts and routes are branch records created by whoever ran an action; "own = createdBy" would show an arbitrary subset (zones spec DM-10). |
| DS-24 | The banks the Settlements pages offer come from the new organization setting `atm.settlements.banks`, default `['BRK']`. | S-10. Adding a bank later is a setting plus that bank's import profile (§5.2), not a release of every screen. |
| DS-25 | The plan page opens on **tomorrow (Cairo)**. Preparation and Control open on the date the server suggests: the earliest date ≥ today (Cairo) that has issued lines not yet prepared, else tomorrow. A date chip pair «اليوم» / «غدًا» sits beside the date field. The date is never remembered. | Plans are built the evening before (§1.1). Preparation and Control work in shifts across midnight, so after 00:00 "tomorrow" would skip the day being prepared. When Preparation actually fills is GS-33. A remembered date would reopen yesterday's plan. |
| DS-26 | Realtime topics per entity (§6.11), plus two day signals that carry the branch (`atm.preparationDay`, `atm.controlDay`), so branch-scoped Preparation and Control users hear the Settlements and Preparation writes they act on. The Preparation and Control pages also refetch every 60 s while visible. | Audit signals carry no branch (G-11; `platform/audit/audit.service.ts:179`), while the publisher already serves branch rooms (`platform/realtime/realtime-publisher.ts:32-36, 67-69`); the explicit-signal precedent is `fleet/custody/custody-memo-guard.ts:158-170`. The refetch precedent is `apps/web/src/modules/atm/api/atm-queries.ts:469`. |
| DS-27 | A spare line has 1–8 planned slots typed by Settlements, an optional `spareCode` (≤ 20), a required `typeLabel`, and counts from a standard load or by hand. Recording the machine later («ربط بماكينة») is allowed while the line is issued or prepared, and may be corrected (audited). | S-9. Al Baraka's files show no spare sets (GS-22); the CIB `SP` and NBE 4-character codes suggest a short code. |
| DS-28 | **Money:** counts are integers. A line's value is `Σ notes × denomination × 100` EGP minor units over its planned slots (`egpTotalMinor`); every money field is EGP and is named so. Sums use `sumMinorUnits`, and every screen, paper and xlsx cell converts ONCE with `fromMinorUnits` (`packages/contracts/src/modules/hr-payroll-money.ts:79, 100`) before formatting. | The repository's minor-unit convention (`hr-payroll-money.ts:61-110`; Operations `amountMinor`). `formatMoney` formats the number it is given (`apps/web/src/shared/lib/format.ts:95-102`); the precedent converts first (`apps/web/src/modules/hr/payroll/components/RunReconciliation.tsx:32`). The maximum, 8 × 100,000 × 200 × 100, is below 2⁵³. |
| DS-29 | A line keeps a snapshot of the machine (code, name, area) and the layout (slots, the three labels, `layoutRevision`) taken when it was added, plus the standard counts it was filled with (`standardNotes`). A draft line can be refreshed; an issued line never changes. | The gold-port rule the board already follows: "the id links, the snapshot is the record a closed day keeps saying" (`replenishment.model.ts:3-6`). |
| DS-30 | Limits: 400 lines per plan (BM's sheet has 350 slots), 200 machine codes per add call (`ATM_BULK_MAX_IDS`, `atm.ts:231`), 100,000 notes per cassette (a sanity cap, not a capacity: GS-13), 200 characters per bag QR, 64 per cassette seal, 100 routes per branch-day, 400 moves per assignment call, the master-workbook limits of §5.1. | Requests stay well below the 1 MB body limit. |
| DS-31 | **Run** = the machine's ordinal visit that day: 1 for its first replenishment of the day, 2 for its second, 3 for its third. | Today's data fits it: both repeated machines are first AM, then PM (REP. TAPE rows 18/19 and 22/23). `RUN_TIME_ORDER` and `DUPLICATE_IN_RUN` assume it. BM's «المسائى2» may name a wave of the day rather than a visit → GS-31. |
| DS-32 | **One word per concept on screens:** a slot is «كاسيت» (the register's «كاسيت 1», `apps/web/src/platform/localization/i18n.ts:17750`, and the paper's «رقم الكاسيت»); a bag is «شوال» (the owner's word, S-6); a cassette seal is «سيلز» (the owner's sheet «سيلزات»). Papers keep their own words: the Note's bag is «الحقيبة» («رقم قفل الحقيبة»). | Screens mixed «درج» and «كاسيت» for one thing. Operations' «أختام الأكياس» (`i18n.ts:16750`) names the vault's custody bags, a different object. |

---

## 3. Domain rules — `packages/contracts/src/modules/atm-settlements.ts` (NEW, pure)

Exported from `packages/contracts/src/index.ts` after `atm-map-geometry.js` (`index.ts:68-71`).
Every function below has a spec in `atm-settlements.spec.ts` (§10.1).

### 3.1 Slots

```ts
export const ATM_SLOT_KINDS = ['withdrawal', 'deposit', 'recycle', 'empty'] as const;
export const ATM_EGP_DENOMINATIONS = [200, 100, 50, 20, 10, 5] as const;   // the papers' order
export const ATM_LAYOUT_SLOTS_MIN = 4, ATM_LAYOUT_SLOTS_MAX = 8, ATM_SPARE_SLOTS_MIN = 1;
export const ATM_BAG_CASSETTES = 4;                                         // S-6
export const ATM_NOTES_ROUNDING = 100;                                      // S-4
export const ATM_CASSETTE_NOTES_MAX = 100_000;                              // DS-30
export const ATM_LABEL_MAX = { typeLabel: 60, featuresLabel: 40, hubLabel: 60 } as const;
export interface AtmCassetteSlot {
  slot: number;                     // 1..8, contiguous from 1
  kind: AtmSlotKind;
  denomination: number | null;      // null for empty and deposit
  currency: string | null;          // ISO 4217, upper case; null for empty
}
export const isFillable = (s: AtmCassetteSlot): boolean => s.kind === 'withdrawal' || s.kind === 'recycle';
export const isPlanned = (s: AtmCassetteSlot): boolean => isFillable(s) && s.currency === 'EGP';  // DS-4
export const cleanLabel = (raw: string): string;
//   strips \p{Cc}\p{Cf}, NFC, collapses runs of white space to one space, trims (DS-5)
```

`isPlanned` is the one predicate for "this plan puts notes in it". `fillFromStandard`,
`bagAllocation`, `receiptRows`, `lineEgpTotalMinor`, `byDenomination`, the Note's cassette rows,
the REP. TAPE and ATM_2 totals and `requiredMissing` all use it, never `isFillable` alone.

`layoutIssues(slots, { spare = false }) → AtmLayoutIssue[]` (each `{ slot | null, code }`):
- `SLOT_COUNT`: fewer than 4 or more than 8 slots (spare: 1–8, and every slot planned).
- `SLOT_NUMBERS`: slots are not exactly 1..n.
- `EMPTY_HAS_VALUE`: an `empty` slot with a denomination or a currency.
- `DEPOSIT_HAS_DENOMINATION`: a `deposit` slot with a denomination. Its currency is optional (GS-14).
- `DENOMINATION_REQUIRED` / `CURRENCY_REQUIRED`: a fillable slot without one.
- `EGP_DENOMINATION`: an EGP slot whose denomination is not one of the six.
- `FOREIGN_DENOMINATION`: a foreign slot whose denomination is not an integer from 1 to 1000 (GS-14).
- `CURRENCY_FORMAT`: not `^[A-Z]{3}$`.

A layout with no planned slot is valid (a deposit-only machine), but it cannot be planned (§3.7
`NO_FILLABLE_SLOT`).

### 3.2 Bags — `bagAllocation(slots) → { bag: 1 | 2; slots: number[] }[]`

The planned slots, in slot order, are cut into groups of `ATM_BAG_CASSETTES`. Bag 1 holds the
first four. More than eight planned slots cannot occur (layouts are ≤ 8).

Examples:
- 4 planned → `[{1,[1,2,3,4]}]`.
- Slots 1 = empty and 2..4 planned → `[{1,[2,3,4]}]`.
- 6 planned → `[{1,[1..4]},{2,[5,6]}]`.
- 8 planned → two bags of 4.
- 4 EGP slots + 2 USD slots → `[{1,[1..4]}]`: the foreign slots are not bagged (DS-4).

`bagNeedsQr(bag, slots) → boolean`: false when every slot of the bag holds 0 notes (DS-13).

### 3.3 Split — `splitEvenly(total, k) → number[]` (S-4, DS-12)

```
units = floor(total / 100); rest = total − 100·units
base  = floor(units / k);    extra = units − base·k
slot j (0-based, slot order) = 100·(base + (j < extra ? 1 : 0)),  + rest on j = k − 1
```

Examples:
- `splitEvenly(4000, 2) = [2000, 2000]`
- `splitEvenly(4100, 2) = [2100, 2000]`
- `splitEvenly(250, 2) = [100, 150]`, with warning `NOT_MULTIPLE_OF_100`
- `splitEvenly(0, 3) = [0, 0, 0]`
- `splitEvenly(700, 3) = [300, 200, 200]`

`splitByDenomination(slots, entries: { denomination; notes }[]) → { notes: Map<slot, number>; unplaced: number[] }`
applies `splitEvenly` per denomination over the planned slots of that denomination. It is the ONE
method of S-4, used both by `fillFromStandard` and by a typed per-denomination edit (§6.5 S16).

### 3.4 Filling from a standard load — `fillFromStandard(slots, profile) → { notes: Map<slot, number>; unplaced: number[] }`

1. `splitByDenomination(slots, profile.notes)`: for every EGP denomination `d` in the profile, the
   planned slots of `d` share `profile[d]`.
2. A planned slot whose denomination has no profile entry gets 0. This is Al Baraka's 20 EGP
   cassette today (§1.1).
3. A profile denomination with no slot is listed in `unplaced`, which raises warning
   `STANDARD_DENOMINATION_UNPLACED`; those notes are not placed.
4. A slot that is not planned (deposit, empty, foreign) gets no notes at all (DS-4).

### 3.5 Scanned values — `cleanScannedValue(raw)`, `sealKey(value)`, `scannedValueWarnings(value)`

`cleanScannedValue(raw) → string | null` is the value as stored and printed:
1. Remove format characters (`\p{Cf}`: LRM, RLM, ALM, BOM, the zero-width marks that a paste from
   right-to-left text carries) and CR, LF and TAB (a scanner may add a trailing CR or a Tab).
2. Map Arabic-Indic (U+0660–0669) and Eastern Arabic-Indic (U+06F0–06F9) digits to ASCII.
3. Trim. An empty result is `null`.

Case and inner characters are kept: the bag QR's payload is unknown (GS-4, GS-6), and a URL or a
case-sensitive code must survive.

`sealKey(value) → string` is used ONLY to find duplicates (DS-15): NFKC, all white space removed,
Latin letters upper-cased. It is stored beside the value and indexed.

`scannedValueWarnings(value) → ('ARABIC_LETTERS')[]`: `ARABIC_LETTERS` when the value holds a
letter in U+0621–064A. A keyboard-wedge scanner sends key positions, so under the Arabic layout a
Latin seal arrives as Arabic letters and would never match the same seal scanned in Latin. The
warning never blocks (whether a seal may hold Arabic letters stays open with GS-6).

Schemas (on the CLEANED value): `AtmBagQrSchema` 1–200 characters, `AtmSealValueSchema` 1–64, both
`/^[^\p{Cc}]+$/u`. The error code is `INVALID_SEAL`. The format is unknown (GS-6), so nothing
narrower is assumed.

### 3.6 Lines, runs, times and totals

```ts
export const ATM_PLAN_RUNS = [1, 2, 3] as const;                            // S-5, DS-31
export const ATM_PLAN_LINE_KINDS = ['machine', 'spare'] as const;
export const ATM_PLAN_LINE_STATUSES = ['draft', 'issued', 'prepared', 'cancelled'] as const;
export const ATM_PLAN_LIVE_STATUSES = ['draft', 'issued', 'prepared'] as const;
export const ATM_PLAN_LINES_MAX = 400;                                      // DS-30
export const ATM_SCHEDULE_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;               // stored form 'HH:mm'
export const normalizeScheduleTime = (raw: string | null): string | null | 'bad';
//   '' / null → null; 'HH:mm', 'H:mm', 'h:mm AM|PM' (any case, optional space), 'h:mm ص|م' and the
//   same with Arabic-Indic digits → 'HH:mm'; anything else → 'bad' (refused per row, §6.5 S14)
export interface AtmPlanSlot extends AtmCassetteSlot { notes: number; bag: 1 | 2 | null }
export const lineEgpTotalMinor = (slots: AtmPlanSlot[]): number;
//   Σ notes × denomination × 100 over planned slots (DS-28)
export const byDenomination = (slots: AtmPlanSlot[]): { denomination: number; notes: number }[];
//   notes per EGP denomination over planned slots, in 200…5 order, only denominations present
export const receiptRows = (lines): { denomination: number; notes: number }[];
//   the six EGP rows 200…5 over the given lines' planned slots (callers pass issued + prepared)
export const receiptMachineCount = (lines): number;
//   distinct machineIds of machine lines + the number of spare lines (accepted improvement)
export const repTapeComment = (time: string | null): string;
//   '21:00' → 'Repl @9:00 PM', '02:00' → 'Repl @2:00 AM', '00:30' → 'Repl @12:30 AM', null → ''
```

A run is the machine's ordinal visit that day (DS-31). A spare line carries the run its add dialog
gave it.

### 3.7 Line issues — `planLineIssues(line, ctx) → { code; severity: 'error' | 'warning'; slot?: number }[]`

`ctx` carries the plan's other non-cancelled lines, the machine's current layout (with its
`revision`), and "today" in Cairo.

**Errors** (they block issue):

| Code | Rule |
|---|---|
| `MACHINE_NOT_PLANNABLE` | The machine is deleted or inactive, or its bank (DS-3) is no longer the plan's. The server re-checks this at issue time. |
| `NO_LAYOUT` | The machine has no layout. |
| `NO_FILLABLE_SLOT` | The line has no planned slot. |
| `EMPTY_LINE` | Every planned slot holds 0 notes. |
| `DUPLICATE_IN_RUN` | Another live machine line of this plan has the same machine and run. The unique index `ux_plan_machine_run` (§4.5) makes this unreachable for stored lines; the rule stays for the web's local check. |
| `SPARE_TYPE_REQUIRED` | A spare line with no `typeLabel`. |
| `LAYOUT_INVALID` | `layoutIssues` is not empty for the line's slots. |

**Warnings** (shown and confirmed; they never block):

| Code | Rule |
|---|---|
| `NOT_MULTIPLE_OF_100` | A slot's notes are not a multiple of 100. |
| `LAYOUT_CHANGED` | Draft line: `line.layoutRevision !== layout.revision` (slots or any label changed). |
| `LAYOUT_CHANGED_AFTER_ISSUE` | Issued or prepared line, `replenishDate ≥ today` (Cairo), and `line.layoutRevision !== layout.revision`. Settlements decides whether to reopen and reprint. |
| `NO_TIME` | `scheduleTime` is null. |
| `STANDARD_DENOMINATION_UNPLACED` | §3.4 step 3. |
| `DIFFERS_FROM_STANDARD` | Draft line only: a denomination's notes differ from the line's own `standardNotes` (manual edits). |
| `RUN_TIME_ORDER` | The same machine's run `n` time is not later than its run `n − 1` time. |
| `FOREIGN_CURRENCY_NOT_PLANNED` | The layout has a fillable foreign-currency slot (DS-4). |
| `PAST_DATE` | The plan date is before today (Cairo). |

---

## 4. Data model (WP-S1)

Every model uses `baseFields` + `baseSchemaOptions` (`apps/api/src/shared/base/base.model.ts:17-29`).
Collections carry the `atm_` prefix (`platform/kernel/module-registry.ts:140-149`). All files are NEW
under `apps/api/src/modules/atm/settlements/` unless stated.

### 4.1 `atm_cassette_layouts` — `settlements/layouts/cassette-layout.model.ts`

```ts
export interface AtmCassetteLayoutDoc extends BaseDocFields {
  machineId: Types.ObjectId;          // one live document per machine (DS-2)
  branchId: Types.ObjectId;           // copied from the machine; a machine's branch never changes
  slots: AtmCassetteSlot[];           // 4..8, layoutIssues() empty
  typeLabel: string | null;           // ≤ 60, cleaned (DS-5), no \p{Cc}
  featuresLabel: string | null;       // ≤ 40, cleaned, no \p{Cc}
  hubLabel: string | null;            // ≤ 60, cleaned, no \p{Cc}: Full list `Dep` (DS-5)
  standardLoadId: Types.ObjectId | null;   // DS-8; null → the bank's default
  revision: number;                   // 1 at creation, +1 per change; = the latest version row
  source: 'import' | 'manual';        // of the latest change (DS-7 `changedManual`)
  changedByName: string | null;       // actorName(ctx) (shared/atm-context.ts:33-34)
  changedAt: Date;
}
index({ machineId: 1 }, { unique: true, name: 'ux_machine', partialFilterExpression: { isDeleted: false } })
index({ branchId: 1 }, { name: 'ix_branch' })
model 'AtmCassetteLayout' → 'atm_cassette_layouts'
```

The Mongoose schema repeats the caps (`maxlength`) and a `match: /^[^\p{Cc}]*$/u` on the three
labels, so a bad value is refused before any transaction starts (the import cleans and checks first,
§5.3).

### 4.2 `atm_cassette_layout_versions` — `settlements/layouts/cassette-layout-version.model.ts`

This collection is append-only; nothing updates or deletes a row.

```ts
{ layoutId, machineId, branchId, revision, slots, typeLabel, featuresLabel, hubLabel, standardLoadId,
  source: 'import' | 'manual', reason: string | null (≤ 300), importRunId: ObjectId | null,
  changedBy: ObjectId, changedByName: string | null, changedAt: Date } + baseFields
index({ machineId: 1, revision: 1 }, { unique: true, name: 'ux_machine_revision' })
model 'AtmCassetteLayoutVersion' → 'atm_cassette_layout_versions'
```

A version takes effect when it is saved (GS-26): lines added after it copy it, whatever their
replenishment date, and lines already on a plan raise `LAYOUT_CHANGED` / `LAYOUT_CHANGED_AFTER_ISSUE`
(§3.7).

### 4.3 `atm_standard_loads` — `settlements/standard-loads/standard-load.model.ts`

```ts
{ branchId, bankCode: AtmBankCode, label: string | null (≤ 40, no \p{Cc}), isDefault: boolean,
  order: number,
  notes: { denomination: 200|100|50|20|10|5; notes: number }[]   // 1..6, unique denominations, EGP
} + baseFields
index({ branchId: 1, bankCode: 1, order: 1 }, { name: 'ix_branch_bank' })
index({ branchId: 1, bankCode: 1 }, { unique: true, name: 'ux_default',
  partialFilterExpression: { isDefault: true, isDeleted: false } })
model 'AtmStandardLoad' → 'atm_standard_loads'
```

Unique denominations are enforced by the save schema (§6.1) and re-checked by the model's validator.

### 4.4 `atm_replenishment_plans` — `settlements/plans/plan.model.ts`

```ts
{ branchId, bankCode, replenishDate: string /* 'YYYY-MM-DD', a Cairo calendar day */,
  lastPosition: number /* 0; $inc when lines are added */,
  receiptPrint: { at: Date; byName: string | null; serials: number[] } | null,   // last «بيان التغذية»
  handoverPrint: { at: Date; byName: string | null; serials: number[] } | null   // last «سيلزات»
} + baseFields
index({ branchId: 1, bankCode: 1, replenishDate: 1 }, { unique: true, name: 'ux_branch_bank_date',
  partialFilterExpression: { isDeleted: false } })
model 'AtmReplenishmentPlan' → 'atm_replenishment_plans'
```

`receiptPrint` and `handoverPrint` are print tracking, set with `$set` and no `__v` bump (§6.7).

### 4.5 `atm_plan_lines` — `settlements/plans/plan-line.model.ts`

```ts
export interface AtmPlanLineDoc extends BaseDocFields {
  planId: Types.ObjectId; branchId: Types.ObjectId; bankCode: AtmBankCode;
  replenishDate: string;                       // copied from the plan, for day queries
  kind: 'machine' | 'spare';
  machineId: Types.ObjectId | null;            // null for a spare line
  machineCode: string | null; machineName: string | null; area: string | null;  // snapshot (DS-29)
  typeLabel: string | null; featuresLabel: string | null; hubLabel: string | null; // snapshot
  layoutRevision: number | null;               // the layout revision copied; null for a spare line
  spareCode: string | null;                    // spare only (DS-27), ≤ 20, no \p{Cc}
  spareUse: { machineId; machineCode; machineName; at: Date; by: ObjectId; byName: string | null } | null;
  run: 1 | 2 | 3; scheduleTime: string | null; // 'HH:mm'
  position: number;                            // insertion order within the plan
  status: AtmPlanLineStatus;
  serial: number | null;                       // set at issue (DS-11)
  voidedSerials: { serial: number; printCount: number; at: Date; byName: string | null; reason: string }[];
  slots: AtmPlanSlot[];                        // layout snapshot + notes + bag (bag set at issue)
  countsSource: 'standard' | 'manual';
  standardLoadId: Types.ObjectId | null;       // the profile the counts came from
  standardNotes: { denomination: number; notes: number }[] | null;  // what that profile gave (DS-8)
  egpTotalMinor: number;                       // lineEgpTotalMinor(slots), stored
  issuedAt: Date | null; issuedBy: Types.ObjectId | null; issuedByName: string | null;
  cancelledAt: Date | null; cancelledBy: Types.ObjectId | null; cancelledByName: string | null;
  cancelReason: string | null;
  notePrintCount: number; notePrintedAt: Date | null;    // DS-10; reset by a reopen
}
index({ planId: 1, status: 1 }, { name: 'ix_plan_status' })
index({ branchId: 1, bankCode: 1, serial: 1 }, { unique: true, name: 'ux_branch_bank_serial',
  partialFilterExpression: { serial: { $gt: 0 }, isDeleted: false } })
index({ planId: 1, machineId: 1, run: 1 }, { unique: true, name: 'ux_plan_machine_run',
  partialFilterExpression: { kind: 'machine', status: { $in: ['draft', 'issued', 'prepared'] },
                             isDeleted: false } })
index({ 'voidedSerials.serial': 1, branchId: 1 }, { name: 'ix_voided_serial' })
index({ branchId: 1, replenishDate: 1 }, { name: 'ix_branch_date' })
index({ machineId: 1, replenishDate: 1 }, { name: 'ix_machine_date' })
model 'AtmPlanLine' → 'atm_plan_lines'
```

`ux_plan_machine_run` is the race guard for two users adding the same machine to the same run, and
for a PATCH that moves a line into an occupied run (§6.5). A partial filter with `$in` already
exists in the repository (`apps/api/src/modules/hr/training/nominations/training-nomination.model.ts:89`;
mongod 7.0).

### 4.6 `atm_line_preparations` — `settlements/preparation/line-preparation.model.ts`

```ts
{ lineId, planId, branchId, bankCode, replenishDate,
  bags: { bag: 1 | 2; slots: number[]; qr: string | null; qrKey: string | null }[],  // from bagAllocation
  seals: { slot: number; value: string | null; key: string | null }[],               // one per bagged slot
  status: 'open' | 'prepared',
  lastCapturedAt: Date | null, lastCapturedByName: string | null,
  preparedAt: Date | null, preparedBy: ObjectId | null, preparedByName: string | null } + baseFields
index({ lineId: 1 }, { unique: true, name: 'ux_line', partialFilterExpression: { isDeleted: false } })
index({ planId: 1 }, { name: 'ix_plan' })
index({ 'bags.qrKey': 1, createdAt: -1 }, { name: 'ix_bag_qr_key', partialFilterExpression: { isDeleted: false } })
index({ 'seals.key': 1, createdAt: -1 }, { name: 'ix_seal_key', partialFilterExpression: { isDeleted: false } })
model 'AtmLinePreparation' → 'atm_line_preparations'
```

`value` / `qr` are what was scanned (§3.5); `key` / `qrKey` = `sealKey(value)`. Values are never
unique-indexed (S-7: warn, never block). The two multikey indexes serve the duplicate lookups
(§6.8).

### 4.7 `atm_dispatch_routes` and `atm_route_assignments` — `settlements/control/*.model.ts`

```ts
AtmDispatchRouteDoc { branchId, replenishDate, name (1..60, no \p{Cc}),
  nameKey: string /* name trimmed, spaces collapsed, case-folded */,
  leaderName: string | null (≤ 80, no \p{Cc}), order: number, zoneId: ObjectId | null } + baseFields
index({ branchId: 1, replenishDate: 1, order: 1 }, { name: 'ix_branch_date_order' })
index({ branchId: 1, replenishDate: 1, nameKey: 1 }, { unique: true, name: 'ux_branch_date_name',
  partialFilterExpression: { isDeleted: false } })
index({ branchId: 1, replenishDate: 1, zoneId: 1 }, { unique: true, name: 'ux_zone_route',
  partialFilterExpression: { zoneId: { $type: 'objectId' }, isDeleted: false } })
model 'AtmDispatchRoute' → 'atm_dispatch_routes'

AtmRouteAssignmentDoc { lineId, routeId, branchId, replenishDate } + baseFields
index({ lineId: 1 }, { unique: true, name: 'ux_line', partialFilterExpression: { isDeleted: false } })
index({ routeId: 1 }, { name: 'ix_route' })
index({ branchId: 1, replenishDate: 1 }, { name: 'ix_branch_date' })
model 'AtmRouteAssignment' → 'atm_route_assignments'
```

Route names are unique per branch-day by `ux_branch_date_name`: routes have no set document whose
revision could serialise writers, as the zones' set does (`map/zone.model.ts:8-9`). `ux_zone_route`
keeps two concurrent «إنشاء الخطوط من القطاعات» calls from creating a zone's route twice.

### 4.8 `atm_layout_import_runs` — `settlements/import/layout-import-run.model.ts`

```ts
{ branchId, bankCode, fileName (≤ 200), fileSha256,
  state: 'running' | 'done' | 'failed' | 'abandoned', startedAt: Date, finishedAt: Date | null,
  mode: 'newOnly' | 'newAndChanged' | 'overwriteManual', standardLoads: boolean,
  counts: Record<AtmLayoutImportOutcome | 'created' | 'updated' | 'conflicts' | 'standardLoadsCreated', number>,
  actorName: string | null, error: string | null } + baseFields
index({ branchId: 1, bankCode: 1 }, { unique: true, name: 'ux_one_running',
  partialFilterExpression: { state: 'running' } })
index({ branchId: 1, bankCode: 1, createdAt: -1 }, { name: 'ix_branch_bank_created' })
model 'AtmLayoutImportRun' → 'atm_layout_import_runs'
```

A run row exists only for an APPLY; a preview writes nothing. It stores counts only: no code, no
value and no row content (the register import's rule, `register/import/register-import.service.ts:9-10`).
`ux_one_running` is the lock: one running apply per branch × bank (the register's precedent,
`register/import/register-import-run.model.ts:80-84`, `apply-import.ts:4-5`).

### 4.9 `atm_note_counters` — `settlements/plans/note-counter.model.ts`

```ts
{ key: string /* 'atm-note:<branchId>:<bankCode>' */, seq: number /* the last number handed out */ }
  timestamps, versionKey: false, no soft delete
index({ key: 1 }, { unique: true, name: 'ux_note_counter_key' })
model 'AtmNoteCounter' → 'atm_note_counters'
```

The fleet counter, as is (`fleet/custody/custody-counter.model.ts:1-60`):
`ensureNoteCounter(key, floor)` runs OUTSIDE the issue transaction and upserts with
`$max: { seq: floor }`, where `floor` is the highest serial ever used for that branch × bank (live
lines and `voidedSerials`, read with `ux_branch_bank_serial` and `ix_voided_serial`), so a lost
counter never restarts below a used number. Inside the transaction the issue only `$inc`s it.

### 4.10 Index registration

- **Boot.** Add the ten models to `atmIndexedModels()` (`apps/api/src/modules/atm/atm-indexes.ts:51-68`).
  - `rowsInLog: true`: layouts, layout versions, standard loads, plans, routes, import runs, note
    counters. Their keys are ids, codes, dates and counter keys.
  - `rowsInLog: false`: `AtmPlanLineModel`, `AtmLinePreparationModel` and `AtmRouteAssignmentModel`.
    They are operation records holding counts and seals, and the operation logs' rule applies
    (`atm-indexes.ts:11-16`).
  - `apps/api/src/modules/atm/shared/open-operation.spec.ts:113-128` asserts that every entry other
    than the two operation logs has `rowsInLog: true`. Change it to name the five `false`
    collections explicitly.
  - Building at boot also creates each collection before its first insert inside a transaction
    (`atm-indexes.ts:8-9`).
- **Deploy.** `db:sync-indexes` (`apps/api/package.json:16`) loads every model reached from `./app`
  and `./modules` (`apps/api/src/sync-indexes.models.ts:10-11`). The new models are reached through
  the manifest routers.

---

## 5. The Full list seed import (S-1)

**The import branch.** Every import works in ONE branch: `resolveWorkBranch(ctx,
'atmCassetteLayout.view', 'atmCassetteLayout.import')` (§6.2). The request carries `branchId` as a
required multipart field and it must equal that branch (400 `BRANCH_MISMATCH`). A preview needs view
reach; an apply needs `canWrite`. Machines, layouts, register entries and standard loads are read
in that branch only.

### 5.1 Reading the workbook

`apps/api/src/modules/atm/register/import/read-register-workbook.ts` already opens an upload in
memory, inflates only the entries it needs under byte caps, and streams ONE named sheet. Nothing
touches the disk (`:1-24`, `:255-332`). Generalise it in place:

- **Entry count first.** Before `JSZip.loadAsync` (`:263`), read the end-of-central-directory record
  from the last 65,557 bytes of the upload (22 bytes + the largest comment). Refuse more than 500
  entries, or any ZIP64 marker (`0xFFFF` / `0xFFFFFFFF` in the EOCD, or a ZIP64 locator), with
  `TOO_LARGE 'entries'`. `loadAsync` builds every entry before any cap applies and no deadline can
  interrupt it; 20 MB of empty entries is hundreds of thousands of objects. The check lives in the
  shared file, so the register reader gets it too (the BRK master has 39 entries).
- **Errors are a parameter.** Extract `reduceWorkbookToSheets(upload, sheetNames, limits, deadline,
  errors)`, where `errors = { layout(message, details), unreadable() }`. The register passes
  factories that produce today's `ATM_REGISTER_IMPORT_LAYOUT` 422 and `unreadableWorkbook()` (`:96-108`,
  so its spec does not change); the settlements reader passes `ATM_LAYOUT_IMPORT_LAYOUT` 422 and the
  same unreadable error. `tooLarge` and the missing-sheet error are built from `errors.layout`.
- **Several sheets, one pass.** `reduceWorkbookToSheets` inflates the workbook, rels, styles and
  shared strings once, then every named worksheet under the sheet cap, and re-zips them with every
  worksheet AFTER the shared strings. That keeps the reader's no-spill rule (`:4-9`). One deadline
  covers the whole read, both sheets included.
- `reduceRegisterWorkbook` stays exported and calls it with `['ATMs']`, so the register spec does not
  change.
- Export `readSheetRows(reduced, sheetName, { maxRowsIterated, maxDataRows, deadline }) →
  AsyncIterable<{ row; cells }>` from the same file.

**Limits** (`settlements/import/read-master-workbook.ts`):

```ts
export const MASTER_WORKBOOK_LIMITS = { workbookBytes: 1 * MB, relsBytes: 1 * MB, stylesBytes: 4 * MB,
  sharedStringsBytes: 8 * MB, sheetBytes: 16 * MB, maxRowsIterated: 5_000, maxDataRows: 2_000,
  timeMs: 20_000 };
export const MASTER_IMPORT_MAX_MB = 10;    // the upload cap (§6.3)
```

The BRK master's measured parts are about 75 KB (`Full list`), 130 KB (`REP. TAPE`), 12 KB of
shared strings and 90 KB of styles, in 39 entries and 1.1 MB on disk. The register's limits
(sheet 150 MB, shared strings 50 MB, 60k rows, 60 s; `:61-69`) are sized for a different file and
are not reused.

The settlements reader calls `reduceWorkbookToSheets(upload, ['Full list', 'REP. TAPE'], …)` once,
then reads `Full list` from row 1 to its end and `REP. TAPE` rows 1–2 (`D:G`) and 7–107 (`B:K`,
codes and denominations only; count columns are never read). ExcelJS and JSZip stay lazily imported
(`:18-21`).

### 5.2 Bank profiles — `settlements/import/master-profiles.ts`

```ts
export interface AtmMasterProfile {
  sheet: 'Full list'; headerRow: 1; firstDataRow: 3;
  columns: { code: 'Reference'; location: 'location'; denominations: ['Denom1','Denom2','Denom3','Denom4'];
             typeLabel: 'Bank'; featuresLabel: 'Deposit'; hubLabel: 'Dep'; help: 'HELP' };
  emptyDenomination: 0;        // 0 or blank = no cassette (DS-7)
  slotKind: 'withdrawal';      // every non-zero slot (GS-9)
  currency: 'EGP';
  standardLoads: { sheet: 'REP. TAPE'; rows: [1, 2]; total: 'D'; counts: { E: 200; F: 100; G: 50 } };
  dayLines: { sheet: 'REP. TAPE'; headerRow: 7; firstRow: 8; lastRow: 107;
              code: 'B'; denominations: ['E', 'G', 'I', 'K'] };   // codes and denominations only
}
export const ATM_MASTER_PROFILES: Partial<Record<AtmBankCode, AtmMasterProfile>> = { BRK: { … } };
```

- Headers are bound by exact text after trimming and collapsing spaces. The Full list headers are
  `Reference · location · No-of bills1 · Denom1 · … · Bank · HELP` (grounding A §5); REP. TAPE row 7
  is `Reference · location · No-of bills1 · Denom1 · No- of bills2 · …` (§8.5).
- A missing header or sheet → 422 `ATM_LAYOUT_IMPORT_LAYOUT`, with details naming the header and
  never a cell.
- A bank with no profile → 422 `ATM_LAYOUT_IMPORT_UNSUPPORTED_BANK`.
- The other banks' formats (`+200` markers, HDB text layouts, CIB `Q:V`) are phase 2. Each one is a
  new profile plus its own row parser (§1.3).

### 5.3 Row outcomes and the differences report — `settlements/import/plan-layout-import.ts` (pure)

Rows are read from `firstDataRow` until the sheet ends; blank rows are skipped. Labels are cleaned
with `cleanLabel` (§3.1) before any comparison. Each row gets ONE outcome:

| Outcome | Rule | Applied? |
|---|---|---|
| `invalid` | Blank code, a denomination that is not 0/blank or one of the six EGP values, all four empty, or a cleaned label over its cap (flag `labelTooLong`). | no |
| `duplicateInFile` | The normalised code appears on more than one row. Every occurrence gets this outcome. | no |
| `notFound` | No live machine with this code in the import branch (DS-6). | no |
| `archived` | The machine is inactive (`isActive: false`). The Full list has 4 such today (grounding A §6). | no |
| `noRegisterBank` | A live machine with no open register entry linked to it (DS-3). The row shows the machine's `bankName`. | no |
| `otherBank` | The machine's open entries name another bank, or two banks (DS-3, GS-25). | no |
| `new` | The machine has no layout. | yes |
| `same` | The layout's slots and its three labels are all equal. | — |
| `changed` | The layout differs, and its latest change came from an import (`source: 'import'`). The row shows the slots before and after. | `newAndChanged` and `overwriteManual` |
| `changedManual` | The layout differs, and its latest change was made by hand (`source: 'manual'`). | `overwriteManual` only |

**Flags** are informational and attached to the row:

| Flag | Rule |
|---|---|
| `reversedOrder` | Slot 1 is empty and the later denominations rise. |
| `typeMentionsRecycle` | `typeLabel` contains `recycle`, case-insensitive (GS-9). |
| `helpDisagrees` | The multiset of the `HELP` text's non-zero numbers differs from the multiset of the non-zero denominations. HELP is trimmed, capped at 100 characters, and split with `split('-').filter(Boolean)`, each part kept only when it is all digits; no regular expression is run over it (the SEC-2 rule, `read-register-workbook.ts:162-164`). |
| `helpOrderOpposite` | The multisets agree, but HELP lists them in the opposite order to the slots. Today this is every reversed row (13 of 13), which is evidence for GS-9. |
| `areaDiffers` | `hubLabel` ≠ the machine's `area` after cleaning (GS-11). |
| `nameDiffers` | The Full list `location` ≠ the machine's `name` after cleaning (GS-30). |
| `repTapeDiffers` | The code is on today's REP. TAPE (`dayLines`) and the denominations there differ from this row's, blank and 0 counted alike (GS-29). |
| `registerCountDiffers` | The open register entry's `cassettes.withdrawalCount` (`packages/contracts/src/modules/atm-register.ts:482`) is a plain integer and differs from the number of non-empty slots. |
| `registerDenominationsDiffer` | The open entry's `cassettes.withdrawal1..5` (`atm-register.ts:483-487`) are each a plain integer or blank, and as a list they differ from the non-empty denominations. |
| `idFormat` | Fails `ATM_REGISTER_ID_FORMATS[bank]` (`atm-register.ts:76-86`). |
| `codeWhitespace` | The raw cell had inner white space. |

The register is read through ONE helper, `registerBankRows(machineIds | { branchId, bankCode })`,
with the projection `{ machineId: 1, bankCode: 1, 'cassettes.withdrawalCount': 1,
'cassettes.withdrawal1': 1, …, 'cassettes.withdrawal5': 1 }` (§6.2). An entry holds `keys`, the notes
fields and the `safeCombination` ref (`register/register.model.ts:57-66`); none of them is ever
loaded here (the map's rule, `map/location.service.ts:5-7`).

**Report sections:**
- the counts per outcome and per flag;
- the rows, filterable by outcome, each with its `revision` (null without a layout);
- `missingFromFile`: the bank's active machines in the import branch (DS-3) that no file row matched;
- `standardLoads`: rows 1–2 of `REP. TAPE!D:G`. Each has an outcome:
  - `invalid`: a blank or non-numeric cell in `D:G`, or a count that is not an integer from 0 to
    100,000;
  - `mismatch`: `D ≠ 200·E + 100·F + 50·G` (today the line's total selects the row, so wrong counts
    would load the wrong notes);
  - `same`: an existing profile of the branch × bank has identical counts;
  - `new`: otherwise.
  Only `new` is ever applied. D itself is never stored.
- **The report as a file.** The import page downloads the preview as an `.xlsx` (one sheet: row,
  code, outcome, flags, machine name; no counts and no amounts), built in the browser from the
  preview DTO with the shared writer (§8.5), so Efficiency can act on the rows (GS-1). A run row
  keeps counts only, so the file exists only from a preview.

What to expect from today's Al Baraka file (grounding A §6). This is a smoke-check expectation, not a
fixture. The research matched the file against the register workbook that ECMS imports, not
against the live database, so the live figures may differ:
- 60 rows match a machine exactly.
- 1 more row matches only after a zero-padding change inside the ID, which ECMS's rule does not
  make.
- 42 rows are absent from the register.
- Those 43 rows are `notFound` when no Operations machine carries the code in the branch, and
  `noRegisterBank` when one does (Operations machines come from the legacy import, not from the
  register; DS-3).
- The 4 machines the register shows as handed back are `archived` when their masters are inactive.

### 5.4 Apply

`POST …/layouts/import` with `apply=true` carries:
- `fileSha256` from the preview, or 409 `ATM_LAYOUT_IMPORT_FILE_CHANGED` (the register's rule,
  `register-import.service.ts:94-99`);
- `previewRevisions`: the preview's `[{ machineId, revision | null }]` for its `new`, `changed` and
  `changedManual` rows, as a JSON string field (§6.1);
- `mode` (required, no default) and `standardLoads`.

Apply re-reads the file and re-runs §5.3 against the database as it is now, then:

1. **Lock.** Mark runs of this branch × bank that are `running` and older than `STALE_RUN_MS`
   (`register/import/plan-import.ts:56`) as `abandoned` (the register's takeover,
   `apply-import.ts:197-199`). Insert the run row with `state: 'running'`; an E11000 on
   `ux_one_running` → 409 `ATM_LAYOUT_IMPORT_RUNNING`. A double click or a second user waits for
   the first apply.
2. **Rows, one small transaction each.** For every row the mode applies, in file order:
   - a row whose current revision differs from its `previewRevisions` entry (someone saved the
     layout after the preview), or that has no entry, counts as a `conflict` and is never written;
   - a `new` row: in its own `unitOfWork`, insert the layout (`revision: 1`, `source: 'import'`) and
     its version row (`importRunId`);
   - a `changed` / `changedManual` row: in its own `unitOfWork`, `updateOne({ _id, __v, revision,
     isDeleted: false })` with `revision + 1`, then insert the version row; `matchedCount ≠ 1` throws
     `StaleDocumentError` inside the callback, which aborts that row only;
   - the caller catches an E11000 on `ux_machine` or `ux_machine_revision`, or that
     `StaleDocumentError`, OUTSIDE the transaction and counts it in `conflicts`. In MongoDB a
     duplicate key aborts the transaction it happens in, so it is never caught inside one; this is
     the map batch's shape (`map/location.service.ts:14-17`), with each row's two writes kept
     atomic.
   - Each row's audit (`create` or `update` on `{ entityType: 'cassetteLayout', entityId:
     machineId }` with `diffChanges` of `{ slots, typeLabel, featuresLabel, hubLabel }`) is recorded
     as soon as its transaction commits.
3. **Standard loads and the run row, one transaction.** With `standardLoads=true`, each `new`
   standard row creates a profile with `label: null` and the next `order`. It is `isDefault: true`
   only when the branch × bank has no default yet and the row is row 1 (DS-8); `ux_default` is the
   race guard (E11000 → the profile is created with `isDefault: false`, counted). Nothing is
   deleted. In the same transaction, the run row gets its counts and `state: 'done'`.
4. **Failure.** Any other error marks the run `failed` (from a `finally`, with the counts so far)
   and is rethrown; committed rows stay, and re-running the same file finds them `same`.
5. **Audits** (after the run commits):
   - one `atmLayoutImport` row on `{ moduleId: 'atm', entityType: 'layoutImport', entityId: runId }`
     with the counts;
   - one `create` per standard load, with its `notes`.

---

## 6. API (WP-S1)

### 6.1 Contracts — `packages/contracts/src/modules/atm-settlements.ts`

Besides §3, the file holds the Zod schemas and DTOs below. Every object is `.strict()`. `objectId()`
and `PaginationQuerySchema` come from `../common/index.js` (`atm.ts:13`). Every free-text field
refuses control characters (`NoControl = /^[^\p{Cc}]*$/u`) after trimming.

```ts
const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Text = (max: number) => z.string().trim().max(max).regex(NoControl);
const RawTimeSchema = z.string().max(20).nullable();   // normalised per row (§3.6 normalizeScheduleTime)
const TimeSchema = z.string().regex(ATM_SCHEDULE_TIME).nullable();
const SlotSchema = z.object({ slot: z.number().int().min(1).max(8), kind: z.enum(ATM_SLOT_KINDS),
  denomination: z.number().int().positive().max(1000).nullable(),
  currency: z.string().regex(/^[A-Za-z]{3}$/).transform((c) => c.toUpperCase()).nullable() });
const uniqueBy = (key) => (items, ctx) => { /* one issue `{ path: [i, key], code: 'DUPLICATE' }` per repeat */ };

export const LayoutImportFieldsSchema = z.object({     // the multipart fields, all strings (§6.3)
  bankCode: AtmBankCodeSchema, branchId: objectId(),
  apply: z.string().optional().transform((v) => v === 'true'),
  mode: z.enum(['newOnly', 'newAndChanged', 'overwriteManual']).optional(),
  standardLoads: z.string().optional().transform((v) => v === 'true'),        // default false
  fileSha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  previewRevisions: z.string().max(200_000).optional() })   // JSON [{ machineId, revision|null }] ≤ 2,000
  .superRefine(/* apply → mode, fileSha256 and previewRevisions required; previewRevisions parses */);
export const SaveAtmCassetteLayoutSchema = z.object({ version: z.number().int().min(0).nullable(),
  slots: z.array(SlotSchema).min(4).max(8), typeLabel: Text(60).nullable(),
  featuresLabel: Text(40).nullable(), hubLabel: Text(60).nullable(), standardLoadId: objectId().nullable(),
  reason: Text(300).nullable() }).superRefine(/* layoutIssues() → issues */);
export const SaveAtmStandardLoadSchema = z.object({ version: z.number().int().min(0).optional(),
  branchId: objectId() /* equality check only (DS-22) */, bankCode: AtmBankCodeSchema,
  label: Text(40).nullable(), isDefault: z.boolean(),
  notes: z.array(z.object({ denomination: z.union(ATM_EGP_DENOMINATIONS.map(z.literal)),
    notes: z.number().int().min(0).max(ATM_CASSETTE_NOTES_MAX) })).min(1).max(6)
    .superRefine(uniqueBy('denomination')) });
export const CreateAtmPlanSchema = z.object({ bankCode: AtmBankCodeSchema, replenishDate: DateSchema,
  branchId: objectId() /* consistency check only (DS-22) */ });
const RunSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
const SlotNotes = z.object({ slot: z.number().int().min(1).max(8),
  notes: z.number().int().min(0).max(ATM_CASSETTE_NOTES_MAX) });
const DenominationNotes = z.object({ denomination: z.union(ATM_EGP_DENOMINATIONS.map(z.literal)),
  notes: z.number().int().min(0).max(8 * ATM_CASSETTE_NOTES_MAX) });
export const AddAtmPlanLinesSchema = z.object({ run: RunSchema,
  rows: z.array(z.object({ machineCode: z.string().trim().min(1).max(40), scheduleTime: RawTimeSchema }))
    .min(1).max(ATM_BULK_MAX_IDS) });
export const AddAtmSpareLineSchema = z.object({ run: RunSchema, scheduleTime: TimeSchema,
  spareCode: Text(20).nullable(), typeLabel: Text(60).pipe(z.string().min(1)),
  slots: z.array(SlotSchema).min(1).max(8), standardLoadId: objectId().nullable(),
  denominationNotes: z.array(DenominationNotes).max(6).superRefine(uniqueBy('denomination')).optional(),
  notes: z.array(SlotNotes).max(8).superRefine(uniqueBy('slot')).optional() });
export const UpdateAtmPlanLineSchema = z.object({ version: z.number().int().min(0),
  run: RunSchema.optional(), scheduleTime: TimeSchema.optional(), refreshLayout: z.literal(true).optional(),
  standardLoadId: objectId().nullable().optional(),
  denominationNotes: z.array(DenominationNotes).max(6).superRefine(uniqueBy('denomination')).optional(),
  notes: z.array(SlotNotes).max(8).superRefine(uniqueBy('slot')).optional() })
  .refine(/* at least one change */);
export const IssueAtmPlanSchema = z.object({ lines: z.array(z.object({ id: objectId(),
  version: z.number().int().min(0) })).min(1).max(ATM_PLAN_LINES_MAX) });
export const AtmLineReasonSchema = z.object({ version: z.number().int().min(0), reason: Text(300).pipe(z.string().min(1)) });
export const AtmSpareUseSchema = z.object({ version: z.number().int().min(0),
  machineCode: z.string().trim().min(1).max(40) });
export const AtmSettlementPrintSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('notes'), lineIds: z.array(objectId()).max(400).optional(),
             unprintedOnly: z.boolean().optional() }),
  z.object({ kind: z.literal('receipt') }), z.object({ kind: z.literal('handover') }),
  z.object({ kind: z.literal('repTape') }) ]);
export const SaveAtmPreparationSchema = z.object({ version: z.number().int().min(0),
  bags: z.array(z.object({ bag: z.union([z.literal(1), z.literal(2)]),
    qr: z.string().max(400).nullable() })).min(1).max(2),
  seals: z.array(z.object({ slot: z.number().int().min(1).max(8),
    value: z.string().max(400).nullable() })).max(8) });
//   raw strings: the service cleans them (§3.5), then applies AtmBagQrSchema / AtmSealValueSchema
//   and answers INVALID_SEAL per field
export const AtmVersionSchema = z.object({ version: z.number().int().min(0) });
export const CreateAtmRouteSchema = z.object({ branchId: objectId(), replenishDate: DateSchema,
  name: Text(60).pipe(z.string().min(1)), leaderName: Text(80).nullable() });
export const UpdateAtmRouteSchema = z.object({ version, name?, leaderName?, order?: z.number().int().min(0) });
export const AssignAtmRoutesSchema = z.object({ branchId: objectId(), replenishDate: DateSchema,
  moves: z.array(z.object({ lineId: objectId(), from: objectId().nullable(),
    to: objectId().nullable() })).min(1).max(400).superRefine(uniqueBy('lineId')) });
export const AtmRoutesFromZonesSchema = z.object({ branchId: objectId(), replenishDate: DateSchema });
export const AtmControlPrintSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('handover'), planId: objectId() }),
  z.object({ kind: z.literal('routes'), branchId: objectId(), replenishDate: DateSchema,
    routeIds: z.array(objectId()).min(1).max(100).optional() }) ]);
```

**DTOs** (all JSON-safe; money in EGP minor units, every money field named `egp…Minor`; dates as ISO
strings):

```ts
AtmSettlementContextDto { page: 'plans' | 'layouts' | 'import'; banks: AtmBankCode[];
  branch: { id; name: LocalizedString } | null; blocked: 'chooseBranch' | 'noBranch' | null;
  can: { viewLayouts; manageLayouts; importLayouts; viewPlans; managePlans; printPlans; exportPlans } }
//   every can.X = branch !== null && keyReachesBranch(ctx, X's key, branch.id)
AtmCassetteLayoutRowDto { machineId; machineCode; machineName; area; active: boolean;
  layout: { version; revision; slots; typeLabel; featuresLabel; hubLabel; standardLoadId; source;
            changedByName; changedAt } | null;
  flags: ('noLayout' | 'noFillableSlot' | 'standardLoadOtherBank')[] }
AtmCassetteLayoutsDto { bankCode; branchId; rows; figures: { machines; withLayout; withoutLayout };
  lastImport: { at; actorName; state; counts } | null; can: { manage; import } }
AtmCassetteLayoutDetailDto = AtmCassetteLayoutRowDto & {
  versions: { revision; slots; typeLabel; featuresLabel; hubLabel; standardLoadId; source; reason;
              changedByName; changedAt }[];                                        // newest first
  affectedLines: { planId; replenishDate; lineId; serial: number | null; status; run }[] }
//   the machine's live lines dated today (Cairo) or later, so the save dialog can list them (GS-26)
AtmStandardLoadDto { id; version; branchId; bankCode; label; isDefault; order; notes; egpTotalMinor }
AtmLayoutImportResultDto { applied; fileName; fileSha256; bankCode; branchId;
  counts: Record<AtmLayoutImportOutcome, number>; flags: Record<AtmLayoutImportFlag, number>;
  rows: { row; code; outcome; flags; machineId: string | null; machineName: string | null;
          bankName: string | null /* noRegisterBank */; revision: number | null;
          before: AtmCassetteSlot[] | null; after: AtmCassetteSlot[] | null;
          typeLabel: { before; after }; featuresLabel: { before; after }; hubLabel: { before; after } }[];
  missingFromFile: { machineId; machineCode; machineName }[];
  standardLoads: { row: 1 | 2; notes; outcome: 'new' | 'same' | 'mismatch' | 'invalid' }[];
  applyCounts: { created; updated; standardLoadsCreated; conflicts } | null }
AtmPlanLineDto { id; version; kind; machineId; machineCode; machineName; area; typeLabel;
  featuresLabel; hubLabel; layoutRevision; spareCode;
  spareUse: { machineCode; machineName; at; byName } | null;
  run; scheduleTime; position; status; serial; voidedSerials; slots: AtmPlanSlot[];
  countsSource; standardLoadId; standardNotes; egpTotalMinor;
  preparationStatus: 'none' | 'partial' | 'complete' | 'prepared' | null /* null for draft */;
  notePrintCount; notePrintedAt; issues: { code; severity; slot? }[] }
AtmSettlementPlanDto { id; version; branchId; bankCode; replenishDate; lines: AtmPlanLineDto[];
  summary: {
    lines /* non-cancelled */; machines /* distinct machineId, non-cancelled */; spares;
    bags /* non-cancelled; a draft counts bagAllocation(slots).length */;
    byStatus: Record<AtmPlanLineStatus, number>; notPrinted /* issued + prepared, notePrintCount 0 */;
    receipt: { rows: { denomination; notes }[]; egpTotalMinor; machineCount };   // issued + prepared
    all: { rows; egpTotalMinor; machineCount };            // every non-cancelled line, drafts too
    receiptPrint: { at; byName } | null; receiptStale: boolean;
    handoverPrint: { at; byName } | null; handoverStale: boolean };
  can: { manage; print; export } }
//   …Stale = a print exists and its serials ≠ the serials of today's issued + prepared lines
AtmPlanAddResultDto { added: AtmPlanLineDto[];
  refused: { code: string; reason: 'unknownCode' | 'inactive' | 'noRegisterBank' | 'otherBank' |
             'noLayout' | 'noFillableSlot' | 'duplicateInRun' | 'duplicateInRequest' | 'badTime' }[] }
AtmPreparationLineDto { lineId; planId; serial; voidedSerials: number[]; lineStatus; kind; machineCode;
  machineName; area; hubLabel; typeLabel; spareCode; run; scheduleTime; egpTotalMinor; slots: AtmPlanSlot[];
  preparation: { id; version; status; bags: { bag; slots; qr; required: boolean }[];
                 seals: { slot; value; required: boolean }[]; lastCapturedByName; lastCapturedAt;
                 preparedByName; preparedAt };
  progress: { captured: number; required: number };
  warnings: { field: 'bag' | 'seal'; bag?: 1 | 2; slot?: number; code: 'ARABIC_LETTERS' }[];
  duplicates: AtmSealDuplicateDto[] }
AtmSealDuplicateDto { field: 'bag' | 'seal'; bag?: 1 | 2; slot?: number;
  matches: ({ sameLine: true; otherField: { field: 'bag' | 'seal'; bag?; slot? } } |
            { replenishDate; bankCode; serial; machineCode: string | null; spareCode: string | null;
              lineStatus; matchedField: 'bag' | 'seal' } |
            { outsideReach: true })[];                                              // ≤ 5
  crossKind: boolean /* a QR matched a seal, or a seal a QR */ }
AtmPreparationContextDto { branch; date /* the requested or suggested day (DS-25) */; canCapture;
  plans: { planId; bankCode; lines; prepared; complete; partial; none }[] }
AtmControlDayDto { branch; date; can: { manage; print; zones };
  plans: { planId; bankCode; lines; prepared }[];
  lines: { lineId; planId; bankCode; serial; lineStatus; kind; machineCode; machineName; area;
           hubLabel; zoneName: string | null /* only when can.zones */; typeLabel; spareCode; run;
           scheduleTime; egpTotalMinor; bags: { bag; slots; qr }[];
           seals: { slot; denomination; notes; value }[]; progress; preparationStatus;
           routeId: string | null; duplicates: AtmSealDuplicateDto[] }[];
  routes: { id; version; name; leaderName; order; zoneId; lines; machines; bags; notPrepared }[];
  unassigned: number }
AtmNotePrintDto { branchName; bankCode; bankNameAr; replenishDate; printedAt;
  notes: { lineId; version; serial; kind; machineCode; machineName; hubLabel; typeLabel; featuresLabel;
           spareCode; run; scheduleTime; slots: AtmPlanSlot[] /* planned only */; bagCount;
           egpTotalMinor }[] }
AtmReceiptPrintDto { bankCode; bankNameAr; replenishDate; printedAt; rows: { denomination; notes }[];
  egpTotalMinor; machineCount; serials: number[]; excludedDraftLines: number;
  previous: { at; byName; serials: number[] } | null }
AtmHandoverPrintDto { bankCode; replenishDate; withQr: boolean; printedAt;
  rows: { serial; bankCode; machineCode; machineName; spareCode; run; scheduleTime; egpTotalMinor;
          qrs: (string | null)[] /* [] when !withQr, or when the line is not prepared */;
          typeLabel; hubLabel; prepared: boolean }[];
  notPrepared: number }
AtmRoutesPrintDto { replenishDate; printedAt; unassigned: number;
  routes: { id; name; leaderName; rows: AtmHandoverPrintDto['rows']; machines; bags; notPrepared }[] }
AtmRepTapeExportDto { bankCode; replenishDate; rows: { serial; reference; location;
  slots: ({ notes; denomination } | null)[] /* physical slots 1..n; null = blank (§8.5) */;
  byDenomination: { denomination; notes }[]; egpTotalMinor; comment; dep; typeLabel; hubLabel }[] }
```

**Error codes** (`packages/contracts/src/errors/index.ts`, after the map block `:154-160`):

| Code | Status | When |
|---|---|---|
| `ATM_WORK_BRANCH_REQUIRED` | 422 | No work branch can be resolved; details `{ field: 'branch', code: 'CHOOSE_BRANCH' \| 'NO_BRANCH' }` (§6.2). |
| `ATM_SETTLEMENT_BANK_NOT_ENABLED` | 422 | The bank is not in `atm.settlements.banks` (DS-24). |
| `ATM_LAYOUT_IMPORT_LAYOUT` | 422 | Sheet or header missing, or the workbook beyond a limit (`TOO_LARGE`), as the register answers (§5.1). |
| `ATM_LAYOUT_IMPORT_UNSUPPORTED_BANK` | 422 | No import profile for the bank. |
| `ATM_LAYOUT_IMPORT_FILE_CHANGED` | 409 | Apply with a different file hash. |
| `ATM_LAYOUT_IMPORT_RUNNING` | 409 | Another apply of this branch × bank is running (§5.4). |
| `ATM_STANDARD_LOAD_IN_USE` | 409 | A profile is deleted while live layouts or draft lines point at it; the details carry both counts. |
| `ATM_PLAN_EXISTS` | 409 | A plan for branch × bank × date already exists; the detail carries its id. |
| `ATM_PLAN_FULL` | 422 | More than 400 non-cancelled lines. |
| `ATM_PLAN_LINE_STATE` | 409 | The action does not fit the line's status; the detail carries `{ status }`. |
| `ATM_PLAN_LINE_HAS_CAPTURES` | 409 | Reopening a line whose preparation holds any value, or changed since it was read. |
| `ATM_PLAN_ISSUE_BLOCKED` | 422 | Issue with errors; details `{ field: 'lines[i]', code }`. |
| `ATM_PREPARATION_LOCKED` | 409 | Saving captures on a `prepared` (or cancelled) line. |
| `ATM_PREPARATION_INCOMPLETE` | 422 | Mark prepared with values missing; details name bag or slot numbers, never values. |

Everything else uses the generic classes (`apps/api/src/shared/errors/index.ts:27-75`):
`ValidationError` 400 (field details such as `OUT_OF_REACH`, `INVALID_SEAL`, `BRANCH_MISMATCH`,
`STANDARD_LOAD_OTHER_BANK`, `DUPLICATE_NAME`, `UNKNOWN_SLOT`, `SLOT_NOT_FILLABLE`, `ROUTE_GONE`),
`ForbiddenError` 403, `NotFoundError` 404, `StaleDocumentError` 409 `STALE_DOCUMENT` (with details
`{ field, code: 'MOVED' }` when a route move's `from` no longer holds, §6.9) and `RateLimitedError`
429. The web maps `ATM_LAYOUT_IMPORT_LAYOUT` with either status the same way.

**Audit verbs** (`packages/contracts/src/platform/audit.ts`, after `atmMapLinkResolve` `:173`, each
with a comment in the style of `:165-171`):
- `atmLayoutImport`: one row per applied Full list import. It carries the counts, in the
  `atmRegisterImport` shape.
- `atmSettlementPrint`: one row per printed set (Notes, «بيان التغذية», «سيلزات», a route sheet). It
  carries the kind and `[{ lineId, serial, version }]` of every printed line, plus each line's
  preparation `version` on «سيلزات» and route sheets, so the printed state can be identified later.
  «بيان التغذية» also carries its six rows. A printed cash document is evidence of who printed which
  Notes, from which state, and when.

Neither verb is added to `REALTIME_BROADCAST_ACTIONS` (`packages/contracts/src/platform/realtime.ts:19-27`).

### 6.2 Scope helpers — `apps/api/src/modules/atm/shared/branch-scope.ts` (NEW)

- **Move** `mapScopeMatch`, `mapScopeBranches`, `narrowToBranch`, `activeBranchIds` and
  `writableBranches` (`map/map-scope.ts:31-94`) here, under the names `branchScopeMatch`,
  `branchScopeBranches`, `narrowToBranch`, `activeBranchIds` and `writableBranches`.
  - `map-scope.ts` keeps exporting the old names as aliases, so no map file or spec changes.
  - `resolveZoneEditBranch` stays in `map-scope.ts`.
- **Add `resolveWorkBranch(ctx, viewKey, writeKey)`** (DS-22):
  ```ts
  readable = branchScopeBranches(scopeSelector(ctx, viewKey))
  active   = ctx.activeBranchId ?? null
  if (active && (readable === 'all' || readable.includes(active)))
      return { branchId: active, canWrite: keyReachesBranch(ctx, writeKey, active) }
  candidates = readable === 'all' ? await activeBranchIds() : readable
  if (candidates.length === 1) return { branchId: candidates[0], canWrite: keyReachesBranch(…) }
  return { branchId: null, blocked: candidates.length > 1 ? 'chooseBranch' : 'noBranch' }
  ```
  The key pairs, one per page: plans `(atmSettlementPlan.view, atmSettlementPlan.manage)`, layouts
  `(atmCassetteLayout.view, atmCassetteLayout.manage)`, import `(atmCassetteLayout.view,
  atmCassetteLayout.import)`, Preparation `(atmPreparation.view, atmPreparation.capture)`, Control
  `(atmControl.view, atmControl.manage)`.
- **A blocked resolution, one rule everywhere.** `GET /context` (S1) answers 200 with `blocked` so the
  page can say why. Every other endpoint that needs the work branch (S2, S3, S4, S7, S8, S11, S12,
  P1, C1, C2, C3, C6, C7 `routes`) answers 422 `ATM_WORK_BRANCH_REQUIRED` with details
  `{ field: 'branch', code: 'CHOOSE_BRANCH' | 'NO_BRANCH' }`, and the web shows the same state as
  S1's `blocked`.
- **Every read** is an `$and` of `{ isDeleted: false }`, `branchScopeMatch(scopeSelector(ctx, key))`
  and `narrowToBranch(…)`, never an object spread (`map/map-scope.ts:17-18`).
- **Every write** loads the record through the read match (outside the match → 404) and then
  requires `keyReachesBranch(ctx, writeKey, record.branchId)` (otherwise 403). `own`, `section` and
  home-only `department` grants read and never write (`shared/types/index.ts:162-211`:
  `keyCoversUnit` is false for a department grant over a whole branch). Manage, import, capture,
  print and export must therefore be granted at `branch` or `organization` scope (§7.1).
- **A print or an export is a write of record** (it changes `notePrintCount` or `receiptPrint` and
  always writes an audit row): it reads the plan through the VIEW key's match, then requires
  `keyReachesBranch(ctx, printKey, plan.branchId)` (or `exportKey`), otherwise 403. `hasPermission`
  (`shared/types/index.ts:108`) only tests that a key exists, and is never the check.
- **Line routes** (`/plans/:planId/lines/:lineId`, S16–S21) load the line with `{ _id: lineId, planId,
  isDeleted: false }` AND the read match; a line of another plan is a 404.
- **A body `branchId`** (create plan, standard load, routes, assignments, route prints, the import)
  must equal `resolveWorkBranch(…).branchId`, otherwise 400 `BRANCH_MISMATCH` (zones spec DM-12).
- **Register reads, one helper** — `registerBankRows(…)` in `settlements/shared/register-bank.ts`:
  - `AtmRegisterEntryModel.find({ …filter, status: 'open', isDeleted: false }, { machineId: 1,
    bankCode: 1, 'cassettes.withdrawalCount': 1, 'cassettes.withdrawal1': 1, …,
    'cassettes.withdrawal5': 1 })`. An entry holds `keys`, the notes fields and the
    `safeCombination` ref (`register/register.model.ts:58-67`); this projection keeps them out of
    this feature's memory, the map's rule (`map/location.service.ts:5-7`).
  - `machineBanks(machineIds) → Map<id, { bank: AtmBankCode | null; reason: 'noRegisterBank' |
    'otherBank' | null }>` uses it with `{ machineId: { $in } }` and `commonBankCode` (DS-3).
  - The bank's machines in a branch use it with `{ branchId, bankCode }` on index
    `register/register.model.ts:221` and are then re-checked with `machineBanks` (a machine with a
    second open entry of another bank drops out).
  - The import uses it for `registerCountDiffers` and `registerDenominationsDiffer` (§5.3).

### 6.3 Routes — three routers

Each router follows `machines/machine.routes.ts`: `authenticate → authorize(…) → validate(…)` for
JSON routes. `authorize` takes one key, so a route that needs two chains two `authorize` calls;
`authorizeAny` is `platform/rbac/rbac.middleware.ts:52`. `authorize` and `authorizeAny` only test
that a key is held; the service checks the reach (§6.2). Literal paths come before parameter
paths. Responses use `ok(res, data)`. Final paths are `/api/v1/atm/...`.

**`/atm/settlements` — `settlements/settlements.routes.ts`**

| # | Method + path | Keys | Body / query | Response |
|---|---|---|---|---|
| S1 | `GET /context` | any of `atmCassetteLayout.view`, `atmSettlementPlan.view` | `?page=plans\|layouts\|import` | `AtmSettlementContextDto` for that page's key pair |
| S2 | `GET /layouts` | `atmCassetteLayout.view` | `{ bankCode, branchId? }` | `AtmCassetteLayoutsDto` |
| S3 | `GET /layouts/import/runs` | `atmCassetteLayout.view` | `{ bankCode, branchId? }` | last 10 runs (counts) |
| S4 | `POST /layouts/import` | `atmCassetteLayout.import` (+ `rateLimit` 6/min/user) | multipart `file` + `LayoutImportFieldsSchema` | `AtmLayoutImportResultDto` |
| S5 | `GET /layouts/:machineId` | `atmCassetteLayout.view` | — | `AtmCassetteLayoutDetailDto` |
| S6 | `PUT /layouts/:machineId` | `atmCassetteLayout.manage` | `SaveAtmCassetteLayoutSchema` | `AtmCassetteLayoutDetailDto` |
| S7 | `GET /standard-loads` | any of `atmCassetteLayout.view`, `atmSettlementPlan.view` | `{ bankCode, branchId? }` | `AtmStandardLoadDto[]` |
| S8 | `POST /standard-loads` | `atmCassetteLayout.manage` | `SaveAtmStandardLoadSchema` | `AtmStandardLoadDto` |
| S9 | `PUT /standard-loads/:id` | `atmCassetteLayout.manage` | `SaveAtmStandardLoadSchema` (version required) | `AtmStandardLoadDto` |
| S10 | `DELETE /standard-loads/:id` | `atmCassetteLayout.manage` | `?version=` | 204 |
| S11 | `GET /plans` | `atmSettlementPlan.view` | `{ bankCode, date, branchId? }` | `{ plan: AtmSettlementPlanDto \| null }` |
| S12 | `POST /plans` | `atmSettlementPlan.manage` | `CreateAtmPlanSchema` | `AtmSettlementPlanDto` |
| S13 | `GET /plans/:planId` | `atmSettlementPlan.view` | — | `AtmSettlementPlanDto` |
| S14 | `POST /plans/:planId/lines` | `atmSettlementPlan.manage` | `AddAtmPlanLinesSchema` | `AtmPlanAddResultDto` |
| S15 | `POST /plans/:planId/spare-lines` | `atmSettlementPlan.manage` | `AddAtmSpareLineSchema` | `AtmPlanLineDto` |
| S16 | `PATCH /plans/:planId/lines/:lineId` | `atmSettlementPlan.manage` | `UpdateAtmPlanLineSchema` | `AtmPlanLineDto` |
| S17 | `DELETE /plans/:planId/lines/:lineId` | `atmSettlementPlan.manage` | `?version=` | 204 |
| S18 | `POST /plans/:planId/issue` | `atmSettlementPlan.manage` | `IssueAtmPlanSchema` | `AtmSettlementPlanDto` |
| S19 | `POST /plans/:planId/lines/:lineId/reopen` | `atmSettlementPlan.manage` | `AtmLineReasonSchema` | `AtmPlanLineDto` |
| S20 | `POST /plans/:planId/lines/:lineId/cancel` | `atmSettlementPlan.manage` | `AtmLineReasonSchema` | `AtmPlanLineDto` |
| S21 | `POST /plans/:planId/lines/:lineId/spare-use` | `atmSettlementPlan.manage` | `AtmSpareUseSchema` | `AtmPlanLineDto` |
| S22 | `POST /plans/:planId/prints` | `atmSettlementPlan.view`; the service then requires `.print` (or `.export` for `repTape`) reaching the plan's branch (+ `rateLimit` 30/min/user) | `AtmSettlementPrintSchema` | the kind's DTO (§6.7) |

**The import route (S4)** chains `authenticate → authorize('atmCassetteLayout.import') → rateLimit
→ workbookUpload(MASTER_IMPORT_MAX_MB) → controller`. `workbookUpload` is the register's multer
factory (memory storage, one file in field `file`, the `TOO_LARGE` answer;
`register/import/register-import.routes.ts:28-62`), exported with the cap as a parameter (the register
passes its 20 MB). The router sets `Cache-Control: private, no-store` (`:64-67`). A generic
`validate(…)` cannot run on multipart, because multer fills `req.body` only after it; the controller
therefore parses `req.body` with `LayoutImportFieldsSchema` (§6.1). The defaults are the harmless
ones, as the register's controller does (`register-import.controller.ts:1-5, 14-17, 31-38`): `apply`
only when the field is exactly `'true'`, `standardLoads` only when exactly `'true'`, and no default
`mode`.

**`/atm/preparation` — `settlements/preparation/preparation.routes.ts`**

| # | Method + path | Keys | Body / query | Response |
|---|---|---|---|---|
| P1 | `GET /context` | `atmPreparation.view` | `{ date?, branchId? }` | `AtmPreparationContextDto` |
| P2 | `GET /plans/:planId/lines` | `atmPreparation.view` | — | `AtmPreparationLineDto[]` |
| P3 | `PUT /lines/:lineId` | `atmPreparation.capture` | `SaveAtmPreparationSchema` | `{ line: AtmPreparationLineDto }` |
| P4 | `POST /lines/:lineId/prepared` | `atmPreparation.capture` | `AtmVersionSchema` | `{ line }` |
| P5 | `POST /lines/:lineId/reopen` | `atmPreparation.capture` | `AtmVersionSchema` | `{ line }` |

**`/atm/control` — `settlements/control/control.routes.ts`**

| # | Method + path | Keys | Body / query | Response |
|---|---|---|---|---|
| C1 | `GET /day` | `atmControl.view` | `{ date?, branchId? }` | `AtmControlDayDto` |
| C2 | `POST /routes` | `atmControl.manage` | `CreateAtmRouteSchema` | route |
| C3 | `POST /routes/from-zones` | `atmControl.manage` + `atmMap.view` | `AtmRoutesFromZonesSchema` | `{ routesCreated; assigned; unlocated; outsideZones }` |
| C4 | `PUT /routes/:routeId` | `atmControl.manage` | `UpdateAtmRouteSchema` | route |
| C5 | `DELETE /routes/:routeId` | `atmControl.manage` | `?version=` | 204 |
| C6 | `PUT /assignments` | `atmControl.manage` | `AssignAtmRoutesSchema` | `AtmControlDayDto['routes']` |
| C7 | `POST /prints` | `atmControl.print` (+ `rateLimit` 30/min/user) | `AtmControlPrintSchema` | `AtmHandoverPrintDto` / `AtmRoutesPrintDto` |

**Common error contract:**
- 400: Zod failures, `OUT_OF_REACH`, `BRANCH_MISMATCH`, the field codes of §6.1.
- 403: the key is missing, or does not reach the record's branch.
- 404: the record is outside the read match, or (line routes) belongs to another plan. Such a record
  is indistinguishable from one that does not exist.
- 409: `STALE_DOCUMENT` and the codes in §6.1.
- 422: business rules, including `ATM_WORK_BRANCH_REQUIRED`.

### 6.4 Layouts and standard loads — `settlements/layouts/layout.service.ts`, `standard-loads/standard-load.service.ts`

- **Context (S1).** `page` picks the key pair (§6.2): `plans` → plan view/manage, `layouts` → layout
  view/manage, `import` → layout view/import. `branch` and `blocked` come from `resolveWorkBranch`
  with that pair. Every `can.X = branch !== null && keyReachesBranch(ctx, X's key, branch.id)`.
- **List (S2).**
  - The bank must be enabled.
  - The branch is `narrowToBranch(q.branchId)` or `resolveWorkBranch(ctx, 'atmCassetteLayout.view',
    'atmCassetteLayout.manage')`.
  - Machines = the bank's active machines in that branch (§6.2), each joined with its layout,
    sorted by `machineCode`.
  - `standardLoadOtherBank` flags a layout whose profile belongs to another bank or branch.
  - Not paginated: at most 2,000 rows; above that, 422 (BM's list has about 450, `UNDERSTANDING` §4).
- **Import runs (S3).** `$and[{ isDeleted: false }, branchScopeMatch(scopeSelector(ctx,
  'atmCassetteLayout.view')), narrowToBranch(q.branchId), { bankCode }]`, newest first, 10.
- **Detail (S5).** The machine is read through `branchScopeMatch` (404 outside). It returns the row,
  every version (newest first), and `affectedLines`: the machine's live lines with `replenishDate ≥
  today (Cairo)`, read with `ix_machine_date` (GS-26).
- **Save (S6).**
  1. The machine is in reach, live and active, and `keyReachesBranch(…manage…)` holds.
  2. `standardLoadId`, when set, is a live profile of the machine's branch and bank (400
     `STANDARD_LOAD_OTHER_BANK`).
  3. A save equal to the current layout writes nothing and returns the detail.
  4. In one `unitOfWork`:
     - `version: null` creates (`revision: 1`); an E11000 on `ux_machine` aborts the transaction and
       is answered, outside it, as 409 `STALE_DOCUMENT`;
     - otherwise `updateOne({ _id, __v: version, isDeleted: false }, { $set: { …, revision + 1,
       source: 'manual', changedByName, changedAt }, $inc: { __v: 1 } })`; `matchedCount ≠ 1` throws
       `StaleDocumentError`;
     - insert the version row with `reason`.
  5. After commit, audit `create` or `update` on `{ entityType: 'cassetteLayout', entityId:
     machineId }` with `diffChanges(before, after)` of `{ slots, typeLabel, featuresLabel, hubLabel,
     standardLoadId }` (`replenishment.service.ts:160-164` pattern). The audit also carries the
     reason.
- **Standard loads (S7–S10).**
  - **Read (S7).** The web always sends its page's work branch as `branchId`, checked with
    `narrowToBranch`; without it the server resolves the layouts pair, or the plans pair when the
    caller holds no layout key. The match is `$and[{ isDeleted: false }, { $or: [branchScopeMatch(scopeSelector(ctx,
    'atmCassetteLayout.view')), branchScopeMatch(scopeSelector(ctx, 'atmSettlementPlan.view'))] },
    narrowToBranch(…), { bankCode }]`, so a plan-only user sees the profiles their plan page offers.
  - **Create (S8).** The branch is `resolveWorkBranch(ctx, 'atmCassetteLayout.view',
    'atmCassetteLayout.manage')` with `canWrite`, and `body.branchId` must equal it (400
    `BRANCH_MISMATCH`, the GM-20 risk, `map/map-scope.ts:99-120`).
  - **Default.** Setting `isDefault: true` clears the previous default in the same transaction
    (`updateOne({ _id: prev, __v, isDefault: true }, { $set: { isDefault: false }, $inc: { __v: 1 } })`).
    `ux_default` is the race guard: E11000 → 409 `STALE_DOCUMENT`.
  - **Delete (S10)** answers 409 `ATM_STANDARD_LOAD_IN_USE` while any live layout, or any DRAFT line,
    points at the profile; the details carry `{ layouts, draftLines }`. Issued lines keep their own
    `standardNotes` and never read the profile again.
  - **Audits.** Every write is audited on `{ entityType: 'standardLoad', entityId }` with
    `diffChanges` of `{ label, isDefault, notes }`, and so is the previous default when a switch
    clears it.

### 6.5 Plans — `settlements/plans/plan.service.ts`

Every line write below is an `updateOne` whose filter carries `{ _id, planId, __v, status,
isDeleted: false }`, inside the transaction that depends on it; `matchedCount ≠ 1` throws
`StaleDocumentError` (or the named 409), which rolls the whole transaction back. Checks made before
the transaction only shape the error message.

- **Read by day (S11).** The branch comes from `narrowToBranch(q.branchId)` or `resolveWorkBranch`;
  blocked → 422 `ATM_WORK_BRANCH_REQUIRED` (§6.2). Load `{ branchId, bankCode, replenishDate }` and
  return the DTO or `null`.
- **The DTO.**
  - Lines are sorted by `serial` (issued lines first), then `run`, `scheduleTime` (nulls last) and
    `position`.
  - `issues` are computed per line (§3.7), with the plan's current layouts and machines loaded in
    two queries.
  - `summary` (§6.1): `lines`, `machines`, `spares` and `bags` count non-cancelled lines; `machines`
    counts distinct `machineId`; a draft's bags are `bagAllocation(slots).length`. `receipt` covers
    `issued` + `prepared`; `all` covers every non-cancelled line. `receiptStale` /
    `handoverStale` are true when a print exists and its `serials` differ from the serials of the
    plan's current issued + prepared lines.
  - `preparationStatus` comes from the line's preparation: no value → `none`, some → `partial`, all
    required values present → `complete`, and `prepared` when its status is prepared.
  - `can.manage` / `can.print` / `can.export` = `keyReachesBranch` of each key on the plan's branch.
- **Create (S12).**
  - The bank must be enabled.
  - The branch is `resolveWorkBranch(ctx, 'atmSettlementPlan.view', 'atmSettlementPlan.manage')`
    with `canWrite`, and `body.branchId` must equal it.
  - Insert; E11000 on `ux_branch_bank_date` → 409 `ATM_PLAN_EXISTS` with `{ planId }`.
  - Audit `create` on `{ entityType: 'settlementPlan' }`.
- **Add machine lines (S14).**
  1. Before the transaction, per row: normalise the code with `normalizeAtmMachineCode`; a repeated
     code → refused `duplicateInRequest` (all but the first); `normalizeScheduleTime` → `'bad'` →
     refused `badTime` (one unreadable time never fails the batch).
  2. Machines = `{ branchId: plan.branchId, machineCode: { $in }, isDeleted: false }`, using
     `ux_branch_code`, `machine.model.ts:45-48`. Refuse a code that is not found (`unknownCode`),
     inactive, or whose bank (DS-3) is missing (`noRegisterBank`) or not the plan's (`otherBank`).
  3. Refuse a machine with no layout (`noLayout`) or no planned slot (`noFillableSlot`).
  4. Build each candidate as a draft line:
     - machine and layout snapshot, with `layoutRevision` (DS-29);
     - counts from `fillFromStandard` with the machine's profile when it is a live profile of
       (branch, bank), else the bank default, else all 0 (`EMPTY_LINE` until edited);
     - `countsSource: 'standard'`, `standardLoadId` = the profile used, `standardNotes` = its notes;
     - `egpTotalMinor = lineEgpTotalMinor(slots)`.
  5. In one `unitOfWork`, the callback building everything afresh on each attempt:
     1. `findOneAndUpdate({ _id: planId, isDeleted: false }, { $inc: { lastPosition: k } }, { new:
        true, session })` FIRST. Two concurrent adds meet a write conflict on the plan here, and
        `withTransaction` retries the loser (`unit-of-work.ts:9`), whose new attempt reads the
        winner's committed lines (`fleet/custody/custody-counter.model.ts:4-9` explains the shape).
     2. Re-read, in the session, the plan's live machine lines (`machineId`, `run`) and its live
        line count. Drop the candidates now `duplicateInRun`. When live + accepted > 400 → throw
        422 `ATM_PLAN_FULL` (nothing written).
     3. Insert the accepted lines with positions from `lastPosition − k + 1` (a dropped candidate
        leaves a gap; positions only order).
     `ux_plan_machine_run` is the backstop: an E11000 aborts the transaction and is answered,
     outside it, as 409 `STALE_DOCUMENT`.
  6. After commit: one `create` audit per line on `{ entityType: 'planLine', entityId: lineId }`
     with `{ machineCode, run, scheduleTime, notes per slot }`.
- **Add spare line (S15).**
  - `layoutIssues(slots, { spare: true })` must be empty.
  - Counts come from the profile (when given) through `fillFromStandard`, then `denominationNotes`
    (split by `splitByDenomination`), then `notes` overrides. A `notes` slot that is not one of the
    line's slots → 400 `UNKNOWN_SLOT`; one that is not planned → 400 `SLOT_NOT_FILLABLE`.
  - `typeLabel` is required; `spareCode` is optional. The insert runs in the S14 callback shape
    (the plan's `$inc` first, then the 400-line check).
- **Update a draft line (S16).**
  - The line is loaded with `{ _id: lineId, planId, isDeleted: false }` plus the read match (404).
    The status must be `draft` (else 409 `ATM_PLAN_LINE_STATE`).
  - Changes are applied in order:
    1. `refreshLayout` re-snapshots the machine and the layout (slots, three labels,
       `layoutRevision`), then refills from `line.standardLoadId ?? layout.standardLoadId ?? the
       bank default` (the first of those that is still a live profile of the branch and bank), with
       `countsSource: 'standard'` and new `standardNotes`. Manual counts are replaced; the web warns
       first (§9.4).
    2. `standardLoadId` (a profile, or null for the layout's or bank's default) refills the same
       way.
    3. `denominationNotes` set each listed denomination's planned slots by `splitByDenomination`
       (S-4); `countsSource: 'manual'`.
    4. `notes` override single slots; `countsSource: 'manual'`. `UNKNOWN_SLOT` /
       `SLOT_NOT_FILLABLE` as in S15.
  - Changing `run` re-checks `DUPLICATE_IN_RUN` → 422; `ux_plan_machine_run` answers the race (409
    `STALE_DOCUMENT`).
  - Write with `{ _id, planId, status: 'draft', __v: version, isDeleted: false }`. Recompute
    `egpTotalMinor`. Audit `update` with the diff.
- **Delete a draft line (S17).** Draft only, `{ _id, planId, status: 'draft', __v, isDeleted: false
  }`. Soft delete, audit `delete`.
- **Issue (S18).**
  1. The plan is in reach, and manage reaches its branch.
  2. Every listed line is a live draft of this plan with the given version, otherwise 409
     `STALE_DOCUMENT` and nothing is written (a hint; step 5 is the guard).
  3. Re-check plannability (machine live and active, bank, layout) and compute
     `planLineIssues`. Any error → 422 `ATM_PLAN_ISSUE_BLOCKED` with details per line. Warnings
     do not block; the web showed them first (§9.4).
  4. Outside the transaction: `ensureNoteCounter('atm-note:<branchId>:<bankCode>', floor)` (§4.9).
  5. In one `unitOfWork`:
     - `counter = findOneAndUpdate({ key }, { $inc: { seq: n } }, { new: true, session })`;
       `first = counter.seq − n + 1`. Two issues of the same branch × bank conflict here and are
       serialised by the retry;
     - order the lines by (`run`, `scheduleTime` nulls last, `position`) and give them
       `first … first + n − 1`;
     - per line: `updateOne({ _id, planId, status: 'draft', __v: version, isDeleted: false },
       { $set: { status: 'issued', serial, issuedAt/By/ByName, slots[].bag from bagAllocation },
       $inc: { __v: 1 } })`; `matchedCount ≠ 1` throws `StaleDocumentError`, which also takes the
       counter's increment back. A PATCH that committed in between is therefore never overwritten;
     - per line: insert its preparation with the bags from `bagAllocation` (`qr: null`, `qrKey:
       null`), one `seals` entry per bagged slot (`value: null`, `key: null`) and `status: 'open'`.
     The callback builds a fresh pending-audit list on each attempt (`withTransaction` may retry,
     `unit-of-work.ts:9`).
  6. After commit: one `statusChange` audit per line, `[{ field: 'status', old: 'draft', new:
     'issued' }, { field: 'serial', old: null, new }]`, and the day signals (§6.11).
- **Reopen (S19).**
  - Only an `issued` line whose preparation is `open` and holds no value. A `prepared` line, or any
    captured value → 409 `ATM_PLAN_LINE_HAS_CAPTURES`.
  - In one transaction:
    - the line: `updateOne({ _id, planId, status: 'issued', __v, isDeleted: false }, { $set: {
      status: 'draft', serial: null, 'slots.$[].bag': null, notePrintCount: 0, notePrintedAt: null },
      $push: { voidedSerials: { serial, printCount: notePrintCount, at, byName, reason } }, $inc: {
      __v: 1 } })`; a miss → `StaleDocumentError`;
    - the preparation: soft-delete with `updateOne({ lineId, status: 'open', __v: prepVersion,
      isDeleted: false, 'bags.qr': { $not: { $type: 'string' } }, 'seals.value': { $not: { $type:
      'string' } } }, …)`; a miss → 409 `ATM_PLAN_LINE_HAS_CAPTURES` (a P3 save landed in between);
    - soft-delete the line's live route assignment, if any.
  - Audits: `statusChange` on the line with `[{ field: 'status', old: 'issued', new: 'draft' },
    { field: 'serial', old: N, new: null }]` and the reason; `delete` on `{ entityType:
    'linePreparation', entityId: preparationId }`; `delete` on `{ entityType: 'routeAssignment',
    entityId: lineId }` when one existed.
- **Cancel (S20).**
  - Allowed from `issued` or `prepared`.
  - In one transaction:
    - the line: `updateOne({ _id, planId, status: { $in: ['issued', 'prepared'] }, __v, isDeleted:
      false }, { $set: { status: 'cancelled', cancelled*, cancelReason }, $inc: { __v: 1 } })`;
    - the preparation: `updateOne({ lineId, isDeleted: false }, { $inc: { __v: 1 } })`, so a P3 or
      P4 in flight with the old version fails and then sees the cancelled line. The preparation is
      kept: its values stay searchable as duplicates (GS-7);
    - soft-delete the line's live route assignment.
  - The serial stays on the line and is never reused. Audits: `statusChange` on the line, and
    `delete` on `routeAssignment` when one existed.
- **Spare use (S21).**
  - The line is a spare and `issued` or `prepared`.
  - The machine is found by code in the plan's branch, live, active and of the plan's bank;
    otherwise 422 with `unknownCode` / `inactive` / `noRegisterBank` / `otherBank`.
  - Set `spareUse` (a correction replaces it) with `{ _id, planId, kind: 'spare', status: { $in:
    ['issued', 'prepared'] }, __v, isDeleted: false }`. Audit `update`.

### 6.6 Spare sets (S-9)

A spare line has no machine. Its Note prints `spareCode` (or «—») in «رقم الماكينة», the i18n text
«طقم سبير» plus `typeLabel` in «إسم الماكينة», `typeLabel` in «البنك», and nothing in «المنطقة» or
after «هذة الماكينة تحتوى على» (§8.2). It is bagged and sealed like any line.

«بيان التغذية»'s machine count adds one per spare line (accepted improvement; the NBE/CIB/HDB
`COUNTIF(…,"SP")` precedent).

Recording the machine (S21) changes no count and no Note. It is the record S-9 asks for. The phase-4
board link will read it.

### 6.7 Prints — `settlements/prints/print.service.ts`

`POST /plans/:planId/prints` (S22). The plan is read through
`branchScopeMatch(scopeSelector(ctx, 'atmSettlementPlan.view'))` (404 outside). Each kind then
requires its key to REACH the plan's branch: `keyReachesBranch(ctx, key, plan.branchId)`, otherwise
403 (§6.2). A user with organization view and own-scope print therefore prints nothing.

| Kind | Key | Lines | Returns | Side effects |
|---|---|---|---|---|
| `notes` | `atmSettlementPlan.print` | `lineIds` (each issued or prepared of this plan, else 422 `ATM_PLAN_LINE_STATE`), or `unprintedOnly` (`notePrintCount = 0`), or every issued and prepared line | `AtmNotePrintDto` in serial order; planned slots only; `bagCount = max(bag)` | In one `unitOfWork`: `updateMany({ _id: { $in: ids }, planId, status: { $in: ['issued', 'prepared'] }, serial: { $in: printedSerials }, isDeleted: false }, { $inc: { notePrintCount: 1 }, $set: { notePrintedAt } })` (no `__v` bump: print tracking is not an edit); `matchedCount < n` throws `StaleDocumentError` → 409 and nothing is returned (a reopen landed between the read and the print). Then one `atmSettlementPrint` audit on `{ entityType: 'settlementPlan', entityId: planId }` with `{ kind, lines: [{ lineId, serial, version }] }` |
| `receipt` | `atmSettlementPlan.print` | issued + prepared | `AtmReceiptPrintDto`: the six rows (`receiptRows`), `egpTotalMinor`, `machineCount` (`receiptMachineCount`), `serials`, `excludedDraftLines`, and `previous` (the last receipt print) | `$set receiptPrint: { at, byName, serials }` on the plan (no `__v` bump); audit `atmSettlementPrint` `{ kind, rows, egpTotalMinor, machineCount, lines: [{ lineId, serial, version }] }` |
| `handover` | `atmSettlementPlan.print` | issued + prepared, serial order | `AtmHandoverPrintDto` with `withQr: false`: the blank QR column, as Settlements hands it out today | `$set handoverPrint` on the plan; audit with `lines: [{ lineId, serial, version, preparationVersion }]` |
| `repTape` | `atmSettlementPlan.export` | issued + prepared, serial order | `AtmRepTapeExportDto`: physical slots 1..n (§8.5 blanks), `byDenomination`, `comment = repTapeComment(time)`, `dep = area`, `typeLabel` and `hubLabel` for ATM_2 | audit `export` (the register export shape, `register-export.ts:112-123`) with the serials |

Control & Supplies prints through C7 (§6.9). Its `handover` is `withQr: true` and needs
`atmControl.print` reaching the plan's branch.

**What the receipt covers.** S-5 allows one «بيان التغذية» per bank per day, and lines may be issued
or cancelled after it is printed. The plan keeps the serials the last receipt covered;
`summary.receiptStale` and the print dialog show when the paper and the plan no longer agree, and
the dialog shows the last print («آخر طباعة») before printing again. Whether a late line gets a
replacement or a supplementary paper is GS-27.

### 6.8 Preparation — `settlements/preparation/preparation.service.ts`

- **Context (P1).** The branch is `resolveWorkBranch(ctx, 'atmPreparation.view',
  'atmPreparation.capture')` (blocked → 422 `ATM_WORK_BRANCH_REQUIRED`). Without `date`, the day is
  the suggested one (DS-25): the earliest `replenishDate ≥ today (Cairo)` among that branch's plans
  of the enabled banks that has a line in `issued`, else tomorrow; `ix_branch_date` serves it. It
  returns the plans of that branch and day that have at least one issued, prepared or cancelled
  line, with their status counts, and `canCapture = keyReachesBranch(ctx, 'atmPreparation.capture',
  branch)`.
- **Lines (P2).** The plan is read through `atmPreparation.view`'s match. Lines with status
  `issued`, `prepared` or `cancelled` (never drafts), in serial order, each with its preparation
  and its `voidedSerials` (the serial box resolves a voided number to the line, §9.6). Duplicates
  are computed for the whole list with the two aggregations below.
- **Save (P3).**
  1. Load the preparation by `lineId` through the read match. The line must be `issued` and the
     preparation `open`; otherwise 409 `ATM_PREPARATION_LOCKED` (prepared, cancelled) or
     `ATM_PLAN_LINE_STATE`.
  2. `bags[].bag` must be exactly the preparation's bag numbers, and `seals[].slot` exactly its
     bagged slots (400 `{ field, code: 'UNKNOWN_BAG' | 'UNKNOWN_SLOT' }`).
  3. Clean each value with `cleanScannedValue` and check it with `AtmBagQrSchema` /
     `AtmSealValueSchema` (§3.5). An invalid value → 400 `{ field: 'seals[i].value', code:
     'INVALID_SEAL' }`; the message never repeats the value. Compute each `key` / `qrKey` with
     `sealKey`, and the `ARABIC_LETTERS` warnings.
  4. In one transaction: `updateOne({ _id, lineId, status: 'open', __v: version, isDeleted: false },
     { $set: { bags, seals, lastCapturedAt, lastCapturedByName }, $inc: { __v: 1 } })`; a miss →
     409. Cancel (S20) bumps this `__v` and reopen (S19) soft-deletes the document, so a save can
     never land on a cancelled or reopened line.
  5. Audit `update` on `{ entityType: 'linePreparation', entityId: preparationId }` with the
     field-level diff (`bags.1.qr`, `seals.3.value`).
  6. Respond with the line DTO, its `warnings` and its `duplicates`.
- **Duplicate rule (DS-15).** For a set of keys (one line's on a save, the list's on P2 and C1):
  - **Two aggregations, one per field**, each bounded:
    `$match { isDeleted: false, 'seals.key': { $in: keys } }` → `$unwind '$seals'` →
    `$match { 'seals.key': { $in: keys } }` → `$sort { createdAt: -1 }` →
    `$group { _id: '$seals.key', top: { $topN: { n: 6, sortBy: { createdAt: -1 }, output:
    { lineId, planId, branchId, bankCode, replenishDate, slot: '$seals.slot' } } } }`; the same over
    `bags.qrKey`. Only those five fields leave the database; the matched lines' `serial`,
    `machineCode`, `spareCode` and `status` are then read with a projection. `$topN` needs mongod
    5.2+; the test and production servers run 7.0.
  - **Every key is looked up in BOTH aggregations.** A QR that matches a seal (or a seal a QR) is
    marked `crossKind`.
  - **Inside the line:** the same key on two fields of this preparation is `{ sameLine: true,
    otherField }`, across kinds too.
  - At most 5 matches per value, newest first, excluding the field itself.
  - A match whose `branchId` is outside `branchScopeBranches(scopeSelector(ctx, viewKey))` of the
    calling page (`atmPreparation.view` or `atmControl.view`) is `{ outsideReach: true }`.
  - Cancelled lines' values are included and labelled by `lineStatus` (GS-7).
- **Mark prepared (P4).**
  - Every bag for which `bagNeedsQr` holds has a QR, and every bagged slot whose notes are above 0
    has a seal (DS-13, DS-16). Otherwise 422 `ATM_PREPARATION_INCOMPLETE`, details `{ field:
    'bags[0].qr' | 'seals[slot=3]', code: 'REQUIRED' }`.
  - In one transaction: the preparation `updateOne({ _id, status: 'open', __v: version, isDeleted:
    false }, { $set: { status: 'prepared', prepared* }, $inc: { __v: 1 } })` (a miss → 409
    `STALE_DOCUMENT`), and the line `updateOne({ _id: lineId, status: 'issued', isDeleted: false },
    { $set: { status: 'prepared' }, $inc: { __v: 1 } })` (a miss → 409 `ATM_PLAN_LINE_STATE`).
  - Audit `statusChange` on both.
- **Reopen (P5).** Only a prepared line → back to `open` / `issued`, in one transaction: the
  preparation with `{ _id, status: 'prepared', __v: version, isDeleted: false }` and the line with
  `{ _id: lineId, status: 'prepared', isDeleted: false }` (a cancelled line never matches). Audit
  `statusChange` on both. There is no date lock (GS-16).

### 6.9 Control & Supplies — `settlements/control/control.service.ts`

- **Day (C1).**
  - The branch is the narrowed query branch, or `resolveWorkBranch(ctx, 'atmControl.view',
    'atmControl.manage')` (blocked → 422 `ATM_WORK_BRANCH_REQUIRED`). Without `date`, the day is
    suggested as in P1 (DS-25).
  - Plans of every enabled bank for that date. Their issued, prepared and cancelled lines, with
    preparations, the live assignments of NON-cancelled lines, and the duplicates computed as in
    §6.8 (scoped by `atmControl.view`).
  - The routes of that branch-day, in `order`, with counts over non-cancelled lines (`lines`,
    `machines`, `bags`, `notPrepared`), and `unassigned` = non-cancelled lines with no assignment.
  - `can.manage` / `can.print` = `keyReachesBranch` of each key on the branch. `can.zones` = the
    branch is in `branchScopeBranches(scopeSelector(ctx, 'atmMap.view'))`; only then do lines carry
    `zoneName` (their primary zone, DS-17).
- **Routes (C2, C4, C5).**
  - Create needs `canWrite` and the body branch equal to the work branch. The new route gets
    `order` = max + 1, `zoneId: null` and `nameKey`.
  - Names are unique per branch-day: `ux_branch_date_name`; the E11000 aborts the transaction and
    is answered, outside it, as 400 `DUPLICATE_NAME`. The 100-route cap is counted inside the create
    transaction. It is a sanity cap (DS-30), not a guard: two creates at the same instant may pass it
    by one, and nothing depends on it.
  - Update writes with `{ _id, __v, isDeleted: false }` and recomputes `nameKey`.
  - Delete soft-deletes the route and its live assignments in one transaction (`{ _id, __v,
    isDeleted: false }` on the route); their lines return to «لم يُوزّع بعد».
  - Audits: `create` / `update` / `delete` on `{ entityType: 'dispatchRoute', entityId }`, and one
    `delete` on `{ entityType: 'routeAssignment', entityId: lineId }` per assignment a delete
    removed.
- **Assignments (C6).**
  1. Every `lineId` is an issued or prepared line of the body branch and date (else 400 `{ field:
     'moves[i]', code: 'LINE_STATE' }`).
  2. Every non-null `to` is a live route of the same branch-day; otherwise 400 `{ field:
     'moves[i]', code: 'ROUTE_GONE' }`.
  3. In one transaction:
     - for each distinct target route, `updateOne({ _id, branchId, replenishDate, isDeleted: false
       }, { $inc: { __v: 1 } })`; a miss → 400 `ROUTE_GONE`. A concurrent C5 delete therefore
       conflicts with this transaction instead of leaving a line on a deleted route;
     - for each move, the line's current live assignment must equal `from` (null = none); a
       mismatch → 409 `STALE_DOCUMENT` with `{ field: 'moves[i]', code: 'MOVED' }`, so two Control
       users never silently overwrite each other;
     - upsert by `ux_line`, or soft-delete when `to` is null.
  4. Audit `create` / `update` / `delete` per move on `{ entityType: 'routeAssignment', entityId:
     lineId }`.
- **From zones (C3, DS-17).**
  1. The work branch must be in `branchScopeBranches(scopeSelector(ctx, 'atmMap.view'))`, otherwise
     403: `authorize('atmMap.view')` only tests that the key is held.
  2. Read the branch's live zones in `order` (`map/zone.model.ts`) and its machines' locations with
     `$and[branchScopeMatch(scopeSelector(ctx, 'atmMap.view')), { branchId }, { isDeleted: false }]`.
  3. Read the unassigned machine lines of the day (issued or prepared) and their machines'
     `atm_machine_locations` with `status: 'located'`. A pin under review counts, as it does on the
     map (`map/map.service.ts:115`).
  4. Primary zone = `zoneMembership(point, zonesInOrder).primary`. `zoneMembership` moves from
     `apps/web/src/modules/atm/lib/map-geometry.ts:157-168` into
     `packages/contracts/src/modules/atm-map-geometry.ts` (with `inBox` and the `Membership` types);
     the web file re-exports it, so the map and this call run the same code. It tests with
     `pointInPolygon` (`atm-map-geometry.ts:206`), the plane the map draws in (zones spec DM-48).
  5. In one transaction: for each zone that has lines, reuse the day's route with that `zoneId`, or
     create one named after the zone (`ux_zone_route` refuses a twin from a concurrent call: E11000
     → 409 `STALE_DOCUMENT`, and the second click finds the routes); check the 100-route cap; then
     assign, each with `from: null` (a line assigned meanwhile is skipped and counted).
  6. Spare lines, unlocated machines and points outside every zone stay unassigned and are counted
     in the response.
  7. Audits: `create` on `dispatchRoute` per route created and `create` on `routeAssignment` per
     line assigned. Zones are read and never written (D-M8).
- **Prints (C7).**
  - `handover`: the plan is read through `branchScopeMatch(scopeSelector(ctx, 'atmControl.view'))`
    and `keyReachesBranch(ctx, 'atmControl.print', plan.branchId)` must hold (403). Returns
    `AtmHandoverPrintDto` with `withQr: true`; `qrs` are filled only for `prepared` lines, every
    other row prints a blank box and counts in `notPrepared`. Sets `handoverPrint` on the plan. One
    `atmSettlementPrint` audit on the plan with `lines: [{ lineId, serial, version,
    preparationVersion }]`.
  - `routes`: the body branch goes through `narrowToBranch(scopeSelector(ctx, 'atmControl.view'),
    body.branchId, 'body.branchId')` and must reach `atmControl.print`. Every route of the day, or
    the listed ones; each route's rows are serial-ordered and exclude cancelled lines; `qrs` as for
    the handover. One `atmSettlementPrint` audit PER PRINTED ROUTE on `{ entityType:
    'dispatchRoute', entityId: routeId }` with its lines and versions.

### 6.10 Request size

The JSON body limit is 1 MB (`apps/api/src/app.ts:167`). The largest body, 400 issue entries or
400 moves, stays below 40 KB. The import is multipart with a 10 MB cap (§5.1); its
`previewRevisions` field is at most 200 KB.

### 6.11 Realtime and web invalidation

**`apps/api/src/platform/realtime/realtime-registry.ts`.** Add these after `'atm.machineLocation'`
(`:32`):

```ts
'atm.cassetteLayout': { permission: 'atmCassetteLayout.view' },
'atm.standardLoad': { permission: 'atmCassetteLayout.view' },
'atm.settlementPlan': { permission: 'atmSettlementPlan.view' },
'atm.planLine': { permission: 'atmSettlementPlan.view' },
'atm.linePreparation': { permission: 'atmPreparation.view' },
'atm.dispatchRoute': { permission: 'atmControl.view' },
'atm.routeAssignment': { permission: 'atmControl.view' },
// Day signals (DS-26): no audit row of their own; each carries the plan's branch.
'atm.preparationDay': { permission: 'atmPreparation.view' },
'atm.controlDay': { permission: 'atmControl.view' },
```

Add `'atm.layoutImport'` to `REALTIME_EXCLUDED_ENTITIES` (after `:256`), with the reason "one audit
row per import run (the register-import shape); the importing screen refetches itself".

**Day signals.** Topic rooms are joined only by holders of the topic's key
(`realtime-registry.ts:14`; `realtime-rooms.ts:29-34`), and the Preparation and Control bundles hold
neither `atmSettlementPlan.view` nor `atmPreparation.view` (§7.1). So, after the commit of S18,
S19, S20, P3, P4, P5 and C6, the service also calls
`publishAuditedChange({ entityRef: { moduleId: 'atm', entityType: 'preparationDay' | 'controlDay',
entityId: planId }, action: 'update', at, branchId: plan.branchId })`: `preparationDay` after S18,
S19 and S20; `controlDay` after S18, S19, S20, P3, P4, P5 and C6. Each call is written with its
literal `{ moduleId: 'atm', entityType: '…' }` pair, so the registry spec's source scan finds both
topics (`realtime-registry.spec.ts:60-80`; a variable entity type would count as a new dynamic
site). The precedent is `fleet/custody/custody-memo-guard.ts:158-170`; the `branchId` reaches branch
rooms (`realtime-publisher.ts:32-36, 67-69`), so branch-scoped users hear them too.

**`apps/web/src/platform/realtime/invalidation-registry.ts`** (`:47-84`):
- `'atm.cassetteLayout'` → `cassetteLayouts`, `cassetteLayout`, `settlementPlan` (a layout change
  raises `LAYOUT_CHANGED`);
- `'atm.standardLoad'` → `standardLoads`;
- `'atm.settlementPlan'` → `settlementPlan`;
- `'atm.planLine'` → `settlementPlan`, `preparationLines`, `preparationContext`, `controlDay`;
- `'atm.linePreparation'` → `preparationLines`, `preparationContext`, `controlDay`,
  `settlementPlan` (its `preparationStatus`);
- `'atm.preparationDay'` → `preparationLines`, `preparationContext`;
- `'atm.controlDay'` → `controlDay`;
- `'atm.dispatchRoute'` and `'atm.routeAssignment'` → `controlDay`;
- extend `'atm.machine'` (`:50-55`) with `cassetteLayouts`.

`realtime.spec.ts` requires a row for every server topic and none for an unknown one.

**Limitation (G-11).** Audit signals carry no branch (`platform/audit/audit.service.ts:179`), so
only organization-wide viewers join the entity topic rooms. The day signals above close that gap
for Preparation and Control; the Preparation and Control pages also refetch every 60 s while the
tab is visible (DS-26).

---

## 7. Permissions, manifest, navigation, settings

### 7.1 `apps/api/src/modules/atm/atm.module.ts`

Add after `locatePermissions` (`:191-207`), each with a one-line comment naming this spec:

```ts
const layoutPermissions = declarePermissions('atm', 'atmCassetteLayout',
  { en: 'ATM cassette denominations', ar: 'فئات كاسيتات الماكينات' }, ['view'],
  [{ action: 'manage', name: { en: 'Edit cassette denominations and standard loads',
                               ar: 'تعديل فئات الكاسيتات والحمولات القياسية' } },
   { action: 'import', name: { en: 'Import a bank master workbook',
                               ar: 'استيراد ملف Full list للبنك' } }], 'atm.cassette-layouts');
const planPermissions = declarePermissions('atm', 'atmSettlementPlan',
  { en: 'ATM replenishment plans', ar: 'خطط تغذية الماكينات' }, ['view', 'print', 'export'],
  [{ action: 'manage', name: { en: 'Build, issue, reopen and cancel plan lines',
                               ar: 'إعداد سطور الخطة واعتمادها وإعادتها وإلغاؤها' } }],
  'atm.settlement-plans');
const preparationPermissions = declarePermissions('atm', 'atmPreparation',
  { en: 'ATM bag and seal preparation', ar: 'تجهيز الشوالات والسيلزات' }, ['view'],
  [{ action: 'capture', name: { en: 'Record bag QR codes and cassette seals',
                                ar: 'تسجيل QR الشوالات وسيلزات الكاسيتات' } }], 'atm.preparation');
const controlPermissions = declarePermissions('atm', 'atmControl',
  { en: 'ATM control and supplies', ar: 'الرقابة والمستلزمات' }, ['view', 'print'],
  [{ action: 'manage', name: { en: 'Create crew lines and distribute the bags',
                               ar: 'إنشاء الخطوط وتوزيع الشوالات عليها' } }], 'atm.control');
```

`export` is a standard action (`packages/contracts/src/permissions/def.ts:9-18`). The `.xlsx` is a
bulk export of the day's per-machine amounts, and the module's precedent gates its export on its
own key (`atmRegister.export`, `register/register-export.ts:77`).

- **`atmPermissions`** (`:214-225`): append the four.
- **`atmPages`** (`:227-277`):

  | id | route | sortOrder | name (en / ar) |
  |---|---|---|---|
  | `atm.settlement-plans` | `/atm/settlements/plans` | 70 | Replenishment plan / خطة التغذية |
  | `atm.cassette-layouts` | `/atm/settlements/layouts` | 75 | Cassette denominations / فئات الكاسيتات |
  | `atm.preparation` | `/atm/preparation` | 80 | Bags and seals / الشوالات والسيلزات |
  | `atm.control` | `/atm/control` | 85 | Dispatch data and lines / بيانات التغذية والخطوط |

- **`routes`** (`:286-298`): add `/atm/settlements`, `/atm/preparation` and `/atm/control`.
- **`collections`** (`:299-310`): add the ten collections of §4.
- **Header comment** (`:1-17`): one line naming this slice.
- No permission name contains a parenthesis (`atm.module.spec.ts:101-105`).

**Intended scopes** (`declarePermissions` stores none; the grant decides):

| Key | Meaningful scopes | Effect |
|---|---|---|
| `atmCassetteLayout.view` / `atmSettlementPlan.view` / `atmPreparation.view` / `atmControl.view` | `branch` (a department's own branch), `organization` | A finer scope narrows to the home branch, and a delegated department copy reads its whole branch. `own` reads nothing (DS-23). |
| `….manage` / `….import` / `….capture` / `….print` / `atmSettlementPlan.export` | `branch`, `organization` ONLY | Writes, prints and the export need `keyReachesBranch` on the record's branch. A `department`-scope grant over the branch never satisfies it (`keyCoversUnit`, `apps/api/src/shared/types/index.ts:162-188`), so such a grant reads and never writes; `own` and `section` likewise. |

Suggested department bundles, for the administrator's grants; the seed widens only super-admin:
- **Settlements & Review:** `atmCassetteLayout.*`, `atmSettlementPlan.*`.
- **Preparation:** `atmPreparation.view`, `atmPreparation.capture`.
- **Control & Supplies:** `atmControl.*`, plus `atmMap.view` for the zones button.
- **ATM vault (read):** `atmControl.view`.

### 7.2 Seed, pinned spec, page registry, permission matrix

- **Super-admin.** `seedAtm` grants every `atmPermissions` key (`atm.seed.ts:17-19`). No code
  change is needed.
- **`atm.module.spec.ts`:**
  - the header comment `:3` becomes "42 permissions, 11 pages, 12 routes, 20 collections, 2
    scheduled tasks";
  - add the 12 keys to the sorted list (`:24-55`), the four page ids after `'atm.register-report'`
    (`:56-64`), the three prefixes (`:65-75`) and the ten collections (`:76-87`).
- **Page registry.** `scripts/check-page-registry.mjs` reads `declarePermissions(` calls and the last
  page-id argument (`:34-61`), and the pages regex (`:24-31`). Run `npm run check:page-registry`.
- **Permission matrix.** It is generated from `platformPermissions` only
  (`scripts/gen-permission-matrix.mjs:10-12`), so `npm run check:permission-matrix` shows no diff.

### 7.3 Navigation — `apps/api/src/seed-navigation.ts`

Append after «تقرير البيانات» (`:1097-1103`), each `permission` equal to the web route guard (§9.1):

```ts
{ en: 'Replenishment Plan', ar: 'خطة التغذية', route: '/atm/settlements/plans', icon: 'receipt', permission: 'atmSettlementPlan.view' },
{ en: 'Cassette Denominations', ar: 'فئات الكاسيتات', route: '/atm/settlements/layouts', icon: 'layers', permission: 'atmCassetteLayout.view' },
{ en: 'Bags and Seals', ar: 'الشوالات والسيلزات', route: '/atm/preparation', icon: 'qr', permission: 'atmPreparation.view' },
{ en: 'Dispatch and Lines', ar: 'بيانات التغذية والخطوط', route: '/atm/control', icon: 'truck', permission: 'atmControl.view' },
```

- All four icons exist (`apps/web/src/platform/navigation/app-icon.tsx:49, 62, 82, 84`).
- `/atm/settlements/layouts/import` gets no row.
- The row count is pinned twice and both move together, as `seed-navigation.spec.ts:52-60` says:
  `seed-navigation.spec.ts:60` changes `130` → `134`, and
  `apps/api/tests/integration/auth-seed-login.spec.ts:36` `SEEDED_APPLICATIONS = 130` → `134`, with
  its breakdown comment (`:268-269`) "… + 17 (ATM) + 10 (Administration) = 134". Add a spec: "offers
  the four settlement rows after the Data Report, in this order, each behind its page key".

### 7.4 Setting — `apps/api/src/modules/atm/atm.settings.ts`

- Add `SettlementBanks: 'atm.settlements.banks'` to `AtmSettingKeys`
  (`packages/contracts/src/modules/atm.ts:769-800`).
- Declare it after `RegisterBankLabels` (`atm.settings.ts:53-62`):
  `schema: z.array(AtmBankCodeSchema).max(6)`, `defaultValue: ['BRK']` (S-10),
  `allowedScopes: ['organization']`.
- Description: "The banks the Settlements, Preparation and Control pages offer. Al Baraka first
  (S-10); a bank is added once its import profile exists".
- It is read like `resolveRegisterSettings` reads its settings (`register/register-settings.ts:30`).

---

## 8. Printed papers and the Excel export (WP-S2)

**The print flow** (every paper; DS-21). In the click handler:
1. `win = openPrintWindow(t('common.loading'))`. When it returns null (the browser blocked the tab),
   show the toast `atm.paper.popupBlocked` and send NO request, so nothing is counted or audited.
2. POST the print (S22 or C7). On failure, `win.close()` and show the mapped error.
3. On success, `writePrintWindow(win, html)` with the composed document.

The precedent is `apps/web/src/modules/it/components/useAssetLabels.ts:34-52` and
`it/lib/custody-receipt-print.ts:477-492`. The ATM papers print through one door,
`modules/atm/lib/papers/settlement-print.ts`, which is added to the "one door" list of
`apps/web/src/shared/lib/print-window.spec.ts:137-150`.

**The documents.** Every paper is standalone HTML written into the print tab. It carries no script,
and its buttons use `data-print`/`data-close` (`print-window.ts:1-20, 92-135`). Builders live in
`apps/web/src/modules/atm/lib/papers/` and are pure: `(dto, words) → string`, where `words` is
built with `translate('ar', 'atm.paper.*')` (`apps/web/src/platform/localization/i18n.ts:18305`), so
a user working in English still prints Arabic papers. Every value is escaped.

**The print engine** (each paper states its own values below):
- `@page { size: A4 portrait | A4 landscape; margin: 0 }`, and the paper's block centred on the
  page, as the workbook prints (margins 0, centred).
- `html { -webkit-print-color-adjust: exact; print-color-adjust: exact }`. Chrome drops background
  fills by default; the label fills `#BFBFBF` / `#D9D9D9` and the seals sheet's white-on-black
  header would disappear without it (precedent `it/lib/custody-receipt-print.ts:353-358`,
  `fleet/lib/custody-paper-excel.ts:20`).
- `.page { break-after: page; break-inside: avoid }`, `.page:last-of-type { break-after: auto }`.
- Fonts: the fleet font table (`fleet/lib/custody-paper-fonts.ts`: `STACK`, `PAPER_FACES`,
  `PAPER_FONT_CSS`) is promoted to `apps/web/src/shared/lib/paper-fonts.ts`; the fleet file
  re-exports it, so no fleet caller moves and ATM never imports Fleet. Calibri's Arabic is Segoe UI
  (`custody-paper-fonts.ts:3`).
- Direction: Arabic label cells carry `dir="rtl"`; codes, numbers, dates and QR values are wrapped
  in `<bdi dir="ltr">`.
- **The EGYCASH logo** (`EGYCASH_LOGO`, `apps/web/src/modules/gold/lib/egycash-logo.ts:7`, about
  55 KB of base64) is written ONCE, as a CSS rule in the document's `<style>`
  (`.egc-logo { background-image: url(…) }`), and every page uses `<div class="egc-logo">`. A
  400-Note print stays near one logo's size instead of about 22 MB through `document.write`.

### 8.1 The wording file — `apps/web/src/modules/atm/lib/papers/settlement-paper-wording.ts` (VERBATIM)

The file holds the owner's paper words exactly as printed, typos included (grounding A §1–3).

Add it to `VERBATIM_PAPERS` (`scripts/check-formal-arabic.mjs:147-150`). Then:
- update `apps/web/src/platform/localization/formal-arabic.spec.ts:97-103` to the three files;
- add a sibling test in the style of `formal-arabic.spec.ts:115-123`: every non-spec `.ts` file in
  `modules/atm/lib/papers/` other than the wording file holds no Arabic letter (the `.spec.ts`
  files assert the Arabic words and are excluded).

The guard flags only «إجمالى», «اجمالى» and «الإجمالى» among these words (checked with `offendersIn`
over the list below). The exemption is what keeps them as the owner prints them.

```ts
export const NOTE_WORDS = {
  title: 'محضر جرد ماكينة الصراف الآلى', bagLock: 'رقم قفل الحقيبة', serial: 'مسلسل',
  bank: 'البنك', area: 'المنطقة', bagReturn: 'رقم راجع الحقيبة', machineId: 'رقم الماكينة',
  machineName: 'إسم الماكينة', date: 'التاريخ', cassetteNo: 'رقم الكاسيت', denomination: 'الفئة',
  noteCount: 'عدد ورق البنكنوت', cassetteLock: 'رقم قفل الكاسيت', camera: 'رقم الكاميرا',
  fillTime: 'ساعة التعبئة', techSign: 'توقيع وختم فنى التجهيز', supervisorStamp: 'ختم و إسم مشرف التجهيز',
  unloadTechStamp: 'ختم و إسم فنى التجهيز لتفريغ الماكينة',
  machineTotal: 'إجمالى قيمة الماكينة', egpOnly: 'جنية مصرى فقط لا غير',
  contains: 'هذة الماكينة تحتوى على', depositUnload: 'تفريغ الإيداع', denominations: 'الفئات',
  deposit: 'الإيداع', short: 'العجز', over: 'الزيادة', envelopes: 'إيداع الأظرف', name: 'الإسم',
  time: 'الساعة', cassetteUnload: 'تفريغ كاسيتات الماكينة', divert: 'ديفرت', total: 'اجمالى',
  overShort: 'زيادة', shortShort: 'عجز', dataEntryStamp: 'ختم وإسم مدخل البيانات',
  cards: 'عدد الكروت', result: 'نتيجة جرد الماكينة', match: 'مطابق', shiftManager: 'ختم وتوقيع مدير الوردية',
  reviewer: 'ختم وإسم المراجع', techAck: 'توقيع الفنى بالعلم',
} as const;
export const RECEIPT_WORDS = { titlePrefix: 'بيان مرسل من إدارة الباك أوفيس لتغذية', titleSuffix: 'عن يوم',
  denomination: 'فئة', count: 'عدد ورق', total: 'الإجمالى',
  sentenceStart: 'تم إستلام المبلغ المذكور أعلاه لتغذية عدد', sentenceEnd: 'ماكينة للبنك المذكور',
  supervisor: 'توقيع المشرف / ' } as const;
export const SEALS_WORDS = { footer: 'تم تسليم الخزينة الماكينات الموضحة اعلاه .',
  supervisor: 'توقيع المشرف / ' + '.'.repeat(54), shortBankName: { BRK: 'البركة' } } as const;
```

`SEALS_WORDS.supervisor` is `سيلزات!D104` exactly: the words, a space, a slash, a space and 54 dots.
The bank name inside the receipt title is `ATM_BANK_NAMES[bank].ar`
(`packages/contracts/src/modules/atm-register.ts:34-41`; BRK → «بنك البركة», as the paper types it).
Words that are new on a paper come from i18n `atm.paper.*` (§9.9), always in Arabic.

### 8.2 The Note — `papers/note-print.ts` (one A4 portrait page per line)

**Grid.** 13 columns A–M with the paper's width shares, from `Print`'s `<cols>` (E, F and G are
each 19.71 characters, one `<col min="5" max="7">` element):

| A | B | C | D | E | F | G | H | I | J | K | L | M |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2.6 % | 6.6 % | 8.4 % | 6.2 % | 8.9 % | 8.9 % | 8.9 % | 5.7 % | 8.9 % | 11.6 % | 12.0 % | 8.8 % | 2.6 % |

The block is about 169 mm wide; columns A and M are gutters.
- `@page { size: A4 portrait; margin: 0 }`, the block centred.
- The page is LTR, as on paper: each Arabic label sits to the right of its box. All text is
  Calibri bold, borders are 1.5 px (the paper's "medium"), and the label fill is `#BFBFBF`, zebra
  `#D9D9D9`.
- Font sizes are the paper's Excel points × 0.41: the title 26 → 10.7 pt; labels 24 → 9.8 pt;
  cassette digits 36 → 14.8 pt.
- **Rows for more than 4 cassettes.** n = the number of planned slots, k = max(0, n − 4). Paper row
  r prints at r for r ≤ 21, at r + 2k for 22 ≤ r ≤ 58, and at r + 4k for r ≥ 59. The filling rows
  14 … 13 + 2n and the unload rows 51 + 2k … 50 + 2k + 2n hold one cassette per 2 rows. A box that
  spans a moved row moves its edge with it (B49:C58 → B(49 + 2k):C(58 + 4k)).
- **Row unit** `u = min(3.75 mm, 270 mm / R)` with `R = 72 + 4k`. Fonts scale by `u / 3.75 mm`, so an
  8-cassette Note still fits one page (DS-19).

**Row map.** Rows are the paper's (grounding A §1), moved by the rule above.

| Rows | Content | Source |
|---|---|---|
| 1–3 | EGYCASH logo at A1 (`.egc-logo`). Title E2:I3 `NOTE_WORDS.title` in a box. J1:L3: the bank's Arabic name in place of the bank logo (DS-18). | — |
| 5 | Shaded labels: K5:L5 bagLock · J5 serial · G5:I5 bank · E5:F5 area · B5:D5 bagReturn | — |
| 6–7 | K6:L7 blank, split into «1»/«2» halves when the line has 2 bags · J6:J7 **serial** · G6:I7 `typeLabel` (blank prints blank) · E6:F7 `hubLabel ?? area` · B6:D7 blank (split like K6:L7) | DS-11, DS-5 |
| 9–10 | L label machineId → K9:K10 `machineCode` (spare: `spareCode` or «—») · J label machineName → E9:I10 `machineName` (spare: `atm.paper.spareSet` + `typeLabel`) · D label date → B9:C10 **replenishment date** `d/m/yyyy` | accepted improvement, DS-18 |
| 11 | B11:L11 run band, centred: `atm.paper.run.{1,2,3}` + ` — ` + `atm.paper.at` + time (12 h, «ص»/«م»). Without a time, the run only. | S-5 |
| 12–13 | Headers L cassetteNo · K denomination · J noteCount · G:I cassetteLock · F `atm.paper.bag` «الحقيبة» (only when 2 bags) · E camera + D blank · C fillTime + B «:» | DS-19 |
| 14 … 13+2n | One planned slot per 2 rows, zebra on even cassettes: L slot number (36 pt) · K denomination (36 pt) · J notes `#,##0` (36 pt) · G:I blank seal box · F bag number when 2 bags. Signature boxes B15:E19 techSign and B21:E25 supervisorStamp stay anchored to row 14. For n < 4 the unused rows stay blank, without boxes. | S-6 |
| 22–23 | K:L machineTotal · I:J `fromMinorUnits(egpTotalMinor)` as `#,##0` (28 pt, top border only) · F:H egpOnly (right-aligned, no border) | DS-28 |
| 24–25 | J:L contains → G:I `featuresLabel` (blank prints nothing) | DS-5 |
| 27 … 72 | The return half exactly as the paper: depositUnload band; denominations 5…200 in L31:L41; B29:E34 `unloadTechStamp` and B37:E42 `supervisorStamp`; row 44 name / camera / time `:` / date `/ /`; cassetteUnload band with **one row per planned slot** (L slot, K denomination); B49:C58 dataEntryStamp; L60 cards; K63:L63 result with match / overShort / shortShort and tick boxes; the three signature boxes. All blank. | §1.3 |
| 72 | G72:I72: the print timestamp in the paper's own explicit format `m/d/yy h:mm:ss` (`Print!G72`, `=NOW()`). Nothing else is added below the block. | DS-18 |

The habits the paper shows and phase 1 does not carry: unused Notes printing 0s (only real lines
print); 0/0 for a missing fourth cassette (only planned slots print); 0 for a blank bank (it prints
blank).

### 8.3 «بيان التغذية» — `papers/receipt-print.ts` (A4 landscape, one page)

- `@page { size: A4 landscape; margin: 0 }`, fit to one page, centred. Calibri; column shares A
  11.8 · B 10.3 · C 8.8 · D 10.3 · E 8.8 · F 10.3 · G 8.8 · H 10.3 · I 8.8 · J 11.8 %.
- A thin frame B2:I24.
- I3, right-aligned, bold 16 pt: `titlePrefix + ' ' + bankNameAr + ' ' + titleSuffix`. B3:C3, bold
  16 pt, holds the PRINT day `d/m/yyyy`, as the paper's `=TODAY()` (GS-28).
- Row 7 (regular 16 pt): F7:H7 `denomination`, C7:E7 `count`. Rows 8–13 hold 200, 100, 50, 20, 10,
  5 in F and the counts in C. The 20/10/5 rows are SUMMED (accepted improvement).
- Row 14: F14 `total`, C14 `fromMinorUnits(egpTotalMinor)` as `#,##0`.
- Row 16: one RTL sentence: `sentenceStart` (bold 12) + `machineCount` (bold 16) + `sentenceEnd`
  (bold 12). The count is distinct machines plus spare lines (accepted improvement).
- G19: `supervisor` (bold 12).
- The paper's white helper row 26 is not carried.
- When `excludedDraftLines > 0`, or a previous print exists (`previous`), the print dialog says so
  before printing (§9.4); the paper itself carries nothing extra.

### 8.4 «سيلزات» (handover to the ATM vault) — `papers/handover-print.ts` (A4 portrait)

`@page { size: A4 portrait; margin: 0 }`, centred; the header row repeats on every page (`thead`).

**Columns, LTR as the paper:**

| A ID | B LOC | C `atm.paper.runShort` | D Total | E bag QR | F TYPE | G HUB |
|---|---|---|---|---|---|---|
| 9.8 % | 20.2 % | 8 % | 9.3 % | 28.6 % | 12.6 % | 11.5 % |

- Header row: black fill, white Tahoma 13 → 10 pt print, bold. Header text: `ID`, `LOC`, the run
  label, `Total`, the PRINT day `d/m/yyyy` (the paper's D1, `=TODAY()`, GS-28),
  `SEALS_WORDS.shortBankName[bank]` (the paper's E1, over TYPE), `HUB`.
- **Rows**, in serial order, Calibri 13 → 10 pt bold (the header's scale), centred:
  - `machineCode` (spare: `spareCode` or «—»), `machineName`;
  - the run in compact form, «2 · 9:00 م» (the run number, a middle dot, the 12-hour time), which
    fits the 8 % column;
  - total `#,##0` from `fromMinorUnits`;
  - the bag QR. With `withQr`, a prepared line prints its QR, and with two bags «1: …» and «2: …» on
    two lines; a line that is not prepared prints a blank box (§6.9). Without `withQr`, the box is
    blank for handwriting, as today.
  - `typeLabel`, `hubLabel ?? area`.
- Thin rules between rows and a medium outer frame. Only real lines print (no zero rows).
- **Footer**, Arial 22 → 12 pt bold: `SEALS_WORDS.footer`, then `SEALS_WORDS.supervisor`.
- **A route sheet** (S-8 b) is the same builder with:
  - each route on its own page (`.page`), with a title line «`atm.paper.routeSheet` {{name}} ·
    {{leader}} · {{date}}» above the table;
  - routes may mix banks (DS-17), so a route sheet adds a narrow «`atm.paper.bank`» column with the
    bank code (taken from LOC's width) and prints the neutral header `TYPE` over F;
  - its own rows (non-cancelled lines only) and the same footer.
  The print dialog confirms first when `unassigned > 0` or a route has `notPrepared > 0` (§9.7).

### 8.5 The `.xlsx` export — `papers/rep-tape-xlsx.ts`

The writer moves from Fleet to `apps/web/src/shared/lib/xlsx-writer.ts`. `fleet/lib/fleet-xlsx.ts`
re-exports it unchanged, so its callers do not move. It gains:

```ts
export type XlsxGridStyle = 'plain' | 'bold' | 'head' | 'headDark' | 'headRed' | 'headBlue' | 'group'
  | 'int' | 'totalInt' | 'dateShort' | 'dateLong' | 'weekday' | 'smallHead';
export interface XlsxGridSheet { kind: 'grid'; name: string; rightToLeft: boolean;
  font: 'tahoma10' | 'calibri13b';                      // the sheet's body font
  columns: { index: number; width: number }[];
  merges: string[];                                     // e.g. 'B6:C6', 'D4:E4'
  cells: { row: number; col: number; value: string | number; style?: XlsxGridStyle }[] }
```

- `buildXlsxBook` accepts both sheet kinds. A book with no grid sheet writes today's `styles.xml`
  byte for byte, so every Fleet export is unchanged (§10.4 pins the bytes). A book with a grid sheet
  writes an extended stylesheet in which the six existing formats keep ids 0–5 (`fleet-xlsx.ts:105`)
  and the new ones follow from 6.
- New fonts: Tahoma 10, Tahoma 10 red `#FF0000`, Tahoma 10 blue `#0000FF`, Tahoma 13 bold white,
  Tahoma 16 bold, Calibri 13 bold. New fills: black, `#FFCC00`, `#C6EFCE`.
- Number formats: `int` = built-in 3 (`#,##0`); `dateShort` = built-in **14**, Excel's short date,
  which follows the reader's regional setting exactly as `REP. TAPE!O8` does today; `dateLong` =
  custom `[$-409]d/mmm/yy;@` (`REP. TAPE!D4`), declared in `<numFmts>` with id 164. A date cell
  holds the Excel serial number of the Cairo day (days since 1899-12-30), never text.
- Text escaping also removes the characters XML 1.0 forbids (U+0000–0008, U+000B, U+000C,
  U+000E–001F, U+FFFE, U+FFFF, lone surrogates); the current `esc` (`fleet-xlsx.ts:67-72`) does not,
  and one such character would corrupt the file. A string without them comes out as today.
- The file name is `REP TAPE BRK dd-mm-yyyy.xlsx`, the owner's own naming (`26-10-2026 brk.xlsx`);
  `xlsxFilename` (`fleet-xlsx.ts:311`) would give `…-YYYY-MM-DD` and is not used.

**Sheet `REP. TAPE`** (LTR, Tahoma 10):
- B4 `Date of cash fill:`; D4:E4 (merged) the replenishment date (`dateLong`, Tahoma 16 bold, fill
  `#FFCC00`); F4:G4 (merged) the English weekday of that date.
- Row 6 (merged groups): B6:C6 ` ATMs` (with the leading space), D6:E6 `Cassette 1`, F6:G6
  `Cassette 2`, H6:I6 `Cassette 3`, J6:K6 `Cassette 4`, M6:P6 `EGY Cash`.
- Row 7, exactly: B `Reference`, C `location`, D `No-of bills1`, E `Denom1`, F `No- of bills2`,
  G `Denom2`, H `No- of bills3`, I `Denom3`, J `No- of bills4`, K `Denom4`, L `Total cash fill for
  the ATM`, M `Comments`, N `Dep`, O `Request Date`, P `Bank`; Q blank, as today; **R7:T7 = 200,
  100, 50 as numbers** (`smallHead`). When any exported line has notes in 20, 10 or 5, U7:W7 = 20,
  10, 5 follow.
  - Denom headers are red (`headRed`) and M:P headers blue (`headBlue`).
  - When any line has more than 4 slots, the pairs `No- of bills5` / `Denom5` … up to slot 8 start
    in the first column after the last per-denomination column, with their `Cassette n` group
    headers in row 6 (DS-20).
- From row 8, one row per issued or prepared line in serial order:
  - B: the code (spare: `spareCode` or empty); C: the name;
  - D..K (and on): physical slots, notes then denomination. A trailing run of slots that are not
    planned is blank / blank (today a 3-cassette machine is blank in cassette 4); a non-planned slot
    before a planned one is 0 / 0 (today the reversed machine's empty slot 1 is 0 / 0);
  - L: `fromMinorUnits(egpTotalMinor)` (`totalInt`, fill `#C6EFCE`);
  - M: `repTapeComment(time)`; N: `area` (GS-11); O: the date (`dateShort`); P: the bank's export
    label (BRK → `AlBarka`, a contracts constant from the paper);
  - R:T (and U:W): the line's notes per denomination, as values (`byDenomination`). They equal the
    slot counts summed per denomination, which is what the paper's `R:T` holds and what the
    Inventory and the DR copy.
- The paper's hidden sum rows 109–111, its `D1:G2` table and its logo are not exported: they are
  formulas and configuration, not plan data.

**Sheet `ATM_2`** (LTR, header row 1 `headDark`, body Calibri 13 bold):
- Headers: `ID · LOC · Note 1 · Denom1 · Note 2 · Denom2 · Note 3 · Denom3 · Note 4 · Denom4 ·
  Total · TYPE · HUB`, then `Note 5 · Denom5 …` when needed.
- The same lines and the same blank rule. Total is `fromMinorUnits(egpTotalMinor)` (`int`; Σ notes
  × denomination, as the paper computes it). TYPE is `typeLabel` and HUB is `hubLabel ?? area`
  (grounding A §4: HUB is the Full list `Dep`, not REP. TAPE's N).

### 8.6 Who prints what

| Paper | Page | Key (reaching the plan's branch) | Notes |
|---|---|---|---|
| Notes | plan | `atmSettlementPlan.print` | All, «غير المطبوعة فقط», or the selected lines |
| «بيان التغذية» | plan | `atmSettlementPlan.print` | Issued and prepared lines |
| «سيلزات» (blank QR) | plan | `atmSettlementPlan.print` | Today's paper, for handwriting |
| «سيلزات» (with QRs) | control | `atmControl.print` | The handover to the ATM vault (S-8 a); QRs of prepared lines only |
| Route sheets | control | `atmControl.print` | One page per route (S-8 b) |
| `.xlsx` | plan | `atmSettlementPlan.export` | For Inventory and DR (S-10) |

### 8.7 Where the mockups differ (this spec governs)

- **Note header.** The mockup moved the fields into a new header and dropped the paper's grid. This
  spec keeps the paper's grid and adds the run band and the bag column.
- **Note serial.** The mockup's `BRK-1027-005` form is replaced by the running number (DS-11).
- **Seals sheet columns.** The mockup used «QR الشوال الأول» / «QR الشوال الثاني» columns. This spec
  keeps the paper's single QR column with its date header, and lists two QRs in one cell.
- **Wording.** Mockup strings such as «السيستم» become formal Arabic on screens (§9.9).

---

## 9. Web (WP-S2) — `apps/web/src/modules/atm/`

### 9.1 Routes — `routes.tsx`

- Extend the header list (`:1-29`):
  - `/atm/settlements/plans atmSettlementPlan.view`
  - `/atm/settlements/layouts atmCassetteLayout.view`
  - `/atm/settlements/layouts/import atmCassetteLayout.import`
  - `/atm/preparation atmPreparation.view`
  - `/atm/control atmControl.view`
- Add five `<Route>`s, each wrapped in `<RequirePermission permission=…>` (`RequirePermission.tsx:13-18`).
- Add a spec in the style of `atm-map-navigation.spec.ts:27-60`: the guards, the header list, and
  that every overview card is a served route.

### 9.2 API client and queries — `api/settlements-api.ts`, `api/settlements-queries.ts` (NEW)

**Keys** (`shared/lib/query-keys.ts:4-9`), all module `'atm'`:

| Key | Holds |
|---|---|
| `listKey('atm','settlementContext',{page})` | the Settlements context of one page |
| `listKey('atm','cassetteLayouts',{bankCode,branchId})` | the layouts list |
| `detailKey('atm','cassetteLayout',machineId)` | one layout |
| `listKey('atm','standardLoads',{bankCode,branchId})` | the profiles |
| `listKey('atm','settlementPlan',{bankCode,date,branchId})` | the plan by day |
| `listKey('atm','layoutImportRuns',{bankCode,branchId})` | the import runs |
| `listKey('atm','preparationContext',{date})` | the Preparation context |
| `listKey('atm','preparationLines',{planId})` | Preparation's lines |
| `listKey('atm','controlDay',{date,branchId})` | the Control & Supplies day |

- The import uses `upload()` (`shared/lib/api-client.ts:486`), with the register's FormData pattern
  (`api/register-api.ts:111-126`); every field is a string (`'true'`, the JSON of
  `previewRevisions`), and the work branch is always sent as `branchId`.
- **Mutations invalidate the same families as §6.11:**
  - layout save → `cassetteLayouts`, `cassetteLayout`, `settlementPlan`;
  - standard-load writes → `standardLoads`, `cassetteLayouts`;
  - plan and line writes and the issue → `settlementPlan`;
  - captures → `preparationLines`, `preparationContext`, `controlDay`;
  - route and assignment writes → `controlDay`.
- `preparationLines`, `preparationContext` and `controlDay` set `refetchInterval: 60_000` and
  `refetchIntervalInBackground: false` (DS-26).
- Print mutations have `gcTime: 0` and follow the print flow of §8 (tab first).

### 9.3 Shared pieces — `lib/` (each with a `.spec.ts`) and `components/settlements/`

| File | Responsibility |
|---|---|
| `lib/settlement-dates.ts` | Reuses `cairoDay` / `cairoToday` from `lib/operation-view.ts:18, 82` (never redeclared); adds `cairoTomorrow(now)`, `formatPaperDate('YYYY-MM-DD') → 'd/m/yyyy'`, `formatPaperTimestamp(instant) → 'm/d/yy h:mm:ss'` (Cairo), `formatTime12('21:00', locale) → '9:00 م' / '9:00 PM'`, `runCompact(run, time) → '2 · 9:00 م'`. |
| `lib/settlement-view.ts` | Status labels and tones; `runLabel(n)`; `issueText(issue, t)`; `planState(summary) → 'draft' \| 'issued' \| 'partlyIssued'` (no line issued / every non-cancelled line issued or prepared / some drafts remain); `lineChips(slots)` (denomination × notes, colours per denomination as in the mockup); `bagsText(n)` («شوال واحد» / «شوالان»). |
| `lib/preparation-form.ts` | The capture reducer, pure: field order **per bag, its cassettes in slot order, then its QR** (bag 1 cassettes → bag 1 QR → bag 2 cassettes → bag 2 QR; GS-32); `nextField(current)`; `sealKeyAction(key) → 'next' \| 'none'` (Enter, or a Tab a scanner appends, → `'next'` with `preventDefault`, so Enter never submits the form); `localDuplicates(values)` over every field of the line by `sealKey`, a QR against the seals included; `localWarnings(values)` (`ARABIC_LETTERS`); `requiredMissing(prep, slots)` (the server's rule, DS-13, with `bagNeedsQr`); `seedOnce(line)` and `mergeAfterConflict(local, fresh)` (§9.6); `cleanScannedValue` / `sealKey` re-exported from contracts. |
| `lib/papers/*.ts` | §8 builders and the one print door `settlement-print.ts`; `settlement-paper-wording.ts` is the only non-spec file with Arabic letters. |
| `components/settlements/SlotEditor.tsx` | One slot row: kind, denomination, currency. Used by the layout editor and the spare dialog. |
| `components/settlements/LineChips.tsx` | The cassette chips. |
| `components/settlements/RunChip.tsx` | «التغذية الأولى» … with its time. |
| `components/settlements/SealInput.tsx` | The wedge input (§9.6). |
| `components/settlements/DuplicateNote.tsx` | The duplicate warning text for one field. |
| `components/settlements/ReasonDialog.tsx` | The reason prompt for reopen and cancel. |

### 9.4 `pages/SettlementPlanPage.tsx` — «خطة التغذية» (`/atm/settlements/plans`)

**Header.**
- `PageHeader title` «خطة التغذية».
- `figures` (counts only, `PageContainer.tsx:64-67`): «الماكينات» (distinct), «التغذيات» (lines),
  «الشوالات». The money total stays in the footer.
- `actions`, each shown by its key (`can.print` / `can.export`) and enabled when issued lines exist:
  - «طباعة بيان التغذية»;
  - «طباعة النوتس ({{count}})», a menu: «كل النوتس» / «غير المطبوعة فقط ({{n}})» / «السطور
    المحددة»;
  - «طباعة شيت السيلزات»;
  - «تصدير Excel (شكل REP. TAPE)».
- Every print follows §8's flow: the tab opens in the click, a blocked tab shows «المتصفح منع فتح
  نافذة الطباعة. اسمح بالنوافذ المنبثقة لهذا الموقع ثم أعد المحاولة.» and sends nothing.
- When `summary.receiptStale` (or `handoverStale`): a notice «تغيّرت السطور المعتمدة بعد آخر طباعة
  لبيان التغذية ({{at}}).» (or «… لشيت السيلزات …»).

**Toolbar.**
- «البنك» (enabled banks; remembered).
- «تاريخ التغذية» (default tomorrow, DS-25).
- The state chip «مسودة» / «معتمدة» / «معتمدة جزئيًا».
- With manage: «+ إضافة ماكينات», «+ سطر سبير», «اعتماد الخطة ({{n}})» (draft lines).
- When the context is blocked (or a read answers `ATM_WORK_BRANCH_REQUIRED`), the page shows
  «اختر فرعًا محددًا من القائمة العلوية.» and nothing else.

**No plan.** «لا توجد خطة لهذا اليوم.» and, with manage, «إنشاء الخطة».

**Table** (one row per line):
- columns «مسلسل» («—» for a draft), «رقم الماكينة», «اسم الماكينة», «التغذية», «الكاسيتات (الفئة ×
  عدد الورق)», «الشوالات», «الإجمالي», «الحالة»;
- an issue icon with the count of errors and warnings;
- a checkbox column for printing a selection;
- a click selects the line.

**Side panel** (selected line):
- the title (code, run and time), then name · area;
- per bag «الشوال الأول — الكاسيتات 1 إلى 4»;
- per slot: «كاسيت n», the denomination chip, a notes input (step 100, draft only) and the value;
- for a denomination held by more than one cassette, «إجمالي فئة {{d}}» (draft only), which splits
  evenly (`denominationNotes`, S-4), and the split note: «في هذه الماكينة أكثر من كاسيت بالفئة
  نفسها ({{list}}). يُقسَّم عدد الفئة عليها بالتساوي مقرّبًا إلى أقرب 100 ورقة، ويمكن تعديل أي كاسيت
  قبل الاعتماد.»;
- «الحمولة القياسية» select («الافتراضية للبنك» + profiles by total), which refills;
- «إجمالي الماكينة»;
- the issues list;
- actions by status:
  - draft: «تحديث من فئات الماكينة» (`refreshLayout`, shown on `LAYOUT_CHANGED`; when
    `countsSource` is `manual` it confirms «ستُستبدل الأعداد المعدّلة يدويًا بأعداد الحمولة القياسية.»)
    and «حذف السطر»;
  - issued: «إعادة إلى المسودة» (reason) and «إلغاء السطر» (reason); on
    `LAYOUT_CHANGED_AFTER_ISSUE` the issue text says to reopen and reprint;
  - prepared: «إلغاء السطر»;
  - spare, issued or prepared: «ربط بماكينة».

**Footer.** «إجمالي الخطة:» with «فئة {{d}}: {{n}} ورقة = {{v}}» per denomination, then the total
and the machine count. Values go through `fromMinorUnits` once, then `formatMoney` (DS-28).

**Dialogs.**
- `AddMachinesDialog`:
  - «أرقام الماكينات» (one per line) and «الساعة (اختياري)», aligned by line with
    `LineListInput` and the pairing of `OpenReplenishmentsForm.buildReplenishmentRows`
    (`components/OpenReplenishmentsForm.tsx:23-35`), plus «التغذية» (1/2/3) for the batch. Times
    such as `9:00`, `9:00 PM` or `9:00 م` are accepted (§3.6);
  - the result lists «أُضيف n» and every refused code with its reason (an unreadable time is
    `badTime`).
- `SpareLineDialog`: «كود السبير (اختياري)», «النوع» (datalist of the bank's `typeLabel`s), the
  slot rows, «الحمولة القياسية», and the run and time.
- `IssueDialog`:
  - «سيُعتمد {{n}} سطرًا وتُعطى أرقامًا مسلسلة.», the warnings grouped by code, and errors (which
    disable the confirm);
  - «اعتماد وإصدار الأرقام».
- `ReasonDialog`; `SpareUseDialog` («رقم الماكينة التي غُذِّيت بالسبير»).
- `PrintReceiptDialog`: when drafts exist, «توجد {{n}} سطور غير معتمدة ولن تظهر في البيان.»; when a
  previous print exists, «آخر طباعة: {{at}} — {{name}}.» and, when stale, what changed since
  («{{added}} سطور أضيفت و{{removed}} سطور أزيلت منذ آخر طباعة.»).

**Errors.**
- `STALE_DOCUMENT` refetches and shows the shared toast.
- `ATM_PLAN_ISSUE_BLOCKED` reopens the dialog with the server's line errors.
- The other §6.1 codes map to `atm.plan.error.*`.

### 9.5 `pages/CassetteLayoutsPage.tsx` — «فئات الكاسيتات» and `pages/LayoutImportPage.tsx`

**Layouts page.**
- `PageHeader` «فئات الكاسيتات». `figures`: «الماكينات», «لها فئات», «بدون فئات».
- `actions`: «استيراد من Full list» (`can.import`, a link) and «الحمولات القياسية» (opens
  `StandardLoadsDialog`).
- Last-import strip: «آخر استيراد ({{date}}): {{rows}} صفًا في الملف · {{matched}} طابقت ماكينات
  في النظام · {{notFound}} غير موجودة في النظام · {{flags}} تحتاج مراجعة» + «عرض نتيجة آخر استيراد»
  (the import page with the last run's counts; the rows themselves exist only in a preview, §5.3).
- Filters: «البنك» (remembered), «الحالة» («الكل» / «لها فئات» / «بدون فئات»; remembered), search
  «رقم الماكينة أو اسمها».
- Table: «رقم الماكينة», «اسم الماكينة», «المنطقة», «النوع», «الكاسيتات» (chips; empty slots «—»,
  recycle «↻»), «الحمولة القياسية», «آخر تعديل» (date · name · «استيراد»/«يدوي»).
- **Editor panel** (selected machine):
  - «عدد الكاسيتات» (4–8 segmented);
  - per slot: «الكاسيت n», «النوع» («سحب» / «إيداع» / «ريسايكل» / «فارغ»), «الفئة», «العملة»
    («جنيه مصري» or a 3-letter code);
  - «النوع كما في Full list» (`typeLabel`), «هذه الماكينة تحتوي على» (`featuresLabel`), «المنطقة
    كما في Full list» (`hubLabel`), «الحمولة القياسية»;
  - the derived line «شوال واحد» / «شوالان (4 كاسيتات في الشوال)»;
  - «سبب التعديل (اختياري)» and «حفظ الفئات» (manage). When `affectedLines` is not empty, the save
    confirms «لهذه الماكينة {{n}} سطور في خطط اليوم أو بعده. سيظهر عليها تنبيه تغيّر الفئات.» and
    lists them (date, serial or «مسودة», run);
  - «سجل التعديلات» (versions: date, name, source, and a one-line diff «الكاسيت 3: 50 ← 100»).
  - Errors show inline per slot from `layoutIssues`.
- `StandardLoadsDialog`: rows of «فئة 200 / 100 / 50 / 20 / 10 / 5» counts, «الإجمالي» (computed),
  «الافتراضية» (radio), «الاسم (اختياري)», with add, delete and save; a repeated denomination is
  refused inline; delete in use shows `ATM_STANDARD_LOAD_IN_USE` with both counts.

**Import page** (`/atm/settlements/layouts/import`, `RequirePermission atmCassetteLayout.import`):
- «البنك», the work branch's name (read only, from S1 `page=import`), «ملف Full list (xlsx)»,
  «معاينة».
- The report:
  - one chip per outcome with its count («جديدة», «بلا تغيير», «مختلفة», «مختلفة بعد تعديل يدوي»,
    «غير موجودة في الفرع», «مؤرشفة», «بلا بنك في سجل الماكينات», «بنك آخر», «مكررة في الملف», «غير
    صالحة»);
  - the flags line («ترتيب معكوس» n · «HELP بترتيب معاكس» n · «النوع يذكر recycle» n · «HELP لا
    يطابق» n · «المنطقة مختلفة» n · «الاسم مختلف» n · «مختلفة عن REP. TAPE» n · «عدد الكاسيتات
    مختلف عن سجل الماكينات» n · «فئات سجل الماكينات مختلفة» n · «صيغة الرقم» n · «نص طويل» n);
  - a table filtered by chip: «الصف», «رقم الماكينة», «اسم الماكينة», «النتيجة», «ملاحظات», «قبل»,
    «بعد»; a `noRegisterBank` row shows the machine's bank name;
  - «ماكينات البنك غير الموجودة في الملف ({{n}})»;
  - «الحمولات القياسية في REP. TAPE», each with its outcome («جديدة» / «موجودة» / «الإجمالي لا يطابق
    الأعداد» / «غير صالحة»);
  - «تنزيل تقرير الاختلافات (Excel)» (§5.3: row, code, outcome, flags, name; no amounts).
- Apply: «تطبيق» with «الجديدة فقط» / «الجديدة والمختلفة» / «الجديدة والمختلفة مع استبدال التعديلات
  اليدوية», and «إضافة الحمولات القياسية» (checked by default on the page; the server's default is
  no), behind a confirm «سيُنشأ {{created}} ويُحدَّث {{updated}}. متابعة؟». The request carries the
  preview's `previewRevisions`.
- The result toast, with «{{conflicts}} تعارضت مع تعديل تم بعد المعاينة ولم تُكتب.» when there are
  conflicts. `ATM_LAYOUT_IMPORT_FILE_CHANGED` → «تغيّر الملف بعد المعاينة. أعد المعاينة.»;
  `ATM_LAYOUT_IMPORT_RUNNING` → «يوجد استيراد آخر قيد التنفيذ لهذا البنك. حاول بعد قليل.»

### 9.6 `pages/PreparationPage.tsx` — «الشوالات والسيلزات» (`/atm/preparation`)

**Header.**
- `PageHeader` «الشوالات والسيلزات»; `figures`: «جاهزة», «مكتملة», «ناقصة», «لم تبدأ».
- Toolbar: «تاريخ التغذية» (the server's suggested day, DS-25) with «اليوم» / «غدًا», «البنك» (the
  plans of that date), and a box «المسلسل أو رقم الماكينة» that opens the line on Enter:
  - a serial matches the line's `serial`, or one of its `voidedSerials` (the line then opens on its
    current serial, with the note «هذا الرقم أُلغي؛ رقم النوت الحالي {{serial}}.»);
  - a machine code with two runs lists both lines and opens the first one not yet prepared.

**List.** «مسلسل», «رقم الماكينة», «التغذية», «الحالة». A cancelled line shows «ملغاة» and is read
only.

**Capture panel.**
- The title, then «إجمالي الماكينة», then the instruction «امسح سيلز كل كاسيت بالترتيب، ثم رمز QR
  الخاص بالشوال. بعد كل مسح ينتقل المؤشر إلى الخانة التالية.»
- Per bag: «الشوال الأول» / «الشوال الثاني», one row per bagged cassette «كاسيت {{slot}} · فئة {{d}} ·
  {{n}} ورقة» with a `SealInput`, then «QR الشوال». A 0-note cassette shows «اختياري», and so does
  the QR of a bag whose cassettes all hold 0 notes (DS-13).
- `SealInput` follows the IT wedge pattern (`apps/web/src/modules/it/pages/AssetScanPage.tsx:30-36,
  74-89`):
  - `dir="ltr"`, `autoComplete="off"`, `spellCheck={false}`;
  - the first empty field takes focus on open, and focusing a field selects its text, so a scan
    REPLACES a filled value instead of appending to it;
  - Enter, or a Tab the scanner appends (`sealKeyAction`), calls `preventDefault`, cleans the value,
    runs the local checks and moves focus to the next field; the last field moves to «حفظ»;
  - a value with Arabic letters keeps the focus on its field and shows «القيمة تحتوي على حروف عربية؛
    غيّر لغة لوحة المفاتيح إلى الإنجليزية وأعد المسح.» (a warning; saving is not blocked);
  - after «حفظ» or «تم التجهيز», focus returns to the «المسلسل أو رقم الماكينة» box.
- **Duplicates:**
  - local ones at once: «هذا السيلز مكرر في هذه الماكينة.» / «هذا الـ QR مكرر.» / «هذه القيمة مسجلة في
    خانة أخرى من هذه الماكينة.» (a QR equal to a seal);
  - the server's after a save: «تنبيه: هذا الرقم مسجل أيضًا على {{where}}. تأكد قبل المتابعة.»,
    where `where` = «مسلسل {{serial}} · {{code}} · {{date}}» or «سطر خارج نطاق صلاحيتك»; a
    `crossKind` match adds «(مسجل هناك كـ QR شوال)» or «(مسجل هناك كسيلز كاسيت)»;
  - an orange border. Saving is never blocked.
- **Local state.** The capture values are local, seeded ONCE when a line is opened (`seedOnce`), and
  a refetch (every 60 s or on a signal) never overwrites them while they hold unsaved changes. On a
  409, the page keeps the local values, refetches, and re-applies them onto the new version
  (`mergeAfterConflict`); a field the server changed meanwhile is marked for the user to choose.
- **Buttons** (`canCapture`):
  - «حفظ»;
  - «تم التجهيز» (enabled when `requiredMissing` is empty; otherwise its title lists what is
    missing);
  - «إعادة فتح التجهيز» on a prepared line.
- Progress: «تم تسجيل {{n}} من {{m}} (QR الشوالات وسيلزات الكاسيتات)».
- Leaving with unsaved captures prompts, using the map's `lib/useUnsavedGuard.ts`.

### 9.7 `pages/ControlPage.tsx` — «بيانات التغذية والخطوط» (`/atm/control`)

**Header.**
- `PageHeader` «بيانات التغذية والخطوط».
- `actions` (print key): «طباعة ورقة التسليم للخزينة» (a menu per bank plan when there are several)
  and «طباعة كشوف الخطوط».
- Toolbar: «تاريخ التغذية» (the server's suggested day, DS-25) with «اليوم» / «غدًا», and tabs
  «البيانات والسيلزات» | «توزيع الخطوط».

**Tab 1.**
- Columns: «مسلسل», «البنك», «رقم الماكينة», «اسم الماكينة», «النوع», «المنطقة», «التغذية»,
  «الإجمالي», «QR الشوال الأول», «QR الشوال الثاني», «سيلزات الكاسيتات» («{{n}} من {{m}}» ✓ when
  complete), «التجهيز», «الخط». «النوع» and «المنطقة» are the seals paper's TYPE and HUB.
- A duplicate shows ⚠ with the same text as Preparation.
- Expanding a row lists its cassette seals («كاسيت n · فئة d: value»).
- The handover print dialog warns «{{n}} سطور لم يكتمل تجهيزها؛ ستُطبع خانة QR فارغة لها.» when
  `notPrepared > 0`.

**Tab 2** (manage):
- The group «لم يُوزّع بعد ({{n}})», then one card per route: name, «{{leader}} · {{n}} ماكينة ·
  {{b}} شوال».
- Each item shows its code, run, bags and area, plus its zone name when `can.zones`. «ترتيب حسب»
  («المنطقة» / «المسلسل») and a grouping by area help distribute.
- «نقل إلى» (select) per item; rows can be multi-selected for «نقل المحدد إلى». Each move sends its
  `from`; a `MOVED` answer refetches and shows «نقل مستخدم آخر هذا السطر للتو؛ تم تحديث القائمة.»
- Route menu: «تعديل الاسم والقائد», «تحريك لأعلى/لأسفل», «حذف الخط» (confirm «ستعود {{n}} سطور إلى
  لم يُوزّع بعد.»), «طباعة كشف {{name}}».
- «+ خط جديد» (name, «القائد (اختياري)»).
- «إنشاء الخطوط من القطاعات» (only with `can.zones`), with its result toast «أُنشئ {{routes}} خطًا
  ووُزِّعت {{assigned}} سطور. بقيت {{left}} بلا قطاع أو بلا موقع.»
- «طباعة كشوف الخطوط» confirms first when lines are unassigned or not prepared: «{{unassigned}} سطور
  لم تُوزَّع و{{notPrepared}} سطور لم يكتمل تجهيزها. متابعة الطباعة؟»
- A move is saved at once (`PUT /assignments`); an error rolls the move back.

### 9.8 Overview cards and the remembered-filters census

**Overview cards.** Add four `ATM_SHORTCUTS` entries (`pages/AtmOverviewPage.tsx:34+`) with
`atm.nav.*` / `atm.cards.*` keys. `atm-i18n.spec.ts:192-198` checks both locales.

**Census** (`apps/web/src/shared/lib/remembered-filters-coverage.spec.ts`):

| Page | State | Declares / excludes | Reason (written in the census beside the entry) |
|---|---|---|---|
| `SettlementPlanPage.tsx` | COVERED | `REMEMBERED_FILTERS = ['bank']`; excludes `date`, `line` | `date` opens on tomorrow (DS-25); `line` is a selection |
| `CassetteLayoutsPage.tsx` | COVERED | `['bank', 'status']`; excludes `q`, `machine` | `q`: the list's search, as `UnlocatedMachinesPage.tsx`; `machine`: a link that opens one machine's editor |
| `PreparationPage.tsx` | COVERED | `['bank']`; excludes `date`, `line` | `date` is the server's suggested day (DS-25); `line` is a selection |
| `ControlPage.tsx` | EXCLUDED | — | "`date` is the server's suggested day — the day being dispatched (DS-25); `tab` is a view" |
| `LayoutImportPage.tsx` | NOT_FILTER_CAPABLE, with a note | — | "an upload form: the bank select picks the file's profile and the table previews one upload; nothing narrows a stored list" (the detector flags its select and table, `:309-311`, and an unexplained flag fails `:412-420`) |

Each page reads its params with `sp.get(...)` in its own file (zones spec §7.5).

### 9.9 i18n keys (`apps/web/src/platform/localization/i18n.ts`)

Add each key to the en block (before its closing `};` at `:9224`) and to the ar block (before
`:18300`). The audit labels go next to `atmRegisterImport` (`:6819`, `:15943`), as
`system-admin-i18n.spec.ts:116-121` requires. Every Arabic string must pass
`node scripts/check-formal-arabic.mjs`; the strings below were checked with `offendersIn`. A spec,
`atm-settlements-i18n.spec.ts`, drives the enum-backed keys from the contracts enums (the
`atm-register-i18n.spec.ts:1-50` pattern), and asserts that every new `atm.*` key has the SAME
placeholder names in both languages (`placeholders.spec.ts` only checks for single braces).

**One word per concept (DS-32).** On every screen: a slot is «كاسيت» (plural «كاسيتات»), a bag is
«شوال», a cassette seal is «سيلز», the bag's code is «QR الشوال». On papers: the bag is «الحقيبة»
(the Note's own word); the paper's words are never changed.

**Navigation, cards, audit**

| Key | en | ar |
|---|---|---|
| `atm.nav.settlementPlan` / `.cassetteLayouts` / `.preparation` / `.control` | Replenishment plan / Cassette denominations / Bags and seals / Dispatch data and lines | خطة التغذية / فئات الكاسيتات / الشوالات والسيلزات / بيانات التغذية والخطوط |
| `atm.cards.settlementPlan` | The day's plan per bank: Notes, cash receipt and seals sheet. | خطة اليوم لكل بنك: النوتس وبيان التغذية وشيت السيلزات. |
| `atm.cards.cassetteLayouts` | Each machine's cassettes and their denominations. | كاسيتات كل ماكينة وفئاتها. |
| `atm.cards.preparation` | Scan each cassette's seal and each bag's QR. | مسح سيلز كل كاسيت وQR كل شوال. |
| `atm.cards.control` | Bags, seals and their distribution over the lines. | الشوالات والسيلزات وتوزيعها على الخطوط. |
| `systemAdmin.users.audit.atmLayoutImport` | Imported a bank master workbook | استيراد ملف Full list للبنك |
| `systemAdmin.users.audit.atmSettlementPrint` | Printed replenishment papers | طباعة أوراق التغذية |

**Shared (`atm.settlement.*`)**

| Key | en | ar |
|---|---|---|
| `run.1` / `.2` / `.3` | 1st run / 2nd run / 3rd run | التغذية الأولى / التغذية الثانية / التغذية الثالثة |
| `status.draft` / `.issued` / `.prepared` / `.cancelled` | Draft / Issued / Ready / Cancelled | مسودة / معتمدة / جاهزة / ملغاة |
| `planState.draft` / `.issued` / `.partlyIssued` | Draft / Issued / Partly issued | مسودة / معتمدة / معتمدة جزئيًا |
| `slotKind.withdrawal` / `.deposit` / `.recycle` / `.empty` | Withdrawal / Deposit / Recycle / Empty | سحب / إيداع / ريسايكل / فارغ |
| `currency.EGP` | Egyptian pound | جنيه مصري |
| `bags.one` / `.two` | One bag / Two bags (4 cassettes per bag) | شوال واحد / شوالان (4 كاسيتات في الشوال) |
| `bag.1` / `.2` | First bag / Second bag | الشوال الأول / الشوال الثاني |
| `bag.slots` | {{bag}}: cassettes {{from}} to {{to}} | {{bag}} — الكاسيتات {{from}} إلى {{to}} |
| `slot` | Cassette {{slot}} | كاسيت {{slot}} |
| `prep.none` / `.partial` / `.complete` / `.prepared` | Not started / Incomplete / Complete / Ready | لم تبدأ / ناقصة / مكتملة / جاهزة |
| `chooseBranch` | Choose a specific branch from the top bar. | اختر فرعًا محددًا من القائمة العلوية. |
| `noBranch` | No branch is within your access for this page. | لا يوجد فرع ضمن صلاحيتك لهذه الصفحة. |
| `today` / `tomorrow` | Today / Tomorrow | اليوم / غدًا |
| `bank` / `date` / `machineCode` / `machineName` / `area` / `run` / `serial` / `total` / `status` | Bank / Replenishment date / Machine ID / Machine name / Area / Run / Serial / Total / Status | البنك / تاريخ التغذية / رقم الماكينة / اسم الماكينة / المنطقة / التغذية / مسلسل / الإجمالي / الحالة |

**Issues (`atm.settlement.issue.*`)**

| Key | ar |
|---|---|
| `MACHINE_NOT_PLANNABLE` | الماكينة غير متاحة للتغذية: موقوفة أو لم تعد تابعة لهذا البنك. |
| `NO_LAYOUT` | لم تُسجَّل فئات الكاسيتات لهذه الماكينة. |
| `NO_FILLABLE_SLOT` | لا يوجد في الماكينة كاسيت سحب أو ريسايكل بالجنيه المصري. |
| `EMPTY_LINE` | لا يوجد ورق في أي كاسيت. |
| `DUPLICATE_IN_RUN` | الماكينة مكررة في التغذية نفسها. |
| `SPARE_TYPE_REQUIRED` | حدّد نوع طقم السبير. |
| `LAYOUT_INVALID` | فئات الكاسيتات في السطر غير صالحة. |
| `NOT_MULTIPLE_OF_100` | عدد الورق في الكاسيت {{slot}} ليس من مضاعفات 100. |
| `LAYOUT_CHANGED` | تغيّرت فئات كاسيتات الماكينة بعد إضافة السطر. |
| `LAYOUT_CHANGED_AFTER_ISSUE` | تغيّرت فئات كاسيتات الماكينة بعد اعتماد السطر؛ أعده إلى المسودة وأعد طباعة النوت إذا لزم الأمر. |
| `NO_TIME` | لم تُحدَّد ساعة التغذية. |
| `STANDARD_DENOMINATION_UNPLACED` | في الحمولة القياسية فئة لا يوجد لها كاسيت في الماكينة. |
| `DIFFERS_FROM_STANDARD` | الأعداد تختلف عن الحمولة القياسية. |
| `RUN_TIME_ORDER` | ساعة هذه التغذية ليست بعد ساعة التغذية السابقة للماكينة نفسها. |
| `FOREIGN_CURRENCY_NOT_PLANNED` | كاسيتات العملة الأجنبية لا تُغذّى من هذه الخطة. |
| `PAST_DATE` | تاريخ التغذية قبل اليوم. |

(English in the same order: "The machine cannot be replenished: archived or no longer this bank's.",
"No cassette denominations are recorded for this machine.", "The machine has no withdrawal or
recycle cassette in Egyptian pounds.", "No cassette holds any notes.", "The machine appears twice in
the same run.", "Choose the spare set's type.", "The line's cassette denominations are not valid.",
"Cassette {{slot}} is not a multiple of 100 notes.", "The machine's cassette denominations changed
after the line was added.", "The machine's cassette denominations changed after the line was
issued; reopen it and reprint the Note if needed.", "No replenishment time is set.", "The standard
load has a denomination this machine has no cassette for.", "The counts differ from the standard
load.", "This run's time is not after the same machine's previous run.", "Foreign-currency cassettes
are not filled from this plan.", "The replenishment date is before today.")

**Plan page (`atm.plan.*`).** These carry the strings quoted in §9.4: `title`, the figures, the
actions, the toolbar labels, the table headings, the panel labels, the dialogs and their results,
the notices, the footer. Further keys:

| Key | en | ar |
|---|---|---|
| `refused.unknownCode` / `.inactive` / `.noRegisterBank` / `.otherBank` / `.noLayout` / `.noFillableSlot` / `.duplicateInRun` / `.duplicateInRequest` / `.badTime` | Not found in this branch / Archived / No bank in the machine register / Another bank's machine / No cassette denominations / No cassette to fill / Already in this run / Repeated in the list / Unreadable time | غير موجودة في هذا الفرع / مؤرشفة / لا بنك لها في سجل الماكينات / ماكينة بنك آخر / بلا فئات كاسيتات / بلا كاسيت يُغذّى / موجودة في هذه التغذية / مكررة في القائمة / ساعة غير مقروءة |
| `error.exists` | A plan for this day already exists; it has been opened. | توجد خطة لهذا اليوم بالفعل، وفُتحت. |
| `error.full` | A plan holds at most 400 lines. | لا تتسع الخطة لأكثر من 400 سطر. |
| `error.lineState` | This line's status no longer allows that action. | لم تعد حالة هذا السطر تسمح بهذا الإجراء. |
| `error.hasCaptures` | Preparation already recorded seals for this line; cancel it instead. | سجّل التجهيز سيلزات لهذا السطر؛ ألغِ السطر بدلًا من إعادته. |
| `error.slotNotFillable` | Notes can only be set on Egyptian-pound withdrawal or recycle cassettes. | لا يُحدَّد عدد الورق إلا لكاسيتات السحب أو الريسايكل بالجنيه المصري. |

**Layouts and import (`atm.layouts.*`, `atm.layoutImport.*`)**, **Preparation (`atm.prep.*`)** and
**Control (`atm.control.*`)** carry the strings quoted in §9.5–§9.7 (the outcome and flag chips are
enum-backed: `atm.layoutImport.outcome.*`, `atm.layoutImport.flag.*`), with these error keys:

| Key | ar |
|---|---|
| `atm.layoutImport.error.layout` | الملف لا يحتوي على شيت Full list أو أحد عناوينه: {{names}}. |
| `atm.layoutImport.error.tooLarge` | الملف أكبر مما يقرؤه الاستيراد. |
| `atm.layoutImport.error.unsupported` | لا يمكن استيراد ملف هذا البنك بعد. |
| `atm.layoutImport.error.fileChanged` | تغيّر الملف بعد المعاينة. أعد المعاينة. |
| `atm.layoutImport.error.running` | يوجد استيراد آخر قيد التنفيذ لهذا البنك. حاول بعد قليل. |
| `atm.layouts.error.inUse` | الحمولة مستخدمة في {{layouts}} ماكينة و{{draftLines}} سطر مسودة؛ غيّرها فيها أولًا. |
| `atm.prep.error.locked` | التجهيز معتمد؛ أعد فتحه قبل التعديل. |
| `atm.prep.error.incomplete` | ينقص: {{list}}. |
| `atm.prep.error.invalidSeal` | الرقم الممسوح غير صالح. |
| `atm.prep.warning.arabicLetters` | القيمة تحتوي على حروف عربية؛ غيّر لغة لوحة المفاتيح إلى الإنجليزية وأعد المسح. |
| `atm.prep.voidedSerial` | هذا الرقم أُلغي؛ رقم النوت الحالي {{serial}}. |
| `atm.control.error.duplicateName` | يوجد خط بالاسم نفسه في هذا اليوم. |
| `atm.control.error.moved` | نقل مستخدم آخر هذا السطر للتو؛ تم تحديث القائمة. |

**Paper words that are new (`atm.paper.*`; formal, not verbatim; always rendered with
`translate('ar', …)`, §8)**

| Key | ar |
|---|---|
| `run.1` / `.2` / `.3` | التغذية الأولى / التغذية الثانية / التغذية الثالثة |
| `at` | الساعة |
| `bag` | الحقيبة |
| `bank` | البنك |
| `spareSet` | طقم سبير |
| `runShort` | التغذية |
| `routeSheet` | كشف خط |
| `popupBlocked` (screen toast) | المتصفح منع فتح نافذة الطباعة. اسمح بالنوافذ المنبثقة لهذا الموقع ثم أعد المحاولة. |

### 9.10 Accessibility

- The tables are real tables.
- Status chips carry text, not colour only.
- Every icon button has an `aria-label`.
- The capture inputs have labels («QR الشوال الأول», «سيلز الكاسيت 3»).
- The duplicate warning is in an `aria-live="polite"` region.
- Moves on the routes tab are plain `<select>`s, with no drag-only interaction.
- Focus returns to the opener when a dialog closes.

---

## 10. Tests

All fixtures are invented: codes `BRKN9001…`, names «ماكينة اختبار 1», seals `SEAL-T-0001`. No
workbook is committed; the import tests build their `.xlsx` with ExcelJS in the test.

### 10.1 Contracts — `packages/contracts/src/modules/atm-settlements.spec.ts`

| Function | Cases |
|---|---|
| `splitEvenly` | The five examples of §3.3; k = 1; `total = 0`; a large total stays integer. |
| `splitByDenomination` | Two 200 cassettes share a typed 200 total; a denomination with no slot → `unplaced`; a foreign slot of the same value is not touched. |
| `isPlanned` | Withdrawal/recycle EGP → true; deposit, empty, a USD withdrawal → false. |
| `bagAllocation` | 4 / 3 (empty first) / 5 / 6 / 8 planned; deposit and empty slots skipped; recycle included; 4 EGP + 2 USD slots → 1 bag. |
| `bagNeedsQr` | A bag whose only cassette is a 0-note 20 → false; any cassette with notes → true. |
| `fillFromStandard` | 200/200/100/50 with a 200·100·50 profile → the 200s split equally; 200/100/50/20 → the 20 gets 0; 0/50/100/200 (reversed) → each by denomination; a profile denomination with no slot → `unplaced`; a foreign slot → no notes. |
| `lineEgpTotalMinor` | A 4,000-note 200 cassette → 80,000,000 minor (800,000 EGP); an empty slot and a USD slot ignored. |
| `byDenomination` | Two 200 cassettes summed; 200/100/50 order; absent denominations omitted. |
| `receiptRows` | Always six rows in 200…5 order; the 20/10/5 rows summed (the paper defect regression); a USD 100 slot is ignored. |
| `receiptMachineCount` | Machine X on run 1 and run 2 → 1; plus 2 spare lines → 3; cancelled lines excluded by the caller. |
| `layoutIssues` | Every code once; 4 and 8 slots valid; 3 and 9 invalid; spare 1 valid. |
| `planLineIssues` | Every error and warning code once (incl. `LAYOUT_CHANGED` by revision on a label-only change, `LAYOUT_CHANGED_AFTER_ISSUE` on an issued line dated today and not on one dated yesterday, `DIFFERS_FROM_STANDARD` against `standardNotes` on a draft and never on an issued line), plus a clean line → []. |
| `cleanScannedValue` | Arabic-Indic and Eastern digits → ASCII; a trailing CR, LF or Tab removed; LRM, RLM, BOM and zero-width marks removed; case and inner spaces KEPT; '' → null; a URL survives unchanged. |
| `sealKey` | Lower case → upper; inner spaces removed; NFKC full-width → ASCII; two values that differ only in case, digits script or a trailing CR → the same key. |
| `scannedValueWarnings` | A value typed under the Arabic layout → `ARABIC_LETTERS`; a Latin value → []. |
| `normalizeScheduleTime` | `21:00`, `9:00`, `9:00 PM`, `9:00 pm`, `9:00 م`, `٩:٠٠ م` → `21:00`; `12:30 AM` → `00:30`; `''` → null; `25:00`, `9`, `abc` → `'bad'`. |
| `cleanLabel` | A control and a format character stripped; NFC; runs of spaces collapsed. |
| `repTapeComment` | 21:00 → `Repl @9:00 PM`; 02:00 → `Repl @2:00 AM`; 00:30 → `Repl @12:30 AM`; 12:00 → `Repl @12:00 PM`; null → ''. |
| Schemas | `SaveAtmCassetteLayoutSchema` refuses 3 slots and a label with a control character; `SaveAtmStandardLoadSchema` refuses a repeated denomination; `UpdateAtmPlanLineSchema` refuses a repeated slot in `notes`; `AddAtmPlanLinesSchema` refuses 201 rows and accepts `scheduleTime: '9:00 PM'`; `LayoutImportFieldsSchema`: `apply: 'TRUE'` → false, `apply: 'true'` without `mode` → refused, `standardLoads` missing → false, a short `fileSha256` → refused; `AtmSettlementPrintSchema` refuses an unknown kind. |

### 10.2 API unit — `apps/api/src/modules/atm/settlements/**`

- **`plan-layout-import.spec.ts`** (pure, over an in-memory world): one row per outcome
  (`noRegisterBank` with the machine's bank name; `changedManual` on a `source: 'manual'` layout);
  a duplicated code marks both rows; every flag (`helpDisagrees` by multiset: a reversed row is
  `helpOrderOpposite` and NOT `helpDisagrees`; a HELP of 10,000 dashes is read in linear time);
  a label over its cap → `invalid` + `labelTooLong`; `missingFromFile`; the `REP. TAPE` standard
  rows (`new`, `same`, `mismatch`, `invalid`); `same` vs `changed` (slot, each of the three labels);
  the zero-padding case → `notFound` (DS-6).
- **`read-master-workbook.spec.ts`:**
  - a workbook built in the test with `Full list` + `REP. TAPE` → the rows, rows 1–2 and the day
    lines' codes and denominations (and no count column read);
  - both sheets are read from ONE reduction (the reducer is called once);
  - a missing sheet → 422 `ATM_LAYOUT_IMPORT_LAYOUT`; a renamed header → the header named;
  - a sheet beyond `maxRowsIterated` (5,000) → `TOO_LARGE`; a sheet part beyond 16 MB → `TOO_LARGE`;
  - a zip of 501 empty entries, and a zip carrying a ZIP64 end record → `TOO_LARGE 'entries'`
    before `loadAsync` runs;
  - nothing is written to disk (the register reader's test pattern).
- **`read-register-workbook.spec.ts`** stays green unchanged (§5.1 refactor), plus the new
  entry-count case.
- **`branch-scope.spec.ts`:**
  - the moved helpers keep the map's cases (re-run against the aliases);
  - `resolveWorkBranch`: top bar readable → it with `canWrite` per key; organization at «كل
    الفروع» with 2 branches → `chooseBranch`; branch grant → home; no reach → `noBranch`; the same
    user resolves differently for `page=plans` and `page=layouts` when the key pairs differ.
- **`register-bank.spec.ts`:** the register helper's `find` is called with exactly the projection of
  §6.2 (no `keys`, notes or `safeCombination`).
- **`plan.service.spec.ts`** (with a mocked session): issue orders serials by run, time and
  position; a retry of the transaction callback does not double-record audits.
- **`atm-indexes.spec.ts` / `open-operation.spec.ts`:** the ten models are listed; the five
  `rowsInLog: false` collections are named.
- **`atm.module.spec.ts`:** the new counts (§7.2).
- **`seed-navigation.spec.ts`:** 134 rows; the four rows after «تقرير البيانات», with keys and
  icons.
- **`realtime-registry.spec.ts`:** passes with the new topics, the two day signals and the
  exclusion.

### 10.3 API integration — `apps/api/tests/integration/atm-settlements.spec.ts` (NEW)

Run with `cd apps/api && MONGOMS_SYSTEM_BINARY=/opt/mongod/mongod npx vitest run
tests/integration/atm-settlements.spec.ts`. The seeded-login suite
(`tests/integration/auth-seed-login.spec.ts`) moves to 134 rows in the same change (§7.3).

**Setup.**
- Two branches (Alpha, Beta).
- Machines in each, with open BRK register entries; one BM machine; one archived BRK machine; one
  machine with BRK + BM open entries; one live machine with no register entry.
- Users:
  - `orgSettle`: organization; all keys;
  - `alphaSettle`: branch Alpha; Settlements keys;
  - `alphaPrep`: Alpha; Preparation keys;
  - `alphaCtl`: Alpha; Control keys + `atmMap.view`;
  - `betaPrep`: Beta; Preparation keys;
  - `deptView`: department-scoped `atmSettlementPlan.view`;
  - `deptManage`: department-scoped `atmSettlementPlan.view` + `.manage`;
  - `deptCapture`: department-scoped `atmPreparation.view` + `.capture`;
  - `orgViewOwnPrint`: organization `atmSettlementPlan.view`, own-scope `.print`;
  - `ownView`: `own` scope;
  - `noKeys`.
- Zones in Alpha (two overlapping), and located machines, one of them a pin under review.

**Interleaving.** The race cases run two sessions by hand: session A starts its transaction and
performs its first write, session B commits, then A continues; each case asserts the outcome named.

**Cases.**
1. **Context.**
   - `orgSettle` with the top bar on Alpha → branch Alpha, all `can` true.
   - The same user at «كل الفروع» → `chooseBranch`; `GET /plans` then answers 422
     `ATM_WORK_BRANCH_REQUIRED` with `CHOOSE_BRANCH`.
   - `alphaSettle` → Alpha.
   - `ownView` → `noBranch` and every read empty or 404.
2. **Bank setting.** BRK is enabled by default. `GET /layouts?bankCode=BM` → 422
   `ATM_SETTLEMENT_BANK_NOT_ENABLED`. After setting `['BRK','BM']`, 200.
3. **Import preview.** A synthetic BRK master with one row per outcome → the expected counts and
   flags; `missingFromFile` lists the unmatched Alpha machine; the no-register machine is
   `noRegisterBank`. Nothing is written (no run row, no audit).
4. **Import apply.**
   - The wrong sha → 409; a missing `mode` → 400; `apply: 'yes'` → a preview.
   - `newOnly` creates `new` only; `newAndChanged` updates `changed` and leaves `changedManual`
     alone; `overwriteManual` updates it.
   - A second apply → all `same`, nothing written.
   - A layout saved by hand between the preview and the apply → that row counts as a conflict and
     the manual save stands (the preview's revisions).
   - Two applies at once (interleaved) → one 409 `ATM_LAYOUT_IMPORT_RUNNING`; a run left `running`
     for longer than `STALE_RUN_MS` is taken over.
   - An E11000 on `ux_machine` mid-apply (a layout created by hand in between) → counted in
     `conflicts`; every other row is written (one transaction per row).
   - Version rows exist with `source: 'import'`; one `atmLayoutImport` audit and one per layout.
   - Standard loads are created and row 1 is the default; a `mismatch` row is not created.
5. **Import scope.**
   - `alphaSettle` cannot import into Beta: body `branchId` Beta → 400 `BRANCH_MISMATCH`.
   - A Beta-only code in the file → `notFound`.
   - `GET /layouts/import/runs` lists only the caller's branch's runs.
   - `noKeys` → 403.
6. **Layout save.**
   - Create with `version: null`; a second create → 409.
   - Update with a stale version → 409.
   - 3 slots → 400 with the `layoutIssues` codes; a label with a control character → 400.
   - A profile of BM → 400 `STANDARD_LOAD_OTHER_BANK`.
   - A Beta machine for `alphaSettle` → 404.
   - The history lists the versions; the detail lists `affectedLines`.
7. **Standard loads.** A second default clears the first (two audits); deleting one used by a
   layout or by a draft line → 409 with both counts; body `branchId` Beta for `alphaSettle` → 400.
8. **Plan create.**
   - Twice → 409 `ATM_PLAN_EXISTS` with the id.
   - Body `branchId` Beta for `alphaSettle` → 400 `BRANCH_MISMATCH`.
   - `deptView` reads Alpha's plan and cannot create (403); `deptManage` cannot create either
     (403: a department grant never writes, §7.1).
9. **Add lines.**
   - Unknown, archived, no-register, BM, two-bank, no-layout, duplicate-in-request and `badTime`
     rows are each refused with the right reason, and the other rows of the batch are added.
   - The same machine in run 2 is accepted; again in run 2 → `duplicateInRun`.
   - Two concurrent adds of the same code in the same run (interleaved) → exactly one line.
   - A PATCH moving a line into an occupied run, racing an add → one 409.
   - Counts come from the profile with the 200s split equally, and `standardNotes` is stored; a
     machine without a profile takes the bank default.
   - 401 lines → 422 `ATM_PLAN_FULL`, nothing written.
10. **Edit draft.**
    - Notes override → `countsSource: 'manual'`, totals recomputed; `denominationNotes` splits a
      200 total over two cassettes.
    - Notes on a deposit or a USD slot → 400 `SLOT_NOT_FILLABLE`; on slot 9 → 400 `UNKNOWN_SLOT`.
    - `refreshLayout` after a layout change clears `LAYOUT_CHANGED` and refills from the line's
      profile.
    - Editing an issued line → 409 `ATM_PLAN_LINE_STATE`.
    - A line of plan P addressed as `/plans/Q/lines/:id` → 404.
11. **Issue.**
    - A line with `EMPTY_LINE` → 422 with details, nothing written.
    - A stale version → 409, nothing written.
    - A PATCH committed between the read and the write (interleaved) → 409, the counter unchanged.
    - Success → consecutive running serials in (run, time, position) order; preparations exist
      with the right bags (a 6-cassette machine → bags [1–4], [5–6]).
    - Issuing new lines later, or on the next day's plan of the same bank, continues the numbers.
    - Two issue calls in parallel (two plans of the same branch × bank) → unique, contiguous
      serials with no gap.
12. **Reopen and cancel.**
    - Reopen an issued, printed line → draft; the serial is in `voidedSerials` with its print
      count; `notePrintCount` is 0; the preparation is soft-deleted (a `delete` audit); the audit
      has `{ field: 'serial', old: N, new: null }`. Re-issue → a NEW serial, never the voided one,
      and «غير المطبوعة فقط» includes it.
    - Reopen after a seal was saved → 409 `ATM_PLAN_LINE_HAS_CAPTURES`.
    - Reopen racing a P3 save (interleaved) → one of them 409; never a draft line with a deleted
      preparation holding seals.
    - Cancel racing a P3 save (interleaved) → the save fails; no capture lands on a cancelled
      line.
    - Cancel a prepared line → cancelled; its preparation is kept; its route assignment is removed
      (with a `delete` audit).
13. **Spare.**
    - Add a spare with 2 slots; issue; its Note print has `spareCode` and `typeLabel`.
    - Spare-use with a BM machine → 422; with an Alpha BRK machine → recorded; a correction
      replaces it (two audits).
    - The receipt machine count = distinct machines + spares.
14. **Prints.**
    - `notes` without the print key → 403; `orgViewOwnPrint` → 403. With it: `notePrintCount`
      increments, no `__v` change, one `atmSettlementPrint` audit with `[{ lineId, serial,
      version }]`.
    - `notes` racing a reopen (interleaved) → 409 and no count change, or a Note of the current
      serial; never a Note with a voided serial.
    - `receipt`: the 20/10/5 rows summed; drafts excluded and counted; `receiptPrint` stored; a
      line issued afterwards → `summary.receiptStale`.
    - `handover` from Settlements → `withQr: false` and no `qrs`.
    - `repTape` with `view` only → 403; with `export` → 200 and an `export` audit.
15. **Preparation.**
    - `alphaPrep` lists issued lines only (a draft is absent).
    - Save with Arabic-Indic digits → stored ASCII; with a trailing CR and an RLM → stored without
      them; a QR's lower-case letters are kept, and its `qrKey` is upper case.
    - The same seal on two cassettes of one line → a `sameLine` duplicate warning, 200.
    - A bag QR equal to a cassette seal of the same line, and of another line → `crossKind`.
    - A seal reused 10 times historically → at most 5 matches returned.
    - A seal typed under the Arabic layout → 200 with an `ARABIC_LETTERS` warning.
    - The same QR on a Beta line → `outsideReach` for `alphaPrep`; full details for `orgSettle`
      holding Preparation keys with the top bar at «كل الفروع» (an organization selector narrows to
      the top bar's branch, `shared/types/index.ts:230-232`).
    - Mark prepared with a missing seal on a 2,000-note cassette → 422 naming the slot. A missing
      seal on a 0-note cassette, and a missing QR on a bag of 0-note cassettes, are allowed.
    - Mark prepared racing a cancel (interleaved) → 409; the line stays cancelled.
    - Save after prepared → 409 `ATM_PREPARATION_LOCKED`; reopen, then save works.
    - `betaPrep` saving an Alpha line → 404; `deptCapture` → 403.
    - P1 without a date at 00:30 Cairo with today's lines issued → today.
16. **Control.**
    - The day lists both runs of a machine as two lines.
    - Route create; duplicate name (also with different case and spaces) → 400.
    - Assignment of a Beta line → 400. Moving between routes, then null → audits
      create/update/delete.
    - A move whose `from` no longer holds (interleaved with another user's move) → 409 `MOVED`.
    - A move onto a route deleted in between (interleaved) → 400 `ROUTE_GONE`; no line is left on
      a deleted route.
    - Delete a route → its lines unassigned, one `delete` audit per assignment.
    - From zones: an overlapping point goes to the zone higher in `order`; a review pin counts;
      unlocated and spare lines stay unassigned; a second call reuses the routes; two calls at once
      → one set of routes; without `atmMap.view` → 403; with `atmMap.view` at own scope → 403.
    - Prints: `handover` with QRs for prepared lines only and `notPrepared`; `routes` per route, one
      audit per route, cancelled lines absent; a body branch out of reach → 400 `OUT_OF_REACH`.
17. **Realtime.** Each write publishes on its topic; S18, P3 and C6 publish the day signals with
    the branch; the import run row does not publish.
18. **Logs.** A duplicate-key report on `atm_line_preparations` (forced) names counts only.

### 10.4 Web — `apps/web/src/modules/atm/**` (node environment, `renderToStaticMarkup`)

| Spec | What it checks |
|---|---|
| `settlements-navigation.spec.ts` | The guards, the header list, that every card is a served route, and the nav keys equal the guards. |
| `atm-settlements-i18n.spec.ts` | Every enum-backed key in both locales; the same placeholders in both languages for every new `atm.*` key; the audit verb labels; no subtitle on the four pages (the `atm-register-i18n.spec.ts:274` pattern). |
| `lib/settlement-dates.spec.ts` | Tomorrow across Cairo midnight; `formatPaperDate` → `d/m/yyyy`; `formatPaperTimestamp`; `formatTime12` ar/en; `runCompact`. |
| `lib/settlement-view.spec.ts` | `planState`, `lineChips`, `bagsText`, `issueText` for every code. |
| `lib/preparation-form.spec.ts` | Field order for 1 and 2 bags (cassettes before each QR); `nextField` past the last field; `sealKeyAction` for Enter, a Tab suffix and other keys; `localDuplicates` across Arabic-Indic vs ASCII digits, letter case and a trailing CR, and a QR equal to a seal; `localWarnings` for Arabic letters; `requiredMissing` (0-note cassette and all-zero bag optional); a refetch while the form holds unsaved values keeps them; `mergeAfterConflict` re-applies local values onto the new version. |
| `lib/papers/note-print.spec.ts` | The verbatim words appear (incl. `unloadTechStamp`); the serial, replenishment date (`d/m/yyyy`) and run band are present; the corrected column widths; 4 vs 8 cassettes (the row rule, the unit scales, one `.page` per Note); a reversed 0/50/100/200 layout prints three cassette rows and three unload rows; a deposit slot is absent from both sections; two bags → column F «الحقيبة» and split boxes; a blank `typeLabel` prints blank; `hubLabel` in «المنطقة»; a spare Note; an invented 4,000-note 200 cassette prints `800,000`; `@page`, `print-color-adjust` and the logo written once for 3 Notes; no `<script>`, no inline handler (the `print-window.spec.ts` rule); values escaped; an English-locale caller still prints Arabic words. |
| `lib/papers/receipt-print.spec.ts` | The title composes «بنك البركة»; six rows; the machine count sentence; the print day in B3; the total converted once. |
| `lib/papers/handover-print.spec.ts` | Without `withQr` the QR boxes are blank; with it, a prepared line prints its QRs and an unprepared one a blank box; two QRs in one cell; the print-day header; the compact run; the footer words with the 54 dots; a route sheet with an unassigned, an unprepared and a cancelled line (only the non-cancelled print, each route on its own page, the bank column and the neutral `TYPE` header). |
| `lib/papers/rep-tape-xlsx.spec.ts` | Unzip the Blob: the sheet names `REP. TAPE` and `ATM_2`; B7…P7 exact text (including `No-of bills1` vs `No- of bills2`); R7:T7 = 200, 100, 50 as numbers and each line's per-denomination sums below; data from row 8; a 3-cassette line blank in cassette 4 and a reversed line 0/0 in slot 1; a 5-slot line's fifth pair after the per-denomination columns; O8 is a number with built-in format 14; D4 carries `[$-409]d/mmm/yy;@`; the merges; `rightToLeft` absent; the file name `REP TAPE BRK dd-mm-yyyy.xlsx`. |
| `shared/lib/xlsx-writer.spec.ts` | An existing Fleet book's sheet XML AND `styles.xml` are byte-identical before and after the move; a grid sheet writes cells at their addresses with their styles; an XML-invalid character is removed. |
| `shared/lib/paper-fonts.spec.ts` | The fleet re-export yields the same `PAPER_FONT_CSS`. |
| `shared/lib/print-window.spec.ts` | The ATM print door is in the "one door" list. |
| `formal-arabic.spec.ts` | `VERBATIM_PAPERS` = the three files; the non-spec ATM paper files other than the wording file hold no Arabic letter. |
| `remembered-filters-coverage.spec.ts` | The five new pages are classified (§9.8), with the notes and reasons. |
| `settlement-plan-page.spec.tsx` | The chooseBranch state; empty state with and without manage; actions hidden without print, Excel hidden without export; figures are counts only; the stale-receipt notice. |
| `preparation-page.spec.tsx` | A cancelled line is read only; «تم التجهيز» disabled with its missing list. |
| `control-page.spec.tsx` | The zones button only with `can.zones`; the unassigned group first; «النوع» and «المنطقة» columns. |

### 10.5 Gates (both work packages, before hand-off)

- `npm run lint`, `npm run typecheck`;
- contracts, api-unit and web tests;
- the full integration suite;
- `check:page-registry`, `check:permission-matrix` (no diff expected), the formal-Arabic guard,
  `check:secrets`;
- `npm run build`.

New files are prettier-clean. Repo-wide `format:check` already fails on the base, so only the
touched files are checked.

---

## 11. GAP register and rollout

### 11.1 GAP register (for the owner unless marked)

| # | Gap | Phase-1 behaviour until answered |
|---|---|---|
| GS-1 | 42 of the 103 Al Baraka Full list machines are absent from the register (40 dated on or before 16-03-2026). 1 differs only by zero-padding inside the ID, and 1 of today's 25 REP. TAPE lines matches nothing. | They are `notFound` when no Operations machine carries the code, else `noRegisterBank`; either way they cannot be planned. The downloadable differences report lists them. **Efficiency must receive them in the register before the pilot covers them** (§11.2 step 0). |
| GS-2 | 4 machines handed back in the register are still in the Full list. | `archived`; not planned. |
| GS-3 | Do October (EGYCASH-5) and Wisal (EGYCASH-7) keep their own Al Baraka masters? 49 open Al Baraka machines there are not in the Full list. | Each branch imports its own master (DS-1); nothing is assumed. |
| GS-4 | Is the bag QR the same number as «رقم قفل الحقيبة»? | QR is captured as scanned; both boxes stay on the Note for handwriting. |
| GS-5 | What is «رقم راجع الحقيبة»? | Blank box on the Note, as today. |
| GS-6 | Do cassette seals carry a scannable barcode, and in what format? May a seal hold Arabic letters? | Scan or type; any 1–64 printable characters (a QR 1–200); Arabic letters warn (§3.5). |
| GS-7 | Does a bag that comes back un-replenished go out again with the same seals? | Duplicates warn and never block; cancelled lines' values stay searchable. |
| GS-8 | Does a 0-note cassette travel in the bag, and need a seal? Is a bag holding only 0-note cassettes closed with a QR? Do deposit cassettes travel? | 0-note cassettes are bagged with an optional seal; a bag of 0-note cassettes has an optional QR; deposit slots are not bagged (DS-4, DS-13). |
| GS-9 | What do «كاسيتات», «نقل أموال» and "recycle" in the TYPE label mean? Are slots of a "recycle" model recycle slots? Is the reversed order (0/50/100/200) physical? (Evidence: on all 13 reversed rows, HELP lists the denominations in the opposite order to the slots, `helpOrderOpposite`.) | Imported as withdrawal slots in stored order, with flags `typeMentionsRecycle`, `reversedOrder` and `helpOrderOpposite`; Settlements corrects by hand. |
| GS-10 | What does the Full list `Date` column mean? | Not imported. |
| GS-11 | Full list `Dep` (26 area names) vs the ECMS area; REP. TAPE's short `Dep` codes. | Full list `Dep` is stored as `hubLabel` and prints as «المنطقة» and HUB, as today (the ECMS area only when it is missing); REP. TAPE's `Dep` column exports the ECMS area; `areaDiffers` is reported. |
| GS-12 | Which machines take Al Baraka's second standard total, and are there only two? | Every machine uses the default (row 1) unless Settlements points it at the other. |
| GS-13 | Cassette capacity per model. | No capacity check; 100,000 notes is a sanity cap only. |
| GS-14 | Foreign-currency slots: the denominations per currency, and who plans forex (المركزية for NBE). | Stored and shown, never filled, bagged or printed in phase 1. |
| GS-15 | Is a crew line per run? Should the leader come from ATM Operations? Who signs the route sheet? | A route per day across runs; free-text leader; the seals sheet's footer. |
| GS-16 | Should Control & Supplies confirm the handover in the system, and should captures lock after it, or after the replenishment date? | No confirm and no lock: printing is audited, and Preparation can reopen a prepared line at any time, as nothing locks the paper today. |
| GS-17 | Who receives `ATM_2`? | Exported beside REP. TAPE. |
| GS-18 | Should a reprinted Note be marked as a copy? | Not marked; every print is audited and counted. |
| GS-19 | The bank's logo on the Note. | The bank's Arabic name prints in its box. A logo upload is a later setting. |
| GS-20 | (Proposal) Print the Note serial as a QR so Preparation can scan the Note to open its line. | Not built; typing the serial opens the line (§9.6). |
| GS-21 | What happens to a machine that is not replenished: its Note, seals and ledger line. The return half of the Note. | Phase 4. |
| GS-22 | Spare-set codes for Al Baraka (none seen). | Optional free `spareCode`. |
| GS-23 | Is «رقم الكاسيت» the slot number (prefilled 1–4 today) or a physical cassette serial? | The slot number, as today. |
| GS-24 | The date format on the papers. `Print!B9`, `بيان التغذية!B3` and `REP. TAPE!O8` use Excel's built-in short date (numFmtId 14), which follows each PC's regional setting; the papers' only explicit formats are `سيلزات!D1` `[$-1010000]d/m/yyyy`, `REP. TAPE!D4` `[$-409]d/mmm/yy` and `Print!G72` `m/d/yy h:mm:ss`. What do the office PCs show? | Papers print `d/m/yyyy` and the Note's timestamp `m/d/yy h:mm:ss`; the `.xlsx` writes built-in 14 in O and `[$-409]d/mmm/yy;@` in D4 (DS-18). |
| GS-25 | (Engineering) A machine with open entries of two banks. | Belongs to no bank; listed nowhere and refused (`otherBank`). |
| GS-26 | A layout change applies from the moment it is saved, to every line added after it, whatever its replenishment date. Is a date from which it applies needed (the bank changes a machine's denominations "from Sunday")? | No effective date. The save dialog lists the machine's lines dated today or later, and those lines warn (`LAYOUT_CHANGED`, `LAYOUT_CHANGED_AFTER_ISSUE`). |
| GS-27 | A line issued after «بيان التغذية» was printed: does the vault get a replacement paper or a supplementary one for the late lines? | The paper is reprinted whole when Settlements chooses; the plan page and the print dialog show that it is out of date and what the last print covered. |
| GS-28 | «بيان التغذية» and «سيلزات» print `=TODAY()`, the print day; only the Note's date change was accepted. Should they show the replenishment date too? | Both keep the print day, as today. |
| GS-29 | The Full list and today's REP. TAPE disagree on one line's cassettes (24 same / 1 different), and the Note prints REP. TAPE's copy. Which source is right when they differ? | The Full list seeds the layout; `repTapeDiffers` flags the machine for Settlements to check by hand. |
| GS-30 | «إسم الماكينة» (LOC) today comes from REP. TAPE `location`, which differs from the Full list on 8 of 25 lines; ECMS prints the machine's name. Which name should the Note carry? | The ECMS machine name (the line's snapshot); `nameDiffers` reports where the Full list differs. |
| GS-31 | Banque Misr's «المسائى2» may name a wave of the day rather than a machine's second visit. | Run = the machine's ordinal visit that day (DS-31). |
| GS-32 | (Preparation) In what order are a bag's cassettes sealed and its QR scanned? | The form asks for each cassette's seal, then the bag's QR (§9.6). |
| GS-33 | (Preparation and Control) When does Preparation fill and seal the bags: the evening before, or after midnight on the day? | Both pages open on the earliest day from today with issued lines not yet prepared, else tomorrow (DS-25). |
| GS-34 | The accepted "serial number" on the Note: is a running number per branch and bank what was meant, or is the day's line number (1, 2, 3 … as today) enough? | A running number per branch × bank that never restarts (DS-11). |

### 11.2 Rollout

0. **Prerequisites, before the import.**
   - Efficiency receives the Al Baraka machines missing from the register (GS-1) and settles the 4
     handed-back ones (GS-2).
   - The administrator grants the department bundles (§7.1). Manage, import, capture, print and
     export must be granted at **branch or organization scope**: a department-scope grant reads
     and never writes. The seed widens only super-admin.
   - `atm.settlements.banks` stays at its default `['BRK']`.
1. **Deploy.**
   - `db:sync-indexes` in report mode, then `apply` (`INDEX_SYNC_MODE`).
   - The boot step builds the ten collections' indexes (§4.10).
   - Nothing migrates; no existing document is touched.
2. **Seed.**
   - Settlements at Mohandessin uploads that day's Al Baraka master, reads the differences report,
     and downloads it for Efficiency (GS-1).
   - Apply `newOnly` with standard loads.
   - Correct the flagged machines by hand (`reversedOrder`, `typeMentionsRecycle`,
     `registerCountDiffers`, `registerDenominationsDiffer`, `repTapeDiffers`). A later import in
     `newAndChanged` leaves those corrections alone (`changedManual`); `overwriteManual` is used
     only to replace them on purpose.
   - Point the machines that use the second standard total at it (GS-12).
3. **Parallel run (one week).**
   - Settlements builds the day's plan in ECMS beside the Excel master.
   - Each evening compare, by count only, «بيان التغذية» from ECMS and from Excel:
     - ECMS lines with Excel's `E16` (Excel counts lines: `COUNTA('REP. TAPE'!B8:B107)`);
     - ECMS distinct machines with the number of distinct REP. TAPE IDs (ECMS's printed count adds
       spare sets);
     - the 200, 100 and 50 rows only (Excel's 20/10/5 rows point at empty rows and are always 0),
       and the total.
   - Print the ECMS Notes for Preparation. Export the `.xlsx` and paste it into Inventory and DR.
4. **Preparation and Control & Supplies.**
   - Preparation captures seals and QRs from day 1 of the parallel run.
   - Control & Supplies builds the routes («إنشاء الخطوط من القطاعات» where zones exist) and prints
     the handover and route sheets.
5. **Switch.** When the owner agrees, the Excel master stops for Al Baraka. The next bank is phase 2:
   its import profile, request-file upload if any, and the setting.
6. **Rollback.** The feature only adds collections and routes; withdrawing the keys hides it. Excel
   remains the fallback throughout the pilot.

---

## Appendix A. Work packages and file ownership

### WP-S1 — contracts + API (first)

**Contracts**
- `packages/contracts/src/modules/atm-settlements.ts` + `.spec.ts` (NEW)
- `packages/contracts/src/index.ts` (export)
- `packages/contracts/src/modules/atm.ts` (`AtmSettingKeys.SettlementBanks`)
- `packages/contracts/src/modules/atm-map-geometry.ts` + spec (`zoneMembership`, `inBox` and the
  `Membership` types, moved from the web, §6.9)
- `packages/contracts/src/errors/index.ts` (§6.1 codes)
- `packages/contracts/src/platform/audit.ts` (two verbs)

**API — new files under `apps/api/src/modules/atm/`**
- `shared/branch-scope.ts` + spec (NEW; `map/map-scope.ts` becomes aliases)
- `settlements/settlements.routes.ts`, `settlements.controller.ts`
- `settlements/shared/{register-bank,day-signals}.ts` + `register-bank.spec.ts`
- `settlements/layouts/{cassette-layout.model,cassette-layout-version.model,layout.service,layout.repository}.ts`
- `settlements/standard-loads/{standard-load.model,standard-load.service}.ts`
- `settlements/import/{master-profiles,read-master-workbook,plan-layout-import,apply-layout-import,layout-import.service,layout-import-run.model}.ts` + specs
- `settlements/plans/{plan.model,plan-line.model,note-counter.model,plan.service,plan-dto}.ts` + spec
- `settlements/prints/print.service.ts`
- `settlements/preparation/{line-preparation.model,preparation.routes,preparation.controller,preparation.service,seal-duplicates}.ts`
- `settlements/control/{dispatch-route.model,route-assignment.model,control.routes,control.controller,control.service}.ts`

**API — changed files**
- `register/import/read-register-workbook.ts` + spec (§5.1: `reduceWorkbookToSheets`, the error
  factory, the entry-count check)
- `register/import/register-import.routes.ts` (`workbookUpload(maxMb)` exported)
- `atm.module.ts`, `atm.module.spec.ts`, `atm.settings.ts`
- `atm-indexes.ts`, `shared/open-operation.spec.ts`
- `apps/api/src/seed-navigation.ts` + spec
- `apps/api/src/platform/realtime/realtime-registry.ts`

**Tests:** `apps/api/tests/integration/atm-settlements.spec.ts` (NEW);
`apps/api/tests/integration/auth-seed-login.spec.ts` (`SEEDED_APPLICATIONS` 130 → 134).

**Done when:** §10.1–§10.3 are green, the §10.5 API gates pass, and an API smoke test on a synthetic
workbook is run.

### WP-S2 — web (after WP-S1's contracts build)

**Promotions**
- `apps/web/src/shared/lib/xlsx-writer.ts` + spec (NEW); `modules/fleet/lib/fleet-xlsx.ts` becomes
  a re-export
- `apps/web/src/shared/lib/paper-fonts.ts` + spec (NEW); `modules/fleet/lib/custody-paper-fonts.ts`
  becomes a re-export
- `modules/atm/lib/map-geometry.ts` re-exports `zoneMembership` from contracts

**New files under `apps/web/src/modules/atm/`**
- `api/settlements-api.ts`, `api/settlements-queries.ts`
- `lib/settlement-dates.ts`, `lib/settlement-view.ts`, `lib/preparation-form.ts` + specs
- `lib/papers/{settlement-paper-wording,settlement-print,note-print,receipt-print,handover-print,rep-tape-xlsx,import-report-xlsx}.ts` + specs
- `components/settlements/*` (§9.3) and the dialogs of §9.4–§9.7
- `pages/{SettlementPlanPage,CassetteLayoutsPage,LayoutImportPage,PreparationPage,ControlPage}.tsx`
- the page specs of §10.4

**Changed files**
- `modules/atm/routes.tsx`, `pages/AtmOverviewPage.tsx`, `atm-i18n.spec.ts`
- `apps/web/src/platform/localization/i18n.ts`
- `apps/web/src/platform/realtime/invalidation-registry.ts`
- `apps/web/src/shared/lib/remembered-filters-coverage.spec.ts`
- `apps/web/src/shared/lib/print-window.spec.ts` (the "one door" list)
- `apps/web/src/platform/localization/formal-arabic.spec.ts`
- `scripts/check-formal-arabic.mjs` (`VERBATIM_PAPERS`)

**Done when:**
- §10.4 is green and every §10.5 gate passes.
- A live check is done as an organization user and as a branch-scoped user per department, on
  synthetic data: build, issue, print all four papers (and a blocked pop-up), export, capture with
  a keyboard wedge (Latin and Arabic layouts), a duplicate warning, routes from zones, and the route
  sheets.

---

## Review log

**Revision 1** (2026-10-26) was written from the two grounding reports (the Al Baraka print formats
and machine matching; the ECMS conventions) and from the code read at `4d820f3b`.

**Revision 2** (2026-10-26) applies three reviews: security (SEC), money (MON) and paper fidelity /
UI (UI). Each finding was checked against the code at `4d820f3b` or against the workbooks (counts,
headers, formats and labels only) before it was applied. The owner's decisions S-1…S-10 (§2.1) are
unchanged. "Applied" means applied as proposed; "applied, adapted" names the one change made.

| Finding | Result | Note |
|---|---|---|
| SEC-1 E11000 caught inside a transaction | applied | One small `unitOfWork` per row; E11000 / guard misses counted outside it; standard loads and the run row in their own transaction (§5.4). |
| SEC-2 Guards checked outside the writing transaction | applied | Guarded `updateOne` with `__v` + status in S16–S21, P3–P5; reopen guards the preparation's emptiness, cancel bumps its `__v`; interleaved tests (§6.5, §6.8, §10.3). |
| SEC-3 Duplicate lines on concurrent adds | applied | `$inc lastPosition` first, in-session re-check, `ux_plan_machine_run` partial unique index, E11000 → 409 (§4.5, §6.5). |
| SEC-4 Print checked by key presence | applied | View-key read, then `keyReachesBranch` of the print key; C7 `routes` narrowed; `orgViewOwnPrint` → 403 (§6.2, §6.7, §6.9). |
| SEC-5 Reopen keeps `notePrintCount` | applied | Reset on reopen, `printCount` kept in `voidedSerials`, serial diff in the audit, voided serials resolve in Preparation (§6.5, §9.6). |
| SEC-6 Note printed with a just-voided serial | applied | Guarded increment in one transaction, 409 on a short match; every print audit records `[{ lineId, serial, version }]` (+ preparation version) (§6.7). |
| SEC-7 Two imports at once | applied | `state` + `ux_one_running` per branch × bank, stale takeover, `ATM_LAYOUT_IMPORT_RUNNING` (§4.8, §5.4). |
| SEC-8 Apply undoes a manual edit made after the preview | applied | `previewRevisions`; a revision mismatch is a conflict, never written (§5.4). |
| SEC-9 Import branch undefined | applied | Required `branchId`, import key pair, `BRANCH_MISMATCH`; S3 scoped; S8 body branch checked (§5, §6.4). |
| SEC-10 Multipart fields unparsed | applied | Route chain order and `LayoutImportFieldsSchema` with the harmless defaults (§6.1, §6.3). |
| SEC-11 Reader limits not sized | applied | Verified: 39 entries, about 75 / 130 / 12 / 90 KB, 1.1 MB file. `MASTER_WORKBOOK_LIMITS`, 10 MB, one deadline, one reduction for both sheets (§5.1). |
| SEC-12 Register error codes leak into the settlements reader | applied | Error factory; `ATM_LAYOUT_IMPORT_LAYOUT` is 422 like the register; §6.1 updated (§5.1). |
| SEC-13 Zip entry flood before any cap | applied | End-of-central-directory check (≤ 500 entries, no ZIP64) before `loadAsync`, in the shared reader, with spec cases (§5.1, §10.2). |
| SEC-14 Untrusted text unbounded | applied | HELP split without a regex; `cleanLabel`; over-cap → `invalid` + `labelTooLong`; schemas refuse `\p{Cc}`; the xlsx escaping drops XML-invalid characters (§3.1, §5.3, §6.1, §8.5). |
| SEC-15 Register reads without projection | applied | One `registerBankRows` helper with the projection, asserted by a spec (§6.2, §10.2). |
| SEC-16 "Any of" endpoints with no scoping key | applied | S1 `?page=`; S7 reads with the OR of both matches; every `can.X` by `keyReachesBranch`; `can.zones` by map scope (§6.4, §6.9). |
| SEC-17 C3 reads zones without map scope | applied | Work branch must be in map reach; locations read with the map match (§6.9). |
| SEC-18 Route writes race | applied, adapted | `from` per move, target route `__v` bump, `ux_branch_date_name`, `ux_zone_route`, cancelled assignments excluded. The 100-route cap is counted inside the transaction but stated as a sanity cap, since no document serialises route inserts (§4.7, §6.9). |
| SEC-19 Cascaded writes not audited | applied | `delete` on preparation / assignment, `create` per C3 write, standard-load diffs incl. the cleared default, one row per printed route (§6.4, §6.5, §6.9). |
| SEC-20 Duplicate detection gaps | applied | Every key against both fields (`crossKind`), bounded `$topN` aggregations, `\p{Cf}` stripped, `ARABIC_LETTERS` warning (§3.5, §6.8). |
| SEC-21 Nothing records what a «بيان التغذية» covered | applied | `receiptPrint` / `handoverPrint` serials on the plan, `receiptStale` / `handoverStale`, serials in the audit (§4.4, §6.7). |
| SEC-22 GS-16 promises a date limit the API lacks | applied (second option) | GS-16 rewritten: no lock and no date rule, as nothing locks the paper today; no rule invented (§11.1). |
| SEC-23 Line routes not tied to the URL's plan | applied | `{ _id: lineId, planId, isDeleted: false }` + read match, else 404 (§6.2). |
| SEC-24 `.xlsx` export needs only view | applied | `atmSettlementPlan.export` with branch reach; 42 permissions (§6.7, §7). |
| SEC-25 Realtime never reaches Preparation and Control | applied | `atm.preparationDay` / `atm.controlDay` signals with `branchId`, literal pairs for the registry scan (§6.11). |
| SEC-26 Inconsistent blocked-branch error | applied | One rule: 422 `ATM_WORK_BRANCH_REQUIRED` with `CHOOSE_BRANCH` / `NO_BRANCH`; S1 keeps a 200 with `blocked` so the page can say why (§6.2). |
| SEC-27 Handover prints unconfirmed QRs | applied | `qrs` only for prepared lines; others blank and counted in `notPrepared` (§6.9, §8.4). |
| SEC-28 Department-scope grants never write | applied | Stated in §6.2, §7.1, §11.2; `deptManage` / `deptCapture` → 403 cases (§10.3). |
| SEC-29 Test 15 cannot pass; missing race cases | applied | Top bar at «كل الفروع»; interleaved cases for SEC-1…4, 6…8, 13 and 18 (§10.3). |
| MON-1 REP. TAPE drops the per-denomination counts | applied | Verified: R7:T7 = 200/100/50, R:T = the sums on 25/25 lines, Inventory G4:K4 and DR E2:H2 per denomination. R:T (U:W when needed) exported, Q blank, cassettes 5–8 after them, `byDenomination` in the DTO (§8.5, DS-20). |
| MON-2 Foreign slots filled as EGP | applied | `isPlanned`, `SLOT_NOT_FILLABLE`, `egpTotalMinor`; DS-4 now also keeps foreign slots off the Note's filling rows (§3.1, DS-4). |
| MON-3 Minor units never converted | applied | `fromMinorUnits` once, `sumMinorUnits`; an 800,000 paper test (DS-28, §10). |
| MON-4 `otherBank` mixes "no bank" with "another bank" | applied | Verified (legacy-imported masters, DEC-30). `noRegisterBank` outcome and refusal; §5.3 and GS-1 reworded. |
| MON-5 The seed ignores REP. TAPE's denominations | applied | Verified 24 same / 1 different. REP. TAPE codes and denominations read (never counts), `repTapeDiffers`, `registerDenominationsDiffer`, GS-29 (§5). |
| MON-6 `helpDisagrees` ambiguous | applied | Verified: ordered 15 vs multiset 2. Multiset rule, `helpOrderOpposite`, GS-9 evidence (§5.3). |
| MON-7 Re-import reverts manual corrections | applied | `changedManual`, written only in `overwriteManual` (DS-7, §5.3). |
| MON-8 Lines do not record the layout revision | applied | `layoutRevision`, revision-based `LAYOUT_CHANGED`, `LAYOUT_CHANGED_AFTER_ISSUE` (§3.7, §4.5). |
| MON-9 No effective date for a layout | applied (second option) | GS-26; the detail lists `affectedLines` and the save dialog shows them (§6.4, §9.5). |
| MON-10 Lines keep only a pointer to their profile | applied | `standardNotes`, in-use check covers drafts, refresh defined, `DIFFERS_FROM_STANDARD` drafts only (§3.7, §6.4, §6.5). |
| MON-11 Standard-load import and schema gaps | applied | `mismatch` / `invalid` outcomes never applied; unique denominations refined (§5.3, §6.1). |
| MON-12 Concurrency of adds and issue | applied | Merged with SEC-2 / SEC-3; issue filters `{ _id, planId, status: 'draft', __v }` (§6.5). |
| MON-13 The even split only via standard loads; per-slot edits unchecked | applied | `denominationNotes` through `splitByDenomination`, unique slots, `UNKNOWN_SLOT` / `SLOT_NOT_FILLABLE` (§3.3, §6.5). |
| MON-14 No record of the receipt; parallel-run compares unlike figures | applied | Audit carries the six rows and serials; dialog shows the last print; GS-27; §11.2 step 3 compares lines with `E16`, distinct machines with distinct IDs, and the 200/100/50 rows. |
| MON-15 A bag of 0-note cassettes can never be prepared | applied | `bagNeedsQr`; QR optional for such a bag; GS-8 (DS-13, §6.8). |
| MON-16 HUB and LOC change source | applied | Verified on the paper. `hubLabel` stored and printed (ECMS area only as fallback), `nameDiffers`, GS-30 (DS-5, §8). |
| MON-17 xlsx dates and styles under-specified | applied, adapted | Date serials, styles, merges and the owner's file name applied; O uses Excel's built-in format 14 (what openpyxl labels `mm-dd-yy`), not a custom `mm-dd-yy` code, per UI-6 (§8.5). |
| MON-18 Empty and deposit slots in the export | applied | Verified (4 lines blank in cassette 4, the reversed line 0/0). Trailing non-planned slots blank, inner ones 0/0 (§8.5). |
| MON-19 Summary figures unspecified | applied | Non-cancelled lines, distinct machines, draft bags by allocation (§6.1, §6.5). |
| MON-20 "Run" undefined | applied | DS-31 (verified: both repeats AM then PM); GS-31 for Banque Misr's waves. |
| MON-21 The differences report cannot be handed on | applied | Preview `.xlsx` (no amounts); the strip's button renamed «عرض نتيجة آخر استيراد» (§5.3, §9.5). |
| UI-1 Note widths of F and G wrong | applied | Verified `<col min="5" max="7" width="19.71">`; corrected shares, about 169 mm (§8.2). The research note GROUNDING_A §1 was corrected too. |
| UI-2 Missing word on the return half | applied | `unloadTechStamp` (verified `Print!B29`) (§8.1, §8.2). |
| UI-3 Seals signature not verbatim | applied | Verified 54 dots (§8.1). |
| UI-4 Additions not on the paper | applied | Footer line and `planOf` dropped; a blank TYPE prints blank (§8.2). |
| UI-5 Receipt and seals dates changed silently | applied | Both keep the print day; GS-28 (DS-18, §8.3, §8.4). |
| UI-6 Date format rests on a misread | applied | Verified numFmtId 14 on B9, B3, O8; papers print `d/m/yyyy`, the timestamp keeps `m/d/yy h:mm:ss`, the xlsx writes 14 and `[$-409]d/mmm/yy;@`; GS-24 corrected. |
| UI-7 The serial looks like today's | applied (first option) | Running number per branch × bank (`atm_note_counters`, the fleet counter); GS-34 asks the owner to confirm (DS-11, §4.9). |
| UI-8 HUB from the wrong source | applied | Merged with MON-16. |
| UI-9 Bag and cassette words disagree | applied, adapted | Papers say «الحقيبة»; screens say «كاسيت» for a slot everywhere (the page is now «فئات الكاسيتات»). «شوال» and «سيلز» stay on screens as the owner's own words (S-6, the «سيلزات» sheet); Operations' «أختام الأكياس» names the vault's custody bags, another object (DS-32). |
| UI-10 Print engine unspecified | applied | `@page`, colour adjust, page breaks, fonts promoted to `shared/lib/paper-fonts.ts`, bidi rules (§8). |
| UI-11 Blocked tab / failed request | applied | Tab first, no request when blocked, close on failure; `popupBlocked` key; one-door list (§8, §9.4). |
| UI-12 Papers follow the UI language | applied | `translate('ar', …)` for paper words; test (§8, §10.4). |
| UI-13 Logo repeated per Note | applied | Written once as a CSS rule (§8). |
| UI-14 Row offsets undefined | applied | Explicit rule r, r + 2k, r + 4k (§8.2). |
| UI-15 Seals run column too narrow | applied | Compact «2 · 9:00 م»; body font stated (§8.4). |
| UI-16 Grid sheet cannot produce §8.5 | applied, adapted | Fonts, fills, merges, number formats added after id 5; instead of changing Fleet's `styles.xml`, a book with no grid sheet keeps today's bytes and only a grid book writes the extended stylesheet, pinned by a test (§8.5). |
| UI-17 Normalisation alters the QR | applied | Value as scanned + separate `key`; QR 200, seal 64 (§3.5, §4.6). |
| UI-18 Arabic keyboard layout | applied | Merged with SEC-20; the message keeps focus on the field (§9.6). |
| UI-19 Scan order | applied | Cassettes before each bag's QR; local cross-field warning; GS-32 (§9.3, §9.6). |
| UI-20 Wedge details | applied | Select on focus, Tab suffix, `preventDefault`, focus back to the serial box, two-run lookup, in a pure `sealKeyAction` (§9.3, §9.6). |
| UI-21 Refetch wipes a half-scanned line | applied | Seed once, never overwrite while dirty, re-apply after a 409 (§9.6). |
| UI-22 One bad time rejects a batch | applied | `normalizeScheduleTime`, per-row `badTime`, `LineListInput` reused (§3.6, §6.5, §9.4). |
| UI-23 "Tomorrow" is wrong after midnight | applied | Server-suggested day, «اليوم» / «غدًا», `cairoDay` reused; GS-33 (DS-25). |
| UI-24 Route sheets gaps | applied | One page per route, `notPrepared` / `unassigned` with a confirm, bank column and neutral TYPE header (§6.1, §8.4, §9.7). |
| UI-25 Control drops paper columns | applied | «النوع» and «المنطقة» in Tab 1; area and zone on Tab 2 items, sorting by area (§9.7). |
| UI-26 "Lines from zones" contradicts the map | applied | Review pins included (verified `map.service.ts:115`); `zoneMembership` moved to contracts (DS-17, §6.9). |
| UI-27 Census entries would fail | applied | Note on the import page; reasons for `q` and `machine` (§9.8). |
| UI-28 Seeded-login count missed | applied | `auth-seed-login.spec.ts:36` → 134 with its breakdown (§7.3). |
| UI-29 Export needs no key | applied | Merged with SEC-24. |
| UI-30 Money among the header figures | applied | Counts only; the total stays in the footer (§9.4). |
| UI-31 Placeholder names differ | applied | `{{bag}}` in both; same-placeholders test (§9.9). |
| UI-32 No-Arabic test would catch spec files | applied | Non-spec `.ts` files only (§8.1). |
| UI-33 Blocked branch, two errors | applied | Merged with SEC-26. |
| UI-34 Test plan gaps | applied | Parallel issue, the Note cases, route print, duplicate-key variants, capture refetch and Arabic letters (§10). |

No finding was rejected outright. Four were applied in an adapted form (SEC-18, MON-17, UI-9,
UI-16), and three offered two options, the chosen one named (SEC-22, MON-9, UI-7).

## Implementation notes

WP-S1 step a (contracts and the pure/importer layer of the API). One line each: section, change, why.

- §3.1 `layoutIssues`: a spare slot that is not planned is reported as `SLOT_COUNT` on that slot — the "every slot planned" rule of a spare has no code of its own in the list.
- §3.4 `fillFromStandard(slots, null)` fills every planned slot with 0 — the "else all 0" case of §6.5 S14 step 4, so the caller needs no empty profile.
- §3.6 / §8.5: added `repTapeSlots(slots)` (the blank / 0-0 rule of the REP. TAPE and ATM_2 pairs) and `ATM_REP_TAPE_BANK_LABELS` (`BRK → 'AlBarka'`, the "contracts constant" of column P) — `AtmRepTapeExportDto.slots` names the rule but no function.
- §6.1: added the query schemas §6.3 needs (`AtmSettlementContextQuerySchema`, `AtmSettlementBankQuerySchema`, `AtmSettlementPlanQuerySchema`, `AtmSettlementDayQuerySchema`, `AtmVersionQuerySchema`) and the code lists behind the DTO unions (issue, outcome, flag, mode, refusal, status, print-kind) — the routes validate queries and the web's enum-backed i18n test (§10.4) needs the lists.
- §6.1 `LayoutImportFieldsSchema`: `previewRevisions` leaves the schema parsed (`{ machineId, revision }[]`); the `superRefine` validates the JSON and a `transform` parses it, so the service never parses it again.
- §6.9: with `zoneMembership` and `inBox`, `LatLngBox`, `MembershipZone` and `membershipZones` moved too — `zoneMembership` reads each zone's cached box, so a caller must be able to build one; the contracts' box helper is `latLngBoxOf` because the file already has a private `boxOf`. The web keeps its copy until WP-S2 makes it a re-export.
- §5.1 `readSheetRows`: takes `columns` (a list, or one per row) and `lastRow`, so the settlements reader reads exactly the cells it names and REP. TAPE's count columns are never read; a reduction also returns its `sheets` (names, in reading order) and its `errors`, and a sheet is found by position, because ExcelJS names a worksheet through the original rels target, which a renamed part no longer matches.
- §5.1 entry count: besides the end record's fields, the central directory is walked (from where JSZip starts it, prepended bytes included) and counted, because JSZip reads central records until the signature stops, whatever the end record says.
- §5.2: REP. TAPE row 7 is checked over the columns read only (B `Reference`, E/G/I/K `Denom1..4`), a miss named `REP. TAPE!<col>7`; Full list headers are looked for in its first 64 columns, the first match binding; `masterProfileOf(bank)` answers `ATM_LAYOUT_IMPORT_UNSUPPORTED_BANK`.
- §5.3 cells: a denomination or count cell holding a text of digits is read as that number (what Excel shows); the standard row's D may be any number (a non-integer D is a `mismatch`, not `invalid`).
- §5.3 `reversedOrder`: slot 1 empty and at least two later denominations strictly rising.
- §5.3 `registerDenominationsDiffer`: an open entry whose `withdrawal1..5` are all blank is not compared (it names nothing), and a register 0 is dropped like a Full list 0.
- §5.3 row DTO: a label over its cap is returned as `after: null` (the row is `invalid` + `labelTooLong`), so an overlong cell never rides the preview response.
- §6.2 `register-bank.ts`: `bankOfEntries` reads an open entry without a bank as no bank — `[null]` → `noRegisterBank`, `[BRK, null]` → `otherBank` (the `commonBankCode` rule); `registerRowsByMachine` and `bankMachineIds` (the bank's machines in a branch, re-checked) are the two reads §6.2 describes.
- §6.1 audit verbs: the web's audit-label specs (`system-admin-i18n.spec.ts`, `audit-screens.spec.tsx`) fail until WP-S2 adds the two `systemAdmin.users.audit.*` keys of §9.9.

WP-S1 step b (models, services, routes, the integration suite). One line each: section, change, why.

- §6.2 / §6.9 C7 `routes`: the body branch is first narrowed (`OUT_OF_REACH`), then must equal the Control page's work branch (422 `ATM_WORK_BRANCH_REQUIRED` when blocked, 400 `BRANCH_MISMATCH`) — §6.2 lists route prints among both the work-branch endpoints and the body-branch checks, §6.9 names only the narrowing; both apply, narrowing first.
- §6.4 S7: a `branchId` query is checked against the OR of the two pages' read reach (`OUT_OF_REACH` when neither view key reaches it) — the read match is that OR, and `narrowToBranch` on one key would refuse a plan-only user the profiles their page offers.
- §6.4 S6: saving the layout of an archived machine answers 422 (business rule) — "live and active" names no code.
- §6.4 S9: a PUT naming another bank than the profile's answers 400 `BANK_MISMATCH` — a profile keeps the bank it was created for, and the schema carries `bankCode` on every save.
- §6.5 S16: `refreshLayout` on a spare line answers 400 `SPARE_LINE` and on a machine with no layout 422 `NO_LAYOUT`; moving a line onto an occupied run answers 422 with detail `DUPLICATE_IN_RUN` — the spec names the outcomes, not the codes.
- §6.5 S21: a machine line answers 409 `ATM_PLAN_LINE_STATE`; a refused machine answers 422 with the reason (`unknownCode` / `inactive` / `noRegisterBank` / `otherBank`) as the detail code.
- §6.9 C3: spare lines are counted in `unlocated` — `AtmRoutesFromZonesResultDto` has no spare count, and a spare set has no point.
- §6.9 C7 `routes`: a listed `routeIds` entry that is not a live route of that day answers 400 `ROUTE_GONE` — the other route writes' code for the same case.
- §10.3 case 10: slot 9 is refused by `SlotNotes` (`max(8)`, §6.1) as a schema 400, so `UNKNOWN_SLOT` is proven with slot 5 on a 4-slot line.
- §10.3 "Interleaving": an add has its own pause point (`plan.add.beforeWrite`, before its transaction) so "two concurrent adds of the same code" runs interleaved like the other race cases; every pause point is a no-op unless a test registers it.

WP-S2 step a (the web foundations: promotions, api client, libs, papers, i18n). One line each: section, change, why.

- §8.5 `xlsx-writer.ts`: the grid stylesheet adds a ninth font, Tahoma 10 **bold** (id 8), for `bold`, `head` and `group` in a Tahoma sheet — `REP. TAPE`'s B4 and its row 6/7 headers are Tahoma 10 bold, and the listed fonts have no bold Tahoma 10. `headRed` / `headBlue` stay the listed non-bold red / blue.
- §8.5 `xlsx-writer.ts`: grid cells and columns are 1-based (A = 1); `columnLetter(col)` and `excelDaySerial('YYYY-MM-DD')` are exported so the REP. TAPE builder names merges and writes date serials without its own copies. Every (body font × style) pair is declared, ids 6–31, in a fixed order.
- §8.5: the Fleet bytes are pinned by the SHA-256 of a sample book (every part and the whole zip) taken from `fleet-xlsx.ts` before the move.
- §10.4 `print-window.spec.ts`: the one-door import regex now accepts three or four `../` — `modules/atm/lib/papers/` is one folder deeper than the other doors.
- §8 `settlement-print.ts` holds the document shell (`paperDocument`), the escaping helpers and `settlementPaperWords()` beside the door; the builders import the shell from it, the door never imports a builder (callers pass `compose`), so there is no cycle and no extra file. The toolbar's buttons are `common.print` / `common.close` in Arabic.
- §8.2 Note: drawn as a CSS grid at the `Print` sheet's own cell ranges (its merges, borders, fills, fonts and alignments read from the workbook's structure, no values): signature labels top-centred as the paper; K64:K66 three bordered tick boxes; the logo spans A1:D3; the bank's name in J1:L3 has no border; a two-bag split puts «1» on row 6 and «2» on row 7; the run band is bold 22 pt text with no fill (the spec names no look). The builder filters `isPlanned` itself as well as the server.
- §8.3 receipt: the counts print `#,##0` (DS-18), though the sheet's count cells are General; the frame is thin as §8.3 says (the sheet's is thick).
- §8.4 handover: the route sheet's title date is the replenishment date (the route's day); the table's date header stays the print day. A row's code is `machineCode ?? spareCode ?? «—»` (the row DTO has no `kind`).
- §8.5 REP. TAPE: a per-denomination cell of a denomination the line lacks is 0; pairs 5–8 appear when any line has more than four physical slots, and a shorter line leaves them blank. The column widths are the paper's.
- §5.3 / §9.5 import report: `import-report-xlsx.ts` takes the caller's translator (`importReportWords(t)`) and names the file `Full list differences BRK dd-mm-yyyy.xlsx` — the spec names neither; its serial header is the new key `atm.layoutImport.report.serial`.
- §9.2 queries: an applied import invalidates layouts, the open layout, standard loads, import runs and plans (no row lists the import); S22 prints invalidate the plan and C7 the plan and Control's day (print counts and the stale notices move); a `STALE_DOCUMENT` re-reads the family it was about.
- §9.3 `preparation-form.ts`: besides the listed functions it exports `fieldOrder`, `fieldId`, `serverValues`, `isDirty`, `setFieldValue`, `resolveConflict` and `saveBodyOf` — "a field the server changed meanwhile is marked for the user to choose" needs a state and a choice; `seedOnce` re-reads a CLEAN form when the server's version moved, and never a dirty or conflicted one.
- §9.3 `settlement-dates.ts`: adds `nextDay`; `runCompact` takes an optional locale, Arabic by default (it is the seals paper's).
- §9.3 `settlement-view.ts`: tones use the shared `Badge` vocabulary (draft warning, issued info, prepared success, cancelled neutral; preparation none/partial/complete/prepared → neutral/warning/info/success); `lineChips` returns planned slots only.
- §9.9: besides the quoted strings, keys were added for labels the pages need and the spec does not quote — dialog titles and field labels, `atm.plan.issuesCount`, `atm.plan.error.issueBlocked`, `atm.plan.error.bankNotEnabled`, `atm.layouts.layoutIssue.*` (the per-slot errors of §9.5), `atm.layoutImport.flag.codeWhitespace` (the flags line lists 11 of the enum's 12), `atm.prep.conflict*`, `atm.prep.leave.body`, `atm.prep.notFound`, `atm.control.menu.label`. All pass the formal-Arabic guard and have the same placeholders in both languages.
- §10.4 `atm-settlements-i18n.spec.ts`: "no subtitle on the four pages" is asserted as the absence of the five pages' `*.subtitle` keys (the `atm-register-i18n.spec.ts:274` pattern); the pages themselves come in step b.
- WP-S1's audit-label gap is closed: `system-admin-i18n.spec.ts` and `audit-screens.spec.tsx` pass with the two `systemAdmin.users.audit.*` keys.

WP-S2 step b (the five pages, their dialogs and the page specs). One line each: section, change, why.

- §9.10 focus return: the shared `Dialog` moves no focus, so the settlement pages use `components/settlements/SettlementDialog.tsx` — the shared dialog plus `useReturnFocus(open)`, which refocuses the element that held the focus when the dialog opened (skipped when it left the page, e.g. a panel re-keyed by a save) — and `MenuButton` gives the focus back to its own button before an item runs, so a dialog opened from a menu returns to it. Changing the shared dialog for every module is outside this package.
- §9.4 `PrintReceiptDialog`: the plan summary carries the last print's time and name but not its serials, so «{{added}} سطور أضيفت و{{removed}} سطور أزيلت منذ آخر طباعة.» is shown as a toast right after the print, from the receipt DTO's `previous.serials` (GS-27); before printing, the dialog shows the last print and the stale notice. The dialog opens only when drafts exist or a previous print exists; otherwise the click prints at once.
- §9.4 «السطور المحددة»: the table's checkbox appears only on lines that have a Note (issued or prepared); a tick on a line that stops being printable is dropped.
- §9.4 notes box: the count commits on Enter or blur and only when it changed; ArrowUp/ArrowDown move it to the next or previous hundred (the "step 100"), never below 0.
- §9.4 `AddMachinesDialog`: as the board's open form, the boxes clear once something was added and the refused codes stay listed with their reasons; a click outside never closes it (`dismissOnOutsideClick={false}`), × / «إغلاق» / Escape do.
- §9.5 layouts search: the machine ID matches as a prefix (case-insensitive) and the name by `foldIncludes`, as the unlocated list; a `standardLoadOtherBank` flag shows beside the standard load, the other flags beside the cassettes.
- §9.5 import page: while no preview is on screen it shows the last run's counts per outcome (counts only, §5.3); an applied result hides the apply block — its revisions are the ones just written, so a new preview starts the next apply; `previewRevisions` carries the rows an apply may write (`new`, `changed`, `changedManual`) that name a machine.
- §9.6 the find box: a code with several runs opens its first line not yet prepared and lists them all under the box (new key `atm.prep.codeLines`, «لهذه الماكينة {{n}} سطور في هذا اليوم: {{list}}.»), in run order (`linesOfCode`). Machine IDs are matched as the system stores them (no case folding).
- §9.6 «تم التجهيز»: unsaved captures are saved first, then the line is marked with the saved version, so the mark always covers what the server holds; a change of day or bank goes through the unsaved-captures prompt like leaving the page.
- §9.6 / §9.5 / §9.4 failed reads: a context (or Preparation lines) read that fails for any reason other than the work branch shows the shared `ErrorState` with a retry, never the empty state.
- §9.7 tabs: «توزيع الخطوط» is offered only with manage; `?tab=routes` without it falls back to the data tab. «تحريك لأعلى/لأسفل» swaps the two routes' `order` with two version-checked PATCHes (the order index is not unique). The data tab shows «لا توجد سطور معتمدة لهذا اليوم.» when the day has no line (new keys `atm.control.empty`, `atm.prep.empty`); the new-route dialog's title is `atm.control.route.create`.
- §9.8 overview cards: icons `ReceiptIcon` (plan), `LayersIcon` (layouts), `QrIcon` (Preparation), `TruckIcon` (Control); each card's key is its route's guard.
- §10.4 no subtitle: besides the absent `*.subtitle` keys, `atm-settlements-i18n.spec.ts` now reads the five page sources and asserts that every `<PageHeader>` passes a `title={t('atm.….title')}` and no `description`/`subtitle`.
- §10.4 page specs: `cassette-layouts-page.spec.tsx` (not listed) covers both layout pages and their pure helpers (`versionDiff`, `applyEstimate`, `withKind`, `duplicateTexts`).

Review fixes (SEC-1..SEC-5, MONEY-1..MONEY-3). One line each: section, change, why.

- §6.5 S18 / §6.8 P3–P5 (SEC-1): a re-issued line's new preparation starts its version above the voided one's (`__v` = the highest of the line's earlier preparations + 1), so a version read from the voided preparation names it alone and a P3, P4 or P5 sent from that form answers 409. The bodies stay `{ version, … }` (no preparation id, the reviewer's own test sends none); the web's form also keys on `preparation.id` and is dropped — re-seeded, never merged — when the line's preparation was replaced.
- §6.9 C3 / C1 (SEC-2): each reused zone route is written inside C3's transaction (`$inc __v` under `isDeleted: false`, 409 on a miss), as C6 writes its targets, so a C5 delete committed meanwhile conflicts and the retried attempt makes a new route. C1's `unassigned` and the web's two tabs count a line whose assignment points at a route that is not live as «لم يُوزّع بعد»; its `routeId` stays the stored one, so a move sends the `from` the server holds.
- §6.9 C3 / C6 (SEC-3): inside the transaction each line is written (`$inc __v` under `status ∈ {issued, prepared}` and the branch-day): C6 answers 400 `LINE_STATE` for a line reopened or cancelled since its checks and C3 skips it, and a concurrent S19 / S20 conflicts. A Control move therefore moves the line's version (a Settlements screen holding the old one re-reads on its 409). C3 has a pause point of its own, `control.zones.beforeWrite`, outside its transaction (§10.3).
- §6.5 S19 (SEC-4): the reopen reads the line's `notePrintCount` in its transaction and filters its write on it, so `voidedSerials[].printCount` is the stored count, a Note print committed after the first read included.
- §6.3 / §6.10 (SEC-5): the shared workbook upload bounds the text fields as well as the file — at most 10 fields of 256 KiB each, 11 parts — and a breach is the cap's 422 `TOO_LARGE` (detail field `body`, the multer code as its message); the register import shares the factory.
- §6.5 S15 / S16 (MONEY-1): after the even split, a share above `ATM_CASSETTE_NOTES_MAX` answers 400 `CASSETTE_NOTES_MAX` on `body.denominationNotes.<i>.notes`, the spare path too (before its insert, so never a 500); the web words it (`atm.plan.error.cassetteNotesMax`).
- §4 plan line / §6.5 S16 step 1 (MONEY-2): the line stores `standardLoadChosen` — true after S15 or S16 step 2 with a profile, false after S14 and after S16 step 2 with null. `refreshLayout` refills from the line's profile only when it was chosen (and is live), else `layout.standardLoadId`, else the bank default: S14 records the inherited default in `standardLoadId`, so "`line.standardLoadId` first" never reached the layout's pointer.
- §3.7 (MONEY-3): `LAYOUT_CHANGED` / `LAYOUT_CHANGED_AFTER_ISSUE` need the revision moved AND the slots (kind, denomination, currency by slot) or one of the three labels to differ from the line's copy; a save that only re-points `standardLoadId` still bumps the revision and writes its version row (the history is kept) but raises neither. `AtmPlanLineIssueInput` carries `featuresLabel` / `hubLabel`, and the context's `layout` its content (`AtmLayoutContent`).
