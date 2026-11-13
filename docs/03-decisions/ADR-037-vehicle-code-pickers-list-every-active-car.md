# ADR-037: A vehicle-code picker lists every active car

**Status:** Accepted · **Date:** 2026-11-08 · **Supersedes:**
[ADR-019](ADR-019-reference-pickers-search-not-load-all.md) rules 4 and 5, for vehicle-code pickers
only · **Relates to:** [IT vehicle device checks](../12-planning/it-vehicle-checks-design.md) §6.1,
[IT design](../12-planning/it-module-design.md) §1 and FR-12

## Context

ADR-019 rule 5 forbids a new picker from loading a whole catalog and filtering it in the browser.
Rule 4 names vehicles among the catalogs that can grow, so they are not exempt as a bounded set.

The owner has ruled the other way for car codes. Fleet's car picker first asked for one page, and
the owner found codes missing from the list: «اكواد السيارات … لازم لازم تظهر كلها». Since then,
`VehicleCodeCombobox` loads the whole registry page by page (`fetchWholeCatalog`), ranks the codes
in the browser (`rankVehicleCodes`), and `vehicle-code-selectors.spec.ts` keeps every Fleet screen
on that one picker. No ADR recorded that exception. Now the IT vehicle device check (FR-21) needs
the same picker outside Fleet.

## Decision

1. **A picker of vehicle codes offers every car it may offer.** Opening it lists all of them, and
   typing narrows the list in the browser, codes that start with the typed text first, with
   Arabic-Indic digits read as Western digits. This is the owner's rule; it is the business fact
   that bounds the set.
2. **The set is still paged on the wire.** The endpoint answers pages of at most `MAX_PAGE_SIZE`,
   and the client walks them with `fetchWholeCatalog`. No endpoint returns an unbounded answer.
3. **A picker's rows are small.** A picker that lists cars outside Fleet asks for `{ id, code }`
   only, not the vehicle record.
4. **Everything else in ADR-019 stands**: every other reference picker searches the server, and
   resolving a selected id stays a by-id read.

## Consequences

- IT's car list (`GET /it/vehicle-checks/vehicles`) loads in full, like Fleet's. About two hundred
  active cars at `{ id, code }` come to a few kilobytes.
- If the fleet grows past what a phone loads comfortably, this ADR is revisited, not quietly
  broken: the answer then is a server search that still shows every match.
- IT design §1 («every reference picker is server-side search») and FR-12 name this exception.
