// «مطابقة أرصدة الكروت» — above the table: the sheet that was read (company, file, rows, when) with
// «رفع شيت آخر»; a red alert when the sheet's card names belong to the other company; batch 2's red
// banner when ✓ was refused because a balance changed after the read (nothing was written — the
// cards are named, and the sheet is to be read again); the four counts; and the note chips (rows
// that never match, last four digits that differ, the sheet's repeated rows).
import {
  FLEET_FUEL_SHEET_NAME_PREFIX,
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
  netOf,
  repeatsOf,
  stampOf,
  wrongCompanyOf,
} from '../../lib/fuel-reconcile';
import { useReconcileCount } from '../../lib/fuel-reconcile-words';
import { CONFLICT_ICON, Net } from './reconcile-cells';

const ANOTHER =
  'inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3.5 py-2 text-xs font-bold transition';
const ALERT =
  'rounded-xl border border-red-500/40 bg-red-50 px-4 py-3 text-sm font-bold text-red-800 dark:bg-red-950/40 dark:text-red-200';
const NOTE_CHIP =
  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold';

export const ReconcileHeader = ({
  result,
  decided,
  movedLines,
  onAnother,
}: {
  result: FleetFuelReconcileDto;
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
  const conflictRows = conflictRowsOf(result.conflicts);
  const repeats = repeatsOf(result.duplicates);
  const sheetSays = wrongCompanyOf(result);
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
              <span dir="ltr" className="font-bold text-slate-800 dark:text-slate-200">
                {result.fileName}
              </span>
              <span className={MOVES_CHIP}>{count.rows(result.rows)}</span>
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

      {sheetSays !== null && (
        <p
          role="alert"
          data-recon-wrong-company="true"
          className={cn(ALERT, 'flex items-start gap-2')}
        >
          <BoardIcon d={PATH.warn} className="mt-0.5 h-4 w-4 shrink-0" />
          {t('fleet.fuelCards.reconcile.wrongCompany', {
            prefix: FLEET_FUEL_SHEET_NAME_PREFIX[sheetSays],
            sheet: companyName(sheetSays),
            picked: companyName(result.company),
          })}
        </p>
      )}

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
                {t('fleet.fuelCards.reconcile.moved', { cards: count.cardsOf(movedLines.length) })}
              </span>
              <span className="flex flex-wrap items-center gap-1.5" data-recon-moved-names="true">
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

      {(repeats > 0 || changedNumbers.length > 0 || conflictRows > 0) && (
        <div className="flex flex-wrap items-center gap-2" data-recon-notes="true">
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
  );
};
