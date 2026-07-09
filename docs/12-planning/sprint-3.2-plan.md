# Sprint 3.2 Planning — Audit & Activity Service

**Release:** v0.4.0 (proposed) · **Capability:** one — Audit & Activity (BD-006) ·
**Status:** 📝 Awaiting approval · **Design authority:** ADR-012,
[Platform Core §8](../02-architecture/platform-core.md),
[Security Architecture §5](../06-security/security-architecture.md)

> **Honest starting point:** Sprint 2.1 already delivered the audit core — append-only
> `audit_logs`/`activity_logs`, queued writes with in-request fallback and loss alarms,
> `requestId` correlation, and query endpoints. **This sprint completes the capability to
> its full ADR-012 / Security-Architecture spec** — it does not rebuild it.

## 1. Sprint goal

Close the gap between the audit core and the designed capability: **audited bulk export,
entity timelines, retention governance, and security-signal detection** — so that
compliance questions are answered by queries, entity histories are user-visible, and
suspicious patterns surface before humans report them.

## 2. Business motivation

- Cross-cutting business rule #3: *full accountability* — regulators and internal audit ask
  "who changed this, when, from where" and expect an exportable answer, not a database session.
- Permission Matrix §6 mandates quarterly reviews of `export`/`print`/break-glass usage —
  that review needs the export and signal machinery this sprint builds.
- Retention is a compliance promise (audit: years) *and* a storage-cost control (activity:
  bounded); today neither is enforced by policy.
- For a cash-logistics company, permission probing, lockout storms, and export spikes are
  security events; Security Architecture §5 requires their detection.

## 3. Functional scope

| # | Feature | Detail |
| --- | --- | --- |
| F1 | **Audit export** | `GET /platform/audit-logs/export` → CSV stream of the current filter set; `auditLog.export` permission; row-capped (config); **the export itself is audited** (actor, filter, row count) |
| F2 | **Entity timeline** | `GET /platform/timeline?entityType&entityId` — the merged *view* (Database Design §3): activity records + audit summaries for one entity, time-ordered, paginated |
| F3 | **Retention governance** | Settings-declared retention per stream; scheduled job purges expired **activity** records in idempotent batches; **audit stream gains an archival seam only** (append-only — no delete path is ever created) |
| F4 | **Security-signal detection** | Scheduled detectors over recent audit data: repeated 403s per user, lockout clusters, export spikes, refresh-reuse occurrences → each raises an `alertRaised` audit record + `platform.audit.alertRaised` event (human delivery arrives with the notifications capability — the event is the seam) |
| F5 | **Query hardening** | Audit/activity list filters extended (moduleId, resource); covering indexes verified against the new query paths |

## 4. Non-functional requirements

- Audit writes keep the existing invariant: **never block or fail a business operation**.
- Query/timeline p95 < 300 ms at current volumes (covering indexes, enforced pagination).
- Export bounded (default 50 000 rows) and streaming — no full result buffering.
- Retention job: batched deletes (≤ 5 000/batch), idempotent, observable in the scheduler
  inventory; **hard minimum floors** on retention settings so misconfiguration cannot
  purge below compliance windows.
- Append-only remains structural: no update/delete API for `audit_logs`, ever.

## 5. Architecture overview

No architectural change. Everything lands inside the existing `platform/audit` feature
(canonical shape) plus registrations on existing seams:

```
platform/audit/
├── audit.export.ts        # CSV serialization + streaming (F1)
├── audit.timeline.ts      # merge composer (F2)
├── audit.retention.ts     # retention job handler (F3)
├── audit.signals.ts       # detectors (F4)
└── (existing model/repository/service/controller/routes extended)
```

Jobs run via the existing **scheduler** registry and `audit`/`scheduled` queues; events use
the existing reliable tier; settings use the declared registry. Zero new services, zero
new middleware, zero module coupling.

## 6. Domain model impact

No new entities ([Domain Model](../01-domain/domain-model.md) already defines Audit Record
and Activity Record as immutable facts; Timeline is explicitly *a view, not an entity*).
Additions are attributes of the existing context: a **Retention Policy** is configuration
(settings), and a **Security Signal** is an Audit Record with action `alertRaised` — no new
collection, no new aggregate.

## 7. Public APIs

| Endpoint | Permission | Notes |
| --- | --- | --- |
| `GET /platform/audit-logs` *(existing, extended filters)* | `auditLog.view` | + `moduleId`, `resource` filters |
| `GET /platform/audit-logs/export` *(new)* | `auditLog.export` | CSV; capped; audited; same filter params as the list |
| `GET /platform/activity-logs` *(existing)* | `activityLog.view` | unchanged |
| `GET /platform/timeline` *(new)* | `activityLog.view` **and** `auditLog.view`² | merged entity history, newest-first, paginated |

² Timeline exposes audit summaries; requiring both keeps it consistent with viewing the
streams separately. If review prefers a softer rule (activity-only content for
activity-only viewers), the composer degrades gracefully — decision flagged for review.

## 8. Events

