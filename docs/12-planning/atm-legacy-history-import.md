# ATM — importing the legacy replenishment and maintenance history

Status: design, 2026-11-25, revised after its design review — stages A–C, then D–E with a code
review (§10) — and built in the same PR. It
reuses the row transforms of the ATM-7 importer ([port doc §7](atm-operations-port.md)) but is a
separate path: ATM-7 imports a whole legacy deployment, machines included, into an empty branch;
this copies only the operation history into branches that already have their registers.

## 1. The request, and what it is for

In place of the JSON samples for «سجل التغذية والصيانة القديم», the owner pointed to the databases
(2026-11-25):

> «بالنسبة إلي عينات ملفات JSON لسجل التغذية والصيانة القديم تقدر تشوفهم أنت من Mongo مباشرة جوا
> maintenance و replenishment — وللأفرع كلها مش بس المهندسين وأكتوبر .. ماعدا أسيوط — alex +
> portsaid + tanta + wsal + egycash ( المهندسين وأكتوبر)»

In English: read the old replenishment and maintenance history directly from the legacy Mongo
databases, for every branch except Asyut — the databases `alex`, `portsaid`, `tanta`, `wsal` and
`egycash` (Mohandessin and October).

**What it is for.** Each branch moved to ECMS in November 2026 and its ATM pages start on the day
it moved: the done pages, the daily report and every per-machine history read nothing older. The
import gives them the months before.

**Done when** the done pages and the daily report of Alexandria, Tanta, Shorouk and (once each
moves or its data is in place) Port Said and Mohandessin show the closed («Done») legacy operations
before the branch's switch, with their own open and close times, names and notes, and nothing after
it twice. The preview's counts are the measure — rows copied per kind, rows left out per reason —
and §7's check after each run confirms it on the pages themselves.

The owner's standing rule for data the two systems disagree on (2026-10) is «أعتمد اللى جاى من
السيستم القديم». It is why a copied row keeps the legacy row's content as written — times, leader,
names, notes — rather than being reconciled against anything in ECMS. It does not settle which
system's record of one piece of work stands once both recorded it; §4.4 does, and says why.

## 2. What the data is (read on 2026-11-25, read-only)

Each legacy deployment is a database on the company's Atlas cluster, beside `ecms`. The cluster's
databases are `admin`, `alex`, `config`, `ecms`, `egycash`, `local`, `portsaid`, `tanta`, `test`
and `wsal`. In each legacy one the operation history is in `replenishment` and `maintenance`; their
rows carry, among others, `bank`, `mach_id`, `name`, `zone`, `area`, `open_time`, `close_time`,
`schedule_time` (replenishment only), `leader`, `ops_emp`, `ops_emp2`, `service_type`, `notes`,
`reference_number`, `end` and `deleted` — the fields ATM-7's transforms read. There is no
`atm_rep_log` in any of them, and `atm_maint_log` is empty in every one.

| Database   | Branch (code)     | Replenishments (deleted / open) | Maintenances (deleted / open) | Legacy rows from → to       |
| ---------- | ----------------- | ------------------------------- | ----------------------------- | --------------------------- |
| `alex`     | Alexandria (050)  | 62,431 (17,844 / 853)           | 63,671 (13,899 / 2,259)       | 2026-04-01 → 11-24          |
| `tanta`    | Tanta (020)       | 51,985 (17,243 / 548)           | 61,888 (13,933 / 527)         | 2026-04-01 → 11-24          |
| `wsal`     | Shorouk (070)     | 6,222 (1,032 / 65)              | 11,415 (2,748 / 129)          | 2026-07-19 → 11-05          |
| `portsaid` | Port Said (060)   | 31,264 (7,808 / 65)             | 22,597 (4,399 / 285)          | 2026-05-20 → 11-25 (in use) |
| `egycash`  | Mohandessin (010) | 0                               | 0                             | —                           |

"Open" is a row that is not deleted and has no `close_time`. Whatever predates the first rows of
each database is not on the cluster. Asyut (030) is left out by the owner. October (040) holds no
ATM data of its own: it is linked to work as Mohandessin (`atm.branchLinks`, port doc §6b — its
people are answered as Mohandessin's on every ATM request, and what they record is filed under
Mohandessin), so `egycash` is imported into Mohandessin.

