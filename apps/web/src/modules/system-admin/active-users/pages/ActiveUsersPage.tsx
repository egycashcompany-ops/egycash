// «المستخدمون النشطون» — who has the system open now, who is working, and for how long.
//
// «عايز فى مديول الإدارة تضيف صفحة جديدة أسمها المستخدمين النشطين .. وتقولى مين فاتح دلوقتى
// وشغال .. ووقت كل واحد على السيستم..».
//
// What each figure means is the server's (`packages/contracts/src/platform/presence.ts`):
//   • «نشط الآن» — used the system within the last two minutes;
//   • «خامل» — signed in, the page open, nobody touching it;
//   • «وقت العمل» — the minutes of the day in which the person was actually using it, each minute
//     counted once however many tabs or devices were open.
//
// Today the page is live: it asks again every 30 seconds. Another day shows that day's working
// time, first and last activity — nobody is «online» on a day that is over.
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  PRESENCE_STATUSES,
  cairoYmd,
  type ActiveUserRowDto,
  type Locale,
  type PresenceStatus,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import {
  DataTable,
  EmptyState,
  FilterBar,
  Input,
  SearchInput,
  Select,
  StatStrip,
  StatusBadge,
  type Column,
  type Tone,
} from '../../../../shared/ui';
import { Portrait } from '../../../../shared/ui/Portrait';
import { fullName } from '../../../../shared/lib/format';
import { relativeTimeText } from '../../../../shared/lib/relative-time';
import { useRememberedFilters } from '../../../../shared/lib/useRememberedFilters';
import { useBranchOptions } from '../../users/api/user-queries';
import { ACTIVE_USERS_REFRESH_MS, useActiveUsers } from '../api/active-users-api';
import { hoursAndMinutes, minutesBetween } from '../lib/presence-format';

/** Remembered across visits: the filters. The day is not — the page opens on today. */
const REMEMBERED_FILTERS = ['q', 'status', 'branch'] as const;

const STATUS_TONE: Record<PresenceStatus, Tone> = {
  active: 'success',
  idle: 'warning',
  offline: 'neutral',
};

