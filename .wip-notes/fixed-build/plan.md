# «الطقم الثابت» — the build plan (one PR)

TEMPORARY (inside `.wip-notes/`, removed before the PR). Written 2026-11-18 on the new machine.
Read first: `.wip-notes/fixed-roster-spec.md` (binding: Q1 ب, Q2 ج, the told list) and
`.wip-notes/fixed-build/design.md` (the element-by-element design, decisions D1–D13, every
function of today's page → its new home, told 1–21 → elements). This file says WHO builds WHAT.

Tree: `/home/user/egycash`, branch `claude/fleet-progress-status-yvgr3f`, base `2b9467a3`.
A package's work = `git diff 2b9467a3 -- . ':!.wip-notes'`. The parent may make signed WIP commits
at any time; never revert or amend them. Do NOT commit unless your step says so. Never push, never
touch a PR, never publish. Edit only inside `/home/user/egycash`.

Web paths are relative to `apps/web/src/modules/fleet/` unless they start with `apps/`, `packages/`,
`docs/` or `CHANGELOG`.

---------------------------------------------------------------------------------------------------

## 0. Rules every package follows

- MEMORY (16 GB, no swap): never two vitest runs at once, ACROSS packages too. Every `vitest`,
  `tsc`/`npm run typecheck` and `npm run build` goes through ONE lock:
  `LOCK=/tmp/claude-0/-home-user/85f289ec-521b-5944-9b89-a0120b22d71a/scratchpad/fixed-build/heavy.lock`
  `flock "$LOCK" <command>`. API specs one file at a time with `--maxWorkers=1`.
- Web specs: `cd /home/user/egycash/apps/web && flock "$LOCK" npx vitest run <file …>`.
  Web types: `cd /home/user/egycash && flock "$LOCK" npm run typecheck -w apps/web`.
  Lint your files: `cd /home/user/egycash && npx eslint <your files>`.
- `exactOptionalPropertyTypes` and `verbatimModuleSyntax` are ON: an optional prop a caller may pass
  as `undefined` is typed `?: T | undefined`; type-only imports use `import { type X }`.
- STRICT OWNERSHIP: edit only the files your package lists. A change you need in another package's
  file → write it in your hand-off (`.wip-notes/fixed-build/handoff-<pkg>.md`) and tell the parent.
- New i18n words → `.wip-notes/fixed-build/i18n/<pkg>.json`, shape
  `{ "<key>": { "ar": "…", "en": "…" } }`, formal Arabic, Latin digits, the SAME `{{placeholders}}`
  in both. Use exactly the keys in §6 (add one only if truly needed, and say so in the hand-off).
  Never edit `i18n.ts`. Until the HUB merges, `t(key)` returns the key itself: assert with
  `t('…')` (not literal Arabic) so a spec passes before AND after the merge; an assertion that needs
  the real Arabic (e.g. "no Latin letter") is allowed but listed in the hand-off as
  "green after the HUB merge".
- Formal Arabic in the UI (`scripts/check-formal-arabic.mjs`), Latin digits (`num()`), no English
  shown to an Arabic reader, no internal id shown. Never print card numbers or PINs.
- `zz-*` scratch only (git-excluded) and gone at the end; screenshots and logs →
  `/tmp/claude-0/-home-user/85f289ec-521b-5944-9b89-a0120b22d71a/scratchpad/fixed-build/`.
- THE DAILY «تعيين السيارات» MUST NOT CHANGE in behaviour or look: a daily file gains only an
  OPTIONAL prop whose default is today's exact output, or the `export` keyword on an existing const.
  No daily spec may need editing because of a package (if one does, stop and hand it to the HUB).
- Fixed save rules, API semantics and data do not change: soft delete only, no migration, no new
  contract field (Q1), the server's refusal gains DETAILS only (read-side).

---------------------------------------------------------------------------------------------------

## 1. Packages at a glance (each file has exactly one owner)

| Package | Area | Builds | Depends on |
|---|---|---|---|
| `api` | api | the fixed save's refusals carry details (driver id, holding car's code in scope, refusal kind) | — |
| `core` | web | the board MODEL, the Arabic refusal line, the swap rule, the page SHELL (header, URL, layout pick), every optional prop on the daily pieces, the spec-sources helper | api's detail codes (§4.4, literal strings — no wait needed) |
| `desk` | web | the computer's board, its cells, the drivers panel, the pen dialog; rewrites `fleet-fixed-roster.spec.tsx` as the screen + desk spec | core (§4 interfaces) |
| `touch` | web | the phone / tablet board and its parts; new touch spec | core (§4 interfaces) |
| HUB (last) | both | i18n merge, CHANGELOG, design doc, the shared census specs, dead keys, the full gate | all |

Start order: `api`, `core`, `desk`, `touch` start together. `core` lands §4.1–§4.3 (types +
optional props + `DriversHeading`) as its FIRST step; `desk` / `touch` write their components against
§4 at once and run their specs only after `lib/fixed-roster-model.ts` and `pages/FixedRosterPage.tsx`
exist (poll with `test -f`). `core`'s shell imports `components/roster/FixedDeskBoard.tsx` and
`components/roster/FixedTouchBoard.tsx` with the props of §4.2 — red typecheck there until `desk` /
`touch` land is expected.

---------------------------------------------------------------------------------------------------

## 2. File map

### New files (owner)
| File | Owner |
|---|---|
| `lib/fixed-roster-model.ts` | core |
| `lib/fixed-roster-model.spec.ts` | core |
| `lib/fixed-save-refusal.ts` | core |
| `lib/fixed-save-refusal.spec.ts` | core |
| `fixed-roster-spec-sources.ts` (like `roster-spec-sources.ts`, not a spec) | core |
| `components/roster/roster-optional-props.spec.tsx` | core |
| `components/roster/FixedDeskBoard.tsx` | desk |
| `components/roster/fixed-desk-cells.tsx` | desk |
| `components/roster/FixedDriversPanel.tsx` | desk |
| `components/roster/FixedCrewDialog.tsx` | desk |
| `components/roster/FixedTouchBoard.tsx` | touch |
| `components/roster/fixed-touch-parts.tsx` | touch |
| `fleet-fixed-roster-touch.spec.tsx` | touch |

### Changed files (owner)
| File | Change | Owner |
|---|---|---|
| `apps/api/src/modules/fleet/fixed-roster/fixed-roster.service.ts` | refusal details (§4.4) | api |
| `apps/api/tests/integration/fleet.spec.ts` | cases in the «fixed crew» describe | api |
| `packages/contracts/src/modules/fleet.ts` | OPTIONAL, comment only: the fixed-crew header says «no mission, no notes» (stale since 1.22) | api |
| `pages/FixedRosterPage.tsx` | rewritten as the shell (§4.2) | core |
| `lib/fixed-roster-board.ts` | `swapDrivers` (pure, = `assignDriver(rows, id, 'driver1EmployeeId', row.driver2EmployeeId)`), the orphaned `clearSlot` doc block moved onto `clearSlot` (stale comment) | core |
| `lib/fixed-roster-board.spec.ts` | swap cases | core |
| `components/roster/RosterDeskBoard.tsx` | `export` on `FIGURE`, `ROW_TINTS`, `LAPTOP_GUTTERS`, `LAPTOP_ACTIONS`, `TIGHT_CELL`, `PINNED_CELL`, `PINNED_HEAD`, `PINNED_EDGE`, `ROSTER_TABLE`, `MISSION_BOX`, `useOverflowing` — nothing else | core |
| `components/roster/roster-desk-parts.tsx` | `ExcelPill` `name`; `export` on `DESK_CONTROLS`, `LIST_SCROLL` | core |
| `components/roster/roster-desk-cells.tsx` | `SeatCell` `emptyLabel` (forwarded to the picker) | core |
| `components/roster/roster-drivers.tsx` | `AvailableList` `freeBadge`, `emptyLabel`; new `DriversHeading` | core |
| `components/roster/roster-touch-parts.tsx` | `ExcelButton` `name`; `DriversButton` `label`; `MissionSheet` `title`, `notice`; `NotesSheet` `title`, `subtitle`, `maxLength` | core |
| `components/roster/RosterCarCard.tsx` | `CarCard` `workshopLock`, `badges`, `menu` | core |
| `components/DriverSlotPicker.tsx` | `emptyLabel` | core |
| `fleet-fixed-roster.spec.tsx` | rewritten: the screen + the computer's board | desk |
| `apps/web/src/platform/localization/i18n.ts` | merge §6 (ar + en) | HUB |
| `CHANGELOG.md` | one `[Unreleased]` entry | HUB |
| `docs/12-planning/fleet-module-design.md` | §4.5b as built + row 1.25 | HUB |
| `fleet-sort-arrows.spec.tsx`, `fleet-vehicle-card-census.spec.tsx`, `lib/vehicle-code-selectors.spec.ts` (+ any other shared spec that goes red) | the fixed columns now live in `FixedDeskBoard.tsx` | HUB |

