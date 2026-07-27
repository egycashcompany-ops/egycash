# Recruitment Workflow Refactor — Design

> Status: **FROZEN** (Revision 2.2, 2026-07-27 — reviewed and frozen by the approver;
> §20 records the implementation invariants I1–I10 added during the build).
> Approved for implementation as a **single PR** (§16), exactly as for Leave
> (`leave-management-design.md`), Auth (`auth-account-lifecycle-design.md`) and Contracts
> (`contracts-module-design.md`).
>
> Later sections supersede earlier ones wherever they conflict. Amendments after the freeze
> require a new recorded revision.
>
> **Revision 2 — approver decisions.** The three open questions are resolved and eight
> amendments (A1–A8) are incorporated throughout:
>
> | | Resolution |
> |---|---|
> | **OQ-1** | Evaluation phases run in real business order: **1 Security Check · 2 Driving Test · 3 Medical Check**. Medical stays last because it is normally the final external approval before hiring (RW6, §15 migration) |
> | **OQ-2** | Stage navigation is a **client-side provider fed by the counters endpoint**. Stages are dynamic business data and must **not** become Platform Applications (RW16) |
> | **OQ-3** | Placement editing stops at **Offer Acceptance**; afterwards changes go through the existing revise / withdraw / re-accept flow so the accepted snapshot stays the legal source of truth (RW3) |
>
> | Amendment | Incorporated in |
> |---|---|
> | **A1** Placement editable Screening → Offer Acceptance; board shows current, history shows snapshots | RW1, RW2, RW4, RW4a |
> | **A2** One chronological timeline for every movement, permanently auditable | RW14 |
> | **A3** Interview phases expose Waiting / Scheduled / In Progress / Completed; Start assigns the current user + `startedAt` automatically | RW11, RW12 |
> | **A4** Each evaluation phase is a full independent page with Waiting / Approved / Rejected + bulk decide with reason | RW6, RW9, RW10 |
> | **A5** Batches carry PDF list, applicant files, status, sent date, returned date, result files; history permanent; Medical never batched | RW8, RW9 |
> | **A6** Live counters on every recruitment nav item, one endpoint, permission-aware, incl. **Employees Ready** | RW15, RW16 |
> | **A7** Multi-select on **every** recruitment table with business-appropriate bulk actions | RW17 |
> | **A8** Return-to-stage supersedes + re-attempts, never modifies history | RW13 |

---

## 0. Scope — the eleven requests mapped to decisions

| # | Request | Decisions |
|---|---|---|
| 1 | Position & Branch editable until hiring | **RW1–RW5** |
| 2 | Evaluations → three independent phases, flat navigation | **RW6, RW7, RW16** |
| 3 | Security Check & Driving Test → batch workflows | **RW8** |
| 4 | Medical Check stays individual | **RW9** |
| 5 | Bulk approve / reject with reason | **RW10, RW17** |
| 6 | Interview flat navigation, page per phase | **RW11, RW16** |
| 7 | Start Interview (immediate, current user, now) | **RW12** |
| 8 | Global multi-selection in every DataTable | **RW17** |
| 9 | Candidate timeline | **RW14** |
| 10 | Return to previous stage | **RW13** |
| 11 | Live stage counters in navigation | **RW15, RW16** |

Out of scope (recorded in §19): job requisitions, candidate self-service portal, interview
scorecard templates, offer e-signature, scheduling calendars/room booking, AI ranking.

---

## 1. The architecture as it stands today

Reviewed before designing; this is what the refactor has to work with.

**Backend** — `apps/api/src/modules/hr/recruitment/`, one feature folder per stage behind an
ADR-003 barrel: `applicants/`, `screening/`, `interviews/`, `evaluations/`, `job-offers/`,
`hiring-documents/`. Employees and the Electronic Employee File moved out to
`employee-management/`. All wiring is declared in the `hrModule` manifest (`hr.module.ts`):
permissions, routes, collections, event subscriptions, scheduled tasks, seed.

**The pipeline is implicit.** There is no workflow engine and no stage field. An applicant's
position in the pipeline is *derived* from the existence and status of stage records:

```
Applicant(status: new) ──▶ Screening(pending→accepted) ──▶ Interview(stage 1..N, passed)
     ──▶ Evaluation(phase 1..M, approved) ──▶ Applicant.movedToOfferAt ──▶ JobOffer(accepted)
     ──▶ Employee ──▶ HiringDocuments ──▶ EmployeeFile
```

Entry gates are hard-coded reads across barrels:
`interviewService.schedule` requires an accepted screening (first stage) or a passed previous
stage; `evaluationService.open` requires `interviewService.hasClearedAllInterviews` **plus every
prior phase approved**; `jobOfferService` gates on `applicant.movedToOfferAt`;
`employeeService.create` gates on an accepted offer's frozen `acceptedSnapshot`.

**Facts that constrain this design:**

1. `ApplicantDoc` has **no position field at all**. It carries `jobRequisitionId` (nullable),
   `branchId` (nullable, the ADR-015 data-scope field), and `status: 'new' | 'rejected' | 'withdrawn'`.
   The first time a position is named is the Job Offer's `terms.jobTitleId` + `departmentId` +
   `branchId`.
2. `employeeService.create` copies employment from `acceptedSnapshot.terms` and hard-codes
   `jobPositionId: null` and `sectionId: null` — the seat never flows through from recruitment.
3. `hr_evaluation_phases` is already an admin catalog (key, name, order, active, `driversOnly`),
   seeded with Security Check (1), Medical Examination (2), Driving Test (3). Phases are
   currently **sequential** (`assertPriorPhasesCleared`).
4. `hr_interview_stages` is the same pattern, seeded with First/Second Interview.
5. Uniqueness is one-shot per stage: `ux_screening_applicant` (one screening per applicant),
   `ux_applicant_phase` (one evaluation per applicant × phase), one live interview per stage.
   **Nothing can be re-attempted** — which is exactly what "return to a previous stage" needs.
6. `InterviewDoc.status` is `scheduled | completed | cancelled`. Every evaluate/decide guard
   tests `status !== 'scheduled'`. There is no "in progress".
7. Decisions are already re-settable: `interview.redecide`, `evaluation.decide` with
   `decisionHistory[]`. Rejection is not terminal — `applicantService.reactivateFromRejection`
   exists.
8. Timeline exists in two unrelated places: the generic platform audit timeline
   (`platform/audit/audit.timeline.ts`, a merged view over audit + activity) and the Employee
   File's hand-rolled milestone list (`employee-file.service.ts` — applicant registered,
   screening accepted, interviews, offer accepted, hire). Neither is a recruitment history.
9. **Web** — `apps/web/src/modules/hr/recruitment/`, mounted at top-level routes
   (`/applicants`, `/screening`, `/interviews`, `/evaluations`, `/job-offers`,
   `/hiring-documents`), one queue page + one detail page per stage. The sidebar is fully
   data-driven from the Applications catalog (`seed-navigation.ts` → `GET /platform/me/applications`);
   it renders a flat list of apps per module with **no children and no counters**.
10. `shared/ui/DataTable.tsx` already accepts `selectable / selectedIds / onToggleRow /
    onToggleAll`, and `shared/ui/BulkActions.tsx` renders a selection bar — but each page owns
    its own `useState<Set<string>>`, and only `ApplicantsListPage` uses it. There is no shared
    selection hook and no shared bulk-mutation contract (the one server bulk endpoint,
    `applicantService.bulk`, supports a single action: withdraw).
11. Platform seams available for reuse: `platform/pdf` (`renderPdfFromHtml`, chromium seam,
    already used for contracts in the **worker**), `platform/files` (`fileService.upload`,
    categories), `platform/notifications`, `platform/audit`, `unitOfWork` transactions, and
    the `hr_sequences` atomic counter used for applicant and offer numbers.
12. There is **no ZIP dependency** in `apps/api/package.json` (§8 adds one).

**Conclusion.** The refactor is additive rather than a rewrite: the stage features, gates and
catalogs stay; what changes is (a) placement becomes a first-class mutable fact, (b) stage
records gain an `attempt` so history is append-only, (c) evaluations become independent and
typed, (d) a batch aggregate and a timeline collection are added, (e) navigation/queues become
per-stage with counters, and (f) selection/bulk moves into shared infrastructure.

