# Passkey sign-in (fingerprint / Face ID) — Design

**Status: APPROVED** — owner decisions of 2026-11-01 recorded in §1; the architectural decision is
[ADR-035](../03-decisions/ADR-035-passkey-sign-in.md). Implementation in one PR. Brought back in line with
the code on 2026-11-07, after a fresh-context review found where it had fallen behind (§8).

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

All under `/api/v1/auth/passkeys` (the auth router: external accounts reach it by construction, so
every handler applies the §5 audience rule itself — except `DELETE`, which works for any account:
nobody is ever stuck with a key).

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/authentication/options` | public | A sign-in challenge: `{ challenge, rpId, timeout, userVerification: 'required', allowCredentials: [], origin }` — `origin` is the one page address answers are accepted from; the web offers no button anywhere else |
| `POST` | `/authentication/verify` | public | The device's answer → the same `LoginResponse` a password sign-in returns (never `totpRequired`) + refresh cookie |
| `GET` | `/` | session | The caller's passkeys `[{ id, name, createdAt, lastUsedAt, backedUp }]`, with `meta: { enabled }` (the kill switch). Answers with the switch off too, so a device can always be seen and removed |
| `POST` | `/registration/options` | session | Step-up `{ password, totpCode? }` → creation options (excludes the caller's existing passkeys) |
| `POST` | `/registration/verify` | session | The device's attestation `{ response, name? }` → the new passkey |
| `PATCH` | `/:id` | session | Rename `{ name }` |
| `DELETE` | `/:id` | session | Remove one — also with the switch off, and for any account |

Error codes:
- `AUTH_PASSKEYS_DISABLED` (403): the kill switch, on sign-in, registration and rename (not on the
  list or `DELETE`).
- `AUTH_PASSKEY_INVALID`: any refused assertion — unknown credential, failed signature, a cleared
  password, an audience refused — one code so none of them can be told apart.
- `AUTH_PASSKEY_EXPIRED`: the challenge is unknown, expired or already used. It is checked before
  any account is looked at, so it reveals nothing, and it is not a counted failure.
- `INVALID` and `EXPIRED` are 401 at sign-in and 422 at registration.
- `AUTH_PASSKEY_NOT_ALLOWED` (403): this account may not use passkeys.
- `AUTH_PASSKEY_LIMIT` (422): ten per account.
- A key already registered is a 409.
- Locked / not-activated / not-active keep their existing codes. They are told apart on the
  password path already, and on this path only after the signature is proven (§4).

Rate limits: options — the per-IP renewal ceiling (`AUTH_REFRESH_RATE_LIMIT_PER_IP`: a sign-in
page asks for two on every visit and renews each once it is three minutes old while the tab is
shown; a hidden tab renews nothing); verify — the per-IP
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
out the id or its creation time. It is not a secret. Sign-in never trusts it: the credential is found
by `credentialId` (which must equal `rawId`), and a `userHandle`, when the device returns one, must
match the owner's.

Sessions gain `method` (`password` · `passkey` · `portalChallenge`; absent on old rows = password),
shown in the session list. The `login` audit row records `method: passkey` and the passkey's record
id (`passkeyId`).

Challenges in Redis: `passkey:auth:<challenge>` (sign-in, 5 min) and
`passkey:reg:<sessionId>` (registration, holds the challenge, 5 min), both consumed with `GETDEL`.

## 4. The two ceremonies

**Adding a passkey.** Security page → «إضافة هذا الجهاز» → a dialog asks for the current password
(and the TOTP code when enabled) → `registration/options` verifies them (a wrong password answers
`AUTH_INVALID_CREDENTIALS` and counts toward the account lockout, as on the sign-in page) → the
browser's prompt → `registration/verify` takes the session's challenge once, verifies origin, RP ID,
user verification and the attestation, stores the credential, audits `passkeyRegistered`.

**The offer after a password sign-in.** On a device with a built-in fingerprint / face / PIN check,
when passkeys are on, the account has none yet and the forced password change is not pending, the
sign-in page asks «الدخول أسرع في المرة القادمة؟» before going in. «تفعيل الدخول بالبصمة» runs the
same step-up with the password just typed; a TOTP account is asked for a current code, because the
one typed at sign-in has usually rolled over. «ليس الآن» is remembered on that browser for thirty
days. "Passkeys are on" is read from the list's `meta.enabled`, since the list answers either way.
The gold portal's sign-in does the same.

**Signing in.** The sign-in page fetches options on load (iOS before 17.4 loses the tap if a network
call happens between it and the WebAuthn call), offers the passkey in the username field's autofill
where the browser supports it, and shows «الدخول بالبصمة أو الوجه» wherever the browser supports
WebAuthn, the options prefetch succeeded and the page's origin is the one answers are accepted from
(a phone can then be used through a QR code even where the computer has no reader).

`authentication/verify`, in order:
1. Take the challenge once.
2. Find the credential (`id` must equal `rawId`) and check the user handle.
3. Verify the signature, origin, RP ID, user verification and counter.
4. Only then apply the account's barriers. Lock, not-activated and not-active have their own codes,
   so account state is told only to someone who holds the key. A cleared password or a refused
   audience answer `AUTH_PASSKEY_INVALID`.
5. Update the counter and `lastUsedAt`.
6. Clear the failed-password count, as a password sign-in does; otherwise a passkey-only person's
   mistyped passwords would add up until the account locked.
7. `completeLogin(method: 'passkey')`.

While the page stays open and its tab is shown, both its challenges (the button's and the
autofill's) are renewed once they are three minutes old. A hidden tab renews nothing, and renews at
once when shown again. The button never uses one older than four minutes, so a tap always finds a
fresh one —
and the autofill is never re-armed while its field is focused or the window has handed focus to the
device's prompt, nor started while the button's prompt is open; nothing is renewed once the form
has left the screen (TOTP step, offer). Once the person has picked a passkey from the autofill, the
server's answer (locked, rate-limited, offline) is shown like the button's.

## 5. Audience

An account may hold or use a passkey when it is internal, or when its external module registered
itself with `allowPasskeysFor(moduleId, subjectType)` — the gold module does, for `goldCompany`.
Deny by default: a module that never registers (the applicant portal) is refused at registration
and at sign-in.

## 6. Threat-model note (security-architecture §6)

| Threat | Control |
|---|---|
| Replayed assertion | Server-held challenge, consumed once (`GETDEL`), 5 min; counter regression refused when the device reports one |
| Phishing / another origin | Origin and RP ID checked against configuration; the browser binds the credential to the RP ID |
| Forged `Host` / `X-Forwarded-Host` | Never read for the ceremony |
| Stolen session plants a backdoor | Password (+ TOTP) step-up bound to the session; audit `passkeyRegistered` |
| Admin reset leaves a key working | The staff reset, the TOTP reset and the gold portal's «new setup link» remove all passkeys; sign-in also refuses a cleared password |
| Rehire revives an old key | Suspend / archive / delete remove passkeys, and reactivation removes any left behind |
| A rotated JWT secret strands every passkey | `user.id` depends on no secret |
| Lockout bypass | `lockedUntil` honoured; a successful passkey sign-in clears the failed-password count, as a password sign-in does |
| Lockout abuse via credential ids | Failed assertions never touch the account lockout; they count per address |
| Account enumeration | Usernameless; options carry nothing per account; one refusal code |
| Applicant skips the phone check | Audience rule (§5) |
| Outbound request on attacker input | Only `none` / certificate-less `packed` attestation reaches the library; trust anchors emptied — no CRL / metadata fetch |
| Kill switch only in the UI | Sign-in, registration and rename check the setting on the server; listing and removing one's own passkeys stay open, so nobody is stuck with a key |

## 7. Tests

**API unit** (`passkey.service.spec.ts`): the real WebAuthn library, driven by a software
authenticator with a real P-256 key (`apps/api/tests/integration/helpers/soft-authenticator.ts`).
It covers:
- single-use challenges, each gate and the audience;
- the kill switch: sign-in, registration and rename refused, the list and `DELETE` still open;
- counter handling and the method on the session;
- the registration step-up (password, TOTP), session binding, the limit, duplicates;
- removal on reset and status changes.

**HTTP integration** (`auth-passkeys.spec.ts`): the same ceremonies end to end, the failed-password
count cleared by a passkey sign-in, and listing and removing with the switch off.

**Web:**
- support detection and error mapping (a prompt the person cancels gets a message, one the page
  withdrew gets none);
- markup of the sign-in buttons and the Security card, including the card with the switch off;
- the offer reading the switch from the list.

The prompts themselves were checked once in Chromium with a virtual authenticator (CDP
`WebAuthn.addVirtualAuthenticator`) when the feature was built; that is not a committed test.

## 8. Follow-ups (not in this change)

- Tell the person when a passkey is added or removed (no user-facing security notification exists
  for any change yet — design §4.4/§4.5 promise them for resets too).
- An administrator view of a user's passkeys (lost phone): today the password reset — or the TOTP
  reset — removes them all.

- Tell a device when one of its passkeys was removed (the WebAuthn signal API), so it stops offering
  a key the server no longer knows.
- ADR-035 §9 says every passkey endpoint checks the kill switch. Listing and removing one's own
  passkeys do not, on purpose (§2). ADRs are not edited, so the next ADR that touches passkeys
  states it.

**Fresh-context review of 2026-11-05** (EGM reviewers: design critic, codebase details,
implementation readiness; every item checked against the code). Fixed on 2026-11-07:
- **Code:** a passkey sign-in now clears the failed-password count (§4 step 6).
- **Code:** the passkey list answers with the switch off, so «حذف» stays reachable.
- **This page** (§2, §3, §4, §6, §7): the order of the sign-in checks, the kill-switch and audience
  exemptions, the TOTP code at the offer, when the button shows, the renewal timing, the tests, and
  the error statuses.
