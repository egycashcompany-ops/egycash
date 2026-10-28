// Record the receipt of a pending entry (POST /atm/register/entries/:id/receive): pending → open.
//
// The entry was recorded without a start date; receiving it now does what a receipt does — the
// machine is linked to, reactivated in or added to its branch's Operations list (D2). So the start
// date is asked for, and so is anything a receipt needs that the entry does not carry yet: the
// area (D6), the bank, the ATM ID, and the name the Operations list should file the bank under.
// What the entry already has is kept and not asked again.
//
// The bank is one of the catalog's ACTIVE banks (DEC-35) — a bank added at runtime is a full
// register bank — and the Operations name a spelling of THAT bank, as on the receipt form; the
// area is suggested in the reader's language and saved by its stored name.
import { useId, useState } from 'react';
import {
  normalizeAtmMachineCode,
  type AtmRegisterEntryDto,
  type AtmRegisterMetaDto,
  type Locale,
  type ReceivePendingAtmRegisterEntry,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { Button } from '../../../../shared/ui/Button';
import { Dialog } from '../../../../shared/ui/Dialog';
import { Field, Input, Select } from '../../../../shared/ui/form';
import { MissingFieldsBanner, useRequiredFields } from '../../../../shared/ui/required-fields';
import {
  useReceivePendingRegisterEntry,
  useRegisterBranchOptions,
} from '../../api/register-queries';
import { makeBankLookup } from '../../lib/bank-catalog';
import { cairoToday } from '../../lib/operation-view';
import {
  FormError,
  announceWrite,
  areaSuggestions,
  opsLabelChoices,
  registerBankChoices,
  registerBankOptionLabel,
  registerErrorText,
} from './EntryFormSections';

/** What a pending entry still lacks for a receipt — each asked for only when it is missing. */
export const pendingGaps = (
  entry: AtmRegisterEntryDto,
): { area: boolean; bank: boolean; code: boolean; opsLabel: boolean; receivedBy: boolean } => ({
  area: entry.area === null,
  bank: entry.bankCode === null,
  code: entry.machineCode === null,
  opsLabel: entry.opsBankLabel === null,
  receivedBy: entry.receivedByName === null,
});

export const ReceivePendingDialog = ({
  entry,
  meta,
  onClose,
}: {
  entry: AtmRegisterEntryDto;
  meta: AtmRegisterMetaDto | undefined;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const id = useId();
  const gaps = pendingGaps(entry);
  const [startDate, setStartDate] = useState(cairoToday);
  const [area, setArea] = useState('');
  const [bank, setBank] = useState('');
  const [code, setCode] = useState('');
  const [opsLabel, setOpsLabel] = useState('');
  const [receivedBy, setReceivedBy] = useState('');
  const [error, setError] = useState<string | null>(null);
  const options = useRegisterBranchOptions(entry.branchId);
  const receive = useReceivePendingRegisterEntry();

  const label = (field: string): string => t(`atm.register.col.${field}`);
  const required = useRequiredFields([
    { key: 'startDate', label: label('startDate'), ok: startDate !== '' },
    ...(gaps.area ? [{ key: 'area', label: label('area'), ok: area.trim() !== '' }] : []),
    ...(gaps.bank ? [{ key: 'bankCode', label: label('bankCode'), ok: bank !== '' }] : []),
    ...(gaps.code
      ? [
          {
            key: 'machineCode',
            label: label('machineCode'),
            ok: normalizeAtmMachineCode(code) !== '',
          },
        ]
      : []),
  ]);

  const lookup = makeBankLookup(meta?.banks);
  const effectiveBank = bank === '' ? entry.bankCode : bank;
  const autoLabel =
    effectiveBank === null
      ? '—'
      : (meta?.banks.find((b) => b.code === effectiveBank)?.opsLabel ?? effectiveBank);
  // Only the catalog's active banks: the bank is asked for only when the entry has none.
  const bankChoices = registerBankChoices(lookup, [bank]);
  const opsLabels = effectiveBank === null ? [] : opsLabelChoices(options.data, effectiveBank, '');
  const areas = areaSuggestions(options.data, locale);

  const submit = required.guard(async () => {
    setError(null);
    const body: ReceivePendingAtmRegisterEntry = { startDate, version: entry.version };
    if (gaps.area && area.trim() !== '') body.area = area.trim();
    if (gaps.bank && bank !== '') body.bankCode = bank;
    if (gaps.code && code.trim() !== '') body.machineCode = code.trim();
    if (gaps.opsLabel && opsLabel !== '') body.opsBankLabel = opsLabel;
    if (gaps.receivedBy && receivedBy.trim() !== '') body.receivedByName = receivedBy.trim();
    try {
      const result = await receive.mutateAsync({ id: entry.id, body });
      announceWrite(result, 'atm.register.received', t);
      onClose();
    } catch (failure) {
      setError(registerErrorText(failure, t, locale));
    }
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('atm.register.form.receivePendingTitle', {
        name: entry.name ?? entry.machineCode ?? '—',
      })}
      size="lg"
      dismissOnOutsideClick={false}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('atm.common.cancel')}
          </Button>
          <Button loading={receive.isPending} onClick={submit}>
            {t('atm.register.action.receivePending')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <MissingFieldsBanner missing={required.missing} attempt={required.attempt} />
        <FormError message={error} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={label('startDate')}
            htmlFor={`${id}-start`}
            required
            missing={required.isMissing('startDate')}
          >
            <Input
              id={`${id}-start`}
              type="date"
              dir="ltr"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </Field>
          {gaps.area && (
            <Field
              label={label('area')}
              htmlFor={`${id}-area`}
              required
              missing={required.isMissing('area')}
            >
              <Input
                id={`${id}-area`}
                value={area}
                maxLength={120}
                autoComplete="off"
                list={`${id}-areas`}
                onChange={(e) => setArea(e.target.value)}
              />
              <datalist id={`${id}-areas`}>
                {areas.map((option) => (
                  <option
                    key={option.value}
                    value={option.value}
                    {...(option.label === undefined ? {} : { label: option.label })}
                  />
                ))}
              </datalist>
            </Field>
          )}
          {gaps.bank && (
            <Field
              label={label('bankCode')}
              htmlFor={`${id}-bank`}
              required
              missing={required.isMissing('bankCode')}
            >
              <Select
                id={`${id}-bank`}
                value={bank}
                onChange={(e) => {
                  setBank(e.target.value);
                  setOpsLabel('');
                }}
              >
                <option value="">{t('common.select')}</option>
                {bankChoices.map((choice) => (
                  <option key={choice.code} value={choice.code}>
                    {registerBankOptionLabel(choice, lookup, locale, t)}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {gaps.code && (
            <Field
              label={label('machineCode')}
              htmlFor={`${id}-code`}
              required
              missing={required.isMissing('machineCode')}
            >
              <Input
                id={`${id}-code`}
                dir="ltr"
                value={code}
                maxLength={64}
                autoComplete="off"
                onChange={(e) => setCode(e.target.value)}
              />
            </Field>
          )}
          {gaps.opsLabel && (
            <Field label={t('atm.register.form.opsBankLabel')} htmlFor={`${id}-ops`}>
              <Select
                id={`${id}-ops`}
                value={opsLabel}
                onChange={(e) => setOpsLabel(e.target.value)}
              >
                <option value="">
                  {t('atm.register.form.opsBankLabelAuto', { label: autoLabel })}
                </option>
                {opsLabels.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {gaps.receivedBy && (
            <Field label={label('receivedByName')} htmlFor={`${id}-received`}>
              <Input
                id={`${id}-received`}
                value={receivedBy}
                maxLength={300}
                autoComplete="off"
                onChange={(e) => setReceivedBy(e.target.value)}
              />
            </Field>
          )}
        </div>
      </div>
    </Dialog>
  );
};
