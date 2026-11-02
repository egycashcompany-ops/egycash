// «مطابقة أرصدة الكروت» — the folds' building blocks (a split of `ReconcileFolds.tsx`): the fold
// itself, its small table, and the two tables of rows that are never decided — «صفوف لا تُطابَق»
// and «تحتاج اختيارًا» (a number with no name whose last four fit a card or more: its candidates
// are listed, a code may hint, nothing is decided from here).
//
// Both are drawn ONE table row per SHEET row, top-aligned, the name and the reason on the
// conflict's first row: batch 2 centred a whole conflict in one cell, so a 216-row conflict put its
// name and reason about 108 lines down. A conflict longer than ten rows shows ten and «و N أخرى».
import { useState, type ReactNode } from 'react';
import {
  type FleetFuelCardDto,
  type FleetFuelReconcileLineDto,
  type FleetFuelSheetConflictDto,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { cn } from '../../../../shared/lib/cn';
import { BoardIcon, NUM, PATH } from '../FuelCardBoard';
import { SECTION_CARD, SECTION_STRIP } from '../custody-board-looks';
import { TITLE } from '../custody-dashboard-parts';
import { dots, maskedOf, money } from '../../lib/fuel-reconcile';
import { useReconcileCount } from '../../lib/fuel-reconcile-words';
import { Figure, Place } from './reconcile-cells';

export type FoldTone = 'amber' | 'blue' | 'cyan' | 'slate' | 'emerald' | 'rose' | 'violet';
export const FOLD_CHIP: Record<FoldTone, string> = {
  amber:
    'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300',
  blue: 'border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-500/40 dark:bg-blue-500/10 dark:text-blue-300',
  cyan: 'border-cyan-300 bg-cyan-50 text-cyan-800 dark:border-cyan-500/40 dark:bg-cyan-500/10 dark:text-cyan-300',
  slate:
    'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300',
  emerald:
    'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300',
  rose: 'border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300',
  violet:
    'border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-300',
};

/** A folded group — its title, count and note on the strip; its rows when opened. Closed at first. */
export const Fold = ({
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

export const MINI_FRAME =
  'overflow-x-auto rounded-xl border border-slate-200 dark:border-[#1c293f]';
export const MINI_HEAD =
  'bg-slate-100 text-xs font-bold text-slate-600 dark:bg-[#0c1322] dark:text-slate-300';
const CELL = 'whitespace-nowrap px-3 py-1.5 font-bold text-slate-800 dark:text-slate-200';

/** A small plain table inside a fold. */
export const MiniTable = ({ head, rows }: { head: string[]; rows: ReactNode[][] }): JSX.Element => (
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
              <td key={j} className={CELL}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

/** The longest conflict shows this many rows, then «و N أخرى». */
export const CONFLICT_ROWS_SHOWN = 10;

type ConflictRow = FleetFuelSheetConflictDto['rows'][number];

/** A conflict row's balance: unreadable, negative (in red, a true minus) or a plain figure. */
const RowBalance = ({ row }: { row: ConflictRow }): JSX.Element => {
  const t = useT();
  return row.balance === null ? (
    <span className="text-[13px] font-bold text-rose-700 dark:text-rose-300">
      {t('fleet.fuelCards.reconcile.unreadable')}
    </span>
  ) : row.balance < 0 ? (
    <span
      dir="ltr"
      className={cn(
        NUM,
        'whitespace-nowrap text-[15px] font-bold text-rose-700 dark:text-rose-300',
      )}
    >
      −{money(Math.abs(row.balance))}
    </span>
  ) : (
    <Figure value={row.balance} />
  );
};

/** The reason tag, on the conflict's first row. */
const Reason = ({ conflict }: { conflict: FleetFuelSheetConflictDto }): JSX.Element => {
  const t = useT();
  const negative =
    conflict.reason === 'badBalance' &&
    conflict.rows.some((row) => row.balance !== null && row.balance < 0);
  return (
    <span className="inline-flex items-center gap-1 rounded border border-rose-300 bg-rose-50 px-1.5 py-0.5 text-[12px] font-bold text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300">
      <BoardIcon d={PATH.warn} className="h-3 w-3" />
      {negative
        ? t('fleet.fuelCards.reconcile.negativeBalance')
        : t(`fleet.fuelCards.reconcile.conflict.${conflict.reason}`)}
    </span>
  );
};

/** The conflict's name — a dash for a row with none. */
const ConflictName = ({ name }: { name: string }): JSX.Element => {
  const t = useT();
  return name === '' ? (
    <span className="text-slate-400 dark:text-slate-500">
      — {t('fleet.fuelCards.reconcile.noName')} —
    </span>
  ) : (
    <span dir="ltr" className="font-figures">
      {name}
    </span>
  );
};

/** «و N أخرى» under a conflict longer than ten rows. */
const MoreRows = ({ more, span }: { more: number; span: number }): JSX.Element => {
  const t = useT();
  const count = useReconcileCount();
  return (
    <tr data-recon-conflict-more={more}>
      <td
        colSpan={span}
        className="px-3 py-1.5 text-start text-xs font-bold text-slate-500 dark:text-slate-400"
      >
        {t('fleet.fuelCards.reconcile.moreRows', { rows: count.rows(more) })}
      </td>
    </tr>
  );
};

/** The sheet row's number and position, shared by both tables. */
const RowCells = ({ row }: { row: ConflictRow }): JSX.Element => (
  <>
    <td className="whitespace-nowrap px-3 py-1.5">
      <span dir="ltr" className={cn(NUM, 'text-xs font-bold text-slate-500 dark:text-slate-400')}>
        {row.row}
      </span>
    </td>
    <td className={CELL}>
      <span dir="ltr" className={NUM}>
        {row.number === '' ? '—' : maskedOf(row.number)}
      </span>
    </td>
    <td className="whitespace-nowrap px-3 py-1.5">
      <RowBalance row={row} />
    </td>
  </>
);

/** «صفوف لا تُطابَق», opened: one row per sheet row, top-aligned. Nothing here is decided. */
export const ConflictTable = ({
  conflicts,
}: {
  conflicts: readonly FleetFuelSheetConflictDto[];
}): JSX.Element => {
  const t = useT();
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
          {conflicts.flatMap((conflict, index) => {
            const shown = conflict.rows.slice(0, CONFLICT_ROWS_SHOWN);
            const more = conflict.rows.length - shown.length;
            const lines = shown.map((row, i) => (
              <tr
                key={`${conflict.reason}-${index}-${row.row}`}
                data-recon-conflict={conflict.reason}
                data-recon-conflict-row={row.row}
                className="align-top hover:bg-slate-50 dark:hover:bg-slate-800/40"
              >
                <td className={CELL}>{i === 0 && <ConflictName name={conflict.name} />}</td>
                <td className="whitespace-nowrap px-3 py-1.5">
                  {i === 0 && <Reason conflict={conflict} />}
                </td>
                <RowCells row={row} />
              </tr>
            ));
            if (more > 0) lines.push(<MoreRows key={`more-${index}`} more={more} span={5} />);
            return lines;
          })}
        </tbody>
      </table>
    </div>
  );
};

/**
 * «تحتاج اختيارًا», opened: each row with no name to check, the reason, and the cards its last
 * four fit — each named with its car or label. Listed only; nothing is decided from here.
 */
export const ChooseTable = ({
  conflicts,
  cardOf,
}: {
  conflicts: readonly FleetFuelSheetConflictDto[];
  cardOf: (id: string) => FleetFuelCardDto | undefined;
}): JSX.Element => {
  const t = useT();
  const head = [
    t('fleet.fuelCards.reconcile.colRow'),
    t('fleet.fuelCards.reconcile.colSheetNumber'),
    t('fleet.fuelCards.reconcile.colSheet'),
    t('fleet.fuelCards.reconcile.colReason'),
    t('fleet.fuelCards.reconcile.colCandidates'),
  ];
  return (
    <div className={MINI_FRAME}>
      <table className="w-full border-collapse text-center text-sm" data-recon-choose="true">
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
          {conflicts.flatMap((conflict, index) => {
            const shown = conflict.rows.slice(0, CONFLICT_ROWS_SHOWN);
            const more = conflict.rows.length - shown.length;
            const lines = shown.map((row, i) => (
              <tr
                key={`${conflict.reason}-${index}-${row.row}`}
                data-recon-choose-row={row.row}
                className="align-top hover:bg-slate-50 dark:hover:bg-slate-800/40"
              >
                <RowCells row={row} />
                <td className="whitespace-nowrap px-3 py-1.5">
                  {i === 0 && <Reason conflict={conflict} />}
                </td>
                <td className="px-3 py-1.5 text-start">
                  {i === 0 && (
                    <span className="flex flex-col items-start gap-1">
                      {conflict.candidateIds.map((id) => {
                        const card = cardOf(id);
                        return (
                          <span
                            key={id}
                            data-recon-candidate={id}
                            className="inline-flex items-center gap-1.5 whitespace-nowrap"
                          >
                            <span
                              dir="ltr"
                              className="font-figures text-[13px] font-bold text-slate-800 dark:text-slate-200"
                            >
                              {card?.name ?? '—'}
                            </span>
                            {card !== undefined && <Place card={card} />}
                          </span>
                        );
                      })}
                    </span>
                  )}
                </td>
              </tr>
            ));
            if (more > 0) lines.push(<MoreRows key={`more-${index}`} more={more} span={5} />);
            return lines;
          })}
        </tbody>
      </table>
    </div>
  );
};

/**
 * «أرقام مختلفة», opened: each card whose last four differ from the sheet's — the sheet's number
 * as printed, the system's, and the card that holds the sheet's number in the system (a crossed
 * number's partner) or, when none does, «تحديث رقم الكارت». The sheet's code is a hint beside the
 * car when it names another place.
 */
export const NumbersTable = ({
  lines,
  cardNow,
  onUpdateNumber,
}: {
  lines: readonly FleetFuelReconcileLineDto[];
  cardNow: (card: FleetFuelCardDto) => FleetFuelCardDto;
  /** `null` without the grant to edit cards. */
  onUpdateNumber: ((card: FleetFuelCardDto) => void) | null;
}): JSX.Element => {
  const t = useT();
  const R = 'fleet.fuelCards.reconcile.';
  return (
    <MiniTable
      head={[
        t(`${R}colName`),
        t(`${R}colPlace`),
        t(`${R}colSheetNumber`),
        t(`${R}colSystemNumber`),
        t(`${R}numberHolder`),
        t(`${R}colSystem`),
        t(`${R}colSheet`),
      ]}
      rows={lines.map((line) => [
        <span key="n" dir="ltr" className="font-figures">
          {line.card.name}
        </span>,
        <span key="p" className="inline-flex flex-col items-center gap-0.5">
          <Place card={line.card} />
          {/* A hint only: the sheet's code says another place. */}
          {line.placeMatches === false && line.sheet.code !== null && (
            <span
              data-recon-place-in-sheet={line.card.id}
              className="whitespace-nowrap text-[11px] font-semibold text-amber-700 dark:text-amber-300"
            >
              {t(`${R}placeInSheet`, { code: line.sheet.code })}
            </span>
          )}
        </span>,
        <span key="s" dir="ltr" className={cn(NUM, 'text-amber-700 dark:text-amber-300')}>
          {maskedOf(line.sheet.number)}
        </span>,
        <span key="y" dir="ltr" className={NUM}>
          {dots(line.card.number)}
        </span>,
        line.numberHolder !== null ? (
          <span
            key="h"
            className="inline-flex items-center gap-1.5"
            data-recon-holder={line.numberHolder.id}
          >
            <span dir="ltr" className="font-figures text-[13px]">
              {line.numberHolder.name}
            </span>
            {line.numberHolder.place !== null && (
              <span className="inline-flex items-center rounded border border-slate-200 bg-slate-100 px-1.5 py-px text-[12px] dark:border-[#2b3b6b] dark:bg-[#121c3f]">
                <span dir="ltr" className={NUM}>
                  {line.numberHolder.place}
                </span>
              </span>
            )}
          </span>
        ) : (
          <span key="h" className="inline-flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              {t(`${R}numberHolderNone`)}
            </span>
            {onUpdateNumber !== null && (
              <button
                type="button"
                data-recon-update-number={line.card.id}
                title={t(`${R}updateNumberTitle`)}
                onClick={() => onUpdateNumber(line.card)}
                className="inline-flex items-center gap-1 rounded-lg border border-[#6c63ff]/50 bg-[#6c63ff]/10 px-2 py-1 text-xs font-bold text-[#4f3dff] transition hover:bg-[#6c63ff]/20 dark:text-[#a59dff]"
              >
                <BoardIcon d={PATH.edit} className="h-3.5 w-3.5" />
                {t(`${R}updateNumber`)}
              </button>
            )}
          </span>
        ),
        <Figure key="a" value={cardNow(line.card).balance} />,
        <Figure key="b" value={line.sheet.balance} />,
      ])}
    />
  );
};
