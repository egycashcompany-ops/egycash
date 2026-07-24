// Shared shell for Personnel Action dialogs (frozen design §8): every action dialog carries an
// optional effective date (past = applies immediately with that date; future = scheduled and
// applied by the server on the day) and an optional note, and submits against the employee's
// current version. Failures surface through the global API error toast.
import { useState, type ReactNode } from 'react';
import { useT } from '../../../../../../platform/localization/useT';
import { Dialog } from '../../../../../../shared/ui/Dialog';
import { Button } from '../../../../../../shared/ui/Button';
import { Field, Input, Textarea } from '../../../../../../shared/ui/form';

export interface ActionDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  submitting: boolean;
  onSubmit: () => void;
  submitLabel?: string;
  danger?: boolean;
  children?: ReactNode;
}

export const ActionDialog = ({
  open,
  onClose,
  title,
  description,
  submitting,
  onSubmit,
  submitLabel,
  danger = false,
  children,
}: ActionDialogProps): JSX.Element | null => {
  const t = useT();
  if (!open) return null;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      {...(description === undefined ? {} : { description })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={submitting} onClick={onSubmit}>
            {submitLabel ?? t('common.confirm')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">{children}</div>
    </Dialog>
  );
};

/** Effective date + note — shared tail fields of every action dialog. */
export const useActionCommonFields = (): {
  effectiveDate: string;
  note: string;
  fields: JSX.Element;
  common: { effectiveDate?: Date; note?: string };
} => {
  const t = useT();
  const [effectiveDate, setEffectiveDate] = useState('');
  const [note, setNote] = useState('');
  const fields = (
    <>
      <Field label={t('employees.actions.effectiveDate')} hint={t('employees.actions.effectiveDateHint')}>
        <Input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
      </Field>
      <Field label={t('employees.actions.note')} hint={t('offers.form.optional')}>
        <Textarea rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </>
  );
  return {
    effectiveDate,
    note,
    fields,
    common: {
      ...(effectiveDate === '' ? {} : { effectiveDate: new Date(effectiveDate) }),
      ...(note.trim() === '' ? {} : { note: note.trim() }),
    },
  };
};
