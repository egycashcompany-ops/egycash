// The two pools the crew screens drag from — قادة الأطقم and الأخصائيين — side by side, as the
// legacy board drew them (tashghela.ejs: the green leaders column and the red specialists column).
//
// ONE COMPONENT FOR BOTH SCREENS. The daily board and the standing crew offered the same pool
// through two copies of the same markup; splitting it into two pools in two places would have
// been four copies to keep in step. The screens keep what differs — where the filter state lives
// (the standing crew remembers it in the URL, the daily board does not) — and nothing else.
//
// THE SPLIT DECIDES WHERE A PLANNER LOOKS, NOT WHAT THEY MAY DO. `splitPool` reads the `isCaptain`
// flag, exactly as legacy read `leader`; a captain can still be dropped into a specialist slot,
// and dropping anybody back onto EITHER pool takes them off the board.
//
// Each pool scrolls on its own and, on a wide screen, stays put while the vehicles scroll beside
// it — with 50 captains and 100 specialists, a pool that scrolled away with the page would mean
// dragging a name past the top of the screen to reach the twentieth vehicle.
//
// SIDE BY SIDE ONLY WHERE IT FITS. From `xl` the two pools stand next to each other, as legacy
// drew them. Between `lg` and `xl` — a 1024–1279px window with the sidebar open — two columns
// beside the board left the vehicle seats about 20px for a name and pushed each vehicle's time box
// under the pools, so there the two pools stack in one column, each taking half the height.
import { Link } from 'react-router-dom';
import { type OperationsCrewMemberDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { cn } from '../../../shared/lib/cn';
import { Card } from '../../../shared/ui/Card';
import { Input } from '../../../shared/ui/form';
import { Spinner } from '../../../shared/ui/Spinner';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import {
  POOL_KINDS,
  availablePool,
  filterPool,
  splitPool,
  type BoardRow,
  type PoolKind,
  type RequirementFilter,
} from '../lib/crew-board';
import { CREW_DRAG_TYPE, CrewMemberCard } from './CrewMemberCard';
import { CrewRosterNotice } from './CrewRosterNotice';

/** One pool's narrowing: its own search and its own icon filters, as each legacy column had. */
export interface PoolQuery {
  search: string;
  flags: RequirementFilter[];
}

export const EMPTY_POOL_QUERIES: Record<PoolKind, PoolQuery> = {
  captains: { search: '', flags: [] },
  specialists: { search: '', flags: [] },
};

/**
 * The icon filters each pool offers, in the legacy order (tashghela.ejs:1114-1142). `isCaptain` is
 * no longer among them: the pools are SPLIT on it, so as a filter it would empty one pool and do
 * nothing to the other.
 */
export const POOL_FILTERS: RequirementFilter[] = [
  'hasWeapon',
  'hasSignature',
  'hasLicense',
  'hasTemporaryLicense',
];

/** Legacy coloured the two columns green and red; operators read them by colour first. */
const ACCENT: Record<PoolKind, string> = {
  captains: 'border-t-4 border-t-emerald-500 dark:border-t-emerald-600',
  specialists: 'border-t-4 border-t-rose-500 dark:border-t-rose-600',
};

const PoolColumn = ({
  kind,
  listed,
  ready,
  query,
  onQueryChange,
  canPlan,
  onReturn,
  hint,
}: {
  kind: PoolKind;
  listed: OperationsCrewMemberDto[];
  /**
   * False while the roster loads or after it failed. An empty list then means "not known yet", and
   * saying "nobody is left to assign" — with a count of 0 — would tell the planner the whole crew
   * is already placed. Every date change on the daily board reloads the roster, so this was not a
   * one-off flash.
   */
  ready: boolean;
  query: PoolQuery;
  onQueryChange: (next: PoolQuery) => void;
  canPlan: boolean;
  onReturn: (employeeId: string) => void;
  hint: JSX.Element | null;
}): JSX.Element => {
  const t = useT();
  const title = t(`operations.crew.pools.${kind}`);
  const narrowed = query.search.trim() !== '' || query.flags.length > 0;

  const toggle = (flag: RequirementFilter): void =>
    onQueryChange({
      ...query,
      flags: query.flags.includes(flag)
        ? query.flags.filter((f) => f !== flag)
        : [...query.flags, flag],
    });

  return (
    <Card className={cn('flex min-h-0 flex-col', ACCENT[kind])}>
      <section aria-label={title} className="flex min-h-0 flex-1 flex-col gap-2 p-3" data-pool={kind}>
        <h2 className="flex items-baseline justify-between gap-2 text-sm font-semibold">
          <span>{title}</span>
          {ready && (
            <span className="tabular-nums text-slate-500 dark:text-slate-400">({listed.length})</span>
          )}
        </h2>
        <Input
          aria-label={`${title} — ${t('operations.crew.searchPool')}`}
          placeholder={t('operations.crew.searchPool')}
          value={query.search}
          onChange={(e) => onQueryChange({ ...query, search: e.target.value })}
        />
        <div className="flex flex-wrap gap-1">
          {POOL_FILTERS.map((flag) => (
            <button
              key={flag}
              type="button"
              // Named WITH the pool: the page has two of every filter, and a screen reader's
              // controls list showed "سلاح" twice with nothing to say which pool each one narrows.
              // The visible word comes first, so the name still starts with what is on screen.
              aria-label={`${t(`operations.crew.flag.${flag}`)} — ${title}`}
              aria-pressed={query.flags.includes(flag)}
              onClick={() => toggle(flag)}
              className={
                query.flags.includes(flag)
                  ? 'rounded-full border border-brand-500 bg-brand-50 px-2 py-0.5 text-xs text-brand-700 dark:bg-brand-950 dark:text-brand-300'
                  : 'rounded-full border border-slate-200 px-2 py-0.5 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-400'
              }
            >
              {t(`operations.crew.flag.${flag}`)}
            </button>
          ))}
        </div>

        {hint}

        <div
          className="-mx-1 max-h-96 min-h-24 flex-1 space-y-2 overflow-y-auto px-1 pb-1 lg:max-h-none"
          // Dropping back onto a pool clears the member from wherever they were — either pool.
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const employeeId = e.dataTransfer.getData(CREW_DRAG_TYPE);
            if (employeeId === '' || !canPlan) return;
            onReturn(employeeId);
          }}
        >
          {ready && listed.length === 0 && hint === null && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {narrowed ? t('operations.crew.poolEmpty') : t(`operations.crew.pools.empty.${kind}`)}
            </p>
          )}
          {listed.map((member) => (
            <CrewMemberCard
              key={member.employeeId}
              member={member}
              draggable={canPlan}
              showCaptainBadge={kind !== 'captains'}
            />
          ))}
        </div>
      </section>
    </Card>
  );
};

