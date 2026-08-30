# Cross-Module Dependency Audit (P-SYS-1)

**Status:** audit complete. One defect (F1), three unguarded-but-correct areas (F2–F4), and an
ordering for the remaining work. **Base:** `main` at `64ac553`.

The first audit of this system that is not about a module. HR is finished; the question before
starting anything else is what the seven modules actually do to each other, and where a change in
one can reach another without anybody meaning it to.

---

## 0. Method, and the two times it was wrong

This section exists because two of the findings below started out as different, larger, and false
claims. Recording that is cheaper than being believed once and wrong.

**«Cross-module imports are almost non-existent.»** A first pass grepped for
`from '../../<module>'` and found essentially nothing. The pattern was too narrow: the real imports
go through `../fleet-boundary`, one directory up, and never matched. There *is* a dependency
structure (§1) and it is a good one — but «almost none» was an artefact of the regex, not a
property of the code.

**«48 catalogued events are never emitted.»** Matching `emit(SomeEvents.Name)` symbolically found
48 orphans. It missed three things: the recruitment engine emits `event.name` **dynamically** from
a parallel map; training publishes through a `publish(name, doc)` helper; payroll passes the event
in as a parameter. Matching event *strings* instead was worse — 175 false positives, because the
API refers to events by symbol, not by literal. Only the **union** of both tests is sound, and it
gives **two**, not 48 (F1).

The rule this leaves behind: in a codebase where the same fact is declared in two places and
reached three ways, a single grep is a hypothesis, not a result.

## 1. What the modules actually do to each other

### 1.1 Code imports — three edges, two of them through a named boundary

| from | to | via | what it takes |
|---|---|---|---|
| `operations` | `fleet` | **`operations/fleet-boundary.ts`** | duty assignments by date, vehicle codes — read-only |
| `gold` | `fleet` | **`gold/fleet-boundary.ts`** | one fact: which vehicle carried a shipment — read-only |
| `hr` | `automation` | *(no boundary file)* | `matchesFilters`, `validateTrigger` — pure functions |

**The boundary file is the pattern worth naming.** Each consumer owns a file whose entire job is to
be the one place it touches another module, saying in its own words what it takes and why:

> *«The ONE place Gold touches Fleet… Gold needs exactly one fact from Fleet: which vehicle carried
> a shipment… READ-ONLY by contract. Anything beyond a read would go through a Fleet-owned service,
> never around it.»*

That turns a dependency into something a reviewer can see in one file instead of hunting for it.
Two of the three edges do it. **HR → Automation does not** — see F3.

### 1.2 Events — three edges, and one of them is invisible to a search

| subscriber | event | declared as |
|---|---|---|
| `fleet` | `hr.employee.exited` | string literal |
| `it` | `hr.employee.exited` | string literal |
| `automation` | `platform.user.statusChanged` | **a constant reference** |

Subscriptions per module: HR 14, Automation 1, Fleet 1, IT 1, and **zero** in ATM, Gold and
Operations. So the runtime coupling between modules is genuinely three edges, two from one event.

The third is declared as `PlatformEvents.UserStatusChanged` rather than as a string, so a search
for `event: '...'` returns a graph that is complete for six modules and silently missing the
seventh — and that edge is the security-bearing one (P-HR-SEP §2: it is what stops a leaver's
scheduled workflows). Neither style is wrong; a check that depends on which one a module chose is.

### 1.3 The real backbone is the platform, not the modules

| platform surface | module files importing it |
|---|---|
| `platform/auth` | 207 |
| `platform/audit` | 113 |
| `platform/rbac` | 113 |
| `platform/kernel` | 71 |
| `platform/files` | 50 |
| `platform/settings` | 26 |
| `platform/organization` | 20 |
| `platform/notifications` | 18 |
| `platform/users` | 10 |
| **`platform/realtime`** | **0** |

Modules depend on the platform an order of magnitude more than on each other, which is the shape
this architecture wanted. **Realtime at zero is the confirmation, not an omission:** ADR-029 has
realtime ride the audit chokepoint, so no module imports it and none can accidentally bypass it.

## 2. F1 — Two catalogued events that nothing can ever emit **(defect)**

