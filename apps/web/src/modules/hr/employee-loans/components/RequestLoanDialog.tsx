// Asking for a loan — one form, wherever the asking happens.
//
// TWO CALLERS, ONE DIALOG. HR records a request on somebody's Loans tab; the employee files their
// own from «سلفي». Those are the same request with the same fields and the same rules — what
// differs is only whose file it lands in, which is the `employeeId` prop. A second form for the
// self-service path would be the same five fields written twice, and the two would answer
// differently the first time either changed.
//
// The server is the authority on who may do this and for whom: `employeeLoan.create` at the
// caller's scope, and the subject employee is loaded through it — so an employee holding the key at
// `own` scope can only ever file against their own record, whatever id reaches this component.
import { useState } from 'react';
import { type CreateEmployeeLoan, EMPLOYEE_LOAN_TYPES } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { Button } from '../../../../shared/ui';
import { Dialog } from '../../../../shared/ui/Dialog';
import { Field, Input, Textarea, Select } from '../../../../shared/ui/form';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { useCreateLoan } from '../api/employee-loans-queries';

export const RequestLoanDialog = ({
  employeeId,
  currency,
  onClose,
}: {
  employeeId: string;
  /** The employee's own pay currency — the obligation is denominated in what they are paid in. */
  currency: string;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const create = useCreateLoan(employeeId);
  const [type, setType] = useState<CreateEmployeeLoan['type']>('loan');
  const [principal, setPrincipal] = useState('');
  const [installmentCount, setInstallmentCount] = useState('1');
  const [firstPeriod, setFirstPeriod] = useState('');
  const [reason, setReason] = useState('');

  const save = (): void => {
    create.mutate(
      {
        type,
        principal: Number(principal),
        currency,
        installmentCount: Number(installmentCount),
        firstPeriod,
        reason: reason.trim(),
      },
      {
        onSuccess: () => {
          toast.success(t('loans.created'));
          onClose();
        },
      },
    );
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('loans.add')}
      description={t('loans.addHint')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={create.isPending} onClick={save}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('loans.type')} required>
          <Select
            value={type}
            onChange={(e) => setType(e.target.value as CreateEmployeeLoan['type'])}
          >
            {EMPLOYEE_LOAN_TYPES.map((k) => (
              <option key={k} value={k}>
                {t(`loans.type.${k}`)}
              </option>
            ))}
          </Select>
        </Field>
        {/* The principal is written once and never reduced: it IS the obligation (D10). */}
        <Field label={t('loans.principal')} required>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={principal}
            onChange={(e) => setPrincipal(e.target.value)}
          />
        </Field>
        <Field label={t('loans.installmentCount')} required>
          <Input
            type="number"
            min="1"
            step="1"
            value={installmentCount}
            onChange={(e) => setInstallmentCount(e.target.value)}
          />
        </Field>
        <Field label={t('loans.firstPeriod')} required>
          <Input type="month" value={firstPeriod} onChange={(e) => setFirstPeriod(e.target.value)} />
        </Field>
        <Field label={t('loans.reason')} required>
          <Textarea rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
};
