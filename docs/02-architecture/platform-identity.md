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
  linkage. Platform/system accounts carry no `employeeId`.
- **Accounts are auto-provisioned** at employee creation (and backfilled at boot) per the frozen
  Auth & Account Lifecycle design (`docs/12-planning/auth-account-lifecycle-design.md`): username =
  Employee Code, temp password = National ID (or a one-time random password), server-enforced
  first-login change gate. The old **create-login-from-employee** flow
  (`POST /hr/employees/:id/login`, gated by `user.create`) remains as the manual override for
  audited provisioning skips (D7).
- **Configurable identifiers.** `auth.loginIdentifiers` enables username, email (optional on
  accounts) and the Employee Code, which resolves through an HR seam
  (`platform/auth/identity-seams.ts`) so the printed code logs in even after a username change.
- **Disable, never delete.** Departing employees are suspended/archived through the existing status
  lifecycle; history is preserved.

## 3. Permanent Global Employee Number + derived Employee Code

The **permanent identity** is the **Global Employee Number** (e.g. `000125`) — a **single global
atomic counter** (`hr_sequences` key `employee:global`, `$inc` in a transaction), company-wide unique,
never reused, never changed (unique `employeeNumber` index). The **displayed Employee Code** is
**derived** as `<CurrentBranchCode><GlobalEmployeeNumber>` (e.g. `001000125`) — it always reflects the
employee's current branch. On a branch transfer only the prefix changes (`004000125`); the number is
fixed, and the code is recomputed via `buildEmployeeCode(currentBranchCode, employeeNumber)`. Never
manually editable. The **Branch Code** is immutable after creation except for a super-admin
(`PATCH /platform/branches/:id/code`).

## 4. Minimal UI (this phase)

Identity UI lives on the **Employee detail** page (`EmployeeAccountCard`): shows the Employee Code
and Branch Code, surfaces the auto-provisioned account with its security state (gate armed, TOTP
on/required), admin actions (reset password to the temp policy, reset authenticator,
require/un-require TOTP — all under `user.resetPassword`), the manual create-login override, and
username editing. Self-service account security (change password, authenticator, sessions) is at
`/account/security`. No account-administration dashboard yet.

## 5. Future-proofing

The employee's employment carries optional `sectionId` and `jobPositionId` (null until set), so an
employee can later belong to Branch → Department → Section → Job Position with no schema change.
This never forces a vacancy link — the Talent Pool stays first-class (ADR-016).
