// The figures behind a board's «الإحصائيات» — a row of single numbers, then lists with how many
// rows sit in each entry. The vehicles screen's, shared with the notices screen («زى شاشه السيارات»).
import type { ReactNode } from 'react';
import type { Locale } from '@ecms/contracts';
import { cn } from '../../../shared/lib/cn';
import { formatMoneyParts } from '../../../shared/lib/format';
import { BoardIcon, NUM } from './FuelCardBoard';

/**
 * A sum of money for a `FigureChip`: the figure in the boards' monospace, «ج.م.» as its unit in the
 * page's own type — spread straight onto the chip.
 */
export const moneyChip = (amount: number, locale: Locale): { value: string; unit: string } => {
  const { figure, currency } = formatMoneyParts(amount, 'EGP', locale);
  return { value: figure, unit: currency };
};

/** One figure across the top: small, one line of words over one number. */
export const FigureChip = ({
  icon,
  iconClass,
  label,
  value,
  valueClass,
  unit,
  note,
  className,
}: {
  icon: readonly string[];
  iconClass: string;
  label: string;
  value: number | string;
  valueClass?: string;
  unit: string;
  /** A small line under the number — words, or words with a figure of their own in them. */
  note?: ReactNode;
  /** For the card itself — `h-full`, where it sits in a cell of a row it must match. */
  className?: string;
}): JSX.Element => (
  <div
    className={cn(
      'flex min-w-0 items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] px-2.5 py-3 sm:gap-3 sm:px-4',
      className,
    )}
  >
    <span className={cn('shrink-0 rounded-lg p-2 sm:p-2.5', iconClass)}>
      <BoardIcon d={icon} className="h-5 w-5" />
    </span>
    <span className="leading-tight">
      <span className="block text-xs font-medium text-slate-500 dark:text-slate-400">{label}</span>
      <span className="flex items-baseline gap-1">
        <span className={cn('text-2xl font-black text-slate-900 dark:text-white', NUM, valueClass)}>
          {value}
        </span>
        <span className="text-xs text-slate-500 dark:text-slate-400">{unit}</span>
      </span>
      {/* The note as bright as the label over it on a dark tile: slate-500 there is about 3.7:1. */}
      {note !== undefined && (
        <span className="block text-[11px] text-slate-500 dark:text-slate-400">{note}</span>
      )}
    </span>
  </div>
);

/** One list — licence classes, operations or insurers — with how many cars sit in each entry. */
export const BreakdownCard = ({
  title,
  rows,
  total,
}: {
  title: string;
  rows: readonly { id: string; name: string; count: number }[];
  total: number;
}): JSX.Element => (
  <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-3">
    <div className="mb-2 flex items-center justify-between">
      <span className="text-xs font-bold text-slate-800 dark:text-slate-200">{title}</span>
      <span
        className={cn(
          'rounded-md bg-slate-100 dark:bg-slate-800 px-1.5 text-[11px] text-slate-500 dark:text-slate-400',
          NUM,
        )}
      >
        {rows.filter((row) => row.id !== '').length}
      </span>
    </div>
    <ul className="space-y-1.5">
      {rows.map((row) => (
        <li key={row.id} className="text-xs">
          <div className="flex items-center justify-between gap-2">
            <span
              className={cn(
                'truncate',
                row.id === '' ? 'text-slate-500' : 'text-slate-600 dark:text-slate-300',
              )}
            >
              {row.name}
            </span>
            <span className={cn('shrink-0 font-bold text-slate-900 dark:text-white', NUM)}>
              {row.count}
            </span>
          </div>
          <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div
              className="h-full rounded-full bg-blue-400/70"
              style={{ width: `${total === 0 ? 0 : Math.round((row.count / total) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  </div>
);
