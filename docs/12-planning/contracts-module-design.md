# Contracts Module — Architecture & Design

**Status: FROZEN (Revision 2, 2026-07-26).** Approved for implementation. Later
sections supersede earlier ones wherever they conflict (§9 > §8 > §2–§7). Amendments
after the freeze require a new recorded revision.

## 1. Purpose & scope

Employment contracts become a **first-class HR module** — not a tab inside Employees:

```
HR
├── Employees
├── Contracts        ← this module (/contracts)
├── Leave
└── …
```

Contracts have their own lifecycle (draft → active → amended/renewed/terminated/expired),
their own admin-editable **template system** (HR builds new contract templates without a
developer), and **immutable generated documents** (a printed contract can never change
retroactively, whatever happens to its template later).

In scope: contract aggregate + lifecycle, template management with a rich-text editor and
placeholders, render-on-create with live preview, printable PDF + immutable snapshot,
list/detail UI, permissions, audit, notifications, expiry sweep.
Out of scope (recorded in §12): e-signature, multi-step approval workflow, payroll math.

## 2. Decisions (D1–D12)

### D1 — First-class module placement

`apps/api/src/modules/hr/contracts/` with features `contract-templates/` and `contracts/`;
web app at `apps/web/src/modules/hr/contracts/` mounted at **`/contracts`** with its own
navigation entry (seeded into the navigation catalog like Leave was, so existing installs
receive it at boot). The module consumes Employees, Organization, Files and Notifications
strictly through their barrels/seams (ADR-003/ADR-017); Employees never imports Contracts.

### D2 — The Contract aggregate

One collection `hr_contracts`:

| Field | Notes |
|---|---|
| `code` | Immutable contract number `CN-YYYY-NNNNNN` (atomic sequence, like offers) |
| `employeeId` + denormalized `employeeName`, `employeeCode` | display without joins |
| `type` | admin catalog value (D4a): e.g. permanent / fixed-term / probation / part-time |
| `templateId` + `templateVersion` | **pinned** at generation (D9) |
| `status` | `draft → active → (amended \| renewed \| terminated \| expired)` (D3) |
| `version` + `parentContractId` / `supersededById` | the amendment/renewal chain (D3) |
| `startDate` / `endDate` | business dates (Cairo calendar, like Leave); `endDate` null for open-ended |
| `variables` | the **resolved placeholder values** frozen at generation (D9) |
| `renderedHtml` | the immutable rendered document snapshot (D9) |
| `pdfFileId` | the generated PDF in the platform Files service (D8) |
| `terminatedAt/By/Reason`, `generatedAt/By` | lifecycle bookkeeping |

### D3 — Lifecycle state machine

```
draft ──generate──▶ active ──amend────▶ amended   (superseded by the new version)
  │                   │  └──renew────▶ renewed    (superseded by the new contract)
  └──delete           ├──terminate──▶ terminated (reason + date, audited)
                      └──endDate passes──▶ expired (hourly sweep, D11)
```

- **Draft** holds employee + template + editable variable overrides; it renders a preview
  but has no snapshot yet and may be deleted.
- **Generate** freezes everything (D9): resolves variables, stores `renderedHtml`, queues
  the PDF, activates the contract. From that moment the document is immutable.
- **Amend** = a new contract **version** (same `code`, `version+1`, new effective dates
  and/or template) generated from current employee data; the old version becomes `amended`
  and keeps its snapshot. **Renew** = a new contract (new `code`, `version 1`) linked via
  `parentContractId` for a fresh period; the old one becomes `renewed`. **Terminate**
  records reason + date and revokes nothing retroactively (the snapshot stays).
- One **active** contract per employee per `type` (business rule; overridable types like
  allowances contracts are a catalog flag).

### D4 — Templates: admin-owned, versioned, clonable, archivable

Collection `hr_contract_templates`: `key` (stable id), `name` (ar/en), `language`
(`ar` | `en` — a template targets ONE language/direction; HR **clones** it to produce the
other), `contractTypeId`, `status` (`draft`/`active`/`archived`), `version` (append-only
version chain — editing an active template creates version N+1; existing contracts keep
their pinned version), structured **sections**:

- `header` (rich text) + `logoFileId` (uploaded via platform Files)
- `body` (rich text with placeholders)
- `footer` (rich text)
- `signatures[]`: labeled signature blocks (e.g. Employee / HR Manager / Company), each an
  optional name/title line + signing line

**D4a** — `hr_contract_types` admin catalog (name ar/en, `allowsEndDate`,
`multipleActiveAllowed`, status) so new contract kinds never need a developer either.

### D5 — Placeholder catalog (server-owned)

