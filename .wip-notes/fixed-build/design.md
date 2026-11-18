# «الطقم الثابت» — element-by-element design (replaces the lost gap map)

TEMPORARY (inside `.wip-notes/`, removed before the PR). Re-derived 2026-11-18 from
`.wip-notes/fixed-roster-spec.md` + the CURRENT code: `pages/RosterPage.tsx`,
`components/roster/*`, `lib/roster-board.ts`, `lib/daily-roster-board.ts`, `lib/roster-view.ts`,
`lib/roster-layout.ts`, `lib/useDraftBoard.ts`, `lib/fixed-roster-board.ts`,
`pages/FixedRosterPage.tsx` (1366 lines, today), `api/fleet-queries.ts`, and
`apps/api/src/modules/fleet/fixed-roster/fixed-roster.service.ts`.

Rule where the spec is silent: exactly the daily «تعيين السيارات» look and behaviour, minus the
day (no date, no stepper, no «يوم سابق», no availability words, no absent/leave), with the fixed
page's own data (`GET/POST /fleet/fixed-roster`), rules (`lib/fixed-roster-board.ts`),
permissions (`fleetRoster.view` / `fleetRoster.plan`), draft key (`FIXED_ROSTER_DRAFT_KEY`) and
Excel content (8 columns incl. «م»).

Paths below are relative to `apps/web/src/modules/fleet/` unless they start with `apps/`.
Tn = told item n (spec §Told list). Q1 = (ب) no standing-member flag. Q2 = (ج) header on top.

---------------------------------------------------------------------------------------------------

## 0. Decisions taken here (the spec was silent or the code forced a choice)

