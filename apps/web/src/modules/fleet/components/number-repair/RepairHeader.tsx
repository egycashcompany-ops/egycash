// «تصحيح أرقام الكروت» (6d) — the top of the screen, as the approved sample draws it (01, 04, 06):
// the header (where it is reached from, whether it ran, when the review was read), the owner's rule
// (what travels with the physical card, what stays, the balances, the PIN), the four figures, and
// the red alert naming every unit a record changed by hand holds back.
import { type FleetFuelNumberRepairDto } from '@ecms/contracts';
import { Link } from 'react-router-dom';
import { useT } from '../../../../platform/localization/useT';
import { cn } from '../../../../shared/lib/cn';
import { BoardIcon, BoardKpi, CompanyBadge, NUM, PATH } from '../FuelCardBoard';
import { MOVES_CHIP } from '../custody-board-looks';
import { TITLE } from '../custody-dashboard-parts';
import { Filled } from '../fuel-reconcile/reconcile-cells';
import { RECONCILE_PATH, heldUnitsOf, type HeldUnit } from '../../lib/fuel-number-repair';
import { N, useRepairWords } from '../../lib/fuel-number-repair-words';
import { stampOf } from '../../lib/fuel-reconcile';
import { useReconcileCount } from '../../lib/fuel-reconcile-words';
import { BUTTON, PANEL, QUIET } from './repair-looks';
import { ICON, Tag, ymdOf } from './repair-parts';

/** A figure or a stamp, set left to right inside an Arabic sentence. */
const Ltr = ({ children }: { children: string }): JSX.Element => (
  <span dir="ltr" className={NUM}>
    {children}
  </span>
);

export const RepairHeader = ({
  repair,
  refreshing,
  onRefresh,
}: {
  repair: FleetFuelNumberRepairDto;
  refreshing: boolean;
  onRefresh: () => void;
}): JSX.Element => {
  const t = useT();
  const count = useReconcileCount();
  const done = repair.state === 'done';
  return (
    <section
      data-repair-header={repair.state}
      className={cn(PANEL, 'flex flex-wrap items-center justify-between gap-3 px-4 py-3')}
    >
      <span className="flex min-w-0 flex-wrap items-center gap-3">
        <CompanyBadge company={repair.company} size="lg" />
        <span className="flex min-w-0 flex-col gap-1">
          <span className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-500 dark:text-slate-400">
            {t('fleet.fuelCards.reconcile.title')}
            <svg viewBox="0 0 24 24" className="h-3 w-3" aria-hidden>
              <path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2" />
            </svg>
            <span className="text-slate-700 dark:text-slate-200">{t(`${N}crumb`)}</span>
          </span>
          <h1 className={cn(TITLE, 'text-lg')}>
            {t(`${N}title`, { company: t(`fleet.fuelCards.company.${repair.company}`) })}
          </h1>
          <span className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
            {done ? (
              <Tag tone="emerald" icon={ICON.ok} data-repair-status="done">
                <Filled
                  template={t(repair.executedByName === null ? `${N}doneTagNoName` : `${N}doneTag`)}
                  values={{
                    at: <Ltr>{repair.executedAt === null ? '—' : stampOf(repair.executedAt)}</Ltr>,
                    name: repair.executedByName ?? '',
                  }}
                />
              </Tag>
            ) : repair.state === 'partial' ? (
              <Tag tone="amber" icon={ICON.fix} data-repair-status="partial">
                {t(`${N}partialTag`, { done: repair.counts.done, all: repair.counts.records })}
              </Tag>
            ) : (
              <Tag tone="amber" icon={ICON.fix} data-repair-status="pending">
                {t(`${N}pendingTag`)}
              </Tag>
            )}
            <span className={MOVES_CHIP}>{count.cards(repair.counts.records)}</span>
            <span>
              <Filled
                template={t(done ? `${N}readDone` : `${N}readNow`)}
                values={{ at: <Ltr>{stampOf(repair.readAt)}</Ltr> }}
              />
            </span>
          </span>
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-2">
        {!done && (
          <button
            type="button"
            data-repair-refresh="true"
            disabled={refreshing}
            onClick={onRefresh}
            className={cn(BUTTON, QUIET, 'disabled:opacity-60')}
          >
            <BoardIcon d={ICON.cycle} className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
            {t(`${N}refresh`)}
          </button>
        )}
        <Link to={RECONCILE_PATH} data-repair-back="true" className={cn(BUTTON, QUIET)}>
          <BoardIcon
            d={PATH.excel}
            className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400"
          />
          {t(`${N}back`)}
        </Link>
      </span>
    </section>
  );
};

