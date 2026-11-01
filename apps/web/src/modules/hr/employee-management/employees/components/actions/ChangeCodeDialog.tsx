// Changing the Employee Code by hand — «عايزك تعمل إمكانية تغيير كود الموظف».
//
// ADR-017 still holds where it always did: the SYSTEM never re-derives a code (a transfer used to,
// and renamed people silently). This is the other thing — somebody holding `employee.changeCode`
// typing the new code and saying why, with both recorded on the employee's history.
//
// The two things a person needs to know before pressing save are written in the dialog, not left
// to be discovered: old contracts and documents keep the code they were made under, and the next
// roster upload must carry the new code — the import names people by code.
import { useEffect, useState } from 'react';
import { EMPLOYEE_CODE_PATTERN, type EmployeeDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../../store';
import { Dialog } from '../../../../../../shared/ui/Dialog';
import { Button } from '../../../../../../shared/ui/Button';
import { Field, Input, Textarea } from '../../../../../../shared/ui/form';
import { toast } from '../../../../../../shared/ui/toast/toast-store';
import { ApiError } from '../../../../../../shared/lib/api-client';
import { errorMessage } from '../../../../../../shared/lib/errors';
import { useChangeEmployeeCode } from '../../api/employee-queries';

interface Props {
  employee: EmployeeDto;
  open: boolean;
  onClose: () => void;
}

export const ChangeCodeDialog = ({ employee, open, onClose }: Props): JSX.Element | null => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const change = useChangeEmployeeCode(employee.id);
  const [code, setCode] = useState('');
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (open) {
      setCode('');
      setReason('');
      setTried(false);
      change.reset();
    }
    // `change` is a new object every render; resetting on open is the only intent here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const next = code.trim();
  const shapeOk = EMPLOYEE_CODE_PATTERN.test(next);
  const same = next === employee.code;
  const reasonOk = reason.trim().length >= 3;

  const codeError = !tried
    ? undefined
    : next === ''
      ? t('employees.changeCode.required')
      : !shapeOk
        ? t('employees.changeCode.shape')
        : same
          ? t('employees.changeCode.same')
          : undefined;

  // A taken code is the one refusal worth its own words; everything else reads as it does elsewhere.
  const serverError =
    change.error === null
      ? undefined
      : change.error instanceof ApiError && change.error.code === 'CONFLICT'
        ? t('employees.changeCode.taken')
        : errorMessage(change.error, locale);

  const save = (): void => {
    setTried(true);
    if (!shapeOk || same || !reasonOk) return;
    change.mutate(
      { code: next, reason: reason.trim(), version: employee.version },
      {
        onSuccess: ({ meta }) => {
          toast.success(
            meta?.loginUsernameChanged === true
              ? t('employees.changeCode.doneWithLogin', { code: next })
              : t('employees.changeCode.done'),
          );
          onClose();
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      dismissOnOutsideClick={false}
      title={t('employees.changeCode.title')}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={save} loading={change.isPending}>
            {t('employees.changeCode.save')}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label={t('employees.changeCode.current')}>
          <Input value={employee.code} readOnly dir="ltr" />
        </Field>
        <Field label={t('employees.changeCode.new')} required error={codeError ?? serverError}>
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            inputMode="numeric"
            dir="ltr"
            maxLength={12}
            autoFocus
          />
        </Field>
        <Field
          label={t('employees.changeCode.reason')}
          required
          error={tried && !reasonOk ? t('employees.changeCode.reasonRequired') : undefined}
        >
          <Textarea rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <p className="text-xs text-slate-500 dark:text-slate-400">{t('employees.changeCode.note')}</p>
      </div>
    </Dialog>
  );
};
