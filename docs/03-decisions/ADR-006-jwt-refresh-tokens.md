# ADR-006: JWT access tokens + rotating refresh tokens with reuse detection

**Status:** Proposed · **Date:** 2026-07-08

## Context

The API must be stateless enough to scale horizontally, sessions must be revocable (employees
leave; devices are lost), and the client is a browser SPA — XSS-safe token storage matters.

## Decision

- **Access token**: JWT, 15-minute TTL, kept in SPA memory only (never localStorage). Carries
  `userId`, `sessionId`, permission-set version — not the permission list itself (kept small;
  permissions resolved server-side from Redis cache).
- **Refresh token**: opaque random value, 7-day sliding TTL, `httpOnly` + `Secure` + `SameSite=Strict`
  cookie scoped to the refresh endpoint. Stored **hashed** in the `sessions` collection per device.
- **Rotation with reuse detection**: every refresh issues a new token and invalidates the old; a
  presented already-used token proves theft → the entire session family is revoked and the event
  is audited + alerted.
- **Revocation**: deleting the session record kills the session at next refresh (≤15 min);
  a Redis denylist of `sessionId`s covers immediate force-logout.

## Alternatives considered

- **Server-side sessions only (cookies + Redis)** — rejected: couples every request to Redis and
  complicates future non-browser clients; JWT keeps request auth local to the process.
- **Long-lived JWTs without refresh** — rejected: unrevocable tokens are unacceptable in this domain.
- **localStorage tokens** — rejected: XSS-exfiltratable; the cookie+memory split is the standard
  hardened SPA pattern.

## Consequences

- ✅ Horizontal scaling with immediate-enough revocation and provable theft detection.
- ⚠️ Slightly more complex client (silent refresh on 401); implemented once in the platform API client.
- ⚠️ Permission changes take effect on next access-token issue (≤15 min) unless force-refreshed —
  acceptable, and the version claim lets us force it.
