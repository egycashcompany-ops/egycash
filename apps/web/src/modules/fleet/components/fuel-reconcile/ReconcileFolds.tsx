// «مطابقة أرصدة الكروت» — what the sheet and the system do not share, folded under the table: in
// the sheet only, in the system only, last four digits that differ, the sheet's repeated rows, and
// the equal cards (the approved sample's five folds), plus batch 2's «صفوف لا تُطابَق» — rows that
// are never decided (one name read with different values, a name two live cards share, a balance
// that cannot be read, a row without a name, one card claimed by two rows). That fold is drawn
// only when the sheet has such rows.
//
// Batch 3 adds «تحتاج اختيارًا» (a number with no name whose last four fit a card or more — its
// candidates listed, nothing decided), «صفوف ليست كروتًا» (totals and notes, the totals row checked
// against the card balances), and, on «أرقام مختلفة», the card that holds the sheet's number in the
// system («الرقم في الشيت مسجَّل في النظام على …») or, when none does, «تحديث رقم الكارت» (the
// card's own edit dialog). «في الشيت وليس في النظام» gives way to «كروت في الشيت وليست في النظام»
// (its own section, with «إضافة») for the rows that name a card. The fold, its table and the two
// conflict tables are in `reconcile-folds-parts.tsx`.
import { type ReactNode } from 'react';
import {
  type FleetFuelCardDto,
  type FleetFuelReconcileDto,
  type FleetFuelSheetRowDto,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useCan } from '../../../../platform/rbac/Can';
import { cn } from '../../../../shared/lib/cn';
import { NUM, PATH } from '../FuelCardBoard';
import {
  changedNumbersOf,
  chooseConflictsOf,
  conflictRowsOf,
  dots,
  money,
  plainConflictsOf,
} from '../../lib/fuel-reconcile';
import { useReconcileCount } from '../../lib/fuel-reconcile-words';
import { CONFLICT_ICON, Figure, HistoryButton, Place } from './reconcile-cells';
import { ChooseTable, ConflictTable, Fold, MiniTable, NumbersTable } from './reconcile-folds-parts';

const TICK = ['M5 13l4 4L19 7'];

/** Every card the answer names — to name a candidate of «تحتاج اختيارًا». */
const cardsOf = (result: FleetFuelReconcileDto): Map<string, FleetFuelCardDto> =>
  new Map(
    [
      ...result.differs.map((line) => line.card),
      ...result.equal.map((line) => line.card),
      ...result.systemOnly,
      ...result.links.map((link) => link.card),
    ].map((card) => [card.id.toLowerCase(), card]),
  );

