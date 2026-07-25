# Authentication & Employee Account Lifecycle — Design (FROZEN, Revision 2)

**Status: FROZEN — approved with decisions D1–D7 as recorded below (D3 and D6 amended by the
approver). Implementation proceeds as a single PR.**

> **Revision 2 (2026-07-25, approver's credentials-delivery amendments R1–R11 — §12).**
> The provisioning flow changed materially: the National ID is **never** used as a credential
> (every account gets a unique CSPRNG temporary password), credentials are **delivered to the
> employee via WhatsApp + email** through a provider-agnostic transport layer, temporary
> passwords **expire** after a configurable period with an admin re-issue flow, and passwords
> are **never exposed through any API response**. §12 supersedes D3, §4.1 step 3, §4.4, and
> the `temporaryPassword` response fields in §5 wherever they conflict. Everything else
> stands as approved in Revision 1.

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
| **D3** | Temp password when the employee has **no National ID** (field is nullable)? | **APPROVED AS AMENDED: never the Employee Code — it is public information.** With NID: temp password = NID. Without NID: generate a **strong random temporary password, shown exactly once to HR** (in the creation/reset response), stored as hash only. Boot-backfilled NID-less employees get an unseen random hash; HR issues a visible one via admin reset when that employee actually needs access. |
| **D4** | Enforcement point for `mustChangePassword` | **Server-side**: while the flag is set, every authenticated call except `password/change`, `me`, `logout` fails with a dedicated error code; the web shows a full-screen change-password gate. Client-only redirects are not security. |
| **D5** | Admin password-reset permission | New catalog permission **`user.resetPassword`** (scope-aware), granted to super-admin automatically via the catalog sync. Reusing `user.edit` would silently widen an existing grant — additive is safer. |
| **D6** | Admin TOTP control semantics | **APPROVED AS AMENDED.** Admin can **disable**, **reset**, and **force TOTP ON**: a per-user `security.totp.required` flag — force-on clears any existing secret and sets it; the user completes enrollment at the next login through the existing enroll-challenge flow. Admins can never generate or view a secret. `TotpEnforcedForPrivileged` (R13) is kept: login requires enrollment when `totp.required` OR (privileged AND policy). |
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
- `security.totp.required: boolean` — default `false` (D6 force-on flag; existing users unaffected).
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
   `passwordHash = hash(NID)` — or, when the employee has no NID, the hash of a generated
   strong random password returned **once** in the creating call's response (D3 amended; the
   Employee Code is never a password), `mustChangePassword = true`.
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

### 4.3 Identifier resolution (configurable)

`findByIdentifier(raw)` resolution order (first match wins), all case-insensitive:
1. `username` (covers employee codes for all auto-created + createLogin accounts);
2. `email` (when the account has one);
3. `employees.code` → linked `userId` — so the printed Employee Code **always** works, even
   after an admin changes the username.

The enabled identifier kinds live in a declared org setting
`auth.loginIdentifiers` (default `["username", "email", "employeeCode"]`) — future identifier
kinds (UPN, phone) extend the list without touching the login endpoint. Unknown-identifier
handling, lockout counters, and audit stay exactly as today.

### 4.3b Username management

`username` becomes admin-editable through the standard user-update path (`user.edit`),
live-uniqueness enforced by the existing `ux_username` index, audited as `usernameChanged`.
Because resolution path 3 goes through the employee registry, changing a username never breaks
Employee-Code login.

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
- **Admin** (permission `user.resetPassword` — same trust level; secrets are never visible):
  - `POST /platform/users/:id/totp/reset` — clears `enabled/secret/backupCodes`
    (keeps `required` as-is), revokes sessions, audits, notifies;
  - `POST /platform/users/:id/totp/require` body `{ required: boolean }` — force ON clears any
    existing secret and sets `totp.required = true` (enrollment happens at the user's next
    login via the existing enroll-challenge); force OFF clears the flag. Audited.
  - Login rule: enroll-challenge fires when `totp.required === true` and not enrolled, OR the
    R13 privileged policy demands it; the plain TOTP challenge fires whenever enrolled.

---

### 4.6 Audit trail (closed-enum additions)

Every security-sensitive action is audited with actor + target:
`accountAutoCreated` (auto-provision + backfill) · `passwordReset` (admin) ·
`passwordChanged` (self; no payload beyond the event) · `totpEnabled` · `totpDisabled` ·
`totpReset` (admin) · `totpRequiredChanged` (admin force-on/off) · `usernameChanged`.
(`loginCreated` remains for the manual escape hatch.)

## 5. API changes (all additive)

