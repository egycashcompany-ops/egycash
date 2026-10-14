// «عدد الماكينات والبنوك والمناطق يظهر فوق بجانب جملة كل الماكينات (ويتغير بناء على الفلتر)».
//
// Three small figures beside the title — how many machines, how many banks, how many areas — each
// the SERVER's count over everything the filter matches in the reader's scope
// (`GET /atm/machines/summary`), never the rows of the page in hand: a page of twenty-five would
// answer «how many are on this screen» while looking like an answer to «how many are there».
import { type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { cn } from '../../../shared/lib/cn';
import { formatNumber } from '../../../shared/lib/format';
import { StrokeIcon } from '../../../shared/ui/StrokeIcon';

/** The directory's icons — each filter's, and each figure's. Stroke paths, 24×24. */
export const MACHINE_ICON = {
  machine: ['M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z'],
  bank: ['M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z'],
  code: ['M7 20l4-16m2 16l4-16M6 9h14M4 15h14'],
  name: [
    'M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z',
  ],
  area: [
    'M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z',
    'M15 11a3 3 0 11-6 0 3 3 0 016 0z',
  ],
} as const;

export interface MachineCounts {
  machines: number;
  banks: number;
  areas: number;
}

const FIGURES = [
  { key: 'machines', icon: MACHINE_ICON.machine, tone: 'bg-blue-500/10 text-blue-600 dark:text-blue-400' },
  { key: 'banks', icon: MACHINE_ICON.bank, tone: 'bg-violet-500/10 text-violet-600 dark:text-violet-300' },
  { key: 'areas', icon: MACHINE_ICON.area, tone: 'bg-amber-500/10 text-amber-700 dark:text-amber-300' },
] as const;

/** The three figures; `undefined` while the first answer is on its way — a dash, not a zero. */
export const MachineFigures = ({
  counts,
  locale,
}: {
  counts: MachineCounts | undefined;
  locale: Locale;
}): JSX.Element => {
  const t = useT();
  return (
    <div
      data-machine-figures="true"
      role="group"
      aria-label={t('atm.machines.figures.label')}
      className="flex flex-wrap items-center gap-1.5"
    >
      {FIGURES.map((figure) => (
        <span
          key={figure.key}
          data-machine-figure={figure.key}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white py-1 pe-2.5 ps-1 text-sm dark:border-slate-800 dark:bg-[#111827]"
        >
          <span className={cn('rounded-md p-1', figure.tone)}>
            <StrokeIcon d={figure.icon} className="h-3.5 w-3.5" />
          </span>
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {t(`atm.machines.figures.${figure.key}`)}
          </span>
          <span
            data-machine-figure-value={figure.key}
            className="font-bold tabular-nums text-slate-900 dark:text-white"
          >
            {formatNumber(counts?.[figure.key], locale)}
          </span>
        </span>
      ))}
    </div>
  );
};
