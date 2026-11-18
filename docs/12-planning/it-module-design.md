# IT Module — Architecture & Domain Design

**Status:** **FROZEN v1.2** (2026-08-03) — owner-approved; the single reference for IT
implementation. §13's defaults are adopted as decisions. Any deviation or discovery that needs
an architectural change is raised as a Design Review or a new ADR **before** implementation,
never during it, and lands as a new revision in §17.
**Methodology:** same as HR and Fleet — design first, owner approval, then delivery in reviewed
slices, each extending one module manifest.
**MVP scope (owner-defined):** Asset Management · Help Desk · Maintenance · Software & Licenses ·
Warranty & Vendors · Dashboards & Reports.

---

## 0. Scope and non-goals

**In scope (MVP):** asset register with categories, QR identification and printable labels ·
custody lifecycle (assign / return / transfer / dispose) with a full per-asset history · help
desk (tickets, categories, priorities, technician assignment, comments, attachments, SLA,
closure) · maintenance (preventive plans, corrective orders, schedule, spare parts, history) ·
installed software, license management and license expiry · warranty tracking, vendors and vendor
contacts · module dashboards and warranty/asset reports · the events that make all of it
automatable.

**Non-goals (this module, this phase):**

- **Asset accounting** — purchase cost is *recorded* (it is part of the asset's identity card),
  but depreciation, book value and asset ledgers belong to a future Accounting module. IT
  publishes events; Accounting subscribes when it exists (same boundary as Fleet §9.3).
- **Procurement** — no purchase requests, quotations or purchase orders. `purchase` fields on an
  asset describe *what happened*, not a workflow that happened here.
- **Automatic software discovery** — installed software is recorded by technicians in MVP. An
  agent/scanner is a future integration that would *feed* the same collections.
- **Email-to-ticket ingestion and a public portal** — tickets are created inside ECMS by
  authenticated users (§13-Q4 decides who).
- **CMDB dependency mapping, network monitoring, remote management.**
- **1D barcode printing** — QR only (§2.2, decision D2); no new dependency.
- **Vehicles** — vehicles are Fleet's assets. The boundary is physical: if it is registered in
  `fleet_vehicles`, it never appears in `it_assets` (§9.2). The vehicle device checks (§2.12) read
  Fleet's car list through IT's one Fleet import surface (§9.2); they register no vehicle.

## 1. Platform study — what exists and is reused (nothing below is rebuilt)

Every capability in this table is live in the platform today, verified in code, and the IT module
consumes it as-is. This is the section that guarantees the module adds *domain*, not
*infrastructure*.

| Platform capability | Where it lives | How IT uses it |
|---|---|---|
| **RBAC + permission matrix** | `packages/contracts/permissions/def.ts`, module manifests, generated matrix | `declarePermissions('it', …)` in the manifest; closed action vocabulary + documented specials (§7) |
| **Data scopes** (own/section/department/branch/organization) | contracts `DATA_SCOPES`, `base.repository.ts` | assets and tickets carry `branchId`; "my tickets" is the `own` scope, not custom code (§7) |
| **Audit** | `platform/audit` + `AUDIT_ACTIONS` | every mutation audited; six named actions added to the closed vocabulary (§10) |
| **Entity timeline (activity+audit)** | audit F1/F2, BD-007 | ops-level history for any IT record; *business* history is module-owned (§2.3, D3) |
| **Files** | `platform/files`, additive attachments | ticket + comment + asset attachments; no new upload path (§2, §5) |
| **Notifications** | `notificationTemplateService.ensure`, channel adapters, quiet hours | seven templates seeded by the module seed (§8.2) |
| **Event bus + outbox** | ADR-008 envelopes, generated event catalog | all §8 events declared with Zod payloads → they appear in the automation trigger picker automatically |
| **Automation engine** | ADR-018 | §8 *is* the integration; nothing else needed |
| **Scheduler** | `scheduledTasks` in the manifest | four sweeps (§4.8); idempotency via set-once stamps, Fleet's sweep-mark pattern where needed |
| **Settings** | `declareSetting` at module load | warn windows, SLA at-risk threshold, auto-close days (§8.3) |
| **Sequences** | BD-002 atomic `$inc` idiom (`hr_sequences` precedent) | `it_sequences` for asset/ticket/order numbers (§2.1) |
| **Directory (person names)** | `platform/directory` (BF-5) | holder/technician/requester names on every list |
| **PDF service** | `platform/pdf` (Contracts CT-5 chromium seam) | printable QR label sheets (§4.2) |
| **QR** | `qrcode` (api) + `qrcode.react` (web) — already dependencies (Contracts A23) | asset QR generation and on-screen rendering; **no new dependency** |
| **Navigation catalog** | `seed-navigation.ts` additive sync (BF-1) | new `IT` category, icon `monitor` (already in the icon registry); existing installs pick it up at boot |
| **Web kit** | shared tables/CRUD/pages kit, `UserPicker`, i18n ar/en + RTL | all pages; **every reference picker is server-side search from its first commit (ADR-019 rule 5 — binding)**, except a vehicle-code picker, which lists every active car ([ADR-037](../03-decisions/ADR-037-vehicle-code-pickers-list-every-active-car.md), FR-21) |
| **Workflow engine (ADR-011)** | *accepted as ADR, not built as a platform service* | **not used.** Recruitment built its own module engine; Fleet used code-defined lifecycles in services. Tickets follow the Fleet precedent (§4.4, D4); the gap is recorded in ADR-022 (§13) |

Two hard lessons from production are carried in as design rules:
**minimize-safety** — any collection whose rows carry a `metadata`/free-object field sets
`minimize: false` (the recruitment-timeline outage, PR #117); **picker-safety** — no "load all +
client filter" anywhere in the module (ADR-019 rule 5 blocks it at review), the vehicle-code
picker excepted (ADR-037).

## 2. Entities (all collections `it_*`, module id `it`)

### 2.1 Identity and numbering

`it_sequences` (BD-002 idiom: single document per key, atomic upserting `$inc`) allocates:

| Key | Format | Used by |
|---|---|---|
| `asset:global` | `AST-00001` | every asset, permanent, never reused (survives disposal) |
| `ticket:global` | `TKT-00001` | every ticket |
| `maintenanceOrder:global` | `MO-00001` | every maintenance order |
| `consumable:global` | `CON-00001` | every consumables-store item (§2.11), permanent |
| `consumableMemo:global` | `EGYCASH-IT-CON-0001` | every consumables memo (§2.11) — the paper's own series |

Global and monotonic — no per-branch or per-year partitions (the employee-number precedent;
§13-Q1 lets the owner change format labels before freeze, not the allocation model). A unique
index on each code is the second line of defence.

### 2.2 `it_assets` — Asset

The register row. One asset = one physical (or licensed-hardware) item.

| Field | Notes |
|---|---|
| `assetCode` | `AST-…`, unique, permanent |
| `name`, `description?` | what it is |
| `categoryId` | → `it_catalog_items` (`kind: assetCategory`, §2.4) |
| `status` | **derived, never hand-set**: `inStock` \| `assigned` \| `underMaintenance` \| `disposed` (§6) |
| `serialNumber?`, `model?`, `manufacturer?` | identity card; `serialNumber` sparse-unique |
| `externalTag?` | a pre-existing printed tag/barcode number, searchable — legacy labels keep working without printing (D2) |
| `branchId` | data-scope anchor; changes only via **transfer** (§2.5) or **«نقل إلى فرع»**, the move to another branch (below) — which for a held asset IS that transfer |
| `location?` | free text (room/desk) within the branch |
| `purchase?` | `{ date, cost?, vendorId?, invoiceRef? }` — recorded facts, not accounting |
| `warranty?` | `{ vendorId?, start, end, terms? }` — embedded (D9); expiry sweep reads `warranty.end` |
| `currentAssignmentId?` | denormalized head of the open assignment, `null` when in stock |
| `disposal?` | `{ at, method: sold\|scrapped\|donated\|lost\|returnedToVendor, reason, notes? }` set once |
| `notes?` | |
| `specs?` | `{ processor?, memory?, systemType?, storage?, mediaDrive?, displayAdapter?, graphicsMemory?, networkAdapters[] }` — the rows of the custody acknowledgment's specifications table (FR-18); a row left empty is left off the paper |
| `accessories[]` | «مشتملاته» — what is handed over with the device (a charger, a bag…), one entry each |

**The move to another branch («نقل إلى فرع», §17 2026-11-11):** one or more assets (at most
`IT_ASSET_MOVE_MAX`, 100) to ONE branch, in ONE transaction — every asset moves or none does —
recorded at once (no «in transit», nothing to confirm at the other branch) and with no paper: the
history is the record. The target is read as an id: lower-cased once (`objectId()` admits
upper-case hex), so a copy of an asset's own branch reads as «already there», never as a move from
a branch to itself. Refused, in this order, before anything is written:

1. a target the caller's `itAsset.assign` does not reach (`keyReachesBranch`) — **403**;
2. a target that is not a branch, or an inactive one — **400** (`body.toBranchId`, `UNKNOWN`);
3. an asset the caller cannot see under that grant's scope — **404** for the whole request;
4. every asset that holds the move back, ALL of them named in ONE refusal, grouped by reason:
   `disposed` (FR-4) · `underMaintenance` — its status, or an order open or in progress (custody's
   guard; the status alone does not say so) · `alreadyThere` — already in that branch ·
   `beforeCustody` — a held asset whose open interval began after the move's date (a transfer
   cannot precede the assignment it closes). Each held asset's open interval is read against the
   move's date here, with the other refusals, so the refusal names it; the transfer still guards
   it, one asset at a time. **409** when every refused asset is under maintenance (custody's
   conflict), **422** otherwise — dropping the one under maintenance would still not let the
   request through.

- **In stock** — `branchId` becomes the target's and `location` is cleared (it names a place inside
  the branch it left, such as the head office's «مخزن IT»); one `transferred` event (§2.3) with
  `{ fromBranchId, toBranchId }` and no employee — the shape the history and the dashboard already
  read as a branch-only move — carrying the move's notes; `it.asset.transferred` with no employee
  follows the commit.
- **Held** — it moves WITH its custody («ينتقل مع عهدته»): exactly §2.5's transfer to a new branch
  in the same hands, through the same code path. The next interval keeps the holder, the receipt
  they signed, and the open interval's due date (`expectedReturnAt`), `conditionOnIssue` and
  `notes` — the move gives none of its own; its notes go on the `transferred` history entry alone.
  Its `location` is cleared as an in-stock asset's is. Only the move clears it: custody's own
  transfer to another branch (`POST /:id/transfer`) leaves `location` as it was.

Each write is conditional on the version read in the same transaction, so a concurrent edit rolls
the whole move back. The audit rows and the events follow the commit, in the order the request
named the assets (§10).

Every asset answer carries `hasActiveMaintenance` — an order open or in progress governs it
(derived on read, never stored: ONE query for the page's ids, as `hasActiveForAsset` counts them).
The screen («نقل إلى فرع» on the register's selection, and on the asset's page) leaves out, with
the reason beside it, what the server would refuse: a disposed asset, one under maintenance (its
status or `hasActiveMaintenance`), and one already in the chosen branch; the rest is sent. Its
branch picker lists the branches the SERVER says the caller's `itAsset.assign` reaches —
`GET /it/assets/move-targets` (`ItMoveTargetsDto { branchIds }`, §12): every active branch for which
`keyReachesBranch` holds, the very test the move applies — other than the one every picked asset is
in. The screen does not work it out from `me`: the account's `branchIds` are the reach of ALL its
grants, so they would offer a branch the move refuses with 403 — the branch a `department`-scoped
`itAsset.assign` merely sits in (that grant never reaches a whole branch), or one only another
grant reaches. While the list is on its way the picker waits; when none is left it says so, and
the move cannot be sent. A held asset dated before its custody began is left to the server's
`beforeCustody`.

**The bulk upload («رفع جماعي», §17 2026-11-16):** one branch's sheet at a time, in the shape of
the branches' custody sheets, is read, decided line by line against the register and PREVIEWED;
nothing is written until the reviewer confirms the lines they kept. The file has no branch column:
the branch is chosen on the screen, and a sheet named «عهدة فرع X» suggests the branch whose name
matches X (the go-live's branch-name folding, `matchBranches` / `foldName`) — only among the
active branches the caller's `itAsset.create` reaches, and only when exactly one answers — which
the picker then shows.

- **The sheet** — one `.xlsx` of at most `IT_ASSET_IMPORT_MAX_MB` (5 MB) and
  `IT_ASSET_IMPORT_MAX_ROWS` (500) data rows. **The workbook is never inflated whole**
  (`workbook.xlsx.load` built every sheet in memory before the 500-line cap applied: a 765 KB
  file of 30 000 rows took 175 MB of heap, a crafted zip far more). It is read as the fuel-card
  reconciliation reads its sheets, through `shared/xlsx/one-sheet-zip.ts`, in two steps:
  - **Unpacked under caps, before a line of it is read.** The zip's entry count is checked before
    anything opens it (more than 500 entries, or any ZIP64 marker, refused —
    [SEC-13](atm-settlements-phase1.md)); then five parts are inflated, each under its own cap
    (`ASSET_IMPORT_SHEET_LIMITS`: the workbook part and its relationships 1 MB each, the styles
    and the shared strings 4 MB each, ONE sheet 6 MB — 501 lines at every column's own limit are
    about 2.5 MB, a real page a few hundred KB), within 20 seconds for the whole read. A sheet
    whose XML inflates past its cap is refused right there, as larger than one branch's sheet,
    before any of it is parsed: a register export of 30 000 lines is refused that way (its sheet
    passes 6 MB long before its last line — 20 000 short lines are already 5.8 MB), not by the
    500-line rule.
  - **Parsed as it streams, and stopped one line past 500.** Within the caps the five parts are
    re-zipped in memory for ExcelJS's STREAMING reader and handed to it in 64 KB slices
    (`readSlices`, views of the buffer, each cut on a character boundary — below), never as one
    buffer. Handed whole, the zip was one
    chunk, unzipper passed the sheet on as one chunk, and the XML parser turned ALL of it into
    events before the first row came out — so «stop past 500» bounded nothing: a 600 KB file of
    20 000 short lines (a 5.8 MB sheet, under its cap) took +283 MB of memory, more than the
    `xlsx.load` it replaced. In slices the sheet reaches the parser a slice or two at a time, is
    parsed as it arrives, and the read stops at the 501st line having parsed about that far and
    the few slices queued behind it: the same file takes +50 to +93 MB (the parse +13 MB of it,
    the rest the sheet unpacked and re-zipped under its cap), a real 500-line page +17 to +20 MB
    (the process's peak memory over the read, measured 2026-11-16). That sheet, past 500 lines
    but within its cap, is then refused by the 500-line rule.
  - **No cut splits a character.** ExcelJS's XML parser decodes every piece it is handed on its
    own, unzipper hands the shared strings and the sheet on in pieces that end where the slices
    end, and the re-zipped parts are stored, their bytes as typed — so a cut that fell inside a
    two-byte Arabic letter read as two «�», written to the register (8 of 17 realistic pages of
    100 to 500 lines, 2026-11-16). Each cut therefore moves forward past the UTF-8 continuation
    bytes after it — at most three, a character being at most four bytes: exact inside the XML,
    harmless in the zip's binary headers, and a slice at most three bytes longer. A piece decoded
    on its own also loses a U+FEFF it starts with — the decoder takes it for a byte-order mark,
    and a cell's «معالج», U+FEFF, «إنتل» read «معالجإنتل» — so a cut also moves past the U+FEFF
    right after it: they end a slice, never start one, and past those three bytes a slice holds
    nothing else.
    And the text is the text typed — what `xlsx.load` reads, or, where `xlsx.load` is wrong, what
    Excel shows. Excel's `_xHHHH_` escapes are decoded in every text cell, shared or inline,
    before it is trimmed: a carriage return Excel stores as `_x000D_` had reached the register
    («كيبورد_x000D_ ماوس»), and `_x005F_` is an escaped «_», so a typed «_x0041_» stays «_x0041_».
    An inline cell written as runs (`<is><r><t>…</t></r>…</is>` — ExcelJS's own streaming writer
    puts rich text so), of which the streaming reader kept only the last, is joined into one text
    before the reader meets it, each run's escapes its own and a phonetic guide left out. A cell
    merged down a block — «النوع» written once beside a run of screens — is every one of those
    lines' value, as Excel shows it and `xlsx.load` reads it (the streaming reader gives it to the
    block's first row only): the sheet's `<mergeCells>` are read from its tail and a merged value
    filled DOWN its column, never across (one accessory merged over L and M stays one), the
    header's own merge left alone, a cell's own value kept. The memory is as above.
  - **Past a cap** — a part, the entry count or the 20 seconds — **422** with
    `{ field: 'file', code: 'SHEET_TOO_LARGE', message: <the part | 'entries' | 'time'> }` and
    the sentence «the workbook is larger than one branch's sheet — upload the custody sheet on its
    own (at most 500 lines)»; the screen says «الملف أكبر من ورقة فرع واحد — ارفع ورقة العهدة
    وحدها (حتى 500 سطر)». It is NOT the upload's own cap — multer's 5 MB, `TOO_LARGE`, «حجم الملف
    أكبر من 5 ميجابايت»: a 1 MB file whose sheet unpacks past one branch's page is not larger than
    5 MB, and saying so would send the reader to shrink the wrong thing.

  Nothing touches the disk. Its first visible worksheet — found from the workbook part, a
  `hidden` or `veryHidden` tab skipped — is read; row 1 must be
  `IT_ASSET_IMPORT_COLUMNS`, A to L — «النوع»، «اسم الصنف»، «سيريال (Serial)»، «الشركة المُصنعة»،
  «الموديل»، «الملصق المطبوع (Tag)»، «المعالج»، «إجمالي ذاكرة النظام»، «نوع النظام»، «إجمالي سعة
  الأقراص الصلبة»، «كارت الشاشة»، «المشتملات» — compared folded (trimmed, spaces collapsed, the
  Latin parts without case), else **422** naming the first header missing or out of place. The
  accessories are L and the unlabelled M; G to K are the specifications table's processor, memory,
  system type, storage and display adapter. Blank rows are skipped; a number is read as its digits
  (a long serial never becomes 1.2e+15), rich text and a formula's result as their text, every cell
  trimmed, an empty one null. The screen's «تحميل النموذج» is exactly that header row.
- **The rules are the branches' custody go-live's** (§17 2026-11-10), decided by ITS planner
  (`planBranchCustody`, generalised to take the sheet's lines — every one a `new` line of the
  chosen branch with its sheet row; the go-live decides exactly as before) against the WHOLE live
  register: every non-deleted asset of every branch, a serial being unique across it. A line is
  found by its serial and its tag against every device's serial number AND printed tag, without
  case — an October all-in-one's «MP…» serial also under its barcode's «S». Each line comes to one
  decision (`IT_ASSET_IMPORT_DECISIONS`):
  - `new` — found nowhere: registered in the chosen branch, in stock, under its tag as its serial
    number when it has one (a Dell's service tag IS its serial), else its serial, and the other
    label as its printed tag (`externalTag`); with its name, its kind's category, make, model (a
    leading copy of the make dropped: «Dell OptiPlex 7090» by Dell is «OptiPlex 7090»),
    specifications and accessories, and the notes «من ملف «<the file's name>» — رفع جماعي». No
    history entry, as no registration has one (FR-5's window stays open).
  - `fill` — found in the chosen branch: it gets only what it has no value for («أكمّل الناقص بس»):
    specification rows, accessories, printed tag, make, model. A value already on the register is
    kept, and shown beside the sheet's where they differ (`kept`). `complete` — nothing to fill:
    left as it is.
  - `move` — found in stock in another branch: moved to the chosen one («يتنقل لفرع الملف»), its
    `location` cleared (a place in the branch it left), and filled. `heldElsewhere` — held, under
    maintenance or disposed in another branch: NOT moved, shown as a conflict, still filled when it
    lacks something. **A device an active maintenance order holds (open or in progress) is never
    moved either**: opening an order leaves it `inStock`, but the technician has it, and every
    other change of branch refuses it (the register's move, custody's own guard) — so it too is
    `heldElsewhere`, its `message` saying an open maintenance order holds it. The orders are asked
    of the devices the plan would move (`itMaintenanceOrderRepository.activeAssetIds`), in the
    apply's own transaction too, and the plan made again holding those back; the go-live's planner
    takes them as an optional input, and the go-live, which passes none, decides as before. One
    decision, but the screen words it from the device's `status` (when the caller sees it), since
    «متسلَّم» says somebody holds it — only an `assigned` device is «متسلَّم في فرع X — لا يُنقل»;
    kept by maintenance, `underMaintenance` or `inStock` under an open order —
    «في الصيانة في فرع X — لا يُنقل»; `disposed` — «مستبعَد في فرع X»; a line naming no device
    reads the neutral «في فرع X — لا يُنقل», and the count chip, which counts them all,
    «في فرع آخر — لا يُنقل».
  - `duplicateInFile` — a second line for a device an earlier line already took: the first wins
    (`firstRow`). `ambiguous` — two devices or more answer to it, and neither is guessed at.
    `noIdentifier` — neither serial nor tag («لو مفيش تاجات فخلاص متضيفهمش»).
  - `unknownKind` — a new line whose «النوع» has no category yet. `invalid` — no «النوع» (a device
    is filed by it), no name, or a value longer than its column's limit (the asset's own: a name
    200, a serial, tag, make or model 120, a specification row or an accessory 200; the kind 100),
    `message` naming the column. Decided BEFORE planning, as `noIdentifier` is: such a line takes
    no part in it, so it never claims a serial or a tag that a later, valid line for the same
    device would then find taken — that line is decided on its own (`new`, `fill` …), not
    `duplicateInFile`.
- **Categories** — each distinct «النوع» is filed under the category the screen gives it
  (`kindCategories`: an active asset category, else **422**), else one matched automatically: the
  live categories' Arabic and English names, folded, and the go-live's kinds (`كمبيوتر مكتبي`،
  `شاشة`، `طابعة`، `هاتف IP`، `لابتوب`; a name containing «neo 50a» is an all-in-one). With neither,
  its new lines are `unknownKind` until one is chosen. The preview lists each kind with its
  category and its line count.
- **Warnings** (`IT_ASSET_IMPORT_WARNINGS`, on `new` lines only — the two doubts the go-live's
  review held back until the owner read the label): `nearSerial` — within two edits of the serial
  of a device of the chosen branch and the same category that no line of the file names (the
  device named when the caller may see it); `productNumber` — no serial, and the tag is HP's
  product number (`/^[A-Z0-9]{5}AV$/`). Such a line can be ticked, but opens unticked.
- **Scope** — the register is read whole, but a device answers only within the caller's grants.
  Only one `itAsset.view` does not reach is hidden: `outOfScope`, with nothing of it shown (no
  code, no branch, no values). One the caller may see but not write is named: a fill needs the
  device within `itAsset.edit`'s scope, a move within `itAsset.assign`'s AND the chosen branch
  within that grant's reach (`keyReachesBranch`) — otherwise the line is `outOfScope` too, with
  its device (code, branch, what it lacks, the values kept) and a `message` naming each right
  missing (`itAsset.edit` does not reach the asset; `itAsset.assign` does not reach the asset, or
  the branch chosen). `complete` needs nothing beyond seeing it. The chosen branch must be active
  and reached by `itAsset.create` (**403**) — the screen offers no other: the server names them,
  `GET /it/assets/import/branches` (§12); with none chosen and none suggested the preview asks for
  one (**422**).
- **What can be ticked** — `new`, `fill`, `move`, and `heldElsewhere` when it has something to
  fill; never `complete`, `outOfScope`, `duplicateInFile`, `ambiguous`, `noIdentifier`,
  `unknownKind` or `invalid`. A line opens ticked when it can be and carries no warning;
  «تحديد الكل/إلغاء» acts on the lines IN VIEW (the pressed count chip's, or all of them): it
  ticks every one there that can be ticked — one with a warning included, since asking for all is
  asking for it — or, when they are all ticked already, clears them; lines out of view keep their
  ticks.
- **The write is the preview that was seen.** The preview answers `fileSha256` (the bytes'
  sha256) and `planHash` (a sha256 of every line's row, decision, device, fields to fill, branch it
  comes from, serial number, printed tag, category and whether it can be ticked, with the branch).
  «تأكيد (n)» sends the same file with both and the rows kept; the server reads and plans again
  against the live register and refuses, writing nothing, when the file or the plan differs
  (**409** — the register changed since the preview: the screen says so and previews again) or
  when a row asked for is not a line of the file or cannot be ticked (**422**). Then it writes
  ONLY those rows, in ONE transaction, through the go-live's own write path — one function both
  use, not a second copy: each device written only as it was read in that transaction (its
  version; a move, still in stock with nobody holding it), so a save in between rolls the whole
  upload back; the new assets' codes one reserved block; a fill's `updated` and a move's
  `transferred` history entries (the two branches, no employee) with the caller as their actor
  and notes naming the file. The audit rows and the events follow the commit (§10).

The screen, `/it/assets/import`, is reached by «رفع جماعي» on the register's toolbar (for
`itAsset.create`). First the template, the file, the branch and «معاينة» — a first preview may go
without a branch, and the one the sheet's name suggests is then shown. The branch select lists
the branches the SERVER says the caller's `itAsset.create` reaches —
`GET /it/assets/import/branches`, filtered from the branch options as the move dialogs filter
theirs (`branchMoveTargets`) — never `me`'s branches, which are the reach of all the account's
grants; while the list is on its way it waits (and «معاينة» with it), and when there is none it
says so. Once a preview is on the screen, choosing another branch previews the same file for it,
and «من اسم الورقة» previews it again with NO branch, so the server suggests one again (or asks for
one) — the select never rests on a branch the plan on screen is not for; step 2 names the branch
the plan is for in words («المعاينة لفرع X»), and «تأكيد» writes to that one. While a preview or a
write is on its way the file cannot be taken off the picker (the shared `FileUpload`'s ✕ obeys
`disabled`, as its drop zone does), so the answer of a write that happened is never lost. The
preview: the counts per decision (each filters the table); the kinds, each with its lines and a
category (changing one, or the branch, previews the same file again); and the lines — the tick,
the sheet's row, kind, name, serial, tag, the decision in words («جديد»، «تكملة بيانات»، «نقل من
فرع X»، «موجود ومكتمل»، «متسلَّم في فرع X — لا يُنقل» (or, as the device's status says,
«في الصيانة في فرع X — لا يُنقل» or «مستبعَد في فرع X» — above)، «خارج صلاحيتك»، «مكرر — الصف N»،
«يطابق أكثر من جهاز»، «بلا سيريال ولا ملصق»، «نوع بلا فئة»، «غير صالح»), the warnings
(«قريب من جهاز مسجَّل: CODE — راجع الملصق»، «الملصق رقم منتج وليس سيريالًا»), the fields to fill
(«يُكمَّل: …», only on a line a tick writes — `new`, `fill`, `move`, `heldElsewhere` that can be
ticked — never on an `outOfScope` one, whose device may lack them but gets nothing), the values
kept (the register's beside the sheet's), the server's `message` on an `invalid`, `outOfScope` or
`ambiguous` line (the column, the right missing, how many devices answer), and the matched
device's code, linking to it.
«تأكيد (n)» then says what was created, filled and moved, each linking to its asset.

**QR (D2):** the QR payload is the plain `assetCode` — not a URL (URLs bind labels to a
deployment host; codes survive redeployment and re-domaining). The web scan surface
(`/it/assets/scan`) resolves a scanned/typed code via `GET /it/assets/by-code/:code`. Server
generates label PNGs with the existing `qrcode` dependency; the printable A4 label sheet
(QR + code + name, N-up) renders through the platform PDF service. 1D barcodes are not printed;
`externalTag` covers assets that already carry one.

### 2.3 `it_asset_events` — Asset History (append-only)

The asset's single business history, same principle as the recruitment timeline (I5): every
custody and lifecycle fact is an event row; screens render history from here, never from audit.
Audit logs are ops-governed and retention-purged (F4) — a custody chain is a business record and
must not depend on them (D3).

`{ assetId, type, at, actorUserId, metadata, notes? }` · `minimize: false` (the PR #117 lesson) ·
types: `registered · updated · assigned · returned · transferred · maintenanceStarted ·
maintenanceCompleted · warrantyUpdated · disposed`. Events without extra facts carry
`metadata: {}` and are handled by type, never by probing metadata keys.

Assets (§2.3) and tickets (§2.6) share **one internal timeline implementation** — one model
factory and one service shape, parameterized by collection and type vocabulary. The idiom
appears twice in the product but once in the code.

### 2.4 `it_catalog_items` — simple catalogs (kind-discriminated, the Fleet pattern)

One collection for every plain name-list the module needs — exactly `fleet_catalog_items`:
`{ kind: assetCategory | ticketCategory, code?, name (ar/en), description?, active, sortOrder }`.
Asset categories and ticket categories are the two MVP kinds; a future simple list joins as a
kind, not as a collection — as the consumables' types did (`consumableType`, §2.11: «حبارات»،
«كابلات»، «محولات»، «ماوس»، «كيبورد»، «رامات»، «هاردات»، «فلاشات»، «أخرى», seeded once and edited
on `/it/catalogs` under the same `itCatalog.manage`). Archive, never delete, once referenced (Fleet catalog rule). No
category tree in MVP (§13-Q2). Catalogs that carry *behaviour* (priorities with their SLA
targets, §2.6) stay their own collections — the `fleet_vehicle_types` precedent.

### 2.5 `it_asset_assignments` — Assignment (custody record)

Open/closed custody intervals; the open one is denormalized on the asset.

`{ assetId, assignedToEmployeeId, assignedByUserId, assignedAt, conditionOnIssue?,
expectedReturnAt?, returnedAt?, returnedToUserId?, conditionOnReturn?, notes? }`

- **Assign**: asset must be `inStock`; creates the record, stamps `currentAssignmentId`, writes
  the `assigned` event, fires `it.asset.assigned`.
- **Return**: closes the record with condition, clears `currentAssignmentId`, writes `returned`.
- **Transfer** (person→person or branch→branch): **one transaction** = close current + open new
  (+ `branchId` change when across branches); writes a single `transferred` event carrying
  `{ fromEmployeeId?, toEmployeeId?, fromBranchId?, toBranchId? }`. Never expressed as
  return+assign on the surface — the history must show intent, not mechanics. When the holder does
  not change, the custody is the same custody: the next interval CARRIES the open one's receipt
  (FR-18) and, unless the transfer request gives its own, its `expectedReturnAt`,
  `conditionOnIssue` and `notes`; a new holder's interval takes them from the request alone. The
  asset's `location` is left as it was (only the move, below, clears it). Its audit row (and a new
  holder's receipt row before it) is written after the commit (§10).
- **Move to another branch** (§2.2, «نقل إلى فرع»): the move of a held asset IS the transfer to a
  new branch in the same hands — the open interval closed, the next opened in the new branch for
  the same holder, carrying the receipt already signed (FR-18), the due date, the condition and the
  interval's notes, one `transferred` event, the `transfer` audit and `it.asset.transferred`. One
  body (`transferInSession`) runs inside a transaction its caller owns: custody's `transfer` for
  one asset, the move for many in one transaction. The move adds two things only it does: it
  clears the asset's `location`, and its notes go on the `transferred` history entry, never on the
  interval. The holder is not refused for having left: a same-hands move hands nobody anything
  (FR-15). The move date may not precede the hand-over it closes, as for any transfer — the move
  checks it for every held asset before anything is written and names each one (`beforeCustody`,
  §2.2).
- **Dispose**: asset must not have an open assignment; sets `disposal`, terminal status; the code
  is never reused; row is never deleted.
- **Receipt** (FR-18): every interval opened for a person carries `receiptId` — the custody
  receipt it was handed over on (§2.5.1). An interval from before receipts has none.

#### 2.5.1 `it_custody_receipts` — Custody receipt (إقرار استلام, FR-18)

The paper the employee signs — the IT department's «إقرار استلام», one page per device — one per
hand-over:

`{ formNumber, employeeId, employeeCode?, employeeName?, jobTitle?{ar,en}, nationalId?, section?{ar,en}, department?{ar,en}, issuedAt, issuedByUserId, branchId,
lines[{ assetId, assignmentId, assetCode, name, serialNumber?, conditionOnIssue?, notes?,
deviceType?, manufacturer?, model?, specs?, accessories[] }],
signedCopy?{ fileId, fileName, mime, size, uploadedAt } }`

- Written in the SAME transaction as the intervals it lists (hand-over, or a transfer to a new
  holder); the lines and the signer are a snapshot of what was recorded — what the paper printed
  for the hand-over shows, or prints later.
- Each line describes its device as its page prints it: `deviceType` (the asset category's
  Arabic name — the word the statement calls the item by: «شاشة», «ماوس», «لاب توب» …, and «جهاز»
  for a computer or a line with none, §17 2026-10-19), the asset's `manufacturer` and `model` (what
  follows it — «جهاز Lenovo / ThinkCentre …»; the asset's name when neither is on file), `specs` and
  `accessories` — the hand-over line's own accessories when it gives them. One composer
  (`receipt-device.ts`) serves the preview, the hand-over, a transfer and a receipt issued for older
  custody, so the paper previewed is the paper stored. Lines from before the acknowledgment have
  none of these and print the asset's name as the device.
- `branchId` is the first line's branch — the read-scope anchor, like an interval's.
- The holder's identity is read from HR through the directory (`getDirectoryIdentityFacts`: the
  national ID and the section, a lookup of its own so the raw ID never joins `DirectoryEmployee`)
  and the organization (the section's and department's names). `nationalId` is stored RAW for the
  paper («بطاقة رقم قومي …»), and leaves the API only for a caller holding `itAsset.viewNationalId`
  (`nationalIdVisible` tells «withheld» from «HR has none»). `section` and `department` are kept
  on the receipt as the record of where the holder worked, but the paper no longer prints them.
  `employeeCode` (the directory's employee code) is printed after the company («كود …»).
- `formNumber` is the paper's own number, printed `EGYCASH-IT-F-14-0001` (counter
  `custodyReceipt:global` in `it_sequences`, partial unique index `ux_form_number`). Every print
  before a hand-over takes the next one; the hand-over records the number of the paper printed
  for it, or takes the next one itself when none was printed or the printed one went stale (§17,
  2026-11-08); printing a stored receipt again keeps its number.
- `signedCopy` links the Files document (category `it-custody-receipts`, authorizer
  `it/custodyReceipt`); replacing it adds a file version, withdrawing it soft-deletes the file.

### 2.6 Help Desk

**Ticket categories** — §2.4 catalog rows (`kind: ticketCategory`), seeded defaults (hardware,
software, network, access, other) — admin-editable, not an enum.

**`it_ticket_priorities`** — `{ name (ar/en), rank, responseMinutes, resolutionMinutes,
active }`. Seeded low/medium/high/critical. **The priority IS the SLA policy.** v1.0 split them
into two collections joined 1:1 by a unique key — normalization without a purpose: admins tune
the name, the rank and the targets as one decision on one screen, and the module carries one
collection and one permission less. A ticket **snapshots** `{ responseMinutes,
resolutionMinutes }` at creation (`sla.policy`), so editing a priority never rewrites history or
running clocks (the contract-template-versioning reasoning). Clock model: 24/7 in MVP; `onHold`
**pauses** the resolution clock (accumulated in `sla.pausedMs`); the response clock never
pauses. Business-hours calendars are §13-Q3. Per-category SLA overrides are deliberately absent
until a real case demands them.

**`it_tickets`**

| Field | Notes |
|---|---|
| `ticketCode` | `TKT-…` |
| `title`, `description` | |
| `requesterUserId`, `branchId` | branch stamped from the requester at creation — the scope anchor |
| `categoryId`, `priorityId` | |
| `assetId?` | the asset this is about, if any |
| `assignedTechnicianUserId?` | |
| `status` | `open → inProgress → onHold → resolved → closed` + `cancelled` (§4.4, §6) |
| `sla` | `{ policy: {responseMinutes, resolutionMinutes}, responseDueAt, resolutionDueAt, firstResponseAt?, responseBreachedAt?, resolutionBreachedAt?, pausedMs, holdStartedAt? }` — breach stamps are **set once** (§4.5) |
| `resolution?` | `{ summary, resolvedByUserId, resolvedAt }` |
| `closedAt?`, `reopenCount` | |

**`it_ticket_events`** — the ticket's history AND its conversation: one append-only stream, one
collection — the recruitment-timeline precedent, where notes are timeline entries (`note` type),
not a sibling collection. Same `minimize: false` rule as §2.3. Types: `opened · assigned ·
statusChanged · priorityChanged · commented · slaBreached` — resolve, close, reopen and cancel
are `statusChanged` rows (`from`/`to` are typed fields), not four more types. A comment is a
`commented` event with two typed fields the other types leave null: `body` and `visibility:
public | internal`. `internal` rows are visible only to holders of `itTicket.edit` (§7) —
filtered in the query/mapper layer (FR-7); the requester never sees them. The ticket page
renders this stream as-is: no interleaving of two collections, no ordering ambiguity.
Attachments: platform Files, additive, owner = ticket, optional `eventId` linkage to the comment
they arrived with.

### 2.7 Maintenance

**`it_maintenance_plans`** — preventive schedule per asset:
`{ assetId, name, intervalDays, checklist?, lastCompletedAt?, nextDueAt, active }`.
`nextDueAt` advances only when the generated order completes (from completion date, not due date
— drift-free, the Fleet alarm-baseline lesson).

**`it_maintenance_orders`** — one collection, two shapes, discriminated by `kind` (the Fleet
violations precedent): `{ orderCode, kind: preventive|corrective, assetId, planId? (preventive),
ticketId? (corrective, when born from a ticket), status: open → inProgress → completed |
cancelled, scheduledFor?, startedAt?, completedAt?, performedByUserId?, vendorId? (external
work), cost?, summary? }`. An order's consumed parts are **not** stored on the order: they are
its movement rows (§ below, keyed `orderId`) — one source of truth, no drift between an embedded
list and the ledger.

An order in `inProgress` puts its asset `underMaintenance`; completion returns the asset to its
prior custody state (assigned assets stay assigned — a laptop being repaired is still that
person's laptop). Maintenance history = the asset's orders + §2.3 events.

**`it_spare_parts`** — `{ partCode, name, unit, onHandQty, minQty?, active }`.
**`it_spare_part_movements`** — append-only ledger: `{ partId, qty (+receipt / −consumption),
orderId? (consumption is always order-tied), at, byUserId, note? }`. `onHandQty` is denormalized
with the same atomic `$inc` write that inserts the movement; consumption below zero is a
`BusinessRuleError`. This is a **minimal store ledger, deliberately not inventory accounting**
(no valuation, no locations, no reservations) — ADR-024 records the boundary.

### 2.8 Software & Licenses

**`it_software_products`** — `{ name, publisher?, active }` — the catalog ("what software
exists"), deduplicating free-text names.

**`it_software_installations`** — `{ assetId, productId, version?, licenseId?, installedAt,
removedAt? }`. Kept after removal (history). One product can appear once per asset while active
(partial unique index on `removedAt: null`).

**`it_licenses`** — `{ productId, licenseKey?, seats (int | null = unlimited), purchase?:
{ vendorId?, date?, cost?, invoiceRef? }, expiresAt (Date | null = perpetual), notes? }`.
`seatsUsed` is **derived** (count of active installations referencing the license) — never
stored, so it can never drift. Assigning a license past its seat count is allowed but fires
`it.license.seatsExceeded` (compliance is a report, not a hard stop — a technician mid-install is
the wrong person to block; §13-Q5). Key visibility is permission-gated (§7); whether keys need
masked display + reveal-with-audit is §13-Q5.

### 2.9 Warranty & Vendors

**Warranty is part of the asset** (§2.2 `warranty` embedded) — one active warranty per asset in
MVP; an extension is an edit (audited, and §2.3 writes `warrantyUpdated` with old→new). A
separate warranty collection is justified only by multi-warranty/claims tracking — out of MVP,
recorded as rejected-for-now in D9.

**`it_vendors`** — `{ name, code?, phone?, email?, address?, services?, active, contacts:
[{ name, role?, phone?, email? }] }`. Contacts are embedded — bounded by business reality (a
vendor has a handful of contacts), rule-4-of-ADR-019 territory. Vendors are IT-owned in MVP;
if Procurement arrives later it takes ownership and IT re-points — the collection prefix stays
`it_` until that day (§13-Q6).

### 2.10 `it_mobile_lines` — Mobile line (خط محمول, FR-19)

The company's SIM lines on its three networks' business accounts — a register beside the assets,
not inside them: a line is a number on a network account, not a device with a serial, a category
and a specifications table (§17, 2026-10-20).

`{ network: vodafone|etisalat|orange, phoneNumber (11 digits, unique ux_phone_number), accountNumber?,
ratePlan?, simKind: physical|esim, simSerial? (the ICCID, unique ux_sim_serial when present; none
for an eSIM), status: inStock|assigned|suspended, branchId, currentAssignmentId?, notes? }`

- **`it_mobile_line_assignments`** — the custody intervals, at most one OPEN per line (partial
  unique index `ux_open_assignment_per_line`, both holder kinds): `{ lineId, holderKind:
  employee|vehicle, assignedToEmployeeId?, vehicleCode?, vehiclePlate?, assignedByUserId,
  assignedAt, returnedAt?, returnedToUserId?, notes?, branchId, receiptId? }`. A tracker SIM is
  held by a CAR, written as the car's code and plate in text — no Fleet id and no Fleet read
  (§9.2 still holds).
- **`it_mobile_line_events`** — the line's history (`registered · updated · assigned · returned ·
  suspended · reactivated`), the timeline model.
- **`it_mobile_line_receipts`** — the employee's «إقرار استلام» for a line: the device receipt's
  header (`formNumber`, `issuedAt`, the signer snapshot, the national ID behind
  `itMobileLine.viewNationalId` — `itAsset.viewNationalId` until §17 2026-11-17) and ONE line snapshot `{ lineId, assignmentId, network, phoneNumber,
  simKind, simSerial?, ratePlan?, accountNumber? }`; `signedCopy` under Files category
  `it-mobile-line-receipts`, authorizer `it/mobileLineReceipt`. One line per paper, so the form's
  undertaking reads as written («لاستخدامه … عليه … برده»). Numbered from the same counter as the
  device papers (`custodyReceipt:global`, EGYCASH-IT-F-14-####): a number printed for one kind of
  paper is refused on the other, and every hand-over claims the number it records inside its own
  transaction (`custodyReceipt:global#<n>` beside the counter in `it_sequences`), so two
  hand-overs racing on one number — whichever kind of paper — cannot both commit.
- `status` is on no write schema; it moves only by hand-over, return, suspension and reactivation.
  A suspended line is held by nobody, and a held line is returned before it is suspended. A held
  line may move branch with its holder: its OPEN interval and the paper it names move with it in
  the same transaction, and its past intervals keep the branch they were held in (§17, 2026-10-28).

### 2.11 `it_consumables` — the consumables store (المستهلكات, FR-20)

The IT team's inks, cables, adapters, mice, keyboards, memory, drives and flash drives — a store
beside the spare parts, not inside them: a spare part leaves the store only through a maintenance
order (FR-9); a consumable is handed to a PERSON, on a memo they sign, and may be named as
installed on one of the register's assets (§17, 2026-10-28).

`{ code (CON-00001, unique ux_code), name, typeId (→ §2.4 kind consumableType), unit, branchId,
minQty?, notes?, active, onHandQty, issuedQty, scrappedQty }` — ONE ROW PER ITEM PER BRANCH (each
branch keeps its own stock; `ux_branch_name` on the live rows), and an item never changes store — a
transfer moves STOCK between two items, one in each store (below). The three counters are
denormalized from the ledger and moved only with it (ADR-024's rule): on no write schema, moved by
one atomic `$inc` whose filter is the guard, so `onHandQty` never goes below zero however many
people take the last unit at once. `belowMin` (on hand at or below `minQty`) is derived
on the answer, never stored.

- **`it_consumable_movements`** — the append-only ledger: `{ consumableId, kind: received | issued |
  scrapped | returned | transferredOut | transferredIn, qty (always positive — the kind says which
  way), at, branchId, byUserId, employeeId?, assetId?, reason?, memoId?, notes?, transferId?,
  counterpartBranchId?, counterpartConsumableId? }` — the last three null except on a transfer's
  pair (index `ix_transfer` on `transferId`). `issued` names the employee and, when it was
  installed on one, the asset; `reason` is `new` or `replacement` («بدل تالف») on an issue and the
  written cause on a scrap. A replacement counts the damaged unit it replaces as scrap too, but takes
  only the new unit off the shelf — the broken one came back from the person and was never on hand.
  A return puts stock back and never lowers `issuedQty` (everything EVER issued). The ledger is
  append-only for QUANTITIES: nothing edits what a movement moved, and a mistake in it is corrected
  by an opposing one.
  **The one correctable fact** (§17 2026-11-17, «تعديل الجهاز»): the device an `issued` unit sits in
  (`assetId`) may be set, changed or cleared after the issue, because it describes where the unit
  went and moves no counter — an opposing movement could not say it. Every other field of every
  row is still never edited; the repository's one write for it (`setInstalledOn`) matches by id,
  the caller's scope, the version they read, the device they read and kind `issued`, sets
  `assetId` alone and moves the row's `__v` on (the ledger's answer carries it as `version`). The
  device it named before is kept on the row (`installedOnBefore`, sparse index
  `ix_installed_on_before`), read by nothing but FR-5's delete guard: the signed copy on file and the
  trail still name it, so it is not «registered in error». The rules are the issue's own:
  gated on `itConsumable.assign`, the movement found within the caller's `itConsumable.view` (else
  **404**, a deleted one too); any other kind **422**; a device named only within the caller's OWN
  `itAsset.view` — without that grant every id is **404** «asset not found» — and not disposed
  (**422**); clearing (null, «بدون جهاز») needs no asset grant; a stale version **409**; the device
  it already names **200** with nothing written. ONE transaction moves the row and its memo line
  (below); after the commit, an `update` audit row on the item (`installedOn` old → new asset id,
  with the `movementId`) and one on the memo (the line's device as printed, before → after), and
  the refresh signals of both topics with the store.
- **Transfer to another branch** («تحويل إلى فرع», §17 2026-11-11) — one or more items of ONE store,
  each with its quantity (at most `IT_CONSUMABLE_TRANSFER_MAX_LINES`, 50), to ONE other active
  branch, at once and with no paper: no memo, no «in transit», nothing to confirm at the other end
  — the ledger is the record. Refused before anything is written, in this order: a target the
  caller's `itConsumable.assign` does not reach (`keyReachesBranch`; `itAsset.assign` until §17
  2026-11-17) — **403**; an item the caller cannot see under that grant's scope — **404**; items of two stores, or a target that is their
  own store (the target lower-cased once and compared as an id, so an upper-case copy of the store
  is that store) — **422**; a target that is not a branch, or an inactive one — **400**
  (`body.toBranchId`, `UNKNOWN`). ONE transaction and ONE `transferId` (a new id) for the whole
  transfer: every line leaves its store and reaches the other, or none does — any line refused
  inside it refuses the whole transfer. The audit rows (both items, and a made item's `create`) and
  the refresh of BOTH stores follow the commit (§10). Per line:
  - the source item's `onHandQty` goes down, guarded in the update's filter as an issue's and a
    scrap's take is — never below what it holds: more than it holds is a **422** naming the item
    and what it has, as an issue's and a scrap's is. A retired item may still send its stock out
    (it empties its shelf, like a scrap); `issuedQty` and `scrappedQty` never move on a transfer;
  - the receiving item is the target store's live item of the SAME name, compared exactly as
    `ux_branch_name` compares it. When there is one it must count in the same unit (trimmed, case
    aside — the refusal names both units) and be active (a retired item takes no new stock,
    receive's rule) — each a **422**; when there is none, the transfer MAKES it: a new code from
    the item series (§2.1, reserved inside the transaction, so a refused transfer leaves no gap),
    the same name, type and unit, no minimum, no notes, active, counters at zero — then its
    `onHandQty` goes up. Somebody adding that name to that store in the same moment makes the
    transfer a **409** («try the transfer again»), nothing written;
  - two movements: `transferredOut` in the source store (`counterpartBranchId` = the target,
    `counterpartConsumableId` = the receiving item) and `transferredIn` in the target store (the
    source branch and item), both with the transfer's `transferId`, date and notes. The ledger's
    answer labels the other store's item code (`counterpartConsumableCode`) at response time.

  The screen («تحويل إلى فرع» on the store's selection, or one row's) takes items of ONE store
  only; an item with nothing on hand is listed and left out of the request, and only the items it
  sends count toward the 50. Each quantity is a whole number from one to what the store holds, its
  box empty until typed. Its branch picker lists the branches the SERVER says the caller's
  `itConsumable.assign` reaches — `GET /it/consumables/transfer-targets` (§12; the assets'
  `GET /it/assets/move-targets` until §17 2026-11-17, when the transfer moved to its own grant), by
  the very test the transfer applies (`keyReachesBranch`) — other than the items' own store. While the list is on its way the picker waits; when none is left it says so,
  and the transfer cannot be sent.
- **`it_consumable_memos`** — «مذكرة صرف مستهلكات», ONE per issue action, listing every item it
  gave: `{ memoNumber, issuedAt, employeeId, employeeCode?, employeeName?, jobTitle?, issuedByUserId,
  issuedByName?, branchId, lines[{ consumableId, movementId, code, name, typeName?, unit, qty, reason,
  assetId?, assetCode?, assetName? }], notes?, signedCopy? }` — a snapshot of what it printed, on the
  device acknowledgment's letterhead with a series of its own (§2.1), not F-14: an F-14 paper
  undertakes to give back what it lists, and a consumable is used up. No national ID on it. The
  issue writes the movements, the counters and the memo in ONE transaction, its number reserved
  inside it, so a refused issue leaves no gap and the paper never lists what the store did not give.
  `signedCopy` under Files category `it-consumable-memos`, authorizer `it/consumableMemo`.
  **The reprint rule** (§17 2026-11-17, «تتحدّث بالجهاز الجديد»): when an issued unit's device is
  changed, the line whose `movementId` is that movement gets `assetId`, `assetCode` and `assetName`
  re-snapshotted from the register at that moment (all three null when cleared), in the same
  transaction as the movement, and the memo's version moves on — so a reprint prints the new device
  under the same number. Nothing else of the paper changes, and the `signedCopy` already filed stays
  as it is: it is the paper that was signed that day, and the audit trail says what changed after.
  A movement whose memo is gone (the reset below) is corrected all the same, with no memo row.
- The workforce reset KEEPS the items and the ledger (the ledger is the stock's explanation) and
  PURGES the memos, which name a person, as it does the other papers; a movement whose memo is gone
  offers none.

### 2.12 `it_vehicle_checks` — Vehicle device check (فحص أجهزة السيارة, FR-21)

A report, filed from a phone, of whether each of a car's devices works: the screen, eight cameras,
the DVR and the Motorola radio — IT's record, not Fleet's (§17, 2026-11-08). The full design is
[it-vehicle-checks-design.md](it-vehicle-checks-design.md).

`{ vehicleId (Fleet's id), vehicleCode and branchId (the car's, when filed), checkDate (a Cairo
day, never after today), items { screen, camera1 … camera8, dvr, radio: works | notWorking | null },
notes?, photos [≤ 5 Files refs, category it-vehicle-check-photos], reportedByUserId, reportedByName,
clientRequestId (unique — a repeated send returns the same report) }` — several reports per car per
day; the car, day, answers and notes never change, and only the reporter adds photos, within 24
hours of filing; no `employeeId` path.

## 3. Relationships

```
it_catalog_items(assetCategory) 1─n it_assets ──1─n it_asset_events        (history)
                          │ ├──1─n it_asset_assignments ──n─1 hr employees (custody)
                          │ ├──1─n it_maintenance_orders ──n─1 it_maintenance_plans
                          │ │        └──1─n it_spare_part_movements ──n─1 it_spare_parts
                          │ ├──1─n it_software_installations ──n─1 it_software_products
                          │ │                └──n─1 it_licenses ──n─1 it_software_products
                          │ ├── warranty ──n─1 it_vendors
                          │ └── purchase ──n─1 it_vendors
it_tickets ──n─1 platform users (requester, technician)
   ├──n─1 it_catalog_items(ticketCategory)
   ├──n─1 it_ticket_priorities                          (carry the SLA targets)
   ├──n─0..1 it_assets                                  (what it's about)
   ├──1─n it_ticket_events                              (history + conversation, one stream)
   └──0..n it_maintenance_orders (corrective, born from the ticket)
platform files ── additive attachments on tickets, comment events, assets
it_mobile_lines ──1─n it_mobile_line_events                                  (history)
   └──1─n it_mobile_line_assignments ──n─1 hr employees | a car (code + plate, text)
              └──n─0..1 it_mobile_line_receipts                              (one line per paper)
it_catalog_items(consumableType) 1─n it_consumables (one per item per branch)
   └──1─n it_consumable_movements ──n─0..1 hr employees    (issued to / returned by)
              ├──n─0..1 it_assets                           (installed on)
              ├──n─0..1 it_consumable_memos                 (one memo per issue, n items)
              └──n─0..1 it_consumables                      (a transfer's other store's item)
it_vehicle_checks ──n─1 fleet_vehicles (id + code/branch snapshot, read through it/fleet-boundary.ts)
   └── photos ──n─1 platform files                          (≤ 5 per report)
```

Cross-module references are **by id + event subscription only** — IT never imports HR or Fleet
services (the Fleet §9.1 discipline). The one exception (2026-11-08, FR-21): IT reads Fleet's car
list through `it/fleet-boundary.ts`, read functions and nothing else — two for the form, a third
for its dashboard (2026-11-10; §9.2).

## 4. Workflows and lifecycles

### 4.1 Asset registration
Create → sequence allocates `AST-…` → `registered` event → status `inStock`. Edit is a plain
audited update (+ `updated`/`warrantyUpdated` events when custody-relevant fields change).
Several at once, from one branch's sheet, through the bulk upload's preview (§2.2, «رفع جماعي»).

### 4.2 Labels
Select assets → server renders QR PNGs (existing `qrcode` dep) → platform PDF service lays out
the N-up A4 sheet → download/print. Printing needs only `itAsset.view` — a label shows nothing
the viewer cannot already see; a dedicated `print` grant would be a permission with no decision
behind it.

### 4.3 Custody: assign / return / transfer / dispose
Exactly §2.5. All four are named service actions (never generic PATCH), each in a transaction:
assignment row + asset denormalization + history event + platform event + audit. Assign, return
and dispose write their audit row inside that transaction; a transfer — and «نقل إلى فرع», the move
to another branch that takes the same path for a held asset (§2.2) — writes its audit rows after
the commit, so a row never outlives a transfer the database then refused (§10). Guards:
assign requires `inStock`; return/transfer require an open assignment; dispose requires none.

### 4.4 Ticket lifecycle (code-defined state machine — D4)

```
open ──assign/start──▶ inProgress ──▶ resolved ──close──▶ closed
  │        ▲   │ hold ▲    │                        ▲ reopen │
  │        │   ▼      │    ▼                        └────────┘ (reopen → inProgress, reopenCount++)
  │        │  onHold ─┘  cancelled
  └─cancel─┘
```

- Assignment (`itTicket.assign`) is independent of state; assigning an `open` ticket moves it to
  `inProgress`.
- **First response** = the first public technician comment or the move to `inProgress`, whichever
  comes first; stamps `sla.firstResponseAt` once.
- `onHold` requires a reason (comment), pauses the resolution clock (§2.6).
- `resolved` requires a resolution summary; the requester is notified via the module's own
  filtered `it.ticket.statusChanged` subscription (§8.2) — resolution is a `to` value, not a
  separate event name.
- `closed` by a technician, or **auto-closed** by sweep after `TicketAutoCloseDays` in
  `resolved` (0 disables). Reopen within the same window reopens *this* ticket; after closure a
  new ticket links back (open question §13-Q7 sets the window).
- The lifecycle is code, not the ADR-011 engine — that engine does not exist as a platform
  service, and tickets must not be the hostage that forces building it (ADR-022 records this).

### 4.5 SLA (policy-as-data, sweep-detected, set-once)
At creation the active policy for the priority is snapshotted; `responseDueAt`/`resolutionDueAt`
computed. The SLA sweep (every 5 minutes) queries indexed due-dates for unstamped overdue
tickets and **stamps `…BreachedAt` exactly once**, writing the `slaBreached` ticket event and
firing `it.ticket.slaBreached` — idempotent by construction (the stamp is the mark; Fleet's
sweep-mark pattern without the extra collection). At-risk (`SlaAtRiskPercent`, default 80%) is a
dashboard query, not a stored state.

### 4.6 Preventive maintenance
Daily sweep finds active plans with `nextDueAt ≤ today+horizon`, generates one `open` preventive
order per plan (idempotent: no second order while one generated from the same plan is not
completed/cancelled), fires `it.maintenance.orderCreated`. Completion stamps the plan's
`lastCompletedAt` and advances `nextDueAt` from the completion date.

### 4.7 Corrective maintenance
Created directly or from a ticket (`ticketId` link). Start → asset `underMaintenance` +
`maintenanceStarted` event; complete → parts consumption movements + cost + summary,
`maintenanceCompleted` event, asset returns to prior custody state.

### 4.8 Scheduled sweeps (module manifest `scheduledTasks`)

| Key | Cron | Does |
|---|---|---|
| `it.slaSweep` | `*/5 * * * *` | §4.5 breach stamping |
| `it.expirySweep` | daily 04:20 | warranty + license expiring/expired events within warn windows (set-once marks on the docs, Fleet FR-14 pattern) |
| `it.preventiveSweep` | daily 04:25 | §4.6 order generation |
| `it.autoCloseSweep` | daily 04:30 | §4.4 auto-close of aged `resolved` tickets |

## 5. Business rules (normative)

- **FR-1** Asset codes, ticket codes and order codes are allocated atomically (§2.1), never
  reused, never editable.
- **FR-2** Asset `status` is derived from operations only; no endpoint sets it directly.
- **FR-3** Every custody change is one transaction spanning assignment row, asset row, history
  event, platform event, audit — partial custody writes must be impossible. The audit rows of a
  transfer and of the move to another branch are the exception: written after the commit (§10);
  hand-over, return and dispose still write theirs inside the transaction.
- **FR-4** An asset with an open assignment cannot be disposed; a disposed asset accepts no
  further operations (terminal).
- **FR-5** Assets are never hard-deleted once they carry any §2.3 event beyond `registered`;
  a registered-in-error asset with no history may be deleted by `itAsset.delete` (audited). Used
  means any trace: a history event, a custody interval, a maintenance order, or a consumable
  installed on it (FR-20) — now, or before a «تعديل الجهاز» moved the unit to another device
  (`installedOnBefore`, §2.11).
- **FR-6** SLA breach stamps are set exactly once and never cleared — a later resolution does
  not rewrite the breach; reports read stamps, not recomputed clocks.
- **FR-7** Internal comments are never returned to callers lacking `itTicket.edit` — enforced in
  the query/mapper layer, not the UI.
- **FR-8** A requester always sees their own tickets (`own` scope) regardless of other grants.
- **FR-9** Spare-part consumption is always tied to a maintenance order and cannot drive
  `onHandQty` below zero.
- **FR-10** `seatsUsed` is computed, never stored; exceeding seats warns (event) but does not
  block (§13-Q5 can harden this).
- **FR-11** Catalog rows (categories, priorities, products, vendors, parts) referenced by any
  record are archived (`active: false`), never deleted.
- **FR-12** All list endpoints paginate under `MAX_PAGE_SIZE`; every reference picker in the web
  app is server-side search + resolve-by-id from its first commit (ADR-019 rule 5); the one
  exception is the vehicle-code picker of FR-21, which lists every active car (ADR-037).
- **FR-13** `hr.employee.exited` never auto-returns assets — physical custody changes only when
  a human records the return (§9.1).
- **FR-14** A requester may cancel their **own** ticket while it is still `open`, and may add
  public comments to their own tickets — ownership rules riding the `own` scope, not grants; no
  permission is minted for either.
- **FR-15** Custody is handed only to a current employee: `assign`, and a `transfer` that names a
  new holder, refuse an employee HR reports as `exited` (422). A branch move in the same hands is
  not a hand-over and stays open to a departed holder. The custody register's holder search finds
  every status, leavers included; the hand-over pickers offer the employed alone (§17,
  2026-09-27).
- **FR-16** Every IT filter that picks a person (custody holder, asset holder, ticket requester,
  ticket technician) finds every employee HR has, leavers included and marked; every hand-over
  (custody assign/transfer, a ticket's technician) offers current employees only (§17, 2026-09-27).
- **FR-17** A ticket's technician is a current employee of the departments in
  `it.technicianDepartmentIds`, resolved through the login's employee (422 otherwise). Until a
  department is chosen the rule is not applied and the technician box offers nobody, saying why
  (§17, 2026-09-27).
- **FR-18** Every hand-over to a person is made on a custody receipt (إيصال استلام, the paper form
  EGYCASH-IT-F-14-02): one employee, one or more in-stock assets, one receipt, written in the same
  transaction as the intervals it opens (`it_custody_receipts`; every interval names it as
  `receiptId`). The screen offers the print before it records the hand-over — the print is
  composed by the server from exactly what will be recorded and writes nothing — but the asset
  hand-over does not wait for it (§17, 2026-11-08): recorded unprinted, or after a change made the
  printed paper stale, the receipt takes the next number and is printed later from the asset, the
  custody register or the employee's history; a stale paper's number is never recorded. A transfer
  to a new holder is a hand-over and gets its own one-line receipt, still printed before the
  transfer is recorded; a branch move in the same hands keeps the paper already signed. The
  receipt keeps what it printed (a snapshot) and can be printed again at any time; the employee's
  signed copy (photo or PDF) is filed against it through Files and can be
  replaced or withdrawn. An interval opened before receipts can be given one while it is open
  (§17, 2026-10-04). Every printed paper carries its own number, `EGYCASH-IT-F-14-0001`, one more
  on every print; the hand-over records the number of the paper printed for it, or the next one
  when none was (a number the counter never handed out, or one already on another receipt, is
  refused); a reprint keeps it.
  The print tab shows the paper as A4 sheets (§17, 2026-10-05). The paper is the IT department's
  «إقرار استلام», one page per device: the statement filled with the employee's name and job and
  the item's kind (its category; «جهاز» for a computer) with its make and model (its name when
  neither is on file) and serial, the device's
  specifications table and accessories (recorded on the
  asset; a hand-over may say what came with it this time), the undertaking, and the signature
  block, dated the day of the hand-over; the footer carries the receipt's number and, on a receipt
  of several pages, the page count (§17, 2026-10-05). The national ID is filled from the system,
  only for a reader holding `itAsset.viewNationalId`; the form's «صادرة من قسم … – … بتاريخ …» is
  not printed; the name under the signature is the first three parts (§17, 2026-10-05). The
  employee's code follows the company, «… بشركة إيجي كاش للحلول النقدية، كود …، بطاقة رقم قومي …»
  (§17, 2026-10-06).
- **FR-19** Mobile lines are a register of their own (§2.10) under their own grants
  (`itMobileLine.*`, page «خطوط المحمول» — the asset grants `itAsset.*` until §17 2026-11-17): registered with their network, number, account, plan and SIM; handed over to a
  current employee — on a printed «إقرار استلام», print first (as devices were until §17,
  2026-11-08) — or to a car by its code and plate, with no paper; returned; suspended and
  reactivated. The screen filters by network with the networks' logos and shows each network's
  figures (lines; in stock, handed over, suspended; accounts; plans) under the other filters; the
  list goes to Excel and PDF. A leaver's lines are flagged like their assets (FR-13), never returned automatically
  (§17, 2026-10-20).
- **FR-20** Consumables are a store of their own (§2.11) under their own grants (`itConsumable.*`,
  page «المستهلكات» — the asset grants `itAsset.*` until §17 2026-11-17), each branch with its own stock: an item is added with its opening quantity, edited, retired
  (`active: false` — it keeps its balances and history; nothing comes in or goes out, though a
  return, a scrap or a transfer out can still be recorded), and its quantities move ONLY by a
  movement — «توريد» (in), «صرف» (out to an employee), «هالك» (out as scrap, with the cause),
  «مرتجع» (back in working order), and «تحويل إلى فرع» / «تحويل من فرع» (between two branches'
  stores). A transfer takes one or more items of ONE store, each with how many — «لو مثلاً فى 10
  ماوس .. فممكن أنقل 5 لفرع تاني» — to ONE other branch at once and with no paper: each reaches that
  store's item of the same name, made there (same name, type and unit) when it has none; never more
  than the store holds, never into an item counting in another unit or retired (§2.11, §17
  2026-11-11). The ledger names, on each half, the other branch and the other store's item. An
  issue goes to a CURRENT employee (a leaver is refused, FR-15's rule), takes
  one or more items of ONE branch's store, never more than it holds, says per item whether it is new
  or replaces a damaged one, may name the register's asset it was installed on (not a disposed
  one — which then counts as used, so FR-5 no longer deletes it), and writes one numbered memo the
  employee signs; the screen prints it at once, and it can be printed again and its signed copy
  filed. The register shows each item's balance, what was issued
  and what was scrapped, and flags an item at its minimum; the movements log answers who was given
  what, and goes to Excel and PDF as the register does. An asset's page lists the consumables
  installed on it; an employee's IT page lists what they were issued (§17, 2026-10-28).
- **FR-21** A user granted the vehicle check (`itVehicleCheck.create`, given through a role) files,
  from a phone, a report on any ACTIVE car: the car (searched by its code), the day (today, may be
  an earlier one), «يعمل» or «لا يعمل» for each of the eleven devices in the owner's order (every
  device opens at «يعمل»; any may be left unanswered), notes, and one to five photos. The car (and
  the pre-filled day) and at least one photo are required, and a note is required while a device is
  «لا يعمل» — the server refuses a new report without it (§17, 2026-11-09). The reports are read on
  IT's dashboard `/it/vehicle-checks` (`itVehicleCheck.view`, scoped by the report's branch at
  filing): the latest report of each active car, the faults per device, the cars not checked for
  seven days, the reports with their photos, Excel and PDF; a wrong report is soft-deleted under
  `itVehicleCheck.delete` (§17, 2026-11-10; [design §11](it-vehicle-checks-design.md)).

## 6. States catalog

| Entity | States | Terminal |
|---|---|---|
| Asset | `inStock · assigned · underMaintenance · disposed` | `disposed` |
| Assignment | `open · closed` (by `returnedAt`) | closed |
| Mobile line | `inStock · assigned · suspended` | — |
| Mobile-line assignment | `open · closed` (by `returnedAt`) | closed |
| Consumable item | `active · retired` (by `active`) | — |
| Consumable movement | append-only: `received · issued · scrapped · returned · transferredOut · transferredIn` — a fact, not a state | — |
| Ticket | `open · inProgress · onHold · resolved · closed · cancelled` | `closed`, `cancelled` (reopen exits `closed` within the window) |
| Maintenance order | `open · inProgress · completed · cancelled` | `completed`, `cancelled` |
| License | derived: `active · expiringSoon · expired · perpetual` (from `expiresAt`) | — (no stored state) |

## 7. Permissions (`resource.action`, moduleId `it` — RBAC + data scopes)

| Screen | View needs | Operations on it |
|---|---|---|
| `/it` (home/dashboards) | any `it*` view permission | — |
| `/it/assets` (+ scan, + labels) | `itAsset.view` | `itAsset.create`, `.edit`, `.export`, `.delete` (FR-5 only), `.assign` («نقل إلى فرع», several at once — the custody grant, as the move of a held asset IS a transfer; no key was added, §17 2026-11-11 — and only to a branch that grant reaches: the picker lists no other — the server names them, `GET /it/assets/move-targets`, under the same grant — and the move answers 403 to one) |
| `/it/assets/import` («رفع جماعي», the register's toolbar) | `itAsset.create` | `itAsset.create` (preview the sheet; register its new lines, in a branch that is active and that grant reaches — 403 otherwise; the branch picker lists no other — the server names them, `GET /it/assets/import/branches`, under the same grant) · `.edit` within its scope (fill what a device the register holds lacks) · `.assign` within its scope AND reaching the chosen branch (move a device in stock in another branch to it — the move's own test, §2.2) — a line whose device the caller may see but not write as it needs is `outOfScope`, the device named and the right missing said; only a device `itAsset.view` does not reach is hidden (`outOfScope` with nothing of it shown). No key was added (§17, 2026-11-16) |
| `/it/assets/:id` custody | `itAsset.view` | `itAsset.assign` (assign + return + transfer + the move to another branch — one custody grant, the roster-precedent: one operational surface), `itAsset.dispose` (a write-off decision, its own grant), `itAsset.viewNationalId` (the holder's national ID on the custody acknowledgment — Security Architecture §3's sensitive-data grant; without it the line is left for the pen) |
| `/it/mobile-lines` | `itMobileLine.view` (the register, a line, its history, its intervals, its acknowledgments read back and reprinted, the lines section of an employee's IT history, the home's lines panel) | `itMobileLine.create` (register a line), `.edit` (edit — its branch included, to one that grant reaches — suspend, reactivate), `.assign` (hand over + return + the line's acknowledgment: print it first, file and withdraw its signed copy), `.viewNationalId` (the holder's national ID on the line acknowledgment — Security Architecture §3's sensitive-data grant, the line's own; the device receipt keeps `itAsset.viewNationalId`). Page `it.mobile-lines` («خطوط المحمول»). Its own keys since §17 2026-11-17; the asset grants carried it from §17 2026-10-20 until then, and open nothing here now |
| `/it/consumables` (+ `/movements`) | `itConsumable.view` (each store, an item, its movements, the ledger, the memos read back and reprinted, the consumables section of an employee's IT history, the home's consumables panel, an asset page's «installed» card — the asset labels a ledger row shows are part of the item's record and read under this grant) | `itConsumable.create` (add an item to a store that grant reaches), `.edit` (edit, retire, receive, scrap), `.assign` (issue to an employee with its memo, take back from one, file and withdraw the memo's signed copy, transfer stock to another branch's store that grant reaches — the picker lists no other: the server names them, `GET /it/consumables/transfer-targets`, under the same grant; «تعديل الجهاز» on an issued row of the ledger — set, change or clear the device it sits in, the row found within `itConsumable.view`, §2.11, §17 2026-11-17). An issue's «installed on», and a device «تعديل الجهاز» names, is an asset within the caller's OWN `itAsset.view` — without that grant every asset is «not found», and only clearing it is left; the screen offers the action only with `itConsumable.assign` AND `itAsset.view`. Page `it.consumables` («المستهلكات»). Its own keys since §17 2026-11-17; the asset grants carried it from §17 2026-10-28 until then, and open nothing here now |
| `/it/people` (the holder boxes, the employees register, a person's head) | ANY of `itAsset.view`, `itMobileLine.view`, `itConsumable.view` | read-only; a person is found when ANY of those three the caller holds reaches them — one selector per held grant, OR-ed by the directory (`anyOfScopes`) — never one key's units standing for the others' (two grants can reach different branches, or one be `own`), and each person's `openCustodyCount` — the assets they hold — is counted within the caller's `itAsset.view` only: 0 for everyone to a caller without it (§17, 2026-11-17) |
| `/it/catalogs` | — | `itCatalog.manage` (asset + ticket categories and the consumables' types — one grant, the `fleetCatalog.manage` precedent) |
| `/it/tickets` | `itTicket.view` (scoped; requesters see own) | `itTicket.create`, `.edit` (work the ticket: status, priority, internal comments), `.assign` (dispatch decision, its own grant), `.close` (close + reopen + cancel, both-directions precedent) |
| `/it/helpdesk-settings` | — | `itSlaPolicy.manage` (priorities + their SLA targets — behaviour-carrying, its own grant: the `fleetMaintenanceRule.manage` precedent) |
| `/it/maintenance` | `itMaintenance.view` | `itMaintenance.create`, `.edit`, `.complete` (complete + cancel) |
| `/it/maintenance-plans` | `itMaintenance.view` | `itMaintenancePlan.manage` |
| `/it/spare-parts` | `itSparePart.view` | `itSparePart.manage` (catalog + receipts; consumption flows through order completion under `itMaintenance` grants) |
| `/it/software` | `itSoftware.view` | `itSoftware.manage` (products + installations) |
| `/it/licenses` | `itLicense.view` | `itLicense.manage` |
| `/it/vendors` | `itVendor.view` | `itVendor.manage` |
| `/it/vehicle-checks` (the dashboard, in the console) | `itVehicleCheck.view` | `itVehicleCheck.view` (the dashboard, the reports, their photos — scoped by the report's branch at filing; the active cars by their current branch) · `itVehicleCheck.delete` (soft-delete a wrong report) — FR-21, §17 2026-11-10 |
| `/it/vehicle-checks/new` (phone, outside the console frame) | `itVehicleCheck.create` | `itVehicleCheck.create` (list the active cars, file a report, add photos to one's own report within 24 hours) — NOT limited by the reporter's data scope, a design decision (the roles screen's default `own` scope would leave no car; [design §4](it-vehicle-checks-design.md)); `itVehicleCheck.view` and `.delete` belong to the dashboard (row above) — FR-21 |

Data scopes on every read/write via the standard base-repository path: `branchId` on assets and
tickets is the anchor; a branch-scoped technician sees that branch's world; `own` gives every
employee their requester view. All permissions land in the generated matrix.

## 8. Events, notifications, settings

### 8.1 Events (`it.<entity>.<pastTense>` — envelope + v1 Zod payloads, auto-catalogued)

| Event | Payload v1 (beyond ids) | Fired when |
|---|---|---|
| `it.asset.registered` / `.updated` | assetCode, categoryId | registry writes |
| `it.asset.assigned` | assetCode, employeeId, assignmentId | §4.3 |
| `it.asset.returned` | assetCode, employeeId, condition? | §4.3 |
| `it.asset.transferred` | assetCode, fromEmployeeId?, toEmployeeId?, fromBranchId?, toBranchId? | §4.3 · the move to another branch (§2.2), once per asset — no employee for one in stock |
| `it.asset.disposed` | assetCode, method, reason | §4.3 |
| `it.asset.warrantyExpiring` / `.warrantyExpired` | assetCode, warrantyEnd, vendorId? | expiry sweep |
| `it.ticket.opened` | ticketCode, categoryId, priorityId, requesterUserId, assetId? | creation |
| `it.ticket.assigned` | ticketCode, technicianUserId | dispatch |
| `it.ticket.statusChanged` | ticketCode, from, to, summary? | every transition — resolved/closed/reopened/cancelled are `to` values selected by automation **filters**, not four more event names |
| `it.ticket.slaBreached` | ticketCode, phase: response\|resolution, dueAt | §4.5, once per phase |
| `it.maintenance.orderCreated` | orderCode, kind, assetCode, planId?, ticketId? | direct + sweep |
| `it.maintenance.orderCompleted` | orderCode, assetCode, cost?, partsCount | completion |
| `it.sparePart.belowMin` | partCode, onHandQty, minQty | consumption crossing the min |
| `it.license.expiring` / `.expired` | productId, expiresAt, seats | expiry sweep |
| `it.license.seatsExceeded` | licenseId, seats, seatsUsed | installation write |

18 events; all become automation triggers with zero extra work. The vocabulary is deliberately
one-name-per-fact: lifecycle transitions ride `statusChanged` + filters (trigger filters exist —
ADR-018 workflow spec), and only facts a filter cannot express get their own name. First
automation candidates: SLA breach → escalate to IT manager; license expiring → WhatsApp the
responsible; asset assigned → notify the holder.

### 8.2 Notification templates (seeded via `notificationTemplateService.ensure`)
`it.ticketAssigned` (technician) · `it.ticketResolved` (requester — sent by the module's own
`statusChanged` subscription filtered on `to: resolved`) · `it.ticketSlaBreached` (supervisors) ·
`it.assetAssigned` (holder) · `it.warrantyExpiring` · `it.licenseExpiring` · `it.maintenanceDue`.

### 8.3 Settings (`declareSetting`, organization scope)
`it.warrantyWarnDays` (30) · `it.licenseWarnDays` (30) · `it.slaAtRiskPercent` (80) ·
`it.ticketAutoCloseDays` (7; 0 = off) · `it.preventiveHorizonDays` (7) ·
`it.technicianDepartmentIds` ([] = not configured; FR-17, edited on the help-desk settings page).

## 9. Integration points

**9.1 HR (live):** custody references employees; requesters/technicians are platform users.
IT NAMES employees through its own read-only `/it/people` (under any of `itAsset.view`,
`itMobileLine.view` and `itConsumable.view` — §7, §17 2026-11-17) and
`/it/technicians` (under `itTicket.assign`/`itTicket.edit`), which read HR through the platform
directory seam (`searchDirectoryEmployees`) — no IT screen needs HR's `employee.view` (§17,
2026-09-27).
Subscribes to `hr.employee.exited`: assets held by the leaver are **flagged** (dashboard panel
"assets held by exited employees" + notification to IT) — never auto-returned (FR-13); the exit
checklist is the human process, the flag is its safety net. The leaver's mobile lines are flagged
the same way, by a second subscription (`it.flagMobileLinesHeldByExitedEmployee`, FR-19).
**9.2 Fleet (boundary, no coupling):** vehicles never enter `it_assets`; `it_maintenance_*` and
`fleet_maintenance_visits` are different domains that happen to share a word. No shared code, no
shared collections. A tracker SIM handed to a car (FR-19) names the car by the code and plate
written on the hand-over — text on the interval, not a Fleet id — and a car Fleet later renames or
disposes is not updated on the line's record. **Amended 2026-11-08 (FR-21):** the vehicle device
checks need Fleet's car list, so IT has ONE read-only import surface,
`modules/it/fleet-boundary.ts` — Operations' and Gold's pattern, narrowed: read functions over
`fleetVehicleRepository` (`listActiveVehicleCodes`, `findVehicleForCheck`, and since the dashboard,
2026-11-10, `listActiveVehiclesForCheckBoard`, every active car with its current branch), not the
repository itself. Through it IT lists active cars and reads a car's code and branch when a check is
filed; it never writes a Fleet collection, and nothing else in IT imports Fleet. None of the three
applies a data scope; IT applies `itVehicleCheck.view`'s to what they return.
**9.3 Contracts/Procurement/Accounting (future):** vendor contracts, purchase workflows and
asset value land in their own modules; IT already publishes the events (§8.1) and holds the ids
they will need.
**9.4 Automation (live):** §8.1 is the contract.

## 10. Audit

Every mutation goes through the platform audit service with the standard actor/entity envelope.
The closed `AUDIT_ACTIONS` vocabulary gains six named actions (the Fleet FL-4 precedent —
distinct audited acts, not generic updates, because disputes are settled by filtering on them):
`assign` · `return` · `transfer` · `dispose` · `resolve` · `slaBreached` (system actor, the
contract-generation precedent). Existing actions cover the rest (`create`, `update`,
`statusChange`, `export`, `reopen`, `archive`).

Moves between branches are a `transfer` (§17, 2026-11-11). Of the asset custody actions, only the
transfer and the move write their audit rows after the commit: the audit service is not part of
the transaction, so a row written inside it would outlive a transfer the database then refused (a
later asset of the same move, say), and a retried transaction would write it twice. Hand-over,
return and dispose still write theirs inside their transaction (FR-3, §4.3). Custody's transfer
writes, after its commit, a new holder's receipt row (`create`) and then its `transfer` row.
«نقل إلى فرع» writes one row per asset, in the order the request named them: `branchId` old→new,
and `location` old→null when it had one — for a held asset, custody's own transfer row (the holder
unchanged, so no receipt row). A consumables transfer, after its commit like every stock
movement's, writes per line a `transfer` row on the item it left, a `create` row for an item the
transfer made, and a `transfer` row on the item it reached (the counters before→after, the
`transferId`, and the other store's branch and item) — each `transfer` row then refreshing its
own store's screens, so BOTH stores read again.

The bulk upload (§2.2, §17 2026-11-16) writes, after its commit and with the caller as the actor,
through the go-live's own write path: a `create` row per new asset (its code, serial number and
status), an `update` row per filled device (each field filled, old→new), and a `transfer` row per
moved device (`branchId` old→new, and `location` old→null when it had one) — every row naming the
upload as its `source`, as the go-live's rows name their run. The realtime refresh of the register
follows the audit rows; `it.asset.registered`, `.updated` and `.transferred` (no employee) follow
them. A preview writes nothing, audit included.

## 11. Dashboards & reports (derived queries — no new collections)

**Asset dashboard:** counts by status/category/branch · assets held by exited employees (§9.1) ·
warranty expiring 30/60/90 · recently registered/disposed. *Built as the `/it` home (§17,
2026-11-03): the counts by status under a category (several) and a branch filter, by category and
by branch, «يحتاج متابعة» (held by leavers, receipts awaiting signature, overdue returns, warranty
ending within `it.warrantyWarnDays`), the latest movements, the lines' networks and the consumables
at their minimum.*
**Ticket dashboard:** open by priority/technician/category · SLA at-risk (§4.5) and breached ·
aging buckets · resolved-this-week.
**Maintenance dashboard:** plans due within horizon · overdue orders · parts below min · cost
this month (sum of order costs — a report figure, not accounting).
**Warranty & license report:** filterable warranty list (window, vendor, category, branch) plus
license compliance (over-seats, expiring) — the §8.1 sweeps' queryable twin, so FR-10's
warn-only stance has a screen someone actually watches.
**Asset export:** CSV via the audited row-capped export path (the applicant-export
precedent; `itAsset.export`).
**Vehicle devices dashboard (FR-21, built 2026-11-10):** the owner's «الـ Dashboard … هتبقي عند الـ
IT» — the latest status of each car's devices, the faults per device, the cars not checked for seven
days, the reports with their photos, derived on read from `it_vehicle_checks` and Fleet's active
cars ([design §11](it-vehicle-checks-design.md)).

## 12. APIs (all under `/api/v1/it/…`, standard list/get/create/patch + named actions)

| Prefix | Named actions beyond CRUD |
|---|---|
| `/it/assets` | list filter `warrantyEndsWithinDays` (the dashboard's warranty row) · `GET /by-code/:code` (scan) · `GET /names` (the register's distinct names, for the name filter; `categoryId`, one or more, narrows them) · the list's `categoryId` and `name` take several values each (`name` a name list, each matched exactly) · `POST /:id/assign` · `/:id/return` · `/:id/transfer` · `/:id/dispose` · `POST /move-branch` (`MoveItAssetsToBranchSchema`: up to 100 assets to one branch, all or none, a held one with its custody; 200 → `ItAssetsBranchMoveResultDto`; 403 target out of reach · 400 no such active branch · 404 an asset out of scope · 422/409 every asset that holds it back, named — §2.2) · `GET /move-targets` (under `itAsset.assign`; → `ItMoveTargetsDto { branchIds }`: every active branch for which `keyReachesBranch(ctx, 'itAsset.assign', id)` holds — the test the move applies — in the branch options' order; what the move's picker offers, §2.2 — the consumables' transfer asked it too until §17 2026-11-17 and now has its own, `GET /it/consumables/transfer-targets`; registered before `/:id`) · `GET /import/branches` (under `itAsset.create`; → `ItMoveTargetsDto { branchIds }`, the move-targets' contract: every active branch `itAsset.create` reaches, by the same function asked of that grant (`moveTargetBranchIds(ctx, permissionKey, branches)`, the move passing `itAsset.assign`) — where the bulk upload may register, so its branch picker offers nothing the upload answers 403; in the branch options' order; registered before `/:id`, §2.2) · `POST /import` («رفع جماعي», under `itAsset.create`; registered before `/:id`; multipart, held in memory: `file` — one `.xlsx`, ≤ `IT_ASSET_IMPORT_MAX_MB` (5 MB), ≤ `IT_ASSET_IMPORT_MAX_ROWS` (500) lines, its workbook never inflated whole (one sheet, each part under its inflated cap — a sheet past it refused before any of it is read — then parsed as it streams, handed to the reader in 64 KB slices cut on character boundaries (the parser decodes each piece on its own: a cut inside an Arabic letter read as «�»), and stopped one line past the 500th — §2.2) — and the text fields of `ItAssetImportFieldsSchema`: `branchId?` (omitted on a first preview: the sheet's name suggests it), `kindCategories?` (JSON `{ "<النوع>": "<categoryId>" }`), `apply`, and with it `fileSha256`, `planHash` and `rows` (JSON, the sheet rows kept); without `apply` 200 → `ItAssetImportPreviewDto` (`fileSha256`, `planHash`, `sheetName`, `branchId`, `suggestedBranchId`, `kinds`, `rows` of `ItAssetImportRowDto` — decision, warnings, the device, fills, kept values, `selectable`/`selected` — and `counts` per decision), nothing written; with it 201 → `ItAssetImportResultDto` (created / filled / moved / unchanged, and each asset written: row, id, code, action); 400 a malformed field · 403 a branch inactive or out of `itAsset.create`'s reach · 409 the file or the plan is not the preview's («preview again») · 422 not an `.xlsx`, over the caps (the file past 5 MB — multer's `TOO_LARGE`; more than 500 lines; more than 500 zip entries or a ZIP64 marker, a part past its inflated cap, or the read past its 20 seconds — `SHEET_TOO_LARGE`, its `message` the part, `entries` or `time`, the sentence «the workbook is larger than one branch's sheet — upload the custody sheet on its own (at most 500 lines)»), a header missing or out of place, no branch chosen or suggested, a category that is not an active asset category, a row not in the file or not selectable — §2.2; nothing is written on any refusal) · `GET /:id/history` · `GET /:id/assignments` · `POST /labels` (PDF) · `GET /export` — every asset answer names its current `holder` and says `hasActiveMaintenance` (an order open or in progress, read for the whole page in one query — §2.2) |
| `/it/assignments` | the custody register: `open`, `branchId`, `employeeId`, and a filter per column — `search` (the asset's code, name or serial), `categoryId` (one or more), `assetName` (one or more asset names, exactly), `holderExited` (the holder HR shows as having left — the dashboard's FR-13 row), `assignedFrom/To`, `overdue`, `returnedFrom/To`, `receipt` (signed / unsigned / none) |
| `/it/catalog-items` | archive (kinds: assetCategory, ticketCategory, consumableType) |
| `/it/tickets` | `POST /:id/assign` · `/:id/status` · `/:id/resolve` · `/:id/close` · `/:id/reopen` · `/:id/cancel` · `GET+POST /:id/comments` · attachments via platform files |
| `/it/ticket-priorities` | carry the SLA targets (§2.6) |
| `/it/maintenance-plans` | activate/deactivate |
| `/it/maintenance-orders` | `POST /:id/start` · `/:id/complete` · `/:id/cancel` |
| `/it/spare-parts` | `POST /:id/receipts` · `GET /:id/movements` |
| `/it/software-products`, `/it/software-installations` | remove (stamps `removedAt`) |
| `/it/licenses` | — |
| `/it/vendors` | — |
| `/it/people` | read-only: `GET /` (search, `status` all/employed/exited, branch) · `GET /:employeeId` — HR's people through the directory (§9.1), under any of the three registers' read grants (§7) |
| `/it/technicians` | read-only: `GET /` — the IT departments' people (FR-17) |
| `/it/custody-receipts` | `POST /preview` (the paper and its new number; nothing else written) · `POST /` (the hand-over: intervals + receipt) · `GET /:id` · `POST /:id/print` (print again, under its number) · `GET+POST+DELETE /:id/signed-copy` — FR-18; plus `POST /it/assignments/:id/receipt` for an interval from before receipts |
| `/it/mobile-lines` | `GET /summary` (each network's figures under the filters) · `POST /:id/assign` (employee or car) · `/:id/return` · `/:id/suspend` · `/:id/reactivate` · `GET /:id/history` — FR-19 |
| `/it/mobile-line-assignments` | read-only: `GET /` (open, line, employee, branch) — FR-19 |
| `/it/mobile-line-receipts` | `POST /preview` · `GET /:id` · `POST /:id/print` · `GET+POST+DELETE /:id/signed-copy` — FR-19 |
| `/it/consumables` | `POST /issue` (one employee, n items of one store, one memo) · `POST /transfer` (`TransferItConsumablesSchema`: up to 50 items of one store, each with a quantity, to another branch's store; one `transferId`; 201 → `ItConsumableTransferResultDto`; 403 target out of reach · 404 an item out of scope · 422 two stores, the same store, more than on hand, another unit or a retired item there · 400 no such active branch — §2.11) · `GET /transfer-targets` (→ `ItMoveTargetsDto`: the transfer picker's branches — the active branches `itConsumable.assign` reaches whole, by the transfer's own test; before `/:id` — §17 2026-11-17) · `GET /:id/movements` · `POST /:id/receive` · `/:id/scrap` · `/:id/return` — FR-20; list filters `search`, `typeId`, `branchId`, `belowMin`, `active` |
| `/it/consumable-movements` | `GET /` (kind — `transferredOut` and `transferredIn` among them — item, type, employee, asset, branch, from/to, search; each row carries its `version`) · `PATCH /:id/installed-on` («تعديل الجهاز», under `itConsumable.assign`; `SetItConsumableInstalledOnSchema { assetId: objectId \| null, version }`; 200 → the `ItConsumableMovementDto` as it now stands, the same device included with nothing written; 404 a movement out of `itConsumable.view`'s scope or deleted, or a device out of the caller's own `itAsset.view` — any device without it · 422 not an `issued` movement, or a disposed device · 409 a stale version; the memo line follows it — §2.11, §17 2026-11-17) — FR-20 |
| `/it/consumable-memos` | `GET /:id` · `POST /:id/print` · `GET+POST+DELETE /:id/signed-copy` — FR-20 |
| `/it/vehicle-checks` | `GET /vehicles` (the active cars `{ id, code }` in Fleet's code order, paginated; the form walks the pages — the owner's «تظهر كلها», an ADR-019 deviation the design records) · `POST /` (file; a known `clientRequestId` returns the existing report) · `POST /:id/photos` (one photo, the reporter only, within 24 hours, ≤ 5) — under `itVehicleCheck.create` · `GET /dashboard` (the figures, the latest per car, the overdue cars) · `GET /` (the reports: window, branch, car, a code, faults, a device) · `GET /:id` · `GET /:id/photos/:fileId` (the bytes) — under `itVehicleCheck.view`, scoped · `DELETE /:id` (soft) — under `itVehicleCheck.delete` — FR-21 |
| `/it/dashboard` | `GET /assets` (status counts: totals, by category, by branch, and «يحتاج متابعة»; `categoryId` one or more, `branchId`) · `GET /activity` (the latest movements, same filters) — built; `/tickets` · `/maintenance` · `GET /reports/warranty` still planned |

Every list obeys API Standards §4 (pagination, `search` where a picker will need it — assets,
vendors, products, parts ship with `search` from day one, per ADR-019 rule 5).

## 13. Open questions — **decided at approval (2026-08-03): every default below is adopted as-is**

| # | Question | Decision (was: default) |
|---|---|---|
| Q1 | Code formats — keep `AST-/TKT-/MO-` global? per-category prefixes? yearly ticket reset? | global, no reset (§2.1) |
| Q2 | Asset categories flat or tree? | flat (§2.4) |
| Q3 | SLA clock 24/7 or business hours? | 24/7, `onHold` pauses resolution (§2.6) |
| Q4 | Who opens tickets — **every employee** (help desk as a service) or IT staff only? | every authenticated employee; `own` scope shows them their tickets (§7, FR-8) |
| Q5 | License keys: plain text under `itLicense.view`, or masked + reveal-with-audit? And should seat overrun **block** instead of warn? | plain under the permission; warn only (FR-10) |
| Q6 | Vendors: confirmed IT-owned until Procurement exists? | yes (§2.9) |
| Q7 | Reopen window after `closed` (reopen vs new-ticket-with-link)? | reopen allowed 7 days after close, then new ticket |
| Q8 | Disposal: is a second approval (chain) required, or is the `itAsset.dispose` grant enough for MVP? | grant is enough; approval chains arrive with the platform approval engine |
| Q9 | Ticket attachments visible to requester always, or can technicians attach internal files? | attachments follow their comment's visibility; direct ticket attachments are public |

## 14. Required ADRs (written during implementation, after this design is approved)

| ADR | Records |
|---|---|
| **ADR-021 — IT asset custody & history** | append-only event chain as the business record; derived status; no hard delete (FR-2/FR-4/FR-5); why audit logs are not the custody chain (D3) |
| **ADR-022 — Help-desk SLA & ticket lifecycle placement** | SLA targets as priority data + snapshot-on-create; set-once breach stamps; sweep cadence; **and the recorded decision that ticket states are code-defined in the module, not the (unbuilt) ADR-011 platform engine** — with the migration note for the day the platform engine exists · **STILL UNWRITTEN — see the note below** |
| **ADR-024 — Minimal spare-parts ledger** | movements ledger + denormalized on-hand; explicitly *not* inventory accounting; the boundary Procurement and Warehouses will inherit · [written](../03-decisions/ADR-024-minimal-spare-parts-ledger.md) with IT-4 |
| **ADR-025 — Sweep announcement marks** | why the expiry sweep's idempotency lives in `it_sweep_marks` and not on the business document; the date-keyed mark that re-arms on renewal · [written](../03-decisions/ADR-025-sweep-announcement-marks.md) with IT-5. **Not foreseen by this table** — §4.8 assumed doc-level marks, and the Fleet precedent it cites turned out to be a marks collection |

> **ADR-022 is a deliberate debt, not an omission.** IT-3 shipped and merged (PR #153) without it:
> the decision it records — ticket states are code-defined in the module rather than in the unbuilt
> ADR-011 engine — was taken and implemented, but the owner has not yet approved a text for it.
> It is left listed here, unwritten and visible, rather than dropped or back-filled with a
> reconstructed decision. Whoever writes it should read `ticket-lifecycle.ts` and the IT-3 PR
> discussion, not invent a rationale.

> **Renumbered twice — numbering only, no decision content changed either time.**
>
> 1. **2026-08-09 (IT-2).** This table reserved 020/021/022 when the design froze on 2026-08-03.
>    **ADR-020** was taken by
>    [Shared file storage](../03-decisions/ADR-020-shared-file-storage.md) (Accepted 2026-08-05),
>    so the three IT ADRs shifted to **021/022/023**.
> 2. **2026-08-09 (IT-4).** **ADR-023** was then taken by
>    [entity-derived file authorization](../03-decisions/ADR-023-entity-derived-file-authorization.md)
>    (Accepted 2026-08-09) — a platform decision that had to land before IT-3's ticket attachments
>    were safe. The spare-parts ledger therefore moves to **ADR-024**, matching §15.
>
> ADR numbers follow the order decisions are TAKEN, never the order slices ship. Nothing already
> delivered depends on an old number.

## 15. Delivery slices (post-approval; each slice = contracts + api + tests, PR-reviewed; web follows)

| Slice | Content |
|---|---|
| IT-1 | contracts (DTOs/schemas/permissions/events) · module skeleton + manifest + nav category · catalog items (asset + ticket categories) · vendors · asset register + sequences + QR/labels |
| IT-2 | custody: assign/return/transfer/dispose · asset events/history · HR exit subscription · ADR-021 |
| IT-3 | help desk: priorities (with SLA targets), tickets, event/conversation stream, attachments, SLA + auto-close sweeps · ADR-022 |
| IT-4 | maintenance: plans, orders, spare parts + movements, preventive sweep · ADR-024 |
| IT-5 | software products, installations, licenses, expiry sweep · ADR-025 |
| IT-6 | dashboards, warranty report, asset export, notification templates, seed data |
| ITW-1…6 | web app per area (skeleton/nav → assets → tickets → maintenance → software → dashboards), ar/en + RTL, ADR-019-compliant pickers |

> **ADR numbering.** IT-4's ADR moved from 023 to **024**: the platform slice
> [ADR-023 — entity-derived file authorization](../03-decisions/ADR-023-entity-derived-file-authorization.md)
> landed first, and numbers follow the order decisions are taken, never the order slices ship.
> IT-3 keeps ADR-022; later IT ADRs continue from 025. Numbering only — no slice content changes.
>
> That platform slice is also what makes IT-3's `attachments` deliverable above real: ticket and
> comment attachments are only safe once file authorization derives from the owning entity, so
> IT-3 is not complete until it registers its two authorizers.

## 16. Deferred architectural debt — the post-IT roadmap

The pre-freeze review named four platform-level gaps this module deliberately works around
rather than fixes. None changes the MVP. They are recorded here so that "later" has a kind, a
compatibility answer, a price and a trigger — not just a mention in a conversation. Cost unit:
**one slice = one reviewed PR of IT-1…IT-6 size**.

| P | Debt | Kind | Extraction compatibility | Cost after IT | Trigger |
|---|---|---|---|---|---|
| 1 | **Workflow/Approval engine (ADR-011)** | Platform Debt — the ADR is accepted (2026-07-08) and the service was never built; recruitment, fleet and now IT each re-implement lifecycles, and approval chains exist only inside Leave | **Non-breaking**: ships for *new* processes; existing code lifecycles keep running untouched; a module that later adopts it migrates internally with its API unchanged (ticket instances can be backfilled from `it_ticket_events` `statusChanged` rows — the event stream pays for itself here) | 5–7 slices (definitions + instances + versioning + guards + approval chains + admin UI + first consumer); +1–2 per module that adopts later | **Before the OPS design freezes.** OPS is the module ADR-011 was written for (cash-order lifecycle, vault operations, money-movement approvals) — designing OPS without it repeats this debt a fourth time at the highest-stakes domain |
| 2 | **Timeline kit (platform)** | Platform Debt in the small — after IT the same append-only idiom exists 4× (recruitment, employee, asset, ticket; IT already ships its two on ONE internal implementation) | **Non-breaking**: collections stay module-owned and module-named (manifest rule untouched); only the model factory + service shape move to platform; no data migration, no API change | 1 slice (kit + IT adoption); recruitment/employee adopt opportunistically at ~½ slice each | Immediately after IT — extract while the second consumer is fresh; the kit also encodes the PR #117 rules (`minimize: false`, `metadata: {}` by type) exactly once |
| 3 | **Expiry-watcher seam** | Platform Debt — the sweep + warn-window + set-once-mark pattern exists 4× (fleet vehicle/driver licenses, job-offer expiration, IT warranty, IT licenses) | **Non-breaking**: registration-based — each module keeps its event names, settings keys and collections; the seam owns only the loop and the window/mark semantics | 1–2 slices (seam + IT + fleet adoption; offers opportunistic) | Opportunistic — the next new "expiring thing" or the first warn-window bug; not before IT-5 exists |
| 4 | **External-party registry** (vendors/workshops) | Platform Debt (shared reference data) — duplicated 2× (fleet workshop catalog rows, `it_vendors`) | The only one needing a **data migration**: merge rows into a platform registry, re-point `workshopId`/`vendorId`, alias module endpoints through a deprecation window — externally non-breaking **if staged**, but the most invasive of the four | 2–3 slices | **Procurement module design** — Procurement owns the concept; extracting earlier buys nothing and guesses at its shape |

Priority is trigger order, not calendar order: P1 is gated on OPS timing, and if OPS slips, P2
and P3 proceed anyway — they are cheap and non-breaking, and the engine is never blocked by
them. P4 waits for its owner. Nothing in this table is scheduled by this document; each item
starts only on an explicit owner GO.

## 17. Review trail

- **v1.0 DRAFT** (2026-08-03) — full architecture & domain design for review. Awaiting owner
  decisions on §13 and overall approval. No implementation exists or begins before approval.
- **v1.1 DRAFT** (2026-08-03) — owner-requested pre-freeze simplification review. Five merges,
  each toward an existing precedent: priorities absorb the SLA policies (a 1:1 split had no
  purpose); ticket comments become `commented` events in the single ticket stream (the
  recruitment `note` precedent); asset + ticket categories collapse into kind-discriminated
  `it_catalog_items` under one `itCatalog.manage` (the Fleet catalog precedent); orders stop
  storing `partsUsed` (the movement ledger is the single source); `itAsset.print` dropped (a
  label shows nothing `view` cannot) and `it.ticket.resolved/.closed/.reopened` folded into
  `statusChanged` + automation filters. Net: 19 → 16 collections, 29 → 27 grants, 21 → 18
  events; one internal timeline implementation shared by assets and tickets; FR-14 added
  (requester ownership rules need no grants). Structure otherwise unchanged; still awaiting §13
  decisions and approval.
- **v1.2 DRAFT** (2026-08-03) — §16 added on owner request: the four deferred platform debts
  (workflow/approval engine, timeline kit, expiry-watcher seam, external-party registry) as a
  prioritized roadmap with kind, extraction-compatibility answer, slice-cost and trigger for
  each. No scope or structure change. This is the final pre-approval revision.
- **v1.2 FROZEN** (2026-08-03) — owner approval. §13's nine defaults adopted as decisions,
  unchanged. Implementation begins with IT-1 and only IT-1; design changes from here require a
  Design Review or new ADR before any code, recorded as a new revision here.
- **IT-4 naming correction** (2026-08-09) — §8.1 named the maintenance events
  `it.maintenance.orderCreated` / `.orderCompleted`. They ship as
  **`it.maintenanceOrder.created`** and **`it.maintenanceOrder.completed`**, with the entity
  `maintenanceOrder`. Two reasons, both about the shared event vocabulary rather than about IT:
  the catalog's entity/action split expects `<entity>.<pastTense>`, so `maintenance.orderCreated`
  would have registered `orderCreated` as an ACTION word used by nothing else; and the entity key
  `maintenance` already belongs to Fleet's maintenance visit, which is a different thing wearing
  the same word. `it.sparePart.belowMin` is unchanged. Payloads, firing conditions and the
  automation-trigger surface are exactly as §8.1 specifies — only the two names differ, and
  nothing consumed them before IT-4.
- **IT-5 naming correction** (2026-08-09) — §8.1 named the warranty pair
  `it.asset.warrantyExpiring` / `.warrantyExpired`. They ship as
  **`it.assetWarranty.expiring`** and **`it.assetWarranty.expired`**, with the entity
  `assetWarranty`. Same rule as IT-4's correction, and the same two reasons: the catalog's
  entity/action split expects `<entity>.<pastTense>`, so `warrantyExpiring` would have registered
  a new ACTION word that nothing else uses; and giving the warranty its own entity lets both
  events reuse `expiring` / `expired`, which Fleet's licence events already put in the shared
  vocabulary. `it.license.expiring` / `.expired` / `.seatsExceeded` are exactly as §8.1 names them
  — the bare `license` entity was free, since Fleet's two are `vehicleLicense` and `driverLicense`.
  Payloads and firing conditions are unchanged, and nothing consumed these names before IT-5.
- **IT-5 corrections to delivered slices** (2026-08-09) — three findings from the IT-5 design
  review, fixed as a prerequisite rather than carried:
  1. **IT-4's list endpoints were not branch-scoped.** Writes were scoped through the asset;
     reads were not, so any technician could list any branch's board. Orders and plans now
     denormalize the asset's `branchId` exactly as `it_asset_assignments` does, and every read
     carries the caller's scope. The spare-parts store stays company-wide — §7 gives it no branch
     anchor.
  2. **FR-5's delete guard asked the wrong question.** `status === 'inStock'` is answered "yes" by
     an asset that has been assigned and returned, so it could be deleted with a full custody
     chain. The guard now asks for history, custody intervals and maintenance orders, as one list
     every future consumer extends.
  3. **IT-4's parts picker loaded the catalogue.** Converted to a searching picker (ADR-019 rule
     5), matching the one IT-5 ships for products.
  Also recorded: `registered`, `updated` and `warrantyUpdated` are declared in
  `IT_ASSET_EVENT_TYPES` and written by nothing (§4.1 says they should be). Left as a deliberate
  debt — IT-5 does not widen its scope to fix an IT-1/IT-2 gap.
- **IT's employees** (2026-09-27) — owner requests: «لما يعمل بحث او يضيف حاجه او اى حاجه يختار
  اسم الموظف يظهرله اسم الموظف من الاتش ار كل المواظفين سواء اللى مشى او اللى موجود لكن فى حاله
  الاضافه اللى موجود بس», then «اعمل شاشه فيها كل المواظفيين اللى مشيوا واللى موجودين واللى ادوس
  عليه يجيب الهيستورى بتاعه كله ونفس الموضوع فى الفلاتر فى كل الشاشات ... الفنى يكون من مموظفيين
  الit بس», and yes to IT staff seeing names without HR's permission. Delivered:
  1. **`/it/people` and `/it/technicians`** — HR's facts through the platform directory's new
     register seam, under IT's own grants (§9.1). Read-only; no collection.
  2. **The employees register** (`/it/employees`) — everybody, current and departed, with what
     each holds now; a row opens the person's history: custody now and before, tickets opened
     and tickets worked (through their login).
  3. **Person filters on every screen that lists by a person** — custody (holder), assets
     (holder, new `holderEmployeeId`) and the help desk (requester, new `requesterUserId`;
     technician) — all finding leavers (FR-16).
  4. **Hand-overs to current employees only**, enforced server-side (FR-15), and a technician from
     the IT departments only (FR-17, `it.technicianDepartmentIds`).
  Only a positive answer refuses — an id the directory cannot read is accepted as before, so a
  deployment without HR, and one whose IT departments are not chosen yet, is unchanged. No new
  permission and no schema change; one setting and two list filters are added.
- **Custody receipts** (2026-10-04) — owner request, with the paper form attached: «وأنا بسلم
  الموظف جهاز او أصل يكون فى طباعة إيصال الأول وبعد الطباعة يسلم الجهاز على السيستم .. ويكون فى
  إمكانية رفع صورة الإيصال مره أخري بعد توقيع الموظف (وإمكانية طباعة الإيصال بردو بعد التسليم)».
  Delivered as FR-18: the hand-over dialog takes one or more in-stock assets with each one's
  condition and notes (the form's «الحالة» and «ملاحظات»), prints the receipt first and only then
  records the hand-over; the receipt is reprinted, and its signed copy uploaded, from the asset,
  the custody register and the employee's history. New collection `it_custody_receipts`, new
  `receiptId` on intervals; the single-asset `POST /it/assets/:id/assign` now writes a one-line
  receipt too, so no interval reaches a person without one. No new permission: writing rides
  `itAsset.assign`, reading `itAsset.view`. The receipt paper is composed in the browser (the
  Fleet report idiom), so printing needs no PDF driver.
- **The asset register restarted** (2026-10-04) — owner request, confirmed explicitly: «شيل كل
  الأصول معادا AST-00005 وخليه AST-00001». A one-time boot step (`go-live/asset-restart.ts`, key
  `go-live:it-asset-restart:v1`, recorded in the new `it_go_live_runs`) deletes every other asset
  SOFTLY — off every screen, still in the database — together with what only existed for them
  (custody intervals, maintenance plans and orders, software installations); tickets and history
  are left alone. AST-00005 becomes AST-00001 (an `updated` history entry says so) and the counter
  is set so the next asset is AST-00002. This is the one sanctioned exception to FR-1's «never
  reused»: the deleted rows' codes are freed as `retired:<code>:<id>`, which keeps each original
  code readable and can never be allocated or scanned. All of it is one transaction with its run
  row, and it is decided once: when AST-00005 is not on the register at the first boot, nothing is
  deleted and the refusal is recorded, so a later AST-00005 can never trigger it.
- **The receipt paper, revised** (2026-10-05) — owner requests: the footer's «EGYCASH-IT -F-14-02 ·
  Issue date: 1/5/2022» becomes the paper's own number — «EGYCASH-IT-F-14-0001», «ابدأ بـ 0001 وكل
  طباعة زود رقم» — and «تاريخ اليوم»; the signature block («المستلم», «التوقيع», «الاسم»,
  «الوظيفة») moves to the left («شمال مش فى النص»); and the print tab shows an A4 sheet instead of
  stretching across the window («تبقى A4 مش الصفحة كلها»), with a toolbar to print again or close.
  Found on the way: the tab inherits the app's Content-Security-Policy (`script-src 'self'`,
  `script-src-attr 'none'`), so the inline script that was to open the print dialog never ran; the
  page now carries no script of its own and is driven from the app's script (`wireReceiptWindow`).
  The same inline-script idiom was used by other modules' printed pages, with the same defect;
  the follow-up (2026-10-05, «صلح الطباعة في الأسطول والذهب كمان») moved fleet's reports, notices
  and licence records, gold's documents and IT's label sheet onto one door,
  `apps/web/src/shared/lib/print-window.ts`, whose spec holds the whole web app to «no printed page
  carries a script of its own». The label sheet had a second defect: its tab was opened with
  `noopener`, for which `window.open` returns null by definition, so the HTML sheet never printed.
- **The custody acknowledgment** (2026-10-05) — owner request, with the department's form attached:
  «ومعلش هنغير التصميم بتاع الطباعة فى الـ IT فقط لدا». The item-table receipt is replaced by the
  IT department's «إقرار استلام», reproduced from the PDF the owner sent (its letterhead strip,
  banner colours, table shading, fonts and footer block taken from the file itself): ONE PAGE PER
  DEVICE under the receipt's one number — «أقر أنا / … بوظيفة … بأنني قد استلمت جهاز … برقم مسلسل …
  ومواصفاته كالتالي:», the specifications table (Component / Details in the form's groups System ·
  Storage · Graphics · Network), «ومشتملاته كالتالي:», the undertaking, «وهذا إقرار مني بذلك» and
  «المقر بما فيه» with the name, signature and date on the left. The form's red marks what is filled
  in, and stays red. What the paper needed and the system did not have is now recorded: an asset's
  `specs` (one field per row of the form's table, several network adapters allowed) and
  `accessories`, edited on the asset form and shown on the asset page; the hand-over dialog shows
  each device's accessories and lets them be changed for this paper. The device's kind is its
  category's Arabic name, so categories read best in the singular («لاب توب», «شاشة»). The national
  ID, its issuing office and date stay dotted lines: HR's directory seam does not carry the
  national ID, by design. Each receipt line snapshots all of it, so a reprint is the paper that was
  signed. Spelling slips in the form were corrected (قومي، إنهاء، إقرار، مني); its wording was not
  changed. The formal-Arabic guard listed «ماله» as dialect; it is also «his property», the
  undertaking's own word, so it left the list («مالوش» and «ملوش» stay). Other modules' printing
  is unchanged.
- **The acknowledgment's identity line, filled** (2026-10-05) — owner request, on a printed paper:
  «بطاقة رقم قومي … صادرة من قسم … – … بتاريخ … مفروض تملأها تلقائي من النظام !! قسم الموظف
  وإدارته وتاريخ اليوم ورقمه القومي», and «اسمه جاى على سطرين !! فمش لازم رباعي ممكن ثلاثي فقط تحت
  عند الإمضاء». The line now reads the employee's national ID, section («قسم») and department
  («إدارة») from HR, and the paper's date (the hand-over's — today, for the print before it); the
  receipt keeps all of it, like the name. The national ID is the platform's first unmasked egress
  of one, so it follows Security Architecture §3: a new grant, `itAsset.viewNationalId`, decides
  who sees it — the super administrator holds it by the catalogue sync, anyone else is granted it
  on the roles screen; a reader without it prints the line for the pen and is told why. HR hands it
  over through a directory lookup of its own (`getDirectoryIdentityFacts`), never as a field of
  `DirectoryEmployee`, which every module reads. Under the signature the name is the first three
  PARTS on one line, by the contracts' name rule — which now also binds the compounds that end in
  their second word («نور الدين», «فتح الله»), so a three-part name never halves one; the
  quadruple-name advice in HR counts them the same way.
- **The statement's wording** (2026-10-05) — owner request, on a printed paper: «شيل كلمة من
  لتكنولوجيا "بشركة إيجي كاش لتكنولوجيا الحلول النقدية" وخليها للحلول النقدية على طول», and «بدل ما
  يظهر بأنني قد استلمت جهاز كمبيوتر All لأ خليه يظهر الـ Manufacturer / Model بداله». The company
  reads «بشركة إيجي كاش للحلول النقدية»; the device is named by its make and model, as the
  table's «Manufacturer / Model» row prints them, and by its category only when neither is on file
  (a receipt line already carried both, so stored receipts print the same way). A make and model is
  one name and is kept on one line, so the statement is set from the right edge rather than
  justified — justifying a line that carries a long unbreakable name stretches its gaps.
- **A new asset starts from the last one of its category** (2026-10-05) — owner request: «ماذا لو
  عندي 20 جهاز بنفس المواصفات .. هفضل أكتب نفس المواصفات !؟ أكيد لأ .. لما أختار الفئة يحمل
  البيانات كلها من السابق ماعدا السيريال والـ Tag والحاجات المتغيره فقط». In the create form,
  picking a category reads the most recently registered asset of that category (the register's
  own list, scoped as always) and fills every box still empty: name, description, make, model,
  branch, purchase, warranty, specifications and accessories. What makes one unit itself — the
  serial number, the printed tag, the location and the notes — is never copied, nothing the user
  already typed is replaced, and picking another category swaps the first template's values for
  the second's. A note names the asset the form was filled from. No API change; the rule lives in
  `apps/web/src/modules/it/lib/asset-form.ts`.
- **«صادرة من قسم … – … بتاريخ …» taken off the acknowledgment** (2026-10-05) — owner request: «شيل
  الجزء دا من الإيصال – صادرة من قسم التسويات والمراجعة – الصراف الالى بتاريخ ٥ / ١٠ / ٢٠٢٦». The
  statement now runs «… بطاقة رقم قومي … بأنني قد استلمت جهاز …»; the paper's date stays in the
  signature block. The section and department are still read and kept on the receipt — the record
  of where the holder worked when they signed — but no longer printed.
- **The employee's code on the acknowledgment** (2026-10-06) — owner request: «عايز بردو أضيف كود
  الموظف هنا . بشركة إيجي كاش للحلول النقدية، كود ......... .». The statement now runs «… بشركة
  إيجي كاش للحلول النقدية، كود …، بطاقة رقم قومي … بأنني قد استلمت جهاز …», the code in the
  form's red and its digits, like the national ID after it, and a dotted line for the pen when the
  directory cannot name the employee. The receipt already kept `employeeCode`; no API change.
- **The IT inventory imported** (2026-10-07) — owner request: «عندي فايل Excel فيه 10 شيتات … الأسماء
  فى الفرع الرئيسي المهندسين ثنائية ! فهحتاج منك بمعلومية الفرع والإدارة والاسم الثنائي تظبط أنت
  الأسماء … وتسلمه الأجهزة اللى معاه (لو فى أسم) .. ولو مكتوب مخزن يبقي مش متسلم … الأفرع كل
  الأجهزة والأصول اللى فيها خليها مش متسلمه». The workbook (`Inventory_Sys_26.xlsx`: the head
  office's PCs and screens, laptops, IP phones and printers, and six branch sheets — 454 devices)
  was reviewed with the owner before anything was written: each head-office two-part name was
  matched against HR by branch and department, and only the matches with one employee were
  handed over (170 devices, 57 employees); the 14 devices whose match needed the owner's word and
  the 31 whose holder HR does not have, has as a leaver, or has twice stay in stock with «في الجرد
  مع: …». «وصال» is the Shorouk branch (owner, 2026-10-07). The reviewed result is
  `apps/api/assets/it-go-live/inventory-2026-10.json` — employee codes only, nothing else from HR —
  and a one-time boot step (`go-live/inventory.ts`, key `go-live:it-inventory-2026-10:v1`, after
  the asset restart) registers every device in ONE transaction: branches matched by spelling and
  never created (a missing one refuses the run, and the next boot retries); the IT team's own asset
  category taken where one exists, else «كمبيوتر مكتبي», «شاشة», «لاب توب», «هاتف IP», «طابعة»
  created (the head office's two Lenovo all-in-ones go under «كمبيوتر All» when that exists); a
  serial the register already holds left alone and reported; the codes taken as a block inside the
  transaction. The settled devices are handed over on ONE receipt per employee (the next form
  numbers), so IT prints each employee's acknowledgment and files the signed copy as for any
  hand-over; a holder HR shows as having left gets nothing. The run row says what was written.
- **The custody register as Excel and PDF** (2026-10-18) — owner request: «في الشاشة دى /it/custody
  عايز يبقي فى زرارين بجانب تسليم عهدة بيـ Extract أكسيل و PDF للجدول المعمول (وأعتمد الفلتر
  طبعاً)». Two buttons beside «تسليم عهدة», offered to everyone who can read the register (not only
  to whoever may hand over) and hidden when the list failed. Both hold EVERY interval the filters
  match — status, branch, holder — in the table's sort, not the page on screen: the screen's own
  params, unpaged, walked page by page (`lib/custody-register-export.ts` → Fleet's
  `fetchFilteredRows`). The columns are the table's, in its order, the asset and employee codes in
  columns of their own: الصنف، كود الصنف، تاريخ التسليم، المستلِم، كود الموظف، الفرع، موعد الإعادة،
  الحالة، تاريخ الاسترجاع، إيصال الاستلام (signed / awaiting signature). A filter in force is never
  dropped from the PDF's filter line: the holder is named by the rows' own name, then the chip's,
  then the id; a branch not among the options prints as «فرع محدد». The holder chip's label is now
  kept with the id it was picked for and resolved by id on a link, as on the asset list, so Back
  never leaves another person's name on it. Excel is the app's one `.xlsx`
  writer («عهدة الأصول-YYYY-MM-DD.xlsx»); the PDF is the company report form the Fleet lists print
  on — the letterhead with «قطاع تكنولوجيا المعلومات», a «م» column, the filters and the day under
  the title — A4 landscape for the ten columns and with no signature block (the form's
  `signatories` and `orientation` became optional; every Fleet report prints as before). The tab
  opens on the click and the rows are gathered after, as the receipt does, so the browser does not
  take it for an unrequested pop-up. No API change.
- **The asset list as Excel and PDF; the buttons before the form's action** (2026-10-18) — owner
  request: «اعمل نفس الزرارين في شاشة الأصول · كمان عايز الزرارين قبل مش بعد زرار الـ Action بتاع
  الفورم · كمان عايزك تشيل كلمة تصدير من الزراير». `/it/assets` gets the custody register's two
  buttons: every asset the filters match (search, status, category, branch, holder), in the table's
  sort and columns — الكود، الاسم، الفئة، الرقم التسلسلي، الفرع، الحالة — the workbook «الأصول-YYYY-MM-DD.xlsx»
  and the PDF on the same report form, A4 portrait (six columns fit), its filter line naming every
  filter in force («فئة محددة» / «فرع محدد» when the name is not among the options; the holder by
  the chip, else the id — the asset rows do not name their holder). On both screens the pair now
  comes BEFORE the screen's own action («تسليم عهدة», «تسجيل أصل») and reads just «Excel» and «PDF».
  One control (`components/RegisterExportButtons.tsx`) and one shared helper
  (`lib/register-export.ts`: the walk, the filter line, the report, the tab opened first) serve
  both screens. Offered to every reader of the list, as the custody export and the labels are;
  the §11 server CSV under `itAsset.export` is still unbuilt and is a separate thing.
- **The acknowledgment names the item by its category** (2026-10-19) — owner request: «فى طباعة
  الإيصال … بأنني قد استلمت جهاز · عايز كلمة جهاز تبقى متغيرة بتاء على نوع ما يتم تسليمه فلو شاشة
  يبقى شاشة ولو ماوس أو كيبورد يتكتبوا ولو جهاز يبقي جهاز وهكذا حسب (الفئة)». The statement's
  fixed «جهاز» is now the receipt line's `deviceType` — the asset's category, snapshotted when the
  receipt is written — in the form's ink and on one line, followed in red by the make and model, or
  the asset's own name when neither is on file (without the category's name a second time when the
  name starts with it, as whole words). A computer — a desktop or an all-in-one: the inventory's
  computer category names, or any category whose first word is «كمبيوتر» — keeps «جهاز» («ولو جهاز
  يبقي جهاز»; and «كمبيوتر All» is the name the owner had the statement stop printing on
  2026-10-05), as does a line with no kind on file. Every other category prints its own name, so
  the catalog decides the word. The rest of the form's wording («ومواصفاته»، «لاستخدامه» …) is
  unchanged. Web only; no API or data change.
- **Mobile lines** (2026-10-20) — owner request: «الـ 3 فايلات دول عبارة عن خطوط موبايل عايز أعملهم
  صفحة لإدارتهم وتسليمهم وبردو بفلتر لكل شبكة مع بيانات كل شبكة» and, with the networks' logos,
  «عايزك تستخدم الـ 3 لوجوهات فى الفلتر وفى الجدول جنب كل خط تابع لشركته». A register of its own
  (§2.10, FR-19) rather than an asset category: a line has a number, a network account, a plan
  and a SIM, and none of an asset's code, category or specifications. Four collections —
  `it_mobile_lines`, `it_mobile_line_assignments`, `it_mobile_line_events`,
  `it_mobile_line_receipts` — and three routers (§12). **No new permission and no new page**: the
  asset grants cover it (owner, the plan's answer «موافق على اقتراحاتك كلها»), so whoever holds
  «الأصول» manages lines. A hand-over to an employee is print-first on the department's own
  acknowledgment, one line per paper, its number from the F-14 series the device papers use; a
  tracker SIM goes to a CAR by its code and plate as text — a deliberate snapshot rather than a
  Fleet link, so §3 and §9.2 stand. `/it/mobile-lines` («خطوط المحمول», in the IT rail): the three
  network cards, each with its logo, its lines and states and its account numbers, ARE the
  network filter (none pressed = every network); search, status, branch, holder (leavers
  included) and holder kind; the table shows each line beside its network's logo; Excel and PDF
  hold every line the filters match (network names as text). An employee's IT page lists their
  lines next to their devices. The go-live file `apps/api/assets/it-go-live/mobile-lines-2026-10.json`
  is the owner's review of Vodafone.xlsx, Etisalat.xlsx and Orange.xls (392 lines: Vodafone 50,
  Etisalat 270 with the 18 trackers, Orange 72) — employee and car codes only, no national IDs or
  addresses, and — the repository being public — no person's name: a line nobody holds that the
  network has registered to somebody HR knows carries their code (`registeredToCode`), and the
  import writes their name from HR into the line's notes («مسجّل باسم موظف ترك العمل: … (كود)»,
  the owner's wording, or «مسجّل في الشبكة باسم: … (كود)»); the three people HR does not have
  are described, not named; the trackers' IMEIs are left out. A one-time boot step
  (`go-live/mobile-lines.ts`, key `go-live:it-mobile-lines-2026-10:v1`) registers them in ONE
  transaction: 301 lines handed to their 285 employees, one acknowledgment each (a block of
  F-14 numbers), 18 to their cars, 68 in stock and 5 suspended. A holder HR shows as having left
  gets nothing and the line says so; a number or SIM the register already holds is skipped and
  reported; a branch it cannot find refuses the run, and the next boot retries; a finished run
  is recognised before anything is read. The workforce reset keeps the lines' intervals
  (`keep`, not `purge` like the devices'): a tracker SIM's custody is a car's, and a line whose
  interval vanished could be neither returned nor handed over again; the papers, which carry the
  national ID, are still purged, and a line whose paper is gone simply offers none. The seven
  lines the review matched to an employee by name alone say the match is unconfirmed
  (`registeredToLikely`). A number is searched as stored: a pasted «+20 10 …» or a card serial in
  its printed groups is found. The audit rows of a line's
  hand-over, return and status change are written after the commit.
- **The asset register names who holds each asset; a name filter** (2026-10-28) — owner request:
  «وعايز فى شاشة الأصول /it/assets تزودلى بعد الحالة لو متسلم اسم الشخص اللى متسلمله الحاجة · وعايز
  فى الفلتر زود بعد الحالات وقبل الفئة (الاسم) ويكون Drop Down مع قابليه للكتابة». Every API answer
  carrying an asset now carries `holder` (the open interval's employee, read through the directory
  at response time, one batch per answer; null while nobody holds it), and the register shows it as
  «المستلِم» right after the status, linked to the employee's IT page. The name filter is a list one
  types into (`GET /it/assets/names` — the distinct names in the reader's scope) between the status
  and the category; it matches the name exactly. The Excel/PDF gain «المستلِم» and «كود الموظف» (A4
  landscape now that there are eight columns) and name the name filter on their filter line.
- **The custody register: the serial in its files, and a filter per column** (2026-10-28) — owner
  request: «وكمان فى شاشة عهد الأصول /it/custody عايزك تزود سيريال الأصول لما أعمل Extract وزود
  الفلتر بتاع الجدول ببيانات الجدول». The Excel/PDF gain «الرقم التسلسلي» after the asset code
  (`assetSerialNumber` on the interval, read with the code and the name). The filter bar follows the
  table's columns, each filter under its column's name: the item (code, name or serial), the
  category, the hand-over date from/to, «متأخر عن موعد الإعادة», the status, the branch, the holder,
  the return date from/to, and the receipt (signed / awaiting the signature / none). A date range
  is whole Cairo days, its end day included — the days the table prints, so a hand-over typed after
  midnight is found under its own day. Picking a return day moves the status to the returned
  intervals and drops «متأخر»; picking «متأخر» moves it to the ones still out and drops the return
  days; a status drops the filters it cannot meet; and a link that contradicts itself is read
  without what cannot be met — so the bar never contradicts itself into an empty table. «الصنف» finds a name or a serial in any
  digit set it was typed in. The receipt filter reads «signed» exactly as the column's badge does.
- **The acknowledgment agrees with what it hands over** (2026-10-28) — asked whether «ومواصفاته»،
  «لاستخدامه» … should agree with a feminine item, the owner answered «شوف أنت الأنسب وأعمله». Each
  page now takes its wording from its own kind: a feminine kind — its first word ending in «ة», a
  plural in «ات», or «كاميرا» — prints «ومواصفاتها»، «ومشتملاتها» and «لاستخدامها … بالحفاظ عليها …
  بردها»; every other kind prints the form exactly as before (a computer is «جهاز», masculine). The
  mobile line's paper («خط») keeps the masculine form. Web only.
- **No separate export grant** (2026-10-28) — asked whether the asset register's Excel/PDF should
  ride its own `itAsset.export`, the owner answered «شوف أنت الأنسب وأعمله». The files stay with
  whoever may read the list: they hold nothing the screen does not show, and a new grant would hide
  the buttons from every role until each was edited. The §11 server CSV under `itAsset.export`
  remains unbuilt.
- **A held mobile line moves branch with its holder** (2026-10-28) — owner request: «عايزك تفتح إنى
  أعدل الفرع عادي لخط من خطوط الموبايل لأن ممكن القائد يغير الفرع بتاعه». The edit no longer
  refuses a held line's branch: the line, its open interval and the acknowledgment that interval
  names move in one transaction, so the branch that keeps the line now sees its holder and can print
  the paper again; the line's closed intervals keep the branch they were held in. The form says so
  before it is saved.
- **Consumables — a store of their own** (2026-10-28) — owner request: «وعايز بقى شاشة تانية تحت خطوط
  المحمول تكون للمستهلكات زي: حبارات - كابلات بأنواعها - كونفرترات (محولات) بأنواعها - ماوس - كيبرود -
  رامات - هاردات - فلاشات - وهكذا .. وأقدر أحدد عندي Stock إيه من كل واحده وإيه الهالك وأتبدل لمين
  واطبعله مذكره ولو حاجة بتتركب فى حاجة تانية زى الهرد والماوس والكابلات أقدر أذكر الجهاز اللى أتركب
  عليه من اللأصول»; the plan was approved as proposed («موافق على اقتراحاتك كلها في المستهلكات»).
  §2.11 and FR-20: three collections — `it_consumables` (one row per item per branch: each branch
  keeps its own stock), `it_consumable_movements` (the append-only ledger: received, issued,
  scrapped, returned) and `it_consumable_memos` («مذكرة صرف مستهلكات») — and three routers (§12). The
  types are a fourth catalog kind, `consumableType` (§2.4), seeded once by a boot step
  (`go-live/consumable-types.ts`, key `go-live:it-consumable-types:v1`: ink, cables, adapters, mice,
  keyboards, memory, storage, flash, other — a type the catalog already holds, by code or Arabic
  name, is left as it is, and nothing is seeded beside it). **No
  new permission**: the asset grants cover the store, as they cover the lines. `/it/consumables`
  («المستهلكات», in the IT rail under «خطوط المحمول») lists each item with its balance, what was issued
  and what was scrapped, and flags an item at its minimum; «صرف لموظف» takes one employee and one or
  more items of one store, each new or in place of a damaged one («بدل تالف» — the damaged unit is
  counted as scrap too) and optionally the asset it went into, and prints the memo at once, on the
  device acknowledgment's letterhead with its own number (`EGYCASH-IT-CON-0001`), the employee's and
  the IT officer's signature blocks, and no national ID. `/it/consumables/movements` («حركات
  المستهلكات») is the ledger with its filters, its Excel and PDF. An asset's page lists what was
  installed on it; an employee's IT page lists what they were issued. The spare parts (FR-9) are
  unchanged. The workforce reset keeps the items and the ledger and purges the memos.
- **The October all-in-ones** (2026-10-28) — owner request: «هبعتلك سيريلات أجهزة عايز أرفعها بنفس
  مواصفات Lenovo ThinkCentre neo 50a 24 جهاز كمبيوتر AIO بس هيكون فى فرع أكتوبر ومش متسلم لحد أسم
  الملف (SN ايجي كاش) وفيه 100 جهاز». Reviewed with the owner and approved («موافق على كل اقتراحاتك»):
  the barcode's leading «S» is not part of the serial (the register already holds two of the list
  as MP30EPDA and MP30EPD2, at the head office from the inventory — they stay as they are); one
  serial too short to be whole (row 71) is, read off the device by the owner, MP30EPD8 — row 62's
  device scanned twice («MP30EPD8 فعلاً»), so the batch is 99 devices. The go-live file
  `apps/api/assets/it-go-live/aio-october-2026-10.json` holds the 97 to register, serials only. A
  one-time boot step (`go-live/aio-october.ts`, key `go-live:it-aio-october-2026-10:v1`, after the
  inventory run) registers them in ONE transaction as new assets in «أكتوبر», in stock and held by
  nobody, their codes one block of the asset series, each copying the live «Lenovo ThinkCentre neo
  50a 24» — its category, make, model, specifications and accessories (the file's make, model and
  the inventory's all-in-one category when no such device is live) — and nothing else: no serial,
  purchase, warranty, location or holder. A serial the register already holds is skipped and
  reported. It writes no history entry, as no registration does, so a device registered here in
  error can still be deleted (FR-5); the audit row names the run.
- **Specifications by serial** (2026-10-28) — owner request: «وهبعتلك ملف تانى أسمه (جرد الأجهزة)
  هنشوف فيه الـ سيريال بتاع الجهاز وتاخد بيانات الرام والبروسيسور والهارد وتزودها على السيستم». The
  sheet's second page, reviewed with the owner: 38 devices the register holds; four serials the
  sheet mistyped are looked for under the register's spelling (JSJSZXMS3 → JSZXMS3, JZ24WF3 →
  JZ24VF3, 8VPL8F3 → BVPL8F3, 8WVGNQT3 → 8WVGNJ3 — the same model each time, approved «طبّق
  الأربعة»); one with no match and the two «Laptop» rows are left out. The go-live file
  `apps/api/assets/it-go-live/asset-specs-2026-10.json` carries serials and the three values only —
  the sheet's holders and departments stay out of the public repository. A one-time boot step
  (`go-live/asset-specs.ts`, key `go-live:it-asset-specs-2026-10:v1`, after the inventory run) fills
  the acknowledgment table's processor, memory and storage rows ONLY where the device has none
  («تزودها»): a value the IT team typed is kept, and reported when the sheet differs; each device
  touched gets an `updated` history entry naming the rows (the asset-restart step's precedent); the
  audit rows and `it.asset.updated` follow the commit.
- **The consumables' opening stock** (2026-10-28) — owner: «دخّل الأرصدة». The «إجمالي» row of the
  same sheet's first page — the IT team's count — entered at «المهندسين» by a one-time boot step
  (`go-live/consumables-opening.ts`, key `go-live:it-consumables-opening-2026-10:v1`, after the
  types step): ten items (SSD 3, RAM 8 GB 5, Keyboard 23, Mouse 13, Patch Cord 1 m 21, Patch Cord 3 m
  24, Power Cable 5, HDMI Cable 10 m 2, HDMI Cable 3 m 11, HDMI Cable 1 m 1), each with ONE `received`
  movement of its count, in one transaction. An item the store already keeps under the same name
  receives the count instead of becoming a second row, and the outcome names it. The sheet's
  «cable power» column has no total and is left out.
- **Several categories and several names, the names following the categories** (2026-11-01) — owner
  request: «في الـ it/assets عايز فلتر الأسم يبقي بعد الفئات (فى الفلتر فقط) والبيانات اللى فى فلتر
  الفئات هي نفسها تتفلتر بناء على الفئات وعايز الأتنين دول يبقوا Multiselect · وفى /it/custody بردو
  عايز الصنف يبقي بعد الفئة (فى الفلتر فقط) ونفس الكلام يتفلتر والأتنين يكونوا Multiselect». On both
  registers' filter bars — the tables' columns are unchanged — the category filter takes several
  categories, and right after it comes the name filter («الاسم» on `/it/assets`, «الصنف» on
  `/it/custody`), which takes several of the register's names and offers only the names of the
  assets in the chosen categories (every name while none is chosen); a name chosen earlier that the
  new categories do not hold is dropped once their names arrive. A name is free text and may hold a
  comma, so a name list travels as one value with `\,` and `\\` escaped — the platform's
  `joinNameList` / `nameListQuery`, which the ATM boards' bank and area filters already used and now
  share. The custody register keeps its free-text box, first, as «بحث» (the asset's code, name or
  serial). The Excel/PDF name every chosen category and name. An old link with one category or one
  name still opens as it did.
- **The `/it` home is a dashboard** (2026-11-03) — owner request: «عايزك تعمل فى الـ /it الرئيسية..
  Dashboard بدل اللى موجود فيها يظهر إجمالى الأصول وإيه فى المخزن وإيه متسلم بس أقدر أفلتر بـالفئة..
  من خلال Drop Down بـ Multiselection · وشوف إيه تانى ممكن يتعمل بس وريني Sample الأول بتاع UI»; the
  sample was shown and approved with every suggested panel («ماشى تمام كمل»). §11's asset
  dashboard, derived on read — no collection and no stored figure: the five status counts (total,
  in stock, handed over, under maintenance, disposed) under a category multi-select and a branch
  filter, each opening the register with the same filters; the status split; by category (under the
  branch only, a click adds the category) and by branch (under the categories only, a click picks
  the branch); «يحتاج متابعة» — assets held by people HR shows as having left (FR-13's panel, read
  live through the directory: the leaver flag stores nothing), receipts awaiting their signed copy,
  overdue returns, warranties ending within `it.warrantyWarnDays` — each opening its list (the
  custody register's new `holderExited` filter, the asset list's `warrantyEndsWithinDays`); the
  latest movements (history entries and registrations, which write none); the lines' three networks;
  the consumables at their minimum; the help desk's two counts; and the pages, by grant. Every panel
  rides its own grant and the reader's data scope. `GET /it/dashboard/assets` and `/activity`.

- **A hand-over without a printed receipt** (2026-11-08) — owner request: «فى الـ IT تحديداً فى
  تسليم العهدة عايزك تسمح عادى بالتسليم حتى لو مطبعش إيصال». FR-18's print-first rule is lifted for
  the asset hand-over («تسليم عهدة») only: «تسليم» records as soon as the form is complete (it waits
  only while a paper is being composed), and the print stays on offer beside it. Nothing changes on
  the server, which already numbered a receipt for a caller that printed nothing: every hand-over
  still writes its receipt, so the paper prints later from the asset, the custody register or the
  employee's history, and it counts among the receipts awaiting a signed copy. A paper printed and
  then made stale by an edit is not recorded — its number is dropped and the receipt takes the next
  one. The transfer to a new holder and the mobile line's hand-over keep printing first: the owner
  named the custody hand-over.

- **Vehicle device checks** (2026-11-08) — owner request: a phone form «for specific users … to
  inform about the car status»: the car (a dropdown with search), the day (today, changeable), the
  screen, eight cameras, the DVR and the Motorola radio, notes and photos; then «الـ Dashboard مش
  هتكون عند الحركة .. هتبقي عند الـ IT … والشاشة بتاعت الفورم نفسها هنخصصها عادى كدور». The sample
  was approved with the two answers moved onto each item's row («خليهم على نفس الصف … وصغر
  عرضهم»), then «طبق PR». §0, §2.12, §3, FR-21, §7, §11, §12; §9.2 amended: IT reads Fleet's car
  list through two read functions in one boundary file. Full design and its review:
  [it-vehicle-checks-design.md](it-vehicle-checks-design.md). The dashboard follows its own sample.

- **The vehicle check opens at «يعمل», with a note for a fault and a photo always** (2026-11-09) —
  owner request: «عايز هنا /it/vehicle-checks/new التلقائي إن كله يعمل ولو حاجة لا تعمل يبقى
  يغيرها», then «كمان عايز الملاحظة إجبارى لو فى حاجة لا تعمل · وكمان الصورة كدا كدا إجبارى فى كل
  الحالات». FR-21 amended: every device opens at «يعمل» (a tap on the chosen «يعمل» still leaves a
  device the car lacks unanswered); a report with any «لا يعمل» needs a note — on the form, and on the
  server (`IT_VEHICLE_CHECK_NOTES_REQUIRED`, checked after a repeated request id is answered, so a
  report filed before the rule still answers 200); and every report needs a photo on the form.
  The server cannot hold a report to its photo, which is uploaded after the report is filed; a
  report whose uploads all failed says so in red on its sent screen, which offers «إعادة رفع الصور»
  while it stays open and asks once before «تقرير لسيارة أخرى» or the back arrow leaves it (a reload
  asks too while failed photos wait). Design: §1.2, §2, §6.1,
  §6.2 and §6.3 of [it-vehicle-checks-design.md](it-vehicle-checks-design.md).

- **The vehicle checks dashboard** (2026-11-10) — owner request: «فين الـ DashBoard؟ اللى بيظهر فيه
  التقرير والبيانات اللى الناس بتدخلها»; the sample was shown and approved («تمام نفذا الـ Dashboard
  بتاعت الفحص»). `/it/vehicle-checks`, in the console: the six figures of a window (today, 7 or 30
  days) under a branch filter, the faults per device, the cars not checked for seven days, the
  latest report of each active car with its eleven devices, the reports with their photos (a report
  view with the images, «كل تقارير هذه السيارة», a soft delete), Excel and PDF. Two grants join
  `itVehicleCheck.create`: `.view` (scoped by the report's branch at filing; the active cars by their
  current branch) and `.delete`. FR-21, §3, §7, §9.2, §11 and §12 amended; the Fleet boundary gains
  one read (every active car with its branch). The realtime topic `it.vehicleCheck` now has its screen. Design:
  [it-vehicle-checks-design.md §11](it-vehicle-checks-design.md).
- **The branches' custody sheets** (2026-11-10) — owner request: «هبعتلك عهده الأفرع وعايزك تضيفهم مره
  واحده كل فرع فى فرعه فى الـ IT شوف الأول لو فى مشاكل .. أو تكرار». Four sheets (بورسعيد، طنطا، الشروق،
  أكتوبر) and, the same day, a fifth («هبعتلك أسيوط كمان»), reviewed against the register's go-live
  files, and the owner's answers: a device the register
  holds under another branch moves to the sheet's («انقلهم لفرع الملف»); a row with neither serial nor
  tag, or repeating another row's serial, is left out; the two Tanta printers are «طابعتين مختلفتين»;
  a device already registered gets only what it lacks («أكمّل الناقص بس»). The go-live file
  `apps/api/assets/it-go-live/branch-custody-2026-11.json` holds the 244 rows — serials, tags,
  specifications and accessories, no person — each with what the review decided: 157 to fill, 8 to
  move, 68 new, 11 left out. Besides the five the owner's answers leave out, six wait for him to read
  a label: two serials the October inventory found twice (the Shorouk printer CNDRP8Z666 and screen
  B3ZY8V3 — it gave each to another device and registered the second without one, so a move could
  move the wrong device), three screens a character or two off a register screen of the same branch
  that the sheet does not list (October's B3SZ8V3; Assiut's BR565G3 and 1Q1L1T3 — probably those
  screens misread) and an HP Z240 whose only label, L8T14AV, is HP's product number. The Shorouk
  sheet's rows 2–14 (Dell OptiPlex desktops) carry its all-in-ones' processor and graphics word for
  word — a laptop chip no OptiPlex holds — so those two values are left out for them, and row 14's
  memory too (it repeats the two OptiPlex 7090 rows above it). A one-time boot step
  (`go-live/branch-custody.ts`, key `go-live:it-branch-custody-2026-11:v1`, after the inventory, the
  October all-in-ones and the specifications runs) decides each row again against the live register,
  in ONE transaction:
  - a new device is registered in its branch, in stock: a Dell's service tag is its serial number, as
    the inventory registered them, and the sheet's other label (the «CN-0…» number) its printed tag
    (`externalTag`, new here — the inventory left it empty); no history entry, as no registration has;
  - a device the register holds gets only the specifications, accessories, printed tag, make and
    model it lacks, with an `updated` history entry naming them; a value already typed is kept and
    reported when the sheet differs;
  - a device in another branch moves to the sheet's when it is in stock (a `transferred` entry with
    the two branches, no employee), and its location — a place in the branch it left, such as the
    head office's «مخزن IT» — is cleared; a held one keeps its branch and is reported — custody moves it;
  - a row matching nothing, two devices, or a device another row already took is reported and left.
  A branch or a category of its own missing refuses the run, nothing written. Audit rows and
  `it.asset.registered` / `.updated` / `.transferred` follow the commit.
- **Assets and consumables moved to another branch** (2026-11-11) — owner request: «هنا
  /it/consumables وهنا /it/assets — عايز إمكانية نقل أصل أو مستهلك إلى فرع تاني، وطبعاً المستهلكات
  لو مثلاً فى 10 ماوس .. فممكن أنقل 5 لفرع تاني وهكذا». His four answers: an asset an employee
  holds moves too, with its custody, and the holder keeps it («ينتقل مع عهدته»); it is recorded at
  once («فوراً») — no «in transit» step and nothing to confirm at the other branch; there is no
  paper («لا، السجل كفاية») — the asset's history and the consumables' ledger are the record; and
  several go in one step («كذا حاجة مرة واحدة») — several assets, or several items each with a
  quantity, to ONE branch.
  - **Assets** (§2.2, §2.5): «نقل إلى فرع» on the register (a selection) and on the asset's page,
    `POST /it/assets/move-branch` — up to 100 assets, one transaction, all of them or none. One in
    stock changes branch, its location is cleared, and its history gets a `transferred` entry naming
    the two branches and nobody. A held one takes custody's transfer to a new branch in the same
    hands — one body for both (`transferInSession`) — keeping its holder, the signed receipt, its
    due date, its condition on issue and its interval's notes (the move's notes go on the history
    entry alone), a departed holder not refused; its location is cleared too, which custody's own
    transfer to another branch does not do. Refused: a branch the caller's `itAsset.assign` does
    not reach (403), no such active branch (400), an asset out of scope (404), then every asset
    that holds the move back, all named in one refusal — disposed, under maintenance (its status or
    an order open or in progress), already in that branch, held since after the move's date (409
    when all are under maintenance, else 422). Every asset answer gains `hasActiveMaintenance`. The
    screen offers only the branches the SERVER says that grant reaches —
    `GET /it/assets/move-targets`, the move's own test, never the account's reach over all its
    grants (which offered a branch a department-scoped grant merely sits in, or one only another
    grant reaches, and the move then refused it) — shows the assets that cannot move with the
    reason, and leaves them out of the request.
  - **Consumables** (§2.11, FR-20): «تحويل إلى فرع» on the store (a selection of ONE store's items,
    or one row), `POST /it/consumables/transfer` — up to 50 items, each with its quantity, one
    transaction and one `transferId`. Two movement kinds, `transferredOut` and `transferredIn`
    («تحويل إلى فرع» / «تحويل من فرع» in the ledger, its kind filter and its Excel/PDF — out
    −1, in +1), each naming the other branch and the other store's item; three fields on the movement
    (`transferId`, `counterpartBranchId`, `counterpartConsumableId`; index `ix_transfer`). The units
    reach the other store's item of the same name, made there — a new code, the same name, type and
    unit — when it has none; a receiving item in another unit, or retired, refuses the transfer; a
    retired item may still send its stock out. Never more than the store holds (422, as an issue's
    and a scrap's take). The screen offers only the branches the server says the grant reaches —
    the same `GET /it/assets/move-targets`.
  - **No new grant**: both — and `GET /it/assets/move-targets`, which names where they may go —
    ride `itAsset.assign`, the custody grant (§7). Audited as `transfer` (§10) — for the assets
    after the commit, as custody's transfer now is too (FR-3, §4.3); `it.asset.transferred` per
    asset (§8.1). §3, §4.3, FR-3, §6, §7, §10 and §12 amended, and
    [ADR-021](../03-decisions/ADR-021-it-asset-custody-and-history.md) (its 2026-11-11 amendment).
- **The asset register's bulk upload** (2026-11-16) — owner request: «في الأصول عايز زرار Bulk
  Upload للأصول بنفس شكل عهدة الأفرع ويكون فى Preview الأول للى هيتضاف ويوضح لو فى تكرار أو تضارب
  مع بيانات موجوده وهكذا». His two answers: the branch is CHOSEN ON THE SCREEN — the file has no
  branch column, as the custody sheets have none — and a sheet named «عهدة فرع X» suggests X when
  it matches a branch; a device the register holds in another branch «يتنقل لفرع الملف» — moved to
  the chosen branch when in stock, while one somebody holds stays and is shown as a conflict — and
  the reviewer may untick any move.
  - **The go-live's rules, not a copy of them** (§2.2): the sheet is the shape of the branches'
    custody sheets (§17 2026-11-10), and each line is decided by THAT step's planner,
    `planBranchCustody` — its input types generalised so the upload passes the sheet's lines, every
    one a new line of the chosen branch with its sheet row; the go-live decides exactly as before,
    its specs unchanged — against the whole live register: found by serial and tag against every
    device's serial number and printed tag, without case and with the all-in-ones' «S» twin; found →
    only what is empty is filled («أكمّل الناقص بس»), a differing value kept and shown; in stock in
    another branch → moved, its location cleared; held, under maintenance or disposed elsewhere →
    not moved, still filled — and so is one in stock that an active maintenance order holds (the
    planner's optional `activeMaintenance`, which the go-live does not pass); not found → registered
    in stock, the tag its serial number (a Dell's
    service tag is its serial) and the other label its printed tag; a second line for one device →
    a duplicate, the first wins. What the go-live's review left for the owner to read becomes a
    warning that leaves a new line unticked: a serial within two edits of the serial of an
    unlisted device of the chosen branch and the same category (`nearSerial`), and HP's product
    number as the only label (`productNumber`).
  - **Written by the go-live's own write path**, extracted into one function both use — the
    version-conditional write, the move that clears the location, the `updated` / `transferred`
    history entries, the new codes as one reserved block, the audit rows and events after the
    commit. The go-live writes as nobody; the upload as its caller, on the history entries and the
    audit rows, the notes naming the file («من ملف «…» — رفع جماعي»).
  - **The write is the preview that was seen**: the preview's file hash and plan hash come back with
    «تأكيد (n)»; the server plans again in the write's transaction and refuses (409) when either
    differs, and (422) a row that is not a line of the file or cannot be ticked.
  - **No new grant** (§7): `itAsset.create` for the screen and the new lines (the chosen branch
    active and within its reach, 403 otherwise — and the picker lists only those, as the server
    names them); a fill within `itAsset.edit`'s scope, a move within `itAsset.assign`'s with the
    chosen branch in its reach — else the line is `outOfScope`, its device named and the right
    missing said; only a device `itAsset.view` does not reach is `outOfScope` with nothing of it
    shown.
  - **What the review held to** (the same day, before release): a device under an active
    maintenance order is never moved (`heldElsewhere`; every other change of branch already refused
    it); the workbook is never inflated whole — one sheet under caps, streamed, stopped one line
    past 500 (the fuel-card reader's way, SEC-13; a 30 000-row file had taken 175 MB of heap); a
    line with no «النوع» or name, or a value past its limit, is `invalid` BEFORE planning, so it
    never takes a device from a later line; the picker's branches come from the server
    (`GET /it/assets/import/branches`); «من اسم الورقة» after a preview plans again, and step 2
    names the branch the plan is for; the file cannot be removed while a write is on its way;
    «يُكمَّل» only where a tick writes; «تحديد الكل/إلغاء» on the lines in view.
  - **And its second round** (the same day): the streaming read did not stream — the reduced zip
    went to ExcelJS as ONE chunk, and its XML parser turned the whole sheet into events before the
    first row, so a 600 KB file of 20 000 short lines (a 5.8 MB sheet, under its cap) took +283 MB,
    more than the `xlsx.load` it replaced. It is handed over in 64 KB slices cut on character
    boundaries now, parsed as they arrive and stopped one line past 500: the same file +50 to
    +93 MB, a 500-line page +17 to 20 MB,
    the sheet's 6 MB cap kept. A sheet whose XML inflates past that cap is refused before any of it
    is read — a 30 000-line register export is refused so, not by the 500-line rule — and the
    reader's own caps (a part, the entry count, the 20 seconds) answer `SHEET_TOO_LARGE` with
    their own sentence («الملف أكبر من ورقة فرع واحد — ارفع ورقة العهدة وحدها (حتى 500 سطر)»), no
    longer multer's `TOO_LARGE`, which the screen words «larger than 5 MB» even for a 1 MB file.
    And a device under maintenance, or in stock under an open maintenance order, is
    «في الصيانة في فرع X — لا يُنقل» — nobody holds it, so not «متسلَّم»; a disposed one
    «مستبعَد في فرع X».
  - `POST /it/assets/import`, `GET /it/assets/import/branches` (§12) and `/it/assets/import`
    («رفع جماعي» on the register's toolbar: the template, the file, the branch, the preview with its
    counts, kinds and lines, «تأكيد (n)»). §2.2, §4.1, §7, §10 and §12 amended. Contracts:
    `IT_ASSET_IMPORT_*`, `ItAssetImportFieldsSchema`, `ItAssetImportRowDto`,
    `ItAssetImportPreviewDto`, `ItAssetImportResultDto`; `ItMoveTargetsDto` reused for the branches.
- **Only the table scrolls** (2026-11-17) — owner request: «فى شاشات الـ IT مش عايز كل الصفحة تعمل
  Scroll !! عايز فقط الجدول لكن الزراير والفلتر يبقوا ثابتين». Web only: every IT list screen takes the
  boards' frame Fleet and ATM already use (`shared/ui/board-scroll.ts`): from `lg` the page fills the
  screen, the title, actions, figures and filters keep their place, the pager keeps its place below,
  and only the rows scroll under a sticky head; a phone or tablet scrolls the page as before. The IT
  boards' table floor is 8rem (`BOARD_TABLE_FILL_LOW`) so a laptop screen shrinks the rows rather
  than scroll the board — checked in a browser on every board from 1024×768 to 1920×1080. The
  mobile lines' network cards are compact from `lg`; the bulk upload's lines scroll in their own box.
  Dashboards, records and the help desk settings page keep scrolling as pages.
- **The lines and the consumables get their own permissions** (2026-11-17) — owner request: «فى
  الصلاحيات مش لاقى حاجة لـ /consumables ولا /mobile-lines !! فى الـ IT ظبط صلاحيات الشاشات عشان أقدر
  أتحكم فيها». Both screens rode the asset grants by design (2026-10-20, 2026-10-28), so the role
  matrix (module → page → permissions) had no row for either, and an administrator could not give
  one without the other, or without the assets.
  - **Two resources, each with its own page**, placed after «الأصول» in the rail's order (sort 13
    and 16; nothing renumbered): `itMobileLine` (page `it.mobile-lines`, «خطوط المحمول») — `view`,
    `create`, `edit`, `assign` («تسليم واسترجاع خطوط المحمول»), and `viewNationalId` («عرض الرقم
    القومي للمستلم في إقرار استلام الخط», Security Architecture §3's sensitive-data grant for the line
    acknowledgment; the device receipt keeps `itAsset.viewNationalId`); `itConsumable` (page
    `it.consumables`, «المستهلكات») — `view`, `create`, `edit`, `assign` («صرف واسترجاع وتحويل
    المستهلكات»). Each maps 1:1 onto what the same route authorized under `itAsset.*` — the same
    operations, the same scopes (built from the new key), the same branch checks (`keyReachesBranch`
    on the new key). Nothing else about behaviour changes (§7).
  - **The asset keys open nothing on these two screens** — every route under `/it/mobile-lines`,
    `/it/mobile-line-assignments`, `/it/mobile-line-receipts`, `/it/consumables`,
    `/it/consumable-movements` and `/it/consumable-memos`, the two signed-copy file authorizers, and
    the realtime topics (`it.mobileLine`, `it.mobileLineReceipt` → `itMobileLine.view`;
    `it.consumable`, `it.consumableMemo` → `itConsumable.view`). No «either key» fallback: it would
    make the new rows meaningless. The assets, custody, the employees screen, the home's asset
    panels, scan, import and the device receipts keep `itAsset.*` exactly as they were.
  - **Nobody loses access on deploy.** A one-time go-live step (`go-live/screen-grants.ts`, run key
    `go-live:it-screen-grants:v1`) gives every role and every live delegated grant that holds an
    `itAsset` key the matching new keys — `view`, `create`, `edit`, `assign` to both resources,
    `itAsset.viewNationalId` → `itMobileLine.viewNationalId`. Strictly additive, idempotent, once (a
    key an administrator removes after the run stays removed), and it widens nobody: every holder
    already had exactly these powers through `itAsset.*`. This is a deliberate exception to the ATM
    split's «no role widened at boot» ([atm-operations-port.md](atm-operations-port.md) §9, lead
    override O-1): there the old key KEPT opening the page; here it STOPS, so without the copy the
    IT team would lose two screens the moment the deploy lands.
  - **`GET /it/consumables/transfer-targets`** (`ItMoveTargetsDto`, under `itConsumable.assign`): the
    transfer picker's branches — `moveTargetBranchIds(ctx, 'itConsumable.assign', …)`, the very test
    the transfer applies before it writes. `GET /it/assets/move-targets` stays on `itAsset.assign`,
    for the assets alone.
  - **`/it/people`** — the holder boxes of all three screens — opens on ANY of `itAsset.view`,
    `itMobileLine.view`, `itConsumable.view`; a person is found when ANY held one reaches them, each
    in its own scope — the platform directory's `anyOfScopes`, which HR's register applies as the OR
    of each selector's own filter. Not one key for all: two grants can reach different branches (the
    assets over A and B, the store over A) or one be `own`, and no single selector says both. What each person holds of the ASSETS (`openCustodyCount`) is
    counted only within the caller's `itAsset.view`; without it the register is not asked and every
    person reads 0 — by the DTO's own definition («open custody intervals the reader may see»), so
    no contract change: a lines or store keeper finds people and learns nothing of anybody's devices.
  - **An issue's «installed on»** names an asset within the caller's OWN `itAsset.view`; without it,
    every asset id is the existing «asset not found» refusal and the register is not asked. The
    asset labels a ledger row and a memo show stay as they were — part of the item's record, read
    under the store's grant.
  - **The catalog's read** (`GET /it/catalog-items`) takes `itConsumable.view` as well as
    `itAsset.view` and `itCatalog.manage`: the store, its movements page and the add-item form read
    the `consumableType` rows, and a store keeper given the consumables without the assets would
    otherwise open a screen whose type list 403'd. It widens nothing — every holder had
    `itAsset.view`, and with it this list, until that day — and the rows are names.
  - **Navigation**: the Mobile Lines row → `itMobileLine.view`, the Consumables row →
    `itConsumable.view`, each with `previousPermission: 'itAsset.view'` (the ATM data-edit
    precedent: the stored row is corrected only while it still holds the old key). IT Home, the
    assets, custody and employees rows unchanged. The web follows (`modules/it/routes.tsx`, the
    screens' `can(…)`, the home's and an employee history's panels on the panel's own grant).
  - The copy is started by the api alone (`server.ts`), not the worker as the other steps are: the
    worker boots the new build minutes before the new api serves, and a role made in the old roles
    screen meanwhile would miss the copy for good. What is left is the health check's hand-over.
  - One window the copy cannot close: a delegation screen opened before the deploy and saved after
    it replaces the unit's whole list (that editor checks no client version), dropping the copied
    keys for that one deputy and unit; a role form in the same window gets the usual version
    conflict. The run row counts the delegated grants copied.
  - §2.10, §2.11, FR-19, FR-20, §7, §9.1 and §12 amended. Contracts: comments only (`ItMoveTargetsDto`, `ItPersonDto`,
    the lines' and consumables' headers).
- **The issue's person and device find each other, and the device can be changed afterwards**
  (2026-11-17) — owner request: «عند تسليم المستهلكات .. عايز حاجة مهمة جداً .. لما أكتب اسم الشخص اللى
  هسلمه تظهر الأجهزة اللى معاه بس.. لأن الطبيعي اسلمله مستهلك لجهاز .. والعكس بردو .. لو كتبت سيرال فى
  الجهاز اللى هيتركب عليه المستهلك .. تظهر على طول الشخص اللى مستلم الجهاز دا انه بردو هو اللى هيستلم
  المستهلك». Asked «بعد ما تختار الموظف، تظهر أجهزته بس ولا تقدر كمان تختار جهاز تاني مش في عهدته (زي
  طابعة في المخزن)؟», he chose **«أجهزته أولاً + «جهاز آخر»»**. And: «وضيف إمكانية تعديل الجهاز اللى
  عليه المستهلك بعد التسليم»; asked what the printed memo does then, he chose **«تتحدّث بالجهاز
  الجديد»** — a reprint shows the new device, the change is recorded (who, when, from which device
  to which), and the signed copy already filed stays as it is.
  - **«صرف لموظف», person first** (web only — the API already answered it: `GET /it/assets
    ?holderEmployeeId=`, every asset's `holder` and `serialNumber`, `GET /it/people/:id`): once a
    person is chosen, each line's «مركّب على» lists the devices they hold now, at once and without
    typing, each with its code and serial, a hint saying whose they are, and plainly «none» when
    they hold none — the field stays optional. Under them, «جهاز آخر» opens the search over the
    whole register (a shared printer's toner, a device in stock), its rows still showing serial
    and holder; a device somebody else holds, picked that way, never changes the person — the
    line notes whose it is.
  - **Device first**: with nobody chosen, the search's rows show the serial and who holds the device
    («في عهدة …» / «في المخزن»), so a typed serial names its holder at once; picking a held device
    fills the person with that holder (the employee box's own label) only if HR shows them still
    working here — a leaver fills nothing and is said under the field; a device in stock fills
    nothing.
  - **Keeping the two consistent**: changing the person from P to Q clears a line's device only if
    P held it (it was picked as P's device), said once under the lines; Q's own device, one in
    stock, or a third person's picked through «جهاز آخر» stays. Clearing the person keeps every
    device. Nothing is ever picked for the user, not even a person's only device. The other
    `AssetPicker` callers (custody, maintenance, software, plans, the movements filter) are
    unchanged — every new prop is optional.
  - **«تعديل الجهاز»** — `PATCH /it/consumable-movements/:id/installed-on`
    (`SetItConsumableInstalledOnSchema { assetId | null, version }`, under `itConsumable.assign`,
    the issue's own rules — §2.11, §7, §12): the device an issued unit sits in is the ledger's ONE
    correctable fact, because it is a description, not a quantity — it moves no counter; every
    other field of every row is still never edited, and the movement repository gains one narrow
    write for exactly this. The memo line that is the movement is re-snapshotted from the register
    in the same transaction (so a reprint prints the new device); the signed copy is untouched; two
    `update` audit rows (the item's, the memo's) and both topics' refresh follow the commit. The
    ledger's rows carry their `version`. On the ledger component (the movements page, an item's
    movements, an employee's history, the asset page's card) every issued row offers it with
    `itConsumable.assign` AND `itAsset.view`: the person's devices first, «جهاز آخر», «بدون جهاز».
    Its dialog is held beside the table, not in the row, so a re-read that takes the row off the
    list (on an asset's card a 409 means the unit now sits elsewhere) leaves the dialog and its
    refusal on screen, saying the row has left the list.
  - **The device it was moved off stays protected** (FR-5): the row keeps every device it named
    before (`installedOnBefore`), and the delete guard reads it — the signed copy on file and the
    trail still name that device, so it is not «registered in error». Disposing it stays open.
  - §2.11, §7, §12 and FR-5 amended. Contracts: `SetItConsumableInstalledOnSchema`,
    `ItConsumableMovementDto.version`.
