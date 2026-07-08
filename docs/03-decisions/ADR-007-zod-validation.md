# ADR-007: Zod validation at every boundary; types inferred from schemas

**Status:** Proposed · **Date:** 2026-07-08

## Context

Runtime input can violate compile-time types. In a bilingual, document-heavy system, invalid data
that slips past the edge surfaces as corrupt records years later. We need one validation
technology whose schemas double as the type system.

## Decision

- **Every boundary validates with Zod**: HTTP body/query/params (route middleware), queue job
  payloads, webhook payloads, environment variables at boot, settings values, workflow guard
  parameters, OCR extraction results.
- **Types are inferred** (`z.infer<typeof CreateApplicantSchema>`) — never hand-written twice.
- **Schemas live in `packages/contracts`** when shared with the frontend (request/response DTOs),
  so the same schema validates the form client-side and the request server-side.
- Services receive **already-parsed, typed input**; controllers and services never re-validate.

## Alternatives considered

- **Joi / express-validator** — rejected: no type inference; types and validators drift.
- **class-validator + DTO classes** — rejected: decorator/class ceremony, weaker composition,
  poor frontend reuse.
- **JSON Schema (ajv)** — rejected as authoring format: verbose, no inference; note Zod can emit
  JSON Schema for OpenAPI generation, so we lose nothing.

## Consequences

- ✅ Single source of truth per contract; impossible for client and server validation to drift.
- ✅ Environment misconfiguration fails the boot with a readable report instead of a 3 a.m. mystery.
- ⚠️ Zod schemas for deeply localized/conditional forms get complex; mitigated by shared schema
  helpers (`localizedString()`, `paginationQuery()`, `objectId()`) in `contracts/common`.