---

## 2. Placement: Position & Branch stay editable until hire (RW1–RW5)

### RW1 — `placement` becomes a first-class field on the Applicant

```ts
interface Placement {
  jobPositionId: ObjectId | null;   // the seat (platform job_positions) — carries its department
  jobTitleId:    ObjectId | null;   // the role name (platform job_titles)
  departmentId:  ObjectId | null;
  branchId:      ObjectId | null;
  sectionId:     ObjectId | null;
}
```

Added to `hr_applicants` as `placement`, plus `placementHistory: PlacementChange[]`.
All fields stay nullable — direct intake with no requisition must keep working (ADR-016).

**The existing top-level `applicant.branchId` remains, as the data-scope field only**
(ADR-015 scoping, all existing indexes and queries untouched). The service is its single
writer and keeps it equal to `placement.branchId` on every reassignment. No query, index or
scope rule is rewritten by this design.

**Gate:** moving to the Job Offer stage requires `placement.branchId` and at least one of
`jobPositionId` / `jobTitleId`. Everything earlier tolerates a null placement, so intake stays
as fast as it is today.

### RW2 — Reassignment is an explicit audited action, not a field edit

`POST /hr/applicants/:id/reassign` — body `{ placement, reason (required), note?, version }`,
permission **`applicant.reassign`**. It is *not* part of `PATCH /hr/applicants/:id`, so a
routine data correction can never silently move a candidate.

One transaction does all of:

1. write `placement` on the applicant and sync the scope field `branchId`;
2. append to `placementHistory[]`: `{ from, to, reason, note, by, at, sourceRef }`;
3. sync the **scope field** `branchId` on the applicant's stage records (screenings,
   interviews, evaluations, batch items, offers) so a branch-scoped HR user keeps seeing the
   candidate's full history and queues follow the candidate — this touches the scope field
   **only**, never a decision, and never a `placementSnapshot`;
4. write a `reassigned` timeline event (RW14) and an audit record;
5. if an **active offer** (`draft` / `sent`) exists, drive `jobOfferService.revise` so the offer
   terms follow the placement — a normal, versioned offer revision with its own history entry.

**Editing window (A1).** Placement is *set* at intake (optional) and *editable* from **Screening
through Offer Acceptance** — screening, every interview phase, every evaluation phase, and while
an offer is `draft` or `sent`. It requires a live applicant (`status === 'new'`) and no accepted
offer. On acceptance the window closes (RW3).

| Stage | Reassign allowed |
|---|---|
| Intake (before screening) | set on the applicant form (no reason required) |
| Screening · Interviews · Evaluations | **yes** — `applicant.reassign`, reason mandatory |
| Job Offer `draft` / `sent` | **yes** — drives an offer revision (step 5 above) |
| Offer `accepted` → hired | **no** — revise / withdraw → re-accept → hire |

### RW3 — Hiring always uses the final placement; acceptance freezes it

- `OfferTerms` gains **`jobPositionId` (nullable)** and **`sectionId` (nullable)**; the create
  form is pre-filled from the applicant's current placement and stays fully editable.
- `employeeService.create` stops hard-coding nulls and copies `jobPositionId` / `sectionId`
  from `acceptedSnapshot.terms`. The seat finally flows recruitment → employee.
- **Once an offer is `accepted`, reassignment is refused** with a business-rule error naming the
  path: withdraw or revise the offer, have it re-accepted, then hire. Rationale: the accepted
  snapshot is the contractual artifact the Employee, Contract and Payroll records descend from;
  silently changing the branch under an accepted offer would make the hire disagree with what
  the candidate accepted. **Approved (OQ-3)** — after acceptance every change goes through
  revise / withdraw → re-accept → hire, so the accepted snapshot always remains the legal
  source of truth.

### RW4 — Every stage record snapshots the placement it was created under

Every stage record gains an immutable `placementSnapshot: Placement` (+ denormalized display
names `placementLabel: { position, branch }` so historical rows render without joins even if a
position is later renamed or deactivated), written at creation and **never rewritten**.

| Record | Snapshot taken at |
|---|---|
| Screening | screening creation |
| Interview | round creation (schedule or start) |
| Evaluation | phase record opening |
| Batch item | batch item creation |
| Job Offer revision | each revision (already versioned) |

Immutable history + a mutable current placement, with the scope field as the only synced value
(RW2 step 3). "Previous stages are never rewritten" is enforced by the repository: the update
seam for these records rejects writes to `placementSnapshot`.

### RW4a — Display rule: board shows current, history shows original (A1)

One rule, applied everywhere, so nobody has to guess which placement they are looking at:

| Surface | Placement shown |
|---|---|
| Recruitment board, every stage queue, applicant list, counters, search/filters | **CURRENT** placement (`applicant.placement`) |
| Stage record detail (screening, interview round, evaluation, batch item), offer revision, timeline entry, exports of historical records | that record's **immutable `placementSnapshot`** |

Where a record's snapshot differs from the candidate's current placement, the detail view shows
both — `Recommended at the time: Cairo · Driver` next to `Current: Giza · Senior Driver` — with a
link to the timeline entry that moved it. Queue rows therefore always reflect where the candidate
stands *today*, while history never silently re-labels itself.

### RW5 — Stage-level recommendations are preserved forever

Interviews and evaluations gain an optional `recommendedPlacement: Placement | null` +
`recommendationNote: string | null`, set by the panel/reviewer when they think the candidate
fits a different seat or branch. Recommendations are **advisory data on the stage record** — they
never move the candidate by themselves.

A recommendation renders in the candidate view with an **Apply recommendation** action that
opens the RW2 reassign dialog pre-filled; accepting it records the reassignment with
`sourceRef = { kind: 'interview' | 'evaluation', id }` so the timeline shows *which* stage's
recommendation produced the move. The recommendation itself stays on the stage record forever,
accepted or not.

---

## 3. Evaluations: three independent, typed phases (RW6–RW10)

### RW6 — Independence and phase kinds

`hr_evaluation_phases` gains:

| Field | Meaning |
|---|---|
| `kind` | `'batch'` \| `'individual'` — drives the whole UX and the available actions |
| `permissionResource` | the permission resource that gates this phase (RW7); default `'evaluation'` |
| `appointmentEnabled` | the phase records an appointment date (`appointmentAt`) |
| `requiresResultDocument` | approval is blocked until a result file is attached |
| `applicability` | `'all'` \| `'driversOnly'` — replaces `driversOnly` (kept as a read alias) |

**`assertPriorPhasesCleared` is deleted.** Phases become independent: any applicable phase may
be opened, run and decided at any time once the applicant has cleared all interview rounds
(that one gate stays — evaluations are post-interview checks).

The offer gate `hasClearedRequiredEvaluations` is unchanged in meaning: every *applicable* phase
approved, driver-only phases only when opened for that applicant.

**Phase order (OQ-1, approved).** The seeded phases run in real business order, with Medical
last because it is normally the final external approval before hiring:

| # | Phase | `key` | `kind` | Permission resource |
|---|---|---|---|---|
| 1 | Security Check | `securityCheck` | `batch` | `securityCheck` |
| 2 | Driving Test | `drivingTest` | `batch` | `drivingTest` |
| 3 | Medical Check | `medicalExam` | `individual` | `medicalCheck` |

Keys are unchanged (no data moves); only `order` changes for the two swapped rows — `drivingTest`
3 → 2 and `medicalExam` 2 → 3 — which the migration performs in three steps because `order` is
uniquely indexed among active phases (§15). Since phases are now independent, `order` is display
order only and stays admin-editable.

### RW6a — Each phase is a full independent page (A4)

Every phase page is a complete workspace of its own — own route, queue, filters, actions,
permissions, export — organised into three buckets:

| Bucket | Contents |
|---|---|
| **Waiting** | applicable applicants with no decision yet at this phase (record `pending`, or eligible with no record) — the bucket the navigation counter reports |
| **Approved** | records `approved` at this phase |
| **Rejected** | records `rejected` at this phase |

