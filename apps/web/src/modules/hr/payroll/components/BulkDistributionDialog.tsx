// One decision, recorded for many people at once (P-HR-13) — a distribution.
//
// WHAT THIS SCREEN IS FOR. Finance decides each person's amount OUTSIDE this system — profit
// sharing is the case it was built for — and this records the result. So there is no pool, no
// formula, no percentage and no eligibility rule anywhere here: **the amounts are typed in, never
// computed.** A field that offered to work one out would be a financial rule nobody has given.
//
// WHY IT LIVES ON THE ADJUSTMENTS SURFACE. A distribution is N payroll adjustments, which is why it
// needs no new entity, no new permission and no new approval: every row lands as a `draft` and the
// second person's key still stands between it and any money.
//
// THE PERIOD AND THE PAY ITEM ARE CHOSEN ONCE, for the batch — a batch spanning months would be two
// decisions wearing one name. The CURRENCY is chosen nowhere: the server derives it from each
// employee's own basic salary, because the engine refuses an adjustment in any other.
import { useState } from 'react';
import {
  type BulkCreatePayrollAdjustmentsResultDto,
  type EmployeeDto,
  type Locale,
} from '@ecms/contracts';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { Button, DataTable, EmptyState, type Column } from '../../../../shared/ui';
import { Dialog } from '../../../../shared/ui/Dialog';
import { Field, Input, Select } from '../../../../shared/ui/form';
import { SearchInput } from '../../../../shared/ui/SearchInput';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { formatNumber, localized } from '../../../../shared/lib/format';
import { listEmployees } from '../../employee-management/employees/api/employee-api';
import { usePayItems, useBulkCreateAdjustments } from '../api/payroll-queries';

const MAX_ROWS = 5000;

/** The Arabic name is the one every employee has; the English one is optional (P-HR-06 / D7). */
const employeeName = (employee: EmployeeDto, locale: Locale): string =>
  locale === 'ar'
    ? employee.personal.fullNameAr
    : (employee.personal.fullNameEn ?? employee.personal.fullNameAr);

interface DraftRow {
  key: string;
  employee: EmployeeDto;
  amount: string;
  reason: string;
}

