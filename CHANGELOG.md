# Changelog

All notable changes to the ECMS Platform are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions
follow the platform-manifest semver described in
[Development Workflow §6](docs/09-guides/development-workflow.md). Each sprint-closing PR adds
its entry here in the same PR.

## [Unreleased]

### Added

- **HR Foundation — Phase 2: Platform Identity & Organizational Access Control** (ADR-017). Permanent
  platform infrastructure every future module reuses:
  - **Hierarchical data scope.** The visibility ladder extends from `own | branch | organization` to
    **`own(Self) ⊂ section ⊂ department ⊂ branch ⊂ organization(Company)`**, enforced in the single
    existing place (`BaseRepository.scopeFilter`). Collections opt into finer scopes by declaring
    `departmentField`/`sectionField`; Users and Employees now scope by the full hierarchy. Role
    assignments, `AuthContext` and `ScopeSelector` carry department/section. Fully backward
    compatible — existing grants keep working; **no permission changes**.
  - **Login account ← Employee.** Every login belongs to exactly one Employee (`User.employeeId`,
    unique; `Employee.userId` back-reference). Create a login from the employee
    (`POST /hr/employees/:id/login`); the **username defaults to the Employee Code** and is editable;
    login now accepts **username OR email** (email retained). Departing employees are disabled, not
    deleted.
  - **Permanent Global Employee Number + branch-derived Employee Code.** The **Global Employee
    Number** (e.g. `000125`) is the permanent identity — a single **global**, concurrency-safe atomic
    sequence (reusing the existing `hr_sequences` `$inc` primitive), never reused, never changed. The
    displayed **Employee Code** is derived as **`<CurrentBranchCode><GlobalEmployeeNumber>`**
    (e.g. `001000125`); on a branch transfer only the prefix changes (`004000125`) while the number
    stays fixed. Never manually editable.
  - **Branch Code** stays required/unique/immutable, now correctable by a **super-admin**
    (`PATCH /platform/branches/:id/code`).
  - **Minimal UI** on the Employee detail (`EmployeeAccountCard`): shows Employee Code + Branch Code,
    creates the login, edits the username, shows the account's data scopes.
  - **Future-proof:** employment carries optional `sectionId` + `jobPositionId` (null until set), so
    an employee can later belong to Branch → Department → Section → Job Position with no schema change
    — without ever forcing a vacancy link (ADR-016 Talent Pool preserved).
- **Organization Management UI — Phase 3.1: Branches Management.** A dedicated Branches admin that
  completes the branch surface on top of the existing `platform/organization` backend:
  - **Branches list.** Columns per spec — **Branch Code, Arabic Name, English Name, Status, Created
    At, Updated At** — with free-text **search** (code or name), a **status** filter, **pagination**
    and sortable code/status/created columns, all URL-synchronized. Each row carries an inline
    **Activate/Deactivate** toggle (version-checked, gated on `branch.edit`).
  - **Branch detail.** Identity (Code, ar/en names, manager), address and audit timestamps, with
    **Edit**, **Activate/Deactivate** and **Delete** (soft, guarded against branches that still have
    departments). The **Branch Code** stays immutable after creation and is editable **only by a
    super-admin** through a dedicated correction dialog (`isPrivileged`, `PATCH
    /platform/branches/:id/code`, ADR-017).
  - **Duplicate protection.** Branch **names** join branch **codes** as unique (case-insensitive, ar
    or en); a collision surfaces as a `409` conflict. `GET /platform/auth/me` now returns
    `isPrivileged` so the web can gate the super-admin-only Branch-Code action. No new backend
    endpoints, permissions or events; audit fields and soft-delete are unchanged.
- **Organization Management UI — Phase 3.2: Departments Management.** A dedicated Departments admin
  on the same `platform/organization` backend. Each department belongs to exactly one branch and is a
  **platform-wide** unit (not HR-only):
  - **Departments list.** Columns per spec — **Branch, Arabic Name, English Name, Status, Created At,
    Updated At** — with a **branch** filter (server-side `?branchId=`), free-text **search**, a
    **status** filter, **pagination** and sortable status/created columns, all URL-synchronized. Each
    row carries an inline **Activate/Deactivate** toggle (version-checked, gated on `department.edit`).
  - **Department detail + form.** Identity (Code, ar/en names, **Description**, manager), the owning
    Branch (linked), path and audit timestamps, with **Edit**, **Activate/Deactivate** and **Delete**
    (soft, guarded against departments that still have sections). The create/edit form gains an
    optional bilingual **Description** field.
  - **New `description` field.** Departments gain an optional bilingual `description` (contracts +
    model + DTO). The generic org-unit **update** now persists per-unit columns via a `buildUpdateSet`
    seam — which also **fixes branch `address`** being editable only at creation. No new endpoints,
    permissions or events; audit fields and soft-delete unchanged.

### Documented

- **ADR-017** — Platform Identity & Organizational Access Control.
- **`docs/02-architecture/platform-identity.md`** — the Phase-2 design.
- **`docs/02-architecture/organization-structure.md` §6** — *Organization vs Navigation: two
  independent hierarchies.* Records that the Company → Branch → Department → Section (→ Job Position/
  Employee) hierarchy governs **data scope, HR, reporting and approvals only** and **does NOT
  generate the sidebar**; that Departments are a **platform-wide** concept (never HR-only); and that
  the **Sidebar is generated from the Applications (Modules) assigned to the user** — a separate,
  deferred track keyed off *Applications × Roles*, with the org tree supplying data scope only. The
  Organization module stays free of any navigation logic (verified in the current code).