A single server-side **variable registry** drives both rendering and the editor's variable
browser (never two lists to keep in sync). Initial catalog:

| Placeholder | Source |
|---|---|
| `{{employee.fullName}}`, `{{employee.employeeCode}}`, `{{employee.nationalId}}`, `{{employee.address}}` | Employee aggregate |
| `{{job.title}}`, `{{department.name}}`, `{{branch.name}}` | employment placement (localized to the template language) |
| `{{salary.basic}}`, `{{salary.currency}}` | employment salary (formatted per language) |
| `{{contract.startDate}}`, `{{contract.endDate}}`, `{{contract.code}}` | the contract itself (localized date format) |
| `{{company.name}}` | Organization singleton |

Exposed as `GET /hr/contract-variables` (key, label ar/en, sample). Unknown placeholders
fail template save with a readable error; **missing values at generation** are listed to
the user (e.g. employee has no address) and block generation unless explicitly overridden
per-field in the draft.

### D6 — Rendering (server-side, one engine)

Rendering happens **server-side only** — one implementation, no client/server drift: the
sanitized rich-HTML sections + the resolved variable map go through the existing pure
`renderTemplate` substitution engine. The **live preview** in the create screen and the
template editor calls `POST /hr/contracts/preview` (template + employee [+ overrides]) —
debounced, returns rendered HTML displayed in a sandboxed iframe (print stylesheet
applied, A4 page box). Stored template HTML is sanitized on save (allow-listed tags/
attributes; no scripts/iframes/external URLs — images only via platform Files ids).

### D7 — Editor: TipTap, structured, variable-aware

The template editor uses **TipTap** (MIT, self-contained — CSP stays closed): toolbar
limited to print-sensible marks (headings, bold/italic/underline, lists, alignment,
tables), RTL/LTR per template language, plus a custom **variable node** — placeholders are
inserted from the **variable browser** side panel (click-to-insert, rendered as chips,
stored as `{{key}}` text). Header/footer/logo/signature blocks are the D4 structured
fields, not free-floating content — so every template prints consistently.

### D8 — PDF strategy

**Recommended:** server-side PDF via headless Chromium (`puppeteer-core` + a pinned
chromium) rendering the stored snapshot HTML — executed as a **BullMQ job in the worker
process** (never in a request), stored through the platform Files service, linked as
`pdfFileId`, downloadable via the existing signed-URL flow. Reasons: authoritative
identical output for every viewer, archivable artifact, auditable download.
- Until the PDF job lands (or if it fails), **Print** opens the snapshot HTML in a print
  view (`@media print` A4 stylesheet) — the browser's print-to-PDF gives the same layout;
  the action stays available forever as the fallback.
- Deployment note: chromium must be present in the worker image (documented in the
  Railway guide; the build adds the apt package). If the approver prefers to avoid the
  dependency, phase 1 ships with print-view only and `pdfFileId` stays null — the schema
  and UI don't change. **Approver choice requested (§13 Q1).**

### D9 — Immutability of generated documents (hard invariant)

At generation the contract stores: the **pinned** `templateId+templateVersion`, the full
**resolved variable map**, the final **`renderedHtml`**, and (async) the PDF file. None of
these are ever updated afterwards — re-rendering an issued contract is **not implemented**
(no code path). Template edits create new template versions used only by future contracts.
Amendments generate a **new** version with its own snapshot. Preview/Print/Download always
serve the stored snapshot, never a fresh render.

### D10 — Permissions, audit, events

Permissions: `contract.view` (scoped like employees), `contract.create`,
`contract.generate`, `contract.amend`, `contract.renew`, `contract.terminate`,
`contract.print` (print/download — audited as `export`), `contractTemplate.manage`,
`contractType.manage`.
Audit: `create`, `contractGenerated`, `contractAmended`, `contractRenewed`,
`statusChange` (terminate/expire), `export` (print/PDF download), template
`create`/`update`/`statusChange` + `templateCloned`.
Events (reliable tier): `hr.contract.generated`, `hr.contract.terminated`,
`hr.contract.expired` — public integration surface for Payroll/Attendance later.

### D11 — Expiry sweep + notifications

Scheduled task `hr.contracts.expirySweep` (hourly, like offers): fixed-term contracts past
`endDate` → `expired` + event + audit. Setting `contracts.expiryNoticeDays` (default 30):
the sweep also notifies `contract.view` holders about contracts ending within the window
(template `hr.contract.expiringSoon`, admin-editable) — once per contract.

### D12 — Employee page & integrations

