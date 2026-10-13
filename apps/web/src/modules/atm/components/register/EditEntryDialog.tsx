// Edit a register entry (PATCH /atm/register/entries/:id) — the same form as Receive, pre-filled,
// sending ONLY what the reader changed.
//
// On an open entry linked to the Operations list, name, area and bank changes reach the machine in
// the same request (D2); on an open entry that is not linked yet, entering the area links it
// (DEC-30) — the toast says what happened in Operations either way. The branch never changes
// (D4). The combination box is empty: empty keeps the recorded value, "clear" removes it.
import { useState } from 'react';
import { type AtmRegisterEntryDto, type AtmRegisterMetaDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { Button } from '../../../../shared/ui/Button';
import { Dialog } from '../../../../shared/ui/Dialog';
import { MissingFieldsBanner, useRequiredFields } from '../../../../shared/ui/required-fields';
import { useRegisterBranchOptions, useUpdateRegisterEntry } from '../../api/register-queries';
import {
  EntryFormSections,
  FormError,
  announceWrite,
  entryEditRules,
  entryFormValues,
  registerErrorText,
  updateBody,
  type EntryFormValues,
} from './EntryFormSections';

export const EditEntryDialog = ({
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
  const [initial] = useState<EntryFormValues>(() => entryFormValues(entry));
  const [values, setValues] = useState<EntryFormValues>(initial);
  const [combinationClear, setCombinationClear] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options = useRegisterBranchOptions(entry.branchId);
  const update = useUpdateRegisterEntry();
  const rules = entryEditRules(entry);

  const label = (field: string): string => t(`atm.register.col.${field}`);
  const required = useRequiredFields([
    { key: 'name', label: label('name'), ok: values.name.trim() !== '' },
    ...(rules.areaRequired
      ? [{ key: 'area', label: label('area'), ok: values.area.trim() !== '' }]
      : []),
    ...(rules.startDateEditable
      ? [{ key: 'startDate', label: label('startDate'), ok: values.startDate !== '' }]
      : []),
    ...(rules.handoverEditable
      ? [{ key: 'endDate', label: label('endDate'), ok: values.endDate !== '' }]
      : []),
  ]);

  const submit = required.guard(async () => {
    setError(null);
    const body = updateBody(entry, initial, values, combinationClear);
    // Nothing changed: nothing to send, and no audit row for an edit that edited nothing.
    if (Object.keys(body).length === 1) {
      onClose();
      return;
    }
    try {
      const result = await update.mutateAsync({ id: entry.id, body });
      announceWrite(result, 'atm.register.saved', t);
      onClose();
    } catch (failure) {
      setError(registerErrorText(failure, t, locale));
    }
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('atm.register.form.editTitle', {
        code: entry.machineCode ?? entry.name ?? '—',
      })}
      size="xl"
      tall
      dismissOnOutsideClick={false}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('atm.common.cancel')}
          </Button>
          <Button loading={update.isPending} onClick={submit}>
            {t('atm.common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <MissingFieldsBanner missing={required.missing} attempt={required.attempt} />
        <FormError message={error} />
        <EntryFormSections
          mode="edit"
          entry={entry}
          values={values}
          onChange={(patch) => setValues((current) => ({ ...current, ...patch }))}
          combinationClear={combinationClear}
          onCombinationClear={setCombinationClear}
          meta={meta}
          options={options.data}
          secrets={entry.secretsVisible}
          isMissing={required.isMissing}
        />
      </div>
    </Dialog>
  );
};
