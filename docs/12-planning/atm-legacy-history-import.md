# ATM — importing the legacy replenishment and maintenance history

Status: design, 2026-11-25, revised after its design review (§10) and built in the same PR. It
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
moves or its data is in place) Port Said and Mohandessin show the closed legacy operations before
the branch's switch, with their own open and close times, names and notes, and nothing after it
twice. The preview's counts are the measure: rows copied per kind, and rows left out per reason.

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
3. it is closed (`close_time` is a date), unless the run includes open rows (§4.5). `end` is not
   read: ATM-7 already takes `close_time` as the truth (port doc G3);
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

- A **closed** legacy row is history when it was **closed** before that moment — its close time is
  a true instant. A row closed after it was finished while ECMS was in use, and ECMS has its own
  record of it.
- An **open** legacy row (when included) is history when it was opened before that moment.

The screen suggests the moment: the branch's first own ECMS row (not deleted, not copied) written
on the first Cairo day it wrote at least 20 — a few test rows earlier do not count. It is editable
to the minute; an empty cut copies every eligible row. For Alexandria it is 2026-11-23 19:57 UTC
(21:57 Cairo). It is asked for one source when its dialog opens, not for every source when the card
does.

### 4.5 Rows still open

Off by default. In a branch that has moved, a legacy row left open was either finished without its
close being recorded or entered again in ECMS; copied, it would sit on the open board as stale work.
The switch is for Port Said, imported on the day it moves (§7): its rows open then are the work in
hand. Whether a given open row is still real work is the reader's call; the preview counts them.

### 4.6 How rows are written

Insert-only, keyed by the legacy `_id`: a row already in ECMS — copied by an earlier run, and
perhaps reopened or edited since — is never changed, and is counted as `existing`. So running again
adds the rows not yet in ECMS (new legacy rows, rows a changed cut or a registered machine now lets
through) and nothing else. The row is built by ATM-7's transforms with the base fields of an ECMS
row and a new field, `legacyImportRunId`: it marks the row as a copy, keeps copies out of the
suggested cutover, and is what the undo removes. Both operation models carry it, null on every row
made in ECMS, with a partial index over the copies only.

Insert-only has a consequence for a deployment still in use: a row copied while open, then closed
in the legacy system, stays open in ECMS. §7 says how Port Said avoids it.

### 4.7 Runs

A run is one source into its branch, with its cut, its open-row switch, its time modes and their
evidence, stored in `atm_legacy_import_runs`. It reads the legacy rows in `_id` order —
replenishments, then maintenances — 2,000 per **step**, and stores where it stopped and its counts.
The screen sends the steps one after another and shows the progress; closing the page pauses the
run, and «متابعة» on its row carries it on.

| State     | Means                                         | Becomes                                                         |
| --------- | --------------------------------------------- | --------------------------------------------------------------- |
| `running` | started; steps remain                         | `done` at its last step; `failed` when taken over; `undone` by the undo once stale |
| `done`    | every row read                                | `undone` by its source's undo                                   |
| `failed`  | left 30 minutes without a step, then taken over by a new start | `undone` by its source's undo                  |
| `undone`  | its copies removed                            | —                                                               |

- **One run at a time**, company-wide: a unique partial index on `running` is the lock. A run that
  has not stepped for 30 minutes is stale: it can still be resumed, and a new start ends it
  `failed` and takes the lock. While it holds the lock (stepped within 30 minutes), the branch move
  refuses (`legacyImportRunning`, below).
- **Steps.** A step takes a two-minute lease on the run before it reads anything; a second step sent
  meanwhile is refused (409 `ATM_LEGACY_IMPORT_STEP_BUSY`) instead of reading the same rows. A step
  that fails gives the lease back and leaves the cursor where it was; the next step reads the same
  rows again, and what the failed one inserted is counted as `existing`.
