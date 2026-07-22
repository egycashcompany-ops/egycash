# ADR-017: Platform Identity & Organizational Access Control

**Status:** Accepted · **Date:** 2026-07-22 · **Builds on:**
[ADR-004](ADR-004-permission-based-authorization.md) (permissions),
[ADR-015](ADR-015-single-organization-model.md) (organization model),
[ADR-016](ADR-016-optional-position-requisition-linkage.md) (Talent Pool)

## Context

Every future module (HR, Accounting, Treasury, Fleet, ATM, Security, IT, …) needs one shared answer
to three foundational questions: **which records can a user see**, **who a login account belongs to**,
and **how an employee is identified**. These must be platform infrastructure, not per-module code,
and must scale to hundreds of branches and thousands of employees without a redesign.

Three gaps existed after Phase 1:

1. Data scopes were only `own | branch | organization` — no department/section granularity.
2. Login accounts (`User`) and employees (`Employee`) were unlinked; login was email-only.
3. The employee number was org-wide `EMP-{YYYY}-{seq:6}`, not tied to the branch identity.

## Decision

### 1. Hierarchical data scopes (extend, don't replace)

The visibility ladder becomes **`own ⊂ section ⊂ department ⊂ branch ⊂ organization`** (narrow→wide),
mapping to the business terms **Self / Section / Department / Branch / Company**. The tokens `own`
and `organization` are **kept** (backward compatible); `section` and `department` are added.

- Enforcement stays in the **one place** it already lived — `BaseRepository.scopeFilter` (ADR-004).
  A scope filters by the caller's own placement: `branch → branchId`, `department → departmentId`
  (which naturally includes every section under it), `section → sectionId`. Widest-granted wins.
- Collections opt into finer scoping by declaring `branchField` / `departmentField` / `sectionField`;
  an undeclared field widens that scope to organization — the exact convention `branch` already used.
- `AuthContext`, `ScopeSelector`, and role assignments carry `departmentId` / `sectionId`. A
  hierarchical grant resolves to the user's **home** placement at that level (as `branch` already did).
- **No permission changes** — scope is orthogonal to "what a user can do" (ADR-004).

### 2. Login account ← one Employee (identity)

- **Every login account belongs to exactly one Employee; every Employee has zero-or-one account.**
  The platform `User` carries an opaque, unique `employeeId` (no cross-layer import); the HR module
  owns the linkage (`Employee.userId`) and the **create-login-from-employee** orchestration. Platform/
  system accounts (e.g. the seeded super-admin) carry no `employeeId`.
- **Authentication accepts a username OR an email.** A new, unique, mutable `username` is added and
  **defaults to the Employee Code**; email support is retained. Administrators may change the username
  later; the Employee Code is never editable.
- Accounts are **enabled/disabled** through the existing status lifecycle — an employee who leaves is
  **disabled, never deleted** (history is preserved). Password reset is unchanged.

### 3. Permanent Global Employee Number + a branch-derived Employee Code

- The **permanent identity** is the **Global Employee Number** — a company-wide, monotonic, zero-padded
  sequence (e.g. `000125`) that **never changes** and is globally unique. It is allocated from a
  **single global** atomic `$inc` sequence (BD-002) on one key inside the hiring transaction —
  concurrency-safe, no duplicates (a unique `employeeNumber` index backs it). The database treats it
  (with the Employee `_id`) as the permanent identity.
- The **displayed Employee Code** is **derived**: `<CurrentBranchCode><GlobalEmployeeNumber>`
  (e.g. `001` + `000125` → `001000125`). It immediately tells you the employee's current branch.
- On a **branch transfer**, only the branch prefix changes (`001000125` → `004000125`); the Global
  Employee Number is fixed. The code is denormalized for search/display and recomputed from
  `buildEmployeeCode(currentBranchCode, employeeNumber)` whenever the branch changes — the reusable
  seam a future transfer uses. It is never manually editable.

### 4. Branch Code is immutable — except super-admin

The Branch Code is required, unique, validated, and immutable after creation (it is part of every
employee's identity). A **super-admin** may correct it through a dedicated, privileged endpoint.

## Alternatives considered

- **Rename `own`→`self` / `organization`→`company`** — rejected: a churny rename across the permission
  matrix, tests and seeds for no capability gain. The tokens are kept; the business labels are the UI's.
- **User references Employee as the authority** — the opposite link direction. Rejected as the sole
  authority because the platform must not import a module type; instead `User.employeeId` is an opaque,
  unique back-reference and the module owns orchestration (boundary-correct, ADR-003).
- **Per-branch employee sequence** — rejected: the business requires a company-wide non-repeating
  number; a per-branch sequence would repeat suffixes across branches.
- **A separate platform "staff directory" distinct from the recruitment Employee** — rejected as
  premature: the Employee is already the canonical hire record; duplicating it violates "no parallel
  systems." A future dedicated Employee module can absorb it without changing this contract.

## Consequences

- ✅ One reusable access-control model for every module; finer scopes are opt-in per collection.
- ✅ Employee identity, login, and code are permanent platform infrastructure, scale-ready.
- ✅ Fully backward compatible: existing `own/branch/organization` grants and email logins keep working.
- ✅ ADR-016 is untouched — nothing here forces an applicant/employee to belong to a Job Position or
  Requisition; the Talent Pool remains first-class.
- ⚠️ Creating a login requires an email (kept required) — deliberate, to avoid nullable-email ripple.
- ⚠️ Employee creation now requires the hiring **branch to exist** (its code prefixes the employee
  code); offers/tests must reference a real branch.
