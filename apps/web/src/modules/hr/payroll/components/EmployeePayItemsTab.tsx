// The employee profile's additive Pay Items tab (PY-2) — default export, lazy-loaded by the
// profile hub exactly as the Leave, Attendance and Contracts tabs are, so the employees chunk
// stays payroll-free for everyone who never opens it.
//
// It shows what each catalog item is worth to this employee and over which interval, and nothing
// else: no tax, no insurance, no attendance figure, no payroll run and no payslip — none of those
// exist in this system, and a column implying otherwise would be a claim, not a feature.
//
// Removing is deliberately not the same act twice: an assignment that has not started yet leaves,
// and one that has started is CLOSED as of today, because payroll will have to explain what it
// already paid. The server decides which happened from the dates; this screen reports it back.
import { useState } from 'react';
import {
  type CreateEmployeePayItem,
  type EmployeeDto,
  type EmployeePayItemDto,
  type Locale,
  type PayItemDto,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useCan } from '../../../../platform/rbac/Can';
import { useAppSelector } from '../../../../store';
import { Badge, Button, DataTable, EmptyState, type Column } from '../../../../shared/ui';
import { Dialog } from '../../../../shared/ui/Dialog';
import { Field, Input, Select } from '../../../../shared/ui/form';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { formatDate, formatMoney, localized } from '../../../../shared/lib/format';
import {
  useCreateEmployeePayItem,
  useEmployeePayItems,
  usePayItems,
  useRemoveEmployeePayItem,
} from '../api/payroll-queries';

const PAGE_SIZE = 50;

const EmployeePayItemsTab = ({ employee }: { employee: EmployeeDto }): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [adding, setAdding] = useState(false);

  const rows = useEmployeePayItems(employee.id, {
    page: 1,
    pageSize: PAGE_SIZE,
    sortBy: 'effectiveFrom',
    sortDir: 'desc',
  });
  const remove = useRemoveEmployeePayItem(employee.id);
  const canManage = can('employee.manageCompensation');

  const onRemove = (row: EmployeePayItemDto): void => {
    remove.mutate(row.id, {
      onSuccess: (result) => toast.success(t(`payroll.employeeItems.removed.${result.outcome}`)),
    });
  };

  const columns: Column<EmployeePayItemDto>[] = [
    {
      key: 'payItem',
      header: t('payroll.employeeItems.item'),
      render: (r) =>
        r.payItem === null ? (
          <span className="text-slate-400">—</span>
        ) : (
          <span className="flex items-center gap-2">
            <span>{localized(r.payItem.name, locale)}</span>
            <span className="font-mono text-xs text-slate-400" dir="ltr">
              {r.payItem.code}
            </span>
            <Badge tone={r.payItem.kind === 'earning' ? 'success' : 'warning'}>
              {t(`payroll.payItems.kind.${r.payItem.kind}`)}
            </Badge>
          </span>
        ),
    },
    {
      key: 'amount',
      header: t('payroll.employeeItems.amount'),
      render: (r) => (
        <span dir="ltr" className="tabular-nums">
          {formatMoney(r.amount, r.currency, locale)}
        </span>
      ),
    },
    {
      key: 'effectiveFrom',
      header: t('payroll.employeeItems.effectiveFrom'),
      render: (r) => formatDate(r.effectiveFrom, locale),
    },
    {
      key: 'effectiveTo',
      header: t('payroll.employeeItems.effectiveTo'),
      render: (r) =>
        r.effectiveTo === null ? (
          <Badge tone="neutral">{t('payroll.employeeItems.openEnded')}</Badge>
        ) : (
          formatDate(r.effectiveTo, locale)
        ),
    },
    {
      key: 'note',
      header: t('payroll.employeeItems.note'),
      render: (r) => r.note ?? '—',
    },
    {
      key: 'actions',
      header: t('payroll.employeeItems.actions'),
      render: (r) =>
        canManage ? (
          <Button size="sm" variant="ghost" onClick={() => onRemove(r)} disabled={remove.isPending}>
            {t('payroll.employeeItems.remove')}
          </Button>
        ) : (
          <span className="text-slate-300">—</span>
        ),
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-500">{t('payroll.employeeItems.hint')}</p>
        {canManage && (
          <Button size="sm" onClick={() => setAdding(true)}>
            {t('payroll.employeeItems.add')}
          </Button>
        )}
      </div>

      <DataTable
        columns={columns}
        rows={rows.data?.items ?? []}
        rowKey={(r) => r.id}
        loading={rows.isLoading}
        error={rows.isError ? rows.error : undefined}
        onRetry={() => void rows.refetch()}
        empty={
          <EmptyState
            title={t('payroll.employeeItems.empty')}
            description={t('payroll.employeeItems.emptyHint')}
          />
        }
      />

      {adding && <AddPayItemDialog employee={employee} onClose={() => setAdding(false)} />}
    </div>
  );
};

