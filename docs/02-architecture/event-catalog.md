# Event Catalogue — what the platform emits, described by the schemas themselves

**`packages/contracts/src/events/catalog.ts`** · delivered by **A-2** · served at
`GET /api/v1/automation/events` (A-3)

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
- **Trigger validation** (A-5): `isCatalogedEventName()` refuses a subscription to a name nobody
  publishes. Without it a workflow sits enabled and silent forever, which is the worst failure an
  automation can have — indistinguishable from "no work to do".
- **Template prerequisites** (A-9): `requires.events` resolves against the catalogue, so a package
  for a module that does not exist yet installs as `draft` and cannot be enabled.

## Not an automation surface

The catalogue describes what **ECMS emits**. It mentions no provider, no transport and no
automation concept, and a test asserts that. Automation is its first consumer, not its owner —
the same list answers "what can I subscribe to?" for any future integration.

## Coverage today

87 events: 22 platform, 65 HR. Every one has a declared payload schema.
