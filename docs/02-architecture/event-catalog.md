# Event Catalogue — what the platform emits, described by the schemas themselves

**`packages/contracts/src/events/catalog.ts`** · delivered by **A-2**, hardened into a platform API
by **A-2.1** · served at `GET /api/v1/automation/events` (A-3)

It is a **platform API**, not an automation implementation detail. Five things are meant to be
buildable on it without any of them knowing what an automation provider is: trigger selection,
workflow validation, event documentation, SDK generation, and the API reference. Everything below
follows from treating it that way.

A user building an automation has to pick something to trigger on. That means the platform needs a
list of its own events — with, for each one, what it is called, what it means, what its payload
contains, and an example. Today that knowledge is spread across a dozen contract files and a
hundred `emit()` calls.

The catalogue collects it. **It is generated, not written.**

## Why generated

A hand-maintained catalogue is correct on the day it is written. Then someone adds a field to
`LeaveRequestedPayloadV1` and the catalogue keeps describing the old shape — and nothing notices,
because nothing consumes the catalogue except a UI that renders whatever it is given. The workflows
built on the stale description keep filtering on a field that no longer means what it did.

So every structural fact in the catalogue is derived by walking the Zod payload schema the
publisher already declares:

| Fact | Source |
|---|---|
| Field paths, types, optional, nullable, enum values | `describeField()` walking the schema |
| Sample payload | `sampleFor()` walking the schema, then **verified to parse against it** |
| Schema version | `EVENT_SCHEMA_VERSIONS`, or 1 for module sources |
| Module, entity, action | The event name's three segments |

The sample being *verified* rather than *hoped for* is the load-bearing part: a test parses every
generated sample against its own schema, so if the walker ever mis-handles a type — or a publisher
adds a constraint the walker cannot satisfy — the suite fails instead of the UI quietly showing a
bad example.

## The one thing a human writes

The link from an event NAME to its payload SCHEMA. There is no way to derive it: `emit()` takes a
plain object, and TypeScript has forgotten the schema by then.

It is written as a `Record<<EventName union>, …>` per module, which makes the table
self-enforcing — **declaring a new event constant without cataloguing it does not compile.** That
is a stronger guarantee than a test, and it costs one line per event.

```ts
export const HR_EVENT_PAYLOAD_SCHEMAS: Readonly<Record<HrCatalogEventName, z.ZodTypeAny | null>> = {
  [HrLeaveEvents.Requested]: LeaveRequestedPayloadV1,
  …
};
```

`null` is allowed and means "this module has not declared a payload contract for this event". The
entry still appears — the event can be triggered on, it just cannot be *filtered* on. Saying so is
honest; inventing a field list is not, and refusing to build the catalogue would take the whole
trigger picker down over one module's omission.

## Labels

Structure can be generated. Words cannot: Arabic does not fall out of an English identifier.

What *is* generated is the composition. Two lexicons — entities (`employee` → موظف) and actions
(`created` → إنشاء) — are each translated once and combined per event, exactly the way
`declarePermissions` combines an action with a resource. English reads `<entity> <action>`
("Employee created"); Arabic reads `<action> <entity>` ("إنشاء موظف").

A new event usually needs **no new vocabulary at all**, because it reuses nouns and verbs the
system already has. When it does need a word, `isFullyLocalized()` returns false and a test fails
— rather than the Arabic UI silently starting to show English identifiers.

Six events whose names do not decompose into prose (`platform.auth.loggedIn` would compose to
"Authentication logged in") carry a written-out label instead. Contorting the lexicon to
accommodate them would have made every other label worse.

## Extending it

A module contributes a source:

```ts
buildEventCatalog(PLATFORM_EVENT_SOURCE, HR_EVENT_SOURCE, FLEET_EVENT_SOURCE);
```

Nothing else changes. When Fleet or Treasury lands, its events become automatable by adding one
source — not by touching the automation engine.

## Who uses it

- **Trigger picker** (A-11): the list a user chooses from, with field paths for filters.
- **Trigger validation** (A-3, `modules/automation/workflows/trigger-validation.ts`): refuses a
  subscription to a name nobody publishes, and a filter on a field the payload does not carry.
  Without it a workflow sits enabled and silent forever, which is the worst failure an automation
  can have — indistinguishable from "no work to do".
- **Template prerequisites** (A-9): `requires.events` resolves against the catalogue, so a package
  for a module that does not exist yet installs as `draft` and cannot be enabled.

## Not an automation surface

The catalogue describes what **ECMS emits**. It mentions no provider, no transport and no
automation concept, and a test asserts that. Automation is its first consumer, not its owner —
the same list answers "what can I subscribe to?" for any future integration.

## Stable identity

