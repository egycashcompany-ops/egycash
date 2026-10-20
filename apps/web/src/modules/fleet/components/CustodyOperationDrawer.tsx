// One operation of «سجل العهدة», opened from its line (`?open=<id>`) — or from anywhere that links
// to it: a memo's «تمت الاستعاضة ✓», a licensing memo's «تمت التسوية ✓». It reads the operation by
// its id, so it opens even when its line is on another page of the log.
//
// What it shows, top to bottom: one sentence saying what was done; «إجمالي العهدة» before → the
// operation → after (its place in the log); what it carried — the replenishment's memos, per kind
// in his letter's order and one by one, or the settlement's licensing memos; then its letter, the
// very sheet the print button prints (`letterSheets(letterPaperOf(op))`: the bracket figure and the
// names it was recorded with, so a reprint never changes). The printer on a line opens the drawer at
// the letter (`letter=1`).
//
// A replenishment's kind that carried no memo shows «—», and — when there are some — how many
// receipts of that kind are in no memo yet: that figure is TODAY's (`useCustodyMemosOutside`), not
// the day of the replenishment, and says so («حتى الآن»).
//
// The shell is the custody board's car log's (`CustodyCarLog`): its own modal over the page, the
// page beneath `inert` and held still, Escape taken on its way down so nothing beneath hears it,
// Tab kept inside, the focus given back to what opened it.
import { Fragment, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import {
  type FleetCustodyOperationDto,
  type FleetLicenseExpenseKind,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { useAppSelector } from '../../../store';
import { Button } from '../../../shared/ui/Button';
import { Skeleton } from '../../../shared/ui/Skeleton';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import { toast } from '../../../shared/ui/toast/toast-store';
import { CheckIcon, CloseIcon, PrinterIcon } from '../../../shared/ui/icons';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { errorMessage } from '../../../shared/lib/errors';
import { formatMoneyParts } from '../../../shared/lib/format';
import { cn } from '../../../shared/lib/cn';
import { useCustodyMemosOutside, useCustodyOperation } from '../api/fleet-queries';
import {
  letterFileName,
  letterPaperOf,
  letterSheets,
  printPaperAfter,
} from '../lib/custody-papers';
import { fundAfter, sumMoney } from '../lib/custody-fund-forms';
import {
  operationIntro,
  replenishedByKind,
  type LedgerWordsKit,
} from '../lib/custody-ledger-words';
import { useCustodyCount } from '../lib/custody-words';
import { CUSTODY_KIND, CustodyKindBadge } from './CustodyKinds';
import { CUSTODY_OPS } from './CustodyFundActions';
import { PaperTray, usePaperFonts } from './CustodyPaperSheets';
import { BoardIcon, NUM, ymd } from './FuelCardBoard';
import {
  CAIRO,
  CARD_BORDER,
  CARD_SURFACE,
  NOTE,
  SCROLLBAR,
  TITLE,
  custodyTrapFocus,
  useCount,
  useSeparator,
} from './custody-dashboard-parts';
import {
  CUSTODY_TABLE,
  EMBEDDED_TABLE,
  GRAND_ROW,
  MOVES_CHIP,
  SECTION_CARD,
  SECTION_STRIP,
} from './custody-board-looks';
import {
  COUNT_BADGE,
  Dates,
  FIGURE,
  MEMO_NO,
  MemoName,
  Money,
  Signed,
  TICK_ON,
} from './custody-memo-parts';
import { LICENCE_DOT, LICENCE_PILL } from './CustodySettleDialog';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const EMERALD_INK = 'text-emerald-800 dark:text-emerald-300';

/** The words a drawer and its log share — `t`, the counts, the cars, the separator, the day. */
export const useLedgerWordsKit = (): LedgerWordsKit => {
  const t = useT();
  const { count, form } = useCustodyCount();
  const cars = useCount();
  const separator = useSeparator();
  return {
    t,
    count,
    form,
    cars: (n) => cars.count('car', n),
    separator,
    day: (iso) => ymd(iso),
  };
};

/** A licensing memo's kind in its pill — a renewal sky, an extension violet. */
const LicenceKindPill = ({ kind }: { kind: FleetLicenseExpenseKind }): JSX.Element => {
  const t = useT();
  return (
    <span
      data-licence-kind={kind}
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-[14px] leading-5',
        CAIRO,
        LICENCE_PILL[kind],
      )}
    >
      <i className={cn('h-1.5 w-1.5 rounded-full', LICENCE_DOT[kind])} />
      {t(`fleet.licenseExpenses.kinds.${kind}`)}
    </span>
  );
};

