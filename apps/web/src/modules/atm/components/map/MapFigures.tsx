// The four figures beside «خريطة الماكينات» (docs/12-planning/atm-map-zones.md §8.8, §6.4): on the
// map, inside zones, outside zones, without a location. The `MachineFigures` style — small chips,
// the count in bold — and every number is a formula of §6.4 over the VISIBLE points, so the chips
// move with the filters.
//
// «بدون موقع» is amber with «?», and a link to the unlocated screen only for a holder of
// `atmMachine.locate`; for anybody else it is plain text, because that screen would refuse them.
import { Link } from 'react-router-dom';
import { type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { cn } from '../../../../shared/lib/cn';
import { formatNumber } from '../../../../shared/lib/format';
import { StrokeIcon } from '../../../../shared/ui/StrokeIcon';
import { type MapFigures as Figures } from '../../lib/map-filters';
import { MAP_ICON } from './map-icons';

const CHIP = 'inline-flex items-center gap-1.5 rounded-lg border py-1 pe-2.5 ps-1 text-sm';

const FIGURES = [
  { key: 'onMap', icon: MAP_ICON.pin, tone: 'bg-blue-500/10 text-blue-600 dark:text-blue-400' },
  {
    key: 'inZones',
    icon: MAP_ICON.zones,
    tone: 'bg-violet-500/10 text-violet-600 dark:text-violet-300',
  },
  {
    key: 'outZones',
    icon: MAP_ICON.outside,
    tone: 'bg-slate-500/10 text-slate-600 dark:text-slate-300',
  },
] as const;

export const MapFigures = ({
  figures,
  locale,
  unlocatedLink,
}: {
  /** Undefined while the points are on their way — a dash, not a zero. */
  figures: Figures | undefined;
  locale: Locale;
  /** The unlocated screen, for a locate holder; null → plain text. */
  unlocatedLink: { onOpen: () => void; href: string } | null;
}): JSX.Element => {
  const t = useT();
  const unlocated = (
    <>
      <span
        aria-hidden="true"
        className="flex h-[22px] w-[22px] items-center justify-center rounded-md bg-amber-500/15 text-xs font-bold text-amber-700"
      >
        ?
      </span>
      <span className="text-xs font-medium text-amber-800 dark:text-amber-300">
        {t('atm.map.figures.unlocated')}
      </span>
      <span
        data-map-figure-value="unlocated"
        className="font-bold tabular-nums text-slate-900 dark:text-white"
      >
        {formatNumber(figures?.unlocated, locale)}
      </span>
    </>
  );
  const amber = cn(CHIP, 'border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950');
  return (
    <div
      data-map-figures="true"
      role="group"
      aria-label={t('atm.map.figures.label')}
      className="flex flex-wrap items-center gap-1.5"
    >
      {FIGURES.map((figure) => (
        <span
          key={figure.key}
          data-map-figure={figure.key}
          className={cn(CHIP, 'border-slate-200 bg-white dark:border-slate-800 dark:bg-[#111827]')}
        >
          <span className={cn('rounded-md p-1', figure.tone)}>
            <StrokeIcon d={figure.icon} className="h-3.5 w-3.5" />
          </span>
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {t(`atm.map.figures.${figure.key}`)}
          </span>
          <span
            data-map-figure-value={figure.key}
            className="font-bold tabular-nums text-slate-900 dark:text-white"
          >
            {formatNumber(figures?.[figure.key], locale)}
          </span>
        </span>
      ))}
      {unlocatedLink === null ? (
        <span data-map-figure="unlocated" className={amber}>
          {unlocated}
        </span>
      ) : (
        <Link
          data-map-figure="unlocated"
          to={unlocatedLink.href}
          onClick={(event) => {
            event.preventDefault();
            unlocatedLink.onOpen();
          }}
          className={cn(amber, 'hover:bg-amber-100 dark:hover:bg-amber-900')}
        >
          {unlocated}
        </Link>
      )}
    </div>
  );
};
