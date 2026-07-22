# Organization Structure (HR Foundation — Phase 1)

The **master organizational model** that every future module reuses. It is built on the existing
`platform/organization` backend (ADR-015) — this phase **enriches** the Job Title catalog and adds
the **web admin** to manage the whole structure end to end.

> Scope of Phase 1: Company · Branches · Departments · Sections · Job Titles.
> **Not** in this phase: Job Positions, Job Requisitions, Recruitment integration (see the roadmap).

## 1. The hierarchy (unchanged from ADR-015)

```
Company (singleton)
└── Branch
    └── Department          (platform-wide — every module belongs to one, not HR-only)
        └── Section
            ├── Job Position   (later phase)
            └── Employee       (later phase)

Job Titles ── organization-wide catalog (NOT nested under Section)
```

This tree is the **canonical organizational backbone** and the **source of navigation** (see §6):
**Branch is the first node** below the Company singleton; Departments, Sections, Job Positions and
Employees hang beneath it in later phases. Branches are therefore a **Platform** concern, never an
HR one.

- **Company** is a singleton profile (`/platform/organization`, `organization.view|edit`).
- **Branch → Department → Section** is the fixed hierarchy. Each unit carries a `code`, a bilingual
  `name`, `active|inactive` status, an optional `managerId` + acting-manager delegation window, and
  a materialized `path`. Branches additionally carry an optional postal address. Endpoints:
  `/platform/{branches|departments|sections}`, each gated by `{branch|department|section}.*`.
- Delete is soft and **guarded**: a unit with children cannot be removed (`ORG_UNIT_HAS_CHILDREN`).
- Every write is version-checked (optimistic concurrency), audited, and emits `platform.orgUnit.changed`.

## 2. Job Titles are an organization-wide catalog

A **Job Title defines a role** — it is deliberately **not** tied to a Branch/Department/Section.
Attaching a title to a concrete organizational location is the job of **Job Positions** (a later
phase), which keeps the Talent-Pool rule (ADR-016) possible.

### Enriched fields (this phase)

| Field | Type | Required | Notes |
|---|---|---|---|
| `code` | string | ✅ | uppercase, unique |
| `name` | `{ar,en}` | ✅ | |
| `jobGrade` | string | ✅ | grade label/code, e.g. `G5` |
| `description` | `{ar,en}` \| null | — | |
| `salaryMin` / `salaryMax` | number \| null | — | EGP; band must satisfy `min ≤ max` |
| `requiredQualifications` | `{ar,en}` \| null | — | |
| `requiredExperienceYears` | int \| null | — | numeric (years), reportable |
| `status` | `active`\|`inactive` | ✅ (default active) | |

- **Only `jobGrade` is newly required**; salary, description, qualifications and experience are
  optional and can be enriched over time.
- **Salary-band coherence** is enforced twice: the Zod schema refines when both bounds are present,
  and the service does a **merged-state** check on partial updates (a lone `salaryMax` is validated
  against the stored `salaryMin`), throwing `BUSINESS_RULE_VIOLATION`.
- No data migration: Job Titles were not previously seeded.

## 3. Frontend: a generic org-unit admin

The web module `apps/web/src/modules/organization/` is a lazy route subtree (`/organization/*`) with
its own shell + nav, mirroring the recruitment module. It follows every existing convention: RBAC
gating (`RequirePermission`/`Can`), TanStack Query with the shared key factory (ADR-013),
version-checked mutations, URL-synchronized list filters, i18n + RTL, and the shared UI kit.

Because Branch/Department/Section are structurally identical, their **List / Detail / Form screens
are one generic implementation** (`shared/Unit*Page.tsx`) configured per unit
(`shared/unit-config.ts`) — the same "thin over one implementation" shape the backend uses via
`makeOrgUnitHandlers`. Company and the enriched Job Titles have their own screens.

