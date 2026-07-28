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

Because a queue is now a plain read over rows, a candidate who leaves the pipeline has to stop
matching one — and the only thing that may say so is the record's own **status** (I1/I10 forbid any
mirrored lifecycle field). So a lifecycle exit CLOSES the work that was still open: the engine
transitions every open stage record to a terminal status inside the lifecycle transaction —
screening and evaluation to `cancelled`, interviews to `cancelled`, a live offer to `withdrawn`.
Decided records are never touched; an accepted screening or a completed round is history.

Each closure is a real transition, so it validates against the rulebook, publishes its own event,
and lands on the timeline and the audit trail like anything else. And because every closure status
is terminal, **reactivation re-opens the stage on a fresh attempt** rather than reviving a closed
row — the departure left its trace in the status vocabulary, and the return reads it back out.

```
applicant registered         → screening waiting
screening accepted           → first interview stage waiting
interview passed             → next stage waiting, or every applicable evaluation phase
applicant moved to Job Offer → offer waiting
```

There is no second, derived "who ought to be here" read model anywhere. The `/awaiting` endpoints
that predated this rule are gone, along with their contracts and their screens.

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

### Why the counters are N parallel aggregations, not one pipeline

Two passages of the frozen design describe this endpoint, and they do not say the same thing.

**I3** says "one aggregation pipeline — a single round trip — rooted on `hr_applicants` with
`$lookup` into screenings, interviews, evaluations, offers and employees, and `$facet`". **RW15 §7
"Efficiency"** — the decision that actually specifies the counters endpoint — says "**Six `$group`
aggregations (one per collection) plus the derived-eligibility counts, issued in parallel inside one
request**, all served by existing indexes".

The tension resolves without anyone having to choose sides, because I3's sentence describes a shape
the design itself later deleted. **I11** removed the cross-collection `$lookup` outright — "the
single aggregation now groups stage records by `status` — no eligibility derivation, no
cross-collection `$lookup` to discover who *should* appear" — and a pipeline "rooted on
`hr_applicants` with `$lookup` … and `$facet`" is exactly the eligibility derivation I11 abolished.
What survives of I3 is its substance: no N+1, index-backed, one bounded pass, verified by
`explain()`. What RW15 specifies is what is shipped, verbatim.

So the implementation issues **one `$match` + `$group` per stage collection, in parallel**
(`Promise.all`). It is a fixed number of queries, never a function of row count, and each is served
from an index. Three reasons that shape is also the right one, in order of weight:

1. **A stage the caller cannot see is not queried at all.** RW15 requires such a stage to be
   *omitted*, not returned as zero. With one query per stage that is a plain permission check
   guarding the call. Inside a single `$unionWith` every branch is built into the pipeline and runs
   regardless, so the omission becomes conditional pipeline assembly — harder to read, harder to
   audit, and it does work on data the caller has no grant for.
2. **Each stage carries its own data scope.** Every collection is filtered through its own
   `ScopeSelector` (ADR-004/ADR-015), resolved per permission, and the same caller can legitimately
   resolve to a different scope on different stages. Per-collection queries keep that inside
   `BaseRepository`, which is *the one place data scopes are enforced*. Hand-assembling five scope
   filters into sub-pipelines would move that enforcement out of the only place it currently lives.
3. **It costs nothing.** The queries run concurrently, so the wall-clock cost is one round trip's
   latency, not N. That is not an assumption:
   `tests/integration/hr-recruitment-performance.spec.ts` runs both shapes over the same 2,000-row
   ×4 dataset, asserts they return identical numbers, and fails if the shipped shape is slower. The
   measurement is printed on every CI run.

The same suite makes the rest of I3 mechanical rather than aspirational. Every stage queue must
show an `IXSCAN` and never a `COLLSCAN`. Each counters aggregation must be served by
`ix_live_counters` — `{ supersededAt, isDeleted, branchId, status }` — and must touch **only rows
that match**: `totalKeysExamined` and `totalDocsExamined` both equal the size of the live set, never
the size of the collection. `supersededAt: null` is an equality bound on the index prefix, so the
retired rows sit in a key range the scan never enters — ignoring history costs nothing rather than
costing a filter, and the work is proportional to what the answer is about.

