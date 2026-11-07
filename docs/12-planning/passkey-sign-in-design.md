# Passkey sign-in (fingerprint / Face ID) — Design

**Status: APPROVED** — owner decisions of 2026-11-01 recorded in §1; the architectural decision is
[ADR-035](../03-decisions/ADR-035-passkey-sign-in.md). Implementation in one PR. Parts of §2, §4, §6 and §7
no longer match the code; §8 lists where.

## 1. What the owner decided

| # | Question | Decision |
|---|---|---|
| P1 | Does a passkey sign-in still ask for the TOTP code (privileged and TOTP-enrolled accounts)? | **No — the passkey is enough** («لا، البصمة كفاية»). Amends Review R13 (ADR-035 §2). |
| P2 | Who may use passkeys? | **Staff, and gold-vault portal customers** («الموظفين وعملاء بوابة الذهب»). Applicants never. |
| P3 | Change the 10-minute idle sign-out? | **No** («نسيبها 10 دقايق»). The passkey makes the return a single touch instead. |

Decided on security grounds (ADR-035): usernameless sign-in; password (+ TOTP) step-up to add a
passkey; admin reset / suspend / archive / delete remove passkeys; a locked account stays locked;
single-use server challenges; RP identity from configuration; attestation `none`, no outbound
fetches; an organization kill switch.

## 2. API

> **Out of date in places (review of 2026-11-05):** see the list at the end of §8.


