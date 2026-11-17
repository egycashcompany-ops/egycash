// ── DESIGN SAMPLE — NEVER COMMIT (apps/web/src/zz-* is in .git/info/exclude) ────────────────────
// «الطقم الثابت» in the design of «تعيين السيارات» — the page SHELL, as RosterPage is the daily's:
// it reads the URL (the fixed page's own keys and remembered set: `mission, q, sort, view` — never a
// day), builds the query, holds ONE model above both boards (a rotate keeps the draft and its undo),
// and picks the board by the real `useRosterLayout`.
//
// Who may edit = `fleetRoster.plan` alone (FixedRosterPage.tsx:507) — the daily's date half is gone.
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  compareFleetVehicleCodes,
  fleetVehicleCodeOrderKey,
  type FleetFixedCrewRowDto,
} from '@ecms/contracts';
import { useCan } from './platform/rbac/Can';
import { readList } from './shared/lib/list-param';
import { useRememberedFilters } from './shared/lib/useRememberedFilters';
import { clickSort, readSorts, writeSorts } from './modules/fleet/lib/table-sort';
import { sortRows } from './modules/fleet/lib/sort-rows';
import { hasDriver, readFixedView, type FixedRosterView } from './modules/fleet/lib/roster-view';
import { useRosterLayout } from './modules/fleet/lib/roster-layout';
import { useFixedSample, type FixedQuery } from './zz-fixed-sample-model';
import { FixedDeskBoard } from './zz-fixed-sample-desk';
import { FixedTouchBoard } from './zz-fixed-sample-touch';

/** «الحالة» ranked workshop → crewed → uncrewed; the code in the fleet's order (P:91-98). */
const fixedSortValue = (row: FleetFixedCrewRowDto, key: string): string | number | null => {
  if (key === 'code') return fleetVehicleCodeOrderKey(row.code);
  if (key === 'state') return row.inMaintenance ? 0 : hasDriver(row) ? 1 : 2;
  return null;
};

const REMEMBERED_FILTERS = ['mission', 'q', 'sort', 'view'] as const;
const DEFAULT_SORT = 'code:asc';

export const FixedCrewSamplePage = (): JSX.Element => {
  const { layout, short } = useRosterLayout();
  const can = useCan();
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);
  const mayPlan = can('fleetRoster.plan');
  const search = sp.get('q') ?? '';
  const missions = readList(sp, 'mission');
  const view: FixedRosterView | null = readFixedView(sp.get('view'));
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
  const query: FixedQuery = { mayPlan, search, missions, view, patch };
  const m = useFixedSample(query);
  /** Every filter off in ONE update — the fixed page's three keys. */
  const resetFilters = (): void => patch({ q: null, mission: null, view: null });
  const changeSort = (by: string): void => {
    patch({ sort: writeSorts(clickSort(sortParam, DEFAULT_SORT, by)) });
  };
  const rows = useMemo(
    () =>
      sortRows(m.visible, sorts, fixedSortValue, (a, b) =>
        compareFleetVehicleCodes(a.code, b.code),
      ),
    [m.visible, sorts],
  );

  if (layout === 'desktop') {
    return (
      <FixedDeskBoard
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
    <FixedTouchBoard
      m={m}
      query={query}
      resetFilters={resetFilters}
      layout={layout}
      short={short}
    />
  );
};
