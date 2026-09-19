# ADR-033: Email is asked for at the moment of sending, never assumed

**Status:** Accepted · **Date:** 2026-09-19 · **Relates to:**
[Notifications Service](../02-architecture/notifications-service.md),
[Account Lifecycle](../02-architecture/account-lifecycle.md) (setup-link delivery),
[ADR-012](ADR-012-logging-audit.md) (the delivery outcomes are audited either way)

## Context

The platform emailed on its own. Twenty-three HR templates, the security alert, the role-change
notice and every announcement listed `email` among their channels, and `notify()` queued an email
for each recipient who had not opted out. Provisioning an employee's login emailed the setup link
to whatever address was on file, as did an administrator's reset or resend — with no way to say
"not by email this time".

The owner's instruction was exact: *"I want email to exist, but optional — when I am about to
send something it should ask me whether I also want it by email. Otherwise, don't send email on
your own."* That is a rule about **who decides**, not about which templates or which categories:
a person sending something decides, at that moment, and the system decides nothing.

## Decision

**The platform never emails on its own initiative. An email leaves only because a person ticked
"also by email" on the screen they sent from.**

- `notify()` takes `byEmail?: boolean`. A template that lists `email` makes the channel
  *available*; the `email` row is put on a notification only when the send says `byEmail: true`.
  Everything else in the pipeline is unchanged and still applies on top — the recipient's
  per-category opt-out, the organization kill switch (`notifications.email.enabled`), quiet hours,
  the queue, the audit trail. Asking is necessary, not sufficient.
- Nothing automatic sets it. A leave decision, a contract expiring, a security alert, a rule that
  fired: inbox, and push where a device is registered. The notification rules module has no
  channel choice and gets none — a rule fires on the system's initiative by definition.
- The two places a person sends carry the tick: the announcement composer (`channels` on the
  request, `['inApp','email']` when ticked) and the setup-link deliveries — reset, resend, and
  the gold portal's resend — as `byEmail` in the request body. Off by default, off again every
  time the dialog opens.
- Provisioning a login (a registration, the boot sweep) asks for no email. Its outcomes carry a
  WhatsApp row when that transport is configured and no email row at all; HR emails the link, if
  they want to, from the account panel's resend with the box ticked.
- WhatsApp is not covered by this rule. It is a transport an operator turns on once, disabled by
  default, and the owner's instruction named email alone.
- Templates keep `email` in their channel lists so the choice exists; the templates screen says
  so beside the checkbox, because a channel list that reads as "sends by email" would promise
  what the platform deliberately does not do.

## Consequences

- No automatic email of any kind, including the security alerts raised for break-glass use and
  refresh-token reuse. Those reach the audit-log administrators in the app and by push. This is
  the owner's rule applied without an exception nobody asked for; an exception, if ever wanted,
  is a `byEmail: true` on one consumer and a line in this ADR.
- A notification's `channels` array now says what was *asked for*, not what the template allows.
  Reports that counted email rows will count fewer.
- The delivery outcomes on an account (`lastDelivery`) show only channels that were attempted. An
  absent email row means "not asked for", a failed one means "asked for and could not be sent" —
  two different facts, kept apart on purpose.
- An older client that sends no body still works: `byEmail` defaults to `false`, which is the rule.

## Alternatives considered

- **A per-template switch ("this template may email").** Rejected: it moves the decision to
  whoever edits templates, once, in advance. The instruction was for the person sending, each
  time.
- **A global setting defaulting to off.** Rejected for the same reason — and because a setting
  that is on somewhere would make an automatic email possible again, which is the thing being
  ruled out.
- **Removing `email` from every template.** Rejected: it would take the choice away along with the
  default. The channel must stay available for the tick to mean anything.
- **Applying the rule to WhatsApp too.** Not asked for, and a different kind of channel: opt-in
  by the operator, not by the sender.
