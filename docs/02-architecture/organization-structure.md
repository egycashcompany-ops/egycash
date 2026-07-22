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
    └── Department               (platform-wide — every module belongs to one, not HR-only)
        ├── Job Position         (belongs to the DEPARTMENT, never a Section — later phase)
        └── Section              (organizational subdivision only)
            └── Employee         (belongs to a Section; its Job Position is the Department's — later phase)

Job Titles ── organization-wide catalog (NOT nested under Section)
```

This tree is the **canonical organizational backbone**: **Branch is the first node** below the
Company singleton; Departments, Sections, Job Positions and Employees hang beneath it in later
phases. Branches are a **Platform** concern, never an HR one. The tree governs **data visibility &
scope, HR, reporting and approvals — it does NOT generate the navigation sidebar.** Organization and
Navigation are two independent hierarchies; see §6.

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
2. **Job Positions** — an approved, budgeted headcount **owned by a Department** (Department + Job
   Title; **not** a Section — see §7), e.g. *Cash Officer · authorized 120 · occupied 103 · vacant
   17*. A position links a Job Title to a Department; it is **not** a requisition.
3. **Job Requisitions** — a hiring request against a position (quantity, reason, priority, needed-by,
   budget, approval workflow).
4. **Recruitment integration** — two entry paths (from a requisition, and direct/Talent-Pool), with
   `jobRequisitionId` and `jobPositionId` kept **OPTIONAL** per ADR-016.

Navigation is **not** part of this roadmap — it is a **separate track** (Applications; see §6).

Each phase is delivered on its own, reviewed, and merged before the next begins.

## 6. Organization vs Navigation — two independent hierarchies

**The Organization hierarchy does NOT generate the sidebar.** These are two different concepts and
must stay decoupled; the Organization module must never know anything about navigation.

### 6.1 Organization hierarchy — data scope, not navigation

`Company → Branch → Department → Section → Job Position → Employee` (§1) is the **organizational
backbone**. Its *only* jobs are:

- **Data visibility & scope** — the five-rung ladder `own ⊂ section ⊂ department ⊂ branch ⊂
  organization` (ADR-017), enforced in `BaseRepository.scopeFilter`, with `branchId`/`departmentId`/
  `sectionId` carried on the `AuthContext` and returned on `me`.
- **HR, reporting and approvals** — org placement, reporting lines, approval routing.

It answers *“what data may this user see and act on?”* — never *“which screens appear in the
sidebar?”*.

### 6.2 Navigation / Sidebar — generated from Applications (a separate, future concept)

The sidebar is generated from the **Applications (Modules)** assigned to the user — **not** from the
organization tree. The intended shape (illustrative; **not implemented yet**):

```
HR Department              Treasury Department        ATM Operations
  Recruitment                Treasury                   ATM
  Employees                  Cash Transfer              Cash Loading
  Attendance                 Gold Treasury              ATM Reconciliation
  Payroll
```

Planned model (deferred — do **not** build until its own phase):

- An **Application** (a.k.a. Module) is a first-class catalog entity (e.g. *Recruitment*, *Payroll*,
  *Treasury*, *ATM Reconciliation*).
- Each **Department** is later linked to **one or more Applications**.
- Each **User** carries: **Branch · Department · Section · Job Position · Applications · Roles**.
- The **Sidebar is built from the user's assigned Applications** (grouped for display, e.g. by
  department/application group), filtered by the user's **Roles/permissions**. The organization
  tree contributes **scope** to what data those applications show — it does **not** decide which
  applications appear.

### 6.3 Why the current code already honours this separation

- The **backend** `platform/organization` module has **no navigation concept** at all (verified: no
  `nav`/`sidebar`/`menu` references). It only serves org master data + scope.
- On the **web**, each module contributes its **own** static `NavSection[]` to its **own** shell
  (`AppShell nav={…}`); the shared `Sidebar` is a dumb renderer that receives `nav` as a prop.
  Nothing derives a sidebar from the organization tree, and the org admin's nav is just that module's
  own section list.
- When the Applications concept lands, the dynamic sidebar becomes a **new** read-model over
  *Applications × Roles* — an additive component that does not touch the Organization module and does
  not reuse the org tree as a menu source.

> **Guardrail for future phases:** keep `platform/organization` free of any navigation/menu/sidebar
> logic. Sidebar generation belongs to the (future) Applications track, keyed off the user's assigned
> Applications and Roles, with the org hierarchy supplying data scope only.

## 7. Access & Applications model (locked; NOT implemented yet)

Three relationship rules are **locked now** so that Branches, Departments, Sections and (future) Job
Positions are built without foreclosing them. **None of these are implemented in this phase** — they
constrain future design only. The current code already leaves room for all three (see §7.4).

### 7.1 Applications ↔ Departments is **many-to-many**

Applications are **not owned by Departments**. A Department is a **consumer** of Applications, and the
**same Application can serve many Departments**:

```
Recruitment   → HR
Payroll       → HR, Finance
Treasury      → Treasury
Cash Transfer → Operations, Treasury
ATM           → ATM Operations
Accounting    → Finance
```

Modelled later as a **join** (`department ⇄ application`), never as an Application field on Department
or a Department list on Application. This keeps an Application reusable across departments.

### 7.2 Access derivation: User → Job Position → Department → Applications → Roles

Users are **not** assigned Applications directly by default. The preferred chain is:

```
User → Job Position → Department → Applications → Roles
```

i.e. a user's Applications (and thus their sidebar) are **derived** from the Department their Job
Position belongs to, then filtered by Roles. **Keep this flexible:** the architecture must still allow
an **optional direct User → Application (and/or Role) assignment** as a business exception later. The
existing `role_assignments` collection already links `userId → roleId` directly, so both the derived
path and a direct-override path remain open — no rework required.

### 7.3 Job Positions belong to **Departments**, not Sections

A **Job Position** is owned by a **Department** (e.g. *HR → HR Manager · Recruiter · HR Specialist*;
*Finance → Accountant · Senior Accountant · Finance Manager*). **Sections are organizational
subdivisions only.** An **Employee belongs to a Section**, but the **Job Position it holds belongs to
the Department** — the two are independent references on the employee, not a Position-under-Section
nesting. When Job Positions are built (roadmap #2), the entity carries `departmentId` (required) and
**no** required `sectionId`.

### 7.4 Why nothing built blocks this

- **Employee** already carries `departmentId` (required), `sectionId` (nullable) and `jobPositionId`
  (nullable) as **independent opaque references** — so "belongs to a Section, holds a Department's Job
  Position" is already representable with no schema change.
- **Job Position** and **Application** entities **do not exist yet**, so their shape is unconstrained;
  when added they will be a Department-owned Position and a many-to-many Application join.
- **Departments/Sections** are plain org units (`branchId`, and `departmentId` for sections) with no
  embedded application/position lists that would force a one-to-many — a future M2M join is a pure
  addition.
- **RBAC** already supports direct `userId → roleId` assignments with scope, so the derived
  (Position→Department→Applications→Roles) model and the optional direct override can both be layered
  on additively.

> **Guardrail for future phases:** Applications are a catalog joined **many-to-many** to Departments;
> a user's Applications are **derived** via Job Position → Department (direct user assignment allowed
> only as an explicit exception); and Job Positions are **Department-owned** (Sections never own
> Positions). Do not build any of this until its own phase.
