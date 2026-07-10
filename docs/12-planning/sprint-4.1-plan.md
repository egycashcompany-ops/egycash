# Sprint 4.1 Planning — HR / Recruitment: Applicants (Release v0.6)

> **Status:** 📝 Draft — business analysis under review
> **Type:** Planning & business analysis only — **no implementation is authorized by this
> document.** It deliberately contains no APIs, no database schema, no models, services,
> controllers, or routes.
> **Scope discipline (BD-006):** Release v0.6 covers the **Recruitment** sub-module of the
> `hr` module only. This sprint plans **Stage 1 — Applicants** in depth; the other six
> stages are surveyed to keep Stage 1 decisions lifecycle-safe, but their own planning
> documents come later.
> **Naming note:** "Sprint 4.x" is proposed for Milestone-3 (business module) sprints,
> continuing from the 3.x platform-capability series. Rename freely at review.

Related, already-approved material this document builds on (and never overrides):
[BD-001 (requisition-driven recruitment)](../01-domain/business-decisions.md#bd-001--recruitment-is-requisition-driven) ·
[BD-002 (organization-wide applicant numbering)](../01-domain/business-decisions.md#bd-002--applicant-numbering-is-organization-wide) ·
[Domain Model §3 (Recruitment context)](../01-domain/domain-model.md) ·
[Bounded Contexts](../01-domain/bounded-contexts.md) ·
[Module Hierarchy §4 (Recruitment features)](../01-business/module-hierarchy.md) ·
[Ubiquitous Language](../01-domain/ubiquitous-language.md).

Where the workflow as stated leaves a business gap, this document **records an Open
Question (§9) instead of assuming an answer** — per the review instruction. Open
Questions continue the global numbering (OQ-1…OQ-6 are resolved; this document raises
**OQ-7 … OQ-30**).

---

## 1. The recruitment lifecycle in context

The recruitment process consists of seven business stages forming **one workflow, not
seven isolated modules**:

```mermaid
flowchart LR
    A[1 Applicants] --> B[2 Initial Screening]
    B --> C[3 Interviews]
    C --> D[4 Job Offer]
    D --> E[5 Employee Hiring]
    E --> F[6 Hiring Documents]
    F --> G[7 Electronic Employee File]
```

### 1.1 Lifecycle-level review findings

A senior-HR-architect pass over the whole lifecycle before zooming into Stage 1. Each
finding is recorded as an Open Question — none is assumed resolved.

1. **The requisition question (blocking).** The seven stages begin at *Applicants*, but
   the approved **BD-001** makes the **Job Requisition** the pipeline anchor: *"no
   applicant can be hired without a Job Requisition; free-floating applicants do not
   exist."* Either the requisition is the unstated stage 0 of this workflow, or BD-001
   is being reconsidered. Everything downstream (which position an applicant is
   evaluated for, which branch context applies, when a vacancy is "filled") depends on
   this. → **OQ-7**
2. **Stage order: employee before documents.** Stage 5 creates the Employee *before*
   stage 6 collects and verifies hiring documents. The approved domain model orders it
   the other way (*Hiring Case completes only when all required documents are collected
   and verified; the Employee File is assembled only from a completed hiring case*).
   Creating an employee whose criminal-record certificate or military status later
   fails verification forces an "un-hire" path — heavy, audit-sensitive, and avoidable.
   → **OQ-8**
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
   nor fail), interview **no-shows**, offer **negotiation/expiry/revocation**,
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

### 1.2 Platform dependencies the lifecycle assumes (reality check)

| Dependency | Needed by | Status today |
| --- | --- | --- |
| Sequence/numbering service | Applicant numbers `APP-{YYYY}-{seq:6}` (BD-002); employee numbers later | ❌ not built (phase-2.2 backlog) |
| Workflow / Approvals v1 | Requisition approval (BD-001), offer approval | ❌ not built (was Sprint 2.3 scope) |
| OCR capability (ADR-014) | National ID extraction | ❌ not built — the Files service's `ocr` processor seam is the plug-in point |
| Virus scanning (real engine) | Public-form file uploads | ❌ seam exists, no engine wired |
| External-recipient notifications + WhatsApp/SMS adapters | Applicant-facing messages | ❌ user-only recipients today |
| Frontend data-grid/filter/export foundation | Every screen requirement (§8) | ❌ `apps/web` is a minimal scaffold |

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
expected salary and availability, and — if BD-001 stands — **which vacancy they are
applying to** (public listing of open requisitions is then implied; whether vacancies
are publicly listed is part of OQ-7's resolution).

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
| 9 | **Application context** | Requisition applied to (per BD-001/OQ-7), source + source detail, intake channel, expected salary, earliest start date, willingness to relocate/travel/shift-work | Registration | Low |
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

**Scope flag:** this is the platform's **first real frontend investment** (`apps/web`
is a minimal scaffold; every prior sprint was backend-only). Building grids, filters,
saved views, and export well means building a *reusable* foundation once — potentially
its own sprint. Whether v0.6 Stage 1 ships backend-first (like every release so far) or
includes the full UI is the largest sizing decision in this release → **OQ-29**.

---

## 10. Open Questions (OQ-7 … OQ-30)

**No implementation planning can be frozen until the blocking questions are answered.**

### Blocking / structural

| ID | Question |
| --- | --- |
| **OQ-7** | Does **BD-001 stand**? Is the Job Requisition the unstated stage 0 — every applicant (including public-form applicants, who would then apply to a *listed vacancy*) attached to an approved requisition? Or is BD-001 being revisited? |
| **OQ-8** | Stage order: may an Employee be created **before** hiring documents are verified (current stage 5→6 order), or do verified documents gate employee creation (approved domain-model order)? If before: what is the un-hire path when documents fail? |
| **OQ-9** | Is v0.6's "Employee" a **minimal identity record** (number, identity, permanent applicant reference, hire date) that the future Employment module extends — with all Employee Management explicitly out of scope? |
| **OQ-10** | Is the Electronic Employee File's **ongoing** edit/grow lifecycle in v0.6, or only its creation from the sealed hiring snapshot? |
| **OQ-29** | Does v0.6 include the **full frontend** (grids/filters/bulk/export foundation) or ship backend-first like all previous releases? |
| **OQ-30** | For each unbuilt dependency (§1.2): build-first, interim-manual (e.g., manual applicant numbers until the sequence service exists?), or de-scope from v0.6? |

### Lifecycle-wide

| ID | Question |
| --- | --- |
| OQ-11 | Are security vetting and medical fitness **first-class pipeline gates** (can fail post-offer) or hiring-document checklist rows? |
| OQ-12 | Withdrawal & re-application policy: cooling-off period? Is prior history linked to a new application? |
| OQ-13 | Is **talent pool** ("good candidate, no current fit") a distinct terminal state separate from Rejected? |
| OQ-14 | Is extending the Notifications Service with **external recipients** (applicant phone/e-mail, no user account) the accepted direction for applicant-facing messages? |
| OQ-15 | Recruiter **data scope**: branch-scoped pipelines or organization-wide visibility (ADR-004 machinery supports both)? |
| OQ-16 | **PII retention** for terminal, never-hired applicants (ID scans, documents): retention window and purge policy (Egypt PDPL, Law 151/2020 exposure)? |

### Stage-1 specific

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

## Out of scope for this document

Implementation of anything · APIs, schemas, models, services, controllers, routes ·
Stages 2–7 detail planning (each gets its own document) · Employee Management,
Attendance, Payroll, Leave, Performance, Training, Medical, Termination · job-posting
management on external platforms · referral-bonus mechanics · any Notifications
Service changes (OQ-14 would be planned in that service's own documents).

---

*Prepared as business analysis for review. Once the Open Questions are resolved and
this analysis is approved, the normal process continues: planning document (with the
approved answers folded in) → review & approval → implementation → code review →
merge → bookkeeping.*
