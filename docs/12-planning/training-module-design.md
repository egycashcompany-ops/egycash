# Training (P-HR-TRN)

**Status: decisions frozen (D1–D14). Not yet implemented — this doc is the base the phases build on.**

**Base:** `main` at the commit this document lands on.

Recruitment asks "should we hire this person". Payroll asks "what are we paying them". Training asks
a third question that neither can answer: **what has this person been taught, and can we prove it.**

The proving is the whole feature. A training module that only scheduled courses would be a calendar;
what an employer actually needs is the answer to "show me that the driver who had the accident had
been through defensive driving, and when" — years later, after the trainer has left and the course
has been renamed twice. Every decision below is that requirement restated against something this
codebase already does.

---

## 1. The five concepts, kept apart

Collapsing any two of these is the usual way a training system starts lying about its own history.

| | what it is | where it lives | may change? |
|---|---|---|---|
| **course** | "defensive driving exists as a thing we teach" — a catalogue entry | `hr_training_courses` | yes; it is configuration |
| **session** | "we are running it on 3 March, in Cairo, with these seats" — one delivery | `hr_training_sessions` | while it is `scheduled` |
| **nomination** | "somebody thinks Ahmed should attend" — a **request**, not a seat | `hr_training_nominations` | while it is `pendingApproval` |
| **enrollment** | "Ahmed holds a seat in this session" — the attendance list | `hr_training_enrollments` | its status does; its identity never |
| **record** | "Ahmed completed defensive driving on 5 March 2026" — a **fact** | `hr_training_records` | **never** |

The last row is the one that carries the weight. A record is written when a session completes and is
never edited afterwards, because the question it answers is asked years later and the answer must not
depend on what anybody has since renamed, deactivated or rescheduled.

---

## 2. The frozen decisions (D1–D14)

| # | decision |
|---|---|
| **D1** | **The catalogue is data, not code.** Courses are rows, seeded at boot and administered in the app — the same stance D-APP-4 took for applicant documents and RW9 for evaluation phases. A new course next year is an administrator's afternoon, not a release. |
| **D2** | **A session is a delivery of a course, never a course itself.** Running the same course twice creates two sessions; it does not duplicate the catalogue entry. Reporting asks "how many people have done X" across sessions, which only works while X is one row. |
| **D3** | **Nomination and enrollment are different things.** A nomination is a request that may be refused; an enrollment is a held seat. The approval shape is P-HR-04's, unchanged: `draft → pendingApproval → approved \| rejected`, a separate `trainingNomination.decide` key, and **the nominator may not decide their own nomination**. |
| **D4** | **Self-nomination is allowed; self-approval is not.** An employee may nominate themselves — the seam is the decision, not the request. This is D3 restated and needs no second rule. |
| **D5** | **A session has an optional capacity.** When set, approving a nomination past it is refused with `409`; when unset there is no limit. No waiting list, no priority, no automatic promotion — a refused nomination is refused, and somebody decides again. |
| **D6** | **Attendance on a session is recorded per enrollment, per session, once.** `attended \| absent \| excused`, marked by whoever runs the session. It is a fact about the seat and is **not** an attendance-module day record — see D11. |
| **D7** | **Completion is a decision about a person, not a side effect of attendance.** Marking somebody `attended` does not complete them. A session is completed as an explicit act which writes one immutable record per completing enrollment. Turning presence into a qualification automatically would be inventing an assessment rule nobody has given. |
| **D8** | **The record is immutable and denormalized.** It stores the course's key and name, the session's dates, the employee's id — copies, not references, resolved at the moment of writing. A course renamed or deactivated in 2028 must not change what a 2026 certificate says. |
| **D9** | **A certificate is a file on a record, and the record stands without it.** Certificates go in their own seeded file category with a file authorizer (ADR-023). A record with no certificate is a completed training whose paperwork has not arrived — a normal state, not an error. |
| **D10** | **An expiry date is RECORDED and gates nothing.** Some certificates carry one and it belongs in the record. Whether an expired certificate stops somebody driving, working or being scheduled is a **labour and safety rule nobody has given**, so nothing consumes it: no sweep, no block, no notification. Recording a fact is not enforcing a policy. |
| **D11** | **Training writes nothing into Attendance and nothing into Payroll.** Whether a training day is a work day, whether it is paid, and whether it displaces a shift are three business rules with no recorded answer. This module does not decide them by writing rows into the modules that would then act on them. |
| **D12** | **No cost, no budget, no vendor accounting.** A course carries no price and no cost centre in this phase. Adding money would pull in the accounting boundary that PY-12, P-HR-12 and P-HR-14 are all deliberately stopped at. |
| **D13** | **No required-training matrix.** "Every driver must hold defensive driving" is a real rule, and it is a rule about job titles that nobody has stated. Without it there is nothing to compute compliance against, and a compliance screen computed from an invented rule would be worse than none. |
| **D14** | **Scope is branch + department, declared.** Every collection carrying an employee stamps both axes from the employee and declares them to the repository — P-SCOPE-1 and F-REQ-1, which were each a silent widening the first time they were missed. Not section (D-DEPT-5). |

