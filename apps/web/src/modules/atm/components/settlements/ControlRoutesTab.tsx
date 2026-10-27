// «توزيع الخطوط» (S-8 b, DS-17, §9.7 Tab 2): the day's bags distributed over the crew lines
// («خطوط», routes in code). A line travels whole — all its bags — on at most one route; routes may
// mix banks. «لم يُوزّع بعد» comes first.
//
// EVERY MOVE IS SAVED AT ONCE and carries the route the page saw the line on (`from`); when another
// user moved it meanwhile the server answers `MOVED`, the page re-reads the day, and nothing is
// overwritten. Moves are plain selects — no drag-only interaction (§9.10).
import { useMemo, useState } from 'react';
import {
  type AssignAtmRoutes,
  type AtmControlDayDto,
  type AtmControlRouteDto,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { cn } from '../../../../shared/lib/cn';
import { formatNumber } from '../../../../shared/lib/format';
import { Button } from '../../../../shared/ui/Button';
import { Checkbox, Select } from '../../../../shared/ui/form';
import { MoreIcon } from '../../../../shared/ui/icons';
import { bagsText, lineCode } from '../../lib/settlement-view';
import { MenuButton } from './MenuButton';
import { RunChip } from './RunChip';

type ControlLine = AtmControlDayDto['lines'][number];
type Move = AssignAtmRoutes['moves'][number];
type SortBy = 'area' | 'serial';

const areaOf = (line: ControlLine): string => line.hubLabel ?? line.area ?? '';

/** The items of one group, in the chosen order: by serial, or by area then serial. */
export const sortItems = (lines: readonly ControlLine[], by: SortBy): ControlLine[] =>
  [...lines].sort((a, b) => {
    if (by === 'area') {
      const byArea = areaOf(a).localeCompare(areaOf(b), 'ar');
      if (byArea !== 0) return byArea;
    }
    return (a.serial ?? Number.MAX_SAFE_INTEGER) - (b.serial ?? Number.MAX_SAFE_INTEGER);
  });

export interface RouteActions {
  onMove: (moves: Move[]) => void;
  onCreate: () => void;
  onEdit: (route: AtmControlRouteDto) => void;
  onShift: (route: AtmControlRouteDto, by: -1 | 1) => void;
  onDelete: (route: AtmControlRouteDto) => void;
  onPrint: (route: AtmControlRouteDto) => void;
  onFromZones: () => void;
}

export const ControlRoutesTab = ({
  day,
  locale,
  busy,
  canPrint,
  actions,
}: {
  day: AtmControlDayDto;
  locale: Locale;
  busy: boolean;
  canPrint: boolean;
  actions: RouteActions;
}): JSX.Element => {
  const t = useT();
  const [sortBy, setSortBy] = useState<SortBy>('serial');
  const [byArea, setByArea] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  // Only a line that travels can be distributed: a cancelled line stays off the routes.
  const live = useMemo(() => day.lines.filter((l) => l.lineStatus !== 'cancelled'), [day.lines]);
  const routes = [...day.routes].sort((a, b) => a.order - b.order);

  const moveTo = (lines: readonly ControlLine[], to: string): void => {
    const target = to === '' ? null : to;
    const moves = lines
      .filter((l) => l.routeId !== target)
      .map((l) => ({ lineId: l.lineId, from: l.routeId, to: target }));
    if (moves.length > 0) actions.onMove(moves);
  };

  const options = (
    <>
      <option value="">{t('atm.control.unassignedOption')}</option>
      {routes.map((route) => (
        <option key={route.id} value={route.id}>
          {route.name}
        </option>
      ))}
    </>
  );

  const item = (line: ControlLine): JSX.Element => (
    <li
      key={line.lineId}
      data-route-item={line.lineId}
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-slate-100 px-3 py-2 first:border-t-0 dark:border-slate-800"
    >
      <input
        type="checkbox"
        className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
        checked={picked.has(line.lineId)}
        aria-label={lineCode(line)}
        onChange={(e) =>
          setPicked((current) => {
            const next = new Set(current);
            if (e.target.checked) next.add(line.lineId);
            else next.delete(line.lineId);
            return next;
          })
        }
      />
      <span className="min-w-0 flex-1 space-y-0.5">
        <span className="flex flex-wrap items-center gap-2">
          <strong dir="ltr" className="text-sm">
            {lineCode(line)}
          </strong>
          <RunChip run={line.run} time={line.scheduleTime} locale={locale} />
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {bagsText(line.bags.length, t)}
          </span>
        </span>
        <span className="block text-xs text-slate-500 dark:text-slate-400">
          {[areaOf(line), day.can.zones ? line.zoneName : null]
            .filter((p) => p !== null && p !== '')
            .join(' · ')}
        </span>
      </span>
      <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
        {t('atm.control.moveTo')}
        <Select
          density="tight"
          value={line.routeId ?? ''}
          disabled={busy}
          onChange={(e) => moveTo([line], e.target.value)}
        >
          {options}
        </Select>
      </label>
    </li>
  );

  /** A group's items, sub-grouped by area when asked. */
  const items = (lines: readonly ControlLine[]): JSX.Element => {
    const sorted = sortItems(lines, byArea ? 'area' : sortBy);
    if (!byArea) return <ul>{sorted.map(item)}</ul>;
    const areas = [...new Set(sorted.map(areaOf))];
    return (
      <div>
        {areas.map((area) => (
          <div key={area}>
            <p className="bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
              {area === '' ? '—' : area}
            </p>
            <ul>{sorted.filter((l) => areaOf(l) === area).map(item)}</ul>
          </div>
        ))}
      </div>
    );
  };

  const unassigned = live.filter((l) => l.routeId === null);

  return (
    <div className="space-y-4" data-control-routes="true">
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1.5 text-sm">
          <span className="block font-medium text-slate-700 dark:text-slate-200">
            {t('atm.control.sortBy')}
          </span>
          <Select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)}>
            <option value="serial">{t('atm.control.sort.serial')}</option>
            <option value="area">{t('atm.control.sort.area')}</option>
          </Select>
        </label>
        <Checkbox
          className="pb-2"
          label={t('atm.control.groupByArea')}
          checked={byArea}
          onChange={(e) => setByArea(e.target.checked)}
        />
        <label className="space-y-1.5 text-sm">
          <span className="block font-medium text-slate-700 dark:text-slate-200">
            {t('atm.control.moveSelected')}
          </span>
          <Select
            value="__none"
            disabled={busy || picked.size === 0}
            onChange={(e) => {
              moveTo(
                live.filter((l) => picked.has(l.lineId)),
                e.target.value,
              );
              setPicked(new Set());
            }}
          >
            <option value="__none" disabled>
              —
            </option>
            {options}
          </Select>
        </label>
        <div className="ms-auto flex flex-wrap gap-2">
          {day.can.zones && (
            <Button variant="secondary" disabled={busy} onClick={actions.onFromZones}>
              {t('atm.control.fromZones')}
            </Button>
          )}
          <Button disabled={busy} onClick={actions.onCreate}>
            {t('atm.control.newRoute')}
          </Button>
        </div>
      </div>

      <section
        data-route-group="unassigned"
        className="overflow-hidden rounded-xl border border-amber-200 bg-white dark:border-amber-900 dark:bg-slate-900"
      >
        <header className="bg-amber-50 px-3 py-2 dark:bg-amber-950/40">
          <strong className="text-sm text-slate-900 dark:text-white">
            {t('atm.control.unassigned', { n: formatNumber(unassigned.length, locale) })}
          </strong>
        </header>
        {items(unassigned)}
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        {routes.map((route, index) => (
          <section
            key={route.id}
            data-route-group={route.id}
            className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
          >
            <header className="flex items-start justify-between gap-2 bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
              <span className="min-w-0">
                <strong className="block text-sm text-slate-900 dark:text-white">
                  {route.name}
                </strong>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {t('atm.control.routeSummary', {
                    leader: route.leaderName ?? '—',
                    n: formatNumber(route.machines, locale),
                    b: formatNumber(route.bags, locale),
                  })}
                </span>
              </span>
              <MenuButton
                variant="ghost"
                size="icon"
                ariaLabel={t('atm.control.menu.label', { name: route.name })}
                icon={<MoreIcon className="h-4 w-4" />}
                disabled={busy}
                items={[
                  {
                    key: 'edit',
                    label: t('atm.control.menu.edit'),
                    onSelect: () => actions.onEdit(route),
                  },
                  {
                    key: 'up',
                    label: t('atm.control.menu.up'),
                    disabled: index === 0,
                    onSelect: () => actions.onShift(route, -1),
                  },
                  {
                    key: 'down',
                    label: t('atm.control.menu.down'),
                    disabled: index === routes.length - 1,
                    onSelect: () => actions.onShift(route, 1),
                  },
                  ...(canPrint
                    ? [
                        {
                          key: 'print',
                          label: t('atm.control.menu.print', { name: route.name }),
                          onSelect: () => actions.onPrint(route),
                        },
                      ]
                    : []),
                  {
                    key: 'delete',
                    label: t('atm.control.menu.delete'),
                    danger: true,
                    onSelect: () => actions.onDelete(route),
                  },
                ]}
              />
            </header>
            <div
              className={cn(route.lines === 0 && 'px-3 py-4 text-center text-xs text-slate-400')}
            >
              {route.lines === 0 ? '—' : items(live.filter((l) => l.routeId === route.id))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
};
