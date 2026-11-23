# Attendance history import — what the branch app has to send

Status: **current** (Task 2, shipped on `claude/attendance-history-import`).
Audience: whoever changes the branch relay. The relay lives in another repository; nothing in this
document requires a change on the ECMS side.

## Why this document exists

The branch machines hold **67,839 scans from 2024-12-26 onwards for 655 people**, and **62,505 of
them had never reached ECMS**. Three things were in the way, and all three are ECMS-side:

1. ECMS refused any scan older than 90 days, so the relay hard-coded `MAX_AGE_DAYS = 89` and
   refused to offer an earlier start date.
2. A recompute was capped at 92 days per request, so there was no way to ask ECMS to re-derive the
   history even once the scans were in.
3. A person who is no longer enrolled on a machine — 153 of them — has no `{device, enrolment}`
   mapping, so their scans were quarantined, reported in a response nobody reads overnight, and
   stored nowhere.

All three are fixed. What follows is the whole contract; nothing else about the relay changes.

## 1. Sign in

```
POST /api/v1/auth/login     { "identifier": "<the integration account>", "password": "…" }
→ 200 { "data": { "accessToken": "…", … } }
```

Send `Authorization: Bearer <accessToken>` on every call below.

**Cache the token and re-sign in only when it actually expires.** `/auth/login` is limited to **10
attempts per 5 minutes per account**, and every branch signs in as the same integration account, so
the bucket is shared: branches whose tokens expire together will lock each other out. Back off on a
429 rather than retrying immediately. Giving each branch its own login on the same role removes the
shared bucket altogether, and the ECMS setup script already takes `--username`.

The account needs `attendance.importPunches` and `attendance.recompute`. It must never be given
`attendance.decide` or `attendance.decideApprove` — the relay imports and recomputes, it does not
judge anybody's day.

## 2. Send the scans

```
POST /api/v1/hr/attendance/punches/import
{
  "rows": [
    { "deviceId": "HQ-GATE-1", "enrollmentNo": "101907", "at": "2025-01-14T06:58:00.000Z" },
    { "deviceId": "HQ-GATE-1", "employeeNumber": "000123", "at": "2025-01-14T15:04:00.000Z" }
  ]
}
```

- **Batch size: at most 5,000 rows per request.** The contract refuses a larger array; 1,000–2,000
  is a comfortable size for a history backfill.
- **Order: oldest first, and send the whole history in ascending `at` order across batches.** The
  import itself does not care — every row is placed independently — but ascending order means a run
  that stops half way has imported a contiguous prefix, so the relay's cursor is simply "the newest
  `at` I have sent".
- **`at` is an instant, in UTC, with the timezone marker.** ECMS files each scan under the Cairo
  calendar date it falls on; do not pre-convert to a local date.
- **Each row carries exactly one of `enrollmentNo` or `employeeNumber`.** A row with both, or
  neither, is refused by the contract. Prefer `enrollmentNo`: it is what the machine actually
  knows, and `Ac-No` on the K40 Pro export is not an ECMS employee number.
- `direction` is optional and defaults to `unknown`; ECMS derives first-in and last-out from the
  times, so the machine's own in/out flag is not needed.
- **Idempotency: `{deviceId, at, employeeId}`.** Re-sending a file, or the same batch twice, creates
  nothing — the repeats come back as `duplicates`. Re-send freely after a dropped connection.
- **No age limit by default.** `hr.attendance.importMaxAgeDays` is a setting (organization scope)
  and ships at `0`, meaning no limit. Scans more than an hour in the future are still refused: that
  is a device with a wrong clock, in every case anyone has had.

The response:

```json
{ "data": {
  "batchId": "…",
  "imported": 1843,
  "duplicates": 157,
  "onFrozenDays": 24,
  "quarantined": [ { "index": 12, "reason": "unmapped enrollmentNo 300412 on device HQ-GATE-1" } ]
} }
```

- `imported` — stored as new punches.
- `duplicates` — already there. Not an error.
- `onFrozenDays` — how many of the imported punches fall on a day Payroll has already closed. **The
  punches are stored either way, as evidence, but no recompute will ever rewrite those day
  records.** Log this: a backfill that reports "12,000 imported" and nothing else looks complete
  while a whole season of it changed no day.
- `quarantined` — rows that could not be placed, by index into the batch you sent, with the reason.
  These are now also **stored** in ECMS, so the relay does not have to keep them or re-send them;
  see §4.

## 3. Recompute the history

Importing a punch does not derive a day. `POST /hr/attendance/days/recompute` is still there and is
still capped at 92 days — it is the live path the relay already calls after each push, and it
answers inside the request. For the history, start a **backfill** instead: it plans the work, runs
it on worker jobs, and reports progress.

```
POST /api/v1/hr/attendance/backfills
{ "from": "2024-12-26", "to": "2026-11-18", "scope": "withPunches" }
→ 201 { "data": { "id": "…", "status": "running", "totalDays": 41203, "doneDays": 0, "percent": 0, … } }
```

- `scope: "withPunches"` (the default) recomputes **only the employee-days that actually carry a
  scan** — which is what the import changed, and a small fraction of the span. This is the one to
  use after a history import.
