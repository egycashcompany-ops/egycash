# Automation Module — Architecture & Design

**Status: DRAFT — awaiting approval.** Not frozen. No implementation until §14 blockers are
resolved and the approver freezes this document. Later revisions supersede earlier text.

**Companion ADR:** [ADR-018 — n8n as the Automation Engine](../03-decisions/ADR-018-automation-engine.md)

---

## 1. Purpose & scope

A first-class **Automation** module that lets business users automate processes across every ECMS
module, without a developer and without any module knowing automation exists.

```
ECMS
├── HR            ┐
├── Fleet         │  publish events (already do, via ADR-008)
├── Treasury      │
├── Contracts     ┘
└── Automation    ← this module (/automation) — subscribes, orchestrates, calls back
```

**In scope:** the Automation module (registry, executions, credentials, variables, templates,
scheduling, monitoring), the event→trigger bridge, the callback API surface for n8n, credential
encryption, the n8n deployment, and the template catalogue.

**Out of scope, recorded here so it is not assumed:** replacing the Workflow Engine (ADR-011);
letting automations own entity state; exposing n8n's builder to anyone outside ECMS auth; automating
across organizations (ECMS is single-organization, ADR-015).

### 1.1 The boundary against ADR-011 — read this first

ADR-011's Workflow Engine and this Automation Engine are different machines and the difference is
not cosmetic:

- **Workflow Engine** answers *"what state is this entity in, and who may move it?"* It is on the
  write path, inside the transaction, and it is the source of truth.
- **Automation Engine** answers *"what should happen elsewhere because that already happened?"* It
  is strictly downstream of a committed event and owns nothing.

An automation may *request* a state transition by calling the same permissioned, audited endpoint a
human would. It never writes state itself. If this rule is relaxed later, the two engines will
start disagreeing about reality and the audit trail stops being trustworthy — so it is stated as
a rule, not a guideline, and §7 enforces it in the token scope.

---

## 2. Overall architecture

```
                       ┌───────────────────────────────────────────┐
                       │  Browser (React, ECMS session cookie)     │
                       └───────┬────────────────────────┬──────────┘
                    /automation│ REST              iframe│ /api/v1/automation/builder/*
                               ▼                         ▼
   ┌───────────────────────────────────────────────────────────────────┐
   │  ECMS API  (Railway: ecms-api)                                    │
   │                                                                   │
   │   modules/automation/                                             │
   │     workflows/     executions/    credentials/                    │
   │     variables/     templates/     triggers/                       │
   │                                                                   │
   │   platform/kernel/event-bus.ts  ← already exists (ADR-008)        │
   │   platform/rbac, audit, notifications, files, pdf, scheduler      │
   └────┬──────────────────┬───────────────────────┬───────────────────┘
        │ Mongo            │ Redis (BullMQ)        │ private network only
        ▼                  ▼                       ▼
   ┌─────────┐      ┌──────────────┐      ┌──────────────────────────┐
   │ MongoDB │      │ Redis        │      │  n8n  (Railway: ecms-n8n)│
   │ ecms_*  │      │ queues:      │      │  ─ webhook  /webhook/... │
   │ auto_*  │      │  automation  │      │  ─ REST API /rest/...    │
   └─────────┘      └──────────────┘      │  ─ builder UI (proxied)  │
                                          └───────────┬──────────────┘
                                                      │ workflow storage
                                                      ▼
                                          ┌──────────────────────────┐
                                          │ PostgreSQL (Railway)     │
                                          │ n8n workflows/executions │
                                          └──────────────────────────┘
```

**Why PostgreSQL for n8n and Mongo for ECMS.** n8n supports Postgres or SQLite. SQLite on a Railway
volume cannot survive a replica change and makes backups a file-copy problem; Postgres is n8n's
own recommendation for production and Railway provisions it natively. ECMS's own data stays on
Mongo (ADR-005) — this is n8n's private store, not an ECMS datastore, and no ECMS code reads it.

### 2.1 The two directions, and how each is secured

**Inbound (ECMS → n8n): an event fires an automation.**

```
module service
  └─ emit('hr.employee.created', payload, { reliable: true, session })   ← inside the txn
       └─ automation_outbox row committed with the business write
            └─ BullMQ 'outbox' → dispatchReliable → automation's handler
                 └─ handler looks up enabled workflows for this event + branch
                      └─ POST https://ecms-n8n.internal/webhook/<id>
                             headers: X-ECMS-Signature: sha256=<hmac>
                                      X-ECMS-Execution: <executionId>
```

