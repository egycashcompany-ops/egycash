# ADR-035: Sign-in with a passkey (fingerprint / Face ID), and it counts as the second factor

**Status:** Accepted · **Date:** 2026-11-01 · **Relates to:**
[ADR-006](ADR-006-jwt-refresh-tokens.md) (sessions), [ADR-027](ADR-027-external-identities.md) (external accounts),
[ADR-033](ADR-033-outbound-http-one-door.md) (outbound HTTP),
[Review R13](../10-reviews/2026-07-architecture-review-01.md) (mandatory TOTP for privileged accounts),
[auth design](../12-planning/auth-account-lifecycle-design.md) §10, [passkey design](../12-planning/passkey-sign-in-design.md)

## Context

The owner: «عايز الدخول يبقي ممكن من خلال الـ Fingerprint أو FaceID للموبايل بحيث مش كل مره يكتب
الباسورد». The platform closes a session after ten idle minutes, so on a phone the sign-in page
comes back almost every time the app is reopened, and the password is typed again.

The web's way to sign in with the device's own biometric is a **passkey** (WebAuthn): a key pair
made on the device, its private half never leaving it and released only after the device verifies
the person — fingerprint, face, or the device PIN. The server keeps the public key and checks a
signature over a one-time challenge. No password crosses the network.

The auth design (§10) anticipated WebAuthn as a *second* factor on the challenge-token envelope. The
owner's request is a *primary* sign-in, which the frozen design did not cover; this ADR is that
revision.

## Decision

1. **A passkey is a sign-in method of its own.** Discoverable credentials (nothing is typed: the
   device offers the accounts it holds for this site), user verification **required**, attestation
   `none`. Synced passkeys (iCloud Keychain, Google Password Manager) are accepted — refusing them
   would refuse every iPhone. The password remains, always, as the fallback.

2. **A passkey sign-in satisfies the second factor** (owner decision, 2026-11-01: «لا، البصمة
   كفاية»). A user-verifying passkey is the device in the person's hand plus their biometric or PIN,
   and it cannot be phished to another site — multi-factor in NIST SP 800-63B terms. So the TOTP
   code is not asked after it, including for privileged accounts and accounts an administrator
   forced onto TOTP. **This amends R13**: privileged accounts must use TOTP *or a passkey*; the
   password path still enforces TOTP exactly as before.

3. **Who.** Staff accounts, and the external accounts of a module that opts in — the gold-vault
   customer portal does (owner: «الموظفين وعملاء بوابة الذهب»). Every other external account is
   refused, applicants in particular: they sign in with their national ID, the phone on file and a
   one-time code, and a passkey would replace that check rather than add to it.

4. **The relying party is configuration, never the request.** The RP ID is the host of
   `WEB_PUBLIC_URL` (override: `WEBAUTHN_RP_ID`), the expected origin is that URL's origin. Production
   is `ecms.egycash.com.eg`. Passkeys are bound to the RP ID for good: moving the app to another host
   orphans them, and people re-add them from the new host (the password still works). `trust proxy`
   makes `Host`/`X-Forwarded-*` caller-controlled, so nothing about the ceremony reads them.

5. **Adding a passkey asks for the current password** — and the TOTP code when the account has one.
   Otherwise a stolen or unattended session could plant a key that outlives a password change. The
   challenge is bound to the session that proved it, lives five minutes and is consumed once. A
   wrong password here counts toward the account lockout, as at the sign-in page. Right after a
   password sign-in on a device that can hold a passkey, the sign-in page offers to add one («sign
   in faster next time?»), using the password just typed — so nobody has to find the Security page
   to get the benefit. It is offered only while the account has no passkey anywhere, and «not now»
   holds for thirty days on that browser.

6. **Every challenge is server-held and single-use** (Redis `GETDEL`), five minutes. Synced
   passkeys report a signature counter of 0, so replay protection rests on the challenge alone; the
   stateless challenge-token JWTs used by the TOTP step are not reused for this.

7. **Sign-in keeps every barrier the password path has.** A locked account (`lockedUntil`), a
   never-activated, suspended or archived account, and an account whose password an administrator
   cleared are refused before any session is made. A failed assertion counts toward the per-address
   failed-sign-in limit; it does not count toward the account lockout, because a credential id is
   not a secret and anyone holding one could otherwise lock its owner out.

8. **Lifecycle.** An administrator's password reset removes all of the account's passkeys, so «reset»
   still locks the account out. So does an administrator's TOTP reset: it is what is done for a lost
   or compromised phone, and a passkey stands in for the TOTP code (§2). Suspending, archiving or deleting the account removes them too, so a
   later reactivation does not revive a key from before. Changing one's own password keeps them —
   they are separate credentials. People rename and remove their own from *My account → Security*;
   gold-portal customers from the portal's *Security* tab.

9. **An organization setting, `auth.passkeys.enabled` (default on), turns the feature off** — every
   passkey endpoint checks it, so the off switch does not depend on the browser hiding a button.

10. **Library: `@simplewebauthn/server` and `@simplewebauthn/browser`, v13.** MIT, maintained,
    widely used; v13 rather than v14 for the smaller dependency tree (no global `reflect-metadata`).
    A registration claiming any attestation other than `none`, or `packed` self-attestation with no
    certificate chain, is **refused before the library sees it**: the library's certificate-path
    code fetches revocation lists from URLs inside the certificates — for `android-key`, ones the
    client supplied — which would be outbound HTTP on attacker input, outside ADR-033's door.
    Browsers answer `none` when `none` is asked for, so this costs no real passkey. The trust
    anchors are emptied at start-up as a second line: with none configured, path validation stops
    before any fetch.

## Consequences

- A second way into every staff account exists. Its strength is the device's: anyone who knows a
  shared phone's PIN can use a passkey enrolled on it. The enrollment screen says so, and the
  passkey list shows when each was last used.
- Sessions now record how they were opened (`password` · `passkey` · `portalChallenge`), and the
  session list shows it.
- No user-facing notification of a new passkey exists yet — none exists for any security change on
  this platform. Recorded as a follow-up in the design; the audit log carries every registration,
  removal and sign-in meanwhile.
