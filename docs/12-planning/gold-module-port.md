# Gold & Precious-Metals Vault — module port

**Status:** delivered · **Source:** the standalone `egycashcompany-ops/gold` system (MERN, Arabic
RTL) · **Target:** ECMS module `gold`

> **On the module id.** [Module Hierarchy](../01-business/module-hierarchy.md) reserved `gold-vault`
> as a placeholder. The delivered id is **`gold`**, because the platform's page-registry contract
> (`PAGE_ID_PATTERN`) requires a page id to read `<moduleId>.<slug>` with no hyphen in the module
> part — a hyphenated module could not declare pages at all. Changing that pattern is a platform
> contract change and not something a module port should make on its way past. The hierarchy
> document has been updated to the delivered id.

This document records what was carried across, what was dropped, and — the part worth reading —
the three places where the module was deliberately changed. It is a PORT record, not a design: the
gold system's business rules are the specification, and where this document and the code disagree
with the original system, the original system is the bug report.

---

## 1. The rule the port was executed under

> Take the Gold module as it is and put it inside ECMS with as little change as possible. Do not
> redesign it and do not rewrite it. Integrate exactly three things: the crew leader and vehicle on
> a receiving receipt, the vault custodians, and the branches. Keep the UI; the theme may change.

So: **behaviour is preserved, scaffolding is replaced.** Numbering formats, the draft → confirm →
revert lifecycle, drawer counters, the closing-balance arithmetic and every Arabic error message
are the gold system's. Auth, RBAC, navigation, audit, data scoping, validation and the HTTP shape
are now the platform's, because that is what "part of ECMS" means.

---

## 2. The three integrations

| # | Was (gold) | Is (ECMS) | Where |
| --- | --- | --- | --- |
| 1 | `teamLeader`, `vehicleNumber` — free text typed on the receipt | `teamLeaderEmployeeId` → an ECMS employee; `vehicleId` → an ECMS **Fleet** vehicle | `receiving-receipt.model.ts`, `shared/ecms-refs.ts`, `fleet-boundary.ts` |
| 2 | `supervisor1` / `supervisor2` — names picked from a gold-owned `supervisors` collection | `supervisor1EmployeeId` / `supervisor2EmployeeId` → ECMS employees, on receiving, delivery **and** transfers | `shared/ecms-refs.ts` |
| 3 | a gold-owned `branches` collection with its own admin screen | `branchId` → an ECMS organization branch; visibility is the platform's branch data scope | `shared/ecms-refs.ts`, every repository's `branchField` |

Two properties hold for all three:

- **id + snapshot, written together.** Every reference stores the id AND the display value at write
  time (`teamLeaderName`, `supervisor1Name`, `vehicleNumber`). This is not a cache. A receipt is a
  printed document; the copy in the filing cabinet must keep saying what it said after somebody is
  renamed or a car is sold. The id is the link, the snapshot is the record.
- **A reference is proved, not trusted.** A non-null employee id that HR cannot answer for, or one
  belonging to somebody who has left, is refused (`400`), as is a vehicle id Fleet does not know.
  Clearing a field with `null` is always allowed — a draft is saved from whatever the operator has
  so far, and that stays true.

**How each module is reached, without a cross-module import:**

- Employees → `platform/directory`, the sanctioned seam (the same one Fleet and Operations use).
- Vehicles → `modules/gold/fleet-boundary.ts`, a single read-only re-export file, exactly the
  precedent `modules/operations/fleet-boundary.ts` set. Gold never writes a Fleet collection.
- Branches → `platform/organization`.
- On the client, all three are ordinary calls to published endpoints (`/hr/employees`,
  `/fleet/vehicles`, `/platform/organization/branches`) from the module's own `api/` layer.

### Branch-on-create

`resolveCreateBranchId` is the gold rule (`utils/branchScope.js`) reading ECMS branches instead of
its own collection, and it is kept because it is a business rule, not plumbing:

- the creating user's branch, when they have one;
- otherwise: no branches at all → `null` (single-branch install); exactly one → that one;
- more than one and no placement → refuse and say so.

---

## 3. What was NOT carried across, and why

