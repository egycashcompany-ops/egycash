# Recruitment — Frontend Foundation (Phase 1)

Implementation reference for the **HR / Recruitment web frontend foundation** — the reusable
shell, shared UI kit, and platform integration that every recruitment screen builds on. Phase 1
(§1–§6) deliberately builds **no feature screen**; it establishes the ground every later screen
reuses. **§7 records the Applicants screens added in Phase 2.** Stack and state rules follow
[Software Architecture §6](software-architecture.md#6-frontend-architecture) and
[ADR-013](../03-decisions/ADR-013-frontend-state.md).

## 1. Stack

React 18 + Vite + TypeScript (strict: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
`verbatimModuleSyntax`) · TanStack Query (server state) · Redux Toolkit (session/UI state) ·
react-router-dom v6 · Tailwind CSS (class-based dark mode, logical RTL utilities). No new runtime
dependencies were added in this phase.

## 2. Folder shape (mirrors the backend platform/module split)

```
apps/web/src/
  platform/            # app shell, cross-cutting concerns
    app/               # App root (router + session bootstrap), ErrorBoundary, 403/404 pages
    layout/            # AppShell · Sidebar · Topbar · Breadcrumbs · PageContainer/PageHeader
    navigation/        # NavSection/NavItem model
    router/            # RequireAuth · RequirePermission route guards
    rbac/              # Can + useCan/useHasAnyPermission/useHasAllPermissions
    theme/             # ThemeProvider + useTheme
    notifications/     # NotificationBell (topbar entry point)
    localization/      # i18n catalog + useT (with {{param}} interpolation)
    auth/              # existing login + session api
  shared/
    lib/               # api-client (typed REST + multipart + silent refresh), errors,
                       # query-keys, format, cn, useOnClickOutside
    ui/                # the shared kit (below), imported via shared/ui barrel
  store/               # auth · locale · ui (theme/sidebar) slices + preference persistence
  modules/hr/recruitment/
    RecruitmentLayout · nav · routes (lazy) · pages/(Overview, StagePlaceholder)
```

## 3. Shared UI kit (`shared/ui`)

Wrapped once and imported through the `shared/ui` barrel — never reached into raw from features.
All components are RTL-safe (logical `ps/pe/ms/me/start/end` utilities) and dark-aware:

- **Data**: `DataTable` (sortable, selectable, built-in loading/empty/error), `Pagination`
  (bound to the API `PageMeta`), `SearchInput` (debounced), `FilterBar`, `BulkActions`.
- **Forms**: `Field`, `Input`, `Textarea`, `Select`, `Checkbox`, `Form`, `FormActions`
  (controlled; shaped to back react-hook-form + shared Zod schemas later without call-site churn).
- **Interaction**: `Button`, `Dialog` (portal modal, Escape/overlay close, scroll lock),
  `FileUpload` (drag-drop + client size guard), `Card`.
- **Display**: `Badge`/`StatusBadge`, `Timeline`, `Spinner`, `Skeleton`.
- **States**: `LoadingState`, `EmptyState`, `ErrorState` (localized retry), `SuccessState`.
- **Notifications**: toast store + `Toaster` (client toasts), `NotificationBell` (inbox stub).

## 4. Platform integration

- **API layer** — `shared/lib/api-client` keeps the access token in memory (ADR-006), unwraps the
  response envelope, retries once on token expiry via silent refresh, and exposes
  `get/post/patch/del/upload` + `buildQuery`. `errors.ts` maps error codes to friendly bilingual
  messages.
- **React Query** — one client with **global error handling**: mutation failures (and background
  refetch failures of already-shown data) raise a toast in the user's locale; a query's first-load
  failure is left to the component's inline `ErrorState`. Query keys use a
  `[module, feature, kind, …params]` factory.
- **Auth** — the App root bootstraps the session (silent refresh + `/auth/me`) into the auth slice;
  `RequireAuth` holds render until it resolves, then gates on sign-in.
- **Permissions (role-based UI)** — `Can`/`useCan` gate elements; `RequirePermission` gates routes
  (→ 403). Both are **UX only**; the server remains the enforcement authority.
- **Theme** — `ThemeProvider` applies light/dark/system to `<html>` (class strategy) and reacts to
  the OS; the choice persists to `localStorage`.
- **RTL & i18n** — Arabic is the default locale (RTL); direction is stamped on `<html>` and every
  component uses logical utilities. `useT` looks up the bilingual catalog with `{{param}}`
  interpolation.

## 5. Routing & code splitting

`/login` is public; everything else is the authenticated recruitment module, **lazy-loaded as one
chunk** (route-based code splitting, §6). `RecruitmentLayout` renders the generic `AppShell`
(sidebar + topbar) with the recruitment nav; stage routes (`/applicants`, `/screening`,
`/interviews`, `/job-offers`, `/employees`, `/hiring-documents`, `/employee-files`) are each
permission-gated and currently render a shared **placeholder** — each real screen drops in by
replacing that element, with zero layout/routing work.

## 6. Deliberately deferred

- **Feature screens** — all seven recruitment stages are now built (Applicants §7 · Initial Screening §8 · Interviews §9 · Job Offer §10 · Employees §11 · Hiring Documents §12 · Electronic Employee File §13). *(Phase 1 itself deliberately shipped none.)* **The module is feature-complete; work is now in a polish phase** — Sprint 5.9 (v0.21.0) added direct applicant intake and the reusable National-ID OCR review flow (§7) without adding a stage.
- **shadcn/ui + react-hook-form** — §6 names these as the eventual kit; the foundation provides the
  same wrapped-in-`shared/ui` surface with hand-rolled, dependency-free primitives so a later
  migration is localized. No behavior depends on the concrete library.
- **Live notifications inbox** — the bell + toast sink are in place; the server-backed inbox and
  Socket.IO badge land with that feature.
- **Frontend unit tests** — no web test runner is configured yet; typecheck + lint + build are the
  current gates. A component test setup (Vitest + Testing Library) is a fast follow.

## 7. Applicants (Phase 2)

The first feature screen set, built entirely on the §3–§5 foundation. Folder:
`modules/hr/recruitment/applicants/` with `api/` (feature api + TanStack Query hooks, ADR-013),
`pages/` (list, detail, create/edit), and `components/` (filters, status badge, form, OCR assist,
attachments).

- **List** (`applicant.view`) — `DataTable` with sortable columns (code, created) and row
  selection; `ApplicantFilters` (search + status/source/channel/identity/duplicates/has-files);
  `Pagination` bound to the API `PageMeta`; **bulk withdraw** (`applicant.edit`) via `BulkActions`
  + a reason dialog; **CSV export** (`applicant.export`) streamed to a browser download; a
  **create** entry point (`applicant.create`). **Filters, search, sort and pagination are
  synchronized with the URL query string** (deep-linkable, back/forward aware); selection is
  transient.
- **Detail** (`applicant.view`) — identity/contact/preferences/application read-out, the
  **attachments** panel (list · upload with title+category · signed-URL download · remove), and
  the **verify-identity** and **withdraw** actions (permission-gated, version-checked).
- **Create / edit** — a comprehensive manual-entry form (application context, identity, contact,
  addresses, preferences, education, military, work experience, references, licenses,
  certifications) using the shared form primitives. Client checks cover the required fields; the
  server stays authoritative and its validation errors surface in a summary. Edits are
  optimistic-concurrency guarded (`version`).
- **National-ID capture + review** (create) — a **reusable, module-agnostic** flow lives in
  `shared/national-id/` (`NationalIdOcr` + `NationalIdReviewDialog` + `mapping`/`transliterate`), so
  Employees / KYC / any future module can reuse it by injecting an *extractor*. It provides **two
  upload areas (front + back)** read together in **one** extraction pass; the applicants binding
  (`ApplicantNationalIdOcr`) supplies the extractor over the existing seam
  (`/hr/applicants/ocr/national-id`, which already accepts `frontFileId` + `backFileId`). On
  **Extract**, a **dedicated review dialog** opens showing **every** extracted field (Arabic name,
  number, marital status, official address, city, religion, card expiry) editable; **nothing is
  saved and the host form is not touched** until the user clicks **Confirm** — only then is the
  reviewed data handed back and the Applicant form populated (§2.1 rule 4). Degrades gracefully — the
  review dialog still opens for manual entry when no provider is wired (OQ-30). Two things are
  computed on the client instead of OCR'd: **birth date / gender / governorate** are **derived
  deterministically from the number** (`parseNationalId`, recomputed live in the dialog and shown
  read-only), and the **English name** is seeded by transliterating the Arabic name (editable).
- **Integration** — all calls go through the feature `api/` layer against the existing endpoints
  (`/hr/applicants`, `/hr/applicant-sources`, `/hr/applicants/ocr/national-id`,
  `/hr/applicants/:id/attachments`, `/hr/applicants/export`, `/hr/applicants/bulk`, and
  `/platform/files` + `/platform/file-categories` for uploads). Reads are cached and writes
  invalidate the feature subtree. **No new backend endpoint** — the OCR extraction DTO was widened
  (extra card fields) and the applicant identity gained `religion` + `nationalIdExpiry`.

**Direct intake:** the Job Request is **optional**. An applicant can be created directly from the
Applicants screen with no linked requisition (`jobRequisitionId` is nullable end-to-end — applicant,
employee, and employee-file all tolerate `null`), and the reference can be attached later when the
Job Requests module lands. **Cross-module references** (Job Requisition, Branch) are still never
entered as raw IDs: `RefPickers` renders a disabled "coming soon" selector when no value is present,
or a read-only reference chip when one is supplied by context (the create route accepts
`?requisitionId=…&branchId=…`, which the future Requisitions screen will deep-link). Detail views
show the same read-only chip (or "—" for a direct intake).

Deferred: frontend component tests (pending the Vitest + RTL setup backlog item).

## 8. Initial Screening (Phase 3)

The second feature screen set (`modules/hr/recruitment/screening/`), reusing the foundation and
Applicants building blocks. Endpoints: `/hr/screenings` (+ `/:id/notes`, `/:id/decide`).

- **Queue** (`screening.view`) — sortable `DataTable` (status, notes, decided, created);
  `ScreeningFilters` (status + created-date range + an **applicant search-picker** that reuses the
  Applicants list API and resolves to the `applicantId` filter, since screening's own list has no
  free-text field); `Pagination`. Filters/sort/pagination are **URL-synchronized** (deep-linkable,
  back/forward). A **Start screening** action (`screening.create`) opens a dialog to pick a live
  applicant + an optional first note.
- **Detail** (`screening.view`) — links to the applicant, the **notes + decision timeline** (shared
  `Timeline`), an **add-note** form while `pending` (`screening.edit`), and the **Accept / Reject**
  actions (`screening.decide`) via a dialog — a reason is required to reject (OQ-32) and optional
  to accept. All mutations are version-checked.
- **Integration** — feature `api/` layer + TanStack Query hooks; the applicant lookup reuses the
  Applicants API. `ar` + `en` i18n. Permission-gated throughout (`screening.{view,create,edit,decide}`).

Deferred (same as Phase 2): frontend component tests (Vitest + RTL). The active-applicant filter
chip shows a short reference on deep-link reload until re-searched.

## 9. Interviews (Phase 4)

The third feature screen set (`modules/hr/recruitment/interviews/`), on the same foundation and
reusing the Applicants building blocks. Endpoints (matched exactly): `/hr/interviews` (+
`/:id/reschedule`, `/:id/panel`, `/:id/panel/skip`, `/:id/cancel`, `/:id/evaluations`,
`/:id/decide`) and `/hr/interview-stages` (read-only here — the admin catalog labels rounds and
backs the stage picker).

- **Queue** (`interview.view`) — sortable `DataTable` (stage `#order`, scheduled, created — the
  backend's sortable fields); `InterviewFilters` (status + outcome + stage + an **applicant
  search-picker** → `applicantId` + a scheduled-date range); `Pagination`. Filters/sort/pagination
  are **URL-synchronized** (deep-linkable, back/forward). A **Schedule interview** action
  (`interview.create`) opens a dialog to pick an applicant, stage, date/time, and panel.
- **Detail** (`interview.view`) — the **panel with per-interviewer evaluation state**
  (`recommend`/`neutral`/`notRecommend`, rating, notes), the scheduling read-out, the decision, and
  the full action surface: **reschedule** and **reassign panel** (`interview.edit`), **skip** a
  pending interviewer (`interview.edit`), **submit/update your own evaluation** (`interview.evaluate`,
  shown only to an assigned panel member), **cancel** (`interview.cancel`), and **Pass / Fail**
  (`interview.decide`). Deciding is disabled — with an inline notice — while any panel member is
  still `pending` (the server rule, surfaced in the UI). All mutations are version-checked.
- **Interviewer references** — the panel is selected and displayed through a **`UserPicker` /
  `UserName`** pair that reuses the existing platform Users endpoint (`/platform/users`, gated by
  `user.view`) rather than exposing raw user ids. Without directory access it degrades to a short
  reference and a hint (never an id-entry field), mirroring the Applicants reference-control rule.
- **Integration** — feature `api/` layer + TanStack Query hooks; the applicant lookup reuses the
  Applicants API and the interviewer lookup reuses the Users API — **no new backend API is
  introduced**. `ar` + `en` i18n. Permission-gated throughout
  (`interview.{view,create,edit,cancel,evaluate,decide}`). Every write returns the fresh interview,
  so its mutation **seeds the detail cache from the response and invalidates only the list subtree**
  (`['hr','interviews','list',…]`) rather than the whole feature — this both narrows invalidation
  and drops the post-write detail refetch. Interviewer name lookups are cached per id (5-min
  `staleTime`, no retry) so the panel, decision, and skip views share one request per interviewer.
  Concurrency conflicts (`STALE_DOCUMENT`) surface through the standard global error toast, as in the
  other feature dialogs.

Deferred (same as earlier phases): frontend component tests (Vitest + RTL). Interviewer names
resolve only with `user.view`; a future dedicated interviewer-directory read would remove that
coupling. Interview-stage administration (create/edit of the catalog) is out of this scope.

## 10. Job Offer (Phase 5)

The fourth feature screen set (`modules/hr/recruitment/job-offers/`), on the same foundation.
Endpoints (matched exactly): `/hr/job-offers` (+ `PATCH /:id` revise, `/:id/send`, `/:id/accept`,
`/:id/reject`, `/:id/withdraw`). Organizational + manager references reuse existing platform
endpoints — **no new backend API is introduced**.

- **List** (`jobOffer.view`) — sortable `DataTable` (status, created — the backend's sortable
  fields); `OfferFilters` (a **free-text search** over offer number/applicant code — the offer list
  has a real `search` field — plus status + an active-only toggle); `Pagination`. Search, status,
  active, sort and pagination are **URL-synchronized** (deep-linkable, back/forward). A **New offer**
  entry point (`jobOffer.create`).
- **Create / revise** — the shared `OfferTermsForm` builds the versioned package (job title,
  department, branch, reporting manager, employment type, salary + currency, dynamic
  allowances/benefits, probation, start/validity dates, notes). Create picks an applicant first
  (`jobOffer.create`); revise edits a draft/sent offer's terms (`jobOffer.edit`, version-checked,
  history preserved). Client checks cover the required fields + `validUntil > startDate`; the server
  stays authoritative.
