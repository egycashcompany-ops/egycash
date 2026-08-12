// Shifts catalog (AT-1, frozen design v1.1 §10 screen 3a) — the "meant to be" patterns.
// A shift DEACTIVATES rather than deletes: assignments and day records reference it forever.
import { useState } from 'react';
import { type ShiftDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { Badge, Button, DataTable, Dialog, type Column } from '../../../../shared/ui';
import { Field, Input, Checkbox } from '../../../../shared/ui/form';
import { PlusIcon } from '../../../../shared/ui/icons';
import { useCreateShift, useShifts, useUpdateShift } from '../api/attendance-queries';

const EMPTY_FORM = {
  code: '',
  nameAr: '',
  nameEn: '',
  startTime: '09:00',
  endTime: '17:00',
  crossesMidnight: false,
  breakMinutes: '0',
  graceInMinutes: '0',
  graceOutMinutes: '0',
};

export const ShiftsPage = (): JSX.Element => {
  const t = useT();
  const { data, isLoading, isError, error, refetch } = useShifts();
  const create = useCreateShift();
  const update = useUpdateShift();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const set = (name: keyof typeof EMPTY_FORM, value: string | boolean): void =>
    setForm((f) => ({ ...f, [name]: value }));

  const columns: Column<ShiftDto>[] = [
    {
      key: 'code',
      header: t('attendance.shifts.code'),
      render: (s) => <span className="font-mono text-xs" dir="ltr">{s.code}</span>,
    },
    { key: 'name', header: t('attendance.shifts.name'), render: (s) => `${s.name.ar} / ${s.name.en}` },
    {
      key: 'times',
      header: t('attendance.shifts.times'),
      render: (s) => (
        <span dir="ltr">
          {s.startTime}–{s.endTime}
          {s.crossesMidnight ? ' +1' : ''}
        </span>
      ),
    },
    {
      key: 'grace',
      header: t('attendance.shifts.grace'),
      render: (s) => <span dir="ltr">{s.graceInMinutes} / {s.graceOutMinutes}</span>,
    },
    {
      key: 'active',
      header: t('attendance.shifts.active'),
      render: (s) =>
        s.active ? (
          <Badge tone="success">{t('attendance.shifts.statusActive')}</Badge>
        ) : (
          <Badge tone="neutral">{t('attendance.shifts.statusInactive')}</Badge>
        ),
    },
    {
      key: 'actions',
      header: '',
      align: 'end',
      render: (s) =>
        s.active ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => update.mutate({ id: s.id, body: { active: false, version: s.version } })}
          >
            {t('attendance.shifts.deactivate')}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => update.mutate({ id: s.id, body: { active: true, version: s.version } })}
          >
            {t('attendance.shifts.activate')}
          </Button>
        ),
    },
  ];

  const submit = (): void => {
    if (form.code.trim() === '' || form.nameAr.trim() === '' || form.nameEn.trim() === '') return;
    create.mutate(
      {
        code: form.code.trim().toUpperCase(),
        name: { ar: form.nameAr.trim(), en: form.nameEn.trim() },
        startTime: form.startTime,
        endTime: form.endTime,
        crossesMidnight: form.crossesMidnight,
        breakMinutes: Number(form.breakMinutes) || 0,
        graceInMinutes: Number(form.graceInMinutes) || 0,
        graceOutMinutes: Number(form.graceOutMinutes) || 0,
        minMinutesForFullDay: 0,
        minMinutesForHalfDay: 0,
        active: true,
        sortOrder: 0,
      },
      {
        onSuccess: () => {
          setAdding(false);
          setForm(EMPTY_FORM);
        },
      },
    );
  };

  return (
    <PageContainer>
      <PageHeader
        title={t('attendance.shifts.title')}
        description={t('attendance.shifts.subtitle')}
        actions={
          <Button size="sm" leftIcon={<PlusIcon className="h-4 w-4" />} onClick={() => setAdding(true)}>
            {t('attendance.shifts.add')}
          </Button>
        }
      />
      <DataTable
        columns={columns}
        rows={data ?? []}
        rowKey={(s) => s.id}
        loading={isLoading}
        error={isError ? error : undefined}
        onRetry={() => void refetch()}
      />
      <Dialog
        open={adding}
        onClose={() => setAdding(false)}
        title={t('attendance.shifts.add')}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAdding(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={submit} loading={create.isPending}>
              {t('common.save')}
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <Field label={t('attendance.shifts.code')}>
            <Input dir="ltr" value={form.code} onChange={(e) => set('code', e.target.value)} />
          </Field>
          <Field label={t('attendance.shifts.nameAr')}>
            <Input value={form.nameAr} onChange={(e) => set('nameAr', e.target.value)} />
          </Field>
          <Field label={t('attendance.shifts.nameEn')}>
            <Input dir="ltr" value={form.nameEn} onChange={(e) => set('nameEn', e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('attendance.shifts.startTime')}>
              <Input type="time" value={form.startTime} onChange={(e) => set('startTime', e.target.value)} />
            </Field>
            <Field label={t('attendance.shifts.endTime')}>
              <Input type="time" value={form.endTime} onChange={(e) => set('endTime', e.target.value)} />
            </Field>
          </div>
          <Checkbox
            checked={form.crossesMidnight}
            onChange={(e) => set('crossesMidnight', e.target.checked)}
            label={t('attendance.shifts.crossesMidnight')}
          />
          <div className="grid grid-cols-3 gap-3">
            <Field label={t('attendance.shifts.breakMinutes')}>
              <Input type="number" min={0} dir="ltr" value={form.breakMinutes} onChange={(e) => set('breakMinutes', e.target.value)} />
            </Field>
            <Field label={t('attendance.shifts.graceIn')}>
              <Input type="number" min={0} dir="ltr" value={form.graceInMinutes} onChange={(e) => set('graceInMinutes', e.target.value)} />
            </Field>
            <Field label={t('attendance.shifts.graceOut')}>
              <Input type="number" min={0} dir="ltr" value={form.graceOutMinutes} onChange={(e) => set('graceOutMinutes', e.target.value)} />
            </Field>
          </div>
          {create.isError && <p className="text-sm text-red-600">{(create.error as Error).message}</p>}
        </div>
      </Dialog>
    </PageContainer>
  );
};