| Dropped | Reason |
| --- | --- |
| `users`, `roles` | The platform owns identity and RBAC. The gold role catalog is expressed as the permissions in `gold.module.ts`. |
| `audit_logs` | Every mutation writes to the platform audit trail, which has its own screens. Two verbs were added to the platform's vocabulary — `deliver` and `revert` — because `receive` and `transfer` already said the rest. |
| `notifications` | Platform notifications. Nothing in the gold system ever created a notification row. |
| `branches`, `supervisors` | Integrations 2 and 3. |
| `ReceivingReceipt.supervisors[]` | Declared in the schema and never written by any code path. Carrying it forward would document a capability the business never had — and a second free-text custodian list is exactly what integration 2 removes. |
| The customer **PORTAL** (`portal_users`, `/portal/login`, the portal app) | See §6. |

---

## 4. Shape of the port

```
apps/api/src/modules/gold/
├── gold.module.ts          the manifest — permissions, pages, routes, collections
├── gold.mappers.ts         doc → DTO, with a per-page label bag (no N+1 name lookups)
├── fleet-boundary.ts       the ONE read-only door to Fleet (integration 1)
├── shared/
│   ├── drawer-numbering.ts the numbering engine, ported verbatim (+ its original tests)
│   ├── drawer-counters.ts  recount-from-bars, never increment
│   ├── document-number.ts  R/D/T <YYYYMMDD><nn>, with a retry the original lacked
│   ├── ecms-refs.ts        the three integrations
│   ├── labels.ts           page-at-a-time display-name resolution
│   └── scope-clause.ts     the caller's data scope, for the aggregation-only reads
├── companies/ representatives/ floors/ vaults/ bars/
└── receiving/ delivery/ transfers/ keys/ dashboard/ reports/
```

Collections, all `gold_`-prefixed: `companies`, `representatives`, `floors`, `vaults`, `drawers`,
`bars`, `receiving_receipts`, `delivery_receipts`, `transfers`, `key_handovers`.

### Permissions

The gold `PERMISSION_CATALOG`, resource by resource, in ECMS's vocabulary. Its `branches`, `users`,
`roles` and `audit` groups are absent because ECMS owns those surfaces.