Batch phases add a **Batches** strip above the buckets (open batches with their status);
Medical never shows one (RW9). Each bucket is a selectable table with the bulk actions of RW10
and RW17.

### RW7 — Per-phase permissions

Three concrete resources are declared in the HR manifest, one per business check:

| Resource | Actions |
|---|---|
| `securityCheck` | `view`, `manage`, `approve`, `reject`, `manageBatch`, `export` |
| `drivingTest` | `view`, `manage`, `approve`, `reject`, `manageBatch`, `export` |
| `medicalCheck` | `view`, `manage`, `approve`, `reject`, `export` |

A phase row points at its resource through `permissionResource`. Admin-created phases keep the
generic `evaluation` resource, so adding a phase still needs no developer.

**Back-compat rule (no role migration):** the generic grants `evaluation.view` /
`evaluation.manage` are a **superset** — holding them satisfies any phase's check. Existing
roles keep working on day one; tightening is an admin choice, not a forced migration.

### RW8 — Batch workflow (Security Check, Driving Test)

New aggregate `hr_evaluation_batches` — permanent, never hard-deleted, excluded from retention
purge.

```ts
interface EvaluationBatch {
  code: string;                       // "SEC-2026-000001" / "DRV-2026-000001" (hr_sequences, atomic)
  phaseId, phaseKey, phaseName;
  branchId: ObjectId | null;          // data scope (ADR-015)
  status: 'draft' | 'issued' | 'closed' | 'cancelled';
  title: string | null;
  scheduledFor: Date | null;          // the phase's "scheduling"
  sentAt: Date | null;                // A5 — when the batch physically went out
  expectedReturnAt: Date | null;
  returnedAt: Date | null;            // A5 — when the results came back
  items: BatchItem[];                 // immutable membership once issued
  counts: { total, pending, approved, rejected, voided };   // denormalized for lists
  package: {                          // generated artifacts (RW8b)
    status: 'none' | 'queued' | 'building' | 'ready' | 'failed';
    listPdfFileId: ObjectId | null;   // the official PDF list
    archiveFileId: ObjectId | null;   // the export package (ZIP)
    manifestCsv: string | null;
    builtAt: Date | null; error: string | null;
  };
  returnedDocuments: { fileId, fileName, note, uploadedBy, uploadedAt }[];
  issuedAt/By, closedAt/By, cancelledAt/By/Reason;
}

interface BatchItem {
  applicantId, applicantCode, applicantName;
  evaluationId;                       // the per-applicant evaluation record this item drives
  placementSnapshot: Placement;       // RW4
  result: 'pending' | 'approved' | 'rejected' | 'voided';
  reason: string | null;              // mandatory on reject/void
  resultFileId: ObjectId | null;
  decidedBy, decidedAt;
}
```

**Lifecycle**

```
draft ──add/remove applicants──▶ draft
draft ──issue──▶ issued ──(results uploaded, items decided)──▶ closed
  │                 └── every item decided ⇒ "ready to close" (HR closes explicitly)
  └──cancel──▶ cancelled          issued ──cancel(reason)──▶ cancelled
```

**A5 — what a batch always carries:** the generated **PDF list**, the **attached applicant
files**, its **status**, its **sent date** (`sentAt`, set on issue or recorded later),
its **returned date** (`returnedAt`, set on the first results upload), and the **uploaded result
files** (`returnedDocuments[]` + per-item `resultFileId`). Batches are **never deleted and never
purged** — the complete batch history stays available permanently, including cancelled ones.

- Creating/issuing a batch **opens the underlying per-applicant evaluation record** for each
  item (existing idempotent `evaluationService.open`), so a batch never becomes a second source
  of truth: the evaluation record stays the applicant's phase result, and deciding a batch item
  decides that evaluation through the existing service (one writer, one audit trail, one event).
- **Membership is frozen at issue.** Afterwards an item may only be *voided* with a reason
  (e.g. the candidate withdrew) — nothing is removed, nothing is deleted, ever.
- Eligibility for inclusion: live applicant, all interviews cleared, phase applicable, no
  approved record for that phase, not already in another open batch of the same phase.

**RW8b — Generated package (async, worker-side, like contract PDFs)**

Issuing emits `hr.evaluationBatch.packageRequested`; the **worker** builds:

1. **Official PDF list** — rendered from an HTML template through the existing
   `renderPdfFromHtml` seam: company branding header, batch code, phase name, branch, issue
   date, and a numbered table (applicant code, name, national ID, position, branch, notes) plus
   a signature block. Stored via `fileService.upload` in a new `hr-evaluation-batches` category.
2. **Applicant attachments** — each item's relevant files (photo, national-ID scans, CV) pulled
   from the Files service.
3. **Export package** — one ZIP: `list.pdf`, `manifest.csv`, and `attachments/<applicantCode>/…`.
   Requires a new API dependency **`archiver`** (streaming, MIT) — the one new runtime dep in
   this design.

If the chromium driver is disabled (`pdfDriverEnabled === false`) the batch still issues: the
package reports `failed` with a readable reason and the print view remains the export path —
the same graceful degradation contracts uses. Package build is **retryable** from the UI.

**RW8c — Returning results.** `POST /hr/evaluation-batches/:id/results` uploads one or more
returned documents against the batch (multipart, Files service), then items are decided
individually or in bulk (RW10). A per-item result file may also be attached.

### RW9 — Medical Check stays individual

No batch surface at all for `kind: 'individual'`. The queue lists applicants awaiting the
phase; HR opens the record, optionally sets `appointmentAt`, uploads the medical result
directly onto the evaluation record (existing `uploadFile`), and approves/rejects with a
reason. Bulk approve/reject from the queue still applies (RW10).

### RW10 — Bulk approve / reject / single actions

One consistent server contract for all three phases:

| Endpoint | Body | Notes |
|---|---|---|
| `POST /hr/evaluations/:id/decide` | `{ decision, reason?, version }` | exists; reason mandatory on reject |
| `POST /hr/evaluations/bulk` | `{ phaseId, ids[], action: 'approve' \| 'reject', reason? }` | reason **mandatory** for reject |
| `POST /hr/evaluation-batches/:id/items/bulk` | `{ applicantIds[], action, reason? }` | same shape, batch-scoped |

Every bulk endpoint returns the shared partial-success envelope (RW17):
`{ requested, succeeded, failed, results: [{ id, ok, error? }] }`. Bulk is a loop over the
single-item service method — identical rules, identical audit, identical events, no second code
path. Rejection removes the applicant from the pipeline exactly as a single rejection does today.

---

## 4. Interviews (RW11–RW12)

### RW11 — A page per interview stage

Stages stay admin-configurable; the UI becomes flat and per-stage:

```
Interviews
├── First Interview   (18)
├── Second Interview  (7)
└── Final Interview   (3)      ← whatever the catalog holds, in `order`
```

Routes (chosen so existing deep links keep working):

| Route | Page |
|---|---|
| `/interviews` | redirects to the first active stage |
| `/interviews/stage/:stageKey` | that stage's queue — own filters, own actions, own export |
| `/interviews/stages` | stage catalog admin (unchanged) |
| `/interviews/:id` | round detail (**unchanged**; matched after the two literals above) |

Each stage page has its own filters (status, outcome, interviewer, branch, date range,
placement), its own scheduling and start actions, and its own selection + bulk actions —
organised into **four buckets (A3)**:

| Bucket | Contents | Primary actions |
|---|---|---|
| **Waiting** | applicants eligible for this stage with no round yet (derived: previous stage passed / screening accepted) — the bucket the navigation counter reports | Schedule · **Start now** |
| **Scheduled** | rounds `scheduled` at this stage | Start · Reschedule · Reassign panel · Cancel |
| **In Progress** | rounds `inProgress` at this stage | Open form · Submit evaluation · Decide |
| **Completed** | rounds `completed` (passed/failed) + `cancelled` | View · Re-decide · Start next phase |

The same four buckets are returned by the counters endpoint (RW15), so the tab badges and the
navigation number never disagree.

