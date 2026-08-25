# Architecture Decision Records (ADRs)

Every significant architectural decision is recorded here: the context, the decision, the
alternatives rejected, and the consequences we accept. ADRs are **immutable** — to change a
decision, write a new ADR that supersedes the old one.

**Format:** Status · Context · Decision · Alternatives considered · Consequences.
**Numbering:** sequential, never reused.

| ADR | Title | Status |
|---|---|---|
| [ADR-001](ADR-001-modular-monolith.md) | Modular monolith on a platform kernel | Accepted |
| [ADR-002](ADR-002-monorepo.md) | Monorepo with npm workspaces | Accepted |
| [ADR-003](ADR-003-layered-feature-architecture.md) | Feature-based structure with Controller → Service → Repository layers | Accepted |
| [ADR-004](ADR-004-permission-based-authorization.md) | Permission-based authorization (roles are only bundles) | Accepted |
| [ADR-005](ADR-005-mongodb-mongoose.md) | MongoDB + Mongoose with module-prefixed collections | Accepted |
| [ADR-006](ADR-006-jwt-refresh-tokens.md) | JWT access tokens + rotating refresh tokens with reuse detection | Accepted |
| [ADR-007](ADR-007-zod-validation.md) | Zod validation at every boundary; types inferred from schemas | Accepted |
| [ADR-008](ADR-008-event-bus.md) | Typed event bus + outbox for inter-module communication | Accepted |
| [ADR-009](ADR-009-bullmq-jobs.md) | BullMQ worker process for all long-running work | Accepted |
| [ADR-010](ADR-010-file-storage.md) | File metadata in MongoDB, binaries behind a StorageAdapter | Accepted |
| [ADR-011](ADR-011-workflow-engine.md) | Configurable workflow engine as data, not code | Accepted |
| [ADR-012](ADR-012-logging-audit.md) | Three log streams: audit, activity, system (Pino) | Accepted |
| [ADR-013](ADR-013-frontend-state.md) | TanStack Query for server state, Redux Toolkit for session/UI state | Accepted |
| [ADR-014](ADR-014-ocr-independent-service.md) | OCR as an independent, provider-pluggable service | Accepted |
| [ADR-015](ADR-015-single-organization-model.md) | Single-organization, multi-branch model (Branch is the primary scope) | Accepted |
| [ADR-016](ADR-016-optional-position-requisition-linkage.md) | Job Positions & Job Requisitions are OPTIONAL for applicants (Talent Pool) | Accepted, amended 2026-08-24 (P-ORG-1 merged Job Positions away; the requisition rule stands) |
| [ADR-017](ADR-017-platform-identity-and-access-control.md) | Platform Identity & Organizational Access Control (hierarchical scopes, employee-linked logins, branch-based employee code) | Accepted |
| [ADR-018](ADR-018-automation-engine.md) | A provider-backed Automation Service, alongside (not replacing) the Workflow Engine | Accepted |
| [ADR-019](ADR-019-reference-pickers-search-not-load-all.md) | Reference pickers search the server; they never load the whole catalog | Accepted |
| [ADR-020](ADR-020-shared-file-storage.md) | Shared file storage for a multi-service deployment (object store, not a local disk) | Accepted |
| [ADR-021](ADR-021-it-asset-custody-and-history.md) | IT asset custody is an append-only event chain, not a status field | Accepted |
| ADR-022 | Help-desk SLA & ticket lifecycle placement | **Reserved, unwritten** |
| [ADR-023](ADR-023-entity-derived-file-authorization.md) | File authorization is derived from the owning entity, not from the file | Accepted |
| [ADR-024](ADR-024-minimal-spare-parts-ledger.md) | The spare-parts ledger is a store record, not inventory accounting | Accepted |
| [ADR-025](ADR-025-sweep-announcement-marks.md) | Sweep announcements are marked in their own collection, not on the record | Accepted |
| [ADR-026](ADR-026-role-administration-guards.md) | Administering roles cannot exceed the administrator | Accepted |
| [ADR-027](ADR-027-external-identities.md) | People outside the company get ECMS accounts, confined to one surface | Accepted |
| [ADR-028](ADR-028-active-branch-narrowing.md) | One control in the command bar narrows the whole application to a branch | Accepted |
| [ADR-029](ADR-029-requisition-names-its-placement.md) | A Job Requisition names the placement it wants filled — there is no vacancy entity | Accepted |

