# P-HR-08 — Retro / Post-Freeze Corrections

**Status:** shipped for everything the repository can decide. **One part is blocked on an owner
decision and was deliberately not built** — §4.

---

## 1. What was already true before this phase

Nothing here was invented; all of it was found and is cited.

| fact | where |
|---|---|
| A regularization approved against a frozen day is stamped `postFreeze: true` and the day row **is not recomputed** | `regularization.service.ts` · asserted in `hr-attendance.spec.ts` |
| The frozen row does not move a byte — the AT-4 test compares the whole document before and after | `hr-attendance.spec.ts` |
| Overtime approval on a frozen day is refused outright (422) | same |
| There is **no unfreeze**, anywhere | `day-record.service.ts` |
| A payroll adjustment **cannot be recorded against a frozen period** (PY-9), re-checked at submit and at approval, not only at creation | `payroll-adjustment.service.ts` → `assertPeriodOpen` |
| A second **live** adjustment with the same employee, month, kind and reason is refused with 409; cancelling releases the reason | `payroll-adjustment.repository.ts` → `findDuplicate` |

So the immutability half of "retro" was complete before P-HR-08 started, and this phase changed
none of it.

## 2. The defect this phase closed

**Nothing could find a post-freeze correction.** The stamp shipped with AT-5 and had no reader
outside its own module: no filter, no screen, no list. A correction against a month that was already
paid is precisely the case that requires a human to act — and it was the one case nobody could see.
It was recorded correctly and then went nowhere.

### What shipped

* `postFreeze` filter on `ListAttendanceRegularizationsQuerySchema`, applied in the repository.
  Exact match, not truthiness: `postFreeze=false` is a real question ("what still recomputed
  normally?").
* A third tab on the existing Regularization Queue screen, with a note that says plainly what the
  screen cannot do.
* **No new endpoint, no new permission, no new page, no migration.** The organization-wide read
  already existed and is already behind `attendance.decideRegularization`.

## 3. The forward path, and why it is the only one

A correction cannot reach the month it belongs to: that month is frozen, and PY-9 refuses a figure
against it. So it travels forward, as an ordinary payroll adjustment in a later **open** month —
the path P-HR-04 built and this phase reuses without extending.

**Double application is prevented by a rule that already existed.** `findDuplicate` refuses a second
live adjustment with the same employee, month, kind and reason; a correction carries its own reason,
so recording it twice is a 409. Cancelling the first releases the reason, which is how P-HR-04
intends a mistake to be fixed. Both directions are now pinned by integration tests.

No mechanism was added for this. A `correctionRef` field, a link table or a third payroll↔attendance
port were all considered and rejected: each would cross the §15.1 seam or add a stored field, and
none is needed for the guarantee the existing rule already gives.

---

## 4. THE DECISION — ruled by the owner

**Ruled, not open.** The question this section used to raise — what a correction is *worth* — has
been answered as a matter of policy rather than derivation:

> **A frozen payslip or payroll run is never modified.** A correction found after the freeze is
> handled as a payroll adjustment on a LATER period, carrying its reference to the original period
> in the audit trail where the existing structures already allow it. No `correctionRef`, no link
> collection and no new endpoint is added for this decision alone. Where the corrected quantities do
> not exist, they are not re-derived and no financial difference is computed automatically — the
> correction needs an adjustment entered by whoever holds the authority, at the correct value.
>
> **P-HR-08 is therefore surface, auditability and guardrails — not a retro-calculation engine.**

### Why the amount still cannot be derived (kept, because it is the reason for the ruling)

1. **The corrected quantities do not exist anywhere.** The §15.1 feed is complete-or-nothing and
   frozen; the day row was deliberately not recomputed. There is no "what the month should have
   said" to compare against "what it did say".
2. **Producing one would mean re-pricing a frozen month** — exactly what the freeze forbids, and the
   freeze is irreversible by design.
3. **Even given both figures, the delta is a policy question, not arithmetic.** Gross or net? Which
   lines participate? Is a downward correction recovered, and over how long? Egyptian labour law has
   answers; this repository does not.

So the amount is a human decision, made under the two-person rule that already governs adjustments,
and the screen says so rather than implying otherwise.

### The audit reference, with what already exists

No field was added. The reference travels in the adjustment's `reason`, which is:

* **required and non-empty** — an adjustment cannot be recorded without one;
* **part of the duplicate key** (`employeeId + period + kind + reason`), so it is what makes the
  same correction unrepeatable while it is live;
* **audited** — the `create` entry records it, and every status change is recorded beside it.

That is a real audit trail for "which correction is this answering", achieved with the structures
P-HR-04 already built. A dedicated field would add a second place for the same fact to live.

### Explicitly out of scope, by the same ruling

No retro engine, no migration, no new API. Anything that would compute a difference automatically is
a separate phase with its own decision.

## 5. Standing constraints observed

`freezePeriod()` semantics untouched. Frozen facts and issued payslips remain immutable — this phase
adds no path that could change either. No new financial rule, no new API, no new permission, no new
setting, no migration. PY-12 remains closed.