> **Two things about `null` that only `explain()` will tell you**, both learned the hard way here.
>
> The obvious index is a PARTIAL one over `{ supersededAt: null, isDeleted: false }`. It does not
> work, and it fails *silently*: MongoDB will not use a partial index for a query whose predicate is
> a `null` equality, because `$eq: null` also matches documents where the field is **missing** and
> those may not be in the index. The plan is never even generated (`rejectedPlans: []`) and the
> query collection-scans exactly as it did before the index was added.
>
> For the same underlying reason, the scan is index-**served** but not index-**only**: an index
> entry cannot distinguish a stored `null` from an absent field, so the server reads each matching
> document to confirm it. `totalDocsExamined` is therefore the live count, not zero. Both claims
> sound alike and only one of them is true, which is precisely the sort of thing a prose invariant
> cannot keep honest and a test can.

**Net: this matches RW15 §7 verbatim and satisfies I3 as I11 left it.** The one phrase it does not
match is I3's "a single round trip", which belongs to the `$lookup`-and-`$facet` pipeline I11
deleted. No approval is being claimed for a deviation here — the deviation would be building the
`$facet` pipeline, since that would reintroduce the derivation I11 removed.

## 7a. Starting a round (RW12)

Two entry points, one rule: the **server** stamps who started it and when. `POST /hr/interviews/start`
takes a CANDIDATE and a stage — the round need not exist yet, so it opens the waiting record and
begins it in one act; `POST /hr/interviews/:id/start` begins a round that was already scheduled.
Both seat the caller on the panel if they are not on it, and both record `startedAt` from the
server clock: a wrong browser clock cannot rewrite when a round began.

Screens render those moments on the **Africa/Cairo** business calendar
(`formatBusinessDateTime`), not the viewer's timezone, so a start time reads the same to everyone.

## 8. Bulk actions (RW17/I4)

Every recruitment bulk endpoint runs through one executor (`workflow/bulk-runner.ts`). Each item
runs its own single-item service method — same rules, same audit, same events, same timeline —
inside that method's own transaction. A failing item rolls back completely and is reported in the
envelope; the rest of the selection still applies. The bulk act itself is audited once, so an
approval of forty is auditable both as forty decisions and as one act.

The UI reports the envelope **honestly**: `bulkOutcomeMessage` says how many applied and how many
did not, never a blanket "done" over a mixed result.

Every recruitment table has one: applicants (withdraw, reassign), screening, the interview queue
and each stage page (schedule, start, cancel), the evaluation queue and each phase page, job
offers, batches and their items, and hiring documents (complete). The client always calls the
bulk endpoint — never a loop of single calls, which would produce no bulk audit record and no
envelope, and would leave a half-finished run behind if the tab closed.

Every one of them renders the SAME `BulkActionBar` over the SAME `useTableSelection` (I7),
including the phase board, whose cards are a table in other clothing. There is no second toolbar
and no bespoke selection state anywhere in the web app.

## 8a. One history (I5)

`hr_recruitment_timeline` is the candidate's chronological history, and it is the only one. Every
screen that shows history reads it: applicant detail, all four stage detail pages, the Electronic
Employee File, and the employee profile's recruitment section. Two components serve them —
`CandidateTimeline` fetches, filters and carries the one user-authored note; `RecruitmentTimelineList`
draws the entries and is what the Employee File reuses, fed from the `recruitmentTimeline` its own
response already carries rather than a second request.

Nothing keeps a copy. The Employee File no longer re-derives recruitment milestones (its own
timeline starts at the hire), and an evaluation no longer logs its re-decisions in
`decisionHistory[]` — that array held exactly what the timeline's `evaluationDecided` entry holds,
so two records of one fact could only ever disagree. Both are dropped, with the boot migration
cleaning up documents already written.

`ApplicantDoc.placementHistory[]` is not an exception: it is the placement record RW1 defines, not
a projection of workflow events.

Every published workflow event names its entry type, and `unmappedWorkflowEvents()` is asserted by
a unit test — an unmapped event would not fail, it would quietly land as a generic `note`, which is
a blank line where a real fact happened. `applied` and `identityVerified` are written directly by
the applicant service, because registration and verification are candidate facts rather than
workflow transitions and nothing downstream of the engine would record them.

Known gap: `batchAdded` / `batchIssued` / `batchResultRecorded` exist in the timeline vocabulary
but nothing writes them — a batch deliberately drives the ordinary evaluations, so only their
decisions reach the timeline. Showing a batch's history *as a batch* needs a read that is not
per-applicant, which is an open design question rather than a missing line of code.