- `scope: "all"` walks every day of the window for every employee. Use it after a shift or
  default-pattern change; it also mints the `absent` / `noSchedule` rows for days nobody scanned.
- `employeeIds` (optional, up to 2,000) narrows the run to named people.
- The window is capped at 1,100 days, which covers the machines' whole history.

Read the progress by polling:

```
GET /api/v1/hr/attendance/backfills/{id}
→ 200 { "data": {
    "status": "running" | "completed" | "cancelled",
    "totalDays": 41203, "doneDays": 18044, "percent": 44,
    "computed": 17900, "skippedFrozen": 144, "failedDays": 0,
    "totalChunks": 1352, "doneChunks": 591, "failedChunks": 0,
    "lastError": null, "startedAt": "…", "finishedAt": null
} }
```

`doneDays` of `totalDays` is the "x of y days recomputed" figure. Poll every 10–30 seconds; nothing
about the run depends on being polled. `GET /hr/attendance/backfills?limit=10` lists recent runs.

Two more verbs, both behind the same `attendance.recompute` key:

- `POST /hr/attendance/backfills/{id}/cancel` — stops claiming new work. The chunk in flight
  finishes; everything already done stays done.
- `POST /hr/attendance/backfills/{id}/resume` — picks a run back up: the chunks that failed and the
  ones whose worker never came back go to the front of the queue, and the finished chunks are left
  alone. Safe to call on a cancelled run, and refused (422) when there is nothing left to do.

A backfill never touches a day Payroll has frozen, and **never undoes a manager's decision**: a
decision is an input to the derivation, re-read on every single day it recomputes.

## 4. The people who are no longer on the machine

A scan ECMS cannot place is now **kept**, not just reported, and a re-send of the same file leaves
one row rather than one per night. The relay does not need to track them.

```
GET  /api/v1/hr/attendance/quarantine/unmatched
→ [ { "deviceId": "HQ-GATE-1", "enrollmentNo": "300412", "employeeNumber": null,
      "reason": "unmapped enrollmentNo 300412 on device HQ-GATE-1",
      "rows": 412, "firstAt": "2024-12-26T06:51:00.000Z", "lastAt": "2026-03-02T15:12:00.000Z" } ]
```

That is the list HR works through: one line per machine id, with how much history it is holding.
Then, per id, either

- **link it** — `POST /hr/attendance/enrollments { deviceId, enrollmentNo, employeeId }`. ECMS asks
  nothing of the machine, so somebody removed from the device, or who has since left the company,
  can be mapped so their past scans have a home. **The held scans are imported automatically the
  moment the link is written** — no re-send and no retry call; or
- **ignore it** — `POST /hr/attendance/quarantine/discard { deviceId, enrollmentNo }`. The rows stay,
  marked, so "why is there no attendance for this id" has an answer later. Nothing is deleted.

`POST /hr/attendance/quarantine/retry { deviceId?, enrollmentNo?, limit? }` re-offers the pending
rows on demand — the same path, for the cases the automatic retry did not cover. It answers in the
import's own terms plus `stillQuarantined`.

Reading the quarantine needs `attendanceDevice.view`; retrying and discarding need
`attendanceDevice.manage`. Both are HR keys, not the integration account's.

**There is a screen for this now**: `/attendance/devices` («أجهزة البصمة»), behind
`attendanceDevice.view`. It lists each unmatched machine id with the wall it was seen on, how many
scans it is holding and its first and last, and offers «ربط» and «تجاهل» per id to a holder of
`attendanceDevice.manage`. It also carries the backfill's progress, with cancel and resume. So HR
no longer needs the API for any of §4 — though the API is unchanged and still works.

The screen **suggests** the exact-code match and never acts on it. That is deliberate and the
reason is in the data: machine id `102815` belongs to ECMS `0102818`, so «machine id with a leading
zero» is not a rule anything may apply by itself. A person confirms each link.

## 5. The order to run the backfill in

1. Link, or discard, the unmatched ids you already know about — otherwise their rows quarantine on
   the way in and wait for §4 anyway.
2. Send the whole history, oldest first, 1,000–2,000 rows per batch. Keep each response's
   `imported` / `duplicates` / `onFrozenDays` and the `quarantined` reasons in the relay's log.
3. Work through `GET /quarantine/unmatched` and link what should be linked. The held scans import
   themselves as each link lands.
4. Start one backfill over the full span with `scope: "withPunches"`, and poll it to completion.
5. Check a few employee pages across 2025 against the machine's own export before telling anyone
   the history is in.

Resume the relay's ordinary forward push (import + `days/recompute`) at any point; the two paths do
not interfere, and both are idempotent.


## 6. What is still to press, and when (added 2026-11-18)

The history send and the first backfill are **done**: 65,579 punches are in ECMS from 2024-12-26
on, and run `6afd6afa` covered 2024-12-26 → 2026-11-18 with `scope: "withPunches"` — 2,062 of 2,062
chunks, 52,299 of 52,299 days, 52,237 computed, **0 failed**. Nothing needs re-sending and nothing
needs re-running for that span.

### Nothing to press for the ordinary day

