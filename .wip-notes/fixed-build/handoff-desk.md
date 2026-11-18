# hand-off — desk (web, the computer's board)

## Files (all new except the spec, which is rewritten)
- `apps/web/src/modules/fleet/components/roster/FixedDeskBoard.tsx` — `FixedDeskBoard(FixedDeskBoardProps)`:
  E2 toolbar (`data-fixed-toolbar`: the plural count `role=status data-filtered-count`
  title `fleet.fixedRoster.matchedRows`, shown once the board answered; `ExcelPill name="fixed-roster"`
  → `m.actions.exportSheet(rows)`), E3 dark filter bar (`data-fixed-filters`: FilterBar reset,
  «كود السيارة» VehicleCodeFilter in FilterWithIcon w-48, DeskCounters; no «كل المهمات»), E4 table
  (`data-fixed-table`, ROSTER_TABLE + useOverflowing, DataTable stickyHead, `data-car`, `data-tint`
  unsaved > workshop, EmptyState «لا توجد سيارات» only for a board with no car), the 7 columns,
  E7 EditsBar floating (planner && dirty; codes → `fixedFiltersHiding` + scroll `tr[data-car]`),
  E8 discard Dialog when more than one car is edited, the pen dialog mount. No PageContainer
  (the shell draws it), no h1.
