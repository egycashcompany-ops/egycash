// The map's side panel in view mode (docs/12-planning/atm-map-zones.md §8.8 `MapPanel`): «الفرع»
// (hidden with one branch), «القطاعات (n)» with its search and list — or one zone's details —, the
// summary line, and «الطبقات». Below `lg` the page puts the same panel in a `SideLayer` (DM-40).
import { type ReactNode } from 'react';
import { type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { formatNumber } from '../../../../shared/lib/format';
import { Button } from '../../../../shared/ui/Button';
import { Select } from '../../../../shared/ui/form';
import { type MapFigures } from '../../lib/map-filters';
import { type MapLayerPrefs } from '../../lib/map-prefs';
import { LayersSection } from './LayersSection';
import { ZoneList, type ZoneRow } from './ZoneList';

export const MapPanel = ({
  locale,
  branch,
  zones,
  branchNames,
  detail,
  figures,
  layers,
  onLayers,
  onHoverZone,
  onOpenZone,
  onDrawFirst,
}: {
  locale: Locale;
  /** «الفرع»; null with a single branch. */
  branch: {
    value: string;
    options: readonly { value: string; label: string }[];
    onChange: (value: string) => void;
  } | null;
  zones: readonly ZoneRow[];
  branchNames: ReadonlyMap<string, string> | null;
  /** One zone's details, in place of the list. */
  detail: ReactNode | null;
  figures: MapFigures | undefined;
  layers: MapLayerPrefs;
  onLayers: (next: MapLayerPrefs) => void;
  onHoverZone: (zoneId: string | null) => void;
  onOpenZone: (zoneId: string) => void;
  /** «رسم أول قطاع», for a zone editor of the branch; null otherwise. */
  onDrawFirst: (() => void) | null;
}): JSX.Element => {
  const t = useT();
  return (
    <div data-map-panel="true" className="flex flex-col gap-3.5">
      {branch !== null && (
        <label className="flex flex-col gap-1.5 text-xs text-slate-500 dark:text-slate-400">
          {t('atm.map.panel.branch')}
          <Select
            value={branch.value}
            onChange={(event) => branch.onChange(event.target.value)}
            aria-label={t('atm.map.panel.branch')}
          >
            {branch.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </label>
      )}
      {detail ?? (
        <div className="flex flex-col gap-2.5">
          <h2 className="text-[15px] font-semibold text-slate-900 dark:text-white">
            {t('atm.map.panel.zones', { count: formatNumber(zones.length, locale) })}
          </h2>
          {zones.length === 0 ? (
            <div
              data-map-empty="noZones"
              className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-slate-200 p-3 text-[13px] text-slate-500 dark:border-slate-700 dark:text-slate-400"
            >
              {t('atm.map.empty.noZones')}
              {onDrawFirst !== null && (
                <Button size="sm" onClick={onDrawFirst}>
                  {t('atm.map.empty.drawFirst')}
                </Button>
              )}
            </div>
          ) : (
            <ZoneList
              rows={zones}
              branchNames={branchNames}
              locale={locale}
              onHover={onHoverZone}
              onOpen={onOpenZone}
            />
          )}
          <div
            data-map-summary="true"
            className="flex flex-wrap gap-x-3.5 gap-y-1.5 rounded-lg bg-slate-50 px-3 py-2.5 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300"
          >
            <span>
              {t('atm.map.panel.summaryIn')}{' '}
              <strong>{formatNumber(figures?.inZones, locale)}</strong>
            </span>
            <span>
              {t('atm.map.panel.summaryOut')}{' '}
              <strong>{formatNumber(figures?.outZones, locale)}</strong>
            </span>
            <span>
              {t('atm.map.panel.summaryUnlocated')}{' '}
              <strong>{formatNumber(figures?.unlocated, locale)}</strong>
            </span>
          </div>
        </div>
      )}
      <LayersSection prefs={layers} onChange={onLayers} />
    </div>
  );
};
