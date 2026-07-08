# Architecture Review 01 — Pre-Milestone 2 Design Review

**Date:** 2026-07-08 · **Reviewer:** Chief Software Architect · **Scope:** the entire Milestone 1
design, reviewed against the corrected business context · **Status:** ⏳ Awaiting approval

## 0. Corrected business context

> ECMS is deployed for **one organization** operating **~6 branches**, with branch expansion
> expected. It is **not** a multi-tenant SaaS platform. It is a
> **Single-Organization, Multi-Branch Enterprise Platform.**

This review (a) corrects the design where it contradicts that model, (b) critically re-examines
every area — including reversing my own Milestone 1 decisions where they don't survive scrutiny —
and (c) proposes improvements with value, trade-offs, and a timing verdict for each.

**Verdict vocabulary:**
- **M2-core** — implement in Milestone 2 as part of the Platform Core.
- **With-first-consumer** — design is fixed now; build it when the first feature needs it.
- **Postpone** — deliberately not now; the design keeps the seam open.
- **Reject** — considered and declined, with reasons (recorded so it isn't re-litigated later).

---

## 1. Finding R1 — The multi-company model was over-engineering. Remove it. **(M2-core)**

**Self-critique:** Milestone 1 designed a multi-*company* platform (a `companies` collection,
`companyId` stamped on every business record, `company`-level scopes, company-scoped sequences
and settings). For one legal entity with six branches, that is speculative generality — the exact
sin the architecture principles prohibit. It taxes **every** query, index, unique constraint,
seed, test, and permission decision with a dimension that has exactly one value.

**Decision proposed:**

- Replace `companies` with a singleton **Organization** profile (identity, logo, legal data,
  fiscal settings). No `companyId` on business records.
- **Branch becomes the primary scoping unit.** Hierarchy: Organization (singleton) → Branch →
  Department → Section; Job Titles are organization-level catalogs.
- Data scopes collapse from `own | branch | company | all` to **`own | branch | organization`**
  (`company` and `all` were indistinguishable in a single-org world).
- Settings hierarchy becomes `user → branch → organization` (was 4 levels).
- Sequence scopes become `organization | branch` (branch-scoped numbering, e.g. per-branch
  applicant codes, remains supported).
- Unique constraints simplify: e.g. `ux_nationalId` (was `ux_nationalId_companyId`).
- Cross-branch entities (a department spanning branches? shared vaults?) must be checked with the
  business; the model assumes departments belong to branches — **open question OQ-1** below.

**Why valuable:** every record, index, and check gets simpler; the permission model becomes
explainable in one sentence; seeds and tests shed a combinatorial dimension.

**Trade-offs:** if EGYCASH later creates subsidiaries, reintroducing a legal-entity dimension is
a real migration (add field, backfill, re-scope). Mitigations that cost nothing now: (1) scope
enforcement stays centralized in BaseRepository — one place to extend; (2) the `organization`
scope name (not `all`) keeps the vocabulary ready for an outer level; (3) an ADR records the
re-expansion path. Carrying multi-company complexity for years "just in case" is the worse trade.

**Documents affected on approval:** database-design, er-diagrams, permission-matrix,
platform-core (§4 organization, §14 sequences, §5 settings), naming-conventions, module-hierarchy.
Recorded as **ADR-015** superseding the multi-company aspects of Milestone 1.

---

## 2. Finding R2 — Deliver the platform in vertical slices, not to full spec first. **(M2-core, process)**

**Self-critique:** Milestone 1 specifies 17 platform services. Building all of them to full
specification before any business feature ships is the classic platform trap: months of
infrastructure, zero user feedback, and services designed against imagined consumers.

**Decision proposed:** Milestone 2 builds the platform **to the depth Recruitment needs**, in
tier order, with each service's *contract* designed to full spec but its *implementation* scoped:

| Phase | Platform slice | Proves |
|---|---|---|
| 2.1 | kernel (module registry, event bus, unit-of-work) + auth + users + rbac + organization + audit + settings | login → permission → scoped data → audit trail |
| 2.2 | files + sequences + notifications (in-app + email) + localization | document handling end-to-end |
| 2.3 | workflow (v1 — see R7) + approvals (v1) | recruitment pipeline runs |
| 2.4 | search (v1) + dashboards (v1) + reports (v1) | operational visibility |
| — | integrations + ai/ocr | built inside 2.x where Recruitment consumes them (OCR in 2.2/2.3) |

**Why valuable:** feedback arrives months earlier; services are shaped by a real consumer;
delivery risk drops from one big bet to four small ones.
**Trade-offs:** some rework when the second consumer arrives (accepted — contracts are stable,
implementations grow); requires discipline not to let "v1" become "hack".

---

## 3. Findings by area

### 3.1 Platform Core

**R3 — Add a Scheduler service. (M2-core, phase 2.1)**
SLA timers, report schedules, escalation ticks, and retention jobs were each defined as ad-hoc
BullMQ repeatable jobs. That scatters cron expressions across services with no inventory, no
"what runs when" answer, no pause/run-now controls.
*Proposal:* a thin platform `scheduler` service: modules/services declare scheduled tasks
(manifest or registration API); one registry collection; one admin view; BullMQ repeatable jobs
remain the executor.
*Trade-offs:* one more small service; pure win otherwise — it is a registry, not an engine.

**R4 — Add a Document Generation service (templated documents). (With-first-consumer: Offers)**
The Reports Engine renders *reports*; nothing renders *transactional documents* — offer letters,
HR forms, custody receipts — from admin-editable templates with variables, in Arabic. This
company will need printed, signed documents constantly.
*Proposal:* platform `documents` service: localized templates (HTML → PDF via the existing
worker/Chromium path), variable schema per template (Zod), output stored via `files`, generation
audited. First consumer: offer letters.
*Trade-offs:* Arabic PDF typography needs real testing (font embedding, RTL); template governance
(who edits) rides on existing permissions.

**R5 — Add an Import/Export framework. (With-first-consumer)**
Enterprises live on Excel. Initial data loads (org structure, job titles, document types) and
bulk applicant import will be demanded on day one of UAT; without a framework, every feature
hand-rolls CSV parsing with inconsistent validation.
*Proposal:* platform `imports` service: file upload → staged parse → row-level Zod validation →
error report (downloadable) → confirm → execute via the feature's service layer (so audit,
events, and rules apply). Export = existing `export` permissions + worker-generated files.
*Trade-offs:* real engineering cost; deferring the *framework* is fine but deferring *validation
discipline* is not — hence design fixed now, built with the first bulk need.