- **No new backend endpoints, permissions, or events** were introduced — the admin consumes the
  existing platform APIs and RBAC catalog.
- The manager field reuses the existing `/platform/users` search (degrades gracefully without
  `user.view`). Acting-manager delegation windows are supported by the backend and left for a later
  admin polish (they render as-is; the form does not yet edit them).

## 4. The Talent-Pool invariant (why this order matters)

Phase 1 builds the structure a role is *defined* against. It does **not** assume every applicant is
attached to a vacancy. That invariant — **Job Positions and Job Requisitions are OPTIONAL for
applicants; the Talent Pool is a first-class state** — is recorded in
[ADR-016](../03-decisions/ADR-016-optional-position-requisition-linkage.md) and **must not be broken
by any future module**. Recruitment already runs the full pipeline for a null requisition.

## 5. Roadmap (do not mix phases)

1. **Organization Structure** — *this phase* (Company, Branches, Departments, Sections, Job Titles).
2. **Job Positions** — an approved, budgeted headcount at a location (Branch + Department + Section
   + Job Title), e.g. *Cash Officer · authorized 120 · occupied 103 · vacant 17*. A position links a
   Job Title to a place; it is **not** a requisition.
3. **Job Requisitions** — a hiring request against a position (quantity, reason, priority, needed-by,
   budget, approval workflow).
4. **Recruitment integration** — two entry paths (from a requisition, and direct/Talent-Pool), with
   `jobRequisitionId` and `jobPositionId` kept **OPTIONAL** per ADR-016.
5. **Dynamic organizational sidebar** — the hierarchy in §1 rendered as a scope-filtered navigation
   tree (see §6).

Each phase is delivered on its own, reviewed, and merged before the next begins.

## 6. Navigation: the Organization Tree drives the sidebar (forward design)

The hierarchy in §1 is not only master data — it is the **navigation backbone**. The dynamic,
role-aware sidebar is future work, but the platform is **already architected to receive it
additively**; nothing below requires reworking the Branches implementation shipped in Phase 3.1.

**What already exists (the seams):**

- **Materialized tree.** Every unit stores a `path` — Branch `<branchId>`, Department
  `<branchId>/<departmentId>`, Section `<branchId>/<departmentId>/<sectionId>` — and Departments/
  Sections carry explicit parent ids (`branchId`, `departmentId`). The full tree is therefore
  reconstructable from the existing list endpoints; a later `GET /platform/organization/tree`
  read-model is a **pure addition** with no schema change.
- **Platform-generic, HR-free.** Branches/Departments/Sections live in `platform/organization`. The
  layer boundary (`eslint-plugin-boundaries`: `platform` may import only `platform|shared|
  infrastructure`) makes it **impossible** for a Branch to depend on HR. A Department is a
  first-class platform node that *any* module (Finance, Treasury, IT, Fleet, Audit, …) belongs to —
  department names are pure data, not code.
- **Scope machinery for the visible subtree.** Access already resolves through the five-rung data
  scope `own ⊂ section ⊂ department ⊂ branch ⊂ organization` (ADR-017), with `branchId`/
  `departmentId`/`sectionId` carried on the `AuthContext` and returned on `me`. This is exactly the
  input the dynamic sidebar consumes to decide what a viewer may see:
  - **System Administrator** (`organization` scope / `isPrivileged`) → the whole tree.
  - **Department Manager** (`department` scope) → their department + its sections.
  - **Section Manager** (`section` scope) → their section.
  - **Employee** (`own` scope) → only their assigned applications.

**What is deliberately deferred (and why it needs no rework now):** the tree read-model endpoint and
a data-driven tree navigation component. The current static, permission-filtered `NavSection[]`
(module-contributed) and the future scope-filtered org tree are **separate concerns** that coexist —
the dynamic tree is a new component fed by API data + `me` scope, not a rewrite of the existing nav
model. Building it before a consumer exists would be speculative; it lands with the phase that needs
it.
