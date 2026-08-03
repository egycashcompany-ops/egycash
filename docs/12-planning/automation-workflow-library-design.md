# Automation Workflow Library — the first three workflows

**Status:** design, awaiting approval · **Slice:** A-9a (first template packages) ·
**Depends on:** A-6a (authoring — ✅ merged, PR #113), A-6b (service tokens + action surface — not
built), A-9 (installer — not built)

Three requested workflows, designed against what ECMS **actually** emits and exposes today, not
against assumptions. The requirement that shaped every decision below is the one the requester
stated first: **n8n automates, ECMS remains the source of truth.** Wherever those two pull in
different directions, this document chooses ECMS and says why.

---

## 0. What this slice delivers

| Artifact | What it is |
|---|---|
| `automation/templates/*.json` | Three **template packages** (`AutomationTemplatePackage`, the A-9 format). Each carries an n8n `WorkflowGraph` that A-6a pushes into n8n when the workflow is enabled. |
| `automation/n8n/ecms-error-handler.json` | A plain n8n workflow the operator imports **once** and sets as every workflow's `errorWorkflow`. It is not an ECMS workflow — it has no ECMS trigger. |
| `npm run automation:preview` | Renders a package's graph into a standalone n8n-importable workflow, so a package can be opened and stepped through in the n8n UI before A-6a/A-9 exist. |

The packages are **data**, not code. They install a graph; they add no attack surface to ECMS
beyond what A-6b's endpoints already define.

---

## 1. Three findings that changed the design

These are recorded first because two of the three requested workflows cannot be built as
described, and the reason is not an implementation gap — it is a security property ECMS
deliberately has.

### 1.1 ECMS does not have temporary passwords to send

The request asks n8n to deliver "username + temporary password + login link". ECMS stopped
issuing temporary passwords at **AL-R4**. `platform/users/credentials-delivery.ts` composes
**username + Employee Code + a one-time activation link + expiry** and sends it over WhatsApp and
email, and it deliberately bypasses the persisted notification pipeline:

> It must NOT go through the persisted notifications pipeline — `notify()` stores rendered bodies,
> which would persist the one-time link (forbidden by R11/R12). Messages exist only in transit.

**n8n persists execution data by default.** Routing the activation link through n8n would write
the one-time credential into n8n's Postgres — precisely the thing ECMS refuses to do to its own
database. So:

> **Decision W-1.** The secret never leaves ECMS. n8n never receives, renders, or forwards an
> activation token. Where a message must be re-sent, n8n calls
> `POST /platform/users/:id/credentials/resend` and **ECMS** composes and sends it.

This is not a reduction in scope. ECMS already sends the credentials message; what it does **not**
do — and what the three workflows are actually worth building for — is **follow-up, escalation and
SLA**: nobody today notices that an invitation was sent 9 days ago and never opened.

### 1.2 An admin password reset emits no event

`POST /platform/users/:id/reset-password` issues a fresh setup link (`mode: 'reset'`), revokes
sessions, re-arms the change gate, and audits the per-channel delivery outcome. It publishes
**nothing** to the event bus — `auth.service.ts` emits `AuthLoggedIn`, `AuthLoginFailed`,
`AuthSessionRevoked` and `AuthRefreshReuseDetected`, and no reset event exists in
`PlatformEvents`.

> **Decision W-2.** Workflow 2 has no trigger today. It subscribes to
> **`platform.auth.passwordReset`** — the event the module-design slice table already earmarks for
> **A-14** — and this slice pins its payload: `{ userId, mode, delivery[] }`. `delivery[]` is the
> per-channel outcome `deliverCredentials()` already returns, carried on the event so the workflow
> can alert on a failed send without a second API call. Publishing it is one constant, one payload
> schema and one `emit()` in the reset path.

### 1.3 Nothing should "wait" for an offer decision

The request describes Workflow 3 as: send the offer, **await accept/reject**, then continue. A
long-running n8n execution parked on a Wait node would become a second, weaker copy of state ECMS
already owns authoritatively — and the answer to "did this candidate accept?" would then live in
two places, which is the exact inversion the requester asked to avoid.

