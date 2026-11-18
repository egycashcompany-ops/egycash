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