// ── The rule (the owner's answer) ───────────────────────────────────────────────────────────────

const Item = ({ text }: { text: string }): JSX.Element => (
  <li className="flex items-center gap-1.5">
    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-60" />
    {text}
  </li>
);

export const RepairRuleBox = ({ repair }: { repair: FleetFuelNumberRepairDto }): JSX.Element => {
  const t = useT();
  return (
    <section data-repair-rulebox="true" className={cn(PANEL, 'space-y-3 px-4 py-3.5')}>
      <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">
        <b className="text-slate-900 dark:text-white">{t(`${N}rule.why`)}</b>{' '}
        <Filled
          template={t(`${N}rule.whyBody`)}
          values={{
            day: <Ltr>{ymdOf(repair.goLiveDay)}</Ltr>,
            crossed: String(repair.counts.crossed),
          }}
        />
      </p>
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 px-3.5 py-2.5 dark:border-indigo-400/30 dark:bg-indigo-500/[0.08]">
          <p className="mb-1.5 flex items-center gap-1.5 text-[13px] font-bold text-indigo-800 dark:text-indigo-200">
            <BoardIcon d={ICON.card} className="h-4 w-4" />
            {t(`${N}rule.moves`)}
          </p>
          <ul className="grid grid-cols-2 gap-1 text-[12px] font-semibold text-indigo-900 dark:text-indigo-100">
            <Item text={t(`${N}rule.number`)} />
            <Item text={t(`${N}rule.pin`)} />
            <Item text={t(`${N}rule.photo`)} />
            <Item text={t(`${N}rule.expiry`)} />
          </ul>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 dark:border-slate-700 dark:bg-[#0b1220]">
          <p className="mb-1.5 flex items-center gap-1.5 text-[13px] font-bold text-slate-800 dark:text-slate-100">
            <BoardIcon d={ICON.lock} className="h-4 w-4" />
            {t(`${N}rule.stays`)}
          </p>
          <ul className="grid grid-cols-2 gap-1 text-[12px] font-semibold text-slate-700 dark:text-slate-200">
            <Item text={t(`${N}rule.name`)} />
            <Item text={t(`${N}rule.car`)} />
            <Item text={t(`${N}rule.balance`)} />
            <Item text={t(`${N}rule.log`)} />
          </ul>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-3.5 py-2.5 dark:border-amber-500/30 dark:bg-amber-500/[0.07]">
          <p className="mb-1.5 flex items-center gap-1.5 text-[13px] font-bold text-amber-900 dark:text-amber-200">
            <BoardIcon d={ICON.money} className="h-4 w-4" />
            {t(`${N}rule.balances`)}
          </p>
          <p
            data-repair-balances="true"
            className="text-[12px] font-semibold leading-relaxed text-amber-900 dark:text-amber-100"
          >
            {t(`${N}rule.balancesBody`)}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-amber-800/90 dark:text-amber-200/80">
            {t(`${N}rule.balancesPair`)}
          </p>
        </div>
      </div>
      <div className="space-y-1">
        <p
          data-repair-pin-follows="true"
          className="flex items-center gap-1.5 text-[13px] font-bold text-indigo-800 dark:text-indigo-200"
        >
          <BoardIcon d={ICON.lock} className="h-3.5 w-3.5" />
          {t(`${N}rule.pinRule`)}
        </p>
        <p className="text-[12px] text-slate-500 dark:text-slate-400">{t(`${N}rule.photos`)}</p>
      </div>
    </section>
  );
};

// ── The figures ─────────────────────────────────────────────────────────────────────────────────

export const RepairKpis = ({ repair }: { repair: FleetFuelNumberRepairDto }): JSX.Element => {
  const t = useT();
  const count = useReconcileCount();
  const words = useRepairWords();
  const noPin = repair.noPinAfterCars;
  const quiet = 'text-slate-500 dark:text-slate-400';
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-repair-kpis="true">
      <BoardKpi
        tone="blue"
        icon={ICON.card}
        label={t(`${N}kpi.all`)}
        value={String(repair.counts.records)}
        unit={count.cardsNoun(repair.counts.records)}
        note={<span className={quiet}>{t(`${N}kpi.allNote`)}</span>}
        testId="repair-all"
      />
      <BoardKpi
        tone="amber"
        icon={ICON.cycle}
        label={t(`${N}kpi.cycles`)}
        value={String(repair.counts.crossed)}
        unit={count.cardsNoun(repair.counts.crossed)}
        note={
          <span className={quiet}>
            {t(`${N}kpi.cyclesNote`, {
              count: repair.cycles.length,
              sizes: words.list(repair.cycles.map((cycle) => String(cycle.rows.length))),
            })}
          </span>
        }
        testId="repair-cycles"
      />
      <BoardKpi
        tone="cyan"
        icon={ICON.swap}
        label={t(`${N}kpi.pair`)}
        value={String(repair.counts.pair)}
        unit={count.cardsNoun(repair.counts.pair)}
        note={<span className={quiet}>{t(`${N}kpi.pairNote`)}</span>}
        testId="repair-pair"
      />
      <BoardKpi
        tone="emerald"
        icon={ICON.lock}
        label={t(`${N}kpi.noPin`)}
        value={String(noPin.length)}
        unit={words.numbersNoun(noPin.length)}
        note={
          <span className={cn('block text-balance', quiet)} data-repair-no-pin={noPin.join(',')}>
            {noPin.length === 0 ? (
              t(`${N}kpi.noPinNone`)
            ) : (
              <Filled
                template={t(`${N}kpi.noPinNote`)}
                values={{ cars: <span className={NUM}>{words.list(noPin)}</span> }}
              />
            )}
          </span>
        }
        testId="repair-no-pin"
      />
    </div>
  );
};

