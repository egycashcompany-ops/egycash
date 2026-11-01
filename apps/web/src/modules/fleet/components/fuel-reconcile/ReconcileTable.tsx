// «مطابقة أرصدة الكروت» — the cards whose balance DIFFERS, the largest difference first: card ·
// company · system · sheet · difference, a ✓ (the card takes the sheet's balance — an adjustment in
// its log) and a ✗ (the card stays as it is — the refusal is logged too), ticks with «تحديد الكل»
// and «اعتماد المحدد ✓» / «رفض المحدد ✗». The approved sample's table (PNGs cs1–cs8), class for
// class, with batch 2's «تغيّر بعد القراءة»: a card the server refused ✓ for (its balance or log
// moved after the read) loses its tick and its ✓; its ✗ stays, since nothing moves.
//
// The small cells it shares with the folds and the dialog are in `reconcile-cells.tsx`.
import { type ReactNode } from 'react';
import {
  type FleetFuelCardDto,
  type FleetFuelReconcileDecision,
  type FleetFuelReconcileLineDto,
  type FleetFuelReconcileResultDto,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { BulkActionBar } from '../../../../shared/ui/BulkActionBar';
import { cn } from '../../../../shared/lib/cn';
import { BoardIcon, CompanyBadge, NUM, PATH } from '../FuelCardBoard';
import { MOVES_CHIP, SECTION_CARD, SECTION_STRIP } from '../custody-board-looks';
import { TITLE } from '../custody-dashboard-parts';
import {
  decisionOf,
  dots,
  largestOf,
  lastFour,
  money,
  netOf,
  openLines,
  tickedLines,
  timeOf,
  type ReconcileSelection,
} from '../../lib/fuel-reconcile';
import { useReconcileCount } from '../../lib/fuel-reconcile-words';
import {
  Check,
  Difference,
  Figure,
  HistoryButton,
  MOVED_ICON,
  Net,
  Place,
} from './reconcile-cells';

/** «الكارت» — its name over its place and its number's end; four digits that differ, in amber. */
const CardCell = ({
  line,
  moved,
}: {
  line: FleetFuelReconcileLineDto;
  moved: boolean;
}): JSX.Element => {
  const t = useT();
  return (
    <span className="flex flex-col items-start gap-1 text-start">
      <span
        dir="ltr"
        title={line.card.name}
        className="whitespace-nowrap font-figures text-[15px] font-bold tracking-wide text-slate-900 dark:text-white"
      >
        {line.card.name}
      </span>
      <span className="flex flex-wrap items-center gap-1.5">
        <Place card={line.card} />
        <span
          dir="ltr"
          className={cn(NUM, 'whitespace-nowrap text-[13px] text-slate-500 dark:text-slate-400')}
        >
          {dots(line.card.number)}
        </span>
        {!line.numberMatches && (
          <span
            data-recon-number-changed={line.card.id}
            title={t('fleet.fuelCards.reconcile.numberDiffersTitle', {
              sheet: lastFour(line.sheet.number),
              system: lastFour(line.card.number),
            })}
            className="inline-flex items-center gap-1 whitespace-nowrap rounded border border-amber-300 bg-amber-50 px-1.5 py-px text-[11px] font-bold text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
          >
            <BoardIcon d={PATH.warn} className="h-3 w-3" />
            {t('fleet.fuelCards.reconcile.numberDiffers')}
            <span dir="ltr" className={NUM}>
              {lastFour(line.sheet.number)}
            </span>
          </span>
        )}
        {moved && (
          <span
            data-recon-moved-tag={line.card.id}
            className="inline-flex items-center gap-1 whitespace-nowrap rounded border border-amber-400 bg-amber-100 px-1.5 py-px text-[11px] font-bold text-amber-900 dark:border-amber-400/50 dark:bg-amber-400/15 dark:text-amber-200"
          >
            <BoardIcon d={MOVED_ICON} className="h-3 w-3" />
            {t('fleet.fuelCards.reconcile.movedTag')}
          </span>
        )}
      </span>
    </span>
  );
};

const DECIDE =
  'inline-flex h-8 w-8 items-center justify-center rounded-lg border text-base font-black transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50';

/** ✓ / ✗ — or, once decided, what was decided, the balance it left, and who decided it. */
const Decision = ({
  line,
  result,
  busy,
  allowed,
  moved,
  onDecide,
}: {
  line: FleetFuelReconcileLineDto;
  result: FleetFuelReconcileResultDto | undefined;
  busy: boolean;
  allowed: boolean;
  /** ✓ is refused for a card that moved; ✗ stays (nothing moves). */
  moved: boolean;
  onDecide: (decision: FleetFuelReconcileDecision) => void;
}): JSX.Element => {
  const t = useT();
  if (result !== undefined) {
    const applied = result.decision === 'apply';
    return (
      <span
        className="mx-auto inline-flex flex-col items-center gap-0.5"
        data-recon-verdict={result.decision}
      >
        <span
          className={cn(
            'inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1 text-[13px] font-bold',
            applied
              ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300'
              : 'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300',
          )}
        >
          <span className="text-sm font-black">{applied ? '✓' : '✗'}</span>
          {applied
            ? t('fleet.fuelCards.reconcile.applied')
            : t('fleet.fuelCards.reconcile.rejected')}
          <span className="font-semibold opacity-80">
            ·{' '}
            {applied
              ? t('fleet.fuelCards.reconcile.appliedNote')
              : t('fleet.fuelCards.reconcile.rejectedNote')}
          </span>
          <span dir="ltr" className={NUM}>
            {money(result.balance)}
          </span>
        </span>
        <span className="whitespace-nowrap text-[11px] text-slate-500 dark:text-slate-400">
          {result.byName ?? '—'} ·{' '}
          <span dir="ltr" className={NUM}>
            {timeOf(result.at)}
          </span>
        </span>
      </span>
    );
  }
  const apply = moved
    ? t('fleet.fuelCards.reconcile.movedApply')
    : t('fleet.fuelCards.reconcile.apply', { balance: money(line.sheet.balance) });
  const reject = t('fleet.fuelCards.reconcile.reject', { balance: money(line.card.balance) });
  return (
    <span className="mx-auto inline-flex items-center gap-1.5">
      <button
        type="button"
        data-recon-apply={line.card.id}
        title={apply}
        aria-label={apply}
        disabled={busy || !allowed || moved}
        onClick={() => onDecide('apply')}
        className={cn(
          DECIDE,
          'border-emerald-500/40 bg-emerald-600/15 text-emerald-700 hover:bg-emerald-600/25 dark:text-emerald-400',
        )}
      >
        ✓
      </button>
      <button
        type="button"
        data-recon-reject={line.card.id}
        title={reject}
        aria-label={reject}
        disabled={busy || !allowed}
        onClick={() => onDecide('reject')}
        className={cn(
          DECIDE,
          'border-red-500/40 bg-red-600/15 text-red-700 hover:bg-red-600/25 dark:text-red-400',
        )}
      >
        ✗
      </button>
    </span>
  );
};

const TH = 'whitespace-nowrap px-3 py-2.5 text-[13px] font-semibold';
const TD = 'px-3 py-2 text-sm text-slate-700 dark:text-slate-200';

export const ReconcileTable = ({
  lines,
  selection,
  mayDecide,
  deciding,
  onToggle,
  onTickAll,
  onClear,
  onDecide,
  onBulk,
  onHistory,
}: {
  lines: readonly FleetFuelReconcileLineDto[];
  selection: ReconcileSelection;
  /** `fleetFuelCharge.approve` — without it there are no ticks and ✓ / ✗ are disabled. */
  mayDecide: boolean;
  deciding: boolean;
  onToggle: (id: string, on: boolean) => void;
  onTickAll: (on: boolean) => void;
  onClear: () => void;
  /** A single row's ✓ / ✗ — one click, as in the sample. */
  onDecide: (id: string, decision: FleetFuelReconcileDecision) => void;
  /** The bulk buttons only open the confirmation. */
  onBulk: (decision: FleetFuelReconcileDecision) => void;
  onHistory: (card: FleetFuelCardDto) => void;
}): JSX.Element => {
  const t = useT();
  const count = useReconcileCount();
  const tickable = openLines(lines, selection);
  const ticked = tickedLines(lines, selection);
  const largest = largestOf(lines);
  const reviewed = Object.keys(selection.decided).length;
  const allTicked = tickable.length > 0 && ticked.length === tickable.length;
  const companyName = (line: FleetFuelReconcileLineDto): string =>
    t(`fleet.fuelCards.company.${line.card.company}`);
  const head = (cell: ReactNode, align: 'start' | 'center' = 'center'): JSX.Element => (
    <th className={cn(TH, align === 'start' ? 'text-start' : 'text-center')}>{cell}</th>
  );

  return (
    <section className={SECTION_CARD} data-recon-table="true">
      <div className={SECTION_STRIP}>
        <span className="flex items-center gap-3">
          <h2 className={TITLE}>{t('fleet.fuelCards.reconcile.tableTitle')}</h2>
          <span className={MOVES_CHIP}>{count.cards(lines.length)}</span>
          <span
            data-recon-reviewed="true"
            className={cn(
              'rounded-full border px-2.5 py-0.5 text-xs font-bold',
              reviewed === lines.length && lines.length > 0
                ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300'
                : reviewed > 0
                  ? 'border-[#6c63ff]/50 bg-[#6c63ff]/10 text-[#4f3dff] dark:text-[#a59dff]'
                  : 'border-slate-300 bg-white text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300',
            )}
          >
            {t('fleet.fuelCards.reconcile.reviewed', { done: reviewed, all: lines.length })}
          </span>
        </span>
      </div>
      {mayDecide && ticked.length > 0 && (
        <div
          className="border-b border-slate-200 px-3 py-2.5 dark:border-[#1c293f]"
          data-recon-bulk="true"
        >
          <BulkActionBar
            count={ticked.length}
            onClear={onClear}
            label={t('fleet.fuelCards.reconcile.selected', { count: count.cardsOf(ticked.length) })}
          >
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              {t('fleet.fuelCards.reconcile.selectedNet')} <Net value={netOf(ticked)} />
            </span>
            <button
              type="button"
              data-recon-apply-selected="true"
              disabled={deciding}
              onClick={() => onBulk('apply')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-sm font-bold text-white shadow-sm shadow-emerald-700/30 transition hover:bg-emerald-500 disabled:opacity-50"
            >
              {t('fleet.fuelCards.reconcile.applySelected')}
            </button>
            <button
              type="button"
              data-recon-reject-selected="true"
              disabled={deciding}
              onClick={() => onBulk('reject')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3.5 py-1.5 text-sm font-bold text-white shadow-sm shadow-red-700/30 transition hover:bg-red-500 disabled:opacity-50"
            >
              {t('fleet.fuelCards.reconcile.rejectSelected')}
            </button>
          </BulkActionBar>
        </div>
      )}
      <div className="overflow-x-auto bg-white dark:bg-[#0d1424]/85">
        <table className="w-full border-collapse" data-recon-list="true">
          <thead>
            <tr className="bg-slate-50 text-slate-500 dark:bg-[#0c1322] dark:text-slate-400 [&_th]:shadow-[inset_0_-1px_0_#cbd5e1] dark:[&_th]:shadow-[inset_0_-1px_0_#233552]">
              {mayDecide && (
                <th className="w-12 px-4 py-2.5">
                  <Check
                    on={allTicked}
                    partly={ticked.length > 0}
                    label={t('fleet.fuelCards.reconcile.tickAll')}
                    data-recon-tick-all="true"
                    onChange={onTickAll}
                  />
                </th>
              )}
              <th className={cn(TH, 'w-10 text-center')}>{t('fleet.violations.report.serial')}</th>
              {head(t('fleet.fuelCards.reconcile.colCard'), 'start')}
              {head(t('fleet.fuelCards.reconcile.colCompany'))}
              {head(t('fleet.fuelCards.reconcile.colSystem'))}
              {head(t('fleet.fuelCards.reconcile.colSheet'))}
              {head(
                <>
                  {t('fleet.fuelCards.reconcile.colDiff')}
                  <span className="ms-1 text-[11px] font-medium opacity-75">
                    ({t('fleet.fuelCards.reconcile.colDiffNote')})
                  </span>
                </>,
              )}
              {head(t('fleet.fuelCards.reconcile.colDecision'))}
              {head(t('fleet.fuelCards.reconcile.colLog'))}
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => {
              const id = line.card.id.toLowerCase();
              const done = decisionOf(selection, id);
              const isMoved = done === undefined && selection.moved.has(id);
              const on = done === undefined && !isMoved && selection.picked.has(id);
              return (
                <tr
                  key={line.card.id}
                  data-recon-row={line.card.id}
                  data-recon-state={done?.decision ?? (isMoved ? 'moved' : on ? 'ticked' : 'open')}
                  className={cn(
                    'border-t border-slate-100 transition-colors dark:border-slate-800/80',
                    done === undefined && 'hover:bg-slate-100/70 dark:hover:bg-slate-800/40',
                    on && 'bg-brand-50/70 dark:bg-brand-950/40',
                    done?.decision === 'apply' && 'bg-emerald-50/70 dark:bg-emerald-500/[0.06]',
                    done?.decision === 'reject' && 'bg-slate-50 dark:bg-white/[0.02]',
                    isMoved && 'bg-amber-50/80 dark:bg-amber-400/[0.05]',
                  )}
                >
                  {mayDecide && (
                    <td className="px-4 py-2 text-center">
                      {isMoved ? (
                        <span aria-hidden className="text-slate-300 dark:text-slate-600">
                          —
                        </span>
                      ) : done === undefined ? (
                        <Check
                          on={on}
                          label={t('fleet.fuelCards.reconcile.tickOne', { name: line.card.name })}
                          data-recon-tick={line.card.id}
                          onChange={(next) => onToggle(id, next)}
                        />
                      ) : (
                        <span
                          className={cn(
                            'text-sm font-black',
                            done.decision === 'apply'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-slate-400',
                          )}
                        >
                          {done.decision === 'apply' ? '✓' : '✗'}
                        </span>
                      )}
                    </td>
                  )}
                  <td className={cn(TD, 'text-center')}>
                    <span
                      dir="ltr"
                      className={cn(NUM, 'text-xs text-slate-400 dark:text-slate-500')}
                    >
                      {index + 1}
                    </span>
                  </td>
                  <td className={cn(TD, 'text-start')}>
                    <CardCell line={line} moved={isMoved} />
                  </td>
                  <td className={cn(TD, 'text-center')}>
                    <span className="inline-flex items-center gap-2 whitespace-nowrap">
                      <CompanyBadge company={line.card.company} />
                      <span className="text-sm font-bold text-slate-700 dark:text-slate-300">
                        {companyName(line)}
                      </span>
                    </span>
                  </td>
                  <td className={cn(TD, 'text-center')}>
                    <Figure value={line.card.balance} struck={done?.decision === 'apply'} />
                  </td>
                  <td className={cn(TD, 'text-center')}>
                    <span className="inline-flex flex-col items-center">
                      <Figure value={line.sheet.balance} struck={done?.decision === 'reject'} />
                      <span className="text-[11px] text-slate-400">
                        {t('fleet.fuelCards.reconcile.row', { row: line.sheet.row })}
                      </span>
                    </span>
                  </td>
                  <td className={cn(TD, 'text-center', done !== undefined && 'opacity-60')}>
                    <Difference value={line.difference} largest={largest} />
                  </td>
                  <td className={cn(TD, 'text-center')}>
                    <Decision
                      line={line}
                      result={done}
                      busy={deciding}
                      allowed={mayDecide}
                      moved={isMoved}
                      onDecide={(decision) => onDecide(id, decision)}
                    />
                  </td>
                  <td className={cn(TD, 'text-center')}>
                    <HistoryButton card={line.card} onOpen={() => onHistory(line.card)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
};