### Not touched
`EmployeeName.tsx` (D3), `RosterTouchBoard.tsx`, `RosterBottomSheet.tsx`, `RosterAssignDialog.tsx`,
`pages/RosterPage.tsx`, `lib/roster-board.ts`, `lib/daily-roster-board.ts`, `lib/roster-view.ts`,
`lib/roster-layout.ts`, `lib/useDraftBoard.ts`, `lib/draft-storage.ts`, `api/*`, `routes.tsx`,
`shared/*`, `roster-spec-sources.ts`, every daily spec (verify only).

---------------------------------------------------------------------------------------------------

## 3. What the shell keeps (core) — `pages/FixedRosterPage.tsx`

```tsx
export const FixedRosterPage = (): JSX.Element => {
  const { layout, short } = useRosterLayout();          // the daily rule: ≥1280 desk, else touch
  return <FixedRosterScreen layout={layout} short={short} />;
};
/** Exported for specs: render any layout without a window (renderToStaticMarkup → 'desktop'). */
export const FixedRosterScreen = ({ layout, short = false }: { layout: RosterLayout; short?: boolean }) => …
```
Keeps, VERBATIM where source specs pin it: `const REMEMBERED_FILTERS = ['mission', 'q', 'sort', 'view'] as const;`
+ `useRememberedFilters([sp, setSp], REMEMBERED_FILTERS)`; `const sortParam = sp.get('sort');`;
`const sorts = useMemo(() => readSorts(sortParam, DEFAULT_SORT), [sortParam]);`;
`const DEFAULT_SORT = 'code:asc';`; `fixedSortValue` with
`if (key === 'state') return row.inMaintenance ? 0 : hasDriver(row) ? 1 : 2;` and the code key
`fleetVehicleCodeOrderKey(row.code)`; `readList(sp, 'mission')`; `readFixedView(sp.get('view'))`;
`patch`; `mayPlan = can('fleetRoster.plan')`; `resetFilters = () => patch({ q: null, mission: null, view: null })`;
`changeSort` via `clickSort`/`writeSorts`; `rows = sortRows(m.visible, sorts, fixedSortValue, (a, b) => compareFleetVehicleCodes(a.code, b.code))`.
Renders (every width, Q2):
```tsx
<PageContainer fullHeight>
  <PageHeader title={t('fleet.nav.fixedRoster')}
    breadcrumbs={[{ label: t('fleet.module.title'), to: '/fleet' }, { label: t('fleet.nav.fixedRoster') }]} />
  {layout === 'desktop'
    ? <FixedDeskBoard m={m} query={query} resetFilters={resetFilters} rows={rows} sort={sorts} onSortChange={changeSort} />
    : <FixedTouchBoard m={m} query={query} resetFilters={resetFilters} layout={layout} short={short} />}
</PageContainer>
```
No `actions`, no `ExportSheetButton` import anywhere in the fixed files. The model lives HERE, above
both boards, so a rotate across 1280 keeps the draft and its undo steps. Header comment rewritten to
describe the screen as built (the old header's stale lines go with it: "a reload … keeps the saved
crews", «نوع المهمة»/«ملاحظات» "always «—»", the orphan "Remembered across visits" and "The order
this screen opens in" docs, the per-car colour — these are the stale comments of the page).

---------------------------------------------------------------------------------------------------

## 4. Interfaces (binding for every package — write against these exactly)

### 4.1 The model — `lib/fixed-roster-model.ts` (core)

```ts
import { type FleetFixedCrewRowDto, type FleetFixedRosterDto, type FleetPersonDto,
  type FleetRosterRowDto } from '@ecms/contracts';
import { type MultiSelectOption } from '../../../shared/ui/MultiSelect';
import { type CrewSlot, type FixedCrewPayloadRow } from './fixed-roster-board';
import { type FixedRosterView } from './roster-view';
import { type DriverOptions, type MissionOption, type RosterCounter } from './roster-board';
import { type DriverSearchRecord } from './driver-search';
import { type TableSort } from './table-sort';
import { type TouchLayout } from './roster-layout';

export type FixedRosterDriver = FleetFixedRosterDto['drivers'][number];

/** What the shell reads off the URL and hands down. No date anywhere. */
export interface FixedRosterQuery {
  mayPlan: boolean;
  /** The raw `?q=` — the comma list of picked car codes. */
  search: string;
  missions: readonly string[];
  view: FixedRosterView | null;
  patch: (updates: Record<string, string | null>) => void;
}

export interface FixedSeatTarget { vehicleId: string; slot: CrewSlot }

/** The pen dialog's four facts. */
export interface FixedEditValues {
  missionTypeId: string | null;
  driver1EmployeeId: string | null;
  driver2EmployeeId: string | null;
  notes: string | null;
}

export interface FixedRosterActions {
  /** Drop, picker, tap: `assignDriver` (another car = move, own other seat = swap, same seat = nothing). */
  assign(target: FixedSeatTarget, employeeId: string): void;
  /** One seat (seat 1 cleared → seat 2 promoted): `clearSlot`. */
  clear(vehicleId: string, slot: CrewSlot): void;
  /** Both seats trade places: `swapDrivers` (no-op, no step, unless both are filled). */
  swap(vehicleId: string): void;
  /** «إفراغ الطقم»: both seats in one write, mission and note KEPT, no confirm: `clearCrew`. */
  clearCrew(vehicleId: string): void;
  /** The mission alone, via `applyEdit`. A car the workshop holds is allowed (fixed rule). */
  mission(vehicleId: string, missionTypeId: string | null): void;
  /** The note alone, via `applyEdit`; trimmed, '' → null. */
  notes(vehicleId: string, notes: string): void;
  /** The pen dialog: ONE undo step via `applyEdit`; nothing changed → no step. */
  apply(vehicleId: string, values: FixedEditValues): void;
  /** «تراجع»: the draft as it was before the last edit. */
  undo(): void;
  /** «إلغاء»: the draft (memory + storage) AND the undo steps. */
  discard(): void;
  /** «حفظ»: toasts itself (saved / `fixedSaveRefusal`); true when stored; a refusal keeps draft + steps. */
  save(): Promise<boolean>;
  /** The 8-column sheet of the rows given, in the order given (today's `exportSheet`, same words). */
  exportSheet(rows: readonly FleetFixedCrewRowDto[]): void;
}

export interface FixedRosterBoardModel {
  board: FleetFixedRosterDto | undefined;
  status: { loading: boolean; error: unknown; retry: () => void };
  saved: FleetFixedCrewRowDto[];
  /** The draft (restored from storage on a reload) — what every board draws and edits. */
  draft: FleetFixedCrewRowDto[];
  /** `draft` narrowed by `q` (whole codes), the missions and the view, in CODE ORDER. */
  visible: FleetFixedCrewRowDto[];
  /** The picked codes of `?q=`. */
  codes: string[];
  /** Every car of the board, code order, as the code filter's options. */
  codeOptions: MultiSelectOption[];
  /** `q`, a mission or a view narrows the board. */
  filtered: boolean;
  /** «إجمالي» brand · «صيانة» rose · «بطقم» emerald · «بلا طقم» YELLOW (`COUNTER_TONES.unmanned`) · one per active mission. Whole draft. */
  counters: RosterCounter[];
  /** Active missions, each with its count on the draft. */
  missionOptions: MissionOption[];
  /** '—' for null or an id the catalog does not (yet) name. */
  missionName: (id: string | null) => string;
  /** The `missionType` catalog's state, for the dialog / sheet lines. */
  missionCatalog: { loading: boolean; failed: boolean; empty: boolean };
  /** The save payload (`changedRows(saved, draft)`) — also what «إلغاء» throws away. */
  changed: FixedCrewPayloadRow[];
  unsavedIds: ReadonlySet<string>;
  dirty: boolean;
  undoDepth: number;
  saving: boolean;
  /** FREE drivers: no seat in the draft and not held on a car off this board (D2). */
  pool: FixedRosterDriver[];
  /** Drivers the SERVER holds on a car that is not on this board (D1). */
  heldOff: FixedRosterDriver[];
  searchIndex: ReadonlyMap<string, DriverSearchRecord>;
  person: (employeeId: string) => FleetPersonDto | undefined;
  /** `fullNameAr`, else the id's tail (the sheet's rule today); '' for nobody. */
  driverName: (employeeId: string | null) => string;
  codeOf: (vehicleId: string) => string;
  /** The car a save would MOVE him off («سيُنقل من السيارة …»): his SAVED seat on another car. */
  transferFrom: (employeeId: string, vehicleId: string) => string | null;
  /**
   * The list for a pick, searched by name or code. free = `pool`; flagged = [] (Q1);
   * seated = (target ? drivers the draft seats on ANOTHER car of this board, with that car's code : [])
   *          + ALWAYS the held-off-board drivers the draft seats nowhere, as state 'seated' with
   *          seatedCode null (→ the shared list paints the blue «سيارة أخرى»); elsewhere = [].
   * licenceExpired is always false. The target car's own crew is left out (the swap is its own button).
   */
  availableFor: (term: string, target: FixedSeatTarget | null) => DriverOptions;
  /** The pen dialog's candidates (today's EditCrewDialog rule): every driver with no seat in the
   *  draft (free + held-off) PLUS this car's own crew. */
  dialogCandidates: (vehicleId: string) => string[];
  actions: FixedRosterActions;
}

export const useFixedRosterBoard = (query: FixedRosterQuery): FixedRosterBoardModel;

// Pure pieces, exported for the boards and the specs:
export const fixedEditStep: (draft: readonly FleetFixedCrewRowDto[],
  change: (rows: readonly FleetFixedCrewRowDto[]) => FleetFixedCrewRowDto[]) => FleetFixedCrewRowDto[] | null;
export interface FixedUndo { base: readonly FleetFixedCrewRowDto[]; steps: readonly FleetFixedCrewRowDto[][] }
export const fixedUndoSteps / pushFixedUndo / popFixedUndo  // one stack, lapses when `saved` changes identity; UNDO_LIMIT (50) from roster-board
export const fixedCounters: (draft, activeMissions: { id: string; label: string }[],
  narrowing: { missions: readonly string[]; view: FixedRosterView | null }, t) => RosterCounter[];
export const fixedFiltersHiding: (row: FleetFixedCrewRowDto,
  narrowing: { search: string; missions: readonly string[]; view: FixedRosterView | null }) => Record<string, null>;
export const fixedTouchCars: (visible: readonly FleetFixedCrewRowDto[], all: readonly FleetFixedCrewRowDto[],
  carTerm: string) => { searching: boolean; drawn: FleetFixedCrewRowDto[]; termFinds: boolean };
  // drawn = visible ∩ matchesVehicleCode(term), in code order — NO workshop split
export const toSeatRow: (row: FleetFixedCrewRowDto) => FleetRosterRowDto;  // {...row, inMaintenance: false, planned: true}
export const toCardRow: (row: FleetFixedCrewRowDto) => FleetRosterRowDto;  // {...row, planned: true}
export interface FixedDeskBoardProps { m: FixedRosterBoardModel; query: FixedRosterQuery;
  resetFilters: () => void; rows: FleetFixedCrewRowDto[]; sort: TableSort[]; onSortChange: (key: string) => void }
export interface FixedTouchBoardProps { m: FixedRosterBoardModel; query: FixedRosterQuery;
  resetFilters: () => void; layout: TouchLayout; short: boolean }
```
Hook internals (core): `useFixedRoster()`, `useSaveFixedRoster()`, `useFleetCatalog('missionType')`,
`useDraftBoard(FIXED_ROSTER_DRAFT_KEY, saved, ROSTER_EDITABLE_FIELDS)` (THE REAL CALL, key without a
date), the daily `inFlight` ref trick (two edits in one tap fold), every edit gated by `mayPlan` and
measured by `fixedEditStep`; names from ONE people map (`useFleetPeopleMap` from
`components/EmployeeName`), so `person` / `searchIndex` / the refusal's `nameOf` resolve any driver;
`save`: `mutateAsync({ rows: changed })` → `accept()` + forget steps + `toast.success(t('fleet.fixedRoster.saved'))`,
refusal → `toast.error(fixedSaveRefusal(error, { t, locale, nameOf }))`, draft + steps kept.

### 4.2 Board props (desk / touch implement; core's shell calls)
`export const FixedDeskBoard = (props: FixedDeskBoardProps): JSX.Element` in
`components/roster/FixedDeskBoard.tsx`; `export const FixedTouchBoard = (props: FixedTouchBoardProps): JSX.Element`
in `components/roster/FixedTouchBoard.tsx`. Neither renders `PageContainer`, `PageHeader` or an `<h1>`.

### 4.3 Optional props on the daily pieces (core) — default = today's exact output
| Piece | New prop(s) | Default | Fixed passes |
|---|---|---|---|
| `ExcelPill` (roster-desk-parts) | `name?: string` → `data-export` | `'roster'` | `'fixed-roster'` |
| `ExcelButton` (roster-touch-parts) | `name?: string` → `data-export` | `'roster'` | `'fixed-roster'` |
| `DriversButton` | `label?: string` → `aria-label` + `title` | `t('fleet.roster.availableTitle')` | `t('fleet.fixedRoster.driversTitle')` |
| `DriverSlotPicker` | `emptyLabel?: string` (the "nobody to offer" line) | `t('fleet.roster.availableEmpty')` | `t('fleet.fixedRoster.poolEmpty')` |
| `SeatCell` (roster-desk-cells) | `emptyLabel?: string` → its `DriverSlotPicker` | unset (picker default) | poolEmpty |
| `AvailableList` (roster-drivers) | `freeBadge?: boolean` (the «متاح» badge on a free row); `emptyLabel?: string` (both "nobody available" lines) | `true`; `t('fleet.roster.availableEmpty')` | `false`; poolEmpty |
| `DriversHeading` (NEW export, roster-drivers) | `{ label: string; count: number; className?: string }` — one line in the tabs' place, the selected tab's face (emerald words, `Count`), no tablist role | — | desk panel, touch sheet/landscape |
| `MissionSheet` | `title?: string`; `notice?: ReactNode` (a line above the options) | `t('fleet.roster.assignTitle', { code })`; none | «تعديل · {code}»; the catalog line |
| `NotesSheet` | `title?`, `subtitle?: string`; `maxLength?: number` | assignTitle; `t('fleet.roster.editAssignment')`; none | «تعديل · {code}»; `t('fleet.attendance.fields.notes')`; `500` |
| `CarCard` | `workshopLock?: boolean` (false: `locked = false`, seats get `{...row, inMaintenance:false}`, badges still read the real row); `badges?: ReactNode` (in place of `RowBadges`, both positions); `menu?: { edit: string; clear: string; canClear: (row: FleetRosterRowDto) => boolean }` (⋮ words, the notes button's aria word, when «clear» shows) | `true`; `<RowBadges row={row} />`; `«تعديل التعيين» / «إلغاء التعيين» / carriesPlan` | `false`; `<FixedRowBadges/>`; `«تعديل» / «إفراغ الطقم» / hasDriver` |
| `RosterDeskBoard.tsx` / `roster-desk-parts.tsx` consts | `export` keyword only | — | imported by desk |

Do not alter any expression a daily spec pins (e.g. `const droppable = mayPlan && !row.inMaintenance && !needsFirst`
in `SeatCell`; `<CloseIcon` after `data-clear-slot=` in the card; `data-export="roster"` on the daily).

### 4.4 The refusal — server details (api) and the Arabic line (core)
Server (`fixed-roster.service.ts`), same status, same error `code`, same English `message`
(logs only) — details ADDED. 409s become `new AppError(ErrorCodes.DUPLICATE, 409, <same message>, { details })`
(the code `ConflictError` already sends; `employee.service.ts:1273` is the precedent); 400s keep their
existing first detail and append one:

| Refusal | Status / code | Details added (`field`, `code`, `message`) |
|---|---|---|
| a payload driver another row still holds | 409 DUPLICATE | `driverEmployeeId`, `FIXED_CREW_DRIVER_HELD`, the employee id; and ONLY when the holding car reads in the caller's scope (today's `getById(…, scope).catch(() => null)`): `vehicleCode`, `FIXED_CREW_HOLDER`, its code |
| a crewed car that is not active | 409 DUPLICATE | `vehicleCode`, `FIXED_CREW_VEHICLE_NOT_ACTIVE`, the car's code |
| the driver's fleet profile is switched off | 400 VALIDATION_FAILED | `driverEmployeeId`, `FIXED_CREW_PROFILE_INACTIVE`, the employee id |
| the employee holds no driving seat | 400 VALIDATION_FAILED | `driverEmployeeId`, `FIXED_CREW_NOT_A_DRIVER`, the employee id |
| mission type not live / wrong kind | 400 VALIDATION_FAILED | `missionTypeId`, `FIXED_CREW_MISSION_INACTIVE`, the id |
| seat 2 without seat 1 | 400 (unchanged) | existing `DRIVER2_WITHOUT_DRIVER1` |
No names in the body (D11). Keep `throw new ValidationError(` within 200 characters after
`findActiveOfKind(` (`fixed-crew-write-surface.spec.ts:94`).

Web (`lib/fixed-save-refusal.ts`, core):
```ts
export const FIXED_REFUSAL = { held: 'FIXED_CREW_DRIVER_HELD', holder: 'FIXED_CREW_HOLDER',
  vehicleNotActive: 'FIXED_CREW_VEHICLE_NOT_ACTIVE', profileInactive: 'FIXED_CREW_PROFILE_INACTIVE',
  notADriver: 'FIXED_CREW_NOT_A_DRIVER', missionInactive: 'FIXED_CREW_MISSION_INACTIVE',
  needsFirst: 'DRIVER2_WITHOUT_DRIVER1' } as const;   // the SAME literals as the server (D12)
export interface RefusalWords { t: (key: string, params?: Record<string, string | number>) => string;
  locale: Locale; nameOf: (employeeId: string) => string | null }
export const fixedSaveRefusal = (error: unknown, words: RefusalWords): string;
```
Order: a recognised detail → its key (§6, named / unnamed by `nameOf`, code or «سيارة أخرى…»);
else an `ApiError` with code `VALIDATION_FAILED` or `DUPLICATE` (or status 400/409 other than
`STALE_DOCUMENT`) → `fleet.fixedRoster.refusal.generic`; else `errorMessage(error, locale)`
(friendly Arabic: stale, forbidden, not found, network, internal …) — and if that equals the
server's own message (an unknown code), the generic line instead. Never English, never an id.

---------------------------------------------------------------------------------------------------

## 5. Packages in detail

### 5.1 `api` — the refusal carries what the screen needs (area: api)
Files: `apps/api/src/modules/fleet/fixed-roster/fixed-roster.service.ts`,
`apps/api/tests/integration/fleet.spec.ts`, (optional, comment only)
`packages/contracts/src/modules/fleet.ts`, `.wip-notes/fixed-build/handoff-api.md`.
Tasks:
1. Add the details of §4.4 to the five refusals; no other change (no rule, no status, no code, no
   message, no new import beyond `AppError`/`ErrorCodes`).
2. Specs in the existing `describe('fixed crew (الطقم الثابت) …')` of `tests/integration/fleet.spec.ts`
   (its helpers `mkDriver`, `saveCrews`, `createVehicle` are there): (a) the held refusal carries
   `FIXED_CREW_DRIVER_HELD` + the id and `FIXED_CREW_HOLDER` + the holding car's code, status 409,
   and the holding row is untouched; (b) a holder OUT of the caller's scope (call
   `fleetFixedRosterService.save(input, by, scope)` with a scope that excludes the holder's branch,
   or a branch-scoped token if the file already has one) → no `FIXED_CREW_HOLDER`, and no vehicle
   id anywhere in `details`; (c) the switched-off profile: the old first detail
   (`'fleet profile is inactive'`) is still there AND `FIXED_CREW_PROFILE_INACTIVE` + the id;
   (d) not a driver → `FIXED_CREW_NOT_A_DRIVER`; (e) an inactive crewed car →
   `FIXED_CREW_VEHICLE_NOT_ACTIVE` + its code (if making a car inactive is cheap in this file;
   otherwise say so in the hand-off); (f) an archived mission type → `FIXED_CREW_MISSION_INACTIVE`.
