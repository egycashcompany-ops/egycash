// The employee profile's additive Leave tab (frozen design §11 / Employee design F6):
// balances + request history for the subject employee, HR balance adjustment, and on-behalf
// filing (the subject is known here). Default export — the profile hub lazy-loads it so the
// employees chunk stays leave-free.
import { lazy, useState } from 'react';
import { type EmployeeDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { Button, EmptyState } from '../../../../shared/ui';
import { Dialog } from '../../../../shared/ui/Dialog';
import { Field, Input, Select, Textarea } from '../../../../shared/ui/form';
import { Can } from '../../../../platform/rbac/Can';
import { useAdjustLeaveBalance, useLeaveRequests, useLeaveTypes } from '../api/leave-queries';
import { BalanceCards } from './BalanceCards';
import { RequestsTable } from './RequestsTable';

const RequestLeaveDialogLazy = lazy(() =>
  import('./RequestLeaveDialog').then((m) => ({ default: m.RequestLeaveDialog })),
);

const AdjustDialog = ({ employeeId, onClose }: { employeeId: string; onClose: () => void }): JSX.Element => {
  const t = useT();
  const { data: types } = useLeaveTypes();
  const adjust = useAdjustLeaveBalance();
  const [typeId, setTypeId] = useState('');
  const [days, setDays] = useState('');
  const [reason, setReason] = useState('');
  const banked = (types ?? []).filter((x) => x.balanceSource === 'self');
  const year = new Date().getUTCFullYear();

  const submit = (): void => {
    const d = Number(days);
    if (typeId === '' || Number.isNaN(d) || d === 0 || reason.trim().length < 3) return;
    adjust.mutate({ employeeId, body: { typeId, year, days: d, reason: reason.trim() } }, { onSuccess: onClose });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('leave.adjust.title')}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={submit} loading={adjust.isPending}>{t('common.save')}</Button>
        </div>
      }
    >
      <div className="space-y-3">
        <Field label={t('leave.request.type')}>
          <Select value={typeId} onChange={(e) => setTypeId(e.target.value)}>
            <option value="">{t('leave.request.selectType')}</option>
            {banked.map((x) => (
              <option key={x.id} value={x.id}>{x.name.ar}</option>
            ))}
          </Select>
        </Field>
        <Field label={t('leave.adjust.days')}>
          <Input type="number" step="0.5" value={days} onChange={(e) => setDays(e.target.value)} />
        </Field>
        <Field label={t('leave.adjust.reason')}>
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {adjust.isError && <p className="text-sm text-red-600">{(adjust.error as Error).message}</p>}
      </div>
    </Dialog>
  );
};

const EmployeeLeaveTab = ({ employee }: { employee: EmployeeDto }): JSX.Element => {
  const t = useT();
  const [adjusting, setAdjusting] = useState(false);
  const [filing, setFiling] = useState(false);
  const { data, isLoading, isError, refetch } = useLeaveRequests({
    page: 1,
    pageSize: 50,
    employeeId: employee.id,
    sortBy: 'createdAt',
    sortDir: 'desc',
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t('leave.profile.balances')}</h3>
        <div className="flex gap-2">
          <Can permission="leave.requestForOthers">
            <Button size="sm" variant="secondary" onClick={() => setFiling(true)}>
              {t('leave.profile.fileOnBehalf')}
            </Button>
          </Can>
          <Can permission="leave.adjustBalances">
            <Button size="sm" variant="secondary" onClick={() => setAdjusting(true)}>
              {t('leave.adjust.title')}
            </Button>
          </Can>
        </div>
      </div>
      <BalanceCards employeeId={employee.id} />
      <h3 className="text-sm font-semibold">{t('leave.profile.history')}</h3>
      <RequestsTable
        rows={data?.items ?? []}
        loading={isLoading}
        error={isError}
        onRetry={() => void refetch()}
        empty={<EmptyState title={t('leave.profile.empty')} />}
      />
      {adjusting && <AdjustDialog employeeId={employee.id} onClose={() => setAdjusting(false)} />}
      {filing && (
        <RequestLeaveDialogLazy open={filing} onClose={() => setFiling(false)} employeeId={employee.id} onBehalf />
      )}
    </div>
  );
};

export default EmployeeLeaveTab;
