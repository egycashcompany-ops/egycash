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

- **Feature screens** — the later-stage screens (Applicants ships in Phase 2 — §7; Initial Screening in Phase 3 — §8; Interviews in Phase 4 — §9; Job Offer in Phase 5 — §10; Employees in Phase 6 — §11; Hiring Documents / Employee Files remain later sprints).
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
- **OCR assist** (create) — upload a National-ID image → the server extraction seam runs → each
  field returns with a confidence band and can be applied to the form. Degrades gracefully to
  "enter manually" when no provider is wired (OQ-30). Nothing is trusted; the user confirms.
- **Integration** — all calls go through the feature `api/` layer against the existing endpoints
  (`/hr/applicants`, `/hr/applicant-sources`, `/hr/applicants/ocr/national-id`,
  `/hr/applicants/:id/attachments`, `/hr/applicants/export`, `/hr/applicants/bulk`, and
  `/platform/files` + `/platform/file-categories` for uploads). Reads are cached and writes
  invalidate the feature subtree.

**Cross-module references** (Job Requisition, Branch) are never entered as raw IDs: `RefPickers`
renders a disabled "coming soon" selector when no value is present, or a read-only reference chip
when one is supplied by context (the create route accepts `?requisitionId=…&branchId=…`, which the
future Requisitions screen will deep-link). Detail views show the same read-only chip. Creation is
gated until a requisition context is provided.

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
