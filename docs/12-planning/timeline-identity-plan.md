# Timeline Identity — frozen scope (PR #1 of the HR UX pair)

Status: **frozen, not implemented.** This note is the agreed scope, recorded so implementation does
not re-open decisions the owner has already made.

## Problem

Every history surface says *what* happened and *when*, and none of them says *who*. The recruitment
timeline is the one exception, and only because it denormalizes a name at write time.

| Surface | Carries today |
| --- | --- |
| `RecruitmentTimelineEntryDto` | `actorUserId` **and** `actorName` (denormalized at write) |
| `TimelineEntryDto` (platform entity timeline) | `actorId` only — no name |
| `ActivityLogDto` | `actorId` only — no name |
| `shared/ui/Timeline` | no concept of an actor at all |

## Decision — a display-only directory, not a user view

A new endpoint whose whole purpose is answering "who is this person" for anyone already inside the
system. It is **not** user administration and must not be gated on `user.view`: a recruiter who can
see that someone accepted a screening must be able to see who that someone is. Precedent: the
identity cards in Azure DevOps, GitHub and Jira.

`GET /api/v1/platform/directory/:userId` — `authenticate` only, no `authorize`.

**Returns** (display identity, nothing more):

- display name
- avatar / photo, when one exists
- job title
- department
- branch
- active / inactive, only because the system already exposes that state
- the internal work contact the system already displays

**Never returns** — this list is the point of the endpoint, not a footnote:

- permissions or effective scopes
- roles
- personal email
- personal phone
- any setting, preference, or administrative field

The response is a deliberately closed DTO, not a filtered user record: adding a field to the user
model must not silently widen what every employee can read. A test asserts the response shape is
exactly the allowed keys.

## Two conditions, binding

**1. The drawer is a PLATFORM component, not an HR one.** It lives beside the other platform UI, not
inside a module, and every surface that renders a user's name uses that one component against that
one endpoint — timeline, activity log, audit log, comments, assignments, and anything added later.
A module-local copy is a defect, not a shortcut: the moment there are two, they drift.

**2. Names are resolved in BATCH, on the server. No N+1 anywhere.** A page of 100 events written by
8 people issues ONE lookup for those 8 and maps them onto the rows. This rules out both the obvious
client-side mistake (a request per row) and the quieter server-side one (a lookup inside the row
mapper). The batching belongs in the service that assembles the page, and there is a test that
counts the lookups rather than trusting the shape of the code.

## Shape of the work

1. **Contracts** — `DirectoryProfileDto` (closed) and the route's param schema. `actorName` added to
   `TimelineEntryDto` and `ActivityLogDto`.
2. **API** — a `platform/directory` feature: one service that joins the user to its employee record
   for title/department/branch, one `authenticate`-only route. The timeline and activity-log
   services resolve actor names in **one batched lookup per page**, never per row.
3. **Web** — one `UserProfileDrawer` under `platform/`, and one `ActorLink` that opens it. Used
   wherever a user's name appears: timeline, activity log, audit log, comments, and anything later.
   `shared/ui/Timeline` grows an optional `actor` on its entry so every timeline gets this for free.
4. **Wiring** — the four surfaces that render a timeline today: employee profile, employee file,
   screening detail, recruitment timeline.

## The PR contains exactly this

- the platform directory endpoint
- the platform profile drawer
- actor identity on the timeline and the activity log
- the tests
- the screenshots

## Explicitly out of scope

Everything in PR #2 (multi-select filters, the reset icon, the step progress bar, Arabic applicant
names). No other change rides along.
