# Employee Separation Closeout (P-HR-SEP)

**Status: audit complete, decisions frozen (D1–D9). Findings F1–F3 are defects; the rest of the
exit already works.**

**Base:** `main` at `d108d4d` (Medical Affairs complete — M1 through M4 merged).

An exit is the one act in this system that reaches **every** module at once. Everything else is
local: a payslip is payroll's, a leave request is leave's, a medical event is Medical Affairs'. But
the moment somebody stops being an employee, twelve features are each holding a row that assumed
they still were — and none of them finds out unless somebody tells it.

So this phase is not a feature. It is the question *«what did we forget to close?»*, asked once,
against the code rather than against a checklist somebody wrote from memory.

---

## 1. What an exit already is

Not assumed — read off `employee-action.service.ts` → `applyExit`. Five things happen inside the
act itself, before any consumer hears about it:

| step | what | why it is inside rather than in a subscriber |
|---|---|---|
| **Direct reports settled** | reassigned to a named manager, or knowingly left unassigned | it is a **decision** the exiting act refuses to proceed without (F1) — a subscriber would settle it after the fact, with nobody's judgement in it |
| **Status → `exited`** | through the shared transition table | the employment status is the employee record's own field |
| **`exit` stamped** | type, reason, effective date, rehire eligibility, by whom | the exit facts are the exit |
| **Employment period closed** | `exitedAt` + `exitType` on the open period | the derived index every span calculation reads |
| **Login suspended** | automatic, stated in the dialog, not a checkbox | D3 of the employee design — access ends when employment does, and making it optional would mean somebody could forget |

Then `hr.employee.exited` is emitted, carrying `employeeId`, `code`, `exitType` **and
`effectiveDate`** — the date travels with the event because the emit happens *before* the employee
document is saved, so a consumer that re-read the employee would read the state from before the
exit.

## 2. Who is listening, and what each one closes

Five subscribers exist today, in three modules plus two outside HR. Every one of them was found in
the code, not in a document:

| subscriber | module | what it closes | the judgement in it |
|---|---|---|---|
| `leave.exitSettlement` | Leave | open requests completed at the exit date or cancelled, allocations released, **all balances expired** | an `active` leave is *completed* at the cutoff (the days were taken); anything else is *cancelled* (they were not) |
| `loans.exitSettlement` | Loans | instalments scheduled after the exit are **cancelled**; a loan never disbursed is cancelled; a loan still owing becomes `outstandingAtExit` | D8 — nothing is taken from final pay and nothing is written off; both would be decisions this system was never granted |
| `attendance.onEmployeeExited` | Attendance | recomputes the last seven days, so days after the exit stop being expected | the employment-span check inside the engine is what actually drops them; this only makes it act |
| `fleet.deactivateExitedDriver` | Fleet | the driver profile leaves the pool | design §9.1 — event-driven, with no HR import |
| `it.flagAssetsHeldByExitedEmployee` | IT | open asset assignments are **recorded**, never auto-returned | FR-13 — a physical return is a thing a human witnesses; writing one because HR closed a record would put a custody fact in the chain that never happened |

**Two of those five deliberately do not finish the job**, and say so. IT records rather than
returns; Loans flags rather than recovers. Both are right, and both are the reason this audit does
not read «unclosed» as «broken».

### What the exit does NOT touch, correctly

* **Payroll.** A leaver is already in the exit month's batch and already prorated to the day —
  `employedDuring` plus `employmentSpansOf`, the same spans the batch and the arithmetic both read.
  Nothing needs closing because nothing was left open.
* **Training records.** A completed course is a fact about the past. `training-record.model.ts`
  copies every name at the moment of writing precisely so the sentence survives everything around
  it, including the person leaving.
* **Medical profile and medical events.** A health record is not closed by an exit; the events are
  immutable by construction (M3), and the profile is read behind `medicalRecord.view` whether or
  not the subject is still employed.
* **The medical insurance card.** D13 of the Medical design already ruled this: **nothing concludes
  from a date**, and a card is ended by a person, taking the end date **from the caller** — because
  a card is usually ended after the fact, precisely in the case where *«an employee left in March»*.
  Auto-ending it on exit would contradict a decision made three phases ago. See D7 below.

## 3. THE FINDINGS

Three consumers are missing, and they are missing in three different ways.