const intlLocale = (locale: Locale): string => (locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB');

/** «10:42 ص» — a time of day in Cairo, whatever the device's clock says. */
const clockTime = (iso: string, locale: Locale): string =>
  new Intl.DateTimeFormat(intlLocale(locale), {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Africa/Cairo',
  }).format(new Date(iso));

export const ActiveUsersPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);

  const today = cairoYmd(new Date());
  const search = sp.get('q') ?? '';
  const status = (PRESENCE_STATUSES as readonly string[]).includes(sp.get('status') ?? '')
    ? (sp.get('status') as PresenceStatus)
    : null;
  const branchId = sp.get('branch') ?? '';
  const requestedDay = sp.get('day') ?? '';
  const day =
    /^\d{4}-\d{2}-\d{2}$/.test(requestedDay) && requestedDay <= today ? requestedDay : today;

  const patch = (updates: Record<string, string | null>): void => {
    const next = new URLSearchParams(sp);
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    setSp(next, { replace: true });
  };

  const query = useMemo(
    () => ({
      ...(day === today ? {} : { day }),
      ...(status === null ? {} : { status }),
      ...(search.trim() === '' ? {} : { search: search.trim() }),
      ...(branchId === '' ? {} : { branchId }),
    }),
    [day, today, status, search, branchId],
  );
  const { data, isLoading, isError, error, refetch, dataUpdatedAt } = useActiveUsers(query);
  const { data: branches = [] } = useBranchOptions();
  const rows = data?.rows ?? [];
  const isToday = data?.today ?? day === today;
  const now = dataUpdatedAt > 0 ? dataUpdatedAt : Date.now();

  const duration = (minutes: number): string => {
    const { h, m } = hoursAndMinutes(minutes);
    return h === 0
      ? t('systemAdmin.activeUsers.duration.minutes', { m })
      : t('systemAdmin.activeUsers.duration.hoursMinutes', { h, m });
  };

  const totals = data?.totals;
  const statItems = [
    ...(isToday
      ? (['active', 'idle'] as const).map((key) => ({
          key,
          label: t(`systemAdmin.activeUsers.totals.${key}`),
          ...(totals === undefined ? {} : { value: String(totals[key]) }),
          loading: isLoading,
          active: status === key,
          // A metric that is also a view of the list below.
          onClick: () => patch({ status: status === key ? null : key }),
        }))
      : []),
    {
      key: 'people',
      label: t('systemAdmin.activeUsers.totals.people'),
      ...(totals === undefined
        ? {}
        : { value: String(totals.active + totals.idle + totals.offline) }),
      loading: isLoading,
    },
    {
      key: 'time',
      label: t('systemAdmin.activeUsers.totals.time'),
      ...(totals === undefined ? {} : { value: duration(totals.activeMinutes) }),
      loading: isLoading,
    },
  ];

  const columns: Column<ActiveUserRowDto>[] = [
    {
      key: 'user',
      header: t('systemAdmin.activeUsers.columns.user'),
      render: (row) => {
        // An account named in Arabic only reads in Arabic on an English page, rather than blank.
        const name = fullName(row.name, locale) || fullName(row.name, 'ar');
        return (
          <div className="flex min-w-0 items-center gap-3">
            <Portrait url={null} name={name} size="sm" />
            <div className="min-w-0">
              <p className="truncate font-medium text-slate-800 dark:text-slate-100">{name}</p>
              <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                {[
                  row.employeeCode,
                  row.branch === null ? null : row.branch[locale] || row.branch.ar,
                ]
                  .filter((part) => part !== null && part !== '')
                  .join(' · ') ||
                  row.username ||
                  row.email}
              </p>
            </div>
          </div>
        );
      },
    },
    ...(isToday
      ? [
          {
            key: 'status',
            header: t('systemAdmin.activeUsers.columns.status'),
            render: (row: ActiveUserRowDto) => (
              <StatusBadge
                tone={STATUS_TONE[row.status]}
                label={t(`systemAdmin.activeUsers.status.${row.status}`)}
              />
            ),
          },
          {
            key: 'signedIn',
            header: t('systemAdmin.activeUsers.columns.signedIn'),
            render: (row: ActiveUserRowDto) =>
              row.signedInAt === null ? (
                <span className="text-slate-400 dark:text-slate-500">—</span>
              ) : (
                <div>
                  <p className="text-sm text-slate-800 dark:text-slate-100">
                    {clockTime(row.signedInAt, locale)}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {t('systemAdmin.activeUsers.signedInFor', {
                      duration: duration(minutesBetween(row.signedInAt, now)),
                    })}
                  </p>
                </div>
              ),
          },
        ]
      : []),
    {
      key: 'activeMinutes',
      header: t(
        isToday
          ? 'systemAdmin.activeUsers.columns.workedToday'
          : 'systemAdmin.activeUsers.columns.worked',
      ),
      render: (row) => (
        <span className="font-semibold tabular-nums text-slate-800 dark:text-slate-100">
          {row.activeMinutes === 0 ? '—' : duration(row.activeMinutes)}
        </span>
      ),
    },
    {
      key: 'activity',
      header: t('systemAdmin.activeUsers.columns.activity'),
      render: (row) =>
        row.firstActivityAt === null || row.lastActivityAt === null ? (
          <span className="text-slate-400 dark:text-slate-500">—</span>
        ) : (
          <div>
            <p className="text-sm text-slate-800 dark:text-slate-100">
              {clockTime(row.firstActivityAt, locale)} – {clockTime(row.lastActivityAt, locale)}
            </p>
            {isToday && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t('systemAdmin.activeUsers.lastActivity', {
                  when: relativeTimeText(Date.parse(row.lastActivityAt), now, locale),
                })}
              </p>
            )}
          </div>
        ),
    },
    ...(isToday
      ? [
          {
            key: 'devices',
            header: t('systemAdmin.activeUsers.columns.devices'),
            render: (row: ActiveUserRowDto) =>
              row.devices.length === 0 ? (
                <span className="text-slate-400 dark:text-slate-500">—</span>
              ) : (
                <ul className="space-y-0.5 text-xs text-slate-600 dark:text-slate-300">
                  {row.devices.map((device) => (
                    <li key={device.signedInAt} dir="auto">
                      {[device.browser, device.os].filter((part) => part !== null).join(' · ') ||
                        t('systemAdmin.activeUsers.unknownDevice')}
                      {device.mobile && ` · ${t('systemAdmin.activeUsers.mobile')}`}
                    </li>
                  ))}
                </ul>
              ),
          },
        ]
      : []),
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('systemAdmin.activeUsers.title')}
        breadcrumbs={[
          { label: t('systemAdmin.module.title') },
          { label: t('systemAdmin.activeUsers.title') },
        ]}
        aside={
          isToday && dataUpdatedAt > 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t('systemAdmin.activeUsers.updated', {
                time: clockTime(new Date(dataUpdatedAt).toISOString(), locale),
                seconds: ACTIVE_USERS_REFRESH_MS / 1000,
              })}
            </p>
          ) : undefined
        }
      />

      <div className="space-y-4">
        <StatStrip items={statItems} columns={isToday ? 4 : 3} />

        <FilterBar
          hasActiveFilters={search !== '' || status !== null || branchId !== '' || day !== today}
          onClear={() => setSp(new URLSearchParams(), { replace: true })}
        >
          <SearchInput
            value={search}
            onChange={(value) => patch({ q: value || null })}
            placeholder={t('systemAdmin.activeUsers.searchPlaceholder')}
          />
          {isToday && (
            <Select
              value={status ?? ''}
              onChange={(event) => patch({ status: event.target.value || null })}
              aria-label={t('systemAdmin.activeUsers.columns.status')}
            >
              <option value="">{t('systemAdmin.activeUsers.filters.anyStatus')}</option>
              {PRESENCE_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {t(`systemAdmin.activeUsers.status.${value}`)}
                </option>
              ))}
            </Select>
          )}
          {branches.length > 0 && (
            <Select
              value={branchId}
              onChange={(event) => patch({ branch: event.target.value || null })}
              aria-label={t('systemAdmin.activeUsers.filters.branch')}
            >
              <option value="">{t('systemAdmin.activeUsers.filters.anyBranch')}</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name[locale]}
                </option>
              ))}
            </Select>
          )}
          <Input
            type="date"
            value={day}
            max={today}
            onChange={(event) =>
              patch({ day: event.target.value === today ? null : event.target.value || null })
            }
            aria-label={t('systemAdmin.activeUsers.filters.day')}
            className="w-auto"
          />
        </FilterBar>

        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.userId}
          loading={isLoading}
          error={isError ? error : undefined}
          onRetry={() => void refetch()}
          empty={
            <EmptyState
              title={t(
                isToday ? 'systemAdmin.activeUsers.emptyToday' : 'systemAdmin.activeUsers.emptyDay',
              )}
            />
          }
        />
      </div>
    </PageContainer>
  );
};
