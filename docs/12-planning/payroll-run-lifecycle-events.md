# P-HR-16 — Payroll Run Lifecycle Events & Notifications

**Status:** scope frozen before implementation. This is a **technical** phase: it adds no business
rule, no state, no permission and no financial figure. It publishes facts that already happen.

---

## 1. The gap, stated as evidence

`payroll-run.service.ts` contains **zero `emit(`** and **zero `notify(`**. Every governance
transition P-HR-10 built — freeze, approve, pay, close — happens in silence.

So the person holding `payrollRun.approve` learns that a month was frozen and is waiting for them
by opening the screen and looking. The person holding `payrollRun.pay` learns that a run was
approved the same way. This is precisely the gap P-HR-07 closed for adjustments and loans, in a
feature that was built after it.

## 2. What this phase reuses, unchanged

Nothing is invented. Every piece already exists and is used exactly as P-HR-07 uses it:

| piece | where | how |
|---|---|---|
| event bus | `platform/kernel/event-bus.ts` | `emit(name, payload)` — in-process tier |
| catalogue | `contracts/src/events/catalog.ts` | an uncatalogued event constant is a **compile error** |
| catalogue↔code check | `event-publishers.spec.ts` | source-scans every emit site |
| notifications | `notificationsService.notify(...)` | direct call, `.catch(() => undefined)` |
| template seeds | `hr.seed.ts` | three more `ensure` calls, same shape |
| seed guard | `hr.seed.spec.ts` | already proves every SENT template is seeded |

## 3. Which transitions publish, and which do not

The rule is P-HR-07's, applied rather than re-decided: **an event exists where a real transition
happens AND somebody is thereby waiting to act.** The recipient is derived from the permission that
governs the NEXT act — never from a job title, never a broadcast.

| transition | event | who is told | why |
|---|---|---|---|
| `draft → frozen` | `hr.payroll.runFrozen` | `payrollRun.approve` | the figures now exist and are locked; approval is the next act and only they can do it |
| `frozen → approved` | `hr.payroll.runApproved` | `payrollRun.pay` | recording the payment is the next act |
| `approved → paid` | `hr.payroll.runPaid` | `payrollRun.manage` | closing the month is the next act, and a paid run left open is a month nobody finished |

### Deliberately silent

| act | why no event |
|---|---|
| **create** (`draft`) | a draft run is a private working note — P-HR-07's exact reasoning for a draft adjustment |
| **close** (`closed`) | terminal. Nothing follows it, so nobody is waiting |
| **cancel** (`cancelled`) | an act by somebody already looking at the row — P-HR-07 declined `Cancelled` for loans for this reason |

Three absences, asserted by name in the guard so a fourth event cannot arrive without a phase
behind it.

## 4. What the notices may say

* **No amount, in any body.** A run has no total of its own anyway — the figures are the payslips',
  behind `employee.viewCompensation`. A notice is a pointer to a decision, not a second copy of a
  number. (P-HR-07's rule, restated.)
* **No broadcast to employees.** Nobody is told "you have been paid": that is a message to every
  employee in the organization, it has no precedent in this repository, and `paid` is recorded on
  the RUN rather than on any payslip (P-HR-10 §5), so there is no per-employee fact to point at.
* **The period is the subject.** `{{period}}` is what identifies the run to a human, so it is the
  one variable every body carries.

## 5. Idempotency — the state machine, not the notifier

Every emit sits **after** the write that owns the transition, and each transition can happen once:

* the status guard (`run.status !== 'frozen'`, etc.) runs **before** the write and does not consult
  the version, so a repeat is refused at any version;
* `updateById` filters on `__v`, so a stale-version retry is a **409 before the emit**.

Nothing is de-duplicated in the notifier, because nothing needs to be. This is asserted from both
sides in the integration tests, as P-HR-07's were.

## 6. Explicitly out of scope

* **No new run state**, and `reviewed` is **not** reopened — it remains the flagged decision P-HR-10
  recorded.
* **The meaning of `Pay` is unchanged**: recorded-as-paid inside this system. No bank, no WPS.
* **PY-12 stays closed.** No export, no PDF, no document of any kind. A guard asserts it.
* No permission, no page, no migration, no web change — there is no screen for "events happened".
* No reliable/outbox tier: the durable record of a transition is the write plus the audit entry,
  both of which already exist. This matches Attendance and P-HR-07.

## 7. Test matrix

| case | expectation |
|---|---|
| freeze a draft run | `hr.payroll.runFrozen` published once; approvers notified |
| approve a frozen run | `hr.payroll.runApproved` published once; payers notified |
| pay an approved run | `hr.payroll.runPaid` published once; managers notified |
| repeat any transition | refused by the status guard (422) — no second event, no second notice |
| stale version | 409 before the emit — no event, no notice |
| create / close / cancel | publish nothing |
| every template sent | seeded (the existing `hr.seed.spec.ts` guard covers it) |
| no body carries money | asserted over the seeds |
