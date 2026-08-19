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

## 6. Deliberately out of scope: the customer portal

The gold system ships a second application for **customers**: `portal_users` with their own
password hash, their own JWT, their own login screen and a read-only view of their company's bars
and receipts.

It is not in this port, and that is a decision rather than an omission. Bringing it across as-is
would stand up a second authentication system beside the platform's — which is precisely what
"make the Gold module part of ECMS from an auth/RBAC point of view" rules out. Doing it properly is
its own piece of work with a real decision behind it (external identities in the platform, or a
scoped read-only surface), and it needs an owner's answer before any code.

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