215 events are catalogued. **213 are reachable from API code. Two are not:**

| event | promised for | what actually happens |
|---|---|---|
| `hr.applicant.returnedToStage` | *«Candidate returned to an earlier stage; forward attempts superseded (RW13)»* | the engine emits **`hr.recruitment.stageLeft`** for RW13 instead |
| `hr.evaluation.opened` | *«Opening a phase record for an applicant (I2 — every workflow action emits)»* | nothing emits it at all |

### Why this is a defect and not tidy-up

The catalogue is not an internal index. It is a **product surface, twice over**:

* `GET /api/v1/automation/events` serves it as the list a workflow trigger is **chosen from**;
* HR notification rules validate against **the same catalogue**, deliberately — *«a rule and a
  workflow trigger ask the same question of the same catalogue; two implementations of that
  question is how the two answers start to differ.»*

So a person can build an automation trigger, or write a notification rule, on either of these two
events. It validates. It saves. It is enabled and green. **And it never fires, for ever, with no
error anywhere.**

`rule-validation.ts` opens by naming this exact failure as the thing it exists to prevent:

> *«Every check here exists because the failure it prevents is SILENT. A rule saved against an
> event nobody publishes… is enabled, green, and does nothing. Nobody reports it, because there is
> nothing to report — the notification simply never comes, and the person waiting for it assumes
> the system works differently than they thought.»*

The validator cannot catch it, because **the catalogue is its source of truth and the catalogue is
what is wrong**. The one door it does not check is the one these two come through.

### Why no gate caught it

`catalog.spec.ts` checks coverage in both directions — «catalogues every declared event» and
«invents nothing — every catalogued name is a declared event constant». Both are
**contracts ↔ contracts**. Neither reaches the API, and structurally neither can: the contracts
package cannot see `apps/api`. A check for this has to live where both are visible, beside
`check-page-registry.mjs`, which already reads module manifests from `scripts/`.

`scripts/check-event-reachability.mjs` is added by this phase and reports both today. It is
**a report, not yet a gate** — see D1.

## 3. F2 — Twenty-three scoped repositories outside HR, and nothing pins them

Repositories declaring a scope axis (`branchField` / `departmentField`), and the specs that hold
them in place:

| module | scoped repositories | guard specs |
|---|---|---|
| gold | 8 | 0 |
| it | 6 | 0 |
| atm | 5 | 0 |
| automation | 3 | 0 |
| fleet | 1 | 0 |
| **hr** | **16** | **4** |
| operations | 0 — *correctly* | n/a |

**There is no live defect, and the audit says so plainly.** The opposite direction was checked
directly: every model outside HR carrying a `branchId` has something declaring `branchField`, and
no model outside HR carries a `departmentId` without a matching declaration. The single apparent
exception, `atm/catalogs/ref-label`, declares it in its *service* rather than a `*.repository.ts` —
a filename heuristic missed it, the code is correct.

So the finding is **«nothing keeps this true»**, not «this is broken». An audit that reported
twenty-three unguarded repositories as a live exposure would be raising an alarm about a system
that is currently right, and the next alarm would be believed less.

What makes it still worth doing is the track record. Each HR guard's own header records that this
defect **shipped twice and survived review both times** — F-B1-1 in payroll, through four phases;
F-REQ-1 in recruitment, the same — and that it is invisible by construction:
`BaseRepository.scopeFilter` answers an undeclared field with an **empty filter**, `baseFilter`
drops the empty clause, and a branch-scoped reader is served the whole organization. Nothing fails,
nothing warns, and the rows that should have been hidden look exactly like rows that do not exist.

**Operations is the model answer.** Every one of its repositories passes `{}` with a comment saying
why — *«organization-level reference data, no org scoping»*, *«organization-wide, like the crew
board it feeds»* — and no Operations model carries a `branchId` at all. The absence is **declared**.
That is the difference between a module that decided and a module that forgot, and it is exactly
what a guard spec makes checkable.

## 4. F3 — HR reaches into Automation with no boundary file

`hr/notification-rules` imports `matchesFilters` from `automation/triggers` and `validateTrigger`
from `automation/workflows`, directly into two feature files. The reuse itself is right, and stated
as such: *«borrowed WHOLE from automation rather than reimplemented»*.

