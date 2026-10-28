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
  `fleet_vehicles`, it never appears in `it_assets` (§9.2).

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
| **Web kit** | shared tables/CRUD/pages kit, `UserPicker`, i18n ar/en + RTL | all pages; **every reference picker is server-side search from its first commit (ADR-019 rule 5 — binding)** |
| **Workflow engine (ADR-011)** | *accepted as ADR, not built as a platform service* | **not used.** Recruitment built its own module engine; Fleet used code-defined lifecycles in services. Tickets follow the Fleet precedent (§4.4, D4); the gap is recorded in ADR-022 (§13) |

Two hard lessons from production are carried in as design rules:
**minimize-safety** — any collection whose rows carry a `metadata`/free-object field sets
`minimize: false` (the recruitment-timeline outage, PR #117); **picker-safety** — no "load all +
client filter" anywhere in the module (ADR-019 rule 5 blocks it at review).

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
| `branchId` | data-scope anchor; changes only via **transfer** |
| `location?` | free text (room/desk) within the branch |
| `purchase?` | `{ date, cost?, vendorId?, invoiceRef? }` — recorded facts, not accounting |
| `warranty?` | `{ vendorId?, start, end, terms? }` — embedded (D9); expiry sweep reads `warranty.end` |
| `currentAssignmentId?` | denormalized head of the open assignment, `null` when in stock |
| `disposal?` | `{ at, method: sold\|scrapped\|donated\|lost\|returnedToVendor, reason, notes? }` set once |
| `notes?` | |
| `specs?` | `{ processor?, memory?, systemType?, storage?, mediaDrive?, displayAdapter?, graphicsMemory?, networkAdapters[] }` — the rows of the custody acknowledgment's specifications table (FR-18); a row left empty is left off the paper |
| `accessories[]` | «مشتملاته» — what is handed over with the device (a charger, a bag…), one entry each |

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
  return+assign on the surface — the history must show intent, not mechanics.
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
  holder); the lines and the signer are a snapshot of what was printed.
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
  before a hand-over takes the next one; the hand-over records the number of the paper that was
  signed; printing a stored receipt again keeps its number.
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
  `itAsset.viewNationalId`) and ONE line snapshot `{ lineId, assignmentId, network, phoneNumber,
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
branch keeps its own stock; `ux_branch_name` on the live rows), and an item never changes store. The
three counters are denormalized from the ledger and moved only with it (ADR-024's rule): on no write
schema, moved by one atomic `$inc` whose filter is the guard, so `onHandQty` never goes below zero
however many people take the last unit at once. `belowMin` (on hand at or below `minQty`) is derived
on the answer, never stored.

- **`it_consumable_movements`** — the append-only ledger: `{ consumableId, kind: received | issued |
  scrapped | returned, qty (always positive — the kind says which way), at, branchId, byUserId,
  employeeId?, assetId?, reason?, memoId?, notes? }`. `issued` names the employee and, when it was
  installed on one, the asset; `reason` is `new` or `replacement` («بدل تالف») on an issue and the
  written cause on a scrap. A replacement counts the damaged unit it replaces as scrap too, but takes
  only the new unit off the shelf — the broken one came back from the person and was never on hand.
  A return puts stock back and never lowers `issuedQty` (everything EVER issued). Nothing edits a
  movement; a mistake is corrected by an opposing one.
- **`it_consumable_memos`** — «مذكرة صرف مستهلكات», ONE per issue action, listing every item it
  gave: `{ memoNumber, issuedAt, employeeId, employeeCode?, employeeName?, jobTitle?, issuedByUserId,
  issuedByName?, branchId, lines[{ consumableId, movementId, code, name, typeName?, unit, qty, reason,
  assetId?, assetCode?, assetName? }], notes?, signedCopy? }` — a snapshot of what it printed, on the
  device acknowledgment's letterhead with a series of its own (§2.1), not F-14: an F-14 paper
  undertakes to give back what it lists, and a consumable is used up. No national ID on it. The
  issue writes the movements, the counters and the memo in ONE transaction, its number reserved
  inside it, so a refused issue leaves no gap and the paper never lists what the store did not give.
  `signedCopy` under Files category `it-consumable-memos`, authorizer `it/consumableMemo`.
- The workforce reset KEEPS the items and the ledger (the ledger is the stock's explanation) and
  PURGES the memos, which name a person, as it does the other papers; a movement whose memo is gone
  offers none.

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
              └──n─0..1 it_consumable_memos                 (one memo per issue, n items)
```

