// «الطقم الثابت» — who each car's STANDING crew is, in the look of «تعيين السيارات» («واعمل ديزاين
// شاشة الطاقم الثابت زى التعيين اليومى»): the computer's table with the drivers panel beside it, and
// on a phone or a tablet the daily board's cards and sheets — the same pieces, minus the day.
//
// A standing crew is a fact about a CAR, true until somebody changes it, so this screen has no day:
// no stepper, no «يوم سابق», no availability word, no absence. It reads the one board
// (`GET /fleet/fixed-roster`) and writes it through «حفظ» (`POST /fleet/fixed-roster`); in between
// every edit lands on a DRAFT that survives a reload, with «تراجع» for the last edit — the board
// model (`lib/fixed-roster-model.ts`), which lives HERE, above both boards, so a rotate or a resize
// across 1280px keeps the draft and its undo steps.
//
// This file is the SHELL: it reads the URL (the code filter `q`, the missions, the view, the sort —
// all remembered across visits), builds the query, holds the model, and draws the page header ON
// TOP AT EVERY WIDTH (owner's answer 2 ج): «الطقم الثابت» under «الحركة», and nothing else in it —
// the Excel control is the board's own, one per width. Then the board for the screen:
// `FixedDeskBoard` from 1280px, `FixedTouchBoard` below.
//
// Who may edit is `fleetRoster.plan`, the daily roster's own grant; a reader without it sees the
// board and changes nothing.
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  compareFleetVehicleCodes,
  fleetVehicleCodeOrderKey,
  type FleetFixedCrewRowDto,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { readList } from '../../../shared/lib/list-param';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';
import { clickSort, readSorts, writeSorts } from '../lib/table-sort';
import { sortRows } from '../lib/sort-rows';
import { hasDriver, readFixedView, type FixedRosterView } from '../lib/roster-view';
import { useFixedRosterBoard, type FixedRosterQuery } from '../lib/fixed-roster-model';
import { useRosterLayout, type RosterLayout } from '../lib/roster-layout';
import { FixedDeskBoard } from '../components/roster/FixedDeskBoard';
import { FixedTouchBoard } from '../components/roster/FixedTouchBoard';

/**
 * What one column of one row is worth, for the order the reader clicked.
 *
 * «الحالة» is ranked rather than spelled: the workshop first, then a car with a crew, then a car
 * nobody is on — the daily board's own ranking.
 */
const fixedSortValue = (row: FleetFixedCrewRowDto, key: string): string | number | null => {
  // The CODE, as the fleet reads it — 150 upward, then the worded ones, then «الملاكى». The bare
  // code would sort «9» after «150», and this board holds the whole fleet in one answer.
  if (key === 'code') return fleetVehicleCodeOrderKey(row.code);
  if (key === 'state') return row.inMaintenance ? 0 : hasDriver(row) ? 1 : 2;
  return null;
};

/** Remembered across visits: this screen's filters and its order. */
const REMEMBERED_FILTERS = ['mission', 'q', 'sort', 'view'] as const;

/**
 * The order this screen opens in, before the reader has asked for one — named once, because the
 * table is DRAWN in it and a first click REPLACES it (`clickSort`).
 */
const DEFAULT_SORT = 'code:asc';

export const FixedRosterPage = (): JSX.Element => {
  const { layout, short } = useRosterLayout();
  return <FixedRosterScreen layout={layout} short={short} />;
};

/** Exported for specs: render any layout without a window (no window → the computer's board). */
export const FixedRosterScreen = ({
  layout,
  short = false,
}: {
  layout: RosterLayout;
  short?: boolean;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);

  /** The picked car codes, as a comma list («كود السيارة»). */
  const search = sp.get('q') ?? '';
  /** SEVERAL missions at once — the `mission` key, a comma-separated list. */
  const missions = readList(sp, 'mission');
  /** Which STATE the board is narrowed to — `readFixedView`, so a hand-typed `?view=` shows all. */
  const view: FixedRosterView | null = readFixedView(sp.get('view'));
  /** The columns the table is read in, in the order they were clicked. */
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

  /** One flag, and every editing affordance reads it — the server enforces the same grant. */
  const mayPlan = can('fleetRoster.plan');

  const query: FixedRosterQuery = { mayPlan, search, missions, view, patch };
  const m = useFixedRosterBoard(query);

  /** «إعادة ضبط» — every filter off in ONE update, the three keys this board narrows by. */
  const resetFilters = (): void => patch({ q: null, mission: null, view: null });

  // Ascending, then descending, then out of the order altogether — and a column the table is NOT
  // sorted by joins the end of it rather than replacing what is there.
  const changeSort = (by: string): void => {
    patch({ sort: writeSorts(clickSort(sortParam, DEFAULT_SORT, by)) });
  };

  // Narrowed first (the model, in code order), then ordered as the reader clicked. The code closes
  // every tie, so a reader who has clicked nothing sees the board in code order.
  const rows = useMemo(
    () =>
      sortRows(m.visible, sorts, fixedSortValue, (a, b) =>
        compareFleetVehicleCodes(a.code, b.code),
      ),
    [m.visible, sorts],
  );

  return (
    <PageContainer fullHeight>
      <PageHeader
        title={t('fleet.nav.fixedRoster')}
        breadcrumbs={[
          { label: t('fleet.module.title'), to: '/fleet' },
          { label: t('fleet.nav.fixedRoster') },
        ]}
      />
      {layout === 'desktop' ? (
        <FixedDeskBoard
          m={m}
          query={query}
          resetFilters={resetFilters}
          rows={rows}
          sort={sorts}
          onSortChange={changeSort}
        />
      ) : (
        <FixedTouchBoard
          m={m}
          query={query}
          resetFilters={resetFilters}
          layout={layout}
          short={short}
        />
      )}
    </PageContainer>
  );
};