type MemoLine = FleetCustodyOperationDto['memos'][number] | { memoId: '__total__'; amount: number };
type PartLine = FleetCustodyOperationDto['parts'][number] | { expenseId: '__total__' };

/** The replenishment: each kind's part, then its memos, ticked. */
const ReplenishBody = ({ op }: { op: FleetCustodyOperationDto }): JSX.Element => {
  const t = useT();
  const kit = useLedgerWordsKit();
  const outside = useCustodyMemosOutside();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const figure = (value: number): string => formatMoneyParts(value, 'EGP', locale).figure;
  const memos = [...op.memos].sort((a, b) => a.no - b.no);
  const shares = replenishedByKind(op.memos);
  const receipts = memos.reduce((sum, memo) => sum + memo.receipts, 0);
  const lines: MemoLine[] = [...memos, { memoId: '__total__', amount: op.amount }];
  const total = (line: MemoLine): boolean => line.memoId === '__total__';
  const columns: Column<MemoLine>[] = [
    {
      key: 'tick',
      header: '✓',
      align: 'center',
      render: (line) =>
        total(line) ? null : (
          <span className={TICK_ON} title={t('fleet.custody.ledger.drawer.tick.replenish')}>
            <CheckIcon className="h-4 w-4 stroke-[3]" />
          </span>
        ),
    },
    {
      key: 'no',
      header: t('fleet.custody.ledger.drawer.col.no'),
      align: 'center',
      render: (line) =>
        'no' in line ? (
          <span className={cn(MEMO_NO, FIGURE)}>{line.no}</span>
        ) : (
          <span className="text-emerald-800 dark:text-emerald-400">
            {t('fleet.custody.fundForm.total')}
          </span>
        ),
    },
    {
      key: 'name',
      header: t('fleet.custody.ledger.drawer.col.name'),
      align: 'center',
      render: (line) => ('no' in line ? <MemoName memo={line} boxed /> : null),
    },
    {
      key: 'kind',
      header: t('fleet.custody.ledger.drawer.col.kind'),
      align: 'center',
      render: (line) => ('kind' in line ? <CustodyKindBadge kind={line.kind} /> : null),
    },
    {
      key: 'period',
      header: t('fleet.custody.ledger.drawer.col.period'),
      align: 'center',
      render: (line) => ('from' in line ? <Dates from={line.from} to={line.to} stack /> : null),
    },
    {
      key: 'receipts',
      header: t('fleet.custody.ledger.drawer.col.receipts'),
      align: 'center',
      render: (line) => (
        <span className={cn(COUNT_BADGE, FIGURE)}>
          {'receipts' in line ? line.receipts : receipts}
        </span>
      ),
    },
    {
      key: 'total',
      header: t('fleet.custody.ledger.drawer.col.total'),
      align: 'center',
      render: (line) => <Money value={line.amount} ink={total(line) ? EMERALD_INK : undefined} />,
    },
  ];
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5" data-ledger-replenish-kinds="true">
        {shares.map((share) => {
          const look = CUSTODY_KIND[share.kind];
          const out = outside.data?.find((line) => line.kind === share.kind);
          return (
            <div
              key={share.kind}
              data-ledger-replenish-kind={share.kind}
              className={cn(
                CARD_SURFACE,
                CARD_BORDER,
                'flex min-w-0 flex-col gap-1 rounded-xl p-3',
                look.accent,
              )}
            >
              <span className={cn('text-xs', look.label)}>
                {t(`fleet.custody.source.${share.kind}`)}
              </span>
              {share.nos.length === 0 ? (
                <>
                  <span className="text-lg text-slate-400">—</span>
                  <span
                    className="text-[11px] leading-snug text-slate-500 dark:text-slate-400"
                    data-ledger-replenish-kind-note={share.kind}
                  >
                    {out !== undefined && out.count > 0
                      ? t('fleet.custody.ledger.drawer.outsideNow', {
                          receipts: kit.count('receipt', out.count),
                          amount: figure(out.total),
                        })
                      : t('fleet.custody.fundForm.replenish.noMemos')}
                  </span>
                </>
              ) : (
                <>
                  <span className={cn('text-base font-black text-slate-900 dark:text-white', NUM)}>
                    {figure(share.total)}
                  </span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    {t('fleet.custody.fundForm.replenish.nos', {
                      memos: kit.count('memo', share.nos.length),
                      nos: share.nos.join(kit.separator),
                    })}
                  </span>
                </>
              )}
            </div>
          );
        })}
        <div className="col-span-2 flex min-w-0 flex-col gap-1 rounded-xl border border-emerald-300 bg-gradient-to-br from-emerald-50/70 via-white to-white p-3 sm:col-span-1 dark:border-emerald-500/40 dark:bg-none dark:bg-emerald-500/[0.07]">
          <span className="text-xs font-bold text-emerald-800 dark:font-semibold dark:text-emerald-300">
            {t('fleet.custody.fundForm.total')}
          </span>
          <span className={cn('text-base font-black text-slate-900 dark:text-white', NUM)}>
            {figure(sumMoney(shares.map((share) => share.total)))}
          </span>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            {kit.count('memo', memos.length)}
          </span>
        </div>
      </div>

      <section className={SECTION_CARD} data-ledger-replenish-memos="true">
        <div className={SECTION_STRIP}>
          <h3 className={TITLE}>{t('fleet.custody.ledger.drawer.memos')}</h3>
          <Link to="/fleet/custody/memos" className={cn(MOVES_CHIP, 'hover:brightness-95')}>
            {t('fleet.custody.ledger.drawer.memosLink', { memos: kit.count('memo', memos.length) })}
          </Link>
        </div>
        {/* A phone: one line per memo, ticked. */}
        <ul className="divide-y divide-slate-100 sm:hidden dark:divide-[#1c273b]">
          {memos.map((memo) => (
            <li key={memo.memoId} className="flex items-center gap-2.5 px-3 py-2.5">
              <span className={cn(TICK_ON, 'mx-0 shrink-0')}>
                <CheckIcon className="h-4 w-4 stroke-[3]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5">
                    <span className={cn(MEMO_NO, FIGURE, 'h-7 font-bold')}>{memo.no}</span>
                    <CustodyKindBadge kind={memo.kind} />
                  </span>
                  <span className="font-bold">
                    <Money value={memo.amount} />
                  </span>
                </span>
                <span className="mt-1 block font-bold">
                  <MemoName memo={memo} />
                </span>
                <span className="mt-1 flex items-center justify-between gap-2 text-xs font-bold text-slate-500 dark:text-slate-400">
                  <Dates from={memo.from} to={memo.to} />
                  <span className="whitespace-nowrap">{kit.count('receipt', memo.receipts)}</span>
                </span>
              </span>
            </li>
          ))}
          <li className="flex items-center justify-between gap-2 bg-slate-100 px-3 py-2.5 font-bold shadow-[inset_0_2px_0_#10b981] dark:bg-[#090e18]">
            <span className="text-emerald-800 dark:text-emerald-400">
              {t('fleet.custody.fundForm.total')}
            </span>
            <Money value={op.amount} ink={EMERALD_INK} />
          </li>
        </ul>
        <div
          className={cn(CUSTODY_TABLE, EMBEDDED_TABLE, 'hidden sm:block [&_tbody_td]:!text-[15px]')}
        >
          <DataTable
            columns={columns}
            rows={lines}
            rowKey={(line) => line.memoId}
            rowClassName={(line) => (total(line) ? GRAND_ROW : undefined)}
            minColumnWidth={3.5}
          />
        </div>
      </section>
    </>
  );
};

