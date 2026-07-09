# Domain Model

The complete business domain of ECMS, modeled **before** further implementation
(Phase 2.5). This document catalogs every core entity per bounded context, its type
(aggregate root · entity · value object), its responsibility, and its key invariants —
at the **domain level only**. Storage schemas live in
[Database Design](../05-database/database-design.md); APIs in
[API Standards](../04-standards/api-standards.md); neither is repeated here.

Companion documents: [Bounded Contexts](bounded-contexts.md) ·
[Entity Relationships](entity-relationships.md) ·
[Ubiquitous Language](ubiquitous-language.md).

---

## 1. Subdomain classification

| Subdomain | Type | Why |
| --- | --- | --- |
| Cash Transportation, Vault Custody, ATM Operations, Gold Custody | **Core** | EGYCASH's differentiating business: moving, storing, and accounting for physical value under chain-of-custody discipline |
| Recruitment / Employment (HR), Fleet, Client Agreements, Physical Security | **Supporting** | Necessary for operations, not differentiating; commercial products exist but must obey our custody/audit constraints |
| Finance, Administration, IT Service | **Supporting** | Internal enablement; integrates with external systems (GL) |
| Identity & Access, Organization, Documents, Process, Communication, Accountability, Configuration, Automation & Integration, Insight | **Generic** (Platform Core) | Enterprise plumbing built once, consumed by every module |

**Modeling principles** (inherited from the accepted ADRs — not re-decided here):

1. **One aggregate per feature** (Module Structure §6): a feature owns exactly one aggregate
   root; needing a second root means two features.
2. **No shared person abstraction** (Review R9 — rejected `Party`): Applicant, Employee, and
   User are distinct entities in distinct contexts; the **National ID** value object is the
   natural correlation key between them.
3. **Lifecycles are workflow-owned** (ADR-011): stage/status progressions of business
   aggregates are workflow definitions (data), not domain code; the domain model names the
   lifecycle but does not hard-code its states.
4. **Branch is the primary scoping dimension** (ADR-015): business aggregates belong to a
   branch; the Organization is a singleton.
5. **Cross-context knowledge travels by ID + denormalized display fields** (ADR-008), never
   by object reference.

---

## 2. Generic contexts (Platform Core)

### 2.1 Identity & Access

| Entity | Type | Responsibility | Key invariants |
| --- | --- | --- | --- |
| **User** | Aggregate root | A person's account: identity, credentials reference, locale, organizational placement, security state | Email unique among live users; lifecycle `invited → active ⇄ suspended → archived`, archived is terminal; never hard-deleted (audit integrity) |
| Session | Entity (child of User) | One device's authenticated presence; a rotation family of refresh credentials | Replay of a rotated credential revokes the whole family; revocation is immediate and audited |
| **Role** | Aggregate root | An admin-managed bundle of permissions | May only bundle registered permissions; protected system roles are immutable via API |
| Permission | Reference entity | A code-declared capability `<resource>.<action>` | Registry mirrors code exactly — the DB never invents permissions |
| Role Assignment | Entity | Grant of a Role to a User at a data scope, optionally time-bound | Scope ∈ `own · branch · organization`; expiry takes effect at permission computation, not by cleanup; branch scope requires the user to have a home branch |

*A User is **not** an employee* — the future Employee entity references a User; the platform
stays business-agnostic (Platform Core §2).

### 2.2 Organization

| Entity | Type | Responsibility | Key invariants |
| --- | --- | --- | --- |
| **Organization** | Aggregate root (singleton) | EGYCASH's legal/fiscal identity | Exactly one exists (ADR-015) |
| **Branch** | Aggregate root | A physical/operational site; the primary scoping unit | Unique code; cannot be deleted while departments exist |
| **Department** | Aggregate root | Functional unit within one branch | Belongs to exactly one active branch (OQ-1 answered in ADR-015); cannot be deleted while sections exist |
| **Section** | Aggregate root | Sub-unit of a department | Belongs to exactly one department; inherits the branch |
| **Job Title** | Aggregate root | Organization-level catalog of positions | Unique code; no hierarchy of its own |
| Acting Manager window | Value object | Time-boxed delegation of a unit's management (Review R11) | `from < to`; effective manager = acting manager inside the window, else the unit manager |

### 2.3 Configuration