## 8b. One response, no follow-up (I6)

Every recruitment workflow **mutation** answers with the same four-part envelope:

```ts
{ data,        // the updated aggregate DTO — exactly what the endpoint returned before
  workflow,    // WorkflowStateDto: where the candidate stands now + what may be done next
  timeline,    // TimelineSummaryDto: what THIS action wrote, plus the latest N entries
  counters }   // the refreshed stage counters (RW15), so the badge redraws from this response
```

Reads (`GET`) are untouched: a list is still a page, a detail is still an aggregate.

`workflow` is **derived on every response, stored nowhere** (I1). It reads the live stage rows
through the engine's stage bindings — the stage features import the workflow folder, so importing
them back would close a cycle — and reports the **furthest** stage that still has open work, which
is the truthful answer to "what happens next?". Capability lives in its `availableActions` and
nowhere else (I10): an action the caller may not perform is still listed, with `enabled: false`
and the permission it needs, because a UI that hides what it cannot explain teaches nothing.
`ACTION_PERMISSIONS` mirrors the routes' `authorize(...)` calls and is pinned against the rulebook
by a unit test, so the button the UI renders and the gate the request meets cannot drift.

`timeline.produced` is the hard part. "Entries written since I started" would be poisoned by a
concurrent request on the same candidate, so instead each writer **reports its entry as it writes**,
into an `AsyncLocalStorage` scope the request opens (`recruitment-timeline.capture.ts` — the same
mechanism the platform uses for the request id, ADR-012). Two kinds of writer report there, and
both name the entry by its `eventId`:

- the workflow **engine**, at publish time — the outbox event's id becomes the timeline entry's id
  when the projection runs, so the report can happen before the entry exists;
- the timeline **service**, for entries written outside the engine (`applied`, `identityVerified`,
  a placement change) — those have no outbox event to name them.

A projected entry is deliberately NOT reported twice: the engine already named it inside the
producing request, and reporting it again at projection time would let a foreign event — one this
request merely happened to drain from the shared outbox — into somebody else's envelope.

Two kinds of endpoint stay outside the envelope, for the same reason in both cases — there is no
single candidate whose state to report:

- **Bulk** endpoints answer with `BulkWorkflowResultDto`: the partial-success envelope plus what
  the batch wrote and the refreshed counters, but no `workflow`. A selection has no one state.
- **Batch-LEVEL** evaluation actions (create, add/remove members, issue, upload results, close,
  cancel) span every candidate in the batch. Their per-CANDIDATE siblings — deciding or voiding an
  item — do carry the full envelope.

Ordinary audited edits are not workflow actions and are unchanged: `PATCH /hr/applicants/:id`,
attachments, OCR, export, and the Electronic Employee File (an employment artifact that owns no
stage record and never moves through the engine).

## 8c. The client half: the envelope IS the refresh

The response only pays for itself if the client stops asking a second time. It does.

`invalidateRecruitment()` — which fanned seven query subtrees out to the network after every write —
is **gone**. Its replacement is `shared/workflow-cache.ts`, and every recruitment mutation goes
through the one hook that uses it, `useWorkflowMutation(feature, run)`. Applying an envelope is a
sequence of cache **writes**:

| half | written to |
| --- | --- |
| `data` | the aggregate's detail key, and its row inside every cached list page |
| `workflow` | `['hr','recruitmentWorkflow',applicantId]` — written by mutations, fetched by none |
| `timeline` | merged into every cached view of that candidate's history, newest first, by `eventId` |
| `counters` | the ONE counters key the sidebar, the stage rail and every queue badge read (I3) |

Three rules make that safe:

- **Membership stays the server's judgement.** Which rows belong on a filtered, sorted, paginated
  queue is not re-derived here — that would be a second source of truth about what a queue contains
  (I1). Cached pages are marked stale with `refetchType: 'none'`, which issues **no request** and
  lets the next mount or focus re-read them. The visible list stays correct meanwhile because the
  row is patched in place, and dropped from a page whose `status` filter it no longer satisfies —
  the one local rule worth keeping, because it is the whole reason a decided item leaves its queue
  the moment it is decided.
- **Empty counters are not written.** The server degrades `counters` to `[]` rather than failing an
  action whose transaction already committed (BD-007); blanking the navigation because a secondary
  read hiccuped would be worse than showing the previous numbers a moment longer.