/** The settlement: the licensing memos it took off the fund, ticked. */
const SettleBody = ({ op }: { op: FleetCustodyOperationDto }): JSX.Element => {
  const t = useT();
  const can = useCan();
  const kit = useLedgerWordsKit();
  const parts = op.parts;
  // «3 مذكرات — في «مصروفات التراخيص»», as the approved drawer reads.
  const partsLink = t('fleet.custody.ledger.drawer.partsLink', {
    memos: kit.count('memo', parts.length),
  });
  const lines: PartLine[] = [...parts, { expenseId: '__total__' }];
  const sumOf = (key: 'visaTotal' | 'cashTotal'): number =>
    sumMoney(parts.map((part) => part[key]));
  const cars = parts.reduce((sum, part) => sum + part.cars, 0);
  const columns: Column<PartLine>[] = [
    {
      key: 'tick',
      header: '✓',
      align: 'center',
      render: (line) =>
        'part' in line ? (
          <span className={TICK_ON} title={t('fleet.custody.ledger.drawer.tick.settle')}>
            <CheckIcon className="h-4 w-4 stroke-[3]" />
          </span>
        ) : null,
    },
    {
      key: 'date',
      header: t('fleet.licenseExpenses.date'),
      align: 'center',
      render: (line) =>
        'part' in line ? (
          <span dir="ltr" className={FIGURE}>
            {ymd(line.date)}
          </span>
        ) : (
          <span className="text-emerald-800 dark:text-emerald-400">
            {t('fleet.custody.fundForm.total')}
          </span>
        ),
    },
    {
      key: 'kind',
      header: t('fleet.licenseExpenses.kind'),
      align: 'center',
      render: (line) => ('part' in line ? <LicenceKindPill kind={line.part} /> : null),
    },
    {
      key: 'cars',
      header: t('fleet.licenseExpenses.columns.cars'),
      align: 'center',
      render: (line) => (
        <span className={cn(COUNT_BADGE, FIGURE)}>{'part' in line ? line.cars : cars}</span>
      ),
    },
    {
      key: 'visa',
      header: t('fleet.licenseExpenses.totals.visa'),
      align: 'center',
      render: (line) => <Money value={'part' in line ? line.visaTotal : sumOf('visaTotal')} />,
    },
    {
      key: 'cash',
      header: t('fleet.licenseExpenses.totals.cash'),
      align: 'center',
      render: (line) => <Money value={'part' in line ? line.cashTotal : sumOf('cashTotal')} />,
    },
    {
      key: 'total',
      header: t('fleet.licenseExpenses.totals.all'),
      align: 'center',
      render: (line) =>
        'part' in line ? (
          <Money value={line.amount} />
        ) : (
          <Money value={op.amount} ink={EMERALD_INK} />
        ),
    },
  ];
  return (
    <section className={SECTION_CARD} data-ledger-settle-parts="true">
      <div className={SECTION_STRIP}>
        <h3 className={TITLE}>{t('fleet.custody.ledger.drawer.parts')}</h3>
        {/* Settling needs no licence grant: the licence screen is offered only to who may open it. */}
        {can('fleetLicenseExpense.view') ? (
          <Link to="/fleet/license-expenses" className={cn(MOVES_CHIP, 'hover:brightness-95')}>
            {partsLink}
          </Link>
        ) : (
          <span className={MOVES_CHIP}>{partsLink}</span>
        )}
      </div>
      {/* A phone: one line per licensing memo, ticked. */}
      <ul className="divide-y divide-slate-100 sm:hidden dark:divide-[#1c273b]">
        {parts.map((part) => (
          <li
            key={`${part.expenseId}:${part.part}`}
            className="flex items-center gap-2.5 px-3 py-2.5"
          >
            <span className={cn(TICK_ON, 'mx-0 shrink-0')}>
              <CheckIcon className="h-4 w-4 stroke-[3]" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2">
                <LicenceKindPill kind={part.part} />
                <span className="font-bold">
                  <Money value={part.amount} />
                </span>
              </span>
              <span className="mt-1 flex items-center justify-between gap-2 text-xs font-bold text-slate-500 dark:text-slate-400">
                <span dir="ltr" className={FIGURE}>
                  {ymd(part.date)}
                </span>
                <span className="whitespace-nowrap">{kit.cars(part.cars)}</span>
              </span>
            </span>
          </li>
        ))}
        <li className="flex items-center justify-between gap-2 bg-slate-100 px-3 py-2.5 font-bold shadow-[inset_0_2px_0_#10b981] dark:bg-[#090e18]">
          <span className="text-emerald-800 dark:text-emerald-400">
            {t('fleet.custody.fundForm.total')}
          </span>
          <Money value={op.amount} ink={EMERALD_INK} />
        </li>
      </ul>
      <div
        className={cn(
          CUSTODY_TABLE,
          EMBEDDED_TABLE,
          'hidden sm:block [&_tbody_td]:!text-[15px] [&&_td]:!px-1 [&&_th]:!px-1',
        )}
      >
        <DataTable
          columns={columns}
          rows={lines}
          rowKey={(line) => ('part' in line ? `${line.expenseId}:${line.part}` : line.expenseId)}
          rowClassName={(line) => ('part' in line ? undefined : GRAND_ROW)}
          minColumnWidth={3.5}
        />
      </div>
    </section>
  );
};

