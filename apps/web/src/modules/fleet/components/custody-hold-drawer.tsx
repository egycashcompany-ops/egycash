// What a replenishment's drawer («سجل العهدة», `?open=<id>`) adds for its hold — kept here so the
// drawer itself only wires them in:
//
//   held         an amber note: «معلّقة — في انتظار تحويل المبلغ منذ …» and that its memos are
//                reserved; the footer's «تأكيد التحويل» (primary, the print stepping back beside it)
//                and, at the footer's other end, the red words «إلغاء الاستعاضة المعلّقة».
//   transferred  an emerald note: «حُوِّل المبلغ في … — مرجع …», who confirmed it, and that the fund
//                grew from the transfer's day.
//   cancelled    a slate note: who cancelled it, when, the reason when one was given, and that its
//                memos went back to «لم تُستعَض بعد»; «ملغاة» beside the title. (The drawer drops the
//                before → after strip and the letter, and greys the memos.)
import { type FleetCustodyOperationDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Button } from '../../../shared/ui/Button';
import { CheckIcon } from '../../../shared/ui/icons';
import { operationStatusOf } from '../lib/custody-hold';
import { BoardIcon, NUM, ymd } from './FuelCardBoard';
import { CANCEL_ICON, CancelledChip, HOLD_CLOCK } from './custody-hold-parts';

const HOLD = 'fleet.custody.hold';
/** Where a value stands in a sentence — the sentence is split on it, so the words stay keys. */
const TOKEN = '⁣';

/** The sentence around its one value, the value in the figures' face. */
const Around = ({ sentence, value }: { sentence: string; value: string }): JSX.Element => {
  const [before = '', after = ''] = sentence.split(TOKEN);
  return (
    <>
      {before}
      <span dir="ltr" className={NUM}>
        {value}
      </span>
      {after}
    </>
  );
};

/** The note under the drawer's sentence — `null` for an operation that was never held. */
export const HoldDrawerNote = ({
  op,
  memos,
}: {
  op: Pick<FleetCustodyOperationDto, 'status' | 'date' | 'transfer' | 'cancellation'>;
  /** «5 مذكرات» — the memos the replenishment reserved. */
  memos: string;
}): JSX.Element | null => {
  const t = useT();
  const status = operationStatusOf(op);
  if (status === 'held') {
    return (
      <p
        data-ledger-held-note="true"
        className="flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold leading-6 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/[0.08] dark:text-amber-200"
      >
        <BoardIcon d={HOLD_CLOCK} className="mt-1 h-4 w-4 shrink-0" />
        <span>
          <b className="block font-bold text-amber-800 dark:text-amber-300">
            <Around sentence={t(`${HOLD}.drawerHeldTitle`, { date: TOKEN })} value={ymd(op.date)} />
          </b>
          {t(`${HOLD}.drawerHeldNote`, { memos })}
        </span>
      </p>
    );
  }
  if (status === 'cancelled') {
    const cancellation = op.cancellation;
    const day = cancellation === null ? '' : ymd(cancellation.at.slice(0, 10));
    return (
      <div
        data-ledger-cancelled-note="true"
        className="flex items-start gap-2.5 rounded-xl border border-slate-300 bg-slate-100 px-4 py-3 text-sm font-semibold leading-6 text-slate-700 dark:border-slate-600/70 dark:bg-slate-800/40 dark:text-slate-200"
      >
        <BoardIcon
          d={CANCEL_ICON}
          className="mt-1 h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400"
        />
        <span>
          <b className="block font-bold text-slate-900 dark:text-white">
            {t(`${HOLD}.cancelledTitle`)}
          </b>
          {cancellation !== null &&
            (cancellation.byName === null
              ? t(`${HOLD}.cancelledNoteAnon`, { date: day })
              : t(`${HOLD}.cancelledNote`, { by: cancellation.byName, date: day }))}
          {cancellation !== null && cancellation.reason !== '' && (
            <span
              className="mt-1 block text-slate-600 dark:text-slate-300"
              data-ledger-cancelled-reason="true"
            >
              {t(`${HOLD}.cancelledReason`, { reason: cancellation.reason })}
            </span>
          )}
        </span>
      </div>
    );
  }
  const transfer = op.transfer;
  if (transfer === null) return null;
  return (
    <p
      data-ledger-transfer-note="true"
      className="flex items-start gap-2.5 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-semibold leading-6 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/[0.08] dark:text-emerald-200"
    >
      <CheckIcon className="mt-1 h-4 w-4 shrink-0" />
      <span>
        <b className="block font-bold text-emerald-800 dark:text-emerald-300">
          <Around
            sentence={t(`${HOLD}.transferredOn`, { date: TOKEN })}
            value={ymd(transfer.date)}
          />
          {transfer.reference !== '' && (
            <>
              {' — '}
              <Around
                sentence={t(`${HOLD}.reference`, { ref: TOKEN })}
                value={transfer.reference}
              />
            </>
          )}
        </b>
        {transfer.byName === null
          ? t(`${HOLD}.drawerTransferNoteAnon`, { letter: ymd(op.date) })
          : t(`${HOLD}.drawerTransferNote`, { by: transfer.byName, letter: ymd(op.date) })}
      </span>
    </p>
  );
};

/**
 * The drawer's title after «استعاضة العهدة —»: a replenishment is titled by its LETTER's day (once
 * transferred its line is dated by the transfer), a cancelled one with «ملغاة» beside it.
 */
export const HoldDrawerTitleDay = ({
  op,
}: {
  op: Pick<FleetCustodyOperationDto, 'kind' | 'status' | 'date'>;
}): JSX.Element => {
  const t = useT();
  const day = (
    <span dir="ltr" className={NUM}>
      {ymd(op.date)}
    </span>
  );
  if (op.kind !== 'replenish') return day;
  const [before = '', after = ''] = t(`${HOLD}.letterOf`, { date: TOKEN }).split(TOKEN);
  return (
    <>
      {before}
      {day}
      {after}
      {operationStatusOf(op) === 'cancelled' && (
        <span className="ms-2 inline-flex align-middle">
          <CancelledChip />
        </span>
      )}
    </>
  );
};

/** «إلغاء الاستعاضة المعلّقة» — red words at the footer's other end, never beside the confirm. */
export const HoldCancelButton = ({
  id,
  onCancel,
}: {
  id: string;
  onCancel: () => void;
}): JSX.Element => {
  const t = useT();
  return (
    <Button
      variant="ghost-danger"
      onClick={onCancel}
      className="me-auto font-bold"
      leftIcon={<BoardIcon d={CANCEL_ICON} className="me-1.5 h-4 w-4" />}
      data-ledger-details-cancel={id}
    >
      {t(`${HOLD}.cancel`)}
    </Button>
  );
};

/** «تأكيد التحويل» — the held replenishment's next step, the footer's primary. */
export const HoldConfirmButton = ({
  id,
  onConfirm,
}: {
  id: string;
  onConfirm: () => void;
}): JSX.Element => {
  const t = useT();
  return (
    <Button
      onClick={onConfirm}
      leftIcon={<CheckIcon className="me-1.5 h-4 w-4" />}
      data-ledger-details-confirm={id}
    >
      {t(`${HOLD}.confirm`)}
    </Button>
  );
};