The relay's forward push is enough. An import now **derives the days it touched itself**, for today
and the two days either side, so a check-out that arrives in a later batch than its check-in turns
«حضر فقط» into a full day inside that same request. `days/recompute` is still accepted and still
idempotent — keep calling it if that is simpler — but it is no longer what makes a recent day
correct.

Each import answers with two new numbers, and the relay's log should keep both:

- `daysRecomputed` — employee-days derived inside the request;
- `daysLeftToBackfill` — employee-days it touched that are older than the live window.

A non-zero `daysLeftToBackfill` is the signal that a backfill is owed. It exists because «imported
26,493» read as «done» when almost nothing had been derived, and no number anywhere said so.

### The one backfill still to run: `scope: "all"`, once the shifts are assigned

Every backfill so far used `scope: "withPunches"`, which plans only the employee-days a scan
actually touched. That is right for importing history and wrong for **pricing** it: a day somebody
was due and did not come has no punch, so nothing planned it, so no `absent` row exists for it.
While no working pattern is set this costs nothing — with no expectation there is no lateness and
no absence to compute, and those days read «لا يوجد جدول», which is honest.

The moment the real hours are assigned per department, those two years need walking day by day:

```
POST /hr/attendance/backfills
{ "from": "2024-12-26", "to": "<the day before the shifts take effect>", "scope": "all" }
```

Then poll `GET /hr/attendance/backfills` (or watch `/attendance/devices`) to completion. Expect it
to be **much larger** than the first run — `withPunches` planned 52,299 employee-days, and `all`
over the same span plans roughly 1,750 employees × 690 days, so plan for a long run and let it
resume rather than restarting it. Frozen months are refused per day and reported as
`skippedFrozen`: a closed payroll month is never re-priced by this, which is the point.

Run it **after** the assignments exist, never before — a backfill prices each day against the
expectation that stands when it runs, so an early run would write the same «no schedule» answer it
is being run to replace.

### If an id is linked later

Nothing to press. Writing the enrolment imports that id's held scans automatically, and the import
derives the recent ones. Only if the link covers days older than the live window is a backfill
owed, and then a narrow one is enough:

```
POST /hr/attendance/backfills
{ "from": "<that id's first scan>", "to": "<today>", "scope": "withPunches",
  "employeeIds": ["<the employee it was linked to>"] }
```

## 7. The backfill the two business rules now need (added 2026-11-18, later the same day)

The owner set two company-wide rules and answered the three questions that were open:

- worked time is **last check-out − first check-in**, flat;
- the company day is **09:00–17:00, eight hours, no grace**, and an arrival after nine is late
  **only if those eight hours were not completed**;
- weekly rest is **Friday and Saturday** (already the shipped default — nothing to set);
- early leave and overtime are measured against the **completed hours**, not the clock;
- a working day with no scan reads **«لا يوجد تسجيل»**, not «غائب» (`hr.attendance.countAbsence`
  ships off).

Section 6 said the `scope: "all"` run was owed once the real hours per department were assigned.
**That condition is now met a different way**: the hours are set company-wide by the default
pattern rather than per department, and the pattern is on by default, so every employee without a
shift assignment has an expectation from the moment this deploys.

### Run this once the deploy is confirmed

```
POST /hr/attendance/backfills
{ "from": "2024-12-26", "to": "<today>", "scope": "all" }
```

`scope: "all"` rather than `"withPunches"`, and the reason is the same as in §6 with one addition:
`withPunches` plans only the employee-days a scan touched, and the new rules change **two** kinds
of day that no scan touched — a day that now has an expectation it did not have (so it can be
`pending` or «لا يوجد تسجيل» rather than «لا يوجد جدول»), and nothing else. It also re-derives
every day that DID have scans, which is what applies the flexible rule, the flat worked time and
the re-tap collapse to the history.

Size it the way §6 says: roughly 1,750 employees × 690 days, so expect it to take far longer than
the 52,299-day first run, and let it resume rather than restarting it.

### What it will and will not change

- **Frozen payroll months are refused per day** and reported as `skippedFrozen`. A closed month is
  never re-priced, so none of this reaches a payslip already issued.
- **Manager decisions survive it.** A decision is an input to the derivation, not a row the
  derivation overwrites, so each re-derived day is computed with the decision still applied.
- **Days with a check-in and only a re-tap after it** stop reading «حاضر, 0 minutes» and start
  reading «حضر فقط» with every figure blank — the owner's five named codes (0100197, 0100319,
  0100477, 0100509, 0100757) and the sixth with five minutes (0100691).
- **No absences are minted**, because `hr.attendance.countAbsence` is off. Turning it on later is
  a settings change plus a second `scope: "all"` run over whatever span should carry absences.

### The one thing to decide before running it

Whether `countAbsence` should be on for the history at all. The owner's answer today was «lateness
only for now», so the run below writes «لا يوجد تسجيل» for every scan-less working day of the two
years. If he later wants absences counted from a date forward, the cheapest shape is: turn the
setting on, then run `scope: "all"` from that date only — the earlier span keeps the honest
«nothing recorded» answer rather than acquiring absences retroactively.
