// One person's attendance — what opens on the employee's profile (and what an employee sees for
// themselves). Redesigned as a dashboard: a header, a row of KPI cards, the period as a full-width
// calendar, the two trends side by side, then the day-by-day record with each day's scan log.
// Presentational: the page computes the figures and passes them in.
import type { ReactNode } from 'react';
import { cn } from '../../../../shared/lib/cn';
import { ArrivalTrend, HoursBars } from './view-charts';
import { MonthCalendar, type CalendarLegendItem } from './MonthCalendar';
import { DayRecord } from './DayRecord';
import { RepeatScansLog, repeatDays } from './repeat-scans-log';
import { AttendanceCanvas, DOT, FIG, INK, INK2, INK3, PageHeader, PersonAvatar, Sheet, SheetHead, Tag, type Tone } from './view-parts';
import { arrow, clock, duration, num } from './view-format';
import { useViewLabels } from './view-labels';
import { sortEmployeeDays } from './day-order';
import type {
  EmployeeDay,
  EmployeeDaySort,
  EmployeeDaysSort,
  EmployeeHeader,
  EmployeeKpis,
  ViewStatus,
} from './view-types';

export interface EmployeeAttendanceViewProps {
  employee: EmployeeHeader;
  /** The period control (this month / last month / 30 days / custom), owned by the page. */
  periodPicker: ReactNode;
  /** «19 أكتوبر – 17 نوفمبر 2026», already formatted. */
  periodLabel: string;
  kpis: EmployeeKpis;
  /** Every day of the period, oldest → newest. */
  days: EmployeeDay[];
  /** Start of this person's working day and its grace, minutes; null when nobody said. */
  dayStart: number | null;
  grace: number;
  /** ISO date of today, to ring it on the calendar. */
  today?: string;
  /** The date the reader picked on the calendar; ringed there and highlighted in the record. */
  picked?: string | null;
  onPickDay?: (date: string) => void;
  onExport?: () => void;
  sort?: EmployeeDaysSort;
  onSort?: (by: EmployeeDaySort, dir: 'asc' | 'desc') => void;
  /** Inside the employee's profile, which already shows who this is: no second avatar and name. */
  compactHeader?: boolean;
}

const LEGEND_GROUPS: { tone: Tone; statuses: ViewStatus[]; key: 'present' | 'late' | 'incomplete' | 'absent' | 'onLeave' }[] = [
  { tone: 'ok', statuses: ['present'], key: 'present' },
  { tone: 'warn', statuses: ['late', 'earlyLeave', 'lateAndEarly'], key: 'late' },
  { tone: 'warn', statuses: ['incomplete'], key: 'incomplete' },
  { tone: 'bad', statuses: ['absent'], key: 'absent' },
  { tone: 'info', statuses: ['onLeave'], key: 'onLeave' },
];

