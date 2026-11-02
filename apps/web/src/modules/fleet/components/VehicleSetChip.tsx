// The NAMELESS chip of a vehicle-set filter a screen cannot name: a dashboard link narrowed it by
// type or operation, but this reader may not read the types list or the operations catalog (their
// own endpoints' guards), so the screen says «أنواع مختارة» / «تشغيل مختار» instead of asking for
// names it would be refused — and the narrowing is still on the bar, and still comes off.
import { useT } from '../../../platform/localization/useT';

export const VehicleSetChip = ({
  kind,
  onClear,
}: {
  kind: 'type' | 'operation';
  onClear: () => void;
}): JSX.Element => {
  const t = useT();
  const label = t(
    kind === 'type' ? 'fleet.dash.filters.someTypes' : 'fleet.dash.filters.someOperations',
  );
  return (
    <button
      type="button"
      data-vehicle-set-chip={kind}
      onClick={onClear}
      aria-label={`${t('common.remove')} ${label}`}
      className="inline-flex h-9 items-center gap-1 whitespace-nowrap rounded-lg border border-brand-300 bg-brand-50 px-2 text-sm font-medium text-brand-700 hover:bg-brand-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:border-brand-800 dark:bg-brand-950 dark:text-brand-300 dark:hover:bg-brand-900"
    >
      {label}
      <span aria-hidden="true">×</span>
    </button>
  );
};
