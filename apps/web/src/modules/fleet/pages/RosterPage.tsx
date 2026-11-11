// Daily duty roster (FW-7) — «تعيين السيارات», the §4.5 planning screen over FL-5.
//
// THE DAY IS A DRAFT. The board arrives derived — the server merges the vehicles, the day's
// stored assignments, the fixed crew where no assignment exists, and the availability seam's
// verdicts — and from then until «حفظ» every drag, mission change and clear edits a LOCAL copy.
// Nothing reaches `fleet_duty_assignments` in between, and nothing reaches `fleet_fixed_crews`
// ever: this screen has no write path to the standing crew at all. The draft, the undo steps and
// the save live in ONE model (`useRosterBoard`) that both layouts draw.
//
// WHERE THE DAY COMES FROM is the server's decision, not this page's: a stored assignment for
// (vehicle, date) IS the baseline, verbatim; otherwise the fixed crew, cut down by that day's
// workshop visits (FR-5) and driver availability (FR-6/7).
//
// This file is the SHELL: it reads the URL (every key and the remembered set as before), builds
// the query, holds the model, and picks the board for the screen — «فى تعديل بسيط ف شاشة تعبين
// الطاقم فى الحركه عاوز شكلها يتغير فى التابلت والفون» (the phone / tablet cards) and «شاشه الكبيوتر
// اعملها زى باقى شاشات الحركة الجديده ك ui» (the computer's board). The model lives HERE, above both
// boards, so a rotate or a resize across a breakpoint keeps the draft and its undo steps.
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  cairoYmd,
  compareFleetVehicleCodes,
  fleetVehicleCodeOrderKey,
  type FleetRosterRowDto,
} from '@ecms/contracts';
import { useCan } from '../../../platform/rbac/Can';
import { readList } from '../../../shared/lib/list-param';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';
import { clickSort, readSorts, writeSorts } from '../lib/table-sort';
import { sortRows } from '../lib/sort-rows';
import { hasDriver, readView, type RosterView } from '../lib/roster-view';
import { useRosterBoard, type RosterQuery } from '../lib/roster-board';
import { useRosterLayout, type RosterLayout } from '../lib/roster-layout';
import { RosterDeskBoard } from '../components/roster/RosterDeskBoard';
import { RosterTouchBoard } from '../components/roster/RosterTouchBoard';

/**
 * What one column of one row is worth, for the order the reader clicked.
 *
 * «الحالة» is ranked rather than spelled: the workshop is the loudest fact a row can carry, then
 * a car somebody is on, then a car nobody has touched. Ranking them by the badges' SPELLING would
 * be an order that means nothing.
 */
const rosterSortValue = (row: FleetRosterRowDto, key: string): string | number | null => {
  // The CODE, as the fleet reads it — 150 upward, then the worded ones, then «الملاكى». The bare
  // code would sort «9» after «150», and this board holds the whole fleet in one answer.
  if (key === 'code') return fleetVehicleCodeOrderKey(row.code);
  if (key === 'state') return row.inMaintenance ? 0 : hasDriver(row) ? 1 : 2;
  return null;
};

/** Remembered across visits: this screen's filters and view preferences — never the day. */
const REMEMBERED_FILTERS = ['mission', 'q', 'sort', 'view', 'unavailable'] as const;

/**
 * The day the board opens on: TODAY IN CAIRO. Between midnight and 02:00 (03:00 in summer) Cairo is
 * already on the next day while UTC is not, and a board opened then is about the Cairo day — the
 * one the fleet dashboard counts and links to with an explicit `?date=`.
 */
const today = (): string => cairoYmd(new Date());

/**
 * The earliest day a roster may be planned for.
 *
 * A roster is a PLAN, and the past is not plannable — the day is spent. The floor is TODAY, not
 * tomorrow: the current day's plan is the one operations is living in and is edited all morning.
 * This is the same `utcDay` boundary the server enforces (`PAST_DATE`), read off the same
 * `toISOString().slice(0, 10)` the whole screen already uses — one date interpretation, not two.
 */
const earliestPlannableDay = (): string => new Date().toISOString().slice(0, 10);

/**
 * The order this screen opens in, before the reader has asked for one.
 *
 * Named, because it is used twice and the two must agree: the table is DRAWN in it, and a
 * first click REPLACES it rather than joining it — see `clickSort`.
 */
