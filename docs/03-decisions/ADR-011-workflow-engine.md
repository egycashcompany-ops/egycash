# ADR-011: Configurable workflow engine as data, not code

**Status:** Proposed · **Date:** 2026-07-08

## Context

Every ECMS business process (recruitment pipeline, cash-order lifecycle, vault operations) is a
staged process with approvals. Hard-coding states into entity logic means every process change is
a deployment, and every module reinvents status handling, history, and approval wiring.

## Decision

A platform **Workflow Engine** where definitions are versioned data:

- **Definition** = states, transitions, guards (required permission, entity-condition expression),
  actions (notify, assign, set field, emit event, request approval), and SLA timers per state.
- **Instance** = one entity's journey; stores current state and the full transition history
  (actor, timestamp, comment) — the entity's status history *is* the workflow history.
- **Versioning**: in-flight instances complete on their definition version; edits create a new
  version for new instances.
- **Module integration**: modules ship default definitions in their manifest (seeded once), read
  state via the workflow API, and react to `platform.workflow.transitioned` events. Modules never
  branch on hard-coded state strings outside the definition's declared states.
- **Approval integration**: a transition may declare `requiresApproval: <chain>`; the Approval
  Engine (ADR in [Platform Core §11](../02-architecture/platform-core.md)) holds the transition
  until the chain resolves.
- Guard conditions use a **restricted declarative expression form** (field comparisons over the
  entity snapshot) — not arbitrary code — so definitions stay admin-editable and safe.

## Alternatives considered

- **Status enums per entity** — rejected: unconfigurable, duplicated history/approval logic per module.
- **Embedding a BPMN engine (Camunda/Zeebe)** — rejected: heavyweight external dependency and
  modeling language for processes that are, in practice, guarded state machines.
- **Arbitrary JS hooks in definitions** — rejected: code execution from DB content is a security
  and maintainability hazard; module-registered named actions cover extensibility.

## Consequences

- ✅ Process changes (add a stage, change approvers) are admin configuration, not releases.
- ✅ One implementation of history, SLA, and approvals serves every module.
- ⚠️ The engine is the most complex platform service — built and tested once, to platform quality.
- ⚠️ Declarative guards can't express everything; escape hatch = module-registered named guard
  functions, referenced by name in definitions (reviewable code, configurable wiring).