3. Run ALONE, one file each, under the lock: `cd /home/user/egycash/apps/api && flock "$LOCK" npx vitest run tests/integration/fleet.spec.ts -t "fixed crew" --maxWorkers=1`,
   then `src/modules/fleet/fixed-roster/fixed-crew-write-surface.spec.ts`,
   `src/modules/fleet/fixed-roster/legacy-crew-row.spec.ts`,
   `src/modules/fleet/driver-profiles/drivers-are-derived.spec.ts`,
   `src/modules/fleet/catalogs/catalog-read-permission.spec.ts` (each its own run);
   `flock "$LOCK" npm run typecheck -w apps/api`; `npx eslint` the service.
Hand-off: the six literal codes exactly as written (core pins them), the field names, and which
cases (if any) could not be tested.

### 5.2 `core` — model, refusal line, shell, daily optional props (area: web)
Files (exclusive): `lib/fixed-roster-model.ts`, `lib/fixed-roster-model.spec.ts`,
`lib/fixed-save-refusal.ts`, `lib/fixed-save-refusal.spec.ts`, `lib/fixed-roster-board.ts`,
`lib/fixed-roster-board.spec.ts`, `pages/FixedRosterPage.tsx`, `fixed-roster-spec-sources.ts`,
`components/roster/roster-optional-props.spec.tsx`, `components/roster/RosterDeskBoard.tsx`,
`components/roster/roster-desk-parts.tsx`, `components/roster/roster-desk-cells.tsx`,
`components/roster/roster-drivers.tsx`, `components/roster/roster-touch-parts.tsx`,
`components/roster/RosterCarCard.tsx`, `components/DriverSlotPicker.tsx`,
`.wip-notes/fixed-build/i18n/core.json`, `.wip-notes/fixed-build/handoff-core.md`.
Tasks, in this order:
1. FIRST (others wait on it): §4.3 optional props + `DriversHeading` + the `export`s; the types of
   §4.1 in `lib/fixed-roster-model.ts` (a compiling skeleton is fine). Announce in the hand-off file
   the moment they are in.