- **Detail** (`jobOffer.view`) — the offer number, applicant link, status, the live package, the
  immutable **accepted-terms snapshot** (once accepted) and the **revision history**, plus the
  lifecycle action surface: **send** (`jobOffer.send`), **accept / reject** (`jobOffer.respond`,
  reason required to reject), **withdraw** (`jobOffer.withdraw`), and **revise** (`jobOffer.edit`) —
  each shown only in the states where it applies (draft·sent). All mutations are version-checked and
  seed the detail cache + invalidate only the list subtree (minimal invalidation); `STALE_DOCUMENT`
  surfaces through the standard global toast.
- **References** — the reporting **manager** uses a single-select `ManagerPicker` (reuses
  `/platform/users`, `user.view`); **job title / department / branch** are dropdowns fed by the
  existing org endpoints (`jobTitle.view` / `department.view` / `branch.view`). Raw ids are never
  entered; without the relevant `*.view` the control degrades to a hint. `ar` + `en` i18n throughout
  (`jobOffer.{view,create,edit,send,respond,withdraw}`).

Deferred (same as earlier phases): frontend component tests (Vitest + RTL). Reference names resolve
only with the relevant `*.view` permission; a future dedicated reference-directory read would remove
that coupling. Automatic offer **expiry** is a backend scheduled sweep — the UI reflects the
resulting `expired` status but does not drive it.