### RW12 — Start Interview

`INTERVIEW_STATUSES` becomes `scheduled | inProgress | completed | cancelled`, and the model
gains `startedAt` / `startedBy`.

| Action | Endpoint | Effect |
|---|---|---|
| **Start now** (no round yet) | `POST /hr/interviews/start` `{ applicantId, stageId, location?, notes?, interviewerIds? }` | creates the round with `status: 'inProgress'`, `scheduledAt = now`, `startedAt = now`, `startedBy = ctx.userId`, panel = **the authenticated user** (plus any extras), then the client opens the interview form immediately |
| **Start** (round already scheduled) | `POST /hr/interviews/:id/start` `{ version }` | `scheduled → inProgress`, records `startedAt/By`; adds the caller to the panel if absent |
| Schedule | `POST /hr/interviews` | unchanged — scheduling remains available separately |

**A3 — nothing is typed by hand.** Start assigns the **currently authenticated user** as the
interviewer, stamps `startedAt` with the server clock, and flips the round to **In Progress** in
one action. Interviewer, start time and status are **server-set and not editable in the form** —
the interviewer opens the evaluation form and records their assessment, nothing else.

- New permission **`interview.start`**.
- Entry gates are the existing ones, unchanged: Screening → first stage requires an accepted
  screening; Interview N → N+1 requires stage N passed. Start is available from the screening
  queue (Start First Interview) and from a passed round (Start Next Interview).
- Guards that currently demand `status === 'scheduled'` accept `scheduled | inProgress` for
  evaluate / skip / decide / reassign-panel; **reschedule stays `scheduled`-only** (a round in
  progress is not rescheduled, it is completed or cancelled).
- Emits `hr.interview.started` and a `interviewStarted` timeline event.

---

## 5. Return to a previous stage (RW13)

`POST /hr/applicants/:id/return-to-stage`, permission **`applicant.returnToStage`**.

```ts
{ target: { kind: 'screening' | 'interview' | 'evaluation' | 'jobOffer', refId?: string },
  reason: string,        // MANDATORY
  version: number }
```

**Mechanism — re-attempt, never rewrite.** Stage records gain `attempt: number` (default 1) and
`supersededAt / supersededBy / supersededByReturnId`. Returning to a stage:

1. records a `returnedToStage` timeline event (who, when, reason, from-stage → to-stage,
   placement) and an audit entry;
2. **supersedes** the applicant's active forward-stage records — scheduled/in-progress
   interviews after the target are cancelled with the return reason; an active offer is
   withdrawn with the return reason; decided evaluations/interviews after the target are flagged
   `supersededAt` so gating ignores them **while keeping every field, file and decision intact**;
3. **opens a new attempt** at the target stage (`attempt = max(attempt) + 1`) carrying the
   applicant's *current* placement as its `placementSnapshot`;
4. leaves the workflow to continue normally from there — the existing gates read the latest
   non-superseded attempt.

**Rules**