- **An empty `workflow.applicantId` is not written.** That is the deliberate empty state a
  candidate-less act answers with, never a real state.

Bulk is the one place a request remains, and for the honest reason: `BulkWorkflowResultDto` carries
the counters and the entries the batch wrote, but **not the changed rows** — so the acted-on list is
re-read exactly once, while every other recruitment list is marked stale without fetching.

`useWorkflowState(applicantId)` reads the stored `workflow` half. It has no `queryFn` on purpose: a
screen that has not yet acted simply has no entry, which is the honest answer — inventing one would
mean deriving workflow state on the client, and the point of I6 is that the server derives it.

## 8d. When something goes wrong: the three recovery paths (I15, I5, I11)

Every invariant that promises durability needs something that runs *after* a failure. Two are
scheduled tasks registered in the HR manifest; the third runs at boot, because what it repairs is
created at boot too.

**`hr.recruitment.workflowOutbox`, every 5 minutes (I15).** The engine writes the aggregate change
and its event in one transaction and publishes after that transaction commits. The gap between
those two moments is small but real: a process killed inside it leaves a committed state change
whose event was never delivered — no timeline entry, no notification, no projection. Any subsequent
transition drains the whole outbox, so the system normally heals itself on the next write; this
sweep is what heals it when there is no next write. It is safe to overlap and safe to repeat:
delivery is per-event and marked, and consumers key on the immutable `eventId`.

**`hr.recruitment.timelineReconcile`, hourly (I5).** The timeline is THE history, which makes a
missing entry silent rather than loud — nothing errors, the history is simply shorter than the
truth. The repair task closes both holes that can produce one:

- an event that was committed but never projected — replayed through the same projection the
  dispatcher uses;
- an entry with **no event to replay**. Two facts are not workflow transitions and were never in
  the outbox: the application itself (`applied`) and the identity check (`identityVerified`). Both
  are written with `recordSafe`, which logs and swallows rather than failing the registration or
  the verification that produced them — on the explicit promise that reconciliation would rebuild
  them. It rebuilds them from the applicant document.

Rebuilding is safe because both halves are **keyed, not timed**: `sourceKey` is derived only from
facts that identify the happening, never from the clock or a random value, so the key a rebuild
computes is the key the original write used and the unique index turns a duplicate into a no-op. A
rebuilt row keeps its original `eventId` — the repair task re-derives `sourceKey`, never `eventId`,
because deep links and client caches key on the latter (I9). A run against a healthy database
changes nothing, however often it runs.

One honesty note in the rebuilt rows: the ACTOR of a repaired `applied` entry is `null`. It was the
request's user and the applicant document does not keep it; `null` reads as "the system", which is
truthful for a repaired row in a way that a plausible-looking guess would not be. Repaired entries
also carry `metadata.reconciled: true`.

**The waiting-row backfill, at every boot (I8/I11).** Since I11, `waiting` is a persisted row and
absence carries no meaning — which means a candidate with no row is not "waiting", they are
*invisible*: to the queue, the counter, the badge and every bulk action. Two populations have
exactly that shape. Every applicant registered before I11 existed, because the pipeline they moved
through never created the row. And any applicant whose materialization threw: materialization is a
projection run through `safely()`, which logs and swallows so a failed projection can never roll
back the decision that triggered it — on the promise that a backfill would repair it.

So `migrateRecruitmentWorkflow()` ends by walking every live applicant and resolving, **from their
own records rather than any stored cursor (I1)**, how far they got: no live screening → open it; an
accepted screening → open the first interview stage; the furthest round they passed → open what
comes after it, which for the last round is every applicable evaluation phase; `movedToOfferAt` set
→ open the offer. Each row is opened through the same `open*` method the live path uses, and each
of those returns early when the row is already there. The step runs last in the migration because
it must read the normalized shape the earlier steps produce.

It is safe on every boot for the same reason `ensureStageRecord()` is idempotent (I12): the second
run repairs nothing and writes nothing. And it never revives history — a decided screening is not a
missing one, so no second attempt appears beside it, and a withdrawn candidate is not scanned at
all, because withdrawal is a lifecycle terminal (I14) and nothing re-admits them to a queue.

`tests/integration/hr-recruitment-recovery.spec.ts` covers all three by breaking the database on
purpose — un-dispatching an event, deleting timeline entries, wedging a consumer, deleting the
stage row a live applicant stands on — and asserting the repair puts things back exactly once.

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