/** The operation once read: its sentence, the sum, what it carried, its letter. */
const OperationBody = ({
  op,
  toLetter,
}: {
  op: FleetCustodyOperationDto;
  toLetter: boolean;
}): JSX.Element => {
  const t = useT();
  const kit = useLedgerWordsKit();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const fonts = usePaperFonts();
  const letterRef = useRef<HTMLElement>(null);
  const signed = op.kind === 'settle' ? -op.amount : op.amount;
  const before = op.ledger?.before ?? op.fundBefore;
  const after = op.ledger?.after ?? fundAfter(op.fundBefore, signed);
  // Drawn again once the faces are in: the shrink-to-fit of a long line is measured with them.
  const sheets = useMemo(() => letterSheets(letterPaperOf(op)), [op, fonts]);
  useEffect(() => {
    if (toLetter) letterRef.current?.scrollIntoView?.({ block: 'start' });
  }, [toLetter]);
  // The sentence with its amount in bold, in the figures' face: written with a marker where the
  // amount goes, then the marker drawn as the figure.
  const amount = formatMoneyParts(op.amount, 'EGP', locale);
  const intro = operationIntro(op, kit, () => '\uE000').split('\uE000');
  return (
    <>
      <p
        data-ledger-intro="true"
        className="text-sm leading-relaxed text-slate-600 dark:text-slate-300"
      >
        {intro.map((part, index) => (
          <Fragment key={index}>
            {index > 0 && (
              <>
                <b className={cn('text-slate-900 dark:text-white', NUM)}>{amount.figure}</b>{' '}
                {amount.currency}
              </>
            )}
            {part}
          </Fragment>
        ))}
      </p>

      {/* The fund before → the operation → the fund after, as the log places it. */}
      <div
        data-ledger-sum="true"
        className={cn(
          CARD_SURFACE,
          CARD_BORDER,
          'flex flex-col gap-2 rounded-2xl p-3 sm:grid sm:grid-cols-[1fr_auto_1fr_auto_1fr] sm:items-center sm:gap-3 sm:p-4',
        )}
      >
        {[
          {
            key: 'before',
            label: t('fleet.custody.ledger.drawer.before'),
            node: (
              <Money
                value={before}
                big
                ink={before < 0 ? 'text-red-600 dark:text-red-400' : undefined}
              />
            ),
          },
          { key: 'op', label: t(CUSTODY_OPS[op.kind].label), node: <Signed value={signed} /> },
          {
            key: 'after',
            label: t('fleet.custody.ledger.columns.after'),
            node: (
              <Money
                value={after}
                big
                ink={after < 0 ? 'text-red-600 dark:text-red-400' : EMERALD_INK}
              />
            ),
          },
        ].map((cell, index) => (
          <Fragment key={cell.key}>
            {index > 0 && (
              <span
                aria-hidden="true"
                className={cn(
                  'hidden h-7 w-7 items-center justify-center rounded-full border border-slate-300 text-sm font-black text-slate-600 sm:flex dark:border-slate-600 dark:text-slate-300',
                  NUM,
                )}
              >
                {index === 1 ? (signed >= 0 ? '+' : '−') : '='}
              </span>
            )}
            <span
              data-ledger-sum-cell={cell.key}
              className="flex min-w-0 items-center justify-between gap-2 border-slate-100 text-center sm:flex-col sm:justify-center sm:gap-1 [&:not(:first-child)]:border-t [&:not(:first-child)]:pt-2 sm:[&:not(:first-child)]:border-t-0 sm:[&:not(:first-child)]:pt-0 dark:border-[#1c273b]"
            >
              <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
                {cell.label}
              </span>
              <span>{cell.node}</span>
            </span>
          </Fragment>
        ))}
      </div>

      {op.kind === 'replenish' && <ReplenishBody op={op} />}
      {op.kind === 'settle' && <SettleBody op={op} />}

      <section ref={letterRef} className={SECTION_CARD} data-ledger-letter-section={op.kind}>
        <div className={SECTION_STRIP}>
          <h3 className={TITLE}>{t(`fleet.custody.ledger.drawer.letter.${op.kind}`)}</h3>
          <span className={NOTE}>{t('fleet.custody.ledger.drawer.printsAsShown')}</span>
        </div>
        <PaperTray sheets={sheets} name={`ledger-letter:${op.id}`} className="rounded-none" />
      </section>
    </>
  );
};

