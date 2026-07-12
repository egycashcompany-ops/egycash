# Recruitment — Frontend Foundation (Phase 1)

Implementation reference for the **HR / Recruitment web frontend foundation** — the reusable
shell, shared UI kit, and platform integration that every recruitment screen builds on. This
phase deliberately builds **no feature screen** (not even Applicants); it establishes the ground
every later screen reuses. Stack and state rules follow
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

- **Feature screens** — Applicants and the other six stages (this phase is foundation only).
- **shadcn/ui + react-hook-form** — §6 names these as the eventual kit; the foundation provides the
  same wrapped-in-`shared/ui` surface with hand-rolled, dependency-free primitives so a later
  migration is localized. No behavior depends on the concrete library.
- **Live notifications inbox** — the bell + toast sink are in place; the server-backed inbox and
  Socket.IO badge land with that feature.
- **Frontend unit tests** — no web test runner is configured yet; typecheck + lint + build are the
  current gates. A component test setup (Vitest + Testing Library) is a fast follow.