Cross-module references are **by id + event subscription only** — IT never imports HR or Fleet
services (the Fleet §9.1 discipline).

## 4. Workflows and lifecycles

### 4.1 Asset registration
Create → sequence allocates `AST-…` → `registered` event → status `inStock`. Edit is a plain
audited update (+ `updated`/`warrantyUpdated` events when custody-relevant fields change).

### 4.2 Labels
Select assets → server renders QR PNGs (existing `qrcode` dep) → platform PDF service lays out
the N-up A4 sheet → download/print. Printing needs only `itAsset.view` — a label shows nothing
the viewer cannot already see; a dedicated `print` grant would be a permission with no decision
behind it.

### 4.3 Custody: assign / return / transfer / dispose
Exactly §2.5. All four are named service actions (never generic PATCH), each in a transaction:
assignment row + asset denormalization + history event + platform event + audit. Guards:
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
  event, platform event, audit — partial custody writes must be impossible.
- **FR-4** An asset with an open assignment cannot be disposed; a disposed asset accepts no
  further operations (terminal).
- **FR-5** Assets are never hard-deleted once they carry any §2.3 event beyond `registered`;
  a registered-in-error asset with no history may be deleted by `itAsset.delete` (audited). Used
  means any trace: a history event, a custody interval, a maintenance order, or a consumable
  installed on it (FR-20).
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
  app is server-side search + resolve-by-id from its first commit (ADR-019 rule 5).
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
  `receiptId`). The screen prints the receipt BEFORE it records the hand-over — the print is
  composed by the server from exactly what will be recorded and writes nothing — and any change
  after printing withholds the hand-over until it is printed again. A transfer to a new holder is
  a hand-over and gets its own one-line receipt; a branch move in the same hands keeps the paper
  already signed. The receipt keeps what it printed (a snapshot) and can be printed again at any
  time; the employee's signed copy (photo or PDF) is filed against it through Files and can be
  replaced or withdrawn. An interval opened before receipts can be given one while it is open
  (§17, 2026-10-04). Every printed paper carries its own number, `EGYCASH-IT-F-14-0001`, one more
  on every print; the hand-over records the number of the paper the employee signed (a number the
  counter never handed out, or one already on another receipt, is refused); a reprint keeps it.
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
- **FR-19** Mobile lines are a register of their own (§2.10) under the asset grants
  (`itAsset.*`): registered with their network, number, account, plan and SIM; handed over to a
  current employee — on a printed «إقرار استلام», print first, as for devices (FR-18) — or to a
  car by its code and plate, with no paper; returned; suspended and reactivated. The screen
  filters by network with the networks' logos and shows each network's figures (lines; in stock,
  handed over, suspended; accounts; plans) under the other filters; the list goes to Excel and
  PDF. A leaver's lines are flagged like their assets (FR-13), never returned automatically
  (§17, 2026-10-20).
- **FR-20** Consumables are a store of their own (§2.11) under the asset grants (`itAsset.*`),
  each branch with its own stock: an item is added with its opening quantity, edited, retired
  (`active: false` — it keeps its balances and history; nothing comes in or goes out, though a
  return or a scrap can still be recorded), and its quantities move ONLY by a movement —
  «توريد» (in), «صرف» (out to an employee), «هالك» (out as scrap, with the cause) and «مرتجع» (back
  in working order). An issue goes to a CURRENT employee (a leaver is refused, FR-15's rule), takes
  one or more items of ONE branch's store, never more than it holds, says per item whether it is new
  or replaces a damaged one, may name the register's asset it was installed on (not a disposed
  one — which then counts as used, so FR-5 no longer deletes it), and writes one numbered memo the
  employee signs; the screen prints it at once, and it can be printed again and its signed copy
  filed. The register shows each item's balance, what was issued
  and what was scrapped, and flags an item at its minimum; the movements log answers who was given
  what, and goes to Excel and PDF as the register does. An asset's page lists the consumables
  installed on it; an employee's IT page lists what they were issued (§17, 2026-10-28).