// ── A record changed by hand: the red alert ─────────────────────────────────────────────────────

/** «دائرة 2» or «زوج 0849». */
export const useUnitName = (): ((held: Pick<HeldUnit, 'n'>) => string) => {
  const t = useT();
  return (held) => (held.n === null ? t(`${N}pairName`) : t(`${N}cycleName`, { n: held.n }));
};

export const RepairChangedAlert = ({
  repair,
}: {
  repair: FleetFuelNumberRepairDto;
}): JSX.Element | null => {
  const t = useT();
  const count = useReconcileCount();
  const words = useRepairWords();
  const unitName = useUnitName();
  const held = heldUnitsOf(repair);
  if (held.length === 0) return null;
  const sentence = (unit: HeldUnit): string => {
    const name = unitName(unit);
    const values = {
      unit: name,
      car: unit.changed[0] ?? '—',
      cars: words.list(unit.changed),
      held: count.cards(unit.records),
    };
    if (unit.n === null) {
      return t(unit.changed.length > 1 ? `${N}alert.pairMany` : `${N}alert.pairOne`, values);
    }
    return t(unit.changed.length > 1 ? `${N}alert.many` : `${N}alert.one`, values);
  };
  const rest = repair.counts.ready;
  return (
    <div
      role="alert"
      data-repair-alert="changed"
      className="flex items-start gap-2 rounded-xl border border-red-500/40 bg-red-50 px-4 py-3 text-sm font-bold text-red-800 dark:bg-red-950/40 dark:text-red-200"
    >
      <BoardIcon d={PATH.warn} className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="space-y-1 leading-relaxed">
        {held.map((unit, i) => (
          <span key={unit.unit} className="block" data-repair-alert-unit={unit.unit}>
            {sentence(unit)}
            {i === held.length - 1 && rest > 0
              ? t(`${N}alert.rest`, { rest: count.cards(rest) })
              : t(`${N}alert.end`)}
          </span>
        ))}
      </span>
    </div>
  );
};
