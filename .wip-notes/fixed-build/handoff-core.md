# hand-off — core (web)

## LANDED (2026-11-18): §4.1–§4.3 are in — desk and touch can code against them now

- `lib/fixed-roster-model.ts` — FULL (not a skeleton): every type of plan §4.1 exactly as written
  (`FixedRosterQuery`, `FixedSeatTarget`, `FixedEditValues`, `FixedRosterActions`,
  `FixedRosterBoardModel`, `FixedDeskBoardProps`, `FixedTouchBoardProps`, `FixedRosterDriver`,
  `FixedUndo`), the pure pieces (`fixedEditStep`, `fixedUndoSteps` / `pushFixedUndo` /
  `popFixedUndo` / `NO_FIXED_UNDO`, `fixedCounters`, `fixedFiltersHiding`, `fixedTouchCars`
  (+ `FixedTouchCars` type), `toSeatRow`, `toCardRow`) and the hook `useFixedRosterBoard(query)`.
- `pages/FixedRosterPage.tsx` — the shell (exports `FixedRosterPage` and `FixedRosterScreen`).
  It imports `FixedDeskBoard` from `components/roster/FixedDeskBoard.tsx` and `FixedTouchBoard`
  from `components/roster/FixedTouchBoard.tsx` with `FixedDeskBoardProps` / `FixedTouchBoardProps`
  — red typecheck until desk / touch land those files is expected.
- `fixed-roster-spec-sources.ts` — `FIXED_FILES {shell, model, desk, touch}`, `fixedFiles(parts)`,
  `fixedSource(parts, { raw })` (comments stripped unless raw; a missing file throws).