2. `fixed-roster-board.ts`: `swapDrivers(rows, vehicleId)` (one/no seat → `[...rows]` unchanged
   values; both → `assignDriver(rows, vehicleId, 'driver1EmployeeId', row.driver2EmployeeId)`);
   move the orphaned «Empty one slot…» doc block onto `clearSlot`. No other rule changes.
3. The model (§4.1) — every function, pure pieces first, then the hook.
4. `fixed-save-refusal.ts` (§4.4) and its keys (§6 core).
5. The shell (§3). `fixed-roster-spec-sources.ts`: `FIXED_FILES = { shell: ['pages/FixedRosterPage.tsx'],
   model: ['lib/fixed-roster-model.ts', 'lib/fixed-roster-board.ts', 'lib/fixed-save-refusal.ts'],
   desk: ['components/roster/FixedDeskBoard.tsx', 'components/roster/fixed-desk-cells.tsx',
   'components/roster/FixedDriversPanel.tsx', 'components/roster/FixedCrewDialog.tsx'],
   touch: ['components/roster/FixedTouchBoard.tsx', 'components/roster/fixed-touch-parts.tsx'] }`
   + `fixedSource(parts, { raw })` (comments stripped unless raw; a missing file throws).
6. Specs:
   - `lib/fixed-roster-model.spec.ts` (pure pieces + the hook through `renderToStaticMarkup` of a
     probe component with a seeded QueryClient, as the daily specs do): NO DATE (the draft key is
     `FIXED_ROSTER_DRAFT_KEY`, no date in any query or payload); UNDO (`fixedEditStep` → null on a
     no-op drop / unchanged dialog; push/pop; 50 cap; steps lapse on a new `saved`; `apply` = one
     step; a reload restores the draft with `undoDepth` 0); SAVE BAR inputs (`changed`, `dirty`,
     `unsavedIds` = exactly what «حفظ» sends; the payload parses with `SaveFleetFixedRosterSchema`);
     TRANSFER (`transferFrom` names the SAVED car, null on the same car / never seated);
     SWAP (both seats trade; one seat → no step); VIEWS/FILTERS (`fixedCounters` values off the
     whole draft, tones — «بلا طقم» = `COUNTER_TONES.unmanned`, «صيانة» rose, apply/active per chip,
     a mission toggles; `visible` code order and AND of q/mission/view; `fixedFiltersHiding` lifts
     only what hides; `fixedTouchCars` part-code search, no workshop split, `termFinds`);
     WORKSHOP (mission + seats editable on an inMaintenance row); LISTS (`pool` excludes seated and
     held-off; `availableFor` free / seated-with-code (target only) / held-off as seated + null code
     always / flagged empty / licenceExpired false / target crew left out; `dialogCandidates` =
     free + held-off + own crew); PERMISSIONS (every action a no-op when `mayPlan` is false);
     EXCEL (`exportSheet` → `saveSheet` called with today's name, header and values — mock
     `./fleet-sheet` with `vi.mock`); Q1 (the model file reads no availability / licence / reason
     field — source check via `fixedSource(['model'])`).
   - `lib/fixed-save-refusal.spec.ts`: every row of §4.4 (named + unnamed, holder code + no holder →
     «سيارة أخرى…» key, vehicle not active, profile, not a driver, mission, needsFirst, zod 400
     without a known detail, unknown 409 → generic, STALE / network → `errorMessage`); the output
     never contains the employee id, the vehicle id or the server's English message; the six literal
     codes pinned (D12). One case uses the real catalog (`translate('ar', …)`) and asserts no Latin
     letter `[A-Za-z]` — "green after the HUB merge".
   - `lib/fixed-roster-board.spec.ts`: swap cases.
   - `components/roster/roster-optional-props.spec.tsx` (THE DAILY UNCHANGED): each piece rendered
     WITHOUT the new prop gives today's markup facts (`data-export="roster"`, aria «السائقون
     المتاحون», «متاح» on a free row, the day's empty line, `assignTitle` titles, the workshop card's
     lock + `data-workshop-lock`, `RowBadges`, «تعديل التعيين» / «إلغاء التعيين», no `maxlength`);
     WITH the prop gives the fixed behaviour. Then run, unedited and green, every daily spec:
     `fleet-daily-roster.spec.tsx`, `fleet-roster-touch.spec.tsx`, `fleet-roster-filter-row.spec.ts`,
     `fleet-roster-licence.spec.tsx`, `fleet-roster-picker.spec.tsx` (its daily half),
     `components/roster/roster-shared.spec.tsx`, `lib/roster-board.spec.ts`, `lib/roster-layout.spec.ts`,
     `lib/daily-roster-board.spec.ts`, `lib/roster-view.spec.ts`, `lib/useDraftBoard.spec.tsx`,
     `lib/draft-storage.spec.ts` — one vitest run at a time under the lock.
