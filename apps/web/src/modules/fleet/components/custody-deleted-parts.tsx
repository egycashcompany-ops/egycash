// «العمليات المحذوفة» — the cells of a deleted operation's line and its phone card (split out of
// `CustodyDeletedPage.tsx`, which only lays them out):
//
//   DeletedOpCell       the operation's chip, «محذوفة» under it — and «كانت معلّقة» / «كانت ملغاة»
//   DeletedDetail       the operation's words as «سجل العهدة» said them, and its letter's day
//   StruckAmount        the amount it had, struck through — it counts for nothing now
//   FundBeforeAfter     «إجمالي العهدة» just before and just after the delete (one figure when the
//                       delete moved nothing)
//   WhoWhen             a name over a Cairo «date · time»
//   DeletedReason       why — or «لم يُذكر سبب»
//   DeletedCard         a phone: one card per deleted operation
import { type FleetCustodyOperationDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { EyeIcon } from '../../../shared/ui/icons';
import { formatMoneyParts } from '../../../shared/lib/format';
import { cn } from '../../../shared/lib/cn';
import { ledgerWords } from '../lib/custody-ledger-words';
import { cairoAt, deletedLedgerRow } from '../lib/custody-delete';
import { operationStatusOf } from '../lib/custody-hold';
import { useLedgerWordsKit } from './CustodyOperationDrawer';
import { ACTION_GROUP, actionTone } from './row-actions-look';
import { ymd } from './FuelCardBoard';
import { CAIRO } from './custody-dashboard-parts';
import { LedgerOpChip } from './custody-ledger-parts';
import { FIGURE, MUTED_INK, Money, PHONE_CARD } from './custody-memo-parts';
import { DeletedChip } from './custody-delete-parts';

const DELETED = 'fleet.custody.deleted';
const NEGATIVE_INK = 'text-red-600 dark:text-red-400';
const SMALL_WORD = 'whitespace-nowrap text-[11px] font-semibold text-slate-500 dark:text-slate-400';
const red = (value: number): string | undefined => (value < 0 ? NEGATIVE_INK : undefined);

/** The operation's chip, «محذوفة» under it — and «كانت معلّقة» / «كانت ملغاة» when it was. */
export const DeletedOpCell = ({
  op,
  align = 'center',
}: {
  op: FleetCustodyOperationDto;
  align?: 'center' | 'start';
}): JSX.Element => {
  const t = useT();
  const status = operationStatusOf(op);
  return (
    <span
      className={cn(
        'inline-flex flex-col gap-1',
        align === 'center' ? 'items-center' : 'items-start',
      )}
    >
      <LedgerOpChip op={op.kind} />
      <span className="inline-flex items-center gap-1">
        <DeletedChip />
        {status !== 'done' && (
          <span
            data-deleted-was={status}
            className="whitespace-nowrap rounded-full border border-slate-300 bg-slate-100 px-2 py-px text-[11px] font-bold leading-5 text-slate-600 dark:border-slate-600/70 dark:bg-slate-700/30 dark:text-slate-300"
          >
            {t(`${DELETED}.${status === 'held' ? 'wasHeld' : 'wasCancelled'}`)}
          </span>
        )}
      </span>
    </span>
  );
};

/** The words the log had for it — its title, its note, and «خطاب …». */
export const DeletedDetail = ({ op }: { op: FleetCustodyOperationDto }): JSX.Element => {
  const t = useT();
  const kit = useLedgerWordsKit();
  const words = ledgerWords(deletedLedgerRow(op), kit);
  return (
    <span
      data-deleted-detail={op.id}
      className={cn('inline-flex flex-col items-center leading-tight', CAIRO)}
    >
      <span className="max-w-[15rem] whitespace-normal text-balance text-[15px] leading-[22px] text-slate-700 dark:text-slate-200">
        {words.title}
      </span>
      {words.note !== '' && (
        <span className="max-w-[15rem] whitespace-normal text-balance text-[12px] leading-4 text-slate-500 [&&]:!font-medium dark:text-slate-400">
          {words.note}
        </span>
      )}
      <span className="whitespace-nowrap text-[12px] leading-4 text-slate-500 [&&]:!font-medium dark:text-slate-400">
        {t('fleet.custody.hold.letterOf', { date: ymd(op.date) })}
      </span>
    </span>
  );
};

/** The amount it had, struck through — it counts for nothing now. */
export const StruckAmount = ({
  op,
  unit = true,
}: {
  op: FleetCustodyOperationDto;
  unit?: boolean;
}): JSX.Element => {
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { figure, currency } = formatMoneyParts(op.amount, 'EGP', locale);
  return (
    <span
      data-deleted-amount={op.amount}
      className="inline-flex items-baseline gap-1 whitespace-nowrap text-slate-500 line-through decoration-red-400/80 decoration-2 dark:text-slate-400 dark:decoration-red-400/70"
    >
      <span dir="ltr" className={FIGURE}>
        {op.kind === 'settle' ? '−' : '+'}
        {figure}
      </span>
      {unit && <span className="text-sm">{currency}</span>}
    </span>
  );
};

/** «إجمالي العهدة» just before and just after the delete — one figure when nothing moved. */
export const FundBeforeAfter = ({
  op,
  stacked = true,
}: {
  op: FleetCustodyOperationDto;
  stacked?: boolean;
}): JSX.Element | null => {
  const t = useT();
  const deletion = op.deletion;
  if (deletion === null) return null;
  if (Math.round(deletion.fundBefore * 100) === Math.round(deletion.fundAfter * 100)) {
    return (
      <span
        className={cn('inline-flex flex-col gap-0.5', stacked ? 'items-center' : 'items-end')}
        data-deleted-fund="same"
      >
        <Money value={deletion.fundAfter} ink={red(deletion.fundAfter)} unit={!stacked} />
        <span className={cn(SMALL_WORD, CAIRO)}>{t(`${DELETED}.unchanged`)}</span>
      </span>
    );
  }
  return (
    <span
      data-deleted-fund={`${deletion.fundBefore}>${deletion.fundAfter}`}
      className={cn(
        'grid grid-cols-[auto_1fr] items-baseline gap-x-2 gap-y-0.5',
        stacked ? 'inline-grid' : 'w-full',
      )}
    >
      <span className={cn(SMALL_WORD, 'text-start', CAIRO)}>{t(`${DELETED}.before`)}</span>
      <span className="text-end">
        <Money
          value={deletion.fundBefore}
          ink={red(deletion.fundBefore) ?? MUTED_INK}
          unit={!stacked}
        />
      </span>
      <span
        className={cn(
          'whitespace-nowrap text-start text-[11px] font-bold text-slate-600 dark:text-slate-300',
          CAIRO,
        )}
      >
        {t(`${DELETED}.after`)}
      </span>
      <span className="text-end font-bold">
        <Money value={deletion.fundAfter} ink={red(deletion.fundAfter)} unit={!stacked} />
      </span>
    </span>
  );
};

/** A name over a Cairo «date · time», as the log's columns stack two facts. */
export const WhoWhen = ({ name, at }: { name: string | null; at: string | null }): JSX.Element => {
  const when = at === null ? null : cairoAt(at);
  return (
    <span className="inline-flex flex-col items-center leading-tight">
      <span className={cn('whitespace-nowrap text-[14px] text-slate-900 dark:text-white', CAIRO)}>
        {name ?? '—'}
      </span>
      {when !== null && (
        <>
          <span
            dir="ltr"
            className={cn(FIGURE, 'mt-0.5 text-[12px] text-slate-600 dark:text-slate-300')}
          >
            {when.day}
          </span>
          <span dir="ltr" className={cn(FIGURE, 'text-[12px] text-slate-500 dark:text-slate-400')}>
            {when.time}
          </span>
        </>
      )}
    </span>
  );
};

/** Why it was deleted — or «لم يُذكر سبب». */
export const DeletedReason = ({ op }: { op: FleetCustodyOperationDto }): JSX.Element => {
  const t = useT();
  const reason = op.deletion?.reason ?? '';
  return reason === '' ? (
    <span className={cn('text-[13px] text-slate-400 dark:text-slate-500', CAIRO)}>
      {t(`${DELETED}.noReason`)}
    </span>
  ) : (
    <span
      data-deleted-reason={op.id}
      className={cn(
        'block max-w-[13rem] whitespace-normal text-balance text-[13px] leading-5 text-slate-700 dark:text-slate-200',
        CAIRO,
      )}
    >
      {reason}
    </span>
  );
};

/** The eye — the operation's drawer in its deleted mode (in the owner's actions box). */
export const DeletedViewButton = ({
  id,
  onOpen,
}: {
  id: string;
  onOpen: (id: string) => void;
}): JSX.Element => {
  const t = useT();
  return (
    <button
      type="button"
      data-deleted-view={id}
      title={t('fleet.custody.ledger.view')}
      aria-label={t('fleet.custody.ledger.view')}
      onClick={() => onOpen(id)}
      className={actionTone('view')}
    >
      <EyeIcon className="h-4 w-4" />
    </button>
  );
};

/** A phone: one card per deleted operation — what, the fund around it, who and why. */
export const DeletedCard = ({
  op,
  onOpen,
}: {
  op: FleetCustodyOperationDto;
  onOpen: (id: string) => void;
}): JSX.Element => {
  const t = useT();
  const kit = useLedgerWordsKit();
  const words = ledgerWords(deletedLedgerRow(op), kit);
  const at = op.deletion === null ? null : cairoAt(op.deletion.at);
  const recorded = cairoAt(op.createdAt);
  const stamp = (when: { day: string; time: string }): JSX.Element => (
    <span dir="ltr" className={cn(FIGURE, 'text-[12px] text-slate-500 dark:text-slate-400')}>
      {when.day} · {when.time}
    </span>
  );
  return (
    <li data-deleted-card={op.id} className={cn(PHONE_CARD, 'border-s-4 border-s-red-400/70')}>
      <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1.5">
        <DeletedOpCell op={op} align="start" />
      </div>
      <p className="mt-2 text-[15px] font-bold leading-snug text-slate-700 dark:text-slate-200">
        {words.title}
      </p>
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
        {words.note}
        {words.note !== '' && ' · '}
        {t('fleet.custody.hold.letterOf', { date: ymd(op.date) })}
      </p>
      <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-slate-100 pt-2.5 dark:border-[#1c273b]">
        <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
          {t(`${DELETED}.col.amount`)}
        </span>
        <span className="text-[15px] font-bold">
          <StruckAmount op={op} />
        </span>
      </div>
      <div className="mt-2 flex flex-col gap-1 rounded-lg bg-slate-50 px-2.5 py-2 dark:bg-white/[0.03]">
        <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
          {t(`${DELETED}.col.fund`)}
        </span>
        <FundBeforeAfter op={op} stacked={false} />
      </div>
      <dl className="mt-2.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 border-t border-slate-100 pt-2.5 text-[13px] dark:border-[#1c273b]">
        <dt className="font-bold text-slate-500 dark:text-slate-400">
          {t(`${DELETED}.col.deleted`)}
        </dt>
        <dd className="font-semibold text-slate-800 dark:text-slate-100">
          {op.deletion?.byName ?? '—'} {at !== null && stamp(at)}
        </dd>
        <dt className="font-bold text-slate-500 dark:text-slate-400">
          {t(`${DELETED}.col.recorded`)}
        </dt>
        <dd className="font-semibold text-slate-800 dark:text-slate-100">
          {op.createdByName ?? '—'} {stamp(recorded)}
        </dd>
        <dt className="font-bold text-slate-500 dark:text-slate-400">
          {t(`${DELETED}.col.reason`)}
        </dt>
        <dd className="text-slate-700 dark:text-slate-200">
          <DeletedReason op={op} />
        </dd>
      </dl>
      <div className="mt-2 flex justify-end">
        <span className={ACTION_GROUP} data-row-actions="custody-deleted">
          <DeletedViewButton id={op.id} onOpen={onOpen} />
        </span>
      </div>
    </li>
  );
};
