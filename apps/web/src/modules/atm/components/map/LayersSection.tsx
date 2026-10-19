// «الطبقات» (docs/12-planning/atm-map-zones.md §8.8): what is drawn, and what colours the dots.
// Preferences of this viewer, kept in `localStorage` (DM-30) — never filters, never in a link.
import { useT } from '../../../../platform/localization/useT';
import { cn } from '../../../../shared/lib/cn';
import { Checkbox } from '../../../../shared/ui/form';
import { type MapLayerPrefs } from '../../lib/map-prefs';

export const LayersSection = ({
  prefs,
  onChange,
}: {
  prefs: MapLayerPrefs;
  onChange: (next: MapLayerPrefs) => void;
}): JSX.Element => {
  const t = useT();
  const toggle = (key: 'pins' | 'zones' | 'names' | 'faded', label: string): JSX.Element => (
    <Checkbox
      label={label}
      checked={prefs[key]}
      onChange={(event) => onChange({ ...prefs, [key]: event.target.checked })}
    />
  );
  const segment = (value: MapLayerPrefs['colorBy'], label: string): JSX.Element => (
    <button
      type="button"
      aria-pressed={prefs.colorBy === value}
      onClick={() => onChange({ ...prefs, colorBy: value })}
      className={cn(
        'h-8 px-3.5 text-[13px] transition-colors',
        value === 'bank' && 'border-s border-slate-300 dark:border-slate-600',
        prefs.colorBy === value
          ? 'bg-brand-600 text-white'
          : 'bg-white text-slate-700 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700',
      )}
    >
      {label}
    </button>
  );
  return (
    <section
      data-map-layers="true"
      className="flex flex-col gap-2.5 border-t border-slate-100 pt-3.5 dark:border-slate-800"
    >
      <h2 className="text-[15px] font-semibold text-slate-900 dark:text-white">
        {t('atm.map.layers.title')}
      </h2>
      {toggle('pins', t('atm.map.layers.pins'))}
      {toggle('zones', t('atm.map.layers.zones'))}
      {toggle('names', t('atm.map.layers.names'))}
      {toggle('faded', t('atm.map.layers.faded'))}
      <div className="flex flex-wrap items-center gap-2.5 text-sm text-slate-700 dark:text-slate-200">
        {t('atm.map.layers.colorBy')}
        <div
          role="group"
          aria-label={t('atm.map.layers.colorBy')}
          className="inline-flex overflow-hidden rounded-lg border border-slate-300 dark:border-slate-600"
        >
          {segment('zone', t('atm.map.layers.byZone'))}
          {segment('bank', t('atm.map.layers.byBank'))}
        </div>
      </div>
    </section>
  );
};
