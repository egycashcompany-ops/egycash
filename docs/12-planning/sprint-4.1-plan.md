# Sprint 4.1 Planning — HR / Recruitment: Applicants (Release v0.6)

> **Status:** 🧊 **Frozen 2026-07-10 (EGYCASH-approved). Implementation of Stage 1
> (Applicants) authorized — backend-first.**
> **Baseline:** the recruitment workflow shape was **approved by EGYCASH on 2026-07-10**
> (reproduced verbatim in §1) and is the anchor this analysis works against.
> **Scope discipline (BD-006):** Release v0.6 covers the **Recruitment** sub-module of the
> `hr` module only. This sprint implements **Stage 1 — Applicants** only; the other six
> stages are surveyed to keep Stage 1 decisions lifecycle-safe, but their own planning
> documents and implementation come later. **No part of Stage 2 (Screening) or beyond is
> built.**
> **Naming note:** "Sprint 4.x" is proposed for Milestone-3 (business module) sprints,
> continuing from the 3.x platform-capability series. Rename freely at review.

> **Freeze decisions (EGYCASH, 2026-07-10) — the last blocking Open Questions, resolved:**
> - **OQ-29 → Backend-first.** Stage 1 ships the **full backend** (contracts + APIs +
>   services + persistence). The **frontend is a separate later sprint** — `apps/web`
>   grids/filters/export are not built here.
> - **OQ-30 → Unbuilt dependencies become integration points/abstractions only.** Any
>   capability that does not yet exist (OCR, external-recipient/WhatsApp-SMS
>   notifications, the Stage-0 Job Requisition service, and the like) is represented by a
>   **swappable interface/adapter with a safe default**, never a concrete implementation
>   this sprint. Real, self-contained pieces that *can* be built without a missing
>   dependency (Egyptian National-ID number parsing/validation, Arabic-normalized search,
>   organization-wide applicant numbering) **are** built.
> - **OQ-9 / OQ-10 → not blocking for Stage 1.** The definition of "Employee" and the
>   Electronic Employee File lifecycle are handled in their own later stages and do **not**
>   affect Applicants. They remain open, parked against those stages.

