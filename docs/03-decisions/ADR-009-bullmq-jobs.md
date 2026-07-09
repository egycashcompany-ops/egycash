# ADR-009: BullMQ worker process for all long-running work

**Status:** Accepted · **Date:** 2026-07-08

## Context

OCR, PDF/Excel report generation, email fan-out, imports/exports, thumbnails, SLA timers, and
scheduled reports are all too slow or too bursty for the request path. Blocking Express requests
on them destroys latency; running them in-process risks memory/CPU starvation.

## Decision

- **All work >100ms of CPU or any external I/O chain runs as a BullMQ job** in a dedicated
  worker process (`apps/api/src/worker.ts`), deployed as a separate Railway service from day one.
- **Queue topology**: one queue per domain (`ocr`, `notifications`, `reports`, `files`, `outbox`,
  `scheduled`) — isolation prevents a report storm from delaying notifications.
- **Job contracts**: payloads are Zod-validated; every job carries `requestId` for log correlation.
- **Reliability**: exponential backoff retries, dead-letter queues with alerting, idempotent
  handlers, repeatable jobs for schedules (report schedules, SLA escalation ticks).
- **Job status API**: the platform exposes job progress (e.g., OCR extraction status) so the UI
  can poll or receive socket pushes.

## Alternatives considered

- **`setImmediate`/in-process async** — rejected: no retries, no persistence, dies with the process.
- **Agenda (Mongo-backed jobs)** — rejected: BullMQ (Redis) is faster, better maintained, and
  Redis is already in the stack.
- **Serverless functions for heavy work** — rejected: stack is Railway + Node; adds a second
  operational model for no current benefit.

## Consequences

- ✅ Flat API latency; heavy work retries safely; worker scales independently.
- ✅ The future microservice split inherits per-module/per-domain queues that already exist.
- ⚠️ Two processes to run locally — hidden behind a single `npm run dev` orchestration.
- ⚠️ Results are asynchronous; UI patterns (progress, notify-on-done) are standardized in the
  platform frontend components once.
