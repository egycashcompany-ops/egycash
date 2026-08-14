# P-HR-10 — Payroll Run Governance

**Status:** design settled against the repository, then implemented. One architectural choice is
flagged for human review in §6 — it was decided the conservative way and the alternative is recorded
rather than taken silently.

---

## 1. `Pay` — the meaning, settled before any code

> **`Pay` means recording INSIDE the system that a run was paid.** A paid state, a date, and who
> recorded it. It does **not** mean a bank file, a WPS export or an integration with any bank —
> that is a separate scope if it is ever wanted.

Checked against every existing contract before building on it, and nothing contradicts it:

* `payslip.model.ts` says out loud there is **no payment status** today, "and a column for one would
  be a claim that it does" — a claim P-HR-10 now makes deliberately, at the RUN level rather than
  per payslip (§4).
* No bank, IBAN, WPS, SEPA or transfer-file concept exists anywhere in `apps/api` or
  `packages/contracts`. Nothing had to be avoided; there was nothing to collide with.
* **PY-12 (payslip export / PDF) stays closed.** Recording that a run was paid produces no document
  and needs none, so nothing here reopens it — asserted by a guard, not by intent.

## 2. What the repository actually proved

The phase name says Review / Approve / Lock / Pay / Close. The repository says something narrower,
and **the repository is the reference**:

| concept | state today | evidence |
|---|---|---|
| **Calculation** | **not a state.** Compensation is computed on READ, per employee per period | `compensation.service.ts` |
| **Freeze / Lock** | **exists** — `frozen`, irreversible, and it is the only thing that pins facts | `payroll-run.service.ts` header: "THERE IS NO UNFREEZE" |
| **Review** | nothing | — |
| **Approval** | nothing | run statuses are `draft` / `frozen` / `cancelled`, and that is the whole enum |
| **Payment** | nothing | `payslip.model.ts` — "No … payment status" |
| **Close** | nothing | — |

Permissions today are exactly two: `payrollRun.view` and `payrollRun.manage`.

So three states genuinely do not exist and cannot be expressed by anything that does. That is the
proof the brief asked for before adding any.

## 3. The lifecycle, in the order the domain forces

The brief's example was `draft → reviewed → approved → frozen/locked → paid → closed`. **The
repository forces a different order**, and the difference is not cosmetic:

> **A payslip is issued FROM a frozen run.** Until the freeze there are no figures to review, and
> nothing to approve. So approval cannot precede the freeze — it can only follow it.

```
draft ──freeze──▶ frozen ──approve──▶ approved ──pay──▶ paid ──close──▶ closed
  │                  │                    │
  └───────── cancel ──┴────────────────────┘        (cancel stops at `approved`)
```

* **draft** — the period exists, its facts are still moving.
* **frozen** — attendance frozen, leave snapshotted, payslips issuable. *This is the Lock.*
* **approved** — somebody with authority signed off on the issued figures. Two-person rule: whoever
  froze the run may not approve it.
* **paid** — payment recorded, with the date it happened and who recorded it.
* **closed** — the month is finished; nothing further is expected of it.

**Cancel stops at `approved`.** Once a run is `paid`, money has left; a status flip cannot call that
back, and pretending otherwise would be the exact failure the freeze exists to prevent. A payment
recorded in error is a correction in a later period — the same forward-only stance P-HR-08 took.

## 4. Why the state lives on the RUN and not the payslip

`payslip.model.ts` refused a payment status for a good reason: a payslip is *a deliberate copy* of
what somebody was paid, and adding a mutable field to an immutable document weakens it.

A run is the opposite kind of object — it is exactly where period-level decisions already live
(`frozenAt`, `cancelledAt`). So `approvedAt` / `paidAt` / `closedAt` join them there, and **the
payslip stays immutable**. That also matches how the money actually moves: a payroll is approved and
paid as a batch, not slip by slip.

## 5. Rules enforced

Every one is a state check plus a version check, in that order, before any write:

* **No payment before approval** — `pay` requires `approved`.
* **No close before payment** — `close` requires `paid`.
* **No approval before the freeze** — `approve` requires `frozen`; there is nothing to approve
  before it.
* **No facts change after the freeze** — untouched from PY-6/PY-9; this phase adds no path that
  could, and asserts the absence.
* **No lifecycle bypass** — the transitions are the only writers of `status`, each from exactly one
  predecessor, so no side path can skip a step.
* **Idempotent** — a repeated transition is refused by the state check *before* the write, at any
  version, exactly as P-HR-07 established.
* **A permission per transition** — see §6.
* **Audited** — every transition writes a `statusChange` entry with its from/to and its evidence.

## 6. ⚠️ The architectural decision flagged for review

**`reviewed` was NOT added as a state.** Two readings were available and the conservative one was
taken:

* *Taken:* review is an **act**, not a state. The reviewer reads the issued payslips and approves;
  the two-person rule (freezer ≠ approver) is what makes it a real second pair of eyes, and that is
  the shape P-HR-04 (D1) and P-HR-05 (D2) already use for every money decision in this system.
* *Not taken:* a distinct `reviewed` state, requiring a third person between freezing and approving.
  That would be a three-person rule, which nothing in this repository does today, and the brief
  explicitly warned against assuming a state because the phase name contains the word.

**If a formal reviewer sign-off distinct from approval is wanted, that is a decision to make and a
state to add — it is not implied by anything here.**

**Two permissions were added**, because "a permission per transition" cannot be met by one key:
`payrollRun.approve` and `payrollRun.pay`. `close` reuses `payrollRun.manage` — it moves no money
and asserts nothing new, it only says the month is finished.

## 7. Explicitly out of scope

No bank or WPS. No tax, social insurance, profit sharing or GL posting. No reports, no retro engine,
no overtime multiplier. No migration — the three new states are additive and every existing row is
still valid in its current one. PY-12 stays closed.
