// Lifecycle personnel actions (frozen design §8): suspension (disable-login checked by
// default — D6), reinstatement (returns to the BASE status: probation if unconfirmed, else
// active), leave start/end (manual until the Leave module drives them), and the probation
// decisions (confirm / extend / fail — nothing auto-confirms, D1).
import { useState } from 'react';
import { type EmployeeDto } from '@ecms/contracts';
import { useT } from '../../../../../../platform/localization/useT';
import { Field, Checkbox, Input, Textarea } from '../../../../../../shared/ui/form';
import { toast } from '../../../../../../shared/ui/toast/toast-store';
import { useEmploymentAction } from '../../api/employee-queries';
import { ActionDialog, useActionCommonFields } from './ActionDialog';

interface DialogProps {
  employee: EmployeeDto;
  open: boolean;
  onClose: () => void;
}

const useSubmit = (
  employee: EmployeeDto,
  onClose: () => void,
): { pending: boolean; run: (body: Parameters<ReturnType<typeof useEmploymentAction>['mutateAsync']>[0]) => Promise<void> } => {
  const t = useT();
  const action = useEmploymentAction(employee.id);
  return {
    pending: action.isPending,
    run: async (body) => {
      try {
        await action.mutateAsync(body);
        toast.success(t('employees.actions.done'));
        onClose();
      } catch {
        // surfaced globally
      }
    },
  };
};

export const SuspendDialog = ({ employee, open, onClose }: DialogProps): JSX.Element | null => {
  const t = useT();
  const { fields, common } = useActionCommonFields();
  const [reason, setReason] = useState('');
  const [disableLogin, setDisableLogin] = useState(true);
  const { pending, run } = useSubmit(employee, onClose);

  return (
    <ActionDialog
      open={open}
      onClose={onClose}
      title={t('employees.actions.suspend.title')}
      submitting={pending}
      danger
      onSubmit={() => {
        if (reason.trim() === '') {
          toast.error(t('employees.actions.reasonRequired'));
          return;
        }
        void run({
          type: 'suspend',
          reason: reason.trim(),
          disableLogin,
          version: employee.version,
          ...common,
        });
      }}
    >
      <Field label={t('employees.actions.reason')} required>
        <Textarea rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      {employee.userId !== null && (
        <Checkbox
          checked={disableLogin}
          onChange={(e) => setDisableLogin(e.target.checked)}
          label={t('employees.actions.suspend.disableLogin')}
        />
      )}
      {fields}
    </ActionDialog>
  );
};

export const ReinstateDialog = ({ employee, open, onClose }: DialogProps): JSX.Element | null => {
  const t = useT();
  const { fields, common } = useActionCommonFields();
  const [enableLogin, setEnableLogin] = useState(true);
  const { pending, run } = useSubmit(employee, onClose);

  return (
    <ActionDialog
      open={open}
      onClose={onClose}
      title={t('employees.actions.reinstate.title')}
      description={t('employees.actions.reinstate.baseHint')}
      submitting={pending}
      onSubmit={() =>
        void run({ type: 'reinstate', enableLogin, version: employee.version, ...common })
      }
    >
      {employee.userId !== null && (
        <Checkbox
          checked={enableLogin}
          onChange={(e) => setEnableLogin(e.target.checked)}
          label={t('employees.actions.reinstate.enableLogin')}
        />
      )}
      {fields}
    </ActionDialog>
  );
};

// LeaveStart/LeaveEnd dialogs were REMOVED: the Leave module owns absence now (Employee
// design F6 / Leave design §11). The engine's leaveStart/leaveEnd actions remain server-side.

export const ProbationConfirmDialog = ({ employee, open, onClose }: DialogProps): JSX.Element | null => {
  const t = useT();
  const { fields, common } = useActionCommonFields();
  const { pending, run } = useSubmit(employee, onClose);

  return (
    <ActionDialog
      open={open}
      onClose={onClose}
      title={t('employees.actions.probationConfirm.title')}
      description={t('employees.actions.probationConfirm.body')}
      submitting={pending}
      onSubmit={() => void run({ type: 'probationConfirm', version: employee.version, ...common })}
    >
      {fields}
    </ActionDialog>
  );
};

export const ProbationExtendDialog = ({ employee, open, onClose }: DialogProps): JSX.Element | null => {
  const t = useT();
  const { fields, common } = useActionCommonFields();
  const [newEndDate, setNewEndDate] = useState('');
  const [reason, setReason] = useState('');
  const { pending, run } = useSubmit(employee, onClose);

  return (
    <ActionDialog
      open={open}
      onClose={onClose}
      title={t('employees.actions.probationExtend.title')}
      submitting={pending}
      onSubmit={() => {
        if (newEndDate === '') {
          toast.error(t('employees.actions.probationExtend.dateRequired'));
          return;
        }
        void run({
          type: 'probationExtend',
          newEndDate: new Date(newEndDate),
          ...(reason.trim() === '' ? {} : { reason: reason.trim() }),
          version: employee.version,
          ...common,
        });
      }}
    >
      <Field label={t('employees.actions.probationExtend.newEnd')} required>
        <Input type="date" value={newEndDate} onChange={(e) => setNewEndDate(e.target.value)} />
      </Field>
      <Field label={t('employees.actions.reason')} hint={t('offers.form.optional')}>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
      </Field>
      {fields}
    </ActionDialog>
  );
};

export const ProbationFailDialog = ({ employee, open, onClose }: DialogProps): JSX.Element | null => {
  const t = useT();
  const { fields, common } = useActionCommonFields();
  const [reason, setReason] = useState('');
  const [eligibleForRehire, setEligibleForRehire] = useState(false);
  const { pending, run } = useSubmit(employee, onClose);

  return (
    <ActionDialog
      open={open}
      onClose={onClose}
      title={t('employees.actions.probationFail.title')}
      description={t('employees.actions.probationFail.body')}
      submitting={pending}
      danger
      onSubmit={() => {
        if (reason.trim() === '') {
          toast.error(t('employees.actions.reasonRequired'));
          return;
        }
        void run({
          type: 'probationFail',
          reason: reason.trim(),
          eligibleForRehire,
          version: employee.version,
          ...common,
        });
      }}
    >
      <Field label={t('employees.actions.reason')} required>
        <Textarea rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <Checkbox
        checked={eligibleForRehire}
        onChange={(e) => setEligibleForRehire(e.target.checked)}
        label={t('employees.actions.exit.eligibleForRehire')}
      />
      {fields}
    </ActionDialog>
  );
};
