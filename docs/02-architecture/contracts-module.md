# Contracts Module — Architecture

> Companion to the frozen design (`docs/12-planning/contracts-module-design.md`, Revision 3 —
> freeze confirmed by the approver), which remains the single source of truth for the business
> rules and the recorded decisions (D1–D12, A1–A26, Q1–Q3, R1–R8). This page maps the design
> onto the codebase.

## Placement

| Feature | Owns | Collections |
|---|---|---|
| `hr/contracts/contract-types` | The reference catalog: `allowsEndDate`, the Q3 `multipleActiveAllowed` override | `hr_contract_types` |
| `hr/contracts/contract-templates` | One document per template VERSION (append-only chain per `key`), sanitized sections, the A17 draft/published/archived gate, clone (Q2), archive | `hr_contract_templates` |
| `hr/contracts/contracts` | The Contract aggregate: lifecycle engine, numbering (A1), variable resolution (A3/A16), the ONE renderer (A18), async PDF job (A13), sweeps (D11), the A22 query seam | `hr_contracts` (+ the shared `hr_sequences` counters) |
| `hr/contracts/shared` | The server-owned variable catalog (D5) + the allow-list HTML sanitizer (A11) | — |
| `hr/contracts/branding` | The A24 company branding singleton (logo via public-visibility Files, header/footer lines, watermark, brand color) applied at every render and frozen into snapshots | `hr_contract_branding` |

Dependency direction stays acyclic: `contracts → employee-management → platform`. Platform
touchpoints are seams, not imports of infrastructure: the chromium driver lives behind
`platform/pdf` (`CHROMIUM_PATH` env; empty = disabled → print-view fallback), PDFs and
attachments are stored through the platform **Files** service, notifications through the
notification templates catalog, and the async hop rides the reliable event tier.

## The lifecycle in one paragraph

A draft freezes nothing: it holds the employee/type/template references, dates, reference
number and manual overrides, and receives its immutable `code` from the configurable
`contracts.numberFormat` pattern over a per-year atomic counter (A1). If
`contracts.requireApproval` is on (default), the draft passes the workflow-shaped
single-step approval (A7) — rejection returns it to draft with the decision recorded.
**Generate** pins the template key's PUBLISHED version (A17), resolves every placeholder
with provenance (A3) — refusing loudly with the structured report when a required value is
empty (A16) — renders the snapshot through the one renderer (A18), computes its SHA-256
(A14) and stores everything on the contract (A20), then emits the reliable
`hr.contract.renderRequested` event. The **worker** consumes it, injects the integrity
line, renders the PDF via chromium and stores ONE immutable Files record per contract
version (A15); with the driver disabled generation completes without a PDF and the print
view remains the export path (D8). Signing is per template block (A5, manual driver);
when every block is signed the contract is SIGNED and — like archived — refuses every
direct edit with `CONTRACT_IMMUTABLE` (A4). Amend spawns the next version of the SAME
code, renew a NEW linked contract (D9); generating the successor supersedes the
predecessor. The hourly sweep expires overdue contracts and the daily sweep sends the
expiring-soon notice exactly once per contract (D11).

## Invariants enforced in code

- **A2/A20 — snapshot permanence**: `renderedHtml`, `variables` and `generation.integrity`
  are written once at generation; every export (`GET /:id/document`, the PDF job) reads the
  stored snapshot — there is no re-render path.
- **A17 — publish gate**: `publishedVersionOf()` throws `CONTRACT_TEMPLATE_NOT_PUBLISHED`;
  editing a published version forks the next draft version (A19) — the chain is
  append-only and every version remains readable.
- **Q3 — one active per employee per type** unless the type opts out
  (`multipleActiveAllowed`), checked against every non-terminal status.
- **A16 — loud validation**: `CONTRACT_VARIABLES_MISSING` carries the placeholder list;
  broken referents (deleted branch, unset organization) resolve to empty and surface the
  same way instead of a 500.
- **A11 — no active content**: the allow-list sanitizer strips script-like containers WITH
  their content on every template save; the toolbar exposes only what survives.
- **A23 — verifiable documents**: every PDF carries a QR encoding
  `{WEB_PUBLIC_URL}/verify/contract?code=…&key={sha256}`; the PUBLIC endpoint
  `GET /hr/contracts/verify` answers with a non-PII verdict, and the public web page at
  `/verify/contract` renders it. The QR (like the A14 integrity line) is a PDF-time
  augmentation — the stored snapshot's hash stays verifiable.
- **A25 — rendering audited**: the worker job records `contractRendered`
  (pdfStored / completedNoPdf / failed) on every run, completing the R6 inventory.
- **A26 — renderer abstraction**: the domain calls only `platform/pdf`; Chromium lives in
  `infrastructure/pdf` behind `CHROMIUM_PATH`. Another renderer is an infrastructure swap.

## Integration surface (A22)

Consumers never read the collections. They get:

- `contractQueryService` — `activeSnapshotAt(employeeId, at)`, `listForEmployee`,
  `getSnapshot` returning `ContractSnapshotDto` (variables + integrity included) — the
  Payroll/Employee-Files/Workflow/Document-Management read contract.
- Events — `hr.contract.{generated,approvalRequested,approvalDecided,signed,amended,renewed,terminated,expired}`.
- The employee timeline (A8) — every lifecycle step lands as an activity on the employee.

## Web app

`/contracts` (register + row actions), `/contracts/new` (two-pane creation with the
debounced SERVER preview — the same renderer that freezes the snapshot), `/contracts/:id`
(snapshot viewer, actions, chain), `/contracts/templates` (+ types catalog panel) and
`/contracts/templates/:id` — the D7 TipTap editor whose toolbar mirrors the sanitizer
allow-list, with the variable browser inserting `{{key}}` at the caret and a sample-data
server preview (`POST /hr/contracts/preview` without `employeeId`). The employee profile
gains a lazy **Contracts** tab.
