// The open boards' day switch — today by default, then tomorrow, everything scheduled ahead, and
// the earlier days left open (`lib/board-day.ts`). One group of pressed/unpressed buttons, each
// with how many rows it holds, so a reader on today's board can see that tomorrow already has some.
//
// The project has no shared segmented control; this is the pill group the Fleet notice setup and
// license-expense screens write by hand (a bordered pill, the brand tint while pressed), kept here
// once for both boards.
import { type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { formatNumber } from '../../../shared/lib/format';
import { cn } from '../../../shared/lib/cn';
import { BOARD_DAY_VIEWS, type BoardDayView } from '../lib/board-day';

export const BoardDayToggle = ({
  value,
  counts,
  onChange,
}: {
  value: BoardDayView;
  counts: Record<BoardDayView, number>;
  onChange: (next: BoardDayView) => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  return (
    <div
      className="flex flex-wrap items-center gap-2"
      role="group"
      aria-label={t('atm.board.day.label')}
    >
      {BOARD_DAY_VIEWS.map((view) => {
        const pressed = view === value;
        return (
          <button
            key={view}
            type="button"
            aria-pressed={pressed}
            data-board-day={view}
            onClick={() => onChange(view)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
              pressed
                ? 'border-brand-500 bg-brand-500/15 text-brand-700 dark:text-brand-200'
                : 'border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800',
            )}
          >
            {t(`atm.board.day.${view}`)}
            <span
              className={cn(
                'rounded px-1.5 tabular-nums',
                pressed
                  ? 'bg-brand-500/20'
                  : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
              )}
            >
              {formatNumber(counts[view], locale)}
            </span>
          </button>
        );
      })}
    </div>
  );
};
