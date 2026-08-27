# Performance (P-HR-PRF)

**Status: decisions frozen (D1–D15). Not yet implemented — this doc is the base the phases build on.**

**Base:** `main` at `ac851d2` (Training complete, CI green).

Training answers "what has this person been taught". Performance asks a harder question that no
other module can answer: **how are they doing, and who says so.**

The difficulty is not the data. It is that a performance system is the most likely thing in an HR
suite to be wrong in a way nobody notices for a year — because its output is a NUMBER attached to a
person, and a number is believed. Every decision below is written against that.

---

## 1. The five concepts, kept apart

| | what it is | where it lives | may change? |
|---|---|---|---|
| **cycle** | "H1 2026, everybody, opens 1 June" — one round of reviewing | `hr_performance_cycles` | while it is `draft` |
| **goal** | "reduce cash-count variance to under 0.2%" — one thing one person is trying to do | `hr_performance_goals` | while the cycle is open |
| **evaluator** | "Ahmed is reviewed by Mona this cycle" — an assignment, not a job title | on the review | while it is `draft` |
| **review** | "Mona's assessment of Ahmed for H1 2026" — the work in progress | `hr_performance_reviews` | until it is `finalized` |
| **result** | what the review said when it closed — the number and the words | frozen on the review | **never** |

The last row is the one that carries the weight, and it is why `result` is not a sixth collection:
a review BECOMES its result. Copying it elsewhere would create two places for one truth and a day
when they disagree.

---

## 2. The frozen decisions (D1–D15)

| # | decision |
|---|---|
| **D1** | **A cycle is the unit of everything.** No review exists outside one; no goal exists outside one. "Continuous feedback with no cycle" is a different product, and building both would mean two answers to "how did they do this year". |
| **D2** | **A cycle has an explicit lifecycle**: `draft → open → closed`. Opening MATERIALIZES the reviews (one per employee in scope) exactly as the recruitment materializer opens stage records — so the queue is real rows, not a computed list nobody can act on. |
| **D3** | **Scope is stated, never inferred.** A cycle names branches and/or departments, or the whole company. There is no "everybody who was employed on date X" rule, because that is a rule about probation, transfers and leave that nobody has given. |
| **D4** | **One evaluator per review, and they are ASSIGNED.** Defaulted from the employee's own reporting manager (`employment.managerId`) where there is one and from their department's manager otherwise, and changeable while the review is `draft`. Refined in P2 from «the department manager» alone: both fields exist, and the direct manager is who actually reviews somebody — the department's is the fallback for the people the chart was never filled in for. What D4 is ABOUT is unchanged: the evaluator is stored, never derived at read time, so a manager who leaves in October cannot silently change who reviewed somebody in June. |
| **D5** | **The evaluator may not be the subject.** The same shape as `trainingNomination.decide` and `employeeLoan.approve` — a key says what you may do, not who you are, so this lives in the service. |
| **D6** | **The review's lifecycle is `draft → submitted → finalized`**, with `returned` from `submitted` back to `draft`. Finalizing is HR's act, not the evaluator's: the evaluator says what they think, and somebody else closes the round. |
| **D7** | **A finalized review is immutable**, denormalized the way a training record is (D8 there): the employee's name and code, the evaluator's name, the cycle's name, all copied at the moment of finalizing. A department renamed in 2028 must not change what a 2026 review says. |
| **D8** | **The score is a stated scale, not a computed one.** A cycle names its scale (`1..5` by default) and the review carries one overall rating from it. There is NO weighted average of goal scores, because weighting is a business rule nobody has given — and an average presented as a judgement is the exact failure this module is most likely to make. |
| **D9** | **A goal is progressed, not scored automatically.** It carries a target, a current value and a status the owner sets. Nothing derives the review's rating from the goals; the evaluator reads the goals and forms a judgement, which is what an evaluator is for. |
| **D10** | **Performance READS Training and Attendance and writes to neither.** The review screen may SHOW what somebody was taught and how often they were present, because an evaluator should see it. Nothing computes a rating from either — that would be inventing the rule D8 refuses. |
| **D11** | **No calibration, no forced distribution, no ranking.** "The top 10% get X" is a real policy and nobody has stated it. Computing a distribution the company has not agreed to would produce a list people are treated by. |
| **D12** | **No pay consequence.** Performance writes nothing into Payroll — no bonus, no increment, no eligibility flag. Whether and how a rating touches pay is the largest unstated rule in this module. |
| **D13** | **No self-assessment and no peer review in this phase.** Both are real features and both change who may write on a review, which is the one thing D5 and D6 are built around. Adding either later is a phase; adding it now would mean designing the permission model twice. |
| **D14** | **Scope is branch + department, declared** on every collection carrying a person — P-SCOPE-1 and F-REQ-1, each a silent widening the first time it was missed. Not section (D-DEPT-5). |
| **D15** | **The employee sees their own finalized review, and nothing before it.** A draft is the evaluator thinking; a submitted review is somebody else's to decide. Showing either would make the process a negotiation instead of an assessment. |

