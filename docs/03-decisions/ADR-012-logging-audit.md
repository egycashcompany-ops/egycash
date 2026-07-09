# ADR-012: Three log streams — audit, activity, system (Pino)

**Status:** Accepted · **Date:** 2026-07-08

## Context

"Logging" hides three different products: compliance-grade change history (who changed what),
business timelines for end users (what happened to this applicant), and technical telemetry for
engineers. Mixing them produces logs that serve no one.

## Decision

Three streams, three schemas, three retentions:

| Stream | Store | Content | Retention |
|---|---|---|---|
| **Audit log** | `audit_logs` (append-only) | entity ref, action, **old/new field-level diff**, actor, IP, user agent, requestId, timestamp | Years (compliance) |
| **Activity log** | `activity_logs` | localized, human-readable business events per entity (timeline feed) | Lifetime of entity |
| **System log** | stdout → Railway logs (Pino JSON) | requests, errors, job runs, integration calls | Weeks |

- Audit capture happens in the **service layer** (`audit.record` + automatic diffing in
  base-CRUD services) — not in Mongoose hooks, which lack actor/IP context.
- Every request gets a `requestId` (AsyncLocalStorage) propagated into audit records, job
  payloads, and system logs — one ID traces a user action across api → queue → worker.
- Audit writes are queued (must not slow or fail business operations) with loss alarms; there is
  **no update/delete API** for audit records.
- Pino is the only logger; `console.*` is lint-banned.

## Alternatives considered

- **One "logs" collection for everything** — rejected: incompatible schemas, retentions, and audiences.
- **Mongoose plugin auto-audit** — rejected as the primary mechanism: hooks can't see the acting
  user/IP and miss bulk operations; kept only as a safety net that flags un-audited writes in dev.
- **External audit store (e.g., append-only ledger service)** — deferred: Mongo append-only +
  restricted roles suffices now; the `audit.record` seam allows relocation later.

## Consequences

- ✅ Compliance answers ("who changed this salary field?") are a query, not an investigation.
- ✅ Entity timelines come free for every feature from the activity stream.
- ⚠️ Audit volume grows fast; mitigated by TTL-per-stream, field-diff (not full-document) storage,
  and archival jobs.
