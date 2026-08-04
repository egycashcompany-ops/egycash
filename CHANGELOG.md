# Changelog

All notable changes to the ECMS Platform are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions
follow the platform-manifest semver described in
[Development Workflow §6](docs/09-guides/development-workflow.md). Each sprint-closing PR adds
its entry here in the same PR.

## [Unreleased]

### Added

- **The applicant form checks its fields as you leave them, and knows Egyptian geography.** A
  mistake used to be discovered by the server after a failed save and reported as a list at the
  bottom of the page; now the field that is wrong says so, in the reader's language, the moment
  focus leaves it — a red outline plus the reason underneath — and saving jumps to the first bad
  field instead of scrolling you back to hunt for it. The rules are real ones: the Arabic name
  takes Arabic letters only (the Arabic-Indic digits ٠-٩ are rejected too, which the obvious
  `\u0600-\u06FF` range would have let through), the Latin name takes Latin letters only, a
  National ID is decoded rather than counted, a mobile must be 11 digits on 010/011/012/015, an
  email needs a dotted domain, and a postal code is five digits. Governorate and city are now
  chosen, not typed: all 27 governorates with their cities, keyed to the National-ID governorate
  code so a decoded number, an OCR read and a hand-picked value resolve to one record; picking the
  governorate scopes the city list, and changing it clears a city that no longer belongs. The
  search behind those pickers folds hamza forms, ta marbuta and diacritics, so "الاسماعيليه"
  finds "الإسماعيلية". Every predicate lives in `@ecms/contracts` and is what the API validates
  with, so the form cannot accept something the server will reject. Numbers are cleaned before
  they are judged and stored in the cleaned form: separators and international prefixes come off a
  phone, and Arabic-Indic digits (٠-٩) fold to ASCII for phones, National IDs and postal codes —
  an Arabic keyboard produces ٠١٠ for what its user reads as 010, which used to be rejected
  outright. Create and edit run the identical rules; a record whose governorate or city predates
  the catalog keeps them rather than being blanked by the act of being opened.

- **Two navigation shells, and the choice belongs to the user.** The launchpad is no longer the
  only shape: the RAIL — a slim strip of module icons beside the module's page panel, the shell
  ECMS carried before the launcher — is back as an alternative, and a switch in the header moves
  between them. The choice rides on the account (`MeDto.navLayout`, `PATCH
  /api/v1/auth/me/preferences`), so it follows the user to any device rather than living in one
  browser; accounts that predate it answer `launchpad` without a migration. It is
  presentation-only by construction: the endpoint's subject is always the caller, so it carries
  no permission, no scope and no audit entry — which navigation shape someone prefers is not an
  act on the business record. Both shells read the same catalog, derive the current module from
  the URL, remember the page you last had open in each module, and share their page rows
  (`nav-rows`), so a row behaves identically wherever it is rendered and the ⌘K palette and
  pinned favourites are untouched in either.

- **`npm run seed:demo` — sixty synthetic candidates, ten resting at each recruitment stage.** The
  boards, queues and counters had nothing to show on a fresh database. The demo cohorts sit at the
  ID gate, in screening, at the first interview, at the open evaluations, holding a sent offer, and
  accepted awaiting the hire. They are driven through the REAL services — a candidate at the
  interview stage got there by having their screening accepted, which is what materializes the
  round — so the queues, the workflow state, the stage counters and the candidate timeline all
  agree, instead of looking right on one screen and wrong on every other. Re-running is a no-op:
  each registration carries a `demo:` intake key and the platform's own idempotent intake returns
  the existing candidate. `npm run seed:demo -- --reset` removes the demo candidates and what they
  produced, matched on that key alone so a real applicant can never be caught by it. Development
  and staging only — it refuses to run when `NODE_ENV=production`.

### Fixed