Security: the n8n service has **no public ingress** (Railway private networking). The webhook body
is HMAC-signed with a per-workflow secret so n8n can reject anything not from ECMS. The execution
row is written *before* the POST, so a crash between the two leaves a `pending` execution that the
sweep retries rather than an invisible loss.

**Outbound (n8n → ECMS): an automation does something.**

```
n8n HTTP Request node
  └─ POST https://ecms-api.internal/api/v1/automation/actions/<action>
       headers: Authorization: Bearer <service token>
                X-ECMS-Execution: <executionId>
         └─ service-token middleware resolves the token → principal
              └─ SAME permission gate, SAME data-scope filter, SAME audit as a human request
```

Security: the token is minted per execution, expires with it, and carries exactly the permissions
and branch scope of the **workflow's owner at dispatch time** (§7). There is no automation
superuser. Every call it makes is audited with `actor.kind = 'automation'` and the execution id, so
"who changed this record" answers "workflow X, run Y, on behalf of user Z" rather than "the system".

---

## 3. Event system

### 3.1 What already exists

`apps/api/src/platform/kernel/event-bus.ts` is production-ready and does not need changing:

- Two tiers: `emit(name, payload)` in-process best-effort, and `emit(..., { reliable: true, session })`
  which writes an **outbox row inside the caller's transaction**, relayed to BullMQ and dispatched to
  idempotent consumers (`ProcessedEventModel` dedups on `${eventId}:${handlerId}`).
- Versioned envelopes (`EventEnvelopeSchema`), `EVENT_SCHEMA_VERSIONS`, tolerant (non-strict) payload
  parsing on the consumer side.

**Automation subscribes as an ordinary module consumer.** No new bus, no new delivery guarantee, no
change to any publisher. This is the single most important reuse decision in the design: it means
adding automation cannot destabilise any existing module.

### 3.2 Naming — the requested events, mapped to the existing convention

The brief lists events as `HR.Employee.Created`. The established convention in
`packages/contracts/src/events/index.ts` is lowercase `<module>.<entity>.<pastTenseEvent>`, with
platform events prefixed `platform.`. Automation adopts the existing convention rather than
introducing a second casing — mixed conventions in one catalogue is a permanent tax.

| Brief | ECMS event name | Publisher status |
|---|---|---|
| `HR.Employee.Created` | `hr.employee.created` | to add |
| `HR.Employee.Updated` | `hr.employee.updated` | to add |
| `HR.Leave.Approved` | `hr.leave.approved` | to add |
| `Fleet.Vehicle.Assigned` | `fleet.vehicle.assigned` | module not built |
| `Fleet.Vehicle.Returned` | `fleet.vehicle.returned` | module not built |
| `Treasury.Transaction.Created` | `treasury.transaction.created` | module not built |
| `Treasury.Transaction.Approved` | `treasury.transaction.approved` | module not built |
| `Accounting.Invoice.Created` | `accounting.invoice.created` | module not built |
| `Accounting.Invoice.Paid` | `accounting.invoice.paid` | module not built |
| `Contract.Created` | `hr.contract.created` | to add (module exists) |
| `Contract.Expired` | `hr.contract.expired` | to add (module exists) |
| `Document.Uploaded` | `platform.file.uploaded` | **exists** |
| `User.Created` | `platform.user.created` | **exists** |
| `User.Deactivated` | `platform.user.statusChanged` | **exists** |
| `Role.Changed` | `platform.role.changed` | **exists** |
| `Password.Reset` | `platform.auth.passwordReset` | to add |
| `Asset.Created` | `admin.asset.created` | module not built |
| `Purchase.Request.Approved` | `purchasing.request.approved` | module not built |

**This table is the honest scope statement.** Six of eighteen already publish. Four more are small
additions to modules that exist. **Eight belong to modules that do not exist yet** — Fleet,
Treasury, Accounting, Purchasing, Administrative assets. Automation cannot subscribe to events
nobody emits, so those arrive with their modules. The engine is built once and each module gets
automation for free when it lands, which is the right sequencing; it is not a reason to delay.

### 3.3 The event catalogue as a first-class surface