- `components/roster/fixed-desk-cells.tsx` — `FixedStatusCell`, `FixedNotesCell`, `fixedSeatFacts(m)`.
- `components/roster/FixedDriversPanel.tsx` — the daily panel shell + DESK_CONTROLS, `DriversHeading`
  «السائقون (n)» (n = `m.pool.length`), DriverSearch, AvailableList (`availableFor(term, null)`,
  `onPick=null`, `licence=null`, `draggable=mayPlan`, `hoverCard`, `part="list"`, `freeBadge={false}`,
  `emptyLabel=poolEmpty`). The list is drawn only once the board answered (design §3 "panel list
  empty" while loading).
- `components/roster/FixedCrewDialog.tsx` — `FixedCrewDialog` (+ exported `CrewCandidates`, the empty
  seat's list, so a node spec can render it without a click).
- `apps/web/src/modules/fleet/fleet-fixed-roster.spec.tsx` — rewritten: the screen + the desk
  (65 cases).
- `.wip-notes/fixed-build/i18n/desk.json` — the six keys of plan §6 (desk), exactly as written.

## Results
- `fleet-fixed-roster.spec.tsx`: 64 passed, 1 RED UNTIL THE HUB MERGE (expected):
  «reads as approved in Arabic — the five forms, no Latin letter (green after the i18n merge)» —
  asserts `fleet.fixedRoster.carCount.{one,two,few,many,other}` = «سيارة واحدة / سيارتان /
  3 سيارات / 11 سيارة / 100 سيارة», `matchedRows` = «عدد الصفوف بعد عوامل التصفية», no Latin letter,
  an en value exists. Every other case asserts through `translate()` and is green before and after.
- `fleet-roster-picker.spec.tsx`: 18/18 GREEN (its fixed half too — the seat adapter `toSeatRow`
  tolerates a hand-built row with `inWorkshop` and no `inMaintenance`).
- `npm run typecheck -w apps/web`: rc 0 (with touch's board landed). eslint + prettier clean on all
  five files.
- `node scripts/check-formal-arabic.mjs`: clean.

## To the HUB — shared census specs to re-point (red now, exactly these 5 cases)
Run on the tree with the touch board landed: 5 failed / 384 passed over the five shared specs.
1. `fleet-sort-arrows.spec.tsx` «offers both rosters the code and the state»: replace
   `pages/FixedRosterPage.tsx` by `components/roster/FixedDeskBoard.tsx` in that loop only
   (`key: 'vehicle',` has `sortable: true` + `sortKey: 'code'`; `key: 'state',` has `sortable: true`).
   The other two loops (state rank, DEFAULT_SORT) stay on `pages/FixedRosterPage.tsx` (green).
2. `fleet-vehicle-card-census.spec.tsx`: the fixed WIRED entry → `file: 'components/roster/FixedDeskBoard.tsx'`,
   screen «الطاقم الثابت» — the code column, hover only, pins
   `/<VehicleHoverCode\s+vehicleId=\{row\.vehicleId\}\s+code=\{row\.code\}\s+focusable=\{false\}/u`
   (the coloured-code pins are retired: no `CrewCarCode`, no `useVehicleHoverCard` here); and in the
   hover-only list replace `pages/FixedRosterPage.tsx` by `components/roster/FixedDeskBoard.tsx`.
   The census's "every screen that draws a car's code is accounted for" then stops listing
   `components/roster/FixedDeskBoard.tsx` as unaccounted. (Touch cards: ask touch's hand-off.)
3. `lib/vehicle-code-selectors.spec.ts` «only the boards pass their own options to the car filter»:
   replace `'modules/fleet/pages/FixedRosterPage.tsx'` by
   `'modules/fleet/components/roster/FixedDeskBoard.tsx'` (sorted list; it goes right before
   `RosterDeskBoard.tsx`).
- `fleet-table-sort.spec.tsx` and `shared/lib/remembered-filters-coverage.spec.ts`: GREEN as they are.

## Decisions taken here (tell the reviewer)
- D-desk-1 Notes cell: `line-clamp-3` WITHOUT design E4.5's `block` — in Tailwind 3.4 the display
  utilities come after `line-clamp-*` in the stylesheet, so `block` would undo the clamp
  (`display:-webkit-box`). Same width rules (`min-w-[5rem] max-w-[8rem]`, laptop `3.125rem`).
- D-desk-2 Pen dialog's mission list: the catalog's ACTIVE missions plus the one already on the
  car (kept legible) — the cell's `CatalogSelect` rule — instead of the old dialog's every item
  (archived ones too, which the server now refuses as FIXED_CREW_MISSION_INACTIVE). The other
  dialog rules are verbatim (seeds, sameTwice + disabled save, promote on clearing seat 1, seat 2
  waits for seat 1, the other seat's pick never offered, '' → null, maxLength 500, «إلغاء» touches
  nothing). «بدون سائق» as an option is replaced by the daily DriverSlot's ✕.
- D-desk-3 The unsaved tint follows `m.unsavedIds` for every reader (the daily board's rule — its
  only gate is the day, and this board has none); only a planner gets the unsaved bar (D13).
- D-desk-4 The pen's hook is `data-edit-row={row.code}` (the daily's), not the vehicle id as before.
  Its aria/title is `common.edit` «تعديل».
- D-desk-5 The dialog's «حفظ» hands the four facts back; the board compares with the row and calls
  `m.actions.apply` only on a change (the daily `applyDialog` shape).
- D-desk-6 Name + code in the dialog: a local `flex gap-x-2` face; `EmployeeName.tsx` untouched (D3).

## To core
Nothing needed in a core file.

## Scratch
Used and removed: `apps/web/zz-vitest-desk.config.mts` + `apps/web/src/modules/fleet/zz-touch-stub.tsx`
(an alias stub for the not-yet-landed touch board, only to run the spec early). Logs in
`/tmp/claude-0/-home-user/85f289ec-521b-5944-9b89-a0120b22d71a/scratchpad/fixed-build/`
(desk-spec.log, picker-spec.log, census-specs.log).

## Note for touch and the HUB — the desk spec reads the touch files too
`fleet-fixed-roster.spec.tsx` builds `SCREEN = fixedSource(['shell','model','desk','touch'])` and
claims on it (green against touch's files as of 08:35): no `DeskDayStepper`, `PastDayBanner`,
`weekdayOf`, `slashDate`, `shiftDay`, `useRosterDay`, `rosterDraftKey`, `type="date"`,
`ExportSheetButton`, `workType`, `vehicleColour`/`vehicle-colour`, `fleetFixedRoster`, or
`.licenceExpired|profileActive|unavailableDrivers|unavailableReason`; exactly ONE `mutateAsync`;
the `…/api/fleet-queries` imports are exactly {useFixedRoster, useFleetCatalog, useSaveFixedRoster};
no `…/api/fleet-api` import. A touch change that breaks one of these is a real regression of the
design, not a desk-spec problem.