| Field | Meaning |
|---|---|
| `name` | The permanent identity of the FACT. Names are added to, never renamed — a rename silently stops every workflow subscribed to the old name, with no error anywhere. |
| `id` | `<name>@<schemaVersion>` — the fact in one shape. What a doc anchor, an SDK symbol and an external integration pin. |
| `typeName` | `PlatformUserCreatedV1` — derived, unique, valid as an identifier in any generated client. |

## Explicit versioning

Three levels, deliberately separate:

- **`schemaVersion`** — the payload's shape. Fields are added within a version (consumers are
  tolerant readers, ADR-008); a removal or a retype needs a new version and a deprecation window.
- **`EVENT_CATALOG_VERSION`** — the shape of a catalogue ENTRY. Minor when a field is added to
  `EventCatalogEntry`, major when one is removed or retyped, because that breaks every generated
  SDK. Independent of the events inside it.
- **`digest`** — content hash of the whole catalogue, for `ETag` and for telling whether two
  environments are running the same event surface. FNV-1a: it detects change, it does not
  authenticate it. The document carries **no timestamp**, so two identical deployments serve
  byte-identical bytes; otherwise the digest would change on every restart and be worthless.

## Lifecycle

| `status` | Meaning to a consumer |
|---|---|
| `stable` | Published today. Build on it. |
| `planned` | Declared, nothing publishes it. A workflow on it would be enabled and silent forever, which is the failure mode with no error to find. A picker should refuse it. |
| `deprecated` | Still published, going away; `supersededBy` names the replacement. This is why a rename is never necessary. |

`alsoPublishedBy` marks a name that **more than one publisher emits with a different payload
shape**. `fields` describes the shape the owning module declares; a filter on a field the other
publisher does not send will silently fail to match it. Ten HR names are in this state today — see
§Known divergence.

## Machine-readable payloads

Every entry carries the payload twice, from one source:

- **`fields`** — flattened dot paths (`entityRef.moduleId`, `lines[].sku`) with type, optional,
  nullable and enum values. What a filter builder and a validator want.
- **`jsonSchema`** — JSON Schema 2020-12. What an SDK generator, an OpenAPI/AsyncAPI document or a
  contract-testing tool wants.

A test asserts the two agree about what is required, because two descriptions of one payload that
can disagree means one of them is lying to whichever tool reads it. `additionalProperties` is
`true` on purpose: the bus parses payloads non-strict, and emitting `false` would tell a generator
the opposite of how delivery actually behaves.

The converter is hand-written rather than `zod-to-json-schema`, because `@ecms/contracts` has
exactly one dependency and is bundled for the browser. Covering the handful of Zod nodes payloads
actually use costs ~80 lines and adds nothing to ship.

## The published document

```jsonc
{
  "catalogVersion": "1.0.0",
  "generatedFrom": "zod",
  "jsonSchemaDialect": "https://json-schema.org/draft/2020-12/schema",
  "digest": "3e441d3e",
  "eventCount": 99,
  "events": [ /* … */ ]
}
```

`eventCatalogDocument()` returns exactly what the endpoint serves. Self-describing, so a consumer
that has never seen this repository can tell what it is holding.

## Checked against the code that publishes

`apps/api/src/platform/kernel/event-publishers.spec.ts` reads the API source, resolves every
`emit(...)` call back to an event name, and compares what it finds with what the catalogue claims:

- every emitted name is catalogued (minus a documented internal-hop allowlist);
- every name the recruitment workflow engine publishes is catalogued;
- every `stable` event is backed by something in the running system;
- every `planned` event really has no publisher — so one that gains a publisher fails the suite
  until somebody promotes it;
- every payload key visible at an emit site is a field the catalogue describes;
- `EVENT_MULTI_PUBLISHER` equals exactly the set of names with two publishers.

Source-scanning rather than runtime tracing: tracing only sees the events a test happens to
trigger, which is a small and unrepresentative subset. This test is what found the three
mis-mappings and the divergence below.

## Known divergence

The recruitment workflow engine mirrors every validated transition onto the platform bus carrying
the TRANSITION (`applicantId`, `applicantCode`, `entityId`, `from`, `to`), while the feature
service that owns the entity emits the same name carrying the ENTITY. Ten names are published both
ways: `hr.applicant.withdrawn`, `hr.interview.scheduled` / `started` / `cancelled`, and the six
`hr.jobOffer.*` events.

Both are real and both are pre-existing. The catalogue records it rather than a contracts slice
changing HR behaviour, and A-3's trigger validation turns the record into a warning on the
workflow that would be affected.

Unifying the two shapes is a **domain** change, deliberately out of scope for the Automation
milestone. Recorded as [TD-001](../10-reviews/technical-debt.md#td-001--two-publishers-emit-ten-hr-event-names-with-different-payloads),
with the containment measures and the triggers that would justify paying it down.

## Coverage today

99 events: 22 platform, 77 HR. Every one has a declared payload schema; 97 are `stable` and 2 are
`planned`.
