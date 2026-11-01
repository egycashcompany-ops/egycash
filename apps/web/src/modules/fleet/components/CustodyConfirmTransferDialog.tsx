// «تأكيد التحويل» — a held replenishment's money arrived. Opened from its line in «سجل العهدة» or
// from its drawer (`?confirm=<id>`, mounted once in the fund's head with the other fund dialogs).
//
// Only the transfer's day is needed — today by default, never before the letter's day (the box's
// `min`, the banner, and the API all say so); a reference and a note are optional. Under them the
// fund now → + the replenishment → the fund after (`FundResult`, sky — the fund's summary, not the
// letter's frozen figure: later operations may follow the letter), then what is reserved for it:
// the memos, each with its total.
//
// A replenishment confirmed or cancelled elsewhere since the dialog opened (409 / 404), or a link
// to one that is no longer held: «أُكِّد تحويل هذه الاستعاضة أو أُلغيت…», the log read again, the
// dialog closed. One press sends once.
import { useEffect, useRef, useState } from 'react';
import { type FleetCustodySource, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { Input } from '../../../shared/ui/form';
import { Spinner } from '../../../shared/ui/Spinner';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import { MissingFieldsBanner, useRequiredFields } from '../../../shared/ui/required-fields';
import { toast } from '../../../shared/ui/toast/toast-store';
import { errorMessage } from '../../../shared/lib/errors';
import {
  useConfirmCustodyTransfer,
  useCustodyFundSummary,
  useCustodyOperation,
} from '../api/fleet-queries';
import { fundAfter, todayDay } from '../lib/custody-fund-forms';
import { useCustodyCount } from '../lib/custody-words';
import { confirmTransferBody, holdRefusalOf, transferDateProblem } from '../lib/custody-hold';
import { DesignCancel, DesignDialog, DesignSave, DesignSection } from './DesignDialog';
import { DesignField, LOOK, boxTone } from './FuelCardDialog';
import { PATH, ymd } from './FuelCardBoard';
import { DATE_BOX, FundResult, useFigure, useFigureLine } from './custody-fund-form-parts';
import { CountChip, MEMO_ICON, SectionHead } from './custody-memo-parts';
import { HeldMemoTable } from './custody-hold-memos';

const HOLD = 'fleet.custody.hold';
/** A words box in the design — the reference and the note. */
const TEXT_BOX = boxTone(LOOK.add);
/** The check in a circle — «تأكيد التحويل». */
const CONFIRM_ICON: readonly string[] = [
  'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
  'm8 12 3 3 5-6',
];

export const CustodyConfirmTransferDialog = ({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const figure = useFigure();
  const figureLine = useFigureLine();
  const { count } = useCustodyCount();
  const op = useCustodyOperation(id);
  const fund = useCustodyFundSummary();
  const confirm = useConfirmCustodyTransfer();
  const [date, setDate] = useState(() => todayDay());
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const sending = useRef(false);
  const [waiting, setWaiting] = useState(false);
  const data = op.data;
  const letterDay = data === undefined ? '' : data.date.slice(0, 10);
  const problem = transferDateProblem(date, letterDay);
  const required = useRequiredFields([
    { key: 'date', label: t(`${HOLD}.transferDate`), ok: problem !== 'missing' },
    {
      key: 'date',
      label: t(`${HOLD}.transferBeforeLetter`, { date: ymd(letterDay) }),
      ok: problem !== 'beforeLetter',
    },
  ]);
  const before = fund.data?.fundTotal ?? 0;
  const amount = data?.amount ?? 0;
  const after = fundAfter(before, amount);
  const kinds = (data?.memos ?? []).reduce<FleetCustodySource[]>(
    (all, memo) => (all.includes(memo.kind) ? all : [...all, memo.kind]),
    [],
  );

  const taken = (): void => {
    toast.error(t(`${HOLD}.confirmTaken`));
    onClose();
  };
  // A link to a replenishment that is no longer held — confirmed or cancelled elsewhere, or not a
  // replenishment at all: said, and closed, before anything is sent.
  useEffect(() => {
    if (sending.current || data === undefined) return;
    if (data.kind !== 'replenish' || data.status !== 'held') taken();
    // `taken` is this render's; only a new answer matters.
  }, [data]);

  const send = (): void => {
    if (sending.current || data === undefined) return;
    sending.current = true;
    setWaiting(true);
    confirm
      .mutateAsync({ id, body: confirmTransferBody({ date, reference, note }) })
      .then(
        () => {
          toast.success(t(`${HOLD}.confirmDone`));
          onClose();
        },
        (error: unknown) => {
          sending.current = false;
          const why = holdRefusalOf(error);
          if (why === 'taken') taken();
          else if (why === 'beforeLetter') {
            toast.error(t(`${HOLD}.transferBeforeLetter`, { date: ymd(letterDay) }));
          } else toast.error(errorMessage(error, locale));
        },
      )
      .finally(() => setWaiting(false));
  };

  return (
    <DesignDialog
      open
      onClose={onClose}
      title={t(`${HOLD}.confirm`)}
      subtitle={
        data === undefined
          ? undefined
          : t(`${HOLD}.confirmSubtitle`, {
              date: ymd(data.date),
              memos: count('memo', data.memos.length),
            })
      }
      icon={CONFIRM_ICON}
      width="3xl"
      panelProps={{ 'data-memo-confirm': id }}
      footer={
        <div className="flex w-full items-center gap-3">
          <DesignSave
            label={t(`${HOLD}.confirm`)}
            busy={waiting || confirm.isPending || op.isPending}
            onClick={required.guard(send)}
            data-memo-confirm-save="true"
          />
          <DesignCancel onClick={onClose} />
        </div>
      }
    >
      <MissingFieldsBanner missing={required.missing} attempt={required.attempt} />
      <DesignSection title={t(`${HOLD}.confirmSection`)} icon={PATH.calendar}>
        <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-3 sm:gap-5">
          <DesignField
            label={t(`${HOLD}.transferDate`)}
            required
            missing={required.isMissing('date')}
            error={
              problem === 'beforeLetter'
                ? t(`${HOLD}.transferBeforeLetter`, { date: ymd(letterDay) })
                : undefined
            }
            datePicker
          >
            <Input
              type="date"
              dir="ltr"
              value={date}
              {...(letterDay === '' ? {} : { min: letterDay })}
              onChange={(e) => setDate(e.target.value)}
              tone={DATE_BOX}
              data-memo-confirm-date="true"
            />
          </DesignField>
          <DesignField label={t(`${HOLD}.transferRef`)}>
            <Input
              dir="auto"
              maxLength={120}
              value={reference}
              placeholder={t(`${HOLD}.transferRefHint`)}
              onChange={(e) => setReference(e.target.value)}
              tone={TEXT_BOX}
              data-memo-confirm-ref="true"
            />
          </DesignField>
          <DesignField label={t(`${HOLD}.transferNote`)}>
            <Input
              maxLength={500}
              value={note}
              placeholder={t(`${HOLD}.transferNoteHint`)}
              onChange={(e) => setNote(e.target.value)}
              tone={TEXT_BOX}
              data-memo-confirm-note="true"
            />
          </DesignField>
        </div>
      </DesignSection>

      <FundResult
        tone="sky"
        data-memo-confirm-result="true"
        line={figureLine('fleet.custody.fundForm.replenish.result', {
          amount: figure(amount),
          after: figure(after),
        })}
        before={before}
        change={amount}
        after={after}
        changeLabel={t('fleet.custody.fundForm.replenish.change')}
      />

      <section className="space-y-3">
        <SectionHead
          title={t(`${HOLD}.confirmMemos`)}
          icon={MEMO_ICON}
          end={
            data === undefined ? undefined : (
              <CountChip>{count('memo', data.memos.length)}</CountChip>
            )
          }
        />
        {data !== undefined ? (
          <HeldMemoTable op={data} kinds={kinds} tone="sky" mark="confirm" />
        ) : op.isError ? (
          <ErrorState error={op.error} onRetry={() => void op.refetch()} />
        ) : (
          <p className="flex justify-center py-6">
            <Spinner className="h-5 w-5" />
          </p>
        )}
      </section>
    </DesignDialog>
  );
};