- **Refusals**: another run holding the lock (409 `ATM_LEGACY_IMPORT_RUNNING`); a step on a run that
  is no longer running (409 `ATM_LEGACY_IMPORT_STATE`); a branch move running (423
  `ATM_BRANCH_MOVE_RUNNING`, checked at the start and at every step); a target branch linked to work
  as another (422 — its rows would be seen only company-wide; checked at every step); no active
  branch with the source's code (422); a kind whose times are undecided (422, §4.3); the API's
  database user unable to read the legacy database (422 `ATM_LEGACY_IMPORT_UNREADABLE` — said
  apart from an empty source, which previews as zero rows).
- **The branch move** («نقل البيانات», port doc §6c) refuses while a run holds the lock, with a
  blocker of its own (`legacyImportRunning`), as it refuses during a register import: a run writes
  rows under machines a move re-files and retires.
- **Audit**: one `atmLegacyImport` row when a run starts, and one when it ends, fails (taken over)
  or is undone — the source, branch, cut, modes and counts; never one per row. The realtime registry
  classifies `atm.legacyImport` as a run the card re-reads itself.

### 4.8 Undo

Per **source**: «تراجع» removes every row the source's runs copied, from both collections, in
batches of 5,000 per request (the screen repeats it until none remain), then marks the source's
runs `undone`. Refused while a run holds the lock. The rows are copies — while the legacy databases
are kept, they are the source — so they are deleted, not soft-deleted. A row reopened or edited in
ECMS since goes with them; the confirmation says how many rows go and says so.

### 4.9 API, and reading the legacy databases

Under `/atm/legacy-import`; every route requires `atmSettings.manage` at organization scope
(`assertAtmSettingsManager`), as every card of `/atm/settings`:

| Route                                | Does                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------ |
| `GET /`                              | the five sources: each one's branch, last run and rows copied now        |
| `GET /sources/:source/cutover`       | the suggested cut (§4.4)                                                 |
| `POST /preview`                      | `{ source, cutoverAt, includeOpen }` → §4.1's counts per kind, the unresolved codes, the time evidence and whether it decides |
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
source and its branch, its last run and the rows copied now; «معاينة», «متابعة» for a paused run,
«تراجع» while it holds copies, and a progress bar while a run or an undo goes. «معاينة» opens a
dialog that is also the confirmation: the cut (suggested), the open-row switch, the server's
preview (both kinds side by side, the time evidence, the unresolved codes, a refusal when the times
are undecided), and «استيراد», held back until the preview allows it.

### 4.11 What it changes elsewhere

