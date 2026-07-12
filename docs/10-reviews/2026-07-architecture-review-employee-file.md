# Architecture Review — HR / Recruitment: Electronic Employee File (Stage 7)

**Subject:** [PR #29](https://github.com/egycashcompany-ops/egycash/pull/29) — Electronic Employee
File (Stage 7), module version `0.12.0` · **Reviewer role:** independent enterprise-architecture
review of the implementation · **Date:** 2026-07-12 · **Verdict:** ✅ **Approvable** — no Critical
or High findings. **No in-PR code change was required or applied**: unlike Stage 6 (which had an
external-storage orphan window worth mitigating), Stage 7 performs only DB-local, index-guarded
writes, and no finding rises to an obviously-correct small fix. All findings are forward-looking
and **documented only**. **Not merged** pending EGYCASH sign-off.

This review deliberately looks for weaknesses and does not defend the design. It evaluates the
implementation as shipped, not the intent.

## 0. Scope reviewed

`packages/contracts/src/modules/hr-employee-file.ts` and
`apps/api/src/modules/hr/recruitment/employee-file/**` (aggregate, repository, service, mapper,
controller, routes, validation, barrel), the two cross-feature read hooks added to the Interviews
and Hiring Documents features, the manifest/seed wiring, and the unit + integration tests. BD-008
and the ubiquitous-language entry were reviewed as the governing domain decision. Earlier stages
were in scope only at their read seams.

## 1. Summary of findings

| ID | Area | Severity | Action |
|----|------|----------|--------|
| EF-01 | Handoff event is in-process, post-commit (droppable) | Medium | Next Sprint |
| EF-02 | Aggregate placement vs the future Employee module | Medium | Future |
| EF-03 | Embedded timeline grows unbounded (notes) | Medium | Future |
| EF-04 | List endpoint returns full timelines (no summary projection) | Medium | Next Sprint |
| EF-05 | `archived` status is unreachable (no transition) | Low | Future |
| EF-06 | Links/timeline are a snapshot, not a live view | Low | Won't Fix (documented) |
| EF-07 | `links.interviewIds` includes non-passed (e.g. cancelled) rounds | Low | Future |
| EF-08 | Cross-feature history reads are unscoped | Low | Future |
| EF-09 | `EmployeeFileEventPayloadV1` declared but not enforced at emit | Low | Next Sprint |
| EF-10 | `refType` is a free-form string, not a closed vocabulary | Low | Future |
| EF-11 | Timeline entries have no stable id | Low | Future |
| EF-12 | Assembly reads run sequentially (could be concurrent) | Low | Future |
| EF-13 | Searchable only by `employeeCode` (unanchored regex) | Low | Future |
| EF-14 | Silent milestone skips on missing source timestamps | Low | Future |
| EF-15 | Test-coverage gaps (branch scope, service unit, race, skips) | Low | Next Sprint |
| EF-16 | Free-form notes + actor ids exposed to any viewer | Low | Won't Fix (documented) |
| EF-17 | Branch scope derives from an unvalidated upstream `branchId` | Low | Future |
| EF-18 | Six-way cross-feature coupling in the assembler | Low | Won't Fix (documented) |

No Critical/High findings. The four Medium items are scalability/robustness/boundary concerns with
safe interim behavior, not release blockers.

---

## 2. Detailed findings

### EF-01 — The handoff event is in-process and emitted post-commit
- **Area:** Event consistency, future Employee-module compatibility, failure handling.
- **Description:** `hr.employeeFile.created` / `hr.employeeFile.noteAdded` use the in-process event
  tier and are emitted after the DB commit. BD-008 makes the Electronic Employee File the **handoff
  artifact** to the Employee module, so `created` is precisely the signal a future Employee module
  would consume — yet a crash between commit and emit drops it, with no outbox/retry. No subscriber
  exists today (consistent with all prior HR stages, cf. HD-08).
- **Severity:** Medium (elevated over HD-08 because this event is the intended module handoff).
- **Business Impact:** If/when the Employee module reacts to file assembly, a dropped event could
  leave the two modules inconsistent (a hired person with no downstream employee record created).
- **Recommendation:** Promote the handoff event to the reliable/outbox tier when the Employee
  module (or any durable consumer) subscribes; until then, treat `hr.employee.created` (Stage 5,
  already emitted) as the authoritative hire signal.
- **Action:** **Next Sprint** (at the point a consumer is introduced).

### EF-02 — Aggregate placement relative to the future Employee module
- **Area:** Aggregate boundaries, future Employee-module compatibility, maintainability.
- **Description:** Semantically the file is the **Employee's** file, but it is implemented inside
  the Recruitment sub-module (`recruitment/employee-file/**`, collection `hr_employee_files`, route
  `/hr/employee-files`, permissions `employeeFile.*`). BD-008 states that everything after hiring
  belongs to the Employee module. When that module is designed, ownership of this aggregate and its
  timeline will need an explicit boundary decision (keep in HR-recruitment as the "hand-off record",
  or migrate ownership — with the route/collection/permission renames that implies).
- **Severity:** Medium.
- **Business Impact:** A later ownership migration is a breaking rename (routes, permissions,
  possibly collection) unless the boundary is decided deliberately now.
- **Recommendation:** Record the intended long-term owner as an ADR when the Employee module is
  planned; keep the Stage-7 surface as the recruitment-side handoff until then.
- **Action:** **Future.**

### EF-03 — Embedded timeline grows unbounded
- **Area:** Scalability, data model, performance.
- **Description:** `timeline` is an embedded array. The initial milestones are bounded (~7), but
  `addNote` appends indefinitely, and each append is a whole-array read-modify-write under
  optimistic concurrency (cf. HD-11). Over an employee's multi-year tenure the document grows and,
  in the theoretical limit, approaches the 16 MB BSON ceiling.
- **Severity:** Medium (long-horizon), Low today.
- **Business Impact:** A long-lived, note-heavy file becomes progressively more expensive to read
  and update; in the extreme, updates would fail.
- **Recommendation:** When the Employee module assumes ownership of the long-term timeline, model
  timeline entries as their own collection keyed by file/employee id (append-only, paginated). The
  recruitment-milestone seed set can remain embedded.
- **Action:** **Future** (Employee-module concern).

### EF-04 — List endpoint returns full timelines
- **Area:** Performance, scalability, API surface.
- **Description:** `GET /hr/employee-files` maps each file with its **entire** `timeline` and
  `links`. As timelines grow (EF-03), list responses become large and costly, even though a list
  view rarely needs the full timeline.
- **Severity:** Medium.
- **Business Impact:** Slow, heavy list responses at volume; wasted bandwidth for callers that only
  need summary rows.
- **Recommendation:** Return a slim list DTO (id, employee, status, counts, timestamps) and expose
  the full timeline only via `GET /:id` (or a dedicated, paginated timeline endpoint).
- **Action:** **Next Sprint.**

### EF-05 — `archived` status is unreachable
- **Area:** Employee File lifecycle, domain correctness, technical debt.
- **Description:** `EMPLOYEE_FILE_STATUSES = ['active','archived']`, but no code path sets
  `archived` — `create` writes `active` and `addNote` leaves status untouched. The value is
  forward-looking (an Employee-module lifecycle concern) but is currently dead.
- **Severity:** Low.
- **Business Impact:** None functionally; a reviewer may expect an archive action that does not exist.
- **Recommendation:** Keep the value as the reserved lifecycle target (the archive transition belongs
  to the Employee module), or drop it until needed. Do not add an archive action in this scope.
- **Action:** **Future** (reserved for the Employee-module lifecycle).

### EF-06 — Links/timeline are a snapshot, not a live view
- **Area:** Aggregate boundaries, domain correctness.
- **Description:** `links` and the initial `timeline` are frozen at assembly. If a source aggregate
  changed afterwards, the file would not reflect it. This is **safe by construction**: recruitment
  is terminal for a hired employee (screening decided, interviews passed, offer accepted, hiring
  documents completed and immutable except via versioning), so the sources do not meaningfully move.
- **Severity:** Low.
- **Business Impact:** Negligible; the snapshot is the intended semantic (a point-in-time hand-off
  record).
- **Recommendation:** Document the snapshot semantic explicitly; revisit only if a post-assembly
  source mutation becomes possible.
- **Action:** **Won't Fix** (documented — intentional).

### EF-07 — `links.interviewIds` includes non-passed rounds
- **Area:** Timeline model, domain correctness.
- **Description:** `interviewIds` links **every** non-deleted interview for the applicant, including
  a round that was cancelled and re-scheduled, whereas the timeline emits an `interviewPassed` entry
  only for `completed`+`passed` rounds. The link set and the timeline can therefore differ in size.
- **Severity:** Low.
- **Business Impact:** A consumer counting `interviewIds` may over-count actual interview rounds.
- **Recommendation:** Either document "links = all history, timeline = milestones", or filter
  `interviewIds` to the rounds that produced a milestone if strict parity is wanted.
- **Action:** **Future.**

### EF-08 — Cross-feature history reads are unscoped
- **Area:** Authorization, multi-branch behavior, security (defense-in-depth).
- **Description:** Assembly reads the applicant **with** scope (`applicantService.getById(id, scope)`)
  but reads screening/interviews/offer/hiring-documents **without** a `ScopeSelector`. This is safe
  today: the employee is scope-checked first, and every unscoped read is keyed by that one
  employee's `applicantId`/`jobOfferId`/`employeeId`, so no other person's data is reachable.
- **Severity:** Low.
- **Business Impact:** None in practice; the guarantee rests on the initial employee scope check
  rather than on each read being independently scoped.
- **Recommendation:** As a defense-in-depth measure, thread scope (or an explicit "system read"
  marker) through the history reads so the intent is enforced, not merely implied.
- **Action:** **Future.**

### EF-09 — `EmployeeFileEventPayloadV1` is declared but not enforced
- **Area:** Event consistency, technical debt.
- **Description:** The contract declares `EmployeeFileEventPayloadV1`, but the service emits a
  hand-built object via `emit(...)` (which does not validate). The shape happens to match, so this
  is harmless — but the schema is decorative, mirroring HD-09.
- **Severity:** Low.
- **Business Impact:** A future payload change could silently diverge from the declared contract.
- **Recommendation:** Parse/emit through the schema, or remove the unused schema. Apply uniformly
  across HR stages rather than only here.
- **Action:** **Next Sprint.**

### EF-10 — `refType` is a free-form string
- **Area:** Timeline model, maintainability.
- **Description:** Timeline `refType` (`'applicant'`, `'interview'`, …) is an unconstrained string in
  the model and DTO, unlike the `type` field which is a closed enum. Typos would not be caught.
- **Severity:** Low. **Recommendation:** Promote `refType` to a small `as const` vocabulary if it is
  ever consumed programmatically. **Action:** **Future.**

### EF-11 — Timeline entries have no stable id
- **Area:** Timeline model, future extensibility.
- **Description:** Entries are stored with `_id: false`; an individual note cannot be addressed for
  edit/redaction/removal. Acceptable for an append-only log, but limits future per-entry operations.
- **Severity:** Low. **Action:** **Future** (add entry ids if per-entry operations are needed).

### EF-12 — Assembly reads run sequentially
- **Area:** Performance.
- **Description:** After loading the employee, the four independent reads (applicant, screening,
  interviews, offer) are awaited one-by-one; they could run concurrently. This is a one-time
  operation per employee, so the cost is negligible.
- **Severity:** Low. **Recommendation:** Parallelize with `Promise.all` if assembly latency ever
  matters. Deliberately **not** changed here to avoid an unrequested refactor. **Action:** **Future.**

### EF-13 — Searchable only by `employeeCode`
- **Area:** Searchability, repository design.
- **Description:** List `search` builds a case-insensitive **unanchored** `RegExp` over
  `employeeCode` only (cf. HD-18). Users will likely want to find a file by person name or National
  ID, but those are not denormalized onto the file.
- **Severity:** Low. **Recommendation:** Prefix-anchor the code search and/or denormalize a
  searchable person name when the Employee module defines its search needs. **Action:** **Future.**

### EF-14 — Silent milestone skips on missing timestamps
- **Area:** Domain correctness, observability.
- **Description:** `screeningAccepted`/`offerAccepted` are added only when their timestamps are
  present. For a normally-hired employee they always are; but an anomalous upstream state would
  yield a silently-incomplete timeline rather than a surfaced warning.
- **Severity:** Low. **Recommendation:** Log/annotate when an expected milestone is absent so data
  anomalies are visible. **Action:** **Future.**

### EF-15 — Test-coverage gaps
- **Area:** Test coverage.
- **Description:** Integration covers the gate, authZ (403/401), assembly links + timeline order,
  one-per-employee (409), get, list, and note append + stale-version 409; a unit test covers the
  mapper. Not covered: branch-scope isolation between two branch-scoped users; the concurrent-create
  race (currently relied on the `ux_employee` unique index as the backstop); the defensive
  milestone-skip branches; and there are no service-level unit tests (service logic is exercised
  only through integration).
- **Severity:** Low.
- **Business Impact:** Regressions in scope isolation or the race backstop could slip through.
- **Recommendation:** Add a branch-scope isolation test and a service-level unit test for the
  timeline builder; assert the index-backed duplicate race.
- **Action:** **Next Sprint.**

### EF-16 — Free-form notes and actor ids exposed to viewers
- **Area:** Security, privacy.
- **Description:** Notes are free-form text (≤2000 chars) stored and returned verbatim (render-time
  XSS is a frontend concern), and each timeline entry exposes the acting user id (`by`) to any
  `employeeFile.view` holder. Standard for an internal audit-style timeline; no PII beyond references
  is embedded in the file itself.
- **Severity:** Low. **Action:** **Won't Fix** (documented) — consistent with platform norms; the
  frontend must escape note text on render.

### EF-17 — Branch scope derives from an unvalidated upstream `branchId`
- **Area:** Multi-branch behavior, data integrity.
- **Description:** The file is branch-scoped by `employee.branchId`, which traces back through the
  offer terms to a structurally-validated (not dereferenced) branch id — the same cross-stage caveat
  as HD-15.
- **Severity:** Low. **Action:** **Future** — resolves when the Requisition/Org integration
  validates organizational references end-to-end.

### EF-18 — Six-way cross-feature coupling in the assembler
- **Area:** Cross-module dependencies, maintainability.
- **Description:** The service imports six sibling features (applicants, screening, interviews,
  job-offers, employees, hiring-documents) through their barrels. All imports respect ADR-003
  (barrel-only, same module), but this is the most coupled service in the module — a change to any
  of those read signatures ripples here.
- **Severity:** Low.
- **Business Impact:** Higher change-amplification risk for the assembler than for a leaf feature.
- **Recommendation:** Accept the coupling as inherent to an aggregator; keep the read surface each
  feature exposes small and stable. **Action:** **Won't Fix** (documented).

---

## 3. Area-by-area assessment

1. **Domain correctness:** Sound. Assembly is correctly gated on a **completed** hiring case
   (BD-008), the timeline captures the real recruitment milestones in chronological order, and the
   link set covers the whole pipeline. EF-14 (silent skips) and EF-07 (link vs timeline parity) are
   edge notes, not errors.
2. **Aggregate boundaries:** One aggregate per employee, assembled from — but not owning — the
   source aggregates; a point-in-time snapshot (EF-06, intentional). EF-02 (long-term ownership) is
   the boundary decision to make when the Employee module lands.
3. **Employee File lifecycle:** `active` on assembly; notes append thereafter. `archived` is
   reserved but unreachable (EF-05). No close/transition in scope — correct per BD-008.
4. **Cross-module dependencies:** Barrel-only, same-module (ADR-003 respected). EF-18 flags the
   assembler as a coupling hotspot; EF-08 flags unscoped history reads (safe, defense-in-depth note).
5. **Timeline model:** Clear milestone vocabulary (closed `type` enum) plus free-form notes.
   Weaknesses: unbounded growth (EF-03), free-form `refType` (EF-10), no entry ids (EF-11).
6. **Authorization:** Every route carries `authorize('employeeFile.*')`; list/get/create are
   branch-scoped via `scopeSelector`; `edit` gates note-append. Fails closed (401/403 tested).
7. **Audit consistency:** `create` → `create`; `addNote` → `update`; both via the platform audit
   service, consistent with prior stages. No findings.
8. **Event consistency:** Named per ADR-008. EF-01 (tier of the handoff event) and EF-09 (schema not
   enforced) are the notes; the former is the most consequential given BD-008.
9. **Repository design:** Standard `BaseRepository`, branch-scoped, well-indexed (`ux_employee`
   partial-unique, `applicantId`, `status+createdAt`, `branchId+status`, `employeeCode`). EF-13
   (regex search) is the only weakness.
10. **Transaction boundaries:** `create` is a single atomic insert; the gate reads precede it
    non-transactionally, but the `ux_employee` unique partial index is the race-safe backstop
    (duplicate → `ConflictError`/409). No external-storage write, so no orphan risk (Stage 7 is
    cleaner than Stage 6 here). No unit-of-work needed (no number allocation).
11. **Concurrency:** `create` is index-guarded against duplicate assembly; `addNote` uses optimistic
    concurrency (stale → 409, tested). Concurrent notes serialize on the whole-array write (EF-03).
12. **Multi-branch behavior:** Correctly branch-scoped by `employee.branchId`; EF-17 is the upstream
    unvalidated-ref caveat.
13. **Performance:** One-time assembly cost is trivial; EF-12 (sequential reads) and EF-04 (full
    timelines in list) are the notes.
14. **Scalability:** EF-03 (unbounded timeline) and EF-04 (list payloads) are the growth items,
    both landing naturally in the Employee module's remit.
15. **Searchability:** Minimal (EF-13) — code-only; no person-name/National-ID search on the file.
16. **Future Employee-module compatibility:** The central architectural question (EF-02); the
    snapshot/handoff model and the reserved `archived` status (EF-05) are forward-compatible, but
    ownership and the long-term timeline store (EF-03) must be decided when that module is designed.
17. **Security:** Minimal PII surface (references, not embedded identity data); fails closed on
    authZ; EF-16 (free-form notes / actor ids) is the standard low note.
18. **Test coverage:** Good happy-path + guard coverage; EF-15 lists the gaps.
19. **Technical debt:** Small and localized — EF-05 (dead status), EF-09 (decorative schema),
    EF-10 (`refType` string). None affect behavior.
20. **Maintainability:** Follows the established module structure closely; the assembler coupling
    (EF-18) is the main long-term maintenance consideration and is inherent to the pattern.

## 4. Changes applied in this PR

**None.** No finding qualifies as an obviously-correct, low-risk in-PR fix: Stage 7 writes only to
its own DB collection under a unique-index backstop and optimistic concurrency, so it has no
external-storage orphan window of the kind that justified the Stage-6 (HD-01) mitigation. Every
finding above is a forward-looking scalability, boundary, or hygiene concern and is **documented
only** — no redesign, refactor, feature, or scope expansion was performed.

## 5. Verification (no code changed)

Because this review adds documentation only, the implementation and its already-green CI on PR #29
stand. Local gates re-run to confirm no drift:

- `lint` (incl. layer-boundary rules) ✅ · `typecheck` (strict, incl. `tests/**`) ✅ ·
  `build` (contracts + api) ✅
- unit tests **138 passed** (incl. `employee-file.mapper.spec.ts`) · `check:permission-matrix` ✅ ·
  `check:flag-expiry` ✅
- Integration suite `tests/integration/hr-employee-file.spec.ts` runs in CI (green on the reviewed
  commit; the docs-only commit re-runs it).

## 6. Recommendation

**Approve for merge** on EGYCASH sign-off. Schedule EF-01, EF-04, EF-09, EF-15 as **Next Sprint**
backlog; carry EF-02, EF-03, EF-05, EF-07, EF-08, EF-10, EF-11, EF-12, EF-13, EF-14, EF-17 as
**Future** (most naturally addressed when the Employee module is designed and assumes ownership of
the post-hire employee lifecycle per BD-008); EF-06, EF-16, EF-18 are **Won't Fix** (documented as
intentional). No Critical or High findings; no release blockers.
