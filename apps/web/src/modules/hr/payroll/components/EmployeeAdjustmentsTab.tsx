// The employee profile's Payroll Adjustments tab (P-HR-04) — default export, lazy-loaded by the
// profile hub exactly as the Pay Items tab is, so the employees chunk stays payroll-free for
// everyone who never opens it.
//
// A bonus or a penalty is ONE amount, for ONE month, because somebody decided so — which is why
// this screen asks for a period rather than an interval, and shows no proration column: there is
// nothing to prorate. That is the whole visible difference from the Pay Items tab beside it.
//
// THE TWO-PERSON RULE IS VISIBLE HERE (D1). A draft can be edited and submitted by whoever
// recorded it; the decision belongs to somebody holding the approve key, and the server refuses it
// from the submitter even when they hold both. The buttons follow the same split so the screen
// cannot suggest an action the server will reject.
import { useState } from 'react';
import {
  type CreatePayrollAdjustment,
  type EmployeeDto,
  type Locale,
  type PayrollAdjustmentDto,
  PAYROLL_ADJUSTMENT_KINDS,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useCan } from '../../../../platform/rbac/Can';
import { useAppSelector } from '../../../../store';
import { Badge, Button, DataTable, EmptyState, type Column } from '../../../../shared/ui';
import { Dialog } from '../../../../shared/ui/Dialog';
import { Field, Input, Select, Textarea } from '../../../../shared/ui/form';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { formatMoney, localized } from '../../../../shared/lib/format';
import {
  useCancelAdjustment,
  useCreateAdjustment,
  useDecideAdjustment,
  useEmployeeAdjustments,
  useSubmitAdjustment,
} from '../api/payroll-queries';

const PAGE_SIZE = 50;

const STATUS_TONE = {
  draft: 'neutral',
  pendingApproval: 'warning',
  approved: 'success',
  cancelled: 'neutral',
} as const;

const EmployeeAdjustmentsTab = ({ employee }: { employee: EmployeeDto }): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [adding, setAdding] = useState(false);

  const rows = useEmployeeAdjustments(employee.id, {
    page: 1,
    pageSize: PAGE_SIZE,
    sortBy: 'period',
    sortDir: 'desc',
  });
  const submit = useSubmitAdjustment(employee.id);
  const decide = useDecideAdjustment(employee.id);
  const cancel = useCancelAdjustment(employee.id);

  const canRecord = can('payrollAdjustment.create');
  const canApprove = can('payrollAdjustment.approve');

  const onSubmit = (row: PayrollAdjustmentDto): void => {
    submit.mutate(
      { id: row.id, version: row.version },
      { onSuccess: () => toast.success(t('payroll.adjustments.submitted')) },
    );
  };
  const onDecide = (row: PayrollAdjustmentDto, decision: 'approved' | 'rejected'): void => {
    decide.mutate(
      { id: row.id, body: { decision, version: row.version } },
      { onSuccess: () => toast.success(t(`payroll.adjustments.${decision}`)) },
    );
  };
  const onCancel = (row: PayrollAdjustmentDto): void => {
    const reason = window.prompt(t('payroll.adjustments.cancelReason'));
    if (reason === null || reason.trim() === '') return;
    cancel.mutate(
      { id: row.id, body: { reason: reason.trim(), version: row.version } },
      { onSuccess: () => toast.success(t('payroll.adjustments.cancelled')) },
    );
  };

  const columns: Column<PayrollAdjustmentDto>[] = [
    { key: 'period', header: t('payroll.adjustments.period'), render: (r) => r.period },
    {
      key: 'kind',
      header: t('payroll.adjustments.kind'),
      render: (r) => t(`payroll.adjustments.kind.${r.kind}`),
    },
    {
      key: 'amount',
      header: t('payroll.adjustments.amount'),
      render: (r) => formatMoney(r.amount, r.currency, locale),
    },
    {
      key: 'name',
      header: t('payroll.adjustments.item'),
      // D4 — the catalog item lends its name when one was chosen; otherwise the reason speaks.
      render: (r) => (r.payItem === null ? r.reason : localized(r.payItem.name, locale)),
    },
    {
      key: 'status',
      header: t('common.status'),
      render: (r) => (
        <Badge tone={STATUS_TONE[r.status]}>{t(`payroll.adjustments.status.${r.status}`)}</Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (r) => (
        <div className="flex gap-1">
          {r.status === 'draft' && canRecord && (
            <Button size="sm" variant="ghost" onClick={() => onSubmit(r)}>
              {t('payroll.adjustments.submit')}
            </Button>
          )}
          {r.status === 'pendingApproval' && canApprove && (
            <>
              <Button size="sm" variant="ghost" onClick={() => onDecide(r, 'approved')}>
                {t('payroll.adjustments.approve')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onDecide(r, 'rejected')}>
                {t('payroll.adjustments.reject')}
              </Button>
            </>
          )}
          {r.status !== 'cancelled' && canRecord && (
            <Button size="sm" variant="danger" onClick={() => onCancel(r)}>
              {t('common.cancel')}
            </Button>
          )}
        </div>
      ),
    },
  ];

  const items = rows.data?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{t('payroll.adjustments.hint')}</p>
        {canRecord && <Button size="sm" onClick={() => setAdding(true)}>{t('payroll.adjustments.add')}</Button>}
      </div>

      {items.length === 0 && !rows.isLoading ? (
        <EmptyState title={t('payroll.adjustments.empty')} />
      ) : (
        <DataTable
          columns={columns}
          rows={items}
          rowKey={(r) => r.id}
          loading={rows.isLoading}
          error={rows.isError ? rows.error : undefined}
          onRetry={() => void rows.refetch()}
        />
      )}

      {adding && (
        <AddAdjustmentDialog employee={employee} onClose={() => setAdding(false)} />
      )}
    </div>
  );
};

const AddAdjustmentDialog = ({
  employee,
  onClose,
}: {
  employee: EmployeeDto;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const create = useCreateAdjustment(employee.id);
  const [period, setPeriod] = useState('');
  const [kind, setKind] = useState<CreatePayrollAdjustment['kind']>('bonus');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');

  const save = (): void => {
    create.mutate(
      {
        period,
        kind,
        amount: Number(amount),
        currency: employee.employment.salary?.currency ?? 'EGP',
        reason: reason.trim(),
      },
      {
        onSuccess: () => {
          toast.success(t('payroll.adjustments.created'));
          onClose();
        },
      },
    );
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('payroll.adjustments.add')}
      description={t('payroll.adjustments.addHint')}
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
        {/* A month, not an interval — that is what "one-off" means here (D5). */}
        <Field label={t('payroll.adjustments.period')} required>
          <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
        </Field>
        <Field label={t('payroll.adjustments.kind')} required>
          <Select
            value={kind}
            onChange={(e) => setKind(e.target.value as CreatePayrollAdjustment['kind'])}
          >
            {PAYROLL_ADJUSTMENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`payroll.adjustments.kind.${k}`)}
              </option>
            ))}
          </Select>
        </Field>
        {/* Always positive — the kind carries the sign, which is why there is no minus here. */}
        <Field label={t('payroll.adjustments.amount')} required>
          <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label={t('payroll.adjustments.reason')} required>
          <Textarea rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
};

export default EmployeeAdjustmentsTab;