| Entity | Type | Responsibility | Key invariants |
| --- | --- | --- | --- |
| Setting Declaration | Reference entity (code-owned) | A typed, documented configuration point | Unknown keys are rejected; allowed scopes declared per key |
| Setting Value | Entity | An override at one hierarchy level | Resolution `user → branch → organization → default` |
| Feature Flag | Reference entity (code-owned) | A temporary, expiring toggle evaluated on the settings hierarchy (Review R27) | Carries owner + expiry; an expired flag fails CI |

### 2.4 Accountability

| Entity | Type | Responsibility | Key invariants |
| --- | --- | --- | --- |
| Audit Record | Immutable fact | Who changed what, when, from where — field-level old/new | Append-only; loss is alarmed; never blocks the business operation |
| Activity Record | Immutable fact | Human-readable timeline entry for an entity | Localized message key + params, never raw prose |

Every business aggregate's **timeline is a view** merging its activity records, workflow
transitions, notes, and document events — not an entity of its own.

### 2.5 Documents

| Entity | Type | Responsibility | Key invariants |
| --- | --- | --- | --- |
| **Document (File)** | Aggregate root | A stored artifact's metadata + integrity (checksum) + access policy | Binary never lives in the database (ADR-010); access is authorized via the owning entity, always audited |
| Document Version | Entity | One upload within a version group | Versions are never destroyed by re-upload |
| Document Category | Reference entity | Admin catalog ("National ID", "Resume", "Contract") with per-category rules | Mime/size/retention rules enforced at intake |

### 2.6 Process (Workflow & Approvals)

| Entity | Type | Responsibility | Key invariants |
| --- | --- | --- | --- |
| **Workflow Definition** | Aggregate root (versioned) | A configurable state machine for a business entity type | Structurally valid at activation (reachability, terminal state — Review R20); versions are immutable once active |
| **Workflow Instance** | Aggregate root | One entity's journey through a definition | Pinned to its definition version for life; single current state (parallel states rejected — Review R21) |
| Transition Record | Immutable fact | One state change: actor, time, comment, approval linkage | The instance's transition history **is** the entity's status history |
| **Approval Chain** | Aggregate root | "Who must say yes": ordered steps, approver resolution rules, quorum, escalation | Approver types: role · job title · org-unit manager · explicit user; org-manager resolution walks up the unit tree (Review R11) |
| **Approval Request** | Aggregate root | One running chain against one entity | Resolves to approved/rejected/cancelled exactly once |
| Approval Decision | Immutable fact | One approver's verdict at one step (approve/reject/return, comment, delegation provenance) | Recorded even when superseded by escalation |

### 2.7 Communication

| Entity | Type | Responsibility | Key invariants |
| --- | --- | --- | --- |
| Notification | Entity | One message to one person; the in-app inbox is the source of truth, sockets are only live push | Always references its origin entity; delivery is asynchronous |
| Notification Template | Reference entity | Localized (ar/en) message shape with variables | Both languages required |
| Channel Preference | Entity | Per user × notification type × channel opt-in | Defaults are settings-driven |
| Translation | Reference entity | A UI string in a namespaced catalog | Namespace maps 1:1 to its owning module/service |

### 2.8 Automation & Integration

| Entity | Type | Responsibility | Key invariants |
| --- | --- | --- | --- |
| Scheduled Task | Reference entity (code-owned) | Declared recurring work — the "what runs when" inventory (Review R3) | Declared in code; pause/run-now are operations, not edits |
| Sequence | Aggregate root | A gap-monitored document-numbering counter | Allocation is atomic; scope `organization · branch`; numbers allocated inside the creating transaction |
| Domain Event | Published fact | Named `<module>.<entity>.<pastTenseEvent>`, versioned payload (Review R22) | Business-consequence events use the reliable (outbox) tier; consumers are idempotent, tolerant readers |
| Connector | Aggregate root | A configured door to one external system (OCR, email, …) | Modules never call external services directly; credentials encrypted; health observable (Review R24) |
| API Key | Aggregate root | A third-party caller's scoped credential | Same permission model as users |
| Webhook Endpoint | Aggregate root | An inbound integration point | HMAC-verified |
| Extraction Job (OCR) | Aggregate root | One document-intelligence run with per-field confidences | Results **pre-fill, never commit** — a human confirms (ADR-014) |

### 2.9 Insight

| Entity | Type | Responsibility | Key invariants |
| --- | --- | --- | --- |
| Searchable Declaration | Reference entity (manifest-owned) | What an entity exposes to global search | Results permission- and scope-filtered before ranking |
| Dashboard / Widget | Aggregate root / reference entity | Composable per-role landing pages from module-contributed widgets | Widget data endpoints are ordinary permission-guarded queries |
| Report Definition / Report Schedule | Reference entity / aggregate root | Parameterized, exportable, schedulable reports | Export/print are individually audited egress events |

