// Public-holidays administration (frozen design §11) — the shared work calendar's catalog.
import { useMemo, useState } from 'react';
import { type HolidayDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { Button, DataTable, Dialog, type Column } from '../../../../shared/ui';
import { Field, Input } from '../../../../shared/ui/form';
import { PlusIcon } from '../../../../shared/ui/icons';
import { formatDate } from '../../../../shared/lib/format';
import { useCreateHoliday, useDeleteHoliday, useWorkCalendar } from '../api/leave-queries';

export const HolidaysPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const year = new Date().getUTCFullYear();
  const [rangeYear, setRangeYear] = useState(year);
  const from = `${String(rangeYear)}-01-01`;
  const to = `${String(rangeYear)}-12-31`;
  const { data, isLoading, isError, refetch } = useWorkCalendar(from, to);
  const create = useCreateHoliday();
  const remove = useDeleteHoliday();
  const [adding, setAdding] = useState(false);
  const [date, setDate] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [nameEn, setNameEn] = useState('');

  const rows = useMemo(() => data?.holidays ?? [], [data]);

  const columns: Column<HolidayDto>[] = [
    { key: 'date', header: t('leave.holidays.date'), render: (h) => <span dir="ltr">{formatDate(h.date, locale)}</span> },
    { key: 'name', header: t('leave.holidays.name'), render: (h) => `${h.name.ar} / ${h.name.en}` },
    {
      key: 'actions',
      header: '',
      align: 'end',
      render: (h) => (
        <Button size="sm" variant="danger" onClick={() => remove.mutate(h.id)}>
          {t('common.delete')}
        </Button>
      ),
    },
  ];

  const submit = (): void => {
    if (date === '' || nameAr.trim() === '' || nameEn.trim() === '') return;
    create.mutate(
      { date: new Date(date), name: { ar: nameAr.trim(), en: nameEn.trim() } },
      {
        onSuccess: () => {
          setAdding(false);
          setDate('');
          setNameAr('');
          setNameEn('');
        },
      },
    );
  };

  return (
    <PageContainer>
      <PageHeader
        title={t('leave.holidays.title')}
        description={t('leave.holidays.subtitle')}
        breadcrumbs={[{ label: t('leave.module.title'), to: '/leave' }, { label: t('leave.holidays.title') }]}
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => setRangeYear(rangeYear - 1)}>←</Button>
            <span className="text-sm font-medium" dir="ltr">{rangeYear}</span>
            <Button size="sm" variant="secondary" onClick={() => setRangeYear(rangeYear + 1)}>→</Button>
            <Button size="sm" leftIcon={<PlusIcon className="h-4 w-4" />} onClick={() => setAdding(true)}>
              {t('leave.holidays.add')}
            </Button>
          </div>
        }
      />
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(h) => h.id}
        loading={isLoading}
        error={isError}
        onRetry={() => void refetch()}
      />
      <Dialog
        open={adding}
        onClose={() => setAdding(false)}
        title={t('leave.holidays.add')}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAdding(false)}>{t('common.cancel')}</Button>
            <Button onClick={submit} loading={create.isPending}>{t('common.save')}</Button>
          </div>
        }
      >
        <div className="space-y-3">
          <Field label={t('leave.holidays.date')}>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label={t('leave.holidays.nameAr')}>
            <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
          </Field>
          <Field label={t('leave.holidays.nameEn')}>
            <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
          </Field>
          {create.isError && <p className="text-sm text-red-600">{(create.error as Error).message}</p>}
        </div>
      </Dialog>
    </PageContainer>
  );
};