The Employee profile gains a read-only **Contracts tab** (list of that employee's
contracts, linking into the module) — the module remains the single writing surface.
Creation pre-fills salary from the employment record (which Stage-5 seeded from the
accepted offer snapshot). Payroll (future) consumes `hr.contract.*` events and the
active-contract query — no redesign expected.

## 3. API surface (summary)

| Endpoint | Permission | Purpose |
|---|---|---|
| `GET /hr/contracts` (+filters employee/type/status/date) | contract.view | list |
| `POST /hr/contracts` | contract.create | create **draft** (employee + template + type + dates + overrides) |
| `GET /hr/contracts/:id` | contract.view | detail incl. snapshot metadata |
| `POST /hr/contracts/preview` | contract.create | live render (draft or ad-hoc) — never persisted |
| `POST /hr/contracts/:id/generate` | contract.generate | freeze snapshot + activate + queue PDF |
| `GET /hr/contracts/:id/document` | contract.print | the stored snapshot HTML (print view) — audited |
| `GET /hr/contracts/:id/pdf` | contract.print | signed-URL redirect to the stored PDF — audited |
| `POST /hr/contracts/:id/amend` / `/renew` | contract.amend / contract.renew | new version / linked new contract (draft) |
| `POST /hr/contracts/:id/terminate` | contract.terminate | reason + date |
| `DELETE /hr/contracts/:id` | contract.create | drafts only |
| `GET/POST/PATCH /hr/contract-templates` + `/:id/clone` + `/:id/archive` | contractTemplate.manage | template CRUD (versioned) |
| `GET /hr/contract-variables` | contractTemplate.manage ∪ contract.create | the variable-browser catalog |
| `GET/POST/PATCH /hr/contract-types` | contractType.manage | contract-type catalog |

## 4. Web UX

- **`/contracts`** — list page per the requirement: Employee, Contract Type, Version,
  Status, Start Date, End Date + row actions **Preview / Print / Download PDF / Amend /
  Renew / Terminate** (permission- and state-gated); filters (employee, type, status,
  expiring-soon); create entry.
- **`/contracts/new`** — two-pane creation: left = employee picker (preselected when
  arriving from the employee profile), template + type + dates + per-variable overrides;
  right = **live preview** (debounced server render, A4 iframe). Generate = confirm dialog
  → snapshot → detail page.
- **`/contracts/:id`** — detail: snapshot viewer, lifecycle timeline (versions chain),
  actions.
- **`/contracts/templates`** — template list (status/language/type) with Create / Edit /
  **Clone** / **Archive**; **`/contracts/templates/:id`** — the D7 editor: structured
  sections, logo upload, signature blocks, variable browser, live sample preview (rendered
  with sample data).
- Full ar/en i18n; the RENDERED document follows its template's language/direction.

## 5. Test plan (integration, mirrors prior modules)

Template lifecycle (create → version-on-edit → clone → archive; sanitization; unknown
placeholder rejected) · contract flow (draft → preview → generate: snapshot frozen,
variables resolved, one-active rule) · **immutability proof**: edit the template after
generation → stored snapshot byte-identical, new contract uses the new version · amend/
renew chains · terminate + expiry sweep + expiring-soon notice · permission matrix ·
missing-variable blocking · print/download audit (`export`) · employee-tab read view.

## 6. Non-goals (this phase)

E-signature, approval chains (Workflow module later), payroll calculations, bulk
generation, DOCX import/export, historical back-dating rules beyond start/end dates.

## 7. Open questions for the approver — RESOLVED (Revision 1)

- **Q1 (D8): approved** — server-side PDF via headless Chromium in the worker.
- **Q2 (D4): confirmed** — one language per template; clone for other languages.
- **Q3 (D3): confirmed** — one active contract per employee per contract type.

## 8. Revision 1 — approver amendments (A1–A12)

### A1 — Configurable contract numbering

The number format becomes an org **setting** `contracts.numberFormat` — a pattern of
tokens `{prefix}`, `{year}`, `{seq}` with configurable prefix and sequence padding
(default `ECMS-CON-{year}-{seq:6}` → `ECMS-CON-2026-000001`). The sequence stays a single
atomic counter per year (`hr_sequences`, like offers/employees). A format change affects
**future** contracts only; every issued number remains immutable forever (D2). The
rendered number is also a placeholder (`{{contract.code}}`, D5).

### A2 — Template-version permanence (confirmed hard invariant)

Restates D9 as an approver requirement: a generated contract **permanently references the
exact template version** (`templateId` + `templateVersion`); editing a template creates a
new version consumed only by future generations — no code path can re-render or relink an
issued contract.

### A3 — Variable snapshots (confirmed hard invariant)