**R6 — Add a Business Calendar service. (With-first-consumer: workflow SLA phase)**
SLA timers defined in hours are wrong in practice: a 24-hour approval SLA that spans Friday +
a public holiday is a broken promise. Egyptian working weeks (Fri/Sat weekends), branch working
hours, and public holidays must inform SLA and escalation math — and later, HR attendance.
*Proposal:* platform `calendar` service: working-week pattern + holiday calendar (organization
level, branch overrides); the workflow engine computes SLA deadlines in *working time*.
*Trade-offs:* small service, subtle date math (test-heavy); implement when SLA timers land (2.3+),
but the workflow schema gains `sla.calendar: boolean` now so definitions don't migrate later.

**R7 — Custom (user-defined) fields: postpone, but reserve the seam. (Postpone)**
ServiceNow/Dynamics-class platforms allow admins to add fields to entities. Powerful, and
enormously expensive: dynamic validation, index management, search integration, report columns,
permission-per-field. Not justified at 6 branches with an in-house dev team that can add real
fields quickly.
*Proposal:* do not build it. Reserve `customFields: {}` (schema-off map) on major business
entities and record the constraint that no code may ever depend on its contents. Revisit via ADR
if the business demands admin-defined fields.

### 3.2 Domain Model

**R8 — Standardize value objects in `packages/contracts`. (M2-core, phase 2.1)**
Milestone 1 left `PersonName`, `Address`, `PhoneNumber` (Egyptian formats), `NationalId`
(14-digit structure + embedded birth date/governorate validation), and `Money` (future) as
per-feature details. That guarantees drift between Applicant, future Employee, and Users.
*Proposal:* one Zod schema per value object in `contracts/common`, reused everywhere; the
NationalId validator becomes the single implementation used by OCR verification and manual entry.
*Trade-offs:* none worth naming; this is cheap and compounding.

**R9 — A `Party`/person abstraction: reject for now. (Reject)**
Classic enterprise move (SAP Business Partner): one Person record behind Applicant/Employee/User.
Rejected because it front-loads the hardest identity questions (matching, merging, lifecycle)
before the second consumer even exists. R8's shared value objects + the national ID as a natural
correlation key give us convergence later without the abstraction now. Recorded so it is
re-evaluated deliberately when the `employees` sub-module is designed — that ADR must state how
Applicant→Employee identity carries over.

