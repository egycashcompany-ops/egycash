# ADR-016: Job Positions and Job Requisitions are OPTIONAL for applicants (Talent Pool)

**Status:** Accepted · **Date:** 2026-07-21 · **Relates to:**
[ADR-015](ADR-015-single-organization-model.md) (organization model),
[recruitment-applicants](../02-architecture/recruitment-applicants.md)

## Context

The HR Foundation introduces an organization structure (Company → Branch → Department → Section,
plus the org-wide **Job Titles** catalog) and — in later phases — **Job Positions** (approved,
budgeted headcount at a location) and **Job Requisitions** (a hiring request against a position).

There is a real temptation, once positions and requisitions exist, to make every applicant belong
to one. The business is explicit that this is wrong: **an applicant may simply walk into the
company and submit an application.** Recruiters evaluate the person first and decide which position
fits them later — often never through a formal requisition at all. This is the **Talent Pool**.

Recruitment already honours part of this today: `applicant.jobRequisitionId` is optional and the
whole pipeline (screening → interviews → offer → employee → file) works for a null requisition
(Sprint 4.2 "direct applicant" path).

## Decision

The relationship between an applicant and an approved vacancy is **optional at every layer, forever**:

- `applicant.jobRequisitionId` **remains OPTIONAL** (nullable).
- A future `applicant.jobPositionId` (when Job Positions land) **is OPTIONAL** (nullable) as well.
- Applicants **may remain in the Talent Pool indefinitely** with neither link set.
- No module may design a query, screen, workflow, report, validation, or index that **assumes**
  every applicant belongs to a Job Position or Job Requisition. "Belongs to a vacancy" is a
  filter, never a precondition.
- Both recruitment **entry paths** are first-class and must stay so:
  1. **From a Job Requisition** — the standard, requisition-driven hire.
  2. **Direct / Talent Pool** — a walk-in applicant with no requisition and no position.

This rule is a **cross-module invariant**: Job Positions, Job Requisitions, and any future module
that touches applicants inherit it.

## Alternatives considered

- **Require a requisition (or position) per applicant** — rejected: it contradicts the business,
  breaks the existing direct-applicant path, and makes the Talent Pool impossible to model.
- **Two applicant types (pooled vs. requisitioned)** — rejected: needless bifurcation; a single
  applicant with optional links expresses both, and lets a pooled applicant later be attached to a
  position/requisition without a type change.

## Consequences

- ✅ The Talent Pool is a natural state, not a special case.
- ✅ Recruitment integration (a later phase) adds *optional* links + filters, changing no existing
  semantics; the null-requisition pipeline keeps working.
- ✅ Job Positions can report occupied/vacant headcount without depending on applicants being linked.
- ⚠️ Occupancy/vacancy analytics must treat unlinked applicants as "pool", not "unassigned error".
- Enforcement is by review + this ADR: any PR that makes an applicant→position/requisition link
  required is rejected on sight.
