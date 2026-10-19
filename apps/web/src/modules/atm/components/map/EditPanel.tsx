// The side panel in edit mode (docs/12-planning/atm-map-zones.md §8.8 `EditPanel`,
// `Edit.dc.html:85-160`), in the mockup's order: «الفرع: name 🔒»; «+ قطاع جديد»; «القطاع المحدد» (its
// name, colour, counts, points, the selected point and the overlaps, «حذف القطاع») or the hint;
// «الالتصاق»; «القطاعات (n)» with Sort A–Z and ↑ ↓ per row; «إظهار أسماء القطاعات على الخريطة».
// In draw mode only the first two give way to `DrawPanel` (`drawPanel`).
//
// The name is committed on blur or Enter — one undo step per rename, never one per keystroke.
import { useEffect, useState, type ReactNode } from 'react';
import { type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { cn } from '../../../../shared/lib/cn';
import { formatNumber } from '../../../../shared/lib/format';
import { Button } from '../../../../shared/ui/Button';
import { Checkbox } from '../../../../shared/ui/form';
import { LockIcon, PlusIcon } from '../../../../shared/ui/icons';
import { machineCountText } from '../../lib/map-count-text';
import { SNAP_MAX_PX, SNAP_MIN_PX, type MapSnapPrefs } from '../../lib/map-prefs';
import { ColorPicker } from './ColorPicker';

export interface EditPanelZoneRow {
  id: string;
  name: string;
  color: string;
  count: number;
}

export interface EditPanelSelection {
  id: string;
  name: string;
  color: string;
  /** The «مقترح» swatch while the zone is new; null once saved. */
  suggested: string | null;
  count: number;
  /** The count before this session, when it differs (`(كانت m)`); null otherwise. */
  was: number | null;
  points: number;
  overlaps: readonly { name: string; count: number }[];
  vertex: { canDelete: boolean } | null;
}

export const EditPanel = ({
  locale,
  branchName,
  drawPanel,
  selection,
  rows,
  snap,
  showNames,
  onNewZone,
  onRename,
  onRecolor,
  onDeleteVertex,
  onDeleteZone,
  onSnap,
  onPick,
  onMoveUp,
  onMoveDown,
  onSortAz,
  onShowNames,
}: {
  locale: Locale;
  branchName: string;
  /** In draw mode, the panel that replaces «+ قطاع جديد» and «القطاع المحدد». */
  drawPanel: ReactNode | null;
  selection: EditPanelSelection | null;
  rows: readonly EditPanelZoneRow[];
  snap: MapSnapPrefs;
  showNames: boolean;
  onNewZone: () => void;
  onRename: (name: string) => void;
  onRecolor: (hex: string) => void;
  onDeleteVertex: () => void;
  onDeleteZone: () => void;
  onSnap: (next: MapSnapPrefs) => void;
  onPick: (zoneId: string) => void;
  onMoveUp: (zoneId: string) => void;
  onMoveDown: (zoneId: string) => void;
  onSortAz: () => void;
  onShowNames: (on: boolean) => void;
}): JSX.Element => {
  const t = useT();
  const [name, setName] = useState(selection?.name ?? '');
  useEffect(() => setName(selection?.name ?? ''), [selection?.id, selection?.name]);
  const commitName = (): void => {
    if (selection === null) return;
    if (name.trim() === '') setName(selection.name);
    else if (name !== selection.name) onRename(name);
  };
  const section = 'flex flex-col gap-2 border-t border-slate-100 pt-3.5 dark:border-slate-800';
  const heading = 'text-[15px] font-semibold text-slate-900 dark:text-white';

  return (
    <div data-edit-panel="true" className="flex flex-col gap-4">
      <div className="flex items-center gap-2 text-[13px] text-slate-500 dark:text-slate-400">
        {t('atm.map.edit.branchLocked')}
        <strong className="font-semibold text-slate-900 dark:text-white">{branchName}</strong>
        <span
          className="ms-auto"
          title={t('atm.map.edit.locked')}
          aria-label={t('atm.map.edit.locked')}
        >
          <LockIcon className="h-3.5 w-3.5" />
        </span>
      </div>

      {drawPanel ?? (
        <>
          <Button onClick={onNewZone} className="w-full font-semibold">
            <PlusIcon className="h-4 w-4" />
            {t('atm.map.edit.newZone')}
          </Button>
          {selection === null ? (
            <p className="text-[13px] leading-[1.8] text-slate-500 dark:text-slate-400">
              {t('atm.map.edit.pickHint')}
            </p>
          ) : (
            <section data-edit-selected={selection.id} className="flex flex-col gap-3">
              <h2 className={heading}>{t('atm.map.edit.selected')}</h2>
              <label className="flex flex-col gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                {t('atm.map.edit.name')}
                <input
                  type="text"
                  value={name}
                  maxLength={60}
                  onChange={(event) => setName(event.target.value)}
                  onBlur={commitName}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      commitName();
                    }
                  }}
                  className="h-[38px] rounded-lg border border-slate-300 bg-white px-2.5 text-sm text-slate-900 focus:border-brand-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                />
              </label>
              <ColorPicker
                value={selection.color}
                suggested={selection.suggested}
                onChange={onRecolor}
              />
              <div className="flex flex-col gap-1 rounded-lg bg-slate-50 px-3 py-2.5 text-[13px] text-slate-700 dark:bg-slate-800/60 dark:text-slate-200">
                <span aria-live="polite">
                  {t('atm.map.edit.inside', {
                    count: machineCountText(selection.count, t, locale),
                  })}{' '}
                  {selection.was !== null && (
                    <span className="text-slate-500 dark:text-slate-400">
                      {t('atm.map.edit.insideWas', { count: formatNumber(selection.was, locale) })}
                    </span>
                  )}
                </span>
                <span>
                  {t('atm.map.edit.points', { count: formatNumber(selection.points, locale) })}
                </span>
              </div>
              {selection.overlaps.map((overlap) => (
                <div
                  key={overlap.name}
                  role="status"
                  className="rounded-lg border border-orange-200 bg-orange-50 px-2.5 py-2 text-[13px] text-orange-800 dark:border-orange-900 dark:bg-orange-950 dark:text-orange-200"
                >
                  {t('atm.map.edit.overlap', {
                    name: overlap.name,
                    count: machineCountText(overlap.count, t, locale),
                  })}
                </div>
              ))}
              {selection.vertex !== null && (
                <div className="flex items-center gap-2 text-[13px]">
                  <Button
                    size="sm"
                    variant="ghost-danger"
                    className="border border-red-200 dark:border-red-900"
                    onClick={onDeleteVertex}
                    disabled={!selection.vertex.canDelete}
                    title={selection.vertex.canDelete ? undefined : t('atm.map.vertex.minThree')}
                  >
                    {t('atm.map.edit.deleteVertex')}
                  </Button>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {t('atm.map.edit.dragHint')}
                  </span>
                </div>
              )}
              <Button
                size="sm"
                variant="ghost-danger"
                className="self-start border border-red-200 dark:border-red-900"
                onClick={onDeleteZone}
              >
                {t('atm.map.edit.deleteZone')}
              </Button>
            </section>
          )}
        </>
      )}

      <section className={section}>
        <h2 className={heading}>{t('atm.map.edit.snap')}</h2>
        <Checkbox
          label={t('atm.map.edit.snapToggle')}
          checked={snap.on}
          onChange={(event) => onSnap({ ...snap, on: event.target.checked })}
        />
        <label className="flex items-center gap-2.5 text-[13px] text-slate-700 dark:text-slate-200">
          <span className="shrink-0">
            {t('atm.map.edit.snapDistance', { count: formatNumber(snap.px, locale) })}
          </span>
          <input
            type="range"
            min={SNAP_MIN_PX}
            max={SNAP_MAX_PX}
            step={1}
            value={snap.px}
            disabled={!snap.on}
            onChange={(event) => onSnap({ ...snap, px: Number(event.target.value) })}
            className="min-w-0 flex-1 accent-brand-600"
          />
        </label>
        <p className="text-xs leading-[1.7] text-slate-500 dark:text-slate-400">
          {t('atm.map.edit.snapHelp')}
        </p>
      </section>

      <section className={section}>
        <div className="flex items-center gap-2">
          <h2 className={heading}>
            {t('atm.map.edit.list', { count: formatNumber(rows.length, locale) })}
          </h2>
          <Button size="sm" variant="secondary" className="ms-auto h-[30px]" onClick={onSortAz}>
            {t('atm.map.edit.sortAz')}
          </Button>
        </div>
        <div className="flex flex-col overflow-hidden rounded-[10px] border border-slate-100 dark:border-slate-800">
          {rows.map((row, i) => (
            <div
              key={row.id}
              data-edit-row={row.id}
              className={cn(
                'flex h-11 items-center gap-2 border-b border-slate-100 px-2.5 last:border-b-0 dark:border-slate-800',
                row.id === selection?.id
                  ? 'bg-brand-50 dark:bg-brand-950'
                  : 'bg-white dark:bg-slate-900',
              )}
            >
              <button
                type="button"
                onClick={() => onPick(row.id)}
                aria-pressed={row.id === selection?.id}
                className="flex min-w-0 flex-1 items-center gap-2 text-start text-sm text-slate-900 dark:text-slate-100"
              >
                <span
                  aria-hidden="true"
                  className="h-3 w-3 shrink-0 rounded-full"
                  style={{ backgroundColor: row.color }}
                />
                <span className="truncate font-medium">{row.name}</span>
                <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">
                  {machineCountText(row.count, t, locale)}
                </span>
              </button>
              <button
                type="button"
                aria-label={t('atm.map.edit.moveUp')}
                title={t('atm.map.edit.moveUp')}
                onClick={() => onMoveUp(row.id)}
                disabled={i === 0}
                className="h-7 w-7 rounded-md border border-slate-200 bg-white text-slate-700 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                ↑
              </button>
              <button
                type="button"
                aria-label={t('atm.map.edit.moveDown')}
                title={t('atm.map.edit.moveDown')}
                onClick={() => onMoveDown(row.id)}
                disabled={i === rows.length - 1}
                className="h-7 w-7 rounded-md border border-slate-200 bg-white text-slate-700 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                ↓
              </button>
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {t('atm.map.edit.priorityHelp')}
        </p>
        <Checkbox
          label={t('atm.map.layers.names')}
          checked={showNames}
          onChange={(event) => onShowNames(event.target.checked)}
        />
      </section>
    </div>
  );
};
