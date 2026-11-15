// The two pools of «لوحة التشغيلة» — القادة and الأخصائيون — at the board's END: on the left in
// Arabic, as the legacy board had its two columns of names beside the table.
//
//   · القادة: green chips, and BLUE ones — the specialists ticked «قائد» too, who may take either a
//     captain's or a specialist's slot («اقدر اوظفهم ك قائد او اخصائى»);
//   · الأخصائيون: red chips.
//
// What the colours mean is said once, in the toolbar (`RoleLegend`). Each pool counts its people (and how many are still free), searches by name or code — folded,
// so «احمد» finds «أحمد» — and filters by the requirement icons (AND, as legacy's buttons). Somebody
// already on a row stays LISTED, after the free ones, dimmed, with where they sit: the pool answers
// «where is he», and dragging him from here moves him. Dropping a chip back onto either pool frees it.
import { type DragEvent, type HTMLAttributes, type ReactNode } from 'react';
import { type OperationsCrewMemberDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { cn } from '../../../shared/lib/cn';
import { formatNumber } from '../../../shared/lib/format';
import { useAppSelector } from '../../../store';
import { NUM } from '../../fleet/components/FuelCardBoard';
import { StrokeIcon } from '../../../shared/ui/StrokeIcon';
import { PLAN_FLAGS, type PlanFlag, type PlanPool, type PlanPoolQuery } from '../lib/crew-plan';
import { CrewPlanChip } from './CrewPlanChip';
import { FLAG_PATH } from './crew-plan-icons';

/** The pool's colour along its top, as legacy's green and red columns. */
const ACCENT: Record<PlanPool, string> = {
  captains: 'border-t-emerald-500 dark:border-t-emerald-600',
  specialists: 'border-t-rose-500 dark:border-t-rose-600',
};

export interface PoolChipHandlers {
  selected: string | null;
  dragging: string | null;
  canPlan: boolean;
  /** Where somebody sits — the row («213») and in words («213 · قائد الطاقم») — or null when free. */
  placedAt: (employeeId: string) => { short: string; long: string } | null;
  onSelect: (employeeId: string) => void;
  onDragStart: (employeeId: string, event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
}

export const CrewPlanPool = ({
  pool,
  listed,
  total,
  free,
  ready,
  query,
  onQueryChange,
  chips,
  drop,
  returnSelected,
  className,
}: {
  pool: PlanPool;
  listed: readonly OperationsCrewMemberDto[];
  total: number;
  free: number;
  /** The roster has arrived: until then an empty list means «not known yet», not «nobody». */
  ready: boolean;
  query: PlanPoolQuery;
  onQueryChange: (next: PlanPoolQuery) => void;
  chips: PoolChipHandlers;
  /** The pool is where a chip comes off the board — by drag, or by the button below. */
  drop: {
    armed: boolean;
    over: boolean;
    handlers: Pick<
      HTMLAttributes<HTMLElement>,
      'onDragOver' | 'onDragEnter' | 'onDragLeave' | 'onDrop'
    >;
  };
  /** A seated chip is picked up: the keyboard's way to send it back. */
  returnSelected: ReactNode;
  className?: string;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  const title = t(`operations.crewPlan.pools.${pool}`);
  const narrowed = query.search.trim() !== '' || query.flags.length > 0;

  const toggle = (flag: PlanFlag): void =>
    onQueryChange({
      ...query,
      flags: query.flags.includes(flag)
        ? query.flags.filter((f) => f !== flag)
        : [...query.flags, flag],
    });

  return (
    <section
      aria-label={title}
      data-plan-pool={pool}
      className={cn(
        'flex min-h-0 min-w-0 flex-col rounded-2xl border border-t-4 border-slate-200 bg-slate-50/70 dark:border-slate-800 dark:bg-[#0b1226]',
        ACCENT[pool],
        className,
      )}
    >
      {/* Kept short: on a laptop each pool has a third of the screen's height, and every pixel the
          header takes is a name the list cannot show. */}
      <header className="shrink-0 space-y-1 border-b border-slate-200 px-2 py-1.5 dark:border-slate-800">
        <h2 className="flex items-center gap-2">
          <span className="text-[15px] font-black text-slate-900 dark:text-white">{title}</span>
          <span
            data-pool-total={ready ? String(total) : undefined}
            className={cn(
              'rounded-full bg-slate-200/80 px-2 py-0.5 text-xs font-black text-slate-700 dark:bg-slate-700/60 dark:text-slate-200',
              NUM,
            )}
          >
            {ready ? formatNumber(total, locale) : '…'}
          </span>
          {ready && (
            <span className="ms-auto text-[11.5px] font-bold text-slate-500 dark:text-slate-400">
              {t('operations.crewPlan.pools.free', { count: formatNumber(free, locale) })}
            </span>
          )}
        </h2>
        <div className="relative">
          <svg
            viewBox="0 0 24 24"
            aria-hidden
            className="pointer-events-none absolute start-2 top-1.5 h-4 w-4 text-slate-400"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            aria-label={`${title} — ${t('operations.crewPlan.pools.search')}`}
            placeholder={t('operations.crewPlan.pools.search')}
            value={query.search}
            onChange={(event) => onQueryChange({ ...query, search: event.target.value })}
            className="h-7 w-full rounded-lg border border-slate-300 bg-white pe-2 ps-8 text-[12.5px] font-bold text-slate-900 placeholder:font-semibold placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/25 dark:border-slate-700/80 dark:bg-[#080C14] dark:text-slate-100"
          />
        </div>
        {/* The icons as filters — each named WITH its pool: the page has two of every filter. One
            row whatever the pool's width: eight equal cells. */}
        <div
          className="grid grid-cols-8 gap-0.5"
          role="group"
          aria-label={t('operations.crewPlan.pools.filters')}
        >
          {PLAN_FLAGS.map((flag) => {
            const on = query.flags.includes(flag);
            return (
              <button
                key={flag}
                type="button"
                data-pool-flag={flag}
                aria-pressed={on}
                aria-label={`${t(`operations.crew.flag.${flag}`)} — ${title}`}
                title={t(`operations.crew.flag.${flag}`)}
                onClick={() => toggle(flag)}
                className={cn(
                  'flex h-6 min-w-0 items-center justify-center rounded-md border transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50',
                  on
                    ? 'border-brand-500 bg-brand-500 text-white dark:border-brand-400 dark:bg-brand-500'
                    : 'border-slate-300 bg-white text-slate-500 hover:border-brand-400 hover:text-brand-600 dark:border-slate-700 dark:bg-[#0a1233] dark:text-slate-400 dark:hover:text-brand-300',
                )}
              >
                <StrokeIcon d={FLAG_PATH[flag]} className="h-3.5 w-3.5" width={2} />
              </button>
            );
          })}
        </div>
      </header>

      <div
        {...drop.handlers}
        data-pool-drop={pool}
        data-drop-over={drop.over ? 'true' : undefined}
        className={cn(
          'min-h-[8rem] flex-1 space-y-1 overflow-y-auto rounded-b-2xl p-1.5 transition-colors',
          drop.armed &&
            'outline-dashed outline-2 -outline-offset-4 outline-brand-300 dark:outline-brand-500/50',
          drop.over && 'bg-brand-50 outline-brand-500 dark:bg-brand-500/10 dark:outline-brand-400',
        )}
      >
        {returnSelected}
        {drop.armed && (
          <p className="py-1 text-center text-[11.5px] font-bold text-brand-600 dark:text-brand-300">
            {t('operations.crewPlan.pools.dropBack')}
          </p>
        )}
        {ready && listed.length === 0 && (
          <p className="px-1 py-3 text-center text-xs font-bold text-slate-500 dark:text-slate-400">
            {narrowed
              ? t('operations.crewPlan.pools.noMatch')
              : t(`operations.crewPlan.pools.empty.${pool}`)}
          </p>
        )}
        {listed.map((member) => (
          <CrewPlanChip
            key={member.employeeId}
            member={member}
            variant="pool"
            selected={chips.selected === member.employeeId}
            dragging={chips.dragging === member.employeeId}
            canPlan={chips.canPlan}
            placedAt={chips.placedAt(member.employeeId)}
            onSelect={() => chips.onSelect(member.employeeId)}
            onDragStart={(event) => chips.onDragStart(member.employeeId, event)}
            onDragEnd={chips.onDragEnd}
          />
        ))}
      </div>
    </section>
  );
};
