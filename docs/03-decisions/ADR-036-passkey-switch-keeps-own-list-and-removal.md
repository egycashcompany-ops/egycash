# ADR-036: With passkeys switched off, people can still see and remove their own

**Status:** Accepted · **Date:** 2026-11-07 · **Supersedes:** [ADR-035](ADR-035-passkey-sign-in.md)
§9 (what the organization switch covers) · **Relates to:**
[passkey design](../12-planning/passkey-sign-in-design.md) §2, §6

## Context

ADR-035 §9 says the organization setting `auth.passkeys.enabled` turns passkeys off and that every
passkey endpoint checks it. The code as built does not do that for removal: `DELETE
/auth/passkeys/:id` stays open while passkeys are off, on purpose, so that nobody is left with a key
on a lost phone that they cannot take away. But the list (`GET /auth/passkeys`) was refused while
off. The Security page builds «حذف» from the list, so with the switch off there was no way to reach
the removal that the server allowed.

A fresh-context review of the passkey design on 2026-11-05 found this gap. The owner approved the
fix on 2026-11-07 («يلا»).

## Decision

1. **The switch covers sign-in, adding and renaming.** With `auth.passkeys.enabled` off, the server
   refuses the sign-in challenge and its answer, the registration step-up and its answer, and a
   rename, with `AUTH_PASSKEYS_DISABLED` (403). This is still checked on the server, never only by
   hiding a button.
2. **One's own list and removal stay open.** `GET /auth/passkeys` answers the caller's own passkeys
   whatever the switch says, and reports the switch in `meta.enabled`; an account that may not hold
   passkeys (ADR-035 §3) is still refused it. `DELETE /auth/passkeys/:id` removes a passkey only
   when it is the caller's own, and checks nothing else.
3. **The page follows `meta.enabled`.** With the switch off, the Security card says passkeys are off,
   lists the devices with only «حذف», and offers neither adding nor renaming. The sign-in page's
   offer to add a passkey is not shown.

Everything else in ADR-035 stands.

## Alternatives considered

- **Refuse the list too, and remove keys only through an administrator.** The administrator's
  password reset already removes every passkey, but it also forces a new password. Making that the
  only way to drop one lost phone turns a self-service step into a support ticket.
- **Remove every passkey when the switch is turned off.** Turning a setting off and on again would
  then cost every person their devices. A switch should be reversible.

## Consequences

- With passkeys off, a person can still see which devices hold a key for their account. The list
  shows only their own devices' names and dates; it gives no way to sign in.
- During a deploy the two versions can meet. An older page gets the list while passkeys are off
  and may offer adding or renaming; the server refuses both with `AUTH_PASSKEYS_DISABLED`. A newer
  page still reads that code on the list as "off", so it works against an older server too.