## 11. Employees (Phase 6)

The fifth feature screen set (`modules/hr/recruitment/employees/`), on the same foundation.
Endpoints (matched exactly): `/hr/employees` (list, `POST` create-from-accepted-offer, get). The
employee record is **read-only in this stage** — no lifecycle mutation is exposed (the DTO carries
`active`/`onLeave`/`suspended`/`terminated`, but transitions belong to a future Employee module).
**No new backend API is introduced.**

- **List** (`employee.view`) — sortable `DataTable` (employee `code`, hired, created — the backend's
  sortable fields); `EmployeeFilters` (a **free-text search** over employee number/applicant code +
  status); `Pagination`. Search, status, sort and pagination are **URL-synchronized**. A **Hire
  employee** entry point (`employee.create`).
- **Hire (create)** — the employment terms are **not** entered: they are copied server-side from the
  offer's immutable accepted snapshot. The page picks an **accepted offer** (an `OfferPicker`
  autocomplete reusing the Job Offer list API scoped to `status: accepted`) + an optional hiring
  date. The server enforces the full rule (accepted + snapshot + not already hired).
- **Detail** (`employee.view`) — the employee number, status, preserved references (applicant link +
  accepted-offer link with its revision), and the copied **employment terms** read-out. The
  employment view **reuses the Job Offer `UserName` + reference hooks** so org/manager names resolve
  from the same cache. `ar` + `en` i18n; permission-gated (`employee.{view,create}`).

