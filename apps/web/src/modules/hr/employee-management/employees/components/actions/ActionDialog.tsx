// Shared shell for Personnel Action dialogs (frozen design §8): every action dialog carries an
// optional effective date (past = applies immediately with that date; future = scheduled and
// applied by the server on the day) and an optional note, and submits against the employee's
// current version. Failures surface through the global API error toast.
//
// It also carries the OVERLAP WARNING (C1): a dialog that names the type it is about to create
// gets, above its fields, the pending scheduled actions that already write the same employment
// fields. A warning and nothing more — the submit button stays exactly as enabled as it was,
// because two actions on one field is legal and applies in strict effective-date order.
import { useState, type ReactNode } from 'react';
import { type EmployeeActionType, type Locale } from '@ecms/contracts';
import { useT } from '../../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../../store';
import { Dialog } from '../../../../../../shared/ui/Dialog';
import { Button } from '../../../../../../shared/ui/Button';
import { Field, Input, Textarea } from '../../../../../../shared/ui/form';
import { formatDate } from '../../../../../../shared/lib/format';
import { useActionOverlaps } from '../../api/employee-queries';

export interface ActionDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  submitting: boolean;
  onSubmit: () => void;
  submitLabel?: string;
  danger?: boolean;
  /** The action about to be created — enables the C1 overlap warning. */
  overlap?: { employeeId: string; type: EmployeeActionType };
  children?: ReactNode;
}

/**
 * What is already scheduled on the same fields.
 *
 * Says WHICH action and WHEN, in the vocabulary the history already uses — that is the part a
 * person acts on. The field paths the server matched on (`employment.salary`, …) are internal
 * names and stay out of the sentence.
 */
const OverlapWarning = ({
  employeeId,
  type,
}: {
  employeeId: string;
  type: EmployeeActionType;
}): JSX.Element | null => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  // Mounted only from inside an OPEN dialog (the shell returns null before this) — which is what
  // keeps a profile from asking about actions nobody is creating.
  const { data } = useActionOverlaps(employeeId, type);
  if (data === undefined || data.length === 0) return null;
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
      <p className="font-medium">{t('employees.actions.overlap.title')}</p>
      <ul className="mt-1 space-y-0.5">
        {data.map((row) => (
          <li key={row.actionId}>
            {t(`employees.actionType.${row.type}`)} — {formatDate(row.effectiveDate, locale)}
          </li>
        ))}
      </ul>
      <p className="mt-1 text-xs">{t('employees.actions.overlap.order')}</p>
    </div>
  );
};

export const ActionDialog = ({
  open,
  onClose,
  title,
  description,
  submitting,
  onSubmit,
  submitLabel,
  danger = false,
  overlap,
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
      <div className="space-y-4">
        {overlap !== undefined && (
          <OverlapWarning employeeId={overlap.employeeId} type={overlap.type} />
        )}
        {children}
      </div>
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
