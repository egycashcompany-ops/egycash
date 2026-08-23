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
| `filters` per-user collection | URL parameters (client persistence) | Same visible behaviour, no server preference store |
| `users` / `user_status` | platform auth/RBAC | Single-session enforcement is a platform policy, not module behaviour (T4) |
| `employees` (dept "الصراف الالى") | `platform/directory` + `atm.maintenanceLeaderDepartmentIds` setting | The hardcoded department NAME became configuration |
| Legacy pages | `/atm/replenishments(±/done)`, `/atm/maintenance(±/done)`, `/atm/mail-tickets(±/log)`, `/atm/machines`, `/atm/data-edit` | `apps/web/src/modules/atm/routes.tsx` |
| Privileges (`atm-user`, `atm-user-review`, `atm-admin`, `Efficiency-admin`) | `atmReplenishment.*`, `atmMaintenance.*`, `atmMailTicket.view/decide/viewLog`, `atmMachine.view/manage` | Roles carry the legacy bundles; the review role = view+complete on done surfaces (contad_app.js:1056 vs :2096); the mail log is admin-narrow (:2901) |

## 3. Decisions taken under the owner's delegation

- **D1 — ATM-owned bank/area lists**, not the operations bank catalog. `data_edit_atm` ADDS and
  REMOVES bank names (contad_app.js:2477-2524) — a write no module may perform on another
  module's collection — and the legacy itself kept `atm_data_lists` beside `data_lists` as a
  separate list with a separate administrator. Machines store the label string, as legacy did.
- **D2 — `/data_edit_atm` in scope** (owner's follow-up message): delivered whole — bulk add with
  skip-and-name, delete with the `-D` rename, area reassignment, both label lists.
- **D3 — `/reports_atm` DELIVERED** (revised): originally deferred as outside the owner's page
  list, then built under the owner's standing delegation. It rides the existing view grants and
  declares no permission and no page (the operations B5-report precedent).
- **D7 — the report's day is a parameter.** The legacy screen could only ever show today
  (contad_app.js:2244-2249), which made "what did yesterday look like" unanswerable. A date on a
  read-only aggregate changes no behaviour and stores nothing; the default is still today.
- **D4 — no `openedAt >= today` floor on the open lists.** The legacy floor (contad_app.js:263)
  made an open row with a past open date invisible on every screen forever — un-closable. Open is
  open; the client still renders non-today rows as the grey carried-over group with no close
  control and no timer, which is the visible legacy behaviour (atm_replenishment.ejs:1086).
- **D5 — mail `duplication` computed at read, not written back during GET.** The legacy GET
  recomputed AND wrote it per render (contad_app.js:2674-2698); the screen shows the same live
  answer either way. The ingest-time value stays on the row for parity.
- **D6 — accepted mail opens maintenance at the ticket's stored `receivedAt`.** The legacy took
  it from the rendered cell text re-parsed client-side (mail_maintenance.ejs:903) — the same
  intent, minus a timezone round-trip through `document.write`.
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

**Preserved quirks worth naming** (because a reviewer will ask): a code pasted twice opens two
operations (no duplicate guard on open — the paste is the operator's statement); the
replenishment leader cascade fires only when open-time is NOT moved in the same submit
(contad_app.js:854-859) while maintenance's cascades unconditionally (:2019-2032); the cascade's
night window is anchored to the open time's own calendar day even before 06:00 (:815-817); a
reopen clears `closedAt` and keeps the closer's name, exactly as `end=0` did (:1032); rejection
does not stop future mails for the same machine; force-date ≠ today opens at 06:00 Cairo (:726).

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
- **Maintenance provenance imports as `manual` without exception.** The legacy accept path kept no
  link back to the ticket (contad_app.js:2806-2823), so `source: 'mail'` genuinely cannot be
  recovered — only rows created in ECMS carry it.

`ops_emp`/`ops_emp2`/`leader` stay name snapshots; matching them to employee ids is best-effort
enrichment for a later pass, never a requirement of the import.

## 8. Delivery record

| Slice | Content | State |
| --- | --- | --- |
| ATM-0 | Contracts vocabulary, manifest, permissions, pages, settings, this document | delivered |
| ATM-1 | Machines + ref labels + `/atm/machines` + `/atm/data-edit` | delivered |
| ATM-2/3 | Replenishments open/close/edit/cascade/delete/reopen + done page | delivered |
| ATM-4 | Maintenance (+ close-with-assignee via directory) + done page | delivered |
| ATM-5 | Mail tickets: pending + accept/reject + log + unread badge + ingestion seam | delivered |
| ATM-6 | Central mail reader: source seam, Graph transport, poll task, branch colours, §6 | delivered |
| ATM-7 | Legacy importer (`npm run atm:import`) with the T1 repair, §7 | delivered |
| — | Daily report `/atm/reports/daily` (legacy `/reports_atm`, D3/D7) | delivered |
| — | Integration suite `tests/integration/atm.spec.ts` (endpoints, authZ, validation) | delivered |
