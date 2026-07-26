# Account Lifecycle (Authentication & Employee Accounts)

Companion to `docs/02-architecture/platform-identity.md`, governed by the frozen design
`docs/12-planning/auth-account-lifecycle-design.md` (Revisions 1–6). This document carries
the complete lifecycle **state diagram** and the **sequence diagrams** required by §16.7.

Vocabulary: the stored **user status** is `invited → active → suspended → archived`
("disable, never delete"). The **derived** admin-facing `accountStatus`
(Not Invited / Invitation Sent / Activated / Expired / Locked — §15.4) is computed from the
stored status, the pending-link state, and the lockout window; it is never persisted.

## 1. Account state diagram

```mermaid
stateDiagram-v2
    direction LR
    [*] --> invited : employee created /\nlegacy invite\n(setup link delivered)
    invited --> active : POST /auth/activate\n(one-time token + own password)
    invited --> suspended : employee exits /\nadmin disable\n(pending link revoked)
    invited --> archived : soft delete\n(pending link revoked)
    active --> suspended : employee exits /\nadmin disable\n(sessions revoked)
    suspended --> active : rehire / re-enable
    active --> archived : soft delete
    suspended --> archived : soft delete
    archived --> [*]

    note right of invited
        accountStatus: Invitation Sent
        (or Expired once the link's
        TTL passes / the sweep runs)
    end note
    note right of active
        accountStatus: Activated —
        or Invitation Sent/Expired while
        an admin reset's fresh link is
        pending, Locked during lockout
    end note
    note right of suspended
        accountStatus: Locked
    end note
```

Derivation rules (§15.4, first match wins): `suspended`/`archived` → **Locked**;
`lockedUntil` in the future → **Locked**; awaiting a link (invited, or active with the
credential cleared by a reset) → **Invitation Sent** while a valid link is pending, else
**Expired**; otherwise **Activated**. An employee with no linked login renders as
**Not Invited** on the employee page.

## 2. Employee creation → provisioning

Provisioning never blocks employee creation (§13 R13); failures are audited and the manual
create-login override (D7) remains.

```mermaid
sequenceDiagram
    participant HR as HR user
    participant E as Employee service
    participant U as User service
    participant D as Credentials delivery
    HR->>E: create employee (hire / direct registration)
    E->>U: createProvisioned(username = Employee Code,\nhashed one-time token, TTL window)
    U-->>E: user (status: invited)
    Note over U: audits accountAutoCreated + invitationCreated
    E->>D: deliver setup link (transient, in memory)
    D->>D: render admin-editable template\n(platform.credentialsDelivery)
    par channels are independent (R16)
        D-->>D: WhatsApp (provider-agnostic)
    and
        D-->>D: Email (SMTP)
    end
    D-->>E: per-channel outcomes (never the link)
    E->>U: persist outcomes (Account panel §16.5)
    Note over D: audits credentialsDelivered (mode: initial)
    E-->>HR: employee + {username, delivery[]}
```

## 3. Invitation (resend / expiry)

```mermaid
sequenceDiagram
    participant A as Admin
    participant API as Users API
    participant U as User service
    participant S as Hourly sweep
    A->>API: POST /platform/users/:id/credentials/resend
    alt a link is pending
        API->>U: resendSetupLink
        U->>U: new token replaces (and invalidates) the old
        Note over U: audits invitationResent — the supersession record (§16.1)
        U-->>A: fresh delivery outcomes
    else nothing pending (already activated / swept)
        API-->>A: 422 — use reset instead
    end
    S->>U: sweepExpiredInvitations (hourly)
    U->>U: clear expired pending tokens\n(stale secrets never linger)
    Note over U: audits invitationExpired once per invitation;\nsentAt + delivery outcomes SURVIVE (§16.1)
```

## 4. Activation

One-time (§15.1), device-independent (§16.3), MFA-independent (§15.8), and **never** a
session mint (§16.2). The URL carries only the token (§15.6).

