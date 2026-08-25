# ADR-029: A Job Requisition names the placement it wants filled — there is no vacancy entity

**Status:** Accepted · **Date:** 2026-08-25 · **Relates to:**
[ADR-016](ADR-016-optional-position-requisition-linkage.md) (Talent Pool — the link stays optional),
[ADR-015](ADR-015-single-organization-model.md) (organization model),
[job-positions-merge-design](../12-planning/job-positions-merge-design.md) (P-ORG-1),
[job-requisition-design](../12-planning/job-requisition-design.md) (the design this settles the spine of)

## Context

Job Requisitions were specified in Sprint 4.1 as a hiring request raised **against a Job Position** —
an approved seat owned by a department. P-ORG-1 removed Job Positions on 2026-08-24: the entity
carried five fields to the Job Title's twelve, none of them headcount or budget, and in the code it
did two things, both of which the placement already did for itself.

That leaves the requisition phase, still unbuilt, without the thing it was defined against. The
question is not cosmetic: whatever a requisition points at is what approvals route on, what
fulfilment counts against, and what a report groups by.

There is a strong pull toward reintroducing the seat under a new name — "vacancy", "establishment
line", "approved post" — because a request naturally reads as being *for* something. The pull should
be resisted, and this ADR is where that is written down.

## Decision

**A Job Requisition carries the placement it wants filled. It references no vacancy, seat, post or
establishment record, under any name.**

- The placement on the requisition is `jobTitleId` + `departmentId` + `branchId`, with an optional
  `sectionId` — the same shape `PlacementSchema` and `OfferTerms` already carry, so the requisition
  becomes the *source* of that tuple rather than a pointer to a record holding it.
- `quantity` lives on the request. A requisition is filled progressively and closes when the count
  is reached; partial fulfilment is a first-class state, not an exception.
- Fulfilment is **derived, never counted by hand**: one link record per `(requisition, applicant)`
  under a unique index, written by a consumer of `hr.applicant.hired`. The requisition listens; it
  never writes workflow state back (I15).
- Approval is two fixed steps — the department's effective manager, then HR. The department on the
  requisition is what makes step one addressable at all.
- **ADR-016 is unchanged and still governs**: an applicant's link to a requisition is optional
  forever, and the direct/Talent-Pool intake path stays first-class. A validator may refuse a link
  to a requisition that is cancelled, filled or not yet approved — that constrains *which* link is
  valid, never *whether* a link is required.
- **No headcount and no budget.** Neither is modelled, derived or displayed by this phase.

## Alternatives considered

- **Revive the seat as the requisition's target.** Rejected: this is P-ORG-1 in reverse. The seat was
  removed because it duplicated the placement, and reintroducing it as a request target restores the
  duplication plus the two questions nobody answered — who opens a seat, and who closes it when its
  holder resigns.
- **Raise the requisition against a Job Title alone.** Rejected: "Driver" exists in many departments.
  A request with no department cannot be routed to an approver, cannot be scoped to a reader, and
  cannot be attributed to a cost owner later.
- **Two status axes (approval status × fulfilment status).** Rejected: it permits states that mean
  nothing — a requisition "filled" that was never approved. One chain
  (`draft → pendingManager → pendingHr → open → partiallyFilled → filled`, beside `rejected`,
  `cancelled`, `closed`) says the same thing without the impossible corners.
- **Model authorized headcount now, so requisitions can be validated against it.** Rejected as
  inventing a rule: who authorizes a headcount, for what period, and against what budget are business
  decisions nobody in this system has made. A number invented here would be enforced on real hiring.

## Consequences

- ✅ No new master entity. The requisition is a record with a lifecycle, and the organization model
  stays Company → Branch → Department → Section, plus the org-wide Job Titles catalog.
- ✅ The recruitment pipeline needs no new stage: `applicant.jobRequisitionId` already exists and is
  already copied onto the employee at hire, so the link's data path is in place before the module is.
- ✅ Scoping works from day one — the requisition carries `departmentId`, so its repository declares
  both `branchField` and `departmentField` and a department-scoped reader is actually narrowed.
- ⚠️ Reporting "vacant positions" is not answerable as a stock. What this system can answer is
  "open requisitions and how much of each is unfilled" — a flow. If the business ever wants the
  stock, that is the headcount decision (D-REQ-8), taken on its own evidence.
- ⚠️ A requisition edited after approval re-enters approval when it raises quantity or changes the
  placement. That is deliberate friction: what a manager approved was *this number for this job*.
- Enforcement is by review and this ADR: any PR introducing a seat/vacancy/post entity, or making an
  applicant→requisition link mandatory, is rejected on sight.
