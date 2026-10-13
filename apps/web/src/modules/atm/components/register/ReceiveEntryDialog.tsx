// Receive a machine from the bank — one new row of the register (POST /atm/register/entries).
//
// With a start date it is a RECEIPT: the entry opens and the machine is linked to, reactivated in
// or added to its branch's Operations list in the same request (D2). Without one it is recorded as
// pending ("No start date") and touches nothing in Operations until "Record receipt" (DEC-12).
// The toast says which of those happened, and every warning the server noticed (an unusual ATM
// ID, a serial already in operation elsewhere) — a warning never stops the receipt (D6).
import { useState } from 'react';
import { normalizeAtmMachineCode, type AtmRegisterMetaDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useCan } from '../../../../platform/rbac/Can';
import { readStoredBranch } from '../../../../platform/layout/BranchSwitcher';
import { useAppSelector } from '../../../../store';
import { Button } from '../../../../shared/ui/Button';
import { Dialog } from '../../../../shared/ui/Dialog';
import { MissingFieldsBanner, useRequiredFields } from '../../../../shared/ui/required-fields';
import { useReceiveRegisterEntry, useRegisterBranchOptions } from '../../api/register-queries';
import {
  EntryFormSections,
  FormError,
  announceWrite,
  creatableBranches,
  entryFormValues,
  receiveBody,
  registerErrorText,
  type EntryFormValues,
} from './EntryFormSections';

/**
 * The branch a receipt starts on: the top bar's branch when the reader may receive there, else
 * the only branch they may receive in — and otherwise nothing, so the choice is theirs.
 */
export const defaultReceiptBranch = (
  meta: AtmRegisterMetaDto | undefined,
  active: string | null,
): string => {
  const ids = creatableBranches(meta).map((b) => b.branchId ?? '');
  if (active !== null && ids.includes(active)) return active;
  return ids.length === 1 ? (ids[0] ?? '') : '';
};

export const ReceiveEntryDialog = ({
  meta,
  onClose,
}: {
  meta: AtmRegisterMetaDto | undefined;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const secrets = can('atmRegister.viewSecrets');
  const [values, setValues] = useState<EntryFormValues>(() =>
    entryFormValues(null, defaultReceiptBranch(meta, readStoredBranch())),
  );
  const [error, setError] = useState<string | null>(null);
  const options = useRegisterBranchOptions(values.branchId === '' ? null : values.branchId);
  const receive = useReceiveRegisterEntry();

  const label = (field: string): string => t(`atm.register.col.${field}`);
  const startSet = values.startDate !== '';
  const required = useRequiredFields([
    { key: 'branchId', label: label('branchCode'), ok: values.branchId !== '' },
    { key: 'name', label: label('name'), ok: values.name.trim() !== '' },
    // A receipt opens the machine in Operations, which needs all three (D6, §3.7).
    ...(startSet
      ? [
          { key: 'area', label: label('area'), ok: values.area.trim() !== '' },
          { key: 'bankCode', label: label('bankCode'), ok: values.bankCode !== '' },
          {
            key: 'machineCode',
            label: label('machineCode'),
            ok: normalizeAtmMachineCode(values.machineCode) !== '',
          },
        ]
      : []),
  ]);

  const submit = required.guard(async () => {
    setError(null);
    try {
      const result = await receive.mutateAsync(receiveBody(values, secrets));
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
      title={t('atm.register.form.receiveTitle')}
      size="xl"
      tall
      dismissOnOutsideClick={false}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('atm.common.cancel')}
          </Button>
          <Button loading={receive.isPending} onClick={submit}>
            {t('atm.register.receive')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <MissingFieldsBanner missing={required.missing} attempt={required.attempt} />
        <FormError message={error} />
        <EntryFormSections
          mode="receive"
          entry={null}
          values={values}
          onChange={(patch) => setValues((current) => ({ ...current, ...patch }))}
          combinationClear={false}
          onCombinationClear={() => undefined}
          meta={meta}
          options={options.data}
          secrets={secrets}
          isMissing={required.isMissing}
        />
      </div>
    </Dialog>
  );
};
