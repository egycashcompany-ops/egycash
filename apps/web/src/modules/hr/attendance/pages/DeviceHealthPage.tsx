// AT-D4 — «صحة أجهزة البصمة». The two facts nothing else in the product can show.
//
// WHY THIS SCREEN EXISTS, in production numbers. Seventeen machine ids on the المهندسين wall
// answer to no employee and are holding 353 scans; 306 enrolments point at people who have left.
// Neither is visible anywhere else BY CONSTRUCTION: the daily sheet is a page of EMPLOYEES, so a
// scan whose machine id maps to nobody has no line to sit on and no bucket to be counted in. The
// sheet now says how many there are; this is where they are dealt with.
//
// NOTHING IS LINKED BY GUESSING. An exact code match is SUGGESTED — machine `100052` beside ECMS
// `0100052` — and a person confirms it, because the rule is not safe on its own: machine `102815`
// belongs to `0102818`, so a screen that auto-linked by it would file one employee's attendance
// under another. The suggestion is a shortcut for the eye, never an action.
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { type AttendanceBackfillDto, type AttendanceUnmatchedIdDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { useCan } from '../../../../platform/rbac/Can';
import { Button, DataTable, Dialog, type Column } from '../../../../shared/ui';
import { Field, Input } from '../../../../shared/ui/form';
import { SearchableSelect } from '../../../../shared/ui/SearchableSelect';
import { Spinner } from '../../../../shared/ui/Spinner';
import { formatBusinessDateTime } from '../../../../shared/lib/format';
import { useAppSelector } from '../../../../store';
import { listKey } from '../../../../shared/lib/query-keys';
import * as api from '../api/attendance-api';
import {
  useAttendanceBackfills,
  useAttendanceUnmatchedIds,
  useCancelAttendanceBackfill,
  useDiscardAttendanceQuarantine,
  useLinkAttendanceEnrollment,
  useResumeAttendanceBackfill,
  useRetryAttendanceQuarantine,
} from '../api/attendance-queries';
import { useAttendanceDevices } from '../api/attendance-queries';

/**
 * The ECMS code an exact match WOULD have: the machine id with the leading zero the codes carry.
 *
 * Only ever used to look a candidate up and show it for confirmation. It is wrong often enough to
 * matter — `102815` is `0102818`'s machine — which is exactly why it suggests and never acts.
 */
const suggestedCode = (enrollmentNo: string | null): string | null =>
  enrollmentNo === null || !/^\d+$/.test(enrollmentNo) ? null : `0${enrollmentNo}`;

export const DeviceHealthPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const mayManage = can('attendanceDevice.manage');
  const mayRecompute = can('attendance.recompute');

  const unmatched = useAttendanceUnmatchedIds({ limit: 500 });
  const devices = useAttendanceDevices({ page: 1, pageSize: 100 });
  const backfills = useAttendanceBackfills({ limit: 10 }, mayRecompute);
  const link = useLinkAttendanceEnrollment();
  const retry = useRetryAttendanceQuarantine();
  const discard = useDiscardAttendanceQuarantine();
  const cancel = useCancelAttendanceBackfill();
  const resume = useResumeAttendanceBackfill();

  const [linking, setLinking] = useState<AttendanceUnmatchedIdDto | null>(null);
  const [employeeId, setEmployeeId] = useState('');
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  // The candidate is looked up by the code the rule suggests, so the dialog can show WHO that
  // would be before anybody presses anything.
  const suggestion = suggestedCode(linking?.enrollmentNo ?? null);
  const suggested = useQuery({
    queryKey: listKey('hr', 'attendanceEmployeeSearch', suggestion ?? ''),
    queryFn: () => api.searchEmployees(suggestion ?? '', 4),
    enabled: suggestion !== null && linking !== null,
    staleTime: 30_000,
  });
  const search = useQuery({
    queryKey: listKey('hr', 'attendanceEmployeeSearch', employeeSearch),
    queryFn: () => api.searchEmployees(employeeSearch),
    enabled: employeeSearch.trim() !== '',
    staleTime: 30_000,
  });

  /** The registered wall a machine id was seen on, named rather than left as a code. */
  const deviceName = (code: string): string => {
    const device = (devices.data?.items ?? []).find((d) => d.code === code);
    return device === undefined ? code : `${device.code} · ${device.name ?? ''}`.trim();
  };

  const candidates = useMemo(() => {
    const rows = employeeSearch.trim() === '' ? (suggested.data?.items ?? []) : (search.data?.items ?? []);
    return rows.map((employee) => ({
      value: employee.id,
      label: `${employee.code} — ${employee.personal.fullNameAr}`,
    }));
  }, [employeeSearch, suggested.data, search.data]);

  const closeLink = (): void => {
    setLinking(null);
    setEmployeeId('');
    setEmployeeSearch('');
    setError(null);
  };

  /**
   * Link, then re-run that id's held scans through the IMPORT.
   *
   * The server queues a retry when an enrolment is created, and this asks for one as well on
   * purpose: the queued job is best-effort and the person standing in front of the screen is owed
   * a number. A row that is already a punch counts as resolved, so asking twice is harmless.
   */
  const doLink = (): void => {
    if (linking === null || employeeId === '') return;
    setError(null);
    link
      .mutateAsync({
        deviceId: deviceIdOf(linking.deviceId),
        enrollmentNo: linking.enrollmentNo ?? '',
        employeeId,
      })
      .then(() =>
        retry.mutateAsync({
          deviceId: linking.deviceId,
          ...(linking.enrollmentNo === null ? {} : { enrollmentNo: linking.enrollmentNo }),
          // The server defaults this; the contract type requires it, so it is stated. One id's
          // held history is well under the 5,000 ceiling — the largest on production holds 353.
          limit: 1_000,
        }),
      )
      .then(() => closeLink())
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };

  /** The enrolment endpoint keys on the device's id; the quarantine row carries its code. */
  const deviceIdOf = (code: string): string =>
    (devices.data?.items ?? []).find((d) => d.code === code)?.id ?? '';

  const doDiscard = (row: AttendanceUnmatchedIdDto): void => {
    setError(null);
    discard
      .mutateAsync({
        deviceId: row.deviceId,
        ...(row.enrollmentNo === null ? {} : { enrollmentNo: row.enrollmentNo }),
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };

  const columns: Column<AttendanceUnmatchedIdDto>[] = [
    {
      key: 'enrollmentNo',
      header: t('attendance.devices.machineId'),
      render: (row) => (
        <span className="font-mono text-xs font-semibold" dir="ltr">
          {row.enrollmentNo ?? row.employeeNumber ?? '—'}
        </span>
      ),
    },
    {
      key: 'device',
      header: t('attendance.devices.device'),
      render: (row) => (
        <span className="text-xs" dir="ltr">
          {deviceName(row.deviceId)}
        </span>
      ),
    },
    {
      key: 'rows',
      header: t('attendance.devices.heldRows'),
      render: (row) => <span className="font-mono text-xs tabular-nums">{row.rows}</span>,
    },
    {
      key: 'span',
      header: t('attendance.devices.span'),
      render: (row) => (
        <span className="text-xs" dir="ltr">
          {formatBusinessDateTime(row.firstAt, locale)} → {formatBusinessDateTime(row.lastAt, locale)}
        </span>
      ),
    },
    {
      key: 'suggestion',
      header: t('attendance.devices.suggestion'),
      render: (row) => {
        const code = suggestedCode(row.enrollmentNo);
        return code === null ? (
          <span className="text-xs text-[color:var(--att-muted)]">—</span>
        ) : (
          <span className="font-mono text-xs" dir="ltr">
            {code}
          </span>
        );
      },
    },
    // Buttons a reader has no permission for are NOT drawn disabled — they are not drawn.
    ...(mayManage
      ? [
          {
            key: 'actions',
            header: t('common.actions'),
            render: (row: AttendanceUnmatchedIdDto) => (
              <span className="flex flex-wrap justify-end gap-2">
                <Button size="sm" onClick={() => setLinking(row)}>
                  {t('attendance.devices.link')}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => doDiscard(row)}>
                  {t('attendance.devices.ignore')}
                </Button>
              </span>
            ),
          } satisfies Column<AttendanceUnmatchedIdDto>,
        ]
      : []),
  ];

  const rows = unmatched.data ?? [];
  const heldRows = rows.reduce((sum, row) => sum + row.rows, 0);

  return (
    <PageContainer>
      <PageHeader title={t('attendance.devices.title')} />
      <p className="mb-5 text-sm text-[color:var(--att-muted,#6b7280)]">
        {t('attendance.devices.subtitle')}
      </p>

      {error !== null && (
        <p role="alert" className="mb-3 text-sm text-red-600">
          {error}
        </p>
      )}

      {mayRecompute && (
        <section className="mb-6 rounded-xl border border-[var(--att-line,rgba(0,0,0,0.08))] p-4">
          <h2 className="mb-3 text-sm font-semibold">{t('attendance.devices.backfillTitle')}</h2>
          {backfills.isLoading ? (
            <Spinner />
          ) : (backfills.data ?? []).length === 0 ? (
            <p className="text-sm text-[color:var(--att-muted,#6b7280)]">
              {t('attendance.devices.backfillNone')}
            </p>
          ) : (
            <ul className="space-y-3">
              {(backfills.data ?? []).map((run: AttendanceBackfillDto) => (
                <li key={run.id} className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-sm">
                    <span dir="ltr" className="font-mono text-xs">
                      {run.from} → {run.to}
                    </span>{' '}
                    · {t(`attendance.devices.backfillStatus.${run.status}`)} ·{' '}
                    <span className="tabular-nums">
                      {run.doneDays}/{run.totalDays}
                    </span>{' '}
                    ({run.percent}%)
                    {run.failedChunks > 0 && (
                      <span className="ms-2 text-red-600">
                        {t('attendance.devices.backfillFailed', { n: run.failedChunks })}
                      </span>
                    )}
                  </span>
                  <span className="flex gap-2">
                    {run.status === 'running' && (
                      <Button size="sm" variant="secondary" onClick={() => cancel.mutate(run.id)}>
                        {t('common.cancel')}
                      </Button>
                    )}
                    {run.status !== 'completed' && run.status !== 'running' && (
                      <Button size="sm" variant="secondary" onClick={() => resume.mutate(run.id)}>
                        {t('attendance.devices.resume')}
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <p className="mb-3 text-sm text-[color:var(--att-muted,#6b7280)]">
        {t('attendance.devices.summary', { ids: rows.length, rows: heldRows })}
      </p>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => `${row.deviceId}|${row.enrollmentNo ?? row.employeeNumber ?? ''}`}
        loading={unmatched.isLoading}
        error={unmatched.isError ? unmatched.error : null}
        onRetry={() => void unmatched.refetch()}
        empty={t('attendance.devices.empty')}
      />

      {linking !== null && (
        <Dialog open onClose={closeLink} title={t('attendance.devices.linkTitle')}>
          <div className="space-y-4">
            <p className="text-sm">
              {t('attendance.devices.linkBody', {
                id: linking.enrollmentNo ?? '',
                rows: linking.rows,
              })}
            </p>
            {suggestion !== null && (
              <p className="text-xs text-[color:var(--att-muted,#6b7280)]">
                {t('attendance.devices.linkSuggestion', { code: suggestion })}
              </p>
            )}
            <Field label={t('attendance.devices.search')}>
              <Input
                value={employeeSearch}
                onChange={(e) => setEmployeeSearch(e.target.value)}
                placeholder={t('attendance.devices.searchPlaceholder')}
              />
            </Field>
            <Field label={t('attendance.devices.employee')}>
              <SearchableSelect
                value={employeeId}
                onChange={setEmployeeId}
                options={candidates}
                placeholder={t('attendance.devices.employeePlaceholder')}
                loading={suggested.isLoading || search.isLoading}
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={closeLink}>
                {t('common.cancel')}
              </Button>
              <Button onClick={doLink} disabled={employeeId === '' || link.isPending || retry.isPending}>
                {t('attendance.devices.confirmLink')}
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </PageContainer>
  );
};
