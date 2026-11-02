// «حذف العملية» — the pieces «سجل العهدة», its drawer and «العمليات المحذوفة» share (split out of
// `CustodyOperationDrawer.tsx` / `CustodyLedgerPage.tsx`, which only wire them):
//
//   DeleteBinButton     the red bin, the LAST action of an operation's line and phone card
//   DeleteDrawerButton  the drawer footer's red «حذف العملية»
//   DeletedChip         «محذوفة», red — beside a deleted operation's title and on its line
//   DeletedNote         a deleted operation's drawer: who deleted it, when (Cairo time), why, and
//                       who had recorded it
//   DeletionSum         the fund just before the delete → what the delete did → after
//   DeleteMemoCards     the dialog's memos going back, one line each on a phone
//   DeletePartsTable    the dialog's licence parts going back to «لم تُسوَّ بعد»
import { Fragment } from 'react';
import { type FleetCustodyOperationDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { Button } from '../../../shared/ui/Button';
import { formatMoneyParts } from '../../../shared/lib/format';
import { cn } from '../../../shared/lib/cn';
import { cairoAt, deletionDeltaOf } from '../lib/custody-delete';
import { useCustodyCount } from '../lib/custody-words';
import { Trash2Icon } from './row-action-icons';
import { actionTone } from './row-actions-look';
import { MONO } from './FuelCardDialog';
import { NUM } from './FuelCardBoard';
import { CAIRO, CARD_BORDER, CARD_SURFACE, useCount } from './custody-dashboard-parts';
import {
  Dates,
  Day,
  FORM_TABLE,
  FORM_TABLE_WRAP,
  FORM_TBODY,
  FORM_THEAD,
  KindPill,
  MemoName,
  Money,
  Signed,
} from './custody-memo-parts';
import { LICENCE_DOT, LICENCE_PILL } from './CustodySettleDialog';

const DELETE = 'fleet.custody.delete';
const DELETED = 'fleet.custody.deleted';

/** The bin's strokes — `Trash2Icon`'s, for a `BoardIcon` tile (the dialog's head, its red button). */
export const BIN_ICON: readonly string[] = [
  'M3 6h18',
  'M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6',
  'M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2',
  'M10 11v6',
  'M14 11v6',
];

const NEGATIVE_INK = 'text-red-600 dark:text-red-400';
const DELETED_CHIP =
  'inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-red-300 bg-red-50 px-2 py-px text-[12px] font-bold leading-5 text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:font-semibold dark:text-red-300';

/** The red bin — the last icon of an operation's actions, given only to `fleetReceipt.delete`. */
export const DeleteBinButton = ({
  id,
  onDelete,
}: {
  id: string;
  onDelete: (id: string) => void;
}): JSX.Element => {
  const t = useT();
  return (
    <button
      type="button"
      data-ledger-delete={id}
      title={t(`${DELETE}.binTitle`)}
      aria-label={t(`${DELETE}.binTitle`)}
      onClick={() => onDelete(id)}
      className={actionTone('delete')}
    >
      <Trash2Icon className="h-4 w-4" />
    </button>
  );
};

/** The drawer footer's red «حذف العملية» — it gives way to the head's dialog. */
export const DeleteDrawerButton = ({
  id,
  onDelete,
}: {
  id: string;
  onDelete: () => void;
}): JSX.Element => {
  const t = useT();
  return (
    <Button
      variant="ghost-danger"
      onClick={onDelete}
      className="font-bold"
      leftIcon={<Trash2Icon className="me-1.5 h-4 w-4" />}
      data-ledger-details-delete={id}
    >
      {t(`${DELETE}.action`)}
    </Button>
  );
};

/** «محذوفة» — red, beside a deleted operation's title and on its line in the deleted log. */
export const DeletedChip = (): JSX.Element => {
  const t = useT();
  return (
    <span className={cn(DELETED_CHIP, CAIRO)} data-ledger-deleted-chip="true">
      <Trash2Icon className="h-3 w-3" />
      {t(`${DELETED}.chip`)}
    </span>
  );
};

/** A deleted operation's note: who deleted it, when, why — and who had recorded it. */
export const DeletedNote = ({ op }: { op: FleetCustodyOperationDto }): JSX.Element | null => {
  const t = useT();
  const deletion = op.deletion;
  if (deletion === null) return null;
  const at = cairoAt(deletion.at);
  const recorded = cairoAt(op.createdAt);
  return (
    <div
      data-ledger-deleted-note="true"
      className="flex items-start gap-2.5 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm font-semibold leading-6 text-red-900 dark:border-red-500/40 dark:bg-red-500/[0.08] dark:text-red-100"
    >
      <Trash2Icon className="mt-1 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
      <span>
        <b className="block font-bold text-red-800 dark:text-red-300">
          {t(`${DELETED}.drawerTitle`)}
        </b>
        {t(`${DELETED}.drawerDeleted`, {
          by: deletion.byName ?? '—',
          date: at.day,
          time: at.time,
        })}{' '}
        {op.createdByName !== null &&
          t(`${DELETED}.drawerRecorded`, {
            by: op.createdByName,
            date: recorded.day,
            time: recorded.time,
          })}
        <span
          className="mt-1 block text-red-800/90 dark:text-red-200/90"
          data-ledger-deleted-reason="true"
        >
          {deletion.reason === ''
            ? t(`${DELETED}.noReason`)
            : t(`${DELETED}.drawerReason`, { reason: deletion.reason })}
        </span>
      </span>
    </div>
  );
};

/** The fund just before the delete, what the delete did to it, and after. */
export const DeletionSum = ({ op }: { op: FleetCustodyOperationDto }): JSX.Element | null => {
  const t = useT();
  const deletion = op.deletion;
  if (deletion === null) return null;
  const delta = deletionDeltaOf(deletion);
  const ink = (value: number): string | undefined => (value < 0 ? NEGATIVE_INK : undefined);
  const cells = [
    {
      key: 'before',
      label: t(`${DELETED}.drawerBefore`),
      node: <Money value={deletion.fundBefore} big ink={ink(deletion.fundBefore)} />,
    },
    {
      key: 'effect',
      label: t(`${DELETED}.drawerEffect`),
      node:
        delta === 0 ? (
          <span className="text-sm font-bold text-slate-500 dark:text-slate-400">
            {t(`${DELETED}.unchanged`)}
          </span>
        ) : (
          <Signed value={delta} />
        ),
    },
    {
      key: 'after',
      label: t(`${DELETED}.drawerAfter`),
      node: <Money value={deletion.fundAfter} big ink={ink(deletion.fundAfter)} />,
    },
  ];
  return (
    <div
      data-ledger-deleted-sum="true"
      className={cn(
        CARD_SURFACE,
        CARD_BORDER,
        'flex flex-col gap-2 rounded-2xl p-3 sm:grid sm:grid-cols-[1fr_auto_1fr_auto_1fr] sm:items-center sm:gap-3 sm:p-4',
      )}
    >
      {cells.map((cell, index) => (
        <Fragment key={cell.key}>
          {index > 0 && (
            <span
              aria-hidden="true"
              className={cn(
                'hidden h-7 w-7 items-center justify-center rounded-full border border-slate-300 text-sm font-black text-slate-600 sm:flex dark:border-slate-600 dark:text-slate-300',
                NUM,
              )}
            >
              {index === 1 ? (delta >= 0 ? '+' : '−') : '='}
            </span>
          )}
          <span
            data-ledger-deleted-sum-cell={cell.key}
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
  );
};

/** A phone: one line per memo going back — the table would scroll sideways at 375. */
export const DeleteMemoCards = ({
  op,
}: {
  op: Pick<FleetCustodyOperationDto, 'memos' | 'amount'>;
}): JSX.Element => {
  const t = useT();
  const { count } = useCustodyCount();
  return (
    <ul
      className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 sm:hidden dark:divide-[#1c273b] dark:border-[#2b3b6b]"
      data-custody-delete-memo-cards="true"
    >
      {[...op.memos]
        .sort((a, b) => a.no - b.no)
        .map((memo) => (
          <li key={memo.memoId} className="flex flex-col gap-1 px-3 py-2.5">
            <span className="flex items-start justify-between gap-2">
              <MemoName memo={memo} />
              <span className="shrink-0 font-bold">
                <Money value={memo.amount} />
              </span>
            </span>
            <span className="flex items-center justify-between gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
              <span className="flex items-center gap-2 whitespace-nowrap">
                <KindPill kind={memo.kind} />
                {t('fleet.custody.fundForm.no')} <span className={MONO}>{memo.no}</span>
              </span>
              <span className="whitespace-nowrap">{count('receipt', memo.receipts)}</span>
            </span>
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              <Dates from={memo.from} to={memo.to} />
            </span>
          </li>
        ))}
      <li className="flex items-center justify-between gap-2 bg-slate-50 px-3 py-2.5 font-bold dark:bg-white/[0.03]">
        <span className="text-slate-700 dark:text-slate-200">
          {t('fleet.custody.fundForm.total')}
        </span>
        <Money value={op.amount} />
      </li>
    </ul>
  );
};

/** The settlement's licence parts that go back to «لم تُسوَّ بعد», with their visa / cash split. */
export const DeletePartsTable = ({
  op,
}: {
  op: Pick<FleetCustodyOperationDto, 'parts' | 'amount'>;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const cars = useCount();
  const figure = (value: number): string => formatMoneyParts(value, 'EGP', locale).figure;
  return (
    <div className={FORM_TABLE_WRAP}>
      <table className={FORM_TABLE} data-custody-delete-parts="true">
        <thead className={FORM_THEAD}>
          <tr>
            <th>{t('fleet.licenseExpenses.date')}</th>
            <th>{t(`${DELETE}.partCol`)}</th>
            <th>{t('fleet.custody.fundForm.total')}</th>
          </tr>
        </thead>
        <tbody className={FORM_TBODY}>
          {op.parts.map((part) => (
            <tr key={`${part.expenseId}:${part.part}`} data-custody-delete-part={part.part}>
              <td>
                <Day day={part.date} />
              </td>
              <td>
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-sm leading-5',
                    LICENCE_PILL[part.part],
                  )}
                >
                  <i className={cn('h-1.5 w-1.5 rounded-full', LICENCE_DOT[part.part])} />
                  {t('fleet.custody.fundForm.settle.pill', {
                    kind: t(`fleet.custody.fundForm.settle.kind.${part.part}`),
                    cars: cars.count('car', part.cars),
                  })}
                </span>
              </td>
              <td>
                <span className="flex flex-col items-center gap-0.5">
                  <Money value={part.amount} unit="wide" />
                  <span className="whitespace-nowrap text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                    {t('fleet.custody.fundForm.settle.visa')}{' '}
                    <span dir="ltr" className={MONO}>
                      {figure(part.visaTotal)}
                    </span>{' '}
                    · {t('fleet.custody.fundForm.settle.cash')}{' '}
                    <span dir="ltr" className={MONO}>
                      {figure(part.cashTotal)}
                    </span>
                  </span>
                </span>
              </td>
            </tr>
          ))}
          <tr className="bg-slate-50 dark:bg-white/[0.03]">
            <td className="whitespace-nowrap [&&]:!text-slate-700 dark:[&&]:!text-slate-200">
              {t('fleet.custody.fundForm.total')}
            </td>
            <td />
            <td>
              <Money value={op.amount} unit="wide" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
};
