# Sprint Retrospective — Recruitment Workflow Refactor (Release v0.24.0)

**Capability:** HR / Recruitment — workflow refactor against a frozen design ·
**PR:** [#85](https://github.com/egycashcompany-ops/egycash/pull/85) · **Merged:** 2026-07-28 ·
**Outcome:** ✅ Delivered — reviewed by EGYCASH, **approved**.

> **A note on the sprint number.** The retrospective series stops at Sprint 5.11 (v0.23.0). The
> capabilities that shipped between then and this release — Employee Management, Leave
> Management, Contracts, the Auth & Account Lifecycle, Organization Phase 3 — did not get their
> own numbered retrospectives, so continuing the numbering here would invent a sequence that was
> never kept. This document is titled by capability instead, deliberately.

## 1. Sprint goal

Implement `docs/12-planning/recruitment-workflow-design.md` (Revision 2.6) **in full** — 17
decisions (RW1–RW17) and 15 invariants (I1–I15) — against a **frozen** architecture. The design
was closed: the mandate was to implement, and to stop and raise a design issue rather than amend
the document to legitimize an implementation.

## 2. Delivered

The full RW1–RW17 / I1–I15 surface. Rather than restate the CHANGELOG, the parts worth keeping
in the project's memory:

- **Placement as a first-class, audited concern (RW1–RW5).** Reassignment is its own action with
  a mandatory reason, not a field edit, and it lives in `recruitment/placement/` reached through
  a seam — because composing it inside Applicants would close an import cycle with every stage
  feature.
- **Re-attempt, never rewrite (RW13/A8).** Returning to a stage supersedes forward records and
  opens a new attempt. Every previous decision, file and round keeps every field.
- **One history (I5), one bulk toolbar (I7), one engine (I13), one envelope (I6).** Each of these
  replaced a duplicate: three parallel histories, two table/selection implementations, several
  services writing `status` directly, and a seven-subtree cache invalidation after every write.
- **`waiting` became real (I11).** The single largest conceptual change: absence of a row stopped
  carrying meaning, which turned every queue and counter into a plain indexed read.
- **Recovery is now machinery, not hope (I15, I5, I8/I11).** A transactional outbox with a
  scheduled sweep, a timeline reconciler, and a boot backfill for the waiting backlog.

## 3. What went well

- **The frozen design held.** Across the whole implementation exactly one passage needed
  escalation rather than interpretation, and it turned out not to be a conflict at all (§5).
  Freezing the architecture before implementing was the right call and paid for itself.
- **Slicing by invariant, not by file.** Working I5 → I7 → I6a → I6b → gap closure kept each PR
  reviewable and each CI run diagnosable. The one slice that spanned server and client (I6) was
  deliberately split so the frontend kept working untouched while the contract changed.
- **The invariants caught real bugs before users did.** Implementing I5 surfaced that `applied`
  and `identityVerified` were in the frozen vocabulary but nothing wrote them — every candidate's
  history began mid-pipeline. Implementing I7 surfaced that the applicant bulk executor fell
  through to `reassign` for anything it did not explicitly handle, so bulk "Move to Job Offer"
  silently reassigned the selection with an undefined placement.
- **The final audit earned its place.** It was scoped as a verification pass and instead found a
  genuine gap (§4). A checklist read against the code, not against memory, is worth the hours.

## 4. What went wrong

- **A promise lived in a comment for weeks.** `queue-materializer.service.ts` said a failed
  materialization "is logged and repaired by the next boot's backfill". There was no backfill.
  The comment was written when the backfill was planned and never revisited, and because
  materialization is fire-and-forget, nothing ever failed loudly enough to expose it. **Lesson:
  a comment that names a mechanism should be a test that exercises it.**
- **Three CI failures were self-inflicted, and all three were assumptions about MongoDB or
  TanStack Query stated as fact in test assertions.** Specifically: a partial index over a
  `null`-equality predicate (never used, silently collection-scans); `totalDocsExamined === 0` on
  a scan that is index-served but not index-only; and an invalidation asserted against a cache
  entry with no active observer. Each cost a full CI cycle. **Lesson: when an assertion encodes a
  belief about a dependency's behaviour, verify the belief locally first — `explain()` and a real
  `QueryClient` are cheap.**
- **A test harness was quietly testing less than it claimed.** The recovery spec's `afterEach`
  called `resetWorkflowConsumers()`, which empties the entire consumer registry, then
  re-registered only the workflow consumers — leaving the queue materializer unsubscribed for
  every test after the first. It was invisible until a new test depended on the path it had
  disabled. **Lesson: a teardown that claims to "restore the real set" should assert that it did.**
- **The CHANGELOG's `Unreleased` section ran for eleven PRs and five capabilities.** It should
  have been cut per sprint, as the format says. The result is one oversized release and four
  missing retrospectives.

## 5. Decisions and judgement calls

- **The counters shape (I3) was nearly escalated as a deviation, and should not have been.** I3
  says "one aggregation pipeline — a single round trip — rooted on `hr_applicants` with
  `$lookup` … and `$facet`"; the shipped code issues one grouped aggregation per stage
  collection in parallel. That looked like a deviation needing approval, and was documented as
  one. It is not: **RW15 §7 specifies the parallel shape verbatim**, and the `$lookup`/`$facet`
  pipeline I3 describes is precisely the eligibility derivation that **I11 deleted**. Building it
  would have been the deviation. The lesson is procedural: when two passages of a frozen document
  disagree, read the more specific decision and check whether a later invariant already
  superseded the general one — before asking for an approval that is not needed.
- **The I1 guard is a filter inside the atomic write, not a pre-check.** A read-then-write guard
  can be overtaken by a concurrent return-to-stage. The trade is that a no-match needs explaining:
  it answers 422 "superseded" rather than a version conflict a retry could never resolve.
- **Bulk endpoints deliberately carry no `workflow`.** A selection has no single state, and
  inventing one would be a lie the client would render.

## 6. Metrics

| | |
|---|---|
| Tests at release | 674 (api) + 21 (web) + 31 (contracts) |
| New integration suites | `hr-recruitment-recovery` (14), `hr-recruitment-performance` (14) |
| Frontend test runner | added this sprint (`vitest` in `apps/web`), 21 cases over the cache layer |
| Scheduled recovery tasks added | 2, plus 1 boot backfill |
| Remaining implementation gaps | **0** (audited against RW1–RW17 and I1–I15) |

## 7. Follow-ups

- Remove the `pending` query alias on evaluations and screenings after one release.
- Decide the batch-history read model (evaluation-batch actions that span a whole batch).
- Cut the CHANGELOG per sprint again, and write the retrospective in the sprint's own PR.