- The done pages and the daily report show the older months. They read by date range on indexes
  that lead with the branch and the close time, in chunks ([PR #796](https://github.com/egycashcompany-ops/egycash/pull/796));
  a range over the old months reads those months' rows, as it reads any other month's. Their speed
  over the copied volume was not measured here.
- With open rows included: the open boards show them; a later branch move counts them as open work
  on the machines it plans (`machineTwinOpen`); the mail duplication check sees them on their day.
- The branch move refuses while a run holds the lock (§4.7).

## 5. Alternatives considered

- **Extend the ATM-7 command-line importer.** It already does one deployment per run, keeps legacy
  ids, refuses linked branches and repairs T1; the differences here (other collections, no machines,
  the register's machines, insert-only, the cut, the time evidence, the undo) could each be a flag.
  Rejected: nobody can run it. Production runs on Railway with no shell for the people who run
  these imports, and every data operation the owner runs is a screen (the register import, the
  machine sync, the branch move); this session has no write access to production either. The
  command stays for an empty branch, and now refuses a branch with a register of its own (§3).
- **A background job on the worker.** It would run with the page closed. Rejected for now: the
  ATM settings have no job-progress screen to show it on, and a loop the page drives is the
  pattern the boards already use for long batches; a closed page pauses, and «متابعة» resumes.
- **One request per run**, as the branch move does. Rejected: the move re-files rows with a few
  server-side updates; this reads another database and transforms each row, about 126,000 rows
  for Alexandria — minutes in one request, beyond what a proxy keeps open.
- **No cursor: each step starts from the first row**, relying on insert-only to skip what is
  there. Rejected: each step would re-read every earlier row, so a run's reads grow with the square
  of its size.
- **Update the rows ECMS has not touched** instead of insert-only. Rejected: telling "not touched"
  from a quiet edit needs a version trail the copies do not have; insert-only, with the undo and a
  re-run, is simpler to trust, and §7 avoids its one cost (Port Said).
- **A cut by day; a cut by matching the same machine on the same day.** The day loses the work
  finished in the legacy system on the switch morning (Shorouk); matching by machine and day would
  also drop a machine's genuine second visit that day. The moment (§4.4) is exact for both
  switches read.
- **Time mode by "closed before opened" counts; per row.** Rejected in §4.3.

## 6. Implementation (this PR)

- contracts `atm-settings.ts`: `ATM_LEGACY_SOURCES`, the bodies and params, the DTOs, the run
  states, the undo batch; `legacyImportRunning` among the move's blockers; `atmLegacyImport` in
  `AUDIT_ACTIONS`; three error codes;
- api `modules/atm/migration/`: `legacy-history.ts` (the pure rules), `legacy-history-run.model.ts`
  and its repository, `legacy-history.service.ts`, `legacy-history.routes.ts`; `legacyImportRunId`
  and its partial index on both operation models; the module's collection list, `atm-indexes.ts`,
  the realtime registry; the move's blocker; ATM-7's refusal of a branch with a register;
- web: the client and hooks (`settings-api.ts`, `settings-queries.ts`), `LegacyHistoryCard` and
  `LegacyHistoryDialog` on `AtmSettingsPage`, the strings in Arabic and English;
- tests: `tests/integration/atm-legacy-history.spec.ts` (legacy databases in the test server),
  `legacy-history.spec.ts`, the card's spec, ATM-7's refusal.

## 7. Running it

After it deploys, on `/atm/settings`, for each source: «معاينة», check the counts, the time modes
and the unresolved codes, then «استيراد».

1. Shorouk, Tanta, Alexandria — they have moved; keep the suggested cut and leave open rows out.
2. Port Said — on the day it moves to ECMS, once it has stopped writing in the legacy system,
   with open rows included: its open rows are then the work in hand, and nothing in the legacy
   system changes after the copy. A copy made earlier is a snapshot whose later legacy changes do
   not follow (§4.6): undo it, then import again on that day.
3. Mohandessin — once its legacy rows are in the `egycash` database (§9).

Registering a machine the preview names, then importing again, adds its rows.

## 8. Risks and limits

- **The cut.** A cut set too early leaves out finished legacy work; too late copies work ECMS also
  has. The suggestion follows the data (§4.4); the preview's `afterCutover` count shows what it
  leaves out; the undo removes a source's copies.
- **The time mode** is refused unless the evidence decides it ten to one; every kind read decides it
  by hundreds to one.
- **Volume.** Alexandria is about 126,000 legacy rows read and about 91,000 copied: 64 steps of
  2,000 rows read. Its undo is about 19 batches.
- **The ATM-7 command** still exists. It refuses a branch with a register of its own, so it cannot
  run against these branches.
- **Rows already edited in ECMS** go with an undo (§4.8).

## 9. Open — the owner's

- Where Mohandessin's legacy rows are, so they can be copied into the `egycash` database (or read in
  place if that server can be reached).
- Whether anything older than each database's first rows exists (April 2026 for Alexandria and
  Tanta).
- Narrowing the API's database user from `atlasAdmin` to what it needs (§4.9).

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
written down; Port Said moves later). Declined (Nits): the five database names in contracts (they
are the owner's list, and the screen shows them); `source` naming both the legacy database and a
maintenance's origin (different objects, never side by side).

Stages D and E follow on this revision.