ECMS already publishes `hr.jobOffer.sent`, `.accepted`, `.rejected`, `.expired` and `.withdrawn`.

> **Decision W-3.** The workflow does not wait. It is **event-driven and re-entrant**: one graph,
> a Switch on `eventType`, and each decision arrives as its own trigger. The candidate's answer is
> recorded in ECMS by ECMS; n8n reacts to it. This also makes the workflow restartable, because
> every branch is a pure function of one event.

---

## 2. The shared skeleton

Every ECMS-owned workflow is the same five things, and only the shaded part differs:

```
[ECMS Trigger (webhook)] → [ECMS Config] → [Verify + Dedupe] → ░ business ░ → [Report to ECMS]
                                                    ↓ on error
                                          [ECMS — Error Handler]
```

- **ECMS Trigger** — not in the package. A-6a's `webhookNode()` prepends it on push, on a UUID
  path minted per workflow. Package graphs connect **from the node named `ECMS Trigger`**.
- **ECMS Config** — a Set node holding the non-secret knobs (`ecmsApiBase`, SLA hours,
  `requireSignature`). Everything an operator tunes is here, in one place, editable in the UI.
- **Verify + Dedupe** — one Code node doing three fail-closed checks:
  1. **Authenticity.** `HMAC(HMAC(N8N_WEBHOOK_SECRET, webhookPath), body)` compared in constant
     time against `x-ecms-signature`. A workflow reachable at a public URL that trusts its caller
     is not integrated, it is exposed.
  2. **Envelope shape.** Refuses anything missing `eventId`/`eventType`/`occurredAt`/`version`/
     `executionId` — a mis-pointed webhook fails loudly rather than half-running.
  3. **Idempotency.** One run per `eventId`, in capped workflow static data. ECMS already dedupes
     on `(eventId, workflowId)` and sends a stable `Idempotency-Key`; this is the third layer, and
     it is the one that survives a redelivery *after* a successful dispatch.
- **Report to ECMS** — every meaningful step is written back through A-6b's action surface, so the
  ECMS execution row is the record. n8n's own execution list is a debugging convenience, never the
  audit trail.
- **Error handler** — set as `errorWorkflow` in workflow settings. One instance, shared by all.

**Retries.** Every HTTP Request node carries `retryOnFail: true, maxTries: 3,
waitBetweenTries: 5000`. This sits under ECMS's own two layers (n8n client transport retry, then
BullMQ job retry), and covers the leg those cannot: a call n8n makes *outward*, mid-run.

### 2.1 Adding a fourth workflow

Copy `automation/templates/` skeleton, change three things: the `key`, the trigger event(s) in the
Switch, and the business nodes. The verify/dedupe/report/error triad is unchanged and needs no
thought — which is the entire point of standardising it here rather than in each package.

---

## 3. Workflow 1 — Account activation follow-up

**Key** `account-activation-followup` · **Trigger** `platform.user.created`
· payload `{ userId, email, status }`

ECMS has already sent the activation link by the time this event lands. The workflow owns the
*schedule*, which ECMS does not:

| Step | Node | Behaviour |
|---|---|---|
| 1 | Wait `firstReminderHours` (default 48) | |
| 2 | `GET /platform/users/:id` | reads the **derived** `accountStatus` (`invitationSent` / `activated` / `expired` / `locked`) |
| 3 | IF `activated` | record `activated`, end — the happy path costs one API call |
| 4 | else `POST /platform/users/:id/credentials/resend` | **ECMS** re-issues and re-sends. n8n sees no token. |
| 5 | Wait `escalationHours` (default 72) → re-check | |
| 6 | still not activated → `POST /automation/actions/notify` | escalates to the HR/IT recipients named in config |
| 7 | every branch → `POST /automation/actions/log` | the ECMS execution row is the record |

A user who never opens their invitation is today invisible. After this, they are a reminder, then
a ticket.

## 4. Workflow 2 — Credentials reissued follow-up

**Key** `account-credentials-reissued` · **Trigger** `platform.auth.passwordReset`
**(does not exist yet — §1.2)** · payload `{ userId, mode, delivery[] }`

Structurally Workflow 1 with a tighter SLA, because a reset means someone is locked out **now**:

