# Business Decisions

The authoritative log of **approved business decisions** that shape the domain model.
Architectural decisions live in [ADRs](../03-decisions/README.md); this log records the
*business* rules the architecture must serve. Like ADRs, entries are **immutable** — a
decision is superseded by a new entry, never edited into something else. Implementation
work and future ADRs cite decisions by ID.

| ID | Decision | Resolves | Status | Date |
| --- | --- | --- | --- | --- |
| [BD-001](#bd-001--recruitment-is-requisition-driven) | Recruitment is requisition-driven | OQ-2 | ✅ Approved | 2026-07-09 |
| [BD-002](#bd-002--applicant-numbering-is-organization-wide) | Applicant numbering is organization-wide | OQ-3 | ✅ Approved | 2026-07-09 |
| [BD-003](#bd-003--one-shared-client-registry) | One shared Client Registry | OQ-4 | ✅ Approved | 2026-07-09 |
| [BD-004](#bd-004--multi-currency-ready-egp-first) | Multi-currency ready, EGP first | OQ-5 | ✅ Approved | 2026-07-09 |
| [BD-005](#bd-005--cash-and-gold-custody-shared-pattern-separate-entities) | Cash and gold custody: shared pattern, separate entities | OQ-6 | ✅ Approved | 2026-07-09 |
| [BD-006](#bd-006--one-capability-per-implementation-sprint) | One capability per implementation sprint | — (governance) | ✅ Approved | 2026-07-09 |
| [BD-007](#bd-007--timeline-authorization-degrades-gracefully) | Timeline authorization degrades gracefully | Sprint 3.2 plan §7 | ✅ Approved | 2026-07-09 |

*(OQ-1 — departments belong to branches — was answered earlier and is recorded in
[ADR-015](../03-decisions/ADR-015-single-organization-model.md).)*

---

## BD-001 — Recruitment is requisition-driven

**Resolves:** OQ-2 (raised in [Architecture Review 01 §5](../10-reviews/2026-07-architecture-review-01.md)).

**Decision:** Every applicant must apply against an **approved Job Requisition (vacancy)**.
The recruitment pipeline is:

> **Job Requisition → Applicant → Screening → Interview → Offer → Hiring → Employee**

**Business rules:**

1. A Job Requisition defines the position (job title), branch, headcount, and budget, and
   requires approval before applicants can be attached to it.
2. **No applicant can be hired without a Job Requisition.** Free-floating applicants do not
   exist in the model.
3. The requisition is the anchor aggregate of the pipeline: applicants inherit the position
   and branch context from the requisition they applied against.

**Consequences:** `hr_requisitions` becomes the anchor entity with its own approval
workflow (as anticipated in Review R10); the Recruitment entity catalog, relationships,
and vocabulary are updated accordingly. Detail design lands with the Recruitment module
(phase 2.3) — this decision fixes the model, not the implementation.

## BD-002 — Applicant numbering is organization-wide

**Resolves:** OQ-3.

**Decision:** Applicant numbers are unique across the **entire organization** and are not
branch-specific. Example: `APP-2026-000001`, `APP-2026-000002`.

**Consequences:** the Recruitment module's applicant sequence is declared at
**organization scope** (yearly reset per the established pattern `APP-{YYYY}-{seq:6}`).
Branch-scoped numbering remains available in the platform for counters that need it —
this decision applies to applicant numbers.

## BD-003 — One shared Client Registry

**Resolves:** OQ-4.

**Decision:** ECMS has a **single shared Client Registry**. The same Client entity is
reused by Cash Transportation, ATM Operations, Vault Custody, Gold Custody, Contracts,
and (future) Accounting.

**Business rules:**

1. Business modules **reference the shared Client entity** (by ID, via the platform query
   contract and events) — they never create their own customer records.
2. The Client Registry is owned by the **Client Agreements** bounded context; other
   contexts are read-only consumers.

**Consequences:** the shared-entities table in the [Domain Model](domain-model.md) lists
Client as a confirmed shared entity; duplicate "customer" concepts in any future module
design are a review reject.

## BD-004 — Multi-currency ready, EGP first

**Resolves:** OQ-5.

**Decision:** The platform must be **multi-currency ready**. Initial deployment operates in
**Egyptian Pounds (EGP)**, but the domain model and architecture must support multiple
currencies **without redesign**. Currency behavior is **configuration-driven**.

**Business rules:**

1. Every monetary amount in the domain is a **Money value object** — an amount bound to an
   explicit currency; bare numeric amounts are banned in domain artifacts.
2. Enabled currencies and the default currency (EGP) are configuration (settings), not code.
3. Amounts of different currencies never mix silently — denomination breakdowns, custody
   accounts, and billable events are per-currency.

**Consequences:** the Money value object joins the shared kernel when its first consumer
lands (the shared-kernel change is ADR-gated per the
[Bounded Contexts](bounded-contexts.md) rules); vault/CIT designs model per-currency
custody from day one.

## BD-005 — Cash and gold custody: shared pattern, separate entities

**Resolves:** OQ-6.

**Decision:** Cash Custody and Gold Custody share the **same custody pattern and workflow
concepts** (custody account, immutable movements, gapless accountable-custodian chain,
reconciliation counts) but are **separate business entities** — e.g. `CashCustody` and
`GoldCustody` — in separate bounded contexts.

**Business rules:**

1. Both reuse the platform workflow engine for their lifecycles.
2. Domain rules may diverge where the business differs (count-based cash vs weight/fineness
   gold, valuation, attestation requirements) without forcing a shared abstraction.
3. No shared custody base entity is created; the *pattern* is documentation, not code
   inheritance across contexts.

**Consequences:** the Vault Custody and Gold Custody contexts in the
[Domain Model](domain-model.md) remain separate with mirrored shapes; any future proposal
to unify them requires a new business decision.

## BD-006 — One capability per implementation sprint

**Type:** delivery governance (raised alongside the domain clarifications).

**Decision:** Every future implementation sprint stays focused on **exactly one
capability**. Multiple platform services are **not** combined into one implementation
sprint unless explicitly approved.

**Consequences:** the phase groupings in the vertical-slice plan (Architecture Review 01,
R2 — e.g. phase 2.2 = files + sequences + notifications + localization) remain the
*roadmap* structure, but each phase is **delivered as a series of single-capability
sprints** (e.g. Sprint 2.2.1 files, Sprint 2.2.2 sequences, …), each with its own PR and
review gate. Sprint plans citing this rule appear in [ECMS-BOOK §4](../../ECMS-BOOK.md).

## BD-007 — Timeline authorization degrades gracefully

**Resolves:** the decision flagged for review in the
[Sprint 3.2 plan §7](../12-planning/sprint-3.2-plan.md) (entity Timeline endpoint).

**Decision:** The Timeline endpoint returns **only the information the current user is
authorized to see**. It does **not** require both `auditLog.view` and `activityLog.view`.

**Business rules:**

1. `activityLog.view` only → the activity timeline only.
2. `auditLog.view` only → the audit timeline only.
3. Both permissions → the merged timeline.
4. Neither permission → the request is denied (and the denial audited, as all 403s are).

**Consequences:** least-privilege access is preserved — a composite *view* never demands
more permission than the streams it exposes, and never widens access beyond each stream's
own gate. Data-scope checks (`own | branch | organization`) continue to apply per stream
exactly as on the underlying list endpoints. This is the model for any future composite
read endpoint: degrade to the authorized subset rather than gate on the union of
permissions.