const DEFAULT_SORT = 'code:asc';

export const RosterPage = (): JSX.Element => {
  const { layout, short } = useRosterLayout();
  return <RosterScreen layout={layout} short={short} />;
};

/** Exported for specs: render any layout without a window. */
export const RosterScreen = ({
  layout,
  short = false,
}: {
  layout: RosterLayout;
  short?: boolean;
}): JSX.Element => {
  const can = useCan();
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);

  /**
   * A roster PLANS ahead, and the past is not plannable — but it is very much readable. The floor
   * decides only whether the day on screen may be EDITED, never which day is SHOWN.
   */
  const floor = earliestPlannableDay();
  const date = sp.get('date') ?? today();
  /** Today and after: a plan. Before today: a record, shown whole and changed by nothing. */
  const editable = date >= floor;
  /** The picked car codes, as a comma list («كود السيارة»). */
  const search = sp.get('q') ?? '';
  /**
   * SEVERAL missions at once — the same `mission` key it has always been, now a comma-separated
   * list, so a link somebody saved with one mission on it still narrows to exactly that mission.
   * On the computer the per-mission counter chip is its control («شيل الفلتر بتاع كل المهمات اللى
   * جمب كود السيارة بس وسيب الباقى»); `?mission=` links keep working.
   */
  const missions = readList(sp, 'mission');
  /** Which STATE the board is narrowed to — `readView`, so a hand-typed `?view=` shows the day. */
  const view: RosterView | null = readView(sp.get('view'));
  /** The unavailable list's REASON filter — as the dashboard's absent figure links to it. */
  const reasons = readList(sp, 'unavailable');
  /**
   * The columns the board is read in, in the order they were clicked. `code:asc` is where it
   * opens, which is the order the server already hands the day over in.
   */
  const sortParam = sp.get('sort');
  const sorts = useMemo(() => readSorts(sortParam, DEFAULT_SORT), [sortParam]);

  const patch = (updates: Record<string, string | null>): void => {
    const next = new URLSearchParams(sp);
    for (const [key, val] of Object.entries(updates)) {
      if (val === null || val === '') next.delete(key);
      else next.set(key, val);
    }
    setSp(next);
  };

  /**
   * May this reader change THIS day? One flag, and every editing affordance reads it — the drop
   * zones, the drag handles, the clear buttons, the mission select, the row actions and the
   * unsaved bar — the same rule the server enforces on the write (`PAST_DATE`).
   */
  const mayPlan = can('fleetRoster.plan') && editable;

  const query: RosterQuery = {
    date,
    today: today(),
    editable,
    mayPlan,
    search,
    missions,
    view,
    reasons,
    patch,
  };
  // Touch re-derives an EDITED row's flags from the draft (approved); the computer keeps the
  // server's flags until «حفظ» re-reads the day, as this board always did.
  const m = useRosterBoard(query, { liveFlags: layout !== 'desktop' });

  /**
   * «إعادة ضبط» — every filter off in ONE update, and the day left alone: `date` is not a filter,
   * it is what the screen is ABOUT.
   */
  const resetFilters = (): void => patch({ q: null, mission: null, view: null, unavailable: null });

  // Ascending, then descending, then out of the order altogether — and a column the table
  // is NOT sorted by joins the end of it rather than replacing what is there.
  const changeSort = (by: string): void => {
    patch({ sort: writeSorts(clickSort(sortParam, DEFAULT_SORT, by)) });
  };

  // Narrowed first (the model), then ordered. The code closes every tie, which is the order this
  // board has always arrived in — so a reader who has clicked nothing sees what they saw before.
  const rows = useMemo(
    () =>
      sortRows(m.visible, sorts, rosterSortValue, (a, b) =>
        compareFleetVehicleCodes(a.code, b.code),
      ),
    [m.visible, sorts],
  );

  if (layout === 'desktop') {
    return (
      <RosterDeskBoard
        m={m}
        query={query}
        resetFilters={resetFilters}
        rows={rows}
        sort={sorts}
        onSortChange={changeSort}
      />
    );
  }
  return (
    <RosterTouchBoard
      m={m}
      query={query}
      resetFilters={resetFilters}
      layout={layout}
      short={short}
    />
  );
};