### What D10–D13 have in common

Four decisions to build nothing, and they are the load-bearing half of this design. Each names a rule
that a training module is *expected* to have, states that nobody has given it, and refuses to guess:

- an expiry that blocks something (**D10**)
- a training day that counts as attendance or pay (**D11**)
- a course that costs money (**D12**)
- a job title that requires a course (**D13**)

Each is guarded by a seam spec asserting the absence, in the shape `employee-loans` used for D4 and
D10 there: the feature must name no attendance model, no payroll model, no price field and no
job-title requirement. An absence nobody asserts is an absence somebody adds by accident.

**Every one of them is a question for the owner, and none of them blocks this module.** They are
listed in §8 as the questions to ask, phrased so an answer can be dropped in later without
re-deciding anything above.

---

## 3. Where each decision lands

- **D1/D2** are two collections and a foreign key. The catalogue seeds a small starting set the way
  `hr.seed.ts` seeds evaluation phases and document types.
- **D3/D4** are the state machine plus the permission split, and one rule a permission cannot
  express: `decide()` refuses the nominator, because a key says what you may do, not who you are.
  Copied from `employeeLoan.approve` rather than reinvented.
- **D5** is a guard at approval over the count of live enrollments, applied at the point at which
  two approvals could both take the last seat.
- **D6/D7** are two separate transitions on two different objects — one on the enrollment, one on
  the session — so that "present" and "qualified" cannot be confused by a caller or by a reader.
- **D8** is a mapper that copies at write time, plus a model with no update path for those fields,
  plus a spec asserting no service ever `$set`s them. The same argument D-DEPT-2 makes for the
  payslip's department stamp.
- **D9** reuses the platform Files service and pushes an authorizer into `file-authorizers.ts` — a
  registration, not a new mechanism.
- **D10–D13** are absences, each with its guard (§2).
- **D14** is `branchField` + `departmentField` on every repository, stamped from the employee, and
  an entry in a `department-scope-guards.spec.ts` of its own — the third copy of a spec that has now
  caught the same defect twice.

---

## 4. The state machines

**Nomination** — `draft → pendingApproval → approved | rejected`, and `approved` creates the
enrollment. `withdrawn` is available while pending.

**Enrollment** — `enrolled → attended | absent | excused` (D6), then `completed` only through the
session's completion act (D7). `cancelled` is available while `enrolled`.

**Session** — `scheduled → running → completed | cancelled`. Completion is terminal and is what
writes the records. A cancelled session cancels its enrollments and writes nothing.

Nothing in these is a workflow engine: ADR-011 is Accepted and unimplemented, and the recruitment
engine is bound to recruitment's own stage vocabulary. Three small explicit transitions, each
audited, each emitting its event.

---

## 5. Events (ADR-008, `<module>.<entity>.<event>`)

`hr.trainingSession.scheduled` · `.completed` · `.cancelled`
`hr.trainingNomination.submitted` · `.approved` · `.rejected`
`hr.trainingEnrollment.created` · `.attendanceMarked` · `.cancelled`
`hr.trainingRecord.created`

All standard-tier. None of them is consumed by another module in this phase, which is D11 restated:
publishing a fact is not asking anybody to act on it.

---

## 6. Realtime

Reuses the existing bus and registry — no new transport. Sessions, nominations and enrollments are
operational records several people work at once, so the same mutation-to-open-screen path every other
HR queue already uses applies here, and the realtime registry's pinned counter moves by the number of
new channels rather than by a new mechanism.

## 7. The phases

Each is a complete slice — contracts, rules, API, screen, i18n, tests — and its own PR.

| phase | what ships |
|---|---|
| **T2** | The catalogue: courses and sessions, administered end to end. |
| **T3** | Nominations and enrollment — the approval flow and the seat. |
| **T4** | Attendance, completion, records and certificates. |
| **T5** | Training history on the employee profile, and realtime across the four. |

T2 first because everything else references a course; T4 before T5 because history has nothing to
show until records exist.

---

## 8. The questions for the owner

None of these blocks the module. Each would be a phase of its own, and each is written so that an
answer can be dropped in without reopening §2.

1. **Does an expired certificate stop anything?** (D10) — if yes: what, and how long before expiry
   does somebody need telling?
2. **Is a training day a work day?** (D11) — does it count as attendance, is it paid, and does it
   displace the shift the employee was rostered for?
3. **Does a course cost money we track?** (D12) — if yes, per session or per seat, and against whose
   budget?
4. **Is any training required by job title?** (D13) — this is the one that turns the module into a
   compliance tool, and it is the largest of the four.
