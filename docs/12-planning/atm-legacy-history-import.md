# ATM — importing the legacy replenishment and maintenance history

Status: design, 2026-11-25. Extends the ATM-7 importer (`docs/12-planning/atm-operations-port.md`
§7); this page is the design for the history part only.

## 1. The owner's request

2026-11-25, after the samples he meant to send for task «سجل التغذية والصيانة القديم»:

> «بالنسبة إلي عينات ملفات JSON لسجل التغذية والصيانة القديم تقدر تشوفهم أنت من Mongo مباشرة جوا
> maintenance و replenishment — وللأفرع كلها مش بس المهندسين وأكتوبر .. ماعدا أسيوط — alex +
> portsaid + tanta + wsal + egycash ( المهندسين وأكتوبر)»

His standing rule for data that disagrees between the two systems (2026-10): «أعتمد اللى جاى من
السيستم القديم». It is why a legacy row is imported as it was, with its own times, names and
notes, rather than reconciled against anything in ECMS.

## 2. What the data is (read on 2026-11-25, read-only)

Each legacy deployment is a database on the company's Atlas cluster, beside `ecms`. The live
collections are `replenishment` and `maintenance` (the shape of the legacy `atm_rep_log` /
`atm_maint_log` models that ATM-7 reads: `bank`, `mach_id`, `name`, `area`, `open_time`,
`close_time`, `schedule_time`, `leader`, `ops_emp`, `ops_emp2`, `service_type`, `notes`, `end`,
`deleted`). `atm_maint_log` is empty in every one of them.

| Database   | ECMS branch            | Replenishment rows (deleted / open) | Maintenance rows (deleted / open) | Legacy period        | ECMS in full use from |
| ---------- | ---------------------- | ----------------------------------- | --------------------------------- | -------------------- | --------------------- |
| `alex`     | Alexandria (050)       | 62,431 (17,844 / 853)               | 63,671 (13,899 / 2,259)           | 2026-04-01 → 11-24   | 2026-11-24            |
| `tanta`    | Tanta (020)            | 51,985 (17,243 / 548)               | 61,888 (13,933 / 527)             | 2026-04-01 → 11-24   | 2026-11-24            |
| `wsal`     | Shorouk (070)          | 6,222 (1,032 / 65)                  | 11,415 (2,748 / 129)              | 2026-07-19 → 11-05   | 2026-11-05            |
| `portsaid` | Port Said (060)        | 31,264 (7,808 / 65)                 | 22,597 (4,399 / 285)              | 2026-05-20 → today   | not yet (no ECMS rows) |
| `egycash`  | Mohandessin (010)      | 0                                   | 0                                 | —                    | 2026-11-01            |

"Open" is a row that is not deleted and has no `close_time`. Asyut (030) is excluded by the owner.
October (040) has no data of its own: it is linked to work as Mohandessin (`atm.branchLinks`), so
the `egycash` deployment imports into Mohandessin. The `egycash` database on the cluster is empty;
Mohandessin's legacy rows are elsewhere and must be copied into it before its import can run (§8).

**Times.** The legacy replenishment path wrote Cairo wall-clock parts stamped as UTC (the T1 bug,
port doc §7); the maintenance path wrote true instants. The data shows it per deployment: among
closed rows, a close earlier than its own open is impossible for an honest open time, and on
`alex` it is 14–25% of replenishments in every month (the clock read two or three hours late)
against 0.1–3% of maintenances (§4.3).

**Machines.** Every branch already has its register in ECMS (Alexandria 311 machines, Tanta 227,
Shorouk 278, Port Said 189, Mohandessin 1,947). On `alex`, 312 of the 316 machine codes found in
closed rows are in the Alexandria register; the four others are typos or another branch's code and
carry a handful of rows.

**The switch to ECMS.** Each branch moved in one day: the legacy days stop and the ECMS days
begin (Alexandria and Tanta on 2026-11-24, Shorouk on 2026-11-05). Before that, ECMS holds only a
few test rows, most of them deleted. Port Said still works in the legacy system.

## 3. Scope

In: the legacy `replenishment` and `maintenance` rows of the five databases above, written into
`atm_replenishments` and `atm_maintenances` under the mapped branch.

Out:

- **Machines** (`atm`). The ECMS register is the truth now. ATM-7 imported legacy machines by
  their legacy ids; doing that here would put a second machine beside each one the branch already
  registered.
- **Mail tickets, label lists, users, employees.** Not asked for.
- **Matching names to employees.** `leader`, `ops_emp` and `ops_emp2` stay name snapshots, as
  ATM-7 decided.

