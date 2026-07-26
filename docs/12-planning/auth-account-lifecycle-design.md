# Authentication & Employee Account Lifecycle — Design (FROZEN, Revision 4)

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

## 13. Revision 3 — delivery-hardening amendments (R12–R18, approved 2026-07-26)

### R12 — Credentials exist only in memory (confirmed + made explicit)

The temporary password lives in process memory between generation and delivery, and only its
argon2id **hash** is ever stored. Delivery logging records provider + recipient + outcome,
never the message body. Audit records carry per-channel outcomes only. This was already the
Revision-2 behavior; R12 promotes it to a hard invariant — and it constrains R14 (below).

### R13 — Delivery failures never block creation; delivery is retryable

Already true: provisioning succeeds regardless of channel outcomes, and per-channel status is
returned + audited. **New:** a dedicated retry —
`POST /platform/users/:id/credentials/resend` (permission `user.resetPassword`) re-delivers
credentials to a still-gated account without the disruption of a full reset (no session
revocation, no gate churn).

### R14 — Regenerate only when necessary (and the R12 conflict, resolved)

- **Expired temp** → resend issues a fresh password **and** a fresh validity window (R10).
- **Still-valid temp** → resend preserves the **remaining validity window**.
- **Conflict note (R12 wins):** literally re-sending *the same* password would require the
  plaintext to be recoverable after delivery — exactly what R12 forbids (hash-only). So a
  resend transparently replaces the hash with a fresh policy-compliant password while
  keeping the window. From the employee's perspective the credentials are simply delivered
  again (the previous message's password — which they evidently never used — stops
  working). No session is revoked and the gate state is untouched, so this is *not* a
  password reset in the R6 sense. If the approver prefers true same-password resend, R12
  must be relaxed to encrypted-at-rest retention until first use — **not** recommended.
- Resend refuses accounts whose gate is cleared (the account is in active use — that is a
  reset, R6): `422`.

### R15 — Configurable message templates

The credential message is no longer hardcoded: a seeded, **admin-editable** notification
template (`platform.credentialsDelivery`, variables `username`, `employeeCode`,
`temporaryPassword`, `loginUrl`, `expiresAt`) is loaded from the existing template system
(`findLatestByKey`) and rendered **in memory** by the pure rendering engine. Seeding is
create-if-missing, so admin edits survive every deploy. The rendered result is sent through
the transient transports and discarded — the persisted `notify()` pipeline is still never
involved (R12). If the template is missing, delivery falls back to the built-in wording.

### R16 — Channels are independent (confirmed)

Each channel attempts independently: email-only employees and phone-only employees both
receive credentials; the account never depends on both succeeding (nor on either — R13).

### R17 — Temp passwords satisfy the permanent-password policy, readably

The generator's alphabet already excludes ambiguous glyphs (no `O/0`, `I/l/1`). **New:** the
generated length adapts to the configured policy (`max(14, auth.password.minLength)`) and
every generated password is verified against the live policy before issuance — a policy
tightened by an admin can never be violated by a machine-generated credential.

### R18 — SSO-ready (confirmed)

Unchanged §10: identifier resolution (`findByIdentifier`), the challenge-token second-factor
seam and the isolated local-credential verification remain the integration points for Azure
AD / Google Workspace / LDAP / SAML / OAuth alongside local accounts — no lifecycle redesign.

### Revision-3 API/data deltas (summary)

| Surface | Change |
|---|---|
| `POST /platform/users/:id/credentials/resend` | New — re-deliver to a gated account; `{ delivery: [...] }`; 422 if the gate is cleared |
| Notification templates | + seeded `platform.credentialsDelivery` (admin-editable; create-if-missing) |
| Temp-password generator | Policy-aware length + pre-issuance policy verification |
| Audit | `credentialsDelivered` gains a `mode` change entry: `initial` / `reset` / `resend` |
| Web | Employee account card gains **Resend credentials** (visible while the gate is armed) |

## 14. Revision 4 — activation-link provisioning (approved 2026-07-26)

