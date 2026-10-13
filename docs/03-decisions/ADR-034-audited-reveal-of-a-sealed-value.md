# ADR-034: A sealed value is revealed by an audited POST, never by a read

**Status:** Accepted · **Date:** 2026-10-13 · **Relates to:**
[Platform crypto](../02-architecture/platform-crypto.md) (the secret store and its key ring),
[ADR-012](ADR-012-logging-audit.md) (the audit stream),
[ADR-029](ADR-029-realtime-invalidation-over-the-audit-chokepoint.md) (signals carry no data),
[the Efficiency register spec](../12-planning/atm-efficiency-register.md) (D3, DEC-18, DEC-29, DEC-33)

## Context

The platform secret store seals a value under a context (`<collection>:<id>:<field>`) and opens it
only where code asks. Until now nothing a user does ever asked: the automation credentials are
written and used by the server, and their route file says so in so many words — *"there is no
`GET /:id/value`, no `?reveal=true`, and no permission that would unlock one. Adding a read path
here would need an ADR, not a route"* (`modules/automation/credentials/credential.routes.ts:24-28`).

The ATM register needs a person to read one sealed value. The safe-door combination of a machine
(column AO of the owner's workbook) is a secret the Efficiency team holds and occasionally has to
read out — to a technician at the machine, to a bank. The owner decided (D3) that it is sealed at
rest, that no response ever carries it in the clear, and that its plaintext comes back only through
an audited reveal under its own key.

The nearest precedents each miss something:

- The fuel-card password is revealed by `GET /fleet/fuel-cards/:id/password` under
  `fleetFuelCard.reveal` (`modules/fleet/fuel-cards/fuel-card.routes.ts:105-112`) — a plain read,
  unaudited, and a `GET` a browser, a proxy or a prefetcher may repeat or keep.
- The medical profile is an audited READ (`medicalRecordRead`, written even when nothing is
  recorded — `modules/hr/medical/profiles/medical-profile.service.ts:73-80`), but what it returns is
  an ordinary document, not a sealed value.

## Decision

**A sealed value a person may see is revealed through `POST …/:id/reveal`, under a dedicated
permission, and every call is audited — whether or not a value is stored.** For the register it is
`POST /api/v1/atm/register/entries/:id/reveal` under `atmRegister.viewSecrets`:

1. **POST, not GET.** The call has a side effect — the audit row — so it is not a read in HTTP's
   sense; a `POST` is never prefetched, retried by an intermediary, or served from a cache.
2. **The key must reach the record**, not merely be held. The entry is found through the caller's
   `viewSecrets` read scope, and the reveal additionally requires the same predicate that decides
   whether the entry's DTO shows its other secret fields (`secretsVisibleFor` — organization-wide,
   or the key reaches the entry's whole branch). A department-, section- or own-scoped grant never
   reveals (DEC-29). One predicate, three uses: the DTO, the write gate, the reveal.
3. **The check comes before the store is touched.** Nothing is opened for a caller who will be
   refused.
4. **Always audited**, with the verb `secretRevealed` and the actor: the change is
   `{ field, old: null, new: '[revealed]' }`, or `'[none]'` when nothing is stored — the
   `medicalRecordRead` rule that asking is the fact worth recording. The audit row never carries
   the value. The verb does not broadcast (ADR-029): a reveal changes nothing anybody's screen shows.
5. **Nothing caches it.** Every response under the register's `/entries` sets
   `Cache-Control: private, no-store`. The web client shows the value for 30 seconds, keeps the
   reveal mutation at `gcTime: 0` and calls `reset()` when the value is cleared, and the register's
   queries for a `viewSecrets` holder use `gcTime: 0` (the medical precedent).
6. **Everywhere else the value is a flag.** Entry DTOs carry `safeCombinationSet: boolean` and no
   `safeCombination` property at all; audit diffs of a write show `[redacted]`; the CSV export has
   no secret column for anybody; the logger redacts the field names and Sentry drops register
   request bodies (DEC-34).
7. **The seal outlives key rotation.** A nightly task re-wraps every stored value not on the current
   data key (`atm.rotateRegisterCombinationKeys`, DEC-33), so dropping a retired key after the
   documented rotation never strands a reveal.

The automation credentials keep their rule: they have no reveal, and this ADR does not give them
one. Any other sealed value a person must read follows this decision rather than inventing a route.

## Alternatives considered

- **`GET …/combination`, like the fuel card.** Rejected: unaudited by construction, and a `GET` is
  exactly what caches, history and prefetchers keep. Auditing a `GET` would make a safe method
  carry a side effect.
- **Return the plaintext in the entry DTO for `viewSecrets` holders.** Rejected: every list page
  would then carry a page of combinations to every holder, into the query cache and every log or
  error report that serializes a response — and no single act of reading would be recorded.
- **Audit only a successful reveal of a stored value.** Rejected: "who asked, and when" is the
  question the audit answers; an empty answer is still an answer somebody asked for.

## Consequences

- One audit row per reveal. A team that reads combinations all day produces a long trail; that is
  the point, and the audit screen already filters by action.
- A reveal needs the secret store to be available; when it is not, the call fails rather than
  returning anything else.
- The pattern costs a second round-trip compared with a field in the DTO. The screen asks only when
  a person presses Reveal, so the cost is paid exactly when it is meant to be visible.