## 4. Design

### 4.1 Which rows are imported

A legacy row is imported when all of these hold:

1. it is not deleted (`deleted` ≠ 1);
2. it has an `open_time`;
3. it is closed (`close_time` is a date), unless the run includes open rows (§4.5);
4. its open time, read in the deployment's time mode (§4.3), falls on a Cairo day **before the
   cutover day** (§4.4), when the run has one;
5. its machine code resolves to a machine of the target branch (§4.2).

Each row that fails one is counted under the first rule it fails, and nothing about it is written.

### 4.2 Machines

The code is normalized as every live entry point normalizes it (`normalizeAtmMachineCode`); a
legacy code ending in `-D` (the legacy delete renamed the machine, contad_app.js:2500) also tries
its base code. It resolves to the target branch's machine with that code, a live one first, then a
deleted one: a row of a machine since removed from the register still belongs to its history.

An unresolved row is skipped and its code reported, most rows first (top 20 in the preview). Once
the register has the machine, running the import again adds those rows and nothing else (§4.6).

### 4.3 Time modes

The ATM-7 rule stands: the two modes cannot be told apart row by row. They can be told apart for a
deployment, from its closed, not-deleted rows read with the open time as UTC. Rows written as Cairo
wall clock then read as closed before they opened whenever the work took less than the offset (two
or three hours); honest rows do so only through a mistyped time. On the deployments read on
2026-11-25 that is 20–85% of the replenishments against 0.1–1.8% of the maintenances. So a kind
whose share is **above 5%** is read as Cairo wall clock, and any other as UTC.

The two readings' counts are not compared with each other. Reading an honest open time as Cairo
wall clock moves it earlier, so it can only make a row look longer, never impossible: the Cairo
count is never higher than the UTC count, whatever the data. The preview shows the closed rows,
the UTC count and the Cairo count (what is left once repaired). The run stores the chosen modes
and the counts, and uses them for every step.

A deployment is read in one mode per kind. On `alex`, August's maintenances read 3.4% impossible
against 0.1–0.4% in the other months, which may be a few days written as Cairo wall clock; those
rows would keep their time as written.

### 4.4 The cutover day

Rows opened on or after the day a branch moved to ECMS are already in ECMS, entered there; a legacy
copy would show the same work twice. The run takes a Cairo day: rows opened on it or later are not
imported.

The screen suggests it: the first Cairo day on which the branch has at least 20 non-deleted ECMS
rows of either kind that were not themselves imported (`legacyImportRunId` null). That gives
2026-11-24 for Alexandria and Tanta and 2026-11-05 for Shorouk, skips the few test rows, and gives
no day for Port Said (nothing to cut). The day is editable; an empty day imports every eligible row.

### 4.5 Rows still open

Off by default. In a branch that has moved, a legacy row left open is work that either finished
without its close being recorded or was re-entered in ECMS; imported, it would sit on the open
board as stale work. The switch exists for a branch imported on the day it moves (Port Said), whose
open legacy rows are the work in hand. The preview counts them either way.

### 4.6 How rows are written

- The row is built by ATM-7's transforms (`replenishmentFromLegacy`, `maintenanceFromLegacy`), with
  the base fields a model write would add (`createdAt`/`updatedAt` = the run's time, the creator
  fields null, `__v` 0) and a new field, `legacyImportRunId` = the run's id.
- **Insert-only, keyed by the legacy `_id`.** Each row is `updateOne({ _id }, { $setOnInsert: row
  }, { upsert: true })`. A row already in ECMS — from an earlier run, and perhaps reopened or edited
  since — is never changed; it is counted as `existing`. So a run repeated after the register
  gained a machine, or after Port Said wrote more rows, adds only what is missing.
- Mail-ticket fields stay as ATM-7 writes them (`source: 'manual'`, `mailTicketId: null`).

`legacyImportRunId` is new on both operation models (`ObjectId | null`, default null, no index):
it marks a row as a copy, lets the cutover suggestion leave the copies out, and makes a run's rows
removable (§4.8).

### 4.7 Runs

A run is one source into one branch, with its cutover day, its open-row switch, its time modes and
their counts. It is stored in `atm_legacy_import_runs`, the branch-move run's shape:

- **One running run at a time**, company-wide: a unique partial index on `state: 'running'` is the
  lock. A run with no step for 30 minutes is stale: the screen can resume it, and a new start
  marks it `failed` and takes the lock.