**R10 — Open question: should Recruitment be requisition-driven? (OQ-2, business decision)**
The Milestone 1 recruitment model lets applicants exist free-floating; real enterprise recruiting
is usually driven by an approved **Job Requisition / Vacancy** (position, headcount, budget
approval) that applicants apply against. This changes the recruitment domain model materially and
is a *business* decision, not an architectural one. **Needs an answer before phase 2.3 detail
design.** If yes: `hr_requisitions` becomes the anchor entity with its own approval workflow.

### 3.3 Organization Structure

**R11 — Org units need managers (and the approver resolution depends on it). (M2-core, phase 2.1)**
**Gap found:** the Approval Engine defines an `orgManager` approver type, but no org entity has a
manager. The design referenced a concept it never modeled.
*Proposal:* `managerId` (userId) on Branch/Department/Section, plus an acting-manager delegation
window (from/to dates). Approver resolution walks up the unit tree when a unit has no manager.
*Trade-offs:* none; this closes an internal inconsistency.

**R12 — Keep the fixed hierarchy; reject a generic org-unit tree. (Reject)**
A generic `org_units` tree (arbitrary depth/types) is more flexible and much harder to reason
about (every query becomes tree-walking; UI becomes abstract). The business states its structure:
Branch → Department → Section. Keep it fixed; the materialized-path field already present makes a
future migration to a generic tree mechanical if ever needed.

### 3.4 Security

**R13 — TOTP 2FA for privileged roles in M2, not "future". (M2-core, phase 2.1)**
Milestone 1 deferred 2FA. For a cash-logistics company, an admin account takeover is a physical
security event, not an IT event. The login pipeline was already designed with a 2FA step slot —
the marginal cost now is small.
*Proposal:* TOTP enrollment + verification; **enforced** for Super Admin/Platform Admin and any
role holding break-glass permissions; optional for others (settings-controlled).
*Trade-offs:* recovery flows (backup codes, admin reset with audit) must be designed — that is
most of the work; accepted.

**R14 — Time-bound role assignments. (M2-core, phase 2.1)**
Enterprises constantly grant temporary access (coverage during leave, auditors, contractors) and
then forget to revoke it.
*Proposal:* `validFrom` / `validTo` on `role_assignments`; expiry enforced at permission-set
computation; expiring-soon report via the scheduler. Also gives R11's acting-manager windows a
uniform pattern.
*Trade-offs:* permission cache invalidation must respect time boundaries (invalidate at expiry) —
minor; the scheduler (R3) handles it.

**R15 — Define DR targets now (RPO/RPO are business promises, not ops details). (M2-core, paper)**
Milestone 1 said "backups + PITR" without targets.
*Proposal:* commit to explicit **RPO ≤ 15 min (PITR)**, **RTO ≤ 4 hours** initially, documented in
the deployment strategy with the restore-drill calendar, and revisit as operations mature. File
storage (Railway volume) is currently the weakest link — its snapshot cadence must be stated
honestly next to the Mongo numbers, which further motivates the cloud storage adapter's priority.
*Trade-offs:* none — writing down a number we can meet beats implying one we can't.

**R16 — Deny-rules in permissions: reject. (Reject)**
Considered adding explicit deny entries (grant minus deny). Rejected: deny semantics make
effective-permission reasoning and caching dramatically harder to explain and audit. The model
stays **grant-only, deny-by-default**. Narrowing is done by *not granting* or by scope.

### 3.5 Permissions

**R17 — Standardize record assignment for the `own` scope. (M2-core, phase 2.1)**
**Gap found:** the `own` scope says "records the user created or is assigned to", but *assignment*
was never modeled. Each feature would have invented its own `assignedTo`.
*Proposal:* a standard `assignees: [{ userId, role: 'owner'|'assignee'|'watcher', at }]` field
convention on assignable entities, honored by BaseRepository's `own`-scope filter and by the
notifications service ("notify watchers").
*Trade-offs:* none; prevents N divergent implementations.