Besides `renderedHtml`, the contract permanently stores the **full resolved variable map**
used at generation (D2 `variables`), now with per-variable **provenance** — each entry
records its source (`employee` / `employment` / `organization` / `contract` / `manual
override` + who overrode). Future audits can explain where every printed value came from.

### A4 — Immutability of Signed / Archived contracts

The D3 machine gains two states:

```
draft ─(approve, A7)─▶ active ─sign─▶ signed ─archive─▶ archived
```

- **`signed`** — the manual signature record for phase 1 (A5): each D4 signature block is
  marked signed (who recorded it, when, optional scanned signed copy as an attachment —
  A6). All blocks signed ⇒ contract `signed`.
- **`archived`** — terminal filing state for superseded/terminated/expired contracts.
- From `signed` or `archived` the contract is **fully immutable** — document, metadata and
  dates. The only permitted operations are the lifecycle transitions themselves:
  **amend/renew produce a NEW version/contract** (each with its own snapshot); terminate
  records the termination on top without touching the document. Direct edits are refused
  (`CONTRACT_IMMUTABLE`, 422).

### A5 — Electronic-signature future-proofing

Signature capture goes behind a **provider seam** (`signature-provider.ts`, mirroring the
storage/WhatsApp driver pattern): `manual` (phase 1 — HR records physical signatures) and
future `docusign` / `adobesign` drivers implementing `initiate(contract, signers)` +
`handleCallback(webhook)`. The contract's signer records (block, status
`pending`/`signed`/`declined`, method, `signedAt`, evidence file, provider envelope id)
are provider-agnostic, so integrating a provider changes **no lifecycle state or schema**
— only a new driver + its webhook route.

### A6 — Attachments (platform Files)

Contracts carry categorized attachments — NDA, annex, scanned signed copy, approval
document, other — through the **existing Files service** (upload validation, signing,
retention, audit all inherited; a seeded `hr.contract` file category). Attachments are
addable in every state (they never mutate the contract document); removal is blocked once
the contract is `signed`/`archived` except by `contract.terminate`-level permission, and
always audited.

### A7 — Approval compatible with the Workflow Engine (ADR-011)

Phase 1 ships a **single-step approval gate**: `draft → (submit) → pendingApproval →
(approve/reject: permission `contract.approve`) → approved → generate`, toggled by the
org setting `contracts.requireApproval` (default **on**; off ⇒ draft generates directly).
The approval record is stored as **workflow-shaped steps**
(`[{step, decidedBy, decision, note, at}]`) and emits `hr.contract.approvalRequested` /
`hr.contract.approvalDecided` — when the Workflow Engine lands, it replaces the
*driver* of this gate (who decides and in what order) while statuses, records and events
stay identical. No redesign.

### A8 — Employee timeline

Every lifecycle event — created, approved, signed, generated, renewed, amended,
terminated, expired, archived — is recorded **twice**: the audit entry on the contract
(D10) and an **activity entry on the Employee** (`hr.contract.*` message keys), exactly
how personnel actions surface. Contracts therefore appear in the Employee timeline and
the Electronic Employee File automatically.

### A9 — Leave boundary (read-only)

Leave Management **never** writes to contracts, and Contracts never mutates leave.
Contracts may *read* leave data solely for reporting/rendering (e.g. a future report
placeholder); the dependency direction is one-way and report-only.

### A10 — Payroll reads snapshots, never live data

Payroll (future) consumes **contract compensation snapshots** — the A3 frozen variable
values (`salary.basic`, `salary.currency`, allowances when added to the catalog) of the
relevant contract version — never mutable employee/employment records. The module exposes
`GET /hr/contracts/active-snapshot?employeeId&at=` (the contract version in force at a
date) plus the `hr.contract.*` events. Compensation used by a past payroll run stays
historically stable by construction: amendments create new versions; old snapshots never
change.

### A11 — Server-side PDF only (security invariant)

PDFs are generated **exclusively server-side** (worker, Q1) from the **stored, sanitized
snapshot** — the API accepts no client-supplied HTML anywhere: preview renders
server-side from the saved template + server-resolved variables (D6), generation freezes
the server render, and the PDF job reads only the stored snapshot. A browser can
therefore never alter contract content ahead of PDF generation.

### A12 — Search + reference number

The contract gains an optional **`referenceNumber`** (free external/manual reference,
searchable). `GET /hr/contracts` supports free-text `search` across **contract number,
employee name + employee code, and reference number** (indexed), combined with the
structured filters **contract type, status, start/end date ranges** — same pattern as the
employees/offers lists.

## 9. Revision 2 — final amendments (A13–A22)