### F1 — The contract sweeps do not know the employee has left. **(defect)**

`contract.repository.ts` filters both sweeps on the **contract's** status and nothing else:

```
findOverdue:      { status: { $in: ['active','signed'] }, endDate: { $lte: asOf } }
findExpiringSoon: { status: { $in: ['active','signed'] }, endDate: { $gt: now, $lte: now+window } }
```

Neither asks whether the person is still employed. So for somebody who resigned in March with a
contract running to June:

* in May, `notifyExpiring` sends HR **«contract C-0042 for فلان expires soon»** — a renewal prompt
  about somebody who left two months ago, to everybody holding `contract.view` org-wide;
* in June, `expireOverdue` flips that contract to `expired` — which is **false as a fact**. The
  contract did not run to its end and expire. It ended when the employment did.

This is the sharpest of the three because the system does not merely stay silent: it **asserts
something untrue**, twice, to people who will act on it.

Note what is *not* claimed here: the probation reminder sweep was checked and is already safe — it
filters `status: 'probation'`, which an exited employee no longer has. The contract sweeps are the
odd ones out, not an instance of a pattern.

### F2 — A leaver's open review freezes the whole performance round. **(defect)**

`performanceCycleService.close` refuses while `countUnfinished(cycleId) > 0`, where unfinished means
*neither `finalized` nor `excused`*. Materialization already excludes leavers — `employeesInScope`
reads `listEmployedByPlacementSystem` — but that only covers people who had already left **when the
round opened**.

Somebody who leaves *during* the round keeps a `draft` review with an evaluator who cannot evaluate
them and a subject who is not there. The round then cannot be closed until a human notices, works
out that the blocker is a leaver, and excuses that row by hand. Nothing tells them; the refusal
names a *count*, not a reason.

`excused` exists for exactly this — «this review is not happening» — and `draft → excused` is
already a legal transition.

### F3 — A leaver keeps their seat in a future training session. **(defect, smaller)**

The seat is the **enrollment**, not the nomination. `occupiesSeat` counts every status except
`cancelled`, so an exited employee's `enrolled` row keeps a place somebody else could have taken,
and puts them on the roster of a session they cannot attend.

The nomination is a different thing and is **deliberately left alone** (D5): `approved` is terminal
in its state machine, because a nomination is a decision that was taken, and decisions taken are
not unmade by later events.

## 4. Decisions

### D1 — The closeout is event-driven, in each module, with no HR import

Three new subscribers to `hr.employee.exited`, each living in the module that owns the row it
closes. This is not a new pattern: it is the fourth and fifth and sixth instance of the one Fleet
and IT already state as *«event-driven, no HR import»*. A central «exit orchestrator» that reached
into contracts, performance and training would make HR own three vocabularies it does not have.

### D2 — Every automatic write states its reason in the row

`cancelledReason: 'employee exited'`, `excusedReason: 'employee exited'`. The precedent is Leave,
which writes `cancelReason: 'employee exited'` today. Somebody reading the row a year later has to
be able to see that a machine did it and why — and a status change with no reason on it is
indistinguishable from a person's decision.

### D3 — The contract's STATUS is not changed by an exit

The sweeps stop reaching leavers; the contract keeps whatever status it has.

This is the narrow fix on purpose. Terminating a contract is a legal act — `terminate` records
`terminatedBy` (a person), `terminatedAt` and a required `terminationReason`, and emits
`hr.contract.terminated`. Writing one from a subscriber would put the system's name where a
signatory's belongs, on a document that may be produced in a dispute.

What the exit is entitled to do is stop the system from **saying false things** about a contract
whose holder has left. It is not entitled to end the contract itself. **Whether an exit should
terminate the employment contract is a Business decision, recorded in §6 Q1 and not taken here.**

### D4 — Only a `draft` review is excused automatically

`submitted → excused` is legal, and it is **not** used. A submitted review contains a real
evaluation of work the person actually did, written by somebody who took the time; discarding it
because the subject later resigned would destroy content on a technicality. A submitted review can
still be finalized by its normal path, which unblocks the round the same way.

So the automatic excuse reaches exactly the rows that hold nothing: the ones nobody has written in.

### D5 — The training nomination is untouched; only the seat is released