1. **Delivery check first.** If any channel in `delivery[]` reports `ok: false`, alert HR/IT
   immediately — a reset that silently failed to reach the employee is the worst case, and it is
   knowable at t=0 without waiting.
2. Wait `firstReminderHours` (default 6) → `GET /platform/users/:id` → not activated → resend via
   ECMS.
3. Wait `escalationHours` (default 24) → still not activated → escalate.

Both workflows call the **same sub-flow shape**. They are separate packages rather than one
because their SLAs, recipients and first-step logic genuinely differ, and a single package with a
mode flag would be harder to read than two that each fit on a screen.

## 5. Workflow 3 — Onboarding from job offer

**Key** `hr-onboarding-job-offer` · **Triggers** `hr.jobOffer.sent`, `.accepted`,
`.rejected`, `.expired` · payload `{ offerId, applicantId, applicantCode, status }`

One graph, a Switch on `eventType`, four branches. No waiting for a decision (§1.3).

**`hr.jobOffer.sent`**
`GET /hr/job-offers/:offerId` and `GET /hr/applicants/:applicantId` →
`POST /automation/actions/notify` with template `hr.jobOfferSent` (already seeded by the HR
module) → Wait `offerReminderHours` (default 48) → re-read the offer → **if still `sent`**, one
reminder. The re-read is what makes the reminder safe: a candidate who accepted an hour ago is
never nagged.

**`hr.jobOffer.accepted`** — the branch the request is really about:
`GET /hr/job-offers/:offerId` (for `startDate`, which **is** the attendance date — it is a
required field on the offer) → `GET /hr/hiring-document-types` (the required-documents catalogue,
already an HR admin surface) → a Code node renders the list → `POST /automation/actions/notify`
sends the candidate the document list and the reporting date → `POST /automation/actions/log`.

**`hr.jobOffer.rejected` / `.expired`** — notify the offer's HR owner, log, end.

**Extensibility.** New onboarding steps (medical exam booking, asset request, IT account request,
induction scheduling) are new branches or new nodes appended to the `accepted` branch — none of
them touch the trigger, the guard, or the other branches. Adding a *stage* means adding an event
to the Switch, which is a one-node change.

---

## 6. What must exist before any of this runs

Honest dependency list, worst first:

| # | Blocker | Owner | Without it |
|---|---|---|---|
| 1 | **A-6b action surface** — `POST /automation/actions/notify`, `POST /automation/actions/log`, and service tokens scoped to the workflow owner | A-6b | n8n cannot send through ECMS or write results back. Every node marked `[A-6b]` in the graphs fails. |
| 2 | **A-6a deployed** — merged in PR #113, so `AUTOMATION_ENABLED=true` + `AUTOMATION_PROVIDER=n8n` must reach the running api **and** worker | operator | `providerRef` stays null, every dispatch records `skipped`, n8n is never called at all |
| 3 | **A-9 installer** — install a package → workflow gets its graph | A-9 | packages can only be previewed/imported by hand |
| 4 | `platform.auth.passwordReset` published, carrying `delivery[]` | A-14 | Workflow 2 has no trigger (§1.2) |
| 5 | `webhookNode()` should set `rawBody: true` | one line in `n8n.graph.ts` | signature verification must re-serialise the parsed body, which is exact for ECMS's envelope but not guaranteed for arbitrary nested payloads |
| 6 | n8n env: `NODE_FUNCTION_ALLOW_BUILTIN=crypto` | operator | the Verify node cannot compute an HMAC |
| 7 | n8n credential `ECMS Service Token` (Header Auth) + `ECMS Ops SMTP` | operator | HTTP nodes unauthenticated; error handler cannot mail |

Items 5–7 are cheap. Item 1 is the real gate, and these three packages are the argument for what
A-6b's surface must contain — they turn "some callback surface" into a specified contract.

---

## 7. Review trail

| Date | Revision |
|---|---|
| 2026-08-01 | 1.0 — first three workflows designed against the real event catalogue, real payload fields, and the real credentials-delivery security model. Three requested behaviours changed rather than implemented as stated: temporary passwords do not exist (§1.1), password reset emits no event (§1.2), and offer decisions are not waited on (§1.3). |