**R18 — Generate the Permission Matrix doc from the code catalog. (M2-core, tooling)**
The hand-maintained matrix in docs will drift from `contracts/permissions` within a month.
*Proposal:* a `scripts/gen-permission-matrix` script renders the doc table from the catalog; CI
fails if the committed doc is stale. Same pattern later for the error-code catalog.
*Trade-offs:* small script to maintain — vastly cheaper than doc rot.

### 3.6 Workflow Engine

**R19 — Phase the engine; v1 is deliberately smaller. (M2-core, phase 2.3)**
**Self-critique:** ADR-011's engine (guards, actions, SLA, approvals, versioning) is the most
complex platform piece, and building it fully before the first workflow runs is risk-stacking.
*Proposal:* **v1** = states, transitions, permission guards, transition history, definition
versioning, `platform.workflow.transitioned` events. **v1.1** = declarative field guards +
notify/assign actions. **v1.2** = approval-chain integration. **v1.3** = SLA timers on the
business calendar (R6). Recruitment can go live on v1.2; the *schema* for all phases is fixed now
so definitions never migrate.
*Trade-offs:* early recruitment iterations hard-wire fewer conveniences; acceptable.

**R20 — Validate definitions at save time. (M2-core, with workflow v1)**
Admin-editable state machines invite unreachable states, dead ends, and transitions referencing
deleted states.
*Proposal:* structural validation on save/activation: reachability from initial state, at least
one terminal state, referenced permissions/chains/templates exist, no duplicate transition keys.
Activation is a separate, permission-gated step (`workflowDefinition.activate` already exists).
*Trade-offs:* none; it's a pure-function check with unit tests.

**R21 — Parallel/sub-states, per-branch workflow variants: postpone. (Postpone)**
Single current-state machines cover recruitment and the known near-term processes. Parallel
tracks (e.g., simultaneous security clearance + medical check) will eventually be requested;
the honest answer today is *checklist-within-a-state* (as hiring documents already do) rather
than engine complexity. Revisit with a concrete process that truly needs it. Per-branch variants
are one org's premature configurability — a definition per process is enough for 6 branches.

### 3.7 Event System

**R22 — Version event payloads from day one. (M2-core, phase 2.1)**
**Gap found:** events had names and payload types but no evolution story; in a 10-year system,
`hr.applicant.hired` v1 consumers will meet v2 payloads.
*Proposal:* every event envelope carries `schemaVersion`; payload schemas in `contracts/events`
are Zod-versioned; consumers are tolerant readers (ignore unknown fields — enforced by using
non-strict Zod parsing for events, unlike API input). Breaking payload changes require a new
version constant and a deprecation window.
*Trade-offs:* tiny ceremony per event; trivial next to the alternative.

**R23 — Event sourcing / CQRS: reject. (Reject)**
The audit log already gives us history; the outbox gives reliable delivery; read models are
denormalized fields updated by events where needed. Full event sourcing would revolutionize
storage, testing, and onboarding for no requirement we have. Recorded to prevent re-litigating.

### 3.8 Integration Layer

**R24 — Endorsed with one addition: connector health surface. (With-first-consumer: OCR)**
The connector registry design stands. Add per-connector health (last success, error rate, circuit
state) exposed on the ops dashboard, because the first connector (OCR) sits directly in a
user-facing flow and "OCR is down" must be visible before users report it.
*Trade-offs:* none meaningful.

### 3.9 Module Registry

**R25 — Manifests declare platform compatibility. (M2-core, phase 2.1)**
**Gap found:** module manifests are versioned, but nothing states which platform version a module
requires — the first upgrade where a platform contract changes will break silently.
*Proposal:* `requiresPlatform: '^2.0'` (semver range) in every manifest; the kernel refuses to
mount incompatible modules at boot. The platform itself gets an explicit version constant bumped
by ADR-governed contract changes.
*Trade-offs:* one field + one check now; discipline later.

**R26 — Derive frontend manifest data from shared contracts. (M2-core, phase 2.2)**
Backend and frontend manifests currently duplicate navigation/permission/route metadata — two
files to keep in sync per module.
*Proposal:* the shareable parts (route paths, permission keys, nav labels/icons as data) live in
`packages/contracts/modules/<id>/manifest.ts`; backend and frontend manifests import and extend
it with their side-specific pieces (handlers vs components).
*Trade-offs:* contracts package grows; the drift it kills is worth it.

### 3.10 Feature Flags — **missing entirely from Milestone 1**