/** Search, never load-all (ADR-019) — the same shape the contract screen's picker uses. */
const EmployeeSearch = ({ onPick }: { onPick: (employee: EmployeeDto) => void }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [search, setSearch] = useState('');
  const results = useQuery({
    queryKey: ['hr', 'payroll', 'bulkEmployeeSearch', search],
    queryFn: () => listEmployees({ search, pageSize: 20 }),
    enabled: search.trim() !== '',
  });

  return (
    <div className="space-y-2">
      <SearchInput value={search} onChange={setSearch} placeholder={t('payroll.bulk.searchEmployee')} />
      {search.trim() !== '' && (
        <ul className="max-h-40 overflow-y-auto rounded border border-slate-200 text-sm dark:border-slate-700">
          {(results.data?.items ?? []).map((employee) => (
            <li key={employee.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between px-3 py-2 text-start hover:bg-slate-50 dark:hover:bg-slate-800"
                onClick={() => {
                  onPick(employee);
                  setSearch('');
                }}
              >
                <span>{employeeName(employee, locale)}</span>
                <span className="font-mono text-xs text-slate-400" dir="ltr">
                  {employee.code}
                </span>
              </button>
            </li>
          ))}
          {(results.data?.items ?? []).length === 0 && (
            <li className="px-3 py-2 text-sm text-slate-400">{t('payroll.bulk.noEmployees')}</li>
          )}
        </ul>
      )}
    </div>
  );
};

export const BulkDistributionDialog = ({ onClose }: { onClose: () => void }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [period, setPeriod] = useState('');
  const [payItemId, setPayItemId] = useState('');
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [result, setResult] = useState<BulkCreatePayrollAdjustmentsResultDto | null>(null);

  // Only what the server will accept: an active EARNING item. Offering a deduction would be
  // offering a refusal.
  const items = usePayItems({ page: 1, pageSize: 100, kind: 'earning', status: 'active' });
  const submit = useBulkCreateAdjustments();

  const periodValid = /^\d{4}-(0[1-9]|1[0-2])$/.test(period);
  const complete = rows.filter((row) => Number(row.amount) > 0 && row.reason.trim() !== '');
  const ready =
    periodValid && payItemId !== '' && complete.length === rows.length && rows.length > 0;

  const columns: Column<DraftRow>[] = [
    {
      key: 'employee',
      header: t('payroll.bulk.employee'),
      render: (row) => (
        <span className="flex flex-col">
          <span>{employeeName(row.employee, locale)}</span>
          <span className="font-mono text-xs text-slate-400" dir="ltr">
            {row.employee.code}
          </span>
        </span>
      ),
    },
    {
      key: 'amount',
      header: t('payroll.bulk.amount'),
      render: (row) => (
        <Input
          type="number"
          min="0"
          value={row.amount}
          onChange={(e) => setRows((all) => all.map((r) => (r.key === row.key ? { ...r, amount: e.target.value } : r)))}
        />
      ),
    },
    {
      key: 'currency',
      header: t('payroll.bulk.currency'),
      // Read-only, and from the employee's own salary — the server derives the same value, so a
      // field the user could type would only be a way to disagree with it.
      render: (row) => (
        <span className="font-mono text-xs text-slate-500" dir="ltr">
          {row.employee.employment.salary?.currency ?? '—'}
        </span>
      ),
    },
    {
      key: 'reason',
      header: t('payroll.bulk.reason'),
      render: (row) => (
        <Input
          value={row.reason}
          onChange={(e) => setRows((all) => all.map((r) => (r.key === row.key ? { ...r, reason: e.target.value } : r)))}
        />
      ),
    },
    {
      key: 'remove',
      header: '',
      render: (row) => (
        <button
          type="button"
          className="text-xs text-slate-500 underline-offset-2 hover:underline"
          onClick={() => setRows((all) => all.filter((r) => r.key !== row.key))}
        >
          {t('common.remove')}
        </button>
      ),
    },
  ];

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('payroll.bulk.title')}
      footer={
        <div className="flex justify-between gap-2">
          <Button
            disabled={!ready}
            loading={submit.isPending}
            onClick={() =>
              submit.mutate(
                {
                  period,
                  payItemId,
                  rows: rows.map((row) => ({
                    employeeId: row.employee.id,
                    amount: Number(row.amount),
                    reason: row.reason.trim(),
                  })),
                },
                {
                  onSuccess: (data) => {
                    setResult(data);
                    setRows([]);
                    toast.success(
                      t('payroll.bulk.recorded', { count: formatNumber(data.created, locale) }),
                    );
                  },
                },
              )
            }
          >
            {t('payroll.bulk.submit')}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            {t('common.close')}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-slate-500">{t('payroll.bulk.hint')}</p>

        {/* Chosen once for the whole batch — never per row. */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('payroll.bulk.period')}>
            <Input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="2025-08" dir="ltr" />
          </Field>
          <Field label={t('payroll.bulk.payItem')}>
            <Select value={payItemId} onChange={(e) => setPayItemId(e.target.value)}>
              <option value="">{t('payroll.bulk.choosePayItem')}</option>
              {(items.data?.items ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {`${item.code} — ${localized(item.name, locale)}`}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <EmployeeSearch
          onPick={(employee) =>
            setRows((all) =>
              all.length >= MAX_ROWS || all.some((row) => row.employee.id === employee.id)
                ? all
                : [...all, { key: employee.id, employee, amount: '', reason: '' }],
            )
          }
        />

        {/* The review step: every row is visible and editable before anything is sent. */}
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.key}
          empty={<EmptyState title={t('payroll.bulk.empty')} />}
        />

        {/* The account of the pass — created, duplicates, and every refusal with its reason. */}
        {result !== null && (
          <div
            role="status"
            className="space-y-1 rounded border border-slate-200 px-3 py-2 text-xs text-slate-500 dark:border-slate-700"
          >
            <p>
              {t('payroll.bulk.result', {
                created: formatNumber(result.created, locale),
                duplicates: formatNumber(result.duplicates, locale),
                rejected: formatNumber(result.rejected.length, locale),
              })}
            </p>
            {result.rejected.map((row) => (
              <p key={`${String(row.index)}-${row.employeeId}`} className="text-amber-700 dark:text-amber-400">
                {t('payroll.bulk.rejectedRow', {
                  index: formatNumber(row.index + 1, locale),
                  employeeId: row.employeeId,
                  reason: row.reason,
                })}
              </p>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
};