| Event | Tier | Payload v1 |
| --- | --- | --- |
| `platform.audit.alertRaised` *(new)* | reliable (outbox) | `{ signal, userId?, count, windowMinutes, details? }` + `schemaVersion` (R22) |

Consumers: none in this sprint (notifications capability subscribes later — documented seam).

## 9. Permissions

**No new permissions.** `auditLog.view`, `auditLog.export`, `activityLog.view` already
exist in the catalog; F1 finally exercises `auditLog.export`. The generated permission
matrix is therefore unchanged.

## 10. Database collections

**No new collections.** `audit_logs` and `activity_logs` are extended with: an
`ix_action_at` index (signal windows), and `ix_entityRef_at` verified for the timeline
path. Alert facts are `audit_logs` rows (`action: 'alertRaised'`, entityType `security`).

## 11. Background jobs

| Task key (scheduler registry) | Cron | Does |
| --- | --- | --- |
| `platform.audit.retention` | daily 03:00 | purge expired activity records in batches; log/audit the applied policy |
| `platform.audit.securitySignals` | hourly | run detectors over the trailing window; raise `alertRaised` records/events; dedup per (signal, subject, window) |

Both appear in the existing scheduled-task inventory with pause/run-now controls (R3).

## 12. Configuration (settings-declared)

| Key | Default | Floor | Scope |
| --- | --- | --- | --- |
| `audit.retention.activityDays` | 730 | ≥ 365 | organization |
| `audit.export.maxRows` | 50 000 | ≤ 200 000 cap | organization |
| `audit.signals.deniedThreshold` (403s/user/hour) | 10 | ≥ 3 | organization |
| `audit.signals.exportSpikeThreshold` (exports/user/day) | 20 | ≥ 5 | organization |

## 13. Security considerations

- **Export = bulk PII egress**: permission-gated, individually audited, row-capped; change
  diffs may contain PII (national IDs) → export applies the platform redaction/masking
  policy to flagged fields — masking rules are part of this sprint's review.
- Signals themselves must not leak: alert records reference user IDs, not credential data.
- Retention floors prevent a mis-set setting from destroying compliance history; the audit
  stream has **no deletion path** regardless of configuration.
- Timeline endpoint is scope-checked like the underlying streams (no privilege widening).

## 14. Integration with existing platform services

| Service | Use |
| --- | --- |
| settings | retention/threshold/cap declarations + resolution |
| scheduler | the two task registrations (inventory, pause, run-now) |
| rbac | existing permissions; 403 audit records are the F4 input signal |
| kernel events/outbox | `alertRaised` on the reliable tier |
| auth | refresh-reuse audit records are an F4 input signal |
| notifications *(future)* | will subscribe to `alertRaised` — no work here beyond the event |

Touches **no module code** (none exists) and **modifies no other platform service**.

## 15. Testing strategy

- **Unit:** retention window/batch math (incl. floor enforcement), each signal detector
  (threshold edges, dedup), CSV serialization + masking, timeline merge ordering.
- **Integration:** export happy/authZ/cap paths + the export-audits-itself invariant;
  timeline for an entity with mixed history; retention job end-to-end on seeded aged data;
  signal job raising an alert from seeded 403 records; existing suites stay green.
- Same harness as prior sprints (in-memory replica set in CI; `MONGO_TEST_URI` locally).

## 16. Risks

| Risk | Mitigation |
| --- | --- |
| Audit volume growth degrades queries/exports | covering indexes, enforced caps, pagination; archival seam prepared (not built) |
| Signal false positives erode trust | conservative defaults, per-signal dedup windows, thresholds configurable |
| Export misuse (insider egress) | audited exports are themselves an F4 signal input (export spikes) |
| Retention misconfiguration | hard floors in setting declarations; job dry-run logging on first run |

## 17. Out of scope

Notifications delivery of alerts (2.2 capability) · report-engine rendering/PDF (2.4) ·
external append-only ledger store (deferred in ADR-012) · audit UI (frontend shell work) ·
system-log stream changes (stdout/Pino is out of band) · any change to write-path
semantics · sequences/localization (separate sprints).

## 18. Acceptance criteria

- [ ] Export endpoint live: permission-gated, capped, streaming CSV, and **its use appears
      in the audit log** — proven by integration test.
- [ ] Timeline endpoint returns the merged, ordered history for any entity ref.
- [ ] Both scheduled tasks visible in the scheduler inventory; run-now works; retention
      respects floors and batches; signals raise `alertRaised` records + events.
- [ ] Settings declared with floors; unknown/invalid values rejected as today.
- [ ] No new permissions/collections; permission-matrix check passes unchanged.
- [ ] All CI gates green (lint, typecheck, unit + integration, build, matrix/flag checks).
- [ ] Docs updated in the same PR: files-service-style reference for audit
      (`docs/02-architecture/audit-service.md`), CHANGELOG, ECMS-BOOK sprint log.
- [ ] Architecture review checklist (PR template) fully satisfied; retrospective follows
      after merge.
