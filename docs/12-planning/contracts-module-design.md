# Contracts Module — Architecture & Design (for approval)

**Status: DRAFT — awaiting approval.** Design-phase only (like Leave Management and
Authentication): nothing here is implemented until the approver freezes this document.
Amendments are recorded as numbered revisions in the review trail.

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

## 7. Open questions for the approver

- **Q1 (D8):** approve the server-side chromium PDF in the worker (recommended), or ship
  phase 1 with the print-view-only fallback and add the PDF job later?
- **Q2 (D4):** template languages — confirm one-language-per-template (clone for the
  other) over a single bilingual template.
- **Q3 (D3):** confirm one-active-contract-per-type default (with the catalog override
  flag) matches EGYCASH's practice.

## Review trail

*(empty — awaiting first review)*
