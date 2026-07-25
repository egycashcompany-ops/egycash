# Authentication & Employee Account Lifecycle — Design (for approval)

**Status: DRAFT — awaiting approval. No implementation yet.**

One cohesive feature: every employee automatically receives a working login the moment they are
registered, first login forces a password change, login accepts username/employee-code/email,
password and TOTP management become complete self-service + admin surfaces. Fully additive and
backward-compatible: no existing account changes behavior until an admin or the user acts.

---

## 0. What already exists (the seams this design builds on)

| Capability | Today |
|---|---|
| `username` on users | Exists — second login identifier, lowercased, live-unique, defaulted to the Employee Code by the manual `createLogin` |
| Login by username OR email | Exists — `LoginSchema.identifier` + `findByUsernameOrEmail` |
| Employee ↔ User link | Exists — `users.employeeId` (live-unique), `hr.employee.loginLinked` event, Leave own-scope backfill |
| Self password change | Exists — `POST /auth/password/change` (current + new ≥ 8 chars) |
| TOTP login challenge | Exists — login returns `totpRequired` + challenge token **only when the user has TOTP enabled** (already requirement #5's login behavior) |
| TOTP self enroll/verify/disable | Exists as API (`/auth/totp/*`); UI exists only inside the login challenge flow |
| Forced TOTP for privileged | Exists — `TotpEnforcedForPrivileged` setting (Review R13), enroll-challenge at login |
| Account lockout + rate limits | Exist — `failedLogins`/`lockedUntil`, strict limiter on login/totp |
| Invite/activation flow | Exists — `status: invited` + activation token (stays, for admin-created platform users) |

Genuinely new: **auto-creation**, **temp-password policy**, **`mustChangePassword`**,
**optional email**, **admin password reset**, **admin TOTP reset**, **self-service Security page**.

---

## 1. Product decisions for approval (D1–D7)

| # | Decision | Recommendation |
|---|---|---|
| **D1** | When is the account created? | **At employee creation** (both paths: hire-from-offer and direct registration). Probationers need self-service (leave, payslips later) from day one; "confirmation" gates nothing account-related. |
| **D2** | Backfill existing employees without logins? | **Yes** — one idempotent boot backfill creates accounts for every *employed* employee with `userId: null`, same policy (username = code, temp password = NID, `mustChangePassword`). This is what makes "no manual step" true for your current database. Exited employees are skipped. |
| **D3** | Temp password when the employee has **no National ID** (field is nullable)? | **Fallback = Employee Code** (uppercase, as printed). Deterministic, communicable by HR without a side channel. The forced change neutralizes both defaults equally. |
| **D4** | Enforcement point for `mustChangePassword` | **Server-side**: while the flag is set, every authenticated call except `password/change`, `me`, `logout` fails with a dedicated error code; the web shows a full-screen change-password gate. Client-only redirects are not security. |
| **D5** | Admin password-reset permission | New catalog permission **`user.resetPassword`** (scope-aware), granted to super-admin automatically via the catalog sync. Reusing `user.edit` would silently widen an existing grant — additive is safer. |
| **D6** | Admin TOTP control semantics | Admin can **disable** and **reset** (clear secret + backup codes so the user re-enrolls). Admin **cannot directly "enable"** — enrollment mathematically requires the user's device to scan the secret. "Admin enable" = reset + the user enrolls at next login/profile visit. `TotpEnforcedForPrivileged` (R13) is kept as-is. |
| **D7** | Should the manual "Create Login" UI remain? | **Yes, repurposed** — the Account tab keeps an admin escape hatch (custom email/username) for edge cases, but the normal workflow never needs it because the account already exists. |

---

## 2. Affected modules

| Layer | Module | Change class |
|---|---|---|
| contracts | `platform/auth`, `platform/users`, `modules/hr-employee` | additive DTO/schema fields, 1 new error code, 1 new permission |
| api | `platform/users` | schema fields, temp-password creation path, admin reset, optional email |
| api | `platform/auth` | identifier resolution (+employee code), `mustChangePassword` gate, login/me flags |
| api | `platform/rbac` | new `user.resetPassword` permission in the catalog (auto-synced to super-admin) |
| api | `modules/hr/employee-management` | auto-provision on both creation paths + boot backfill; ESS role granted at link time (today it waits for the next boot) |
| web | `platform/auth` | login page copy, forced-change gate screen |
| web | `platform` (new) | **Security page** (`/account/security`): change password, TOTP enroll/disable |
| web | users admin + employee Account tab | reset-password and TOTP-reset actions; auto-account display |
| docs | architecture + CHANGELOG | companion doc §, migration notes |

Zero changes to: recruitment, leave, organization, files, notifications internals (notifications
only gain two templates). The frozen Leave contracts are untouched — `loginLinked` fires exactly
as today, so the own-scope backfill keeps working unchanged.

---

## 3. Data model changes (all additive)

**`users`**
- `security.mustChangePassword: boolean` — schema default `false` ⇒ **existing documents are
  unaffected** (missing ⇒ false on hydrated reads; the auth gate treats only explicit `true` as set).
- `email: string | null` — becomes optional. The live-unique index becomes partial on
  `email: { $type: 'string' }` (same pattern as `username`). Existing emails keep working.
- No other changes; TOTP structure, activation, lockout stay as-is.

**`hr_employees`** — none. (`personal.nationalId` and `personal.contact.email` already exist.)

**Index migration**: `ux_email` must be dropped and re-created with the partial filter — a
guarded boot step (only when the existing index lacks the filter), idempotent, non-locking at
this data size.

---

## 4. Behavior design

### 4.1 Auto account creation (idempotent)

A single service seam `employeeService.ensureLoginFor(employee, by)` called from **both**
creation paths (hire-from-offer, direct registration) and from the boot backfill (D2):

1. Skip if `employee.userId !== null` (idempotency guard #1).
2. Skip if another live user already has `username == employee.code` (collision safety; audited warning).
3. Create the user: `username = employee.code` (lowercased for storage, resolution is
   case-insensitive), `email = employee.personal.contact.email ?? null`, names/locale/org
   placement copied from the employee, **status `active` immediately** (no invite),
   `passwordHash = hash(NID ?? employee code)` (D3), `mustChangePassword = true`.
4. Link `employee.userId`, grant the **ESS role at link time** (closing today's gap where the
   grant waits for the next boot), audit `loginCreated`, emit `hr.employee.loginLinked`
   (unchanged payload — Leave backfill just works).
5. Notify HR (existing template mechanism) that credentials follow the standard policy.

DB-level guards make double-provision impossible even racing: `ux_username` + `ux_employeeId`
live-unique indexes already exist. The temp password is **never stored or returned in
plaintext** — it is derived from data HR already possesses.

### 4.2 Forced password change

- Login succeeds normally and returns `mustChangePassword: true` in the login response and in
  `MeDto`.
- While the flag is set, `authenticate`d endpoints other than
  `POST /auth/password/change`, `GET /auth/me`, `POST /auth/logout`, `POST /auth/refresh`
  return **403 `PASSWORD_CHANGE_REQUIRED`** (new error code) — enforced in the auth middleware,
  one comparison, zero cost for normal users.
- `password/change` (which validates the current password) clears the flag and stamps
  `passwordChangedAt`. Nothing else clears it.
- Existing users: flag absent ⇒ never gated.

### 4.3 Identifier resolution

`findByIdentifier(raw)` resolution order (first match wins), all case-insensitive:
1. `username` (covers employee codes for all auto-created + createLogin accounts);
2. `email`;
3. `employees.code` → linked `userId` (covers the corner where an admin changed the username —
   the printed employee code always works).
Unknown-identifier handling, lockout counters, and audit stay exactly as today.

### 4.4 Password management

- **Self**: existing `POST /auth/password/change`, now also clears `mustChangePassword`; gets a
  proper UI home on the new Security page.
- **Admin**: `POST /platform/users/:id/reset-password` (permission `user.resetPassword`):
  re-derives the temp password per policy (linked employee's NID → employee code → for
  employee-less platform accounts: a generated one-time password returned **once** in the
  response), sets `mustChangePassword = true`, **revokes all sessions**, audits, notifies the user.

### 4.5 TOTP

- **Login**: unchanged — prompts only when the user has TOTP enabled (already true), or the
  enroll-challenge when the privileged-enforcement setting demands it (R13 kept).
- **Self-service**: the Security page exposes the existing enroll/verify/disable endpoints
  (disable requires a valid code — unchanged).
- **Admin**: `POST /platform/users/:id/totp/reset` (permission `user.resetPassword` — same
  trust level): clears `enabled/secret/backupCodes`, revokes sessions, audits, notifies. Per D6
  there is no admin "enable"; enforcement remains the R13 setting.

---

## 5. API changes (all additive)

| Endpoint | Change |
|---|---|
| `POST /auth/login` | response gains `mustChangePassword: boolean` |
| `GET /auth/me` | `MeDto` gains `mustChangePassword: boolean`, `username: string \| null`, `totpEnabled: boolean` |
| `POST /auth/password/change` | also clears `mustChangePassword` |
| `POST /platform/users/:id/reset-password` | **new** — `user.resetPassword` |
| `POST /platform/users/:id/totp/reset` | **new** — `user.resetPassword` |
| `POST /platform/users` (admin create) | `email` becomes optional in `CreateUserSchema` |
| `POST /hr/employees/:id/login` | kept (D7); auto-creation makes it an escape hatch |
| Error codes | **new** `PASSWORD_CHANGE_REQUIRED` |

No endpoint is removed or reshaped — every existing client keeps working.

## 6. Web UI changes

1. **Login page** — identifier field labeled "Email / username / employee code" (en+ar); on
   `mustChangePassword: true` route to the gate instead of the app.
2. **Forced-change gate** — full-screen, current + new + confirm, no navigation escape (server
   enforces anyway); success → normal entry.
3. **Security page** (`/account/security`, any authenticated user) — change password; TOTP
   status + enroll (QR) / disable. New platform page, linked from the user menu.
4. **Users admin detail** — "Reset password" and "Reset authenticator" actions (gated by
   `user.resetPassword`), with confirm dialogs explaining the consequences.
5. **Employee profile → Account tab** — shows the auto-created account (username, status,
   TOTP state) instead of the "no login yet" prompt; manual creation remains as the escape hatch.
6. i18n en+ar for all of the above.

## 7. Migration strategy (boot, idempotent — same pattern as PR #78)

1. `users`: nothing to rewrite — `mustChangePassword` missing ⇒ false; email index swapped
   guardedly (③.Index migration).
2. **D2 backfill**: for each *employed* employee with `userId: null` → `ensureLoginFor`
   (skips forever after via the `userId` guard). Runs inside the HR seed chain after the
   employee-registry migration.
3. Permission catalog: `user.resetPassword` lands via the existing `syncPermissionRegistry`
   (super-admin picks it up automatically, holders invalidated — the PR #78 machinery).
4. Re-running any step N times = no-op (`legacy-upgrade` suite will assert it, same as PR #78).

## 8. Backward compatibility

- Existing users: no flag, no forced change, same login, same TOTP state, email login unchanged.
- Seeded admin/HR accounts: platform accounts without employees — untouched by backfill.
- Manual `createLogin` + invite/activation flow: preserved verbatim for admin-created users.
- Frozen Leave contracts: `loginLinked` payload unchanged; ESS grant only moves *earlier*.
- `LoginSchema`: `email` field kept alongside `identifier` (existing clients unaffected).

## 9. Security review

| Risk | Mitigation |
|---|---|
| NID as temp password is guessable by insiders (HR knows NIDs) | `mustChangePassword` is **server-enforced** — the temp password grants access to nothing except the change-password endpoint; lockout + strict rate limiting already apply; org guidance documented: communicate credentials through the HR channel and expect immediate change. |
| Temp password reuse after admin reset | Reset revokes **all sessions** and re-arms the gate. |
| NID exposure | Never returned by any API (masked DTOs unchanged); the hash is stored, not the NID; the reset response never echoes it. |
| Username enumeration | Same generic unknown-identifier response as today; employee-code resolution does not change the error shape. |
| Privileged accounts weakening | R13 stands: TOTP still force-enrolled for privileged users; admin reset of a privileged user's TOTP re-triggers enroll at next login. |
| Gate bypass | Enforced in `authenticate` middleware, not the client; refresh allowed so the gate itself can hold a session. |
| Admin reset abuse | Dedicated audited permission (`user.resetPassword`), every use audited with actor + target; break-glass review applies. |
| Password policy | Existing ≥8/≤128 on change; the gate forces the *new* password through this policy immediately, so NID-strength secrets live only for one login. |

## 10. Delivery plan (after approval)

One PR: contracts → platform (users/auth/rbac) → HR auto-provision + backfill → web → tests
(unit + integration: auto-provision idempotency, gate enforcement incl. bypass attempts,
identifier matrix, admin reset/TOTP reset, legacy-user non-impact, repeated boots) → docs.
Same discipline as always: adversarial pass, CI green, wait for review.