Deferred (same as earlier phases): frontend component tests (Vitest + RTL). Reference names resolve
only with the relevant `*.view`. Employee lifecycle transitions (leave/suspend/terminate) are out of
this stage's scope — a later Employee module concern.

## 12. Hiring Documents (Phase 7)

The sixth feature screen set (`modules/hr/recruitment/hiring-documents/`), on the same foundation.
Endpoints (matched exactly): `/hr/hiring-documents` (list, `POST` create-for-employee, get,
`/:id/documents` upload, `/:id/documents/:typeId/replace`, `/:id/documents/:typeId/versions`,
`/:id/complete`) and `/hr/hiring-document-types` (**consumed read-only** to label + require types —
type administration, `hiringDocumentType.manage`, is out of scope, like interview-stage admin).
**No new backend API is introduced.**

- **List** (`hiringDocuments.view`) — sortable `DataTable` (employee `code`, created — the backend's
  sortable fields); filters (a **free-text search** over employee number/applicant code + status);
  `Pagination`. Search, status, sort and pagination are **URL-synchronized**. An **Open document
  set** action (`hiringDocuments.create`) opens a dialog to pick an employee (search reuses the
  Employees list API).
- **Detail** (`hiringDocuments.view`) — a **per-type checklist** merging the active type catalog with
  the uploaded documents: each type shows uploaded/missing (required flagged), with **download**
  (signed-URL ticket, reused from Applicants attachments), **version history**, **replace**, and
  **upload** for missing types (`hiringDocuments.upload`, PDF-only via the shared `FileUpload` +
  multipart `upload`). **Complete** (`hiringDocuments.complete`) is blocked — with the missing-list
  banner — until every required document is present; once completed the set is read-only. All
  mutations are version-checked; each write seeds the detail cache + invalidates only the list
  subtree. `ar` + `en` i18n.