```mermaid
sequenceDiagram
    participant Emp as Employee (any device)
    participant W as /activate page
    participant API as POST /auth/activate (rate-limited)
    participant U as User service
    Emp->>W: opens link {WEB_PUBLIC_URL}/activate?token=…
    W->>API: {token, chosen password}
    API->>U: activateWithToken
    alt token matches, account eligible, not expired
        U->>U: policy-check password (422 keeps the token alive)
        U->>U: store argon2id hash, status → active,\nclear tokenHash (single-use, atomic)
        Note over U: audits invitationUsed + firstLogin + statusChange
        API-->>W: 204 — NO session tokens
        W-->>Emp: "activated — sign in"
    else invalid / expired / ineligible
        Note over U: audits invitationAttemptInvalid when attributable
        API-->>W: 422 AUTH_ACTIVATION_TOKEN_INVALID
    end
```

## 5. Login

```mermaid
sequenceDiagram
    participant Emp as Employee
    participant API as POST /auth/login (rate-limited)
    participant AU as Auth service
    Emp->>API: {identifier (username / email / Employee Code), password}
    API->>AU: login
    alt unknown identifier OR wrong password
        AU-->>Emp: 401 AUTH_INVALID_CREDENTIALS (identical — no enumeration, §16.6)
    else lockout window active
        AU-->>Emp: 401 AUTH_ACCOUNT_LOCKED
    else invited (never activated)
        AU-->>Emp: 401 AUTH_ACCOUNT_NOT_ACTIVATED — "use your setup link" (§15.3)
    else suspended / archived
        AU-->>Emp: 401 AUTH_ACCOUNT_NOT_ACTIVE
    else credentials OK
        AU->>AU: TOTP challenge / forced enrollment when required
        AU->>AU: create session, stamp lastLoginAt (§16.5)
        Note over AU: audits login (failures: loginFailed / lockout)
        AU-->>Emp: access + refresh tokens
    end
```

## 6. Password reset (admin)

```mermaid
sequenceDiagram
    participant A as Admin (user.resetPassword)
    participant API as Users API
    participant U as User service
    participant AU as Auth service
    A->>API: POST /platform/users/:id/reset-password (no body)
    API->>U: resetViaSetupLink
    U->>U: clear password hash (lock out),\nissue fresh one-time token
    Note over U: audits passwordReset + invitationCreated (mode: reset)
    API->>AU: revoke ALL sessions (§16.2)
    U-->>A: delivery outcomes only — admin never sees a credential
    Note over U: employee re-establishes their own password at /activate
```

## 7. Account disable & employee exit

```mermaid
sequenceDiagram
    participant Src as Admin action / Exit engine
    participant U as User service
    participant AU as Auth service (event handler)
    Src->>U: changeStatus → suspended (or archived)
    Note over U: works from active AND invited (§15.5)
    U->>U: revoke any pending setup link\nin the same operation
    Note over U: audits statusChange (+ invitationRevoked when a link died)
    U-->>AU: UserStatusChanged event
    AU->>AU: revoke ALL sessions immediately (§16.2)
    Note over Src: exits keep history — accounts are\nsuspended, never deleted; rehire re-enables
```

## 8. Audit map (quick reference)

| Lifecycle moment | Audit actions |
|---|---|
| Provisioning / legacy invite | `accountAutoCreated`, `invitationCreated`, `credentialsDelivered` |
| Resend | `invitationResent`, `credentialsDelivered` |
| Expiry (hourly sweep) | `invitationExpired` |
| Activation | `invitationUsed`, `firstLogin`, `statusChange` (or `passwordChanged` post-reset) |
| Failed activation attempt | `invitationAttemptInvalid` (when attributable) |
| Login | `login` / `loginFailed` / `lockout` |
| Admin reset | `passwordReset`, `invitationCreated`, `sessionRevoked` |
| Disable / exit / delete | `statusChange` / `delete`, `invitationRevoked`, `sessionRevoked` |
| TOTP | `totpEnrolled` / `totpDisabled` / `totpReset` / `totpRequiredChanged` |