Hand-off: when §4.1–§4.3 landed; any interface deviation (there should be none); the i18n keys;
which assertions are "green after the HUB merge"; the stale comments fixed.

### 5.3 `desk` — the computer's board (area: web)
Files (exclusive): `components/roster/FixedDeskBoard.tsx`, `components/roster/fixed-desk-cells.tsx`,
`components/roster/FixedDriversPanel.tsx`, `components/roster/FixedCrewDialog.tsx`,
`fleet-fixed-roster.spec.tsx`, `.wip-notes/fixed-build/i18n/desk.json`,
`.wip-notes/fixed-build/handoff-desk.md`.
Tasks: build design.md §1 E2–E8 exactly (the daily `RosterDeskBoard` structure minus the stepper,
the past-day banner, `RosterAssignDialog`, the clear confirm and `DriversPanel`):
1. `FixedDeskBoard` (E2 toolbar + count with `pluralKey('fleet.fixedRoster.carCount', …)` and
   `fleet.fixedRoster.matchedRows`; E3 filter bar; E4 table with the daily look constants imported
   from `RosterDeskBoard.tsx`; the grid widths as the daily; E7 `EditsBar` floating; E8 discard
   `Dialog`; `showCar` with `fixedFiltersHiding` + `tr[data-car]` scroll; drag state). Hooks:
   `data-fixed-desk`, `data-fixed-toolbar`, `data-filtered-count`, `data-car`, `data-tint`,
   `data-row-actions="fixed-roster"`, `data-edit-row={code}`, `data-swap-drivers={vehicleId}`,
   `data-clear-crew={code}`.
2. `fixed-desk-cells.tsx`: `FixedStatusCell` (E4.2), `FixedNotesCell` (E4.5, `line-clamp-3` + `title`),
   `fixedSeatFacts(m)` (the empty Q1 facts of E4.4).
3. `FixedDriversPanel` (E5) with `DriversHeading`, `DriverSearch`, `AvailableList` per E5.
4. `FixedCrewDialog` (E6): today's `EditCrewDialog` rules verbatim (read them in
   `git show 2b9467a3:apps/web/src/modules/fleet/pages/FixedRosterPage.tsx`, lines 110–322), seats
   in the daily `DriverSlot` look (`RosterAssignDialog.tsx` lines 26–117), the name + code face
   with a real gap (D3 — do not touch `EmployeeName`), the list from `m.dialogCandidates`, the blue
   «سيارة أخرى» on `m.heldOff` ids, `m.transferFrom` line, «حفظ» → `m.actions.apply` only when
   something changed.
5. Rewrite `fleet-fixed-roster.spec.tsx` as the screen + desk spec (render `FixedRosterPage` —
   desktop under `renderToStaticMarkup` — with the existing seeding helpers; a restored draft via
   `sessionStorage` stub where needed; read sources through `fixedSource`). Keep every still-true
   claim of the old file (navigation + permission reuse, two API functions only, payload parse,
   same-driver rule, seat-2-needs-seat-1, mission catalog = `missionType` never `workType`, cancel
   touches nothing, the draft key without a date, refusal keeps the draft) and REPLACE the ones the
   redesign retires (seven-column strip layout, coloured code, 160px picker, «كل المهمات», Save in
   the strip, DriverChip pool, green panel, «سيارة أخرى» amber). Themes to cover: NO DATE (no
   `data-day-stepper`, no `type="date"`, no `PastDayBanner`/`weekdayOf`/`slashDate`/`shiftDay`/
   `useRosterDay`/`rosterDraftKey` in any fixed source); Q2 (exactly one `<h1>` = «الطقم الثابت»,
   the breadcrumbs, no `ExportSheetButton`, exactly one `data-export="fixed-roster"` and it sits in
   `data-fixed-toolbar`); SAVE BAR (absent on a clean board and for a viewer; with a restored draft:
   the edited codes, «تراجع» disabled, «إلغاء» and «حفظ» live); UNDO wiring; TRANSFER strip on a
   moved seat; SWAP button only with both seats (workshop row included); «إفراغ الطقم» without a
   confirm; VIEWS/FILTERS (no `CatalogMultiSelect`, the counters with «بلا طقم» yellow, the reset,
   the code filter); WORKSHOP (rose `data-tint`, mission select enabled, pen offered); EXCEL wiring
   (`m.actions.exportSheet(rows)`); PERMISSIONS (viewer: no «إجراءات» header, no
   `data-driver-picker`, no `draggable="true"`, no `data-seat-bin`, mission as text, «بدون سائق»);
   Q1 (no `data-problem`, `data-driver-out`, `data-driver-licence`, no `fleet.roster.reason.*` word,
   no «متاح» in the panel); the panel (heading count = free, held-off under
   «معيّنون على سيارات أخرى» with «سيارة أخرى», `poolEmpty` when everyone is crewed); the dialog
   (four facts, rules, 500 cap, candidates); the notes clamp + title; the count's plural key.
6. Run: this spec, `fleet-roster-picker.spec.tsx` (its fixed half must stay green — report to the
   HUB if not), the web typecheck — each under the lock.
Hand-off: i18n keys (§6 desk), anything core must change (should be nothing), anything the HUB's
census specs must re-point (the code column, the hover-only code and the code filter now live in
`FixedDeskBoard.tsx`).

