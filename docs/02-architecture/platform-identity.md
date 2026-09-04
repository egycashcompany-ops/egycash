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
  Auth & Account Lifecycle design (`docs/12-planning/auth-account-lifecycle-design.md`, Rev 6):
  username = Employee Code, born `invited` with a **one-time setup link delivered to the employee
  via WhatsApp + email** (transient — never persisted or echoed by any API), expiring after
  `auth.activationLink.ttlHours`; the employee chooses their own policy-checked password at
  `/activate`. Resend issues a new link (old one dies); admin reset locks the account and sends a
  fresh link; disable/exit revokes any pending link and all sessions; an hourly sweep revokes
  expired links. The full invitation lifecycle is audited and the state/sequence diagrams live in
  `docs/02-architecture/account-lifecycle.md`. The old **create-login-from-employee** flow
  (`POST /hr/employees/:id/login`, gated by `user.create`) remains as the manual override for
  audited provisioning skips (D7).
- **Configurable identifiers.** `auth.loginIdentifiers` enables username, email (optional on
  accounts) and the Employee Code, which resolves through an HR seam
  (`platform/auth/identity-seams.ts`) so the printed code logs in even after a username change.
- **Disable, never delete.** Departing employees are suspended/archived through the existing status
  lifecycle; history is preserved.

## 3. Permanent Global Employee Number + an Employee Code issued at hire

The **permanent identity** is the **Global Employee Number** (e.g. `0125`) — a **single global atomic
counter** (`hr_sequences` key `employee:global`, `$inc` in a transaction), four digits wide, never
reused, never changed. The counter is what makes it unique; `employeeNumber` carries a plain index,
not a unique one (see ADR-017 §3 for the two legacy numbers that settled this).

The **Employee Code** is `<BranchCodeAtHire><GlobalEmployeeNumber>` (e.g. `0100004`), **composed once
at hire by `buildEmployeeCode` and then frozen**. Nothing recomputes it — not a transfer, not a
rehire into another branch, not a super-admin correcting the branch's code. It records which branch
*hired* the employee; `branchId` records where they are *now*, and only that moves. `code` carries
the unique index, and is never manually editable.

Do not re-derive a code to compare against the stored one: for anyone who has transferred, the two
legitimately differ. `code-freeze.spec.ts` reads the sources and holds this rule in place.

The **Branch Code** is immutable after creation except for a super-admin
(`PATCH /platform/branches/:id/code`), and changing it deliberately leaves every employee code alone.

## 4. Minimal UI (this phase)

Identity UI lives on the **Employee detail** page (`EmployeeAccountCard`), now a full Account
panel (design §16.5): the derived account status (Not Invited / Invitation Sent / Activated /
Expired / Locked), lifecycle timestamps (invitation sent/expires, activated at, last login,
password last changed), per-channel delivery outcomes, TOTP state, admin actions (reset — lock +
fresh setup link, resend setup link, reset authenticator, require/un-require TOTP — all under
`user.resetPassword`), the manual create-login override, and username editing. Self-service account security (change password,
authenticator, sessions) is at `/account/security`; the public setup page is `/activate`. No
account-administration dashboard yet.

## 5. Future-proofing

The employee's employment carries an optional `sectionId` (null until set), so an employee can
belong to Branch → Department → Section with no schema change. It once carried `jobPositionId`
beside it; P-ORG-1 (2026-08-24) merged Job Positions into Job Titles and removed the field with the
entity, so the job an employee holds is `jobTitleId` and where it sits is the department and section
on the record. This never forces a vacancy link — the Talent Pool stays first-class (ADR-016).