## 6. States catalog

| Entity | States | Terminal |
|---|---|---|
| Asset | `inStock · assigned · underMaintenance · disposed` | `disposed` |
| Assignment | `open · closed` (by `returnedAt`) | closed |
| Mobile line | `inStock · assigned · suspended` | — |
| Mobile-line assignment | `open · closed` (by `returnedAt`) | closed |
| Consumable item | `active · retired` (by `active`) | — |
| Consumable movement | append-only: `received · issued · scrapped · returned` — a fact, not a state | — |
| Ticket | `open · inProgress · onHold · resolved · closed · cancelled` | `closed`, `cancelled` (reopen exits `closed` within the window) |
| Maintenance order | `open · inProgress · completed · cancelled` | `completed`, `cancelled` |
| License | derived: `active · expiringSoon · expired · perpetual` (from `expiresAt`) | — (no stored state) |

## 7. Permissions (`resource.action`, moduleId `it` — RBAC + data scopes)

| Screen | View needs | Operations on it |
|---|---|---|
| `/it` (home/dashboards) | any `it*` view permission | — |
| `/it/assets` (+ scan, + labels) | `itAsset.view` | `itAsset.create`, `.edit`, `.export`, `.delete` (FR-5 only) |
| `/it/assets/:id` custody | `itAsset.view` | `itAsset.assign` (assign + return + transfer — one custody grant, the roster-precedent: one operational surface), `itAsset.dispose` (a write-off decision, its own grant), `itAsset.viewNationalId` (the holder's national ID on the custody acknowledgment — Security Architecture §3's sensitive-data grant; without it the line is left for the pen) |
| `/it/mobile-lines` | `itAsset.view` | `itAsset.create`, `.edit` (edit, suspend, reactivate), `.assign` (hand over + return + the line's acknowledgment), `.viewNationalId` — the asset grants: granting «الأصول» now covers the lines too, and no key or page was added (§17, 2026-10-20) |
| `/it/consumables` (+ `/movements`) | `itAsset.view` | `itAsset.create` (add an item), `.edit` (edit, retire, receive, scrap), `.assign` (issue to an employee, take back from one, file the memo's signed copy) — the asset grants again: no key or page was added (§17, 2026-10-28) |
| `/it/catalogs` | — | `itCatalog.manage` (asset + ticket categories and the consumables' types — one grant, the `fleetCatalog.manage` precedent) |
| `/it/tickets` | `itTicket.view` (scoped; requesters see own) | `itTicket.create`, `.edit` (work the ticket: status, priority, internal comments), `.assign` (dispatch decision, its own grant), `.close` (close + reopen + cancel, both-directions precedent) |
| `/it/helpdesk-settings` | — | `itSlaPolicy.manage` (priorities + their SLA targets — behaviour-carrying, its own grant: the `fleetMaintenanceRule.manage` precedent) |
| `/it/maintenance` | `itMaintenance.view` | `itMaintenance.create`, `.edit`, `.complete` (complete + cancel) |
| `/it/maintenance-plans` | `itMaintenance.view` | `itMaintenancePlan.manage` |
| `/it/spare-parts` | `itSparePart.view` | `itSparePart.manage` (catalog + receipts; consumption flows through order completion under `itMaintenance` grants) |
| `/it/software` | `itSoftware.view` | `itSoftware.manage` (products + installations) |
| `/it/licenses` | `itLicense.view` | `itLicense.manage` |
| `/it/vendors` | `itVendor.view` | `itVendor.manage` |

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
| `it.asset.transferred` | assetCode, fromEmployeeId?, toEmployeeId?, fromBranchId?, toBranchId? | §4.3 |
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
IT NAMES employees through its own read-only `/it/people` (under `itAsset.view`) and
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
written on the hand-over — text on the interval, not a Fleet id — so IT still reads nothing of
Fleet's, and a car Fleet later renames or disposes is not updated on the line's record.
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

## 11. Dashboards & reports (derived queries — no new collections)

**Asset dashboard:** counts by status/category/branch · assets held by exited employees (§9.1) ·
warranty expiring 30/60/90 · recently registered/disposed.
**Ticket dashboard:** open by priority/technician/category · SLA at-risk (§4.5) and breached ·
aging buckets · resolved-this-week.
**Maintenance dashboard:** plans due within horizon · overdue orders · parts below min · cost
this month (sum of order costs — a report figure, not accounting).
**Warranty & license report:** filterable warranty list (window, vendor, category, branch) plus
license compliance (over-seats, expiring) — the §8.1 sweeps' queryable twin, so FR-10's
warn-only stance has a screen someone actually watches.
**Asset export:** CSV via the audited row-capped export path (the applicant-export
precedent; `itAsset.export`).

## 12. APIs (all under `/api/v1/it/…`, standard list/get/create/patch + named actions)

| Prefix | Named actions beyond CRUD |
|---|---|
| `/it/assets` | `GET /by-code/:code` (scan) · `GET /names` (the register's distinct names, for the name filter) · `POST /:id/assign` · `/:id/return` · `/:id/transfer` · `/:id/dispose` · `GET /:id/history` · `GET /:id/assignments` · `POST /labels` (PDF) · `GET /export` — every asset answer names its current `holder` |
| `/it/assignments` | the custody register: `open`, `branchId`, `employeeId`, and a filter per column — `search` (the asset's code, name or serial), `categoryId`, `assignedFrom/To`, `overdue`, `returnedFrom/To`, `receipt` (signed / unsigned / none) |
| `/it/catalog-items` | archive (kinds: assetCategory, ticketCategory, consumableType) |
| `/it/tickets` | `POST /:id/assign` · `/:id/status` · `/:id/resolve` · `/:id/close` · `/:id/reopen` · `/:id/cancel` · `GET+POST /:id/comments` · attachments via platform files |
| `/it/ticket-priorities` | carry the SLA targets (§2.6) |
| `/it/maintenance-plans` | activate/deactivate |
| `/it/maintenance-orders` | `POST /:id/start` · `/:id/complete` · `/:id/cancel` |
| `/it/spare-parts` | `POST /:id/receipts` · `GET /:id/movements` |
| `/it/software-products`, `/it/software-installations` | remove (stamps `removedAt`) |
| `/it/licenses` | — |
| `/it/vendors` | — |
| `/it/people` | read-only: `GET /` (search, `status` all/employed/exited, branch) · `GET /:employeeId` — HR's people through the directory (§9.1) |
| `/it/technicians` | read-only: `GET /` — the IT departments' people (FR-17) |
| `/it/custody-receipts` | `POST /preview` (the paper and its new number; nothing else written) · `POST /` (the hand-over: intervals + receipt) · `GET /:id` · `POST /:id/print` (print again, under its number) · `GET+POST+DELETE /:id/signed-copy` — FR-18; plus `POST /it/assignments/:id/receipt` for an interval from before receipts |
| `/it/mobile-lines` | `GET /summary` (each network's figures under the filters) · `POST /:id/assign` (employee or car) · `/:id/return` · `/:id/suspend` · `/:id/reactivate` · `GET /:id/history` — FR-19 |
| `/it/mobile-line-assignments` | read-only: `GET /` (open, line, employee, branch) — FR-19 |
| `/it/mobile-line-receipts` | `POST /preview` · `GET /:id` · `POST /:id/print` · `GET+POST+DELETE /:id/signed-copy` — FR-19 |
| `/it/consumables` | `POST /issue` (one employee, n items of one store, one memo) · `GET /:id/movements` · `POST /:id/receive` · `/:id/scrap` · `/:id/return` — FR-20; list filters `search`, `typeId`, `branchId`, `belowMin`, `active` |
| `/it/consumable-movements` | read-only: `GET /` (kind, item, type, employee, asset, branch, from/to, search) — FR-20 |
| `/it/consumable-memos` | `GET /:id` · `POST /:id/print` · `GET+POST+DELETE /:id/signed-copy` — FR-20 |
| `/it/dashboard` | `GET /assets` · `/tickets` · `/maintenance` · `GET /reports/warranty` |

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
  serial too short to be whole is held back until the owner reads it off the device. The go-live
  file `apps/api/assets/it-go-live/aio-october-2026-10.json` holds the 97 others, serials only. A
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