| Resource | Grants |
| --- | --- |
| `goldReport` | `view` (the dashboard **and** the printed statements — one grant, as gold's `view_reports` was) |
| `goldVault` | `view` `create` `edit` `delete` (floors ride these) |
| `goldBar` | `view` `edit` — no create/delete: a bar is born from a receipt and leaves through a delivery |
| `goldReceiving` | `view` `create` `edit` `print` + `confirm` `revert` `import` |
| `goldDelivery` | `view` `create` `edit` `print` + `confirm` `revert` |
| `goldTransfer` | `view` `create` `edit` `print` + `confirm` `revert` |
| `goldKey` | `view` `create` `delete` `print` + `return` |
| `goldCompany` | `view` `create` `edit` `delete` |
| `goldRepresentative` | `view` `create` `edit` `delete` |

`goldReceiving.import` gates the spreadsheet control and has no endpoint of its own — the parsing
happens in the browser and the rows arrive as ordinary lines, exactly as in the gold system.

---

## 5. Behaviour-preserving changes worth naming

These are the only places where the ported code does something the original did not, and each is
the original rule being *made to hold* rather than being changed:

1. **Document numbers retry on collision.** The gold system derived `nn` from a count and inserted,
   so two operators saving in the same second produced the same number. The unique index now
   catches it and the caller retries with the next number. Same format, same rule — it just holds.
2. **References are validated** (§2). Free text validated nothing because there was nothing to
   validate against.
3. **Writes carry a version** (`__v`), the platform's optimistic-concurrency convention, so two
   people cannot approve the same draft twice.
4. **`print` is a grant.** The gold catalog declared print actions for these screens; the routes now
   enforce them, and the print endpoint still logs the count and the timestamp.
5. **The company logo** moves from Cloudinary to the platform Files service (`logoFileId`). Storing
   the URL of a file service ECMS does not use would have carried a second file stack into the
   platform.

Everything else — every message, every threshold, every refusal — is the gold code's.

---

## 6. The customer portal — deferred once, then built on platform identities

The gold system ships a second application for **customers**: `portal_users` with their own password
hash, their own JWT, their own login screen and a read-only view of their company's bars and
receipts.

It was left out of the first pass, and that was a decision rather than an omission: bringing it
across as-is would have stood up a second authentication system beside the platform's — precisely
what "make the Gold module part of ECMS from an auth/RBAC point of view" rules out. The owner then
settled the two questions that were blocking it: portal users are **external identities, not
employees**, and the portal is **read-only**.

It is now built, and the shape is recorded in
[ADR-027](../03-decisions/ADR-027-external-identities.md). In one paragraph: a customer is an
ordinary ECMS account with `employeeId: null` and an `externalSubject` naming the gold company they
belong to — same login, same argon2id, same lockout, same sessions, same audit. The platform
confines external accounts, before authorization and by default-deny, to their own `/auth`
self-service plus one GET-only surface their module registers. Which customer's data they see is the
module's own question, answered by a branded `PortalCompany` that only one middleware can mint.

### What the customer receives, and what gold used to send

gold's portal read the same `.lean()` documents the staff screens did, so it handed customers rather
more than they ever looked at. The ported DTOs are allow-lists in their own contracts file, and a
spec asserts the following stay out of it:

| Field gold sent | Why it is not on this surface |
| --- | --- |
| `supervisor1`, `supervisor2` | EGYCASH's own vault custodians, by name |
| `teamLeader`, `vehicleId` / plate | our transport crew and our vehicles |
| `notes` | the vault's internal remarks on the customer's document |
| `createdBy`, `printCount`, `branchId` | bookkeeping about how *we* handled the paper |
| `history[]` on every bar | the staff who moved it, and when |
| counterparty delegates on a transfer | another customer's people |

Nothing a customer actually looked at is lost. The delegate register still carries the national ids
gold showed, because those are the customer's own people, registered with us by them.

### Two deliberate differences from gold, both signed off

- **Confirmed documents only.** gold's portal listed drafts and counted them in the overview tiles.
  A draft is work the vault has not committed to, and a customer counting it as theirs is counting
  metal that has not moved.
- **The two monthly reports still cover funds only.** That restriction lives in ported report logic
  this work is not allowed to edit, so a customer registered as a company or an institution is told
  why rather than shown an empty table.

**Nothing else from the gold system was left out.**

---

## 7. Front end

`apps/web/src/modules/gold/` — the eleven screens the gold sidebar had, minus the four ECMS already
owns (users, roles, branches, audit log). Same layouts, same flows, same Arabic wording; restyled
to the ECMS theme (slate + brand, light/dark, RTL logical utilities) and rebuilt on the shared UI
kit.

Two things are deliberately **not** re-themed:

- **The printed documents.** Receipts, the drawer-inventory minutes (محضر جرد درج) and the monthly
  statements keep the EGYCASH letterhead, the company indigo and the signature blocks exactly as
  they were. These are company records, not application chrome.
- **The vault board's fill colours.** Grey → green → yellow → orange → red is a state signal: a
  drawer over its limit has to look wrong in either theme.

### New client dependencies

| Package | Why |
| --- | --- |
| `recharts` | The dashboard IS its charts, and ECMS had no charting library. |

That is the whole list — one package.

### The bulk import is CSV, not XLSX

The gold system read `.xlsx` through SheetJS. The npm mirror of that library is frozen at 0.18.5
and carries two unfixed advisories (prototype pollution, ReDoS), so carrying it across would have
added a known-vulnerable dependency to the platform for one screen's convenience. **Decision: the
import reads CSV**, through a parser written in the module
(`components/receiving-import.ts`, ~150 lines, no dependency).

Nothing about the feature is lost. The intake was always ONE sheet of flat rows — which is exactly
what CSV is — and the parser keeps every behaviour the original had: the same fuzzy bilingual column
matching, the same "a row counts when it has a serial or a weight" rule, and the same
report-what-could-not-be-matched discipline for vault and drawer. It also handles what real files
from customers' accountants actually contain and SheetJS was papering over:

- the separator Excel chose — comma, semicolon (most Arab and European locales) or tab, detected
  from the header rather than assumed;
- RFC 4180 quoting: fields carrying the delimiter, a line break, or a doubled `""`;
- CRLF endings and the UTF-8 byte-order mark a spreadsheet export writes before the first header,
  which otherwise becomes part of that column's name and stops it matching.

Operators save the sheet as CSV; the file picker accepts `.csv` and the empty-file message says so.
Covered by `receiving-import.spec.ts` (14 cases).

---

## 8. Verification

- `apps/api/src/modules/gold/shared/drawer-numbering.spec.ts` — the gold system's own numbering
  tests, carried across.
- `apps/web/src/modules/gold/components/receiving-import.spec.ts` — the CSV intake: separators,
  quoting, the BOM, Arabic and English headers, and the row-keeping rule.
- `apps/api/tests/integration/gold.spec.ts` — the lifecycle end to end: draft → confirm → revert for
  all three documents, drawer re-counts, serial uniqueness, the reshape/regenerate guards, one key
  per drawer, the three integrations (including refusing a reference that is not a real ECMS
  record), branch scoping, and RBAC.

### Fidelity audit

The port was written in one pass and its integration suite cannot run outside CI, so the finished
module was audited against the gold sources file by file: seven slices (receiving, delivery and
transfers, vaults, bars/people/keys, reports and dashboard, endpoint-and-field wiring, and the
front end screen by screen), each one asked to find behaviour the port had changed, and each
finding then given to a second reader whose job was to refute it. Only a finding that survived
refutation — with a quoted gold line and a quoted port line — counted.

Thirty-nine differences were raised and twenty-eight were refuted as unreachable, dead in gold, or
already on the approved list above. The eleven that survived are fixed in this branch:

| What differed | Fix |
| --- | --- |
| The delegate dropdowns in all three editors asked for `pageSize: 200`; gold's backend clamped that to 100, ECMS's pagination schema rejects it — so the delegate could never be selected and no printed document carried a signatory. | Ask for 100, the platform maximum, which is what gold received after its own clamp. |
| Delivery and transfer `confirm`/`revert` moved the bars before the version-guarded header write, so a stale version could leave bars moved under an unchanged header with the drawers never re-counted. Gold's `save()` could not fail, so its loop was never half-applied. | Claim the header first; the bar writes and the re-count stay on one success path. (Receiving keeps gold's order deliberately — there the second write is `insertMany`, which really can fail on a serial race, and the stale-version path is unreachable.) |
| `GET /gold/drawers/:id` returned at most 100 bars, silently truncating the drawer dialog's count, its owner chips and the printed جرد الدرج sheet. Nothing bounds how many bars a drawer holds. | An unpaginated `findInDrawer` read, as gold's `getDrawer` did. |
| An emptied phone, e-mail, note, national id, job title or vault description was sent as `undefined` on update, which omits the key — so the field could no longer be cleared. | Blanks travel as `null` on the update path, `undefined` only on create. |
| The vault list tie-break became `_id` ascending instead of gold's `createdAt: -1`, and ties are ordinary because `order` defaults to the vault count. | `listInGoldOrder` — `{ order: 1, createdAt: -1, _id: 1 }` — for the default listing. |
| The key register resolved the drawer and the delegate one row at a time, 2N queries where gold used one populate pass. | Batched `drawerCells` / `representativeContacts` beside the existing helpers. |
| The dashboard's four charts lost click-a-legend-entry-to-hide, the two doughnuts lost their in-slice percentages, and the company picker no longer remembered the selection between visits. | All three restored, the selection under the `ecms.` localStorage prefix the platform already uses. |
| Drawer cells on the board printed bare numbers — no «جم», no «سبيكة», and no «بدون حد» line on a drawer without a weight limit. | Units and the no-limit line restored from the existing catalogue keys. |
| The drawer-audit minutes printed «ادارة الخزينة — خزينة المعادن الثمينة» on one line; gold gave the department its own line. | `letterhead` takes a list of subtitle lines. |

The refutations are as much a part of the record as the fixes: dropped payload fields nothing
rendered, dead endpoints no screen called, gold query parameters no caller could send, and the
soft-delete/validation idioms that are the platform's by design, all stay as they are.
