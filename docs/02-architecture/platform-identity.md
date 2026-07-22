# Platform Identity & Organizational Access Control (HR Foundation — Phase 2)

Permanent platform infrastructure that every module reuses (ADR-017). Three concerns: **who can see
which records** (data scope), **who a login belongs to** (account ↔ employee), and **how an employee
is identified** (branch-based code).

## 1. Hierarchical data scope

`own (Self) ⊂ section ⊂ department ⊂ branch ⊂ organization (Company)`. Data Scope answers "which
records can the user see?" — orthogonal to permissions ("what can the user do?", ADR-004).

- **One enforcement point.** `BaseRepository.scopeFilter` (`apps/api/src/shared/base/base.repository.ts`)
  filters by the caller's own placement carried on `AuthContext` / `ScopeSelector`:

  | scope | filter |
  |---|---|
  | `organization` (Company) | none — whole org |
  | `branch` | `branchField == ctx.branchId` |
  | `department` | `departmentField == ctx.departmentId` (includes all sections under it) |
  | `section` | `sectionField == ctx.sectionId` |
  | `own` (Self) | `createdBy`/assignees |

- **Opt-in per collection.** A repository declares `branchField` / `departmentField` / `sectionField`;
  an undeclared field widens that scope to organization-wide (the convention `branch` already used).
  Users (`organization.*Id`) and Employees (denormalized `branchId`/`departmentId`/`sectionId`) opt in.
- **Widest-granted wins** (`DATA_SCOPE_RANK`). Role assignments store the resolved home
  branch/department/section; `AuthContext` is built from the user's placement at login.
- **Backward compatible:** `own` = Self, `organization` = Company; the two new scopes are additive.

## 2. Login account ← Employee

- `User.employeeId` (opaque, unique) links a login to exactly one Employee; `Employee.userId` is the
  denormalized back-reference. The platform never imports a module type — the HR module owns the
  linkage and the **create-login-from-employee** flow (`POST /hr/employees/:id/login`, gated by
  `user.create`). Platform/system accounts carry no `employeeId`.
- **Username OR email.** A unique, mutable `username` (defaults to the Employee Code) is a second
  login identifier; email is retained. `login` accepts `identifier` (username or email) or `email`.
- **Disable, never delete.** Departing employees are suspended/archived through the existing status
  lifecycle; history is preserved. Password reset is unchanged.

## 3. Branch-based Employee Code

`<BranchCode><GlobalSequence>` — e.g. `001025`. The running number is a **single global atomic
counter** (`hr_sequences` key `employee:global`, `$inc` in a transaction), so the suffix is
company-wide unique and never repeats; a unique `code` index is the backstop. Set once at hire,
immutable, never manually editable. The **Branch Code** is immutable after creation except for a
super-admin (`PATCH /platform/branches/:id/code`).

## 4. Minimal UI (this phase)

Only the minimum identity UI, on the **Employee detail** page (`EmployeeAccountCard`): shows the
Employee Code and Branch Code, creates the login account (username defaults to the code), edits the
username, and shows the account's data scopes. No account-administration dashboard yet.

## 5. Future-proofing

The employee's employment carries optional `sectionId` and `jobPositionId` (null until set), so an
employee can later belong to Branch → Department → Section → Job Position with no schema change.
This never forces a vacancy link — the Talent Pool stays first-class (ADR-016).
