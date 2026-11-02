// «مطابقة أرصدة الكروت» — above the table: the sheet that was read (company, file, card rows, the
// sheet's date, when it was read) with «رفع شيت آخر»; «طريقة قراءة الشيت» (batch 3); the wrong
// company's STOP — nothing else is drawn under it, and one click reads the file as the sheet's
// company; batch 2's red banner when ✓ was refused because a balance changed after the read
// (nothing was written — the cards are named, and the sheet is to be read again); the guard banner
// when more than half the card rows found no card; the four counts; and the note chips (the cards
// found, the totals row against the card balances, the rows that are not cards, rows that never
// match, last four digits that differ, the sheet's repeated rows).
import {
  type FleetFuelCardCompany,
  type FleetFuelReconcileDto,
  type FleetFuelReconcileLineDto,
  type FleetFuelReconcileResultDto,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { cn } from '../../../../shared/lib/cn';
import { BoardIcon, BoardKpi, CompanyBadge, NUM, PATH } from '../FuelCardBoard';
import { MOVES_CHIP } from '../custody-board-looks';
import { TITLE } from '../custody-dashboard-parts';
import {
  changedNumbersOf,
  conflictRowsOf,
  dayText,
  matchedRowsOf,
  money,
  mostUnmatched,
  netOf,
  plainConflictsOf,
  repeatsOf,
  stampOf,
  wrongCompanyOf,
} from '../../lib/fuel-reconcile';
import { useReconcileCount } from '../../lib/fuel-reconcile-words';
import { CONFLICT_ICON, FileName, Net } from './reconcile-cells';
import { GuardBanner, LayoutLine, WrongCompanyStop } from './reconcile-header-parts';

const ANOTHER =
  'inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3.5 py-2 text-xs font-bold transition';
const ALERT =
  'rounded-xl border border-red-500/40 bg-red-50 px-4 py-3 text-sm font-bold text-red-800 dark:bg-red-950/40 dark:text-red-200';
const NOTE_CHIP =
  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold';
const GOOD_CHIP =
  'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300';
const TICK = ['M5 13l4 4L19 7'];

export const ReconcileHeader = ({
  result,
  decided,
  movedLines,
  onAnother,
  onSwitch,
}: {
  result: FleetFuelReconcileDto;
  /** The wrong-company stop's one click: read the same file as the sheet's company. */
  onSwitch: (company: FleetFuelCardCompany) => void;
  /** The answers so far, by card id. */
  decided: Readonly<Record<string, FleetFuelReconcileResultDto>>;
  /** The differing cards the server refused ✓ for — moved after the read. */
  movedLines: readonly FleetFuelReconcileLineDto[];
  /** «رفع شيت آخر» — back to the two steps. */
  onAnother: () => void;
}): JSX.Element => {
  const t = useT();
  const count = useReconcileCount();
  const companyName = (company: FleetFuelCardCompany): string =>
    t(`fleet.fuelCards.company.${company}`);
  const lines = result.differs;
  const results = Object.values(decided);
  const applied = results.filter((r) => r.decision === 'apply').length;
  const rejected = results.filter((r) => r.decision === 'reject').length;
  const reviewed = applied + rejected;
  const changedNumbers = changedNumbersOf(result);
  // The rows that list candidates have a fold of their own («تحتاج اختيارًا»).
  const conflictRows = conflictRowsOf(plainConflictsOf(result.conflicts));
  const repeats = repeatsOf(result.duplicates);
  const sheetSays = wrongCompanyOf(result);
  const matched = matchedRowsOf(result);
  const skipped = result.skipped.length;
  const total = result.totalCheck;
  // An old session (read before batch 3) has no layout: its strip and chips read as before.
  const read = result.layout.length > 0;
  const muted = 'text-slate-500 dark:text-slate-400';

  return (
    <>
      {/* The sheet that was read, and a way to read another. */}
      <section
        data-recon-sheet="true"
        className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-slate-800 dark:bg-[#111827]"
      >
        <span className="flex flex-wrap items-center gap-3">
          <CompanyBadge company={result.company} size="lg" />
          <span className="flex flex-col gap-0.5">
            <span className={cn(TITLE, 'text-lg')}>
              {t('fleet.fuelCards.reconcile.title')} — {companyName(result.company)}
            </span>
            <span className="flex flex-wrap items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
              <BoardIcon
                d={PATH.excel}
                className="h-4 w-4 text-emerald-600 dark:text-emerald-400"
              />
              <FileName
                name={result.fileName}
                className="font-bold text-slate-800 dark:text-slate-200"
              />
              <span className={MOVES_CHIP}>{count.rows(result.cardRows)}</span>
              {result.sheetDate !== null && (
                <span
                  data-recon-sheet-date="true"
                  className="inline-flex items-center gap-1 rounded-full border border-[#6c63ff]/40 bg-[#6c63ff]/10 px-2.5 py-0.5 text-xs font-bold text-[#4f3dff] dark:text-[#a59dff]"
                >
                  <BoardIcon d={PATH.calendar} className="h-3.5 w-3.5" />
                  {t('fleet.fuelCards.reconcile.sheetDate')}{' '}
                  <span dir="ltr" className={NUM}>
                    {dayText(result.sheetDate)}
                  </span>
                </span>
              )}
              <span className="text-xs">
                {t('fleet.fuelCards.reconcile.readAt')}{' '}
                <span dir="ltr" className={NUM}>
                  {stampOf(result.readAt)}
                </span>
              </span>
            </span>
          </span>
        </span>
        <button
          type="button"
          data-recon-again="true"
          onClick={onAnother}
          className={cn(
            ANOTHER,
            'border-slate-300 bg-slate-100 text-slate-800 hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-200 dark:hover:bg-slate-700',
          )}
        >
          <BoardIcon
            d={PATH.excel}
            className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400"
          />
          {t('fleet.fuelCards.reconcile.another')}
        </button>
      </section>

      <LayoutLine result={result} />

      {/* The wrong company stops the comparison: one click reads the same file as the sheet's. */}
      {sheetSays !== null && (
        <WrongCompanyStop
          result={result}
          sheetSays={sheetSays}
          onSwitch={onSwitch}
          onAnother={onAnother}
        />
      )}
      {sheetSays === null && (
        <>
          {/* ✓ refused: a balance changed after the sheet was read. Nothing was written. */}
          {movedLines.length > 0 && (
            <div
              role="alert"
              data-recon-moved="true"
              className={cn(ALERT, 'flex flex-wrap items-start justify-between gap-3')}
            >
              <span className="flex min-w-0 flex-1 items-start gap-2">
                <BoardIcon d={PATH.warn} className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="min-w-0 space-y-2">
                  <span className="block leading-relaxed">
                    {t('fleet.fuelCards.reconcile.moved', {
                      cards: count.cardsOf(movedLines.length),
                    })}
                  </span>
                  <span
                    className="flex flex-wrap items-center gap-1.5"
                    data-recon-moved-names="true"
                  >
                    {movedLines.map((line) => (
                      <span
                        key={line.card.id}
                        dir="ltr"
                        className="rounded border border-red-300 bg-white px-1.5 py-px font-figures text-xs font-bold text-red-800 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200"
                      >
                        {line.card.name}
                      </span>
                    ))}
                  </span>
                </span>
              </span>
              <button
                type="button"
                data-recon-moved-again="true"
                onClick={onAnother}
                className={cn(
                  ANOTHER,
                  'border-red-300 bg-white text-red-800 hover:bg-red-100 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-100 dark:hover:bg-red-500/20',
                )}
              >
                <BoardIcon d={PATH.excel} className="h-3.5 w-3.5" />
                {t('fleet.fuelCards.reconcile.another')}
              </button>
            </div>
          )}

          {mostUnmatched(result) && <GuardBanner result={result} />}

          {/* The four counts. */}
          <section
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
            data-recon-counts="true"
          >
            <BoardKpi
              testId="recon-differs"
              tone="amber"
              icon={PATH.warn}
              hoverBorder="hover:border-amber-500/40"
              label={t('fleet.fuelCards.reconcile.differs')}
              value={String(lines.length)}
              valueClass="text-amber-600 dark:text-amber-400"
              unit={count.cardsNoun(lines.length)}
              note={
                reviewed > 0 ? (
                  <span className="text-slate-600 dark:text-slate-300" data-recon-progress="true">
                    {t('fleet.fuelCards.reconcile.differsLeft', {
                      applied,
                      rejected,
                      left: lines.length - reviewed,
                    })}
                  </span>
                ) : (
                  <span className={muted}>
                    {t('fleet.fuelCards.reconcile.differsNote')} <Net value={netOf(lines)} />{' '}
                    {t('fleet.fuelCards.board.kpi.currency')}
                  </span>
                )
              }
            />
            <BoardKpi
              testId="recon-equal"
              tone="emerald"
              icon={['M5 13l4 4L19 7']}
              label={t('fleet.fuelCards.reconcile.equal')}
              value={String(result.equal.length)}
              valueClass="text-emerald-600 dark:text-emerald-400"
              unit={count.cardsNoun(result.equal.length)}
              note={<span className={muted}>{t('fleet.fuelCards.reconcile.equalNote')}</span>}
            />
            <BoardKpi
              testId="recon-sheet-only"
              tone="blue"
              icon={PATH.excel}
              label={t('fleet.fuelCards.reconcile.sheetOnly')}
              value={String(result.sheetOnly.length)}
              unit={count.cardsNoun(result.sheetOnly.length)}
              note={
                <span className={muted}>
                  {t('fleet.fuelCards.reconcile.sheetOnlyNote', {
                    company: companyName(result.company),
                  })}
                </span>
              }
            />
            <BoardKpi
              testId="recon-system-only"
              tone="cyan"
              icon={PATH.card}
              label={t('fleet.fuelCards.reconcile.systemOnly')}
              value={String(result.systemOnly.length)}
              unit={count.cardsNoun(result.systemOnly.length)}
              note={
                <span className={muted}>
                  {t('fleet.fuelCards.reconcile.systemOnlyNote', {
                    company: companyName(result.company),
                  })}
                </span>
              }
            />
          </section>

          {(repeats > 0 || changedNumbers.length > 0 || conflictRows > 0 || read) && (
            <div className="flex flex-wrap items-center gap-2" data-recon-notes="true">
              {read && (
                <span data-recon-matched-chip="true" className={cn(NOTE_CHIP, GOOD_CHIP)}>
                  <BoardIcon d={TICK} className="h-3.5 w-3.5" />
                  {t('fleet.fuelCards.reconcile.matchedChip', {
                    matched,
                    rows: count.rows(result.cardRows),
                  })}
                </span>
              )}
              {total !== null && (
                <span
                  data-recon-total-chip={total.agrees ? 'agrees' : 'differs'}
                  className={cn(
                    NOTE_CHIP,
                    total.agrees
                      ? GOOD_CHIP
                      : 'border-red-300 bg-red-50 text-red-800 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300',
                  )}
                >
                  <BoardIcon d={total.agrees ? TICK : PATH.warn} className="h-3.5 w-3.5" />
                  {t(
                    total.agrees
                      ? 'fleet.fuelCards.reconcile.totalCheck.agrees'
                      : 'fleet.fuelCards.reconcile.totalCheck.differs',
                    {
                      sum: money(total.sum),
                      text: total.text,
                      row: total.row,
                      figure: money(total.figure),
                    },
                  )}
                </span>
              )}
              {skipped > 0 && (
                <span
                  data-recon-skipped-chip="true"
                  className={cn(
                    NOTE_CHIP,
                    'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300',
                  )}
                >
                  <BoardIcon d={PATH.box} className="h-3.5 w-3.5" />
                  {t('fleet.fuelCards.reconcile.secSkippedChip', { rows: count.rows(skipped) })}
                </span>
              )}
              {conflictRows > 0 && (
                <span
                  data-recon-conflicts-chip="true"
                  className={cn(
                    NOTE_CHIP,
                    'border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300',
                  )}
                >
                  <BoardIcon d={CONFLICT_ICON} className="h-3.5 w-3.5" />
                  {t('fleet.fuelCards.reconcile.conflictsChip', { rows: count.rows(conflictRows) })}
                </span>
              )}
              {changedNumbers.length > 0 && (
                <span
                  className={cn(
                    NOTE_CHIP,
                    'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300',
                  )}
                >
                  <BoardIcon d={PATH.warn} className="h-3.5 w-3.5" />
                  {t('fleet.fuelCards.reconcile.numberChanged', {
                    count: count.cardsOf(changedNumbers.length),
                  })}
                </span>
              )}
              {repeats > 0 && (
                <span
                  className={cn(
                    NOTE_CHIP,
                    'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300',
                  )}
                >
                  <BoardIcon d={PATH.copy} className="h-3.5 w-3.5" />
                  {t('fleet.fuelCards.reconcile.duplicates', { rows: count.repeatedRows(repeats) })}
                </span>
              )}
            </div>
          )}
        </>
      )}
    </>
  );
};
