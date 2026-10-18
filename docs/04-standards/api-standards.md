# API Standards

Every ECMS endpoint — platform or module — follows these standards. They are implemented once in
platform middleware and base controllers, so features get them for free and cannot deviate.

## 1. General

- **Style:** REST over HTTPS, JSON only. Resource-oriented URLs
  ([Naming Conventions §4](naming-conventions.md)).
- **Versioning:** URL-based major version, `/api/v1/...`. Breaking changes require `/api/v2` for
  the affected resource; v1 is maintained through a documented deprecation window.
- **Auth:** `Authorization: Bearer <access-token>` on every request except `auth/login`,
  `auth/refresh`, health checks.
- **Localization:** `Accept-Language: ar | en` selects message language; localized data fields
  return both languages (`{ ar, en }`) and clients pick.
- **Correlation:** server assigns/echoes `X-Request-Id` on every response.

## 2. Response envelope

Uniform across all endpoints:

```jsonc
// Success
{
  "success": true,
  "data": { /* resource or array */ },
  "meta": {                      // present on lists
    "page": 1, "pageSize": 25, "totalItems": 143, "totalPages": 6
  }
}

// Failure
{
  "success": false,
  "error": {
    "code": "APPLICANT_NOT_FOUND",       // stable, machine-readable (error catalog)
    "message": "Applicant not found",    // localized per Accept-Language
    "details": [                          // optional; validation errors, field-level
      { "field": "nationalId", "code": "INVALID_FORMAT", "message": "…" }
    ],
    "requestId": "req_01H..."
  }
}
```

Clients branch on `error.code`, never on message text.

An **action** may carry its own typed `meta` beside an unchanged `data` — how an answer grows
without breaking a client that reads only `data` (`ApiSuccess<T, M>`; the web reads it with
`postWithMeta`). Example: `POST /atm/mail-tickets/accept` answers `data` = the tickets accepted, as
it always did, and `meta.refused` = the tickets the one-open-maintenance rule left pending.

## 3. Methods & status codes

| Operation | Method & path | Success |
|---|---|---|
| List (paginated) | `GET /hr/applicants` | 200 |
| Read | `GET /hr/applicants/:id` | 200 |
| Create | `POST /hr/applicants` | 201 + `Location` |
| Update (partial) | `PATCH /hr/applicants/:id` | 200 |
| Replace | `PUT` — *not used; PATCH only* | — |
| Delete (soft by default) | `DELETE /hr/applicants/:id` | 204 |
| Domain action | `POST /hr/applicants/:id/transitions` | 200/201 |

Errors: 400 validation · 401 unauthenticated · 403 unauthorized (permission or scope) ·
404 not found (also returned instead of 403 when hiding existence) · 409 conflict/duplicate ·
422 business-rule violation · 429 rate-limited · 500 unexpected (no internals leaked).

## 4. Lists: pagination, sorting, filtering

- **Pagination:** `?page=1&pageSize=25` (max `pageSize` 100, enforced). Cursor pagination may be
  added per-resource for very large sets without breaking the envelope (`meta.nextCursor`).
- **Sorting:** `?sortBy=createdAt&sortDir=desc`; sortable fields are declared per endpoint (whitelist).
- **Filtering:** explicit, Zod-validated query params per resource (`?status=in-review&branchId=…`).
  A free-text `?search=` param hits the resource's declared searchable fields. No generic
  query-language passthrough to Mongo — ever (injection + index safety).
- **Scoping is implicit:** results are always filtered to the caller's data scope server-side.

## 5. Error-code catalog

Stable codes live in `packages/contracts` beside the schemas:
`AUTH_INVALID_CREDENTIALS`, `AUTH_TOKEN_EXPIRED`, `AUTH_SESSION_REVOKED`, `FORBIDDEN`,
`VALIDATION_FAILED`, `NOT_FOUND`, `DUPLICATE`, `BUSINESS_RULE_VIOLATION` (+ specific subcodes per
feature, e.g. `WORKFLOW_TRANSITION_NOT_ALLOWED`, `SEQUENCE_EXHAUSTED`), `RATE_LIMITED`,
`INTEGRATION_UNAVAILABLE`. Adding a code = PR to the catalog with docs.

## 6. Idempotency & concurrency

- **Idempotency:** POST endpoints that create documents accept `Idempotency-Key`; the platform
  stores key→response for 24h and replays the stored response on retry.
- **Optimistic concurrency:** update endpoints require the document `version` (Mongoose `__v`
  surfaced as `version`); mismatch → 409 `STALE_DOCUMENT`, client refetches and re-applies.

## 7. Files

- Upload: `POST /platform/files` — multipart (Multer), metadata fields alongside; responds with
  the file record (never a raw path).
- Download: `GET /platform/files/:id/download` → authorized redirect to a short-lived signed URL.
- Entity attachments: `GET /hr/applicants/:id/files` composes from the files service.

## 8. Real-time (Socket.IO)

- Handshake authenticates with the access token; connections join rooms:
  `user:<id>`, `company:<id>`, `branch:<id>`.
- Server→client events mirror domain-event naming (`hr.applicant.transitioned`) and carry
  IDs + minimal display data; clients re-fetch details through the API (keeps authorization
  single-sourced).
- Sockets are a *delivery optimization* — every capability must also work by refetching.

## 9. Rate limiting & security headers

- Redis-backed limits: strict on `auth/*`, standard on writes, generous on reads; responses
  include `Retry-After`. On the staff-facing `auth/*` routes the strict limit sits on what is being
  guessed or replayed: the account (sign-in, and TOTP codes, whichever challenge token carries
  them), the one-time token (activation), the session (renewal, counted by session id because the
  cookie rotates). On top sit a generous per-IP ceiling on every request (`AUTH_RATE_LIMIT_PER_IP`,
  `AUTH_REFRESH_RATE_LIMIT_PER_IP`) and a lower per-IP limit on FAILED sign-ins only
  (`AUTH_FAILED_LOGIN_LIMIT_PER_IP`, 30 per 5 minutes), which bounds account discovery and password
  spraying while successful sign-ins are not counted. Once an address has used it up, every
  sign-in from it is refused until the window ends, correct passwords included, so anyone sharing
  the address can block it for up to five minutes on purpose. A per-IP limit on every request
  alone is shared by everyone behind one office address. Replays of a used refresh token are
  refused every time but reported (audit row, alert) only for the first five per session per
  window. The client address is read from a header the edge in front of the api writes itself
  (`CLIENT_IP_HEADER`: Railway's `X-Real-IP` by default, or the subpath proxy's own header), not
  from the left-most `X-Forwarded-For`, which the caller can write.
- A renewal the server did not refuse (429, 5xx, a dropped connection) never signs the person
  out: the web client retries it and keeps the session. Only a 4xx refusal does.
- Helmet-managed security headers; CORS locked to known web origins; request body size capped
  (higher only on upload routes).
- Responses over 1 KB are compressed (brotli or gzip, whichever the client accepts), the web bundle
  included — except the `auth/*` routes, whose bodies carry tokens (BREACH; matched
  case-insensitively and with repeated slashes collapsed, as Express routes them), partial (Range)
  responses and server-sent events (`infrastructure/http/compression.ts`). A streamed export writes
  through `shared/utils/draining-writer.ts`, which waits on one `drain` listener per response.

## 10. Documentation

- OpenAPI 3.1 generated **from the Zod schemas** (single source of truth) and published per
  environment at `/api/docs` (auth-protected outside dev).
- Every endpoint declares: permission required, scope behavior, error codes, example
  request/response — generated where possible, reviewed always.
