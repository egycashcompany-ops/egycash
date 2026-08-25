# ADR-016: Job Positions and Job Requisitions are OPTIONAL for applicants (Talent Pool)

**Status:** Accepted, amended · **Date:** 2026-07-21 · **Amended:** 2026-08-24 (P-ORG-1)
· **Relates to:**
[ADR-015](ADR-015-single-organization-model.md) (organization model),
[recruitment-applicants](../02-architecture/recruitment-applicants.md),
[job-positions-merge-design](../12-planning/job-positions-merge-design.md) (P-ORG-1)

## Amendment — 2026-08-24: half of this ADR's subject no longer exists

P-ORG-1 merged Job Positions into Job Titles (PR #296, merge `d7a8ac7`). There is **one** job
concept in this system now — the Job Title — and where a job sits is the placement's business:
`departmentId`, `sectionId` and `branchId` live on the record itself.

This ADR was written assuming Job Positions were a capability still to come. They arrived, thin,
and then went: the entity carried five fields to the Job Title's twelve — no code, no grade, no
salary band, and, despite the name, no headcount and no budget. The parenthesis in the Context
below describes what a Job Position was expected to become, never what it was.

**Void with this amendment:** the clause reserving a future `applicant.jobPositionId`. There is no
concept for it to point at, so there is no link to keep optional.

**Unchanged — and this is the half that carries the decision:** `applicant.jobRequisitionId` stays
OPTIONAL, the Talent Pool stays a natural state rather than a special case, and both entry paths
stay first-class. The merge is the far end of the same principle this ADR states: an applicant's
link to a vacancy is optional forever, and after P-ORG-1 there is no vacancy entity at all. The Job
Requisition half is untouched — the reference is still a nullable id, and the Requisition module
itself is still unbuilt (`applicants/requisition-ref.ts` holds the seam that defers it).

**Stored data:** nothing unsets the `jobPositionId` values old documents may carry. The schemas
that named the path are gone, so a leftover value is never read, never written and never reported —
which is why no migration was written to chase it.

## Context

The HR Foundation introduces an organization structure (Company → Branch → Department → Section,
plus the org-wide **Job Titles** catalog) and — in later phases — **Job Positions** (approved,
budgeted headcount at a location) and **Job Requisitions** (a hiring request against a position).
*Written 2026-07-21. Job Positions were later built and then removed — see the amendment above.*

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
- ~~A future `applicant.jobPositionId` (when Job Positions land) **is OPTIONAL** (nullable) as
  well.~~ **Void — P-ORG-1, 2026-08-24.** Job Positions no longer exist, so the field never will.
- Applicants **may remain in the Talent Pool indefinitely** with neither link set.
- No module may design a query, screen, workflow, report, validation, or index that **assumes**
  every applicant belongs to a Job Position or Job Requisition. "Belongs to a vacancy" is a
  filter, never a precondition.
- Both recruitment **entry paths** are first-class and must stay so:
  1. **From a Job Requisition** — the standard, requisition-driven hire.
  2. **Direct / Talent Pool** — a walk-in applicant with no requisition and no position.

This rule is a **cross-module invariant**: Job Requisitions and any future module that touches
applicants inherit it. (Job Positions were named here too, and inherited it until they were merged
away.)

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
- ~~✅ Job Positions can report occupied/vacant headcount without depending on applicants being
  linked.~~ **Void — P-ORG-1.** No entity reports headcount; the one that was supposed to never
  carried the field.
- ⚠️ Occupancy/vacancy analytics must treat unlinked applicants as "pool", not "unassigned error".
- Enforcement is by review + this ADR: any PR that makes an applicant→requisition link required is
  rejected on sight.
