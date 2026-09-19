# ADR-032: Outbound HTTP leaves through one guarded door

**Status:** Accepted · **Date:** 2026-09-19 · **Relates to:**
[Security Architecture §4](../06-security/security-architecture.md) (the SSRF row),
[ADR-018](ADR-018-automation-engine.md) (the n8n provider, one of the callers),
[ADR-014](ADR-014-ocr-independent-service.md) (the OCR sidecar, another)

## Context

The security document has said, since its first version, that outbound HTTP goes *"only via the
Integrations service with host allowlists"*. No such service was ever built. What the api actually
had was five bare `fetch` calls — the n8n client, the OCR sidecar, the Microsoft Graph mailbox
reader, and the two WhatsApp transports — each with its own timeout and retry, none with any
opinion about *where* it was sending. A sixth outbound path, the Web Push channel, sends to
whatever endpoint a browser registered.

Server-side request forgery is exactly a request the application makes on somebody else's behalf.
The attacker needs one of two things: a destination of their choosing, or a legitimate destination
that quietly turns out to point somewhere private — the cloud metadata endpoint at
`169.254.169.254`, a Redis on the same network, the api's own health route. Two of the six paths
take their base URL from the environment, so an attacker would need the operator's `.env`; one,
push, takes its destination from an unauthenticated browser API call by any signed-in user. A
`302` from any of them would have been followed by `fetch` without a second look.

## Decision

**Every outbound request the api makes goes through `infrastructure/http/outbound.ts`, and a
source-reading guard spec fails CI on a bare `fetch` anywhere else.** There is no integrations
*service* — a class that owned five unrelated protocols would be a module with no cohesion — but
there is one door, and the allowlist lives on it.

The door judges each destination in this order:

1. **Scheme** — `http:` or `https:`, and no credentials in the URL.
2. **Pinned hosts** — the hosts of the base URLs the operator configured (`N8N_BASE_URL`,
   `NATIONAL_ID_OCR_URL`) are trusted **at whatever address they resolve to**. On a compose network
   `http://n8n:5678` *is* a private address; the operator typing it is the authorization. The
   pinned set is derived from the environment, never from data.
3. **Allowlist** — anything else must match a listed host: the SaaS endpoints the code itself names
   (Microsoft Graph, Meta, Twilio — one row each, in the source, next to the caller that needs
   it), plus `OUTBOUND_HTTP_ALLOWLIST` for a deployment's extras (`*.suffix` allowed).
4. **Address** — an allowlisted host must resolve only to globally routable addresses. Private,
   loopback, link-local, carrier-grade NAT, multicast, reserved, and the documentation ranges are
   refused, in IPv4 and IPv6 including the mapped and NAT64 forms, and so is an address the
   classifier cannot parse. `OUTBOUND_HTTP_ALLOW_PRIVATE` relaxes this for an integration on the
   deployment's own network that is not one of the configured base URLs.
5. **Redirects are followed by hand.** `fetch` runs with `redirect: 'manual'`; each `Location` is
   resolved against the request that produced it and judged from step 1 as if it were the first
   request. A `303` (and a `301`/`302` answering a `POST`) becomes a `GET` without a body, as a
   browser does; `307`/`308` keep method and body. Five hops at most.

A refusal is an `OutboundBlockedError`, logged with the origin and path — never the query string,
which is exactly where a signed URL or an API key would be — and each caller decides what a
refusal means for it: the n8n client does not retry one, the OCR provider degrades to manual
entry, the WhatsApp transport reports the message undelivered.

**Web Push endpoints are judged at registration.** The browser's endpoint must be `https:` to a
public address (`publicHttpsRefusal`); there is no allowlist because every browser vendor runs its
own push service. The check runs once, when the subscription is stored, not on every notification.

## Consequences

- A deployment that configured nothing sees no change: the pinned hosts are its own base URLs and
  the named SaaS hosts are the ones the code already called.
- Adding an integration is a reviewable line in the allowlist table, next to the caller — not a
  `fetch` somewhere the policy never sees. The guard spec is what makes the "one door" hold.
- The address check resolves the host before the request and `fetch` resolves it again; a DNS
  answer that changes between the two (rebinding) is not caught. For pinned and SaaS hosts the DNS
  is the operator's or the vendor's; for `OUTBOUND_HTTP_ALLOWLIST` entries it is a residual risk
  the operator accepts by listing the host. Closing it needs a custom dispatcher that pins the
  resolved address, which Node's global `fetch` does not expose without a dependency.
- Web Push sends through the `web-push` library's own HTTPS client, not through the door. TLS to
  a raw private address fails on the certificate, and the endpoint was public when registered;
  that is the control, and it is weaker than the door's — recorded here rather than papered over.

## Alternatives considered

- **An Integrations service class owning all outbound protocols.** Rejected: the five callers
  share nothing but the fact of leaving the process, and a class that wrapped n8n's REST, Graph's
  OAuth, a JSON sidecar and two chat APIs would be a module with no cohesion and every change's
  bottleneck. The allowlist is the shared thing, so the allowlist is what is shared.
- **Block private addresses for pinned hosts too.** Rejected: it breaks every compose deployment,
  where the sidecars are private by construction, and the operator who typed the URL has already
  made the decision the check would be second-guessing.
- **Follow redirects with `fetch`'s default and trust the first hop's judgement.** Rejected: a
  listed host answering `302 Location: http://169.254.169.254/` is the canonical SSRF, and the
  first hop's judgement is exactly what it exploits.
- **A vendor allowlist for push endpoints.** Rejected as brittle: the set of push services is
  every browser vendor's and changes without notice; a wrong list silently breaks notifications for
  one browser. HTTPS-to-public is the protocol's own rule and catches the attack.