Related, already-approved material this document builds on (and never overrides):
[BD-001 (requisition-driven recruitment)](../01-domain/business-decisions.md#bd-001--recruitment-is-requisition-driven) ·
[BD-002 (organization-wide applicant numbering)](../01-domain/business-decisions.md#bd-002--applicant-numbering-is-organization-wide) ·
[Domain Model §3 (Recruitment context)](../01-domain/domain-model.md) ·
[Bounded Contexts](../01-domain/bounded-contexts.md) ·
[Module Hierarchy §4 (Recruitment features)](../01-business/module-hierarchy.md) ·
[Ubiquitous Language](../01-domain/ubiquitous-language.md).

Where the workflow as stated leaves a business gap, this document **records an Open
Question (§10) instead of assuming an answer** — per the review instruction. Open
Questions continue the global numbering (OQ-1…OQ-6 were resolved earlier; this document
raises **OQ-7 … OQ-32**). **Seven are resolved by EGYCASH decisions of 2026-07-10** —
OQ-7 (requisition-driven, Stage 0), OQ-8 (documents before employee), OQ-31 (interviews
configurable), OQ-32 (screening Accepted/Rejected only), **OQ-29 (backend-first),
OQ-30 (unbuilt dependencies → abstractions), and OQ-9/OQ-10 declared non-blocking for
Stage 1** — clearing the last blockers and **freezing the plan for Stage 1
implementation**. The remaining open OQs concern later stages or intentionally-deferred
Stage-1 policy (public-form anti-abuse OQ-17/18, retention OQ-16, bulk/export specifics
OQ-27/28, …) and are handled as noted in §10.

---

## 1. The recruitment lifecycle in context

The recruitment process is **one workflow, not seven isolated modules**. The approved
baseline (EGYCASH, 2026-07-10), reproduced verbatim:

```
Applicant
    │
    ▼
Initial Screening
    │
    ├── Rejected
    └── Accepted
             │
             ▼
Interview #1
    │
    ├── Failed
    └── Passed
             │
             ▼
Interview #2
    │
    ├── Failed
    └── Passed
             │
             ▼
Job Offer
    │
    ├── Rejected
    ├── Expired
    └── Accepted
             │
             ▼
Hiring Documents
             │
             ▼
Employee Created
             │
             ▼
Electronic Employee File
```

What the approved baseline **settles**:

- **Hiring Documents precede Employee Created.** This matches the approved domain
  model's ordering (documents gate employment) and **resolves OQ-8**: no employee
  exists until the hiring documents stage completes, so no "un-hire" path is needed.
- **Job Offer has three outcomes — Rejected, Expired, Accepted.** *Expired* is now an
  approved first-class outcome (this closes the offer-expiry gap this analysis raised;
  the expiry policy's parameters — validity period, who sets it — are stage-4 planning
  detail).
- The failure exits are explicit at every evaluative stage: screening Rejected,
  interview Failed, offer Rejected/Expired — each a terminal outcome for that
  application.

Two differences between the baseline diagram and the earlier written brief were resolved
by EGYCASH on 2026-07-10 (reflected in the relevant sections below):

- **Interviews are configurable (→ OQ-31 resolved).** The diagram's two rounds are the
  **default configuration**, not a domain limit. The number, names, and order of
  interview stages are **administrator-configurable**; two interviews is only the
  shipped default. (Detail lands with the Interviews stage plan; recorded here so the
  Applicant/pipeline model treats the interview sequence as data, not a fixed shape.)
- **Screening has exactly two outcomes (→ OQ-32 resolved).** The official screening
  outcomes are **Accepted** and **Rejected** only. When HR needs more information, the
  applicant **remains in the Screening stage** until the missing information is
  completed — there is **no separate "Needs More Information" workflow state**.

The diagram starts at **Applicant**; the Job Requisition that precedes it is documented
as **Stage 0** in §1.2 (→ OQ-7 resolved: recruitment remains requisition-driven).

### 1.1 Lifecycle-level review findings

A senior-HR-architect pass over the whole lifecycle before zooming into Stage 1. Each
finding is recorded as an Open Question — none is assumed resolved.

1. **The requisition question — ✅ resolved (EGYCASH, 2026-07-10).** Recruitment is
   **always requisition-driven; BD-001 stands unchanged.** The workflow starts from an
   **approved Job Requisition (Stage 0)**, and **every applicant belongs to exactly one
   Job Requisition**. The Job Requisition itself is **outside the Recruitment module**
   and will be planned separately — this document treats it as a documented prerequisite
   (§1.2), not as work in this sprint, and the Applicants workflow is unchanged by the
   decision. → **OQ-7 resolved**
2. **Stage order: employee before documents — ✅ resolved by the approved baseline.**
   The earlier seven-item list created the Employee before collecting hiring documents;
   the approved baseline (§1) orders it Hiring Documents → Employee Created, matching
   the approved domain model (*Hiring Case completes only when all required documents
   are collected and verified*). No "un-hire" path is needed. → **OQ-8 resolved**
3. **The Recruitment ⇄ Employment boundary.** Stages 5 and 7 (Employee, ongoing
   Electronic Employee File) sit on the boundary the bounded-context map explicitly
   defends ("will exert pressure to merge into one HR context — resist"). What
   "Employee" *means* in v0.6, and whether the Electronic File's ongoing life belongs
   to this release at all, must be decided before stage 5/7 planning. → **OQ-9, OQ-10**
4. **A possibly missing stage: security vetting & medical fitness.** For a company
   whose staff carry cash, drive armored vehicles, and hold vault custody, background
   vetting and medical fitness are not obviously "two more PDFs in stage 6" — vetting
   can *fail after an offer is accepted* and may deserve its own gate. → **OQ-11**
5. **Missing lifecycle edges.** The stages describe the happy path. Not described:
   applicant **withdrawal** (possible at any stage), **re-application** by the same
   person, a **talent pool** outcome ("good candidate, wrong timing" — neither pass
   nor fail), interview **no-shows**, offer **negotiation/revocation** (expiry is now
   an approved baseline outcome, §1),
   requisition **filled/cancelled/frozen** effects on in-flight applicants.
   → **OQ-12, OQ-13** (stage-2/3/4 specifics recorded when those stages are planned)
6. **Notifying applicants is a platform gap.** Stage-3 WhatsApp/SMS/Email notifications
   address *applicants* — external people, not platform users. The Notifications
   Service (v0.5.0) delivers to platform users only; its channel-adapter seam is ready
   for WhatsApp/SMS, but an **external-recipient** concept does not exist yet. This is
   a Notifications Service extension to plan deliberately, not a Recruitment detail.
   → **OQ-14**
7. **Cross-cutting business policies** that shape every stage: recruiter data scope
   (branch vs organization), and PII retention for applicants who are never hired.
   → **OQ-15, OQ-16**

### 1.2 Stage 0 — Job Requisition (prerequisite, planned separately)

**Approved (EGYCASH, 2026-07-10):** recruitment is always requisition-driven; the
pipeline begins at an **approved Job Requisition**. Recorded here as the documented
prerequisite to Stage 1 — **not designed or built in this sprint**:

- A **Job Requisition** is an approved vacancy (position/job title, branch, headcount,
  budget — per the approved domain model and BD-001) that must be **approved before any
  applicant can be attached to it**.
- **Every Applicant belongs to exactly one Job Requisition** and inherits its position
  and branch context. There are no free-floating applicants (BD-001).
- The **Job Requisition lives outside the Recruitment module** and has its own planning
  document, approval workflow, and lifecycle. Whether it belongs to a dedicated
  `requisitions` sub-module or elsewhere in `hr` is decided in that separate plan.
- **Consequence for Stage 1:** the Applicant model carries a **mandatory, immutable
  reference to its Job Requisition**; registration (internal and public) selects the
  requisition being applied to; a public applicant applies to a *published* requisition
  (the publication mechanism is Stage-0/requisition-plan scope, not this document).
  This is the only structural addition the decision makes to the Applicants workflow —
  the workflow shape (§1) is otherwise unchanged.

Because Stage 0 is a separate capability, its two enabling dependencies (an approvals
mechanism, and requisition publication for public applicants) are tracked in §1.3 and do
not gate Stage 1's own planning beyond providing the requisition reference.

### 1.3 Platform dependencies the lifecycle assumes (reality check)

| Dependency | Needed by | Status today |
| --- | --- | --- |
| Sequence/numbering service | Applicant numbers `APP-{YYYY}-{seq:6}` (BD-002); employee numbers later | ❌ not built (phase-2.2 backlog) |
| Workflow / Approvals v1 | Requisition approval (BD-001, Stage 0), offer approval | ❌ not built (was Sprint 2.3 scope) |
| OCR capability (ADR-014) | National ID extraction | ❌ not built — the Files service's `ocr` processor seam is the plug-in point |
| Virus scanning (real engine) | Public-form file uploads | ❌ seam exists, no engine wired |
| External-recipient notifications + WhatsApp/SMS adapters | Applicant-facing messages | ❌ user-only recipients today |
| Frontend data-grid/filter/export foundation | Every screen requirement (§9) | ❌ `apps/web` is a minimal scaffold |
| Job Requisition (Stage 0) | The mandatory requisition reference every Applicant carries | ❌ planned separately (§1.2) |

Whether each is **built first**, **interim-manual**, or **de-scoped from v0.6** is a
business sequencing decision → **OQ-30**.

---

## 2. Stage 1 — Applicant registration

### 2.1 Registration paths

Three ways an Applicant comes into existence, all converging on **one intake pipeline
and one identical lifecycle** afterwards:

| Path | Operator | Trust level | Notes |
| --- | --- | --- | --- |
| **Internal entry** (recruitment page: form + grid) | Recruiter | Trusted | Manual entry and/or OCR-assisted from a scanned National ID |
| **Public web form** | The applicant | Untrusted | §4 |
| **Public mobile form** | The applicant | Untrusted | §4 — same rules as web |
| *(future)* Platform integration | External platform | Semi-trusted | §5 — arrives through the same intake pipeline, never directly |

Business rules for registration, regardless of path:

1. **Manual entry is always available** — OCR assists, it never gates.
2. **Registration without an ID card is permitted.** The applicant is marked
   **identity-unverified**; the National ID becomes mandatory at a later stage gate
   (which gate — screening pass? offer? hiring documents? — is a business decision,
   → **OQ-19**). Recommended floor: no offer without a verified National ID.
3. **Every applicant records its source** (§3) and its **intake channel** (internal /
   web / mobile / integration) — the channel is not the source (a LinkedIn applicant
   arrives via integration channel with source LinkedIn; a walk-in is internal channel
   with source Walk-in).
4. **Identity data captured via OCR is never authoritative until a human confirms it**
   (already an approved invariant in the domain model). Confirmation is per-applicant,
   attributable, and audited.
5. **Duplicate policy**: National ID is unique among live applicants (approved
   invariant). Where no ID exists yet (public submissions, ID-less registration),
   duplicate *detection* falls back to heuristics (normalized phone, name + birth
   date) and produces a **flag for recruiter resolution**, not an automatic block.
   Whether the same person may hold two live applications against two different
   requisitions is a policy choice → **OQ-20**.

### 2.2 Attachments at registration

- Unlimited files/photos per applicant.
- Every uploaded file carries: **custom title** (mandatory), **category** (mandatory),
  **optional notes**.
- Attachment categories should be an **admin-managed catalog** (CV, ID scan front, ID
  scan back, certificate, photo, other…) rather than free text — filtering and the
  later hiring-documents checklist both depend on categories being stable. Whether
  this reuses the existing platform file-category catalog or is a recruitment-owned
  list → **OQ-25**.
- ID scans (front/back) are stored as attachments **even when OCR fails or is skipped**
  — the scan is evidence, not merely OCR input.

---

## 3. Applicant sources

A **localized, admin-extensible catalog** (matches the approved "Recruitment Source"
reference entity). Expected initial entries:

| Source | Kind | Structured detail beyond the catalog entry |
| --- | --- | --- |
| Internal HR | manual | — |
| Company Website | public form | submission reference |
| Mobile Application | public form | submission reference |
| LinkedIn | integration *(future)* | external posting/application reference |
| Wuzzuf | integration *(future)* | external reference |
| Forasna | integration *(future)* | external reference |
| Facebook | manual or integration | campaign/post reference (optional) |
| Referral | manual | **referring person** — employee reference expected (→ OQ-21) |
| Walk-in | manual | branch where they walked in (optional) |
| Recruitment Agency | manual | **which agency** — implies an agency catalog (→ OQ-22) |

Rules:

1. Source is **mandatory at creation** and **immutable afterwards except by an audited
   correction** (source statistics drive real spending decisions; silent edits would
   corrupt them).
2. The catalog is extensible by administrators (localized names, active/inactive —
   deactivation never deletes history).
3. Two sources carry structured business detail that a bare catalog entry cannot hold:
   **Referral** (who referred — needed for any referral program, → OQ-21) and
   **Agency** (which agency — commission/contract tracking implications, → OQ-22).
   Deciding these now prevents a breaking model change when the first referral bonus
   or agency invoice arrives.

---

## 4. Public recruitment forms (web + mobile)

### 4.1 The trust boundary

Public forms are the platform's **first unauthenticated write surface and first
anonymous file-upload surface**. Everything else in ECMS sits behind `authenticate`.
The business consequences:

- Submissions are **untrusted input**: spam, bots, malformed files, and hostile
  uploads are expected, not exceptional. Anti-abuse measures (rate limiting, CAPTCHA
  or equivalent, upload-type/size restrictions, virus scanning before any recruiter
  opens a file) are **mandatory scope**, not hardening for later. The strictness level
  (e.g., phone/e-mail OTP verification vs. fully anonymous submission) is a business
  choice → **OQ-17**.
- A submission is **not yet an Applicant**. The recommended shape: a public submission
  lands as a **pending application** that a recruiter reviews and converts (or
  rejects) — this is where duplicate flags are resolved, junk is discarded, and the
  applicant number is assigned. Whether conversion is manual-review-always or
  auto-with-flags → **OQ-18**.

### 4.2 Equality of pipeline

Once converted, a public applicant enters **exactly the same pipeline** as an
internally-created one — same lifecycle, same screens, same rules (stated requirement,
affirmed). The only permanent differences are the recorded intake channel, source, and
the identity-verification state (public applicants start identity-unverified until a
recruiter verifies the National ID).

### 4.3 Public-form content

The public form is a **subset** of the internal registration form (§7): identity as
typed by the applicant, contact, address, education/experience summary, CV upload,
expected salary and availability, and — since recruitment is requisition-driven
(OQ-7 resolved, §1.2) — **the Job Requisition they are applying to**. A public applicant
therefore applies to a *published* requisition; the publication mechanism (how a Stage-0
requisition is exposed to the public form) is **Stage-0 / requisition-plan scope**, not
this document.

---

## 5. Recruitment platform integrations (LinkedIn, Wuzzuf, Forasna, …) — boundaries only

No APIs are designed here. Domain boundaries and responsibilities:

| Responsibility | Owner |
| --- | --- |
| Job posting lifecycle on the external platform (publishing vacancies, budgets, ad performance) | **External platform** — out of ECMS scope for v0.6; a future "posting" capability may reference it |
| Receiving an external application and translating it into a standard internal submission | **Integration adapter** (one per platform — the same *adapter at the edge* pattern as notification channels and storage providers) |
| Duplicate detection, validation, conversion to Applicant, numbering | **Recruitment intake pipeline** — identical for every channel; adapters never bypass it |
| Source catalog entry + external reference (platform's application/posting id) | **Applicant record** (source detail, §3) |
| Credentials/config for each platform | **Platform settings** (established settings mechanism), never hard-coded |

Boundary rules:

1. **External platforms never write into Recruitment directly.** An adapter translates;
   the intake pipeline decides. Adapters are dumb translators with no business rules.
2. **An external application is a pending submission** (§4.1) until the intake
   pipeline accepts it — the same convert-or-reject review as public forms.
3. The Applicant keeps a **permanent external reference** (which platform, which
   external application id) for traceability and future two-way sync — but v0.6
   records the field, it does not build any sync.

---

## 6. OCR workflow (Egyptian National ID)

### 6.1 Expected extracted fields

| Side | Extracted directly | Notes |
| --- | --- | --- |
| **Front** | Full name (Arabic) · address (Arabic) · National ID number (14 digits) | Name and address are printed in Arabic only |
| **Back** | Occupation · employer · religion · marital status · gender · card expiry date · issuing office | Sensitive-field handling → OQ-23 |
| **Derived from the 14-digit number** (no OCR needed) | Date of birth · gender · governorate of birth · century | The number is self-describing; deriving these is deterministic |

The number also carries a **check digit** — structural validation of the OCR'd (or
manually typed) number is deterministic and applies regardless of OCR confidence.

### 6.2 Confidence handling

- The OCR result carries **per-field confidence**. Business bands: high → prefill;
  medium → prefill **visibly flagged for attention**; low/absent → leave blank for
  manual entry. (Threshold values are implementation detail; the three-band behavior
  is the business rule.)
- **Cross-check rule:** fields derivable from the ID number (birth date, gender,
  governorate) are compared against the OCR'd card-face values; any mismatch flags the
  applicant for human resolution and blocks identity confirmation until resolved.
- **No OCR output is authoritative.** Every OCR-prefilled field remains *unconfirmed*
  until a recruiter reviews and confirms; confirmation is a single audited act on the
  identity block, recording who confirmed and when.

### 6.3 Manual correction workflow

1. Recruiter opens the registration form with OCR prefill applied and flags visible.
2. Any field is editable; corrections **overwrite the OCR value but the original OCR
   reading is retained** (for extraction-quality measurement and dispute evidence).
3. Structural ID-number validation re-runs on every correction.
4. Recruiter confirms the identity block → applicant becomes identity-verified (if the
   ID number is present and valid) — audited.

### 6.4 OCR failure workflow

- Failure (unreadable scan, provider error, timeout) **never blocks registration**:
  the scans persist as attachments, the form falls back to fully manual entry, and
  re-scanning/retrying later is always possible.
- Failures are recorded (per scan) so extraction quality is measurable — deciding
  whether a provider is worth its cost is a business question that needs this data.

### 6.5 Missing-ID workflow

- Registration proceeds without any scan; applicant is **identity-unverified**;
  ID number and derived fields stay empty.
- The ID becomes mandatory at a later gate (→ **OQ-19**); when it arrives, the same
  scan → OCR → confirm (or manual entry → validate → confirm) path runs, and the
  uniqueness check against live applicants executes at that moment.
- Until verified, duplicate detection uses the heuristic fallback (§2.1 rule 5).

---

## 7. Applicant business data — classification

Business grouping of everything the organization needs to know about an applicant.
Grouped by domain meaning, not by screen layout. *Mandatory-at* marks the recommended
stage gate at which the group must be complete — confirming these gates is **OQ-24**.

| # | Group | Contents (business level) | Mandatory at | Sensitivity |
| --- | --- | --- | --- | --- |
| 1 | **Identity** | Full name (Arabic; English transliteration optional), National ID number, birth date, gender, nationality, place of birth, personal photo | Registration (name); ID gate → OQ-19 | High — national identity data |
| 2 | **Contact** | Primary mobile, secondary phone, e-mail, preferred contact channel | Registration (at least one reachable channel) | Medium |
| 3 | **Address** | Official address (as on ID) and current residence (governorate, city/district, street detail) — the two often differ | Identity gate | Medium |
| 4 | **Military service** *(male applicants)* | Status (completed / exempted / postponed / serving), certificate reference, dates | Before offer (recommended) | Medium — legally required for employment in Egypt |
| 5 | **Education** | Highest qualification, institution, faculty/specialization, graduation year, grade | Screening | Low |
| 6 | **Work experience** | Prior employers (name, position, from/to, leaving reason), total years, current employment status, notice period | Screening | Low |
| 7 | **Licenses & certifications** | Driving licenses (**grade/class and expiry** — decisive for driver roles), professional certificates, any security-work permits | Role-dependent: screening for driver/guard requisitions | Medium |
| 8 | **References** | Name, relationship, phone — n entries | Optional; before hiring recommended | Medium — third-party PII |
| 9 | **Application context** | **Job Requisition applied to** (mandatory, immutable — BD-001 / OQ-7 resolved, §1.2), source + source detail, intake channel, expected salary, earliest start date, willingness to relocate/travel/shift-work | Registration | Low |
| 10 | **Marital & family status** | Marital status (card-face), dependents count | Identity gate (card-face part) | Medium |

Explicitly recorded classification decisions:

- **Religion** appears on the National ID back face and is therefore *seen* during
  OCR. Whether ECMS **stores** it at all, and if so who may read it, is a deliberate
  business/compliance decision, not a default → **OQ-23**.
- **Health/medical data is not applicant data.** Medical fitness belongs to the
  vetting/hiring stage (→ OQ-11) — the applicant record must not accumulate health
  information.
- **Emergency contact** is employee-stage data (needed from day one of employment,
  not from application) — it belongs to stage 5/7 planning, noted here so it isn't
  duplicated into the applicant form.
- Expected salary is applicant-provided; any internal salary banding on the
  requisition side is stage-0/stage-4 material, not applicant data.

---

## 8. Documents strategy — ownership and lifecycle only

Four document populations exist across the lifecycle. One table fixes ownership and
lifecycle for all four **now**, so Stage-1 decisions cannot corner stages 6–7:

| Population | Owner | Created | Mutability | End of life |
| --- | --- | --- | --- | --- |
| **1. Temporary uploads** | The intake submission (not yet an applicant) | During form filling — esp. public forms, before submit | Replaceable freely by the uploader | Adopted by the Applicant on accepted submission; **orphans auto-purged** after a short window (→ OQ-26) |
| **2. Applicant documents** | **Applicant** | At/after registration (title + category + notes, §2.2) | Live: add, retitle, recategorize, archive — all audited; content replacement = new version (platform versioning), old versions retrievable | Follow the applicant's retention policy (→ OQ-16); selected documents get **pinned** into population 3 at hiring |
| **3. Hiring documents** *(stage 6, future)* | **Hiring Case** | During hiring, per the admin-defined required-documents checklist | Correctable **until the case is sealed**; after sealing — **immutable forever** (the hiring snapshot) | Permanent — the legal record of what was collected at hire |
| **4. Electronic employee file** *(stage 7, future)* | **Employee File** (handoff artifact to the future Employment context) | Assembled from the sealed hiring snapshot | Grows and changes throughout employment **without ever touching the sealed snapshot** | Employment-context lifecycle (out of v0.6 scope per OQ-10) |

Lifecycle principles (business commitments, not designs):

1. **Reference, don't copy.** "The employee file starts as a copy of hiring documents"
   is business intent; the mechanism should be **snapshot pinning** (population 3 pins
   exact immutable versions; population 4 references the same lineage and later edits
   create *new* versions) — the sealed snapshot stays byte-identical by construction.
   Opening the hiring snapshot years later shows exactly what was collected at hire.
2. **Sealing is the immutability boundary.** Before sealing, mistakes are correctable
   (audited); after sealing, nothing changes — corrections happen in population 4.
3. **Every transition of ownership is an explicit, audited act**: submission→applicant
   (adoption), applicant→hiring case (pinning), hiring snapshot→employee file
   (assembly).
4. **Temporary uploads are disposable by design** — never part of any snapshot, never
   referenced across the adoption boundary, purged on a schedule.

---

## 9. Filters, search, and bulk operations (Applicants screens)

Required by the business (affirmed): multi-select filters · multi-select rows · bulk
actions · fast search · sorting · saved filters.

Review — recommended additions and the rules that make the required set safe:

| Capability | Recommendation |
| --- | --- |
| **Filterable dimensions** | Status, source (multi), intake channel, requisition/position, branch, date ranges (applied/updated), identity-verified flag, duplicate flag, has-attachments, education level, military status, license grade |
| **Search** | Name (Arabic-normalized: hamza/taa-marbuta/alef variants fold together), applicant number, National ID (partial), phone (partial) — Arabic normalization is a business requirement, not a nicety |
| **Saved filters** | Personal by default; **shared/team views** are valuable but need an owner + permission story → OQ-28 |
| **Quick views** | Predefined status tabs (New / In screening / Needs info / …) on top of free filtering |
| **Bulk actions** | Each bulk action = the same permission as its single-row form, executed per-row, **audited per row**, with a per-row success/failure report (no silent partial success). Which bulk actions exist in Stage 1 (bulk reject with mandatory reason? bulk assign to recruiter? bulk tag?) → OQ-27 |
| **Export** | Export is **data egress of PII** — permission-gated, row-capped, audited (who exported what filter, how many rows), National-ID-masked by default (the audit module's export already established this exact pattern; reuse it) → OQ-27 |
| **Grid preferences** | Column show/hide/order per user; server-side pagination/sorting as the platform standard |
| **Duplicate-flag surfacing** | The §2.1 heuristic flags must be a first-class filterable state, or they will be ignored |

**Scope flag (resolved — OQ-29 → backend-first):** the frontend grid/filter/saved-view/
export UI is a **separate later sprint**. Stage 1 delivers the **backend** for all of the
above — a filterable, sortable, paginated list API; Arabic-normalized search; an audited,
PII-masked export endpoint; and a generic per-row-audited bulk executor — so the future
frontend has a complete API to build against.

---

## 10. Open Questions (OQ-7 … OQ-32)

**All blocking questions are resolved (below); the plan is frozen for Stage 1
implementation. The remaining open OQs govern later stages or intentionally-deferred
Stage-1 policy and do not block the Applicants build.**

### Resolved (EGYCASH decisions, 2026-07-10)

| ID | Question | Resolution |
| --- | --- | --- |
| **OQ-7** | Does BD-001 stand — is the Job Requisition the pipeline anchor? | ✅ **Yes, BD-001 unchanged.** Recruitment is always requisition-driven; the workflow starts from an approved **Job Requisition (Stage 0)**; every applicant belongs to exactly one requisition. The Job Requisition is **outside the Recruitment module, planned separately** (§1.2). The Applicants workflow is unchanged. |
| **OQ-8** | Stage order: employee created before or after hiring-document verification? | ✅ **Resolved by the approved baseline workflow** — Hiring Documents precede Employee Created; verified documents gate employee creation; no un-hire path needed |
| **OQ-9** | Is v0.6's "Employee" a minimal identity record? | ✅ **Not blocking for Stage 1.** Employee definition is handled in its own later stage; it does not affect Applicants. Parked against the Employee-creation stage. |
| **OQ-10** | Is the Electronic Employee File's ongoing lifecycle in v0.6? | ✅ **Not blocking for Stage 1.** Handled in the Electronic-File stage; does not affect Applicants. Parked. |
| **OQ-29** | Full frontend, or backend-first? | ✅ **Backend-first.** Stage 1 ships the full backend (contracts + APIs + services + persistence); the frontend is a **separate later sprint**. |
| **OQ-30** | Unbuilt dependencies: build, interim-manual, or de-scope? | ✅ **Integration points/abstractions only.** Any missing capability (OCR, external-recipient notifications, the Stage-0 requisition service, …) is a **swappable interface/adapter with a safe default**; self-contained pieces that need no missing dependency (National-ID parsing, Arabic search, applicant numbering) are built for real. |
| **OQ-31** | Is the interview count fixed at two, or configurable? | ✅ **Configurable.** Two interviews is the **default configuration only**; the number, names, and order of interview stages are **administrator-configurable** — not a domain limitation (detail with the Interviews stage plan) |
| **OQ-32** | Does screening have a third "needs more information" outcome? | ✅ **No.** Official screening outcomes are **Accepted / Rejected only**. If HR needs more information, the applicant **remains in Screening** until it is completed — **no separate workflow state** is introduced |

### Deferred — do not block Stage 1 (resolved when their stage/topic is planned)

The questions below stay open. Where a Stage-1 code path would otherwise need them, the
implementation takes the **non-assuming, reversible** option and records it, rather than
guessing the eventual policy:

- **Public-form policy (OQ-17 anti-abuse level, OQ-18 convert-vs-auto):** the
  unauthenticated public/mobile intake **surface is not built this sprint**. Per OQ-30,
  the intake pipeline is exposed as a **service seam** a future public controller/adapter
  can call once these are decided; only the authenticated internal registration path is
  built now.
- **Integration adapters (OQ-21 referral detail, OQ-22 agency catalog):** the source
  catalog stores an optional structured `sourceDetail`; the referral-employee and
  agency-catalog specifics are **not modeled as first-class entities** yet.
- **OQ-25 attachment categories:** Stage 1 **reuses the existing platform file-category
  catalog** (the non-assuming choice — no new catalog invented); a recruitment-owned list
  remains a future option.
- **OQ-16 retention, OQ-26 temp-upload purge, OQ-27 bulk actions/export unmasking,
  OQ-28 shared saved views:** Stage 1 builds an **audited, PII-masked export** and a
  **filterable list**; a **generic per-row-audited bulk executor** is provided but the
  specific bulk action set and shared-view model are left minimal pending these.
- **OQ-19 ID-mandatory gate, OQ-20 cross-requisition duplicates, OQ-23 religion,
  OQ-24 field gates:** applicants may register **ID-less (identity-unverified)**;
  duplicate National-ID among live applicants is flagged (not hard-blocked beyond the
  unique-live-ID invariant); **religion is not stored**; only name + one contact channel
  + the requisition reference are mandatory at registration.

The full still-open register (unchanged wording), for traceability:

#### Lifecycle-wide

| ID | Question |
| --- | --- |
| OQ-11 | Are security vetting and medical fitness **first-class pipeline gates** (can fail post-offer) or hiring-document checklist rows? |
| OQ-12 | Withdrawal & re-application policy: cooling-off period? Is prior history linked to a new application? |
| OQ-13 | Is **talent pool** ("good candidate, no current fit") a distinct terminal state separate from Rejected? |
| OQ-14 | Is extending the Notifications Service with **external recipients** (applicant phone/e-mail, no user account) the accepted direction for applicant-facing messages? |
| OQ-15 | Recruiter **data scope**: branch-scoped pipelines or organization-wide visibility (ADR-004 machinery supports both)? |
| OQ-16 | **PII retention** for terminal, never-hired applicants (ID scans, documents): retention window and purge policy (Egypt PDPL, Law 151/2020 exposure)? |

#### Stage-1 specific

| ID | Question |
| --- | --- |
| OQ-17 | Public forms: fully anonymous submission, or verified (e.g., phone/e-mail OTP)? What anti-abuse level is mandated? |
| OQ-18 | Do public submissions **always** pass a recruiter convert-or-reject review before becoming Applicants, or auto-convert with flags? |
| OQ-19 | At which stage gate does the National ID become **mandatory** (screening pass / offer / hiring documents)? |
| OQ-20 | Duplicates: hard-block on live National ID match only? May one person hold live applications against **two different requisitions**? Merge policy for heuristic matches? |
| OQ-21 | Referral source: is the **referring employee** captured? Is a referral program (bonus tracking) anticipated? |
| OQ-22 | Agency source: is an **agency catalog** needed (names, contacts, contract/commission references)? |
| OQ-23 | **Religion** (card-face field): stored at all? If stored, who may read it? Same question for any other card-face field the business does not actually need. |
| OQ-24 | Confirm the **mandatory-at gates** per data group (§7): what is the minimum to register vs. what each later stage requires? |
| OQ-25 | Attachment categories: reuse the platform **file-category catalog** or a recruitment-owned list? |
| OQ-26 | Temporary-upload orphan **purge window** (e.g., 24–72 h)? |
| OQ-27 | Which **bulk actions** exist on Applicants in v0.6, and what are the export masking rules (who may export unmasked)? |
| OQ-28 | Saved filters: personal only, or **shared team views** (with an owner/permission model)? |

---

## Out of scope for Stage 1 implementation

**Any part of Stage 2 (Screening) or later** (interviews, offers, hiring, employee,
electronic file) · the unauthenticated **public/mobile intake surface** (OQ-17/18 open —
exposed only as a service seam) · **external-platform integration adapters** (boundaries
documented, no adapter built) · **OCR image extraction** (interface + null stub only) ·
the **Stage-0 Job Requisition** service (referenced via a validator seam) ·
external-recipient / WhatsApp-SMS notifications · the **frontend** (separate sprint) ·
Employee Management, Attendance, Payroll, Leave, Performance, Training, Medical,
Termination · referral-bonus mechanics · agency catalog as a first-class entity.

---

## Planning frozen

This document is **frozen as of 2026-07-10** (EGYCASH-approved). The recruitment workflow
baseline, the seven decisions of 2026-07-10 (OQ-7/8/9/10/29/30/31/32), and the Stage-1
scope boundary above are the authorized specification for the **Stage 1 (Applicants)
backend implementation**. Further planning changes are made only to fix a real defect.
Implementation follows the frozen document exactly, per the established process:
implement → verify → self architecture review → open PR → await review → merge →
bookkeeping.
