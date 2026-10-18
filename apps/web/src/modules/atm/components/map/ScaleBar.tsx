// The Arabic scale bar (docs/12-planning/atm-map-zones.md §8.4, DM-28): Leaflet's own scale
// control speaks English only. The longest round distance that fits in 72 px at the map's centre.
import { type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { formatNumber } from '../../../../shared/lib/format';
import { scaleFor } from '../../lib/map-scale';

export const ScaleBar = ({
  metersPerPixel,
  locale,
}: {
  metersPerPixel: number;
  locale: Locale;
}): JSX.Element | null => {
  const t = useT();
  const bar = scaleFor(metersPerPixel);
  if (bar === null) return null;
  return (
    <div
      data-map-scale="true"
      dir={locale === 'ar' ? 'rtl' : 'ltr'}
      className="pointer-events-none absolute bottom-2 left-3 z-[1100] flex items-end gap-1 text-[11px] text-slate-700"
    >
      <span
        aria-hidden="true"
        className="block h-1.5 border-[1.5px] border-t-0 border-slate-700"
        style={{ width: `${String(Math.round(bar.px))}px` }}
      />
      {t(bar.label.key, { n: formatNumber(bar.label.n, locale) })}
    </div>
  );
};
