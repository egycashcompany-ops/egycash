// Shift assignments (AT-1, frozen design v1.1 §10 screen 3b). One OPEN interval per employee is
// the standing assignment; a bounded interval — down to one day — is an override that wins over
// it (D2). Ending or correcting is a delete + a new row: assignment history stays whole.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { type ShiftAssignmentDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { Button, DataTable, Dialog, Pagination, type Column } from '../../../../shared/ui';
import { Field, Input, Select } from '../../../../shared/ui/form';
import { SearchInput } from '../../../../shared/ui/SearchInput';
import { Spinner } from '../../../../shared/ui/Spinner';
import { PlusIcon } from '../../../../shared/ui/icons';
import { formatDate } from '../../../../shared/lib/format';
import { useAppSelector } from '../../../../store';
import { listKey } from '../../../../shared/lib/query-keys';
import * as api from '../api/attendance-api';
import {
  useCreateShiftAssignment,
  useRemoveShiftAssignment,
  useShiftAssignments,
  useShifts,
} from '../api/attendance-queries';

export const AssignmentsPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  const [page, setPage] = useState(1);
  const assignments = useShiftAssignments({ page, pageSize: 25 });
  const shifts = useShifts();
  const create = useCreateShiftAssignment();
  const remove = useRemoveShiftAssignment();

  const [adding, setAdding] = useState(false);
  const [employeeId, setEmployeeId] = useState('');
  const [employeeLabel, setEmployeeLabel] = useState('');
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [shiftId, setShiftId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const search = useQuery({
    queryKey: listKey('hr', 'attendanceEmployeeSearch', employeeSearch),
    queryFn: () => api.searchEmployees(employeeSearch),
    enabled: employeeSearch.trim() !== '',
    staleTime: 30_000,
  });

  const shiftName = (id: string): string => {
    const shift = (shifts.data ?? []).find((s) => s.id === id);
    return shift === undefined ? id : `${shift.code}`;
  };

  const columns: Column<ShiftAssignmentDto>[] = [
    {
      key: 'employee',
      header: t('attendance.assignments.employee'),
      render: (a) => <span className="font-mono text-xs" dir="ltr">{a.employeeId}</span>,
    },
    {
      key: 'shift',
      header: t('attendance.assignments.shift'),
      render: (a) => <span className="font-mono text-xs" dir="ltr">{shiftName(a.shiftId)}</span>,
    },
    {
      key: 'from',
      header: t('attendance.assignments.from'),
      render: (a) => <span dir="ltr">{formatDate(a.fromDate, locale)}</span>,
    },
    {
      key: 'to',
      header: t('attendance.assignments.to'),
      render: (a) =>
        a.toDate === null ? (
          <span className="text-slate-400">{t('attendance.assignments.open')}</span>
        ) : (
          <span dir="ltr">{formatDate(a.toDate, locale)}</span>
        ),
    },
    {
      key: 'actions',
      header: '',
      align: 'end',
      render: (a) => (
        <Button size="sm" variant="danger" onClick={() => remove.mutate(a.id)}>
          {t('common.delete')}
        </Button>
      ),
    },
  ];

  const submit = (): void => {
    if (employeeId === '' || shiftId === '' || fromDate === '') return;
    create.mutate(
      {
        employeeId,
        shiftId,
        fromDate: new Date(fromDate),
        ...(toDate === '' ? {} : { toDate: new Date(toDate) }),
      },
      {
        onSuccess: () => {
          setAdding(false);
          setEmployeeId('');
          setEmployeeLabel('');
          setEmployeeSearch('');
          setShiftId('');
          setFromDate('');
          setToDate('');
        },
      },
    );
  };

  return (
    <PageContainer>
      <PageHeader
        title={t('attendance.assignments.title')}
        description={t('attendance.assignments.subtitle')}
        actions={
          <Button size="sm" leftIcon={<PlusIcon className="h-4 w-4" />} onClick={() => setAdding(true)}>
            {t('attendance.assignments.add')}
          </Button>
        }
      />
      <DataTable
        columns={columns}
        rows={assignments.data?.items ?? []}
        rowKey={(a) => a.id}
        loading={assignments.isLoading}
        error={assignments.isError ? assignments.error : undefined}
        onRetry={() => void assignments.refetch()}
      />
      {assignments.data !== undefined && (
        <Pagination meta={assignments.data.meta} onPageChange={setPage} />
      )}
      <Dialog
        open={adding}
        onClose={() => setAdding(false)}
        title={t('attendance.assignments.add')}
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
          <Field label={t('attendance.assignments.employee')}>
            <div className="space-y-2">
              {employeeId !== '' && (
                <p className="text-sm font-medium text-brand-700 dark:text-brand-300">
                  {employeeLabel}
                </p>
              )}
              <SearchInput
                value={employeeSearch}
                onChange={setEmployeeSearch}
                placeholder={t('attendance.assignments.searchEmployee')}
              />
              {employeeSearch.trim() !== '' &&
                (search.isPending ? (
                  <div className="grid place-items-center p-2">
                    <Spinner />
                  </div>
                ) : (
                  <ul className="max-h-40 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                    {(search.data?.items ?? []).map((employee) => (
                      <li key={employee.id}>
                        <button
                          type="button"
                          className="flex w-full items-center justify-between px-3 py-2 text-start text-sm hover:bg-slate-50 dark:hover:bg-slate-800/60"
                          onClick={() => {
                            setEmployeeId(employee.id);
                            setEmployeeLabel(
                              `${employee.personal.fullNameAr} (${employee.code})`,
                            );
                            setEmployeeSearch('');
                          }}
                        >
                          <span>{employee.personal.fullNameAr}</span>
                          <span className="font-mono text-xs text-slate-500" dir="ltr">
                            {employee.code}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ))}
            </div>
          </Field>
          <Field label={t('attendance.assignments.shift')}>
            <Select value={shiftId} onChange={(e) => setShiftId(e.target.value)}>
              <option value="">{t('attendance.assignments.pickShift')}</option>
              {(shifts.data ?? [])
                .filter((s) => s.active)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} — {locale === 'ar' ? s.name.ar : s.name.en}
                  </option>
                ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('attendance.assignments.from')}>
              <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </Field>
            <Field label={t('attendance.assignments.toOptional')}>
              <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </Field>
          </div>
          {create.isError && (
            <p className="text-sm text-red-600">{(create.error as Error).message}</p>
          )}
        </div>
      </Dialog>
    </PageContainer>
  );
};