The approver reviewed the resend flow and rejected password regeneration on resend as a UX
hazard (an employee holding the first message would find its password silently dead). Two
options were offered; **Option 1 — the enterprise standard — was chosen: no passwords are
sent at all.** (Option 2, encrypted-at-rest temporary passwords, is explicitly rejected:
it would weaken R12's hash-only invariant.) Where §14 conflicts with §12/§13, **§14 wins**.

### The model

1. **Provisioning issues a one-time activation link, never a password.** `ensureLoginFor`
   creates the account in the existing `invited` state with **no password hash** and a
   hashed one-time activation token (the platform's original invite machinery). The
   delivered message (WhatsApp + email, §12 R3 transports, §13 R15 template) contains:
   username, Employee Code, the **setup link** (`{WEB_PUBLIC_URL}/activate?token=…`) and
   its expiry. The employee opens the link and **chooses their own policy-checked
   password** — `POST /auth/activate` — which activates the account.
2. **No forced-change gate in the normal flow.** The user sets their own password at
   activation, so `mustChangePassword` is never armed by provisioning or reset. The gate
   machinery (field, middleware, `PASSWORD_CHANGE_REQUIRED`, web screen) **remains
   implemented** as approved — dormant defense-in-depth for any future temp-credential
   path — but nothing arms it today.
3. **Resend = new token, old link dies** (exactly the approver's rule): allowed only while
   a setup link is pending (`activation.tokenHash != null`); generates a fresh token with a
   fresh window and re-delivers; the previous link is instantly invalid. An account with no
   pending link (already activated, no reset in flight) refuses resend with `422` — that is
   a reset.
4. **Admin reset = lock out + new link**: clears the password hash, revokes every session,
   issues a fresh activation token and delivers the setup link. The user re-establishes
   their own password through the link. Completion of `POST /auth/activate` now accepts
   both `invited` (first setup) and `active` (post-reset) accounts holding a valid token.
5. **Link expiry** replaces temp-password expiry: org setting
   **`auth.activationLink.ttlHours`** (default 48, 1–336) governs provisioning/reset/resend
   links. An expired link fails with the existing `AUTH_ACTIVATION_TOKEN_INVALID`; a
   not-yet-activated account signing in gets the existing `AUTH_ACCOUNT_NOT_ACTIVE`.
6. **Retired by this revision** (all unreleased — no compatibility impact): temp-password
   generation/issuance (`generateTempPassword`, `policyTempPassword`, `setTempPassword`),
   `security.tempPasswordExpiresAt`, `AUTH_TEMP_PASSWORD_EXPIRED`, `auth.tempPassword.ttlHours`,
   and the R17 password-readability rule (nothing to read — there is no password in transit).
   R11/R12 are now trivially absolute: no credential ever exists outside the user's head
   and the argon2id hash.
7. **Audit**: `credentialsDelivered` (per channel + mode `initial`/`reset`/`resend`) now
   describes link delivery; **`firstLogin` is recorded at activation completion** (the
   first authenticated use of the account's credential).
8. **Web**: a public **`/activate`** page (token from the URL, choose password + confirm →
   activate → sign-in) replaces the force-change surface in the normal flow; the employee
   account card shows an **Awaiting activation** state with **Send new link** (reset) and
   **Resend link** actions and per-channel delivery status; `UserDto` gains
   `setupLinkPending`.

### Why this dissolves the earlier conflicts

- The §13 R14 conflict (resend vs. hash-only storage) disappears: there is nothing secret
  to re-deliver — a link resend invalidating its predecessor is the industry-expected
  behavior the approver asked for.
- The message template (R15), transports (R9), channel independence (R16), transient
  delivery + audit (R12/R11), non-blocking provisioning (R13), backfill (R8) and SSO seams
  (R18) all carry over unchanged — only the payload changed from a password to a link.

## 15. Revision 5 — activation hardening (approved 2026-07-26)

Eight final requirements before release. Four were already §14 behavior and are promoted to
**named invariants**; four change code. Where §15 conflicts with earlier sections, §15 wins.

### 15.1 Single-use links (invariant — confirmed)

A successful `POST /auth/activate` **atomically clears** `activation.tokenHash` +
`expiresAt` in the same write that stores the chosen password's hash — the token is
permanently dead from that moment; any later presentation (even instantly) fails with
`AUTH_ACTIVATION_TOKEN_INVALID`.

### 15.2 CSPRNG tokens, hash-only at rest (invariant — confirmed)

Tokens are 48 bytes of `crypto.randomBytes` (base64url, ~384 bits); **only the SHA-256
hash is ever persisted** — exactly the refresh-token discipline. The raw token exists in
memory during delivery and in the recipient's message, nowhere else. *Recorded exception:*
the pre-existing platform invite response (`InvitedUserDto.activationToken`, POST
`/platform/users`) still echoes the token **once** for platform/system accounts that have
no delivery channel; it is never persisted and is scheduled for retirement once
platform-account delivery ships. Employee provisioning never echoes a token anywhere.

### 15.3 No login before activation — dedicated error

`invited` accounts cannot authenticate (they hold no password hash at all). **New:** the
login pipeline now answers a **dedicated `AUTH_ACCOUNT_NOT_ACTIVATED` (401)** for invited
accounts; `AUTH_ACCOUNT_NOT_ACTIVE` now means suspended/archived only. The web login maps
the new code to a "use your setup link" message.

### 15.4 Admin-visible account status

`UserDto` gains a **derived** (never stored) `accountStatus`, shown on the employee
account card; **Not Invited** is the card's rendering of an employee with no linked login.
First matching row wins:

| Condition | `accountStatus` |
|---|---|
| user status `suspended` / `archived` | `locked` |
| `security.lockedUntil` in the future (lockout) | `locked` |
| `invited` or credential cleared by reset, **valid** link pending | `invitationSent` |
| `invited` or credential cleared by reset, link expired or revoked | `expired` |
| `active` with a credential | `activated` |

### 15.5 Immediate invalidation

A pending activation link dies **in the same operation** whenever:
- **a new link is issued** (reset/resend — §14.3, already the rule),
- **the account is disabled**: every transition to `suspended`/`archived` (admin action,
  soft delete) clears the token and audits `invitationRevoked`,
- **the employee exits**: exit propagation now also covers **never-activated logins** —
  the status machine gains `invited → suspended` (and rehire's `suspended → active` is
  unchanged; a formerly-invited rehire shows `expired` until an admin issues a fresh link
  via reset). Defense-in-depth: `/auth/activate` accepts only `invited`/`active` accounts,
  so even an un-cleared token is useless on a disabled account.

### 15.6 No internal identifiers in messages (invariant — confirmed)

The URL carries **only** the token (`/activate?token=…`) — no user id, employee id, or any
database identifier. The message body contains the Employee Code because §12 R3 requires
it — it is the public business identifier printed on cards, not a database key.

### 15.7 Invitation audit trail

New audit actions cover the full invitation lifecycle:

| Event | Recorded by |
|---|---|
| `invitationCreated` | provisioning, the legacy invite, and every reset that issues a fresh link |
| `invitationResent` | resend (new token replaces the old) |
| `invitationExpired` | **hourly sweep** `platform.auth.invitationExpirySweep`: revokes (clears) every expired pending token — stale secrets never linger — and audits once per invitation; after the sweep, re-issue is an admin **reset** |
| `invitationUsed` | successful activation (alongside `firstLogin`/`statusChange` or `passwordChanged`) |
| `invitationAttemptInvalid` | failed activation attempts attributable to a user (token matched but expired, or account not eligible); unmatched tokens cannot be attributed — the strict rate limit on `/auth/activate` covers them |
| `invitationRevoked` | disable/exit/soft-delete clearing a pending link (15.5) |

### 15.8 MFA-independent activation (invariant — confirmed)

Activation establishes only the knowledge factor; **factor negotiation lives exclusively
in the login pipeline** (TOTP challenge/enroll today, more factors later). An account with
`totp.required` set *before* activation activates normally and is prompted to enroll at
first login — additional factors never touch the activation lifecycle.

### Revision-5 API/data deltas (summary)

| Surface | Change |
|---|---|
| Errors | + `AUTH_ACCOUNT_NOT_ACTIVATED` (401 — login by an invited account); `AUTH_ACCOUNT_NOT_ACTIVE` narrowed to suspended/archived |
| `UserDto` | + derived `accountStatus`: `invitationSent` / `activated` / `expired` / `locked` |
| User status machine | + `invited → suspended` (exit/disable before first activation) |
| Suspend / archive / soft-delete | atomically revoke any pending link (+ `invitationRevoked`) |
| Audit | + `invitationCreated` / `invitationResent` / `invitationExpired` / `invitationUsed` / `invitationAttemptInvalid` / `invitationRevoked` |
| Scheduler | + `platform.auth.invitationExpirySweep` (hourly) |
| Web | account card shows the five account states (incl. **Not invited**); login maps the dedicated error |

## 16. Revision 6 — enterprise completeness (approved 2026-07-26)

Final requirements (approver items 26–32) before the lifecycle is considered complete.

### 16.1 Expiration deletes nothing (item 26)

Invitations are **not** first-class entities; their complete lifecycle history lives in the
**append-only audit stream** (`invitationCreated` → `invitationResent`/`invitationExpired`/
`invitationRevoked` → `invitationUsed`/`invitationAttemptInvalid`), which is immutable and
has no delete path (ADR-012) — so nothing about an invitation is ever deleted. What expiry
and supersession remove is only the **live secret pointer** (`activation.tokenHash`); the
invitation's metadata (`sentAt`, last delivery outcomes) is denormalized on the account and
**survives** consumption, supersession and expiry for the admin panel. A resend appends
`invitationResent` (the supersession record) and replaces the pointer — the full chain of
who was invited, when, over which channels, and what became of every link is reconstructible
from the audit trail alone.

### 16.2 Session policy (item 27 — confirmed invariants)

- **Password reset** revokes **all** sessions (§14.4 — already the rule).
- **Disable / exit**: every transition to `suspended`/`archived` revokes all sessions
  (platform event handler on `UserStatusChanged`) — §15.5 extends this to exits of
  never-activated logins.
- **Activation never creates a session**: `POST /auth/activate` answers `204` with **no
  tokens**; the employee then authenticates through the normal login pipeline (TOTP and
  future factors included). Sessions are born in exactly one place.
- Brute-force lockout (`lockedUntil`) is a *login* barrier by design; it does not revoke
  standing sessions (they belong to the legitimate holder) — admins who want the axe use
  suspend or reset.

### 16.3 Device independence (item 28 — confirmed invariant)

Tokens carry no device binding — no fingerprint, IP pin, or user-agent check. The link may
be opened on any device; **the first successful activation consumes the token** (§15.1)
and every later attempt fails regardless of device.

### 16.4 Notification resilience (item 29 — confirmed invariants)

Channels attempt independently (§13 R16); a failed delivery is retryable via **resend**
(new link — §14.3) without touching the account; delivery failures **never roll back
provisioning** (§13 R13) — they are audited (`credentialsDelivered` outcomes per channel)
and now also **persisted** on the account for the admin panel (16.1).

### 16.5 Administrative visibility — the Account panel (item 30)

The employee page's account card becomes a full **Account panel**. `UserDto` gains
read-only, server-derived/denormalized fields: `invitationSentAt`, `invitationExpiresAt`
(null once consumed), `activatedAt`, `lastLoginAt`, `passwordChangedAt`, and
`lastDelivery` (per-channel outcome of the most recent invitation delivery). Together with
Revision 5's `accountStatus`, the existing username editor and the TOTP badges, the panel
shows: Account Status + Activation Status, Username, Invitation Sent/Expires, Activated
At, Last Login, Password Last Changed, MFA status, and per-channel delivery status.

### 16.6 Security hardening (item 31)

- **Rate limiting**: every unauthenticated auth surface (`login`, `activate`,
  `totp/challenge`, `totp/enroll-challenge`, `refresh`) already sits behind the same
  strict Redis-backed limiter — confirmed consistent. Authenticated admin operations
  (reset/resend/TOTP admin) are permission-gated (`user.resetPassword`) and fully audited.
- **Audit**: every listed endpoint records outcomes (`login`/`loginFailed`/`lockout`,
  `invitationUsed`/`invitationAttemptInvalid`, `passwordReset`/`passwordChanged`,
  `totpEnrolled`/`totpDisabled`/`totpReset`).
- **Enumeration**: unknown identifier and wrong password answer the **identical**
  `AUTH_INVALID_CREDENTIALS`. Recorded tension: the state-specific answers
  (`AUTH_ACCOUNT_NOT_ACTIVATED`, `AUTH_ACCOUNT_LOCKED`) reveal that an account exists —
  **deliberately accepted** per item 3 (employees need actionable guidance in an internal
  ERP) and mitigated by the strict rate limit.

### 16.7 Documentation (item 32)

`docs/02-architecture/account-lifecycle.md` (new) carries the complete account-lifecycle
**state diagram** and **sequence diagrams** for employee creation, invitation, activation,
login, password reset, account disable and employee exit.

## Review trail

**Revision 6 approved (2026-07-26):** enterprise completeness (§16) — expiry deletes
nothing (audit stream is the invitation history; metadata persists for the panel), session
policy invariants (reset/disable/exit revoke all; activation never mints a session), device
independence, notification resilience, the full admin Account panel
(sent/expires/activated/last-login/password-changed/MFA/delivery on `UserDto`), consistent
rate limiting + enumeration-parity note, and the dedicated lifecycle architecture document.

**Revision 5 approved (2026-07-26):** activation hardening (§15) — single-use, CSPRNG +
hash-only, token-only URLs and MFA independence promoted to named invariants; dedicated
`AUTH_ACCOUNT_NOT_ACTIVATED` login error; derived admin-visible `accountStatus`
(Not Invited / Invitation Sent / Activated / Expired / Locked); immediate link revocation on
disable/exit/re-issue (status machine gains `invited → suspended`); full invitation audit
trail with an hourly expiry sweep.

Approved with amendments (2026-07-24): D1/D2/D4/D5/D7 as proposed; **D3 amended** (random
one-time-visible temp password instead of Employee-Code fallback — codes are public);
**D6 amended** (admin force-TOTP-ON via `totp.required`, secrets never admin-visible).
Additions: configurable login identifiers, admin username management with permanent
Employee-Code login, reset = revoke sessions + re-arm gate, Security page ships Active
Sessions, full audit enumeration (§4.6), future-provider compatibility (§10).

**Revision 4 approved (2026-07-26):** activation-link provisioning (§14) — Option 1 of the
approver's resend review: no passwords are ever sent; provisioning/reset/resend deliver a
one-time setup link (new token invalidates the old), the employee chooses their own password
at `/activate`, the forced-change gate goes dormant, and the temp-password machinery is
retired. Option 2 (encrypted-at-rest passwords) explicitly rejected.

**Revision 3 approved (2026-07-26):** delivery-hardening amendments R12–R18 (§13) —
memory-only credentials made a hard invariant, retryable delivery with a dedicated resend
(regenerate-only-when-necessary, R12 conflict resolved in R12's favor), admin-editable
message templates via the notification-template system, explicit channel independence,
policy-verified readable temp passwords, SSO seams reconfirmed.

**Revision 2 approved (2026-07-25):** credentials-delivery amendments R1–R11 (§12) — NID
never a password, always-random unique temp passwords, WhatsApp + email delivery through
provider-agnostic transports, temp-password expiry (configurable, 48h default) with admin
re-issue, no password ever exposed through any API, extended audit (credential delivery +
first login). Everything else stands as Revision 1.
