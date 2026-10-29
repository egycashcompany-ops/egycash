# ATM Operations — module port

**Status:** approved by the owner (design 2026-08-23) · **Source:** the standalone
`egycashcompany-ops/ATM` system (Express 4 + EJS + Mongoose 6, one deployment per branch) and its
per-branch mail reader `egycashcompany-ops/Automation` · **Target:** ECMS module `atm`

This is a PORT record, not a redesign: the legacy Operations behaviour is the specification, and
where this document and the code disagree with the original system, the original system is the
bug report. File:line references point into the two source repositories.

> **Scope.** The legacy ATM system has eight sections (efficiency/investigations, back office,
> open-cash vault, ATM vault, supplies, review, preparation, operations). This port delivers
> **Operations only**: `/atm_replenishment` (+`_done`), `/atm_maintenance` (+`_done`),
> `/mail_maintenance` (+`_log`), `/all_atm` — plus `/data_edit_atm`, added to scope by the owner
> after design approval (it is the machine-master dependency the operations pages validate
> against). The other sections arrive as later slices of this same manifest.

---

## 1. The rule the port was executed under

> انقل الـOperations إلى ECMS مع الحفاظ على السلوك الحالي للـlegacy system كما هو قدر الإمكان،
> ثم اربطه فقط بالبنية المشتركة الموجودة في ECMS.

So: **behaviour preserved, scaffolding replaced** (the gold-port rule). Multi-row opens, the
open→close lifecycle with timing from the moment of opening, the two-group grid, the timer's
1h/2h/3h colour ladder, the leader shift-cascade, the mail accept/reject flow and its
categorization, the `-D` delete rename — all the legacy's. Auth, RBAC, branch scoping, audit,
validation, concurrency and the HTTP shape are the platform's, because that is what "part of
ECMS" means.

## 2. Legacy → ECMS map

| Legacy | ECMS | Notes |
| --- | --- | --- |
| `atm` collection (models/atm.js) | `atm_machines` | + `branchId` (D-branch below); unique `(branchId, machineCode)` over live rows |
| `atm_rep_log` (models/atm_rep_log.js) | `atm_replenishments` | `end:0/1` → `closedAt: null/Date`; vestigial `status` (always 0) not carried (G3); `service_type` (always `''` on rep) not carried |
| `atm_maint_log` (models/atm_maint_log.js) | `atm_maintenances` | + `source: manual|mail` + `mailTicketId` (provenance the legacy discarded at acceptance) |
| `atm_mails` (models/atm_mailss.js) | `atm_mail_tickets` | status 0/1/2 → `pending/accepted/rejected`; + `actionAt` (G1) + `providerMessageId` (idempotency) |
| `atm_data_lists.bank[]/area[]` | `atm_ref_labels` (kind `bank`/`area`) | The five dead arrays (`zone`, `leaders`, `ops_emp`, `rep`, `maint`) not carried (G4) |
| `filters` per-user collection | URL parameters (client persistence) | Same visible behaviour, no server preference store; the area list without a bank, the bank-change cascade and the whole-board read are D8 |
| `users` / `user_status` | platform auth/RBAC | Single-session enforcement is a platform policy, not module behaviour (T4) |
| `employees` (dept "الصراف الالى") | `platform/directory` + `atm.maintenanceLeaderDepartmentIds` setting | The hardcoded department NAME became configuration |
| Legacy pages | `/atm/replenishments(±/done)`, `/atm/maintenance(±/done)`, `/atm/mail-tickets(±/log)`, `/atm/machines`, `/atm/data-edit` | `apps/web/src/modules/atm/routes.tsx` |
| Privileges (`atm-user`, `atm-user-review`, `atm-admin`, `Efficiency-admin`) | `atmReplenishment.*`, `atmMaintenance.*`, `atmMailTicket.view/decide/viewLog`, `atmMachine.view/manage/moveArea`, `atmRefLabel.create/edit`; Efficiency: `atmRegister.view/create/edit/delete/export/handover/viewSecrets/import`, `atmRegisterReport.view`; the bank catalog: `atmBank.create/edit` (organization scope only) | Roles carry the legacy bundles; the review role = view+complete on done surfaces (contad_app.js:1056 vs :2096); the mail log is admin-narrow (:2901). Since the Efficiency register, `/atm/data-edit` is split: Operations hold `atmRefLabel.*` + `atmMachine.moveArea`, the administrator keeps `manage` (§9) |

## 3. Decisions taken under the owner's delegation

- **D1 — ATM-owned bank/area lists**, not the operations bank catalog. `data_edit_atm` ADDS and
  REMOVES bank names (contad_app.js:2477-2524) — a write no module may perform on another
  module's collection — and the legacy itself kept `atm_data_lists` beside `data_lists` as a
  separate list with a separate administrator. Machines store the label string, as legacy did.
  **Amended 2026-10-28:** the register's banks became the company-wide catalog `atm_banks`
  (register spec DEC-35), and it is ATM-owned for the same reason: the operations bank catalog is
  another module's list, with another administrator. The per-branch lists stay. A `bank` label is
  now an Operations SPELLING of a catalog bank and names it (`bankCode`); an `area` label gains
  Arabic and English display names. Machines still store one label string.