export const ReconcileFolds = ({
  result,
  cardNow,
  onHistory,
  onUpdateNumber,
}: {
  result: FleetFuelReconcileDto;
  /** The card as it stands now — the sheet's balance once applied on this screen. */
  cardNow: (card: FleetFuelCardDto) => FleetFuelCardDto;
  onHistory: (card: FleetFuelCardDto) => void;
  /** «تحديث رقم الكارت» — the card's own edit dialog, as on «بطاقات الوقود». */
  onUpdateNumber: (card: FleetFuelCardDto) => void;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const count = useReconcileCount();
  const R = 'fleet.fuelCards.reconcile.';
  const changedNumbers = changedNumbersOf(result);
  const conflicts = plainConflictsOf(result.conflicts);
  const choose = chooseConflictsOf(result.conflicts);
  const conflictRows = conflictRowsOf(conflicts);
  const known = cardsOf(result);
  // The sheet-only rows «كروت في الشيت وليست في النظام» offers to add live there; the rest here.
  const offered = new Set(result.newCards.map((row) => row.sheetRow));
  const sheetOnly = result.sheetOnly.filter((row) => !offered.has(row.row));
  const total = result.totalCheck;
  const sheetRow = (row: FleetFuelSheetRowDto): ReactNode[] => [
    <span key="n" dir="ltr" className="font-figures">
      {row.name}
    </span>,
    <span key="u" dir="ltr" className={NUM}>
      {dots(row.number)}
    </span>,
    <Figure key="b" value={row.balance} />,
    <span key="r" dir="ltr" className={cn(NUM, 'text-xs text-slate-500')}>
      {row.row}
    </span>,
  ];
  const colName = t(`${R}colName`);
  const colPlace = t(`${R}colPlace`);
  const colSheetNumber = t(`${R}colSheetNumber`);
  const colSystemNumber = t(`${R}colSystemNumber`);
  const colSystem = t(`${R}colSystem`);
  const colSheet = t(`${R}colSheet`);

  return (
    <div className="space-y-3" data-recon-folds="true">
      {conflicts.length > 0 && (
        <Fold
          mark="conflicts"
          title={t(`${R}secConflicts`)}
          note={t(`${R}secConflictsNote`)}
          count={conflicts.length}
          countText={count.rows(conflictRows)}
          tone="rose"
          icon={CONFLICT_ICON}
        >
          <ConflictTable conflicts={conflicts} />
        </Fold>
      )}
      {choose.length > 0 && (
        <Fold
          mark="choose"
          title={t(`${R}secChoose`)}
          note={t(`${R}secChooseNote`)}
          count={choose.length}
          countText={count.rows(conflictRowsOf(choose))}
          tone="violet"
          icon={PATH.card}
        >
          <ChooseTable conflicts={choose} cardOf={(id) => known.get(id.toLowerCase())} />
        </Fold>
      )}
      {result.skipped.length > 0 && (
        <Fold
          mark="skipped"
          title={t(`${R}secSkipped`)}
          note={t(`${R}secSkippedNote`)}
          count={result.skipped.length}
          countText={count.rows(result.skipped.length)}
          tone="slate"
          icon={PATH.box}
        >
          <MiniTable
            head={[t(`${R}colRow`), t(`${R}colText`), t(`${R}colFigure`), t(`${R}colCheck`)]}
            rows={result.skipped.map((row) => [
              <span key="r" dir="ltr" className={cn(NUM, 'text-xs text-slate-500')}>
                {row.row}
              </span>,
              <span key="t">{row.text === '' ? '—' : row.text}</span>,
              row.figure === null ? <span key="f">—</span> : <Figure key="f" value={row.figure} />,
              total !== null && total.row === row.row ? (
                <span
                  key="c"
                  data-recon-total-check={total.agrees ? 'agrees' : 'differs'}
                  className={cn(
                    'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[12px] font-bold',
                    total.agrees
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300'
                      : 'border-red-300 bg-red-50 text-red-800 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300',
                  )}
                >
                  {total.agrees ? '✓' : '✗'}{' '}
                  {t(total.agrees ? `${R}totalCheck.matches` : `${R}totalCheck.notMatches`)}
                </span>
              ) : (
                <span key="c" className="text-slate-400">
                  —
                </span>
              ),
            ])}
          />
        </Fold>
      )}
      {(result.newCards.length === 0 || sheetOnly.length > 0) && (
        <Fold
          mark="sheet-only"
          title={t(`${R}sheetOnly`)}
          // A card the sheet has and the system lacks is added from the sheet («إضافة»): the note
          // says so; the rows left here (no name to add by) keep batch 2's note.
          note={t(result.newCards.length === 0 ? `${R}newCards.noneNote` : `${R}secSheetOnlyNote`)}
          count={sheetOnly.length}
          countText={count.cards(sheetOnly.length)}
          tone="blue"
          icon={PATH.excel}
        >
          <MiniTable
            head={[colName, colSheetNumber, colSheet, t(`${R}colRow`)]}
            rows={sheetOnly.map(sheetRow)}
          />
        </Fold>
      )}
      <Fold
        mark="system-only"
        title={t(`${R}systemOnly`)}
        note={t(`${R}secSystemOnlyNote`)}
        count={result.systemOnly.length}
        countText={count.cards(result.systemOnly.length)}
        tone="cyan"
        icon={PATH.card}
      >
        <MiniTable
          head={[colName, colPlace, colSystemNumber, colSystem, t(`${R}colLog`)]}
          rows={result.systemOnly.map((card) => [
            <span key="n" dir="ltr" className="font-figures">
              {card.name}
            </span>,
            <Place key="p" card={card} />,
            <span key="u" dir="ltr" className={NUM}>
              {dots(card.number)}
            </span>,
            <Figure key="b" value={card.balance} />,
            <HistoryButton key="h" card={card} onOpen={() => onHistory(card)} />,
          ])}
        />
      </Fold>
      {changedNumbers.length > 0 && (
        <Fold
          mark="numbers"
          title={t(`${R}secNumbers`)}
          note={t(`${R}secNumbersNote`)}
          count={changedNumbers.length}
          countText={count.cards(changedNumbers.length)}
          tone="amber"
          icon={PATH.warn}
        >
          <NumbersTable
            lines={changedNumbers}
            cardNow={cardNow}
            onUpdateNumber={can('fleetFuelCard.edit') ? onUpdateNumber : null}
          />
        </Fold>
      )}
      {result.duplicates.length > 0 && (
        <Fold
          mark="duplicates"
          title={t(`${R}secDuplicates`)}
          note={t(`${R}secDuplicatesNote`)}
          count={result.duplicates.length}
          countText={count.cards(result.duplicates.length)}
          tone="slate"
          icon={PATH.copy}
        >
          <MiniTable
            head={[colName, colSheetNumber, colSheet, '']}
            rows={result.duplicates.map((row) => [
              ...sheetRow(row).slice(0, 3),
              <span key="t" className="text-xs text-slate-500">
                {t(`${R}times`, { times: count.times(row.times) })}
              </span>,
            ])}
          />
        </Fold>
      )}
      <Fold
        mark="equal"
        title={t(`${R}secEqual`)}
        note={t(`${R}equalNote`)}
        count={result.equal.length}
        countText={count.cards(result.equal.length)}
        tone="emerald"
        icon={TICK}
      >
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {result.equal.map((line) => (
            <span
              key={line.card.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs dark:border-slate-800 dark:bg-[#0b0f19]"
            >
              <span
                dir="ltr"
                className="truncate font-figures font-bold text-slate-800 dark:text-slate-200"
              >
                {line.card.name}
              </span>
              <span dir="ltr" className={cn(NUM, 'text-emerald-700 dark:text-emerald-400')}>
                {money(line.card.balance)}
              </span>
            </span>
          ))}
        </div>
      </Fold>
    </div>
  );
};