export const EmployeeAttendanceView = (p: EmployeeAttendanceViewProps): JSX.Element => {
  const { employee, kpis, days } = p;
  const { t, status, locale } = useViewLabels();
  const dur = (m: number | null): string => duration(m, t('hours'), t('minutes'));
  const sort: EmployeeDaysSort = p.sort ?? { by: 'date', dir: 'desc' };
  const ordered = sortEmployeeDays(days, sort.by, sort.dir);
  const meta = [employee.jobTitle, employee.department, employee.branch].filter(
    (x): x is string => typeof x === 'string' && x !== '',
  );
  const onTimeRate = kpis.daysPresent > 0 ? Math.round(((kpis.daysPresent - kpis.lateDays) / kpis.daysPresent) * 100) : 0;
  const presence = kpis.daysExpected > 0 ? Math.round((kpis.daysPresent / kpis.daysExpected) * 100) : 0;

  const legend: CalendarLegendItem[] = [
    ...LEGEND_GROUPS.map((g) => ({
      tone: g.tone,
      label: g.key === 'incomplete' ? status('incomplete') : t(g.key),
      count: days.filter((d) => g.statuses.includes(d.status)).length,
    })),
    {
      tone: 'muted' as const,
      label: t('legendOther'),
      count: days.filter((d) => ['dayOff', 'holiday', 'noSchedule', 'noRecord', 'notYetIn'].includes(d.status)).length,
    },
  ];

  return (
    <AttendanceCanvas>
      <PageHeader
        {...(p.compactHeader === true ? {} : { lead: <PersonAvatar name={employee.name} photoUrl={employee.photoUrl} size="lg" /> })}
        eyebrow={
          p.compactHeader === true ? (
            t('attendance')
          ) : (
            <span>
              <bdi className={FIG}>#{employee.code}</bdi>
              {meta.length > 0 ? ` · ${meta.join(' · ')}` : ''}
            </span>
          )
        }
        title={p.compactHeader === true ? p.periodLabel : employee.name}
        meta={
          <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
            {employee.lastPunch && (
              <span className="inline-flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-[var(--att-ok)]" />
                {t('lastPunch')} <bdi className={cn('font-semibold', INK)}>{employee.lastPunch}</bdi>
              </span>
            )}
            {p.compactHeader !== true && <span className={INK3}>{p.periodLabel}</span>}
          </span>
        }
        actions={
          <>
            {p.periodPicker}
            {p.onExport !== undefined && (
              <button type="button" className="att-btn" onClick={p.onExport}>
                {t('exportCsv')}
              </button>
            )}
          </>
        }
      />

      {/* KPI cards — one number each, large, with the one line that explains it. */}
      {/* Four cards, not six: attendance, punctuality, the usual day, and the hours. */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <Kpi tone="ok" label={t('daysPresent')} value={`${kpis.daysPresent}`} suffix={`/${kpis.daysExpected}`} note={`${presence}%`} bar={presence} />
        <Kpi
          tone={kpis.lateDays > 0 ? 'warn' : 'ok'}
          label={t('onTimeRate')}
          value={`${onTimeRate}%`}
          note={`${num(kpis.lateDays)} ${t('lateDays')}`}
          bar={onTimeRate}
        />
        <Kpi
          tone="accent"
          label={t('usualDay')}
          value={clock(kpis.usualArrival)}
          suffix={`${arrow()} ${clock(kpis.usualDeparture)}`}
          note={`${t('usualArrival')} · ${t('usualDeparture')}`}
        />
        <Kpi
          tone={kpis.shortfallTotal > 0 ? 'warn' : 'info'}
          label={t('hoursPerDay')}
          value={dur(kpis.avgWorked)}
          note={kpis.shortfallTotal > 0 ? `${t('shortfallCol')} ${dur(kpis.shortfallTotal)}` : t('inTotal', { t: dur(kpis.totalWorked) })}
        />
      </div>

      <Sheet>
        <SheetHead
          title={t('calendarTitle')}
          note={t('calendarNote', { a: kpis.absentDays, l: kpis.lateDays })}
          actions={kpis.incompleteDays > 0 ? <Tag tone="warn">{`${num(kpis.incompleteDays)} ${status('incomplete')}`}</Tag> : undefined}
        />
        <div className="pt-4">
          <MonthCalendar
            days={days}
            weekdays={t('weekdays').split(',')}
            statusLabel={status}
            locale={locale}
            legend={legend}
            {...(p.today !== undefined ? { today: p.today } : {})}
            {...(p.picked !== undefined ? { picked: p.picked } : {})}
            {...(p.onPickDay !== undefined ? { onPick: p.onPickDay } : {})}
          />
        </div>
      </Sheet>

      <div className="grid gap-5 lg:grid-cols-2 sm:gap-6">
        <Sheet>
          <SheetHead
            title={t('punctualityTitle')}
            note={
              p.dayStart === null
                ? t('punctualityNoteNoRoster', { u: clock(kpis.usualArrival) })
                : t('punctualityNote', { u: clock(kpis.usualArrival), s: clock(p.dayStart) })
            }
          />
          <div className="pt-6">
            <ArrivalTrend days={days} dayStart={p.dayStart} grace={p.grace} usual={kpis.usualArrival} labels={{ limit: t('lateAfter'), usual: t('usualDay'), week: (n) => t('weekN', { n }), empty: t('noDays') }} locale={locale} />
          </div>
        </Sheet>
        <Sheet>
          <SheetHead title={t('hoursChart')} note={kpis.avgWorked !== null ? t('hoursChartNote', { t: dur(kpis.avgWorked) }) : t('hoursChartEmpty')} />
          <div className="pt-5">
            <HoursBars days={days} avg={kpis.avgWorked} locale={locale} format={dur} weekLabel={(n) => t('weekN', { n })} />
          </div>
        </Sheet>
      </div>

      <Sheet className="overflow-hidden">
        <SheetHead
          title={t('dailyRecord')}
          note={`${p.periodLabel} · ${sort.by === 'date' && sort.dir === 'desc' ? t('newestFirst') : t('oldestFirst')}`}
        />
        {ordered.length === 0 ? (
          <p className={cn('px-6 py-16 text-center text-sm', INK3)}>{t('noDays')}</p>
        ) : (
          <div className="mt-4">
            <DayRecord days={ordered} locale={locale} picked={p.picked} today={p.today ?? ""} sort={sort} onSort={p.onSort} />
          </div>
        )}
      </Sheet>

      {/* THE REPEATED SCANS LOG — days with more than one check-in or check-out */}
      <Sheet className="overflow-hidden">
        <SheetHead title={t('repeatLog')} note={`${t('repeatLogNote')} · ${num(repeatDays(days).length)}`} />
        <div className="mt-3">
          <RepeatScansLog days={days} locale={locale} />
        </div>
      </Sheet>
    </AttendanceCanvas>
  );
};

const KPI_BAR: Record<Tone, string> = {
  ok: 'bg-[var(--att-ok)]',
  warn: 'bg-[var(--att-warn)]',
  bad: 'bg-[var(--att-bad)]',
  info: 'bg-[var(--att-info)]',
  muted: 'bg-[var(--att-muted)]',
  accent: 'bg-[var(--att-accent)]',
};

const Kpi = ({
  label,
  value,
  suffix,
  note,
  tone,
  bar,
}: {
  label: string;
  value: string;
  suffix?: string;
  note: string;
  tone: Tone;
  bar?: number;
}): JSX.Element => (
  <div className="att-kpi px-5 py-5 sm:px-6">
    <p className={cn('flex items-center gap-2 text-[12.5px] font-medium', INK2)}>
      <span className={cn('h-2 w-2 rounded-full', DOT[tone])} />
      <span className="truncate">{label}</span>
    </p>
    <p className={cn('mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[28px] font-semibold leading-none tracking-[-0.02em] sm:text-[34px]', FIG, INK)}>
      <bdi>{value}</bdi>
      {suffix !== undefined && <span className={cn('text-[14px] font-medium', INK3)}>{suffix}</span>}
    </p>
    {bar !== undefined ? (
      <div className="mt-3 flex items-center gap-2">
        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--att-muted-soft)]">
          <span className={cn('block h-full rounded-full', KPI_BAR[tone])} style={{ width: `${Math.max(0, Math.min(100, bar))}%` }} />
        </span>
        <span className={cn('text-[11.5px]', FIG, INK3)}>{note}</span>
      </div>
    ) : (
      <p className={cn('mt-3 truncate text-[12px]', INK3)}>{note}</p>
    )}
  </div>
);
