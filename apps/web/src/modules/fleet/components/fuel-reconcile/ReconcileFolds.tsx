// «مطابقة أرصدة الكروت» — what the sheet and the system do not share, folded under the table: in
// the sheet only, in the system only, last four digits that differ, the sheet's repeated rows, and
// the equal cards (the approved sample's five folds), plus batch 2's «صفوف لا تُطابَق» — rows that
// are never decided (one name read with different values, a name two live cards share, a balance
// that cannot be read, a row without a name). That fold is drawn only when the sheet has such rows.
import { useState, type ReactNode } from 'react';
import {
  type FleetFuelCardDto,
  type FleetFuelReconcileDto,
  type FleetFuelSheetConflictDto,
  type FleetFuelSheetRowDto,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { cn } from '../../../../shared/lib/cn';
import { BoardIcon, NUM, PATH } from '../FuelCardBoard';
import { SECTION_CARD, SECTION_STRIP } from '../custody-board-looks';
import { TITLE } from '../custody-dashboard-parts';
import { changedNumbersOf, conflictRowsOf, dots, money } from '../../lib/fuel-reconcile';
import { useReconcileCount } from '../../lib/fuel-reconcile-words';
import { CONFLICT_ICON, Figure, HistoryButton, Place } from './reconcile-cells';

type FoldTone = 'amber' | 'blue' | 'cyan' | 'slate' | 'emerald' | 'rose';
const FOLD_CHIP: Record<FoldTone, string> = {
  amber:
    'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300',
  blue: 'border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-500/40 dark:bg-blue-500/10 dark:text-blue-300',
  cyan: 'border-cyan-300 bg-cyan-50 text-cyan-800 dark:border-cyan-500/40 dark:bg-cyan-500/10 dark:text-cyan-300',
  slate:
    'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300',
  emerald:
    'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300',
  rose: 'border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300',
};

/** A folded group — its title, count and note on the strip; its rows when opened. Closed at first. */
const Fold = ({
  mark,
  title,
  note,
  count,
  countText,
  tone,
  icon,
  children,
}: {
  mark: string;
  title: string;
  note: string;
  count: number;
  /** The chip's words — cards, or rows for the conflicts fold. */
  countText: string;
  tone: FoldTone;
  icon: readonly string[];
  children: ReactNode;
}): JSX.Element => {
  const [open, setOpen] = useState(false);
  return (
    <section className={SECTION_CARD} data-recon-fold={mark} data-open={open ? 'true' : 'false'}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        disabled={count === 0}
        data-recon-fold-toggle={mark}
        className={cn(
          SECTION_STRIP,
          'w-full text-start enabled:cursor-pointer enabled:hover:bg-slate-100 disabled:opacity-70 dark:enabled:hover:bg-[#0d1424]',
          !open && 'border-b-0',
        )}
      >
        <span className="flex items-center gap-3">
          <BoardIcon
            d={['M15 19l-7-7 7-7']}
            className={cn(
              'h-4 w-4 text-slate-500 transition-transform',
              open && '-rotate-90',
              count === 0 && 'opacity-0',
            )}
          />
          <span className={cn('rounded-lg p-1.5', FOLD_CHIP[tone], 'border-0')}>
            <BoardIcon d={icon} className="h-3.5 w-3.5" />
          </span>
          <span className={TITLE}>{title}</span>
          <span
            className={cn('rounded-full border px-2.5 py-0.5 text-xs font-bold', FOLD_CHIP[tone])}
          >
            {countText}
          </span>
        </span>
        <span className="text-xs text-slate-500 dark:text-slate-400">{note}</span>
      </button>
      {open && <div className="bg-white p-3 dark:bg-[#0d1424]/85">{children}</div>}
    </section>
  );
};

const MINI_FRAME = 'overflow-x-auto rounded-xl border border-slate-200 dark:border-[#1c293f]';
const MINI_HEAD =
  'bg-slate-100 text-xs font-bold text-slate-600 dark:bg-[#0c1322] dark:text-slate-300';

/** A small plain table inside a fold. */
const MiniTable = ({ head, rows }: { head: string[]; rows: ReactNode[][] }): JSX.Element => (
  <div className={MINI_FRAME}>
    <table className="w-full border-collapse text-center text-sm">
      <thead className={MINI_HEAD}>
        <tr>
          {head.map((cell, i) => (
            <th key={`${cell}-${i}`} className="whitespace-nowrap px-3 py-2">
              {cell}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-200 dark:divide-slate-800/80">
        {rows.map((row, i) => (
          <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
            {row.map((cell, j) => (
              <td
                key={j}
                className="whitespace-nowrap px-3 py-1.5 font-bold text-slate-800 dark:text-slate-200"
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

type ConflictRow = FleetFuelSheetConflictDto['rows'][number];

/**
 * «صفوف لا تُطابَق», opened: one line per name, its sheet rows stacked in it (a name read twice with
 * different values shows both rows), the reason in words. Nothing here is decided.
 */
const ConflictTable = ({
  conflicts,
}: {
  conflicts: readonly FleetFuelSheetConflictDto[];
}): JSX.Element => {
  const t = useT();
  const stack = (
    conflict: FleetFuelSheetConflictDto,
    cell: (row: ConflictRow) => ReactNode,
  ): JSX.Element => (
    <span className="flex flex-col items-center gap-1.5">
      {conflict.rows.map((row) => (
        <span key={row.row} className="leading-5">
          {cell(row)}
        </span>
      ))}
    </span>
  );
  const head = [
    t('fleet.fuelCards.reconcile.colName'),
    t('fleet.fuelCards.reconcile.colReason'),
    t('fleet.fuelCards.reconcile.colRow'),
    t('fleet.fuelCards.reconcile.colSheetNumber'),
    t('fleet.fuelCards.reconcile.colSheet'),
  ];
  return (
    <div className={MINI_FRAME}>
      <table className="w-full border-collapse text-center text-sm" data-recon-conflicts="true">
        <thead className={MINI_HEAD}>
          <tr>
            {head.map((cell) => (
              <th key={cell} className="whitespace-nowrap px-3 py-2">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 dark:divide-slate-800/80">
          {conflicts.map((conflict, index) => (
            <tr
              key={`${conflict.reason}-${conflict.name}-${index}`}
              data-recon-conflict={conflict.reason}
              className="align-middle hover:bg-slate-50 dark:hover:bg-slate-800/40"
            >
              <td className="whitespace-nowrap px-3 py-2 font-bold text-slate-800 dark:text-slate-200">
                {conflict.name === '' ? (
                  <span className="text-slate-400 dark:text-slate-500">
                    — {t('fleet.fuelCards.reconcile.noName')} —
                  </span>
                ) : (
                  <span dir="ltr" className="font-figures">
                    {conflict.name}
                  </span>
                )}
              </td>
              <td className="whitespace-nowrap px-3 py-2">
                <span className="inline-flex items-center gap-1 rounded border border-rose-300 bg-rose-50 px-1.5 py-0.5 text-[12px] font-bold text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300">
                  <BoardIcon d={PATH.warn} className="h-3 w-3" />
                  {t(`fleet.fuelCards.reconcile.conflict.${conflict.reason}`)}
                </span>
              </td>
              <td className="whitespace-nowrap px-3 py-2">
                {stack(conflict, (row) => (
                  <span
                    dir="ltr"
                    className={cn(NUM, 'text-xs font-bold text-slate-500 dark:text-slate-400')}
                  >
                    {row.row}
                  </span>
                ))}
              </td>
              <td className="whitespace-nowrap px-3 py-2 font-bold text-slate-800 dark:text-slate-200">
                {stack(conflict, (row) => (
                  <span dir="ltr" className={NUM}>
                    {row.number === '' ? '—' : dots(row.number)}
                  </span>
                ))}
              </td>
              <td className="whitespace-nowrap px-3 py-2">
                {stack(conflict, (row) =>
                  row.balance === null ? (
                    <span className="text-[13px] font-bold text-rose-700 dark:text-rose-300">
                      {t('fleet.fuelCards.reconcile.unreadable')}
                    </span>
                  ) : (
                    <Figure value={row.balance} />
                  ),
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const TICK = ['M5 13l4 4L19 7'];

export const ReconcileFolds = ({
  result,
  cardNow,
  onHistory,
}: {
  result: FleetFuelReconcileDto;
  /** The card as it stands now — the sheet's balance once applied on this screen. */
  cardNow: (card: FleetFuelCardDto) => FleetFuelCardDto;
  onHistory: (card: FleetFuelCardDto) => void;
}): JSX.Element => {
  const t = useT();
  const count = useReconcileCount();
  const changedNumbers = changedNumbersOf(result);
  const conflictRows = conflictRowsOf(result.conflicts);
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
  const colName = t('fleet.fuelCards.reconcile.colName');
  const colPlace = t('fleet.fuelCards.reconcile.colPlace');
  const colSheetNumber = t('fleet.fuelCards.reconcile.colSheetNumber');
  const colSystemNumber = t('fleet.fuelCards.reconcile.colSystemNumber');
  const colSystem = t('fleet.fuelCards.reconcile.colSystem');
  const colSheet = t('fleet.fuelCards.reconcile.colSheet');

  return (
    <div className="space-y-3" data-recon-folds="true">
      {result.conflicts.length > 0 && (
        <Fold
          mark="conflicts"
          title={t('fleet.fuelCards.reconcile.secConflicts')}
          note={t('fleet.fuelCards.reconcile.secConflictsNote')}
          count={result.conflicts.length}
          countText={count.rows(conflictRows)}
          tone="rose"
          icon={CONFLICT_ICON}
        >
          <ConflictTable conflicts={result.conflicts} />
        </Fold>
      )}
      <Fold
        mark="sheet-only"
        title={t('fleet.fuelCards.reconcile.sheetOnly')}
        note={t('fleet.fuelCards.reconcile.secSheetOnlyNote')}
        count={result.sheetOnly.length}
        countText={count.cards(result.sheetOnly.length)}
        tone="blue"
        icon={PATH.excel}
      >
        <MiniTable
          head={[colName, colSheetNumber, colSheet, t('fleet.fuelCards.reconcile.colRow')]}
          rows={result.sheetOnly.map(sheetRow)}
        />
      </Fold>
      <Fold
        mark="system-only"
        title={t('fleet.fuelCards.reconcile.systemOnly')}
        note={t('fleet.fuelCards.reconcile.secSystemOnlyNote')}
        count={result.systemOnly.length}
        countText={count.cards(result.systemOnly.length)}
        tone="cyan"
        icon={PATH.card}
      >
        <MiniTable
          head={[
            colName,
            colPlace,
            colSystemNumber,
            colSystem,
            t('fleet.fuelCards.reconcile.colLog'),
          ]}
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
          title={t('fleet.fuelCards.reconcile.secNumbers')}
          note={t('fleet.fuelCards.reconcile.secNumbersNote')}
          count={changedNumbers.length}
          countText={count.cards(changedNumbers.length)}
          tone="amber"
          icon={PATH.warn}
        >
          <MiniTable
            head={[colName, colPlace, colSheetNumber, colSystemNumber, colSystem, colSheet]}
            rows={changedNumbers.map((line) => [
              <span key="n" dir="ltr" className="font-figures">
                {line.card.name}
              </span>,
              <Place key="p" card={line.card} />,
              <span key="s" dir="ltr" className={cn(NUM, 'text-amber-700 dark:text-amber-300')}>
                {dots(line.sheet.number)}
              </span>,
              <span key="y" dir="ltr" className={NUM}>
                {dots(line.card.number)}
              </span>,
              <Figure key="a" value={cardNow(line.card).balance} />,
              <Figure key="b" value={line.sheet.balance} />,
            ])}
          />
        </Fold>
      )}
      {result.duplicates.length > 0 && (
        <Fold
          mark="duplicates"
          title={t('fleet.fuelCards.reconcile.secDuplicates')}
          note={t('fleet.fuelCards.reconcile.secDuplicatesNote')}
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
                {t('fleet.fuelCards.reconcile.times', { times: count.times(row.times) })}
              </span>,
            ])}
          />
        </Fold>
      )}
      <Fold
        mark="equal"
        title={t('fleet.fuelCards.reconcile.secEqual')}
        note={t('fleet.fuelCards.reconcile.equalNote')}
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