**R27 — Add a lightweight feature-flag facility on the settings service. (M2-core, phase 2.1)**
**Gap found:** no way to ship dark, run a pilot branch, or kill a risky feature without deploying.
For a 6-branch rollout, "enable OCR intake for Branch Cairo-1 first" is exactly how releases will
be run.
*Proposal:* flags are **declared in code** (key, description, default, owner, expiry date) and
evaluated through the settings hierarchy (organization → branch → user), cached like settings,
exposed to the frontend via the session bootstrap. A flag past its expiry date fails CI — flags
are temporary by construction.
*Trade-offs:* flag debt is real; the expiry-date gate is the mitigation. No third-party flag
service — settings already provide storage, scoping, and cache.

### 3.11 Licensing — **assessed, mostly not applicable**

**R28 — No commercial licensing engine; keep module entitlements as deployment config. (Postpone)**
ECMS is an internal platform for one organization, not a sold product. A licensing/entitlement
engine (seats, module SKUs, expiry) would be pure speculation. The existing per-deployment
module enable/disable config **is** the entitlement seam; if EGYCASH ever productizes ECMS,
licensing becomes an ADR that plugs into the module registry (the right shape already exists).
*Trade-off of postponing:* none today; recorded so the question has a documented answer.

### 3.12 Business Rules

**R29 — Rules-as-code with a naming convention; reject a rules engine. (M2-core, convention)**
The listed area "Business Rules" deserves an explicit stance. Generic rules engines (Drools-like,
or admin-editable expression trees beyond workflow guards) trade compile-time safety for
configurability nobody asked for.
*Proposal:* business rules live in services as **named, unit-tested functions** with a
`rules/` sub-folder convention inside a feature when they grow
(`applicant.rules.ts: canBeHired(applicant): RuleResult`), returning structured results
(`{ ok, code, message }`) that map to the `BUSINESS_RULE_VIOLATION` error family. Workflow
declarative guards remain the *only* admin-configurable rule surface.
*Trade-offs:* rule changes require deploys — that is a feature (review + tests + audit trail via git).

### 3.13 Scalability & Performance

**R30 — Right-size expectations; add the two genuinely missing pieces. (M2-core)**
Honest assessment: at one organization, 6 branches, likely low-hundreds of users, the designed
architecture is *ample* — the scalability risks here are organizational, not computational.
Two real gaps:
1. **Socket.IO Redis adapter** must be part of the design (not an afterthought) since the API is
   declared horizontally scalable — without it, multi-replica deployments silently break rooms.
2. **Slow-query telemetry:** Mongoose debug + slow-op logging thresholds in staging/production,
   feeding the metrics endpoint, so index gaps surface before users feel them.
Everything heavier (sharding, CQRS read stores, search cluster) is rejected as premature and
already has designed seams.

### 3.14 Maintainability & Developer Experience

**R31 — Error tracking (Sentry or equivalent) from the first deploy. (M2-core, phase 2.1)**
**Gap found:** observability listed logs/metrics/alerts but no exception aggregation. Pino logs
are not how a 20-developer team triages production errors.
*Proposal:* Sentry (or self-hosted GlitchTip) wired into api, worker, and web (source maps),
with `requestId` correlation and release tagging from CI.
*Trade-offs:* third-party dependency + PII scrubbing config required (reuse the Pino redaction
path list).

**R32 — DX niceties bundled into the dev stack. (M2-core, cheap)**
Add to docker-compose/dev scripts: **Mailpit** (local email preview — the notifications service is
untestable locally without it), **bull-board** mounted on a dev/admin route (queue visibility),
and a **devcontainer** definition so onboarding is one click. Storybook for `shared/ui`:
**postpone** until the UI kit stabilizes (maintaining stories for churning components is waste).

---

## 4. Consolidated recommendation table

