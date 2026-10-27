// «التغذية الأولى» … «التغذية الثالثة» with its time (S-5, DS-31; §9.3) — the run every line
// carries, coloured per run as the mockup draws it, and always written out: the colour only helps
// the eye, the words are what the chip says (§9.10).
import { type AtmPlanRun, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { cn } from '../../../../shared/lib/cn';
import { formatTime12 } from '../../lib/settlement-dates';
import { runLabel } from '../../lib/settlement-view';

const RUN_TONE: Readonly<Record<AtmPlanRun, string>> = {
  1: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  2: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300',
  3: 'bg-pink-100 text-pink-800 dark:bg-pink-950 dark:text-pink-300',
};

export const RunChip = ({
  run,
  time,
  locale,
}: {
  run: AtmPlanRun;
  /** 'HH:mm', or null when no time is set (the chip shows the run alone). */
  time: string | null;
  locale: Locale;
}): JSX.Element => {
  const t = useT();
  const at = formatTime12(time, locale);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5" data-run-chip={run}>
      <span
        className={cn(
          'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
          RUN_TONE[run],
        )}
      >
        {runLabel(run, t)}
      </span>
      {at !== '' && (
        <span dir="ltr" className="text-xs tabular-nums text-slate-500 dark:text-slate-400">
          {at}
        </span>
      )}
    </span>
  );
};