**Mohandessin.** The `egycash` database on the cluster exists and is empty; no other database on
the cluster holds its rows. ECMS holds no legacy Mohandessin row either (its first own row is of
2026-10-13). ATM-7's own example points at a self-hosted legacy server (`mongodb://host:27017/
egycash`), so the rows are most likely there. Where they are is the owner's to answer (§9).

**Times.** A legacy row's `_id` is an ObjectId, whose first four bytes record when the row was
written — for most rows, the moment it was opened. Comparing `open_time` with that moment, month by
month, for every deployment:

| Database   | Maintenance: open time within 15 min of written | Replenishment: open time 105–195 min after written | Replenishment within 15 min |
| ---------- | ----------------------------------------------- | -------------------------------------------------- | --------------------------- |
| `alex`     | 82–94% of each month's rows                     | 22–36% of each month's rows                        | 0 in every month            |
| `tanta`    | 69–89%                                          | 17–40%                                             | 0 in every month            |
| `wsal`     | 83–94%                                          | 54–77%                                             | 0 in every month            |
| `portsaid` | 93–98%                                          | 87–92%                                             | at most 6 in a month        |

So in every deployment and every month, maintenance open times are true instants and replenishment
open times are Cairo wall-clock parts stamped as UTC (port doc §4, T1; the repair is §7). Close
times were always true instants (both legacy paths wrote `new Date()`). The rest of each month's
rows fit neither signature: rows written ahead of their open time (a replenishment planned the
evening before), or whose time was edited later. In `alex`, the August maintenances that read 3.4%
"closed before opened" fit the true-instant signature like every other month: the cause is
mistyped times, not a change in how they were written.

**The switch to ECMS.** Each branch's first own ECMS rows were written within one sitting, and its
legacy rows stop around it:

- Alexandria: the 24th's plan was entered in the legacy system on 2026-11-23 from 21:00 (Cairo)
  and in ECMS from 21:57; the 215 legacy replenishments of the 24th were never closed.
- Shorouk: on 2026-11-05 the legacy maintenances were written between 07:00 and 10:00 and a third
  of them closed there; ECMS's first rows of the day were written from 11:00, 52 maintenances in
  one batch — the open work, entered again.
- Tanta: legacy rows end on 2026-11-24, ECMS's own begin the same day.

**Machines.** Every branch has its register in ECMS (live machines: Alexandria 311, Tanta 227,
Shorouk 278, Port Said 189, Mohandessin 1,947). Spot checks of `alex` found its codes in the
Alexandria register except a few carrying a handful of rows each — a typo, an empty code, another
branch's code. The preview lists the exact codes (§4.2).

## 3. Scope

In: the legacy `replenishment` and `maintenance` rows of the five databases, written into
`atm_replenishments` and `atm_maintenances` under the branch each database's code names.

Out:

- **Machines** (`atm`). The ECMS register is the truth now. ATM-7 writes legacy machines by their
  legacy ids; run against a branch with a register it would put a second machine beside each, so
  it now refuses a branch that holds machines other than the deployment's own (its re-runs still
  work).
- **Mail tickets, label lists, users, employees.** Not asked for.
- **Matching names to employees.** `leader`, `ops_emp` and `ops_emp2` stay name snapshots, as
  ATM-7 decided.

## 4. Design

### 4.1 Which rows are copied

A legacy row is copied when all of these hold, and is counted under the first one it fails:

1. it is not deleted (`deleted` ≠ 1);
2. it has an `open_time`;
3. it is «Done» in the legacy system: closed (`end` is 1) **and** given a close time (`close_time`
   is a date). Only Done rows are ever copied (§4.5); in every deployment the two signals agree on
   every row, and a row only one of them calls closed stays out;
4. it belongs before the cutover (§4.4), when the run has one;
5. its machine code resolves to a machine of the target branch (§4.2).

### 4.2 Machines

The code is normalized as every live entry point normalizes it (`normalizeAtmMachineCode`). A live
machine answers for its code. A machine deleted in ECMS is stored as `<code>-D` (the ECMS delete
renames it, `machine.service.ts`), so it answers for its base code too when no live machine holds
it — a deleted machine's history still belongs to it; of several deleted under one code, the one
changed last. A legacy code ending in `-D` (the legacy delete's rename) also tries its base code.

A copied row carries its machine's code as the register writes it — for a deleted machine, the
base code, as every row ECMS wrote before that delete still reads. An unresolved row is left out
and its code listed, most rows first (20 at most). Once the register has the machine, running the
import again adds those rows, with everything else not yet in ECMS.

### 4.3 Time modes

Per kind and deployment, the preview counts the rows whose open time is within 15 minutes of when
they were written (`asWritten`) and those 105 to 195 minutes after it (`cairoShifted` — the Cairo
offset, winter or summer). The larger names the mode; open times read as Cairo wall clock are
repaired by ATM-7's `repairLegacyInstant`, and close times are never touched.

The mode is used only when the evidence decides it: the larger count above zero and **at least ten
times the smaller**. On the deployments above every kind is decided by hundreds to one. A kind with
rows that leaves it undecided — a few rows, or rows that fit neither signature — is refused, before
anything is written, rather than guessed: a wrong mode shifts a whole history by two or three
hours. A kind with no rows is clear (there is nothing to copy).

Two readings were rejected. Counting rows that "close before they open" under each reading cannot
choose: reading an honest open time as Cairo wall clock moves it earlier, so that count is never
higher for the Cairo reading, whatever the data. A mode per row cannot be read either: up to
three quarters of a deployment's replenishments fit neither signature.

### 4.4 The cutover

The work of the switch day is in both systems: the plan entered in both (Alexandria), or the open
work entered again in ECMS (Shorouk). Copying the legacy record of what ECMS already holds would
show it twice; dropping the switch day whole would lose what was finished in the legacy system that
morning. So the cut is a **moment**, not a day: the moment the branch began working in ECMS.

A closed («Done») legacy row is history when it was **closed** before that moment — its close time
is a true instant. A row closed after it was finished while ECMS was in use, and ECMS has its own
record of it. An open row is never copied (§4.5), whenever it was opened.

The screen suggests the moment: the branch's first own ECMS row (not deleted, not copied) of the
**day's own work** — opened for the Cairo day it was written — on the first Cairo day it wrote at
least 20 such rows; a few test rows earlier do not count. A plan entered the evening before for the
next day is not work in ECMS yet: Alexandria's 33 rows of 2026-11-23 were all the 24th's plan, and a
cut at the first of them (19:57 UTC) would have left out 14 operations of the 23rd — 5
replenishments and 9 maintenances closed in the legacy system that evening — that ECMS never
recorded (code review, 2026-11-25). Counted that way, on 2026-11-25:

| Branch     | Suggested cut (UTC)  | Cairo        | Done legacy rows closed at or after it          |
| ---------- | -------------------- | ------------ | ----------------------------------------------- |
| Alexandria | 2026-11-24 05:03:16  | 07:03        | 0 (the legacy rows of the 24th are all open)    |
| Tanta      | 2026-11-24 05:53:07  | 07:53        | 0                                               |
| Shorouk    | 2026-11-05 09:04:09  | 11:04        | 1 replenishment, on 25994620 — ECMS has it      |

It is editable to the minute; an empty box copies every Done row. It is asked for one source when
its dialog opens, not for every source when the card does. The box shows the reader's own clock,
as every ATM time box does; the preview says, in Cairo time, which cut its numbers were counted
with (§4.10).

### 4.5 Rows still open — never copied

The owner, 2026-11-25: «عايز اللى يتنقل بس سجل الصيانة والتغذية اللى اتقفل Done» — only the
replenishments and maintenances closed («Done») move. There is no switch for open rows: the body
has no such field and a request that sends one is refused (400). In a branch that has moved, a
legacy row left open was either finished without its close being recorded or entered again in ECMS;
copied, it would sit on the open board as stale work. Work still open in a branch's legacy system
when it moves is opened in ECMS by hand, as any new work is. The preview counts the open rows
(`open`, «لم تُغلق (ليست Done)») so the reader sees what stays behind.

"Done" is read from both fields the legacy app writes on a close — `end: 1` and `close_time`
(`legacyRowDone`). Read on 2026-11-25 across alex, portsaid, tanta and wsal, both kinds: every row
with a close time has `end: 1`, every row without one has `end: 0`, and `status` is 0 throughout, so
asking both changes no count today; it keeps out a row a later edit leaves half-closed.

### 4.6 How rows are written

Insert-only, keyed by the legacy `_id`: a row already in ECMS — copied by an earlier run, and
perhaps reopened or edited since — is never changed, and is counted as `existing`. So running again
adds the rows not yet in ECMS (new legacy rows, rows a changed cut or a registered machine now lets
through) and nothing else. The row is built by ATM-7's transforms with the base fields of an ECMS
row and a new field, `legacyImportRunId`: it marks the row as a copy, keeps copies out of the
suggested cutover, and is what the undo removes. Both operation models carry it, null on every row
made in ECMS, with a partial index over the copies only.

Only Done rows are copied (§4.5), so a copy is never open work that the legacy system closes
later. A Done row edited in the legacy system after it was copied keeps its copied content; §7
imports Port Said once it has stopped writing in the legacy system.

### 4.7 Runs

A run is one source into its branch, with its cut, its time modes and their evidence, stored in
`atm_legacy_import_runs`. It reads the legacy rows in `_id` order —
replenishments, then maintenances — 2,000 per **step**, and stores where it stopped and its counts.
The screen sends the steps one after another and shows the progress; closing the page pauses the
run, and «متابعة» on its row carries it on.

| State     | Means                                                    | Becomes                                                                 |
| --------- | -------------------------------------------------------- | ----------------------------------------------------------------------- |
| `running` | started; steps remain                                    | `done` at its last step; `failed` once stale, at the next start attempt or undo of **any** source |
| `done`    | every row read                                           | `undone` when its source's undo leaves no copy                          |
| `failed`  | left 30 minutes without a step, then ended (error `stale`) | `undone` when its source's undo leaves no copy                        |
| `undone`  | its copies removed                                       | —                                                                       |

- **One run at a time**, company-wide: a unique partial index on `running` is the lock. A running
  run is, on the server's clock, **active** (stepped within the two-minute step lease — a window is
  driving it), **paused** (its page closed) or **stale** (no step for 30 minutes). A paused or stale
  run can still be resumed. A stale one no longer holds the lock: **every start attempt and every
  undo batch, of any source, first ends every stale run `failed`** (one audit row each), before
  anything else is checked — a start refused afterwards (a branch move, a linked branch, an
  undecided mode, an unreadable source) has still ended it. Opening a preview ends nothing. While a run holds the
  lock (stepped within 30 minutes), the branch move refuses (`legacyImportRunning`, below). The
  screen offers «متابعة» on a paused run, nothing on an active one (another window drives it), and
  on a stale one «متابعة», «معاينة» and «تراجع» — «تراجع», or «استيراد» in the preview's dialog,
  ends it. A run this window drove and stopped (a step failed) is paused at once, though the
  server still reads it active for two minutes; while a row shows a run another window drives, the
  card reads its sources again every 15 seconds, so it sees that run pause or end.
- **Steps.** A step takes a two-minute lease on the run before it reads anything; a second step sent
  meanwhile is refused (409 `ATM_LEGACY_IMPORT_STEP_BUSY`) instead of reading the same rows. A step
  that fails gives the lease back and leaves the cursor where it was; the next step reads the same
  rows again, and what the failed one inserted is counted as `existing`.
- **Refusals.** Four have codes of their own: another run holding the lock (409
  `ATM_LEGACY_IMPORT_RUNNING`); a step on a run that is no longer running (409
  `ATM_LEGACY_IMPORT_STATE`); a second step while one holds the lease (409
  `ATM_LEGACY_IMPORT_STEP_BUSY`); the API's database user unable to read the legacy database (422
  `ATM_LEGACY_IMPORT_UNREADABLE`, at the preview and the start — said apart from an empty source,
  which previews as zero rows). The others: a branch move running (423 `ATM_BRANCH_MOVE_RUNNING`, at
  the start, every step and every undo batch); and, as 422 `BUSINESS_RULE_VIOLATION`, a target
  branch linked to work as another (its rows would be seen only company-wide — at the start and
  every step; the preview does not check it), no active branch with the source's code, a kind whose
  times are undecided (§4.3, with `TIME_MODE_UNCLEAR` per kind in its details), and a source named
  like ECMS's own database. A step on an unknown run is 404; a body that still sends an open-row
  switch is 400.
- **The screen** words each refusal with a code of its own in the reader's language; a busy step
  is waited for (3 seconds, up to 50 times) and never shown as a failure, and a step on a run
  another window ended is not one either.
- **The branch move** («نقل البيانات», port doc §6c) refuses while a run holds the lock, with a
  blocker of its own (`legacyImportRunning`), as it refuses during a register import: a run writes
  rows under machines a move re-files and retires.
- **Audit**: one `atmLegacyImport` row when a run starts, and one when it ends, fails (stale) or
  is undone — the source, branch, cut, modes and counts; never one per row. The audit screens label
  it «استيراد سجل الصراف الآلي من النظام القديم». The realtime registry
  classifies `atm.legacyImport` as a run the card re-reads itself.

### 4.8 Undo

Per **source**: «تراجع» removes every row the source's runs copied, from both collections, in
batches of 5,000 per request (the screen repeats it until none remain), then marks the source's
runs `undone`. Refused while a run holds the lock or a branch move runs; it does not take the lock
itself. The rows are copies — while the legacy databases are kept, they are the source — so they
are deleted, not soft-deleted.

A copy changed in ECMS since — closed again, edited, reopened — goes with them. Every ECMS write
raises a row's version (`__v`, optimistic concurrency) and a copy is written at 0, so the card
counts those copies (`changedRows`) and the confirmation names them before anything is removed.
Sparing them instead would leave a partial import that a re-run counts as `existing` and never
completes; the undo is for an import that was wrong, so it removes all of it, said aloud.

The undo's batches and the card's counts read the copies on `ix_legacy_import_run`. Its partial
filter (`$type: 'objectId'`) is restated in every such query (`legacyCopiesFilter`): MongoDB's
planner does not take an `$in` of ObjectIds as implying it (measured on MongoDB 7, as for
`maintenanceFromTicketFilter`), and without it each count and batch walked the whole collection. A
test asserts the index is chosen. The confirmation reads the count the server holds when «تراجع» is
pressed, not the one the card read earlier.

### 4.9 API, and reading the legacy databases

Under `/atm/legacy-import`; every route requires `atmSettings.manage` at organization scope
(`assertAtmSettingsManager`), as every card of `/atm/settings`:

| Route                                | Does                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------ |
| `GET /`                              | the five sources: each one's branch, last run and rows copied now        |
| `GET /sources/:source/cutover`       | the suggested cut (§4.4)                                                 |
| `POST /preview`                      | `{ source, cutoverAt }` → §4.1's counts per kind, the unresolved codes, the time evidence and whether it decides |
| `POST /runs`                         | the same body → starts a run                                             |
| `POST /runs/:runId/step`             | one step → the run                                                       |
| `POST /sources/:source/undo`         | one batch of the undo → removed, remaining                               |

`source` is one of the five names (`ATM_LEGACY_SOURCES` in contracts, each with its branch code),
never free text; the branch is the one that code names, never the request's. The legacy databases
are read through the API's own connection (`connection.useDb(source)`), with `find`, `aggregate`
and `countDocuments` only; a source named like ECMS's own database is refused.

**Security.** This works because the API's database user can read the legacy databases: on
2026-11-25 the cluster has one database user, with `atlasAdmin`. That is wider than the API needs
for anything, this feature included: a flaw in the API reaches every database on the cluster with
the rights to change or drop it. The least the API needs is `readWrite` on `ecms` and `read` on the
five legacy databases; with that, this feature works unchanged, and anything less reads as
`ATM_LEGACY_IMPORT_UNREADABLE`, never as an empty source. The fixed list of sources keeps the
feature itself from naming any other database. Narrowing the user is the owner's, in Atlas (§9).

### 4.10 The screen

A card on `/atm/settings`, «استيراد السجل القديم», after the other cards. One row per source: the
source and its branch, its last run and the operations copied now; the buttons of §4.7 for a
running run, otherwise «معاينة» and «تراجع» while it holds copies; a progress bar while this window
drives a run or an undo. «معاينة» opens a dialog that is also the confirmation: the cut (suggested),
the server's preview (both kinds side by side, the cut it was counted with in Cairo time, the time
evidence, the unresolved codes of both kinds as one list — ten, then how many more there are in
all —, a refusal when the times are undecided, a line when nothing would be copied), and «استيراد», held back until the preview allows
it.

The cut box is sent only as a complete moment from the year 2000, once it has held still for half a
second or been left (the done pages' rule, `done-range-commit.ts`); a superseded preview is
cancelled in the browser, and a failed one is not retried unasked. A half-typed box — a native box
reads '' while any part is blank — blocks the preview and «استيراد» and, once left, says so; only an
EMPTY box means no cut, and the preview then says every Done row is copied. A box that was empty and
is half-typed sends no change event at all, so the box's own `validity.badInput` is asked on each
key, on leaving it and again at «استيراد».

### 4.11 What it changes elsewhere

- The done pages and the daily report show the older months. They read by date range on indexes
  that lead with the branch and the close time, in chunks ([PR #796](https://github.com/egycashcompany-ops/egycash/pull/796));
  a range over the old months reads those months' rows, as it reads any other month's. Their speed
  over the copied volume was not measured here.
- Nothing on the open boards: only closed rows are copied (§4.5), so no copy is open work for a
  later branch move (`machineTwinOpen`) or for the mail duplication check.
- The branch move refuses while a run holds the lock (§4.7).

## 5. Alternatives considered

- **Extend the ATM-7 command-line importer.** It already does one deployment per run, keeps legacy
  ids, refuses linked branches and repairs T1; the differences here (other collections, no machines,
  the register's machines, insert-only, the cut, the time evidence, the undo) could each be a flag.
  Rejected: nobody can run it. Production runs on Railway with no shell for the people who run
  these imports, and every data operation the owner runs is a screen (the register import, the
  machine sync, the branch move); this session has no write access to production either. The
  command now refuses a branch with a register of its own (§3), and every branch in scope has one,
  so it has no target here; it reads `atm_rep_log` and `atm_maint_log`, which no deployment uses
  (§2). Retiring it, keeping the transforms this path reuses, is left to a later change (§9).
- **A background job on the worker.** It would run with the page closed. Rejected for now: the
  ATM settings have no job-progress screen to show it on, and a loop the page drives is the
  pattern the boards already use for long batches; a closed page pauses, and «متابعة» resumes.
- **One request per run**, as the branch move does. Rejected: the move re-files rows with a few
  server-side updates; this reads another database and transforms each row, about 126,000 rows
  for Alexandria — minutes in one request, beyond what a proxy keeps open.
- **No cursor: each step starts from the first row**, relying on insert-only to skip what is
  there. Rejected: each step would re-read every earlier row, so a run's reads grow with the square
  of its size.
- **Update the copies ECMS has not touched** instead of insert-only. The version trail exists —
  a copy is written at version 0 and every ECMS write raises it — so "not touched" can be told.
  Rejected all the same: only Done rows are copied, and a Done legacy row rarely changes; a re-run
  that rewrote untouched copies would add a second way for a copy to change, for a case §7 avoids
  by importing a deployment once it has stopped writing. The version is used where it pays: the
  undo names the copies changed in ECMS (§4.8).
- **A cut by day; a cut by matching the same machine on the same day.** The day loses the work
  finished in the legacy system on the switch morning (Shorouk); matching by machine and day would
  also drop a machine's genuine second visit that day. The moment (§4.4) is exact for both
  switches read.
- **Time mode by "closed before opened" counts; per row.** Rejected in §4.3.

## 6. Implementation (this PR)

One PR, in this order; nothing in ECMS changes until a run is started on the screen. The new field
is absent on every existing row, which reads as null (made in ECMS), so no migration of existing
rows is needed; the new indexes are built at boot by `atm-indexes.ts`. To roll back, revert the PR:
copies already made stay as ordinary closed rows until their source is undone first, so **undo every
source before reverting**.

**Contracts** (`packages/contracts/src/`)

- Modify `modules/atm-settings.ts`: `ATM_LEGACY_SOURCES`, `ATM_LEGACY_KINDS`,
  `ATM_LEGACY_TIME_MODES`, `ATM_LEGACY_SKIP_REASONS`, `ATM_LEGACY_RUN_STATES`,
  `ATM_LEGACY_UNDO_ROWS`; `AtmLegacyImportBodySchema` and the params schemas; the preview, run
  (`active`, `stale`), source (`copiedRows`, `changedRows`), cutover and undo DTOs;
  `legacyImportRunning` among the move's blockers.
- Modify `errors/index.ts`: four codes — `ATM_LEGACY_IMPORT_RUNNING`, `ATM_LEGACY_IMPORT_STATE`,
  `ATM_LEGACY_IMPORT_STEP_BUSY`, `ATM_LEGACY_IMPORT_UNREADABLE`.
- Modify `platform/audit.ts`: `atmLegacyImport` in `AUDIT_ACTIONS`.

**API** (`apps/api/src/`)

- Create `modules/atm/migration/legacy-history.ts` (the pure rules: `classifyLegacyRow`,
  `legacyRowDone`, the time-mode choice, the machine index, `suggestLegacyCutoverAt`),
  `legacy-history-run.model.ts`, `legacy-history-run.repository.ts`, `legacy-history.service.ts`
  (with `legacyCopiesFilter` and the test seams `setLegacyStepRowsForTests` and
  `setLegacyUndoRowsForTests`, which only the integration spec calls), `legacy-history.routes.ts`.
- Modify `modules/atm/maintenances/maintenance.model.ts` and
  `modules/atm/replenishments/replenishment.model.ts`: `legacyImportRunId` and
  `ix_legacy_import_run`.
- Modify `modules/atm/atm.module.ts` (the routes, the collection), `modules/atm/atm-indexes.ts`,
  `platform/realtime/realtime-registry.ts` (`atm.legacyImport`),
  `modules/atm/branch-links/branch-move.service.ts` and `branch-move.planner.ts` (the blocker),
  `modules/atm/migration/legacy-import.ts` (ATM-7's refusal).

**Web** (`apps/web/src/`)

- Create `modules/atm/components/settings/LegacyHistoryCard.tsx`, `LegacyHistoryDialog.tsx` and
  `legacy-history-view.ts` (the pure parts the spec pins).
- Modify `modules/atm/api/settings-api.ts` and `settings-queries.ts`;
  `modules/atm/pages/AtmSettingsPage.tsx` (the card, last); `MoveBranchDataDialog.tsx` (the
  blocker's sentence); `platform/localization/i18n.ts` (`atm.settings.legacy.*`, the blocker and
  the audit label, Arabic and English).

**Tests**

- `apps/api/src/modules/atm/migration/legacy-history.spec.ts` — the order of the rules; Done is
  both signals; an open row is never copied; the cut by close time; codes, `-D`, padded and spaced
  codes; the time-mode choice and margin; the suggestion.
- `apps/api/tests/integration/atm-legacy-history.spec.ts`, legacy databases in the test server —
  each skip reason counted once; the time modes read from `_id`; no cut; a body with an open-row
  switch refused; an undecided mode refused; a source with no branch, an empty one; the sources
  card; a run step by step, audited at start and end; times repaired, machines resolved, deleted
  machines kept; insert-only re-runs (a copy edited in ECMS left as it is, and counted as changed);
  one run at a time, a busy step, the move's blocker, the undo refused, active / paused / stale on
  the server's clock; the undo in batches and its index; a linked target, a branch move running
  (at the start and the undo) and an unknown run refused; the suggestion counting only the day's
  own work; a stale run ended by a start the move then refuses; both kinds' unresolved codes as one
  list with its count; a source with a branch and no legacy database (Shorouk's, here) previewing
  as not found. ATM-7's refusal is in `atm-no-double-open.spec.ts`. Not tested: the unreadable
  source (it needs a database user without read rights on the test server).
- `apps/web/src/modules/atm/legacy-history-card.spec.tsx` — the rows, their buttons by run state
  and permission, the labels naming the source, the progress, the body, when «استيراد» waits, the
  skip reasons shown, the code list, which box values are sent, the refusals' wording, every
  string in both languages.
- Not covered by an automated test: the dialog's typing (no DOM test environment in the web
  package). It was driven once in Chromium, under StrictMode, on 2026-11-25: a half-typed box sends
  nothing and holds «استيراد»; a complete moment sends one preview; an empty box previews with no
  cut; a run steps to its end; the undo names the changed copies.

## 7. Running it

After it deploys, on `/atm/settings`, one source at a time: «معاينة», compare the preview with the
table below, then «استيراد». **Stop, and change nothing, if** a kind's time mode differs from the
table, or the dialog refuses the times as undecided; or the unresolved codes carry more than 1% of a
kind's rows (register those machines first, then preview again); or «ستُنسخ» differs from the table
by more than the switch day and the unresolved rows explain.

| Source  | Times: replenishment / maintenance | Done rows (replenishment / maintenance) | Closed after the suggested cut |
| ------- | ---------------------------------- | --------------------------------------- | ------------------------------ |
| `wsal`  | Cairo clock / true                 | 5,125 / 8,538                           | 1 / 0                          |
| `tanta` | Cairo clock / true                 | 34,194 / 47,428                         | 0 / 0                          |
| `alex`  | Cairo clock / true                 | 43,734 / 47,513                         | 0 / 0                          |

(read on 2026-11-25; the Done rows are §2's rows less the deleted and the open ones.)

1. **Shorouk, Tanta, Alexandria** — they have moved; keep the suggested cut (§4.4).
2. **Port Said** — on the day it moves, after it has stopped writing in the legacy system. Before
   its first ECMS rows the suggestion is empty and every Done row is copied, which is right then:
   ECMS holds nothing of its own to duplicate. Imported later the same day, keep the suggestion.
   Its work still open in the legacy system is opened in ECMS by hand (§4.5).
3. **Mohandessin** — once its legacy rows are in the `egycash` database (§9), and after the same
   month-by-month reading of its times as §2's: the run applies one mode to a kind's whole
   history (§8).

**After each run**, before the next source:

- open the branch's done replenishments and done maintenances for a legacy month and for the switch
  day, and its daily report for one legacy day; the legacy rows are there with their times, leader,
  names and notes;
- on the switch day, no machine shows the same operation twice (a copy and an ECMS row closed
  minutes apart) — a too-late cut shows here, not in the preview;
- the done pages open as fast as before (§8); if they do not, undo the source and stop.

Registering a machine the preview names, then importing again, adds its rows.

## 8. Risks and limits

- **The cut.** Too early leaves finished legacy work out: the preview's «أُغلقت بعد بدء العمل على
  النظام الجديد» counts it. Too late copies work ECMS also has: the preview cannot see that; §7's
  switch-day check does, and the undo removes the source's copies. The suggestion (§4.4) leaves
  nothing out on the three moved branches.
- **A change of time mode within one history.** The run decides one mode per kind over a whole
  collection (ten to one). A deployment that changed how it wrote times part-way could pass overall
  while its earlier months sit two or three hours off. The four deployments read were checked month
  by month (§2) and none changed; Mohandessin, unread and probably the oldest, gets the same check
  before its import (§7).
- **The preview reads a whole source in one request** — about 126,000 rows for Alexandria, after an
  aggregate and a count per kind — and was not timed here. The box sends a cut only once it holds
  still, a superseded preview is cancelled in the browser (the server still finishes reading it),
  and a failure is not retried unasked. If it times out, «استيراد» stays held: count server-side
  instead, before running.
- **The done pages and the daily report over the copied volume** (about 91,000 more rows for
  Alexandria) were not measured. They read by date range on the branch-and-close-time indexes, in
  chunks; §7 checks them after each run.
- **Volume of a run.** Alexandria is 64 steps of 2,000 rows read and about 19 undo batches.
- **The ATM-7 command** still exists; it refuses a branch with a register of its own, so it cannot
  run against these branches (§5).
- **Copies changed in ECMS go with an undo**; the confirmation counts them (§4.8).
- **An undo and a new start of the same source at once.** The undo does not take the run lock, so a
  run started while another window's undo batch is between its check and its delete can count rows
  as `existing` that the batch then removes: the run ends `done` with those rows missing, and the
  undo's next batch is refused. It needs two administrators acting on one source within the same
  seconds; importing the source again adds the missing rows (insert-only). Not guarded in code.

## 9. Open — the owner's

- **Where Mohandessin's legacy rows are.** This feature reads only databases on the company's
  cluster, beside `ecms`; it cannot reach another server. If they are on a legacy server of their
  own (ATM-7's example points at `mongodb://host:27017/egycash`), its `replenishment` and
  `maintenance` collections are copied as they are into the cluster's empty `egycash` database
  (`mongodump --db egycash --collection replenishment`, the same for `maintenance`, then
  `mongorestore` into the cluster) — the fields of §2, unchanged. The answer decides whether
  Mohandessin is imported at all, and when.