Automation needs to *show a user* what they can trigger on. A new
`packages/contracts/src/events/catalog.ts` exports, per event: the name, a localised label, the
owning module, a JSON-schema-ish description of the payload, and a sample payload. The catalogue is
generated from the existing Zod payload schemas, so it cannot drift from what is actually emitted.

`GET /api/v1/automation/events` serves it to the trigger picker.

---

## 4. Workflow triggers

| Trigger | Mechanism | Notes |
|---|---|---|
| Entity Created / Updated / Deleted | event subscription | `<module>.<entity>.created` etc. |
| Status Changed | event subscription + filter | listens to the module's status event, filters on `from`/`to` |
| Scheduled Time | `automation_schedules` + platform scheduler | one-shot at a timestamp |
| Cron | `automation_schedules` + platform scheduler | Cairo timezone by default (matches Leave's calendar) |
| Manual | `POST /workflows/:id/run` | permission-gated, audited, accepts an input payload |
| Webhook | `POST /automation/hooks/:token` | inbound from outside ECMS; token-scoped, rate-limited |
| API Call | any ECMS service calling `automationService.trigger()` | the seam for module code that wants an explicit hook |

**Filters.** A trigger may carry a declarative condition over the payload — the same restricted
expression form ADR-011 mandates for guards (field comparisons, no arbitrary code). Reusing that
form rather than inventing a second one means one parser, one test suite, one security review.

**Scheduling reuses the platform scheduler** (`ScheduledTaskDeclaration` in the module manifest)
rather than n8n's own cron. One place to see everything scheduled, one place it can be paused, and
schedules survive an n8n rebuild.

---

## 5. Actions

Actions are **n8n nodes**. Three families:

**a. ECMS actions** — a small set of first-party HTTP endpoints under
`/api/v1/automation/actions/*`, called with the execution's service token:

| Action | Endpoint | Reuses |
|---|---|---|
| Send Notification | `POST .../notify` | `platform/notifications` |
| Send Email | `POST .../notify` (channel `email`) | notifications' email transport |
| Create Task / Approval | `POST .../task`, `.../approval` | Workflow Engine's approval chain |
| Generate PDF | `POST .../pdf` | `platform/pdf` (already used by Contracts) |
| Upload File | `POST .../files` | `platform/files` |
| Generate Excel | `POST .../export` | existing CSV/export service, extended |
| Update Record | `POST .../records/:module/:id` | the module's own service + permission gate |
| Generate Report | `POST .../reports/:key` | reporting seam |

**b. Outbound connectors** — n8n's built-in nodes: WhatsApp (Business Cloud API), SMS, Slack,
Telegram, Microsoft Teams, Google Calendar, generic REST. Credentials come from ECMS (§7), not from
n8n's store.

**c. AI actions** — §6.

**Reuse rule.** No action re-implements a capability ECMS already has. "Send Email" is the
notifications service with a channel argument, not an SMTP client in a workflow. This keeps
templates, preferences, rate limits, retries and the delivery audit in one place.

---

## 6. AI integration

Providers: OpenAI, Anthropic (Claude), Google (Gemini) — behind one `AiProvider` seam in
`platform/ai/`, so a workflow names a *capability* and the deployment picks the model. Same shape as
`NationalIdOcrProvider`: the module never imports a vendor SDK directly.

Capabilities exposed as actions: summarise a document, classify a record, analyse a CV against a job
description, draft an email, detect an anomaly in a series, recommend an approval, answer a policy
question.

**The data-egress gate — non-negotiable.** Every AI action sends ECMS data to a third party.
Egyptian national IDs, salaries, medical leave reasons and contract terms are in scope of that data.
So:

1. AI actions are **off by default**. A settings flag per provider enables them.
2. Each AI action declares which fields it sends; the workflow builder shows this before saving.
3. A **redaction pass** strips national IDs, phone numbers and bank details unless the workflow
   explicitly opts in per field, with the opt-in recorded on the workflow and audited.
4. Every AI call is audited with provider, model, token counts, and a **hash** of the prompt — not
   the prompt itself, so the audit log does not become a second copy of the data.
5. `recommend an approval` and `detect an anomaly` produce **advice attached to a record for a
   human**. They never auto-approve. An LLM's output is not an authorisation.

---

## 7. Security

### 7.1 Permissions

Module id `automation`; keys follow `PERMISSION_KEY_PATTERN` (`<resource>.<action>`):

| Resource | Actions |
|---|---|
| `workflow` | `view`, `create`, `edit`, `delete`, `enable`, `run`, `transfer` |
| `execution` | `view`, `retry`, `cancel` |
| `credential` | `view`, `create`, `edit`, `delete` |
| `variable` | `view`, `edit` |
| `template` | `view`, `install` |
| `automation` | `admin` (settings, all-branch visibility, builder access) |

`credential.view` **never returns a secret value** — only metadata. There is no read path for a
stored secret anywhere in the API; §7.3 explains why.

### 7.2 Ownership, branch isolation, and the privilege question

Every workflow has an `ownerUserId` and a `branchScope`. Executions inherit both.

**The service token carries the owner's permissions, not the automation's.** This is the central
security decision and it deserves stating plainly: a workflow can do exactly what its owner could
do by hand, in the branches its owner can see, and no more. Consequences that follow, and are
accepted deliberately:

- If the owner's role is reduced, the workflow's power is reduced at the next run. It is not
  silently grandfathered.
- If the owner is deactivated, workflows they own are **suspended**, not orphaned into running with
  a dead principal. `workflow.transfer` moves them to a live owner, audited.
- A workflow cannot be used to escalate: an author who cannot approve a purchase order cannot build
  an automation that approves one.

Branch isolation is enforced at the ECMS boundary — registry filter on dispatch, data-scope filter
on every callback — because n8n Community has no tenancy model to enforce it in.

### 7.3 Secrets and credentials

- Stored in `automation_credentials`, encrypted with **AES-256-GCM envelope encryption**: a data key
  per credential, wrapped by a master key from `AUTOMATION_MASTER_KEY` (Railway secret, rotatable).
- **Write-only through the API.** Values can be set and replaced, never read back. The UI shows
  `••••` and a "replace" action. A stolen session cannot exfiltrate credentials, only use them.
- Injected into an execution at dispatch and held in memory for its duration; never persisted into
  n8n's own credential store, never logged, redacted from execution payload snapshots by key name
  and by value match.
- Rotation re-wraps data keys without re-entering secrets.

There is no crypto helper in the codebase today (only password hashing in `user.model.ts`), so this
is genuinely new code and gets its own PR and its own test suite.

### 7.4 Audit, history, rate limiting

- Every workflow mutation, every enable/disable, every manual run, every credential write → audit
  log with the actor.
- Every action a workflow performs → audited as the owner, tagged `via: automation:<executionId>`.
- Execution history in `automation_executions` with per-node timings and status; payload snapshots
  redacted and retained per the platform retention policy (they contain business data).
- Rate limits: per workflow (runs/minute), per execution (outbound calls), and a global concurrency
  cap. A runaway loop degrades one workflow, not the platform.
- **Loop protection**: an execution carries a `depth` header; an action that emits an event which
  re-triggers the same workflow is refused past depth 3. Without this, `employee.updated` →
  "update employee" is an infinite loop that writes to production.

---

## 8. Database

All collections carry the `automation_` prefix (manifest rule).

| Collection | Key fields |
|---|---|
| `automation_workflows` | `key`, `name{en,ar}`, `description`, `ownerUserId`, `branchScope`, `status` (draft/active/suspended), `trigger{type,event,filter,schedule,webhookTokenHash}`, `n8nWorkflowId`, `hmacSecretRef`, `aiOptIn[]`, `templateKey`, `version`, timestamps |
| `automation_executions` | `workflowId`, `executionId`, `trigger{type,eventId}`, `status` (pending/running/success/failed/cancelled), `startedAt`, `finishedAt`, `durationMs`, `nodes[]{name,status,ms,error}`, `inputSnapshot` (redacted), `outputSnapshot` (redacted), `error`, `actorUserId`, `branchId`, `depth` |
| `automation_credentials` | `key`, `name`, `type` (http/smtp/whatsapp/slack/openai/…), `ciphertext`, `iv`, `authTag`, `wrappedDataKey`, `keyVersion`, `ownerUserId`, `branchScope`, `lastUsedAt` |
| `automation_variables` | `key`, `value`, `scope` (global/branch/workflow), `branchId?`, `workflowId?`, `secret` (bool → stored as credential instead) |
| `automation_templates` | `key`, `name{en,ar}`, `category`, `description`, `requiredCredentials[]`, `requiredEvents[]`, `graph` (n8n JSON), `version` |
| `automation_schedules` | `workflowId`, `kind` (once/cron), `cron`, `runAt`, `timezone`, `nextRunAt`, `lastRunAt`, `enabled` |
| `automation_logs` | `executionId`, `nodeName`, `level`, `message`, `at` — capped collection, short retention |

Indexes: `workflows{trigger.event, status, branchScope}` (the dispatch lookup — hot path),
`executions{workflowId, startedAt:-1}`, `executions{status, startedAt}` (the sweep),
`schedules{enabled, nextRunAt}`.

**No migration is required for existing data.** Every collection is new; nothing is altered. The
one platform-contract change is adding `'automation'` to the `QUEUES` tuple in
`infrastructure/queue/jobs.ts`, which bumps `PLATFORM_VERSION` to `2.2.0` under the ADR-governed
process.

---

## 9. REST API

Base `/api/v1/automation`. All routes authenticated; permissions as §7.1.

```http
GET /workflows?status=active&trigger=hr.employee.created&page=1
200 { "items": [ { "id": "...", "key": "hr-welcome-email",
                   "name": { "en": "Welcome email", "ar": "بريد ترحيبي" },
                   "status": "active", "trigger": { "type": "event",
                   "event": "hr.employee.created" }, "owner": { "id": "...", "name": "..." },
                   "lastRun": { "at": "2026-07-29T10:02:11Z", "status": "success" },
                   "stats": { "runs7d": 43, "failures7d": 1 } } ],
      "total": 12, "page": 1, "pageSize": 20 }
```

```http
POST /workflows
{ "key": "hr-welcome-email", "name": { "en": "Welcome email", "ar": "بريد ترحيبي" },
  "trigger": { "type": "event", "event": "hr.employee.created",
               "filter": { "field": "employmentType", "op": "eq", "value": "permanent" } },
  "branchScope": "branch", "templateKey": "hr.welcome-email" }
201 { "id": "66a1…", "n8nWorkflowId": "wf_8812", "status": "draft" }
```

```http
POST /workflows/:id/run          # manual trigger
{ "input": { "employeeId": "66b2…" } }
202 { "executionId": "ex_5561", "status": "pending" }

POST /workflows/:id/enable       # 200 { "status": "active" }
GET  /executions?workflowId=&status=failed&from=&to=
GET  /executions/:id             # nodes[], timings, redacted snapshots
POST /executions/:id/retry       # 202 — new executionId, links to the original
POST /executions/:id/cancel

GET    /credentials              # metadata only — never a value
POST   /credentials              # { key, type, value } → 201 (value write-only)
PUT    /credentials/:id          # replace value
DELETE /credentials/:id

GET  /variables?scope=global
PUT  /variables/:key
GET  /templates?category=hr
POST /templates/:key/install     # → creates a draft workflow
GET  /events                     # the trigger catalogue (§3.3)
GET  /metrics?window=7d          # dashboard counters
GET  /builder/*                  # authenticated reverse proxy to the n8n editor
```

**Callback surface, service-token only** (not reachable with a user session):

```http
POST /actions/notify | /actions/pdf | /actions/files | /actions/export
POST /actions/records/:module/:id
POST /actions/ai/:capability
POST /executions/:id/progress    # n8n reports node completion back
```

---

## 10. React UI

`apps/web/src/modules/automation/`, mounted at `/automation`, seeded into the navigation catalog so
existing installs receive it at boot (as Leave and Contracts were). Uses the existing design system
and the shared page layout — no new visual language.

| Page | Contents |
|---|---|
| **Dashboard** `/automation` | Runs today / success rate / failures, most-active workflows, recent failures, per-module trigger counts |
| **Workflows** `/automation/workflows` | Table: name, trigger, owner, branch, status toggle, last run, 7-day sparkline; filters by module/trigger/status |
| **Workflow detail** `/automation/workflows/:id` | Header + enable toggle, trigger configuration, run history, "Open builder" → the proxied n8n editor in a full-height iframe |
| **Executions** `/automation/executions` | Live monitor: status chips, duration, trigger source; auto-refresh via the existing socket channel |
| **Execution detail** `/automation/executions/:id` | Node timeline with per-node status/duration/error, redacted input/output, retry + cancel |
| **Credentials** `/automation/credentials` | Write-only manager; masked values, "replace" action, last-used, owning branch |
| **Variables** `/automation/variables` | Scoped key/value editor (global / branch / workflow) |
| **Templates** `/automation/templates` | Catalogue by category, prerequisites shown before install, one-click install → draft |
| **Logs** `/automation/logs` | Filterable stream by workflow/level/time |
| **Settings** `/automation/settings` | AI providers on/off, redaction defaults, rate limits, retention |

Components: `WorkflowStatusChip`, `TriggerPicker` (driven by `GET /events`), `FilterBuilder`
(the ADR-011 expression form), `ExecutionTimeline`, `NodeResultCard`, `CredentialField`,
`BuilderFrame`, `RunSparkline`.

Arabic/RTL throughout, matching the rest of the platform.

---

## 11. Workflow templates (50)

Ships as `automation_templates` seeds. Each is an n8n graph plus prerequisites. Templates whose
events belong to unbuilt modules install as `draft` and cannot be enabled until the event exists —
the installer checks the catalogue, so a template can never silently listen to nothing.

**HR (10)** — welcome email on hire · probation-end reminder (T-14) · contract-expiry escalation
(90/30/7) · leave-approved calendar entry + team notice · leave-balance monthly digest · CV
screening against a job description (AI) · interview reminders to panel + candidate · offer-expiry
chase · document-completeness check on hiring docs · birthday/anniversary greeting.

**Fleet (5)** — assignment notice to driver (WhatsApp) · licence/registration expiry alerts ·
maintenance-due scheduling · fuel-anomaly detection (AI) · return-checklist task on vehicle return.

**Treasury (5)** — transaction-created approval routing by amount band · large-transaction alert to
Finance + Security · daily cash-position report · unapproved-transaction escalation after SLA ·
vault-count reminder.

**Accounting (5)** — invoice-created → approval chain · payment-received receipt to customer ·
overdue-invoice reminder ladder (7/14/30) · monthly close checklist tasks · duplicate-invoice
detection (AI).

**Contracts (4)** — contract generated → PDF to employee + HR file · expiry notice ladder ·
renewal task 60 days out · termination → offboarding checklist.

**Purchasing (4)** — request submitted → approval by amount · approved → PO generation · supplier
delivery reminder · budget-threshold alert.

**Administration (4)** — asset assigned → acknowledgement task · asset warranty expiry · office
supplies reorder point · visitor pre-registration notice.

**Security (4)** — failed-login burst → alert (`platform.auth.loginFailed`) · role change →
notify security officer · break-glass permission used → immediate alert · after-hours access report.

**IT (4)** — user created → account provisioning checklist · user deactivated → access revocation
checklist · password reset → confirmation + audit note · system health digest.

**Documents (3)** — uploaded → OCR + classify (AI) · uploaded to a restricted folder → notify
owner · retention-expiry sweep notice.

**Approvals & notifications (2)** — generic approval-pending reminder ladder · daily "awaiting you"
digest per approver.

Full catalogue with trigger/actions/credentials per template lands with PR **A-9**; the list above
is the committed scope.

---

## 12. Deployment

| Service | Railway | Notes |
|---|---|---|
| `ecms-api` | existing `railway.json` | unchanged |
| `ecms-worker` | existing `railway.worker.json` | picks up the `automation` queue |
| `ecms-n8n` | **new** `railway.n8n.json` | `n8nio/n8n` image, **no public domain** |
| `ecms-n8n-db` | **new** | Railway PostgreSQL, n8n's private store |

n8n environment: `DB_TYPE=postgresdb`, `N8N_ENCRYPTION_KEY` (separate from
`AUTOMATION_MASTER_KEY`), `N8N_PUBLIC_API_DISABLED=false` (ECMS uses the REST API),
`WEBHOOK_URL` set to the private hostname, `N8N_BASIC_AUTH_ACTIVE=true` as defence in depth behind
the private network, `GENERIC_TIMEZONE=Africa/Cairo`.

Environments: `dev` (docker-compose adds `n8n` + `postgres` alongside mongo/redis/mailpit),
`staging`, `production` — each with its own n8n instance and its own credential store. **Workflows
are promoted by exporting the graph and installing it as a template**, never by pointing staging at
production's n8n.

Backups: n8n's Postgres on Railway's managed backups; `automation_*` collections with the existing
Mongo backup. A restore needs both, and the runbook says so.

---

## 13. Implementation plan

Each PR is independently reviewable, independently mergeable, and leaves `main` releasable. No PR
after A-1 changes behaviour for a user who never opens `/automation`.

| PR | Goal | Key files | Tests | Migration |
|---|---|---|---|---|
| **A-0** | This design + ADR-018 frozen | `docs/` | — | — |
| **A-1** | Platform: `automation` queue, `PLATFORM_VERSION` 2.2.0, crypto helper (AES-256-GCM envelope) | `infrastructure/queue/jobs.ts`, `platform/crypto/` | crypto round-trip, rotation, tamper-detect | none |
| **A-2** | Contracts: DTOs, schemas, permissions, event catalogue generator | `packages/contracts/src/modules/automation.ts`, `events/catalog.ts` | schema + catalogue-vs-Zod drift | none |
| **A-3** | Registry: workflows + variables (model, repo, service, routes) | `modules/automation/workflows/` | CRUD, ownership, branch filter | new collections |
| **A-4** | Credentials: write-only store + injection | `modules/automation/credentials/` | no read path, redaction, rotation | new collection |
| **A-5** | Trigger bridge: event subscription → dispatch → execution rows | `modules/automation/triggers/` | idempotency, filter eval, depth guard | none |
| **A-6** | n8n client + service tokens + callback action surface | `modules/automation/n8n/`, `actions/` | token scope = owner scope, no escalation | none |
| **A-7** | Executions: history, retry, cancel, progress callback, sweep | `modules/automation/executions/` | retry idempotency, stuck-execution sweep | new collection |
| **A-8** | Scheduling: cron/one-shot via the platform scheduler | `modules/automation/schedules/` | Cairo tz, pause/resume | new collection |
| **A-9** | Templates: model, installer, the 50 seeds | `modules/automation/templates/`, `seeds/` | prerequisite gate, install→draft | seed |
| **A-10** | AI seam + redaction + egress policy gate | `platform/ai/`, `actions/ai.ts` | redaction, opt-in enforcement, audit shape | none |
| **A-11** | Web: dashboard, workflows, detail, builder proxy | `apps/web/src/modules/automation/` | render + permission gating | nav seed |
| **A-12** | Web: executions monitor, credentials, variables, templates, logs, settings | as above | as above | none |
| **A-13** | Deployment: `railway.n8n.json`, compose, runbook, env docs | root, `docs/08-operations/` | smoke | infra |
| **A-14** | Module publishers: `hr.employee.*`, `hr.leave.approved`, `hr.contract.*`, `platform.auth.passwordReset` | HR + platform services | event emission in txn | none |

Sequencing: A-1→A-2 unblock everything. A-3..A-8 are the engine and can be reviewed in order.
A-11/A-12 can start once A-3 lands (against the real API). A-14 is independent and can go any time.

**Each PR carries:** goal, files changed, tests, docs delta, migration steps — the format already
used by this repository.

---

## 14. Blockers for the approver — must be resolved before A-1

1. **n8n licensing.** Sustainable Use License, not OSI open source. Internal use inside ECMS is
   permitted; re-offering the builder to third parties is not. **If ECMS is or becomes a
   multi-customer product where customers author their own automations, this needs legal sign-off
   or an n8n Embed licence.** The fallback is a native action runner (ADR-018 §Alternatives), which
   costs the visual builder and the connector library. This is a business decision and I should not
   make it.
2. **AI data egress.** Sending employee records, national IDs and contract terms to OpenAI /
   Anthropic / Google is a data-protection decision under Egyptian PDPL. §6 designs the controls;
   someone still has to accept the residual risk, per provider.
3. **Scope reality.** Eight of the eighteen requested events belong to modules that do not exist
   (Fleet, Treasury, Accounting, Purchasing, Administration). Confirm the intent is "build the
   engine now, modules subscribe as they land" rather than "these modules exist" — the template
   catalogue is sized for the former.
4. **Two runtimes.** n8n + its Postgres is a second system to operate, patch and back up. Confirm
   the operational appetite.

## 15. Non-goals (this phase)

Multi-organization automation (ADR-015: single organization) · customer-facing workflow authoring ·
replacing the Workflow Engine · n8n's own user management (ECMS is the only identity) · arbitrary
code nodes in workflows (`N8N_BLOCK_ENV_ACCESS_IN_NODE`, Function nodes disabled — code execution
from stored graphs is the hazard ADR-011 already rejected).

## Review trail

| Date | Revision | Change |
|---|---|---|
| 2026-07-29 | Draft | Initial design + ADR-018. Awaiting approval; §14 blockers open. |