- Optional props (each defaults to today's exact daily output):
  - `ExcelPill` (roster-desk-parts) `name?: string` → `data-export` (default `'roster'`).
  - `ExcelButton` (roster-touch-parts) `name?: string` → `data-export` (default `'roster'`).
  - `DriversButton` `label?: string` → aria-label + title (default `t('fleet.roster.availableTitle')`).
  - `DriverSlotPicker` `emptyLabel?: string` (default `t('fleet.roster.availableEmpty')`).
  - `SeatCell` `emptyLabel?: string` → forwarded to its `DriverSlotPicker`.
  - `AvailableList` `freeBadge?: boolean` (default `true`: «متاح» on a free row) and
    `emptyLabel?: string` (replaces BOTH «لا يوجد سائقون متاحون…» lines: the no-drivers line and
    the free-list-empty-and-not-searched line; the search-miss line is unchanged).
  - NEW export `DriversHeading({ label, count, className? })` in roster-drivers: the selected tab's
    face (`rounded-xl bg-slate-100 p-1` box, emerald words, `Count`), an `<h2 data-drivers-heading>`
    with no tab role, `h-11` by default. `className` goes on the OUTER box; to resize the face on a
    computer target it: e.g. `[&_[data-drivers-heading]]:!h-9 [&_[data-drivers-heading]]:!text-[13px]`.
  - `MissionSheet` `title?: string` (default assignTitle), `notice?: ReactNode` (drawn above the
    options as `<p data-mission-notice>`; none by default).
  - `NotesSheet` `title?`, `subtitle?: string` (defaults assignTitle / `fleet.roster.editAssignment`),
    `maxLength?: number` (→ the Textarea; none by default).
  - `CarCard` `workshopLock?: boolean` (default `true`; `false` → `locked = false`, the seats get
    `{...row, inMaintenance:false}`, the badges / tint still read the real row), `badges?: ReactNode`
    (in place of `<RowBadges row={row} />`, both places), `menu?: CardMenu` where
    `CardMenu = { edit: string; clear: string; canClear: (row: FleetRosterRowDto) => boolean }`
    (⋮ words, the notes button's aria word, when «clear» shows; default «تعديل التعيين» /
    «إلغاء التعيين» / `carriesPlan`). `CardMenu` is exported from RosterCarCard.
  - `export` added (nothing else changed): RosterDeskBoard `FIGURE`, `ROW_TINTS`, `LAPTOP_GUTTERS`,
    `LAPTOP_ACTIONS`, `TIGHT_CELL`, `PINNED_CELL`, `PINNED_HEAD`, `PINNED_EDGE`, `ROSTER_TABLE`,
    `MISSION_BOX`, `useOverflowing`; roster-desk-parts `DESK_CONTROLS`, `LIST_SCROLL`.
- `lib/fixed-roster-board.ts`: `swapDrivers(rows, vehicleId)` (the model's `actions.swap` uses it).

Interface deviations from plan §4: none. Additions only: `NO_FIXED_UNDO`, the `FixedTouchCars`
type name, the `CardMenu` type, `fixedFiles()`.

Notes for desk / touch:
- `m.availableFor(term, target)` returns held-off drivers as `state: 'seated', seatedCode: null`
  (→ AvailableList paints the BLUE «سيارة أخرى»; not draggable, not an idle pick, pickable only
  with `onPick`). `flagged` and `elsewhere` are always `[]`, `licenceExpired` always false.
- `m.pool` = FREE drivers only (the count for «السائقون (n)» and the DriversButton).
- `m.actions.discard / undo / save` and every edit are no-ops without `query.mayPlan`;
  `m.actions.exportSheet` works for everyone.
- `m.missionName(null)` is '—'; `m.missionCatalog = { loading, failed, empty }` for the dialog
  and the mission sheet's `notice` (`fleet.fixedRoster.missionTypesFailed` / `noMissionTypesYet`).
- `m.actions.apply` measures the change itself (no step when nothing changed) — a dialog may
  still compare first, as the daily does.
- `toSeatRow` sets `inMaintenance: false, planned: true`; `toCardRow` sets `planned: true`.

## STATUS (end of the core run, 2026-11-18): DONE, nothing committed by core

Files (core's work = `git diff 2b9467a3 -- <these>`):
- NEW `apps/web/src/modules/fleet/lib/fixed-roster-model.ts` (+ `.spec.ts`, 56 cases)
- NEW `apps/web/src/modules/fleet/lib/fixed-save-refusal.ts` (+ `.spec.ts`, 25 cases)
- NEW `apps/web/src/modules/fleet/fixed-roster-spec-sources.ts`
- NEW `apps/web/src/modules/fleet/components/roster/roster-optional-props.spec.tsx` (23 cases)
- REWRITTEN `apps/web/src/modules/fleet/pages/FixedRosterPage.tsx` (the shell)
- `apps/web/src/modules/fleet/lib/fixed-roster-board.ts` (+ swap cases in its spec)
- the daily pieces (optional props / `export` only): `components/roster/RosterDeskBoard.tsx`,
  `roster-desk-parts.tsx`, `roster-desk-cells.tsx`, `roster-drivers.tsx`, `roster-touch-parts.tsx`,
  `RosterCarCard.tsx`, `components/DriverSlotPicker.tsx`
- `.wip-notes/fixed-build/i18n/core.json` (13 keys, ar + en, formal — checked with
  `offendersIn`, placeholders equal in both)

Runs (each alone under the flock lock):
- own specs: model 56/56, board (with swap) green, optional-props 23/23, refusal 23/25 — the 2 red
  are the "real words" block (no Latin letter in any Arabic line; placeholders filled in ar + en):
  GREEN ONLY AFTER THE HUB MERGES `i18n/core.json`. Verified with a throw-away zz harness that fed
  core.json into `translate`: every line Arabic, no Latin letter, names + code filled (harness
  deleted).
- daily specs UNEDITED: fleet-daily-roster, fleet-roster-touch, fleet-roster-filter-row,
  fleet-roster-licence, roster-shared, roster-board, roster-layout, daily-roster-board, roster-view,
  useDraftBoard, draft-storage, fleet-driver-card — all green. `fleet-roster-picker.spec.tsx`
  cannot load until `components/roster/FixedTouchBoard.tsx` exists (it imports FixedRosterPage) —
  re-run after touch lands (its fixed half reads the desk seat: see R3, desk's to confirm).
- also green: fleet-date-picker, fleet-table-sort (the shell keeps every pinned sort line),
  remembered-filters-coverage, fleet-row-actions-look, fleet-figures-font.
- web typecheck: the ONLY error is the missing `components/roster/FixedTouchBoard` import
  (desk's files compile against §4 as written).
- eslint + prettier clean on every core file and spec. `scripts/check-formal-arabic.mjs` clean.

## To the HUB
1. Merge `i18n/core.json` (13 keys: `fleet.fixedRoster.poolEmpty` + 12 `fleet.fixedRoster.refusal.*`).
   Then `lib/fixed-save-refusal.spec.ts` › «the real words» goes green (2 cases).
2. Red until re-pointed (the fixed code column / hover code / code filter now live in
   `components/roster/FixedDeskBoard.tsx`, the shell keeps DEFAULT_SORT + the state rank):
   - fleet-sort-arrows › «offers both rosters the code and the state» (`pages/FixedRosterPage.tsx`
     → `components/roster/FixedDeskBoard.tsx` for the `vehicle`/`state` columns; the «ranks
     الحالة» and «default order» cases still pass on the shell).
   - fleet-vehicle-card-census › ««الطاقم الثابت» — the coloured code…» and «hover only where…».
   - vehicle-code-selectors › «only the boards pass their own options to the car filter».
   - `fleet-fixed-roster.spec.tsx` is desk's rewrite.
3. Stale comments fixed by core: the page header (the old «a reload … keeps the saved crews»,
   «نوع المهمة/ملاحظات always «—»», the per-car colour) and its two orphan JSDoc blocks («Remembered
   across visits…» stacked on `fixedSortValue`, «The order this screen opens in» stacked on
   `CrewCarCode`) — gone with the rewrite; the orphan `clearSlot` doc block in
   `lib/fixed-roster-board.ts` moved onto `clearSlot`; `isDirty`'s doc (no banner reads it);
   roster-drivers' two «as the fixed roster badges them» comments (the fixed screen now lists the
   held-off driver in blue).
   NOT core's file, still stale: `lib/roster-board.ts` (daily model) says the held-off driver is
   listed «as the fixed roster badges him» (amber) — the fixed screen now draws him blue. Comment
   only; touch nothing else there (`roster-board.ts` is pinned by daily specs).
4. EmployeeName: untouched (D3) — the gap is desk's local face in `FixedCrewDialog.tsx`.
5. D5 (fullHeight on phone / portrait): no report from touch yet. If touch's browser check says the
   sticky rows break, the fallback is core's one-line change in the shell:
   `<PageContainer fullHeight={layout === 'desktop' || layout === 'landscape'}>` (check that
   `PageContainer` accepts a boolean `fullHeight`; the header stays on top at every width).
   Note `fleet-fixed-roster` / my model spec pin `<PageContainer fullHeight>` in the shell source —
   update `lib/fixed-roster-model.spec.ts` › «the shell (answer 2 ج)» with it.

## Behaviour notes (for the told list / CHANGELOG)
- `actions.discard / undo / save` and every edit are no-ops without `fleetRoster.plan`;
  `exportSheet` works for every reader (same 8 columns, today's file name, the rows given).
- «حفظ» stored → draft dropped (storage + memory), undo steps forgotten, «تم الحفظ» toast.
  Refused → `toast.error(fixedSaveRefusal(...))`, draft AND undo steps kept.
- The refusal line: held + holder code → «… للسيارة {code}»; held, no holder code (another
  branch) → «… لسيارة أخرى ليست في هذه الشاشة …»; a holder value that is an internal id or blank is
  treated as no code; no name in reach → the unnamed sentence; a 400/409 payload refusal with no
  known detail (incl. the contract's `CUSTOM` issues, and an older server's bare 409) → the generic
  line; stale / forbidden / network → the app's friendly line; any code the app has no words for →
  the generic line (never the server's English).