- **D2 — `/data_edit_atm` in scope** (owner's follow-up message): delivered whole — bulk add with
  skip-and-name, delete with the `-D` rename, area reassignment, both label lists. Since the
  Efficiency register its authority is split between Operations and the administrator (§9);
  nothing was removed. **Amended 2026-10-28:** a machine added here is also recorded in the
  register, an archived code is brought back instead of refused, and a code living in another
  branch is refused (§9).
- **D3 — `/reports_atm` DELIVERED** (revised): originally deferred as outside the owner's page
  list, then built under the owner's standing delegation. It rides the existing view grants and
  declares no permission and no page (the operations B5-report precedent).
- **D7 — the report's day is a parameter.** The legacy screen could only ever show today
  (contad_app.js:2244-2249), which made "what did yesterday look like" unanswerable. A date on a
  read-only aggregate changes no behaviour and stores nothing; the default is still today.
- **D4 — no `openedAt >= today` floor on the open lists.** The legacy floor (contad_app.js:263)
  made an open row with a past open date invisible on every screen forever — un-closable. Open is
  open; the client still renders non-today rows as the grey carried-over group with no timer,
  which is the visible legacy behaviour (atm_replenishment.ejs:1086). **Amended 2026-10-13 with
  OD-1:** the legacy grey group also had no close control and no checkbox. Harmless while a
  machine could simply be opened again; under OD-1 an open row of ANY day blocks its machine (a
  new open, a reopen, a mail accept), so the grey rows now carry the close button and the checkbox
  on both boards (bulk close, edit and delete span both groups; each table's "select all" stays in
  its own group). Without it the only ways out were deleting the record or moving its open time
  to today — losing or falsifying it. The server's close always accepted any open row.
  **Amended again 2026-10-27:** the boards no longer draw two groups at once — they show ONE day
  view (§10), today's by default; the earlier days left open are the «أيام سابقة لم تُغلق» view,
  and its rows keep the close control and the checkbox. With OD-1 narrowed to the day such a row no
  longer blocks today's open, but it is still open and still needs a place to be closed.
- **D5 — mail `duplication` computed at read, not written back during GET.** The legacy GET
  recomputed AND wrote it per render (contad_app.js:2674-2698); the screen shows the same live
  answer either way. The ingest-time value stays on the row for parity. (What it MEANS changed
  with OD-1, §4a: an open maintenance on any day, in any branch.)
- **D6 — accepted mail opens maintenance at the ticket's stored `receivedAt`.** The legacy took
  it from the rendered cell text re-parsed client-side (mail_maintenance.ejs:903) — the same
  intent, minus a timezone round-trip through `document.write`.
- **D8 — the bank and area filters work on their own and over the whole board** (2026-10-13,
  «الفلتر بتاع البنك والمنطقة اتأكد إنه شغال فيهم»). Both open boards, one rule set
  (`operation-log.repository.ts` `facets`/`listOpen`, `apps/web/src/modules/atm/lib/board-filters.ts`,
  `lib/whole-board.ts`):
  - **An area can be chosen with no bank — restoring the legacy header filter.** The legacy page
    had TWO filters. The saved one (contad_app.js:255-266) offered areas only for the chosen banks
    and, with none chosen, `$in: []` — nothing; the port copied that faithfully. But the same page
    carried a table-header filter row whose Area select listed every area on the board, whatever
    the bank (atm_replenishment.ejs:997-1005, :1158-1181; atm_maintenance.ejs:1285, :1499-1522).
    The port has no header row, so filtering by area alone had become impossible. The facets now
    answer: no bank chosen → the areas of every open row in scope; banks chosen → those banks'
    areas (the saved filter's cascade, unchanged).
  - **A bank change drops the areas it orphaned.** Pick NBE and one of its areas, switch to CIB,
    and the stale area stayed in the URL — the board asked «CIB in that area» and came up empty
    with nothing on screen saying why. The screen now prunes the chosen areas against the NEW
    banks' area list, once that list has loaded (never against a list still loading, being
    re-read, or failed). Pressing Back before that list arrives leaves the change: nothing is
    pruned and the board reads the restored selection at once (it used to wait on its loading
    rows for good). While a bank tick's answer loads, the bank list stays on offer — it is the same
    whatever the banks chosen — and the area list says it is loading rather than offering the
    previous banks' areas or «no results». Nothing else prunes: a remembered or linked bank/area that no open row
    carries right now stays chosen — it is still the desk's question, and the next row opened
    there belongs on its board — and stays visible: its dropdown lists it, ticked, to untick, and
    an empty board says «لا توجد عمليات مفتوحة تطابق البنك أو المنطقة المختارة» instead of the
    unfiltered empty message (the `MultiSelect`/vehicle-code precedent for a value its list has
    moved past).
  - **The board is read whole.** It asked for one page of `MAX_PAGE_SIZE` (100) and had no pager,
    so past the hundredth open operation (by area) rows were invisible — not closable — and every
    filter searched only those hundred. The screen now walks every page into one cache entry (the
    fleet `whole-catalog` precedent), each row kept once if it slid across a page boundary between
    reads. A write landing between two page reads can also slide a row back onto a page already
    read — missed, while the closed row stays — and on a first load its realtime signal is absorbed
    by the read in flight, so the walk checks itself: every page must report the first page's
    total and the rows read must add up to it, else it is read again (at most three walks, the last
    one shown); selection, bulk actions, close, the today/carried-over split and the realtime refresh
    all run over the whole set. `MAX_PAGE_SIZE` is unchanged. Since «select all» can now check
    more rows than one bulk request carries (`ATM_BULK_MAX_IDS`, 200 — unchanged), close, edit and
    delete send a larger selection in consecutive requests of that size, joined as one answer; a
    refused batch fails the action and nothing after it is sent.
  - **A name is matched as the board shows it.** Bank and area are free text, so the filter
    lists travel escaped: one comma-separated value as before, `\,` a comma inside a name, `\\` a
    backslash (`joinAtmNameList`/`splitAtmNameList`, `atmNameListQuery`) — «Raml, Station» used to
    be cut in two and match nothing, while every link and remembered filter written before reads
    exactly as it did. And a name stands for every stored spelling that differs only by
    surrounding spaces («NBE» and «NBE »): the dropdown offered both as «NBE», and picking the
    spaced one matched the OTHER spelling's rows because the query parser trims. Case is not
    folded — two spellings that differ by case remain two options, each matching its own rows.
  - **Verified unchanged:** the dropdowns and the list read the same open, live rows under the same
    `*.view` scope selector, the command bar's branch narrowing included; Arabic names travel
    percent-encoded and match; a write's invalidation and its realtime signal refresh the board
    and its dropdowns together (both under the kind's feature key). Suite:
    `tests/integration/atm-board-filters.spec.ts`.
- **D9 — the machine directory (`/atm/machines`) filters every column, server-side, and counts
  it** (2026-10-14, «عايز فلتر كامل بكل حاجة فى الجدول زى فلتر الحركة كدا فى السيارات … وكمان عدد
  الماكينات والبنوك والمناطق يظهر فوق بجانب جملة كل الماكينات (ويتغير بناء على الفلتر)»).
  `machines/machine-filter.ts`, `GET /atm/machines/summary`,
  `apps/web/src/modules/atm/pages/MachinesPage.tsx`, `lib/machine-directory.ts`:
  - **One filter per column, the vehicles registry's bar.** Bank and Area: names, several at once
    (ORed), escaped like the boards' (`atmNameListQuery`), each standing for every stored spelling
    that differs only by surrounding spaces (`storedSpellingsOf`, resolved over the machines in
    scope). ID: `codes` — exact, normalized by `normalizeAtmMachineCode`, up to 200, pasted with any
    separator — and `code`, a substring, which is what the picker searches (50 at a time, among the
    machines the other filters leave; the directory is too large to load whole into a dropdown the
    way the vehicle-code filter loads two hundred cars). ATM Name: `name`, a substring. Every
    substring is case-insensitive and taken literally (regex-escaped). Columns are ANDed. The
    existing `isActive`, `search`, `bankName`, `area` parameters read exactly as before; the page
    sends `isActive=true` as /all_atm did. The page's free-text search box is gone — the four
    column filters ask what it asked, column by column.
  - **The summary counts the whole filtered set, never the page.** Machines, distinct banks and
    distinct areas (names trimmed, blanks not counted) under the same `atmMachine.view` scope as
    the list, the command bar's branch narrowing included; no branch parameter exists for a screen
    to send. Its dropdown sources are FACETED: each list offers the names of the machines matching
    every OTHER filter, its own choice left out — so a second bank can always be ticked, while an
    area narrows the banks to those it has. A chosen name nothing matches is not offered by the
    server; the screen still lists it, ticked, to untick (the boards' rule).
  - **Paged on the server, exported whole.** The page read one page of `MAX_PAGE_SIZE` with no pager,
    so past the hundredth machine (by code) nothing was listed, searched or exported. It now pages
    (the shared `Pagination`, 10/25/50/100, 25 by default) and sorts by any column; the CSV export
    walks every page of the filter (`fetchWholeBoard`) and keeps its four columns. No index was
    added: the scope's `branchId` prefix is already indexed and the directory is a few thousand rows.
  - Suite: `tests/integration/atm-machines-filter.spec.ts`.
- **T7 — open forms validate codes against ACTIVE machines.** Legacy replenishment validated
  against every machine ever stored, deleted included (`Event6.find({})`, contad_app.js:657),
  while its own mail reader validated against active ones (Automation/src/index.js:149-153). The
  active set wins the disagreement.

## 4. Deliberate deviations (each one a conflict the design surfaced)

| # | Legacy | Port | Why |
| --- | --- | --- | --- |
| T-auth | Every POST unauthenticated (contad_app.js:632, 1024, 1887, 2189, 2404, 2742) | Every mutation behind a permission | RBAC is non-negotiable platform architecture |
| T2 | Acting user read from a hidden form input (`user_name`, atm_replenishment.ejs:559) | `createdBy`/snapshots from the authenticated identity | Same visible columns, minus the spoofability |
| T1 | Replenishment `open_time` stored as Cairo-local labelled UTC (:644-650) while `close_time` is true UTC (:782) — bridged by a +3h display kludge (atm_replenishment_done.ejs:471-478) | Honest UTC instants; durations are the plain difference | The kludge dies; **migration must normalize** (§7) |
| T5 | Unknown codes accumulated in a module-global shared across users, cleared every 500ms (contad_app.js:202, 618-623) | Returned in the open response per request | The global raced between users by construction |
| T6 | Maintenance multi-edit "wrote" `schedule_time` — a field its schema never declared, silently dropped (:2042-2044 vs models/atm_maint_log.js) | Not carried | A write that never landed is not behaviour |
| UI | Reopen was the done icon's double-click (atm_replenishment_done.ejs:462) | A visible action with a confirm | Same capability, same data effect (`closedAt` cleared, closer kept) |
| UI | /all_atm exported via a CDN-loaded xlsx build (all_atm.ejs:986) | CSV with UTF-8 BOM, same four columns | No CDN dependency; Excel opens it identically |

**Preserved quirks worth naming** (because a reviewer will ask): ~~a code pasted twice opens two
operations (no duplicate guard on open — the paste is the operator's statement)~~ — **withdrawn
2026-10-13 by the owner's decision OD-1 below**; the
replenishment leader cascade fires only when open-time is NOT moved in the same submit
(contad_app.js:854-859) while maintenance's cascades unconditionally (:2019-2032); the cascade's
night window is anchored to the open time's own calendar day even before 06:00 (:815-817) —
so a row opened between 00:00 and 06:00 falls OUTSIDE its own window and the leader cascade
correctly touches nothing, not even that row (`contad_app.js:858-861` takes the shift_two
window whenever the hour is < 6); a
reopen clears `closedAt` and keeps the closer's name, exactly as `end=0` did (:1032); rejection
does not stop future mails for the same machine; force-date ≠ today opens at 06:00 Cairo (:726).

## 4a. Owner decisions overriding the legacy

| # | Date | The owner's words | Legacy | Port |
| --- | --- | --- | --- | --- |
| OD-1 | 2026-10-13 | «في ملحوظه مهمه جداً .. إن مينفعش أضيف ماكينة مرتين سواء فى عملية التغذية أو الصيانة» | No duplicate guard anywhere: the replenishment open (contad_app.js:637-768) and the maintenance open (:1896-1957) inserted one row per submitted line, so a pasted-twice code, a second paste later in the day, or a mail accepted for a machine already in maintenance each opened a second live row | **A machine has at most ONE open replenishment and at most ONE open maintenance** (open = `closedAt: null`, not deleted). The two kinds are independent; after a close the machine may open again. Enforced on every path that creates or re-opens an open row, with a partial unique index per collection behind it |
| OD-1a | 2026-10-27 | «خلى الرفض دا "لم تُفتح لأن للماكينة تغذية مفتوحة بالفعل أو لأن الكود مُدخل مرتين" يحصل فقط إذا كانت الماكينات مفتوحه في نفس اليوم ولم تُغلق ! مش يرفضها لو مفتوحه أمبارح ومتقفلتش» | — (OD-1 itself overrode the legacy) | **OD-1 is per Cairo day.** A machine has at most one open replenishment and at most one open maintenance ON ONE DAY — the Cairo calendar day of the open time, the day the boards show it on. One left open on an earlier day does not block a new open, a reopen or a mail accept; a second one on the same day still does. Moving an open operation's time onto a day its machine is already open on is refused too (new: the edits) |

**OD-1 in detail** (`apps/api/src/modules/atm/shared/open-operation.ts`). Since OD-1a every
"open" below means "open on that day": the day is `openDayOf(openedAt)` (Cairo); the service checks
ask by the open time's own day range, so a row stored before the day was (`openDay: null`) blocks
its day all the same.

- **Identity is the machine code, company-wide.** The normalized `machineCode` — the identity the
  mail matcher already uses (§6) — so an operation open in ANOTHER branch blocks too, including a
  code whose master moved branch. Every refusal names only the code the caller typed: never the
  other branch, never the blocking row.
- **The batch opens** (`POST /atm/replenishments/open`, `POST /atm/maintenances/open`) keep their
  partial semantics: a code that already has an open operation of that kind, or that repeats
  earlier in the same batch, is not opened and is returned in the NEW response field
  `alreadyOpenCodes` (one entry per refused line, beside `unknownCodes`); the other lines open.
- **The reopens** (`POST /atm/replenishments/:id/reopen`, `POST /atm/maintenances/:id/reopen`) answer
  **409 `ATM_OPERATION_ALREADY_OPEN`** when the machine already has ANOTHER open operation of that
  kind on the reopened row's own day; a reopen writes the row's `openDay`.
- **The edits that move the open time** (OD-1a — `PATCH /atm/replenishments/:id`, `/bulk`, `PATCH
  /atm/maintenances/:id`) answer the same 409 when an OPEN row would land on a day its machine is
  already open on; the bulk edit sets one instant on every checked row, so two checked rows of one
  machine are refused too, before anything is written (`codesBlockedByMove`).
- **The mail accept** (`POST /atm/mail-tickets/accept` → `maintenance.service.openFromMail`) does not
  accept a ticket whose machine already has an open maintenance — including one accepted earlier in
  the same selection. The ticket stays pending; `data` is still the array of accepted tickets
  (unchanged for existing clients), and the refused ones ride in
  `meta.refused: [{ ticketId, machineCode, reason: 'maintenanceAlreadyOpen' }]`. A ticket that a
  CONCURRENT accept of the same ticket just accepted is skipped like any decided ticket, never
  reported as refused (the maintenance blocking it is its own). The accept confirm already counts
  the selected mails painted «Duplicate» and says they will stay pending.
- **The mail `duplication` flag changed meaning** (D5 is otherwise unchanged): it was "an open
  maintenance opened TODAY in this branch" (contad_app.js:2674); it is now "this machine has an
  open maintenance ON THE TICKET'S DAY" — the day it was received, which is the day accept opens it
  on (D6) — in any branch, on the pending screen AND as the ingest-time value the log stores. What
  the screen paints is exactly what accept refuses.
- **Concurrency.** `ux_open_replenishment_per_code_day` / `ux_open_maintenance_per_code_day` (since
  OD-1a): unique on `{ machineCode, openDay }` where `closedAt: null`, `isDeleted: false`, the code
  is a non-empty string and `openDay` is a stored day — every write that sets the open time writes
  it. The first form's `ux_open_*_per_code` (unique on the code alone) is DROPPED at boot by name
  (`RETIRED_OPEN_OPERATION_INDEX_NAMES`, `atm-indexes.ts`): kept, it would refuse a machine left open
  yesterday. A row stored before `openDay` existed is outside the index and held by the service
  check alone, which reads its open time; nothing is backfilled. Under the first form, the index ran
  where `closedAt: null`, `isDeleted: false` and the code is a non-empty string
  (an empty code — only a raw legacy import could write one — identifies no machine, and the
  service check ignores it exactly as the index does). A race past the service check lands on the index and is mapped to the same refusal — a reported
  line, a refused ticket or a 409 — never a 500 and never a half-written line. Both are built at
  boot by `atm-indexes.ts` (the two operation models joined its list, so their older non-unique
  indexes are now built in production too). Production may already hold two open rows for one
  code: the index is then reported — collection, index and counts only, no row data — and skipped,
  and the service check keeps refusing every new duplicate. Close or delete the stale row, then
  redeploy. The maintenance index also serves the `duplication` question, so the legacy-shaped
  `ix_branch_machine_open` (branch + code + "today") is no longer declared.
- **A carried-over row is closable where it is shown** (D4, amended): the grey group of rows
  opened on an earlier day — an overnight operation, a mail received yesterday and accepted today
  (D6), a back-dated open, a reopened older row, an imported stale row — blocks its machine like
  any open row, so both boards give it the close button and the checkbox.
- **Paths that cannot open a row and need no guard:** close, the leader cascade, soft delete — the
  mail restore's removal of the maintenance a ticket opened included (§6d); the edits when they
  leave the open time's day alone (since OD-1a an edit that moves it is guarded, above); no path
  brings a deleted operation back — a restored ticket accepted again opens a new one, through the
  guarded accept.
- **The legacy importer is exempt** (§7): it writes history as it was. A second open row it carries
  is refused by the index and REPORTED (`openDuplicate`, `openDuplicateIds`), never a crashed run;
  where the index is absent the report says so (`openIndexMissing`) and the duplicate lands (§7).

## 5. GAPs (no clear legacy implementation — recorded, not guessed)

- **G1**: no timestamp for accept/reject — the log showed WHO but never WHEN. `actionAt` added;
  the owner's log requirement ("متى حدث ذلك") demands it.
- **G2**: `atm_mails.found` written at ingest, read by nothing. Carried as `foundInMaster`,
  still rendered nowhere.
- **G3**: `status` on both logs written 0 and never changed by any code path — the field
  never carried a state. Not carried: open IS `closedAt: null`, the fleet maintenance-visit
  precedent.
- **G4**: the five unused `atm_data_lists` arrays — dropped.
- **G5**: mails matching no machine were dropped on the floor (Automation/src/index.js:199-201).
  The ingestion contract returns `unmatched` and the transport must LEAVE THE MESSAGE UNREAD —
  the owner's explicit rule.

## 6. The central mail reader (ATM-6 — delivered)

The legacy ran ONE reader PER BRANCH — a separate Node service per deployment, each polling its own
mailbox against its own database (`Automation/src/index.js`). The target is ONE central reader, and
the port inverts branch resolution to get there: **the machine decides the branch.** A mail names a
machine code; the code resolves to exactly one active machine across all branches; the ticket is
filed under that machine's `branchId`. That is the whole of "يصنف الرسائل حسب Branch", expressed as
data the master already holds — there is no per-branch mailbox, rule or routing table to keep.

**Shape.** Three files, one direction:

| Piece | What it is |
| --- | --- |
| `mail-tickets/mail-source.ts` | The mailbox seam — `listUnread` / `markHandled`, a NULL default, opt-in registration. The National-ID OCR seam's exact shape. |
| `mail-tickets/graph-mail.source.ts` | Microsoft Graph, the legacy transport ported. Opt-in on four `ATM_MAIL_GRAPH_*` settings; the client secret takes plaintext OR a platform `SecretRef`. |
| `mail-tickets/mail-poll.service.ts` | The loop, run by the `atm.mailPoll` scheduled task every minute — the legacy's own 60s cadence. |

**Why the module owns the reader rather than n8n calling in.** Everything that makes ingestion a
business decision — parsing the two bank formats, matching the machine, deriving the branch, the
found/duplication flags — is ATM domain logic and already lives in `mail-ingestion.service.ts`.
What was missing was a transport. Putting the transport behind an interface in the module uses only
sanctioned platform seams (scheduler, secret store, settings) and needs nothing that does not exist;
routing it through n8n instead would need the automation module's inbound callback surface (A-6b,
not delivered) and would put either the parsing or a token surface somewhere it does not belong.
**The choice is reversible**: when A-6b lands, an HTTP route can call the SAME
`atmMailIngestionService.ingest(...)` seam and `mail-source.ts` simply stops being registered —
nothing above the seam moves. (ADR-018 positions `automationService` as ECMS → runtime dispatch;
this is the other direction, which that seam does not model.)

**The outcome decides what happens to the message** — the owner's rule, "الرسائل التي لا يتم
قراءتها يجب أن تظل Unread حتى يمكن رؤيتها عند فتح الـmail":

| Outcome | The message |
| --- | --- |
| `created` | marked read, tagged with **that branch's** colour category |
| `duplicateMessage` | marked read, not re-tagged (a retry after a half-failure) |
| `unmatched` | **left unread**, reason logged — a human opening the mailbox still sees it |
| ingestion threw | left unread — nothing took responsibility for it, so the next poll retries |

A machine code active in two branches is `unmatched` too: the legacy could not be ambiguous (one
master per branch), so there is no legacy answer to copy, and refusing to guess is the only move
that cannot misfile a ticket.

**Branch colours** are the `atm.mail.branchCategories` setting (branchId → category name) — the
legacy's single hard-coded "Green Category" (`index.js:224`) made per branch, because one reader now
serves them all. Unset means nothing is tagged; the message is still marked read, since the ticket
is the record and the tag a convenience.

**Two legacy holes closed, both recorded rather than assumed:**

- **The watermark is gone.** The legacy filtered on `isRead eq false AND receivedDateTime ge
  lastCheckedTime`, with `lastCheckedTime` held in memory and reset to "now" at every process start
  (`index.js:29, 209`). Every unread mail older than the last restart became invisible forever —
  including the ones it had just decided to leave unread. Unread IS the backlog now, and the
  `providerMessageId` idempotency key makes re-reading a message harmless.
- **`receivedAt` is the true receipt time.** The legacy captured `receivedDateTime` and then
  overwrote it with "now" (`index.js:134` vs `:137`), which is why its log page timestamps were
  ingest times. This is the one legacy bug the transport deliberately does not reproduce.

### 6a. The mailbox on a screen, branch by branch (2026-10-28)

The owner: «عايز نبدأ فى موضوع الـ Automation بتاع الميلات اللى بيجي من بنك مصر لماكينات الصيانة —
هنبدأ بفرع المهندسين حالياً وبعدين هنبقى نزود فرع فرع». His answers in the same conversation: ONE
shared mailbox for every branch (the machine still decides the branch); branches switched on one at
a time, mail for a branch not on yet staying UNREAD in the mailbox; and the mailbox credentials
typed on a screen, the secret stored encrypted — never in code.

**`/atm/settings` «إعدادات الصراف الآلي»**, behind one new key, `atmSettings.manage`, which both
services require at ORGANIZATION scope (the `atmBank.*` rule): one mailbox serves every branch, and
which branch works as which (below) is one fact about the company. The boot seed gives it to
super-admin; any other holder is an administrator's grant.

**The mailbox document** (`atm_mailbox_config`, one row, `mail-tickets/mailbox-config.model.ts`):
tenant, client id, the client secret as a SEALED platform `SecretRef` bound to the row
(`atm_mailbox_config:<id>:clientSecret`), the mailbox address, «تفعيل القراءة», the switched-on
branches with their Outlook category, and the last run. `GET/PUT /atm/mailbox` read and save it —
the secret only ever travels toward the server: an omitted one keeps the stored ref, the answer says
`hasSecret`, the audit (`atm.mailboxConfig`) says that it changed and never what it is. Switching
reading on with no secret anywhere is a 400. `POST /atm/mailbox/test` acquires a token and lists one
unread message with the stored settings; `POST /atm/mailbox/poll` («قراءة الآن») runs the reader
once and answers its report — refused while reading is off.

**Which mailbox a run reads** (`mail-tickets/mailbox-source.ts`, asked per run, so a save takes
effect on the next minute):

| State | The reader |
| --- | --- |
| no document | the `ATM_MAIL_GRAPH_*` environment exactly as before: every branch, `atm.mail.branchCategories` |
| a disabled document | reads nothing — the environment included |
| an enabled document | the mailbox it names, newest first (below); a mail is filed only when its machine's branch is switched on, otherwise it is `unmatched` · "branch not enabled for mail" and LEFT UNREAD, and is filed once its branch is switched on |

The machine still decides the branch; the document only says whether that branch takes mail yet.
A filed mail is tagged with its row's category, else the old setting's, else nothing. The source is
built once per document version, so Graph's token outlives a run. Every run on the document is
written to its `lastPoll` (start time, counts, the run's error, the first five unmatched reasons) —
best effort, and outside the versioned write, so a poll a minute never makes the screen's next save
stale; a run never creates the document. A run that fails as a whole is its `error`, and still a
failed `atm.mailPoll` run. The nightly `atm.rotateRegisterCombinationKeys` also re-wraps the mailbox
secret onto the active key, so a key rotation does not strand it
([platform-crypto](../02-architecture/platform-crypto.md)).

**The document is read NEWEST first, with a sweep below** (`mail-poll.service.ts`
`readNewestFirst`, Graph's `listUnreadPage`). The shared mailbox fills with mail left unread on
purpose — every branch not switched on yet — and the environment's batch, the 50 OLDEST unread,
would stop reaching anything new once fifty of those sat ahead of it. So each run takes the newest
page of 50 first: a new mail is filed on the next run however large the pile grows. When that page
is full, the run also takes ONE older page, the next step of a sweep that walks the rest of the
unread mail a page per run and starts over at its end (and after every save) — so a backlog deeper
than a page, a branch switched on after weeks or a machine added to the master later, is still
filed, and no run lists more than two pages. Graph is asked in the shape it accepts for a sorted
filter (`receivedDateTime ge 1900-01-01 and isRead eq false`, `$orderby=receivedDateTime desc`),
and «اختبار الاتصال» lists with that same query. The environment mode keeps its own listing and
batch, unchanged.

### 6b. Branches that work together — ATM only (2026-10-28)

The owner: «فرع أكتوبر شغال هو والمهندسين مع بعض بكل بياناتهم والبيانات دي متسجله إنها المهندسين —
يعني أكتوبر هيشوف شغل المهندسين ويشتغل معاهم عادى والمهندسين شايف أكتوبر إنه شغال معاه بردو».

The setting `atm.branchLinks` (`[{ branchId, actsAsBranchId }]`, organization scope,
`GET/PUT /atm/branch-links`, written through the platform settings service so it is audited and its
cache dropped) says «October acts as Mohandessin». On every ATM request a caller placed in October is read as placed in Mohandessin —
the placement, the top bar's branch and every branch the grants reach, per key and through
department copies — so they read Mohandessin's ATM rows, what they write is filed under
Mohandessin, and Mohandessin's people see it because it is theirs. The rewrite runs in the platform
auth middleware through a generic seam, `registerAuthContextRefiner(prefix, refine)`
(`platform/auth/context-refiners.ts`), which ATM registers for `/atm` only
(`branch-links/link-context.ts`): on every other route the same employee is still in October. A
link to itself, a source on two rows, a chain (the target is itself a source) and a branch that does
not exist or is not active are each a 400.

**What the link does not move (2026-10-28).** The owner's report: machine 27720226 shows on
`/atm/machines` only under «كل الشركة» and vanishes under «المهندسين»; its replenishment and
maintenance fail in Mohandessin; its mail shows only under «كل الشركة»; and `/atm/register` calls it
Mohandessin's while its branch filter brings the machines under October — «أنا عايز كل ماكينه تظهر
فى الفرع بتاعها طبقاً للفرع المتسجله فيه», «غالباً عشان أسم الفروع متسمي كدا EGYCASH-1 — أنا عايزك
تعتمد التسمية اللى بالعربي والإنجليزي», «الفروع فوق خالص فى البار بتاع السيستم غير اللى فى
الفلاتر». The refiner moves the CALLER, never a row: what was filed under October before the link —
the workbook rows of the code mapped to October, the machines their import coupled there, and the
mail of those machines — stayed October's, readable only under «كل الشركة». Three things close it:

1. **An id the caller does not carry is read through the links too** — one lookup, a source is its
   target (`linkedBranchOf`, `shared/atm-context.ts`): a branch a request names (a register receipt,
   the register list's filter and `branch-options`, a label's `branchId`); the register's code
   mapping, so a code mapped to October files, shows and counts its rows under Mohandessin, and the
   import compares column A as BRANCHES, never as codes, so a remap or a move does not turn every
   imported row into `changedSinceImport`; a mail's machine — the switch-on is judged and the ticket
   filed on the target, and the mailbox save keeps a source's row as the target's, or drops it beside
   the target's own row; and the legacy importer, which refuses a linked source as `--branch` and
   names the target to import into. The stored `atm.register.branchCodes` stays RAW: the card saves
   what it reads, and a link-aware schema would read today's value as `[]`. The register names a
   branch by its ECMS name, as the top bar does — the codes stay on its settings card and the import
   preview — and its branch filter offers only what the top bar's choice lets the reader see
   (register doc DEC-42).
2. **An organization-wide writer files where the top bar points** (GM-20 for ATM,
   `shared/atm-context.ts`). `currentBranchId` puts the home placement first and an organization
   grant adds nothing to the reach list, so such a user placed in Alexandria filed every machine
   add, delete and area move, every label, replenishment and maintenance under Alexandria whatever
   the top bar said — and silently under «كل الشركة». When the write's own key is held company-wide
   (the label writes: `manage`, else the label key held) and the caller's grants name no branch
   (an organization grant adds none to the reach list), the top bar's branch, already refined by
   the link, is the branch; on «كل الشركة» it is the company's only active branch, or the write is
   refused «اختر فرعًا محددًا من القائمة العلوية أولًا.». The data-edit dialogs say «الفرع: …»
   before the add, and wait for a branch when there is none. Every other caller keeps the old rule —
   one whose grants list branches included: the platform drops a top-bar branch outside that reach,
   so the top bar inside it decides, else the home branch (deciding on the key alone would ask such
   a caller for a branch while the top bar shows one).
3. **«نقل البيانات»: what is already filed under the source moves, once**
   (`GET`/`POST /atm/branch-links/:sourceBranchId/move`, `atmSettings.manage` at organization
   scope; the pair is always the STORED link's, and a branch that is no stored source is 404). The
   links card offers «نقل البيانات إلى …» on each link, opens it by itself when a link just saved has
   rows under its source, and names every source still holding rows in a banner. The dialog
   previews the rows per collection, what merges and what refuses the move; the move re-files 17
   collections in transactions of at most 200 rows. A label of a name both branches hold merges into
   the target's row (filling only what it left empty); a machine twin that would meet the survivor
   in the target is retired the legacy way (`<code>-D`, deleted, with its own `delete` audit row),
   its cassette layout (every version) and map point going to the survivor where it has none;
   a zone or dispatch-line name the target uses gets the source's name as a suffix; the target's
   default standard load stays the default; a Full list run stalled for 30 minutes is closed first;
   and `atm.mail.branchCategories`, `atm.register.branchCodes` and the mailbox list are re-pointed
   where the target has none of its own. Refused 409 `ATM_BRANCH_MOVE_BLOCKED`, with each named,
   while a machine is active in both branches and the register does not say which stays, a twin to
   retire still holds open work (an open register entry, replenishment or maintenance, or a draft
   or issued plan line), Note serials or a plan of one bank and day collide, the target
   would pass the map's caps, a Full list import is running, or another move runs; a blocker that
   appears part-way stops the run at that step (409 `ATM_BRANCH_MOVE_STOPPED`) and what moved stays
   moved. Every step reads what is STILL under the source, so running it again carries on, and a run
   cut off by a restart is taken over after 30 minutes and audited then. ONE `atmBranchMove` audit
   row per run (not broadcast). The link stays: October's people keep working as Mohandessin.
   The POST names the target the reader confirmed (`expectedTargetBranchId`, from the preview) —
   a precondition only: a link re-pointed since is refused 409 `ATM_BRANCH_MOVE_TARGET_CHANGED`
   and nothing moves. While a run holds the lock, the writes the move plans from wait for it, 409
   `ATM_BRANCH_MOVE_RUNNING` (`branch-links/move-fence.ts`): machine adds, edits, area moves and
   deletes; register create, edit, receive, link, handover and delete; the register import; label
   saves; replenishment and maintenance opens and mail accepts (open work the twin plan reads).
   Otherwise a coupling between the machines step and the register step would write a new
   master under the source, and a key the target gained after a plan would meet the batch. Each
   twin is read again inside its retire's transaction — reactivated or given open work since the
   plan, the run stops on it (`machineTwinOpen`, STOPPED when an earlier batch already retired some,
   each of those counted on the run). An area name deleted or renamed away in one linked
   branch is never written back as a live label by the other, neither after a write nor by the boot
   repair (`catalogs/area-labels.ts`): the move takes the source's memory rows first.

### 6c. Go-live: Mohandessin first

1. Grant `atmSettings.manage` at organization scope to whoever runs the screen (super-admin holds
   it already).
2. On `/atm/settings`, «بريد الصيانة — بنك مصر»: enter the Tenant ID, the Client ID, the Client
   Secret and the mailbox address, leave «تفعيل القراءة» off, and save.
3. «اختبار الاتصال» — it must answer ok; a refusal names the provider's answer.
4. Add Mohandessin to the switched-on branches, with its Outlook category.
5. «فروع تعمل معاً»: link October → acts as Mohandessin.
6. «نقل البيانات إلى المهندسين» on that link (it opens by itself when October holds rows): read the
   preview, resolve what it lists in red, then «نقل». October's earlier machines, register rows and
   mail then show under «المهندسين» (§6b).
7. Switch «تفعيل القراءة» on and save; «قراءة الآن», then check the last-run line and
   `/atm/mail-tickets`.
8. Once the document is saved the `ATM_MAIL_GRAPH_*` environment is no longer read: remove it from
   the deployment, so the secret lives in one place, sealed.

Every later branch is step 4 alone: its row is added, and its unread backlog is filed — its newest
page on the next run, anything older as the sweep reaches it, a page a minute.

### 6d. The two mail pages: filters, row buttons — and «إسترجاع» (2026-10-28)

The owner: «هنا /atm/mail-tickets/log وهنا /atm/mail-tickets عايز فلتر وعايز Action Buttons — في
/atm/mail-tickets يكون 2 قبول ورفض — في /atm/mail-tickets/log إسترجاع ويقدر يرجعه مفتوح لو قبل أو
رفض غلط». A decision was final in the legacy (and here until now); this is the way back.

**`POST /atm/mail-tickets/restore`** (`{ ids }`, 1–200 — `RestoreAtmMailTicketsSchema`) puts decided
tickets back to PENDING, to be decided again on the pending screen: `status: 'pending'`, the
decider and `actionAt` cleared by a versioned write. It rides `atmMailTicket.decide` — undoing a
decision is deciding; the log page itself stays behind `viewLog` — and reads the tickets in that
grant's scope (`mail-ticket.service.ts` `restore`, the rule pure in `planMailRestore`):

| The ticket | The restore |
| --- | --- |
| rejected | back to pending — a rejection opened nothing |
| accepted, the maintenance it opened still open | that maintenance is soft-deleted — gone from `/atm/maintenance` — and the ticket returns, in ONE transaction (`maintenance.service.removeFromMail`, the undo of `openFromMail`), so neither half lands alone |
| accepted, that maintenance already deleted on the board | back to pending |
| accepted, that maintenance CLOSED | **refused**, nothing written — a closed maintenance is work done, on the done page and in the daily report, and erasing it to reopen a mail would erase that record |
| accepted, and NO maintenance — live or deleted — carries it | **refused**, nothing written (`noLinkedMaintenance`) — every accept here links the maintenance it opens (`mailTicketId`), so this is a legacy accept: the importer links none (`legacy-transform.ts`). Returning it would leave its maintenance on the board while the confirm says it goes, and a second accept could open another one for the same mail |
| already pending, or outside the caller's scope | skipped silently, as accept and reject skip a decided ticket; so is one a concurrent restore returned first (a double click) — never a 409 |

The answer mirrors accept's: `data` is the tickets restored, and the refused ones ride in
`meta.refused: [{ ticketId, machineCode, reason }]`, `reason` being `maintenanceClosed` or
`noLinkedMaintenance` — the log shows one red message per reason, naming the machines. The maintenance is read
INSIDE the transaction, so a close that lands while a restore runs makes its delete a write
conflict, and the retry reads the row closed and refuses: a closed maintenance is never deleted.
Accepting a restored ticket again opens a FRESH maintenance on the ticket's day (D6) — the removed
one is deleted, and OD-1 counts live rows only. The trail: the ticket gets a `restore` row — the
status and, when the restore took a maintenance back, the `maintenanceId` it removed (accept's
change reversed; the accept or reject row already there keeps who decided and when) — and that
maintenance gets the board's own `delete` row, by the caller, both after commit. A maintenance
already deleted on the board is not named again: the `delete` row its deleter wrote is its record.
The maintenance `delete` refreshes open boards as any delete does; `restore`, like `accept` and
`reject`, is not a broadcast action, so the page that restores refreshes the mail lists and the
board itself — on failure too, as a decision does. A ticket the legacy import wrote raw (no `__v`,
`createdAt` or `updatedAt` — no backfill covers the mail collection) is read as the master rows are
(DEC-23): version 0, made at the instant inside its own id, so the whole-list reads of both pages
never fail on one.

**The pages.**

- `/atm/mail-tickets`: «قبول» and «رفض» on every row, always shown and pinned to the row's end, for
  `atmMailTicket.decide`. On a checked row they act on every checked row, on an unchecked row on
  that row alone — the boards' rule (#613) — and the accept and reject bar is gone. The confirms,
  the duplicate warning in the accept confirm, the refusal notice and the yellow duplicate rows
  stay.
- `/atm/mail-tickets/log`: «استرجاع» on accepted and rejected rows, always shown and pinned, for
  `atmMailTicket.decide`, behind a confirm that says what happens — accepted: the mail returns to
  pending and the maintenance opened from it leaves `/atm/maintenance` if it is still open;
  rejected: the mail returns to pending. A refusal names the machine code and says why: the
  maintenance is already closed, or the mail was accepted in the old system and no maintenance is
  linked to it.
- Both: a filter row — bank, area, a search by machine code or name, and the red reset — kept in
  the address and remembered. The log adds a status choice (الكل / معلقة / مقبولة / مرفوضة, the row
  badges' own words) beside its date range, and that range reads as the done pages' does: a cleared
  date takes the other, a reversed range is put in order. The dropdowns' options come from the rows
  read; the area list follows the banks chosen, and a bank change drops the areas the new banks do
  not hold, as on the boards. The rows are read WHOLE, page by page (the pending list was one page
  of a hundred), and filtered in the browser; a log range too long to read whole says so, as the
  done pages do. Accept and reject go in batches of 200, as the boards' checked rows do. Only the
  table scrolls.

## 7. Migration (ATM-7 — delivered)

    npm run atm:import -w apps/api -- --legacy-uri=mongodb://host:27017/egycash \
      --branch=<objectId> [--rep-time=cairo|utc] [--maint-time=cairo|utc] [--dry-run]

**One legacy deployment → one ECMS branch, per run** — a branch WAS a deployment, so the branch is
a flag rather than something the data could carry. Order: `atm` → `atm_machines`;
`atm_data_lists.bank[]/area[]` → `atm_ref_labels`; `atm_rep_log`/`atm_maint_log` → the two
operation collections; `atm_mails` → tickets.

Properties worth knowing before running it:

- **Idempotent.** Legacy `_id`s are preserved and rows upsert by id, so a re-run replaces rather
  than duplicates, and a row spot-checked in the legacy database is findable here by the same id.
  Labels had no id (they were array entries) and are keyed by (branch, kind, name) instead.
- **T1 normalization is a FLAG, not a detection.** `--rep-time` defaults to `cairo` (repairing the
  legacy's local-parts-stamped-`+00:00` open times) and `--maint-time` to `utc` (that path moved to
  moment-tz). Close times are never repaired — both paths always wrote true instants. The two modes
  are indistinguishable in the data, so **sample known rows with `--dry-run` first**: getting it
  wrong shifts a deployment's history by two or three hours.
- **Unresolvable rows are reported, never invented.** An operation whose `mach_id` matches no
  machine is skipped and counted (a deleted machine still claims its history through its base code,
  the `-D` suffix stripped); a row with no `open_time` is skipped and counted. A MAIL ticket with no
  resolvable machine is still imported with a null machine — the log is a record of decisions
  people made, and dropping it would erase one.
- **Two fields stay null by design**: `actionAt` (the legacy never recorded when a mail was decided
  — GAP G1; stamping the import time would be a false fact) and `providerMessageId` (these rows
  predate the key; NULL is exempt from its partial unique index).
- **Open duplicates are reported, not imported** (OD-1). The importer is exempt from the
  one-open-operation rule's service check — it decides nothing about history — but the partial
  unique index admits one OPEN row per machine code and kind. A legacy row it refuses is counted in
  `openDuplicate` and named (first 100) in `openDuplicateIds` by its preserved `_id`; every other
  row still lands (the bulk write is unordered). A dry run PREDICTS the count within the deployment.
  Close the stale row in the legacy database and re-run — the import is idempotent. **Only while
  the index exists:** if the boot skipped it (the database already holds two open rows for one
  code — likely after an earlier import, since nothing guarded it before OD-1), nothing can refuse.
  The report then carries `openIndexMissing: true` (dry run and real run alike), `openDuplicate` /
  `openDuplicateIds` name the deployment's open duplicates that were WRITTEN anyway, and a warning
  names the collection, the index and the count. Resolve the stored duplicates so the next boot
  builds the index, then import — or proceed knowingly; the live paths refuse every new duplicate
  either way.
- **Maintenance provenance imports as `manual` without exception.** The legacy accept path kept no
  link back to the ticket (contad_app.js:2806-2823), so `source: 'mail'` genuinely cannot be
  recovered — only rows created in ECMS carry it.

`ops_emp`/`ops_emp2`/`leader` stay name snapshots; matching them to employee ids is best-effort
enrichment for a later pass, never a requirement of the import.

## 8. Delivery record

**What the integration suite caught on its first real run.** Worth recording, because it is the
argument for the suite existing at all:

- **No ATM document could be inserted.** All three operation models declared
  `zone: { type: String, required: true, default: '' }`. Mongoose's String required-validator is
  `typeof v === 'string' && v.length`, so an EMPTY string fails `required` — and every write path
  stores exactly `''` (the legacy wrote `''` everywhere, contad_app.js:2443, which is the only
  reason the field exists). The first insert threw `ValidationError`, which is not an `AppError`
  and surfaced as a 500. 1528 unit tests passed straight through it, because a unit test never
  constructs a Mongoose document. `required` was never meaningful here and is gone.
- **`senderEmail` had the same flaw**, on the mail path: the Graph transport yields `''` when a
  message carries no sender, and the poll calls `ingest()` with the raw transport object, so that
  message would 500 and be retried every minute forever.
- **The seeded catalog crossed `MAX_PAGE_SIZE`.** The ten ATM rows took it to 101, so
  `auth-seed-login.spec.ts`'s `pageSize=100` reads silently dropped the OLDEST row — `/applicants`,
  the row its reorder test moves.


| Slice | Content | State |
| --- | --- | --- |
| ATM-0 | Contracts vocabulary, manifest, permissions, pages, settings, this document | delivered |
| ATM-1 | Machines + ref labels + `/atm/machines` + `/atm/data-edit` | delivered |
| ATM-2/3 | Replenishments open/close/edit/cascade/delete/reopen + done page | delivered |
| ATM-4 | Maintenance (+ close-with-assignee via directory) + done page | delivered |
| ATM-5 | Mail tickets: pending + accept/reject + log + unread badge + ingestion seam | delivered |
| ATM-6 | Central mail reader: source seam, Graph transport, poll task, branch colours, §6 | delivered |
| — | `/atm/settings`: the mailbox on a screen, branches switched on one at a time, branches that work together (§6a–§6c); suites `tests/integration/atm-mailbox.spec.ts`, `atm-branch-links.spec.ts` | delivered |
| — | The two mail pages' filters and row buttons, and the log's «إسترجاع» (`POST /atm/mail-tickets/restore`, §6d); suite `tests/integration/atm-mail-restore.spec.ts` | delivered |
| ATM-7 | Legacy importer (`npm run atm:import`) with the T1 repair, §7 | delivered |
| — | Daily report `/atm/reports/daily` (legacy `/reports_atm`, D3/D7) | delivered |
| — | Integration suite `tests/integration/atm.spec.ts` (endpoints, authZ, validation) | delivered |
| — | OD-1: one open replenishment and one open maintenance per machine, company-wide (§4a); suite `tests/integration/atm-no-double-open.spec.ts` | delivered |
| — | OD-1a: the rule per Cairo day, the edits guarded, the any-day index dropped (§4a); the boards one day at a time, sort, reset, copy columns, F8, the «الوردية» box, Excel/PDF on the four tables (§10) | delivered |
| — | D8: bank/area filters — area without a bank, bank-change cascade, whole-board read, comma and spacing in names (§3); suite `tests/integration/atm-board-filters.spec.ts` | delivered |
| — | Efficiency register, Data Report and the data-edit split — [atm-efficiency-register.md](atm-efficiency-register.md), §9 below | in progress (ships as one release) |
| — | The bank catalog, bilingual areas and data-edit adds recorded in the register — register spec §1.3 (DEC-35–DEC-41), §9 below; suites `tests/integration/atm-banks.spec.ts`, `atm-area-labels.spec.ts`, `atm-data-edit-register.spec.ts` | in progress (ships as one release) |
| — | Machine map and owner-drawn zones: `/atm/map`, `/atm/map/unlocated`, the location sync and the short-link resolver — [atm-map-zones.md](atm-map-zones.md) (no legacy counterpart: GAP, §1) | in progress (ships as one release) |
| — | Settlements & Review → Preparation → Control & Supplies, phase 1 (Al Baraka only): `/atm/settlements/plans`, `/atm/settlements/layouts` (+ `/import`), `/atm/preparation`, `/atm/control`; the machine's cassette layout, the day's plan and its papers, the bag and seal capture, the crew lines — [atm-settlements-phase1.md](atm-settlements-phase1.md); suite `tests/integration/atm-settlements.spec.ts` | in progress (ships as one release) |

## 9. The Efficiency register and the data-edit split

The owner's Efficiency & Investigations workbook became the machine register
([atm-efficiency-register.md](atm-efficiency-register.md)): one custody period per row, from the
bank's handover to ECMS until ECMS hands the machine back. From then on the register — not
`/atm/data-edit` — decides which Operations machines exist (owner decision D2): a receipt creates,
reactivates or links the `atm_machines` row, a handover archives it.

`/atm/data-edit` therefore stays the OPERATIONS page with the machine-existence actions taken out of
Operations' hands — gated, never deleted:

| Action | Route | Key after the split |
|---|---|---|
| Add / bulk add a machine, delete by codes, reassign by code, edit or archive a machine | `POST /atm/machines`, `/bulk`, `/bulk-delete`, `/reassign-area`, `PATCH /:id` | `atmMachine.manage` (unchanged). Since 2026-10-28 an add, and a delete by codes, need it to reach the acting branch (DEC-39); the delete also removes the add's untouched register stub (DEC-36) |
| Move ONE machine to another area (legacy «نقل ماكينة لمنطقة», contad_app.js:2529-2541) | `PATCH /atm/machines/:id/area` (new, DEC-3) | `atmMachine.moveArea` or `manage` |
| Add a bank spelling or an area label | `POST /atm/ref-labels/:kind` | `atmRefLabel.create` or `manage`. Since 2026-10-28, for an AREA also `atmRegister.create` or `atmRegister.edit` — the register form's «+ منطقة» (DEC-39) |
| Rename or archive-toggle a label; set an area's Arabic and English names; link a spelling to a bank | `PATCH /atm/ref-labels/:kind/:id` | `atmRefLabel.edit` or `manage` |
| Delete a label | `DELETE /atm/ref-labels/:kind/:id` | `atmMachine.manage` (unchanged) |
| Read what the dialogs offer in one branch (new, 2026-10-28) | `GET /atm/ref-labels/options?branchId=` | any of `atmMachine.view`, `manage`, `moveArea`, `atmRefLabel.create`, `atmRefLabel.edit` reaching the branch |
| Add, edit or archive a bank of the company-wide catalog (new, 2026-10-28) | `POST /atm/banks`, `PATCH /atm/banks/:code`; read `GET /atm/banks` | `atmBank.create` / `atmBank.edit` at organization scope only (Efficiency and the administrators); any ATM key reads |

- **Every AREA write moves the machine's open register entries with it** — `moveArea`, `PATCH /:id`
  and `reassign-area`, in the same transaction (DEC-4). A name or bank edit by an administrator does
  not flow back into the register.
- **The key must reach the branch it touches** (DEC-29): `moveArea` and label edit need the key over
  the machine's or label's whole branch (or the label/machine inside today's `manage` scope); a label
  create needs `atmRefLabel.create` or `manage` over the branch it is filed in, so a top-bar choice
  that only an unrelated key reaches is refused (review finding F-4) — a `manage` holder whose scope
  reaches no whole branch (department, section, own) still adds labels in the branch they are placed
  in, as before.
- **Navigation:** the Machine Data row's key moves from `atmMachine.manage` to `atmRefLabel.create`
  through `previousPermission` (`seed-navigation.ts`, the `previousIcon` mechanism) — corrected only
  while the stored row still holds the old key. The web route guard accepts any of
  `atmRefLabel.create`, `atmRefLabel.edit`, `atmMachine.moveArea`, `atmMachine.manage`.
- **No role or delegated grant is widened at boot** (lead override O-1). Granting the Operations
  keys to existing roles, and removing `manage` from them, is an administrator's step (register spec
  §12.2); until then a manage-only holder still opens the page by URL through the route guard, but
  the sidebar row now needs `atmRefLabel.create`.

**Since 2026-10-28** (register spec revision 4, DEC-35–DEC-41). The owner: «وبالنسبة لإضافة الماكينات
/atm/data-edit البنوك والمناطق مش مسمعه !! من /atm/register · مع العلم عايز لما يتضاف حاجة هنا
/atm/data-edit تتضاف هنا /atm/register بحيث شغل العمليات ميعطلش ويبقى بتاع الكفاءة والتحقيقات يكمل
بياناتها براحته وبرضو يقدروا يضيفوا مناطق وبنوك (عربي وأنجليزي)».

- **Four tabs, each one table.**
  - «الماكينات».
  - «البنوك»: the company-wide catalog. Any ATM key reads it; only `atmBank.*` at organization
    scope adds or edits.
  - «أسماء البنوك في التشغيل»: the branch's spellings of catalog banks (`NBE FOREX` → NBE). A callout
    lists the bank texts on the branch's machines that map to no bank, each with «ربط ببنك».
  - «المناطق»: each area with its Arabic and English names, the name stored on machines, and where
    it came from. A new area's stored name is the English one — the owner: «الإنجليزي تمام».
  - Every area on an active machine, or on an open or pending register entry, is listed
    automatically: written after each save, plus a boot backfill. A name Operations deleted,
    archived or renamed is never brought back.
- **An add lands in the register.**
  - A machine added here, single or bulk, is recorded as an OPEN register entry dated the add day,
    linked to the machine and flagged «بيانات ناقصة» for Efficiency to complete.
  - A pending entry of that code is received instead, and an open one in this branch is linked.
  - Nothing is recorded, but the machine still works, when the branch has no `EGYCASH-n` code, the
    code is a placeholder, or the bank text maps to no bank.
  - The add is refused (409, nothing written) when the code is active, or has an open register
    period, in another branch. An archived catalog bank is refused too (400).
  - An archived code in this branch is brought back with the form's data.
  - The dialog says each outcome in words.
- **The dialogs read one endpoint,** `GET /atm/ref-labels/options?branchId=`. It returns:
  - the active catalog banks and the branch's mapped spellings, grouped by bank;
  - the branch's areas, whole (the two old 100-row lists cut long lists short and mixed branches);
  - whether the branch is mapped, and the unmapped bank texts.

  Any key of the page that reaches the branch can read it.

## 10. The boards, one day at a time — and the four tables as files (2026-10-27)

The owner's requests of 2026-10-27 for `/atm/replenishments` and `/atm/maintenance` (and, for the
files, their done pages), each with what was asked and what settled the open points (the owner's
answers in the same conversation):

- **One day at a time.** «هنا يظهر فقط الماكينات اللى المفروض يتغذى أو يتعمله صيانه في اليوم دا مش
  عموماً · وتعمل زرار Toggle يظهر اللى … اليوم اللى بعده أو متجدول في المستقبل عموماً». The boards
  open on TODAY's rows (the Cairo day of the open time — a force date opens at 06:00 of its day, a
  maintenance at its datetime) with the live timer. A switch above the table shows «غدًا»,
  «كل المجدول» (every day after today, tomorrow included) and «أيام سابقة لم تُغلق» (the owner's
  answer for rows left open on an earlier day), each with its count. `?day=` carries the view;
  it is not remembered across visits — the board opens on today, as asked. The board is still
  read whole (D8); the view only picks the rows (`apps/web/src/modules/atm/lib/board-day.ts`).
- **Copy columns.** «مش عايز كل الأعمدة تبقي Selectable عايز بس البنك والكود واسم الماكينة وتوقيت
  التغذية». The table is `select-none`; bank, code, name and the schedule time — on maintenance the
  open time, its "when" (the owner's answer) — are `select-text`. Chromium then copies a drag across
  rows as exactly those cells, a tab between columns and a line per row; Ctrl+A outside a field
  selects the table's rows the same way (`lib/board-copy.ts`).
- **«Select all» on F8.** «شيل الـ Select all من فوق الجدول … خليها تظهر فقط عند الضغط على F8 …
  بس تختفى لو مدوستش عليها ودوست على اى حاجة تانية». The head's box is drawn only after F8 and goes
  again at the next key or press anywhere but on it — F8 also gives it the focus, and Space or Enter
  on it is using it, so it works without a mouse; the row boxes stay, and checking rows or the
  revealed box shows the bulk bar exactly as before (the owner's answer: «F8 يظهر تحديد الكل بس»).
  The shared `DataTable` gained `selectAll` (default on) for it (`lib/select-all-reveal.ts`).
- **Sort and reset.** Every text column sorts in the browser — the board is whole — through the
  shared `table-sort` (`?sort=`, remembered) and `sort-rows` (moved from Fleet to `shared/lib`, as
  `table-sort` was); the server's order (area) breaks ties. One red reset, the ATM machine list's,
  clears the bank and area filters; the day view is not a filter and stays, the Fleet day boards'
  rule. Excel and PDF are offered once the rows on screen are the answer — never while the board
  loads, fails or settles a bank change.
- **The «الوردية» box.** «يكون في Check Box بجانب عنوان المجال اسمة مثلاً شيفت. الطبيعي بتاعه انه
  يبقي متعلم ودا اللى هينفذ الحالي … بس لو شيلت من عليه الـ Check يغير القائد للى معمول عليهم Select
  فقط». Beside the leader label in both edit dialogs, ticked on open. `cascadeLeader` on the edit
  requests: the single edit defaults to true (the legacy cascade, unchanged — on replenishment still
  not when the open time moves in the same submit), the bulk edit to false (the legacy asymmetry).
  Ticked on a checked set it now ALSO carries the leader over each checked row's area and shift (the
  owner's answer), one cascade per distinct group; unticked, the leader is written on the rows in
  the dialog only.
- **Excel and PDF on the four tables.** «عايز إنه يقدر يخرج الجدول في شكل Excel و PDF مكتوب فوقه عنوان
  بيان "تغذية/صيانة" ماكينات الصراف الآلي "عن يوم/عن الفترة من إلي"». The table as it stands — the
  day view, the filters and the reader's order applied — under «بيان تغذية/صيانة ماكينات الصراف الآلي
  عن يوم …» or «… عن الفترة من … إلى …» (the board's day or the days its rows span; on a done page
  the closed range). The workbook is the app's own writer (`fleet-xlsx`, which gained an optional
  title row), the PDF the company's report form under «إدارة الصراف الآلي» with the filters in force
  printed under the title; the buttons are the IT registers'. The done pages now read their range
  WHOLE, as the boards do: they asked for one page of a hundred and had no pager.