- **Whether anything older than each database's first rows exists** (April 2026 for Alexandria and
  Tanta). If it does, it is copied into the same databases the same way, and importing again adds
  it (insert-only); if not, the history starts there.
- **Narrowing the API's database user** from `atlasAdmin` to `readWrite` on `ecms` and `read` on the
  five legacy databases (§4.9). The legacy rights can go once every source is imported and checked;
  the card, its routes and ATM-7 can then be retired in a later change.

## 10. Review

2026-11-25, preset **Full** (design-review skill), stages A–C run: `egm-zoom-out`,
`egm-comprehension`, `egm-design`, `egm-structural`, `egm-style`, then one verifier (`Plan`). 83
findings; 34 duplicates merged; 2 dropped under (d), both the time-mode rule already replaced when
they were verified; 46 kept, 23 of them Nits.

Fixed in this revision: the time-mode rule (two Blockers, found independently) — now the
creation-time signature with a ten-to-one margin, checked month by month on all four deployments
(§2, §4.3); no alternatives (a Blocker) — §5; the switch day — a moment, with the data (§2, §4.4);
the `-D` fallback on the wrong side (§4.2); Port Said under insert-only (§4.6, §7); the branch move
during a run — a blocker both ways (§4.7); the undo — per source, batched, indexed, under the lock
(§4.8); the security of `atlasAdmin` and an unreadable source told apart from an empty one (§4.9);
the run states, the lease and the refusals with their codes (§4.7); the target branch fixed by the
source; Mohandessin's search recorded (§2) and asked (§9); `atm_rep_log` and the start dates (§2);
the problem statement and the acceptance (§1); ATM-7's relation (top, §3) and its guard; the
Alexandria counts restated (§2); the cutover suggestion asked per source (§4.4); the audit at the
start of a run (§4.7); the Nits on wording, terms, the field list, the T1 pointer, links and status.