| # | Decision | Why |
|---|---|---|
| D1 | A driver the SERVER holds on a car that is not on this board (another branch's car, or an inactive car) is listed under «معيّنون على سيارات أخرى» with a BLUE «سيارة أخرى» (rendered as an `AvailableList` row of state `seated` with `seatedCode: null`, which the shared list already paints `info` + «سيارة أخرى»). He is pickable as a MOVE onto a seat being filled (touch picker sheet, landscape target, desk pen dialog list) — not a drag source and not a "driver first" pick (the daily's seated-row rule). The desk seat picker (`DriverSlotPicker`) offers the FREE list only (the daily's `m.pool` rule). A pick of him is refused at «حفظ» by the server; the refusal line names him (T16). | T9 (blue, under the heading), T16 (the refusal is reachable), daily list rules; nobody loses the function (today he is draggable; now reached through the dialog / the seat list). Told as T24. |
| D2 | The drivers count («السائقون (n)», the touch drivers button) counts the FREE drivers only (no seat in the draft and not held off the board) — the daily's `poolLicensed` rule. | Daily look; T9 lists held-off drivers under their own heading. Told as T23. |
| D3 | `EmployeeName` is NOT changed (its `ms-2` on a `dir="ltr"` code resolves to the far side in Arabic). Fixing it shared would visibly change the merged daily pen dialog → the fixed pen dialog draws its own name + code face with the gap. | "EmployeeName gap only if the daily stays as approved (else local)". |
| D4 | Plural-aware car count («سيارة واحدة / سيارتان / 3 سيارات / 11 سيارة») and its title «عدد الصفوف بعد عوامل التصفية» are NEW keys used by this screen only; `fleet.vehicles.count` / `fleet.filters.matchedRows` (daily + every board) are untouched. | "where this screen shows it"; the daily must not change. Told as T22. |
| D5 | `PageContainer fullHeight` + `PageHeader` wrap EVERY layout in the shell. The touch board is written for that container: no outer `px-*` of its own; its edge-to-edge pieces bleed by the container's padding (`-mx-4 px-4 sm:-mx-6 sm:px-6`; landscape is inside `lg:px-8`). On phone / portrait the board column is taller than the capped container; `main` scrolls the overflow and the sticky filter row / bottom bar stick inside the board column. FALLBACK (only if a browser check at 390×844 and 820×1180 shows the sticky row or bar not sticking): `fullHeight` on desktop + landscape only — the header still on top at every width. | Q2 binding; daily touch board relies on `main` scrolling. |
| D6 | Excel controls keep this screen's hook `data-export="fixed-roster"` through a new optional `name` prop on `ExcelPill` / `ExcelButton` (default `'roster'`). | Daily specs pin `data-export="roster"`. |
| D7 | «إفراغ الطقم» (desk bin and touch ⋮) is immediate — no confirm — and keeps the mission and the note (`clearCrew`). Only «إلغاء» with more than one edited car asks first. | T8, T2. |
| D8 | Notes: desk cell = at most 3 lines + `title` with the whole note (T21); touch card = the daily card's note (full). The touch notes sheet caps at 500 like the dialog. | T21; spec "the 500 cap". |
| D9 | Workshop: desk row rose tint (`data-tint="workshop"`, unsaved amber outranks it), «في الورشة» badge in «الحالة», mission select ENABLED, pen / swap / bin offered, seats editable (seat adapter `inMaintenance: false`). Touch: the card stays in code order (no «في الورشة (n)» group, no lock), «في الورشة» badge on it. | T10; fixed rule (a workshop car still has a standing crew). |
| D10 | Picker sheet title stays the daily's «تعيين السيارة {{code}}» (not a day word). The mission and note sheets take «تعديل · {code}» (the fixed dialog's idiom), per the spec. | spec §How the sample was assembled. |
| D11 | Refusal names come from the client's ONE people map (`useFleetPeopleMap`, gated on `fleetDriver.view` like every name on the screen). The server adds ids and the holding car's code (only when that car reads in the caller's scope), never names. No name in reach → the unnamed sentence («أحد السائقين»). | "never an internal id", no permission bypass through an error body. |
| D12 | Refusal detail codes are string literals pinned on BOTH sides (API service + web lib) by specs; no contracts change (no new contract field, no contracts rebuild between packages). | Q1 "no new contract field"; parallel packages. |
| D13 | The model keeps the draft for a reader who cannot plan exactly as today (a restored draft is drawn); every edit, the bar and the pickers are gated by `mayPlan`. | Today's behaviour; daily does the same on a plannable day. |

---------------------------------------------------------------------------------------------------

## 1. COMPUTER (≥ 1280 px) — `layout === 'desktop'`

Frame: shell `<PageContainer fullHeight>` → `<PageHeader …/>` → `FixedDeskBoard`
(`<div className={BOARD_FRAME} data-fixed-desk="true">`: toolbar, filter bar, grid, save bar).

| id | Element | Look / behaviour (daily piece reused) | Home | Told |
|---|---|---|---|---|
| E1 | Page header | REAL `PageHeader`: title `t('fleet.nav.fixedRoster')`, breadcrumbs `fleet.module.title` → `/fleet` › `fleet.nav.fixedRoster`; NO `actions`, no subtitle. The only `<h1>` on the page. No day stepper, no title box in its place. | `pages/FixedRosterPage.tsx` (shell, every width) | T1, T15, Q2 |
| E2 | Toolbar row | `flex items-center justify-between` (the daily's `data-roster-toolbar` row, hook `data-fixed-toolbar`): START = the count `t(pluralKey('fleet.fixedRoster.carCount', locale, rows.length), { count: num(rows.length) })`, `role="status"`, `data-filtered-count`, `title={t('fleet.fixedRoster.matchedRows')}`, shown once the board answered; END = `ExcelPill name="fixed-roster"` (busy spinner, failure toast) exporting `rows` (the table, its order). Nothing else. | `components/roster/FixedDeskBoard.tsx` | T1, T12, T15, T22 |
| E3 | Filter bar | `DARK_FILTER_BAR` + `FilterBar hasActiveFilters={m.filtered} onClear={resetFilters}`: «كود السيارة» = `FilterWithIcon icon={FILTER_ICON.car}` (w-48) around `VehicleCodeFilter density="tight" fullWidth value={m.codes} options={m.codeOptions}` writing `?q=`; then `DeskCounters counters={m.counters} onApply={patch}` (one line, ‹ › arrows when it overflows). The red reset (FilterBar's) clears `q`, `mission`, `view`. NO «كل المهمات» dropdown. | `FixedDeskBoard.tsx` | T3, T19 |
| E3a | Counters | «إجمالي» (brand; clears mission + view) · «صيانة» (rose; view=workshop) · «بطقم» (emerald = `COUNTER_TONES.assigned`; view=crewed) · «بلا طقم» (YELLOW = `COUNTER_TONES.unmanned`; view=uncrewed) · one chip per ACTIVE mission (`missionTone`, toggles it in `?mission=`). Counted off the WHOLE draft, never the filtered rows; Latin digits; active = ring. | `lib/fixed-roster-model.ts` (`fixedCounters`) | T19, T12 |
| E4 | Table frame | `ROSTER_TABLE` (exported from `RosterDeskBoard.tsx`) + `useOverflowing`; `DataTable stickyHead minColumnWidth={4}`, `rowProps`: `data-car={row.code}`, `data-tint` = `'unsaved'` (in `m.unsavedIds`) else `'workshop'` (inMaintenance) else none; sort = the shell's (`code`, `state`). loading → `m.status.loading`; error + retry; `empty` = `EmptyState title={t('fleet.fixedRoster.noVehicles')}` when the board has no car, the table's own empty line when filters hide everything. | `FixedDeskBoard.tsx` | T10, T11 |
| E4.1 | «السيارة» | `VehicleHoverCode vehicleId code focusable={false} dir="ltr" className={cn('text-sm font-bold', FIGURE)}` — bold white, NO `vehicleColour`; hover card = today's daily facts (shared card, unchanged). `sortable`, `sortKey: 'code'`, `TIGHT_CELL`. | `FixedDeskBoard.tsx` | T11, T14 |
| E4.2 | «الحالة» | `FixedStatusCell`: stacked one-line badges, `size="sm"`: «في الورشة» (`info`, when inMaintenance) then «معيّنة» (`success`, `hasDriver`) or «بلا طقم» (`neutral`). Sortable, ranked workshop 0 / crewed 1 / none 2 (shell's `fixedSortValue`). | `components/roster/fixed-desk-cells.tsx` | T10 |
| E4.3 | «نوع المهمة» | Planner: `CatalogSelect kind="missionType" density="tight" className="w-full"` inside `MISSION_BOX`, `allLabel={t('fleet.fixedRoster.noMissionType')}`, aria-label `${code} · نوع المهمة`, click/mousedown stopped, NOT disabled for a workshop car → `m.actions.mission`. Viewer: the name, or `DASH`. | `FixedDeskBoard.tsx` | T10, T17 |
| E4.4 | «السائق الأول» / «السائق الثاني» | The daily `SeatCell` over `toSeatRow(row)` (`{...row, inMaintenance:false, planned:true}`), `facts = { expired: ∅, unavailable: ∅, transferFrom: m.transferFrom, person: m.person, reasonLabel: (r) => r }`, `pool={m.pool}` (FREE only), `searchIndex`, `emptyLabel={t('fleet.fixedRoster.poolEmpty')}`. Filled: green mark, name, code UNDER it, seat bin «إزالة من هذه الخانة» (seat 1 cleared → seat 2 promoted), draggable (planner), the strip «سيُنقل من السيارة 214 عند الحفظ» while the move is unsaved. Empty: dashed, drop target, «+ اختيار سائق» picker. Seat 2 while seat 1 is empty: «عيّن السائق الأول أولاً», not a target. Viewer: «بدون سائق», nothing draggable. NO amber frame, NO reason / licence badge (Q1). Drop: pool row or seated chip → `m.actions.assign` (other car = move, own other seat = swap, same seat = nothing). | `FixedDeskBoard.tsx` + `fixed-desk-cells.tsx` (adapter, facts) | T5, T7, T9, T12, Q1 |
| E4.5 | «ملاحظات» | `FixedNotesCell`: `DASH`, or `<span title={note} className="mx-auto block min-w-[5rem] max-w-[8rem] whitespace-normal break-words text-xs leading-snug line-clamp-3 [text-wrap:balance] max-[1535px]:min-w-[3.125rem]">` — at most 3 lines, the whole note on hover; the row never grows past 3 lines. | `fixed-desk-cells.tsx` | T21 |
| E4.6 | «إجراءات» | Planner only (the column is absent for a viewer). Pinned (`PINNED_CELL` / `PINNED_HEAD`, `PINNED_EDGE` while overflowing), `ACTION_GROUP` + `LAPTOP_ACTIONS`, `data-row-actions="fixed-roster"`: pen `actionTone('edit')` `data-edit-row={code}` aria «تعديل» on EVERY row (workshop too) → E6; swap `actionTone('transfer')` `SwapIcon` `data-swap-drivers={vehicleId}` aria «تبديل السائق الأول والثاني» when both seats hold somebody → `m.actions.swap`; bin `actionTone('delete')` `Trash2Icon` `data-clear-crew={code}` aria «إفراغ الطقم» when `hasDriver` → `m.actions.clearCrew` at once (mission + note kept, no confirm). | `FixedDeskBoard.tsx` | T6, T8, T17 |
| E5 | Drivers panel | `FixedDriversPanel`, the grid's second column (20rem; 18.25rem 1280–1535; 24rem ≥1750; gaps as the daily). Shell = the daily `DriversPanel` aside + `DESK_CONTROLS` (exported) with ONE heading in the tabs' place — «السائقون (n)» (`fleet.fixedRoster.driversTitle` + `Count`, n = `m.pool.length`), no tablist, no licence footer — then `DriverSearch` (its own term). List (`LIST_SCROLL`): `AvailableList options={m.availableFor(term, null)} person={m.person} onPick={null} licence={null} dayHasDrivers={(m.board?.drivers.length ?? 0) > 0} searched draggable={mayPlan} hoverCard part="list" freeBadge={false} emptyLabel={t('fleet.fixedRoster.poolEmpty')}`. Free drivers first (no «متاح» word), each draggable onto a seat; then «معيّنون على سيارات أخرى (n)» with the held-off-board drivers and a blue «سيارة أخرى». Empty: «لا يوجد سائقون بلا طقم ثابت»; a search with no hit: «لا يوجد سائق مطابق للبحث». Name hover = the driver card (today's daily facts). | `components/roster/FixedDriversPanel.tsx` | T9, T14, D1, D2 |
| E6 | Pen dialog | `FixedCrewDialog` (today's `EditCrewDialog` rules VERBATIM, moved out of the page): `Dialog open dismissOnOutsideClick={false}` title `${t('common.edit')} · ${code}`, description `t('fleet.fixedRoster.editHint')`; body: «نوع المهمة» `Select` over `useFleetCatalog('missionType')` (loading → disabled; failed → `missionTypesFailed`; empty → `noMissionTypesYet`); «السائق الأول» / «السائق الثاني» drawn as the daily `DriverSlot`: chosen → bordered row, name + code (local gap, D3) + ✕ `common.clear`, the transfer line under it when `m.transferFrom` says so; empty → secondary «اختيار سائق» → an inline list (`max-h-48`) of `m.dialogCandidates(vehicleId)` minus the other seat's pick, each row name + code, the blue «سيارة أخرى» on a held-off-board driver, nothing on a free one; nothing left → «لا يوجد سائقون بلا طقم ثابت». Seat 2 disabled with `needsFirstDriver` while seat 1 is empty; choosing «none» in seat 1 with seat 2 filled PROMOTES seat 2; the same person in both seats → `sameDriverTwice` and «حفظ» disabled. «ملاحظات» `Textarea rows={3} maxLength={500}`. «إلغاء» touches nothing; «حفظ» → `m.actions.apply` (ONE undo step; no step when nothing changed; '' → null). | `components/roster/FixedCrewDialog.tsx` | T18 (desk), T20 |
| E7 | Save bar | `EditsBar shape="floating"` in a `shrink-0` box at the frame's foot, only `mayPlan && m.dirty`: «تغييرات غير محفوظة», the count, «السيارات المعدَّلة:» + each edited code (tap → lift only the URL filters hiding that car — `fixedFiltersHiding` — then scroll its row to the centre), «تراجع» (disabled with no step), «إلغاء» (edited = dirty), «حفظ» (spinner). | `FixedDeskBoard.tsx` | T2 |
| E8 | Discard confirm | `Dialog` «إلغاء التغييرات» + `discardBody` + `CodeList` of the edited codes, when «إلغاء» is pressed with more than one edited car; one car discards at once. | `FixedDeskBoard.tsx` | T2 |

---------------------------------------------------------------------------------------------------

## 2. TABLET AND PHONE (< 1280 px) — `layout` phone (<768) · portrait (768–1023) · landscape (1024–1279); `short` = height < 500

Frame: the same shell header (E1) above `FixedTouchBoard` (`data-fixed-touch={layout}`), inside
the shell's `PageContainer fullHeight` (D5). The board draws NO `<h1>`, no stepper.

| id | Element | Look / behaviour (daily piece reused) | Home | Told |
|---|---|---|---|---|
| T-1 | First row | `CarSearch` («ابحث بكود السيارة…», this board's own state, not in the URL, ANDed with `?q=`/missions/view via `fixedTouchCars`) + `ExcelButton name="fixed-roster"` at the row's end (exports the cards drawn, in their order). Phone: `[CarSearch flex-1][Excel]`, scrolls away with the header. Portrait: the same row INSIDE the sticky header, above the filter row. Landscape: `[CarSearch w-[20rem]] [spacer] [Excel]`. One Excel per width. | `components/roster/FixedTouchBoard.tsx` | T4, T15 |
| T-2 | Filter row | `FilterButton` (badge = picked codes + missions + view; compact on phone) · `ResetChip` while filtered (also clears the typed code) · the counter chips (`CounterChips`, same counters as E3a; a tap on the ACTIVE state chip lets it go) · `DriversButton count={m.pool.length} label={t('fleet.fixedRoster.driversTitle')}` (phone: icon + number; portrait: «السائقون» + number) → the drivers sheet. Sticky on phone/portrait unless `short`; landscape: no drivers button (the panel is always there). The active chip is scrolled into sight. | `FixedTouchBoard.tsx` | T4, T19 |
| T-3 | Car cards | The daily `CarCard` over `toCardRow(row)` (`{...row, planned:true}`) with `workshopLock={false}`, `badges={<FixedRowBadges row={row} />}` («في الورشة» `InWorkshopBadge`, «معيّنة» / «بلا طقم»), `menu={{ edit: t('common.edit'), clear: t('fleet.fixedRoster.clearCrew'), canClear: hasDriver }}`. In CODE ORDER (`m.visible` after the typed code) — no «في الورشة (n)» group, no lock. Head: bold code + unsaved dot; mission pill (tap → T-8); ⋮ «تعديل» (note → T-9) and «إفراغ الطقم» (at once). Seats: caption, name, code; empty dashed «اختيار سائق»; ✕ clears; swap button between the seats when both are filled (stacked bracket on a phone); the transfer strip; amber card while unsaved. Empty: «لا توجد سيارة بهذا الكود» when the typed code finds no car, else «لا توجد نتائج»; no cars at all: «لا توجد سيارات». Loading → `LoadingState`; error → `ErrorState` + retry. | `FixedTouchBoard.tsx` + `components/roster/fixed-touch-parts.tsx` | T4–T8, T10, T18 |
| T-4 | Picker sheet (phone, portrait) | `BottomSheet name="picker" tall`: title `t('fleet.roster.assignTitle', {code})`, subtitle «السائق الأول» (· the occupant's name); toolbar = `DriverSearch` only (no tabs); body `AvailableList onPick occupant licence={null} freeBadge={false} emptyLabel=poolEmpty`: free drivers, then «معيّنون على سيارات أخرى (n)»: drivers the draft seats on OTHER cars of this board with that car's code (pick = MOVE + the transfer strip) and the held-off-board ones with blue «سيارة أخرى» (pick = seat; the save refuses — T16). The occupant row offers «إزالة من هذه الخانة». | `FixedTouchBoard.tsx` | T5, T9 |
| T-5 | Drivers sheet (phone, portrait) | `BottomSheet name="pool" tall`: title «السائقون», NO subtitle (no date); toolbar = `poolHint` (planner) + `DriverSearch`; body `AvailableList onPick={null} onIdlePick` (planner: choose first → the sheet closes, the green banner «يُعيَّن الآن: {name} — اختر له خانة في إحدى السيارات.» with ✕, the next seat tap places him), `freeBadge={false}`, `emptyLabel`. | `FixedTouchBoard.tsx` | T5, T9 |
| T-6 | Landscape split | cars 60% (`data-cars-column`, own scroll) · drivers 40% aside: planner banner (target «يُعيَّن الآن: السيارة {code} · {slot}» / pending driver / `pickSlotHint`), the heading «السائقون (n)» (no tabs), `DriverSearch`, the list (`onPick` while a seat is the target, otherwise `onIdlePick`; `draggable` for a mouse). A seat tap makes it the target (tap again = off); the targeted car scrolls into view. | `FixedTouchBoard.tsx` | T5 |
| T-7 | Filters sheet | the daily `FiltersSheet`: «كود السيارة» buttons (`?q=`), «نوع المهمة» multi («كل المهمات» + each active mission with its count), footer reset (+ typed code) and «عرض النتائج (n)» (n = cards drawn). | `FixedTouchBoard.tsx` | T3 |
| T-8 | Mission sheet | the daily `MissionSheet` with `title={`${t('common.edit')} · ${code}`}` and `notice` = the catalog line (`missionTypesFailed` / `noMissionTypesYet`) when the catalog failed / is empty; «بدون نوع مهمة» + every active mission. Workshop car: allowed. | `FixedTouchBoard.tsx` | T18 |
| T-9 | Notes sheet | the daily `NotesSheet` with `title` «تعديل · {code}», `subtitle` «ملاحظات», `maxLength={500}`; «حفظ» writes the DRAFT (`m.actions.notes`). | `FixedTouchBoard.tsx` | T18 |
| T-10 | Discard confirm | `ConfirmSheet name="discard"` when «إلغاء» with more than one edited car. (No clear confirm — D7.) | `FixedTouchBoard.tsx` | T2, T8 |
| T-11 | Save bar | `EditsBar` phone (two rows) / portrait strip / landscape floating, bottom sticky, only `mayPlan && m.dirty`; a code tap lifts the typed code and the hiding URL filters, then scrolls its card to the centre. | `FixedTouchBoard.tsx` | T2 |

---------------------------------------------------------------------------------------------------

## 3. States (both widths)

| State | Desk | Touch |
|---|---|---|
| Loading | header + toolbar (no count yet) + DataTable spinner; panel list empty | header + first row + filter row + `LoadingState` |
| Error | DataTable error + «إعادة المحاولة» (`m.status.retry`) | `ErrorState` + retry |
| Empty board | «لا توجد سيارات» | «لا توجد سيارات» |
| Filtered to nothing | the table's empty line; the reset is lit | «لا توجد نتائج» / «لا توجد سيارة بهذا الكود» |
| Read-only viewer (no `fleetRoster.plan`) | no «إجراءات» column, no picker, no seat bin, nothing draggable, mission as text, empty seat «بدون سائق», no save bar | no ⋮, seats are plain rows, mission pill not a button («—» when none), no pool hint, no "driver first", no target, no save bar |
| Branch view (branch switcher) | the server answers that branch's ACTIVE cars only; drivers company-wide; anyone fixed to a car of another branch appears under «معيّنون على سيارات أخرى» with «سيارة أخرى» | same |
| Draft restored (reload) | the draft from sessionStorage (`ecms.fleet.fixedRoster.draft`); amber rows; save bar with the edited codes; «تراجع» disabled (history starts again) | same, amber cards + dots |
| Save refused | `toast.error(fixedSaveRefusal(…))` — Arabic, the driver's name and the holding car's code (or «سيارة أخرى…»), never English, never an id; draft AND undo steps stay | same |
| Saved | `toast.success(t('fleet.fixedRoster.saved'))`; draft dropped (storage too), undo cleared, tints gone | same |

No state shows an availability word, an absence, a licence or profile flag (Q1).

---------------------------------------------------------------------------------------------------

## 4. Every function of today's `FixedRosterPage.tsx` → its place in the new screen

| # | Today (line refs in the current file) | New home |
|---|---|---|
| F1 | `PageContainer fullHeight` + `PageHeader` title/breadcrumbs (1065–1076) | shell, every width; `actions` removed (Q2) |
| F2 | `ExportSheetButton` in the header + `exportSheet` (881–909): 8 cols (م, السيارة, في الورشة, الحالة, نوع المهمة, السائق الأول, السائق الثاني, ملاحظات), the rows on screen (draft) in table order, no signature, file «الطقم الثابت» | `m.actions.exportSheet(rows)` (model, same columns/values) via `ExcelPill` (desk toolbar) / `ExcelButton` (touch first row) |
| F3 | URL keys `q`, `mission`, `view`, `sort` + `useRememberedFilters(['mission','q','sort','view'])` (100, 505–538) | shell (unchanged keys and remembered set) |
| F4 | `readFixedView` / `visibleFixedRows` narrowing (530, 692–703) | model `visible` (code order); shell sorts it for the desk |
| F5 | sort `code` / `state` + `DEFAULT_SORT 'code:asc'` + `fixedSortValue` + `clickSort` (92–98, 499, 771–774) | shell (verbatim strings — source specs pin them) |
| F6 | `VehicleCodeFilter` 160px (1094–1100) | desk filter bar (daily w-48 `FilterWithIcon`); touch: FiltersSheet codes + `CarSearch` |
| F7 | `CatalogMultiSelect` «كل المهمات» (1104–1113) | REMOVED on desk (T3); touch FiltersSheet «نوع المهمة»; chips on both |
| F8 | counters (597–656) | model `fixedCounters`; «بلا طقم» yellow (T19) |
| F9 | reset (1173–1185) | desk `FilterBar` reset; touch `ResetChip` + sheet reset |
| F10 | «لديك تغييرات غير محفوظة» + «إلغاء» + «حفظ» in the strip (1190–1214) | `EditsBar` (+ edited codes, «تراجع», discard confirm) |
| F11 | `changedRows` / `pending` / `dirty` (558–559) | model (`changed`, `dirty`) |
| F12 | unsaved row tint `UNSAVED_ROW` (571, 1237) | desk `data-tint="unsaved"` (ROW_TINTS amber); touch amber card + dot |
| F13 | `useDraftBoard(FIXED_ROSTER_DRAFT_KEY, saved, ROSTER_EDITABLE_FIELDS)` (551–556) | model (same call, same key) |
| F14 | the 7 columns (918–1060) | desk table E4.1–E4.6 |
| F15 | `CrewCarCode` coloured code + hover card (476–497) | `VehicleHoverCode` bold, no colour (T11), same hover card |
| F16 | «الحالة» badges (941–956) | `FixedStatusCell` |
| F17 | mission select in the cell (957–994) + `setMission` via `applyEdit` (853–861) | desk E4.3 → `m.actions.mission`; touch pill → MissionSheet |
| F18 | `CrewSlotCell`: drop zone, draggable chip, `DriverSlotPicker`, slot bin, «الأول قبل الثاني», viewer words (342–463) | daily `SeatCell` over `toSeatRow` (desk); `CarCard` seats (touch) |
| F19 | `drop` = `assignDriver` (781–787) | `m.actions.assign` |
| F20 | `clearSlot` (837–838) | `m.actions.clear` |
| F21 | bin «إفراغ الطقم» = `clearCrew` (1041–1054) | desk bin + touch ⋮, no confirm |
| F22 | pen → `EditCrewDialog` (110–322, 1352–1363) | `FixedCrewDialog` (desk) → `m.actions.apply`; touch: ⋮ «تعديل» = note only, pill = mission, seats = drivers (T18) |
| F23 | the pool = `availableDrivers(drivers, draft)` + the «سيارة أخرى» exception badge (676–679, 1305–1341) | model `pool` (free) + `heldOff`; lists per D1/D2 |
| F24 | driver search over pool + seated (`records`, `searchIndex`, `filterDrivers`) (713–759) | model `searchIndex` + each list's own term |
| F25 | `driverName` for the file (766–769) | model `driverName` |
| F26 | `missionTypeName` (663–670) | model `missionName` |
| F27 | `commit` → `useSaveFixedRoster`, success toast, refusal toast, draft kept (789–822) | `m.actions.save`; refusal → `fixedSaveRefusal` (Arabic, T16) |
| F28 | `discard` / `acceptDraft` (551–556, 1201) | `m.actions.discard` (+ undo cleared) / accept on success |
| F29 | loading / error + retry / empty «لا توجد سيارات» (1238–1243) | desk DataTable; touch `LoadingState` / `ErrorState` / empty line |
| F30 | `mayPlan = can('fleetRoster.plan')` gating every edit (507) | shell → `query.mayPlan` → model + boards |
| F31 | drag state `dragging` / `over` (658–659) | desk board state (SeatCell props) |
| F32 | driver chip hover card (`DriverChip`) | `SeatPerson` driver card (desk seat), `hoverCard` names (desk panel) |
| F33 | panel title «السائقون (n)» + search + empty lines (1259–1297) | `FixedDriversPanel` heading; touch sheet/landscape heading |

Nothing is lost. Added: undo, edited codes, discard confirm, swap, transfer strip, touch cards /
sheets / search, the Arabic refusal line, the plural count.

---------------------------------------------------------------------------------------------------

## 5. Told items 1–21 → elements

| Told | Elements |
|---|---|
| 1 daily look, no day, count under the title | E1, E2, E3, T-1, T-2; no stepper anywhere |
| 2 save bar, edited codes, undo, discard asks, draft survives a reload, undo restarts | E7, E8, T-10, T-11, state "draft restored" |
| 3 no «كل المهمات» on desk; mission in «عوامل التصفية» on touch | E3, T-7 |
| 4 touch cards, search + Excel under the title, drivers button (icon + number on phone), code order | T-1, T-2, T-3 |
| 5 tap a seat → list incl. drivers on other cars (move); or driver first | T-4, T-5, T-6 |
| 6 swap: desk «إجراءات», touch between the seats | E4.6, T-3 |
| 7 «سيُنقل من السيارة 214 عند الحفظ» | E4.4, T-3, E6 |
| 8 «إفراغ الطقم» both seats, mission + note kept, no question | E4.6, T-3 ⋮ |
| 9 driver list face (name, code under), no «متاح», free first, «معيّنون على سيارات أخرى» + blue «سيارة أخرى», «لا يوجد سائقون بلا طقم ثابت» | E5, T-4, T-5, T-6, E4.4 |
| 10 workshop row rose, still editable; touch card in place | E4 tint, E4.3, E4.6, T-3, D9 |
| 11 code bold white, no per-car colour | E4.1, T-3 |
| 12 Latin digits | E2, E3a, every `num()` / `Count` |
| 13 no absent / leave here | Q1 + no availability data on this board |
| 14 hover cards = today's daily facts | E4.1, E4.4, E5 (shared cards unchanged) |
| 15 one Excel «تصدير Excel» under the title on the left, same file | E1, E2, T-1, F2 |
| 16 refusal: Arabic, driver's name + holding car (build change) | `fixedSaveRefusal` + server details; draft kept |
| 17 permissions; viewer: no «إجراءات», no save bar; branch picks cars, drivers company-wide | state table, E4.6, E7 |
| 18 touch ⋮ «تعديل» = note only; mission pill; seats; desk pen = all four | T-3, T-8, T-9, E6 |
| 19 «بلا طقم» yellow, rose = workshop only, tap filters | E3a |
| 20 pen dialog seats like the daily DriverSlot, same rules | E6 |
| 21 notes 3 lines max, hover shows all, the table fits | E4.5 |