ADR-001…014 were accepted with Milestone 1 approval (2026-07-08). ADR-015 records the
single-organization correction from [Architecture Review 01](../10-reviews/2026-07-architecture-review-01.md),
superseding the multi-company aspects of the Milestone 1 design. ADR-016 records the HR-Foundation
invariant that an applicant need not belong to any vacancy (the Talent Pool). ADR-017 records the
Platform-Identity foundation: hierarchical data scopes (Self→Company), employee-linked login accounts
(username-or-email), and the branch-based, globally-sequenced Employee Code. ADR-018 places the
Automation Service beside the Workflow Engine rather than in place of it. ADR-019 settles how a
picker reads a catalog — by searching it, never by loading it — and records the remaining
convert-to-search debt that the `pageSize` hotfix in PR #117 does not discharge. ADR-020 revisits the
one consequence ADR-010 accepted knowingly — that a local volume ties files to a single service —
which stopped holding when contract PDFs and evaluation-batch packages began being written by the
worker. **Accepted 2026-08-05**; the migration is designed in
[shared-file-storage-design.md](../12-planning/shared-file-storage-design.md) and is scheduled as a
platform sprint of its own, so the decision is settled while the implementation is still ahead.
ADR-021 records the IT custody chain delivered with slice IT-2 — an append-only business history
that is deliberately *not* the audit trail, because a record that settles a dispute must not inherit
a security log's retention policy. It carries the number the
[IT design](../12-planning/it-module-design.md) §14 reserved as 020 before that number was taken;
the module's remaining two ADRs shift to 022 and 023 with it. **ADR-022 is a deliberate, recorded
debt** — IT-3 shipped without it ([IT design](../12-planning/it-module-design.md) §13) — and the
number stays reserved rather than being reused, per the numbering rule above. ADR-023 settles that a
file's authorization comes from the entity it hangs off rather than from the file row. ADR-024 keeps
the spare-parts ledger a store record rather than inventory accounting. ADR-025 gives sweep
announcements a mark collection of their own, so idempotency does not become a flag inside a
business record. ADR-026 records the guards that had to exist before role administration could be
handed to a human: an administrator can neither put a permission into a role nor grant one at a
breadth they do not themselves hold, server-side and with no identity-based exemption. It also
writes down the department/section widening that ADR-017 §1 chose knowingly, which the roles screens
ADR-028 gives the shell the control the gold system had in its top bar and the port had left
behind: an account that sees the whole company can narrow itself to one branch, and the same choice
decides both what it reads and where a new document is filed. It narrows and never widens — the
caller's granted scope is the ceiling — which is why it is a preference rather than a permission.

ADR-027 is the platform's answer to a population it did not have: people who are not employees and
never will be. The gold vault's customers get ordinary ECMS accounts carrying an opaque
`externalSubject` back-reference — `employeeId` with its owner named — and are confined, before
authorization and by default-deny, to their own `/auth` self-service plus the single read surface
their module registered. It is written to be reused: a second module with external users of its own
writes one string.

now warn about but do not change. ADR-026 carries **three appendices** rather than spawning further
ADRs, because each refines a decision it already owns: SA-4 records that effective permissions are a
projection of the enforced answer and never a second authority; SA-5/SA-6 record what "the last
Super Admin" counts — accounts that can sign in, not assignment rows, a correction to the rule as
first shipped — together with the permission matrix's third row state for a key the registry has
forgotten; and SA-7 records the page layer, which groups permissions and **grants nothing**, and why
duplicating a role is a create through the ordinary endpoint rather than an endpoint of its own.