Two things follow that are not:

* it is **the only cross-module edge with no boundary file**, while the two Fleet edges each have
  one. The asymmetry is not a decision anybody took; it is the older edge.
* `automation.module.ts` says *«With the flag off nothing here loads: no routes mounted, no
  permissions synced, no event subscriptions»*. True of the **manifest**. These three imports are
  file imports, not manifest registrations, and HR is not flag-gated — so Automation's
  trigger-matching code loads in every deployment whether `AUTOMATION_ENABLED` is on or not.

Not a bug. A sentence that is narrower than it reads, and an edge that is harder to see than the
other two.

## 5. F4 — «28 deliberately unassigned» is asserted by the sentence, not the data

`check-page-registry.mjs` prints `${permissions.length - assigned} deliberately unassigned`, where
`assigned` is `permissions.filter(p => p.pageId !== null).length`. Nothing records which 28 keys
those are or why each has no page.

Every phase this session added permissions and read that line as confirmation the registry was in
order. It would have printed the same reassuring word if a key had lost its page by accident.
`validatePageRegistry` guards the opposite direction — a page with no permission, the `empty-page`
refusal that surfaced Medical's D3-b — so only this side is unwatched.

Not a defect. A claim with nothing behind it, inside a gate whose whole job is to be believed.

## 6. Decisions

### D1 — The reachability check ships as a report, not a gate

`scripts/check-event-reachability.mjs` exits 0 and prints what it finds. It becomes a blocking gate
in the change that resolves F1, and not before: a gate that fails on `main` from the day it lands
teaches people to ignore it, and the two events it would fail on need a decision that is not this
audit's to take (§8 Q1).

### D2 — The audit does not resolve F1 itself

Each orphan has two possible answers — emit the event, or remove it from the catalogue — and they
are different decisions with different consequences. Emitting `hr.evaluation.opened` would start
firing notifications and automation triggers that have never fired. Removing it withdraws something
the catalogue has promised. Neither is a tidy-up, so both are put to the owner rather than guessed.

### D3 — No module boundary is refactored by this audit

F3 names an asymmetry; it does not fix it. Adding `hr/automation-boundary.ts` would be a real
improvement and a change to a working module made for symmetry rather than need — which is exactly
the scope-widening this system's phases have refused elsewhere. It is recorded for whoever next
touches `notification-rules`.

### D4 — Ordering the remaining work is a dependency question, and the dependencies are thin

With three code edges and three event edges, **no remaining module blocks another**. Fleet is
depended upon by two (Operations, Gold), so a breaking change there is the only one with reach;
everything else can be worked in any order without a technical constraint. That means the order is
a **business** question, not an architectural one — and this audit deliberately does not dress a
business priority up as a dependency.

## 7. What the order should be, and why

Ranked by what the audit can actually justify:

1. **The scope guards (F2)** — five spec files, no runtime change, protecting who can read whose
   data, against a defect with a two-for-two record of shipping. Cheapest real risk reduction here.
2. **F1's resolution + turning D1's report into a gate** — small, and it closes a silent failure a
   user can walk into today.
3. **Fleet, if any module is to be extended** — the only module two others read through a boundary,
   so it is where a breaking change costs most and where guards pay most.
4. **Everything else — by business priority.** Gold, IT, ATM and Operations are mutually
   independent. There is no technical reason to prefer one, and inventing one would be worse than
   admitting it.

## 8. Questions for the owner

**Q1 — the two orphan events (F1).** For each: emit it, or withdraw it from the catalogue?
`hr.evaluation.opened` looks like an intended emit that was never wired — its own comment says
*«every workflow action emits»*. `hr.applicant.returnedToStage` looks like a **renamed** event: the
engine emits `hr.recruitment.stageLeft` for the same RW13 rule, and one of the two names is
redundant. Both matter because a person can build a rule on either today.

**Q2 — should `AUTOMATION_ENABLED` isolate Automation's code, not only its manifest (F3)?** Today
its pure helpers load everywhere through HR. Harmless now; it decides what the flag is meant to
promise.

**Q3 — what are the 28 unassigned permissions (F4)?** Either they get a list with a reason each, or
the gate stops calling them deliberate.
