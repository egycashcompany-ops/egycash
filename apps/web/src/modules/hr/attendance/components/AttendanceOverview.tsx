// One employee's attendance over a stretch of days — the SAME view wherever it is opened: the
// employee month page, the Attendance tab of a profile, and My Attendance.
//
// ONE COMPONENT RATHER THAN THREE COPIES. The three screens differ only in who the subject is and
// which endpoint answers for them (`/days` scoped, or `/days/me` which is own-scope by
// construction). Everything below that — what is counted, how it is drawn, which chips appear —
// is the same question about the same rows, and three copies of it would drift apart by the
// second change. An employee looking at themselves therefore sees exactly what HR sees about
// them, minus the controls their keys do not open.
//
// WHAT IT ANSWERS, in the order it answers it: who this is and when they were last seen · how the
// period went in four figures · the shape of those days · and then every day, newest first.
import { type AttendanceDayDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { Can } from '../../../../platform/rbac/Can';
import { Badge, Button, Card, CardBody, CardHeader } from '../../../../shared/ui';
import { StatCard } from '../../../../shared/ui/StatCard';
import { Input } from '../../../../shared/ui/form';
import {
  CalendarIcon,
  DownloadIcon,
  FingerprintIcon,
  HistoryIcon,
  LogOutIcon,
} from '../../../../shared/ui/icons';
import { formatBusinessDateTime, formatNumber } from '../../../../shared/lib/format';
import { DaysTable } from './DaysTable';
import { HoursPerDayChart } from './HoursPerDayChart';
import { SheetAvatar } from './SheetAvatar';
import { clockAt, periodStats } from './attendance-stats';
import { formatMinutes } from './minutes';
import {
  addDays,
  MAX_PERIOD_DAYS,
  PERIOD_KEYS,
  periodRange,
  rangeLabel,
  type PeriodKey,
  type PeriodRange,
} from './period';

/** Who the period is about. Everything but the id may be unknown without breaking the card. */
export interface AttendanceSubject {
  employeeId: string;
  name: string;
  code: string | null;
  department: string | null;
  photoFileId: string | null;
}

export interface PeriodState extends PeriodRange {
  key: PeriodKey;
}

/** This month · last month · 30 days · custom. A segmented control, not a dropdown: four choices. */
const PeriodPicker = ({
  period,
  onChange,
}: {
  period: PeriodState;
  onChange: (next: PeriodState) => void;
}): JSX.Element => {
  const t = useT();
  const choose = (key: PeriodKey): void => {
    // `custom` keeps the dates already on screen as its starting point, so choosing it does not
    // blank the view and ask the reader to rebuild it.
    onChange(key === 'custom' ? { ...period, key } : { key, ...periodRange(key) });
  };

  /**
   * A hand-typed range is held to the same 92 days the server's export and recompute are capped
   * at — and, more immediately, to a page the screen can actually show: one request carries at
   * most `MAX_PAGE_SIZE` rows, so a longer range would quietly drop days off the end of the table
   * and out of every figure above it. The end the reader did NOT just touch is the one that moves.
   */
  const spanDays = (from: string, to: string): number =>
    (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000 + 1;

  const setFrom = (from: string): void => {
    if (from === '') return;
    const to = period.to < from ? from : period.to;
    onChange({
      ...period,
      from,
      to: spanDays(from, to) > MAX_PERIOD_DAYS ? addDays(from, MAX_PERIOD_DAYS - 1) : to,
    });
  };

  const setTo = (to: string): void => {
    if (to === '') return;
    const from = to < period.from ? to : period.from;
    onChange({
      ...period,
      to,
      from: spanDays(from, to) > MAX_PERIOD_DAYS ? addDays(to, -(MAX_PERIOD_DAYS - 1)) : from,
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div
        role="group"
        aria-label={t('attendance.period.label')}
        className="inline-flex rounded-lg border border-slate-200 p-0.5 dark:border-slate-700"
      >
        {PERIOD_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => choose(key)}
            aria-pressed={period.key === key}
            className={
              period.key === key
                ? 'rounded-md bg-brand-50 px-3 py-1 text-sm font-medium text-brand-700 dark:bg-brand-950 dark:text-brand-200'
                : 'rounded-md px-3 py-1 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }
          >
            {t(`attendance.period.${key}`)}
          </button>
        ))}
      </div>
      {period.key === 'custom' && (
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={period.from}
            onChange={(e) => setFrom(e.target.value)}
            aria-label={t('attendance.period.from')}
            dir="ltr"
            className="w-auto"
          />
          <Input
            type="date"
            value={period.to}
            onChange={(e) => setTo(e.target.value)}
            aria-label={t('attendance.period.to')}
            dir="ltr"
            className="w-auto"
          />
        </div>
      )}
    </div>
  );
};

export const AttendanceOverview = ({
  subject,
  rows,
  loading,
  error,
  onRetry,
  period,
  onPeriodChange,
  onExport,
  exporting = false,
  empty,
  children,
}: {
  subject: AttendanceSubject;
  rows: AttendanceDayDto[];
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  period: PeriodState;
  onPeriodChange: (next: PeriodState) => void;
  /** Offered only where `attendance.export` is held — an employee reads their own month. */
  onExport?: () => void;
  exporting?: boolean;
  empty?: JSX.Element;
  /** What the host screen adds under the record: the change log, the regularization list. */
  children?: React.ReactNode;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const stats = periodStats(rows);

  /** Newest first — the question asked of this table is almost always about a recent day. */
  const newestFirst = [...rows].sort((a, b) => b.workDate.localeCompare(a.workDate));

  /** Said only when there is something to say: a chip reading «0» is noise on every profile. */
  const chips = [
    { key: 'checkedInOnly', count: stats.checkedInOnlyDays, tone: 'neutral' as const },
    { key: 'noSchedule', count: stats.noScheduleDays, tone: 'warning' as const },
    { key: 'absent', count: stats.absentDays, tone: 'danger' as const },
    { key: 'decided', count: stats.decidedDays, tone: 'info' as const },
  ].filter((chip) => chip.count > 0);

  return (
    <div className="space-y-4">
      <Card>
        <CardBody className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <SheetAvatar
              employeeId={subject.employeeId}
              photoFileId={subject.photoFileId}
              name={subject.name}
              size="lg"
            />
            <div className="min-w-0">
              <p className="truncate text-lg font-semibold text-slate-900 dark:text-white">
                {subject.name}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                {subject.code !== null && (
                  <span dir="ltr" className="font-mono">
                    {subject.code}
                  </span>
                )}
                {subject.department !== null && <span>{subject.department}</span>}
                {stats.lastPunchAt !== null && (
                  <span>
                    {t('attendance.overview.lastPunch', {
                      at: formatBusinessDateTime(stats.lastPunchAt, locale),
                    })}
                  </span>
                )}
                {chips.map((chip) => (
                  <Badge key={chip.key} tone={chip.tone} size="sm">
                    {t(`attendance.overview.chip.${chip.key}`, {
                      count: formatNumber(chip.count, locale),
                    })}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <PeriodPicker period={period} onChange={onPeriodChange} />
            {onExport !== undefined && (
              <Can permission="attendance.export">
                <Button
                  size="sm"
                  variant="secondary"
                  loading={exporting}
                  leftIcon={<DownloadIcon className="h-4 w-4" />}
                  onClick={onExport}
                >
                  {t('attendance.daily.export')}
                </Button>
              </Can>
            )}
          </div>
        </CardBody>
      </Card>

      {/* Full width on a phone, two from `sm`, four on a desktop. Two across at 390px looked
          tighter but truncated «الحضور المعتاد» to «الحضور ال...» — a label nobody can read is
          worse than a screen that scrolls. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={t('attendance.overview.daysPresent')}
          icon={CalendarIcon}
          value={formatNumber(stats.attendedDays, locale)}
          caption={t('attendance.overview.outOfWorkingDays', {
            total: formatNumber(stats.expectedDays, locale),
          })}
          tone="success"
          loading={loading === true && rows.length === 0}
        />
        <StatCard
          label={t('attendance.overview.usualArrival')}
          icon={FingerprintIcon}
          {...(stats.averageArrivalMinutes === null
            ? {}
            : { value: clockAt(stats.averageArrivalMinutes, locale) })}
          caption={t('attendance.overview.usualArrivalHint')}
          tone="brand"
          loading={loading === true && rows.length === 0}
        />
        <StatCard
          label={t('attendance.overview.usualDeparture')}
          icon={LogOutIcon}
          {...(stats.averageDepartureMinutes === null
            ? {}
            : { value: clockAt(stats.averageDepartureMinutes, locale) })}
          caption={t('attendance.overview.usualDepartureHint')}
          tone="brand"
          loading={loading === true && rows.length === 0}
        />
        <StatCard
          label={t('attendance.overview.hoursPerDay')}
          icon={HistoryIcon}
          {...(stats.averageWorkedMinutes === null
            ? {}
            : { value: formatMinutes(stats.averageWorkedMinutes, locale) })}
          caption={t('attendance.overview.hoursTotal', {
            total: formatMinutes(stats.totalWorkedMinutes, locale),
          })}
          tone="neutral"
          loading={loading === true && rows.length === 0}
        />
      </div>

      <HoursPerDayChart rows={rows} averageMinutes={stats.averageWorkedMinutes} />

      <Card>
        <CardHeader
          title={t('attendance.overview.record')}
          description={`${rangeLabel(period, locale)} · ${t('attendance.overview.newestFirst')}`}
        />
        <DaysTable
          rows={newestFirst}
          loading={loading ?? false}
          error={error}
          {...(onRetry === undefined ? {} : { onRetry })}
          {...(empty === undefined ? {} : { empty })}
        />
      </Card>

      {children}
    </div>
  );
};
