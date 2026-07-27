// The bucket strip every stage page opens with (RW6a/RW11). Buckets ARE the stage's own status
// enum (I10), and their counts come from the aggregated counters endpoint — the same numbers the
// navigation badges read, so a tab and its badge can never disagree.
import { cn } from '../../../../shared/lib/cn';

export interface StageBucket {
  key: string;
  label: string;
  count: number;
}

export const StageBuckets = ({
  buckets,
  active,
  onPick,
}: {
  buckets: StageBucket[];
  active: string;
  onPick: (key: string) => void;
}): JSX.Element => (
  <div className="flex flex-wrap gap-1 border-b border-slate-200 pb-2 dark:border-slate-800" role="tablist">
    {buckets.map((b) => (
      <button
        key={b.key}
        type="button"
        role="tab"
        aria-selected={b.key === active}
        onClick={() => onPick(b.key)}
        className={cn(
          'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors',
          b.key === active
            ? 'bg-brand-600 font-medium text-white'
            : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
        )}
      >
        <span>{b.label}</span>
        {b.count > 0 && (
          <span
            className={cn(
              'rounded-full px-1.5 text-[11px] font-semibold tabular-nums',
              b.key === active ? 'bg-white/20' : 'bg-slate-200 dark:bg-slate-700',
            )}
          >
            {b.count}
          </span>
        )}
      </button>
    ))}
  </div>
);