/**
 * Add one assignment.
 *
 * The catalog is read with `payItem.view`, which is a DIFFERENT key from the one that authorizes
 * this write — so a caller who manages compensation without catalog access is told exactly that,
 * rather than being shown an empty picker or having the button hidden from them. Nothing here
 * invents a permission to paper over the gap.
 */
const AddPayItemDialog = ({
  employee,
  onClose,
}: {
  employee: EmployeeDto;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const create = useCreateEmployeePayItem(employee.id);
  const canBrowseCatalog = can('payItem.view');

  const catalog = usePayItems({
    page: 1,
    pageSize: 100,
    status: 'active',
    sortBy: 'sortOrder',
    sortDir: 'asc',
  });
  const items: PayItemDto[] = canBrowseCatalog ? (catalog.data?.items ?? []) : [];

  const [payItemId, setPayItemId] = useState('');
  const [amount, setAmount] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [effectiveTo, setEffectiveTo] = useState('');
  const [note, setNote] = useState('');

  const parsedAmount = Number(amount);
  const amountValid = amount.trim() !== '' && Number.isFinite(parsedAmount) && parsedAmount > 0;
  const invalid = payItemId === '' || !amountValid || effectiveFrom === '';

  const submit = (): void => {
    if (invalid) return;
    const body = {
      payItemId,
      amount: parsedAmount,
      currency: employee.employment.salary?.currency ?? 'EGP',
      effectiveFrom,
      ...(effectiveTo === '' ? { effectiveTo: null } : { effectiveTo }),
      ...(note.trim() === '' ? {} : { note: note.trim() }),
    } as unknown as CreateEmployeePayItem;
    create.mutate(body, {
      onSuccess: () => {
        toast.success(t('payroll.employeeItems.created'));
        onClose();
      },
    });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('payroll.employeeItems.add')}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} loading={create.isPending} disabled={invalid}>
            {t('common.save')}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        {!canBrowseCatalog && (
          <p role="alert" className="text-sm text-amber-700 dark:text-amber-400">
            {t('payroll.employeeItems.needCatalog')}
          </p>
        )}
        <Field label={t('payroll.employeeItems.item')}>
          <Select
            value={payItemId}
            onChange={(e) => setPayItemId(e.target.value)}
            aria-label={t('payroll.employeeItems.item')}
          >
            <option value="">{t('payroll.employeeItems.pickItem')}</option>
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {`${localized(item.name, locale)} — ${item.code}`}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('payroll.employeeItems.amount')} hint={t('payroll.employeeItems.amountHint')}>
          <Input
            type="number"
            step="0.01"
            min="0"
            inputMode="decimal"
            dir="ltr"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-label={t('payroll.employeeItems.amount')}
          />
        </Field>
        <Field label={t('payroll.employeeItems.effectiveFrom')}>
          <Input
            type="date"
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
            aria-label={t('payroll.employeeItems.effectiveFrom')}
          />
        </Field>
        <Field
          label={t('payroll.employeeItems.effectiveTo')}
          hint={t('payroll.employeeItems.effectiveToHint')}
        >
          <Input
            type="date"
            value={effectiveTo}
            onChange={(e) => setEffectiveTo(e.target.value)}
            aria-label={t('payroll.employeeItems.effectiveTo')}
          />
        </Field>
        <Field label={t('payroll.employeeItems.note')}>
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-label={t('payroll.employeeItems.note')}
          />
        </Field>
        {create.error !== null && create.error !== undefined && (
          <p role="alert" className="text-sm text-red-600">
            {(create.error as Error).message}
          </p>
        )}
      </div>
    </Dialog>
  );
};

export default EmployeePayItemsTab;