Deferred (same as earlier phases): frontend component tests (Vitest + RTL). Document-type
administration (create/edit the catalog) is out of scope; the catalog is consumed read-only.

## 13. Electronic Employee File (Phase 8)

The seventh and final feature screen set (`modules/hr/recruitment/employee-files/`) — the handoff
artifact to the future Employee module (BD-008). Endpoints (matched exactly): `/hr/employee-files`
(list, `POST` create-for-employee, get, `/:id/notes` add-note). **No new backend API is introduced.**

- **List** (`employeeFile.view`) — sortable `DataTable` (employee `code`, created — the backend's
  sortable fields); filters (a **free-text search** over employee number/applicant code + status);
  `Pagination`. Search, status, sort and pagination are **URL-synchronized**. An **Assemble file**
  action (`employeeFile.create`) opens a dialog to pick an employee (whose hiring documents are
  complete — server-enforced; the employee search reuses the Employees list API).
- **Detail** (`employeeFile.view`) — the **Employee Timeline** (shared `Timeline`) built from the
  recruitment milestones (`applicantRegistered` → … → `hiringDocumentsCompleted` → `fileOpened`)
  plus free-form notes, with an **add-note** form (`employeeFile.edit`, version-checked) that appends
  to the timeline; and the **linked history** — deep-links into the applicant, screening, interview,
  job-offer and hiring-documents screens (the Job Requisition shows as a read-only reference, no
  screen yet). `ar` + `en` i18n. Each write seeds the detail cache + invalidates only the list subtree.