- **Steps.** The run reads the legacy rows in `_id` order, the replenishments then the
  maintenances, 2,000 per step, and stores where it stopped (`cursor: { kind, after }`) and its
  counts. `POST …/step` does one step; the screen calls it in a loop and shows progress against
  the preview's totals. Closing the page pauses the run; «متابعة» resumes it. A step claims the
  run by its step number, so two steps sent at once cannot both advance it: the second one's writes
  are inserts the first already made, and it reports the run as it stands.
- **Refusals.** A target branch linked to work as another (`linkedSourceRefusal`, ATM-7); a branch
  move running (423, `assertNoBranchMoveRunning`); another run running (409).
- **Audit.** One `atmLegacyImport` row when a run finishes, fails or is undone, with the source,
  branch, cutover, modes and counts — never one per row (the branch-move shape). The realtime
  registry classifies `atm.legacyImport` as a run the screen refetches itself.

### 4.8 Undo

`POST …/undo` removes the rows that carry the run's `legacyImportRunId`, from both collections,
and marks the run `undone`. They are copies — the legacy database is still the source — so they
are deleted, not soft-deleted. A row a person reopened or edited since goes with them; the
confirmation says so. Refused while the run is running.

### 4.9 API

Under `/atm/legacy-import`, every route `atmSettings.manage` at organization scope
(`assertAtmSettingsManager`):

| Route                     | Does                                                                              |
| ------------------------- | --------------------------------------------------------------------------------- |
| `GET /`                   | the sources: each with its suggested branch, suggested cutover day and last run    |
| `POST /preview`           | `{ source, branchId, cutoverDay, includeOpen }` → the counts of §4.1 per kind, the time-mode counts, the unresolved codes |
| `POST /runs`              | the same body → starts a run                                                      |
| `POST /runs/:id/step`     | one step → the run                                                                |
| `POST /runs/:id/undo`     | removes the run's rows → the run                                                  |

`source` is one of the five names, a fixed list in contracts, never free text. The legacy
databases are read through the API's own connection (`connection.useDb(source)`), with `find` and
`aggregate` only: the deployment's database user (`atlasAdmin`, 2026-11-25) can read them. A
source that is missing or empty previews as zero rows.

### 4.10 The screen

A card on `/atm/settings`, «استيراد السجل القديم», one row per source: the target branch, the
cutover day, the open-row switch, «معاينة», then «استيراد» behind a confirmation; a running run
shows its progress, a paused one «متابعة», a finished one its counts and «تراجع».

### 4.11 What it changes elsewhere

The done pages and the daily report gain the older months; they read their ranges in index order,
in chunks (#796), so the volume is what they were built for. The open boards change only when a
run includes open rows.

## 5. Implementation plan

One PR:

- contracts `atm-settings.ts`: `ATM_LEGACY_SOURCES`, the body schemas, the DTOs, the run states;
  `atmLegacyImport` in `AUDIT_ACTIONS`;
- api `modules/atm/migration/`: `legacy-history.ts` (pure: classification, time-mode choice,
  cutover suggestion), `legacy-history-run.model.ts` and its repository, `legacy-history.service.ts`
  (preview, start, step, undo), `legacy-history.routes.ts`; `legacyImportRunId` on both operation
  models; the module's collection list, `atm-indexes.ts`, the realtime registry;
- web: the API client and hooks, `LegacyHistoryCard` on `AtmSettingsPage`, ar + en strings;
- tests: an integration suite with legacy databases in the test server (`useDb`), unit tests of the
  pure part, the web card rendered;
- docs: this page's review record, the port doc §7 pointer, `database-design.md`, CHANGELOG.

## 6. Running it

After it merges and deploys: on `/atm/settings`, preview each source, check the numbers and the
time modes, then import. Suggested order: Shorouk, Tanta, Alexandria (moved; cutover suggested),
then Port Said on the day it moves (with open rows), then Mohandessin once `egycash` holds its data.

## 7. Risks

- **A wrong cutover** imports days ECMS already has (duplicates) or leaves days out. The preview
  shows the count on and after the day; undo removes a run.
- **A wrong time mode** shifts a deployment's history by two or three hours. The mode is chosen by
  the data, with a wide margin on both sides of the 5% line, and the counts are shown; undo removes
  a run.
- **Volume.** Alexandria is about 92,000 rows. At 2,000 per step that is about 63 steps; the
  inserts are unordered bulk writes.

## 8. Open

- Mohandessin: copy its legacy `replenishment` and `maintenance` into the `egycash` database on
  the cluster (the owner).