| # | Recommendation | Area | Verdict |
|---|---|---|---|
| R1 | Single-organization model; Branch as primary scope; scopes `own/branch/organization` | Org / everything | **M2-core** (ADR-015) |
| R2 | Vertical-slice delivery of the platform (phases 2.1–2.4) | Process | **M2-core** |
| R3 | Scheduler service (scheduled-task registry) | Platform Core | **M2-core** |
| R4 | Document Generation service (templated PDFs, Arabic) | Platform Core | With-first-consumer (Offers) |
| R5 | Import/Export framework (staged, validated) | Platform Core | With-first-consumer |
| R6 | Business Calendar service; SLA in working time | Platform Core / Workflow | With-first-consumer (SLA phase) |
| R7 | Custom fields | Platform Core | Postpone (reserve `customFields`) |
| R8 | Shared value objects (`NationalId`, `PhoneNumber`, `Address`, `PersonName`) | Domain Model | **M2-core** |
| R9 | Party/person abstraction | Domain Model | Reject (revisit at `employees` design) |
| R10 | Requisition-driven recruitment? | Domain Model | **Open question OQ-2 — business decision** |
| R11 | Managers on org units + acting-manager windows | Organization | **M2-core** |
| R12 | Generic org-unit tree | Organization | Reject |
| R13 | TOTP 2FA enforced for privileged roles | Security | **M2-core** |
| R14 | Time-bound role assignments (`validFrom/validTo`) | Permissions | **M2-core** |
| R15 | Explicit RPO/RTO targets + file-storage honesty | Security/Ops | **M2-core** (docs) |
| R16 | Deny-rules in permissions | Permissions | Reject |
| R17 | Standard `assignees` convention backing the `own` scope | Permissions | **M2-core** |
| R18 | Generate permission-matrix doc from code catalog (CI-checked) | Permissions/DX | **M2-core** |
| R19 | Workflow engine phased v1 → v1.3 (schema fixed now) | Workflow | **M2-core** |
| R20 | Workflow definition validation at save/activation | Workflow | **M2-core** |
| R21 | Parallel states, per-branch workflow variants | Workflow | Postpone |
| R22 | Event payload `schemaVersion` + tolerant readers | Events | **M2-core** |
| R23 | Event sourcing / CQRS | Events | Reject |
| R24 | Connector health surface (OCR first) | Integrations | With-first-consumer |
| R25 | `requiresPlatform` compatibility range in manifests | Module Registry | **M2-core** |
| R26 | Shared manifest metadata in `contracts` (kill FE/BE drift) | Module Registry | **M2-core** |
| R27 | Feature flags on the settings hierarchy, with expiry-gated CI | Feature Flags | **M2-core** |
| R28 | Licensing engine | Licensing | Postpone (module-enable config is the seam) |
| R29 | Rules-as-code convention; no rules engine | Business Rules | **M2-core** (convention) / Reject (engine) |
| R30 | Socket.IO Redis adapter + slow-query telemetry; reject heavier scaling work | Scalability/Perf | **M2-core** |
| R31 | Error tracking (Sentry-class) across api/worker/web | Maintainability | **M2-core** |
| R32 | Mailpit, bull-board, devcontainer; Storybook later | DX | **M2-core** (Storybook: postpone) |

## 5. Open questions for the business (blocking noted phases)

| ID | Question | Blocks |
|---|---|---|
| **OQ-1** | Do departments/sections always belong to a branch, or can they span branches (e.g., a central HR department)? | R1 detail design (phase 2.1) |
| **OQ-2** | Should recruitment be driven by approved Job Requisitions/Vacancies, or remain applicant-first? | Recruitment detail design (phase 2.3) |
| **OQ-3** | Confirm branch-scoped vs organization-scoped applicant numbering (affects sequence seeds). | Phase 2.2 |

## 6. What was reviewed and stands unchanged

For completeness — these were re-examined, challenged, and endorsed: modular monolith (ADR-001),
monorepo (ADR-002), layer/feature shape (ADR-003), permission-based authorization (ADR-004 —
amended only by R1's scope rename and R14/R17), MongoDB conventions (ADR-005 — minus `companyId`),
token design (ADR-006 — extended by R13), Zod-first validation (ADR-007), event bus + outbox
(ADR-008 — extended by R22), BullMQ worker split (ADR-009), file storage adapter (ADR-010 —
urgency of the cloud adapter raised by R15), audit streams (ADR-012), frontend state split
(ADR-013), OCR independence (ADR-014).

---

## 7. On approval

1. Record **ADR-015 (single-organization model)** and mark ADR-001…014 **Accepted** (with noted
   amendments).
2. Update the affected Milestone 1 documents per R1 and fold the accepted R-items into the
   Platform Core, security, workflow, and standards documents.
3. Re-plan Milestone 2 as phases 2.1–2.4 (R2), and obtain answers to OQ-1…OQ-3.

**Stopping here. No documents beyond this review have been changed; nothing has been implemented.
Awaiting approval and the open-question answers.**