### 5.4 `touch` — the phone and tablet board (area: web)
Files (exclusive): `components/roster/FixedTouchBoard.tsx`, `components/roster/fixed-touch-parts.tsx`,
`fleet-fixed-roster-touch.spec.tsx`, `.wip-notes/fixed-build/i18n/touch.json`,
`.wip-notes/fixed-build/handoff-touch.md`.
Tasks: build design.md §2 T-1…T-11 exactly (the daily `RosterTouchBoard` structure minus the h1,
the stepper, the past-day banner, the tabs, the unavailable list, the workshop group, the arrival
reason logic and the clear confirm):
1. `FixedTouchBoard`: phone / portrait one column (sticky filter row unless `short`; the first row
   per T-1; the bottom bar sticky), landscape split; written for the shell's `PageContainer` (D5:
   no outer padding; bleed `-mx-4 px-4 sm:-mx-6 sm:px-6`); car term state; `fixedTouchCars`;
   counters with the toggle-off tap; picker / pool / mission / notes / filters / discard sheets;
   target and driver-first; `showCar` (clears the term if it hides the car, `fixedFiltersHiding`,
   double rAF scroll); Excel `m.actions.exportSheet(drawn)` in a try/catch toast. Hooks:
   `data-fixed-touch={layout}`, `data-car`, `data-cars-column`, `data-drivers-panel`,
   `data-export="fixed-roster"`, `data-touch-header`, `data-touch-bottom`.
2. `fixed-touch-parts.tsx`: `FixedRowBadges` (InWorkshopBadge + «معيّنة» / «بلا طقم»), the card
   handlers adapter, the `menu` object, anything else touch-only.
3. Browser check (Chromium, light + dark) at 390×844, 820×1180, 1180×820 and a 844×390 short phone:
   the sticky filter row and the bottom bar stick, nothing scrolls sideways, one Excel per width,
   one title. If the sticky row does not stick inside `PageContainer fullHeight`, write the D5
   fallback in the hand-off for core (do not edit the shell). Pictures → scratch `fixed-build/`.
4. `fleet-fixed-roster-touch.spec.tsx` (render `FixedRosterScreen layout="phone" | "portrait" |
   "landscape"`, `short`): NO DATE (no `data-day-stepper`, no `type="date"`, no weekday, pool sheet
   has no date subtitle); Q2 (no `<h1>` drawn by the board — the page has exactly one; one
   `data-export="fixed-roster"` per layout, in the first row); the cards in CODE ORDER with a
   workshop car in place, unlocked, mission pill a button, «في الورشة» badge; the ⋮ words «تعديل» /
   «إفراغ الطقم» (clear only with a driver); SWAP button between filled seats; TRANSFER strip;
   the DriversButton label/aria «السائقون» and its count = free (phone compact: icon + number);
   the lists (no «متاح», held-off under «معيّنون على سيارات أخرى» with «سيارة أخرى», `poolEmpty`);
   FILTERS (sheet keeps «نوع المهمة», the typed code is not in the URL, reset clears it, active
   chip lets go on a second tap); SAVE BAR shapes (phone / strip / floating) and absent for a
   viewer; PERMISSIONS (viewer: no ⋮, no seat buttons, no pool hint); Q1 (no flag hooks or reason
   words); the mission / notes sheet titles «تعديل · {code}» and the 500 cap (source check).
5. Run: this spec + the web typecheck, under the lock.
Hand-off: i18n keys (probably none — say so), the browser result (pass / fallback needed).

---------------------------------------------------------------------------------------------------

## 6. New i18n words (ar + en) — HUB merges them beside `fleet.fixedRoster.*` in both blocks

core.json
| key | ar | en |
|---|---|---|
| `fleet.fixedRoster.poolEmpty` | لا يوجد سائقون بلا طقم ثابت | Every driver is on a fixed crew |
| `fleet.fixedRoster.refusal.held` | تعذّر الحفظ: السائق {{name}} في الطقم الثابت للسيارة {{code}}. | Not saved: driver {{name}} is on the fixed crew of vehicle {{code}}. |
| `fleet.fixedRoster.refusal.heldUnnamed` | تعذّر الحفظ: أحد السائقين في الطقم الثابت للسيارة {{code}}. | Not saved: one of the drivers is on the fixed crew of vehicle {{code}}. |
| `fleet.fixedRoster.refusal.heldElsewhere` | تعذّر الحفظ: السائق {{name}} في الطقم الثابت لسيارة أخرى ليست في هذه الشاشة (فرع آخر أو سيارة خارج الخدمة). | Not saved: driver {{name}} is on the fixed crew of another vehicle that is not on this screen (another branch, or a vehicle out of service). |
| `fleet.fixedRoster.refusal.heldElsewhereUnnamed` | تعذّر الحفظ: أحد السائقين في الطقم الثابت لسيارة أخرى ليست في هذه الشاشة (فرع آخر أو سيارة خارج الخدمة). | Not saved: one of the drivers is on the fixed crew of another vehicle that is not on this screen (another branch, or a vehicle out of service). |
| `fleet.fixedRoster.refusal.profileInactive` | تعذّر الحفظ: ملف السائق {{name}} موقوف، فلا يمكن وضعه في طقم ثابت. | Not saved: driver {{name}}’s fleet profile is switched off, so he cannot be on a fixed crew. |
| `fleet.fixedRoster.refusal.profileInactiveUnnamed` | تعذّر الحفظ: ملف أحد السائقين موقوف، فلا يمكن وضعه في طقم ثابت. | Not saved: one driver’s fleet profile is switched off, so he cannot be on a fixed crew. |
| `fleet.fixedRoster.refusal.notADriver` | تعذّر الحفظ: {{name}} ليس على وظيفة سائق. | Not saved: {{name}} does not hold a driving seat. |
| `fleet.fixedRoster.refusal.notADriverUnnamed` | تعذّر الحفظ: أحد المختارين ليس على وظيفة سائق. | Not saved: one of the chosen people does not hold a driving seat. |
| `fleet.fixedRoster.refusal.vehicleNotActive` | تعذّر الحفظ: السيارة {{code}} لم تعد في الخدمة، فلا يمكن حفظ طقم لها. | Not saved: vehicle {{code}} is no longer in service, so it cannot carry a crew. |
| `fleet.fixedRoster.refusal.missionInactive` | تعذّر الحفظ: نوع المهمة المختار لم يعد متاحًا — اختر نوعًا آخر. | Not saved: the chosen mission type is no longer available — choose another. |
| `fleet.fixedRoster.refusal.needsFirst` | تعذّر الحفظ: عيّن السائق الأول قبل الثاني. | Not saved: assign driver 1 before driver 2. |
| `fleet.fixedRoster.refusal.generic` | تعذّر حفظ الطقم الثابت، وتعديلاتك باقية — راجع السيارات المعدَّلة ثم أعد المحاولة. | The fixed crews were not saved; your changes are kept — check the edited vehicles and try again. |

desk.json
| key | ar | en |
|---|---|---|
| `fleet.fixedRoster.carCount.one` | سيارة واحدة | One vehicle |
| `fleet.fixedRoster.carCount.two` | سيارتان | Two vehicles |
| `fleet.fixedRoster.carCount.few` | {{count}} سيارات | {{count}} vehicles |
| `fleet.fixedRoster.carCount.many` | {{count}} سيارة | {{count}} vehicles |
| `fleet.fixedRoster.carCount.other` | {{count}} سيارة | {{count}} vehicles |
| `fleet.fixedRoster.matchedRows` | عدد الصفوف بعد عوامل التصفية | Rows after the filters |

touch.json — none expected (write `{}` if none).

Reused as they are (no change): `fleet.fixedRoster.driversTitle` «السائقون», `.noDriver`,
`.needsFirstDriver`, `.sameDriverTwice`, `.editHint`, `.noMissionType`, `.noMissionTypesYet`,
`.missionTypesFailed`, `.clearCrew` «إفراغ الطقم», `.saved`, `.noVehicles`, `.unassigned` «بلا طقم»,
`.counter.crewed`, `.counter.uncrewed`, `.driverSearchPlaceholder`, `.driverSearchEmpty`;
`fleet.roster.*` words without a day (unsaved, undo, discardAll, discardBody, editedCars,
transferHint, onOtherVehicles, otherVehicle, clearSlot, pickDriver, swapDrivers, assigned,
assignTitle, filters, showResults, allMissions, fields.mission, searchPlaceholder, poolHint,
driverNow, targetNow, pickSlotHint, counter.total, counter.workshop); `common.edit`, `common.save`,
`common.cancel`, `common.clear`, `common.close`, `common.noResults`, `fleet.odometer.vehicleNotFound`.
Never used here: `fleet.roster.availableTitle` (as a visible word), `.availableEmpty`, `.free`,
`.reason.*`, `.licenceExpired`, `.crewAbsent`, `.pastDay*`, `.prevDay`, `.nextDay`, `.date`,
`.clearBody`, `.assignHint`, `.editAssignment`, `.clearAssignment`.

