# Automation workflow library

Workflow definitions for the ECMS Automation Engine (ADR-018). Design and rationale:
[`docs/12-planning/automation-workflow-library-design.md`](../docs/12-planning/automation-workflow-library-design.md).

```
automation/
├── templates/     ECMS template packages — the workflows themselves. Data, not code.
└── n8n/           Operator-installed n8n workflows that are NOT ECMS workflows.
```

## `templates/` — the three workflows

Each file is an `AutomationTemplatePackage` (the A-9 format), validated in CI against the real
contract schema. It carries a provider-native graph that A-6a pushes into n8n when an ECMS
workflow using it is enabled.

| Package | Triggers on | Does |
|---|---|---|
| `account-activation-followup` | `platform.user.created` | reminds at 48 h, asks **ECMS** to re-issue the setup link, escalates at +72 h |
| `account-credentials-reissued` | `platform.auth.passwordReset` ¹ | alerts on failed delivery immediately, reminds at 6 h, escalates at +24 h |
| `hr-onboarding-job-offer` | `hr.jobOffer.sent` · `.accepted` · `.rejected` · `.expired` | delivers the offer + one reminder; on accept sends the required-documents list and the reporting date |

¹ **This event does not exist yet** — see the design doc §1.2. It is earmarked for A-14.

### The graph does not contain its own trigger

A-6a's `webhookNode()` prepends the webhook trigger on push, on a per-workflow UUID path. Package
graphs therefore connect **from a node named exactly `ECMS Trigger`**, and the CI check fails a
package whose graph is unreachable from it.

### What every workflow receives

```json
{
  "eventId": "…", "eventType": "hr.jobOffer.accepted", "occurredAt": "2026-01-02T03:04:05.000Z",
  "correlationId": "req_…", "version": 1, "payload": { "…": "redacted business data" },
  "executionId": "…", "actor": { "userId": "…", "branchId": "…" }, "depth": 0
}
```

with `x-request-id`, `idempotency-key` and — when `N8N_WEBHOOK_SECRET` is set on ECMS —
`x-ecms-signature: sha256=<hex>`, which is `HMAC(HMAC(secret, webhookPath), body)`.

### Secrets never enter n8n

Activation links and temporary credentials stay inside ECMS (design §1.1). Where a workflow needs
a credential message re-sent it calls `POST /platform/users/:id/credentials/resend` and **ECMS**
composes and delivers it. n8n persists execution data; nothing that must not be persisted is ever
sent to it.

## `n8n/` — operator-installed

`ecms-error-handler.json` is a plain n8n workflow with no ECMS trigger. Import it once and set it
as the **Error Workflow** (Workflow settings → Error Workflow) on every ECMS-owned workflow. It
normalises the failure, reports it to the ECMS execution row, and falls back to email when ECMS
itself is what is unreachable.

## Working with packages

```bash
npm run check:automation-templates            # validate all (also runs in CI)
npm run automation:preview hr-onboarding-job-offer > /tmp/preview.json
```

`automation:preview` emits a standalone n8n-importable workflow — the package's graph with a
throwaway webhook trigger prepended — so a package can be opened and stepped through in the n8n UI
before A-6a/A-9 are deployed. The throwaway path receives no real ECMS dispatches.

## One-time n8n setup

| What | Value |
|---|---|
| Env `NODE_FUNCTION_ALLOW_BUILTIN` | `crypto` — the signature check cannot compute an HMAC without it |
| Env `ECMS_WEBHOOK_SECRET` | the same value as ECMS's `N8N_WEBHOOK_SECRET` |
| Credential `ECMS Service Token` | Header Auth, `Authorization: Bearer <token>` (A-6b) |
| Credential `ECMS Ops SMTP` | SMTP, for the error handler's fallback |

Then, per imported workflow: set the **Error Workflow**, and open the **ECMS Config** node — every
tunable value (API base URL, SLA hours, template keys, escalation role) lives there and nowhere
else.

## Adding a fourth workflow

Copy the nearest package and change three things: the `key`, the events in `requires.events` (and
the Switch, if it routes), and the business nodes. `ECMS Config` → `Verify + Dedupe` →
`… → Log step` is unchanged, which is the point of standardising it.
