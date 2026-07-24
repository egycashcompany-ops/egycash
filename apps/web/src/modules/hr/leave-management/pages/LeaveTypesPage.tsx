// Leave Types administration (frozen design §11). The catalog is law-as-data: the most
// operational knobs are editable here (name/active/notice/backdate/caps/approval shape/
// carryover); structural fields (pay model, balance source, counting mode) display read-only
// — they are seed-time decisions that would rewrite history semantics if flipped casually.
import { useState } from 'react';
import { type LeaveTypeDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { Badge, Button, DataTable, Dialog, type Column } from '../../../../shared/ui';
import { Checkbox, Field, Input, Select } from '../../../../shared/ui/form';
import { useLeaveTypes, useUpdateLeaveType } from '../api/leave-queries';

const num = (v: string): number | null => (v.trim() === '' ? null : Number(v));

export const LeaveTypesPage = (): JSX.Element => {
  const t = useT();
  const { data, isLoading, isError, refetch } = useLeaveTypes();
  const update = useUpdateLeaveType();
  const [editing, setEditing] = useState<LeaveTypeDto | null>(null);
  const [form, setForm] = useState({
    active: true,
    minNoticeDays: '0',
    backdateDays: '0',
    maxPerYearDays: '',
    maxPerOccasionDays: '',
    approvalShape: 'managerOnly',
    carryoverMode: 'carryAll',
    carryoverCapDays: '',
  });

  const openEdit = (x: LeaveTypeDto): void => {
    setEditing(x);
    setForm({
      active: x.active,
      minNoticeDays: String(x.minNoticeDays),
      backdateDays: String(x.backdateDays),
      maxPerYearDays: x.maxPerYearDays === null ? '' : String(x.maxPerYearDays),
      maxPerOccasionDays: x.maxPerOccasionDays === null ? '' : String(x.maxPerOccasionDays),
      approvalShape: x.approvalShape,
      carryoverMode: x.carryoverMode,
      carryoverCapDays: x.carryoverCapDays === null ? '' : String(x.carryoverCapDays),
    });
  };

  const save = (): void => {
    if (editing === null) return;
    update.mutate(
      {
        id: editing.id,
        body: {
          active: form.active,
          minNoticeDays: Number(form.minNoticeDays) || 0,
          backdateDays: Number(form.backdateDays) || 0,
          maxPerYearDays: num(form.maxPerYearDays),
          maxPerOccasionDays: num(form.maxPerOccasionDays),
          approvalShape: form.approvalShape as LeaveTypeDto['approvalShape'],
          carryoverMode: form.carryoverMode as LeaveTypeDto['carryoverMode'],
          carryoverCapDays: num(form.carryoverCapDays),
          version: editing.version,
        },
      },
      { onSuccess: () => setEditing(null) },
    );
  };

  const columns: Column<LeaveTypeDto>[] = [
    { key: 'code', header: t('leave.types.code'), render: (x) => <span className="font-mono text-xs">{x.code}</span> },
    { key: 'name', header: t('leave.types.name'), render: (x) => x.name.ar },
    {
      key: 'policy',
      header: t('leave.types.policy'),
      render: (x) => (
        <span className="text-xs text-slate-500">
          {t(`leave.payModel.${x.payModel}`)} · {t(`leave.counting.${x.countingMode}`)} ·{' '}
          {t(`leave.approvalShape.${x.approvalShape}`)}
          {x.affectsEmployeeStatus ? ` · ${t('leave.types.affectsStatus')}` : ''}
        </span>
      ),
    },
    {
      key: 'active',
      header: t('leave.types.active'),
      render: (x) => (
        <Badge tone={x.active ? 'success' : 'neutral'}>
          {x.active ? t('common.yes') : t('common.no')}
        </Badge>
      ),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('leave.types.title')}
        description={t('leave.types.subtitle')}
        breadcrumbs={[{ label: t('leave.module.title'), to: '/leave' }, { label: t('leave.types.title') }]}
      />
      <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
        {t('leave.types.legalNote')}
      </p>
      <DataTable
        columns={columns}
        rows={data ?? []}
        rowKey={(x) => x.id}
        loading={isLoading}
        error={isError}
        onRetry={() => void refetch()}
        onRowClick={openEdit}
      />
      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === null ? '' : `${editing.name.ar} (${editing.code})`}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditing(null)}>{t('common.cancel')}</Button>
            <Button onClick={save} loading={update.isPending}>{t('common.save')}</Button>
          </div>
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('leave.types.minNotice')}>
            <Input type="number" min="0" value={form.minNoticeDays} onChange={(e) => setForm({ ...form, minNoticeDays: e.target.value })} />
          </Field>
          <Field label={t('leave.types.backdate')}>
            <Input type="number" min="0" value={form.backdateDays} onChange={(e) => setForm({ ...form, backdateDays: e.target.value })} />
          </Field>
          <Field label={t('leave.types.maxPerYear')}>
            <Input type="number" min="0" value={form.maxPerYearDays} onChange={(e) => setForm({ ...form, maxPerYearDays: e.target.value })} />
          </Field>
          <Field label={t('leave.types.maxPerOccasion')}>
            <Input type="number" min="0" value={form.maxPerOccasionDays} onChange={(e) => setForm({ ...form, maxPerOccasionDays: e.target.value })} />
          </Field>
          <Field label={t('leave.types.approval')}>
            <Select value={form.approvalShape} onChange={(e) => setForm({ ...form, approvalShape: e.target.value })}>
              <option value="managerOnly">{t('leave.approvalShape.managerOnly')}</option>
              <option value="managerThenHr">{t('leave.approvalShape.managerThenHr')}</option>
            </Select>
          </Field>
          <Field label={t('leave.types.carryover')}>
            <Select value={form.carryoverMode} onChange={(e) => setForm({ ...form, carryoverMode: e.target.value })}>
              <option value="carryAll">{t('leave.carryover.carryAll')}</option>
              <option value="cap">{t('leave.carryover.cap')}</option>
              <option value="none">{t('leave.carryover.none')}</option>
            </Select>
          </Field>
          {form.carryoverMode === 'cap' && (
            <Field label={t('leave.types.carryoverCap')}>
              <Input type="number" min="0" value={form.carryoverCapDays} onChange={(e) => setForm({ ...form, carryoverCapDays: e.target.value })} />
            </Field>
          )}
          <div className="sm:col-span-2">
            <Checkbox
              checked={form.active}
              onChange={(e) => setForm({ ...form, active: e.target.checked })}
              label={t('leave.types.active')}
            />
          </div>
        </div>
        {update.isError && <p className="mt-2 text-sm text-red-600">{(update.error as Error).message}</p>}
      </Dialog>
    </PageContainer>
  );
};