**Recruitment frontend complete.** With this phase all seven stages of the approved recruitment
workflow run in the UI on the single Phase 1 foundation, as one lazy route chunk.

Deferred (same as earlier phases): frontend component tests (Vitest + RTL). Timeline actor (`by`)
resolution and inline previews could follow; post-hire employee-lifecycle concerns belong to the
future Employee module, not this stage.

## 14. Pipeline automation & lifecycle (v0.22 polish)

Enhancements across the finished module that make the stages behave as a continuous pipeline while
**keeping the existing workflow and permissions intact** — no stage was added, and the manual
open/schedule/decide flows are untouched.

- **Automatic pipeline progression (derived, not fabricated).** Applicants surface in the next
  stage automatically, via **derived read-model "awaiting" queues** rather than auto-created
  records (so there are no duplicate/placeholder rows and the existing create flows are unchanged):
  - **Screening** — `GET /hr/screenings/awaiting` returns live applicants (`new`) with no screening
    yet; the Screening queue shows an **"Awaiting screening"** panel, each row opening the existing
    Start-screening dialog. A newly-registered applicant appears here immediately.
  - **Interviews** — `GET /hr/interviews/awaiting` returns applicants who passed Initial Screening
    and are still live but have no interview yet; the Interview queue shows an **"Awaiting
    scheduling"** panel, each row opening the existing Schedule dialog. The list is backend-computed
    (active applicant + accepted screening − already-interviewed), so withdrawn/rejected applicants
    never appear. Scheduling invalidates the awaiting subtree.
  - Both queues reuse existing list APIs/repos; the two new read-only endpoints are the only backend
    additions and introduce no writes.
- **Optional interview committee.** `interviewerIds` is now optional at scheduling
  (`ScheduleInterview` defaults to `[]`); an interview can be scheduled before a committee is
  assigned, with members added later via the reassign-panel action. Validation, version checks,
  optimistic updates and cache behaviour are unchanged.
- **Withdraw / restore from any stage.** A shared **`ApplicantLifecycleActions`** control renders
  the one relevant action for the applicant — **Withdraw** while active (`new`), **Restore** while
  `withdrawn` — and is placed on the applicant detail **and every stage detail page** (Screening,
  Interview, Job Offer), so HR can withdraw or restore *from wherever they are working* without
  navigating away. Both actions are version-checked, `applicant.edit`-gated, and fully audited.
  - Restore (`POST /hr/applicants/:id/restore` → status `new`, emits `hr.applicant.restored`)
    **preserves all prior history** — screening decisions, interviews, offers, audit and timeline
    records are never deleted. Because visibility is **derived from the applicant's records** (not a
    stored stage pointer), a restored applicant **resumes from the exact stage they left**: one with
    an accepted screening but no interview reappears in *Awaiting scheduling* (Interviews), one with
    no screening reappears in *Awaiting screening*, one mid-interview or with an offer shows back in
    that stage's list — they never restart from the beginning. Withdraw/restore invalidate the
    screening + interview awaiting subtrees so the pipeline queues update immediately.