---------------------------------------------------------------------------------------------------

## 7. HUB (runs last, alone)

Files: `apps/web/src/platform/localization/i18n.ts`, `CHANGELOG.md`,
`docs/12-planning/fleet-module-design.md`, `apps/web/src/modules/fleet/fleet-sort-arrows.spec.tsx`,
`apps/web/src/modules/fleet/fleet-vehicle-card-census.spec.tsx`,
`apps/web/src/modules/fleet/lib/vehicle-code-selectors.spec.ts`, and ANY other shared spec that is
red after the packages (`fleet-table-sort.spec.tsx`, `fleet-roster-picker.spec.tsx`,
`shared/lib/remembered-filters-coverage.spec.ts`, `fleet-daily-roster.spec.tsx`,
`platform/localization/*.spec.ts`, `roster-spec-sources.ts`), `.wip-notes/fixed-build/handoff-hub.md`.
Tasks:
1. Read every hand-off. Merge `i18n/core.json`, `desk.json`, `touch.json` into `i18n.ts` (en block
   after `'fleet.fixedRoster.counter.uncrewed'` ≈ line 8512, ar block after the same key ≈ line
   23704), formal Arabic, same placeholders.
2. Re-point the shared census specs: `fleet-sort-arrows.spec.tsx` «offers both rosters the code and
   the state» → `components/roster/FixedDeskBoard.tsx` for the columns (the shell keeps
   `DEFAULT_SORT` and the state rank — keep those on `pages/FixedRosterPage.tsx`);
   `fleet-vehicle-card-census.spec.tsx` → the fixed entry pins
   `<VehicleHoverCode\s+vehicleId=\{row\.vehicleId\}\s+code=\{row\.code\}\s+focusable=\{false\}` in
   `components/roster/FixedDeskBoard.tsx` and the hover-only list names that file (the touch cards
   draw the code without a card, as the daily cards — add them to SKIPPED if the census asks);
   `lib/vehicle-code-selectors.spec.ts` → replace `modules/fleet/pages/FixedRosterPage.tsx` by
   `modules/fleet/components/roster/FixedDeskBoard.tsx` in the sorted list. Make the others green
   only if red, without weakening a claim.
3. Dead keys: remove (ar + en) only fixed keys nothing references any more (grep `apps/web/src`
   outside `i18n.ts`), e.g. `fleet.fixedRoster.unsaved`, `.removeDriver`, `.driversHint`,
   `.subtitle`, `.summary` — each only if truly unreferenced.
4. `CHANGELOG.md` `[Unreleased]` → `### Changed`: «Fleet: «الطقم الثابت» in the look of «تعيين
   السيارات»» — the owner's words, what changed (desk / tablet / phone, the save bar with undo, swap,
   transfer strip, the Excel pill/button, the plural count, the Arabic refusal line naming the driver
   and the car, the server's refusal details), what did not (rules, data, permissions, the daily
   screen, no migration).
5. `docs/12-planning/fleet-module-design.md` §4.5b rewritten as built (table + drivers panel on a
   computer, cards + sheets below 1280, draft + undo + save bar, the swap, no date, no availability
   flags, the refusal details) and a row `1.25` in the version table (date 2026-11-18).
6. Remove every `zz-*` file; then run THE GATE alone (§8). Fix what is red in HUB files; anything
   red in a package file goes back to that package.
7. Owner pictures (dark, per the spec): fixed desk company, desk one branch, the pen dialog,
   tablet, phone, phone drivers sheet, and the same daily shots to prove the daily unchanged →
   scratch `fixed-build/`.

---------------------------------------------------------------------------------------------------

## 8. The gate (CI order; `bash /home/user/egycash/.wip-notes/fixed-build/gate.sh`, ALONE)

Logs: `/tmp/claude-0/-home-user/85f289ec-521b-5944-9b89-a0120b22d71a/scratchpad/fixed-build/gate-out/`
(`summary.txt` + one log per step). Every `rc` must be 0, `00-cleanroom lines=0`, and
`99-git-status` lists only the intended files.

00 no `zz-` file under `apps` · 01 `node scripts/check-secrets.mjs` · 02 `npm ci` (CI only; skipped
here) · 03 `npm run build -w packages/contracts` · 04 `npm run lint` · 05
`npm run typecheck --workspaces --if-present` · 06 `node scripts/gen-permission-matrix.mjs --check` ·
07 `node scripts/check-flag-expiry.mjs` · 08 `node scripts/check-page-registry.mjs` · 09
`node scripts/automation-templates.mjs` · 10 `node scripts/check-formal-arabic.mjs` · 11
`npm run test -w packages/contracts` · 12 `npm run test -w apps/api` · 13 `npm run test -w apps/web` ·
14 `npm run build` · 15 `node scripts/dependency-audit.mjs` · 99 `git status --porcelain -- . ':!.wip-notes'`.

---------------------------------------------------------------------------------------------------

## 9. Spec themes → where they are proven

| Theme | api | core | desk | touch | HUB |
|---|---|---|---|---|---|
| no date | — | draft key, model source | markup + all fixed sources | markup, pool sheet | — |
| save bar | — | changed / dirty / unsavedIds | bar present / absent, codes, disabled states | bar shapes | — |
| undo | — | editStep, stack, lapse, reload | wiring | wiring | — |
| transfer | — | `transferFrom` | seat strip, dialog line | card strip | — |
| swap | — | `swapDrivers`, action | button rule (workshop incl.) | button between seats | — |
| views / filters | — | counters, visible, filtersHiding, touchCars | bar, chips, reset, no «كل المهمات» | sheet, chip toggle, typed term | census specs |
| Excel | — | `exportSheet` columns / values | one pill in the toolbar | one button per layout | — |
| permissions | — | actions no-op | viewer desk | viewer touch | — |
| Q1 no flags | — | model reads no flag field | no flag hooks / words / «متاح» | same | — |
| Q2 header | — | shell source | one h1, breadcrumbs, no header actions | board draws no h1 | — |
| the 409 line | details in the body | every case → Arabic, no id, no English | refusal keeps the draft | — | real-catalog check green after merge |
| the daily unchanged | — | optional-props spec + every daily spec green | — | — | full web suite in the gate |

---------------------------------------------------------------------------------------------------

## 10. Told list for the owner (Egyptian Arabic, Arabic script only) — as built

