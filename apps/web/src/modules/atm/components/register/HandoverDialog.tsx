// Hand a machine back to the bank (POST /atm/register/entries/:id/handover): open → ended.
//
// The machine is archived in the Operations list unless another open period still holds it (D2):
// it leaves the open forms, and its maintenance mails stay unmatched — the hint says so before the
// press, and the toast confirms it after.
//
// Delivered name and notes delivered are PRE-FILLED from the entry. Eight imported open rows
// already carry a delivered name and seven a note (review finding F-18), and a handover that
// re-typed them blank would erase them. So only what the reader CHANGED is sent; a field left as
// it was is left out, and the server keeps its stored value. The notes are a K field: a reader who
// may not see them is not shown the box, and nothing is sent for it.
import { useId, useState } from 'react';
import {
  type AtmRegisterEntryDto,
  type HandoverAtmRegisterEntry,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { Button } from '../../../../shared/ui/Button';
import { Dialog } from '../../../../shared/ui/Dialog';
import { Field, Input, Textarea } from '../../../../shared/ui/form';
import { MissingFieldsBanner, useRequiredFields } from '../../../../shared/ui/required-fields';
import { useHandoverRegisterEntry } from '../../api/register-queries';
import { cairoToday } from '../../lib/operation-view';
import { FormError, announceWrite, registerErrorText } from './EntryFormSections';

/** The handover body: the end date, and only the fields the reader changed from the entry's. */
export const handoverBody = (
  entry: AtmRegisterEntryDto,
  endDate: string,
  deliveredName: string,
  notesDelivered: string,
): HandoverAtmRegisterEntry => {
  const body: HandoverAtmRegisterEntry = { endDate, version: entry.version };
  const clean = (value: string): string | null => (value.trim() === '' ? null : value.trim());
  if (clean(deliveredName) !== entry.handoverName) body.handoverName = clean(deliveredName);
  if (entry.secretsVisible && clean(notesDelivered) !== entry.handoverNotes) {
    body.handoverNotes = clean(notesDelivered);
  }
  return body;
};

export const HandoverDialog = ({
  entry,
  onClose,
}: {
  entry: AtmRegisterEntryDto;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const id = useId();
  const [endDate, setEndDate] = useState(cairoToday);
  const [deliveredName, setDeliveredName] = useState(entry.handoverName ?? '');
  const [notesDelivered, setNotesDelivered] = useState(
    entry.secretsVisible ? (entry.handoverNotes ?? '') : '',
  );
  const [error, setError] = useState<string | null>(null);
  const handover = useHandoverRegisterEntry();

  const required = useRequiredFields([
    { key: 'endDate', label: t('atm.register.col.endDate'), ok: endDate !== '' },
  ]);

  const submit = required.guard(async () => {
    setError(null);
    try {
      const result = await handover.mutateAsync({
        id: entry.id,
        body: handoverBody(entry, endDate, deliveredName, notesDelivered),
      });
      announceWrite(result, 'atm.register.handedOver', t);
      onClose();
    } catch (failure) {
      setError(registerErrorText(failure, t, locale));
    }
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('atm.register.form.handoverTitle', { code: entry.machineCode ?? '—' })}
      size="lg"
      dismissOnOutsideClick={false}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('atm.common.cancel')}
          </Button>
          <Button loading={handover.isPending} onClick={submit}>
            {t('atm.register.action.handover')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
          {t('atm.register.form.handoverHint')}
        </p>
        <MissingFieldsBanner missing={required.missing} attempt={required.attempt} />
        <FormError message={error} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={t('atm.register.col.endDate')}
            htmlFor={`${id}-end`}
            required
            missing={required.isMissing('endDate')}
          >
            <Input
              id={`${id}-end`}
              type="date"
              dir="ltr"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </Field>
          <Field label={t('atm.register.col.handoverName')} htmlFor={`${id}-name`}>
            <Input
              id={`${id}-name`}
              data-handover-name="true"
              value={deliveredName}
              maxLength={300}
              autoComplete="off"
              onChange={(e) => setDeliveredName(e.target.value)}
            />
          </Field>
          {entry.secretsVisible && (
            <Field
              label={t('atm.register.col.handoverNotes')}
              htmlFor={`${id}-notes`}
              className="sm:col-span-2"
            >
              <Textarea
                id={`${id}-notes`}
                rows={3}
                value={notesDelivered}
                maxLength={4000}
                onChange={(e) => setNotesDelivered(e.target.value)}
              />
            </Field>
          )}
        </div>
      </div>
    </Dialog>
  );
};
