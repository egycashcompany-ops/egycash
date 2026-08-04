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
| **Workflow engine (ADR-011)** | *accepted as ADR, not built as a platform service* | **not used.** Recruitment built its own module engine; Fleet used code-defined lifecycles in services. Tickets follow the Fleet precedent (§4.4, D4); the gap is recorded in ADR-021 (§13) |

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
kind, not as a collection. Archive, never delete, once referenced (Fleet catalog rule). No
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
(no valuation, no locations, no reservations) — ADR-022 records the boundary.

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
  service, and tickets must not be the hostage that forces building it (ADR-021 records this).

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
  a registered-in-error asset with no history may be deleted by `itAsset.delete` (audited).
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

## 6. States catalog

| Entity | States | Terminal |
|---|---|---|
| Asset | `inStock · assigned · underMaintenance · disposed` | `disposed` |
| Assignment | `open · closed` (by `returnedAt`) | closed |
| Ticket | `open · inProgress · onHold · resolved · closed · cancelled` | `closed`, `cancelled` (reopen exits `closed` within the window) |
| Maintenance order | `open · inProgress · completed · cancelled` | `completed`, `cancelled` |
| License | derived: `active · expiringSoon · expired · perpetual` (from `expiresAt`) | — (no stored state) |

## 7. Permissions (`resource.action`, moduleId `it` — RBAC + data scopes)

| Screen | View needs | Operations on it |
|---|---|---|
| `/it` (home/dashboards) | any `it*` view permission | — |
| `/it/assets` (+ scan, + labels) | `itAsset.view` | `itAsset.create`, `.edit`, `.export`, `.delete` (FR-5 only) |
| `/it/assets/:id` custody | `itAsset.view` | `itAsset.assign` (assign + return + transfer — one custody grant, the roster-precedent: one operational surface), `itAsset.dispose` (a write-off decision, its own grant) |
| `/it/catalogs` | — | `itCatalog.manage` (asset + ticket categories — one grant, the `fleetCatalog.manage` precedent) |
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
`it.ticketAutoCloseDays` (7; 0 = off) · `it.preventiveHorizonDays` (7).

## 9. Integration points

**9.1 HR (live):** custody references employees; requesters/technicians are platform users.
Subscribes to `hr.employee.exited`: assets held by the leaver are **flagged** (dashboard panel
"assets held by exited employees" + notification to IT) — never auto-returned (FR-13); the exit
checklist is the human process, the flag is its safety net.
**9.2 Fleet (boundary, no coupling):** vehicles never enter `it_assets`; `it_maintenance_*` and
`fleet_maintenance_visits` are different domains that happen to share a word. No shared code, no
shared collections.
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
| `/it/assets` | `GET /by-code/:code` (scan) · `POST /:id/assign` · `/:id/return` · `/:id/transfer` · `/:id/dispose` · `GET /:id/history` · `GET /:id/assignments` · `POST /labels` (PDF) · `GET /export` |
| `/it/catalog-items` | archive (kinds: assetCategory, ticketCategory) |
| `/it/tickets` | `POST /:id/assign` · `/:id/status` · `/:id/resolve` · `/:id/close` · `/:id/reopen` · `/:id/cancel` · `GET+POST /:id/comments` · attachments via platform files |
| `/it/ticket-priorities` | carry the SLA targets (§2.6) |
| `/it/maintenance-plans` | activate/deactivate |
| `/it/maintenance-orders` | `POST /:id/start` · `/:id/complete` · `/:id/cancel` |
| `/it/spare-parts` | `POST /:id/receipts` · `GET /:id/movements` |
| `/it/software-products`, `/it/software-installations` | remove (stamps `removedAt`) |
| `/it/licenses` | — |
| `/it/vendors` | — |
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
| **ADR-020 — IT asset custody & history** | append-only event chain as the business record; derived status; no hard delete (FR-2/FR-4/FR-5); why audit logs are not the custody chain (D3) |
| **ADR-021 — Help-desk SLA & ticket lifecycle placement** | SLA targets as priority data + snapshot-on-create; set-once breach stamps; sweep cadence; **and the recorded decision that ticket states are code-defined in the module, not the (unbuilt) ADR-011 platform engine** — with the migration note for the day the platform engine exists |
| **ADR-022 — Minimal spare-parts ledger** | movements ledger + denormalized on-hand; explicitly *not* inventory accounting; the boundary Accounting will inherit |

## 15. Delivery slices (post-approval; each slice = contracts + api + tests, PR-reviewed; web follows)

| Slice | Content |
|---|---|
| IT-1 | contracts (DTOs/schemas/permissions/events) · module skeleton + manifest + nav category · catalog items (asset + ticket categories) · vendors · asset register + sequences + QR/labels |
| IT-2 | custody: assign/return/transfer/dispose · asset events/history · HR exit subscription · ADR-020 |
| IT-3 | help desk: priorities (with SLA targets), tickets, event/conversation stream, attachments, SLA + auto-close sweeps · ADR-021 |
| IT-4 | maintenance: plans, orders, spare parts + movements, preventive sweep · ADR-022 |
| IT-5 | software products, installations, licenses, expiry sweep |
| IT-6 | dashboards, warranty report, asset export, notification templates, seed data |
| ITW-1…6 | web app per area (skeleton/nav → assets → tickets → maintenance → software → dashboards), ar/en + RTL, ADR-019-compliant pickers |

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