| Endpoint | Change |
|---|---|
| `POST /auth/login` | response gains `mustChangePassword: boolean` |
| `GET /auth/me` | `MeDto` gains `mustChangePassword: boolean`, `username: string \| null`, `totpEnabled: boolean` |
| `POST /auth/password/change` | also clears `mustChangePassword` |
| `POST /platform/users/:id/reset-password` | **new** — `user.resetPassword` |
| `POST /platform/users/:id/totp/reset` | **new** — `user.resetPassword` |
| `POST /platform/users/:id/totp/require` | **new** — `user.resetPassword` (D6 force-on/off) |
| `PATCH /platform/users/:id` | `username` becomes updatable (`user.edit`), audited |
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
   status + enroll (QR) / disable; **Active Sessions** with per-session revoke (the
   `GET/DELETE /auth/sessions` API already exists — shipped now, not a placeholder). New
   platform page, linked from the user menu.
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

## 10. Future identity-provider compatibility (no redesign required later)

The refactor isolates the seams that LDAP/AD, Azure AD, OIDC/SAML, WebAuthn and SMS/email OTP
plug into, without adding speculative code now:

- **Identifier resolution** is already data-driven (`auth.loginIdentifiers`); a directory
  identifier (UPN) or phone number is a new list entry + resolver, not a new endpoint.
- **Credential verification** becomes a single function (`verifyLocalCredentials`) — the only
  bcrypt call site in login. An `IdentityProvider` strategy (local / ldap / oidc…) slots in
  behind that call; the user record's provider linkage would be one additive nullable field
  (`authProvider`, reserved — NOT added now).
- **Second factors** already flow through the challenge-token pattern (`totp-challenge` /
  `totp-enroll` typed tokens). WebAuthn assertions and SMS/email OTP are new challenge types on
  the same envelope — the login response contract (`totpRequired`/`challengeToken`) generalizes
  to `secondFactorRequired` without breaking existing clients.
- **Session issuance** (access/refresh/permissions) is already independent of how the identity
  was proven — federated logins reuse it unchanged.

## 11. Delivery plan (frozen)

One PR: contracts → platform (users/auth/rbac) → HR auto-provision + backfill → web → tests
(unit + integration: auto-provision idempotency, gate enforcement incl. bypass attempts,
identifier matrix, admin reset / TOTP reset / TOTP force-on, username change + code login,
legacy-user non-impact, repeated boots) → docs. Same discipline as always: adversarial pass,
CI green, wait for review.

## 12. Revision 2 — credentials delivery amendments (R1–R11, approved 2026-07-25)

The approver's second review adjusted the provisioning flow. Where §12 conflicts with
earlier sections, **§12 wins**.

### R1 — Temporary passwords are always random (supersedes D3 and §4.1 step 3)

Every provisioned or reset account receives a **unique, cryptographically random temporary
password** (`crypto.randomInt`, 14 chars, guaranteed character classes). The National ID is
**never** used as a credential in any path — the Revision-1 `tempPasswordSource` identity
seam (userId → NID) is **removed**; the `employeeCode → userId` login-resolver seam stays.

### R2 — Auto-provisioning is the only normal path (D1 confirmed)

Both creation paths (hire-from-offer and direct registration) auto-provision. The manual
"Create Login" endpoint/UI remains **only** as the escape hatch for audited provisioning
skips (D7) — never part of the normal workflow.

### R3 — Credentials are delivered to the employee (WhatsApp + email), transiently

A new platform seam **`credentialsDelivery`** (platform/users) composes a bilingual message
containing: **username, Employee Code, temporary password, login URL** (env
`WEB_PUBLIC_URL`), and a clear notice that the password is temporary and must be changed at
first sign-in. Delivery:

- **WhatsApp** → the employee's `primaryPhone` (normalized to E.164; Egyptian `01…` numbers
  become `+20…`), through the provider-agnostic transport (R9).
- **Email** → the account email, when present, through the existing SMTP `sendMail`
  infrastructure.
- **Never through the persisted notifications pipeline**: `notify()` stores rendered bodies
  (inbox + delivery records), which would persist the password in plaintext — forbidden by
  R11. Credential messages are rendered, sent, and discarded.
- Each channel's outcome is audited as **`credentialsDelivered`** with
  `changes: [{field: channel, new: 'sent' | <error>}]` — the password itself never appears.
- If **no** channel succeeds (no phone reachable, no email), provisioning still succeeds and
  the failure is audited; the admin fixes the contact details and **re-issues** (R6/R10).
  The API **never** returns the password (R11): the Revision-1 `temporaryPassword` fields in
  the creation response and the admin-reset response are **removed**.

### R4 — First-login gate (D4 confirmed, unchanged)