- **`docs/02-architecture/organization-structure.md` §7** — *Access & Applications model (locked; not
  implemented).* Locks three forward rules so Organization Management does not foreclose them:
  **Applications ↔ Departments is many-to-many** (Departments consume Applications; an Application
  serves many Departments); a user's Applications are **derived** via **User → Job Position →
  Department → Applications → Roles** (with an optional direct user assignment kept possible as an
  exception); and **Job Positions are Department-owned, never Section-owned** (Sections are
  subdivisions; an Employee belongs to a Section but holds a Department's Job Position). Confirms the
  current models already leave room for all three — no code change.

## [0.23.0] - 2026-07-21

Release v0.23.0 — Sprint 5.11: **HR Foundation — Phase 1: Organization Structure**
([PR #54](https://github.com/egycashcompany-ops/egycash/pull/54)). Delivers the master
organizational model every future module reuses — **Company, Branches, Departments, Sections and the
Job Titles catalog** — built on the existing `platform/organization` backend (ADR-015). **Phase 1 is
complete and released.** Job Positions and Job Requisitions are **intentionally deferred** to later
phases; Job Titles remain an **organization-wide catalog**; and per **ADR-016** (now the governing
decision) applicants are **never required** to be linked to a Job Position or Job Requisition — the
**Talent Pool is first-class**.

### Added

- **HR Foundation — Phase 1: Organization Structure.** The master organizational model that every
  future module reuses, built on the existing `platform/organization` backend (ADR-015):
  - **Organization admin (web).** A new lazy module at `/organization` to manage the **Company**
    profile and the **Branch → Department → Section** hierarchy plus the org-wide **Job Titles**
    catalog — list/detail/create/edit/delete, all RBAC-gated, version-checked, with URL-synced
    filters, i18n + RTL. Branch/Department/Section share **one generic Unit\* implementation**
    configured per unit (mirroring the backend `makeOrgUnitHandlers` factory). No new backend
    endpoints, permissions or events were introduced.
  - **Enriched Job Titles.** Job Titles gain `jobGrade` (required), `description`, `salaryMin`,
    `salaryMax`, `requiredQualifications` and `requiredExperienceYears` (all optional). The salary
    band must satisfy `min ≤ max`, enforced by the schema and by a merged-state check on partial
    updates. Job Titles remain an **organization-wide catalog** — not tied to any Branch/Department/
    Section (that linkage is the future Job Positions' concern).

### Documented

- **ADR-016** — Job Positions & Job Requisitions are **OPTIONAL** for applicants; the **Talent Pool**
  is a first-class state that no future module may break.
- **`docs/02-architecture/organization-structure.md`** — the Phase-1 design and the phase roadmap
  (Organization Structure → Job Positions → Job Requisitions → Recruitment integration).

## [0.22.0] - 2026-07-21

Release v0.22.0 — Sprint 5.10: **HR / Recruitment — Pipeline flow & applicant lifecycle**
([PR #51](https://github.com/egycashcompany-ops/egycash/pull/51) +
[PR #52](https://github.com/egycashcompany-ops/egycash/pull/52)). Makes the finished seven-stage
module behave as a continuous pipeline **without changing the existing workflow, permissions or
create/decide flows** — visibility is derived from the applicant's current state, never from
placeholder records.

### Added

- **Auto-appearing stage queues (derived read models).** Applicants surface in the next stage
  automatically, computed server-side rather than via fabricated records:
  - **Awaiting screening** (`GET /hr/screenings/awaiting`) — live applicants (`new`) with no
    screening yet; a panel on the Screening queue opens the existing Start-screening dialog.
  - **Awaiting scheduling** (`GET /hr/interviews/awaiting`) — applicants who passed Initial
    Screening, still live, with no interview yet (active + accepted screening − already-interviewed,
    so withdrawn/rejected never appear); a panel on the Interviews queue opens the existing Schedule
    dialog. Both are read-only endpoints; no writes, no duplicate records.
- **Withdraw / restore from any stage.** A shared `ApplicantLifecycleActions` control (Withdraw
  while `new`, Restore while `withdrawn`) on the applicant detail **and** every pre-hire stage detail
  page (Screening, Interviews, Job Offer). Withdraw/restore invalidate the awaiting subtrees so the
  derived queues refresh immediately. (Intentionally not exposed on the post-hire stages — Employees,
  Hiring Documents, Electronic Employee File — the person is already an employee there.)
- **Applicant restore** (`POST /hr/applicants/:id/restore`, `applicant.edit`, version-checked → status
  `new`, emits `hr.applicant.restored`). Restored applicants **resume from the exact stage they left**
  (derived visibility), and **all history is preserved** — screening decisions, interviews, offers,
  audit and timeline records are never deleted or recreated.

### Changed

- **Optional interview committee** — `ScheduleInterview.interviewerIds` now defaults to `[]`; an
  interview can be scheduled before a committee is assigned, with members added later via the
  reassign-panel action. Validation, version checks and cache behaviour unchanged.

### Notes

- **No new runtime dependencies.** Backend additions are two read-only "awaiting" endpoints and the
  restore endpoint/event; no existing API, permission, versioning or event was changed. Verified via
  web typecheck, repo lint, vite build (recruitment stays a lazy chunk), permission-matrix +
  flag-expiry checks, and backend unit + integration specs (auto-appear queues incl. exclusions,
  empty-committee schedule, restore lifecycle, and exact-stage resume). No web unit-test runner yet
  (backlog: Vitest + React Testing Library).

## [0.21.0] - 2026-07-21

Release v0.21.0 — Sprint 5.9: **HR / Recruitment — Applicants intake improvements + reusable
National-ID OCR** ([PR #49](https://github.com/egycashcompany-ops/egycash/pull/49)). The first
**polish** sprint on the completed Recruitment module — no new stage, an enhancement to the
existing Applicants intake.

### Added

- **Reusable National-ID OCR flow (`apps/web/src/shared/national-id/`).** A module-agnostic
  capture → review flow, reusable by Employees / KYC / any future module by injecting an
  *extractor* (no HR coupling): `NationalIdOcr` (two upload areas — **front + back** — read
  together in one extraction pass), a **dedicated `NationalIdReviewDialog`** showing **every**
  extracted field editable (birth date / gender / governorate derived live from the number and
  read-only), plus pure `mapping` + `transliterate` helpers and typed `NationalIdReviewData` /
  `NationalIdExtractor`. Generic `nationalIdOcr.*` i18n (`ar` + `en`).
- **Applicant identity: `religion` + `nationalIdExpiry`** — new nullable fields read from the ID
  card (contract + model + service + mapper).

### Changed

- **Applicants create — direct intake.** The Job Request is now **optional**: an applicant can be
  registered directly from the Applicants screen with no linked requisition. `jobRequisitionId` is
  **nullable end-to-end** (applicant → employee → employee-file all tolerate `null`); when a
  requisition is supplied it is still validated (malformed ids rejected), and the reference can be
  attached later when the Job Requests module lands.
- **National-ID capture flow.** Upload front → upload back → **Extract** → the dedicated review
  dialog → edit → **Confirm** → *only then* the Applicant form is populated. Birth date / gender /
  governorate are **derived** from the number (`parseNationalId`), never OCR'd; the English name is
  seeded by transliterating the Arabic name (editable). Replaces the single-image OCR assist.

### Notes

- No new runtime dependencies and **no new backend endpoint** — the OCR extraction DTO was widened
  with the card fields and the applicant identity gained two fields. Verified via web typecheck,
  repo lint, and vite build (recruitment stays a lazy chunk); backend unit + integration specs
  extended (direct intake with no requisition; OCR extraction shape; null-requisition mappers). No
  web unit-test runner yet (backlog: Vitest + React Testing Library).

## [0.20.0] - 2026-07-13

Release v0.20.0 — Sprint 5.8: **HR / Recruitment — Electronic Employee File Frontend (Phase 8)**
([PR #47](https://github.com/egycashcompany-ops/egycash/pull/47)), the **seventh and final**
Recruitment feature screen set. **With this release all seven recruitment stages run in the UI on
the single Phase 1 foundation.**

### Added

- **HR / Recruitment: Electronic Employee File frontend (`apps/web`).**
  - **List** (`employeeFile.view`) — sortable `DataTable` (employee `code`, created — the backend's
    sortable fields); filters (a **free-text search** over employee number / applicant code +
    status); `Pagination`. Search, status, sort and pagination are **URL-synchronized**. An
    **Assemble file** action (`employeeFile.create`) opens a dialog to pick an employee whose hiring
    documents are complete (server-enforced; the employee search reuses the Employees list API).
  - **Detail** (`employeeFile.view`) — the **Employee Timeline** (shared `Timeline`) built from the
    recruitment milestones (`applicantRegistered` → … → `hiringDocumentsCompleted` → `fileOpened`)
    plus free-form notes, with an **add-note** form (`employeeFile.edit`, version-checked) appending
    to the timeline; and the **linked history** — deep-links into the applicant, screening,
    interview, job-offer and hiring-documents screens (the Job Requisition shows as a read-only
    reference). Each write seeds the detail cache + invalidates only the list subtree. `ar` + `en`
    i18n.
  - Removed the now-unused stage placeholder helper + `StagePlaceholder` (all seven stages are real
    screens).

### Changed

- **Recruitment frontend complete** — all seven stages (Applicants → Screening → Interviews → Job
  Offer → Employees → Hiring Documents → Electronic Employee File) run in the UI as one lazy route
  chunk. Post-hire employee-lifecycle concerns belong to the future Employee module.

### Notes

- No new runtime dependencies and **no new backend API**. Verified via web typecheck, repo lint, and
  vite build (recruitment stays a lazy chunk). No web unit-test runner yet (backlog: Vitest + React
  Testing Library) — the primary follow-up before declaring the module production-ready.

## [0.19.0] - 2026-07-13

Release v0.19.0 — Sprint 5.7: **HR / Recruitment — Hiring Documents Frontend (Phase 7)**
([PR #45](https://github.com/egycashcompany-ops/egycash/pull/45)), the sixth Recruitment feature
screen set on the Phase 1 foundation, reusing the shared file-management infrastructure
(`FileUpload`, the signed-URL download ticket, multipart `upload`). **Hiring Documents only** — the
Electronic Employee File remains the final phase.

### Added

- **HR / Recruitment: Hiring Documents frontend (`apps/web`).**
  - **List** (`hiringDocuments.view`) — sortable `DataTable` (employee `code`, created — the
    backend's sortable fields); filters (a **free-text search** over employee number / applicant
    code + status); `Pagination`. Search, status, sort and pagination are **URL-synchronized**. An
    **Open document set** action (`hiringDocuments.create`) opens a dialog to pick an employee
    (search reuses the Employees list API).
  - **Detail** (`hiringDocuments.view`) — a **per-type checklist** merging the active document-type
    catalog with the uploaded documents: each type shows uploaded/missing (required flagged), with
    **download** (signed-URL ticket, reused from Applicants attachments), **version history**,
    **replace**, and **upload** for missing types (`hiringDocuments.upload`, PDF-only via the shared
    `FileUpload` + multipart). **Complete** (`hiringDocuments.complete`) is blocked — with the
    missing-required banner — until every required document is present; once completed the set is
    read-only. All mutations version-checked; each write seeds the detail cache + invalidates only
    the list subtree. `ar` + `en` i18n.
  - The document-type catalog (`/hr/hiring-document-types`) is **consumed read-only** to label +
    require types; type administration is out of scope.

### Changed

- Recruitment now runs in the UI **through the Hiring Documents stage** (Applicants → Screening →
  Interviews → Job Offer → Employees → Hiring Documents); the Electronic Employee File is the final
  phase.

### Notes

- No new runtime dependencies and **no new backend API** — uploads/downloads reuse the existing
  Files service seams. Verified via web typecheck, repo lint, and vite build (recruitment stays a
  lazy chunk). No web unit-test runner yet (backlog: Vitest + React Testing Library).

## [0.18.0] - 2026-07-13

Release v0.18.0 — Sprint 5.6: **HR / Recruitment — Employees Frontend (Phase 6)**
([PR #43](https://github.com/egycashcompany-ops/egycash/pull/43)), the fifth Recruitment feature
screen set on the Phase 1 foundation, reusing the prior phases' building blocks (including the Job
Offer reference infrastructure). **Employees only** — no later stage.

### Added

- **HR / Recruitment: Employees frontend (`apps/web`).**
  - **List** (`employee.view`) — sortable `DataTable` (employee `code`, hired, created — the
    backend's sortable fields); `EmployeeFilters` (a **free-text search** over employee number /
    applicant code + status); `Pagination`. Search, status, sort and pagination are
    **URL-synchronized** (deep-linkable, back/forward). A **Hire employee** entry (`employee.create`).
  - **Hire / create** — the employment terms are **not** entered; they are copied server-side from
    the offer's immutable accepted snapshot. The page picks an **accepted offer** (an `OfferPicker`
    autocomplete reusing the Job Offer list API scoped to `status: accepted`) + an optional hiring
    date. The server enforces the full rule (accepted + snapshot + not already hired). The create
    write seeds the detail cache and invalidates only the list subtree.
  - **Detail** (`employee.view`) — the employee number, status, preserved references (applicant link
    + accepted-offer link with its revision), and the copied **employment terms** read-out. The
    employment view **reuses the Job Offer `UserName` + reference hooks** so org/manager names resolve
    from the same cache. `ar` + `en` i18n. The employee record is **read-only in this stage** — no
    lifecycle mutation is exposed (statuses exist in the DTO but transitions belong to a future
    Employee module).

### Changed

- Recruitment now runs in the UI **through the Employee stage** (Applicants → Screening → Interviews
  → Job Offer → Employees); Hiring Documents and Employee Files remain later phases.

### Notes

- No new runtime dependencies and **no new backend API**. Verified via web typecheck, repo lint, and
  vite build (recruitment stays a lazy chunk). No web unit-test runner yet (backlog: Vitest + React
  Testing Library).

## [0.17.0] - 2026-07-13

Release v0.17.0 — Sprint 5.5: **HR / Recruitment — Job Offer Frontend (Phase 5)**
([PR #41](https://github.com/egycashcompany-ops/egycash/pull/41)), the fourth Recruitment feature
screen set on the Phase 1 foundation, reusing the Applicants/Screening/Interviews building blocks.
**Job Offer only** — no later stage.

### Added

- **HR / Recruitment: Job Offer frontend (`apps/web`).**
  - **List** (`jobOffer.view`) — sortable `DataTable` (status, created — the backend's sortable
    fields); `OfferFilters` (a **free-text search** over offer number / applicant code + status + an
    active-only toggle); `Pagination`. Search, status, active, sort and pagination are
    **URL-synchronized** (deep-linkable, back/forward). A **New offer** entry (`jobOffer.create`).
  - **Create / revise** — the shared `OfferTermsForm` builds the versioned package (job title,
    department, branch, reporting manager, employment type, salary + currency, dynamic
    allowances/benefits, probation, start/validity dates, notes). Create picks an applicant first;
    revise edits a draft/sent offer's terms (`jobOffer.edit`, version-checked, history preserved).
    Client checks cover the required fields + `validUntil > startDate`; the server stays authoritative.
  - **Detail** (`jobOffer.view`) — the offer number, applicant link, status, the live package, the
    immutable **accepted-terms snapshot** and the **revision history**, plus the lifecycle actions:
    **send** (`jobOffer.send`), **accept / reject** (`jobOffer.respond`, reason required to reject),
    **withdraw** (`jobOffer.withdraw`), **revise** (`jobOffer.edit`) — each shown only in the states
    where it applies (draft·sent). All mutations version-checked; each write seeds the detail cache
    and invalidates only the list subtree; `STALE_DOCUMENT` surfaces via the standard global toast.
  - **References** reuse existing platform endpoints (**no new backend API**): the reporting manager
    via a `ManagerPicker` over `/platform/users` (`user.view`); job title / department / branch via
    the org list endpoints (`jobTitle.view` / `department.view` / `branch.view`). Raw ids are never
    entered; controls degrade to a hint without the relevant `*.view`. `ar` + `en` i18n.

### Changed

- Recruitment now runs in the UI **through the Job Offer stage** (Applicants → Screening →
  Interviews → Job Offer); Employees onward remain later phases.

### Notes

- No new runtime dependencies. Verified via web typecheck, repo lint, and vite build (recruitment
  stays a lazy chunk). Automatic offer expiry remains a backend scheduled sweep — the UI reflects the
  resulting `expired` status but does not drive it. No web unit-test runner yet (backlog: Vitest +
  React Testing Library).

## [0.16.0] - 2026-07-13

Release v0.16.0 — Sprint 5.4: **HR / Recruitment — Interviews Frontend (Phase 4)**
([PR #37](https://github.com/egycashcompany-ops/egycash/pull/37)), the third Recruitment feature
screen set on the Phase 1 foundation, reusing the Applicants/Screening building blocks — plus two
authentication **dev-login fixes** surfaced during review
([PR #38](https://github.com/egycashcompany-ops/egycash/pull/38),
[PR #39](https://github.com/egycashcompany-ops/egycash/pull/39)). **Interviews only** — no later
stage.

### Added

- **HR / Recruitment: Interviews frontend (`apps/web`).**
  - **Queue** (`interview.view`) — sortable `DataTable` (stage order, scheduled, created — the
    backend's sortable fields); filters (status + outcome + stage + an **applicant search-picker**
    resolving to `applicantId` + a scheduled-date range); pagination. Filters/sort/pagination are
    **URL-synchronized** (deep-linkable, back/forward). A **Schedule interview** action
    (`interview.create`) opens a dialog to pick applicant, stage, date/time, and panel.
  - **Detail** (`interview.view`) — the **panel with per-interviewer evaluation state**
    (recommend/neutral/notRecommend + rating + notes), the scheduling read-out, and the full action
    surface: **reschedule** + **reassign panel** (`interview.edit`), **skip** a pending interviewer,
    **submit/update your own evaluation** (`interview.evaluate`, assigned members only), **cancel**
    (`interview.cancel`), and **Pass / Fail** (`interview.decide`) — blocked with an inline notice
    while any panelist is still `pending`. All mutations version-checked; each write seeds the
    detail cache from the response and invalidates only the list subtree.
  - Interviewer references go through a **`UserPicker` / `UserName`** pair that reuses the platform
    Users endpoint (`user.view`) rather than exposing raw ids; degrades to a short reference without
    directory access. Feature `api/` layer + TanStack Query hooks against `/hr/interviews`
    (+ `/hr/interview-stages`, `/:id/reschedule|panel|panel/skip|cancel|evaluations|decide`);
    `ar` + `en` i18n. No new backend API.
- **Auth: scannable QR for TOTP enrollment**
  ([PR #38](https://github.com/egycashcompany-ops/egycash/pull/38)) — the mid-login 2FA enrollment
  step renders the backend-provided `otpauthUrl` as a QR code (Microsoft Authenticator / Google
  Authenticator / any TOTP app), with the manual base32 key kept as a collapsible fallback. Adds
  `qrcode.react` (inline SVG, no network request). Standard TOTP (RFC 6238); no backend change.

### Fixed

- **Dev login blocked by TOTP enforcement**
  ([PR #39](https://github.com/egycashcompany-ops/egycash/pull/39)) — every seeded account holds a
  system role (privileged), and `auth.totp.enforcedForPrivileged` defaults to `true`, so a fresh
  `npm run seed` produced accounts that could not complete an email/password login (login returned a
  TOTP enrollment challenge, not a session). The seed now disables enforcement at **organization**
  scope (dev/staging only; production keeps the default `true` and never runs the seed). The seed
  data moved to an importable, side-effect-free `seed-data.ts`, and an **integration regression
  test** exercises the real seed path and asserts a password-only login yields a token + working
  `/me` — failing if the enforcement-disable is ever removed.

### Changed

- Recruitment now runs in the UI **through the Interview stage** (Applicants → Screening →
  Interviews); Job Offer onward remain later phases.

### Notes

- One new web runtime dependency (`qrcode.react`). Verified via web typecheck, repo lint, and vite
  build (recruitment stays a lazy chunk), plus API typecheck/lint/build; the seed-login regression
  runs on CI's in-memory Mongo. No web unit-test runner yet (backlog: Vitest + React Testing
  Library).

## [0.15.0] - 2026-07-12

Release v0.15.0 — Sprint 5.3: **HR / Recruitment — Initial Screening Frontend (Phase 3)**
([PR #35](https://github.com/egycashcompany-ops/egycash/pull/35)), the second Recruitment feature
screen set, built on the Phase 1 foundation and reusing the Applicants building blocks.
**Screening only** — no later stage.

### Added

- **HR / Recruitment: Initial Screening frontend (`apps/web`).**
  - **Queue** (`screening.view`) — sortable `DataTable` (status, notes, decided, created); filters
    (status + created-date range + an **applicant search-picker** that reuses the Applicants list
    API and resolves to the `applicantId` filter — the screening list has no free-text field);
    pagination. Filters/sort/pagination are **URL-synchronized** (deep-linkable, back/forward). A
    **Start screening** action (`screening.create`) opens a dialog to pick a live applicant + an
    optional first note.
  - **Detail** (`screening.view`) — applicant link, the **notes + decision timeline** (shared
    `Timeline`), an **add-note** form while `pending` (`screening.edit`), and the **Accept / Reject**
    workflow (`screening.decide`) via a dialog — a reason is required to reject (OQ-32), optional to
    accept. All mutations version-checked.
  - Feature `api/` layer + TanStack Query hooks against `/hr/screenings` (+ `/:id/notes`,
    `/:id/decide`); `ar` + `en` i18n; permission-gated throughout.

### Notes

- No new runtime dependencies. Verified via web typecheck, repo lint, and vite build (recruitment
  stays a lazy chunk). No web unit-test runner yet (backlog: Vitest + React Testing Library).

## [0.14.0] - 2026-07-12

Release v0.14.0 — Sprint 5.2: **HR / Recruitment — Applicants Frontend (Phase 2)**
([PR #33](https://github.com/egycashcompany-ops/egycash/pull/33)), the first Recruitment feature
screen set, built on the Phase 1 foundation. **Applicants only** — no later stage. Approved with
no blocking comments after two review changes (URL-synced list state; placeholder reference
controls for cross-module IDs) folded in before merge.

### Added

- **HR / Recruitment: Applicants frontend (`apps/web`).**
  - **List** — sortable/selectable `DataTable`; multi-filter bar (search + status / source /
    intake channel / identity-verification / duplicates-only / has-files); `Pagination`;
    **bulk withdraw** (reason dialog); **CSV export**; create entry point — all permission-gated.
    Filters, search, sort and pagination are **synchronized with the URL query string**
    (deep-linkable, back/forward aware).
  - **Detail** — identity/contact/preferences/application read-out; **attachments** panel
    (upload with title+category, signed-URL download, remove); **verify-identity** and
    **withdraw** actions (version-checked).
  - **Create / edit** — comprehensive manual-entry form (context, identity, contact, addresses,
    preferences, education, military, experience, references, licenses, certifications) on the
    shared form primitives; server-authoritative validation surfaced in a summary;
    optimistic-concurrency-guarded edits.
  - **OCR assist** — upload a National-ID image → extraction seam → apply fields with confidence
    bands; degrades to manual entry when no provider is wired (OQ-30).
  - **Cross-module references** (Job Requisition, Branch) use placeholder reference controls
    (disabled "coming soon" selector, or a read-only chip when supplied by context via
    `?requisitionId=&branchId=`) — internal IDs are never editable fields.
  - Feature `api/` layer + TanStack Query hooks against the existing endpoints; `ar` + `en` i18n.
    Added `getPage` (pagination meta) and `downloadBlob` (CSV export) to the shared api-client.

### Notes

- No new runtime dependencies. Verified via web typecheck, repo lint, and vite build (recruitment
  stays a lazy chunk). No web unit-test runner yet (backlog: Vitest + React Testing Library).

## [0.13.0] - 2026-07-12

Release v0.13.0 — Sprint 5.1: **HR / Recruitment — Frontend Foundation (Phase 1)**
([PR #31](https://github.com/egycashcompany-ops/egycash/pull/31)). The reusable web foundation for
the Recruitment module — shell, shared UI kit, and platform integration — built foundation-first;
**no feature screen (Applicants included) is built here.** Approved with two backlog notes (add
Vitest + React Testing Library before the feature screens grow; revisit shadcn/ui later — the
current abstraction layer is acceptable).

### Added

- **HR / Recruitment: frontend foundation (`apps/web`).**
  - **App shell & layout** — generic `AppShell` (sidebar + topbar), RTL-safe and responsive
    (persistent rail on desktop, off-canvas drawer on mobile), breadcrumbs, page container/header.
  - **Theme** — light/dark/system (Tailwind class strategy, OS-reactive, persisted); brand token
    scale; **Arabic RTL** default with logical utilities throughout.
  - **Navigation & permission-aware routing** — `RequireAuth` + `RequirePermission` route guards,
    `Can`/`useCan` role-based UI, 403/404 pages, and the recruitment module **lazy-loaded**
    (route-based code splitting).
  - **Shared UI kit** (`shared/ui`, imported via barrel) — DataTable (sort/selection/state-aware),
    Pagination, SearchInput (debounced), FilterBar, BulkActions, Button, Field/Input/Textarea/
    Select/Checkbox/Form, Dialog, FileUpload, Badge/StatusBadge, Timeline, Card, Spinner/Skeleton,
    and Loading/Empty/Error/Success states.
  - **API layer & data** — typed REST + multipart client (in-memory token per ADR-006, silent
    refresh, envelope unwrap), error-code → localized message mapping, query-key factory, and
    **TanStack Query with global error handling**; client toast store + `Toaster`;
    `NotificationBell`; top-level `ErrorBoundary`.
  - **Recruitment module shell** — nav, permission-aware landing overview, and per-stage
    permission-gated placeholder routes for all seven stages (each real screen drops in by
    replacing one element).
  - **i18n** — `ar` + `en` catalog with `{{param}}` interpolation. Docs:
    [recruitment-frontend.md](docs/02-architecture/recruitment-frontend.md).

### Notes

- No new runtime dependencies; the existing React + Vite + RTK + TanStack Query + Tailwind stack
  was extended in place. Verified via web typecheck, repo lint, and vite production build (the
  recruitment module emits as a separate lazy chunk). No web unit-test runner yet (backlog:
  Vitest + React Testing Library).

## [0.12.0] - 2026-07-12

Release v0.12.0 — Sprint 4.7: **HR / Recruitment — Electronic Employee File (Stage 7)**
([PR #29](https://github.com/egycashcompany-ops/egycash/pull/29)), the **seventh and final stage**
of the approved seven-stage recruitment workflow and the handoff artifact to the (future) Employee
module ([BD-008](docs/01-domain/business-decisions.md#bd-008--hiring-transforms-applicant-to-employee-no-separate-onboarding-stage)).
Additive on Stage 6; **no part of the Employee module is built.** Merged after a self-conducted
architecture review ([review](docs/10-reviews/2026-07-architecture-review-employee-file.md); 18
findings, no Critical/High — all documented, no in-PR code change required).

### Added

- **HR / Recruitment: Electronic Employee File (Stage 7).** Once an employee's hiring documents
  are **completed**, their electronic file is **assembled once**.
  - **Electronic Employee File aggregate** (`hr_employee_files`) — **one file per employee**
    (partial-unique index), gated on the employee existing **and** its hiring documents being
    `completed`. **Links all applicant history** (applicant, job requisition, screening,
    interviews, job offer, hiring documents) and builds the **initial Employee Timeline** from the
    recruitment milestones (applicant registered → screening accepted → each interview passed →
    offer accepted → employee created → hiring documents completed → file opened), ordered
    chronologically.
  - **Timeline notes** — free-form notes can be appended to the timeline (optimistic-concurrency
    guarded). Status `active` / `archived`.
  - Publishes `hr.employeeFile.{created,noteAdded}`, **notifies** the reporting manager + the
    assembler on assembly, and **audits** every operation. Permissions
    `employeeFile.{view,create,edit}`; routes `/api/v1/hr/employee-files` (+ `/:id`, `/:id/notes`).
  - Cross-feature history is read through feature barrels only (ADR-003); new read hooks
    `interviewService.listByApplicant` and `hiringDocumentsService.findByEmployeeId`.
- **BD-008 — Hiring transforms Applicant to Employee; no separate Onboarding stage.** Recorded in
  the [Business Decisions log](docs/01-domain/business-decisions.md#bd-008--hiring-transforms-applicant-to-employee-no-separate-onboarding-stage):
  the recruitment workflow stands at **seven stages** (no eighth "Onboarding" stage), and the
  post-hire employee lifecycle belongs to the future Employee module. Added the *Electronic
  Employee File* entry to the [Ubiquitous Language](docs/01-domain/ubiquitous-language.md).

### Notes

- The seven-stage recruitment workflow (Applicant → Screening → Interview → Offer → Employee
  Creation → Hiring Documents → Electronic Employee File) is now **complete**. The post-hire
  employee lifecycle (documents, assets, contracts, attendance, payroll, leave) is the future
  Employee module's remit (BD-008) and is not started.

## [0.11.0] - 2026-07-12

Release v0.11.0 — Sprint 4.6: **HR / Recruitment — Hiring Documents (Stage 6)**
([PR #27](https://github.com/egycashcompany-ops/egycash/pull/27)), the sixth stage of the
approved seven-stage recruitment workflow. Additive on Stage 5; **no part of Stage 7
(Electronic File) or later is built.** Merged after a self-conducted architecture review
([review](docs/10-reviews/2026-07-architecture-review-hiring-documents.md); no Critical/High
findings — one small mitigation applied in-PR, the rest logged for later sprints).

### Added

- **HR / Recruitment: Hiring Documents (Stage 6).** After an employee is created, their hiring
  documents are collected.
  - **Administrator-defined document types** (`hr_hiring_document_types`) — required and
    optional; a default set is seeded, admin-managed under `hiringDocumentType.manage`.
  - **Hiring Documents aggregate** (`hr_hiring_documents`) — **one set per employee**. Each
    document is an uploaded **PDF** backed by the platform Files service: the **original is
    preserved** and **replacement creates a new version while keeping prior versions
    retrievable**. Stores document metadata (type, name, uploader, upload date, version).
  - **Required-completion validation** — completion is blocked while any active required type is
    missing (`missingRequired` is surfaced on the DTO). Once **completed**, the set is
    **immutable except through the versioning (replace) workflow**; documents are never
    overwritten or deleted.
  - PDF-only enforced by a dedicated Files category. Publishes
    `hr.hiringDocuments.{created,documentUploaded,documentReplaced,completed}`, **notifies** the
    reporting manager + creator on completion, and **audits** every operation. Permissions
    `hiringDocuments.{view,create,upload,complete}` + `hiringDocumentType.manage`; routes
    `/api/v1/hr/hiring-documents` and `/hr/hiring-document-types`.

### Fixed

- **Hiring-document upload/replace could orphan a file version on a lost optimistic-concurrency
  race** (review finding HD-01): the service now rejects a stale `version` before writing bytes
  to the Files service, so only an up-to-date request performs the upload (the atomic version
  check in the repository still guards the commit).

## [0.10.0] - 2026-07-12

Release v0.10.0 — Sprint 4.5: **HR / Recruitment — Employee Creation (Stage 5)**
([PR #25](https://github.com/egycashcompany-ops/egycash/pull/25)), the fifth stage of the
approved seven-stage recruitment workflow. Additive on Stage 4; **no part of Stage 6 (Hiring
Documents) or later is built.**

### Added

- **HR / Recruitment: Employee Creation (Stage 5).** A `hr_employees` aggregate: an applicant
  whose Job Offer was **Accepted** becomes an Employee.
  - **Accepted-offer gate** — creation is allowed only from an offer whose status is
    `accepted`; the employment terms are read **exclusively from the offer's immutable
    Accepted Snapshot** (never the live, mutable offer).
  - **Unique employee number** `EMP-{YYYY}-{seq:6}` (organization-wide, atomic per-year counter
    in the shared `hr_sequences` collection + unique index).
  - **Atomic creation** — the number allocation and the record insert run in one transaction
    (`unitOfWork`); a **unique index on `jobOfferId`** prevents a duplicate employee from the
    same offer even under concurrency (with a fast-path service check).
  - **Preserved references** to the Applicant, the Job Requisition (carried by the applicant),
    and the Accepted Job Offer; **copies the approved employment terms** (job title,
    department, branch, manager, employment type, salary, allowances, benefits, probation,
    start date) plus the accepted offer revision number; sets the initial status **`active`**
    and records the **hiring date** (defaults to now).
  - **Publishes** `hr.employee.created`, **notifies** the reporting manager + the creator, and
    **audits** every operation. Permissions `employee.{view,create}`; route
    `/api/v1/hr/employees`; the employee number is searchable in the list endpoint.

## [0.9.0] - 2026-07-12

Release v0.9.0 — Sprint 4.4: **HR / Recruitment — Job Offer (Stage 4)**
([PR #23](https://github.com/egycashcompany-ops/egycash/pull/23)), the fourth stage of the
approved seven-stage recruitment workflow. Additive on Stage 3; **no part of Stage 5
(Employee Creation) or later is built.**

### Added

- **HR / Recruitment: Job Offer (Stage 4).** A `hr_job_offers` aggregate: an applicant who
  cleared every interview round receives a versioned compensation offer.
  - **Lifecycle** `draft → sent → accepted / rejected / expired / withdrawn`. The offer
    carries a full package — salary (`Money`), allowances, benefits, job title, department,
    branch, reporting manager, employment type, probation period, start date, offer validity,
    and notes. **Version history**: every revise snapshots the prior package into `revisions`.
  - **Immutable, human-readable offer number** `JO-{YYYY}-{seq:6}` (organization-wide, atomic
    per-year counter in the shared `hr_sequences` collection + unique index) — HR references
    offers by this number, not the ObjectId; the list endpoint is searchable over it.
  - **Immutable accepted-revision snapshot**: acceptance freezes the exact terms and their
    revision number into `acceptedSnapshot`, never mutated afterward — the record Employee
    Creation (Stage 5) will consume, decoupled from the live offer.
  - **Guards**: creation requires all interview stages cleared; **at most one active
    (draft/sent) offer per applicant** (partial unique index + service check); an applicant
    who already accepted an offer cannot be issued another; sending requires a future
    validity; a lapsed sent offer cannot be accepted. The **accepted-offer gate**
    (`acceptedOfferFor`) is exposed so Stage 5 can require the latest offer be Accepted.
  - **Automatic expiration**: a scheduled sweep (`hr.jobOffers.expire`, every 15 min) flips
    sent offers past their validity to `expired` (audited, emitted, notified).
  - **Notifications** for offer sent / accepted / rejected / expired (fire-and-forget, to the
    hiring manager + the offer's author); **full audit trail** on every transition.
  - Permissions `jobOffer.{view,create,edit,send,respond,withdraw}` (`send`/`respond`/
    `withdraw` each their own grant); route `/api/v1/hr/job-offers`; events
    `hr.jobOffer.{created,revised,sent,accepted,rejected,expired,withdrawn}`.
  - **Additive platform seam**: `ModuleManifest.scheduledTasks` — a module can now declare
    repeatable tasks (declared before the scheduler sync, validated to carry the module-id
    prefix), the analogue of the existing `seed`/`eventSubscriptions` seams.

## [0.8.0] - 2026-07-11

Release v0.8.0 — Sprint 4.3: **HR / Recruitment — Interviews (Stage 3)**
([PR #21](https://github.com/egycashcompany-ops/egycash/pull/21)), the third stage of the
approved seven-stage recruitment workflow. Additive on Stage 2; **no part of Stage 4 (Job
Offer) or later is built.**

### Added

- **HR / Recruitment: Interviews (Stage 3).** An applicant who passed Initial Screening
  advances through the interview rounds.
  - **Administrator-configurable interview stages** (`hr_interview_stages`, OQ-31): an
    ordered, localized, deactivatable catalog seeded with the two default rounds ("First
    Interview", "Second Interview") — number/names/order are admin-managed thereafter
    (`interviewStage.manage`).
  - **Interview aggregate** (`hr_interviews`): a scheduled round with a **panel** where each
    member carries an individual evaluation state — **`pending` / `submitted` / `skipped`**
    (the roster and per-interviewer evaluations are one unified structure). Lifecycle:
    **schedule** → **reschedule** (date/time only) · **reassign panel** (independent of the
    schedule — retained members keep their state, added members start pending and are
    notified, removed members drop off) · **cancel** · per-interviewer **evaluate** ·
    **decide**.
  - **Workflow gate & progression** (approved workflow): the earliest stage requires a passed
    screening, each later stage requires the previous stage passed, and one live interview per
    stage. A decision is **blocked until every panel member is `submitted` or `skipped`**
    (prevents premature decisions without deadlocking on a no-show). Passing the final
    configured stage clears the interview phase (the applicant is ready for a future Job
    Offer); failing any round transitions the applicant to the terminal `rejected` status.
  - **Notifications integration**: scheduling, rescheduling, and cancelling notify the panel
    through the platform Notifications service (fire-and-forget — never blocks the operation);
    the HR seed registers the three interview templates at boot.
  - Permissions `interview.{view,create,edit,cancel,evaluate,decide}` (`evaluate` and `decide`
    each their own grant) + `interviewStage.manage`; routes under `/api/v1/hr/interviews` and
    `/hr/interview-stages`; events `hr.interview.{scheduled,rescheduled,cancelled,evaluated,decided}`.
    The applicant terminal-rejection event (`hr.applicant.rejected`) was made source-agnostic
    (screening or interview). **Additive platform seam**: `notificationTemplateService` is now
    exposed on the `platform/notifications` barrel so a business module can register its own
    templates at boot (the same idempotent seam the platform's built-ins use).

## [0.7.0] - 2026-07-11

Release v0.7.0 — Sprint 4.2: **HR / Recruitment — Initial Screening (Stage 2)**
([PR #20](https://github.com/egycashcompany-ops/egycash/pull/20)), the second stage of the
approved seven-stage recruitment workflow. Additive on Stage 1; **no part of Stage 3 or later
is built in this release.**

### Added

- **HR / Recruitment: Initial Screening (Stage 2).** A `hr_screenings` aggregate, **one
  screening per applicant** (partial unique index), decided to a single terminal outcome —
  **Accepted or Rejected** (OQ-32, two outcomes only). "Needs more information" is **not a
  state**: it is a note appended to a screening that stays `pending`; screening notes and the
  mandatory rejection reason are stored. A **rejection** transitions the applicant to the
  terminal `rejected` status (which frees the live National-ID for a fresh application,
  exactly like a withdrawal); an **acceptance** leaves the applicant live for the interview
  stage. Permissions `screening.{view,create,edit,decide}` (`decide` — the terminal
  accept/reject — is a separate grant from `edit`, which only appends notes); route
  `/api/v1/hr/screenings`; events `hr.screening.{created,decided}`. Extends the applicant
  lifecycle with the terminal `rejected` status and the `hr.applicant.rejected` event.

## [0.6.0] - 2026-07-10

Release v0.6.0 — Sprint 4.1: **HR / Recruitment — Applicants (Stage 1)**, the platform's
first Layer 2 business module
([PR #18](https://github.com/egycashcompany-ops/egycash/pull/18); plan:
`docs/12-planning/sprint-4.1-plan.md` (frozen 2026-07-10); reference:
`docs/02-architecture/recruitment-applicants.md`; retrospective:
`docs/11-retrospectives/2026-07-sprint-4.1.md`). Planning went through business analysis
([PR #17](https://github.com/egycashcompany-ops/egycash/pull/17)) with the approved
baseline workflow and eight resolved decisions (OQ-7/8/9/10/29/30/31/32).

### Added

- **Sprint 4.1 implementation** — HR / Recruitment: **Applicants (Stage 1)**, the
  platform's **first Layer 2 business module** (reference:
  `docs/02-architecture/recruitment-applicants.md`; plan frozen 2026-07-10 with
  OQ-7/8/9/10/29/30/31/32 resolved). Backend-first (OQ-29): full contracts + APIs +
  services + persistence; the frontend is a later sprint. The `hr` module manifest
  registers under `/api/v1/hr` (routes `applicants`, `applicant-sources`), owns
  `hr_applicants` / `hr_applicant_sources` / `hr_sequences`, declares its own permissions
  (`applicant.{view,create,edit,delete,export}`, `applicant.verifyIdentity`,
  `applicantSource.manage`), and seeds the 10 applicant sources at boot. Capabilities: a
  requisition-driven intake pipeline (BD-001 — mandatory immutable requisition reference
  behind a Stage-0 validator seam), manual / National-ID-derived / ID-less registration,
  deterministic Egyptian National-ID parsing (birth date, gender, governorate — real) with
  live-uniqueness enforcement and masked-by-default DTOs, an OCR extraction **seam** (null
  stub, OQ-30), organization-wide atomic applicant numbering `APP-{YYYY}-{seq:6}` (BD-002),
  heuristic duplicate flagging (never blocks), human identity verification, withdrawal,
  Arabic-normalized search, a filterable/sortable/paginated list, an audited PII-masked CSV
  export, a generic per-row-audited bulk executor, and attachments delegated to the platform
  Files service (title/category/notes, transactional count). Emits
  `hr.applicant.{created,updated,identityVerified,withdrawn}`. **Additive platform seams for
  the first module**: a `platform/web` barrel re-exporting HTTP helpers so modules build
  routers within the layer boundary, and wiring of `manifest.seed` into the boot sequence.
  Public/mobile intake, external-platform adapters, real OCR, and the Stage-0 requisition
  service are **integration seams only** (their governing OQs remain open); **no part of
  Stage 2 (Screening) or later is built.**
- **Sprint 4.1 planning document** (`docs/12-planning/sprint-4.1-plan.md`): HR /
  Recruitment — Applicants (Release v0.6, first business module; docs only, no
  implementation). Business analysis of the full seven-stage recruitment lifecycle
  with an in-depth Stage 1 (Applicants) treatment: registration paths (manual,
  Egyptian National-ID OCR with confidence bands/cross-checks/failure and missing-ID
  workflows, ID-less registration), attachment rules (title + category + notes),
  admin-extensible source catalog with structured referral/agency detail, public
  web/mobile intake as a new trust boundary (pending-submission review model),
  integration domain boundaries (adapters translate, the intake pipeline decides),
  a complete business classification of applicant data (10 groups with stage gates
  and sensitivity levels), a four-population documents-ownership/lifecycle model
  (temporary → applicant → sealed hiring snapshot → employee file, reference-don't-
  copy), and grid/filter/bulk/export requirements with safety rules. Anchored to the
  **EGYCASH-approved baseline workflow (2026-07-10)**: screening → interviews →
  offer (Rejected/Expired/Accepted) → hiring documents → employee created →
  electronic file. **Four business decisions were approved 2026-07-10, resolving
  OQ-7/8/31/32**: recruitment stays requisition-driven (BD-001 unchanged) with the
  Job Requisition documented as a separately-planned **Stage 0** prerequisite that
  every applicant references; hiring documents precede employee creation; interview
  stages are **administrator-configurable** (two rounds is the default, not a limit);
  and screening has **Accepted/Rejected outcomes only** (missing information keeps the
  applicant in Screening, no separate state). Records **Open Questions OQ-7…OQ-32**
  (4 resolved, 20 open) — the remaining blockers being the minimal-Employee shape, the
  frontend scope, and unbuilt-dependency sequencing (sequences service, approvals, OCR,
  external-recipient notifications, frontend grid foundation) — **none assumed, all
  awaiting business resolution before planning freezes**. The blocking set was
  subsequently resolved 2026-07-10 (OQ-29 backend-first, OQ-30 abstractions,
  OQ-9/10 non-blocking) and the plan **frozen** for Stage-1 implementation.

### Backlog (recorded at review — non-blocking, for future sprints)

1. Dedicated concurrency/stress test for the atomic applicant-number allocation
   (no-gap/no-collision under parallel registration).
2. Deeper documentation of the duplicate-detection heuristic (probe fields,
   normalization, flag-resolution workflow) in the architecture reference.
3. Search optimization for contains-style Arabic queries (text index / n-gram) if
   applicant volume outgrows the current regex-over-`searchName` approach.
4. Extend `gen-permission-matrix.mjs` to include module-manifest permissions alongside
   the platform catalog.

## [0.5.0] - 2026-07-09

Release v0.5.0 — Sprint 3.3: **Notifications Service**
([PR #15](https://github.com/egycashcompany-ops/egycash/pull/15); plan:
`docs/12-planning/sprint-3.3-plan.md`; reference:
`docs/02-architecture/notifications-service.md`). Planning went through two amendment
rounds ([PR #12](https://github.com/egycashcompany-ops/egycash/pull/12)/
[#13](https://github.com/egycashcompany-ops/egycash/pull/13)/
[#14](https://github.com/egycashcompany-ops/egycash/pull/14)) before being frozen —
see those PRs for the full design-decision history.

### Added

- **`notificationsService.notify()`** — the one platform-wide, in-process entry point
  (never an HTTP endpoint): synchronous, bilingual, entity-referenced in-app inbox
  creation (the delivery guarantee) plus asynchronous, queued delivery on every other
  enabled channel through a small channel-adapter registry (`inApp`/`email` built;
  SMS/push/WhatsApp interface-ready). Delivery failure on any channel never throws back
  to the caller.
- **In-app inbox** (self-scoped, no permission required): list, live unread count, mark
  one/all read (first-read-wins), archive.
- **Email delivery**: self-managed 5-attempt exponential-backoff retry; every
  delivery-status transition audited; final failure raises the reliable
  `platform.notification.deliveryFailed` event.
- **Versioned notification templates** (`notificationTemplate` CRUD, preview,
  test-send — permission-gated and audited): every edit, including deactivation,
  creates a new version; nothing is ever mutated in place.
- **Preferences**: category-level opt-in/out with a settings-driven default
  (`notifications.email.enabled`); quiet hours (server/UTC, `critical` priority
  bypasses).
- **Idempotency** (caller-supplied key + delivery-job status guard), `sendAt`
  scheduling, `expiresAt` expiration, and file-reference attachments (no binary
  handling this sprint, by design).
- **Socket.IO live push** (`notification:new`/`notification:read`), authenticated the
  same way as the HTTP API, relayed across the api/worker process split over Redis
  pub/sub (a real gap the plan's own text didn't account for — reliable-tier
  subscribers run in the worker, which has no Socket.IO server of its own).
- **Both initially-wired event subscriptions** (`platform.audit.alertRaised`,
  `platform.roleAssignment.changed`) produce real notifications end-to-end against
  idempotently-seeded built-in templates.
- Additive-only elsewhere: a new RBAC read query (`rbacService.listUserIdsWithPermission`)
  and two new settings (`notifications.email.enabled`,
  `notifications.quietHours.enabledByDefault`); no existing service's behavior changed.

### Fixed

- **Retry-after-failure was permanently stuck**: the delivery handler kept a failed
  channel at `processing` across its whole retry sequence, intending that as the
  idempotency guard for the next attempt — but the guard checks for status `queued`
  before proceeding, so every attempt after the first silently no-op'd. A channel now
  transitions back to `queued` before its next attempt is enqueued.

### Backlog (recorded for future release planning — not implemented)

1. Frontend inbox UI and Socket.IO client wiring.
2. SMS / push / WhatsApp channel adapters (interface-ready, not built).
3. Digest/scheduled-summary notifications (`digestMode` field reserved, unused) and
   recurring delivery (`sendAt` is a one-time timestamp only).
4. A quiet-hours-expiry sweep job, an admin "resend a failed delivery" action, and
   notification retention/purge.
5. The future administration console (template management, queue monitoring, failed
   deliveries, resend/retry, statistics) and a dedicated metrics backend.

## [0.4.0] - 2026-07-09

Release v0.4.0 — Sprint 3.2: **Audit & Activity Service**
([PR #10](https://github.com/egycashcompany-ops/egycash/pull/10); plan:
`docs/12-planning/sprint-3.2-plan.md`; reference: `docs/02-architecture/audit-service.md`).
Completes the Sprint 2.1 audit core to its full ADR-012 spec.

### Added

- **Audited CSV export** (`GET /platform/audit-logs/export`, `auditLog.export`): streams
  via a Mongo cursor (no full-result buffering), row-capped
  (`audit.export.maxRows`, default 50,000), field-name-based `nationalId` masking, and
  **the export itself is audited** (actor, filter, row count).
- **Entity timeline** (`GET /platform/timeline`): a merged view over the audit + activity
  streams for one entity, newest-first. Implements
  [BD-007](docs/01-domain/business-decisions.md#bd-007--timeline-authorization-degrades-gracefully) —
  content degrades to whichever of `activityLog.view` / `auditLog.view` the caller holds
  (activity-only, audit-only, or merged); neither ⇒ audited 403.
- **Retention governance**: `platform.audit.retention` (daily) purges expired
  **activity** records in idempotent batches, settings-declared with a hard 365-day
  floor (`audit.retention.activityDays`); the audit stream keeps its structural
  no-delete guarantee.
- **Security-signal detection**: `platform.audit.securitySignals` (hourly) runs four
  detectors — repeated permission denials, lockout clusters, export spikes,
  refresh-token reuse — each raising an `alertRaised` audit record plus the reliable
  `platform.audit.alertRaised` event, deduplicated per (signal, subject, window).
- **Query hardening**: `moduleId` filter added to the audit list/export; new
  `ix_moduleId_at` / activity `ix_at` indexes.
- **Sprint 3.2 planning document** (`docs/12-planning/sprint-3.2-plan.md`, approved
  2026-07-09) and **BD-007 — Timeline authorization degrades gracefully**
  (`docs/01-domain/business-decisions.md`), resolving the decision flagged in the plan's §7.

No new permissions, no new collections (`check:permission-matrix` unchanged). Architecture
review: self-assessed in the PR, no code changes required.

### Backlog (recorded for future release planning — not implemented)

1. Replace the entity timeline's in-memory merge with a cursor-based merge if a given
   entity's history ever grows beyond current practical limits.
2. Generalize CSV export masking (`audit.export.ts`) into a reusable PII-masking framework,
   rather than the current field-name-based check.
3. Consider making the `lockoutCluster` and `refreshReuse` signal thresholds
   settings-configurable in a future release (currently fixed constants).
4. The future Notifications Service (v0.5.0) should _subscribe_ to
   `platform.audit.alertRaised` rather than introduce any direct coupling to the audit
   service.

## [0.3.0] - 2026-07-09

Release v0.3.0 — Sprint 3.1: **File Management Service**
([PR #6](https://github.com/egycashcompany-ops/egycash/pull/6), architecture review:
Implementation Approved; retrospective:
[2026-07-sprint-3.1](docs/11-retrospectives/2026-07-sprint-3.1.md)).

### Added

- **File Management Service** (platform `files`, ADR-010): storage providers behind one
  interface — Local, Railway volume, Amazon S3, MinIO (S3-compatible), Azure Blob — selected
  by `STORAGE_DRIVER`; upload/download/replace(versioning)/archive/restore/soft-delete/
  permanent-delete lifecycle; full metadata set (names, mime, extension, sha256 checksum,
  size, uploader, entity reference, category, tags); category catalog with per-category
  mime/size/retention rules; visibility-aware, per-download-audited authorization with a
  signed-URL abstraction (native presigning or app-level HMAC streaming); extension points
  for virus scanning, OCR and thumbnails with completion events; `platform.file.*` events
  on the reliable tier; unit + integration suites; API doc with sequence diagrams
  (`docs/02-architecture/files-service.md`).

## [0.2.0] - 2026-07-09

Documentation & governance wave (PRs
[#3](https://github.com/egycashcompany-ops/egycash/pull/3),
[#4](https://github.com/egycashcompany-ops/egycash/pull/4),
[#5](https://github.com/egycashcompany-ops/egycash/pull/5)). Release numbering follows the
sprint plan from here (0.x pre-GA); the `2.1.0`/`1.0.0` entries below predate this scheme.

### Added

- Project governance: `ECMS-BOOK.md`, `CONTRIBUTING.md`, `SECURITY.md`, `LICENSE`,
  `CODEOWNERS`, pull-request and issue templates, this changelog.
- **Phase 2.5 — Domain Model** (documentation only): `docs/01-domain/` — domain model,
  bounded contexts, entity relationships, and ubiquitous language for the whole platform.
- **Business Decisions log** (`docs/01-domain/business-decisions.md`): BD-001 requisition-driven
  recruitment (OQ-2), BD-002 organization-wide applicant numbering (OQ-3), BD-003 shared
  Client Registry (OQ-4), BD-004 multi-currency-ready EGP-first Money (OQ-5), BD-005
  separate cash/gold custody entities over a shared pattern (OQ-6), BD-006 one capability
  per implementation sprint — with the domain documents updated accordingly.

## [2.1.0] - 2026-07-09

Sprint 2.1 — Platform Core, phase 2.1 slice
([PR #2](https://github.com/egycashcompany-ops/egycash/pull/2), per
[Architecture Review 01](docs/10-reviews/2026-07-architecture-review-01.md) R2).

### Added

- **Monorepo**: npm workspaces (`apps/api`, `apps/web`, `packages/contracts`,
  `packages/config`); ESLint flat config with layer-boundary enforcement; Prettier;
  GitHub Actions CI (lint, typecheck, permission-matrix and flag-expiry gates, tests,
  build, audit); docker-compose dev stack (Mongo replica set, Redis, Mailpit); devcontainer.
- **`@ecms/contracts`**: Zod-first DTOs and schemas; platform permission catalog (single
  source of truth, synced to DB at boot); versioned event contracts (`schemaVersion`);
  error-code catalog; Egyptian NationalId validator/decoder and PhoneNumber normalizer;
  feature-flag declarations with expiry dates.
- **Kernel**: module registry with manifest validation (including `requiresPlatform`
  compatibility) that fails the boot loudly; typed event bus with in-process and
  outbox→BullMQ reliable tiers; `unitOfWork` transaction helper.
- **Auth**: argon2id login pipeline; 15-minute JWT access tokens; rotating refresh tokens
  with reuse detection and session-family revocation; session registry with revocation;
  settings-driven lockout and password policy; TOTP 2FA with single-use backup codes,
  enforced for privileged accounts.
- **RBAC**: code-declared permission registry; roles as data with protected system roles;
  time-bound role assignments enforced at permission-set computation; data scopes
  `own | branch | organization` applied centrally by `BaseRepository`.
- **Organization**: Organization singleton profile; Branch → Department → Section hierarchy
  with materialized paths, delete guards, managers and acting-manager delegation windows;
  Job Titles catalog.
- **Audit**: append-only audit and activity streams; queued writes with in-request fallback;
  `requestId` correlation across api → queue → worker; query endpoints; audited 403s.
- **Settings & feature flags**: declared-in-code registry; `user → branch → organization →
default` resolution with caching and change events; flags evaluated on the hierarchy.
- **Scheduler**: declared-task registry with pause/resume/run-now API; BullMQ repeatable
  executor; outbox sweep and expiring-assignments report.
- **Web scaffold**: login with TOTP step, in-memory access token with silent refresh,
  session bootstrap, `<Can>`/`useCan` permission gates, ar/en with RTL switching.
- **Tests**: 44 unit tests + integration suite proving login → permission → scoped data →
  audit trail, refresh-reuse detection, lockout, TOTP enforcement, optimistic concurrency,
  and hierarchy guards.

### Changed

- ADR-001…014 statuses Proposed → Accepted per the Milestone 1 approval log; **ADR-015**
  records the single-organization model (Review R1), superseding the multi-company aspects
  of the Milestone 1 design.
- README status lines updated to Milestone 2 / phase 2.1; generated permission-matrix
  companion added (Review R18).

## [1.0.0] - 2026-07-08

Milestone 1 — complete platform design documentation (`docs/`), approved by EGYCASH,
followed by Architecture Review 01 (pre-Milestone 2 critical review, R1–R32).

[Unreleased]: https://github.com/egycashcompany-ops/egycash/compare/main...HEAD