- **"Authentication required" after leaving a tab idle — the client raced its own silent
  refresh.** Returning to an idle tab fired several stale-token requests at once; each ran its
  own `POST /auth/refresh` with the same single-use cookie, so one rotation won and the rest
  were rejected (`AUTH_SESSION_REVOKED` — the server's rotation guard doing its job), nulling
  the in-memory token. Every later request then left **without** an Authorization header and
  surfaced the middleware's raw `Authentication required`, with no way back but a manual
  reload. Empirically traced end-to-end against the real auth stack before fixing. Three
  changes, web only: (1) **single-flight refresh** — concurrent 401s share one in-flight
  refresh promise, released the moment it settles (a regression spec proves ten concurrent
  requests produce exactly one refresh and all complete); (2) **organized sign-out** — a
  definitively failed refresh reports auth loss once (never once per waiter), signs Redux out,
  clears the query cache and lets `RequireAuth` redirect to `/login` instead of stranding the
  user on an error screen; (3) `UNAUTHENTICATED` and `AUTH_SESSION_REVOKED` join the bilingual
  friendly-message table as defence in depth. **Known limitation** (recorded in the auth
  design's review trail): two *separate tabs* refreshing in the same instant still race
  cross-tab — single-flight cannot span JS memories; the proposed server-side fix (a short
  post-rotation grace window answering the previous token with the current one) is documented,
  deliberately not implemented here.

- **Every api entrypoint crashed at startup — `npm run dev`, `seed` and `seed:demo` died before
  their first line of logic.** The automation barrel re-exported `runProviderConformance`, whose
  `vitest` import throws the moment it is loaded outside a vitest run, and the barrel sits in the
  runtime graph: server, worker and both seed CLIs load it through `moduleManifests` regardless of
  the `AUTOMATION_ENABLED` flag (the flag withholds the manifest, not the module file). Nothing
  consumed the re-export — both provider spec files already import `provider-conformance` directly
  — so it is simply removed, and the docs snippet that recommended the barrel import for future
  providers now shows the direct one. A new `runtime-import-safety.spec.ts` loads the shared
  entrypoint graph in a clean subprocess (Node + tsx, exactly how the package scripts load it), so
  any future test-only import reachable from the runtime graph fails the unit suite instead of
  taking the platform down. In effect since the A-5 automation merge (#112); surfaced on the first
  `npm run seed` after it.

- **Opening a candidate crashed once their history held an entry with no metadata.** The timeline
  schema declares `metadata` as required with a `{}` default, but Mongoose minimization deletes
  empty objects on the way to the database — so the two writers that pass none (`identityVerified`
  and `note`; every other type supplies its own, and the workflow projection stamps
  `{ eventId, eventName, …payload }` on all 25 projected types) stored no `metadata` field at all,
  while an interview entry carrying `{ attempt: n }` kept it. Reads are `.lean()`, which applies no
  schema default, so those entries came back as `metadata: undefined`, breaking the DTO's
  `Record<string, unknown>` guarantee: the renderer read `entry.metadata['attempt']` and every
  candidate without an interview attempt threw `TypeError` — which is why verifying an identity was
  what exposed it. The schema now sets `minimize: false` so the declared field is actually
  persisted, and the boot migration backfills `{}` onto rows already stored without it, matching
  only `{ metadata: { $exists: false } }` so a populated metadata is never reset. The renderer is
  unchanged — the contract it relied on now holds.

- **Job-position, job-title and fleet-vehicle pickers returned 400.** Six call sites asked for
  `pageSize: 200`, over the `MAX_PAGE_SIZE` of 100 that API Standards §4 fixes and that both the
  contract schema and the base repository enforce, so the reassign, bulk-reassign and
  recommendation dialogs and four Fleet pages had their dropdown queries rejected by validation.
  They now request `MAX_PAGE_SIZE`, matching every other picker in the app; the cap is a documented
  architectural decision, so the requests were what needed fixing. This is a hotfix, not the end
  state: a picker that renders one large page still truncates silently once a catalog passes 100
  records. [ADR-019](docs/03-decisions/ADR-019-reference-pickers-search-not-load-all.md) records the
  correct design — a picker searches the server the way `UserPicker` already does, using the
  `search` parameter these endpoints already support — and lists the surfaces still to convert.

### Changed

- **Applicant identity fields say what they mean.** Religion is a two-value list (مسلم / مسيحي)
  written in Arabic — the spelling the National-ID card carries and the OCR reads back, so a
  scanned card and a hand-picked value are the same string rather than two encodings of it; a
  legacy value the list does not carry stays selectable rather than silently becoming
  "unspecified" on the next save. Nationality is stored canonically (`Egyptian`) and rendered
  "مصري" to an Arabic reader, as are the governorates the National ID decodes to. The military
  section no longer asks for a certificate reference. Driving licences and certificates left the
  card they used to share, which read as though one were a kind of the other.

- **Modules are now chosen from a Launchpad — the app steps back and a launcher takes over.**
  The switcher's popover is replaced by a full-viewport launcher in the SAP Fiori / Azure /
  Atlassian family: opening it defocuses the app behind a 6px blur, then the launcher arrives
  70ms later (closing reverses the order), so switching reads as leaving one workspace for
  another rather than answering a dialog — depth comes from blur alone, since scaling the page
  read as the background zooming out from under the launcher instead of the launcher taking
  focus. The launcher is a screen, not a panel — title near the top, a centred grid of
  310×208 tiles through the middle, nothing with a dialog silhouette. Each tile carries the
  module's catalog icon at 40px, its name, and a hover that lifts, scales 1.5% and deepens its
  shadow on one curve; the module you are already in is filled with a darker tint and a darker
  icon chip, the way the active row reads in the column. Everything else about switching is
  unchanged: the current module is
  still derived from the URL, choosing still returns you to the page you last had open there,
  permissions still come from `/platform/me/applications`, a single-module user still sees no
  launcher at all, and the ⌘K palette and pinned favourites are untouched. It owns focus while
  open (trap, scroll lock that holds the scrollbar's space so the app cannot jump sideways),
  moves under the arrow keys, filters past six modules, and with twenty modules keeps its title
  and search pinned while only the grid scrolls — the grid centres only while everything fits,
  because a centred flex child that overflows pushes its first row above the scroll origin
  where nothing can reach it. Rendered through a portal to `<body>`: inside the shell, the
  mobile drawer's own transform would trap a fixed overlay inside the drawer's width. `Alt+M`
  still opens it — bound in exactly one of the two mounted shells, since both the desktop
  column and the always-mounted drawer used to answer the chord and raise two launchers at
  once.

- **The sidebar now scopes itself to one module, and the module is chosen from a switcher.**
  Choosing a module and navigating inside it are different questions, so they get different
  surfaces: a small header at the top of the column names the current module and opens a light
  popover listing the ones this user may see (instant, no dialog and no full-screen takeover —
  switching is frequent, and blanking the screen for it costs more than it gives); the column
  below shows that module's pages and nothing else. The current module is **derived from the
  URL**, never a second piece of state, so a deep link, a ⌘K jump, a pinned favourite belonging
  to another module, and Back/Forward all re-scope the column correctly by construction; the
  remembered module answers only the case the URL cannot — a path that names no module, such as
  the landing page or an account screen. `Alt+M` opens the switcher from the keyboard, arrows
  and Enter work in it, and a filter field appears once there are seven or more modules.
  Switching **returns you to the page you last had open** in that module (re-validated against
  the live catalog, so a revoked page degrades to the module's entry point) — leaving and
  coming back should not cost you your place. A user with a single module sees no switcher at
  all, just a quiet label. Pinned favourites and the
  ⌘K palette are untouched — the palette still searches every permitted page across every
  module. Monochrome throughout: no colours, no badges, no shadows.

- **Fixed: two sidebar rows could read as "you are here" at once.** `NavLink` highlights by
  prefix, so a module landing page like `/fleet` stayed lit while the user was on
  `/fleet/vehicles`. Rows whose route has another page nested under it now match exactly, and
  which rows those are is derived from the catalog's own routes — nothing hardcoded, so it stays
  true for whatever the catalog serves next.

- **Sidebar restyled to a minimal-enterprise language (UI only).** One quiet neutral surface for
  the whole rail; per-module colors, shadows and filled pills are gone. Every item — module
  buttons and page rows alike — is transparent with neutral icon/text; ONLY the active item sits
  in a white (dark: `slate-800`) rounded container with the brand color on its icon and label,
  and hover is a faint neutral tint with `transition-colors` alone. The pin star and queue
  badges went neutral too (the badge picks up a faint brand tint inside the active row). No
  behavior change of any kind: routing, permissions, active detection, module order, pinned
  favorites, live counters, RTL and the mobile drawer all work exactly as before, and
  `moduleColor` still serves the command palette.

- **Every page now spans the full available width.** `PageContainer` capped content at `max-w-7xl`
  (80rem) and let a page opt out with a `wide` prop, which only the interviews board and the
  contracts screens used — so the same table rendered narrow on one screen and full-width on
  another. The cap is removed; with no cap there is nothing to opt out of, so the `wide` prop is
  gone too. Padding, headers, toolbars, cards, grids, filters, and spacing are untouched.

- **Sidebar department tiles now show icons instead of two-letter initials.** The module rail, the
  module-panel header, and the ⌘K palette's module rows render each department's icon from the
  shared in-house icon set (no new dependency), resolved through the same registry application
  icons already use; a department without a suitable icon falls back to the generic building tile.
  The icon is data, not code: it is the Application Category's existing admin-editable `icon`
  field — the navigation seed now sets defaults for the shipped categories (HR → users,
  Fleet → truck, Organization → building, Administration → briefcase), and the boot sync fills
  the icon in on existing installs only while it is still null, so an admin-chosen icon is never
  overwritten. Tile colors, sizes, alignment, RTL behavior, and accessible names are unchanged;
  the monogram helper is removed.

- **National-ID OCR: the capture pipeline now handles cards that are angled, bent, or poorly
  photographed — and says so when it cannot.** The previous pipeline read a card that filled the
  frame, flat and square, and failed on anything else in a way that looked arbitrary from outside:
  some cards read correctly, some returned nonsense, and nothing in the output distinguished them.

  The cause was that card localization ran one fixed-threshold edge pass and, when it found nothing,
  silently resized the whole frame. For an already-cropped scan that fallback is right; for a
  photograph of a card on a desk it puts every field box on background. Both took the same code
  path. Localization now runs four detectors (edges, brightness in both polarities, gradient,
  texture), scores their candidates against the ID-1 aspect ratio with a measured floor, and reports
  which one won — separating "already cropped, nothing to find" from "a card was there and we missed
  it". A card bowed in a wallet is no longer treated as a plane: its top and bottom borders are
  traced and each column remapped, which a perspective warp cannot do. Flat cards skip it.

  A new capture-quality gate measures the card's real resolution, sharpness, glare and contrast, and
  returns reason codes — `too_small`, `blurred`, `glare`, `low_contrast`, `card_not_located` — so the
  UI can say what to change instead of "could not read the card". It does not discard the read:
  fields still come back, with the capture's verdict capping their confidence. A blurred crop can
  make recognition _more_ confident, not less, so the photograph gets the final word and only ever
  downward.

  Field boxes are no longer trusted blindly. Detection runs once per side and each box is snapped
  onto the text found near it, with a growth guard so a crop cannot swallow the neighbouring field;
  the national ID and the expiry are then identified by content rather than position — a line of
  exactly fourteen digits, and a full year/month/day — which is what lets an unfamiliar card layout
  still yield its most important field.

- **National-ID OCR: the number and the Arabic fields get real error correction.** Nine of the
  fourteen digits are constrained by a century, a calendar date and the governorate list, so a read
  that cannot be a national ID is now searched outward by edit distance over the shape collisions of
  Arabic-Indic numerals (٧/٨ are mirrors, ٢/٣ differ by a tooth, ٠ is a dot and ٥ a loop). A unique
  valid result at the nearest distance is accepted at `medium`; a tie is refused as ambiguous and
  the raw read preserved. The five unconstrained digits are never edited — there, a "repair" could
  only swap one valid-looking identity for another.

  The number is also read from **both sides** of the card and reconciled: two crops sharing no pixels
  have independent errors, so agreement raises confidence to `high`, while two different valid
  numbers drop to `low` for the reviewer to settle. The sex printed on the back cross-checks the
  parity digit — reaching a digit no structural check covers — as a validator only; `parseNationalId`
  remains the sole source of gender, and nothing is populated from it.

  Arabic matching now folds to the letter skeleton (rasm), so the dots a reflection or a JPEG
  artefact destroys stop counting as misreads — مسلمه matches مسلمة — while the feminine ending
  survives the fold, keeping masculine and feminine forms distinct. Address governorates snap
  against the official Arabic list, with approximate matching disabled for البحيرة and الجيزة, which
  are one edit apart after folding. The governorate is deliberately **not** cross-checked against
  the number: digits 8-9 encode birth registration, the address is residence, and the two legitimately
  differ for a large share of the population.

  `/extract` gains additive `quality` and `diagnostics` keys; callers that ignore them are unaffected.
  Quality thresholds are environment-settable (`OCR_QUALITY_*`) because they are reasoned priors
  awaiting measurement against real cards.

### Added

- **The Fleet web module exists (FW-1) and opens on a live dashboard (FW-2) — built exactly
  like the HR modules, with nothing unfinished ever shown to a user.** The module loads as one
  lazy chunk behind the platform shell; navigation stays data-driven, and per the owner's
  review rule a page joins the sidebar catalog and the route table only in the slice that ships
  it — an unshipped URL is a plain 404, never a "coming soon". The boot catalog sync gained a
  Fleet category carrying exactly the shipped surface (Fleet Home today), strictly additive, so
  each slice's rows reach existing installs on next start with admin customizations untouched.
  All labels ship in Arabic and English; RTL comes from the platform frame.

  `/fleet` is a real dashboard, not a link grid: four KPIs — active vehicles, vehicles in the
  workshop (open visits), derived maintenance alarms with the red count, open accident files —
  and two boards: the alarm list in triage order (red first, most-overdue first) and vehicle
  licenses expiring within 60 days with already-expired ones flagged. Every number is a server
  fact from the FL-2…FL-6 APIs; each card gates its own §7 permission, so queries never fire
  for cards the user cannot see, and an account with no fleet permissions gets one honest empty
  state. The data foundation for every coming slice landed alongside: a typed API client
  covering the whole backend surface plus TanStack Query hooks on the platform key factory —
  no mock data exists anywhere in the module. Five glyphs (truck, gauge, wrench, calendar, cog)
  joined the shared icon set and the sidebar registry — `calendar` also repairs the Leave app's
  icon, which had referenced a name the registry never knew.

  The vehicles registry followed (FW-3) in the HR list-page idiom exactly: URL-synchronized
  search (the four physical identifiers, matched server-side), status/type/branch filters,
  sortable columns, and pagination — deep-linkable and back/forward-aware. The derived
  in-workshop pill sits beside the lifecycle badge and expired licenses show red in place.
  Create and edit share one dialog where a cleared optional field submits as null — an erased
  fact, not an untouched one; the status dialog offers only the transitions the lifecycle
  allows, demands a reason whenever a vehicle leaves active service, and says plainly that
  disposal cannot be undone; deletion confirms with the audit-trail note. Every action stands
  behind its own permission.

  The vehicle profile (FW-4) completes the pair — reached through an explicit View action in
  the list's actions column, never by clicking the row (the owner's module-wide rule: no
  accidental navigation, and row selection stays free for later). The profile shows the whole
  car as live server facts: identity and radio, the type with its maintenance interval from the
  catalog, license with expiry flagged in place, placement, audit timestamps, the lifecycle
  status with its reason, and four indicators each gating its own permission — the derived
  workshop flag, the server's expected next odometer reading, the maintenance alarm with
  remaining or overdue kilometres, and the last closed workshop visit with its counter. Edit
  and status changes reuse the list's dialogs against the freshly loaded document, so every
  write stays version-checked. History links to the odometer, maintenance, accident, violation,
  and roster screens are wired behind per-slice flags and appear as each of those pages ships —
  fully hidden until then, never disabled, which the owner confirmed as the ECMS-wide standard.

  Drivers and attendance followed (FW-5). The drivers list shows the fleet-owned profiles over
  HR employees with names resolved through the shared HR cache — one EmployeeName component
  that degrades honestly to the raw id for callers without directory access — plus license
  search, specialization and active filters, and expired licenses in red. The driver profile
  gathers the fleet facts, links into the real HR employee profile for those who may open it,
  and carries the driver's own operational-unavailability timeline with record, edit, and
  cancel in place — recording there skips the employee picker because the driver is already
  known. The attendance screen lists the whole overlay (covering-date filter, sortable spans)
  and records through a directory search picker; edits and cancellations stay version-aware,
  and the cancel confirm says what it means: the driver becomes assignable again, the history
  stays in the audit log.

  The FL-4 trio followed (FW-6): odometer, maintenance, and the alarms board — screens over
  server facts, with none of the chain arithmetic reimplemented in the browser. The odometer
  log filters by vehicle and date range; an open period shows an honest "open" badge with the
  km column blank, because the server has not derived that distance yet. Recording offers the
  expected next reading as a hint only — continuity is enforced where it lives, in the API —
  and the correction dialog sends just the changed fields with the document version; it never
  sends an empty in-reading, because the backend reads that as reopening the period and
  refuses, and the UI does not offer what the server forbids. Maintenance lists visits with
  open/closed filtering and catalog-resolved workshop and work-type names; check-in pre-trims
  vehicles already in the workshop from the picker while the server remains the authority,
  and check-out, reopen, edit, and delete are version-aware behind their own permissions with
  plain-spoken confirms. The alarms board renders the derived projection exactly as served —
  level filter and code search run client-side over the one live response, triage order red
  first and most-overdue first, and a vehicle with no counting service yet says so instead of
  pretending a number. The vehicle profile's odometer and maintenance links lit up with this
  slice, and three rows joined the navigation seed.

  The daily roster board followed (FW-7), with the frontend as a pure viewer and executor of
  FL-5. One call brings the whole day: the scoped vehicles with their assignments, the derived
  in-workshop flag, and the driver pool already split by the availability seam — the unavailable
  side carries the server's named reason, translated when it is one of the five known verdicts
  and shown as sent otherwise. The date is URL-synced with previous/next-day stepping; searching
  by code or plate filters the one live response. Assigning opens a dialog that edits the
  complete desired state of that vehicle's day, and the driver slots offer only the board's own
  available pool — never a directory search — each candidate labelled free or with the vehicle
  currently holding them. Picking a held driver states plainly that saving will move them, and
  the save sends both sides of the move in one call, which the backend runs as one transaction;
  the server remains the authority on every rule, and a refused save refreshes the board because
  refusal usually means it went stale. The plan response is the refreshed board itself, so the
  screen repaints from the same round-trip with no second fetch. Clearing a day's assignment is
  its own confirmed action, and an in-workshop vehicle offers clearing but never assigning —
  the same asymmetry the backend enforces. The vehicle profile's roster link lit up with this
  slice, arriving pre-filtered to the vehicle's code, and the roster row joined the navigation
  seed.

  Accidents followed (FW-8), with states and money exactly as the backend keeps them. The
  registry lists the files with vehicle, status, and date-range filters synchronized to the URL,
  a sortable accident date, and pagination; the three amounts render through the platform's
  currency formatter and are never summed or combined — they are the entered facts, and no
  derived money exists until the owner defines the formula. Recording and editing share one
  dialog whose vehicle select offers the whole registry, because an accident is historical
  paperwork about the day it happened and a disposed vehicle is a legal reference — the same
  reasoning that makes the code column resolve retired vehicles instead of hiding them. The
  open/closed state is purely the server's: each row offers exactly the one direction its
  current state allows, closing and reopening are the same confirmed, version-aware call in
  either direction, and edits diff against the loaded document so only changed fields travel
  with the version. Deletion confirms with the audit-trail note. The vehicle profile's
  accidents link lit up with this slice and the accidents row joined the navigation seed.

  Violations and grievances close the FL-6 surface (FW-9), with not one amount computed in the
  browser. One screen carries two URL-synchronized views. The list shows both backend shapes
  side by side: a vehicle row is a bulk yearly statement — the year is the fact, and the amount
  column shows what the server derived from count times unit value — while a driver row is a
  per-event fact with its date, the driver's name from the shared HR cache, and the amount as
  entered. Recording matches: the vehicle-statement dialog sends count and unit value and never
  an amount, saying plainly that the server computes it, and the driver dialog picks the person
  through the directory while the server enforces that a driver profile exists. Editing opens
  the dialog of the row's own shape — the backend refuses crossing shapes, so the form never
  offers it — and sends only changed fields with the version. The annual rollup view renders
  the server's per-vehicle-per-year assembly exactly as returned, every figure including the
  grievance derived at query time; the grievance dialog sets the one stored figure per vehicle
  and year, prefilled from the row it was opened on, and the board repaints from the
  invalidated subtree. The vehicle profile's violations link lit up with this slice — all five
  history links now live — and the violations row joined the navigation seed.

  Catalogs and settings complete the module (FW-10). The catalogs screen manages the six list
  kinds every fleet form reads — workshops, work types, spare parts, mission types, violation
  types, unavailability reasons — as URL-synchronized tabs over the live paginated list, with
  archive instead of delete because history keeps referencing items, and the counts-for-alarm
  fact offered only where the contract allows it. The settings screen carries the two rule
  surfaces: the vehicle-type table, because the maintenance interval on the type is the
  maintenance rule the alarm engine reads, and the five fleet platform settings edited through
  the platform's own settings endpoints — a new thin platform settings client whose first
  consumer this screen is — with every value arriving from the server's hierarchical
  resolution and nothing hardcoded in the browser. Writes that move server-derived projections
  invalidate them: interval and work-type changes refresh the alarm board, and the HR-leave
  switch refreshes the roster's availability verdicts. With the catalogs and settings rows in
  the sidebar the Fleet category carries all twelve applications, and the closing integration
  review confirmed the whole: thirteen routes plus the 404 exactly matching the frozen
  information architecture, every route behind its own permission, all five vehicle-profile
  history links live, no placeholder or unreachable surface anywhere, and the module still one
  lazy chunk. The Fleet module — backend and web — is complete.

- **Accidents, violations, and grievances complete the Fleet backend (FL-6) — every fleet
  event is now stable.** Accidents keep the legacy's freedom with none of its looseness: a file
  opens on creation, closes and reopens as many times as the truth requires, but each flip is a
  distinct audited, published change — flipping to the state a file is already in is refused, so
  automation never hears an event that changed nothing. Amounts are stored as the entered facts;
  nothing is derived from them until the owner defines the formula (§13-Q9). An accident can be
  recorded against a disposed vehicle deliberately: it is historical paperwork about the day it
  happened, unlike an odometer reading, which stays refused.

  Violations are one collection with two discriminated shapes, and the shape decides who
  computes the money. A vehicle statement row has no amount field at all — the server derives
  count × unitValue when the row is created and again on every edit that touches either factor
  — while a driver event row records the amount as entered and requires a driver profile to
  exist (active or not; history counts). Editing a row with the other shape's fields is refused
  in the service, the one place both shapes meet. The grievance is a single figure per
  (vehicle, year) under a unique index, set and overwritten in place — the legacy stamped it
  redundantly onto every violation row. The annual rollup endpoint derives everything at query
  time: vehicle rows by their stored year, driver rows by the year of their event date (the
  legacy synthesized fake dates here, which is exactly how its reports went wrong), merged with
  grievance figures and vehicle codes by a pure, unit-tested assembler.

  `fleet.accident.recorded/.closed/.reopened` and
  `fleet.violation.recorded/.grievanceApplied` fire post-commit and are promoted
  planned → stable — with them, all 22 fleet events are stable and the module's automation
  surface is complete. Contract deltas are additive only: a grievance DTO and a rollup query
  schema.

- **The daily duty roster is live (FL-5): one board, one save shape, the day's exclusivity
  enforced where it can't be forgotten.** `GET /fleet/roster?date=` returns the whole planning
  picture — the caller's in-scope active vehicles with their assignments and a derived
  `inMaintenance` flag, plus the driver pool split into available (with the vehicle already
  holding each driver, anywhere in the fleet) and unavailable (with the layer that said no).
  The roster owns none of that logic: a driver's assignability is exactly what FL-3's
  `driverAvailabilityOn` answers, and a vehicle's is exactly what the `openVisitVehicleIds`
  seam answers — now accepting the plan date, so a car that enters the workshop after day D
  doesn't block day D (FR-5), with no call-site changed.

  `POST /fleet/roster` saves a plan as an upsert per (vehicle, date) — only the changed rows
  are sent, and each row is the complete desired state of that vehicle-day. The whole save runs
  in one transaction, every write version-checked against the row it read, and unchanged rows
  are pure no-ops: no write, no audit entry, no event. FR-7 — one vehicle per driver per date —
  is checked against the end state of the entire day, so taking a driver another vehicle still
  holds is refused with the holder named; sending both rows of the move in one save transfers
  the driver atomically. That is precisely the shape a drag produces, which is why a future
  drag-and-drop scheduler needs no backend change. Assignment rows are never deleted: clearing
  a day empties the row's facts in place, keeping the audit trail hanging on the row it
  describes. `fleet.roster.planned` (one per save) and `fleet.assignment.changed` (per changed
  row) fire after commit and are promoted planned → stable. Zero contract changes — the FL-1
  roster surface shipped exactly as frozen.

- **The odometer chain, maintenance visits, and the derived alarm engine are live (FL-4).** The
  odometer is one continuous chain per vehicle: recording a reading closes the open period
  (deriving its km) and opens the next inside a single transaction, a partial unique index
  guarantees at most one open period, and FR-2 refuses any reading below the vehicle's latest —
  the odometer never runs backwards. The only way past that refusal is the correction flow
  (`fleetOdometer.correct`, fully audited): because the closing reading of one period IS the
  opening reading of the next, a correction rewrites the shared value on both neighbouring rows
  atomically, and refuses outright anything that would break the chain's order — including
  "reopening" a period that has periods after it. `GET /fleet/odometer/expected` tells the
  client what reading the server expects next; the client computes nothing.

  Maintenance visits are the cycle's only reset: check-in requires a vehicle not already in the
  workshop (FR-4, doubly held by a partial unique index), check-out closes the visit with the
  counter at service, and reopen undoes a mistaken check-out — each firing its event only after
  commit. FL-2's `inWorkshop` seam now answers from the real open-visit query, with no call
  site touched. The maintenance alarm is never stored: `computeAlarm` derives
  remaining = interval − (latest reading − counter at last counting service) at query time, from
  the vehicle TYPE's interval, the settings thresholds, and the latest closed «صيانة» visit,
  preserving the legacy's two guards (no baseline / stale reading ⇒ no data, never a false
  alarm). `GET /fleet/odometer/alarms` is the alarm board.

  Two daily sweeps announce without changing state: license expiry (vehicles + drivers, warn
  windows from settings) and maintenance-alarm crossings. Idempotency is structural — a
  `fleet_sweep_marks` insert-if-new on a deterministic key means running a sweep twice emits
  nothing the second time, while a renewed license or a fresh service baseline naturally re-arms
  the announcement. Ten events promoted planned → stable: `fleet.odometer.recorded/.corrected`,
  `fleet.maintenance.checkedIn/.checkedOut/.reopened`, `fleet.maintenanceAlarm.raised`, and the
  four license-expiry surfaces. Contract deltas are additive only: an expected-reading DTO, a
  vehicle-id query schema, a reopen schema, and audit actions `correct`/`checkOut`/`reopen`.

- **Fleet drivers exist as extensions of HR employees, never copies (FL-3).** A driver profile
  holds only what Fleet is the authority on — license, specialization, area, an active switch —
  keyed by `employeeId`; name, phone and employment state stay in HR and are read through a new
  platform seam, `platform/directory`, which HR populates at module load the same way the auth
  identity seams work. Neither module imports the other: creating a profile validates the
  employee through the seam (an exited employee is refused), and the `hr.employee.exited` event
  deactivates the profile with no coupling. Internally each profile carries a `kind`
  discriminator with a (employeeId, kind) unique index, so a future second profile kind is an
  additive value rather than a migration — deliberately absent from the DTO until it exists.

  التمامات (driver unavailability) is the daily operational overlay the owner decided on:
  official leave lives in HR and is consulted through the seam when
  `fleet.availability.useHrLeave` is on, while this collection records only what the fleet floor
  knows (مأمورية، عهدة خارجية). One seam function answers "may this driver be assigned on date
  D", layering the profile switch, the HR employment gate, the fleet overlay, and HR leave — in
  that order, cheapest first — and names which layer said no. `fleet.driverUnavailability
.recorded/.ended` fire at commit points and are promoted planned → stable; an update publishes
  nothing, because a date correction adjusts a fact rather than creating one.

- **The Fleet module is running (FL-2): vehicle types, catalogs, and the vehicle registry with
  its lifecycle.** The `fleet` manifest registers alongside HR — permissions, routes,
  collections, settings, seed — and the first three features follow the platform shape exactly:
  Router → Zod validation → Service → BaseRepository, every write version-aware and audited,
  RBAC + data scopes from the first endpoint (a branch-scoped operator sees their branch's fleet;
  the legacy's hardcoded branch filter became scope, as the owner decided). The §4.1 lifecycle is
  enforced: leaving active service requires a reason, `disposed` is terminal and refuses edits,
  returning to service clears the reason. FR-1's four physical identifiers (code, plate, chassis,
  motor) are unique among non-deleted vehicles via partial indexes, so a scrapped car's plate can
  legitimately return. Nothing derived is stored: `inWorkshop` is computed through a service seam
  that honestly answers `false` until FL-4 owns maintenance visits.

  `fleet.vehicle.created/.updated/.statusChanged` are published at commit points and promoted
  `planned → stable` in the catalogue — the publisher test now holds them to their emit sites.
  Fleet settings are declared with defaults (alarm thresholds, leave-integration ON per the
  owner's Q1 decision, license-warning windows), and the boot seed installs the catalog rows the
  frozen design names: the alarm-counting «صيانة» work type, the roster's default mission type,
  and the seven violation types the legacy had hardcoded in its views.

- **The Fleet module's contract surface exists (FL-1), built from a frozen design extracted out
  of the legacy fleet system.** `packages/contracts/src/modules/fleet.ts` declares, at field
  level, everything the module will be: vehicles and their types (the per-type maintenance
  interval lives on the type), driver profiles as fleet-owned extensions of HR employees, driver
  unavailability, the odometer log, maintenance visits, the daily duty roster, accidents,
  two-shape violations with a once-per-(vehicle, year) grievance, and six catalogs. The schemas
  encode the design's load-bearing rules where they cannot be forgotten: odometer recording
  accepts one reading and no derived fields (km and the closing reading are server-derived),
  vehicle violations carry no client-supplied amount (count × unit value is computed), a roster
  plan refuses a driver holding two assignments in one day, and leaving active service requires a
  reason.

  All 22 `fleet.*` events are catalogued with v1 payloads and bilingual labels — visible to the
  Automation Engine's trigger picker from day one — and declared **`planned`**, the lifecycle
  state for a declared-but-unpublished event; the publisher test promotes each to `stable` only
  when its real emit site lands in FL-2…FL-6, so the catalogue cannot claim an event nobody
  fires. Settings keys (alarm thresholds, leave-integration toggle, license-warning windows) and
  notification template keys ship alongside, so nothing threshold-like is ever hardcoded. The
  design itself — entities, lifecycles, 14 business rules, permissions per screen, the hidden
  view-logic inventory from the legacy system, and the two legacy bugs deliberately not carried —
  is frozen in
  [`docs/12-planning/fleet-module-design.md`](docs/12-planning/fleet-module-design.md).

- **The first three automation workflows exist as data — account activation follow-up, password
  reset follow-up, and job-offer onboarding (A-9a).** Each is an `AutomationTemplatePackage`
  carrying an n8n graph, checked into `automation/templates/` and validated in CI against the real
  contract schema, so a package that would install as nothing fails here rather than on a
  production instance. A shared n8n error-handler workflow ships alongside them in
  `automation/n8n/`, and `npm run automation:preview <key>` renders any package into a standalone
  importable workflow for stepping through in the n8n UI.

  Designing them against the code rather than against assumptions changed all three. **ECMS has no
  temporary passwords to send** — AL-R4 replaced them with one-time activation links that
  `credentials-delivery.ts` deliberately keeps out of the persisted notification pipeline, and n8n
  persists execution data, so routing a link through n8n would write the credential into n8n's
  Postgres. The secret therefore never leaves ECMS: where a message must be re-sent, the workflow
  calls `credentials/resend` and ECMS composes and delivers it. What the workflows add is the thing
  ECMS genuinely lacks — follow-up and escalation, so an invitation sent nine days ago and never
  opened stops being invisible. **The onboarding workflow does not wait for the candidate's
  decision**: ECMS owns that state and publishes `hr.jobOffer.accepted`/`.rejected`, so each
  decision arrives as its own trigger and every branch is a pure function of one event, which keeps
  the answer to "did they accept?" in exactly one place.

  Every graph shares one skeleton — config, a fail-closed guard (constant-time signature check,
  envelope-shape check, `eventId` idempotency), business nodes, then a write-back to the ECMS
  execution row — so adding a fourth workflow is the business nodes and nothing else. Design,
  including the honest list of what must exist before any of it runs, is in
  [`docs/12-planning/automation-workflow-library-design.md`](docs/12-planning/automation-workflow-library-design.md).

- **National-ID OCR now has a real, fully local provider (OQ-30).** The seam has carried a null
  stub since Sprint 4.1 — `available: false`, no extraction — because image-to-text was a deferred
  capability. It is now implemented: a PaddleOCR 3.x sidecar carrying the PP-OCR weights baked into
  its image, reached by `PaddleNationalIdOcrProvider` behind the existing
  `NationalIdOcrProvider` seam. No third-party service and no external API at runtime.

  The pipeline is field-based rather than full-page — the card has fixed geometry, so each field is
  rectified, deskewed, denoised, contrast-enhanced, cropped and recognized on its own. That gives
  each field its own confidence band (which `OcrFieldDto` requires) and removes the guesswork of
  mapping a bag of strings back onto fields. Card geometry is data, not code: `OCR_LAYOUT_PROFILE`
  points at a JSON profile so real card stock can be calibrated without rebuilding the image.

  Deliberately unchanged: `parseNationalId` remains the sole owner of birth date, gender and
  governorate — the provider never returns them; the contracts in `packages/contracts`; the
  recruitment workflow; and the review dialog with its confidence model. Every field still goes to
  a human.

  **Off by default.** Without `NATIONAL_ID_OCR_URL` the null stub stays registered and the endpoint
  answers exactly as before, so this ships safely ahead of the sidecar being deployed anywhere. The
  provider reads card images through the Files service under the CALLER's context, so OCR cannot
  widen who can see a card, and it degrades to "no fields" on every failure path — an unreachable
  sidecar means the reviewer types the card in, not that recruitment stops.

  Accuracy against real Egyptian cards is **not yet measured**; the measurement harness and its
  documented process ship alongside in `spikes/national-id-ocr/`.

- **Recruitment: filter bars on every stage queue that was missing one.** The per-stage interview
  pages (First Interview, Second Interview, …), the per-phase evaluation pages (Security Check,
  Driving Test, Medical Examination, …) and Employees Ready now filter like the rest of the module:
  URL-synchronized, server-side, and part of the React Query key, so a filtered view is
  deep-linkable, survives a refresh, and can never share a cache entry with a different one.

  The interview bar is the existing component with a new `omit` prop rather than a second bar (I7):
  on a per-stage page the stage comes from the route and the status is the tab strip, so offering
  either again would be two controls for one piece of state. `clear filters` and the
  "any filters active?" hint both respect what the page owns. Evaluations get an applicant picker
  and a created-date range; Employees Ready gets free-text search over the offer number and
  applicant code plus an accepted-date range — never its own `status`/`hired` predicates, which
  ARE the queue (A6/RW15) and whose totals must keep agreeing with the stage counter.

  Each queue also gets the standard controls it can support: **free-text search** over the
  denormalized applicant code and name (interviews, evaluations; Employees Ready already searched
  its offer number), the **branch**, and — on interviews, the only stage where a record is assigned
  to anyone — the **interviewer**. Evaluations and accepted offers have no assignee, so neither
  offers a control for one.

  Branch and interviewer come from two new shared controls rather than three copies each, and both
  render _nothing_ when the caller lacks the permission that reads their catalog (`branch.view`,
  `user.view`) — an empty dropdown would filter nothing while implying access nobody granted. The
  user picker is the one the offer form already used, generalized: `ManagerPicker` is now that
  control with the offer form's wording.

  New query parameters: `createdFrom`/`createdTo` on evaluations, `respondedFrom`/`respondedTo` on
  job offers.

- **`search` now actually filters on screenings, interviews and evaluations.** All three declared
  the parameter in their contracts, and none of the three implemented it — a client could send
  `search=…` and get an unfiltered list back, which is worse than a 400 because it looks like it
  worked. All three now match the offers queue: an escaped, case-insensitive regex over the
  denormalized `applicantCode` and `applicantName`, so a user typing `.` searches for a dot instead
  of matching every row.

- **Prescreening: age-range and education-level filters, applied on the server.** Both facts live
  on the APPLICANT, not on the screening — the screening denormalizes only what it displays, and
  I1 is explicit that the list is closed. So the service resolves them against `hr_applicants`
  first and narrows the screening query by the id set they matched: the batched `$in` I3 permits,
  one extra indexed query per request rather than one per row. Two supporting indexes back it
  (`ix_education_birthDate`, `ix_birthDate`), the equality bound leading the range.

  Age is entered in whole years and converted to a half-open `birthDate` range at the boundary
  (`$lte now − from`, `$gt now − (to + 1)`), so "25 to 30" includes a candidate through the day
  before their 31st birthday and the stored field stays the date it always was. An applicant with
  no birth date — or no education record — is excluded when the corresponding filter is supplied:
  unknown cannot satisfy a predicate, and including those rows would make the filter mean nothing.
  An inverted range (`ageFrom > ageTo`) is a 400 at the contract boundary, not an empty page the
  user has to decode.

### Fixed

- **A deep link to page 2 of any searchable list bounced back to page 1.** `SearchInput`'s debounce
  effect listed `onChange` in its dependencies, and every caller passes an inline closure — so the
  effect re-ran on each parent render and re-emitted the _unchanged_ search term. On a list whose
  filter handler resets paging (the correct behaviour when a filter really changes), that discarded
  the page the user had linked to or refreshed on. The effect now emits only when the text differs
  from the value it was given, which also stops "clear filters" echoing back a change of its own.

- **Recruitment: interview status labels rendered as raw translation keys.** `/interviews`,
  `/interviews/:id` and `/interviews/stage/:stageId` showed `interviews.status.waiting` and
  `interviews.status.inProgress` instead of localized text, in the table, the detail badge, the
  status filter and the stage-queue tabs.

  I11 added `waiting` and `inProgress` to `INTERVIEW_STATUSES`; the locale catalogs were never
  extended, and `translate()` falls back to returning the key. Screening, evaluations, offers and
  applicants were all complete — interviews was the only stage missing values, and the two it was
  missing were exactly the two I11 introduced.

  Nothing caught it because `InterviewStatusBadge` mapped status to tone with a ternary
  (`cancelled ? neutral : info`) rather than the exhaustive `Record<Status, Tone>` every other
  stage badge uses — so growing the enum was not a typecheck error. That map is now exhaustive
  (`waiting` takes the same `warning` tone it has across the pipeline), and two suites make the
  class of bug mechanical rather than noticed: one drives every stage's status enum from
  `@ecms/contracts` and asserts each value resolves in **both** locales, the other renders the real
  badge for every status and fails if a raw key reaches the markup.

## [0.24.0] - 2026-07-28

Release v0.24.0 — **HR completed: Recruitment, Employee Management, Leave Management, Contracts,
and the Authentication & Account Lifecycle**, closing with the **Recruitment Workflow Refactor**
([PR #85](https://github.com/egycashcompany-ops/egycash/pull/85), merged 2026-07-28) whose frozen
design (`docs/12-planning/recruitment-workflow-design.md`, Revision 2.6 — decisions RW1–RW17,
invariants I1–I15) is now **fully implemented and audited with zero remaining implementation
gaps**. This release accumulates every change merged since v0.23.0; the Recruitment module is
**approved by EGYCASH**.

### Changed

- **Recruitment: every workflow mutation answers with the full state (I6, server half).** All
  seven recruitment controllers — screening, applicants, interviews, evaluations, job offers,
  hiring documents, return-to-stage — plus the per-candidate evaluation-batch actions now return
  `{ data, workflow, timeline, counters }` instead of the bare aggregate. `data` is byte-for-byte
  what they returned before; the other three are derived on the server, on every response, and
  stored nowhere (I1). `workflow` reports the furthest stage that still has open work and what the
  CALLER may do next — an action they lack the permission for is listed with `enabled: false` and
  the permission it needs, because capability lives in `availableActions` and nowhere else (I10).
  `counters` is the same aggregated stage-counts payload the navigation already reads (RW15),
  refreshed after the act. Reads (`GET`) are unchanged.

  Two kinds of endpoint stay outside the envelope, for the same reason: there is no single
  candidate whose state to report. Bulk endpoints answer with `BulkWorkflowResultDto` — the
  partial-success envelope plus what the batch wrote and the refreshed counters, but no
  `workflow`. Batch-LEVEL evaluation actions (create, add/remove members, issue, upload results,
  close, cancel) span every candidate in the batch; their per-candidate siblings (decide/void an
  item) do carry the full envelope.

- **Recruitment: the response IS the refresh (I6, client half).** `invalidateRecruitment()` — which
  fanned seven query subtrees out to the network after every write — is deleted, not deprecated.
  Every recruitment mutation now goes through one hook, `useWorkflowMutation`, which applies the
  response envelope to the TanStack Query cache: `data` seeds the aggregate's detail key and
  patches its row inside every cached list page, `workflow` is stored per candidate, `timeline` is
  merged into that candidate's history by `eventId` (newest first), and `counters` writes the one
  aggregated key the sidebar, the stage rail and every queue badge read. No request is issued.

  List MEMBERSHIP stays the server's judgement (I1): cached pages are marked stale with
  `refetchType: 'none'` — no request now, re-read on the next mount — while the visible list stays
  correct because the row is patched in place and dropped from a page whose `status` filter it no
  longer satisfies. Two responses are deliberately not written: empty `counters` (the BD-007
  degradation must not blank the navigation) and an empty `workflow.applicantId` (the empty state a
  candidate-less act answers with). Bulk keeps exactly one refetch, because
  `BulkWorkflowResultDto` carries the counters and the entries the batch wrote but not the changed
  rows; the other stages are marked stale without fetching. Adding a timeline note no longer
  invalidates anything either — the entry it returns is merged straight in.

  UI behaviour is unchanged throughout: the hooks still resolve to the aggregate, so every page,
  dialog and component reads exactly what it read before. `apps/web` gains a test runner (`vitest`,
  wired into `npm run test --workspaces`) and its first suite: 21 cases over the cache layer,
  including the ones that would catch a refetch creeping back in.

- **Recruitment: a retired attempt is read-only for every write, not just transitions (I1).** The
  stage repositories already refused to let a service write `status`, `attempt` or the supersede
  markers (I13), and the engine already refused to transition a superseded record — but an ordinary
  domain write addressed by id (a note, a file, a panel edit, a recommendation) could still land on
  an attempt a return-to-stage had retired. `BaseRepository` gains two generic hooks,
  `writeConditions()` and `assertWritable()`; the four stage repositories narrow them to the live
  set. The condition rides inside the same atomic `findOneAndUpdate` as the write, so a return
  landing mid-request cannot be overtaken, and the refusal says _why_ (422, "superseded by a return
  to an earlier stage") rather than reporting a version conflict a retry could never resolve. Two
  writers still reach a retired row, both named by I1 itself: the supersede marker, and the
  denormalized branch scope a reassignment syncs across a candidate's whole history.

- **Recruitment: the outbox has a scheduled recovery sweep (I15).** `hr.recruitment.workflowOutbox`
  runs every 5 minutes and publishes committed workflow events whose dispatch never ran. The engine
  writes the aggregate change and its event in one transaction and publishes after commit; a process
  killed in that gap left a committed state change with no timeline entry, no notification and no
  projection until some later write happened to drain the outbox. Now it heals on a timer too. Safe
  to overlap and safe to repeat — delivery is per-event and marked.

- **Recruitment: the timeline repair task exists (I5).** `hr.recruitment.timelineReconcile` runs
  hourly and puts back entries that should exist and do not: events committed but never projected
  (replayed through the dispatcher's own projection), and the two facts that have no event behind
  them — `applied` and `identityVerified`, whose writer logs and swallows rather than failing a
  registration — rebuilt from the applicant document. Every write it makes is keyed on the
  deterministic `sourceKey`, so a run against a healthy database changes nothing and a rebuilt row
  keeps its original `eventId`. The promise `recordSafe` has been making in a comment since the
  timeline was introduced is now kept in code.

- **Recruitment: the boot migration materializes the waiting backlog (I8/I11).** Since I11 made
  `waiting` a persisted row, a candidate with no row is not "waiting" — they are invisible to every
  queue, counter, badge and bulk action. Two populations had exactly that shape and nothing put them
  back: applicants who moved through the pipeline before I11 existed, and applicants whose
  materialization threw and was swallowed by `safely()` so the decision that triggered it would
  still commit. `migrateRecruitmentWorkflow()` now ends by walking every live applicant and
  resolving how far they got from their own records — never from a stored cursor (I1) — then opening
  whatever is missing through the same `open*` methods the live path uses. Re-running repairs
  nothing and writes nothing, which is what makes it safe on every boot; a decided stage is never
  re-opened, and a withdrawn candidate is not scanned at all. This closes the repair `safely()` has
  promised in a comment since materialization was introduced.

- **Recruitment: I3 is enforced by tests instead of asserted in prose.** A new integration suite
  seeds 2,000 rows across four stage collections and runs `explain()`: every stage queue must show
  an `IXSCAN` and never a `COLLSCAN`, and each counters aggregation must touch only rows that match
  — keys and documents examined both equal the live count, never the collection size. Making that
  true needed a new index, `ix_live_counters` on `{ supersededAt, isDeleted, branchId, status }`,
  which puts the retired rows in a key range the scan never enters.

  Two things about `null` came out of writing the check, and neither is visible without it. The
  obvious PARTIAL index over `{ supersededAt: null, isDeleted: false }` does not work and fails
  silently — MongoDB will not use a partial index for a `null`-equality predicate, because
  `$eq: null` also matches missing fields, so the plan is never generated and the query
  collection-scans exactly as before. And for the same reason the scan is index-_served_ but not
  index-_only_: an index entry cannot tell a stored `null` from an absent field, so each matching
  document is still read. Both claims sound alike and only one is true.
  The same suite benchmarks the shipped counters shape (N grouped aggregations in parallel)
  against a single `$unionWith` pipeline, asserts both return identical numbers, and fails if the
  shipped shape is slower. The shape itself is what RW15 §7 specifies verbatim — "six `$group`
  aggregations (one per collection) … issued in parallel inside one request" — and the `$lookup`
  pipeline I3's wording describes is the one I11 deleted when it made `waiting` a real row and
  removed the eligibility derivation. `docs/02-architecture/recruitment-workflow.md` §7 records how
  the two passages reconcile.

- **Recruitment: one history, and only one (I5).** Three parallel histories are gone. The
  Electronic Employee File no longer re-derives the recruitment milestones — its own timeline
  starts at the hire, and the candidate's recruitment history arrives as `recruitmentTimeline`,
  read from `hr_recruitment_timeline` at request time. `EvaluationDoc.decisionHistory[]` is
  removed: it logged `at`/`from`/`to`/`reason`/`by` for every re-decision, which is exactly what
  the timeline's `evaluationDecided` entry already records for the same act. And every screen that
  shows history now reads the canonical collection through one renderer — the four stage detail
  pages, the Employee File and the employee profile's recruitment section included. The boot
  migration drops the four derived milestone types from files already assembled and unsets the
  evaluation array; nothing is lost, because the timeline held all of it.

- **Recruitment: one bulk toolbar and one selection model (I7).** The older `BulkActions`
  component is deleted rather than deprecated, and its two call sites — the applicants list and
  the phase board — moved to the shared `BulkActionBar`. The phase board also dropped its own
  `useState<Set<string>>` selection for `useTableSelection`, and its "move to Job Offer" now
  issues one `POST /hr/applicants/bulk` instead of a client-side loop of single-item requests,
  so the act gets the per-item transaction, the partial-success envelope and the single audit
  record every other bulk action already had. `BulkActionBar` and `useTableSelection` are now part
  of the shared UI barrel.

### Fixed

- **Recruitment: `timeline.produced` could never resolve.** The envelope's "what did this action
  write?" half joined the workflow event ids the engine reported against the timeline's `eventId`
  column — but the projection minted a _fresh_ id for the entry, so the two never matched and the
  slice would have shipped permanently empty. A projected entry now takes its event's id, which is
  also what makes the join idempotent across a redelivery, and entries written outside the engine
  report themselves at write time. Found before the contract had a single consumer.

- **Recruitment: the candidate timeline was missing its first two entries.** `applied` and
  `identityVerified` were in the frozen vocabulary but nothing wrote them — registration and
  identity verification are candidate facts, not workflow transitions, so no consumer recorded
  them and every history began mid-pipeline at the first decision. Both are now written by the
  applicant service.

- **Recruitment: a stage closed by a withdrawal showed as a blank note.** `hr.screening.cancelled`
  and `hr.evaluation.cancelled` had no timeline entry type, and an unmapped event does not fail —
  it falls through to a generic `note`. The vocabulary gains `screeningCancelled` and
  `evaluationCancelled`, and a unit test now asserts the mapping is total, so the next event
  cannot repeat this.

- **Recruitment: bulk "Move to Job Offer" silently ran a reassignment instead.** The applicant
  bulk executor handled `withdraw` and fell through to `reassign` for everything else, so
  `moveToOffer` and `moveToScreening` — both in the closed action vocabulary — reassigned the
  selection with an undefined placement rather than moving anyone. The executor is now exhaustive
  over its own vocabulary: `moveToOffer` moves, and `moveToScreening` opens the screening row
  (idempotent, since I11 materializes it at registration). Both are now offered on the applicants
  table, completing RW17's action list for it, and both are covered by integration tests.

- **Recruitment: bulk "Start now" was a no-op.** The web client posted the bulk body to
  `POST /hr/interviews/start` — the single-candidate route, whose schema is `.strict()` —
  so every click answered 400. It now calls `POST /hr/interviews/bulk/start`, and bulk
  scheduling likewise calls `POST /hr/interviews/bulk/schedule` instead of looping
  single-schedule calls client-side, which produced no bulk audit record, no
  partial-success envelope, and a half-finished run if the tab was closed. A test pins
  that the single route refuses a bulk body.

- **Recruitment: withdrawing or restoring a candidate bypassed the workflow engine.** Both wrote
  `applicant.status` directly through the repository, so the invariant that the engine owns every
  lifecycle change (I13/I14) was documented but not enforced for the two most common moves — and
  nothing downstream of the engine ran for them. Both now go through it, carrying their own
  fields and the caller's version check in the same act.

- **Recruitment: withdrawn and rejected candidates lingered in the stage counters.** The
  counters read stage rows without regard to whether the candidate was still in the
  running, so a badge could out-count its own page indefinitely. A lifecycle exit now
  **closes** the candidate's open stage records: the workflow engine transitions each of
  them to a terminal status in the same transaction — screening and evaluation to the new
  `cancelled`, interviews to `cancelled`, a live offer to `withdrawn` — so they leave every
  queue and counter through the status vocabulary itself, with no mirrored lifecycle field
  anywhere (I1/I10). Decided records are never touched. Because each closure status is
  terminal, restoring a candidate re-opens the stage on a **new attempt** rather than
  reviving a closed row (I11/I12). The boot migration closes the records of applicants who
  had already left.

- **Contract templates: Save Draft is no longer completeness-gated — Publish is.**
  Saving a template draft no longer demands the full names, contract type and body up
  front ("Complete the Full Names, Contract Type, and Body before saving"): a draft is
  expected to be incomplete while it is being authored, so drafts now save freely with
  empty names, no contract type, an empty body and unlabeled signature rows (schemas,
  Mongoose model and editor all relaxed; the template DTO's `contractTypeId` is `null`
  while unset). **Publish** becomes the single completeness gate: it blocks — client-side
  with a friendly message and server-side with a 422 listing exactly what is missing
  (Arabic/English names, contract type, body, signature labels) — until the draft is
  complete, which also preserves the invariant that only complete templates can ever
  generate contracts (A17). Unknown placeholders (e.g. a typo like `{{employe.name}}`)
  no longer block draft saves either — they surface as preview issues while authoring
  and are rejected at publish (D5 enforced at the gate), and a body of empty markup
  (the editor's leftover `<p></p>`) counts as empty there too. Preview stays entirely
  outside this validation (it renders the current editor state, now even with unlabeled
  signature rows), and unnamed drafts list as "(untitled draft)" so they stay reachable.

### Removed

- **Recruitment: the derived "awaiting" queues are gone (I11).** `GET /hr/screenings/awaiting`,
  `GET /hr/interviews/awaiting` and `GET /hr/job-offers/awaiting` — with their contracts,
  services and the three panels that rendered them — have been removed. Every queue in the
  product is now a plain indexed read over persisted `waiting` rows, so there is no second
  "who ought to be here" model that can disagree with the first. Also removed: the four
  deprecated loose selection props on `DataTable` (superseded by `selection`) and the
  duplicated `BulkApplicantsResultDto` (superseded by the shared `BulkActionResultDto`);
  applicant bulk actions now run through the same executor as every other module, so they
  are audited once as an act as well as per item.

### Added

- **Recruitment: every backend capability is now reachable from the UI.** The pieces that
  existed only as endpoints are wired to real screens: **Return to stage** (RW13) gets its
  own dialog — target picker, the server's own consequence preview of what will be
  superseded and what will be closed first, a mandatory reason, and a confirm button that
  stays disabled until that preview has arrived. **Start interview** (RW12) gets buttons on
  the round's page and on each row of a stage queue, covering both "start now" for a
  candidate whose round does not exist yet and "start" for one already scheduled; the
  server stamps who started it and when, and the screens render those moments on the
  Africa/Cairo business calendar rather than the viewer's timezone. **Placement
  recommendations** (RW5) can finally be _recorded_ — previously only displayed and
  applied — on both interviews and evaluation phases, including clearing one. **Employees
  Ready** appears in the navigation with its live counter and filters server-side, so its
  pagination and its badge agree. **Bulk complete** arrives for Hiring Documents (new
  endpoint) and **bulk close/cancel** for Evaluation Batches, completing bulk actions on
  every recruitment table.

- **Recruitment: Position & Branch stay editable until hire (RW1–RW5).** A candidate now
  carries a first-class `placement` (position, title, department, branch, section) that
  may be set at intake and stays editable from Screening through Offer Acceptance.
  Moving one is its OWN audited action — `POST /hr/applicants/:id/reassign` behind the new
  `applicant.reassign` grant, with a mandatory reason — never a field on the edit form, so
  a routine data correction can't silently move someone to another branch. One act does all
  of it: writes the placement and its ADR-015 scope mirror, appends to `placementHistory`,
  syncs the **scope field only** on the candidate's screenings, interviews, evaluations and
  offers so a branch-scoped user keeps seeing their whole history, writes one timeline entry
  per moved dimension under a shared correlation id, and drives a live (`draft`/`sent`) offer
  through a normal versioned revision so the package follows the placement. Selecting a job
  position completes the rest of the placement from the seat. Every stage record keeps its
  **immutable `placementSnapshot`** — queues show where the candidate stands today, history
  shows what it was created under, and nothing already decided is rewritten. Acceptance
  closes the window: afterwards the path is revise / withdraw → re-accept → hire, because the
  accepted snapshot is the contractual artifact. Bulk reassignment applies one placement to a
  whole selection with the shared partial-success envelope. Interviews and evaluations can
  record an advisory `recommendedPlacement` that never moves anyone by itself.

- **Recruitment: Employees Ready queue + bulk "Start now".** `/employees/ready` lists
  accepted offers not yet converted into an Employee — read from a fact on the offer, the
  same source the stage counter uses — with a direct hire action. Interview stage queues gain
  a bulk **Start now** (RW12) alongside bulk cancel.

- **Recruitment: Security / Driving check batches (RW8).** The two external checks that
  are performed on a GROUP of applicants are now worked as batches. HR picks candidates
  from a phase's waiting queue (`GET /hr/evaluation-batches/candidates` lists exactly the
  eligible ones — live applicant, all interviews cleared, phase applicable, not already
  held by an open batch), the system allocates an immutable batch number
  (`SEC-2026-000001` / `DRV-2026-000001`, atomic per prefix and year) and drafts the
  batch. Issuing freezes membership, stamps the sent date and queues the package build.
  A batch never becomes a second source of truth: every item points at the applicant's
  ordinary per-phase evaluation record, and deciding an item decides that evaluation
  through the existing service — one writer, one audit trail, one event, one timeline
  entry. Membership is only editable while the batch is a draft; afterwards an item is
  **voided with a reason**, never removed, and batches themselves are never deleted or
  purged, so the whole history (cancelled ones included) stays available permanently.
  Closing requires every item to be decided or voided. Bulk approve/reject/void run
  per item with the shared partial-success envelope (RW10/I4). Sight is per phase (RW7):
  the generic `evaluation.*` grants remain a superset, and a caller who only holds
  `medicalCheck.*` never sees a security batch — including in an unfiltered list.
  Medical Check stays individual and offers no batch surface at all (RW9).

- **Recruitment: batch package — official PDF list + ZIP export (RW8b).** Issuing emits
  `hr.evaluationBatch.generated` on the reliable tier; the **worker** renders the official
  list through the existing chromium seam (company branding header, batch identity, a
  numbered candidate table and a signature block, printed RTL), writes a manifest CSV, and
  packs `list.pdf`, `manifest.csv` and `attachments/<applicantCode>/…` into one ZIP stored
  in a new `hr-evaluation-batches` Files category. With the PDF driver disabled (dev/CI)
  the batch still issues and the package still builds — it simply reports that it holds no
  `list.pdf`, the same graceful degradation contracts uses — and the build is retryable
  from the UI. Returned results are uploaded against the same batch
  (`POST /hr/evaluation-batches/:id/results`, multipart); the first upload stamps
  `returnedAt`, and a document may be attributed to one applicant's item (RW8c).
  Adds one runtime dependency: `archiver`.

- **Contracts: preview without saving + `{{contract.currentDate}}`.** The template
  editor's Preview now renders the CURRENT form state directly — nothing has to be
  completed or saved first: `POST /hr/contracts/preview` accepts an `inlineTemplate`
  (language + sections + signature blocks) as an alternative to a saved `templateId`,
  sanitizes it through the same pipeline, and reports unknown or unresolved
  placeholders as listed issues in the preview dialog instead of blocking. A new
  built-in catalog variable `{{contract.currentDate}}` resolves to the current date on
  the **Africa/Cairo** calendar (same `YYYY-MM-DD` shape as the other date variables)
  and is available in every template via the variable browser.

- **Recruitment workflow UX.** The Interviews phases board (`/interviews?view=board`) now
  uses the full page width (kanban-style; the standard 80rem cap remains everywhere else).
  Scheduling an interview from an **accepted Screening** opens the schedule dialog with
  the applicant preselected and read-only — searching exists only when scheduling a
  completely new interview. `/job-offers` becomes a workflow queue: applicants moved to
  the Job Offer stage with no offer drafted yet surface automatically in an
  **Awaiting offer** panel (name, code, eligibility status, moved-on date; derived
  read model via `GET /hr/job-offers/awaiting` — no offer record is fabricated), and
  **New Offer** opens the create form with that applicant preselected; the applicant
  search remains only for standalone offers. Drafting an offer removes the applicant from
  the queue.
- **Contracts module (frozen design `docs/12-planning/contracts-module-design.md`,
  Revision 2 — D1–D12, A1–A22, Q1–Q3; architecture:
  `docs/02-architecture/contracts-module.md`).** First-class HR module:
  - **Templates** — admin-owned, ONE document per version in an append-only recoverable
    chain (A19): drafts edit in place, editing a _published_ version forks the next
    draft, and only **published** versions generate (A17, one published per key). Rich
    sections (header/body/footer) pass an allow-list sanitizer on every save (A11 — no
    active content survives), placeholders are validated against the server-owned
    variable catalog (D5), clone creates the cross-language copy (Q2), archive retires a
    version. Web: `/contracts/templates` + the D7 **TipTap** editor whose toolbar
    mirrors the sanitizer exactly, variable browser (insert `{{key}}` at the caret),
    signature-block editor, version history, and a sample-data **server** preview.
  - **Contracts** — draft → optional single-step approval (A7, `contracts.requireApproval`,
    default on) → **generate**: pins the published template version (A2), resolves every
    variable **with provenance** incl. manual overrides (A3), refuses loudly with a
    structured report when required values are empty (A16 — `CONTRACT_VARIABLES_MISSING`),
    renders the immutable snapshot through ONE renderer (A18/A20), stores SHA-256 +
    generator/template/contract-version integrity metadata (A14) and hands the PDF to the
    **worker** over the reliable event tier (A13). One immutable Files record per contract
    version (A15); with no chromium (`CHROMIUM_PATH` empty) generation completes and the
    print view serves exports (D8). Configurable numbering `contracts.numberFormat`
    (A1, default `ECMS-CON-{year}-{seq:6}`) over per-year atomic counters. Signing per
    template block (A5); fully signed or archived ⇒ `CONTRACT_IMMUTABLE` (A4). Amend =
    next version of the same code, renew = new linked contract (D9); generating the
    successor supersedes the predecessor. Q3: one active contract per employee per type
    unless the type allows multiple. Hourly expiry sweep + once-per-contract
    expiring-soon notice (D11, `contracts.expiryNoticeDays`). Free-text search over
    number/employee/reference (A12); attachments via the platform Files service (A6);
    every lifecycle step lands on the employee timeline (A8).
  - **Integration seam (A22)** — consumers (Payroll, Employee Files, Workflow, Document
    Management) read ONLY `contractQueryService` snapshots (`activeSnapshotAt`,
    `listForEmployee`, `getSnapshot`) and the `hr.contract.*` events — never the tables.
  - **Revision 3 (freeze confirmed) — A23–A26.** Every PDF carries a **verification QR**
    targeting the public non-PII endpoint `GET /hr/contracts/verify` (key = the A14
    SHA-256, bound to the exact issued snapshot) and the public `/verify/contract` web
    page renders the verdict (A23). A **company branding profile** (logo, header/footer
    lines, watermark, brand color — each ar+en, managed on the Templates page under
    `contractTemplate.manage`) is applied by the server at every render and preview and
    frozen into each issued snapshot, so branding changes never alter existing documents
    (A24). The worker records a `contractRendered` audit entry on every PDF run —
    completing the audit inventory across template edits, generation, approvals,
    signatures, downloads and lifecycle transitions (A25). The renderer abstraction is a
    recorded invariant: the domain depends only on `platform/pdf`, never on Chromium
    (A26).
  - **Web app** — `/contracts` register (Employee/Type/Version/Status/dates + Preview /
    Print / Download PDF / Amend / Renew / Terminate, permission- and state-gated),
    `/contracts/new` two-pane creation with a debounced live **server** preview (the
    exact document generation freezes) + per-variable overrides + generation progress,
    `/contracts/:id` detail (snapshot viewer, integrity line, variables with sources,
    approval, signing, attachments, amendment chain), and a **Contracts** tab on the
    employee profile. Full ar/en i18n; sidebar entry seeded for new AND existing
    installs.

- **Authentication & Employee Account Lifecycle (frozen design:
  `docs/12-planning/auth-account-lifecycle-design.md`, Revisions 2–6).** Every employed
  employee now gets a login account **automatically at creation** (hire or direct
  registration) and via an idempotent boot backfill for existing databases: username = the
  Employee Code, Employee Self-Service role granted at link time. **No passwords are ever
  sent (§14, enterprise standard):** the account is born awaiting a **one-time setup link**
  delivered to the employee **via WhatsApp + email** (username, Employee Code, link, expiry)
  through provider-agnostic transports (Meta Cloud API / Twilio / disabled — R9); the
  employee opens `/activate` and **chooses their own policy-checked password**. Delivery is
  transient — the persisted notification pipeline is never used, nothing secret is ever
  stored (hash-only), logged, or returned by any API (R11/R12) — and the message wording is
  an **admin-editable notification template** (`platform.credentialsDelivery`,
  create-if-missing so edits survive deploys, R15). Channels are independent (email-only or
  WhatsApp-only both work, R16). Links **expire** (`auth.activationLink.ttlHours`, default
  48h); **Resend** issues a new link that instantly invalidates the previous one (only while
  a link is pending); **admin Reset** (permission `user.resetPassword`) locks the account —
  password cleared, all sessions revoked — and delivers a fresh link. Login identifiers are
  configurable (`auth.loginIdentifiers`): username, email (now **optional** on accounts —
  partial unique index, migrated at boot) and the Employee Code, which resolves through an
  HR seam and keeps working even after an admin renames the username. Admins can also
  **Reset** a user's authenticator or **Require/Un-require TOTP** (force-on wipes any
  enrolled secret and demands enrollment at the next login — admins can never see or
  generate a secret, D6). Self-service gets an **Account Security** page (change password,
  enable/disable authenticator with QR + one-time backup codes, active-session list with
  revoke). The server-enforced first-login gate (`mustChangePassword` →
  `PASSWORD_CHANGE_REQUIRED`) remains implemented as dormant defense-in-depth — the link
  model never needs it. All lifecycle events are audited (`accountAutoCreated`,
  `credentialsDelivered` per channel + mode, `firstLogin` at activation, `passwordReset`,
  `passwordChanged`, `totpEnrolled`/`totpDisabled`/`totpReset`/`totpRequiredChanged`,
  `usernameChanged`). Fully backward-compatible: existing email-only accounts, the invite →
  activate flow and enrolled TOTP users behave exactly as before, and the identifier
  resolution + challenge-token seams keep the door open for Azure AD / Google Workspace /
  LDAP / SAML / OAuth, WebAuthn and SMS/Email OTP without redesign (§10/R18). Also fixes
  the web login form, which only sent `email` and silently broke username-based sign-in.
  **Hardening + enterprise completeness (§15/§16):** a never-activated login answers a
  dedicated `AUTH_ACCOUNT_NOT_ACTIVATED` (unknown identifier and wrong password stay
  indistinguishable); admins see a derived **account status** (Not Invited / Invitation
  Sent / Activated / Expired / Locked) plus a full **Account panel** on the employee page
  (invitation sent/expires, activated at, last login, password last changed, MFA state,
  per-channel delivery outcomes); disabling an account, deleting it, or an **employee
  exit** revokes any pending setup link _and every session_ in the same operation (the
  status machine now allows suspending a never-activated login); an **hourly sweep**
  revokes expired links; the whole invitation lifecycle is audited (`invitationCreated` /
  `invitationResent` / `invitationExpired` / `invitationUsed` / `invitationAttemptInvalid`
  / `invitationRevoked`) with nothing ever deleted — history lives in the append-only
  audit stream and the invitation metadata survives consumption; activation is single-use,
  device-independent, MFA-independent and **never mints a session** (login is the only
  place sessions are born); lifecycle state + sequence diagrams live in
  `docs/02-architecture/account-lifecycle.md`.

- **Railway deployment support.** Config-as-code for a two-service deployment
  (`railway.json` → api + web, `railway.worker.json` → BullMQ worker + scheduler), a new
  `WEB_STATIC_DIR` option that lets the api serve the built web bundle **same-origin**
  (hashed assets immutable, HTML shell no-cache, SPA fallback) so the `SameSite=Strict`
  refresh cookie works without cross-site exceptions, and a step-by-step guide
  (`docs/09-guides/railway-deployment.md`) covering Atlas (transactions require a replica
  set), Redis, volumes, env vars and first-boot seeding. Field-tested notes are folded in:
  `REDIS_URL` needs `?family=0` (Railway private networking is IPv6-only), `WEB_STATIC_DIR`
  must be absolute (`/app/apps/web/dist` — `npm start -w` sets cwd to `apps/api`), and the
  worker's optional contract-PDF stack (`RAILPACK_DEPLOY_APT_PACKAGES` chromium + Noto
  fonts, `CHROMIUM_PATH=/usr/bin/chromium`).

### Fixed

- **Upgrade compatibility + field-test fixes (post-Leave-merge QA round).**
  - _Sidebar_: the navigation catalog now syncs at every api boot (`syncNavigationCatalog`),
    so installs upgraded from older releases receive newly shipped applications (e.g. `/leave`)
    and super-admins are granted them automatically — previously the catalog only seeded on
    fresh installs.
  - _Permissions_: `syncPermissionRegistry` invalidates super-admin/platform-admin holders'
    cached permission snapshots when the catalog changes — new-module permissions apply
    immediately after deploy instead of 403ing until cache expiry.
  - _Applicants list 500_: documents created by earlier releases lack later-added fields and
    `.lean()` reads skip schema defaults (`undefined.toISOString()` crashed the list). The
    applicant mapper is now total over legacy shapes and a boot migration
    (`migrateRecruitmentLegacy`) backfills the stored documents.
  - _Person names in tables_: Screening/Interview/Evaluation/Job-Offer rows now denormalize
    `applicantName` (backfilled for existing rows); queue tables, the workflow board and the
    awaiting panels show the display name next to the code, and job-offer search matches it.
  - _Leave error reporting_: leave tables no longer mask API failures behind a generic
    message — the real error (permission, validation, server) surfaces in the error state.
  - _Reference lookups_: dropdown queries requested `pageSize: 200` against the API's
    `MAX_PAGE_SIZE = 100` and silently degraded to empty lists — the Department picker on the
    Section form (and four sibling lookups) now work.
  - _Numeric org-unit codes_: `01`-style codes are accepted (min length 1), Arabic-Indic
    digits are folded to ASCII in the code input, and the hint copy no longer implies letters
    are required.
  - _i18n_: added the missing `employees.tabs.leave` label (en + ar).
  - _Job Titles vs Job Positions_: kept as two entities (WHAT vs WHERE — see
    `docs/02-architecture/organization-structure.md` §2); both pages now state the
    distinction explicitly in both languages.

### Added

- **HR — Leave Management module (frozen design: `docs/12-planning/leave-management-design.md`).**
  Law and policy live as editable configuration: the seeded leave-type catalog models the
  Egyptian Labor Law defaults (annual 15/21/30 with age-50 step, casual deducted from annual,
  tiered-pay sick leave with a certificate gate, maternity, pilgrimage, unpaid) — **HR must
  verify the amounts before production (L4)**. The append-only leave ledger is the truth for
  every balance movement, with an atomic reservation gate on the balance cache, frozen
  `paidBreakdown` snapshots on consumption (the Payroll read contract) and pro-rated grants at
  boot, year-end and hire time. Requests flow submit → dynamic current-manager approval
  (relationship-based — line managers need no leave permission) → optional HR step, with HR
  override, synchronous catch-up for backdated spans, soft-rule override for HR on-behalf
  filing (L8), early return, cancellation, attachments via the Files platform and a live
  eligibility preflight. Status-affecting types (maternity/Hajj/long unpaid) drive
  `leaveStart`/`leaveEnd` through the Personnel Actions engine and never roll back when a drive
  fails. The shared `work-calendar` feature (Fri+Sat weekend setting + holiday catalog, Cairo
  business dates) is Attendance-ready. Web ships the Leave app (My Leave + wizard, approvals
  inbox, team calendar, HR administration) and the employee profile's Leave tab; the first
  self-service surface arrives with the seeded **Employee Self-Service** role (own-scoped),
  `MeDto.employeeId`, the `ownerUserField` own-scope repository option and the
  `hr.employee.loginLinked` backfill event (C1-R). Four scheduler tasks, eight notification
  templates, four audit actions, exit settlement and the deprecated manual leave dialogs
  removed from the Employees UI complete the module.

- **HR — Employee Management module (frozen design: `docs/12-planning/employee-module-design.md`).**
  The employee becomes the post-hire system of record, moved out of Recruitment into
  `modules/hr/employee-management` (URLs and permission keys unchanged).
  - **Probation-first lifecycle.** Statuses are now `probation → active ⇄ onLeave ⇄ suspended →
exited`; every new hire starts in probation (0 months ⇒ straight to active) with explicit
    confirm / extend / fail decisions and a scheduler reminder before the deadline. `exited` is the
    single terminal status — the exit _type_ (`resignation | termination | endOfContract |
retirement | death`), reason, effective date and an explicit **rehire-eligibility** decision are
    data on the exit record. Returning from suspension/leave lands on the BASE status (probation if
    never confirmed). The legacy `terminated` status is migrated to `exited` at boot.
  - **Personnel Actions engine** (`hr_employee_actions`) — the only writer of employment facts.
    Append-only, per-employee sequenced, **effective-dated** (past applies immediately; future is
    `scheduled` and applied by a scheduler task in date order, with org referents re-validated at
    application time — failures are recorded + notified, never silent), cancellable while scheduled.
    Permission-grouped endpoints: `POST /hr/employees/:id/actions/{employment|compensation|exit|rehire}`
    - cancel + list. The old `PATCH /:id/status` remains one release as a thin alias (exits refused
      there). Propagation: a branch transfer recomputes the employee code and syncs the **linked user's
      placement** and the Employee File's code/branch; an exit **auto-suspends the login**, settles
      direct reports (bulk reassign or explicit unassigned) and closes the employment period;
      self-actions are always rejected.
  - **Owned personal data.** The applicant's personal data is copied ONCE at hire (raw national id,
    masked in DTOs) and maintained on the employee via audited `PATCH /:id/personal` edits — the
    applicant record stays immutable pre-hire history.
  - **Direct Registration** (`POST /hr/employees/direct`, `employee.registerDirect`) — onboard the
    existing workforce or walk-in hires without a pipeline (recruitment references null), with the
    shared national-id OCR and duplicate guards against employees AND live applicants.
  - **Rehire on the SAME employee number** — reopens a new employment period (same number, same
    Electronic File; a new completed hiring case _supplements_ the existing file). Terms come from an
    accepted offer or direct entry; rehiring someone marked not-eligible needs the dedicated
    **`employee.rehireOverride`** permission. Hiring a returning person through recruitment or direct
    registration is refused and routed to Rehire (one person = one employee, forever).
  - **Compensation split.** `employee.viewCompensation` / `employee.manageCompensation` — salary and
    allowances are redacted end-to-end (profile, lists, action history) without view rights.
  - **Employees web app.** `/employees` becomes its own sidebar app: an employed-by-default registry
    list (+ exited view), a profile hub (Overview / Personal / Employment / Documents / Timeline /
    Account) with a status-and-permission-filtered Actions menu, focused action dialogs (suspend's
    "disable login" checked by default), pending-exit + probation banners, a Direct Registration
    form with a live rehire-match check, and a composed timeline (recruitment milestones + personnel
    actions + audited personal edits). `/employee-files` moves alongside unchanged.
  - New permissions: `employee.{registerDirect, editPersonal, manageActions, manageCompensation,
viewCompensation, exit, rehire, rehireOverride, viewSensitive}`; new events
    `hr.employee.{actionApplied, transferred, exited, rehired}`; five notification templates; boot
    migration is idempotent (origin backfill, employment periods, personal copy, synthesized hire
    actions, frozen legacy status trail). Hiring-documents / employee-file applicant references are
    nullable for direct-registration employees.

- **HR — Recruitment workflow completion (follow-up to the workflow redesign).**
  - **Interview Phases (Kanban) view.** `/interviews` gains a **List ⇄ Phases toggle** (URL-persisted).
    The board's columns are _Waiting for Scheduling → each active interview stage → each active
    evaluation phase → Job Offer_, composed from the existing per-stage endpoints; cards show the
    Application Number only. Waiting + interview columns support **multi-selection** with **bulk
    actions**: _Schedule interviews_ for all selected at once (one stage + time; every row still goes
    through the normal endpoint so all workflow rules apply) and _Move to Job Offer_.
  - **Stage & phase management UIs.** New settings screens — `/interviews/stages`
    (`interviewStage.manage`) and `/evaluations/phases` (`evaluationPhase.manage`) — to add a 3rd/4th
    interview round or a new evaluation phase, rename, reorder (order number), toggle drivers-only,
    and enable/disable, all without touching the API directly.
  - **Explicit Job Offer stage (eligibility is never automatic).** Completing interviews/evaluations
    no longer qualifies an applicant for an offer. HR **explicitly moves** an applicant to the Job
    Offer stage — `POST /hr/applicants/:id/move-to-offer`, new **`applicant.moveToOffer`** permission,
    audited, `hr.applicant.movedToOffer` published — from ANY interview or evaluation stage ("Move to
    Job Offer" on the Interview and Evaluation detail screens + the board bulk action). Offer creation
    now requires the move (the interviews/evaluations hard-gate is replaced), and the **New Job Offer
    picker lists only moved applicants** (`movedToOffer` filter on the applicants list).
  - **Hiring documents: all SEVEN checklist documents are now seeded as REQUIRED** (completion blocks
    until every one is uploaded). On databases seeded before this change, flip the two previously
    optional types (bank letter, company ID card) via `PATCH /hr/hiring-document-types/:id` — the boot
    seed intentionally never overrides admin-edited flags.

- **HR — Recruitment workflow redesign (one coherent flow).** The Recruitment module now runs as a
  single end-to-end pipeline, backend + web:
  - **Evaluation phases (Security / Medical / Driving, extensible).** A post-interview, file-based
    approval stage. An **administrator-configurable** phase catalog (`hr_evaluation_phases`, seeded
    with **Security Check / Medical Examination / Driving Test**, the last flagged drivers-only) runs
    **sequentially** after the interview rounds — phases are added, disabled, or reordered with **no
    code changes**, exactly like interview stages. Per applicant × phase an **evaluation**
    (`hr_evaluations`) collects **one or more files** (platform Files service) and an
    **approved / rejected** decision with a reason. New endpoints under `/hr/evaluations`
    (+ `/hr/evaluation-phases`), gated by `evaluation.view` / `evaluation.manage` /
    `evaluationPhase.manage`; every mutation audited and `hr.evaluation.decided` published. A new web
    **Evaluations** module (queue + detail: open, upload files, decide) is wired into the navigation.
  - **Job Offer is hard-gated** until the applicant has cleared **all required interviews _and_ all
    required evaluation phases** (driver-only phases gate only when opened).
  - **Rejection is not final (fully audited).** HR can **edit the decision** of any stage — Screening
    (`PATCH /hr/screenings/:id/decision`), Interviews (`PATCH /hr/interviews/:id/decision`), and
    Evaluations — and a corrected rejection **reactivates the applicant** into the pipeline at the
    right stage (`applicantService.reactivateFromRejection`). Edit-decision actions added to the web
    Screening, Interview, and Evaluation screens.
  - **Job Offers: Direct Manager and Salary are optional.** `managerId` / `salary` are nullable and
    handled as NULL through the offer → employee → hiring-documents → employee-file chain; the web
    offer form and read-out treat them as optional.
  - **Employee Files hold independent COPIES of the hiring documents** (new `fileService.copy`) plus
    **custom uploads**; editing/removing a copy never touches the original. Surfaced on the web
    Employee File detail, gated by the new `employeeFile.upload` permission.
  - **Hiring-documents checklist** seeded to the approved **7-document** set (Employment Contract,
    Employment Acceptance Acknowledgment, Social Status Form, Relatives Declaration, Job Description,
    National Bank / Banque Misr Letter, Company ID Card).
- **Organization — reference-options endpoint.** `GET /platform/<unit>/options` returns minimal
  `{id, code, name}` for active units, authorized for any authenticated user and **decoupled from the
  unit's `view` permission** — so the **Branch dropdown on the Department / Section forms** is always
  populated (bug fix).
- **HR — Employees: employment lifecycle.** The post-hire workforce capability. An employee can now
  be moved through their lifecycle — **go on leave, return, suspend, reinstate, terminate** — via
  `PATCH /hr/employees/:id/status`, gated by the new **`employee.changeStatus`** permission and
  enforced against a single shared transition matrix (`terminated` is terminal; same-status and
  illegal jumps are refused). Suspend/terminate require a reason. Every change is appended to an
  auditable **status trail** (`statusHistory`, surfaced on the Employee DTO — the hire is recorded as
  its first entry), written under optimistic-concurrency control, audited, and published as
  `hr.employee.statusChanged`. Backend-first; UI is a later slice.
- **HR Foundation — Phase 2: Platform Identity & Organizational Access Control** (ADR-017). Permanent
  platform infrastructure every future module reuses:
  - **Hierarchical data scope.** The visibility ladder extends from `own | branch | organization` to
    **`own(Self) ⊂ section ⊂ department ⊂ branch ⊂ organization(Company)`**, enforced in the single
    existing place (`BaseRepository.scopeFilter`). Collections opt into finer scopes by declaring
    `departmentField`/`sectionField`; Users and Employees now scope by the full hierarchy. Role
    assignments, `AuthContext` and `ScopeSelector` carry department/section. Fully backward
    compatible — existing grants keep working; **no permission changes**.
  - **Login account ← Employee.** Every login belongs to exactly one Employee (`User.employeeId`,
    unique; `Employee.userId` back-reference). Create a login from the employee
    (`POST /hr/employees/:id/login`); the **username defaults to the Employee Code** and is editable;
    login now accepts **username OR email** (email retained). Departing employees are disabled, not
    deleted.
  - **Permanent Global Employee Number + branch-derived Employee Code.** The **Global Employee
    Number** (e.g. `000125`) is the permanent identity — a single **global**, concurrency-safe atomic
    sequence (reusing the existing `hr_sequences` `$inc` primitive), never reused, never changed. The
    displayed **Employee Code** is derived as **`<CurrentBranchCode><GlobalEmployeeNumber>`**
    (e.g. `001000125`); on a branch transfer only the prefix changes (`004000125`) while the number
    stays fixed. Never manually editable.
  - **Branch Code** stays required/unique/immutable, now correctable by a **super-admin**
    (`PATCH /platform/branches/:id/code`).
  - **Minimal UI** on the Employee detail (`EmployeeAccountCard`): shows Employee Code + Branch Code,
    creates the login, edits the username, shows the account's data scopes.
  - **Future-proof:** employment carries optional `sectionId` + `jobPositionId` (null until set), so
    an employee can later belong to Branch → Department → Section → Job Position with no schema change
    — without ever forcing a vacancy link (ADR-016 Talent Pool preserved).
- **Organization Management UI — Phase 3.1: Branches Management.** A dedicated Branches admin that
  completes the branch surface on top of the existing `platform/organization` backend:
  - **Branches list.** Columns per spec — **Branch Code, Arabic Name, English Name, Status, Created
    At, Updated At** — with free-text **search** (code or name), a **status** filter, **pagination**
    and sortable code/status/created columns, all URL-synchronized. Each row carries an inline
    **Activate/Deactivate** toggle (version-checked, gated on `branch.edit`).
  - **Branch detail.** Identity (Code, ar/en names, manager), address and audit timestamps, with
    **Edit**, **Activate/Deactivate** and **Delete** (soft, guarded against branches that still have
    departments). The **Branch Code** stays immutable after creation and is editable **only by a
    super-admin** through a dedicated correction dialog (`isPrivileged`, `PATCH
/platform/branches/:id/code`, ADR-017).
  - **Duplicate protection.** Branch **names** join branch **codes** as unique (case-insensitive, ar
    or en); a collision surfaces as a `409` conflict. `GET /platform/auth/me` now returns
    `isPrivileged` so the web can gate the super-admin-only Branch-Code action. No new backend
    endpoints, permissions or events; audit fields and soft-delete are unchanged.
- **Organization Management UI — Phase 3.2: Departments Management.** A dedicated Departments admin
  on the same `platform/organization` backend. Each department belongs to exactly one branch and is a
  **platform-wide** unit (not HR-only):
  - **Departments list.** Columns per spec — **Branch, Arabic Name, English Name, Status, Created At,
    Updated At** — with a **branch** filter (server-side `?branchId=`), free-text **search**, a
    **status** filter, **pagination** and sortable status/created columns, all URL-synchronized. Each
    row carries an inline **Activate/Deactivate** toggle (version-checked, gated on `department.edit`).
  - **Department detail + form.** Identity (Code, ar/en names, **Description**, manager), the owning
    Branch (linked), path and audit timestamps, with **Edit**, **Activate/Deactivate** and **Delete**
    (soft, guarded against departments that still have sections). The create/edit form gains an
    optional bilingual **Description** field.
  - **New `description` field.** Departments gain an optional bilingual `description` (contracts +
    model + DTO). The generic org-unit **update** now persists per-unit columns via a `buildUpdateSet`
    seam — which also **fixes branch `address`** being editable only at creation. No new endpoints,
    permissions or events; audit fields and soft-delete unchanged.

### Documented

- **ADR-017** — Platform Identity & Organizational Access Control.
- **`docs/02-architecture/platform-identity.md`** — the Phase-2 design.
- **`docs/02-architecture/organization-structure.md` §6** — _Organization vs Navigation: two
  independent hierarchies._ Records that the Company → Branch → Department → Section (→ Job Position/
  Employee) hierarchy governs **data scope, HR, reporting and approvals only** and **does NOT
  generate the sidebar**; that Departments are a **platform-wide** concept (never HR-only); and that
  the **Sidebar is generated from the Applications (Modules) assigned to the user** — a separate,
  deferred track keyed off _Applications × Roles_, with the org tree supplying data scope only. The
  Organization module stays free of any navigation logic (verified in the current code).
- **`docs/02-architecture/organization-structure.md` §7** — _Access & Applications model (locked; not
  implemented)._ Locks three forward rules so Organization Management does not foreclose them:
  **Applications ↔ Departments is many-to-many** (Departments consume Applications; an Application
  serves many Departments); a user's Applications are **derived** via **User → Job Position →
  Department → Applications → Roles** (with an optional direct user assignment kept possible as an
  exception); and **Job Positions are Department-owned, never Section-owned** (Sections are
  subdivisions; an Employee belongs to a Section but holds a Department's Job Position). Confirms the
  current models already leave room for all three — no code change.

## [0.23.0] - 2026-07-21

Release v0.23.0 — Sprint 5.11: **HR Foundation — Phase 1: Organization Structure**
([PR #54](https://github.com/egycashcompany-ops/egycash/pull/54)). Delivers the master
organizational model every future module reuses — **Company, Branches, Departments, Sections and the
Job Titles catalog** — built on the existing `platform/organization` backend (ADR-015). **Phase 1 is
complete and released.** Job Positions and Job Requisitions are **intentionally deferred** to later
phases; Job Titles remain an **organization-wide catalog**; and per **ADR-016** (now the governing
decision) applicants are **never required** to be linked to a Job Position or Job Requisition — the
**Talent Pool is first-class**.

### Added

- **HR Foundation — Phase 1: Organization Structure.** The master organizational model that every
  future module reuses, built on the existing `platform/organization` backend (ADR-015):
  - **Organization admin (web).** A new lazy module at `/organization` to manage the **Company**
    profile and the **Branch → Department → Section** hierarchy plus the org-wide **Job Titles**
    catalog — list/detail/create/edit/delete, all RBAC-gated, version-checked, with URL-synced
    filters, i18n + RTL. Branch/Department/Section share **one generic Unit\* implementation**
    configured per unit (mirroring the backend `makeOrgUnitHandlers` factory). No new backend
    endpoints, permissions or events were introduced.
  - **Enriched Job Titles.** Job Titles gain `jobGrade` (required), `description`, `salaryMin`,
    `salaryMax`, `requiredQualifications` and `requiredExperienceYears` (all optional). The salary
    band must satisfy `min ≤ max`, enforced by the schema and by a merged-state check on partial
    updates. Job Titles remain an **organization-wide catalog** — not tied to any Branch/Department/
    Section (that linkage is the future Job Positions' concern).

### Documented

- **ADR-016** — Job Positions & Job Requisitions are **OPTIONAL** for applicants; the **Talent Pool**
  is a first-class state that no future module may break.
- **`docs/02-architecture/organization-structure.md`** — the Phase-1 design and the phase roadmap
  (Organization Structure → Job Positions → Job Requisitions → Recruitment integration).

## [0.22.0] - 2026-07-21

Release v0.22.0 — Sprint 5.10: **HR / Recruitment — Pipeline flow & applicant lifecycle**
([PR #51](https://github.com/egycashcompany-ops/egycash/pull/51) +
[PR #52](https://github.com/egycashcompany-ops/egycash/pull/52)). Makes the finished seven-stage
module behave as a continuous pipeline **without changing the existing workflow, permissions or
create/decide flows** — visibility is derived from the applicant's current state, never from
placeholder records.

### Added

- **Auto-appearing stage queues (derived read models).** Applicants surface in the next stage
  automatically, computed server-side rather than via fabricated records:
  - **Awaiting screening** (`GET /hr/screenings/awaiting`) — live applicants (`new`) with no
    screening yet; a panel on the Screening queue opens the existing Start-screening dialog.
  - **Awaiting scheduling** (`GET /hr/interviews/awaiting`) — applicants who passed Initial
    Screening, still live, with no interview yet (active + accepted screening − already-interviewed,
    so withdrawn/rejected never appear); a panel on the Interviews queue opens the existing Schedule
    dialog. Both are read-only endpoints; no writes, no duplicate records.
- **Withdraw / restore from any stage.** A shared `ApplicantLifecycleActions` control (Withdraw
  while `new`, Restore while `withdrawn`) on the applicant detail **and** every pre-hire stage detail
  page (Screening, Interviews, Job Offer). Withdraw/restore invalidate the awaiting subtrees so the
  derived queues refresh immediately. (Intentionally not exposed on the post-hire stages — Employees,
  Hiring Documents, Electronic Employee File — the person is already an employee there.)
- **Applicant restore** (`POST /hr/applicants/:id/restore`, `applicant.edit`, version-checked → status
  `new`, emits `hr.applicant.restored`). Restored applicants **resume from the exact stage they left**
  (derived visibility), and **all history is preserved** — screening decisions, interviews, offers,
  audit and timeline records are never deleted or recreated.

### Changed

- **Optional interview committee** — `ScheduleInterview.interviewerIds` now defaults to `[]`; an
  interview can be scheduled before a committee is assigned, with members added later via the
  reassign-panel action. Validation, version checks and cache behaviour unchanged.

### Notes

- **No new runtime dependencies.** Backend additions are two read-only "awaiting" endpoints and the
  restore endpoint/event; no existing API, permission, versioning or event was changed. Verified via
  web typecheck, repo lint, vite build (recruitment stays a lazy chunk), permission-matrix +
  flag-expiry checks, and backend unit + integration specs (auto-appear queues incl. exclusions,
  empty-committee schedule, restore lifecycle, and exact-stage resume). No web unit-test runner yet
  (backlog: Vitest + React Testing Library).

## [0.21.0] - 2026-07-21

Release v0.21.0 — Sprint 5.9: **HR / Recruitment — Applicants intake improvements + reusable
National-ID OCR** ([PR #49](https://github.com/egycashcompany-ops/egycash/pull/49)). The first
**polish** sprint on the completed Recruitment module — no new stage, an enhancement to the
existing Applicants intake.

### Added

- **Reusable National-ID OCR flow (`apps/web/src/shared/national-id/`).** A module-agnostic
  capture → review flow, reusable by Employees / KYC / any future module by injecting an
  _extractor_ (no HR coupling): `NationalIdOcr` (two upload areas — **front + back** — read
  together in one extraction pass), a **dedicated `NationalIdReviewDialog`** showing **every**
  extracted field editable (birth date / gender / governorate derived live from the number and
  read-only), plus pure `mapping` + `transliterate` helpers and typed `NationalIdReviewData` /
  `NationalIdExtractor`. Generic `nationalIdOcr.*` i18n (`ar` + `en`).
- **Applicant identity: `religion` + `nationalIdExpiry`** — new nullable fields read from the ID
  card (contract + model + service + mapper).

### Changed

- **Applicants create — direct intake.** The Job Request is now **optional**: an applicant can be
  registered directly from the Applicants screen with no linked requisition. `jobRequisitionId` is
  **nullable end-to-end** (applicant → employee → employee-file all tolerate `null`); when a
  requisition is supplied it is still validated (malformed ids rejected), and the reference can be
  attached later when the Job Requests module lands.
- **National-ID capture flow.** Upload front → upload back → **Extract** → the dedicated review
  dialog → edit → **Confirm** → _only then_ the Applicant form is populated. Birth date / gender /
  governorate are **derived** from the number (`parseNationalId`), never OCR'd; the English name is
  seeded by transliterating the Arabic name (editable). Replaces the single-image OCR assist.

### Notes

- No new runtime dependencies and **no new backend endpoint** — the OCR extraction DTO was widened
  with the card fields and the applicant identity gained two fields. Verified via web typecheck,
  repo lint, and vite build (recruitment stays a lazy chunk); backend unit + integration specs
  extended (direct intake with no requisition; OCR extraction shape; null-requisition mappers). No
  web unit-test runner yet (backlog: Vitest + React Testing Library).

## [0.20.0] - 2026-07-13

Release v0.20.0 — Sprint 5.8: **HR / Recruitment — Electronic Employee File Frontend (Phase 8)**
([PR #47](https://github.com/egycashcompany-ops/egycash/pull/47)), the **seventh and final**
Recruitment feature screen set. **With this release all seven recruitment stages run in the UI on
the single Phase 1 foundation.**

### Added

- **HR / Recruitment: Electronic Employee File frontend (`apps/web`).**
  - **List** (`employeeFile.view`) — sortable `DataTable` (employee `code`, created — the backend's
    sortable fields); filters (a **free-text search** over employee number / applicant code +
    status); `Pagination`. Search, status, sort and pagination are **URL-synchronized**. An
    **Assemble file** action (`employeeFile.create`) opens a dialog to pick an employee whose hiring
    documents are complete (server-enforced; the employee search reuses the Employees list API).
  - **Detail** (`employeeFile.view`) — the **Employee Timeline** (shared `Timeline`) built from the
    recruitment milestones (`applicantRegistered` → … → `hiringDocumentsCompleted` → `fileOpened`)
    plus free-form notes, with an **add-note** form (`employeeFile.edit`, version-checked) appending
    to the timeline; and the **linked history** — deep-links into the applicant, screening,
    interview, job-offer and hiring-documents screens (the Job Requisition shows as a read-only
    reference). Each write seeds the detail cache + invalidates only the list subtree. `ar` + `en`
    i18n.
  - Removed the now-unused stage placeholder helper + `StagePlaceholder` (all seven stages are real
    screens).

### Changed

- **Recruitment frontend complete** — all seven stages (Applicants → Screening → Interviews → Job
  Offer → Employees → Hiring Documents → Electronic Employee File) run in the UI as one lazy route
  chunk. Post-hire employee-lifecycle concerns belong to the future Employee module.

### Notes

- No new runtime dependencies and **no new backend API**. Verified via web typecheck, repo lint, and
  vite build (recruitment stays a lazy chunk). No web unit-test runner yet (backlog: Vitest + React
  Testing Library) — the primary follow-up before declaring the module production-ready.

## [0.19.0] - 2026-07-13

Release v0.19.0 — Sprint 5.7: **HR / Recruitment — Hiring Documents Frontend (Phase 7)**
([PR #45](https://github.com/egycashcompany-ops/egycash/pull/45)), the sixth Recruitment feature
screen set on the Phase 1 foundation, reusing the shared file-management infrastructure
(`FileUpload`, the signed-URL download ticket, multipart `upload`). **Hiring Documents only** — the
Electronic Employee File remains the final phase.

### Added

- **HR / Recruitment: Hiring Documents frontend (`apps/web`).**
  - **List** (`hiringDocuments.view`) — sortable `DataTable` (employee `code`, created — the
    backend's sortable fields); filters (a **free-text search** over employee number / applicant
    code + status); `Pagination`. Search, status, sort and pagination are **URL-synchronized**. An
    **Open document set** action (`hiringDocuments.create`) opens a dialog to pick an employee
    (search reuses the Employees list API).
  - **Detail** (`hiringDocuments.view`) — a **per-type checklist** merging the active document-type
    catalog with the uploaded documents: each type shows uploaded/missing (required flagged), with
    **download** (signed-URL ticket, reused from Applicants attachments), **version history**,
    **replace**, and **upload** for missing types (`hiringDocuments.upload`, PDF-only via the shared
    `FileUpload` + multipart). **Complete** (`hiringDocuments.complete`) is blocked — with the
    missing-required banner — until every required document is present; once completed the set is
    read-only. All mutations version-checked; each write seeds the detail cache + invalidates only
    the list subtree. `ar` + `en` i18n.
  - The document-type catalog (`/hr/hiring-document-types`) is **consumed read-only** to label +
    require types; type administration is out of scope.

### Changed

- Recruitment now runs in the UI **through the Hiring Documents stage** (Applicants → Screening →
  Interviews → Job Offer → Employees → Hiring Documents); the Electronic Employee File is the final
  phase.

### Notes

- No new runtime dependencies and **no new backend API** — uploads/downloads reuse the existing
  Files service seams. Verified via web typecheck, repo lint, and vite build (recruitment stays a
  lazy chunk). No web unit-test runner yet (backlog: Vitest + React Testing Library).

## [0.18.0] - 2026-07-13

Release v0.18.0 — Sprint 5.6: **HR / Recruitment — Employees Frontend (Phase 6)**
([PR #43](https://github.com/egycashcompany-ops/egycash/pull/43)), the fifth Recruitment feature
screen set on the Phase 1 foundation, reusing the prior phases' building blocks (including the Job
Offer reference infrastructure). **Employees only** — no later stage.

### Added

- **HR / Recruitment: Employees frontend (`apps/web`).**
  - **List** (`employee.view`) — sortable `DataTable` (employee `code`, hired, created — the
    backend's sortable fields); `EmployeeFilters` (a **free-text search** over employee number /
    applicant code + status); `Pagination`. Search, status, sort and pagination are
    **URL-synchronized** (deep-linkable, back/forward). A **Hire employee** entry (`employee.create`).
  - **Hire / create** — the employment terms are **not** entered; they are copied server-side from
    the offer's immutable accepted snapshot. The page picks an **accepted offer** (an `OfferPicker`
    autocomplete reusing the Job Offer list API scoped to `status: accepted`) + an optional hiring
    date. The server enforces the full rule (accepted + snapshot + not already hired). The create
    write seeds the detail cache and invalidates only the list subtree.
  - **Detail** (`employee.view`) — the employee number, status, preserved references (applicant link
    - accepted-offer link with its revision), and the copied **employment terms** read-out. The
      employment view **reuses the Job Offer `UserName` + reference hooks** so org/manager names resolve
      from the same cache. `ar` + `en` i18n. The employee record is **read-only in this stage** — no
      lifecycle mutation is exposed (statuses exist in the DTO but transitions belong to a future
      Employee module).

### Changed

- Recruitment now runs in the UI **through the Employee stage** (Applicants → Screening → Interviews
  → Job Offer → Employees); Hiring Documents and Employee Files remain later phases.

### Notes

- No new runtime dependencies and **no new backend API**. Verified via web typecheck, repo lint, and
  vite build (recruitment stays a lazy chunk). No web unit-test runner yet (backlog: Vitest + React
  Testing Library).

## [0.17.0] - 2026-07-13

Release v0.17.0 — Sprint 5.5: **HR / Recruitment — Job Offer Frontend (Phase 5)**
([PR #41](https://github.com/egycashcompany-ops/egycash/pull/41)), the fourth Recruitment feature
screen set on the Phase 1 foundation, reusing the Applicants/Screening/Interviews building blocks.
**Job Offer only** — no later stage.

### Added

- **HR / Recruitment: Job Offer frontend (`apps/web`).**
  - **List** (`jobOffer.view`) — sortable `DataTable` (status, created — the backend's sortable
    fields); `OfferFilters` (a **free-text search** over offer number / applicant code + status + an
    active-only toggle); `Pagination`. Search, status, active, sort and pagination are
    **URL-synchronized** (deep-linkable, back/forward). A **New offer** entry (`jobOffer.create`).
  - **Create / revise** — the shared `OfferTermsForm` builds the versioned package (job title,
    department, branch, reporting manager, employment type, salary + currency, dynamic
    allowances/benefits, probation, start/validity dates, notes). Create picks an applicant first;
    revise edits a draft/sent offer's terms (`jobOffer.edit`, version-checked, history preserved).
    Client checks cover the required fields + `validUntil > startDate`; the server stays authoritative.
  - **Detail** (`jobOffer.view`) — the offer number, applicant link, status, the live package, the
    immutable **accepted-terms snapshot** and the **revision history**, plus the lifecycle actions:
    **send** (`jobOffer.send`), **accept / reject** (`jobOffer.respond`, reason required to reject),
    **withdraw** (`jobOffer.withdraw`), **revise** (`jobOffer.edit`) — each shown only in the states
    where it applies (draft·sent). All mutations version-checked; each write seeds the detail cache
    and invalidates only the list subtree; `STALE_DOCUMENT` surfaces via the standard global toast.
  - **References** reuse existing platform endpoints (**no new backend API**): the reporting manager
    via a `ManagerPicker` over `/platform/users` (`user.view`); job title / department / branch via
    the org list endpoints (`jobTitle.view` / `department.view` / `branch.view`). Raw ids are never
    entered; controls degrade to a hint without the relevant `*.view`. `ar` + `en` i18n.

### Changed

- Recruitment now runs in the UI **through the Job Offer stage** (Applicants → Screening →
  Interviews → Job Offer); Employees onward remain later phases.

### Notes

- No new runtime dependencies. Verified via web typecheck, repo lint, and vite build (recruitment
  stays a lazy chunk). Automatic offer expiry remains a backend scheduled sweep — the UI reflects the
  resulting `expired` status but does not drive it. No web unit-test runner yet (backlog: Vitest +
  React Testing Library).

## [0.16.0] - 2026-07-13

Release v0.16.0 — Sprint 5.4: **HR / Recruitment — Interviews Frontend (Phase 4)**
([PR #37](https://github.com/egycashcompany-ops/egycash/pull/37)), the third Recruitment feature
screen set on the Phase 1 foundation, reusing the Applicants/Screening building blocks — plus two
authentication **dev-login fixes** surfaced during review
([PR #38](https://github.com/egycashcompany-ops/egycash/pull/38),
[PR #39](https://github.com/egycashcompany-ops/egycash/pull/39)). **Interviews only** — no later
stage.

### Added

- **HR / Recruitment: Interviews frontend (`apps/web`).**
  - **Queue** (`interview.view`) — sortable `DataTable` (stage order, scheduled, created — the
    backend's sortable fields); filters (status + outcome + stage + an **applicant search-picker**
    resolving to `applicantId` + a scheduled-date range); pagination. Filters/sort/pagination are
    **URL-synchronized** (deep-linkable, back/forward). A **Schedule interview** action
    (`interview.create`) opens a dialog to pick applicant, stage, date/time, and panel.
  - **Detail** (`interview.view`) — the **panel with per-interviewer evaluation state**
    (recommend/neutral/notRecommend + rating + notes), the scheduling read-out, and the full action
    surface: **reschedule** + **reassign panel** (`interview.edit`), **skip** a pending interviewer,
    **submit/update your own evaluation** (`interview.evaluate`, assigned members only), **cancel**
    (`interview.cancel`), and **Pass / Fail** (`interview.decide`) — blocked with an inline notice
    while any panelist is still `pending`. All mutations version-checked; each write seeds the
    detail cache from the response and invalidates only the list subtree.
  - Interviewer references go through a **`UserPicker` / `UserName`** pair that reuses the platform
    Users endpoint (`user.view`) rather than exposing raw ids; degrades to a short reference without
    directory access. Feature `api/` layer + TanStack Query hooks against `/hr/interviews`
    (+ `/hr/interview-stages`, `/:id/reschedule|panel|panel/skip|cancel|evaluations|decide`);
    `ar` + `en` i18n. No new backend API.
- **Auth: scannable QR for TOTP enrollment**
  ([PR #38](https://github.com/egycashcompany-ops/egycash/pull/38)) — the mid-login 2FA enrollment
  step renders the backend-provided `otpauthUrl` as a QR code (Microsoft Authenticator / Google
  Authenticator / any TOTP app), with the manual base32 key kept as a collapsible fallback. Adds
  `qrcode.react` (inline SVG, no network request). Standard TOTP (RFC 6238); no backend change.

### Fixed

- **Dev login blocked by TOTP enforcement**
  ([PR #39](https://github.com/egycashcompany-ops/egycash/pull/39)) — every seeded account holds a
  system role (privileged), and `auth.totp.enforcedForPrivileged` defaults to `true`, so a fresh
  `npm run seed` produced accounts that could not complete an email/password login (login returned a
  TOTP enrollment challenge, not a session). The seed now disables enforcement at **organization**
  scope (dev/staging only; production keeps the default `true` and never runs the seed). The seed
  data moved to an importable, side-effect-free `seed-data.ts`, and an **integration regression
  test** exercises the real seed path and asserts a password-only login yields a token + working
  `/me` — failing if the enforcement-disable is ever removed.

### Changed

- Recruitment now runs in the UI **through the Interview stage** (Applicants → Screening →
  Interviews); Job Offer onward remain later phases.

### Notes

- One new web runtime dependency (`qrcode.react`). Verified via web typecheck, repo lint, and vite
  build (recruitment stays a lazy chunk), plus API typecheck/lint/build; the seed-login regression
  runs on CI's in-memory Mongo. No web unit-test runner yet (backlog: Vitest + React Testing
  Library).

## [0.15.0] - 2026-07-12

Release v0.15.0 — Sprint 5.3: **HR / Recruitment — Initial Screening Frontend (Phase 3)**
([PR #35](https://github.com/egycashcompany-ops/egycash/pull/35)), the second Recruitment feature
screen set, built on the Phase 1 foundation and reusing the Applicants building blocks.
**Screening only** — no later stage.

### Added

- **HR / Recruitment: Initial Screening frontend (`apps/web`).**
  - **Queue** (`screening.view`) — sortable `DataTable` (status, notes, decided, created); filters
    (status + created-date range + an **applicant search-picker** that reuses the Applicants list
    API and resolves to the `applicantId` filter — the screening list has no free-text field);
    pagination. Filters/sort/pagination are **URL-synchronized** (deep-linkable, back/forward). A
    **Start screening** action (`screening.create`) opens a dialog to pick a live applicant + an
    optional first note.
  - **Detail** (`screening.view`) — applicant link, the **notes + decision timeline** (shared
    `Timeline`), an **add-note** form while `pending` (`screening.edit`), and the **Accept / Reject**
    workflow (`screening.decide`) via a dialog — a reason is required to reject (OQ-32), optional to
    accept. All mutations version-checked.
  - Feature `api/` layer + TanStack Query hooks against `/hr/screenings` (+ `/:id/notes`,
    `/:id/decide`); `ar` + `en` i18n; permission-gated throughout.

### Notes

- No new runtime dependencies. Verified via web typecheck, repo lint, and vite build (recruitment
  stays a lazy chunk). No web unit-test runner yet (backlog: Vitest + React Testing Library).

## [0.14.0] - 2026-07-12

Release v0.14.0 — Sprint 5.2: **HR / Recruitment — Applicants Frontend (Phase 2)**
([PR #33](https://github.com/egycashcompany-ops/egycash/pull/33)), the first Recruitment feature
screen set, built on the Phase 1 foundation. **Applicants only** — no later stage. Approved with
no blocking comments after two review changes (URL-synced list state; placeholder reference
controls for cross-module IDs) folded in before merge.

### Added

- **HR / Recruitment: Applicants frontend (`apps/web`).**
  - **List** — sortable/selectable `DataTable`; multi-filter bar (search + status / source /
    intake channel / identity-verification / duplicates-only / has-files); `Pagination`;
    **bulk withdraw** (reason dialog); **CSV export**; create entry point — all permission-gated.
    Filters, search, sort and pagination are **synchronized with the URL query string**
    (deep-linkable, back/forward aware).
  - **Detail** — identity/contact/preferences/application read-out; **attachments** panel
    (upload with title+category, signed-URL download, remove); **verify-identity** and
    **withdraw** actions (version-checked).
  - **Create / edit** — comprehensive manual-entry form (context, identity, contact, addresses,
    preferences, education, military, experience, references, licenses, certifications) on the
    shared form primitives; server-authoritative validation surfaced in a summary;
    optimistic-concurrency-guarded edits.
  - **OCR assist** — upload a National-ID image → extraction seam → apply fields with confidence
    bands; degrades to manual entry when no provider is wired (OQ-30).
  - **Cross-module references** (Job Requisition, Branch) use placeholder reference controls
    (disabled "coming soon" selector, or a read-only chip when supplied by context via
    `?requisitionId=&branchId=`) — internal IDs are never editable fields.
  - Feature `api/` layer + TanStack Query hooks against the existing endpoints; `ar` + `en` i18n.
    Added `getPage` (pagination meta) and `downloadBlob` (CSV export) to the shared api-client.

### Notes

- No new runtime dependencies. Verified via web typecheck, repo lint, and vite build (recruitment
  stays a lazy chunk). No web unit-test runner yet (backlog: Vitest + React Testing Library).

## [0.13.0] - 2026-07-12

Release v0.13.0 — Sprint 5.1: **HR / Recruitment — Frontend Foundation (Phase 1)**
([PR #31](https://github.com/egycashcompany-ops/egycash/pull/31)). The reusable web foundation for
the Recruitment module — shell, shared UI kit, and platform integration — built foundation-first;
**no feature screen (Applicants included) is built here.** Approved with two backlog notes (add
Vitest + React Testing Library before the feature screens grow; revisit shadcn/ui later — the
current abstraction layer is acceptable).

### Added

- **HR / Recruitment: frontend foundation (`apps/web`).**
  - **App shell & layout** — generic `AppShell` (sidebar + topbar), RTL-safe and responsive
    (persistent rail on desktop, off-canvas drawer on mobile), breadcrumbs, page container/header.
  - **Theme** — light/dark/system (Tailwind class strategy, OS-reactive, persisted); brand token
    scale; **Arabic RTL** default with logical utilities throughout.
  - **Navigation & permission-aware routing** — `RequireAuth` + `RequirePermission` route guards,
    `Can`/`useCan` role-based UI, 403/404 pages, and the recruitment module **lazy-loaded**
    (route-based code splitting).
  - **Shared UI kit** (`shared/ui`, imported via barrel) — DataTable (sort/selection/state-aware),
    Pagination, SearchInput (debounced), FilterBar, BulkActions, Button, Field/Input/Textarea/
    Select/Checkbox/Form, Dialog, FileUpload, Badge/StatusBadge, Timeline, Card, Spinner/Skeleton,
    and Loading/Empty/Error/Success states.
  - **API layer & data** — typed REST + multipart client (in-memory token per ADR-006, silent
    refresh, envelope unwrap), error-code → localized message mapping, query-key factory, and
    **TanStack Query with global error handling**; client toast store + `Toaster`;
    `NotificationBell`; top-level `ErrorBoundary`.
  - **Recruitment module shell** — nav, permission-aware landing overview, and per-stage
    permission-gated placeholder routes for all seven stages (each real screen drops in by
    replacing one element).
  - **i18n** — `ar` + `en` catalog with `{{param}}` interpolation. Docs:
    [recruitment-frontend.md](docs/02-architecture/recruitment-frontend.md).

### Notes

- No new runtime dependencies; the existing React + Vite + RTK + TanStack Query + Tailwind stack
  was extended in place. Verified via web typecheck, repo lint, and vite production build (the
  recruitment module emits as a separate lazy chunk). No web unit-test runner yet (backlog:
  Vitest + React Testing Library).

## [0.12.0] - 2026-07-12

Release v0.12.0 — Sprint 4.7: **HR / Recruitment — Electronic Employee File (Stage 7)**
([PR #29](https://github.com/egycashcompany-ops/egycash/pull/29)), the **seventh and final stage**
of the approved seven-stage recruitment workflow and the handoff artifact to the (future) Employee
module ([BD-008](docs/01-domain/business-decisions.md#bd-008--hiring-transforms-applicant-to-employee-no-separate-onboarding-stage)).
Additive on Stage 6; **no part of the Employee module is built.** Merged after a self-conducted
architecture review ([review](docs/10-reviews/2026-07-architecture-review-employee-file.md); 18
findings, no Critical/High — all documented, no in-PR code change required).

### Added

- **HR / Recruitment: Electronic Employee File (Stage 7).** Once an employee's hiring documents
  are **completed**, their electronic file is **assembled once**.
  - **Electronic Employee File aggregate** (`hr_employee_files`) — **one file per employee**
    (partial-unique index), gated on the employee existing **and** its hiring documents being
    `completed`. **Links all applicant history** (applicant, job requisition, screening,
    interviews, job offer, hiring documents) and builds the **initial Employee Timeline** from the
    recruitment milestones (applicant registered → screening accepted → each interview passed →
    offer accepted → employee created → hiring documents completed → file opened), ordered
    chronologically.
  - **Timeline notes** — free-form notes can be appended to the timeline (optimistic-concurrency
    guarded). Status `active` / `archived`.
  - Publishes `hr.employeeFile.{created,noteAdded}`, **notifies** the reporting manager + the
    assembler on assembly, and **audits** every operation. Permissions
    `employeeFile.{view,create,edit}`; routes `/api/v1/hr/employee-files` (+ `/:id`, `/:id/notes`).
  - Cross-feature history is read through feature barrels only (ADR-003); new read hooks
    `interviewService.listByApplicant` and `hiringDocumentsService.findByEmployeeId`.
- **BD-008 — Hiring transforms Applicant to Employee; no separate Onboarding stage.** Recorded in
  the [Business Decisions log](docs/01-domain/business-decisions.md#bd-008--hiring-transforms-applicant-to-employee-no-separate-onboarding-stage):
  the recruitment workflow stands at **seven stages** (no eighth "Onboarding" stage), and the
  post-hire employee lifecycle belongs to the future Employee module. Added the _Electronic
  Employee File_ entry to the [Ubiquitous Language](docs/01-domain/ubiquitous-language.md).

### Notes

- The seven-stage recruitment workflow (Applicant → Screening → Interview → Offer → Employee
  Creation → Hiring Documents → Electronic Employee File) is now **complete**. The post-hire
  employee lifecycle (documents, assets, contracts, attendance, payroll, leave) is the future
  Employee module's remit (BD-008) and is not started.

## [0.11.0] - 2026-07-12

Release v0.11.0 — Sprint 4.6: **HR / Recruitment — Hiring Documents (Stage 6)**
([PR #27](https://github.com/egycashcompany-ops/egycash/pull/27)), the sixth stage of the
approved seven-stage recruitment workflow. Additive on Stage 5; **no part of Stage 7
(Electronic File) or later is built.** Merged after a self-conducted architecture review
([review](docs/10-reviews/2026-07-architecture-review-hiring-documents.md); no Critical/High
findings — one small mitigation applied in-PR, the rest logged for later sprints).

### Added

- **HR / Recruitment: Hiring Documents (Stage 6).** After an employee is created, their hiring
  documents are collected.
  - **Administrator-defined document types** (`hr_hiring_document_types`) — required and
    optional; a default set is seeded, admin-managed under `hiringDocumentType.manage`.
  - **Hiring Documents aggregate** (`hr_hiring_documents`) — **one set per employee**. Each
    document is an uploaded **PDF** backed by the platform Files service: the **original is
    preserved** and **replacement creates a new version while keeping prior versions
    retrievable**. Stores document metadata (type, name, uploader, upload date, version).
  - **Required-completion validation** — completion is blocked while any active required type is
    missing (`missingRequired` is surfaced on the DTO). Once **completed**, the set is
    **immutable except through the versioning (replace) workflow**; documents are never
    overwritten or deleted.
  - PDF-only enforced by a dedicated Files category. Publishes
    `hr.hiringDocuments.{created,documentUploaded,documentReplaced,completed}`, **notifies** the
    reporting manager + creator on completion, and **audits** every operation. Permissions
    `hiringDocuments.{view,create,upload,complete}` + `hiringDocumentType.manage`; routes
    `/api/v1/hr/hiring-documents` and `/hr/hiring-document-types`.

### Fixed

- **Hiring-document upload/replace could orphan a file version on a lost optimistic-concurrency
  race** (review finding HD-01): the service now rejects a stale `version` before writing bytes
  to the Files service, so only an up-to-date request performs the upload (the atomic version
  check in the repository still guards the commit).

## [0.10.0] - 2026-07-12

Release v0.10.0 — Sprint 4.5: **HR / Recruitment — Employee Creation (Stage 5)**
([PR #25](https://github.com/egycashcompany-ops/egycash/pull/25)), the fifth stage of the
approved seven-stage recruitment workflow. Additive on Stage 4; **no part of Stage 6 (Hiring
Documents) or later is built.**

### Added

- **HR / Recruitment: Employee Creation (Stage 5).** A `hr_employees` aggregate: an applicant
  whose Job Offer was **Accepted** becomes an Employee.
  - **Accepted-offer gate** — creation is allowed only from an offer whose status is
    `accepted`; the employment terms are read **exclusively from the offer's immutable
    Accepted Snapshot** (never the live, mutable offer).
  - **Unique employee number** `EMP-{YYYY}-{seq:6}` (organization-wide, atomic per-year counter
    in the shared `hr_sequences` collection + unique index).
  - **Atomic creation** — the number allocation and the record insert run in one transaction
    (`unitOfWork`); a **unique index on `jobOfferId`** prevents a duplicate employee from the
    same offer even under concurrency (with a fast-path service check).
  - **Preserved references** to the Applicant, the Job Requisition (carried by the applicant),
    and the Accepted Job Offer; **copies the approved employment terms** (job title,
    department, branch, manager, employment type, salary, allowances, benefits, probation,
    start date) plus the accepted offer revision number; sets the initial status **`active`**
    and records the **hiring date** (defaults to now).
  - **Publishes** `hr.employee.created`, **notifies** the reporting manager + the creator, and
    **audits** every operation. Permissions `employee.{view,create}`; route
    `/api/v1/hr/employees`; the employee number is searchable in the list endpoint.

## [0.9.0] - 2026-07-12

Release v0.9.0 — Sprint 4.4: **HR / Recruitment — Job Offer (Stage 4)**
([PR #23](https://github.com/egycashcompany-ops/egycash/pull/23)), the fourth stage of the
approved seven-stage recruitment workflow. Additive on Stage 3; **no part of Stage 5
(Employee Creation) or later is built.**

### Added

- **HR / Recruitment: Job Offer (Stage 4).** A `hr_job_offers` aggregate: an applicant who
  cleared every interview round receives a versioned compensation offer.
  - **Lifecycle** `draft → sent → accepted / rejected / expired / withdrawn`. The offer
    carries a full package — salary (`Money`), allowances, benefits, job title, department,
    branch, reporting manager, employment type, probation period, start date, offer validity,
    and notes. **Version history**: every revise snapshots the prior package into `revisions`.
  - **Immutable, human-readable offer number** `JO-{YYYY}-{seq:6}` (organization-wide, atomic
    per-year counter in the shared `hr_sequences` collection + unique index) — HR references
    offers by this number, not the ObjectId; the list endpoint is searchable over it.
  - **Immutable accepted-revision snapshot**: acceptance freezes the exact terms and their
    revision number into `acceptedSnapshot`, never mutated afterward — the record Employee
    Creation (Stage 5) will consume, decoupled from the live offer.
  - **Guards**: creation requires all interview stages cleared; **at most one active
    (draft/sent) offer per applicant** (partial unique index + service check); an applicant
    who already accepted an offer cannot be issued another; sending requires a future
    validity; a lapsed sent offer cannot be accepted. The **accepted-offer gate**
    (`acceptedOfferFor`) is exposed so Stage 5 can require the latest offer be Accepted.
  - **Automatic expiration**: a scheduled sweep (`hr.jobOffers.expire`, every 15 min) flips
    sent offers past their validity to `expired` (audited, emitted, notified).
  - **Notifications** for offer sent / accepted / rejected / expired (fire-and-forget, to the
    hiring manager + the offer's author); **full audit trail** on every transition.
  - Permissions `jobOffer.{view,create,edit,send,respond,withdraw}` (`send`/`respond`/
    `withdraw` each their own grant); route `/api/v1/hr/job-offers`; events
    `hr.jobOffer.{created,revised,sent,accepted,rejected,expired,withdrawn}`.
  - **Additive platform seam**: `ModuleManifest.scheduledTasks` — a module can now declare
    repeatable tasks (declared before the scheduler sync, validated to carry the module-id
    prefix), the analogue of the existing `seed`/`eventSubscriptions` seams.

## [0.8.0] - 2026-07-11

Release v0.8.0 — Sprint 4.3: **HR / Recruitment — Interviews (Stage 3)**
([PR #21](https://github.com/egycashcompany-ops/egycash/pull/21)), the third stage of the
approved seven-stage recruitment workflow. Additive on Stage 2; **no part of Stage 4 (Job
Offer) or later is built.**

### Added

- **HR / Recruitment: Interviews (Stage 3).** An applicant who passed Initial Screening
  advances through the interview rounds.
  - **Administrator-configurable interview stages** (`hr_interview_stages`, OQ-31): an
    ordered, localized, deactivatable catalog seeded with the two default rounds ("First
    Interview", "Second Interview") — number/names/order are admin-managed thereafter
    (`interviewStage.manage`).
  - **Interview aggregate** (`hr_interviews`): a scheduled round with a **panel** where each
    member carries an individual evaluation state — **`pending` / `submitted` / `skipped`**
    (the roster and per-interviewer evaluations are one unified structure). Lifecycle:
    **schedule** → **reschedule** (date/time only) · **reassign panel** (independent of the
    schedule — retained members keep their state, added members start pending and are
    notified, removed members drop off) · **cancel** · per-interviewer **evaluate** ·
    **decide**.
  - **Workflow gate & progression** (approved workflow): the earliest stage requires a passed
    screening, each later stage requires the previous stage passed, and one live interview per
    stage. A decision is **blocked until every panel member is `submitted` or `skipped`**
    (prevents premature decisions without deadlocking on a no-show). Passing the final
    configured stage clears the interview phase (the applicant is ready for a future Job
    Offer); failing any round transitions the applicant to the terminal `rejected` status.
  - **Notifications integration**: scheduling, rescheduling, and cancelling notify the panel
    through the platform Notifications service (fire-and-forget — never blocks the operation);
    the HR seed registers the three interview templates at boot.
  - Permissions `interview.{view,create,edit,cancel,evaluate,decide}` (`evaluate` and `decide`
    each their own grant) + `interviewStage.manage`; routes under `/api/v1/hr/interviews` and
    `/hr/interview-stages`; events `hr.interview.{scheduled,rescheduled,cancelled,evaluated,decided}`.
    The applicant terminal-rejection event (`hr.applicant.rejected`) was made source-agnostic
    (screening or interview). **Additive platform seam**: `notificationTemplateService` is now
    exposed on the `platform/notifications` barrel so a business module can register its own
    templates at boot (the same idempotent seam the platform's built-ins use).

## [0.7.0] - 2026-07-11

Release v0.7.0 — Sprint 4.2: **HR / Recruitment — Initial Screening (Stage 2)**
([PR #20](https://github.com/egycashcompany-ops/egycash/pull/20)), the second stage of the
approved seven-stage recruitment workflow. Additive on Stage 1; **no part of Stage 3 or later
is built in this release.**

### Added

- **HR / Recruitment: Initial Screening (Stage 2).** A `hr_screenings` aggregate, **one
  screening per applicant** (partial unique index), decided to a single terminal outcome —
  **Accepted or Rejected** (OQ-32, two outcomes only). "Needs more information" is **not a
  state**: it is a note appended to a screening that stays `pending`; screening notes and the
  mandatory rejection reason are stored. A **rejection** transitions the applicant to the
  terminal `rejected` status (which frees the live National-ID for a fresh application,
  exactly like a withdrawal); an **acceptance** leaves the applicant live for the interview
  stage. Permissions `screening.{view,create,edit,decide}` (`decide` — the terminal
  accept/reject — is a separate grant from `edit`, which only appends notes); route
  `/api/v1/hr/screenings`; events `hr.screening.{created,decided}`. Extends the applicant
  lifecycle with the terminal `rejected` status and the `hr.applicant.rejected` event.

## [0.6.0] - 2026-07-10

Release v0.6.0 — Sprint 4.1: **HR / Recruitment — Applicants (Stage 1)**, the platform's
first Layer 2 business module
([PR #18](https://github.com/egycashcompany-ops/egycash/pull/18); plan:
`docs/12-planning/sprint-4.1-plan.md` (frozen 2026-07-10); reference:
`docs/02-architecture/recruitment-applicants.md`; retrospective:
`docs/11-retrospectives/2026-07-sprint-4.1.md`). Planning went through business analysis
([PR #17](https://github.com/egycashcompany-ops/egycash/pull/17)) with the approved
baseline workflow and eight resolved decisions (OQ-7/8/9/10/29/30/31/32).

### Added

- **Sprint 4.1 implementation** — HR / Recruitment: **Applicants (Stage 1)**, the
  platform's **first Layer 2 business module** (reference:
  `docs/02-architecture/recruitment-applicants.md`; plan frozen 2026-07-10 with
  OQ-7/8/9/10/29/30/31/32 resolved). Backend-first (OQ-29): full contracts + APIs +
  services + persistence; the frontend is a later sprint. The `hr` module manifest
  registers under `/api/v1/hr` (routes `applicants`, `applicant-sources`), owns
  `hr_applicants` / `hr_applicant_sources` / `hr_sequences`, declares its own permissions
  (`applicant.{view,create,edit,delete,export}`, `applicant.verifyIdentity`,
  `applicantSource.manage`), and seeds the 10 applicant sources at boot. Capabilities: a
  requisition-driven intake pipeline (BD-001 — mandatory immutable requisition reference
  behind a Stage-0 validator seam), manual / National-ID-derived / ID-less registration,
  deterministic Egyptian National-ID parsing (birth date, gender, governorate — real) with
  live-uniqueness enforcement and masked-by-default DTOs, an OCR extraction **seam** (null
  stub, OQ-30), organization-wide atomic applicant numbering `APP-{YYYY}-{seq:6}` (BD-002),
  heuristic duplicate flagging (never blocks), human identity verification, withdrawal,
  Arabic-normalized search, a filterable/sortable/paginated list, an audited PII-masked CSV
  export, a generic per-row-audited bulk executor, and attachments delegated to the platform
  Files service (title/category/notes, transactional count). Emits
  `hr.applicant.{created,updated,identityVerified,withdrawn}`. **Additive platform seams for
  the first module**: a `platform/web` barrel re-exporting HTTP helpers so modules build
  routers within the layer boundary, and wiring of `manifest.seed` into the boot sequence.
  Public/mobile intake, external-platform adapters, real OCR, and the Stage-0 requisition
  service are **integration seams only** (their governing OQs remain open); **no part of
  Stage 2 (Screening) or later is built.**
- **Sprint 4.1 planning document** (`docs/12-planning/sprint-4.1-plan.md`): HR /
  Recruitment — Applicants (Release v0.6, first business module; docs only, no
  implementation). Business analysis of the full seven-stage recruitment lifecycle
  with an in-depth Stage 1 (Applicants) treatment: registration paths (manual,
  Egyptian National-ID OCR with confidence bands/cross-checks/failure and missing-ID
  workflows, ID-less registration), attachment rules (title + category + notes),
  admin-extensible source catalog with structured referral/agency detail, public
  web/mobile intake as a new trust boundary (pending-submission review model),
  integration domain boundaries (adapters translate, the intake pipeline decides),
  a complete business classification of applicant data (10 groups with stage gates
  and sensitivity levels), a four-population documents-ownership/lifecycle model
  (temporary → applicant → sealed hiring snapshot → employee file, reference-don't-
  copy), and grid/filter/bulk/export requirements with safety rules. Anchored to the
  **EGYCASH-approved baseline workflow (2026-07-10)**: screening → interviews →
  offer (Rejected/Expired/Accepted) → hiring documents → employee created →
  electronic file. **Four business decisions were approved 2026-07-10, resolving
  OQ-7/8/31/32**: recruitment stays requisition-driven (BD-001 unchanged) with the
  Job Requisition documented as a separately-planned **Stage 0** prerequisite that
  every applicant references; hiring documents precede employee creation; interview
  stages are **administrator-configurable** (two rounds is the default, not a limit);
  and screening has **Accepted/Rejected outcomes only** (missing information keeps the
  applicant in Screening, no separate state). Records **Open Questions OQ-7…OQ-32**
  (4 resolved, 20 open) — the remaining blockers being the minimal-Employee shape, the
  frontend scope, and unbuilt-dependency sequencing (sequences service, approvals, OCR,
  external-recipient notifications, frontend grid foundation) — **none assumed, all
  awaiting business resolution before planning freezes**. The blocking set was
  subsequently resolved 2026-07-10 (OQ-29 backend-first, OQ-30 abstractions,
  OQ-9/10 non-blocking) and the plan **frozen** for Stage-1 implementation.

### Backlog (recorded at review — non-blocking, for future sprints)

1. Dedicated concurrency/stress test for the atomic applicant-number allocation
   (no-gap/no-collision under parallel registration).
2. Deeper documentation of the duplicate-detection heuristic (probe fields,
   normalization, flag-resolution workflow) in the architecture reference.
3. Search optimization for contains-style Arabic queries (text index / n-gram) if
   applicant volume outgrows the current regex-over-`searchName` approach.
4. Extend `gen-permission-matrix.mjs` to include module-manifest permissions alongside
   the platform catalog.

## [0.5.0] - 2026-07-09

Release v0.5.0 — Sprint 3.3: **Notifications Service**
([PR #15](https://github.com/egycashcompany-ops/egycash/pull/15); plan:
`docs/12-planning/sprint-3.3-plan.md`; reference:
`docs/02-architecture/notifications-service.md`). Planning went through two amendment
rounds ([PR #12](https://github.com/egycashcompany-ops/egycash/pull/12)/
[#13](https://github.com/egycashcompany-ops/egycash/pull/13)/
[#14](https://github.com/egycashcompany-ops/egycash/pull/14)) before being frozen —
see those PRs for the full design-decision history.

### Added

- **`notificationsService.notify()`** — the one platform-wide, in-process entry point
  (never an HTTP endpoint): synchronous, bilingual, entity-referenced in-app inbox
  creation (the delivery guarantee) plus asynchronous, queued delivery on every other
  enabled channel through a small channel-adapter registry (`inApp`/`email` built;
  SMS/push/WhatsApp interface-ready). Delivery failure on any channel never throws back
  to the caller.
- **In-app inbox** (self-scoped, no permission required): list, live unread count, mark
  one/all read (first-read-wins), archive.
- **Email delivery**: self-managed 5-attempt exponential-backoff retry; every
  delivery-status transition audited; final failure raises the reliable
  `platform.notification.deliveryFailed` event.
- **Versioned notification templates** (`notificationTemplate` CRUD, preview,
  test-send — permission-gated and audited): every edit, including deactivation,
  creates a new version; nothing is ever mutated in place.
- **Preferences**: category-level opt-in/out with a settings-driven default
  (`notifications.email.enabled`); quiet hours (server/UTC, `critical` priority
  bypasses).
- **Idempotency** (caller-supplied key + delivery-job status guard), `sendAt`
  scheduling, `expiresAt` expiration, and file-reference attachments (no binary
  handling this sprint, by design).
- **Socket.IO live push** (`notification:new`/`notification:read`), authenticated the
  same way as the HTTP API, relayed across the api/worker process split over Redis
  pub/sub (a real gap the plan's own text didn't account for — reliable-tier
  subscribers run in the worker, which has no Socket.IO server of its own).
- **Both initially-wired event subscriptions** (`platform.audit.alertRaised`,
  `platform.roleAssignment.changed`) produce real notifications end-to-end against
  idempotently-seeded built-in templates.
- Additive-only elsewhere: a new RBAC read query (`rbacService.listUserIdsWithPermission`)
  and two new settings (`notifications.email.enabled`,
  `notifications.quietHours.enabledByDefault`); no existing service's behavior changed.

### Fixed

- **Retry-after-failure was permanently stuck**: the delivery handler kept a failed
  channel at `processing` across its whole retry sequence, intending that as the
  idempotency guard for the next attempt — but the guard checks for status `queued`
  before proceeding, so every attempt after the first silently no-op'd. A channel now
  transitions back to `queued` before its next attempt is enqueued.

### Backlog (recorded for future release planning — not implemented)

1. Frontend inbox UI and Socket.IO client wiring.
2. SMS / push / WhatsApp channel adapters (interface-ready, not built).
3. Digest/scheduled-summary notifications (`digestMode` field reserved, unused) and
   recurring delivery (`sendAt` is a one-time timestamp only).
4. A quiet-hours-expiry sweep job, an admin "resend a failed delivery" action, and
   notification retention/purge.
5. The future administration console (template management, queue monitoring, failed
   deliveries, resend/retry, statistics) and a dedicated metrics backend.

## [0.4.0] - 2026-07-09

Release v0.4.0 — Sprint 3.2: **Audit & Activity Service**
([PR #10](https://github.com/egycashcompany-ops/egycash/pull/10); plan:
`docs/12-planning/sprint-3.2-plan.md`; reference: `docs/02-architecture/audit-service.md`).
Completes the Sprint 2.1 audit core to its full ADR-012 spec.

### Added

- **Audited CSV export** (`GET /platform/audit-logs/export`, `auditLog.export`): streams
  via a Mongo cursor (no full-result buffering), row-capped
  (`audit.export.maxRows`, default 50,000), field-name-based `nationalId` masking, and
  **the export itself is audited** (actor, filter, row count).
- **Entity timeline** (`GET /platform/timeline`): a merged view over the audit + activity
  streams for one entity, newest-first. Implements
  [BD-007](docs/01-domain/business-decisions.md#bd-007--timeline-authorization-degrades-gracefully) —
  content degrades to whichever of `activityLog.view` / `auditLog.view` the caller holds
  (activity-only, audit-only, or merged); neither ⇒ audited 403.
- **Retention governance**: `platform.audit.retention` (daily) purges expired
  **activity** records in idempotent batches, settings-declared with a hard 365-day
  floor (`audit.retention.activityDays`); the audit stream keeps its structural
  no-delete guarantee.
- **Security-signal detection**: `platform.audit.securitySignals` (hourly) runs four
  detectors — repeated permission denials, lockout clusters, export spikes,
  refresh-token reuse — each raising an `alertRaised` audit record plus the reliable
  `platform.audit.alertRaised` event, deduplicated per (signal, subject, window).
- **Query hardening**: `moduleId` filter added to the audit list/export; new
  `ix_moduleId_at` / activity `ix_at` indexes.
- **Sprint 3.2 planning document** (`docs/12-planning/sprint-3.2-plan.md`, approved
  2026-07-09) and **BD-007 — Timeline authorization degrades gracefully**
  (`docs/01-domain/business-decisions.md`), resolving the decision flagged in the plan's §7.

No new permissions, no new collections (`check:permission-matrix` unchanged). Architecture
review: self-assessed in the PR, no code changes required.

### Backlog (recorded for future release planning — not implemented)

1. Replace the entity timeline's in-memory merge with a cursor-based merge if a given
   entity's history ever grows beyond current practical limits.
2. Generalize CSV export masking (`audit.export.ts`) into a reusable PII-masking framework,
   rather than the current field-name-based check.
3. Consider making the `lockoutCluster` and `refreshReuse` signal thresholds
   settings-configurable in a future release (currently fixed constants).
4. The future Notifications Service (v0.5.0) should _subscribe_ to
   `platform.audit.alertRaised` rather than introduce any direct coupling to the audit
   service.

## [0.3.0] - 2026-07-09

Release v0.3.0 — Sprint 3.1: **File Management Service**
([PR #6](https://github.com/egycashcompany-ops/egycash/pull/6), architecture review:
Implementation Approved; retrospective:
[2026-07-sprint-3.1](docs/11-retrospectives/2026-07-sprint-3.1.md)).

### Added

- **File Management Service** (platform `files`, ADR-010): storage providers behind one
  interface — Local, Railway volume, Amazon S3, MinIO (S3-compatible), Azure Blob — selected
  by `STORAGE_DRIVER`; upload/download/replace(versioning)/archive/restore/soft-delete/
  permanent-delete lifecycle; full metadata set (names, mime, extension, sha256 checksum,
  size, uploader, entity reference, category, tags); category catalog with per-category
  mime/size/retention rules; visibility-aware, per-download-audited authorization with a
  signed-URL abstraction (native presigning or app-level HMAC streaming); extension points
  for virus scanning, OCR and thumbnails with completion events; `platform.file.*` events
  on the reliable tier; unit + integration suites; API doc with sequence diagrams
  (`docs/02-architecture/files-service.md`).

## [0.2.0] - 2026-07-09

Documentation & governance wave (PRs
[#3](https://github.com/egycashcompany-ops/egycash/pull/3),
[#4](https://github.com/egycashcompany-ops/egycash/pull/4),
[#5](https://github.com/egycashcompany-ops/egycash/pull/5)). Release numbering follows the
sprint plan from here (0.x pre-GA); the `2.1.0`/`1.0.0` entries below predate this scheme.

### Added

- Project governance: `ECMS-BOOK.md`, `CONTRIBUTING.md`, `SECURITY.md`, `LICENSE`,
  `CODEOWNERS`, pull-request and issue templates, this changelog.
- **Phase 2.5 — Domain Model** (documentation only): `docs/01-domain/` — domain model,
  bounded contexts, entity relationships, and ubiquitous language for the whole platform.
- **Business Decisions log** (`docs/01-domain/business-decisions.md`): BD-001 requisition-driven
  recruitment (OQ-2), BD-002 organization-wide applicant numbering (OQ-3), BD-003 shared
  Client Registry (OQ-4), BD-004 multi-currency-ready EGP-first Money (OQ-5), BD-005
  separate cash/gold custody entities over a shared pattern (OQ-6), BD-006 one capability
  per implementation sprint — with the domain documents updated accordingly.

## [2.1.0] - 2026-07-09

Sprint 2.1 — Platform Core, phase 2.1 slice
([PR #2](https://github.com/egycashcompany-ops/egycash/pull/2), per
[Architecture Review 01](docs/10-reviews/2026-07-architecture-review-01.md) R2).

### Added

- **Monorepo**: npm workspaces (`apps/api`, `apps/web`, `packages/contracts`,
  `packages/config`); ESLint flat config with layer-boundary enforcement; Prettier;
  GitHub Actions CI (lint, typecheck, permission-matrix and flag-expiry gates, tests,
  build, audit); docker-compose dev stack (Mongo replica set, Redis, Mailpit); devcontainer.
- **`@ecms/contracts`**: Zod-first DTOs and schemas; platform permission catalog (single
  source of truth, synced to DB at boot); versioned event contracts (`schemaVersion`);
  error-code catalog; Egyptian NationalId validator/decoder and PhoneNumber normalizer;
  feature-flag declarations with expiry dates.
- **Kernel**: module registry with manifest validation (including `requiresPlatform`
  compatibility) that fails the boot loudly; typed event bus with in-process and
  outbox→BullMQ reliable tiers; `unitOfWork` transaction helper.
- **Auth**: argon2id login pipeline; 15-minute JWT access tokens; rotating refresh tokens
  with reuse detection and session-family revocation; session registry with revocation;
  settings-driven lockout and password policy; TOTP 2FA with single-use backup codes,
  enforced for privileged accounts.
- **RBAC**: code-declared permission registry; roles as data with protected system roles;
  time-bound role assignments enforced at permission-set computation; data scopes
  `own | branch | organization` applied centrally by `BaseRepository`.
- **Organization**: Organization singleton profile; Branch → Department → Section hierarchy
  with materialized paths, delete guards, managers and acting-manager delegation windows;
  Job Titles catalog.
- **Audit**: append-only audit and activity streams; queued writes with in-request fallback;
  `requestId` correlation across api → queue → worker; query endpoints; audited 403s.
- **Settings & feature flags**: declared-in-code registry; `user → branch → organization →
default` resolution with caching and change events; flags evaluated on the hierarchy.
- **Scheduler**: declared-task registry with pause/resume/run-now API; BullMQ repeatable
  executor; outbox sweep and expiring-assignments report.
- **Web scaffold**: login with TOTP step, in-memory access token with silent refresh,
  session bootstrap, `<Can>`/`useCan` permission gates, ar/en with RTL switching.
- **Tests**: 44 unit tests + integration suite proving login → permission → scoped data →
  audit trail, refresh-reuse detection, lockout, TOTP enforcement, optimistic concurrency,
  and hierarchy guards.

### Changed

- ADR-001…014 statuses Proposed → Accepted per the Milestone 1 approval log; **ADR-015**
  records the single-organization model (Review R1), superseding the multi-company aspects
  of the Milestone 1 design.
- README status lines updated to Milestone 2 / phase 2.1; generated permission-matrix
  companion added (Review R18).

## [1.0.0] - 2026-07-08

Milestone 1 — complete platform design documentation (`docs/`), approved by EGYCASH,
followed by Architecture Review 01 (pre-Milestone 2 critical review, R1–R32).

[Unreleased]: https://github.com/egycashcompany-ops/egycash/compare/v0.24.0...HEAD
[0.24.0]: https://github.com/egycashcompany-ops/egycash/releases/tag/v0.24.0