export const CrewPools = ({
  members,
  rows,
  queries,
  onQueryChange,
  loading,
  error,
  onRetry,
  rosterIsDerived,
  canPlan,
  onReturn,
  className,
}: {
  /** The whole roster. Who is already on a card is worked out here, from `rows`. */
  members: readonly OperationsCrewMemberDto[];
  rows: readonly BoardRow[];
  queries: Record<PoolKind, PoolQuery>;
  onQueryChange: (kind: PoolKind, next: PoolQuery) => void;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  rosterIsDerived: boolean | undefined;
  canPlan: boolean;
  onReturn: (employeeId: string) => void;
  className?: string;
}): JSX.Element => {
  const t = useT();
  const pools = splitPool(availablePool(members, rows));

  // Nobody on the WHOLE roster is ticked as a captain — assigned or not. Then the split has
  // nothing to split on: every name sits under الأخصائيين and the captains column is empty for a
  // reason the planner cannot see from here. Said once, in the column that looks wrong, with the
  // way to fix it.
  const nobodyFlagged =
    !loading && members.length > 0 && members.every((m) => m.requirements?.isCaptain !== true);

  return (
    <div className={cn('flex min-h-0 flex-col gap-3', className)}>
      <CrewRosterNotice rosterIsDerived={rosterIsDerived} />
      {loading && <Spinner />}
      {error !== null && error !== undefined && <ErrorState error={error} onRetry={onRetry} />}
      <div className="grid min-h-0 flex-1 gap-3 sm:grid-cols-2 lg:grid-cols-1 lg:grid-rows-2 xl:grid-cols-2 xl:grid-rows-1">
        {POOL_KINDS.map((kind) => (
          <PoolColumn
            key={kind}
            kind={kind}
            listed={filterPool(pools[kind], queries[kind].flags, queries[kind].search)}
            ready={!loading && (error === null || error === undefined)}
            query={queries[kind]}
            onQueryChange={(next) => onQueryChange(kind, next)}
            canPlan={canPlan}
            onReturn={onReturn}
            hint={
              kind === 'captains' && nobodyFlagged ? (
                <p className="rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                  {t('operations.crew.pools.noCaptainsFlagged')}{' '}
                  <Link to="/operations/requirements" className="font-medium underline">
                    {t('operations.crew.pools.flagCaptains')}
                  </Link>
                </p>
              ) : null
            }
          />
        ))}
      </div>
    </div>
  );
};