### What D8–D13 have in common

Six decisions to compute nothing, and they are the spine of this design. A performance module's
characteristic failure is arithmetic wearing the costume of judgement:

- a rating averaged from goal scores (**D8**)
- a goal that scores itself (**D9**)
- a rating computed from attendance (**D10**)
- a distribution nobody agreed to (**D11**)
- a bonus that follows a number (**D12**)

Each is guarded by a seam spec asserting the absence, the shape `training-absences.spec.ts` uses:
the feature must name no payroll model, no attendance model, no weighting, and no percentile.

**Five of them are questions for the owner (§8), and none of them blocks this module.**

---

## 3. Where each decision lands

- **D1/D2** are two collections and a materializer that reuses the pattern, not the code:
  recruitment's engine is bound to recruitment's stage vocabulary, and borrowing it would couple
  two modules through a shape neither owns.
- **D3** is a stored scope on the cycle plus the query that opens it. Nothing infers.
- **D4/D5** are a field and a service rule — the third copy of "a key says what you may do, not who
  you are", after `employeeLoan.approve` and `trainingNomination.decide`.
- **D6** is the state machine, pure, in `review-rules.ts`.
- **D7** is a mapper that copies at finalize time plus a spec that counts the update paths — the
  same assertion `training-immutability.spec.ts` makes, which caught a real slip when it was written.
- **D8–D13** are absences, each with its guard.
- **D14** is `branchField` + `departmentField` on every repository, stamped from the employee, and a
  `performance-scope-guards.spec.ts` — the fourth copy of a spec that has now caught the same defect
  three times.

## 4. The state machines

**Cycle** — `draft → open → closed`. Opening materializes the reviews; closing refuses while any
review is not `finalized` or explicitly `excused`.

**Review** — `draft → submitted → finalized`, plus `returned` (submitted → draft, with a reason) and
`excused` (a person who cannot be reviewed this round — on leave, newly hired, already left).

**Goal** — `active → achieved | missed | dropped`, set by whoever owns it. No automatic transition.

## 5. Events (ADR-008)

`hr.performanceCycle.opened` · `.closed`
`hr.performanceReview.submitted` · `.returned` · `.finalized` · `.excused`
`hr.performanceGoal.created` · `.progressed` · `.closed`

All standard-tier. None is consumed by another module — D10 and D12 restated: publishing a fact is
not asking anybody to act on it.

## 6. Realtime

Reuses the existing bus and registry. Reviews and goals are operational records several people work
at once, so the same mutation-to-open-screen path every other HR queue uses applies here.

## 7. The phases

| phase | what ships |
|---|---|
| **P2** | Cycles: the round, its scope, and opening it (which materializes the reviews). |
| **P3** | Goals: setting them, progressing them, closing them. |
| **P4** | The review itself — the evaluator's screen, submit / return / finalize. |
| **P5** | Results and history: the employee's own finalized reviews, on the profile. |

P2 first because nothing exists without a cycle; P5 last because history has nothing to show until
reviews are finalized.

---

## 8. The questions for the owner

None of these blocks the module. Each would be a phase of its own.

1. **Does a rating touch pay?** (D12) — the largest unstated rule here. If yes: which ratings, what
   amount, and decided by whom?
2. **Is there a distribution the company holds itself to?** (D11) — a forced curve, a top band, a
   quota. If yes, calibration becomes a phase and reviews stop being independent of each other.
3. **Should goals carry weights that produce the rating?** (D8/D9) — if yes, the rating stops being
   a judgement and becomes arithmetic, and that has to be a decision rather than a default.
4. **Self-assessment and peer review?** (D13) — both change who may write on a review.
5. **What is the scale?** (D8) — `1..5` is the default this ships with. If the company already uses
   something else (letters, `1..10`, a two-axis grid), say so before the first cycle runs, because
   ratings from two scales cannot be compared afterwards.

Question 5 is the only one worth answering BEFORE P2 ships: the others can be added later without
invalidating anything, and a scale cannot.