### A13 — Asynchronous generation

`POST /hr/contracts/:id/generate` performs only the synchronous, cheap part — variable
resolution + validation (A16) and the snapshot freeze — then **enqueues** the document
job and returns immediately. The contract carries a **generation state**
(`generation.status`: `queued` → `rendering` → `completed` | `failed` + `error`), polled
by the UI to show progress; the PDF is produced in the **worker** (D8/A21). Large
templates never block an API request; a failed job is retryable (`/generate/retry`)
without touching the frozen snapshot.

### A14 — PDF integrity metadata

Every generated PDF embeds (document info + a footer line): generation timestamp,
**generator version** (platform version + renderer identifier), template version,
contract version, and the **SHA-256 hash of the stored snapshot HTML**. The same fields
are persisted on the contract (`generation.integrity`) so a future verification tool can
recompute and compare without opening the PDF.

### A15 — One immutable file per contract version

Each generation/amendment writes a **new** Files record — never a replacement. The
contract version keeps its `pdfFileId` forever; an amendment's new version gets its own
file. Files-service retention/immutability applies; nothing in the module can overwrite
a stored document.

### A16 — Variable validation (fail loud, never silent)

Generation resolves **every placeholder used by the pinned template version** and fails
with a structured **validation report** (`[{placeholder, source, reason}]`, error
`CONTRACT_VARIABLES_MISSING`, 422) when any required value is absent — an unresolved
`{{…}}` can never reach a rendered document. The create screen surfaces the report next
to the fields; manual per-variable overrides (A3) are the escape hatch.

### A17 — Template publishing gate

Template versions carry `draft → published → archived`. **Only a `published` version can
generate** (draft versions render sample previews only); editing a published version
creates the next `draft` version — publishing it never touches contracts generated from
earlier published versions (A2). Archiving hides a template from new drafts; history
stays.

### A18 — Preview ≡ final document

One rendering path (D6/A11): the preview endpoint and the PDF job consume the **same
server-side renderer and the same print stylesheet** — the PDF is chromium printing the
exact HTML the preview iframe shows (same page box, fonts, margins). Pixel parity is a
test-guarded invariant, not an aspiration: preview output and the PDF job's input are
byte-identical HTML.

### A19 — Template audit trail (recoverable history)

Every template edit records who/when/what: the append-only version chain (D4) keeps
every prior version **readable and restorable** (restore = clone an old version into a
new draft), and each version stores `changedBy`/`changedAt` + an audit entry with the
field-level diff. Nothing about a template's history is ever deleted.

### A20 — Storage layout (snapshot + PDF together)

The contract version stores the rendered **HTML snapshot** (source of truth) alongside
the generated **PDF file** (A15). Every future export — reprint, re-download, future
formats — reads the stored snapshot/PDF; **no export path regenerates from mutable
data**, ever.

### A21 — Deterministic, print-ready PDFs

A4 with fixed margins, **embedded fonts** (bundled Arabic + Latin faces shipped with the
renderer — no system-font dependence), deterministic chromium print settings
(`printBackground`, fixed scale, no headers/footers beyond the A14 integrity line) so the
same snapshot yields the same document on every environment.

### A22 — Stable query service (no direct table reads)

Consumers (Payroll, Employee Files, Workflow, Document Management) integrate ONLY
through the module's **query seam** (`contract-query.service.ts` behind the module
barrel) — `activeSnapshotAt(employeeId, date)`, `listForEmployee`, `getSnapshot(id)` —
plus the `hr.contract.*` events. The collections are module-private; the seam's DTOs are
the compatibility contract.

## Review trail

**Revision 2 (2026-07-26) — DESIGN FROZEN:** final amendments A13–A22 incorporated
(async generation with UI progress, PDF integrity metadata incl. SHA-256, one immutable
file per version, loud variable validation, template publishing gate, preview ≡ PDF
parity, recoverable template audit trail, snapshot+PDF storage with no regeneration on
export, deterministic A4/embedded-font output, stable query seam). Q1–Q3 re-confirmed.
Implementation approved.

**Revision 1 (2026-07-26):** Q1 approved (worker-side chromium PDF), Q2 confirmed
(one language per template + clone), Q3 confirmed (one active contract per employee per
type) — and twelve amendments incorporated (§8): configurable numbering format,
template-version permanence, variable snapshots with provenance, signed/archived
immutability, e-signature provider seam, Files-backed attachments, Workflow-compatible
approval gate, employee-timeline activity entries, read-only Leave boundary,
snapshot-based Payroll reads, server-side-only PDF, and full search + reference number.
**Awaiting the approver's freeze.**