/**
 * The drawer. `id` is the operation's; `toLetter` scrolls to its letter; `opener` gets the focus
 * back when it closes.
 */
export const CustodyOperationDrawer = ({
  id,
  toLetter,
  opener = null,
  onClose,
}: {
  id: string;
  toLetter: boolean;
  opener?: HTMLElement | null;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const read = useCustodyOperation(id);
  const op = read.data;
  const titleId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [printing, setPrinting] = useState(false);
  // The latest `onClose`, and the opener as it was: a new arrow each render must not re-run the
  // effect, which would take the focus again.
  const close = useRef(onClose);
  close.current = onClose;
  const returnTo = useRef(opener ?? null);

  useEffect(() => {
    returnTo.current ??=
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton.current?.focus();
    // The log stays beneath, out of reach: neither Tab nor a screen reader lands there.
    const root = rootRef.current;
    const muted = Array.from(root?.parentElement?.children ?? []).filter(
      (el): el is HTMLElement => el !== root && el instanceof HTMLElement && !el.inert,
    );
    for (const el of muted) el.inert = true;
    // …and the page under the drawer stays still.
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const stops = (): HTMLElement[] =>
      Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
    let back = false;
    const trap = (active: Element | null, preventDefault?: () => void): void => {
      const list = stops();
      const first = list[0];
      const last = list[list.length - 1];
      if (first === undefined || last === undefined) return;
      const inside = active !== null && panelRef.current?.contains(active) === true;
      const target = custodyTrapFocus<Element>({ back, active, first, last, inside });
      if (!(target instanceof HTMLElement)) return;
      preventDefault?.();
      target.focus();
    };
    const onKey = (e: KeyboardEvent): void => {
      // Escape closes the drawer, and the drawer alone: stopped here, nothing beneath hears it.
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close.current();
        return;
      }
      if (e.key !== 'Tab') return;
      e.stopPropagation();
      back = e.shiftKey;
      if (document.activeElement === document.body) return;
      trap(document.activeElement, () => e.preventDefault());
    };
    const onFocusIn = (e: FocusEvent): void => {
      if (e.target instanceof Node && panelRef.current?.contains(e.target) === false) {
        e.stopPropagation();
        trap(e.target instanceof Element ? e.target : null);
      }
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', onFocusIn, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', onFocusIn, true);
      for (const el of muted) el.inert = false;
      document.body.style.overflow = overflow;
      returnTo.current?.focus();
    };
  }, []);

  const letterName = op === undefined ? '' : t(`fleet.custody.ledger.drawer.letter.${op.kind}`);
  const print = (): void => {
    if (op === undefined || printing) return;
    setPrinting(true);
    printPaperAfter(
      async () => ({ sheets: letterSheets(letterPaperOf(op)), title: letterFileName(op.kind) }),
      t('fleet.custody.papers.printing'),
    )
      .then(
        (opened) => {
          if (!opened) toast.error(t('fleet.violations.popupBlocked'));
        },
        (error: unknown) => toast.error(errorMessage(error, locale)),
      )
      .finally(() => setPrinting(false));
  };

  return createPortal(
    <div
      ref={rootRef}
      className="fixed inset-0 z-[95] flex justify-end"
      data-ledger-details={id}
      {...(toLetter ? { 'data-ledger-to-letter': 'true' } : {})}
    >
      <div
        aria-hidden="true"
        data-ledger-details-backdrop="true"
        onClick={() => close.current()}
        className="absolute inset-0 animate-fade-in bg-slate-900/50 dark:bg-black/60"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex h-full w-full max-w-4xl animate-pop-in flex-col border-s border-slate-200 bg-[#f8fafc] text-slate-800 shadow-elevated dark:border-[#1c263b] dark:bg-[#0b0f19] dark:text-slate-200"
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 py-3.5 sm:px-6 dark:border-[#1c263b] dark:bg-[#0c111e]/95">
          <h2
            id={titleId}
            className={cn(
              'flex min-w-0 items-center gap-2 text-base font-bold text-slate-900 sm:text-lg dark:text-white',
              CAIRO,
            )}
          >
            {op !== undefined && (
              <span
                aria-hidden="true"
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                  CUSTODY_OPS[op.kind].tile,
                )}
              >
                <BoardIcon d={CUSTODY_OPS[op.kind].icon} className="h-4 w-4" />
              </span>
            )}
            <span className="min-w-0">
              {op === undefined ? (
                t('fleet.custody.ledger.title')
              ) : (
                <>
                  {t(CUSTODY_OPS[op.kind].label)} —{' '}
                  <span dir="ltr" className={NUM}>
                    {ymd(op.date)}
                  </span>
                </>
              )}
            </span>
          </h2>
          <button
            ref={closeButton}
            type="button"
            onClick={() => close.current()}
            aria-label={t('common.close')}
            title={t('common.close')}
            data-ledger-details-close="true"
            className="-me-1 shrink-0 rounded-lg p-2 text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <CloseIcon />
          </button>
        </header>

        <div
          data-ledger-details-scroll="true"
          className={cn(
            'min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain p-4 sm:p-6',
            SCROLLBAR,
          )}
        >
          {read.isLoading ? (
            <div className="space-y-3" data-ledger-details-loading="true">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-64 w-full" />
            </div>
          ) : op === undefined ? (
            <ErrorState error={read.error} onRetry={() => void read.refetch()} />
          ) : (
            <OperationBody op={op} toLetter={toLetter} />
          )}
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-white/95 px-4 py-3 sm:px-6 dark:border-[#1c263b] dark:bg-[#0c111e]/95">
          <Button variant="secondary" onClick={() => close.current()}>
            {t('common.close')}
          </Button>
          {op !== undefined && (
            <Button
              onClick={print}
              loading={printing}
              leftIcon={<PrinterIcon className="me-1.5 h-4 w-4" />}
              data-ledger-details-print={op.kind}
            >
              {t('fleet.custody.ledger.drawer.printLetter', { letter: letterName })}
            </Button>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  );
};
