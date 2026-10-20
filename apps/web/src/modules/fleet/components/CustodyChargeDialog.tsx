// «شحن العهدة» — an amount charged into the fund, with his «صرف عهدة» letter.
//
// «التاريخ» opens on today, «المبلغ» is the only value it cannot go without, «وذلك نظير» is his
// reason as he writes it (optional — an empty one drops the letter's second paragraph). «نص
// الخطاب» is the letter's own sentence (`chargeLetterSentence`), drawn as text. The sum under it
// is «إجمالي العهدة» now, the amount, and the fund after it.
//
// Save stays pressable: a press with no amount names «المبلغ» in the banner and turns its box red
// (`useRequiredFields`). Both saves go through `useFundOperation` — once per press, `busy` while on
// the way — so a double click never records two charges.
import { useState } from 'react';
import { useT } from '../../../platform/localization/useT';
import { Input, Textarea } from '../../../shared/ui/form';
import { MoneyInput } from '../../../shared/ui/MoneyInput';
import { MissingFieldsBanner, useRequiredFields } from '../../../shared/ui/required-fields';
import { useChargeCustody, useCustodyFundSummary } from '../api/fleet-queries';
import { chargeLetterSentence } from '../lib/custody-papers';
import {
  CHARGE_AMOUNT_MAX,
  CHARGE_REASON_MAX,
  chargeAmountOf,
  chargeBody,
  fundAfter,
  todayDay,
} from '../lib/custody-fund-forms';
import { DesignCancel, DesignDialog, DesignSave, DesignSection } from './DesignDialog';
import { DesignField } from './FuelCardDialog';
import { PATH } from './FuelCardBoard';
import { NOTE_BOX } from './LicenseExpensePaidGroup';
import { CUSTODY_OPS } from './CustodyFundActions';
import { MEMO_ICON, PrintButton, SectionHead } from './custody-memo-parts';
import {
  AMOUNT_BOX,
  DATE_BOX,
  DialogButtons,
  FundResult,
  useFigure,
  useFigureLine,
  useFundOperation,
} from './custody-fund-form-parts';

export const CustodyChargeDialog = ({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): JSX.Element | null => {
  const t = useT();
  const figure = useFigure();
  const figureLine = useFigureLine();
  const fund = useCustodyFundSummary(open);
  const charge = useChargeCustody();
  const [date, setDate] = useState(() => todayDay());
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const value = chargeAmountOf(amount);
  const before = fund.data?.fundTotal ?? 0;
  const after = fundAfter(before, value ?? 0);
  // Past the contract's ceiling the server would refuse it with no field named: said here instead.
  const tooBig = value !== null && value > CHARGE_AMOUNT_MAX;
  const required = useRequiredFields(
    [
      { key: 'amount', label: t('fleet.custody.fundForm.required.amount'), ok: value !== null },
      { key: 'amount', label: t('fleet.custody.fundForm.required.amountMax'), ok: !tooBig },
    ],
    open,
  );
  const { run, busy } = useFundOperation({
    mutation: charge,
    letter: 'charge',
    done: t('fleet.custody.fundForm.charge.done'),
    taken: t('fleet.custody.fundForm.charge.retry'),
    onDone: onClose,
    onTaken: () => void fund.refetch(),
  });
  const send = (print: boolean): void =>
    run(chargeBody({ date, amount: value ?? 0, reason }), print);

  return (
    <DesignDialog
      open={open}
      onClose={onClose}
      title={t('fleet.custody.actions.charge')}
      subtitle={t('fleet.custody.fundForm.charge.subtitle')}
      icon={CUSTODY_OPS.charge.icon}
      width="2xl"
      panelProps={{ 'data-memo-charge': 'true' }}
      footer={
        <DialogButtons
          save={
            <DesignSave
              busy={busy}
              onClick={required.guard(() => send(false))}
              data-memo-charge-save="true"
            />
          }
          print={
            <PrintButton
              label={t('fleet.custody.fundForm.charge.savePrint')}
              busy={busy}
              onClick={required.guard(() => send(true))}
              data-memo-charge-print="true"
            />
          }
          cancel={<DesignCancel onClick={onClose} />}
        />
      }
    >
      <MissingFieldsBanner missing={required.missing} attempt={required.attempt} />
      <DesignSection title={t('fleet.custody.fundForm.charge.section')} icon={PATH.calendar}>
        <div className="grid grid-cols-1 items-start gap-5 sm:grid-cols-2">
          <DesignField label={t('fleet.custody.fundForm.charge.date')} datePicker>
            <Input
              type="date"
              dir="ltr"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              tone={DATE_BOX}
              data-memo-charge-date="true"
            />
          </DesignField>
          <DesignField
            label={t('fleet.custody.fundForm.charge.amount')}
            required
            missing={required.isMissing('amount')}
            error={tooBig ? t('fleet.custody.fundForm.amountTooBig') : undefined}
          >
            <MoneyInput
              value={amount}
              onChange={setAmount}
              tone={AMOUNT_BOX}
              data-memo-charge-amount="true"
            />
          </DesignField>
        </div>
        <DesignField label={t('fleet.custody.fundForm.charge.reason')}>
          <Textarea
            rows={2}
            maxLength={CHARGE_REASON_MAX}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={NOTE_BOX}
            data-memo-charge-reason="true"
          />
        </DesignField>
      </DesignSection>

      <section className="space-y-3">
        <SectionHead title={t('fleet.custody.fundForm.charge.letterText')} icon={MEMO_ICON} />
        {/* His letter's request, word for word and in his digits — text, never markup. */}
        <blockquote
          data-memo-charge-sentence="true"
          className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-[15px] font-semibold leading-8 text-slate-800 dark:border-[#2b3b6b] dark:bg-[#0a1233]/80 dark:text-slate-200"
        >
          <span className="block font-bold text-slate-900 dark:text-white">
            {t('fleet.custody.papers.paper.charge')}
          </span>
          <span>{chargeLetterSentence({ amount: value ?? 0, reason })}</span>
        </blockquote>
      </section>

      <FundResult
        tone="teal"
        data-memo-charge-result="true"
        line={figureLine('fleet.custody.fundForm.charge.result', {
          amount: figure(value ?? 0),
          after: figure(after),
        })}
        before={before}
        change={value ?? 0}
        after={after}
        changeLabel={t('fleet.custody.fundForm.charge.change')}
      />
    </DesignDialog>
  );
};