---

## 3. Supporting context: Recruitment (first business module)

The only business context designed to full detail in Milestone 1; entity names below are
canonical and already bound to permissions, routes, and events
([Module Hierarchy §5](../01-business/module-hierarchy.md)). Per **[BD-001](business-decisions.md#bd-001--recruitment-is-requisition-driven)**
the pipeline is **requisition-driven**:

> Job Requisition → Applicant → Screening → Interview → Offer → Hiring → Employee

| Entity | Type | Responsibility | Key invariants |
| --- | --- | --- | --- |
| **Job Requisition** | Aggregate root (pipeline anchor) | An approved vacancy: position (job title), branch, headcount, budget | Requires approval before applicants attach; **no applicant can be hired without one** (BD-001) |
| **Applicant** | Aggregate root | A person seeking employment against a requisition: identity data (OCR-prefilled or manual), source, attachments | Applies against exactly one approved Job Requisition, inheriting its position and branch context; National ID unique among live applicants; identity fields confirmed by a human when OCR-prefilled; lifecycle owned by the recruitment workflow; numbered organization-wide (BD-002) |
| Applicant Note | Entity | Free-form remark on an applicant | Attributed and timestamped, never edited silently |
| Scheduled Activity | Entity | A planned action (call, reminder) with an assignee and due time | Belongs to one applicant |
| Recruitment Source | Reference entity | Where applicants come from (referral, job board, walk-in) | Localized catalog |
| **Screening** | Aggregate root | A structured screening form instance with score and decision | One decision per screening; pass/fail feeds a workflow guard |
| **Interview** | Aggregate root | A scheduled interview round with a panel and per-interviewer evaluations | An interviewer evaluates at most once per round |
| **Offer** | Aggregate root | Proposed terms requiring approval before sending | Terms immutable while its approval request is pending; sending requires a completed approval |
| **Hiring Case** | Aggregate root | Conversion of an accepted offer into employment readiness: the required-documents checklist | Completes only when all required documents are collected and verified |
| Hiring Document | Entity | One checklist item: document type × requirement × collected file | References a Document (Files context), never stores content |
| Document Type | Reference entity | Catalog of documents a hire must provide | Requirement rules per checklist |
| **Employee File** | Aggregate root | The consolidated digital file handed to the future Employment context | Assembled only from a completed hiring case; the handoff artifact across the context boundary |

---

## 4. Future contexts — indicative entity catalogs

These modules are **designed later** (Module Hierarchy §3); the catalogs below fix the
domain vocabulary and the shape of cross-context relationships so earlier phases don't
paint them into corners. Each requires its own design document before implementation —
**nothing here authorizes building them**.

### 4.1 Employment (HR, after Recruitment)

**Employee** (aggregate root — created from an Employee File; references a platform User;
correlated to the former Applicant by National ID per Review R9) · Employment Assignment
(position/unit/grade history) · Attendance Record · Leave Request · Payroll Run (or GL
handoff) · Training Record · Performance Review · Medical Record · Termination Case.

### 4.2 Cash Transportation (CIT) — core

**Service Order** (aggregate root — a client's request to move value between locations)
· **Trip** (aggregate root — one armored-vehicle run executing one or more orders; crew,
vehicle, route) · **Consignment** (the sealed value being moved: declared amount,
denomination breakdown, seals) · Custody Transfer (immutable fact — value changing hands:
from/to party, time, place, verification) · Seal (value object — tamper-evidence identity)
· Crew Assignment · Client *(reference from Client Agreements)*.

*Domain rule that shapes everything:* at any instant, every consignment has **exactly one
accountable custodian**; the chain of custody transfers is gapless and append-only.

### 4.3 Vault Custody — core

**Vault** (aggregate root — a physical strongroom at a branch with capacity and access
rules) · **Custody Account** (aggregate root — what the vault holds for one owner: client
or EGYCASH) · Deposit / Withdrawal (immutable movement facts, dual-verified) ·
**Vault Count** (aggregate root — a reconciliation event: expected vs counted, variances,
attestations) · Denomination Breakdown (value object).

### 4.4 ATM Operations — core

**ATM** (aggregate root — a serviced machine: location, owner bank, service terms) ·
**Replenishment Order** (aggregate root — cash loading: cassette plan, consignment linkage
to CIT/Vault) · Cassette (value object — denomination × count) · **Maintenance Visit**
(aggregate root — first/second-line intervention with findings) · **Incident** (aggregate
root — fault or discrepancy with SLA clock).

### 4.5 Gold Custody

**Precious Item** (aggregate root — an identified item/lot: weight, fineness, certificates)
· Item Movement (immutable custody fact) · Weighing Record (dual-attested).

Per [BD-005](business-decisions.md#bd-005--cash-and-gold-custody-shared-pattern-separate-entities):
gold custody mirrors the cash custody *pattern* (custody account, immutable movements,
gapless custodian chain, reconciliation) as **separate entities** (`GoldCustody` vs
`CashCustody`) with independent domain rules where the business differs; both reuse the
platform workflow engine.

### 4.6 Fleet

**Vehicle** (aggregate root — armored vehicle: registration, armor class, equipment) ·
Vehicle Assignment (to branch/trip/driver over time) · **Maintenance Order** (aggregate
root) · Route (reference entity).

### 4.7 Client Agreements (contracts)

**Client** (aggregate root — the counterparty; the shared "who we serve" entity other
contexts reference by ID) · **Contract** (aggregate root — services, sites, validity) ·
SLA (value object — response/frequency commitments the operational contexts must honor) ·
Price List / Tariff (reference entity).

### 4.8 Finance (accounting)

Cost Center (reference entity) · Billable Event (immutable fact emitted by operational
contexts) · Invoice (aggregate root) · GL Mapping (reference entity — export to the
external general ledger; ECMS is not the ledger).

### 4.9 Physical Security

Guard (aggregate root — references a User/Employee) · Shift Assignment · **Security
Incident** (aggregate root) · Security Clearance (entity — feeds hiring and site access).

### 4.10 Administration & IT Service

Administrative Request (aggregate root — generic workflow-driven request) · IT Asset
(aggregate root) · IT Ticket (aggregate root) · Access Request (aggregate root — bridges
to Identity & Access via provisioning events, never by direct writes).

---

## 5. Shared entities and shared language

| Shared thing | Owner context | How others use it |
| --- | --- | --- |
| **User** | Identity & Access | By ID, as actor / assignee / manager / approver everywhere; display name denormalized where lists demand it |
| **Branch** (and org units) | Organization | By ID, as the scoping dimension on every business aggregate |
| **Client** — one shared registry (BD-003) | Client Agreements | By ID + query contract from Cash Transportation, ATM, Vault, Gold, Contracts, and future Accounting; consumers never create or edit clients |
| **Document** | Documents | By ID via the standard entity reference; content never crosses contexts |
| **Entity Reference** (`module · entityType · entityId`) | Published language (kernel) | The universal way Documents, Accountability, Process, and Communication point at any business entity |
| **Value objects**: LocalizedString, NationalId, PhoneNumber, Address, PersonName, Assignee, Money *(joins the kernel with its first consumer)* | Shared kernel (`contracts/common`, Review R8) | Same validation and meaning in every context; NationalId doubles as the person-correlation key (R9); Money is an amount bound to an explicit currency — multi-currency ready, EGP-first, configuration-driven (BD-004) |
| **Domain events** | Published language (`contracts/events`) | The only broadcast medium between contexts (ADR-008) |

Deliberately **not** shared: a Party/person master (R9 — rejected), workflow state enums in
code (ADR-011), any direct read of another context's data store (ADR-005).

## 6. Business questions — all resolved

Every question this model raised or restated has been **decided and recorded** in the
[Business Decisions log](business-decisions.md):

| ID | Question | Resolution |
| --- | --- | --- |
| OQ-2 | Requisition-driven or applicant-first recruitment? | **Requisition-driven** — [BD-001](business-decisions.md#bd-001--recruitment-is-requisition-driven) |
| OQ-3 | Applicant numbering scope? | **Organization-wide** — [BD-002](business-decisions.md#bd-002--applicant-numbering-is-organization-wide) |
| OQ-4 | Single Client register or per-context customers? | **One shared Client Registry** — [BD-003](business-decisions.md#bd-003--one-shared-client-registry) |
| OQ-5 | Currency policy for Money? | **Multi-currency ready, EGP first, configuration-driven** — [BD-004](business-decisions.md#bd-004--multi-currency-ready-egp-first) |
| OQ-6 | One custody model for cash and gold? | **Shared pattern, separate entities** — [BD-005](business-decisions.md#bd-005--cash-and-gold-custody-shared-pattern-separate-entities) |

*(OQ-1 — departments belong to branches — was resolved earlier in
[ADR-015](../03-decisions/ADR-015-single-organization-model.md).)*