All under `/api/v1/auth/passkeys` (the auth router: external accounts reach it by construction, so
every handler applies the §5 audience rule itself).

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/authentication/options` | public | A sign-in challenge: `{ challenge, rpId, timeout, userVerification: 'required', allowCredentials: [], origin }` — `origin` is the one page address answers are accepted from; the web offers no button anywhere else |
| `POST` | `/authentication/verify` | public | The device's answer → the same `LoginResponse` a password sign-in returns (never `totpRequired`) + refresh cookie |
| `GET` | `/` | session | The caller's passkeys: `{ id, name, createdAt, lastUsedAt, backedUp }` |
| `POST` | `/registration/options` | session | Step-up `{ password, totpCode? }` → creation options (excludes the caller's existing passkeys) |
| `POST` | `/registration/verify` | session | The device's attestation `{ response, name? }` → the new passkey |
| `PATCH` | `/:id` | session | Rename `{ name }` |
| `DELETE` | `/:id` | session | Remove one |

Error codes: `AUTH_PASSKEYS_DISABLED` (kill switch, 403), `AUTH_PASSKEY_INVALID` (any refused
assertion — unknown credential, failed signature, an audience refused; one code so none of them can
be told apart), `AUTH_PASSKEY_EXPIRED` (the challenge is unknown, expired or already used — checked
before any account is looked at, so it reveals nothing; not a counted failure), `AUTH_PASSKEY_NOT_ALLOWED` (this account may
not add a passkey), `AUTH_PASSKEY_LIMIT` (ten per account). Locked / not-activated / not-active keep
their existing codes — they are told apart on the password path already.

Rate limits: options — the per-IP renewal ceiling (`AUTH_REFRESH_RATE_LIMIT_PER_IP`: a sign-in
page asks for two on every visit and renews both every four minutes while open); verify — the per-IP
sign-in ceiling, ten per credential id per five minutes, and the failed-sign-in limit per address
(`AUTH_PASSKEY_INVALID` counts there, not toward the account lockout; `AUTH_PASSKEY_EXPIRED` does not
count); the registration steps — ten per access token per five minutes, the per-IP ceiling, and the
TOTP code at the step-up shares the sign-in's per-account bucket (ten per five minutes) whichever
token asks; a locked account is refused at the step-up before its password is checked.

## 3. Data

`passkey_credentials` (strict, no baseFields, like `sessions`):
`userId`, `credentialId` (base64url, **unique**), `publicKey` (base64url COSE), `counter`,
`transports[]`, `deviceType` (`singleDevice` | `multiDevice`), `backedUp`, `name`,
`createdAt`, `lastUsedAt`, `createdSessionId`. Indexes `ux_credentialId`, `ix_userId`. The unique
index is built by the code before the first write (`collectionReady` pattern) because production
index sync runs in report mode.

WebAuthn `user.id` = SHA-256(`ecms-passkey-user:<userId>`) — stable per account forever (the device
replaces rather than duplicates a re-registration, and no configuration change can invalidate the
passkeys already on people's phones — keying it with a rotatable secret would), and does not spell
out the id or its creation time. It is not a secret. Sign-in never trusts it: the credential is found by `credentialId`, and the
`userHandle` returned must match the owner's.

Sessions gain `method` (`password` · `passkey` · `portalChallenge`; absent on old rows = password),
shown in the session list. The `login` audit row records `method: passkey` and the credential.

Challenges in Redis: `passkey:auth:<challenge>` (sign-in, 5 min) and
`passkey:reg:<sessionId>` (registration, holds the challenge, 5 min), both consumed with `GETDEL`.

## 4. The two ceremonies

> **Out of date in places (review of 2026-11-05):** see the list at the end of §8.


**Adding a passkey.** Security page → «إضافة هذا الجهاز» → a dialog asks for the current password
(and the TOTP code when enabled) → `registration/options` verifies them (a wrong password answers
`AUTH_INVALID_CREDENTIALS` and counts toward the account lockout, as on the sign-in page) → the
browser's prompt → `registration/verify` takes the session's challenge once, verifies origin, RP ID,
user verification and the attestation, stores the credential, audits `passkeyRegistered`.

**The offer after a password sign-in.** On a device with a built-in fingerprint / face / PIN check,
when passkeys are on, the account has none yet and the forced password change is not pending, the
sign-in page asks «الدخول أسرع في المرة القادمة؟» before going in. «تفعيل الدخول بالبصمة» runs the
same step-up with the password just typed (and the TOTP code just typed; if that has expired, it
asks for the current one). «ليس الآن» is remembered on that browser for thirty days. The gold
portal's sign-in does the same.

**Signing in.** The sign-in page fetches options on load (iOS before 17.4 loses the tap if a network
call happens between it and the WebAuthn call), offers the passkey in the username field's autofill
where the browser supports it, and shows «الدخول بالبصمة أو الوجه» everywhere a platform
authenticator exists → `authentication/verify`: take the challenge once; find the credential; the
owner's gates (lock, status, cleared password, audience); verify signature, origin, RP ID, user
verification, counter; update counter and `lastUsedAt`; `completeLogin(method: 'passkey')`. While the
page stays open both its challenges (the button's and the autofill's) are renewed once they are
three minutes old — the button never uses one older than four, so a tap always finds a fresh one —
and the autofill is never re-armed while its field is focused or the window has handed focus to the
device's prompt, nor started while the button's prompt is open; nothing is renewed once the form
has left the screen (TOTP step, offer). The offer asks a TOTP account for a current code rather
than resending the one typed at sign-in, which has usually rolled over; and once the person has picked a passkey from it, the server's
answer (locked, rate-limited, offline) is shown like the button's.

## 5. Audience

An account may hold or use a passkey when it is internal, or when its external module registered
itself with `allowPasskeysFor(moduleId, subjectType)` — the gold module does, for `goldCompany`.
Deny by default: a module that never registers (the applicant portal) is refused at registration
and at sign-in.

## 6. Threat-model note (security-architecture §6)

> **Out of date in places (review of 2026-11-05):** see the list at the end of §8.


| Threat | Control |
|---|---|
| Replayed assertion | Server-held challenge, consumed once (`GETDEL`), 5 min; counter regression refused when the device reports one |
| Phishing / another origin | Origin and RP ID checked against configuration; the browser binds the credential to the RP ID |
| Forged `Host` / `X-Forwarded-Host` | Never read for the ceremony |
| Stolen session plants a backdoor | Password (+ TOTP) step-up bound to the session; audit `passkeyRegistered` |
| Admin reset leaves a key working | The staff reset, the TOTP reset and the gold portal's «new setup link» remove all passkeys; sign-in also refuses a cleared password |
| Rehire revives an old key | Suspend / archive / delete remove passkeys, and reactivation removes any left behind |
| A rotated JWT secret strands every passkey | `user.id` depends on no secret |
| Lockout bypass | `lockedUntil` honoured |
| Lockout abuse via credential ids | Failed assertions never touch the account lockout; they count per address |
| Account enumeration | Usernameless; options carry nothing per account; one refusal code |
| Applicant skips the phone check | Audience rule (§5) |
| Outbound request on attacker input | Only `none` / certificate-less `packed` attestation reaches the library; trust anchors emptied — no CRL / metadata fetch |
| Kill switch only in the UI | Every endpoint checks the setting |

## 7. Tests

> **Out of date in places (review of 2026-11-05):** see the list at the end of §8.


API: options/verify with the WebAuthn verification seam mocked — single-use challenge, each gate,
audience, kill switch, counter handling, method on the session; registration step-up (password,
TOTP), session binding, limit, duplicate; reset / status removal. Web: support detection, error
mapping (a cancelled prompt is silent), markup of the sign-in buttons and the Security card. End to
end in Chromium with a virtual authenticator (CDP `WebAuthn.addVirtualAuthenticator`): the offer
after a password sign-in adds a passkey, then the autofill suggestion and the button each sign in
with it, a replayed answer is refused — the browser's bodies parsed with the contract schemas and
verified with the server library. The API ceremonies run against a software authenticator with a
real P-256 key (`tests/integration/helpers/soft-authenticator.ts`), unit and HTTP.

## 8. Follow-ups (not in this change)

- Tell the person when a passkey is added or removed (no user-facing security notification exists
  for any change yet — design §4.4/§4.5 promise them for resets too).
- An administrator view of a user's passkeys (lost phone): today the password reset — or the TOTP
  reset — removes them all.

**Open after the fresh-context review of 2026-11-05** (EGM reviewers: design critic, codebase
details, implementation readiness; every item below was checked against the code):

- Code: a passkey sign-in never resets `security.failedLogins`, so a person who signs in only with
  a passkey and mistypes the password now and then is eventually locked out, passkey included
  (`auth.service.ts` resets on the password path only; `completePasskeyLogin` does not).
- Code: «حذف» cannot be reached while passkeys are switched off. The server lets a passkey be
  removed with the switch off, but `GET /auth/passkeys` is refused then, and the Security card
  hides the list; both need changing.
- This page lags the code in six places (the code is right in each):
  - §4 lists the account checks before the signature check; the code verifies the signature
    first, so account state is never told to someone who does not hold the key.
  - §2 and §6 say every endpoint checks the kill switch and applies the §5 audience rule; DELETE
    does neither, on purpose. ADR-035 §9 says the same and needs a superseding ADR, or a note in
    the next one that touches passkeys.
  - §4 says both that the offer reuses the TOTP code just typed and that it asks for a current one;
    it asks.
  - §4 says the button shows where a platform authenticator exists; it shows wherever WebAuthn is
    supported, the options prefetch succeeds and the page's origin is the server's.
  - §2 says the challenges renew every four minutes, §4 three; it is three, and a hidden tab renews
    nothing.
  - §7: no committed test uses a virtual authenticator (that was a one-off check); the unit suite
    runs the real WebAuthn library against a software authenticator rather than mocking it; a
    cancelled prompt shows a message; the soft authenticator is at
    `apps/api/tests/integration/helpers/soft-authenticator.ts`.
- §2's error list gives a status only for `AUTH_PASSKEYS_DISABLED` (403): `AUTH_PASSKEY_INVALID`
  and `AUTH_PASSKEY_EXPIRED` are 401 at sign-in and 422 at registration, and a duplicate key is a
  409.