Accepted: the suggestion of a cut for dates already known, and the open-row switch for a move whose
date is unknown — both are measurements the screen needs anyway (the cut is a moment no one has
written down; Port Said moves later). The switch was then removed by the owner's word the same day —
only Done rows move (§4.5) — and «Done» is read from `end` and `close_time` together. Declined (Nits): the five database names in contracts (they
are the owner's list, and the screen shows them); `source` naming both the legacy database and a
maintenance's origin (different objects, never side by side).

**Stages D–E and a code review**, the same day, on the revision above: `egm-zoom-out` (D),
`egm-implementation-readiness`, `egm-codebase-details` and `egm-style` (E), and three code
reviewers (data safety, concurrency and API, web), each finding verified by a skeptic told to refute
it. The design stages raised 50 findings (1 Blocker, 21 Major, 28 Nits; several the same point from
two stages); the code review 14, of which 10 survived and 4 were refuted.

Fixed:

- the suggested cut, from the day's own work (§4.4) — the code review's data-safety finding,
  confirmed on production: Alexandria's cut would have left out 14 operations ECMS never recorded;
- the stale-run state machine restated as the code runs it, and a stale run offering «معاينة» and
  «تراجع» from its own row; «active», «paused» and «stale» read on the server's clock, so a run
  another window drives is neither called paused nor offered «متابعة» (the Blocker, §4.7);
- the copies' index never chosen — the filter restated, and a test that it is used (§4.8);
- copies changed in ECMS named in the undo's confirmation, from their version, and §5's premise
  corrected (§4.8, §5);
- the undo's count read fresh, its progress never past 100% or below 0;
- the cut box: a half-typed box no longer means «no cut», a cut is sent only when complete and
  still, a superseded preview is cancelled, and the preview says which cut it counted (§4.10);
- the card's loop flag under StrictMode (the project's `useMountedRef`);
- the audit label of `atmLegacyImport` (its absence failed four web specs);
- §6 as exact files and tests; §7's expected values, its stop rules, Port Said's cut and a check
  after each run; §8's risks of a time-mode change within one history, of the preview's single
  request and of the pages' speed; §9's copy procedure for Mohandessin and what each answer
  changes; the refusals with and without codes of their own; §10's own claims calibrated (the
  month-by-month check was §2's, once; the undo is refused during a run, it does not take the lock).

