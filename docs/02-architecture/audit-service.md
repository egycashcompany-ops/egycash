# Audit & Activity Service (Sprint 3.2)

Implementation reference for the platform `audit` service (design: ADR-012,
[Platform Core §8](platform-core.md), [Security Architecture §5](../06-security/security-architecture.md)).
Sprint 2.1 delivered the append-only core (`audit_logs` / `activity_logs`, queued writes,
list endpoints); this sprint completes it to the full spec: audited export, an entity
timeline, retention governance, and security-signal detection. No new collections, no new
permissions — everything lands on the existing streams and seams.

## 1. The two streams

| Stream | Collection | Nature | Retention |
| --- | --- | --- | --- |
| **Audit** | `audit_logs` | Compliance record — who changed what, from where | **Never purged.** No delete API exists anywhere in this service. |
| **Activity** | `activity_logs` | Human-readable narrative feed | Storage-bounded — batch-purged past a configurable floor (F4) |

Both are written through `auditService.record()` / `.recordActivity()` — queued with an
in-request fallback so a write failure never blocks the business operation it describes
(ADR-012's founding invariant, unchanged this sprint).

## 2. Entity timeline (F1/F2) — BD-007 graceful degradation

`GET /api/v1/platform/timeline?entityType&entityId&page&pageSize` returns a **merged view**
over both streams for one entity — not a new entity or collection (Domain Model: Timeline
is explicitly a view).

**[BD-007](../01-domain/business-decisions.md#bd-007--timeline-authorization-degrades-gracefully)**
(approved 2026-07-09, superseding the plan's original "requires both permissions" draft):
content degrades to whichever streams the caller may see — it never requires the union of
both view permissions.

| Caller holds | Response |
| --- | --- |
| `activityLog.view` only | Activity entries only; `included: ["activity"]` |
| `auditLog.view` only | Audit summaries only; `included: ["audit"]` |
| Both | Merged, newest-first; `included: ["activity", "audit"]` |
| Neither | `403 FORBIDDEN` (the denial is itself audited, same as `authorize()`) |

Each stream keeps its own gate — the composite endpoint never widens access beyond what
`GET /platform/audit-logs` or `GET /platform/activity-logs` would already allow the same
caller. This is the model for any future composite read endpoint (Plan §7 note, now BD-007's
closing rule).

**Known limitation:** per-entity histories are fetched and merged in memory, capped at
1,000 rows per stream. This is correct and fast for a single record's history at current
volumes; an entity with an unbounded history would need a true k-way-merge cursor —
deferred until a real one exists (logged as technical debt, not built speculatively).

## 3. Audited export (F1/F3)

`GET /api/v1/platform/audit-logs/export` — same filter vocabulary as the list endpoint
(`entityType`, `entityId`, `actorUserId`, `action`, `moduleId`, `from`, `to`), no pagination:
it streams up to the row cap via a MongoDB cursor (`Content-Type: text/csv`), never
buffering the full result set.

- **Permission:** `auditLog.export` (existing catalog entry — F1 is its first consumer).
- **Row cap:** `audit.export.maxRows` (settings, default 50,000, hard ceiling 200,000).
- **The export is itself audited** — after the stream completes, one `audit_logs` row
  (`action: "export"`) records the actor, the filter used, and the row count.
- **Masking:** the `changes` column applies the platform's default masking to fields named
  `nationalId` (`298*******4567`, Security Architecture §3's existing rule) — field-name-based,
  not a general PII scanner; documented as the current scope, not a promise of completeness.

## 4. Retention governance (F4)

Settings-declared, with **hard floors** so a misconfiguration cannot purge below a
compliance window:

| Setting | Default | Floor | Scope |
| --- | --- | --- | --- |
| `audit.retention.activityDays` | 730 | **365** (schema minimum + a code-level clamp) | organization |

`platform.audit.retention` (daily, 03:00) purges **activity** records older than the
resolved cutoff in batches of 5,000, looping until nothing remains past cutoff — idempotent,
safe to re-run or trigger manually (scheduler inventory `run-now`). Each run writes one
`audit_logs` row (`action: "purge"`, entity `activityLog/retention`) with the applied
retention window and the count deleted. **The audit stream has no retention setting and no
delete path** — this job's queries and deletes are scoped to `ActivityLogModel` only.

## 5. Security-signal detection (F5)

`platform.audit.securitySignals` (hourly) runs four detectors over the trailing audit
window. Each raised signal is an `alertRaised` audit row (`entityType: "security"`) plus the
reliable `platform.audit.alertRaised` event — the event is a seam only; no consumer
subscribes this sprint (the notifications capability will, later).

| Signal | Trigger | Window | Threshold |
| --- | --- | --- | --- |
| `repeatedDenied` | `permissionDenied` rows per user | 1 hour | `audit.signals.deniedThreshold` (default 10, floor 3) |
| `lockoutCluster` | `lockout` rows, organization-wide | 1 hour | fixed at 3 (not settings-declared — Plan §12 lists only the two thresholds below) |
| `exportSpike` | `export` rows per user | 24 hours | `audit.signals.exportSpikeThreshold` (default 20, floor 5) |
| `refreshReuse` | `refreshReuse` rows per user | 1 hour | 1 occurrence (inherently severe) |

**Dedup per (signal, subject, window):** before raising, the detector checks whether the
same signal already fired for the same subject within the window — a re-run (scheduled or
manual) never double-raises.

## 6. Query hardening (F5 in the plan's own numbering)

`GET /platform/audit-logs` (and the export) gained a `moduleId` filter
(`entityRef.moduleId`); the existing `entityType` filter already covers what the plan calls
"resource." A new index (`ix_moduleId_at`) covers moduleId-filtered queries; `activity_logs`
gained a plain `at` index for the retention job's age scan.

## 7. Configuration summary

All four settings are organization-scoped, declared with Zod schema minimums that act as
hard floors (misconfiguration cannot be written past them — same pattern as the existing
lockout settings):

`audit.retention.activityDays` (≥365) · `audit.export.maxRows` (≤200,000) ·
`audit.signals.deniedThreshold` (≥3) · `audit.signals.exportSpikeThreshold` (≥5).

## 8. No new permissions, no new collections

`auditLog.view`, `auditLog.export`, `activityLog.view` already existed in the catalog —
this sprint is their first full set of consumers. The permission matrix is unchanged
(verified by `check:permission-matrix`). Timeline and signals are views/records over the
two existing collections; nothing new is persisted.