1. الشاشة اتعملت بنفس شكل «تعيين السيارات» الجديد بالظبط على الكمبيوتر والتابلت والموبايل، بس من غير تاريخ ولا أيام: مفيش أسهم يوم قبل/بعد، ومفيش «يوم سابق». الطقم الثابت ملوش يوم، بيفضل زي ما هو لحد ما تغيّره. وتحت العنوان على اليمين بقى مكتوب عدد العربيات اللي ظاهرة بعد الفلتر، زي اليومي.
2. زراير «حفظ» و«إلغاء» نزلت تحت في الشريط اللي بيظهر بس لما يكون فيه تعديل مش محفوظ، زي التعيين اليومي، ومعاها أرقام العربيات اللي اتعدلت (تدوس على رقم يوديك للعربية) وزرار «تراجع» بيرجّع آخر تعديل. ولو عدّلت أكتر من عربية ودوست «إلغاء» هيسألك الأول. ولو قفلت الصفحة وفتحتها التعديلات اللي مش محفوظة بترجع، بس «تراجع» بيبدأ من جديد.
3. خانة «كل المهمات» اللي جنب «كود السيارة» اتشالت على الكمبيوتر زي ما طلبت في التعيين اليومي؛ مربعات المهمات نفسها هي الفلتر. على الموبايل والتابلت فلتر المهمة موجود جوه «عوامل التصفية».
4. على الموبايل والتابلت بقى فيه كروت للعربيات بدل الجدول، وخانة «ابحث بكود السيارة…» تحت العنوان وجنبها زرار التحميل، وزرار السواقين (على الموبايل أيقونة ورقم بس) بيفتح قايمة السواقين من تحت. والكروت دايمًا بترتيب أرقام العربيات، من غير ترتيب بالحالة زي اللي كان في الجدول.
5. بما إن السحب مش شغال باللمس: تدوس على خانة السواق تطلعلك قايمة تختار منها، وفيها كمان السواقين اللي على عربيات تانية برقم عربيتهم — تختار واحد منهم يتنقل لعربيتك. أو تختار السواق الأول من قايمة «السائقون» وبعدين تدوس على الخانة.
6. ضفنا زرار التبديل (السواق الأول يبقى التاني والعكس) زي التعيين اليومي، على الكمبيوتر في عمود «إجراءات» وعلى الموبايل بين الخانتين.
7. لما تنقل سواق من عربية لعربية، الخانة الجديدة بيظهر تحتها «سيُنقل من السيارة 214 عند الحفظ» لحد ما تحفظ.
8. سلة «إفراغ الطقم» فاضلة زي ما هي: بتفضّي السواقين الاتنين مرة واحدة، والمهمة والملاحظات بيفضلوا، ومن غير سؤال (لو غلطت عندك «تراجع» أو «إلغاء»). وعلى الموبايل والتابلت موجودة بنفس الاسم في قايمة النقط التلاتة.
9. قايمة السواقين بقت بشكل التعيين اليومي (الاسم وتحته الكود)، والكود بقى تحت الاسم في خانات العربية كمان. مفيش كلمة «متاح» جنب كل واحد، لأن الشاشة دي مش بتسأل مين فاضي النهارده. السواقين اللي ملهمش طقم ثابت بقوا أول القايمة، وبعدهم عنوان «معيّنون على سيارات أخرى» وتحته السواق المتثبت على عربية مش ظاهرة في الشاشة (فرع تاني أو عربية خارج الخدمة) ومكتوب جنبه «سيارة أخرى» بالأزرق، زي ما اليومي بيكتبها. ولو مفيش ولا سواق من غير طقم هيكتب «لا يوجد سائقون بلا طقم ثابت» بدل الجملة القديمة اللي كان فيها «في هذا التاريخ».
10. العربية اللي في الورشة صفها بقى بلون وردي خفيف زي التعيين اليومي، بس طقمها الثابت بيتعدل عادي (مش مقفولة زي اليومي). وعلى الموبايل فاضلة في مكانها برقمها، مش متجمعة تحت ومقفولة.
11. رقم العربية بقى أبيض عريض زي التعيين اليومي، من غير اللون الخاص بكل عربية. لو عاوز الألوان دي ترجع قولي.
12. كل الأرقام بقت أرقام إنجليزي (1، 2، 3) زي باقي الشاشات الجديدة، بدل (١، ٢، ٣) اللي كانت في المربعات.
13. اللي غايب النهارده أو في إجازة مش هيظهر هنا، لأن ده يوم؛ هيفضل ظاهر في «تعيين السيارات» («غائب من الطاقم الثابت») وفي لوحة الحركة.
14. لما تقف على اسم سواق أو رقم عربية، الكارت اللي بيطلع بيقول عربية النهارده وسواقين النهارده من التعيين اليومي، مش الطقم الثابت — زي ما هو دلوقتي.
15. زرار التحميل بقى تحت العنوان على الشمال، في نفس السطر اللي فيه عدد العربيات، نفس زرار التعيين اليومي وباقي الشاشات الجديدة: مكتوب عليه «تصدير» وجنبها كلمة إكسيل بالحروف الإنجليزي زي ما هي هناك. زرار واحد بس، ومفيش زرار تاني في العنوان. الملف نفسه زي ما هو: اللي ظاهر بالفلتر، ثمان أعمدة.
16. لو الحفظ اترفض (مثلًا سواق متثبت على عربية فرع تاني أو على عربية خارج الخدمة، أو سواق ملفه موقوف وهو في طقم العربية اللي بتعدلها)، رسالة الرفض بقت بالعربي وفيها اسم السواق ورقم العربية اللي ماسكاه، ومن غير أي رقم داخلي. ولو العربية دي مش من العربيات اللي تقدر تشوفها (فرع تاني)، الرسالة بتقول «سيارة أخرى ليست في هذه الشاشة» بدل رقمها، زي القايمة. التعديل نفسه مش بيضيع، بيفضل مستني لحد ما تصلّحه أو تلغيه.
17. الصلاحيات زي ما هي: اللي معاه تخطيط بس هو اللي يعدّل، واللي بيتفرج بس مش هيشوف عمود «إجراءات» ولا شريط الحفظ. والفرع اللي فوق بيحدد العربيات، والسواقين من الشركة كلها.
18. على الموبايل والتابلت «تعديل» اللي في قايمة النقط التلاتة بقى للملاحظات بس، زي التعيين اليومي؛ المهمة بتتغير من الزرار اللي جنب رقم العربية، والسواقين من خاناتهم. على الكمبيوتر القلم لسه بيفتح الشباك اللي فيه الأربع حاجات مع بعض.
19. مربع «بلا طقم» فوق بقى لونه أصفر زي «بلا سائق» في التعيين اليومي، والوردي بقى للورشة بس. ولو دوست عليه يفلتر زي ما هو.
20. شباك «تعديل» على الكمبيوتر بقى شكل خانات السواقين فيه زي التعيين اليومي: السواق المختار اسمه وكوده وجنبه علامة ✕، والخانة الفاضية فيها زرار «اختيار سائق» يفتح القايمة. نفس القواعد: السواق التاني مستني الأول، ونفس الشخص مينفعش في الخانتين.
21. الملاحظات في الجدول بقت تظهر في تلات سطور بالكتير، ولو أطول تقف عليها تشوفها كلها (دلوقتي كانت سطر واحد بنفس الطريقة). كده الملاحظة الطويلة مش بتكبّر الصف، وعلى شاشات الكمبيوتر الصغيرة الجدول كله داخل من غير ما حاجة تستخبى تحت عمود «إجراءات».
22. عدد العربيات اللي تحت العنوان بقى مكتوب بالعربي الصح حسب الرقم: «سيارة واحدة»، «سيارتان»، «3 سيارات»، «11 سيارة». ده في الشاشة دي بس، و«تعيين السيارات» فاضل زي ما هو.
23. الرقم اللي جنب «السائقون» (فوق القايمة، وعلى زرار السواقين في الموبايل والتابلت) بقى عدد السواقين اللي ملهمش طقم ثابت بس، زي اليومي؛ اللي متثبتين على عربيات مش ظاهرة بيبانوا تحت «معيّنون على سيارات أخرى» ومش محسوبين فيه.
24. على الكمبيوتر السواق المتثبت على عربية مش ظاهرة في الشاشة مبقاش بيتسحب من القايمة (زي اليومي). لو لازم تحطه، تختاره من خانة السواق في شباك «تعديل» (وعلى الموبايل والتابلت من قايمة الخانة)، والحفظ هيترفض بالرسالة اللي في البند 16 لحد ما يتشال من عربيته الأول.
25. العنوان «الطقم الثابت» وفوقه «الحركة» فاضل فوق في كل المقاسات زي ما اخترت (ج)، فعلى شاشة الكمبيوتر الصغيرة (1280 و1366) بيبان حوالي 5 صفوف كاملة بدل 7 في اليومي، وعلى التابلت وهو بالعرض كارتين بدل تلاتة.
26. زي ما اخترت (ب): مفيش أي علامة في الشاشة دي على سواق ملفه موقوف أو رخصته منتهية أو مش على وظيفة سائق — لا في الخانة ولا في القايمة ولا في شباك «تعديل»؛ ده بيبان في «تعيين السيارات» بس. ولو الحفظ اترفض بسبب كده، الرسالة بتقول ليه (البند 16).

---------------------------------------------------------------------------------------------------

## 11. Risks and fallbacks

- R1 Sticky pieces inside `PageContainer fullHeight` on phone / portrait (D5) — touch checks in a
  browser; fallback = `fullHeight` on desktop + landscape only (core edits the shell).
- R2 A daily spec pins a string an optional prop touches → core keeps the pinned expression
  verbatim (compute the new value beside it); never edit a daily spec — HUB only, and only with
  the claim kept.
- R3 `fleet-roster-picker.spec.tsx` renders the fixed page with a hand-built board (`inWorkshop`
  instead of `inMaintenance`, no `typeId`): the seat adapter must tolerate a missing
  `inMaintenance` (falsy) — desk checks this spec.
- R4 Parallel vitest / tsc → the `flock` lock in §0, always.
- R5 The out-of-scope holder test needs a scope: api may call the service directly with a
  `ScopeSelector`; if impossible, say so and keep the in-scope case.
- R6 Real-catalog Arabic assertions are red until the HUB merges i18n — listed in hand-offs, green
  in the gate.
