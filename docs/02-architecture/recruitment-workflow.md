# Recruitment — Workflow (placement, stages, batches, counters)

Implementation reference for the recruitment workflow as it stands after the refactor. The
approved design is [recruitment-workflow-design.md](../12-planning/recruitment-workflow-design.md)
(decisions RW1–RW17, invariants I1–I15); this document records how it is actually built, so a
reader can navigate the code without re-deriving the design.

## 1. The shape of a stage

Every stage — screening, each interview round, each evaluation phase, the job offer — is a
**record**, and `waiting` is a persisted status on it, never the absence of a row (I11). That one
rule is what makes every queue, counter and badge a plain indexed read over a status instead of a
cross-collection derivation of who *should* be there.

Records are opened by the **queue materializer** (`recruitment/materializer/`), which reacts to
facts the workflow engine publishes. It never decides anything: the transition already did.

```
applicant registered         → screening waiting
screening accepted           → first interview stage waiting
interview passed             → next stage waiting, or every applicable evaluation phase
applicant moved to Job Offer → offer waiting
```

Each record carries the shared `stageFields` (`workflow/stage-fields.ts`): the attempt number, the
supersede markers, and an immutable `placementSnapshot` + `placementSnapshotLabel`.

## 2. The workflow engine owns every status change (I13)

`recruitment/workflow/workflow-engine.ts` is the single writer of a stage record's `status`,
`attempt` and supersede markers. A stage service updating its own domain data never touches them —
`assertNotWorkflowManaged` throws rather than silently corrupting the pipeline.

The engine writes its event to a **transactional outbox** inside the producing transaction and
publishes only after that transaction commits (I15). Consumers subscribe through
`onWorkflowEvent`; the engine itself performs no side effects.

## 3. Placement stays editable until the offer is accepted (RW1–RW5)

An applicant carries a first-class `placement` (position, title, department, branch, section) plus
`placementHistory[]`. The top-level `applicant.branchId` remains, as the **data-scope field only**
(ADR-015), kept equal to `placement.branchId` by its single writer.

**Reassignment is its own audited action**, `POST /hr/applicants/:id/reassign` behind
`applicant.reassign`, with a mandatory reason — never part of the applicant PATCH, so a routine
data correction cannot silently move a candidate. One act:

1. writes the placement and syncs the scope mirror;
2. appends to `placementHistory[]`;
3. syncs the **scope field only** on the candidate's stage records, so a branch-scoped user keeps
   seeing their whole history and the queues follow the candidate — never a decision, and never a
   `placementSnapshot`;
4. writes one timeline entry per moved dimension, under one correlation id;
5. drives a live (`draft`/`sent`) offer through a normal versioned revision.

**Where it lives, and why.** Reassignment spans every stage, and the stage features import
Applicants — so composing it from inside Applicants would close an import cycle. It lives in
`recruitment/placement/` and registers itself through the Applicants seam
(`applicants/placement-seam.ts`), exactly as the queue materializer does. `applicantService.reassign`
stays the single public entry point.

**Display rule (RW4a).** Queues, lists, counters and search show the **current** placement; a stage
record's detail, an offer revision and a timeline entry show that record's **immutable snapshot**.
History never silently re-labels itself.

Acceptance closes the editing window (RW3/OQ-3): afterwards the path is revise / withdraw →
re-accept → hire, because the accepted snapshot is the artifact the Employee, Contract and Payroll
records descend from.

## 4. Evaluations are independent, typed phases (RW6–RW10)

Phases do not run in sequence. The only entry gate is that the candidate cleared every interview
round; after that every applicable phase opens at once and may be decided in any order.

A phase declares its `kind`:

- **`batch`** (Security Check, Driving Test) — worked as a group, see §5.
- **`individual`** (Medical Check) — worked one candidate at a time: book the appointment
  (`PATCH /hr/evaluations/:id/appointment`), upload the returned report, decide.

**Per-phase permissions (RW7).** Each phase names a `permissionResource` (`securityCheck`,
`drivingTest`, `medicalCheck`), so a security officer, a driving examiner and a company doctor each
see only their own phase. The generic `evaluation.*` grants are a **superset** — holding one
satisfies any phase's check — so existing roles keep working with no migration.

## 5. Batches (RW8)

`hr_evaluation_batches` is a **coordination** record, never a second source of truth: every item
points at the candidate's ordinary per-phase evaluation, and deciding an item decides that
evaluation through the existing service — one writer, one audit trail, one event, one timeline
entry.

```
draft ──add/remove──▶ draft ──issue──▶ issued ──(results, decisions)──▶ closed
  └──cancel(reason)──▶ cancelled            issued ──cancel(reason)──▶ cancelled
```

Membership freezes at issue; afterwards an item is **voided with a reason**, never removed.
Batches are never deleted and never purged.

Issuing emits `hr.evaluationBatch.generated` on the reliable tier; the **worker** renders the
official PDF list through the chromium seam, writes a manifest CSV, and packs
`list.pdf` + `manifest.csv` + `attachments/<applicantCode>/…` into one ZIP. With the PDF driver
disabled the batch still issues and the package still builds — it reports that it holds no
`list.pdf`. The build is retryable from the UI.

## 6. Return to an earlier stage (RW13)

Nothing is deleted or edited. Forward records are **superseded** (`supersededAt` + the return's id)
and the target stage re-opens on a new `attempt`. The uniqueness rule that makes this safe is
`(applicantId, stageId, attempt)` over live rows only (I12), so a superseded attempt never collides
with its successor.

## 7. Counters and navigation (RW15/RW16)

`GET /hr/recruitment/stage-counts` returns every stage the caller may see with its live queue
count, from **one** request. `count` is always the `waiting` bucket, so the number in the
navigation is exactly the number of rows on the page's first tab; the other buckets ride along for
the tab badges. A stage the caller cannot view is **omitted**, not returned as zero.

The recruitment stage menus are dynamic business data, so the web module registers them with the
sidebar's **nav-children provider registry** (`platform/navigation/nav-children.ts`) rather than
adding rows to the Applications catalog — stages never become Platform Applications.

## 8. Bulk actions (RW17/I4)

Every recruitment bulk endpoint runs through one executor (`workflow/bulk-runner.ts`). Each item
runs its own single-item service method — same rules, same audit, same events, same timeline —
inside that method's own transaction. A failing item rolls back completely and is reported in the
envelope; the rest of the selection still applies. The bulk act itself is audited once, so an
approval of forty is auditable both as forty decisions and as one act.

The UI reports the envelope **honestly**: `bulkOutcomeMessage` says how many applied and how many
did not, never a blanket "done" over a mixed result.

## 9. Two traps worth remembering

- **A `required: true` String cannot carry `default: ''`.** Mongoose treats `''` as missing, so
  such a field can never save its own default — the bug that once silently emptied the timeline
  collection. Denormalized display names are declared `{ type: String, default: '' }`.
- **A schema-level `.refine()` answers 400, not 422.** A missing mandatory reason is a validation
  failure; only a rule the schema cannot express (an offer already accepted, a batch already
  closed) is a business-rule refusal.

## 10. Migration

`recruitment.migration.ts` runs at boot, idempotently: attempt markers, placement + labels,
`pending` → `waiting`, phase typing, phase business order, offer terms, and dropping the indexes
the new uniqueness rules replaced. Re-running it is a no-op.
