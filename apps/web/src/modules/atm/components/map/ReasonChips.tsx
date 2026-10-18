// Why machines have no location, as filter chips (docs/12-planning/atm-map-zones.md §8.8
// `ReasonChips`, `Unlocated.dc.html:76-80`): one per reason with machines in it, in the spec's order,
// each pressed or not. Several can be pressed; the page keeps them in `?reasons=`.
import { type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { cn } from '../../../../shared/lib/cn';
import { formatNumber } from '../../../../shared/lib/format';
import { chipLabelKey, type UnlocatedChip } from '../../lib/unlocated-view';

/** A chip's colours — amber for a pin to review, blue for a link, red for what failed. */
export const chipTone = (chip: UnlocatedChip): string => {
  switch (chip) {
    case 'review':
      return 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200';
    case 'shortLink':
      return 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200';
    case 'shortLinkFailed':
    case 'invalidCoordinates':
      return 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200';
    case 'noCoordinates':
    case 'shortPlusCodeNoReference':
      return 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200';
    default:
      return 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200';
  }
};

export const ReasonChips = ({
  chips,
  selected,
  locale,
  onToggle,
}: {
  chips: readonly { chip: UnlocatedChip; count: number }[];
  selected: readonly string[];
  locale: Locale;
  onToggle: (chip: UnlocatedChip) => void;
}): JSX.Element => {
  const t = useT();
  return (
    <div
      role="group"
      aria-label={t('atm.map.figures.unlocated')}
      data-reason-chips="true"
      className="flex flex-wrap gap-1.5"
    >
      {chips.map(({ chip, count }) => {
        const on = selected.includes(chip);
        return (
          <button
            key={chip}
            type="button"
            aria-pressed={on}
            data-reason-chip={chip}
            onClick={() => onToggle(chip)}
            className={cn(
              'inline-flex h-[30px] items-center gap-1.5 rounded-full border px-2.5 text-xs transition-shadow',
              chipTone(chip),
              on && 'ring-2 ring-brand-500 ring-offset-1 dark:ring-offset-slate-900',
            )}
          >
            {t(chipLabelKey(chip))} <strong>{formatNumber(count, locale)}</strong>
          </button>
        );
      })}
    </div>
  );
};