Stated above under F3. `approved` is terminal, and widening a state machine so a subscriber can
reach through it would be the wrong trade for a row that records a decision correctly.

### D6 — Only seats in sessions that have not yet ended are cancelled

A seat in a session that already ran is history — the person was there, or was marked absent, and
`occupiesSeat` counting an absence is itself a decision the training design took deliberately
(*«an absent seat was still taken»*). Cancelling it retroactively would rewrite what happened in a
room. The cutoff is the **session's end**, not the exit date, because somebody who left on the 20th
genuinely attended the session that ran on the 12th.

### D7 — The medical insurance card is NOT ended by the exit

Restating M4's D13 rather than reopening it: a card is ended by a person, with the date they give,
and no date concludes anything by itself. The exit does not reach it, and this is the recorded
reason. §6 Q2 records the consequence.

### D8 — Nothing here computes money

No gratuity, no encashment, no notice pay, no final-pay adjustment. Those are the three amounts
`end-of-service-settlement.md` §5 blocks on a legal rule, and this phase does not become the place
one gets guessed. The settlement summary already names all three as unresolved on the screen.

### D9 — No new entity, no new permission, no new page

Every write this phase makes is a status change on a row that already exists, made by a subscriber
that has no caller and therefore no permission check to run. The page registry, the permission
matrix and the navigation are untouched.

## 5. What this phase builds

**Three event subscribers and their tests. Nothing else.**

| subscriber | module | closes |
|---|---|---|
| `contracts.skipExitedInSweeps` *(a query change, not a subscriber)* | Contracts | both sweeps exclude employees who have left |
| `performance.excuseReviewsOfExitedEmployee` | Performance | every `draft` review in an `open` cycle → `excused`, reason `employee exited` |
| `training.releaseSeatsOfExitedEmployee` | Training | every seat in a session ending after the exit → `cancelled`, reason `employee exited` |

F1 is deliberately **not** a subscriber. There is no state to change — the fix is that two queries
ask one more question — and inventing a subscriber to write a status would be exactly what D3
refuses.

### Test matrix

| case | expectation |
|---|---|
| expiring contract, employee still employed | notice sent, as today |
| expiring contract, employee exited | **no notice** |
| overdue contract, employee still employed | flipped to `expired`, as today |
| overdue contract, employee exited | **left alone** |
| contract with no employee record at all | left alone — a missing employee is not a leaver |
| exit during an open cycle, `draft` review | excused, reason recorded |
| exit during an open cycle, `submitted` review | **untouched** (D4) |
| exit, `finalized` / `excused` review | untouched |
| exit, review in a `closed` cycle | untouched — the round is over |
| the cycle can then close | asserted: `countUnfinished` reaches 0 |
| exit, seat in a future session | cancelled, reason recorded |
| exit, seat in a session that already ended | **untouched** (D6) |
| exit, seat already `cancelled` | untouched, and not double-written |
| exit, `attended` seat in a past session | untouched |
| the nomination behind a cancelled seat | untouched (D5) |
| every automatic write | carries `employee exited` as its reason |
| re-delivery of the same event | idempotent — each write is a status transition that is already terminal on the second pass |

## 6. Business questions — recorded, not answered

**Q1 — Should an exit terminate the employment contract?** Today it does not, and after this phase
it still does not; the contract simply stops generating false notices. Terminating it is a legal act
with a signatory, and the answer decides whether that signatory can be the system. *(D3)*

**Q2 — Who ends the medical insurance card when somebody leaves?** D13/D7 say a person does, taking
the date from the caller. Nothing currently prompts them. The exit notification goes to
`employee.view` org-wide, which is not the group that administers `medicalInsurance.manage`. This is
a gap this audit found and deliberately did not close, because closing it means either
auto-ending the card (contradicting D13) or adding a notification target that names a group nobody
has scoped.

**Q3 — Are the three settlement amounts still blocked?** Yes: gratuity, leave encashment and notice
period each need a legal rule, unchanged since `end-of-service-settlement.md` §5. They are named as
unresolved on the settlement screen, which is the correct behaviour until a rule exists.

**Q4 — Does an exit need an exit CHECKLIST?** IT's FR-13 comment calls the checklist «the process»
and its own flag «its safety net», which implies a checklist that lives outside this system. If one
should live inside it, that is a feature with its own design, not a closeout.