- Target must be strictly *before* the applicant's furthest reached stage.
- Blocked once an **Employee exists** for the applicant (post-hire changes belong to the
  Employee module's personnel actions), and while the applicant is `withdrawn`.
- **Nothing is ever deleted or modified (A8).** Every previous decision, attachment, interview
  round, evaluation record, batch item and offer keeps every field exactly as it was; the only
  write to a superseded record is the `supersededAt/By/ByReturnId` marker. The candidate view
  and the timeline keep showing them, visibly flagged as superseded, with the attempt number and
  a link to the return event that superseded them — the complete history is always visible.
- Batch items belonging to a superseded evaluation are voided with the return reason (the batch
  itself and its history are untouched).

**Index changes this forces** (§8): `ux_screening_applicant` and `ux_applicant_phase` become
unique on `(applicantId, attempt)` / `(applicantId, phaseId, attempt)`, with a second partial
unique index guaranteeing **at most one non-superseded active record per stage**.

---

## 6. Candidate timeline (RW14)

New append-only collection **`hr_recruitment_timeline`** — the complete recruitment history.

```ts
interface RecruitmentTimelineEntry {
  applicantId, applicantCode;
  at: Date;
  actorUserId: ObjectId | null;  actorName: string;      // denormalized, survives user renames
  type: RecruitmentTimelineType;                          // closed enum, below
  stage: { kind, refId, name: LocalizedString } | null;   // which stage the event belongs to
  fromStatus: string | null;  toStatus: string | null;
  placement: Placement | null;  placementLabel: { position, branch } | null;
  entityRef: { entityType, entityId } | null;             // deep link target
  reason: string | null;  note: string | null;
  metadata: Record<string, unknown>;
  sourceKey: string;                                      // deterministic idempotency key
  branchId: ObjectId | null;                              // data scope
}
```

`type` covers: `applied`, `identityVerified`, `screeningOpened`, `screeningDecided`,
`interviewScheduled`, `interviewStarted`, `interviewCompleted`, `interviewCancelled`,
`evaluationOpened`, `evaluationScheduled`, `evaluationDecided`, `batchAdded`, `batchIssued`,
`batchResultRecorded`, `offerDrafted`, `offerSent`, `offerRevised`, `offerAccepted`,
`offerRejected`, `offerWithdrawn`, `offerExpired`, `hired`, **`positionChanged`**,
**`branchChanged`**, `returnedToStage`, `withdrawn`, `rejected`, `restored`, `note`.

**A2 — every movement, one chronological stream.** A reassignment writes **one entry per changed
dimension** (`positionChanged` and/or `branchChanged`), sharing a `correlationId` so the UI can
group them into a single "Reassigned" card while each dimension stays independently queryable.
Worked examples of what the stream reads like:

| Timeline row | Source |
|---|---|
| Screening completed — *accepted* | `screeningDecided`, from `pending` → `accepted` |
| Position changed — *Driver → Senior Driver* | `positionChanged` (reason mandatory) |
| Branch changed — *Cairo → Giza* | `branchChanged` (same `correlationId`) |
| Interview scheduled — *Second Interview, 12 Aug 10:00* | `interviewScheduled` |
| Interview started — *by Ahmed Samir* | `interviewStarted` (RW12) |
| Interview finished — *passed* | `interviewCompleted`, `scheduled`/`inProgress` → `completed` |
| Offer sent — *JO-2026-000123* | `offerSent` |
| Offer accepted | `offerAccepted` |
| Security approved | `evaluationDecided`, phase = Security Check → `approved` |
| Medical rejected — *reason* | `evaluationDecided`, phase = Medical Check → `rejected` |

The collection is **append-only and permanent**: entries are never updated or deleted, the
collection is excluded from retention purge, and superseded stages (RW13) keep their entries with
a `superseded` marker rather than losing them.

**Writing.** One helper, `recruitmentTimeline.record(...)`, called by every workflow transition —
the single writer. Where the operation already runs in `unitOfWork`, the entry is written inside
the same transaction; elsewhere it is written immediately after the state change, and a failure
is logged rather than failing the business operation. A unique index on `sourceKey` makes writes
idempotent, and a **nightly reconciliation task** (`hr.recruitment.timelineRepair`)
deterministically re-derives any missing entry from the aggregates — so a dropped write is
self-healing, and the timeline can never silently lose history.

**Reading.** `GET /hr/applicants/:id/timeline` (gated by `applicant.view` + data scope) returns
entries newest-first with resolved user, position and branch display names. Rendered with the
existing `shared/ui/Timeline` component on a **Timeline tab** of the applicant detail page, with
each entry showing date & time, user, action, previous → new status, position, branch and notes.

**Consolidation.** The Employee File's hand-rolled milestone derivation reads from this
collection instead (keeping its BD-007 graceful degradation), so recruitment history has exactly
one source. The platform audit timeline is unchanged and remains the technical/security trail —
this is the *business* history.

**Backfill.** The boot migration derives historical entries from existing applicants,
screenings, interviews, evaluations, offers and employees, keyed by `sourceKey` so it is
idempotent and re-runnable.

---

## 7. Stage counters (RW15)

**One aggregated endpoint**, never one request per stage:

`GET /hr/recruitment/stage-counts?branchId=` →

```jsonc
{ "stages": [
  { "key": "applicants",           "kind": "applicants", "refId": null, "count": 122,
    "buckets": { "new": 122 } },
  { "key": "screening",            "kind": "screening",  "refId": null, "count": 18,
    "buckets": { "waiting": 18, "accepted": 240, "rejected": 61 } },
  { "key": "interview:<stageId>",  "kind": "interview",  "refId": "…", "name": {…}, "count": 10,
    "buckets": { "waiting": 10, "scheduled": 6, "inProgress": 2, "completed": 143 } },
  { "key": "evaluation:<phaseId>", "kind": "evaluation", "refId": "…", "name": {…}, "count": 6,
    "buckets": { "waiting": 6, "approved": 88, "rejected": 12 } },
  { "key": "jobOffers",            "kind": "jobOffer",   "refId": null, "count": 5,
    "buckets": { "waiting": 5, "sent": 7, "accepted": 31 } },
  { "key": "employeesReady",       "kind": "employeesReady", "refId": null, "count": 2,
    "buckets": { "waiting": 2 } }
] }
```

**`count` is always the `waiting` bucket** — "applicants currently waiting there" — so the number
in the navigation is exactly the number of rows in the page's first tab. The other buckets ride
along in the same response to fill the tab badges, costing no extra round trip.

**Queue definitions** (`waiting` = the next action has not been taken):

| Stage | `waiting` counts |
|---|---|
| Applicants | live applicants with no screening yet |
| Screening | screenings `pending` (latest attempt) |
| Interview stage *S* | applicants eligible for *S* with no round yet (existing "awaiting" derivation) |
| Evaluation phase *P* | applicable applicants who cleared interviews with no decision at *P* (record `pending` or no record) |
| Job Offers | applicants moved to offer with no blocking offer |
| **Employees Ready** (A6) | applicants with an **accepted offer and no Employee yet** — the hire queue, gated by `employee.create` |

**Efficiency.** Six `$group` aggregations (one per collection) plus the derived-eligibility
counts, issued in parallel inside one request, all served by existing indexes
(`ix_status_createdAt`, `ix_applicant_stage`, `ix_phase_status`, `ix_branchId_status`). Results
are scoped by the caller's data scope and **filtered by permission** — a stage the caller cannot
view is omitted entirely, not returned as zero, so the navigation never advertises a queue the
user cannot open.

**Freshness.** The web keeps one React Query key `['recruitment', 'stage-counts', branchId]`
with a short `staleTime`; a shared `invalidateRecruitment()` helper is called by *every*
recruitment mutation (approve, reject, decide, schedule, start, move, hire, reassign, return,
bulk, batch issue/close), so counters update automatically after every action.

---

## 8. Navigation (RW16)

**Decision: the flat stage menus are rendered from one server source and shown in two places,
with no change to the platform Applications catalog.**

- The Applications catalog keeps exactly one entry per family (`Interviews`, `Evaluations`, …) —
  it stays the administrator's control over *which apps a user sees*, which is what it is for.
- The web sidebar gains a generic, client-side **nav-children provider registry**: a module may
  register a provider for an app route that returns `{ key, label, route, count }[]`. The
  recruitment module registers providers for `/interviews` and `/evaluations` fed by
  `GET /hr/recruitment/stage-counts` (one query, shared cache). The sidebar renders the counter
  on every recruitment item and nests the stage children under their family:

  ```
  Applicants        (122)
  Screening          (18)
  Interviews
  ├── Phase 1        (10)
  ├── Phase 2         (4)
  └── Final           (2)
  Evaluations
  ├── Security        (6)
  ├── Driving         (3)
  └── Medical         (1)
  Job Offers          (5)
  Employees Ready     (2)
  ```

- The **same hook** renders an in-page stage rail on every stage page, so the flat navigation is
  consistent whether the user is in the sidebar or already inside the module. One data source,
  two surfaces, zero duplication.
- Children respect permissions (the server omits stages the caller cannot view) and collapse to
  nothing when the provider has no data — the sidebar degrades to today's behaviour.

**Rejected alternative (OQ-2, decided):** storing stage children as catalog Applications.
Rejected by the approver — *the recruitment workflow is dynamic business data, not platform
navigation metadata*. Seeding stages as apps would fork the catalog every time HR adds a phase
or renames a stage, and every counter change would become a DB write.

Web routes added: `/interviews/stage/:stageKey`, `/evaluations/phase/:phaseKey`,
`/evaluations/phase/:phaseKey/batches`, `/evaluations/batches/:id`. `/evaluations` and
`/interviews` redirect to their first accessible stage.

---

## 9. Bulk-action infrastructure (RW17)

Built **once** in `apps/web/src/shared/ui/`, then adopted:

| Piece | Contract |
|---|---|
| `useTableSelection<T>({ rowKey, pageRows })` | `{ selectedIds, isSelected, toggleRow, toggleAllOnPage, clear, count, allOnPageSelected, someOnPageSelected }` — selection survives paging; explicit `clear()` |
| `DataTable` | gains one `selection?: TableSelection` prop that wires the header/row checkboxes; the current four loose props stay as deprecated aliases for one release |
| `BulkActionBar` | extends today's `BulkActions`: declarative `actions: { key, label, tone, permission, confirm?: { reasonRequired } }[]`, sticky, shows "N selected · Select all on page · Clear" |
| `useBulkMutation` | posts `{ ids, action, reason? }` to a module's bulk endpoint, renders the partial-success summary toast ("18 succeeded, 2 failed"), lists failures with their reasons, invalidates the module's queries |
| `BulkActionResultDto` (contracts) | `{ requested, succeeded, failed, results: [{ id, ok, error? }] }` — promoted from the existing applicant bulk shape, reused by every module |

Server side, the convention is fixed: `POST <resource>/bulk` with `{ ids, action, reason? }`,
looping the single-item service method (same permissions, same audit, same events), returning
the shared envelope. Partial success is normal and is reported per id — never an all-or-nothing
transaction across candidates.

**A7 — every recruitment table is multi-select, with the bulk actions that make business sense
there.** No recruitment surface requires repeating an action row by row:

| Table | Bulk actions | Endpoint |
|---|---|---|
| Applicants | move to screening · move to offer · export · withdraw · **reassign** (position/branch, one reason) | `POST /hr/applicants/bulk` |
| Screening queue | approve · reject (reason) · export | `POST /hr/screenings/bulk` |
| Interviews — Waiting | **schedule** (one date/panel for all) · **start** · export | `POST /hr/interviews/bulk-schedule`, `/bulk-start` |
| Interviews — Scheduled | **assign / reassign panel** · reschedule · cancel (reason) · export | `POST /hr/interviews/bulk` |
| Interviews — In Progress / Completed | decide (pass/fail + notes) · export | `POST /hr/interviews/bulk` |
| Evaluation phase — Waiting | approve · reject (reason) · **generate batch** (batch phases) · export | `POST /hr/evaluations/bulk`, `POST /hr/evaluation-batches` |
| Evaluation phase — Approved / Rejected | re-decide (reason) · export | `POST /hr/evaluations/bulk` |
| Batch items | approve · reject (reason) · void (reason) · export | `POST /hr/evaluation-batches/:id/items/bulk` |
| Job Offers | send · withdraw (reason) · export | `POST /hr/job-offers/bulk` |
| Employees Ready | hire · export | `POST /hr/employees/bulk-hire` |
| Batches list | export · close | `POST /hr/evaluation-batches/bulk` |

Every one of them is the same loop-the-single-service-method pattern with the same
partial-success envelope, the same permission checks, the same audit trail and the same timeline
entries — a bulk action can never do something its single-row equivalent could not.
**Generate batch** is the one bulk action that creates rather than mutates: it drafts a batch
from the current selection (RW8) and opens it.

Outside recruitment, every existing DataTable gains the selection capability from the shared
infrastructure; Employees, Leave and Contracts adopt their own bulk *operations* when next
touched — inventing bulk semantics for them here would be scope creep.

---

## 10. Domain model summary

| Collection | Change |
|---|---|
| `hr_applicants` | **+** `placement`, `placementHistory[]`; `branchId` documented as the synced scope mirror |
| `hr_screenings` | **+** `attempt`, `placementSnapshot`, `supersededAt/By/ByReturnId` |
| `hr_interviews` | **+** `attempt`, `placementSnapshot`, `recommendedPlacement`, `recommendationNote`, `startedAt/By`, `supersededAt/By/ByReturnId`; `status` gains `inProgress` |
| `hr_evaluations` | **+** `attempt`, `placementSnapshot`, `recommendedPlacement`, `recommendationNote`, `batchId`, `appointmentAt`, `supersededAt/By/ByReturnId` |
| `hr_evaluation_phases` | **+** `kind`, `permissionResource`, `appointmentEnabled`, `requiresResultDocument`, `applicability` |
| `hr_job_offers` | **+** `terms.jobPositionId`, `terms.sectionId` (nullable, in terms → revisions → accepted snapshot) |
| `hr_evaluation_batches` | **NEW** (RW8) |
| `hr_recruitment_timeline` | **NEW** (RW14) |
| `hr_employees` | no schema change — `jobPositionId`/`sectionId` now actually populated at hire |

**Index changes**

- `hr_screenings`: drop `ux_screening_applicant`; add `ux_applicant_attempt {applicantId, attempt}`
  and partial unique `ux_active_screening {applicantId}` where `supersededAt: null, isDeleted: false`.
- `hr_evaluations`: drop `ux_applicant_phase`; add `ux_applicant_phase_attempt
  {applicantId, phaseId, attempt}` and partial unique `ux_active_evaluation {applicantId, phaseId}`
  where `supersededAt: null, isDeleted: false`; add `ix_batchId`.
- `hr_interviews`: add `ix_stage_status {stageId, status}` (per-stage queues + counters),
  `ix_applicant_stage_attempt`.
- `hr_evaluation_batches`: `ux_code`, `ix_phase_status`, `ix_branchId_status`, `ix_items_applicantId`.
- `hr_recruitment_timeline`: `ux_sourceKey`, `ix_applicant_at {applicantId, at: -1}`, `ix_branchId_at`.

**New dependency:** `archiver` (API, for the batch export package). No other runtime dep.

---

## 11. Permissions

| Key | Purpose |
|---|---|
| `applicant.reassign` | change position/branch of a live candidate (RW2) |
| `applicant.returnToStage` | return a candidate to an earlier stage (RW13) |
| `interview.start` | start an interview immediately (RW12) |
| `securityCheck.{view,manage,approve,reject,manageBatch,export}` | Security Check phase |
| `drivingTest.{view,manage,approve,reject,manageBatch,export}` | Driving Test phase |
| `medicalCheck.{view,manage,approve,reject,export}` | Medical Check phase |

Unchanged and still authoritative: `applicant.*`, `screening.*`, `interview.*`,
`interviewStage.manage`, `evaluationPhase.manage`, `jobOffer.*`, `employee.*`. The generic
`evaluation.view` / `evaluation.manage` remain as the compatibility superset (RW7). The
timeline is readable under `applicant.view`. `scripts/gen-permission-matrix.mjs` regenerates
`docs/06-security/permission-matrix.generated.md` as part of the PR.

Data scope is unchanged throughout: every new collection carries `branchId` and goes through the
existing scoped base repository (ADR-015).

---

## 12. Events

New (ADR-008 naming, versioned payloads):

| Event | Payload |
|---|---|
| `hr.applicant.reassigned` | applicantId, code, from, to, reason, sourceRef? |
| `hr.applicant.returnedToStage` | applicantId, code, fromStage, toStage, reason |
| `hr.interview.started` | interviewId, applicantId, applicantCode, stageOrder, startedBy |
| `hr.evaluationBatch.created` / `.issued` / `.closed` / `.cancelled` | batchId, code, phaseKey, itemCount |
| `hr.evaluationBatch.packageRequested` | batchId — **worker** subscription builds the PDF + ZIP |
| `hr.evaluationBatch.packageReady` / `.packageFailed` | batchId, fileIds \| error |
| `hr.evaluationBatch.resultsUploaded` | batchId, documentCount |

Existing events keep their names and payloads. Notifications: batch issued / results uploaded
(to the phase's viewers) reuse the existing template mechanism; interview start reuses the panel
notification path. All fire-and-forget, never blocking the business operation.

---

## 13. API surface

**Applicants**
```
POST   /hr/applicants/:id/reassign            { placement, reason, note?, version }
POST   /hr/applicants/:id/return-to-stage     { target, reason, version }
GET    /hr/applicants/:id/timeline            → RecruitmentTimelineEntryDto[]
POST   /hr/applicants/bulk                    { ids, action, reason? }   (existing; extended)
```
**Recruitment workflow**
```
GET    /hr/recruitment/stage-counts?branchId=  → aggregated counters (RW15)
```
**Interviews**
```
POST   /hr/interviews/start                    { applicantId, stageId, location?, notes?, interviewerIds? }
POST   /hr/interviews/:id/start                { version }
GET    /hr/interviews?stageId=…&bucket=…       (existing; per-stage queues, four buckets)
POST   /hr/interviews/bulk                     { ids, action: 'cancel'|'decide'|'reassignPanel', reason?, … }
POST   /hr/interviews/bulk-schedule            { applicantIds[], stageId, scheduledAt, interviewerIds[] }
POST   /hr/interviews/bulk-start               { applicantIds[], stageId }
PATCH  /hr/interviews/:id/recommendation       { recommendedPlacement, note, version }
```
**Screening · Job Offers · Employees Ready (bulk, A7)**
```
POST   /hr/screenings/bulk                     { ids, action: 'approve'|'reject', reason? }
POST   /hr/job-offers/bulk                     { ids, action: 'send'|'withdraw', reason? }
POST   /hr/employees/bulk-hire                 { jobOfferIds[], hiringDate? }
```
**Evaluations**
```
GET    /hr/evaluations?phaseId=…               (existing; per-phase queues)
POST   /hr/evaluations/bulk                    { phaseId, ids, action, reason? }
PATCH  /hr/evaluations/:id/appointment         { appointmentAt, version }
PATCH  /hr/evaluations/:id/recommendation      { recommendedPlacement, note, version }
GET    /hr/evaluations/export?phaseId=…        per-phase CSV report
```
**Batches**
```
POST   /hr/evaluation-batches                  { phaseId, title?, scheduledFor?, applicantIds[] }
GET    /hr/evaluation-batches?phaseId=&status= list (paged, scoped)
GET    /hr/evaluation-batches/:id              detail
POST   /hr/evaluation-batches/:id/items        { applicantIds[] }        (draft only)
DELETE /hr/evaluation-batches/:id/items/:applicantId                     (draft only)
POST   /hr/evaluation-batches/:id/issue        { version, sentAt? } → queues the package
PATCH  /hr/evaluation-batches/:id              { title?, scheduledFor?, sentAt?, expectedReturnAt?, version }
POST   /hr/evaluation-batches/:id/package/retry
GET    /hr/evaluation-batches/:id/package      → download (PDF / ZIP)
POST   /hr/evaluation-batches/:id/results      multipart: returned documents
POST   /hr/evaluation-batches/:id/items/bulk   { applicantIds[], action, reason? }
POST   /hr/evaluation-batches/:id/items/:applicantId/decide { result, reason?, version }
POST   /hr/evaluation-batches/:id/close        { version }
POST   /hr/evaluation-batches/:id/cancel       { reason, version }
```
All new endpoints: Zod-validated (`.strict()`), permission-gated, data-scoped, optimistic
`version`, audited.

---

## 14. UI inventory

| Page | Notes |
|---|---|
| Applicant detail — **Placement card** | current position/branch, Reassign action, placement history |
| Applicant detail — **Timeline tab** | RW14, full history with filters |
| Applicant detail — **Return to stage** action | reason-mandatory dialog with consequence preview |
| `/interviews/stage/:stageKey` | per-stage queue, filters, Schedule / **Start now**, selection + bulk |
| Interview detail | start button, in-progress state, recommendation panel |
| `/evaluations/phase/:phaseKey` | per-phase queue; batch phases show a Batches strip |
| `/evaluations/phase/:phaseKey/batches` | batch list; New Batch (multi-select applicants) |
| `/evaluations/batches/:id` | items table, package downloads, upload results, per-item + bulk approve/reject |
| Stage rail | flat stage navigation with counters, on every recruitment page |
| Sidebar | nested stage children with counters (RW16) |

All screens: RTL-safe, ar/en i18n keys added for every new string, permission-gated actions,
existing `ListView`/`FilterBar`/`DataTable`/`Dialog` kit — no new UI primitives beyond the
selection/bulk infrastructure in RW17.

---

## 15. Migration & backward compatibility

**Boot migration** (idempotent, extends `recruitment.migration.ts`, runs on every boot):

1. `attempt: 1` and `supersededAt: null` backfilled on screenings, interviews, evaluations.
2. `placement` backfilled on applicants from `branchId` (position/title null); `placementSnapshot`
   backfilled on stage records from the applicant's branch at that time; offers backfilled from
   their own terms.
3. Evaluation phases backfilled: `kind` (security/driving → `batch`, medical → `individual`,
   others → `individual`), `permissionResource`, `applicability` from `driversOnly`.
3b. **Phase reorder to business order (OQ-1)** — `drivingTest` 3 → 2, `medicalExam` 2 → 3.
   `ux_active_order` is unique among active phases, so the migration moves the two rows through
   a temporary high order in three steps (`medicalExam` → 900, `drivingTest` → 2,
   `medicalExam` → 3), guarded by a check that the current orders are the pre-migration values
   so an admin who has already reordered them is never overridden. Idempotent and logged.
4. Offer terms backfilled with `jobPositionId: null`, `sectionId: null`.
5. Index migration: drop the two one-shot unique indexes, create the attempt-based and
   active-partial replacements (guarded, logged, safe to re-run).
6. Timeline backfill from existing records, keyed by `sourceKey`.
7. New Files category `hr-evaluation-batches`; new notification templates ensured.

**Backward compatibility**

- Every existing endpoint keeps its path, shape and semantics. `GET /hr/evaluations` and
  `GET /hr/interviews` remain the unfiltered lists; per-stage pages are filtered views.
- `/evaluations` and `/interviews` web routes redirect instead of 404-ing; `/interviews/:id`
  detail links keep working.
- `INTERVIEW_STATUSES` gains a value — consumers are tolerant readers (ADR-008); the web handles
  the new state, and existing filters are unaffected.
- No role migration: generic `evaluation.*` grants satisfy the new per-phase checks (RW7).
- `driversOnly` remains readable as an alias of `applicability`.
- Sequential evaluation ordering is removed — the deliberate behaviour change in this refactor
  (RW6). Any applicant mid-pipeline simply gains access to the other phases; nothing is invalidated.
- The DataTable's four loose selection props stay as deprecated aliases for one release.

---

## 16. Implementation plan (single PR, ordered)

1. **Contracts** — placement types, DTOs/schemas for reassign, return-to-stage, timeline,
   batches, bulk envelope, stage counts; new permissions, events, statuses.
2. **API — placement & timeline core**: applicant placement + reassign, timeline collection +
   writer + reconciliation task, stage snapshots on all stage records.
3. **API — attempts & return-to-stage**: attempt fields, index migration, supersede semantics,
   gate updates.
4. **API — interviews**: `inProgress`, start endpoints, per-stage queries, recommendations.
5. **API — evaluations**: phase kinds + per-phase permissions, independence, appointments,
   bulk decide.
6. **API — batches**: aggregate, service, endpoints, worker package job (PDF + ZIP), Files
   category, notifications.
7. **API — stage counts** endpoint + manifest wiring (permissions, routes, collections,
   subscriptions, scheduled task, seed, migration).
8. **Web — shared infrastructure**: `useTableSelection`, `DataTable.selection`, `BulkActionBar`,
   `useBulkMutation`, nav-children provider registry, `invalidateRecruitment()`.
9. **Web — recruitment**: stage rail + sidebar children with counters, per-stage interview pages,
   per-phase evaluation pages, batch pages, placement card, timeline tab, return-to-stage dialog,
   ar/en i18n.
10. **Tests + docs** — §17, plus `docs/02-architecture/recruitment-*.md` updates, permission
    matrix regeneration, CHANGELOG.

## 17. Test plan

- **Unit**: placement transitions and guards; attempt/supersede resolution; queue-count
  derivations; timeline `sourceKey` determinism; batch state machine; bulk partial-success
  aggregation; PDF/ZIP builders with the driver disabled.
- **Integration**: reassign mid-pipeline → snapshots unchanged, active offer revised, scope
  follows, timeline recorded; reassign after acceptance → refused; return-to-stage → forward
  records superseded not deleted, new attempt opened, workflow resumes; start interview from
  screening and from stage N; independent phases run in parallel; batch issue → package →
  results → bulk decide → close; per-phase permission enforcement including the generic
  superset; stage-counts respects permissions and data scope; migration idempotency (run twice).
- **Web**: selection/bulk behaviour incl. partial failure reporting; counters refresh after every
  mutation; per-stage routing and redirects; RTL and ar/en rendering.

## 18. Risks & resolved questions

| Risk | Mitigation |
|---|---|
| Index migration on live data | Guarded, logged, re-runnable; old indexes dropped only after the new ones build |
| Timeline write loss | Deterministic `sourceKey` + nightly reconciliation rebuild |
| ZIP/PDF build cost on large batches | Worker-side, async, retryable; batch size limit (setting, default 200) |
| Removing sequential phase ordering surprises HR | Behaviour change called out in release notes; phase `order` still drives display |
| Phase reorder collides with the unique active-order index | Three-step migration through a temporary order, guarded against admin-reordered installs (§15 step 3b) |

**All open questions are resolved** (Revision 2, recorded in the header): OQ-1 → business order
Security · Driving · Medical, Medical last as the final external approval; OQ-2 → client-side
navigation provider fed by the counters endpoint, stages stay business data and never become
Platform Applications; OQ-3 → placement editing stops at Offer Acceptance, with revise / withdraw
/ re-accept as the only path afterwards so the accepted snapshot remains the legal source of truth.

## 19. Explicitly out of scope

Job requisitions; candidate self-service portal; interview scorecard/competency templates; offer
e-signature; calendar/room integration for scheduling; automated candidate ranking; bulk
operations for Employees/Leave/Contracts (infrastructure only, per RW17); post-hire changes
(owned by the Employee module's personnel actions).

---

## 20. Implementation rules — hard invariants (I1–I8)

Recorded with the freeze (Revision 2.1). These constrain **how** the approved design is built;
they change no decision above. Every one is verified by a test named in §17, and a violation is
a blocking review finding — not a judgement call.

### I1 — One source of truth

Workflow state is **never duplicated**. There is no `currentStage` field, no status mirror, no
cached stage cursor. The current state of any stage is **derived from the latest active attempt**
(`max(attempt)` where `supersededAt === null && isDeleted === false`), through one shared resolver
used by every gate, queue, counter and DTO — never re-implemented per feature.

Historical attempts are **read-only**: the repository update seam rejects any write to a record
carrying `supersededAt`, except the supersede marker itself (RW13/A8). The only intentionally
denormalized values remain the ones that already exist for display and scoping — `applicantCode`,
`applicantName`, `branchId` (scope), `placementLabel` — and each has exactly one writer.

### I2 — Everything is event-driven

**Every** workflow action emits its domain event, at the boundary of the service method that
performed it, after the state change, with a versioned payload (ADR-008):

| Action | Event |
|---|---|
| Placement changed | `hr.applicant.placementChanged` |
| Returned to a previous stage | `hr.applicant.returnedToStage` |
| Screening decided | `hr.screening.decided` |
| Interview scheduled / started / completed / cancelled | `hr.interview.scheduled` · `.started` · `.completed` · `.cancelled` |
| Evaluation approved / rejected | `hr.evaluation.approved` · `hr.evaluation.rejected` |
| Batch generated / issued / returned / closed | `hr.evaluationBatch.generated` · `.issued` · `.returned` · `.closed` |
| Offer created / sent / accepted / rejected / withdrawn | `hr.jobOffer.created` · `.sent` · `.accepted` · `.rejected` · `.withdrawn` |
| Applicant hired | `hr.applicant.hired` |

Existing event names are kept and **added to, never renamed** (`hr.evaluation.decided` continues
to fire alongside the new `approved`/`rejected` pair for one release, so current subscribers keep
working). Emission is fire-and-forget through the bus and never blocks or fails the business
operation; the timeline write (I5) is the durable record.

### I3 — Performance: one aggregation, no N+1

The recruitment dashboard and **all** navigation counters are produced by **one aggregation
pipeline** — a single round trip — rooted on `hr_applicants` with `$lookup` into screenings,
interviews, evaluations, offers and employees, and `$facet` fanning out every stage bucket at
once. No per-stage query, no per-phase query, no loop issuing queries.

Across the module: **no N+1 anywhere**. Queues resolve their display data through the existing
denormalized fields or one batched `$in` lookup per page — never one query per row. Bulk
operations load their targets in a single `$in` query before the per-item loop. Every new query
path is backed by an index named in §10, and the PR includes an `explain()` check that the
counters pipeline and every stage queue use one.

### I4 — Bulk operations are transactional and fully audited

Each item in a bulk operation executes **inside its own transaction** (`unitOfWork`): its state
change, audit entry, domain event and timeline entry all commit together, or none of them do.
A failing item rolls back completely and is reported in the partial-success envelope (RW17) —
it can never leave a half-applied record, an orphan audit row or an event without a state change.

The bulk operation **itself** also records one audit entry — actor, action, requested ids,
succeeded/failed counts, reason — so an approval of forty candidates is auditable both as forty
individual decisions and as the single administrative act that produced them.

> Per-item atomicity (not all-or-nothing across the selection) is the deliberate reading: it is
> what makes the approved partial-success envelope in RW10/RW17 possible. If a future decision
> wants a whole selection to fail as one unit, it is a one-line change to wrap the loop.

### I5 — The timeline is the single history

`hr_recruitment_timeline` is **the** chronological history of an applicant. Every screen that
shows history — applicant detail, stage details, batch detail, the Electronic Employee File,
the employee profile's recruitment section — **reads from it**. No screen keeps, derives or
re-assembles a parallel history, and the Employee File's hand-rolled milestone derivation is
deleted rather than left alongside (RW14).

One writer: `recruitmentTimeline.record(...)`. A workflow transition that does not write a
timeline entry is an incomplete implementation.

### I6 — API consistency: no follow-up refresh

Every workflow endpoint returns, in one response:

```ts
{ data: <the updated aggregate DTO>,
  workflow: WorkflowStateDto,        // derived current state (I1): stage, bucket, placement,
                                     // available actions, counters delta
  timeline: TimelineSummaryDto }     // the entries this action produced + the latest N entries
```

The frontend never issues an extra request to learn what just happened. Bulk endpoints return the
same envelope per succeeded id plus the aggregate result. Read endpoints (`GET`) are unchanged.

### I7 — UI consistency

Every recruitment table is the shared `DataTable` with the shared `useTableSelection` +
`BulkActionBar` (RW17). No bespoke table, no bespoke selection state, no per-page bulk toolbar.
A deviation requires a recorded justification in the PR description; "it was quicker" is not one.
Filters use the shared `FilterBar`, states use the shared empty/error/loading states, and every
new string ships with `ar` + `en` keys.

### I8 — Backward compatibility: automatic migration

Existing applicants migrate **automatically at boot** — the idempotent migration in §15, run by
the kernel on every start, with no manual step, no script to remember, no downtime window and no
operator action of any kind. Every applicant currently mid-pipeline keeps its exact position.

**Existing history stays accessible exactly as before**: no record is rewritten, no id changes,
every current endpoint keeps its path and response shape, every existing deep link resolves, and
every current permission keeps working (RW7's superset rule). The migration is verified by an
integration test that boots against a database seeded with pre-refactor documents, asserts the
pipeline still resolves to the same stage for every applicant, and re-runs the migration to prove
idempotency.

### I9 — Timeline identity and correlation

Every timeline entry carries **three** ids, each with exactly one job:

| Field | Job |
|---|---|
| `eventId` | The entry's own **immutable public identity** — assigned once at write, time-sortable, never reused, never changed, never recycled by a repair run. Deep links and client caches key on it. |
| `correlationId` + `correlationType` | The **episode** the entry belongs to. Entries that describe one business happening share them, so the UI groups and labels without inspecting event types. |
| `sourceKey` | Internal **idempotency/repair** key (deterministic from the source record + type). Uniquely indexed so the reconciliation task (I5) can rebuild a missing entry without ever duplicating one. Never shown. |

An episode is the subject the events are about, so `correlationId` is that subject's id and
`correlationType` names its kind:

```
correlationType: placementChange     correlationType: interview
correlationId:   <change id>         correlationId:   <interview round id>
├── branchChanged                    ├── interviewScheduled
└── positionChanged                  ├── interviewStarted
                                     └── interviewCompleted
```

The same holds for `evaluation` (opened → scheduled → decided), `batch` (added → issued →
resultRecorded), `offer` (drafted → sent → accepted), `screening`, `return` and `hire`. Filtering
by `correlationType` gives "show me all interview activity"; grouping by `correlationId` renders
one collapsible card per round, batch or offer — no client-side type-sniffing.

### I10 — One status enum per workflow object; no boolean state flags

Every workflow object exposes **exactly one** status enum. There are no `isScheduled` /
`isStarted` / `isCompleted` / `isActive` booleans anywhere — in the model, the DTO, or the query
layer — because they permit combinations the domain does not have.

| Object | The single enum |
|---|---|
| Interview | `waiting` · `scheduled` · `inProgress` · `completed` · `cancelled` |
| Evaluation | `waiting` · `approved` · `rejected` |
| Job Offer | `draft` · `sent` · `accepted` · `rejected` · `withdrawn` · `expired` · `superseded` |
| Screening | `waiting` · `accepted` · `rejected` |
| Applicant | `new` · `rejected` · `withdrawn` (unchanged) |

Consequences, all applied:

- **The status enum IS the queue vocabulary.** The separate bucket enums drafted in RW15 are
  deleted; stage tabs, list filters and counter buckets all use the status enum. `waiting` is the
  value meaning *no active record yet* — it is derived at the stage level and never persisted on
  a record (a record that does not exist cannot store a status).
- **`pending` → `waiting`** on both Evaluations and Screenings — across model, DTO and
  `decisionHistory[]` — with an idempotent boot migration rewriting stored values (I8: automatic,
  no manual step). `pending` is still accepted as a query-parameter alias for one release so
  existing links keep working.
- **Where a value is derived, it is never persisted.** `waiting` on Interviews means "no round
  exists yet", so the interview model's schema enum accepts only the persistable subset
  (`scheduled` · `inProgress` · `completed` · `cancelled`) while the DTO, filters and counters use
  the full enum. One vocabulary, with the database refusing to store a state that cannot exist.
- **Job Offer gains `superseded`** — what a return-to-stage sets on an active offer (RW13), which
  is more truthful than the withdrawal it used to record. `expired` is **kept**: the automatic
  expiry sweep is live behaviour, and the approver's list was illustrative, not a removal.
- **`JobOfferDoc.active` is deleted.** The "at most one active offer per applicant" invariant
  moves to a partial unique index on `status: { $in: ['draft', 'sent'] }`, so the invariant is
  enforced by the status itself rather than by a flag that could disagree with it. The `active`
  query filter is replaced by filtering on those statuses.
- **`placementEditable` is deleted** from the applicant and workflow DTOs. Capability belongs in
  `availableActions[]`, which already carries `enabled` + `reason`; a duplicate boolean would be a
  second source of truth (I1).
- **Supersede is a timestamp, not a flag**: `supersededAt` (with `supersededBy`,
  `supersededByReturnId`) carries when and by whom. No `isSuperseded` boolean is ever introduced;
  callers test the timestamp.
