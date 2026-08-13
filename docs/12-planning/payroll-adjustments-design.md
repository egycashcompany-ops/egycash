# Payroll Adjustments — Bonuses / Grants + Penalties (P-HR-04)

**Status: decisions frozen (D1–D5, owner-approved), implemented in this phase.**

**Base:** `main` at `037a910`.

A bonus is not a rate and a penalty is not a policy: each is **one amount, for one person, for one
month, because somebody decided so**. That sentence is the whole design, and every rule below is
it restated against something the codebase already does.

---

## 1. Why not a Pay Item

Pay Items serve the *recurring* case and serve it well — but they cannot say "once":

| | evidence |
|---|---|
| a `fixed` item **prorates** by `daysInForce / periodDays` | `compensation-rules.ts` — a 5,000 bonus recorded on the 20th pays a fraction of itself |
| **no two** assignments of one item may overlap | `employee-pay-item.service.ts` — two bonuses in one month need two catalog items |
| an open-ended assignment **pays every month, forever** | `employee-pay-item.model.ts` — a forgotten end date is a permanent raise |
| an assignment has **no `update`** | the service exposes `list` / `create` / `remove` only |
| it carries no **reason**, no **approver**, no **attachment** | the model has `note` and nothing else |

So P-HR-04 adds a source rather than bending one. That is not a new idea here: the pure engine has
taken a new money source twice already — PY-4 (attendance quantities) and PY-5 (leave) — each as a
port plus an `origin`. This is the third, in the same shape.

## 2. The frozen decisions (D1–D5, owner-approved)

| # | decision |
|---|---|
| **D1** | An adjustment needs **one approval by a second person** before it reaches payroll, under a **separate `approve` permission**, with a simple Contracts-style state machine — **not** a Manager → HR chain. |
| **D2** | **No penalty cap inside ECMS.** No payroll setting, no legally-derived percentage. Any future legal requirement is its own decision. |
| **D3** | A negative net is **neither blocked, floored, nor carried forward**: the figure is computed as it stands and `netBelowZero` is raised — the behaviour payroll already has. |
| **D4** | `payItemId` is **optional**. Present, the line takes the catalog item's identity; absent, it uses a fixed code and name plus the reason. A Pay Item is **never required**. |
| **D5** | **One-off only**, bound to a single payroll period. No recurring monthly bonus, no instalments, no total spreading. Recurring already lives in Pay Items; instalments belong to P-HR-05. |

### What each decision costs, in code

- **D1** is the state machine and the permission split. Nothing else in the phase depends on it.
- **D2** is the absence of a rule — there is nothing to implement, and `payroll.*` gains no setting.
  (Searched before deciding: the only caps in this repository are leave caps and the overtime
  ceiling. No cap, no legal rule, no payroll setting of any kind exists.)
- **D3** is *already* the engine's behaviour: `if (netMinor < 0) warnings.push('netBelowZero')`, and
  the payslip stores `warnings`. This phase changes nothing and must keep changing nothing.
- **D4** needs no contract change at all: `CompensationLineDto` already carries `payItemId: string |
  null`, and PY-5 already emits a line with `payItemId: null` under its own constant code
  (`LEAVE_SHORTFALL`). The shape exists; this uses it.
- **D5** is what makes the entity *period-keyed* rather than interval-keyed, which in turn makes the
  freeze check a membership test instead of a range query.

## 3. The entity

`hr_payroll_adjustments` — one document per decision.

- `employeeId`, `branchId` (ADR-015 scope, denormalized at write like every HR collection)
- `period` — `YYYY-MM`, the Cairo month; **the binding to payroll**
- `kind` — `bonus | penalty`; the direction of the line
- `amount`, `currency` — major units, as `employee_pay_items` stores them
- `reason` — **required**; a payment nobody can explain is not a payment anybody should make
- `payItemId` — optional (D4), for the line's identity only; never for its arithmetic
- `note`, `attachmentFileId` — the document behind the decision (ADR-023, the HR3-C pattern)
- `status`, `submittedBy/At`, `decidedBy/At`, `decisionNote`, `cancelledBy/At`, `cancelReason`

### States (D1)

```
draft ──submit──▶ pendingApproval ──approve──▶ approved
  ▲                     │
  └──────reject─────────┘                     (any live state) ──cancel──▶ cancelled
```

`reject` returns to `draft` so the mistake can be fixed and resubmitted — the Contracts precedent
(`status: input.decision === 'approved' ? 'approved' : 'draft'`).

**Only `approved` reaches payroll.** A draft is a proposal; the engine never sees it.

**`approved` is immutable.** No edit, no delete — only `cancel`, and only while the period is open.
That is the same append-only stance Personnel Actions take, for the same reason: a figure somebody
approved is a record of a decision, not a working note.

## 4. Validation, and what each rule is protecting

| rule | protects |
|---|---|
| the employee is visible in the caller's scope | ADR-015; the same `scopeSelector` every HR write uses |
| the period lies inside **one employment span** | paying for a stretch nobody worked here (the PY-3/D3 rule, reused) |
| the period is **not frozen** | a month that has been priced changing after the fact (PY-9's rule, reused) |
| the currency equals the **basic salary's** | PY-3 refuses to total two currencies; an adjustment in a third is a payslip that cannot be issued |
| `amount > 0` | direction is `kind`'s job — a negative bonus is a penalty written unclearly |
| no identical live entry in the same period | the double-submit |

The last one is held by the **service**, with an index making the check cheap — deliberately the
same division `employee_pay_items` uses for its overlap rule, and for the same reason: "identical
live entry" is a predicate, not a key.

## 5. Payroll integration

```
approved adjustment ──port──▶ computeCompensation ──▶ line (origin: 'adjustment')
                                                       │
                                              run frozen ──▶ payslip snapshot (immutable)
```

- The port reads **`approved` only**, for one employee and one period. Payroll never reaches into
  the collection directly — the same seam PY-4 and PY-5 established.
- The line is **not prorated**: `prorationFactor: null`, and its amount is exactly the decided
  amount. That is the difference from a Pay Item, stated in the one field a reader will check.
- A `bonus` lands in `earnings`, a `penalty` in `deductions`. Both totals are already computed by
  summing those arrays, so nothing about totalling changes.

### Freeze, and correction after it

Before the freeze an adjustment can be created, submitted, approved and cancelled. After it, the
period refuses both creation and cancellation — there is no unfreeze, and an issued payslip that
disagrees with a recalculation is the failure the freeze exists to prevent.

A mistake found after the freeze is corrected by a **new adjustment of the opposite kind in a later
period**, never by editing history. This is the same forward-adjustment stance the attendance
module already takes for post-freeze corrections.

## 6. What this phase deliberately does not do

No cap (D2). No instalments and no recurring (D5). No statutory or legal deduction. No payroll
setting. No change to Pay Items, to PY-1…PY-12 behaviour, or to `employment.allowances[]` — which
remains what PY-10 froze it as: historical data that pays nobody.

## 7. Open questions this phase does not answer

- **Who may approve** is a permission, and the permission is separate — but *which role holds it*
  is an administration decision, not a code one.
- Whether an adjustment should notify the employee. No template is added: notifications ship with
  the code that sends them, and nothing here sends one.
