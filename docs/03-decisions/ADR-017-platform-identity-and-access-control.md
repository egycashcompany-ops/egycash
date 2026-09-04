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

### 3. Permanent Global Employee Number + an Employee Code issued at hire

- The **permanent identity** is the **Global Employee Number** — a company-wide, monotonic,
  zero-padded sequence (e.g. `0125`) that **never changes**. It is allocated from a **single global**
  atomic `$inc` sequence (BD-002) on one key inside the hiring transaction, which is what makes it
  unique: uniqueness is a property of how numbers are made, not of an index. It is **four digits**
  wide, matching the numbering the company already uses, and widens past `9999` without truncating.
- The **Employee Code** is `<BranchCodeAtHire><GlobalEmployeeNumber>` (e.g. `010` + `0004` →
  `0100004`). It is **composed once, at hire, and stored**. It tells you which branch *hired* the
  employee — where they work *now* is `branchId`, and only that moves.
- **Nothing recomputes the code afterwards.** Not a branch transfer, not a rehire into another
  branch, not a super-admin correcting the branch's own code. `buildEmployeeCode` is called by the
  two hire paths and nowhere else; `code-freeze.spec.ts` reads the sources and enforces this.
- **`employeeNumber` is indexed but NOT unique-indexed.** The allocator cannot issue a number twice,
  so the index was only ever a second line of defence — and the go-live workforce carries two
  numbers the company itself issued twice on paper (`1311`, `1651`; four people, all exited). A
  unique index would have forced a renumbering, and renumbering rewrites a code printed on
  contracts and insurance filings. `code` carries the unique index instead.

**Why frozen, when the opposite rule stood here first.** A derived code keeps the prefix honest
about where somebody works, which is genuinely useful. It was overturned by evidence: of the 2,699
employees in the go-live workforce, **148 carry a prefix from a branch they no longer work at** —
the company transfers people and their code stays. Re-deriving on import would have renamed 148
real people whose code appears on documents nobody reissues. The prefix answers *who hired you*.

*Consequence to hold onto:* `code` is **not** reconstructible from an employee's current row.
`buildEmployeeCode(currentBranch.code, employeeNumber)` may legitimately differ from the stored
`code`. Read the stored value; never re-derive one to compare against it.

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
- ✅ ADR-016 is untouched — nothing here forces an applicant/employee to belong to a vacancy; the
  Talent Pool remains first-class. *(Written when Job Positions were expected; P-ORG-1 merged them
  into Job Titles on 2026-08-24, and the Requisition half of ADR-016 stands.)*
- ⚠️ Creating a login requires an email (kept required) — deliberate, to avoid nullable-email ripple.
- ⚠️ Employee creation now requires the hiring **branch to exist** (its code prefixes the employee
  code); offers/tests must reference a real branch.
