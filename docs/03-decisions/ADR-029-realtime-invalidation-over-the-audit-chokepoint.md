# ADR-029: Realtime screens by invalidation signals over the audit chokepoint

**Status:** Accepted · **Date:** 2026-08-25

## Context

Every screen fetched once and stayed as fetched until navigation or a manual refresh. The
platform owner asked for the opposite: an employee added on one machine appears on another's
open list; a shipment, a gold receipt, an ATM status transition — all of it, on every screen,
without a refresh.

An audit of what already existed found three load-bearing facts:

1. **A full Socket.IO transport was already running and nobody was listening.** Sprint 3.3 built
   the server (`infrastructure/realtime/socket-server.ts`): attached to the api's HTTP server,
   authenticated with the same JWT as HTTP, per-user rooms, and a Redis relay channel so the
   worker process can reach connected clients. The web app never installed `socket.io-client` —
   the notification bell polled every sixty seconds instead of hearing the push that was already
   being emitted for it.

2. **Domain events are business events, not a change feed.** The catalog holds 179 events, but
   they are selective by design — `updatePersonal` on an employee emits nothing — and two whole
   modules (ATM, Gold) emit none at all. Building realtime on the bus would miss plain edits
   everywhere and miss ATM/Gold entirely, or force ~70 new emit sites into business services.

3. **`auditService.record()` is the one call every mutation already makes.** ADR-012's audit
   trail is written at every create, update, delete and status transition in every module — the
   PR checklist enforces it — and its entry shape (`entityRef` + `action` + timestamp) is
   exactly the minimal signal a client needs.

## Decision

**The audit chokepoint is the realtime signal source.** `record()` (and `recordActivity()`)
hands each entry to a platform publisher; the publisher broadcasts to Socket.IO topic rooms; the
web client turns batches of signals into TanStack Query invalidations; screens refetch through
the normal authorized api.

```
mutation → auditService.record() → publishAuditedChange()
        → topic rooms (Socket.IO + Redis relay)          [existing transport]
        → client coalescer (300 ms) → invalidateQueries  [ADR-013 keys]
        → refetch through the caller's own permissions and scope
```

The rules that make this safe:

- **The signal is not data.** Payload is `{module, entity, entityId, action, at}` — never a
  field of the record. Nothing sensitive rides the socket; ordering cannot regress state because
  no state travels; duplicates coalesce into one refetch.
- **Joining a topic room requires the entity's own view permission**, resolved server-side at
  connect from the verified `AuthContext`. No `payrollRun.view`, not even the *fact* that a
  payroll run changed. `hr.employeePayItem` sits behind `employee.viewCompensation`.
- **Branch is fail-closed.** An `organization` grant joins the org-wide room; narrower grants
  join only their own branch's room; `own` joins nothing. A signal that names no branch reaches
  org-wide viewers only — a branch viewer can never receive another branch's activity.
- **Two registries, both guarded.** The api maps every audited `(moduleId, entityType)` to a
  permission (`realtime-registry.ts`); its spec scans the source tree and fails CI on an
  unclassified entity — a forgotten signal is a build failure, not a stale screen discovered in
  production. The web maps every topic to the query keys its mutations already invalidate
  (`invalidation-registry.ts`); its spec reads the api registry file and fails on drift in
  either direction.
- **Reconnect is reconciliation.** On any re-connect the client stale-marks the whole
  realtime-covered key set; mounted screens refetch, the rest refetch when opened. Missed
  signals can cost at most one connection gap.
- **`REALTIME_ENABLED=false` restores the previous behaviour exactly** (no rooms, no
  broadcasts); the bell's poll stays as a safety net always — five minutes with the socket up,
  one minute without.

## Consequences

- Every audited mutation in every module — ATM and Gold included — broadcasts from day one with
  zero business-service edits. Audit and activity screens go live through the same pipe, gated
  by `auditLog.view` / `activityLog.view`.
- False-positive signals are possible (an aborted transaction after `record()`, an audit write
  the mutation outlived) and harmless: a refetch reads the truth. The database remains the only
  source of truth; realtime is delivery of *staleness*, never of data.
- Branch-scoped viewers get realtime only where publishers pass `branchId` — a later, per-module
  wiring pass (the `AuditedChange.branchId` field already carries it). Until then they simply
  keep today's fetch-on-navigation behaviour for those entities.
- A socket authenticates once at connect; revoking a role does not evict a live socket until it
  reconnects. Acceptable at current session lengths; a disconnect-on-role-change subscriber to
  `platform.roleAssignment.changed` is the known follow-up if it stops being acceptable.
- Domain events for ATM/Gold remain worth adding for automation/notification rules — a separate
  concern this decision neither blocks nor requires; the publisher is one seam both can feed.