Declined: dropping the step lease (Nit) — it is built and tested, and it is what keeps two windows
from reading the same rows; a mode decided month by month in the code — the four deployments were
read month by month and none changed, and Mohandessin gets the same reading before its import (§7,
§8); retiring ATM-7 and the card now — after the imports, in a later change (§5, §9); the cut box in
Cairo time — every ATM time box uses the reader's clock, and the preview names the cut in Cairo time.
Refuted by their skeptics: a paused run's dead end, as worded, and two test-coverage claims with no
failure a user can reach. A fourth, an undo racing a new run of the same source, was refuted then
as "each refuses while the other holds the lock" — which holds for a run, not for an undo, which
takes no lock; the final review below kept it, and it is §8's accepted risk.

**Final review**, the same day, of everything since the code review — three reviewers (data and
API, the web card, the doc against the code), each finding put to a skeptic: 13 kept, several the
same point, 1 refuted. Fixed: a box half-typed from empty imported with no cut (two reviewers); a
run this window stopped read as another window's, and the card never read again; a refused start
or undo left stale runs running, and the doc said «معاينة» ended one; the undo's confirmation
could open over another action begun while its count was read; «و… أخرى» counted only the codes
sent (both kinds are now one list, with the count of all); the cutover contract's comment; §6's
claim of a test for an empty source (the test now exists). Accepted, not built: the undo racing a
start of the same source (§8).
