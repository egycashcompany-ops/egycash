// «تعذّر تحميل الشوارع…» (docs/12-planning/atm-map-zones.md §8.4): more than six tiles failed within
// ten seconds. The zones and the machines are drawn on the canvas and do not need the streets, so
// the map keeps working on a blank background — this only says why it looks empty.
import { useT } from '../../../../platform/localization/useT';
import { AlertIcon } from '../../../../shared/ui/icons';

export const TileErrorBanner = ({ dir }: { dir: 'rtl' | 'ltr' }): JSX.Element => {
  const t = useT();
  return (
    <div
      role="status"
      dir={dir}
      className="absolute inset-x-3 top-14 z-[1100] mx-auto flex max-w-md items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 shadow"
    >
      <AlertIcon className="h-4 w-4 shrink-0" />
      {t('atm.map.tilesFailed')}
    </div>
  );
};
