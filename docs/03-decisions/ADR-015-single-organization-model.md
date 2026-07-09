# ADR-015: Single-organization, multi-branch model (Branch is the primary scope)

**Status:** Accepted · **Date:** 2026-07-08 · **Supersedes:** the multi-company aspects of
ADR-004, ADR-005 and the Milestone 1 database/permission designs
(per [Architecture Review 01, R1](../10-reviews/2026-07-architecture-review-01.md))

## Context

Milestone 1 designed a multi-_company_ platform (`companies` collection, `companyId` stamped on
every business record, company-level scopes, company-scoped sequences and settings). The corrected
business context is: **one organization operating ~6 branches, with branch expansion expected —
not a multi-tenant SaaS platform.** Carrying a legal-entity dimension with exactly one value taxes
every query, index, unique constraint, seed, test, and permission decision.

## Decision

- Replace `companies` with a singleton **Organization** profile (identity, logo, legal data,
  fiscal settings). No `companyId` on business records.
- **Branch becomes the primary scoping unit.** Hierarchy: Organization (singleton) → Branch →
  Department → Section; Job Titles are organization-level catalogs.
- Data scopes collapse from `own | branch | company | all` to **`own | branch | organization`**.
- Settings hierarchy becomes **`user → branch → organization`** (3 levels).
- Sequence scopes become `organization | branch`.
- Unique constraints simplify (e.g., `ux_nationalId` instead of `ux_nationalId_companyId`).
- Org units carry a `managerId` and an acting-manager delegation window (Review R11).

## Re-expansion path (kept deliberately open)

1. Scope enforcement stays centralized in `BaseRepository` — one place to extend.
2. The outer scope is named `organization` (not `all`), keeping the vocabulary ready for an
   outer legal-entity level.
3. Reintroducing a legal-entity dimension is a recorded migration: add field, backfill, re-scope —
   governed by a future ADR.

## Alternatives considered

- **Keep the multi-company model "just in case"** — rejected: speculative generality that taxes
  everything for years for a subsidiary that may never exist.
- **Generic org-unit tree** — rejected (Review R12): the business states its structure
  (Branch → Department → Section); the materialized-path field makes a future migration mechanical.

## Consequences

- ✅ Every record, index, and permission check gets simpler; the permission model is explainable
  in one sentence.
- ✅ Seeds and tests shed a combinatorial dimension.
- ⚠️ If EGYCASH later creates subsidiaries, a real migration is required — mitigated by the
  re-expansion path above.
- Open question **OQ-1** (can departments span branches?) is answered _no_ for now: departments
  belong to branches. Revisit with the business before any cross-branch entity is modeled.