`mustChangePassword` stays server-enforced; only `password/change`, `me`, `logout`,
`refresh` are exempt; everything else fails with `PASSWORD_CHANGE_REQUIRED`.

### R5 — Login identifiers (§4.3 confirmed, unchanged)

Username, Employee Code, and email (optional) — configurable via `auth.loginIdentifiers`.

### R6 — Admin password reset (supersedes §4.4's admin paths)

One reset semantic: **generate a new random temporary password → deliver via WhatsApp +
email → revoke all sessions → `mustChangePassword = true` → new expiry window (R10)**.
The Revision-1 "admin supplies an explicit `newPassword`" option is **removed** — passwords
are never chosen by, shown to, or returned to administrators.

### R7 — TOTP (D6 + §4.5 confirmed, unchanged)

Self enable/disable on the Security page; admin reset + require/un-require (secrets never
admin-visible); `TotpEnforcedForPrivileged` keeps working.

### R8 — Backfill (D2 confirmed, extended)

The idempotent boot backfill provisions existing employed employees with the **same flow**:
random temp password + WhatsApp/email delivery + armed gate + expiry. Outcomes are audited
per employee; employees with no reachable channel are provisioned anyway and re-issued
later (R3).

### R9 — Provider-agnostic delivery transports

A `whatsappTransport` interface (infrastructure/messaging) with pluggable drivers selected
by env: **`meta`** (WhatsApp Cloud API), **`twilio`**, and **`disabled`** (default — logs a
warning, reports not-delivered; keeps dev/CI hermetic). Email stays behind the existing
`sendMail` seam (SMTP today; SendGrid et al. are future drivers of that seam). The account
lifecycle depends only on the `credentialsDelivery` interface — switching providers never
touches lifecycle logic.

### R10 — Temporary-password expiry + re-issue

- New org setting **`auth.tempPassword.ttlHours`** (default **48**, min 1, max 336).
- `security.tempPasswordExpiresAt: Date | null` is set whenever a temporary password is
  issued and cleared on the successful (policy-checked) password change.
- A login presenting the **correct but expired** temporary password fails with the dedicated
  code **`AUTH_TEMP_PASSWORD_EXPIRED`** (the UI says "ask HR to issue a new password").
- Re-issue = the same admin reset (R6): the new hash instantly invalidates the previous
  temporary password, a fresh delivery goes out, and a new expiry window starts.

### R11 — Audit + secrecy guarantees

Audited: account auto-created, every credential delivery (per channel), password reset,
**first successful login** of a gated account (new action **`firstLogin`**), forced password
change, TOTP enable/disable/reset/require. Passwords are never logged, never stored outside
the argon2id hash, and never returned by any API. Credential messages exist only in transit.

### Revision-2 API/data deltas (summary)

| Surface | Change |
|---|---|
| `EmployeeLoginProvisionDto` | `{ username, delivery: CredentialsDeliveryResultDto[] }` — `temporaryPassword` removed |
| `POST /platform/users/:id/reset-password` | Body removed; response `{ delivery: [...] }` — `newPassword` + `temporaryPassword` removed |
| `CredentialsDeliveryResultDto` | `{ channel: 'whatsapp' \| 'email', ok: boolean, detail: string \| null }` |
| Errors | + `AUTH_TEMP_PASSWORD_EXPIRED` |
| Settings | + `auth.tempPassword.ttlHours` (48h default) |
| Audit actions | + `credentialsDelivered`, + `firstLogin` |
| users model | + `security.tempPasswordExpiresAt: Date \| null` |
| Env | + `WEB_PUBLIC_URL`, `WHATSAPP_PROVIDER` (`meta`/`twilio`/`disabled`), provider credentials |
| Identity seams | `tempPasswordSource` (NID) **removed**; `employeeCode` resolver unchanged |
| Web | Creation/reset dialogs show **delivery status** instead of a one-time password |

## Review trail

Approved with amendments (2026-07-24): D1/D2/D4/D5/D7 as proposed; **D3 amended** (random
one-time-visible temp password instead of Employee-Code fallback — codes are public);
**D6 amended** (admin force-TOTP-ON via `totp.required`, secrets never admin-visible).
Additions: configurable login identifiers, admin username management with permanent
Employee-Code login, reset = revoke sessions + re-arm gate, Security page ships Active
Sessions, full audit enumeration (§4.6), future-provider compatibility (§10).

**Revision 2 approved (2026-07-25):** credentials-delivery amendments R1–R11 (§12) — NID
never a password, always-random unique temp passwords, WhatsApp + email delivery through
provider-agnostic transports, temp-password expiry (configurable, 48h default) with admin
re-issue, no password ever exposed through any API, extended audit (credential delivery +
first login). Everything else stands as Revision 1.
